import { createSearchAPI } from 'fumadocs-core/search/server';

import { source } from '@/lib/source';

import type { AdvancedIndex } from 'fumadocs-core/search/server';

/**
 * Orama, built on the server on the first query (instrumentation.ts warms it at
 * startup), so the index of ~2.1k pages never ships to the browser.
 *
 * Core docs are indexed in full. The ~2k provider pages (`integrations/`,
 * `api-integrations/`) are mostly the same generated snippets, so they are
 * indexed by title, description and headings: indexing their paragraphs makes
 * the index several times larger and slower to build for little search value.
 */
const PROVIDER_PAGES = /^(integrations|api-integrations)\//;

async function buildIndexes(): Promise<AdvancedIndex[]> {
    const started = Date.now();
    const pages = source.getPages();
    const indexes: AdvancedIndex[] = [];
    // Loading a page module is synchronous work: go in small batches and yield
    // in between, so the server keeps answering requests while the index builds.
    for (let i = 0; i < pages.length; i += 16) {
        const batch = await Promise.all(
            pages.slice(i, i + 16).map(async (page): Promise<AdvancedIndex> => {
                const { structuredData } = await page.data.load();
                const provider = PROVIDER_PAGES.test(page.path);
                return {
                    id: page.url,
                    url: page.url,
                    title: page.data.title ?? page.slugs.join('/'),
                    description: page.data.description,
                    tag: provider ? 'integrations' : 'docs',
                    structuredData: provider ? { headings: structuredData.headings, contents: [] } : structuredData
                };
            })
        );
        indexes.push(...batch);
        await new Promise((resolve) => setImmediate(resolve));
    }
    console.log(`[search] indexed ${indexes.length} pages in ${Date.now() - started}ms`);
    return indexes;
}

export const { GET } = createSearchAPI('advanced', {
    language: 'english',
    indexes: buildIndexes
});
