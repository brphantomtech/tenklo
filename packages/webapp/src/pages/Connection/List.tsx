import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs';
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { useDebounce } from 'react-use';

import { Badge, Button, InputGroup, InputGroupAddon, InputGroupInput } from '@nangohq/design-system';

import { ErrorPageComponent } from '@/components/patterns/ErrorComponent';
import { IntegrationLogo } from '@/components/patterns/IntegrationLogo';
import { PermissionGate } from '@/components/patterns/PermissionGate';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ComboboxSelect } from '@/components/ui/Combobox';
import { CopyButton } from '@/components/ui/CopyButton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useConnections, useConnectionsCount } from '@/hooks/useConnections';
import { useListIntegrations } from '@/hooks/useIntegration';
import { usePermissions } from '@/hooks/usePermissions';
import DashboardLayout from '@/layout/DashboardLayout';
import { useStore } from '@/store';
import { describeConnectionProblem } from '@/utils/connectionProblems';
import { getConnectionDisplayName, getEndUserEmail } from '@/utils/endUser';
import { formatDateToInternationalFormat } from '@/utils/utils';
import { resolveView, views, withErrorFor } from './views';

import type { StatusFilterValue, View } from './views';
import type { ComboboxOption } from '@/components/ui/Combobox';
import type { ApiConnectionSimple, ApiIntegrationList, GetConnections } from '@nangohq/types';
import type { ColumnDef } from '@tanstack/react-table';

type ConnectionRow = ApiConnectionSimple & { integration?: ApiIntegrationList };

/** `ok` and `error` are older links' values, read as the healthy and attention views. */
const validStatusFilterValues = new Set<string>(['auth_error', 'sync_error', 'paused']);

const statusOptions: ComboboxOption<StatusFilterValue>[] = [
    { label: 'Credentials problem', value: 'auth_error' },
    { label: 'Failing syncs', value: 'sync_error' },
    { label: 'Paused syncs', value: 'paused' }
];

const parseView = parseAsStringLiteral(views);
const parseSearch = parseAsString.withDefault('');
const parseIntegrations = parseAsArrayOf(parseAsString, ',').withDefault([]);
const parseStatusFilters = parseAsArrayOf(parseAsString, ',').withDefault([]);

const columns: ColumnDef<ConnectionRow>[] = [
    {
        accessorKey: 'id',
        header: 'Customer',
        size: 115,
        cell: ({ row }) => {
            const data = row.original;

            const displayName = getConnectionDisplayName({ endUser: data.endUser, connectionId: data.connection_id, connectionTags: data.tags });
            const email = getEndUserEmail(data.endUser, data.tags);

            return (
                <div className="flex gap-2.5 items-center min-w-0">
                    <Avatar name={displayName} />
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-body-small-semi text-text-strong truncate">{displayName}</span>
                        <span className="text-body-small-regular text-text-muted truncate">{email ?? ''}</span>
                    </div>
                </div>
            );
        }
    },
    {
        accessorKey: 'provider',
        header: 'Integration',
        size: 100,
        cell: ({ row }) => {
            const { provider, integration } = row.original;

            return (
                <div className="flex gap-1.5 items-center">
                    <IntegrationLogo provider={provider} className="size-8 bg-transparent" />
                    <span className="text-body-small-semi text-text-strong">{integration?.unique_key ?? provider}</span>
                </div>
            );
        }
    },
    {
        accessorKey: 'connection_id',
        header: 'Connection ID',
        size: 130,
        cell: ({ row }) => {
            const { connection_id } = row.original;

            return (
                <div className="flex gap-1.5 items-center min-w-0">
                    <span className="text-body-extra-small-medium text-text-secondary truncate flex-1 min-w-0">{connection_id}</span>
                    <CopyButton text={connection_id} />
                </div>
            );
        }
    },
    {
        accessorKey: 'created_at',
        header: 'Created on',
        size: 80,
        cell: ({ row }) => {
            const { created_at } = row.original;

            return (
                <time dateTime={created_at} title={created_at} className="text-code-body-small-regular text-text-muted">
                    {formatDateToInternationalFormat(created_at)}
                </time>
            );
        }
    },
    {
        accessorKey: 'status',
        header: 'Status',
        size: 170,
        cell: ({ row }) => {
            const { errors, pausedSyncs } = row.original;
            const problem = describeConnectionProblem(errors);

            return (
                <div className="flex flex-col items-start gap-1 min-w-0">
                    <div className="flex flex-wrap gap-1">
                        {problem ? <Badge variant={problem.tone}>{problem.label}</Badge> : <Badge variant="success">Connected</Badge>}
                        {pausedSyncs.length > 0 && (
                            <Badge variant="secondary">{pausedSyncs.length === 1 ? 'Sync paused' : `${pausedSyncs.length} syncs paused`}</Badge>
                        )}
                    </div>
                    {problem && (
                        <span className="text-body-small-regular text-text-muted truncate max-w-full" title={problem.cause}>
                            Fix: {problem.fix.toLowerCase()}
                        </span>
                    )}
                </div>
            );
        }
    }
];

