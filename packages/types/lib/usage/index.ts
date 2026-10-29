export type UsageMetric =
    | 'proxy'
    | 'connections'
    | 'function_executions'
    | 'function_compute_gbms'
    | 'function_duration_seconds'
    | 'records'
    | 'webhook_forwards'
    | 'function_logs'
    | 'data_transfer';

export interface MetricUsageSummary {
    label: string;
    usage: number;
    limit: number | null;
}

export type LedgerMetricName =
    | 'requests.proxy'
    | 'requests.actions'
    | 'requests.webhook_forwards'
    | 'requests.channel_messages'
    | 'data_transfer_bytes'
    | 'connections.integrations'
    | 'connections.channels'
    | 'storage.records_bytes'
    | 'storage.media_bytes';

export interface ApiAccountUsage {
    /** `YYYY-MM`, UTC. */
    month: string;
    /** Never charged; the usage is measured all the same. */
    billingExempt: boolean;
    /** Requests and bytes transferred are the month's total; connections and storage the average of its days. */
    metrics: Record<LedgerMetricName, number>;
    environments: { name: string; metrics: Record<LedgerMetricName, number> }[];
}
