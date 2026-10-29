import { Blocks, CornerDownLeft, FileText, Plug, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebounce } from 'react-use';
import { create } from 'zustand';

import { Dialog, DialogContent, DialogTitle } from '@nangohq/design-system';

import { IntegrationLogo } from '@/components/patterns/IntegrationLogo';
import { useConnections } from '@/hooks/useConnections';
import { useListIntegrations } from '@/hooks/useIntegration';
import { useStore } from '@/store';
import { getConnectionDisplayName } from '@/utils/endUser';
import { cn } from '@/utils/utils';
import { fold } from './search';

import type { LucideIcon } from 'lucide-react';

/** Whether the palette is open, so the sidebar's search button and the ⌘K shortcut share it. */
export const useCommandPalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
    open: false,
    setOpen: (open) => set({ open })
}));

interface PaletteItem {
    id: string;
    group: 'Pages' | 'Integrations' | 'Connections';
    label: string;
    hint?: string;
    to: string;
    icon: LucideIcon | { provider: string };
}

/** How many results each group shows, so one group never pushes the others out of view. */
const GROUP_LIMIT = 6;

const pagesFor = (env: string): PaletteItem[] => [
    { id: 'page:home', group: 'Pages', label: 'Home', to: `/${env}`, icon: FileText },
    { id: 'page:connections', group: 'Pages', label: 'Connections', hint: 'Needs attention', to: `/${env}/connections`, icon: FileText },
    { id: 'page:integrations', group: 'Pages', label: 'Integrations', to: `/${env}/integrations`, icon: FileText },
    { id: 'page:new-integration', group: 'Pages', label: 'Set up a new integration', to: `/${env}/integrations/create`, icon: FileText },
    { id: 'page:activity', group: 'Pages', label: 'Activity', hint: 'Logs', to: `/${env}/logs`, icon: FileText },
    { id: 'page:settings', group: 'Pages', label: 'Settings', hint: 'Environment, keys, webhooks', to: `/${env}/environment-settings`, icon: FileText },
    { id: 'page:api-keys', group: 'Pages', label: 'API keys', to: `/${env}/environment-settings#api-keys`, icon: FileText },
    { id: 'page:webhooks', group: 'Pages', label: 'Webhooks', to: `/${env}/environment-settings#webhooks`, icon: FileText },
    { id: 'page:team', group: 'Pages', label: 'Team', to: `/${env}/team-settings`, icon: FileText }
];

/**
 * ⌘K / Ctrl+K: jump to any page, integration or connection by typing part of its name. Connections are
 * searched on the server (by ID, customer name or email); pages and integrations locally.
 */
export const CommandPalette: React.FC = () => {
    const { open, setOpen } = useCommandPalette();

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setOpen(!useCommandPalette.getState().open);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [setOpen]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent showCloseButton={false}>
                <span className="sr-only">
                    <DialogTitle>Search</DialogTitle>
                </span>
                <div className="p-3">{open && <PaletteBody onClose={() => setOpen(false)} />}</div>
            </DialogContent>
        </Dialog>
    );
};

const PaletteBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const env = useStore((state) => state.env);
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);
    useDebounce(() => setDebouncedQuery(query.trim()), 200, [query]);

    const { data: integrationsData } = useListIntegrations(env);
    const connections = useConnections({ env: debouncedQuery ? env : '', search: debouncedQuery });

    const items = useMemo<PaletteItem[]>(() => {
        const term = fold(query.trim());
        const matches = (text: string) => !term || fold(text).includes(term);

        const pages = pagesFor(env).filter((page) => matches(`${page.label} ${page.hint ?? ''}`));
        const integrations = (integrationsData?.data ?? [])
            .filter((integration) => matches(`${integration.display_name || integration.meta.displayName} ${integration.unique_key}`))
            .slice(0, GROUP_LIMIT)
            .map<PaletteItem>((integration) => ({
                id: `integration:${integration.unique_key}`,
                group: 'Integrations',
                label: integration.display_name || integration.meta.displayName,
                hint: integration.unique_key,
                to: `/${env}/integrations/${encodeURIComponent(integration.unique_key)}`,
                icon: { provider: integration.provider }
            }));
        const found = term
            ? (connections.data?.pages[0]?.data ?? []).slice(0, GROUP_LIMIT).map<PaletteItem>((connection) => ({
                  id: `connection:${connection.id}`,
                  group: 'Connections',
                  label: getConnectionDisplayName({ endUser: connection.endUser, connectionId: connection.connection_id, connectionTags: connection.tags }),
                  hint: `${connection.provider_config_key} · ${connection.connection_id}`,
                  to: `/${env}/connections/${encodeURIComponent(connection.provider_config_key)}/${encodeURIComponent(connection.connection_id)}`,
                  icon: { provider: connection.provider }
              }))
            : [];
        return [...(term ? pages : pages.slice(0, GROUP_LIMIT)), ...integrations, ...found];
    }, [env, query, integrationsData, connections.data]);

    useEffect(() => setActive(0), [query]);
    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [active]);

    const go = (item: PaletteItem | undefined) => {
        if (!item) return;
        onClose();
        void navigate(item.to);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            go(items[active]);
        }
    };

    const searchingConnections = Boolean(query.trim()) && (query.trim() !== debouncedQuery || connections.isFetching);

    return (
        <div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
            <div className="flex items-center gap-2 border-b border-border-muted pb-2">
                <Search className="size-4 text-text-muted" aria-hidden />
                <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search pages, integrations and connections"
                    aria-label="Search pages, integrations and connections"
                    aria-controls="command-palette-results"
                    aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
                    role="combobox"
                    aria-expanded
                    className="min-w-0 flex-1 bg-transparent py-1 text-body-medium-regular text-text-strong outline-none placeholder:text-text-placeholder"
                />
            </div>
            <ul id="command-palette-results" ref={listRef} role="listbox" aria-label="Results" className="flex max-h-96 flex-col overflow-auto">
                {items.map((item, index) => {
                    const startsGroup = index === 0 || items[index - 1]?.group !== item.group;
                    return (
                        <li key={item.id} role="presentation">
                            {startsGroup && <div className="px-2 pb-1 pt-2 text-body-extra-small-medium uppercase text-text-muted">{item.group}</div>}
                            <div
                                id={`palette-${item.id}`}
                                role="option"
                                aria-selected={index === active}
                                onMouseMove={() => setActive(index)}
                                onClick={() => go(item)}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5',
                                    index === active ? 'bg-surface-panel-inset text-text-strong' : 'text-text-secondary'
                                )}
                            >
                                {'provider' in item.icon ? (
                                    <IntegrationLogo provider={item.icon.provider} className="size-6" />
                                ) : (
                                    <span className="flex size-6 items-center justify-center">
                                        <item.icon className="size-4" aria-hidden />
                                    </span>
                                )}
                                <span className="truncate text-body-medium-medium">{item.label}</span>
                                {item.hint && <span className="truncate text-body-small-regular text-text-muted">{item.hint}</span>}
                                {index === active && <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-text-muted" aria-hidden />}
                            </div>
                        </li>
                    );
                })}
                {searchingConnections && <li className="px-2 py-2 text-body-small-regular text-text-muted">Searching connections…</li>}
                {items.length === 0 && !searchingConnections && (
                    <li className="px-2 py-6 text-center text-body-small-regular text-text-muted">Nothing matches “{query.trim()}”.</li>
                )}
            </ul>
            <div className="flex items-center gap-3 border-t border-border-muted pt-2 text-body-extra-small-medium text-text-muted">
                <span className="flex items-center gap-1">
                    <Blocks className="size-3" aria-hidden /> <Plug className="size-3" aria-hidden /> Type a name, ID or email
                </span>
                <span className="ml-auto">↑↓ to move · ↵ to open · esc to close</span>
            </div>
        </div>
    );
};
