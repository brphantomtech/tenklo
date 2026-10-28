import { DocsLayout } from 'fumadocs-ui/layouts/notebook';

import { baseOptions } from '@/lib/layout.shared.tsx';
import { getNavigation } from '@/lib/navigation.tsx';

import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
    const { nav, ...base } = baseOptions();
    return (
        <DocsLayout {...base} nav={{ ...nav, mode: 'top' }} tabMode="navbar" tree={getNavigation().tree}>
            {children}
        </DocsLayout>
    );
}
