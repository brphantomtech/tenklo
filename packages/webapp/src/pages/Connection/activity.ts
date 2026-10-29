import type { OperationRow } from '@nangohq/types';

export type ActivityTone = 'ok' | 'failed' | 'pending' | 'neutral';

export interface ActivityEntry {
    id: string;
    /** What happened, in words. */
    title: string;
    /** The error, or what was involved (a sync, an HTTP request). */
    detail: string | null;
    tone: ActivityTone;
    at: string;
}

const failedStates = new Set(['failed', 'timeout']);
const pendingStates = new Set(['waiting', 'running']);

function toneOf(operation: OperationRow): ActivityTone {
    if (failedStates.has(operation.state)) return 'failed';
    if (pendingStates.has(operation.state)) return 'pending';
    if (operation.state === 'cancelled') return 'neutral';
    return 'ok';
}

/** A title for an operation, worded by whether it succeeded, failed or is still going. */
function titleOf(operation: OperationRow, tone: ActivityTone): string {
    const { type, action } = operation.operation;
    const name = operation.syncConfigName;
    const failed = tone === 'failed';
    const pending = tone === 'pending';

    switch (`${type}:${action}`) {
        case 'auth:create_connection':
            return failed ? 'Connecting failed' : 'Connected';
        case 'auth:refresh_token':
            return failed ? 'Refreshing the credentials failed' : 'Credentials refreshed';
        case 'auth:connection_test':
            return failed ? 'The credentials were rejected' : 'Credentials checked';
        case 'auth:post_connection':
            return failed ? 'Post-connection setup failed' : 'Post-connection setup ran';
        case 'sync:run':
            return `${name ? `The “${name}” sync` : 'A sync'} ${failed ? 'failed' : pending ? 'is running' : 'ran'}`;
        case 'sync:request_run':
        case 'sync:request_run_full':
            return `${name ? `The “${name}” sync` : 'A sync'} was triggered`;
        case 'sync:pause':
            return `${name ? `The “${name}” sync` : 'A sync'} was paused`;
        case 'sync:unpause':
            return `${name ? `The “${name}” sync` : 'A sync'} was resumed`;
        case 'action:run':
            return `${name ? `The “${name}” action` : 'An action'} ${failed ? 'failed' : pending ? 'is running' : 'ran'}`;
        case 'proxy:call':
            return failed ? 'An API request failed' : 'API request';
        case 'webhook:incoming':
            return failed ? 'Handling a webhook failed' : 'Webhook received';
        case 'webhook:forward':
            return failed ? 'Forwarding a webhook failed' : 'Webhook forwarded';
        case 'events:post_connection_creation':
            return failed ? 'The post-connection script failed' : 'The post-connection script ran';
        case 'events:pre_connection_deletion':
            return failed ? 'The pre-deletion script failed' : 'The pre-deletion script ran';
        default:
            return operation.message;
    }
}

function detailOf(operation: OperationRow): string | null {
    if (operation.error?.message) return operation.error.message;
    if (operation.request) {
        const code = operation.response?.code;
        return `${operation.request.method} ${operation.request.url}${code ? ` · ${code}` : ''}`;
    }
    return null;
}

/** An operation from the logs as a timeline entry. */
export function toActivityEntry(operation: OperationRow): ActivityEntry {
    const tone = toneOf(operation);
    return {
        id: operation.id,
        title: titleOf(operation, tone),
        detail: detailOf(operation),
        tone,
        at: operation.startedAt ?? operation.createdAt
    };
}
