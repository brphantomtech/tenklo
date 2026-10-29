import { describe, expect, it } from 'vitest';

import { describeConnectionProblem, problemLogUrl } from './connectionProblems';

import type { ApiConnectionError } from '@nangohq/types';

const auth = (action: string): ApiConnectionError => ({ type: 'auth', action, log_id: `auth-${action}`, sync_name: null });
const sync = (name: string | null, logId = 'sync-log'): ApiConnectionError => ({ type: 'sync', action: 'run', log_id: logId, sync_name: name });

describe('describeConnectionProblem', () => {
    it('has nothing to say about a healthy connection', () => {
        expect(describeConnectionProblem([])).toBeNull();
    });

    it('leaves expired credentials to the customer', () => {
        expect(describeConnectionProblem([auth('token_refresh')])).toMatchObject({
            label: 'Credentials expired',
            owner: 'customer',
            fix: 'The customer reconnects',
            logId: 'auth-token_refresh'
        });
    });

    it('leaves a failed credentials override to you', () => {
        expect(describeConnectionProblem([auth('override')])).toMatchObject({ label: 'Credentials override failed', owner: 'you' });
    });

    it('still explains an auth action it does not know', () => {
        expect(describeConnectionProblem([auth('something_new')])?.label).toBe('Credentials problem');
    });

    it('puts credentials ahead of failing syncs', () => {
        expect(describeConnectionProblem([sync('contacts'), auth('connection_test')])?.label).toBe('Credentials stopped working');
    });

    it('names the failing syncs', () => {
        expect(describeConnectionProblem([sync('contacts')])).toMatchObject({
            label: 'Sync failing',
            cause: 'The “contacts” sync failed on its last run.',
            owner: 'you'
        });
        expect(describeConnectionProblem([sync('contacts', 'a'), sync('deals', 'b')])).toMatchObject({
            label: '2 syncs failing',
            cause: 'These syncs failed on their last run: contacts, deals.',
            logId: 'a'
        });
        expect(describeConnectionProblem([sync(null)])?.cause).toBe('A sync failed on its last run.');
    });
});

describe('problemLogUrl', () => {
    it('opens the log operation of the problem', () => {
        const problem = describeConnectionProblem([sync('contacts', 'op/1')]);
        expect(problem).not.toBeNull();
        expect(problem && problemLogUrl('prod', problem)).toBe('/prod/logs?operationId=op%2F1');
    });
});
