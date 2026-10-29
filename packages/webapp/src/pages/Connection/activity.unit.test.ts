import { describe, expect, it } from 'vitest';

import { toActivityEntry } from './activity';

import type { OperationRow } from '@nangohq/types';

const operation = (over: Partial<OperationRow>): OperationRow =>
    ({
        id: 'op-1',
        message: 'raw message',
        state: 'success',
        operation: { type: 'auth', action: 'refresh_token' },
        createdAt: '2026-10-29T10:00:00.000Z',
        startedAt: '2026-10-29T10:00:01.000Z',
        ...over
    }) as OperationRow;

describe('toActivityEntry', () => {
    it('words an operation by how it went', () => {
        expect(toActivityEntry(operation({})).title).toBe('Credentials refreshed');
        expect(toActivityEntry(operation({ state: 'failed' })).title).toBe('Refreshing the credentials failed');
    });

    it('names the sync and says whether it is still running', () => {
        const sync = { operation: { type: 'sync', action: 'run' }, syncConfigName: 'contacts' } as Partial<OperationRow>;
        expect(toActivityEntry(operation({ ...sync })).title).toBe('The “contacts” sync ran');
        expect(toActivityEntry(operation({ ...sync, state: 'running' }))).toMatchObject({ title: 'The “contacts” sync is running', tone: 'pending' });
        expect(toActivityEntry(operation({ ...sync, state: 'timeout' })).tone).toBe('failed');
    });

    it('shows the error, or else the request', () => {
        expect(toActivityEntry(operation({ state: 'failed', error: { name: 'Error', message: '401 from provider' } })).detail).toBe('401 from provider');
        expect(
            toActivityEntry(
                operation({
                    operation: { type: 'proxy', action: 'call' },
                    request: { method: 'GET', url: '/v1/contacts', headers: {} },
                    response: { code: 200, headers: {} }
                })
            ).detail
        ).toBe('GET /v1/contacts · 200');
    });

    it('falls back to the log message for operations it has no words for', () => {
        expect(toActivityEntry(operation({ operation: { type: 'deploy', action: 'custom' } })).title).toBe('raw message');
    });

    it('dates an entry from when it started', () => {
        expect(toActivityEntry(operation({})).at).toBe('2026-10-29T10:00:01.000Z');
        expect(toActivityEntry(operation({ startedAt: null })).at).toBe('2026-10-29T10:00:00.000Z');
    });
});
