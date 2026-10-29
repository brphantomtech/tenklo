import db from '@nangohq/database';
import { getLogger, report } from '@nangohq/utils';

import { isBillableDataTransfer } from '../proxy/data-transfer-event.js';

import type { UsageEvent } from '@nangohq/types';
import type { Knex } from 'knex';

const logger = getLogger('usage.ledger');

export const USAGE_DAILY_TABLE = 'usage_daily';

/**
 * What the ledger measures. Counters add up over the day; snapshots keep the day's highest reading, so a month
 * bills on the average of its days.
 */
export const LEDGER_COUNTERS = ['requests.proxy', 'requests.actions', 'requests.webhook_forwards', 'requests.channel_messages', 'data_transfer_bytes'] as const;
export const LEDGER_SNAPSHOTS = ['connections.integrations', 'connections.channels', 'storage.records_bytes', 'storage.media_bytes'] as const;

export type LedgerCounter = (typeof LEDGER_COUNTERS)[number];
export type LedgerSnapshot = (typeof LEDGER_SNAPSHOTS)[number];
export type LedgerMetric = LedgerCounter | LedgerSnapshot;

/** Usage events the ledger counts, by the counter they add to. The others are measured by snapshots. */
const COUNTER_BY_EVENT: Partial<Record<UsageEvent['type'], LedgerCounter>> = {
    'usage.proxy': 'requests.proxy',
    'usage.actions': 'requests.actions',
    'usage.webhook_forward': 'requests.webhook_forwards',
    'usage.channel_messages': 'requests.channel_messages',
    'usage.data_transfer': 'data_transfer_bytes'
};

/** Bytes sent out that the hosted plans bill too: the egress of billable call sites. */
function billableBytes(event: Extract<UsageEvent, { type: 'usage.data_transfer' }>): number {
    const { package: pkg, callsite, egressedBytes } = event.payload.properties;
    return isBillableDataTransfer(pkg, callsite) ? egressedBytes : 0;
}

export interface LedgerRow {
    environmentId: number;
    accountId: number;
    /** UTC day, `YYYY-MM-DD`. */
    day: string;
    metric: LedgerMetric;
    value: number;
}

export const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** Adds counters to the day's totals. */
export async function addCounters(rows: LedgerRow[], knex: Knex = db.knex): Promise<void> {
    if (rows.length === 0) {
        return;
    }
    await knex
        .table(USAGE_DAILY_TABLE)
        .insert(rows.map(toDb))
        .onConflict(['environment_id', 'day', 'metric'])
        .merge({ value: knex.raw(`"${USAGE_DAILY_TABLE}"."value" + excluded."value"`), updated_at: knex.fn.now() });
}

/** Records snapshots, keeping the day's highest reading. */
export async function recordSnapshots(rows: LedgerRow[], knex: Knex = db.knex): Promise<void> {
    if (rows.length === 0) {
        return;
    }
    await knex
        .table(USAGE_DAILY_TABLE)
        .insert(rows.map(toDb))
        .onConflict(['environment_id', 'day', 'metric'])
        .merge({ value: knex.raw(`GREATEST("${USAGE_DAILY_TABLE}"."value", excluded."value")`), updated_at: knex.fn.now() });
}

function toDb(row: LedgerRow) {
    return { environment_id: row.environmentId, account_id: row.accountId, day: row.day, metric: row.metric, value: Math.round(row.value) };
}

/**
 * Collects the counters from usage events in memory and writes them every few seconds, so a busy proxy doesn't
 * turn every call into a write. A crash loses at most one interval.
 */
export class UsageLedger {
    private pending = new Map<string, LedgerRow>();
    private timer: NodeJS.Timeout | null = null;
    private flushing: Promise<void> = Promise.resolve();

    constructor(
        private readonly intervalMs = 10_000,
        private readonly write: (rows: LedgerRow[]) => Promise<void> = addCounters
    ) {}

    record(event: UsageEvent): void {
        const metric = COUNTER_BY_EVENT[event.type];
        const { accountId, environmentId } = event.payload.properties;
        const value = event.type === 'usage.data_transfer' ? billableBytes(event) : event.payload.value;
        // Account 0 is a real account: the first one of a self-hosted instance.
        if (!metric || !Number.isFinite(value) || value <= 0 || typeof accountId !== 'number' || typeof environmentId !== 'number') {
            return;
        }

        const day = utcDay(event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt));
        const key = `${environmentId}|${day}|${metric}`;
        const row = this.pending.get(key);
        if (row) {
            row.value += value;
        } else {
            this.pending.set(key, { environmentId, accountId, day, metric, value });
        }
        this.timer ??= setTimeout(() => void this.flush(), this.intervalMs);
    }

    /** Writes what is pending. Rows that fail to write go back to be retried with the next ones. */
    async flush(): Promise<void> {
        this.flushing = this.flushing.then(async () => {
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }
            const rows = [...this.pending.values()];
            this.pending.clear();
            try {
                await this.write(rows);
            } catch (err) {
                logger.error('Failed to write usage, retrying with the next flush', { rows: rows.length });
                report(new Error('usage_ledger_flush_failed', { cause: err }));
                for (const row of rows) {
                    const key = `${row.environmentId}|${row.day}|${row.metric}`;
                    const current = this.pending.get(key);
                    if (current) {
                        current.value += row.value;
                    } else {
                        this.pending.set(key, row);
                    }
                }
                this.timer ??= setTimeout(() => void this.flush(), this.intervalMs);
            }
        });
        return this.flushing;
    }
}
