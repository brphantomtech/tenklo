import * as cron from 'node-cron';

import db from '@nangohq/database';
import { records } from '@nangohq/records';
import { recordSnapshots, utcDay } from '@nangohq/shared';
import { getLogger, report } from '@nangohq/utils';

import { envs } from '../env.js';
import { GATEWAY_OF_PROVIDER, getGatewayMediaUsage } from '../whatsapp/gateway.js';

import type { GatewayKind } from '../whatsapp/gateway.js';
import type { LedgerRow } from '@nangohq/shared';

const logger = getLogger('cron.usageSnapshots');

/**
 * Hourly reading of what each environment keeps: active connections (integrations and channels apart), the size of
 * its records and the media its channels keep in the gateways' bucket. The ledger keeps each day's highest reading, so running it again in the same day is harmless.
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

    rows.push(...(await mediaRows(day)));

    await recordSnapshots(rows);
    logger.info('Usage snapshot taken', { rows: rows.length });
    return rows;
}

/** The gateways' bucket is not ours to read: each gateway sums the media of the channels it runs. */
const MEDIA_USAGE_BATCH = 500;

async function mediaRows(day: string): Promise<LedgerRow[]> {
    const channels = await db.knex
        .from('_nango_connections as c')
        .join('_nango_environments as e', 'e.id', 'c.environment_id')
        .join('_nango_configs as cfg', 'cfg.id', 'c.config_id')
        .where({ 'c.deleted': false, 'e.deleted': false, 'cfg.deleted': false })
        .whereIn('cfg.provider', Object.keys(GATEWAY_OF_PROVIDER))
        .whereRaw(`c.connection_config->>'session_id' IS NOT NULL`)
        .select<
            { environment_id: number; account_id: number; uuid: string; provider: string; session_id: string }[]
        >('c.environment_id', 'e.account_id', 'e.uuid', 'cfg.provider', db.knex.raw(`c.connection_config->>'session_id' as session_id`));

    const environmentOf = new Map(channels.map((c) => [c.uuid, { environmentId: c.environment_id, accountId: c.account_id }]));
    const bytesOf = new Map<string, number>();
    const byGateway = new Map<GatewayKind, { tenantId: string; channelId: string }[]>();
    for (const c of channels) {
        const kind = GATEWAY_OF_PROVIDER[c.provider];
        if (kind) {
            byGateway.set(kind, [...(byGateway.get(kind) ?? []), { tenantId: c.uuid, channelId: c.session_id }]);
        }
        bytesOf.set(c.uuid, 0);
    }

    for (const [kind, list] of byGateway) {
        for (let i = 0; i < list.length; i += MEDIA_USAGE_BATCH) {
            const usage = await getGatewayMediaUsage(kind, list.slice(i, i + MEDIA_USAGE_BATCH));
            if (usage.isErr()) {
                // Without every gateway's answer the total would read low, and the day keeps its highest reading anyway.
                report(new Error('usage_snapshot_media_failed', { cause: usage.error }));
                return [];
            }
            for (const channel of usage.value) {
                bytesOf.set(channel.tenantId, (bytesOf.get(channel.tenantId) ?? 0) + channel.bytes);
            }
        }
    }

    return [...bytesOf].flatMap(([uuid, bytes]) => {
        const env = environmentOf.get(uuid);
        return env ? [{ ...env, day, metric: 'storage.media_bytes' as const, value: bytes }] : [];
    });
}
