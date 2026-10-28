import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/notebook/page';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { notFound } from 'next/navigation';

import { OpenAPIPage } from '@/components/api-page.tsx';
import { getMDXComponents } from '@/components/mdx.tsx';
import { OPENAPI_DOCUMENT, parseOpenAPIFrontmatter } from '@/lib/openapi';
import { source } from '@/lib/source';

import type { Metadata } from 'next';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
    const params = await props.params;
    const page = source.getPage(params.slug);
    if (!page) notFound();

    const { body: MDX, toc } = await page.data.load();
    // Mintlify `openapi: 'GET /path'` pages: the page's own MDX, then the operation from docs/spec.yaml
    const operation = page.data.openapi ? parseOpenAPIFrontmatter(page.data.openapi) : undefined;
    const isChangelog = page.path.startsWith('updates/');

    return (
        <DocsPage toc={toc} full={isChangelog || undefined} tableOfContent={{ style: 'clerk' }}>
            <DocsTitle>{page.data.title}</DocsTitle>
            {page.data.description ? <DocsDescription>{page.data.description}</DocsDescription> : null}
            <DocsBody>
                <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
                {operation ? (
                    <div className="not-prose mt-8">
                        <OpenAPIPage document={OPENAPI_DOCUMENT} payload={{}} operations={[operation]} showTitle={false} showDescription />
                    </div>
                ) : null}
            </DocsBody>
        </DocsPage>
    );
}

/**
 * Core docs (~130 pages) are prerendered at build time. The ~2k provider pages
 * (`integrations/`, `api-integrations/`) are rendered on their first request and
 * then cached like static pages: each page embeds the whole sidebar (1,000+
 * integrations), so prerendering all of them takes ~3GB and doubles the build.
 * `DOCS_PRERENDER=all` prerenders every page.
 */
export function generateStaticParams() {
    const params = source.generateParams();
    if (process.env.DOCS_PRERENDER === 'all') return params;
    return params.filter(({ slug }) => !['integrations', 'api-integrations'].includes(slug[0] ?? ''));
}

export const dynamicParams = true;

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
    const params = await props.params;
    const page = source.getPage(params.slug);
    if (!page) notFound();
    return {
        title: page.data.title,
        description: page.data.description
    };
}
