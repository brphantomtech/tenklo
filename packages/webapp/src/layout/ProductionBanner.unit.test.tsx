// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionBanner } from './ProductionBanner';

import type { Root } from 'react-dom/client';

const mocks = vi.hoisted(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    return { env: 'prod' };
});

vi.mock('@/store', () => ({ useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ env: mocks.env }) }));
vi.mock('@/hooks/useMeta', () => ({
    useMeta: () => ({
        data: {
            data: {
                environments: [
                    { id: 1, account_id: 0, name: 'prod', is_production: true },
                    { id: 2, account_id: 0, name: 'dev', is_production: false }
                ]
            }
        }
    })
}));

describe('ProductionBanner', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows on a production environment', () => {
        mocks.env = 'prod';
        act(() => root.render(<ProductionBanner />));

        expect(container.querySelector('[role="status"]')?.textContent).toContain('Changes here affect live customers.');
    });

    it('stays hidden elsewhere', () => {
        mocks.env = 'dev';
        act(() => root.render(<ProductionBanner />));

        expect(container.innerHTML).toBe('');
    });
});
