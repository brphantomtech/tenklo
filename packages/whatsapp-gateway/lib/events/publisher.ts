import { randomUUID } from 'node:crypto';

import { assertValidEvent } from '../contracts/index.js';

import type { Event, EventOf, EventPayload } from '../contracts/index.js';
import type { Logger } from '../logger.js';

export interface EventContext {
    tenantId: string;
    channelId: string;
    /** The one of the command that caused the event; a new one for spontaneous events (drop, read receipt). */
    correlationId: string;
}

export interface EventSink {
    publish<T extends Event['type']>(ctx: EventContext, type: T, providerEventId: string, payload: EventPayload<T>): Promise<void>;
}

const ATTEMPTS = 4;
const TIMEOUT_MS = 10_000;

/**
 * Delivers each event to the Tenklo server (the role the receive queue had in StackChat). Same envelope and contract
 * as the queue, so a consumer of the queue can consume these too.
 *
 * Retries a few times with backoff; the server deduplicates on eventId/providerEventId. After the last attempt the
 * event is logged and dropped: Baileys already acknowledged it to WhatsApp, and holding the session for it would
 * be worse.
 */
export class HttpEventPublisher implements EventSink {
    constructor(
        private readonly url: string,
        private readonly secret: string,
        private readonly logger: Logger,
        private readonly fetchImpl: typeof fetch = fetch
    ) {}

    async publish<T extends Event['type']>(ctx: EventContext, type: T, providerEventId: string, payload: EventPayload<T>): Promise<void> {
        const event = buildEvent(ctx, type, providerEventId, payload);
        assertValidEvent(event);
        const body = JSON.stringify(event);

        for (let attempt = 1; ; attempt++) {
            try {
                const res = await this.fetchImpl(this.url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
                    body,
                    signal: AbortSignal.timeout(TIMEOUT_MS)
                });
                if (res.ok) return;
                // 4xx other than 429 will not get better by retrying.
                if (res.status < 500 && res.status !== 429) {
                    this.logger.error({ type, status: res.status, channelId: ctx.channelId }, 'event rejected by the server');
                    return;
                }
                throw new Error(`server answered ${res.status}`);
            } catch (err) {
                if (attempt >= ATTEMPTS) {
                    this.logger.error({ err, type, channelId: ctx.channelId }, 'event not delivered; dropped');
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 500 * 4 ** (attempt - 1)));
            }
        }
    }
}

export function buildEvent<T extends Event['type']>(ctx: EventContext, type: T, providerEventId: string, payload: EventPayload<T>): EventOf<T> {
    return {
        version: 1,
        eventId: randomUUID(),
        correlationId: ctx.correlationId,
        tenantId: ctx.tenantId,
        channelId: ctx.channelId,
        channelType: 'WHATSAPP_LIB',
        type,
        providerEventId,
        payload,
        occurredAt: new Date().toISOString()
    } as EventOf<T>;
}
