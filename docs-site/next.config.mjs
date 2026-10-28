import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMDX } from 'fumadocs-mdx/next';

const here = path.dirname(fileURLToPath(import.meta.url));
// `content/` is a copy of ../docs made by scripts/prepare-content.mjs (predev/prebuild).
const docsJson = JSON.parse(fs.readFileSync(path.join(here, 'content', 'docs.json'), 'utf8'));

/** First page of the first tab: the landing page of `/docs`. */
function firstPage(node) {
    if (typeof node === 'string') return node;
    for (const child of [...(node.tabs ?? []), ...(node.groups ?? []), ...(node.pages ?? [])]) {
        const found = firstPage(child);
        if (found) return found;
    }
    return undefined;
}

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
    reactStrictMode: true,
    basePath: '/docs',
    output: 'standalone',
    // This app is standalone (own lockfile), not part of the monorepo workspaces:
    // pin the roots so Next doesn't infer the repository root from its lockfile.
    turbopack: { root: here },
    outputFileTracingRoot: here,
    images: { unoptimized: true },
    async redirects() {
        const landing = firstPage(docsJson.navigation) ?? 'getting-started/intro-to-nango';
        return [
            { source: '/', destination: `/${landing}`, permanent: false },
            ...(docsJson.redirects ?? []).map((r) => ({
                source: r.source,
                destination: r.destination,
                permanent: r.permanent ?? true
            }))
        ];
    }
};

export default withMDX(config);
