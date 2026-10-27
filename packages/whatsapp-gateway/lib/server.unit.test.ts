import { describe, expect, it, vi } from 'vitest';

import { createServer } from './server.js';
import { silentLogger } from './testing/fakes.js';

import type { SubmitResult } from './commands/dispatcher.js';
import type { AddressInfo } from 'node:net';

const SECRET = 'a-shared-secret-with-more-than-32-chars';

async function withServer(opts: { accepted?: boolean; ready?: boolean }, fn: (base: string, submit: ReturnType<typeof vi.fn>) => Promise<void>) {
    const submit = vi.fn(
        (_raw: unknown): Promise<SubmitResult> =>
            Promise.resolve(opts.accepted === false ? { accepted: false, error: 'bad' } : { accepted: true, commandId: 'c1' })
    );
    const app = createServer({ dispatcher: { submit }, secret: SECRET, isReady: () => Promise.resolve(opts.ready ?? true), logger: silentLogger });
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
});
