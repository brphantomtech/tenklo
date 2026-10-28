import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHANNEL, CORRELATION, silentLogger, TENANT } from '../testing/fakes.js';
import { HttpEventPublisher } from './publisher.js';

const ctx = { tenantId: TENANT, channelId: CHANNEL, correlationId: CORRELATION };
const SECRET = 'a-shared-secret-with-more-than-32-chars';

function publisherWith(responses: (number | Error)[]) {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => {
        const next = responses.shift() ?? 200;
        if (next instanceof Error) throw next;
        return Promise.resolve(new Response(null, { status: next }));
    });
    const publisher = new HttpEventPublisher('http://server/internal/telegram/events', SECRET, silentLogger, fetchImpl as unknown as typeof fetch);
    return { publisher, fetchImpl };
}

describe('HttpEventPublisher', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('posts the contract envelope with the shared secret', async () => {
        const { publisher, fetchImpl } = publisherWith([200]);
        await publisher.publish(ctx, 'channel.status', 'status:1', { status: 'CONNECTING' });
        expect(fetchImpl).toHaveBeenCalledOnce();
        const [url, init] = fetchImpl.mock.calls[0]!;
        expect(url).toBe('http://server/internal/telegram/events');
        expect(init.headers).toMatchObject({ authorization: `Bearer ${SECRET}` });
        expect(JSON.parse(init.body as string)).toMatchObject({
            version: 1,
            tenantId: TENANT,
            channelId: CHANNEL,
            channelType: 'TELEGRAM',
            type: 'channel.status',
            providerEventId: 'status:1',
            payload: { status: 'CONNECTING' }
        });
    });

    it('retries server errors and network failures', async () => {
        vi.useFakeTimers();
        const { publisher, fetchImpl } = publisherWith([503, new Error('ECONNREFUSED'), 200]);
        const done = publisher.publish(ctx, 'channel.status', 'status:2', { status: 'CONNECTING' });
        await vi.runAllTimersAsync();
        await done;
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('does not retry a rejected event', async () => {
        const { publisher, fetchImpl } = publisherWith([400]);
        await publisher.publish(ctx, 'channel.status', 'status:3', { status: 'CONNECTING' });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('gives up after the last attempt without throwing', async () => {
        vi.useFakeTimers();
        const { publisher, fetchImpl } = publisherWith([500, 500, 500, 500, 500]);
        const done = publisher.publish(ctx, 'channel.status', 'status:4', { status: 'CONNECTING' });
        await vi.runAllTimersAsync();
        await expect(done).resolves.toBeUndefined();
        expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it('refuses an event outside the contract', async () => {
        const { publisher, fetchImpl } = publisherWith([200]);
        // @ts-expect-error -- not a valid status
        await expect(publisher.publish(ctx, 'channel.status', 'status:5', { status: 'NOPE' })).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
