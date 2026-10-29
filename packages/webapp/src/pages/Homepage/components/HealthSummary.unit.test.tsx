// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeProblem, HealthSummary } from './HealthSummary';

import type { Root } from 'react-dom/client';

const mocks = vi.hoisted(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    return {
        count: { loading: false, error: undefined, data: undefined, refetch: vi.fn() } as Record<string, unknown>,
        failing: [] as unknown[]
    };
});

vi.mock('@/hooks/useConnections', () => ({
    useConnectionsCount: () => mocks.count,
    useConnections: () => ({ isLoading: false, data: { pages: [{ data: mocks.failing }] } })
}));

const connection = (id: number, errors: { type: string }[]) => ({
    id,
    connection_id: `conn-${id}`,
    provider_config_key: 'slack',
    provider: 'slack',
    errors: errors.map((error) => ({ ...error, log_id: 'log' })),
    endUser: null,
    tags: {},
    pausedSyncs: []
});

describe('HealthSummary', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        mocks.count = { loading: false, error: undefined, data: undefined, refetch: vi.fn() };
        mocks.failing = [];
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render() {
        act(() => {
            root.render(
                <MemoryRouter>
                    <HealthSummary env="prod" />
                </MemoryRouter>
            );
        });
    }

    const counts = (total: number, withError: number) => ({ data: { total, withError, withAuthError: 0, withSyncError: 0 } });

    it('says everything is running when no connection has an error', () => {
        mocks.count.data = counts(12, 0);
        render();

        expect(container.querySelector('h1')?.textContent).toBe('Everything is running');
        expect(container.textContent).toContain('12 connections, none need attention.');
        expect(container.querySelector('ul')).toBeNull();
    });

    it('lists the connections that need attention with a link to each', () => {
        mocks.count.data = counts(10, 2);
        mocks.failing = [connection(1, [{ type: 'auth' }]), connection(2, [{ type: 'sync' }])];
        render();

        expect(container.querySelector('h1')?.textContent).toBe('2 connections need your attention');
        expect(container.textContent).toContain('The other 8 connections are running.');
        const links = [...container.querySelectorAll('li a')].map((a) => a.getAttribute('href'));
        expect(links).toEqual(['/prod/connections/slack/conn-1', '/prod/connections/slack/conn-2']);
        expect(container.textContent).not.toContain('See all');
    });

    it('links to the full list when there are more than it shows', () => {
        mocks.count.data = counts(40, 9);
        mocks.failing = Array.from({ length: 9 }, (_, i) => connection(i + 1, [{ type: 'sync' }]));
        render();

        expect(container.querySelectorAll('li')).toHaveLength(5);
        const seeAll = [...container.querySelectorAll('a')].find((a) => a.textContent === 'See all 9');
        expect(seeAll?.getAttribute('href')).toBe('/prod/connections?status=error');
    });

    it('offers to create the first connection on an empty environment', () => {
        mocks.count.data = counts(0, 0);
        render();

        expect(container.querySelector('h1')?.textContent).toBe('No connections yet');
        expect(container.querySelector('a')?.getAttribute('href')).toBe('/prod/connections/create');
    });

    it('explains a failed check instead of showing nothing', () => {
        mocks.count.error = { error: { code: 'server_error' } };
        render();

        expect(container.querySelector('h1')?.textContent).toBe('We couldn’t check your connections');
        expect(container.querySelector('button')?.textContent).toBe('Try again');
    });
});

describe('describeProblem', () => {
    it('puts expired credentials ahead of failing syncs', () => {
        expect(
            describeProblem({
                errors: [
                    { type: 'sync', log_id: 'a' },
                    { type: 'auth', log_id: 'b' }
                ]
            }).label
        ).toBe('Credentials expired or were revoked');
        expect(describeProblem({ errors: [{ type: 'sync', log_id: 'a' }] }).label).toBe('A sync is failing');
    });
});
