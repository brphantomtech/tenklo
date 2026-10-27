import { parseCommand } from '../contracts/index.js';

import type { Command } from '../contracts/index.js';
import type { Logger } from '../logger.js';

/** Same delays as the StackChat retry queues (.retry.1/2/3). */
export const RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000];
export const MAX_RETRIES = RETRY_DELAYS_MS.length;

export interface AttemptInfo {
    /** 0 on the first attempt. */
    attempt: number;
    /** Whether the command can still be retried later; if false the handler must settle it. */
    canRetry: boolean;
}

export type HandlerResult = 'done' | 'retry';

export type CommandHandler = (command: Command, info: AttemptInfo) => Promise<HandlerResult>;

/** Called when the body does not follow the contract. Receives the raw JSON. */
export type InvalidHandler = (raw: unknown, error: string) => Promise<void>;

export type SubmitResult = { accepted: true; commandId: string } | { accepted: false; error: string };

/**
 * Takes the place of the StackChat command queues: a command is validated, accepted and then executed in the
 * background, and its outcome is reported through events (channel.status, message.status, command.failed...).
 * Retries keep the queue semantics, but live in memory: a restart drops pending retries. Sends are still safe,
 * because their idempotency is kept in Redis.
 */
export class CommandDispatcher {
    private readonly timers = new Set<NodeJS.Timeout>();
    private readonly running = new Set<Promise<void>>();
    private stopped = false;

    constructor(
        private readonly handle: CommandHandler,
        private readonly onInvalid: InvalidHandler,
        private readonly logger: Logger
    ) {}

    async submit(raw: unknown): Promise<SubmitResult> {
        if (this.stopped) return { accepted: false, error: 'gateway is shutting down' };
        const parsed = parseCommand(raw);
        if (!parsed.ok) {
            this.logger.warn({ error: parsed.error }, 'command outside the contract');
            await this.onInvalid(raw, parsed.error).catch((err: unknown) => this.logger.warn({ err }, 'failed to report the invalid command'));
            return { accepted: false, error: parsed.error };
        }
        this.run(parsed.value, 0);
        return { accepted: true, commandId: parsed.value.commandId };
    }

    /** Stops accepting commands, cancels pending retries and waits for the running ones. */
    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timers.size) this.logger.warn({ count: this.timers.size }, 'pending command retries dropped on shutdown');
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        await Promise.allSettled(this.running);
    }

    private run(command: Command, attempt: number): void {
        const task = this.execute(command, attempt).finally(() => this.running.delete(task));
        this.running.add(task);
    }

    private async execute(command: Command, attempt: number): Promise<void> {
        const log = { commandType: command.type, commandId: command.commandId, channelId: command.channelId, attempt };
        try {
            const result = await this.handle(command, { attempt, canRetry: attempt < MAX_RETRIES });
            if (result !== 'retry') return;
            if (attempt >= MAX_RETRIES || this.stopped) {
                this.logger.error(log, 'command gave up after the last retry');
                return;
            }
            const timer = setTimeout(() => {
                this.timers.delete(timer);
                if (!this.stopped) this.run(command, attempt + 1);
            }, RETRY_DELAYS_MS[attempt]);
            this.timers.add(timer);
        } catch (err) {
            this.logger.error({ ...log, err }, 'unexpected error while running a command');
        }
    }
}
