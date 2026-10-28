/**
 * Mintlify MDX components, rendered with Fumadocs UI primitives.
 * Prop names follow https://mintlify.com/docs/components so docs/ renders unchanged.
 */
import Link from 'fumadocs-core/link';
import { Callout } from 'fumadocs-ui/components/callout';
import { Cards, Card as FdCard } from 'fumadocs-ui/components/card';
import { Tab as FdTab, Tabs as FdTabs } from 'fumadocs-ui/components/tabs';
import { ChevronRight } from 'lucide-react';

import { renderIcon } from '@/lib/icons.tsx';

import type { ReactNode } from 'react';

type Children = { children?: ReactNode };

const slug = (value: string) =>
    value
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-');

// ---------------------------------------------------------------------------
// Callouts

type CalloutProps = Children & { title?: ReactNode; icon?: string };
const callout = (type: 'info' | 'warning' | 'error' | 'success' | 'idea') =>
    function MintlifyCallout({ children, title, icon }: CalloutProps) {
        return (
            <Callout type={type} title={title} icon={icon ? renderIcon(icon) : undefined}>
                {children}
            </Callout>
        );
    };

export const Note = callout('info');
export const Info = callout('info');
export const Tip = callout('idea');
export const Warning = callout('warning');
export const Danger = callout('error');
export const Check = callout('success');

export function MintlifyCalloutGeneric({ children, title, icon, type }: CalloutProps & { type?: string; color?: string }) {
    const t = (['info', 'warning', 'error', 'success', 'idea'] as const).find((v) => v === type) ?? 'info';
    return (
        <Callout type={t} title={title} icon={icon ? renderIcon(icon) : undefined}>
            {children}
        </Callout>
    );
}

// ---------------------------------------------------------------------------
// Steps

export function Steps({ children }: Children & { titleSize?: string }) {
    return <div className="fd-steps mintlify-steps">{children}</div>;
}

