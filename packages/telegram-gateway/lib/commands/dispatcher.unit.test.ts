import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHANNEL, CORRELATION, silentLogger, TENANT } from '../testing/fakes.js';
import { CommandDispatcher, RETRY_DELAYS_MS } from './dispatcher.js';

import type { CommandHandler } from './dispatcher.js';

const validCommand = {
    version: 1,
    commandId: 'c0000000-0000-4000-8000-000000000005',
    correlationId: CORRELATION,
    tenantId: TENANT,
    channelId: CHANNEL,
    type: 'groups.sync',
    payload: {},
    createdAt: '2026-10-01T12:00:00Z'
};

function setup(handle: CommandHandler) {
    const onInvalid = vi.fn(() => Promise.resolve());
    const dispatcher = new CommandDispatcher(handle, onInvalid, silentLogger);
    return { dispatcher, onInvalid };
}

describe('CommandDispatcher', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects a command outside the contract and reports it', async () => {
        const handle = vi.fn<CommandHandler>(() => Promise.resolve('done'));
        const { dispatcher, onInvalid } = setup(handle);
        const result = await dispatcher.submit({ ...validCommand, version: 2 });
        expect(result.accepted).toBe(false);
        expect(onInvalid).toHaveBeenCalledOnce();
        expect(handle).not.toHaveBeenCalled();
    });

    it('accepts a valid command and runs it on the first attempt', async () => {
        const handle = vi.fn<CommandHandler>(() => Promise.resolve('done'));
        const { dispatcher } = setup(handle);
        expect(await dispatcher.submit(validCommand)).toEqual({ accepted: true, commandId: validCommand.commandId });
        await dispatcher.stop();
        expect(handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'groups.sync' }), { attempt: 0, canRetry: true });
    });

    it('retries with the queue delays and tells the handler on the last attempt', async () => {
        vi.useFakeTimers();
        const handle = vi.fn<CommandHandler>(() => Promise.resolve('retry'));
        const { dispatcher } = setup(handle);
        await dispatcher.submit(validCommand);
        for (const delay of RETRY_DELAYS_MS) {
            await vi.advanceTimersByTimeAsync(delay);
        }
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(handle.mock.calls.map(([, info]) => info)).toEqual([
            { attempt: 0, canRetry: true },
            { attempt: 1, canRetry: true },
            { attempt: 2, canRetry: true },
            { attempt: 3, canRetry: false }
        ]);
    });

    it('drops pending retries and refuses new commands once stopped', async () => {
        vi.useFakeTimers();
        const handle = vi.fn<CommandHandler>(() => Promise.resolve('retry'));
        const { dispatcher } = setup(handle);
        await dispatcher.submit(validCommand);
        await vi.advanceTimersByTimeAsync(0);
        await dispatcher.stop();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(handle).toHaveBeenCalledOnce();
        expect((await dispatcher.submit(validCommand)).accepted).toBe(false);
    });

    it('keeps running after the handler throws', async () => {
        const handle = vi.fn<CommandHandler>(() => {
            return Promise.reject(new Error('boom'));
        });
        const { dispatcher } = setup(handle);
        await dispatcher.submit(validCommand);
        await dispatcher.stop();
        expect(handle).toHaveBeenCalledOnce();
    });
});
