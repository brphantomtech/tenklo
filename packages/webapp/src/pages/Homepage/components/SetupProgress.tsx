import { ButtonLink } from '@/components/ui/ButtonLink';
import { useListIntegrations } from '@/hooks/useIntegration';

/**
 * How many of the environment's integrations are ready to connect, and a way into the next one that
 * still misses settings (credentials, scopes...). Hidden when every integration is ready.
 */
export const SetupProgress: React.FC<{ env: string }> = ({ env }) => {
    const { data } = useListIntegrations(env);
    const integrations = data?.data ?? [];
    const incomplete = integrations.filter((integration) => integration.meta.missingFieldsCount > 0);

    if (incomplete.length === 0) {
        return null;
    }

    const ready = integrations.length - incomplete.length;
    const next = incomplete[0]!;

    return (
        <section aria-label="Integration setup" className="flex flex-col gap-3 rounded-md border border-border-muted bg-surface-panel p-4">
            <h2 className="text-heading-sm text-text-strong">Finish setting up integrations</h2>
            <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={integrations.length}
                aria-valuenow={ready}
                aria-label="Integrations ready"
                className="h-1.5 overflow-hidden rounded-full bg-surface-panel-inset"
            >
                <div className="h-full rounded-full bg-interactive-primary" style={{ width: `${(ready / integrations.length) * 100}%` }} />
            </div>
            <p className="text-body-small-regular text-text-secondary">
                {ready} of {integrations.length} ready. {incomplete.length === 1 ? '1 still needs' : `${incomplete.length} still need`} credentials or settings
                before customers can connect.
            </p>
            <div>
                <ButtonLink to={`/${env}/integrations/${encodeURIComponent(next.unique_key)}/settings`} variant="primary" size="sm">
                    Continue with {next.meta.displayName}
                </ButtonLink>
            </div>
        </section>
    );
};
