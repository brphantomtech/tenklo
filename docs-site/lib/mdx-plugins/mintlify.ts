/**
 * Remark plugins that make Mintlify-flavoured MDX (docs/) compile and render
 * with Fumadocs, without editing the content:
 *
 * - absolute snippet imports (`import X from "/snippets/a.mdx"`) are rewritten
 *   to paths relative to the importing file;
 * - code fence meta (`json Example Response`) becomes `title="Example Response"`;
 * - `<Tabs>`/`<Tab title>` get the `items`/`value` props Fumadocs tabs need;
 * - `<CodeGroup>`, `<RequestExample>`, `<ResponseExample>` become tabs of code blocks;
 * - site-absolute asset URLs (`/images/x.png`) get the base path.
 */
import fs from 'node:fs';
import path from 'node:path';

import { visit } from 'unist-util-visit';

import type { Code, Root, RootContent } from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import type { Pluggable } from 'unified';
import type { VFile } from 'vfile';

type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;

interface Options {
    /** Mintlify content dir, relative to the cwd or absolute. */
    contentDir: string;
    /** Base path the site is served under, e.g. `/docs`. */
    basePath: string;
}

export function mintlifyRemarkPlugins(options: Options): Pluggable[] {
    const contentDir = path.resolve(options.contentDir);
    return [
        [remarkMintlifyImports, { contentDir }],
        remarkMintlifyCodeGroups,
        remarkMintlifyCodeMeta,
        remarkMintlifyTabs,
        [remarkMintlifyAssetUrls, { basePath: options.basePath }]
    ];
}

const toPosix = (p: string) => p.split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Imports

