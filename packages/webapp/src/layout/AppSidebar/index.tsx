import { Activity, ArrowUpRight, Blocks, Bot, Cog, House, Plug, Search, Sprout, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { AlertButtonLink } from '@/components/ui/AlertButtonLink';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem
} from '@/components/ui/Sidebar';
import { OverdueInvoiceAlert } from '@/features/Billing/OverdueInvoiceAlert';
import { useCommandPalette } from '@/features/CommandPalette/CommandPalette';
import { useConnectionsCount } from '@/hooks/useConnections';
import { useMeta } from '@/hooks/useMeta';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiGetOverdueInvoices, useCurrentPlan } from '@/hooks/usePlan';
import { apiPatchUser } from '@/hooks/useUser';
import { useStore } from '@/store';
import { track } from '@/utils/analytics';
import { EnvironmentDropdown } from './EnvironmentDropdown';
import { ProfileDropdown } from './ProfileDropdown';
import UsageLimitAlert from './UsageLimitAlert';

import type { LucideIcon } from 'lucide-react';

interface SidebarItem {
    title: string;
    url: string;
    icon: LucideIcon;
    exact?: boolean;
    /** How many things there need attention. */
    badge?: number;
    onClose?: () => Promise<void>;
}

export const AppSidebar: React.FC = () => {
    const env = useStore((state) => state.env);
    const { pathname } = useLocation();
    const { data: metaData, refetch: refetchMeta } = useMeta();
    const meta = metaData?.data;
    const showGettingStarted = useStore((state) => state.showGettingStarted);
    const { data: environmentData } = useCurrentPlan(env);
    const plan = environmentData?.plan;
    const { can } = usePermissions();
    const showPlayground = Boolean(meta?.agentPlayground) && can('environment:agent_sessions:write');
    const { data: connectionsCount } = useConnectionsCount(env);
    const needsAttention = connectionsCount?.data.withError ?? 0;
    const openSearch = useCommandPalette((state) => state.setOpen);

    // One item per question the dashboard answers; the tools for getting started sit apart, below.
    const items = useMemo<SidebarItem[]>(
        () => [
            { title: 'Home', url: `/${env}`, icon: House, exact: true },
            { title: 'Connections', url: `/${env}/connections`, icon: Plug, badge: needsAttention },
            { title: 'Integrations', url: `/${env}/integrations`, icon: Blocks },
            { title: 'Activity', url: `/${env}/logs`, icon: Activity },
            { title: 'Settings', url: `/${env}/environment-settings`, icon: Cog }
        ],
        [env, needsAttention]
    );

    const tools = useMemo<SidebarItem[]>(() => {
        const gettingStarted = {
            title: 'Getting started',
            url: `/${env}/getting-started`,
            icon: Sprout,
            onClose: async () => {
                await apiPatchUser({
                    gettingStartedClosed: true
                });
                void refetchMeta();
            }
        };

        return [
            meta && showGettingStarted && !meta.gettingStartedClosed ? gettingStarted : null,
            showPlayground ? { title: 'Playground', url: `/${env}/playground`, icon: Bot } : null
        ].filter((item) => item !== null);
    }, [env, meta, refetchMeta, showGettingStarted, showPlayground]);

    // Only free accounts see the usage-limit alert. Paid accounts have no enforced caps, so it
    // just adds noise and surfaces upgrade/downgrade inconsistencies (NAN-5959).
    const showUsageAlert = plan?.name === 'free';

    const canManageBilling = can('account:billing:payment_methods:create');
    const { data: overdue } = useApiGetOverdueInvoices(env, plan);
    const showOverdueAlert = Boolean(overdue?.data.hasOverdue);

    return (
        <Sidebar collapsible="none" className="border-r-[0.5px] border-border-default">
            <SidebarHeader className="p-0">
                <EnvironmentDropdown />
            </SidebarHeader>
            <SidebarContent className="pt-3">
                <div className="px-2.5 pb-3">
                    <button
                        type="button"
                        onClick={() => openSearch(true)}
                        className="flex h-8 w-full items-center gap-2 rounded border-[0.5px] border-border-input bg-surface-input px-2.5 text-body-small-regular text-text-muted transition-colors hover:text-text-strong focus-visible:outline-none focus-visible:shadow-focus-outline-default"
                    >
                        <Search className="size-3.5" aria-hidden />
                        Search
                        <kbd className="ml-auto font-code text-body-extra-small-medium">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
                    </button>
                </div>
                <SidebarItems items={items} pathname={pathname} />
                {tools.length > 0 && (
                    <div className="mt-4 border-t-[0.5px] border-border-default pt-4">
                        <SidebarItems items={tools} pathname={pathname} />
                    </div>
                )}
            </SidebarContent>
            <SidebarFooter className="p-0">
                {showOverdueAlert && (
                    <div className="px-2.5 mb-4">
                        <OverdueInvoiceAlert canManageBilling={canManageBilling}>
                            <AlertButtonLink to="/team/billing" onClick={() => track('billing:overdue_alert_link_click', {})}>
                                View billing <ArrowUpRight />
                            </AlertButtonLink>
                        </OverdueInvoiceAlert>
                    </div>
                )}
                {showUsageAlert && (
                    <div className="px-2.5 mb-6">
                        <UsageLimitAlert />
                    </div>
                )}
                <ProfileDropdown />
            </SidebarFooter>
        </Sidebar>
    );
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const SidebarItems: React.FC<{ items: SidebarItem[]; pathname: string }> = ({ items, pathname }) => (
    <SidebarGroup className="p-0 px-2.5">
        <SidebarGroupContent>
            <SidebarMenu className="gap-0">
                {items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                            asChild
                            data-active={pathname === item.url || (!item.exact && pathname.startsWith(`${item.url}/`))}
                            className="type-text-regular-sm gap-2.5 text-text-secondary [&>svg]:size-4!"
                        >
                            <Link to={item.url}>
                                <item.icon />
                                <span>{item.title}</span>
                            </Link>
                        </SidebarMenuButton>
                        {item.badge ? (
                            <SidebarMenuBadge aria-label={`${item.badge} need attention`} className="bg-status-danger-bg text-status-danger-text">
                                {item.badge}
                            </SidebarMenuBadge>
                        ) : null}
                        {item.onClose && (
                            <SidebarMenuAction
                                onClick={item.onClose}
                                aria-label={`Close ${item.title}`}
                                className="text-icon-secondary hover:bg-transparent hover:text-icon-default"
                            >
                                <X />
                            </SidebarMenuAction>
                        )}
                    </SidebarMenuItem>
                ))}
            </SidebarMenu>
        </SidebarGroupContent>
    </SidebarGroup>
);
