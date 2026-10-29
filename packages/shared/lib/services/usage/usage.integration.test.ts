import { beforeAll, describe, expect, it } from 'vitest';

import { multipleMigrations } from '@nangohq/database';

import { seedAccountEnvAndUser } from '../../seeders/global.seeder.js';
import { addCounters, recordSnapshots } from './ledger.js';
import { getAccountUsage, monthOf, setBillingExempt } from './usage.js';

describe('account usage', () => {
    beforeAll(async () => {
        await multipleMigrations();
    });

    it('totals the requests and averages the snapshots over the days passed', async () => {
        const { account, env } = await seedAccountEnvAndUser();
        const row = { environmentId: env.id, accountId: account.id };

        await addCounters([{ ...row, day: '2026-10-01', metric: 'requests.proxy', value: 5 }]);
        await addCounters([{ ...row, day: '2026-10-01', metric: 'requests.proxy', value: 3 }]);
        await addCounters([{ ...row, day: '2026-09-30', metric: 'requests.proxy', value: 100 }]);
        // Two connections on the 1st (the highest reading wins), none afterwards.
        await recordSnapshots([{ ...row, day: '2026-10-01', metric: 'connections.integrations', value: 2 }]);
        await recordSnapshots([{ ...row, day: '2026-10-01', metric: 'connections.integrations', value: 1 }]);

        const usage = await getAccountUsage({ accountId: account.id, ...monthOf(new Date('2026-10-15T00:00:00Z')), now: new Date('2026-10-02T10:00:00Z') });

        expect(usage).toMatchObject({ from: '2026-10-01', to: '2026-11-01', billingExempt: false });
        expect(usage?.metrics['requests.proxy']).toBe(8);
        expect(usage?.metrics['connections.integrations']).toBe(1); // 2 connections on 1 of 2 days
        expect(usage?.environments).toEqual([{ environmentId: env.id, metrics: usage?.metrics }]);
    });

    it('keeps measuring the accounts that are never charged', async () => {
        const { account, env } = await seedAccountEnvAndUser();

        expect(await setBillingExempt({ accountId: account.id, exempt: true })).toBe(true);
        await addCounters([{ environmentId: env.id, accountId: account.id, day: '2026-10-05', metric: 'requests.channel_messages', value: 4 }]);

        const usage = await getAccountUsage({ accountId: account.id, from: '2026-10-01', to: '2026-11-01' });
        expect(usage?.billingExempt).toBe(true);
        expect(usage?.metrics['requests.channel_messages']).toBe(4);
    });

    it('does not know an account that does not exist', async () => {
        expect(await setBillingExempt({ accountId: 987654, exempt: true })).toBe(false);
        expect(await getAccountUsage({ accountId: 987654, from: '2026-10-01', to: '2026-11-01' })).toBeNull();
    });
});
