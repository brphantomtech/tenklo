import { Readable } from 'node:stream';

import { Api } from 'grammy';

import { assertValidEvent } from '../contracts/index.js';
import { buildEvent } from '../events/publisher.js';
import { createLogger } from '../logger.js';
import { ObjectNotFoundError } from '../storage/index.js';

import type { Event, EventPayload } from '../contracts/index.js';
import type { EventContext, EventSink } from '../events/publisher.js';
import type { MediaObject } from '../storage/index.js';
import type { Redis } from 'ioredis';

export const TENANT = '7d0c3a52-4f7e-4d55-9b6e-2f7f4c1a9e01';
export const CHANNEL = '2c8e1f55-1d2e-4c9b-9a4f-6b7c8d9e0f03';
export const CORRELATION = '3c2b1a00-9f8e-4d7c-8b6a-5f4e3d2c1b03';

export const silentLogger = createLogger('silent');

/** Só os comandos do Redis que o worker usa, com NX e EX. Expiração não é simulada. */
export class FakeRedis {
    readonly data = new Map<string, string>();
    readonly hashes = new Map<string, Map<string, string>>();

    get(key: string): Promise<string | null> {
        return Promise.resolve(this.data.get(key) ?? null);
    }

    set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null> {
        if (args.includes('NX') && this.data.has(key)) return Promise.resolve(null);
        this.data.set(key, value);
        return Promise.resolve('OK');
    }

    del(...keys: string[]): Promise<number> {
        let n = 0;
        for (const key of keys) if (this.data.delete(key) || this.hashes.delete(key)) n++;
        return Promise.resolve(n);
    }

    pexpire(): Promise<number> {
        return Promise.resolve(1);
    }

    /** Só os scripts do ChannelLock: renovar e liberar, se o dono confere. */
    eval(script: string, _numKeys: number, key: string, owner: string): Promise<number> {
        if (this.data.get(key) !== owner) return Promise.resolve(0);
        if (script.includes("'del'")) this.data.delete(key);
        return Promise.resolve(1);
    }

    hexists(key: string, field: string): Promise<number> {
        return Promise.resolve(this.hashes.get(key)?.has(field) ? 1 : 0);
    }

    hget(key: string, field: string): Promise<string | null> {
        return Promise.resolve(this.hashes.get(key)?.get(field) ?? null);
    }

    hgetall(key: string): Promise<Record<string, string>> {
        return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []));
    }

    hset(key: string, field: string, value: string): Promise<number> {
        const hash = this.hashes.get(key) ?? new Map<string, string>();
        hash.set(field, value);
        this.hashes.set(key, hash);
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

    publish<T extends Event['type']>(ctx: EventContext, type: T, providerEventId: string, payload: EventPayload<T>): Promise<void> {
        const event = buildEvent(ctx, type, providerEventId, payload);
        assertValidEvent(event);
        this.events.push(event);
        return Promise.resolve();
    }

    ofType<T extends Event['type']>(type: T): Extract<Event, { type: T }>[] {
        return this.events.filter((e): e is Extract<Event, { type: T }> => e.type === type);
    }
}

/** Armazenamento em memória (objetos do canal e mídia). */
export class MemoryStorage {
    readonly sessions = new Map<string, Buffer>();
    readonly media = new Map<string, { body: Buffer; contentType: string }>();

    getSessionObject(key: string): Promise<Buffer | undefined> {
        return Promise.resolve(this.sessions.get(key));
    }
    putSessionObject(key: string, body: Buffer): Promise<void> {
        this.sessions.set(key, body);
        return Promise.resolve();
    }
    deleteSessionPrefix(prefix: string): Promise<void> {
        for (const k of [...this.sessions.keys()]) if (k.startsWith(prefix)) this.sessions.delete(k);
        return Promise.resolve();
    }
    putMedia(key: string, body: Buffer, contentType: string): Promise<void> {
        this.media.set(key, { body, contentType });
        return Promise.resolve();
    }
    openMedia(key: string): Promise<MediaObject> {
        const item = this.media.get(key);
        if (!item) return Promise.reject(new ObjectNotFoundError(key));
        return Promise.resolve({ stream: Readable.from([item.body]), contentLength: item.body.length });
    }
}

export interface ApiCall {
    method: string;
    payload: Record<string, unknown>;
}

/** Resposta de um método da Bot API falsa: o result, ou um erro no formato da Bot API. */
export type FakeReply = { result: unknown } | { error_code: number; description: string; parameters?: Record<string, unknown> };
export type FakeHandler = (payload: Record<string, unknown>, signal?: AbortSignal) => Promise<FakeReply> | FakeReply;

/**
 * Bot API sem rede: um transformer do grammY responde no lugar do Telegram. Chamadas sem handler devolvem
 * `{ ok: true, result: true }`. Um handler que lança simula falha de rede (o grammY embrulha em HttpError).
 */
export class FakeTelegram {
    readonly calls: ApiCall[] = [];
    readonly handlers = new Map<string, FakeHandler>();

    on(method: string, handler: FakeHandler): this {
        this.handlers.set(method, handler);
        return this;
    }

    callsOf(method: string): ApiCall[] {
        return this.calls.filter((c) => c.method === method);
    }

    createApi = (token: string): Api => {
        const api = new Api(token);
        api.config.use(async (_prev, method, payload, signal) => {
            this.calls.push({ method, payload: payload as Record<string, unknown> });
            const handler = this.handlers.get(method);
            const reply = handler ? await handler(payload as Record<string, unknown>, signal as AbortSignal | undefined) : { result: true };
            return ('result' in reply ? { ok: true, result: reply.result } : { ok: false, ...reply }) as never;
        });
        return api;
    };
}

/** getUpdates que entrega os lotes enfileirados e, sem nada, espera um pouco (ou até o abort), como o long polling. */
export function updatesQueue(batches: unknown[][]): FakeHandler {
    return async (_payload, signal) => {
        const next = batches.shift();
        if (next) return { result: next };
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 20);
            signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
            });
        });
        return { result: [] };
    };
}

/** Espera uma condição assíncrona (o long polling roda em segundo plano). */
export async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('condição não atingida a tempo');
        await new Promise((r) => setTimeout(r, 5));
    }
}