function remarkMintlifyImports({ contentDir }: { contentDir: string }) {
    return (tree: Root, file: VFile) => {
        // a relative vfile path is relative to the app dir (the parent of the content dir)
        const filePath = file.path ? (path.isAbsolute(file.path) ? file.path : path.resolve(path.dirname(contentDir), file.path)) : undefined;
        const from = filePath ? path.dirname(filePath) : contentDir;
        const rewrite = (source: string): string => {
            if (!source.startsWith('/') || source.startsWith('//')) return source;
            const target = path.join(contentDir, source);
            let rel = toPosix(path.relative(from, target));
            if (!rel.startsWith('.')) rel = `./${rel}`;
            return rel;
        };

        // local names bound to imported MDX files (snippets)
        const mdxComponents = new Set<string>();
        // local names of snippet imports whose file doesn't exist (Mintlify renders nothing for them)
        const missing = new Set<string>();

        visit(tree, 'mdxjsEsm', (node: any) => {
            const program = node.data?.estree;
            if (!program) return;
            program.body = program.body.filter((stmt: any) => {
                if (!((stmt.type === 'ImportDeclaration' || stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') && stmt.source))
                    return true;
                const original = String(stmt.source.value);
                const next = rewrite(original);
                if (next !== original) {
                    if (stmt.type === 'ImportDeclaration' && !fs.existsSync(path.join(contentDir, original))) {
                        console.warn(`[mintlify] ${toPosix(path.relative(contentDir, filePath ?? ''))}: missing snippet ${original}, usages removed`);
                        for (const spec of stmt.specifiers ?? []) missing.add(spec.local.name);
                        return false;
                    }
                    stmt.source.value = next;
                    stmt.source.raw = JSON.stringify(next);
                }
                if (stmt.type === 'ImportDeclaration' && /\.mdx?$/.test(next)) {
                    for (const spec of stmt.specifiers ?? []) mdxComponents.add(spec.local.name);
                }
                return true;
            });
            // the compiler reads the estree; keep `value` in sync for anything printing it
            node.value = program.body.length ? node.value : '';
        });

        if (missing.size > 0) {
            visit(tree, (node, index, parent: any) => {
                if (isJsx(node) && node.name && missing.has(node.name) && parent && typeof index === 'number') {
                    parent.children.splice(index, 1);
                    return index;
                }
            });
            // drop esm nodes left empty
            tree.children = tree.children.filter((n: any) => !(n.type === 'mdxjsEsm' && n.data?.estree?.body.length === 0));
        }

        if (mdxComponents.size === 0) return;
        // Mintlify snippets use the site components without importing them. MDX
        // doesn't pass `components` down to imported MDX files, so forward them:
        // <Snippet /> -> <Snippet components={props.components} />
        visit(tree, (node) => {
            if (!isJsx(node) || !node.name || !mdxComponents.has(node.name) || hasAttr(node, 'components')) return;
            node.attributes.push(expressionAttr('components', 'props.components', memberExpression('props', 'components')));
        });
    };
}

function memberExpression(object: string, property: string) {
    return {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: object },
        property: { type: 'Identifier', name: property },
        computed: false,
        optional: false
    };
}

function expressionAttr(name: string, source: string, expression: unknown): MdxJsxAttribute {
    return {
        type: 'mdxJsxAttribute',
        name,
        value: {
            type: 'mdxJsxAttributeValueExpression',
            value: source,
            data: {
                estree: { type: 'Program', sourceType: 'module', body: [{ type: 'ExpressionStatement', expression }] } as any
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Code fence meta

const MINTLIFY_FLAGS = new Set(['lines', 'wrap', 'expandable', 'twoslash', 'theme={null}']);

interface ParsedMeta {
    title?: string;
    attrs: string[];
}

/**
 * Mintlify: ```lang [title words] [{1,3-5}] [key="value"] [flags]
 * Fumadocs: ```lang title="..."
 */
export function parseMintlifyMeta(meta: string | null | undefined): ParsedMeta {
    const attrs: string[] = [];
    if (!meta) return { attrs };
    let rest = meta;
    let title: string | undefined;

    rest = rest.replace(/([A-Za-z_][\w-]*)=("([^"]*)"|'([^']*)'|\{[^}]*\}|\S+)/g, (_m, key: string, raw: string, dq?: string, sq?: string) => {
        const value = dq ?? sq ?? raw;
        if (key === 'title' || key === 'filename') title = value;
        else if (key === 'tab') attrs.push(`tab=${JSON.stringify(value)}`);
        // Mintlify-only keys (icon, highlight, focus, lines, theme...) are dropped.
        return ' ';
    });
    // highlight ranges like {1,3-5}
    rest = rest.replace(/\{[^}]*\}/g, ' ');
    const words = rest
        .split(/\s+/)
        .filter(Boolean)
        .filter((w) => !MINTLIFY_FLAGS.has(w));
    if (!title && words.length > 0) title = words.join(' ');
    return { title, attrs };
}

function formatMeta(parsed: ParsedMeta): string | null {
    const parts = [...parsed.attrs];
    if (parsed.title) parts.unshift(`title=${JSON.stringify(parsed.title)}`);
    return parts.length ? parts.join(' ') : null;
}

function remarkMintlifyCodeMeta() {
    return (tree: Root) => {
        visit(tree, 'code', (node: Code) => {
            if ((node.data as any)?.mintlifyMetaDone) return;
            node.meta = formatMeta(parseMintlifyMeta(node.meta));
        });
    };
}

// ---------------------------------------------------------------------------
// JSX helpers

function getAttr(node: JsxElement, name: string): string | undefined {
    for (const attr of node.attributes) {
        if (attr.type === 'mdxJsxAttribute' && attr.name === name && typeof attr.value === 'string') return attr.value;
    }
    return undefined;
}

function hasAttr(node: JsxElement, name: string): boolean {
    return node.attributes.some((a) => a.type === 'mdxJsxAttribute' && a.name === name);
}

function stringAttr(name: string, value: string): MdxJsxAttribute {
    return { type: 'mdxJsxAttribute', name, value };
}

function arrayAttr(name: string, values: string[]): MdxJsxAttribute {
    return {
        type: 'mdxJsxAttribute',
        name,
        value: {
            type: 'mdxJsxAttributeValueExpression',
            value: JSON.stringify(values),
            data: {
                estree: {
                    type: 'Program',
                    sourceType: 'module',
                    body: [
                        {
                            type: 'ExpressionStatement',
                            expression: {
                                type: 'ArrayExpression',
                                elements: values.map((v) => ({ type: 'Literal', value: v, raw: JSON.stringify(v) }))
                            }
                        }
                    ]
                } as any
            }
        }
    };
}

function uniqueLabels(labels: string[]): string[] {
    const seen = new Map<string, number>();
    return labels.map((label) => {
        const n = seen.get(label) ?? 0;
        seen.set(label, n + 1);
        return n === 0 ? label : `${label} (${n + 1})`;
    });
}

function isJsx(node: unknown): node is JsxElement {
    const t = (node as { type?: string })?.type;
    return t === 'mdxJsxFlowElement' || t === 'mdxJsxTextElement';
}

// ---------------------------------------------------------------------------
// <Tabs><Tab title="A"> -> <Tabs items={["A"]}><Tab value="A">

function remarkMintlifyTabs() {
    return (tree: Root) => {
        visit(tree, (node) => {
            if (!isJsx(node) || node.name !== 'Tabs' || hasAttr(node, 'items')) return;
            const tabs = (node.children as RootContent[]).filter((c): c is MdxJsxFlowElement => isJsx(c) && c.name === 'Tab');
            if (tabs.length === 0) return;
            const labels = uniqueLabels(tabs.map((t, i) => getAttr(t, 'title') ?? getAttr(t, 'value') ?? `Tab ${i + 1}`));
            tabs.forEach((tab, i) => {
                tab.attributes = tab.attributes.filter((a) => !(a.type === 'mdxJsxAttribute' && a.name === 'value'));
                tab.attributes.push(stringAttr('value', labels[i]!));
            });
            node.attributes.push(arrayAttr('items', labels));
        });
    };
}

// ---------------------------------------------------------------------------
// <CodeGroup>/<RequestExample>/<ResponseExample> -> tabs of code blocks

const CODE_GROUPS: Record<string, string | null> = {
    CodeGroup: null,
    RequestExample: 'Request',
    ResponseExample: 'Response'
};

function remarkMintlifyCodeGroups() {
    return (tree: Root) => {
        visit(tree, (node) => {
            if (!isJsx(node) || !node.name || !(node.name in CODE_GROUPS)) return;
            const kind = CODE_GROUPS[node.name];
            const codes = (node.children as RootContent[]).filter((c): c is Code => c.type === 'code');
            const labels = uniqueLabels(
                codes.map((code) => {
                    const parsed = parseMintlifyMeta(code.meta);
                    return parsed.title ?? code.lang ?? 'Code';
                })
            );
            // titles move to the tab triggers
            for (const code of codes) {
                const parsed = parseMintlifyMeta(code.meta);
                code.meta = formatMeta({ attrs: parsed.attrs });
                code.data = { ...code.data, mintlifyMetaDone: true } as any;
            }

            let content: RootContent[] = node.children as RootContent[];
            if (codes.length > 1) {
                const tabs: MdxJsxFlowElement = {
                    type: 'mdxJsxFlowElement',
                    name: 'Tabs',
                    attributes: [arrayAttr('items', labels)],
                    children: codes.map((code, i) => ({
                        type: 'mdxJsxFlowElement',
                        name: 'Tab',
                        attributes: [stringAttr('value', labels[i]!)],
                        children: [code]
                    })) as any
                };
                content = [tabs];
            } else if (codes.length === 1) {
                // a single block keeps its title on the block itself
                codes[0]!.meta = formatMeta({ title: labels[0], attrs: parseMintlifyMeta(codes[0]!.meta).attrs });
            }

            if (kind) {
                node.name = 'ApiExample';
                node.attributes = [stringAttr('kind', kind)];
                node.children = content as any;
            } else {
                // CodeGroup: replace by its content
                Object.assign(node, { name: 'CodeGroup', attributes: [], children: content });
            }
        });
    };
}

// ---------------------------------------------------------------------------
// Asset URLs

function remarkMintlifyAssetUrls({ basePath }: { basePath: string }) {
    const prefix = (url: string): string => {
        if (!url.startsWith('/') || url.startsWith('//') || url.startsWith(`${basePath}/`)) return url;
        return `${basePath}${url}`;
    };
    const isAsset = (url: string) =>
        /\.(png|jpe?g|gif|svg|webp|avif|mp4|webm|ico|pdf)(\?.*)?$/i.test(url) || url.startsWith('/images/') || url.startsWith('/logo/');

    return (tree: Root) => {
        visit(tree, (node: any) => {
            if (node.type === 'image' && typeof node.url === 'string') {
                node.url = prefix(node.url);
                return;
            }
            if (!isJsx(node)) return;
            const lowercase = !!node.name && /^[a-z]/.test(node.name);
            for (const attr of node.attributes) {
                if (attr.type !== 'mdxJsxAttribute' || typeof attr.value !== 'string') continue;
                if (attr.name === 'src' || attr.name === 'img' || attr.name === 'image' || attr.name === 'poster') {
                    attr.value = prefix(attr.value);
                } else if (attr.name === 'href' && (lowercase || isAsset(attr.value))) {
                    // components (Card...) render Next links, which add the base path themselves
                    attr.value = prefix(attr.value);
                }
            }
        });
    };
}
