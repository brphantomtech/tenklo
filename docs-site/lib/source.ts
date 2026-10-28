import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';

/**
 * Every page of the Mintlify site. URLs are relative to the Next base path
 * (`/docs`), which Next adds to links and router navigation itself.
 */
export const source = loader({
    baseUrl: '/',
    source: docs.toFumadocsSource()
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

/** Look up a page by its Mintlify path (`guides/auth/x`, or `foo/index`). */
export function getPageByPath(pagePath: string): DocsPage | undefined {
    const slugs = pagePath
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);
    return source.getPage(slugs) ?? (slugs.at(-1) === 'index' ? source.getPage(slugs.slice(0, -1)) : undefined);
}

/** Sidebar label of a page, as Mintlify shows it. */
export function pageLabel(page: DocsPage): string {
    return page.data.sidebarTitle ?? page.data.title ?? page.slugs.at(-1) ?? '';
}
