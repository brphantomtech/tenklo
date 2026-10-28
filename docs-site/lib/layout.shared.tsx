import { BASE_PATH, DASHBOARD_URL, SITE_NAME, SITE_URL } from './constants';
import { renderIcon } from './icons.tsx';
import { getNavigation, readDocsJson } from './navigation.tsx';

import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
    const docsJson = readDocsJson();
    const navbar = docsJson.navbar;
    const tabLinks = getNavigation().links;

    return {
        nav: {
            title: (
                <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${BASE_PATH}/images/Tenklo-Light-Mode.svg`} alt={SITE_NAME} className="tenklo-logo tenklo-logo-light" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${BASE_PATH}/images/Tenklo-Dark-Mode.svg`} alt={SITE_NAME} className="tenklo-logo tenklo-logo-dark" />
                </>
            ),
            url: '/'
        },
        links: [
            ...tabLinks.map((link) => ({ text: link.text, url: link.url, icon: renderIcon(link.icon), external: true })),
            ...(navbar?.links ?? [])
                .filter((link) => link.type !== 'github')
                .map((link) => ({ text: link.label, url: link.href, external: true, secondary: false })),
            ...(navbar?.primary
                ? [{ text: navbar.primary.label, url: navbar.primary.href, external: true }]
                : [{ text: 'Dashboard', url: DASHBOARD_URL, external: true }]),
            { text: SITE_NAME, url: SITE_URL, external: true, on: 'menu' as const }
        ]
    };
}
