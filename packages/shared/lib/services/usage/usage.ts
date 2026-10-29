import db from '@nangohq/database';

import { LEDGER_COUNTERS, LEDGER_SNAPSHOTS, USAGE_DAILY_TABLE } from './ledger.js';

import type { LedgerMetric } from './ledger.js';
import type { Knex } from 'knex';

export interface AccountUsage {
    accountId: number;
    /** UTC days, inclusive start and exclusive end (`YYYY-MM-DD`). */
    from: string;
    to: string;
    /** Never charged; the usage is measured all the same. */
    billingExempt: boolean;
    /**
     * Counters are the period's total. Snapshots are the average of the daily readings over the days of the period
     * that have passed, so a connection kept for half a month counts as half.
     */
    metrics: Record<LedgerMetric, number>;
    /** The same, per environment. */
    environments: { environmentId: number; metrics: Record<LedgerMetric, number> }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyMetrics(): Record<LedgerMetric, number> {
    return Object.fromEntries([...LEDGER_COUNTERS, ...LEDGER_SNAPSHOTS].map((m) => [m, 0])) as Record<LedgerMetric, number>;
}

/** The UTC calendar month containing `date`. */
export function monthOf(date: Date): { from: string; to: string } {
    const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export async function getAccountUsage(
    { accountId, from, to, now = new Date() }: { accountId: number; from: string; to: string; now?: Date },
    knex: Knex = db.knex
): Promise<AccountUsage | null> {
    const account = await knex.from('_nango_accounts').where({ id: accountId }).first<{ billing_exempt: boolean } | undefined>('billing_exempt');
    if (!account) {
        return null;
    }

    const rows = await knex
        .from(USAGE_DAILY_TABLE)
        .where({ account_id: accountId })
        .andWhere('day', '>=', from)
        .andWhere('day', '<', to)
        .groupBy('environment_id', 'metric')
        .select<{ environment_id: number; metric: LedgerMetric; total: string }[]>('environment_id', 'metric', knex.raw('sum(value) as total'));

    // Days of the period that have started, to average the snapshots over.
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Math.min(Date.parse(`${to}T00:00:00Z`), Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const days = Math.max(1, Math.round((end - start) / DAY_MS));
    const snapshots = new Set<string>(LEDGER_SNAPSHOTS);

    const metrics = emptyMetrics();
    const byEnvironment = new Map<number, Record<LedgerMetric, number>>();
    for (const row of rows) {
        if (!(row.metric in metrics)) {
            continue;
        }
        const value = snapshots.has(row.metric) ? Number(row.total) / days : Number(row.total);
        metrics[row.metric] += value;
        const env = byEnvironment.get(row.environment_id) ?? emptyMetrics();
        env[row.metric] += value;
        byEnvironment.set(row.environment_id, env);
    }

    return {
        accountId,
        from,
        to,
        billingExempt: account.billing_exempt,
        metrics,
        environments: [...byEnvironment.entries()].map(([environmentId, m]) => ({ environmentId, metrics: m }))
    };
}

/** Marks an account as never charged, or charged again. Its usage keeps being measured either way. */
export async function setBillingExempt({ accountId, exempt }: { accountId: number; exempt: boolean }, knex: Knex = db.knex): Promise<boolean> {
    const updated = await knex.from('_nango_accounts').where({ id: accountId }).update({ billing_exempt: exempt, updated_at: knex.fn.now() });
    return updated > 0;
}
