/// <reference types="vite-plugin-svgr/client" />
import { QueryErrorResetBoundary, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, CircleAlert, LoaderCircle, Plug, Search } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useEffectOnce } from 'react-use';

import { ErrorFallback } from '@/components/ErrorFallback';
import { HeaderButtons } from '@/components/HeaderButtons';
import { IntegrationLogo } from '@/components/IntegrationLogo';
import { LoadingView } from '@/components/LoadingView';
import { Button } from '@/components/ui/button';
import { APIError, getIntegrations, getProvider } from '@/lib/api';
import { triggerClose } from '@/lib/events';
import { useI18n } from '@/lib/i18n';
import { useGlobal } from '@/lib/store';
import { telemetry } from '@/lib/telemetry';

import type { ApiPublicIntegration, GetPublicProvider } from '@nangohq/types';

/** Below this many integrations the whole list fits at a glance, so no search field. */
const SEARCH_THRESHOLD = 6;

export const IntegrationsList: React.FC = () => {
    return (
        <QueryErrorResetBoundary>
            {({ reset }) => (
                <ErrorBoundary fallbackRender={ErrorFallback} onReset={reset}>
                    <Suspense fallback={<LoadingView />}>
                        <Integrations />
                    </Suspense>
                </ErrorBoundary>
            )}
        </QueryErrorResetBoundary>
    );
};

const Integrations: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useI18n();
    const store = useGlobal();
    const { data } = useSuspenseQuery({ queryKey: ['integrations'], queryFn: getIntegrations });
    const [query, setQuery] = useState('');

    const isSingleIntegration = data.data.length === 1 && store.session?.allowed_integrations?.length === 1;
    useEffect(() => {
        async function call() {
            const integration = data.data[0];
            const provider = await getProvider({ provider: integration.provider });
            store.set(provider.data, integration);
            await navigate({ to: '/go' });
        }
        if (isSingleIntegration) {
            store.setIsSingleIntegration(true);
            void call();
        }
    }, [data, store.session]);

    useEffectOnce(() => {
        if (isSingleIntegration) {
            return;
        }
        telemetry('view:list');
    });

    const integrations = useMemo<ApiPublicIntegration[]>(() => {
        const list: ApiPublicIntegration[] = [];
        for (const integration of data.data) {
            list.push({
                ...integration,
                display_name: integration.display_name
            });
        }
        return list;
    }, [data]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return integrations;
        }
        return integrations.filter(
            (integration) =>
                (integration.display_name ?? '').toLowerCase().includes(needle) ||
                integration.provider.toLowerCase().includes(needle) ||
                integration.unique_key.toLowerCase().includes(needle)
        );
    }, [integrations, query]);

    if (data.data.length <= 0) {
        return (
            <>
                <HeaderButtons />
                <main className="flex flex-1 flex-col justify-center gap-8 py-6 animate-rise">
                    <div className="flex w-full flex-col items-center gap-3 text-center">
                        <div className="mb-2 grid size-16 place-items-center rounded-2xl border border-dashed border-hairline-hover text-text-tertiary">
                            <Plug aria-hidden="true" className="size-6" strokeWidth={1.5} />
                        </div>
                        <h1 className="text-title text-text-primary" id="connect-ui-title">
                            {t('integrationsList.noIntegrations')}
                        </h1>
                        <p className="max-w-[36ch] text-body text-text-secondary">{t('integrationsList.noIntegrationsDescription')}</p>
                    </div>

                    <Button className="w-full" size="lg" title={t('common.close')} variant="secondary" onClick={() => triggerClose('click:close')}>
                        {t('common.close')}
                    </Button>
                </main>
            </>
        );
    }

    if (isSingleIntegration) {
        return <LoadingView />;
    }

    const showSearch = integrations.length >= SEARCH_THRESHOLD;

    return (
        <>
            <HeaderButtons step={{ current: 1, total: 3 }} />
            <main className="flex flex-col gap-5 pt-5">
                <div className="flex flex-col gap-1.5">
                    <h1 className="text-title text-text-primary" id="connect-ui-title">
                        {t('integrationsList.title')}
                    </h1>
                    <p className="text-body text-text-secondary">{t('integrationsList.description')}</p>
                </div>

                {showSearch && (
                    <label className="field relative flex h-10 items-center gap-2 px-3">
                        <span className="sr-only">{t('integrationsList.searchPlaceholder')}</span>
                        <Search aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" strokeWidth={1.75} />
                        <input
                            autoComplete="off"
                            className="h-full w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary [&::-webkit-search-cancel-button]:hidden"
                            placeholder={t('integrationsList.searchPlaceholder')}
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </label>
                )}

                {filtered.length > 0 ? (
                    <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface shadow-card">
                        {filtered.map((integration, index) => (
                            <li key={integration.unique_key} className="animate-rise" style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
                                <Integration integration={integration} />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p
                        aria-live="polite"
                        className="rounded-xl border border-dashed border-hairline-strong px-4 py-8 text-center text-body-sm text-text-tertiary"
                    >
                        {t('integrationsList.noResults', { query: query.trim() })}
                    </p>
                )}
            </main>
        </>
    );
};

const Integration: React.FC<{ integration: ApiPublicIntegration }> = ({ integration }) => {
    const store = useGlobal();
    const navigate = useNavigate();
    const { t } = useI18n();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function triggerAuth() {
        setLoading(true);

        let provider: GetPublicProvider['Success'] | undefined;
        try {
            provider = await getProvider({ provider: integration.provider });
        } catch (err) {
            if (err instanceof APIError) {
                setError(() => {
                    // Trick to catch async error in the global state
                    throw err;
                });
                return;
            }
            setError(t('integrationsList.error'));
            setLoading(false);
            return;
        }

        telemetry('click:integration', { integration: integration.unique_key });
        store.set(provider.data, integration);
        setLoading(false);
        await navigate({ to: '/go' });
    }

    const onClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (loading) {
            return;
        }

        void triggerAuth();
    };

    const connectToLabel = t('integrationsList.connectTo', { provider: integration.provider });

    return (
        <button
            aria-busy={loading || undefined}
            aria-label={connectToLabel}
            className="group flex w-full cursor-pointer flex-col gap-3 px-3.5 py-3 text-left transition-colors hover:bg-ov-1 focus-inset"
            type="button"
            onClick={onClick}
        >
            <div className="flex w-full items-center gap-3.5">
                <IntegrationLogo name={integration.display_name} src={integration.logo} />
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium tracking-[-0.01em] text-text-primary">{integration.display_name}</span>
                {loading ? (
                    <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-text-tertiary" />
                ) : (
                    <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-text-tertiary transition-[translate,color] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-text-primary"
                        strokeWidth={1.75}
                    />
                )}
            </div>
            {error && (
                <div className="flex w-full items-center gap-2 rounded-lg border border-error-border bg-error-soft px-3 py-2 text-body-sm text-text-primary">
                    <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-error" strokeWidth={1.75} /> {error} Error obtaining the provider.
                </div>
            )}
        </button>
    );
};
