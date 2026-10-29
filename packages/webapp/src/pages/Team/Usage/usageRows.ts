import type { LedgerMetricName } from '@nangohq/types';

export interface UsageRow {
    metric: LedgerMetricName;
    label: string;
    description: string;
    unit: 'count' | 'bytes';
    /** Totals over the month, or the average of its days. */
    kind: 'total' | 'average';
}

export const USAGE_ROWS: UsageRow[] = [
    { metric: 'connections.integrations', label: 'Integration connections', description: 'Connections to APIs', unit: 'count', kind: 'average' },
    { metric: 'connections.channels', label: 'Channels', description: 'WhatsApp numbers and Telegram bots', unit: 'count', kind: 'average' },
    { metric: 'requests.proxy', label: 'Proxy requests', description: 'Calls through the proxy', unit: 'count', kind: 'total' },
    { metric: 'requests.actions', label: 'Actions', description: 'Action runs', unit: 'count', kind: 'total' },
    { metric: 'requests.channel_messages', label: 'Channel messages', description: 'Messages sent through channels', unit: 'count', kind: 'total' },
    { metric: 'requests.webhook_forwards', label: 'Webhooks forwarded', description: 'Provider webhooks sent to you', unit: 'count', kind: 'total' },
    { metric: 'data_transfer_bytes', label: 'Data transfer', description: 'Data sent to you', unit: 'bytes', kind: 'total' },
    { metric: 'storage.records_bytes', label: 'Records storage', description: 'Synced records kept', unit: 'bytes', kind: 'average' }
];

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatUsage(value: number, unit: UsageRow['unit']): string {
    if (unit === 'bytes') {
        let size = value;
        let i = 0;
        while (size >= 1000 && i < BYTE_UNITS.length - 1) {
            size /= 1000;
            i++;
        }
        return `${size.toLocaleString('en-US', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${BYTE_UNITS[i]}`;
    }
    return value.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 });
}

/** The last `count` months, newest first, as `YYYY-MM` (UTC). */
export function lastMonths(now: Date, count: number): string[] {
    return Array.from({ length: count }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}