export function Step({ children, title, id, icon }: Children & { title?: ReactNode; id?: string; icon?: string; stepNumber?: number; titleSize?: string }) {
    const anchor = id ?? (typeof title === 'string' ? slug(title) : undefined);
    return (
        <div className="fd-step mintlify-step scroll-mt-28" id={anchor}>
            {title ? (
                <p className="not-prose mb-2 flex items-center gap-2 font-semibold text-fd-foreground">
                    {icon ? renderIcon(icon) : null}
                    {anchor ? (
                        <a href={`#${anchor}`} className="no-underline hover:underline">
                            {title}
                        </a>
                    ) : (
                        title
                    )}
                </p>
            ) : null}
            <div className="prose-no-margin">{children}</div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Tabs (`items`/`value` are added at compile time from `<Tab title>`)

export function Tabs({ children, items, defaultIndex }: Children & { items?: string[]; defaultIndex?: number }) {
    return (
        <FdTabs items={items} defaultIndex={defaultIndex}>
            {children}
        </FdTabs>
    );
}

export function Tab({ children, value }: Children & { title?: string; value?: string; icon?: string }) {
    return <FdTab value={value}>{children}</FdTab>;
}

// ---------------------------------------------------------------------------
// Accordions & expandables: native <details>, works standalone and in groups

export function AccordionGroup({ children }: Children) {
    return <div className="mintlify-accordion-group not-prose-margins my-4 divide-y divide-fd-border overflow-hidden rounded-lg border">{children}</div>;
}

export function Accordion({
    children,
    title,
    description,
    defaultOpen,
    icon,
    id
}: Children & { title?: ReactNode; description?: ReactNode; defaultOpen?: boolean; icon?: string; id?: string }) {
    // only explicit ids: many pages repeat titles like "For agents"
    return (
        <details className="mintlify-accordion group/acc scroll-mt-28 bg-fd-card" id={id} open={defaultOpen || undefined}>
            <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3 font-medium hover:bg-fd-accent/60 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="mt-1 size-4 shrink-0 text-fd-muted-foreground transition-transform group-open/acc:rotate-90" />
                {icon ? <span className="mt-0.5 text-fd-muted-foreground">{renderIcon(icon)}</span> : null}
                <span className="flex flex-col">
                    <span>{title}</span>
                    {description ? <span className="text-sm font-normal text-fd-muted-foreground">{description}</span> : null}
                </span>
            </summary>
            <div className="prose-no-margin border-t px-4 py-3">{children}</div>
        </details>
    );
}

export function Expandable({ children, title, defaultOpen }: Children & { title?: string; defaultOpen?: boolean }) {
    return (
        <details className="mintlify-expandable group/exp my-2 rounded-lg border" open={defaultOpen || undefined}>
            <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 transition-transform group-open/exp:rotate-90" />
                <span className="group-open/exp:hidden">Show {title ?? 'properties'}</span>
                <span className="hidden group-open/exp:inline">Hide {title ?? 'properties'}</span>
            </summary>
            <div className="prose-no-margin border-t px-3 py-1">{children}</div>
        </details>
    );
}

// ---------------------------------------------------------------------------
// Cards

export function Card({
    children,
    title,
    icon,
    href,
    img,
    horizontal
}: Children & { title?: ReactNode; icon?: string; href?: string; img?: string; horizontal?: boolean; color?: string; cta?: string; arrow?: boolean }) {
    const external = href ? /^https?:\/\//.test(href) : false;
    return (
        <FdCard
            title={
                <span className={horizontal ? 'inline-flex items-center gap-2' : undefined}>
                    {horizontal && icon ? renderIcon(icon) : null}
                    {title}
                </span>
            }
            icon={!horizontal && icon ? renderIcon(icon) : undefined}
            href={href}
            external={external}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img ? <img src={img} alt="" className="mb-2 rounded-md" /> : null}
            {children}
        </FdCard>
    );
}

const COLS: Record<number, string> = { 1: 'grid-cols-1!', 2: 'sm:grid-cols-2!', 3: 'sm:grid-cols-2! lg:grid-cols-3!', 4: 'sm:grid-cols-2! lg:grid-cols-4!' };

export function CardGroup({ children, cols = 2 }: Children & { cols?: number }) {
    return <Cards className={`not-prose-margins my-4 grid-cols-1! ${COLS[Number(cols)] ?? COLS[2]}`}>{children}</Cards>;
}

export const Columns = CardGroup;

// ---------------------------------------------------------------------------
// API fields

function FieldHeader({
    name,
    type,
    required,
    deprecated,
    defaultValue,
    location
}: {
    name?: string;
    type?: string;
    required?: boolean;
    deprecated?: boolean;
    defaultValue?: unknown;
    location?: string;
}) {
    return (
        <div className="not-prose flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {name ? <code className="font-mono text-sm font-semibold text-fd-primary">{name}</code> : null}
            {location ? <span className="text-xs text-fd-muted-foreground">{location}</span> : null}
            {type ? <span className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-xs text-fd-muted-foreground">{type}</span> : null}
            {required ? <span className="text-xs font-medium text-red-600 dark:text-red-400">required</span> : null}
            {deprecated ? <span className="text-xs font-medium text-amber-600 line-through dark:text-amber-400">deprecated</span> : null}
            {defaultValue !== undefined ? (
                <span className="text-xs text-fd-muted-foreground">
                    default:{' '}
                    <code className="font-mono">{typeof defaultValue === 'object' ? JSON.stringify(defaultValue) : String(defaultValue as string)}</code>
                </span>
            ) : null}
        </div>
    );
}

export function ResponseField({
    children,
    name,
    type,
    required,
    deprecated,
    default: defaultValue
}: Children & { name?: string; type?: string; required?: boolean; deprecated?: boolean; default?: unknown; pre?: string[]; post?: string[] }) {
    return (
        <div className="mintlify-field border-b py-3 last:border-b-0">
            <FieldHeader name={name} type={type} required={required} deprecated={deprecated} defaultValue={defaultValue} />
            {children ? <div className="prose-no-margin mt-2 text-sm">{children}</div> : null}
        </div>
    );
}

export function ParamField({
    children,
    path,
    query,
    body,
    header,
    name,
    type,
    required,
    deprecated,
    default: defaultValue
}: Children & {
    path?: string;
    query?: string;
    body?: string;
    header?: string;
    name?: string;
    type?: string;
    required?: boolean;
    deprecated?: boolean;
    default?: unknown;
    placeholder?: string;
}) {
    const [location, field] = path ? ['path', path] : query ? ['query', query] : body ? ['body', body] : header ? ['header', header] : [undefined, name];
    return (
        <div className="mintlify-field border-b py-3 last:border-b-0">
            <FieldHeader name={field} type={type} required={required} deprecated={deprecated} defaultValue={defaultValue} location={location} />
            {children ? <div className="prose-no-margin mt-2 text-sm">{children}</div> : null}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Media & misc

export function Frame({ children, caption, hint }: Children & { caption?: ReactNode; hint?: ReactNode }) {
    return (
        <figure className="mintlify-frame not-prose-margins my-6">
            {hint ? <p className="mb-2 text-sm text-fd-muted-foreground">{hint}</p> : null}
            <div className="overflow-hidden rounded-xl border bg-fd-card p-2 [&_img]:m-0! [&_img]:rounded-lg">{children}</div>
            {caption ? <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
        </figure>
    );
}

export function Update({ children, label, description, tags }: Children & { label: string; description?: ReactNode; tags?: string[]; rss?: unknown }) {
    const id = slug(label);
    return (
        <section className="update-container scroll-mt-28 border-b py-8 last:border-b-0 lg:flex lg:gap-6" id={id}>
            <div className="mb-4 shrink-0 lg:sticky lg:top-24 lg:mb-0 lg:w-40 lg:self-start">
                <a href={`#${id}`} className="not-prose inline-block rounded-md bg-fd-primary/10 px-2 py-1 text-sm font-medium text-fd-primary no-underline">
                    {label}
                </a>
                {description ? <p className="not-prose mt-2 text-sm text-fd-muted-foreground">{description}</p> : null}
                {tags?.length ? (
                    <div className="not-prose mt-2 flex flex-wrap gap-1">
                        {tags.map((tag) => (
                            <span key={tag} className="rounded border px-1.5 text-xs text-fd-muted-foreground">
                                {tag}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
            <div className="prose-no-margin min-w-0 flex-1">{children}</div>
        </section>
    );
}

/** Children are rewritten at compile time (see lib/mdx-plugins/mintlify.ts). */
export function CodeGroup({ children }: Children) {
    return <div className="mintlify-code-group">{children}</div>;
}

/** `<RequestExample>` / `<ResponseExample>`: Mintlify puts them in a side column; here they follow the content. */
export function ApiExample({ children, kind }: Children & { kind?: string }) {
    return (
        <div className="mintlify-api-example my-6">
            {kind ? <p className="not-prose mb-2 text-sm font-semibold text-fd-muted-foreground">{kind} example</p> : null}
            {children}
        </div>
    );
}

export function Tooltip({ children, tip, headline, href, cta }: Children & { tip?: string; headline?: string; href?: string; cta?: string }) {
    const title = [headline, tip].filter(Boolean).join(': ');
    const content = (
        <span title={title} className="cursor-help underline decoration-dotted underline-offset-4">
            {children}
        </span>
    );
    return href ? (
        <Link href={href} title={cta ?? title}>
            {content}
        </Link>
    ) : (
        content
    );
}

export function Icon({ icon, size }: { icon?: string; size?: number; color?: string; iconType?: string }) {
    const sizeClass = size ? `inline-block align-middle` : 'inline-block size-4 align-middle';
    return <span style={size ? { width: size, height: size } : undefined}>{renderIcon(icon, sizeClass)}</span>;
}

export function Badge({ children }: Children & { color?: string }) {
    return <span className="rounded-md border bg-fd-muted px-1.5 py-0.5 text-xs font-medium">{children}</span>;
}

export const mintlifyComponents = {
    Note,
    Info,
    Tip,
    Warning,
    Danger,
    Check,
    Callout: MintlifyCalloutGeneric,
    Steps,
    Step,
    Tabs,
    Tab,
    Accordion,
    AccordionGroup,
    Expandable,
    Card,
    CardGroup,
    Columns,
    ResponseField,
    ParamField,
    Frame,
    Update,
    CodeGroup,
    ApiExample,
    Tooltip,
    Icon,
    Badge
};
