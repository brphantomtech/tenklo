import { Badge, Button } from '@nangohq/design-system';

import { IntegrationLogo } from '@/components/patterns/IntegrationLogo';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Skeleton } from '@/components/ui/Skeleton';
import { useConnections, useConnectionsCount } from '@/hooks/useConnections';
import { getConnectionDisplayName } from '@/utils/endUser';

import type { ApiConnectionSimple } from '@nangohq/types';

/** How many connections needing attention the home lists before linking to the full list. */
export const ATTENTION_LIMIT = 5;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What went wrong with a connection and who can fix it, in words rather than error types. */
export function describeProblem(connection: Pick<ApiConnectionSimple, 'errors'>): { label: string; hint: string; tone: 'danger' | 'warning' } {
    if (connection.errors.some((error) => error.type === 'auth')) {
        return { label: 'Credentials expired or were revoked', hint: 'The customer needs to reconnect', tone: 'danger' };
    }
    return { label: 'A sync is failing', hint: 'Open the connection to see the failed runs', tone: 'warning' };
}

/**
 * Answers "is everything working?" before anything else on the home: a headline with the state of the
 * environment's connections, then the ones that need attention, each linking to where it gets fixed.
 */
export const HealthSummary: React.FC<{ env: string }> = ({ env }) => {
    const count = useConnectionsCount(env);
    const withError = count.data?.data.withError ?? 0;
    const failing = useConnections({ env, withError: true });
    const attention = (failing.data?.pages[0]?.data ?? []).slice(0, ATTENTION_LIMIT);

    if (count.loading) {
        return (
            <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-96" />
                <Skeleton className="w-64" />
            </div>
        );
    }

    if (count.error || !count.data) {
        return (
            <div className="flex flex-col items-start gap-3">
                <h1 className="text-heading-large text-text-strong">We couldn’t check your connections</h1>
                <p className="text-body-medium-regular text-text-secondary">The rest of the dashboard still works. Try again in a moment.</p>
                <Button variant="outline" size="md" onClick={() => void count.refetch()}>
                    Try again
                </Button>
            </div>
        );
    }

    const { total } = count.data.data;

    if (total === 0) {
        return (
            <div className="flex flex-col items-start gap-3">
                <h1 className="text-heading-large text-text-strong">No connections yet</h1>
                <p className="text-body-medium-regular text-text-secondary">A connection is one of your customers’ accounts, linked through an integration.</p>
                <ButtonLink to={`/${env}/connections/create`} variant="primary" size="md">
                    Create a connection
                </ButtonLink>
            </div>
        );
    }

    if (withError === 0) {
        return (
            <div className="flex flex-col gap-1">
                <h1 className="text-heading-large text-text-strong">Everything is running</h1>
                <p className="text-body-medium-regular text-text-secondary">{plural(total, 'connection', 'connections')}, none need attention.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="text-heading-large text-text-strong">{plural(withError, 'connection needs', 'connections need')} your attention</h1>
                <p className="text-body-medium-regular text-text-secondary">
                    {total > withError ? `The other ${plural(total - withError, 'connection is', 'connections are')} running.` : 'Open each one to fix it.'}
                </p>
            </div>
            <ul
                aria-label="Connections that need attention"
                className="flex flex-col rounded-md border border-border-muted border-l-2 border-l-status-danger-text bg-surface-panel"
            >
                {failing.isLoading &&
                    Array.from({ length: Math.min(withError, ATTENTION_LIMIT) }, (_, i) => (
                        <li key={i} className="px-4 py-3">
                            <Skeleton className="w-full" />
                        </li>
                    ))}
                {attention.map((connection) => {
                    const problem = describeProblem(connection);
                    const name = getConnectionDisplayName({
                        endUser: connection.endUser,
                        connectionId: connection.connection_id,
                        connectionTags: connection.tags
                    });
                    return (
                        <li
                            key={connection.id}
                            className="grid grid-cols-[32px_minmax(0,1.2fr)_minmax(0,1.6fr)_auto] items-center gap-4 border-t border-border-muted px-4 py-3 first:border-t-0"
                        >
                            <IntegrationLogo provider={connection.provider} />
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-body-medium-semi text-text-strong">{name}</span>
                                <span className="truncate text-body-small-regular text-text-muted">{connection.provider_config_key}</span>
                            </div>
                            <div className="flex min-w-0 flex-col items-start gap-1">
                                <Badge variant={problem.tone}>{problem.label}</Badge>
                                <span className="text-body-small-regular text-text-muted">{problem.hint}</span>
                            </div>
                            <ButtonLink
                                to={`/${env}/connections/${encodeURIComponent(connection.provider_config_key)}/${encodeURIComponent(connection.connection_id)}`}
                                variant="outline"
                                size="sm"
                            >
                                Open
                            </ButtonLink>
                        </li>
                    );
                })}
            </ul>
            {withError > attention.length && !failing.isLoading && (
                <div>
                    <ButtonLink to={`/${env}/connections?status=error`} variant="ghost" size="sm">
                        See all {withError}
                    </ButtonLink>
                </div>
            )}
        </div>
    );
};
