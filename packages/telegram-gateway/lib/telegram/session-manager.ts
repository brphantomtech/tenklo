import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { ChannelLockedError } from '../errors.js';
import { keys } from '../storage/redis.js';
import { ChannelLock } from './channel-lock.js';
import { ChannelSession, sessionPrefix } from './channel-session.js';

import type { SessionDeps } from './channel-session.js';

const RESUME_LOCK_RETRIES = 4;
const RESUME_LOCK_RETRY_MS = 15_000;

/** Sessões (bots em long polling) abertas nesta instância, uma por canal. */
export class SessionManager {
    private readonly sessions = new Map<string, ChannelSession>();

    constructor(private readonly deps: Omit<SessionDeps, 'onClosed'>) {}

    get(channelId: string): ChannelSession | undefined {
        const session = this.sessions.get(channelId);
        return session && !session.isClosed ? session : undefined;
    }

    get size(): number {
        return this.sessions.size;
    }

    /**
     * Idempotente: com a sessão já aberta com o mesmo token, só repete o status atual. Com outro token (bot trocado ou
     * token regenerado no BotFather), fecha a sessão atual e abre com o novo.
     */
    async connect(tenantId: string, channelId: string, correlationId: string, sealedBotToken?: string): Promise<void> {
        const existing = this.get(channelId);
        if (existing) {
            if (!sealedBotToken || existing.usesToken(sealedBotToken)) {
                await existing.announce(correlationId);
                return;
            }
            await existing.shutdown();
        }
        const session = this.create(tenantId, channelId);
        try {
            await session.start(correlationId, sealedBotToken);
        } catch (err) {
            this.sessions.delete(channelId);
            throw err;
        }
    }

    async disconnect(tenantId: string, channelId: string, correlationId: string, clearSession: boolean): Promise<void> {
        const session = this.get(channelId);
        if (session) {
            await session.disconnect(correlationId, clearSession);
            return;
        }

        // Sem sessão aberta aqui: limpa o que estiver salvo, desde que nenhuma outra instância esteja com o canal.
        const lock = new ChannelLock(this.deps.redis, channelId, this.deps.config.INSTANCE_ID, this.deps.logger);
        if (!(await lock.acquire(() => undefined))) throw new ChannelLockedError(channelId);
        try {
            if (clearSession) {
                await this.deps.storage.deleteSessionPrefix(sessionPrefix(tenantId, channelId));
                await this.deps.redis.del(keys.offset(channelId), keys.groups(channelId));
            }
            await this.deps.registry.remove(channelId);
        } finally {
            await lock.release();
        }
        await this.deps.events.publish({ tenantId, channelId, correlationId }, 'channel.status', `status:${randomUUID()}`, {
            status: 'DISCONNECTED',
            reason: 'REQUESTED'
        });
    }

    /**
     * Retoma em segundo plano as sessões do registro, com o token salvo. Se o lock ainda estiver com a instância anterior
     * (reinício com outro hostname), espera ele expirar.
     */
    resumeAll(): void {
        void this.deps.registry
            .list()
            .then((entries) => {
                this.deps.logger.info({ count: entries.length }, 'retomando sessões salvas');
                for (const { tenantId, channelId } of entries) void this.resume(tenantId, channelId);
            })
            .catch((err: unknown) => this.deps.logger.error({ err }, 'falha ao ler o registro de canais'));
    }

    async shutdown(): Promise<void> {
        await Promise.allSettled([...this.sessions.values()].map((s) => s.shutdown()));
    }

    private async resume(tenantId: string, channelId: string): Promise<void> {
        const log = this.deps.logger.child({ tenantId: tenantId, channelId: channelId });
        for (let attempt = 1; attempt <= RESUME_LOCK_RETRIES; attempt++) {
            if (this.get(channelId)) return;
            const session = this.create(tenantId, channelId);
            try {
                const opened = await session.start(randomUUID(), undefined, { resumeOnly: true });
                if (!opened) {
                    this.sessions.delete(channelId);
                    log.info('sem token para retomar; canal removido do registro');
                }
                return;
            } catch (err) {
                this.sessions.delete(channelId);
                if (!(err instanceof ChannelLockedError)) {
                    log.error({ err }, 'falha ao retomar a sessão');
                    return;
                }
                if (attempt < RESUME_LOCK_RETRIES) await sleep(RESUME_LOCK_RETRY_MS);
            }
        }
        log.info('sessão continua com outra instância; não será retomada aqui');
    }

    private create(tenantId: string, channelId: string): ChannelSession {
        const session = new ChannelSession(tenantId, channelId, {
            ...this.deps,
            onClosed: (closed) => {
                if (this.sessions.get(channelId) === closed) this.sessions.delete(channelId);
            }
        });
        this.sessions.set(channelId, session);
        return session;
    }
}
