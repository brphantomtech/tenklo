import { icons } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

/**
 * Mintlify icon names are Font Awesome names; render the closest Lucide icon.
 * Server-only: importing the whole Lucide set is fine in RSC, it isn't shipped.
 */
const ALIASES: Record<string, string> = {
    bolt: 'zap',
    cubes: 'boxes',
    cube: 'box',
    slack: 'message-square',
    robot: 'bot',
    'arrows-rotate': 'refresh-cw',
    'circle-question': 'circle-help',
    'circle-info': 'info',
    'circle-check': 'circle-check',
    'triangle-exclamation': 'triangle-alert',
    gear: 'settings',
    gears: 'settings',
    'magnifying-glass': 'search',
    'book-open': 'book-open',
    book: 'book',
    code: 'code',
    terminal: 'terminal',
    'file-code': 'file-code',
    'file-lines': 'file-text',
    globe: 'globe',
    lock: 'lock',
    key: 'key',
    shield: 'shield',
    'shield-halved': 'shield-half',
    server: 'server',
    database: 'database',
    users: 'users',
    user: 'user',
    rocket: 'rocket',
    github: 'github',
    'arrow-right': 'arrow-right',
    'square-terminal': 'square-terminal',
    'wand-magic-sparkles': 'wand-sparkles',
    sparkles: 'sparkles',
    'pen-to-square': 'square-pen',
    'clock-rotate-left': 'history',
    webhook: 'webhook',
    'list-check': 'list-checks',
    'chart-line': 'chart-line',
    'cloud-arrow-up': 'cloud-upload',
    'hand-pointer': 'pointer',
    'puzzle-piece': 'puzzle'
};

const toPascal = (name: string) =>
    name
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join('');

export function resolveIcon(name: string | undefined): LucideIcon | undefined {
    if (!name || name.includes('/') || name.includes('.')) return undefined;
    const key = name.replace(/^fa-/, '').toLowerCase();
    const lookup = icons as Record<string, LucideIcon>;
    return lookup[toPascal(ALIASES[key] ?? key)] ?? lookup[toPascal(key)];
}

export function renderIcon(name: string | undefined, className = 'size-4'): ReactElement | undefined {
    if (name && (name.startsWith('/') || /^https?:/.test(name))) {
        const src = name.startsWith('/') && !name.startsWith('/docs/') ? `/docs${name}` : name;
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={src} alt="" className={className} />;
    }
    const Icon = resolveIcon(name);
    return Icon ? <Icon className={className} /> : undefined;
}
