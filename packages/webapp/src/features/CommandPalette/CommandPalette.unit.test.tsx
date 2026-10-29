// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette, useCommandPalette } from './CommandPalette';

import type { Root } from 'react-dom/client';

vi.hoisted(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('@/store', () => ({ useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ env: 'prod' }) }));
vi.mock('@/hooks/useIntegration', () => ({
    useListIntegrations: () => ({
        data: { data: [{ unique_key: 'slack', provider: 'slack', display_name: null, meta: { displayName: 'Slack' } }] }
    })
}));
vi.mock('@/hooks/useConnections', () => ({ useConnections: () => ({ data: undefined, isFetching: false }) }));
vi.mock('@/components/patterns/IntegrationLogo', () => ({ IntegrationLogo: () => null }));

describe('CommandPalette', () => {
    let container: HTMLDivElement;
    let root: Root;
    let router: ReturnType<typeof createMemoryRouter>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        router = createMemoryRouter([{ path: '*', element: <CommandPalette /> }], { initialEntries: ['/prod'] });
        act(() => root.render(<RouterProvider router={router} />));
    });

    afterEach(() => {
        act(() => useCommandPalette.getState().setOpen(false));
        act(() => root.unmount());
        container.remove();
    });

    const press = (target: EventTarget, init: KeyboardEventInit) =>
        act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })));
    const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"]');
    const field = () => {
        const el = input();
        if (!el) throw new Error('The palette is closed');
        return el;
    };
    const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    const type = (value: string) =>
        act(() => {
            const el = field();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });

    it('opens with ⌘K and Ctrl+K', () => {
        expect(input()).toBeNull();
        press(window, { key: 'k', metaKey: true });
        expect(input()).not.toBeNull();
        press(window, { key: 'k', ctrlKey: true });
        expect(input()).toBeNull();
    });

    it('finds pages and integrations by name, ignoring accents and case', () => {
        act(() => useCommandPalette.getState().setOpen(true));
        type('SLÁ');
        expect(options()).toEqual(['Slackslack']);
        type('webhooks');
        // Settings matches by its description too.
        expect(options()).toEqual(['SettingsEnvironment, keys, webhooks', 'Webhooks']);
    });

    it('opens the highlighted result with the keyboard', () => {
        act(() => useCommandPalette.getState().setOpen(true));
        type('integra');
        expect(options()[0]).toContain('Integrations');
        press(field(), { key: 'ArrowDown' });
        press(field(), { key: 'Enter' });

        expect(router.state.location.pathname).toBe('/prod/integrations/create');
        expect(useCommandPalette.getState().open).toBe(false);
    });
});
