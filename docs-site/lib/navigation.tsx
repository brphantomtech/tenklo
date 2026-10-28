import fs from 'node:fs';
import path from 'node:path';

import { CONTENT_DIR } from './constants';
import { renderIcon } from './icons.tsx';
import { getPageByPath, pageLabel } from './source';

import type * as PageTree from 'fumadocs-core/page-tree';

/**
 * The Fumadocs page tree, built from Mintlify's `docs.json` navigation:
 * - each tab with pages is a root folder (a navbar tab of the notebook layout);
 * - top-level groups of a tab are sidebar section headers (separators);
 * - nested groups are collapsible folders;
 * - tabs that are only a link (`href`) become navbar links.
 */

interface MintlifyGroup {
    group: string;
    icon?: string;
    expanded?: boolean;
    root?: string;
    pages: MintlifyEntry[];
}
type MintlifyEntry = string | MintlifyGroup;
interface MintlifyTab {
    tab: string;
    icon?: string;
    href?: string;
    groups?: MintlifyGroup[];
    pages?: MintlifyEntry[];
}
interface DocsJson {
    navigation: { tabs: MintlifyTab[] };
    navbar?: { links?: { label: string; href: string; type?: string }[]; primary?: { label: string; href: string } };
}

export function readDocsJson(): DocsJson {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), CONTENT_DIR, 'docs.json'), 'utf8')) as DocsJson;
}

const missing = new Set<string>();

function pageNode(pagePath: string): PageTree.Item | undefined {
    const page = getPageByPath(pagePath);
    if (!page) {
        if (!missing.has(pagePath)) {
            missing.add(pagePath);
            console.warn(`[navigation] docs.json lists a page that doesn't exist: ${pagePath}`);
        }
        return undefined;
    }
    return { type: 'page', name: pageLabel(page), url: page.url, $id: page.path };
}

function entryNodes(entry: MintlifyEntry, depth: number): PageTree.Node[] {
    if (typeof entry === 'string') {
        const node = pageNode(entry);
        return node ? [node] : [];
    }
    const children = entry.pages.flatMap((child) => entryNodes(child, depth + 1));
    if (depth === 0) {
        // top-level group of a tab: a section header followed by its pages
        return [{ type: 'separator', name: entry.group, icon: renderIcon(entry.icon) }, ...children];
    }
    const index = entry.root ? pageNode(entry.root) : undefined;
    return [
        {
            type: 'folder',
            name: entry.group,
            icon: renderIcon(entry.icon),
            // Mintlify keeps nested groups closed unless `expanded: true`;
            // Fumadocs opens the folder of the active page anyway.
            defaultOpen: entry.expanded === true,
            index,
            children
        }
    ];
}

let cached: { tree: PageTree.Root; links: { text: string; url: string; icon?: string }[] } | undefined;

export function getNavigation() {
    if (cached && process.env.NODE_ENV === 'production') return cached;
    const docsJson = readDocsJson();
    const children: PageTree.Node[] = [];
    const links: { text: string; url: string; icon?: string }[] = [];

    for (const tab of docsJson.navigation.tabs) {
        const entries: MintlifyEntry[] = [...(tab.groups ?? []), ...(tab.pages ?? [])];
        if (entries.length === 0) {
            if (tab.href) links.push({ text: tab.tab, url: tab.href, icon: tab.icon });
            continue;
        }
        children.push({
            type: 'folder',
            name: tab.tab,
            icon: renderIcon(tab.icon),
            // root folders are the layout tabs; each tab links to its first page
            root: true,
            defaultOpen: true,
            children: entries.flatMap((entry) => entryNodes(entry, 0)),
            $id: `tab:${tab.tab}`
        });
    }

    cached = { tree: { name: 'Tenklo', children }, links };
    return cached;
}
