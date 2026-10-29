import * as cron from 'node-cron';

import db from '@nangohq/database';
import { records } from '@nangohq/records';
import { recordSnapshots, utcDay } from '@nangohq/shared';
import { getLogger, report } from '@nangohq/utils';

import { envs } from '../env.js';
import { GATEWAY_OF_PROVIDER } from '../whatsapp/gateway.js';

import type { LedgerRow } from '@nangohq/shared';

const logger = getLogger('cron.usageSnapshots');

/**
 * Hourly reading of what each environment keeps: active connections (integrations and channels apart) and the size
 * of its records. The ledger keeps each day's highest reading, so running it again in the same day is harmless.
 */
export function usageSnapshotsCron(): void {
    if (envs.NANGO_PUBSUB_TRANSPORT !== 'ledger') {
        return;
    }

    const task = cron.schedule(
        '7 * * * *',
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async () => {
            try {
                await takeUsageSnapshots();
            } catch (err) {
                report(new Error('cron_failed_to_take_usage_snapshots', { cause: err }));
            }
        }
    );
    void task.execute();
}

export async function takeUsageSnapshots(now = new Date()): Promise<LedgerRow[]> {
    const day = utcDay(now);
    const channelProviders = Object.keys(GATEWAY_OF_PROVIDER);

    const connections = await db.knex
        .from('_nango_connections as c')
        .join('_nango_environments as e', 'e.id', 'c.environment_id')
        .join('_nango_configs as cfg', 'cfg.id', 'c.config_id')
        .where({ 'c.deleted': false, 'e.deleted': false, 'cfg.deleted': false })
        .groupBy('c.environment_id', 'e.account_id', 'is_channel')
        .select<{ environment_id: number; account_id: number; is_channel: boolean; count: string }[]>(
            'c.environment_id',
            'e.account_id',
            db.knex.raw('cfg.provider = ANY(?) as is_channel', [channelProviders]),
            db.knex.raw('count(*) as count')
        );

    const accountOf = new Map<number, number>(
        (await db.knex.from('_nango_environments').where({ deleted: false }).select<{ id: number; account_id: number }[]>('id', 'account_id')).map((e) => [
            e.id,
            e.account_id
        ])
    );

    const rows: LedgerRow[] = connections.map((c) => ({
        environmentId: c.environment_id,
        accountId: c.account_id,
        day,
        metric: c.is_channel ? 'connections.channels' : 'connections.integrations',
        value: Number(c.count)
    }));

    const recordsBytes = new Map<number, number>();
    for await (const page of records.paginateCounts()) {
        if (page.isErr()) {
            throw page.error;
        }
        for (const count of page.value) {
            recordsBytes.set(count.environment_id, (recordsBytes.get(count.environment_id) ?? 0) + Number(count.size_bytes));
        }
    }
    for (const [environmentId, bytes] of recordsBytes) {
        const accountId = accountOf.get(environmentId);
        if (accountId !== undefined) {
            rows.push({ environmentId, accountId, day, metric: 'storage.records_bytes', value: bytes });
        }
    }

    await recordSnapshots(rows);
    logger.info('Usage snapshot taken', { rows: rows.length });
    return rows;
}
