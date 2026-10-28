import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acquisitionFromInitialInfo, readSignupAcquisition } from './signupAcquisition';

const sdk = vi.hoisted(() => ({ has_opted_out_capturing: vi.fn(), get_property: vi.fn() }));
vi.mock('posthog-js', () => ({ default: sdk }));

describe('signup acquisition', () => {
    beforeEach(() => vi.resetAllMocks());

    it('keeps campaign fields and strips unrelated URL data', () => {
        expect(
            acquisitionFromInitialInfo({
                u: 'https://tenklo.dev/integrations?utm_source=facebook&utm_medium=paid_social&utm_campaign=launch&token=secret#fragment',
                r: 'https://www.facebook.com/feed?private=value'
            })
        ).toEqual({
            acquisition_utm_source: 'facebook',
            acquisition_utm_medium: 'paid_social',
            acquisition_utm_campaign: 'launch',
            acquisition_landing_path: '/integrations',
            acquisition_referring_domain: 'www.facebook.com'
        });
    });

    it.each(['https://next.tenklo.dev/pricing', 'https://pr-161.next.tenklo.dev/pricing'])('accepts preview website hosts: %s', (u) => {
        expect(acquisitionFromInitialInfo({ u: `${u}?utm_source=t1` })).toEqual({ acquisition_utm_source: 't1', acquisition_landing_path: '/pricing' });
    });

    it.each([
        undefined,
        {},
        { u: 'invalid' },
        { u: 'https://app.tenklo.dev/signup/invite-token' },
        { u: 'https://app.tenklo.dev/account/private-id' },
        { u: 'https://app.tenklo.dev.evil.example/signup' },
        { u: 'https://pr-7872.app-development.tenklo.dev/signup/invite-token' },
        { u: 'https://pr-7872.app-development.tenklo.dev/account/private-id' },
        { u: 'https://pr-7872.app-development.tenklo.dev.evil.example/signup' },
        { u: 'https://pr-other.app-development.tenklo.dev/signup' },
        { u: 'https://pr-7872-storybook.app-development.tenklo.dev/signup' },
        { u: 'http://pr-7872.app-development.tenklo.dev/signup' },
        { u: 'https://other.example/' },
        { u: 'https://a.b.next.tenklo.dev/' },
        { u: 'https://next.tenklo.dev.evil.example/' }
    ])('ignores unavailable website history: %j', (info) => {
        expect(acquisitionFromInitialInfo(info)).toBeUndefined();
    });

    it.each(['app.tenklo.dev', 'app-development.tenklo.dev', 'pr-7872.app-development.tenklo.dev'])('keeps direct-to-app signup attribution on %s', (host) => {
        expect(
            acquisitionFromInitialInfo({
                u: `https://${host}/signup?utm_source=github&utm_medium=referral&token=secret`,
                r: 'https://github.com/NangoHQ/nango'
            })
        ).toEqual({
            acquisition_utm_source: 'github',
            acquisition_utm_medium: 'referral',
            acquisition_landing_path: '/signup',
            acquisition_referring_domain: 'github.com'
        });
    });

    it('keeps direct signup UTMs without treating Tenklo docs as an external referrer', () => {
        expect(acquisitionFromInitialInfo({ u: 'https://app.tenklo.dev/signup/?utm_source=docs', r: 'https://docs.tenklo.dev' })).toEqual({
            acquisition_utm_source: 'docs',
            acquisition_landing_path: '/signup/'
        });
    });

    it('does not invent a referrer for direct visits or use unsafe campaign values', () => {
        expect(acquisitionFromInitialInfo({ u: 'https://tenklo.dev/?utm_source=person@example.com&utm_term=' + 'x'.repeat(257), r: '$direct' })).toEqual({
            acquisition_landing_path: '/'
        });
    });

    it.each(['\u0080', '\u0085', '\u009f'])('drops campaign controls while keeping valid source fields: %j', (control) => {
        expect(
            acquisitionFromInitialInfo({
                u: `https://pr-7872.app-development.tenklo.dev/signup/?utm_source=face${encodeURIComponent(control)}book&utm_campaign=caf%C3%A9`
            })
        ).toEqual({ acquisition_utm_campaign: 'café', acquisition_landing_path: '/signup/' });
    });

    it('honors opt-out and tolerates an unavailable SDK', () => {
        sdk.has_opted_out_capturing.mockReturnValue(true);
        expect(readSignupAcquisition()).toBeUndefined();
        expect(sdk.get_property).not.toHaveBeenCalled();
        sdk.has_opted_out_capturing.mockReturnValue(false);
        sdk.get_property.mockImplementation(() => {
            throw new Error('unavailable');
        });
        expect(readSignupAcquisition()).toBeUndefined();
    });
});
