import { beforeAll, describe, expect, it } from 'vitest';

import { multipleMigrations } from '@nangohq/database';
import { records } from '@nangohq/records';
import { seeders } from '@nangohq/shared';

import { takeUsageSnapshots } from './usageSnapshots.js';

describe('takeUsageSnapshots', () => {
    beforeAll(async () => {
        await multipleMigrations();
        await records.migrate();
    });

    it('counts integrations and channels apart, per environment', async () => {
        const { account, env } = await seeders.seedAccountEnvAndUser();
        await seeders.createConfigSeed(env, 'github', 'github');
        await seeders.createConfigSeed(env, 'whatsapp', 'whatsapp-web');
        await seeders.createConnectionSeed({ env, provider: 'github' });
        await seeders.createConnectionSeed({ env, provider: 'github' });
        await seeders.createConnectionSeed({ env, provider: 'whatsapp' });

        const rows = await takeUsageSnapshots(new Date('2026-10-29T10:00:00Z'));

        const mine = rows.filter((r) => r.environmentId === env.id);
        expect(mine).toEqual(
            expect.arrayContaining([
                { environmentId: env.id, accountId: account.id, day: '2026-10-29', metric: 'connections.integrations', value: 2 },
                { environmentId: env.id, accountId: account.id, day: '2026-10-29', metric: 'connections.channels', value: 1 }
            ])
        );
    });
});
