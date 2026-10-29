import { describe, expect, it, vi } from 'vitest';

import { UsageLedger } from './ledger.js';

import type { LedgerRow } from './ledger.js';
import type { UsageEvent } from '@nangohq/types';

const base = { accountId: 1, environmentId: 10, environmentName: 'dev', integrationId: 'github', connectionId: 'c1' };
const at = new Date('2026-10-29T12:00:00Z');

function proxy(value = 1, createdAt = at): UsageEvent {
    return { subject: 'usage', type: 'usage.proxy', idempotencyKey: 'k', createdAt, payload: { value, properties: { ...base, success: true } } };
}

describe('UsageLedger', () => {
    it('adds up the requests of an environment and day into one row', async () => {
        const write = vi.fn<(rows: LedgerRow[]) => Promise<void>>().mockResolvedValue();
        const ledger = new UsageLedger(60_000, write);

        ledger.record(proxy());
        ledger.record(proxy(2));
        ledger.record(proxy(1, new Date('2026-10-30T00:00:01Z')));
        await ledger.flush();

        expect(write).toHaveBeenCalledOnce();
        expect(write.mock.calls[0]![0]).toEqual([
            { environmentId: 10, accountId: 1, day: '2026-10-29', metric: 'requests.proxy', value: 3 },
            { environmentId: 10, accountId: 1, day: '2026-10-30', metric: 'requests.proxy', value: 1 }
        ]);
    });

    it('counts channel messages and only billable egress', async () => {
        const write = vi.fn<(rows: LedgerRow[]) => Promise<void>>().mockResolvedValue();
        const ledger = new UsageLedger(60_000, write);

        ledger.record({
            subject: 'usage',
            type: 'usage.channel_messages',
            idempotencyKey: 'k',
            createdAt: at,
            payload: { value: 1, properties: { ...base, provider: 'whatsapp-web' } }
        });
        ledger.record({
            subject: 'usage',
            type: 'usage.data_transfer',
            idempotencyKey: 'k',
            createdAt: at,
            payload: { value: 1, properties: { ...base, package: 'server', callsite: 'persist_system_logs', ingressedBytes: 0, egressedBytes: 500 } }
        } as UsageEvent);
        await ledger.flush();

        expect(write.mock.calls[0]![0]).toEqual([{ environmentId: 10, accountId: 1, day: '2026-10-29', metric: 'requests.channel_messages', value: 1 }]);
    });

    it('counts account 0, the first account of a self-hosted instance', async () => {
        const write = vi.fn<(rows: LedgerRow[]) => Promise<void>>().mockResolvedValue();
        const ledger = new UsageLedger(60_000, write);

        ledger.record({ ...proxy(), payload: { value: 1, properties: { ...base, accountId: 0, success: true } } } as UsageEvent);
        await ledger.flush();

        expect(write.mock.calls[0]![0]).toEqual([{ environmentId: 10, accountId: 0, day: '2026-10-29', metric: 'requests.proxy', value: 1 }]);
    });

    it('ignores what it does not count', async () => {
        const write = vi.fn<(rows: LedgerRow[]) => Promise<void>>().mockResolvedValue();
        const ledger = new UsageLedger(60_000, write);

        ledger.record({ subject: 'usage', type: 'usage.connections', idempotencyKey: 'k', createdAt: at, payload: { value: 1, properties: base } });
        ledger.record(proxy(0));
        await ledger.flush();

        expect(write).toHaveBeenCalledWith([]);
    });

    it('keeps the rows that failed to write for the next flush', async () => {
        const write = vi.fn<(rows: LedgerRow[]) => Promise<void>>().mockRejectedValueOnce(new Error('db down')).mockResolvedValue();
        const ledger = new UsageLedger(60_000, write);

        ledger.record(proxy());
        await ledger.flush();
        ledger.record(proxy());
        await ledger.flush();

        expect(write).toHaveBeenCalledTimes(2);
        expect(write.mock.calls[1]![0]).toEqual([{ environmentId: 10, accountId: 1, day: '2026-10-29', metric: 'requests.proxy', value: 2 }]);
    });
});
