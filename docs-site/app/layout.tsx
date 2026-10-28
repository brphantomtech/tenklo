import { RootProvider } from 'fumadocs-ui/provider/next';

import { BASE_PATH, SITE_NAME, SITE_URL } from '@/lib/constants';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './global.css';

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: { default: `${SITE_NAME} Docs`, template: `%s | ${SITE_NAME} Docs` },
    description: 'Tenklo documentation: auth, functions, and 1,000+ API integrations.',
    icons: {
        icon: [
            { url: `${BASE_PATH}/favicon-black.svg`, media: '(prefers-color-scheme: light)', type: 'image/svg+xml' },
            { url: `${BASE_PATH}/favicon-white.svg`, media: '(prefers-color-scheme: dark)', type: 'image/svg+xml' }
        ]
    }
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className="flex min-h-screen flex-col">
                <RootProvider search={{ options: { api: `${BASE_PATH}/api/search` } }}>{children}</RootProvider>
            </body>
        </html>
    );
}
