'use client';

import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import { preload } from 'react-dom';

const documentUrl = (id: string) => `/docs/api/openapi/${encodeURIComponent(id)}`;

export const OpenAPIPage = createOpenAPIPage({
    async loadDocument(id) {
        if (typeof window === 'undefined') {
            // server render: read the spec directly, and let the browser start fetching it
            preload(documentUrl(id), { as: 'fetch', crossOrigin: 'anonymous' });
            const { openapi } = await import('@/lib/openapi');
            return (await openapi.getSchema(id)).bundled;
        }
        return (await fetch(documentUrl(id))).json();
    }
});
