import { Link } from 'react-router-dom';

import { Badge, Button } from '@nangohq/design-system';

import { ButtonLink } from '@/components/ui/ButtonLink';
import { Skeleton } from '@/components/ui/Skeleton';
import { useConnections } from '@/hooks/useConnections';
import { useConnectionActivity } from '@/hooks/useLogs';
import { useStore } from '@/store';
import { describeConnectionProblem, problemLogUrl } from '@/utils/connectionProblems';
import { globalEnv } from '@/utils/env';
import { cn } from '@/utils/utils';
import { toActivityEntry } from '../activity';
import { useConnectionContext } from '../Show';

import type { ActivityTone } from '../activity';

const markClass: Record<ActivityTone, string> = {
    ok: 'bg-status-success-text',
    failed: 'bg-status-danger-text ring-4 ring-status-danger-bg',
    pending: 'bg-text-brand',
    neutral: 'bg-border-strong'
};

const formatAt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * The connection's state in a sentence, with where it gets fixed, then what happened to it lately, in
 * words and in order. The other tabs keep the details.
 */
export const ActivityTab: React.FC = () => {
    const env = useStore((state) => state.env);
    const { connectionData, providerConfigKey } = useConnectionContext();
    const connectionId = connectionData.connection.connection_id;

    // The list endpoint carries every error with its sync's name; the detail only has the credentials one.
    const listed = useConnections({ env, search: connectionId, integrationIds: [providerConfigKey] });
    const errors = listed.data?.pages[0]?.data.find((c) => c.connection_id === connectionId)?.errors ?? [];
    const problem = describeConnectionProblem(errors);

    return (
        <div className="flex flex-col gap-6 pt-6">
            {listed.isLoading ? (
                <Skeleton className="h-24 w-full" />
            ) : (
                <section
                    aria-label="Connection status"
                    className={cn(
                        'flex items-start justify-between gap-4 rounded-md border bg-surface-panel p-4',
                        problem ? 'border-border-muted border-l-2 border-l-status-danger-text' : 'border-border-muted'
                    )}
                >
                    {problem ? (
                        <>
                            <div className="flex flex-col items-start gap-1.5">
                                <Badge variant={problem.tone}>{problem.label}</Badge>
                                <p className="text-body-medium-regular text-text-strong">{problem.cause}</p>
                                <p className="text-body-small-medium text-text-muted">
                                    {problem.owner === 'customer' ? 'Only the customer can fix this, by reconnecting their account.' : 'You can fix this.'}
                                </p>
                            </div>
                            <ButtonLink to={problemLogUrl(env, problem)} variant={problem.owner === 'you' ? 'primary' : 'outline'} size="md">
                                View logs
                            </ButtonLink>
                        </>
                    ) : (
                        <div className="flex flex-col gap-1">
                            <h2 className="text-heading-sm text-text-strong">Everything is working</h2>
                            <p className="text-body-small-regular text-text-secondary">
                                Connected since {new Date(connectionData.connection.created_at).toLocaleDateString()}.
                            </p>
                        </div>
                    )}
                </section>
            )}

            <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
                <h2 id="timeline-title" className="text-heading-sm text-text-strong">
                    Recent activity
                </h2>
                {globalEnv.features.logs ? (
                    <Timeline env={env} integration={providerConfigKey} connectionId={connectionId} />
                ) : (
                    <p className="text-body-small-regular text-text-muted">Logs aren’t configured, so there’s no activity to show.</p>
                )}
            </section>
        </div>
    );
};

const Timeline: React.FC<{ env: string; integration: string; connectionId: string }> = ({ env, integration, connectionId }) => {
    const activity = useConnectionActivity(env, integration, connectionId);

    if (activity.isLoading) {
        return (
            <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                ))}
            </div>
        );
    }

    if (activity.error) {
        return (
            <div className="flex flex-col items-start gap-2">
                <p className="text-body-small-regular text-text-secondary">We couldn’t load this connection’s activity.</p>
                <Button variant="outline" size="sm" onClick={() => void activity.refetch()}>
                    Try again
                </Button>
            </div>
        );
    }

    const entries = (activity.data?.data ?? []).map(toActivityEntry);
    if (entries.length === 0) {
        return <p className="text-body-small-regular text-text-muted">Nothing has happened on this connection lately.</p>;
    }

    return (
        <ol aria-label="Recent activity" className="flex flex-col rounded-md border border-border-muted bg-surface-panel">
            {entries.map((entry) => (
                <li key={entry.id} className="border-t border-border-muted first:border-t-0">
                    <Link
                        to={`/${env}/logs?operationId=${encodeURIComponent(entry.id)}`}
                        className="grid grid-cols-[96px_16px_minmax(0,1fr)] items-start gap-2 px-4 py-2.5 hover:bg-state-hover focus-visible:outline-none focus-visible:shadow-focus-outline-default"
                    >
                        <time dateTime={entry.at} className="pt-0.5 font-code text-body-extra-small-medium text-text-muted">
                            {formatAt(entry.at)}
                        </time>
                        <span aria-hidden className={cn('mt-1.5 size-2 justify-self-center rounded-full', markClass[entry.tone])} />
                        <span className="flex min-w-0 flex-col">
                            <span className={cn('text-body-medium-medium', entry.tone === 'failed' ? 'text-status-danger-text' : 'text-text-strong')}>
                                {entry.title}
                            </span>
                            {entry.detail && <span className="truncate text-body-small-regular text-text-muted">{entry.detail}</span>}
                        </span>
                    </Link>
                </li>
            ))}
        </ol>
    );
};
