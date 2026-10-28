import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pageSchema } from 'fumadocs-core/source/schema';
import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { z } from 'zod';

import { BASE_PATH, CONTENT_DIR } from './lib/constants';
import { mintlifyRemarkPlugins } from './lib/mdx-plugins/mintlify';

/**
 * The content is the Mintlify site in `../docs`, used as is. Snippets
 * (`docs/snippets/**`) are not pages: they are imported by pages, and compiled
 * through the global MDX options below.
 */
export const docs = defineDocs({
    dir: CONTENT_DIR,
    docs: {
        files: [
            'getting-started/**/*.mdx',
            'guides/**/*.mdx',
            'reference/**/*.mdx',
            'integrations/**/*.mdx',
            'api-integrations/**/*.mdx',
            'updates/**/*.mdx',
            'contributing.mdx'
        ],
        // Only the frontmatter is bundled upfront; page bodies are loaded on demand.
        async: true,
        schema: pageSchema.extend({
            sidebarTitle: z.string().optional(),
            // Mintlify OpenAPI pages: `openapi: 'GET /connections/{connectionId}'`
            openapi: z.string().optional(),
            icon: z.string().optional(),
            provider: z.string().optional()
        })
    },
    meta: {
        // Navigation comes from docs/docs.json, not meta files.
        files: ['**/meta.json']
    }
});

/**
 * Absolute content dir. Bundler loader workers don't necessarily run with the
 * app as cwd, so find it from this module (compiled into `.source/`) instead.
 */
function findContentDir(): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
        const candidate = path.join(dir, CONTENT_DIR);
        if (fs.existsSync(path.join(candidate, 'docs.json'))) return candidate;
        dir = path.dirname(dir);
    }
    return path.resolve(CONTENT_DIR);
}

export default defineConfig({
    mdxOptions: {
        remarkPlugins: (defaults) => [...mintlifyRemarkPlugins({ contentDir: findContentDir(), basePath: BASE_PATH }), ...defaults],
        // Mintlify image paths are site-absolute (`/images/...`), served from `public/`.
        remarkImageOptions: false,
        rehypeCodeOptions: {
            themes: { light: 'github-light', dark: 'github-dark' },
            // Unknown languages in the content (e.g. `env`) fall back to plain text.
            fallbackLanguage: 'plaintext'
        }
    }
});
