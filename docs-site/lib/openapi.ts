import path from 'node:path';

import { createOpenAPI } from 'fumadocs-openapi/server';

import { BASE_PATH, CONTENT_DIR } from './constants';

export const OPENAPI_DOCUMENT = 'tenklo';

export const openapi = createOpenAPI({
    // docs/spec.yaml, copied into content/ by scripts/prepare-content.mjs
    input: { [OPENAPI_DOCUMENT]: path.join(process.cwd(), CONTENT_DIR, 'spec.yaml') },
    // the spec is ~260KB: pages load it once per browser session from /docs/api/openapi/<id>
    includeDocument: false,
    proxyUrl: `${BASE_PATH}/api/proxy`
});

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;
export type HttpMethod = (typeof METHODS)[number];

/**
 * Mintlify `openapi:` frontmatter: `GET /connections/{id}`, optionally
 * prefixed by a spec file (`spec.yaml GET /x`).
 */
export function parseOpenAPIFrontmatter(value: string): { method: HttpMethod; path: string } | undefined {
    const parts = value.trim().split(/\s+/);
    const pathPart = parts.at(-1);
    const method = parts.at(-2)?.toLowerCase() as HttpMethod | undefined;
    if (!pathPart?.startsWith('/') || !method || !METHODS.includes(method)) return undefined;
    return { method, path: pathPart };
}
