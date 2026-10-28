import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createServer } from './server.js';
import { ObjectNotFoundError } from './storage/index.js';
import { silentLogger } from './testing/fakes.js';
import { SessionImportError } from './whatsapp/session-import.js';

import type { SubmitResult } from './commands/dispatcher.js';
import type { AddressInfo } from 'node:net';

const SECRET = 'a-shared-secret-with-more-than-32-chars';
const KEY = 'tenants/11111111-1111-1111-1111-111111111111/media/22222222-2222-2222-2222-222222222222/photo.jpg';

const bucket = new Map<string, { body: Buffer; contentType: string }>();
const media = {
    putMedia: (key: string, body: Buffer, contentType: string) => {
        bucket.set(key, { body, contentType });
        return Promise.resolve();
    },
    openMedia: (key: string) => {
        const object = bucket.get(key);
        if (!object) {
            return Promise.reject(new ObjectNotFoundError(key));
        }
        return Promise.resolve({ stream: Readable.from([object.body]), contentLength: object.body.length, contentType: object.contentType });
    }
};

const importSessionMock = vi.fn(({ channelId }: { channelId: string }) => {
    if (channelId === EXISTING) {
        return Promise.reject(new SessionImportError('session_exists', 'this channel already has a session'));
    }
    return Promise.resolve({ account: { jid: '5511988880000:1@s.whatsapp.net', name: null }, objects: 1 });
});
const EXISTING = '33333333-3333-3333-3333-333333333333';

async function withServer(opts: { accepted?: boolean; ready?: boolean }, fn: (base: string, submit: ReturnType<typeof vi.fn>) => Promise<void>) {
    const submit = vi.fn(
        (_raw: unknown): Promise<SubmitResult> =>
            Promise.resolve(opts.accepted === false ? { accepted: false, error: 'bad' } : { accepted: true, commandId: 'c1' })
    );
    const app = createServer({
        dispatcher: { submit },
        media,
        mediaMaxBytes: 10,
        sessions: { import: importSessionMock },
        secret: SECRET,
        isReady: () => Promise.resolve(opts.ready ?? true),
        logger: silentLogger
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, submit);
    } finally {
        server.close();
    }
}

const post = (base: string, body: unknown, auth?: string) =>
    fetch(`${base}/v1/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: JSON.stringify(body)
    });

describe('gateway API', () => {
    it('requires the shared secret', async () => {
        await withServer({}, async (base, submit) => {
            expect((await post(base, {})).status).toBe(401);
            expect((await post(base, {}, 'Bearer wrong')).status).toBe(401);
            expect(submit).not.toHaveBeenCalled();
        });
    });

    it('accepts a command with 202', async () => {
        await withServer({}, async (base, submit) => {
            const res = await post(base, { type: 'groups.sync' }, `Bearer ${SECRET}`);
            expect(res.status).toBe(202);
            expect(await res.json()).toEqual({ commandId: 'c1' });
            expect(submit).toHaveBeenCalledWith({ type: 'groups.sync' });
        });
    });

    it('answers 400 for a command outside the contract', async () => {
        await withServer({ accepted: false }, async (base) => {
            const res = await post(base, {}, `Bearer ${SECRET}`);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: { code: 'invalid_command', message: 'bad' } });
        });
    });

    it('reports readiness without auth', async () => {
        await withServer({ ready: false }, async (base) => {
            expect((await fetch(`${base}/health/live`)).status).toBe(200);
            expect((await fetch(`${base}/health/ready`)).status).toBe(503);
        });
    });

    describe('media', () => {
        const auth = { authorization: `Bearer ${SECRET}` };
        const put = (base: string, key: string, body: string, headers: Record<string, string> = auth) =>
            fetch(`${base}/v1/media?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', ...headers }, body });

        it('stores and streams a file back', async () => {
            await withServer({}, async (base) => {
                const stored = await put(base, KEY, 'jpeg');
                expect(stored.status).toBe(201);
                expect(await stored.json()).toEqual({ objectKey: KEY, sizeBytes: 4 });

                const res = await fetch(`${base}/v1/media?key=${encodeURIComponent(KEY)}`, { headers: auth });
                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toBe('image/jpeg');
                expect(await res.text()).toBe('jpeg');
            });
        });

        it('requires the shared secret', async () => {
            await withServer({}, async (base) => {
                expect((await put(base, KEY, 'jpeg', {})).status).toBe(401);
                expect((await fetch(`${base}/v1/media?key=${encodeURIComponent(KEY)}`)).status).toBe(401);
            });
        });

        it('refuses a key outside the media layout', async () => {
            await withServer({}, async (base) => {
                expect((await put(base, '../sessions/x', 'jpeg')).status).toBe(400);
                expect((await put(base, 'tenants/a/media/b/c', 'jpeg')).status).toBe(400);
            });
        });

        it('answers 413 above the size limit and 404 for a missing file', async () => {
            await withServer({}, async (base) => {
                expect((await put(base, KEY, 'more than ten bytes')).status).toBe(413);
                const missing = KEY.replace('photo.jpg', 'missing.jpg');
                expect((await fetch(`${base}/v1/media?key=${encodeURIComponent(missing)}`, { headers: auth })).status).toBe(404);
            });
        });
    });

    describe('session import', () => {
        const TENANT = '11111111-1111-1111-1111-111111111111';
        const CHANNEL = '22222222-2222-2222-2222-222222222222';
        const put = (base: string, path: string, body: unknown, auth = `Bearer ${SECRET}`) =>
            fetch(`${base}/v1/sessions/${path}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json', authorization: auth },
                body: JSON.stringify(body)
            });
        const objects = [{ path: 'creds', json: '{}' }];

        it('imports a session and answers the paired account', async () => {
            await withServer({}, async (base) => {
                const res = await put(base, `${TENANT}/${CHANNEL}`, { objects });
                expect(res.status).toBe(201);
                expect(await res.json()).toEqual({ account: { jid: '5511988880000:1@s.whatsapp.net', name: null }, objects: 1 });
                expect(importSessionMock).toHaveBeenLastCalledWith({ tenantId: TENANT, channelId: CHANNEL, objects });
            });
        });

        it('requires the secret, valid ids and objects', async () => {
            await withServer({}, async (base) => {
                expect((await put(base, `${TENANT}/${CHANNEL}`, { objects }, 'Bearer wrong')).status).toBe(401);
                expect((await put(base, `${TENANT}/not-a-uuid`, { objects })).status).toBe(400);
                expect((await put(base, `${TENANT}/${CHANNEL}`, { objects: [] })).status).toBe(400);
                expect((await put(base, `${TENANT}/${CHANNEL}`, { objects: [{ path: 'creds', json: {} }] })).status).toBe(400);
            });
        });

        it('answers 409 when the channel already has a session', async () => {
            await withServer({}, async (base) => {
                const res = await put(base, `${TENANT}/${EXISTING}`, { objects });
                expect(res.status).toBe(409);
                expect(await res.json()).toMatchObject({ error: { code: 'session_exists' } });
            });
        });
    });
});
