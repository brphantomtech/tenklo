import { describe, expect, it } from 'vitest';

import { envs } from '../env.js';
import { assertOAuthServerUsesDashboardApiOrigin, isOAuthServerEnabled } from './config.js';

describe('OAuth server origin configuration', () => {
    it('accepts the dashboard API origin', () => {
        expect(() => assertOAuthServerUsesDashboardApiOrigin('https://api.tenklo.dev', 'https://api.tenklo.dev')).not.toThrow();
        expect(() => assertOAuthServerUsesDashboardApiOrigin('https://api.tenklo.dev/', 'https://api.tenklo.dev')).not.toThrow();
    });

    it('allows the OAuth server to remain disabled', () => {
        expect(() => assertOAuthServerUsesDashboardApiOrigin(undefined, 'https://api.tenklo.dev')).not.toThrow();
    });

    it('rejects a different OAuth origin', () => {
        expect(() => assertOAuthServerUsesDashboardApiOrigin('https://id.tenklo.dev', 'https://api.tenklo.dev')).toThrow(
            'NANGO_OAUTH_SERVER_BASE_URL must use the same origin as the dashboard API'
        );
    });

    it('enables the OAuth server only when its base URL is configured', () => {
        const previousBaseUrl = envs.NANGO_OAUTH_SERVER_BASE_URL;
        try {
            envs.NANGO_OAUTH_SERVER_BASE_URL = undefined;
            expect(isOAuthServerEnabled()).toBe(false);

            envs.NANGO_OAUTH_SERVER_BASE_URL = 'https://api.tenklo.dev';
            expect(isOAuthServerEnabled()).toBe(true);
        } finally {
            envs.NANGO_OAUTH_SERVER_BASE_URL = previousBaseUrl;
        }
    });
});
