import { assertValidEvent } from '../contracts/index.js';
import { buildEvent } from '../events/publisher.js';
import { createLogger } from '../logger.js';

import type { Event, EventPayload } from '../contracts/index.js';
import type { EventContext, EventSink } from '../events/publisher.js';
import type { Redis } from 'ioredis';

export const TENANT = '7d0c3a52-4f7e-4d55-9b6e-2f7f4c1a9e01';
export const CHANNEL = '1b9f0e44-0c1d-4b8a-8f3e-5a6b7c8d9e02';
export const CORRELATION = '3c2b1a00-9f8e-4d7c-8b6a-5f4e3d2c1b03';

export const silentLogger = createLogger('silent');

/** Só os comandos do Redis que o worker usa, com NX e EX. Expiração não é simulada. */
export class FakeRedis {
    readonly data = new Map<string, string>();
    readonly hashes = new Map<string, Map<string, string>>();

    get(key: string): Promise<string | null> {
        return Promise.resolve(this.data.get(key) ?? null);
    }

    set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
        if (args.includes('NX') && this.data.has(key)) return Promise.resolve(null);
        this.data.set(key, value);
        return Promise.resolve('OK');
    }

    del(key: string): Promise<number> {
        return Promise.resolve(this.data.delete(key) ? 1 : 0);
    }

    hexists(key: string, field: string): Promise<number> {
        return Promise.resolve(this.hashes.get(key)?.has(field) ? 1 : 0);
    }

    hset(key: string, field: string, value: string): Promise<number> {
        if (!this.hashes.has(key)) this.hashes.set(key, new Map());
        this.hashes.get(key)!.set(field, value);
        return Promise.resolve(1);
    }

    hdel(key: string, field: string): Promise<number> {
        return Promise.resolve(this.hashes.get(key)?.delete(field) ? 1 : 0);
    }

    asRedis(): Redis {
        return this as unknown as Redis;
    }
}

/** Guarda os eventos publicados, já validados contra o contrato. */
export class RecordingEvents implements EventSink {
    readonly events: Event[] = [];

    publish<T extends Event['type']>(ctx: EventContext, type: T, providerEventId: string, payload: EventPayload<T>) {
        const event = buildEvent(ctx, type, providerEventId, payload);
        assertValidEvent(event);
        this.events.push(event);
        return Promise.resolve();
    }

    ofType<T extends Event['type']>(type: T): Array<Extract<Event, { type: T }>> {
        return this.events.filter((e): e is Extract<Event, { type: T }> => e.type === type);
    }
}