export const ConnectionList = () => {
    const env = useStore((state) => state.env);

    const { can } = usePermissions();
    // Connections are created through a connect session, which requires `connections:update`.
    const canCreateTestConnection = can('environment:connections:update');

    const navigate = useNavigate();

    const [search, setSearch] = useQueryState('search', parseSearch);
    const [debouncedSearch, setDebouncedSearch] = useState<string>('');
    const [selectedIntegrations, setSelectedIntegrations] = useQueryState('integrations', parseIntegrations);
    const [rawStatusFilters, setSelectedStatusFilters] = useQueryState('status', parseStatusFilters);
    const selectedStatusFilters = useMemo(
        () => (rawStatusFilters ?? []).filter((s): s is StatusFilterValue => validStatusFilterValues.has(s)),
        [rawStatusFilters]
    );
    const [viewParam, setView] = useQueryState('view', parseView);
    const { data: countData, loading: countLoading } = useConnectionsCount(env);
    const counts = countData?.data;
    const hasLegacyStatus = rawStatusFilters?.some((s) => s === 'ok' || s === 'error') ?? false;
    const view = resolveView({ viewParam, rawStatusFilters: rawStatusFilters ?? [], counts: countLoading ? null : (counts ?? { withError: 0 }) });

    useDebounce(() => setDebouncedSearch(search || ''), 300, [search]);

    const { data: listIntegrationData, isLoading: integrationsLoading } = useListIntegrations(env);

    const withError = withErrorFor(view, selectedStatusFilters);

    const integrationIds = useMemo(() => {
        if (!selectedIntegrations || selectedIntegrations.length === 0) return undefined;
        return selectedIntegrations;
    }, [selectedIntegrations]);

    const {
        data: connectionsData,
        isLoading: loading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        error: connectionsError
    } = useConnections({
        env: view ? env : '',
        search: debouncedSearch,
        integrationIds,
        withError
    });

    const connectionsWithIntegrations = useMemo(() => {
        const connections = connectionsData?.pages.flatMap((page) => page.data) || [];

        return connections.map((connection) => ({
            ...connection,
            integration: listIntegrationData?.data?.find((integration) => integration.id === connection.config_id)
        }));
    }, [connectionsData, listIntegrationData?.data]);

    const displayedConnections = useMemo(() => {
        if (selectedStatusFilters.length === 0) return connectionsWithIntegrations;
        return connectionsWithIntegrations.filter((conn) =>
            selectedStatusFilters.some((filter) => {
                switch (filter) {
                    case 'auth_error':
                        return conn.errors.some((e) => e.type === 'auth');
                    case 'sync_error':
                        return conn.errors.some((e) => e.type === 'sync');
                    case 'paused':
                        return conn.pausedSyncs.length > 0;
                }
            })
        );
    }, [connectionsWithIntegrations, selectedStatusFilters]);

    useEffect(() => {
        if (selectedStatusFilters.length > 0 && displayedConnections.length === 0 && hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
        }
    }, [displayedConnections.length, selectedStatusFilters.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

    const hasFiltered =
        debouncedSearch || (selectedIntegrations && selectedIntegrations.length > 0) || selectedStatusFilters.length > 0 || (view !== null && view !== 'all');

    const connectionCount = displayedConnections.length;
    const hasConnections = connectionCount > 0;
    const listLoading = loading || view === null;
    const showEmptyStateNoFilters = !listLoading && connectionCount === 0 && !hasFiltered;
    const showEmptyStateWithFilters = !listLoading && !isFetchingNextPage && connectionCount === 0 && hasFiltered && !hasNextPage;
    const coreRowModel = useMemo(() => getCoreRowModel(), []);
    const table = useReactTable({
        data: displayedConnections,
        columns,
        getCoreRowModel: coreRowModel
    });

    const integrationsOptions = useMemo(() => {
        const list = listIntegrationData?.data;
        if (!list) {
            return [];
        }
        return list.map((integration) => ({
            label: integration.display_name || integration.unique_key,
            value: integration.unique_key,
            icon: <IntegrationLogo provider={integration.provider} className="size-7 rounded-[3.7px] p-[3.48px] bg-transparent border-transparent" />
        }));
    }, [listIntegrationData?.data]);

    if (connectionsError) {
        return <ErrorPageComponent title="Connections" error={connectionsError.json as GetConnections['Errors']} />;
    }

    return (
        <DashboardLayout fullWidth title="Connections">
            <Helmet>
                <title>Connections - Tenklo</title>
            </Helmet>

            <div className="flex flex-col gap-3">
                {/* Content */}
                <div className="flex flex-col gap-3">
                    {(listLoading || hasConnections || hasFiltered) && (
                        <>
                            {/* Filters */}
                            <div className="flex items-center gap-1.5">
                                <InputGroup className="flex-1">
                                    <InputGroupInput
                                        type="text"
                                        placeholder="Search connections"
                                        value={search || ''}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                    <InputGroupAddon>
                                        <Search />
                                    </InputGroupAddon>
                                </InputGroup>
                                <ComboboxSelect
                                    allowMultiple
                                    label={selectedIntegrations && selectedIntegrations.length > 0 ? `Integrations` : 'All integrations'}
                                    dropdownTitle="All integrations"
                                    onClearAll={() => setSelectedIntegrations([])}
                                    options={integrationsOptions}
                                    loading={integrationsLoading}
                                    selected={selectedIntegrations || []}
                                    onSelectedChange={(selected) => setSelectedIntegrations(selected)}
                                    emptyText="No integrations found"
                                    footer={
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="flex items-center justify-center gap-2 text-text-muted text-body-small-regular">
                                                Need a new integration?
                                            </span>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    navigate(`/${env}/integrations/create`);
                                                }}
                                            >
                                                <Plus className="size-4" /> Add
                                            </Button>
                                        </div>
                                    }
                                />
                                <ComboboxSelect
                                    allowMultiple
                                    label="Status"
                                    dropdownTitle="Select statuses"
                                    onClearAll={() => setSelectedStatusFilters([])}
                                    options={statusOptions}
                                    selected={selectedStatusFilters}
                                    onSelectedChange={setSelectedStatusFilters}
                                    reorderOnSelect={false}
                                    showSearch={false}
                                />
                                <PermissionGate condition={canCreateTestConnection}>
                                    {(allowed) => (
                                        <ButtonLink to={`/${env}/connections/create`} size="md" disabled={!allowed} className="ml-auto">
                                            Add test connection
                                        </ButtonLink>
                                    )}
                                </PermissionGate>
                            </div>

                            {/* Health views */}
                            <div className="flex items-center">
                                {counts ? (
                                    <SegmentedControl<View>
                                        aria-label="Connections by health"
                                        value={view ?? 'all'}
                                        onChange={(next) => {
                                            void setView(next);
                                            // An older link's ok/error filter would otherwise keep overriding the view.
                                            if (hasLegacyStatus) void setSelectedStatusFilters(selectedStatusFilters);
                                        }}
                                        options={[
                                            { value: 'attention', label: `Needs attention · ${counts.withError}` },
                                            { value: 'healthy', label: `Healthy · ${counts.total - counts.withError}` },
                                            { value: 'all', label: `All · ${counts.total}` }
                                        ]}
                                    />
                                ) : (
                                    <Skeleton className="w-72 h-7" />
                                )}
                            </div>

                            {/* Table */}
                            <Table>
                                <TableHeader>
                                    {table.getHeaderGroups().map((headerGroup) => (
                                        <TableRow key={headerGroup.id}>
                                            {headerGroup.headers.map((header) => {
                                                return (
                                                    <TableHead
                                                        key={header.id}
                                                        style={{
                                                            maxWidth: header.getSize() !== 0 ? header.getSize() : undefined,
                                                            width: header.getSize() !== 0 ? header.getSize() : undefined
                                                        }}
                                                        className="h-11"
                                                    >
                                                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                                    </TableHead>
                                                );
                                            })}
                                        </TableRow>
                                    ))}
                                </TableHeader>
                                {listLoading && (
                                    <TableBody>
                                        {Array.from({ length: 3 }).map((_, rowIndex) => (
                                            <TableRow key={rowIndex} className="h-16">
                                                {table.getAllColumns().map((col, colIndex) => (
                                                    <TableCell
                                                        key={colIndex}
                                                        style={{
                                                            maxWidth: col.getSize() !== 0 ? col.getSize() : undefined
                                                        }}
                                                    >
                                                        <Skeleton className="h-4" style={{ width: col.getSize() ? col.getSize() - 20 : 'auto' }} />
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                )}
                                {!listLoading && hasConnections && (
                                    <TableBody>
                                        {table.getRowModel().rows.map((row) => (
                                            <TableRow
                                                key={row.id}
                                                className="h-16 cursor-pointer"
                                                onClick={() => {
                                                    navigate(`/${env}/connections/${row.original.provider_config_key}/${row.original.connection_id}`);
                                                }}
                                            >
                                                {row.getVisibleCells().map((cell) => (
                                                    <TableCell
                                                        key={cell.id}
                                                        style={{
                                                            maxWidth: cell.column.getSize() !== 0 ? cell.column.getSize() : undefined
                                                        }}
                                                    >
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                )}
                            </Table>

                            {showEmptyStateWithFilters && (
                                <div className="flex flex-col gap-3 p-20 items-center justify-center bg-surface-panel rounded">
                                    {view === 'attention' && !debouncedSearch && !selectedIntegrations?.length && !selectedStatusFilters.length ? (
                                        <>
                                            <h3 className="text-title-body text-text-strong">Nothing needs attention</h3>
                                            <p className="text-text-secondary text-body-medium-regular">Every connection is running.</p>
                                            <Button variant="outline" size="md" onClick={() => void setView('all')}>
                                                See all connections
                                            </Button>
                                        </>
                                    ) : (
                                        <p className="text-text-secondary text-body-medium-regular">No connections found.</p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                    {showEmptyStateNoFilters && (
                        <div className="flex flex-col gap-5 p-20 items-center justify-center bg-surface-panel rounded">
                            <h3 className="text-title-body text-text-strong">Connect to an external API</h3>
                            <p className="text-text-secondary text-body-medium-regular">
                                Connections can be created by using{' '}
                                <Button asChild variant="link-accent">
                                    <a href="https://docs.tenklo.dev/guides/auth/auth-guide" target="_blank" rel="noopener noreferrer">
                                        Tenklo Connect
                                        <ExternalLink />
                                    </a>
                                </Button>
                                , or manually here.
                            </p>
                            <ButtonLink to={`/${env}/connections/create`} size="lg">
                                Add test connection
                            </ButtonLink>
                        </div>
                    )}

                    {hasNextPage && (
                        <div className="self-center">
                            <Button onClick={() => fetchNextPage()} loading={isFetchingNextPage} variant="outline">
                                Load More
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
};
