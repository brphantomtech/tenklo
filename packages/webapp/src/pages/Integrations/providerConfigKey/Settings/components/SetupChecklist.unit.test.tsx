// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupChecklist, setupSteps } from './SetupChecklist';

import type { ApiEnvironment, GetIntegration } from '@nangohq/types';
import type { Root } from 'react-dom/client';

vi.hoisted(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('@/utils/cloud', () => ({ defaultCallback: () => 'https://api.tenklo.dev/oauth/callback' }));
vi.mock('@/components/ui/CopyButton', () => ({ CopyButton: () => null }));

const environment = { name: 'prod', callback_url: '' } as unknown as ApiEnvironment;
const dataWith = (missing: string[], extra: Record<string, unknown> = {}) =>
    ({
        integration: { unique_key: 'linkedin', display_name: null, missing_fields: missing, shared_credentials_id: null, ...extra },
        template: { display_name: 'LinkedIn', auth_mode: 'OAUTH2', docs: 'https://docs.tenklo.dev/integrations/linkedin' }
    }) as unknown as GetIntegration['Success']['data'];

describe('setupSteps', () => {
    it('lists what the auth mode needs, done or not', () => {
        expect(setupSteps('OAUTH2', ['oauth_client_secret'])).toEqual([
            { field: 'oauth_client_id', label: 'Client ID', anchor: 'client_id', done: true },
            { field: 'oauth_client_secret', label: 'Client secret', anchor: 'client_secret', done: false }
        ]);
    });

    it('keeps a missing field it has no step for', () => {
        expect(setupSteps('API_KEY', ['something_new'])).toEqual([{ field: 'something_new', label: 'something_new', anchor: null, done: false }]);
    });
});

describe('SetupChecklist', () => {
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

    const render = (data: GetIntegration['Success']['data']) =>
        act(() =>
            root.render(
                <MemoryRouter>
                    <SetupChecklist data={data} environment={environment} />
                </MemoryRouter>
            )
        );

    it('shows what is left, the callback URL and a way to each field', () => {
        render(dataWith(['oauth_client_id', 'oauth_client_secret']));

        expect(container.querySelector('h2')?.textContent).toBe('Finish setting up LinkedIn');
        expect(container.textContent).toContain('0 of 2 done.');
        expect(container.textContent).toContain('https://api.tenklo.dev/oauth/callback');
        expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Fill in', 'Fill in']);
    });

    it('stays out of the way of a ready integration', () => {
        render(dataWith([]));
        expect(container.innerHTML).toBe('');
    });

    it('says so when the last step gets done', () => {
        render(dataWith(['oauth_client_secret']));
        render(dataWith([]));

        expect(container.querySelector('h2')?.textContent).toBe('LinkedIn is ready');
        expect(container.querySelector('a')?.getAttribute('href')).toBe('/prod/connections/create?integration_id=linkedin');
    });

    it('has nothing to ask of shared credentials', () => {
        render(dataWith(['oauth_client_id'], { shared_credentials_id: 1 }));
        expect(container.innerHTML).toBe('');
    });
});
