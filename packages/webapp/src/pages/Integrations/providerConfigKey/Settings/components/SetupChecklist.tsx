import { Check, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@nangohq/design-system';

import { ButtonLink } from '@/components/ui/ButtonLink';
import { CopyButton } from '@/components/ui/CopyButton';
import { defaultCallback } from '@/utils/cloud';
import { cn } from '@/utils/utils';

import type { ApiEnvironment, GetIntegration } from '@nangohq/types';

/** The settings each auth mode needs before customers can connect, in the order they're filled. Mirrors the server's `missing_fields` rules. */
const REQUIRED_FIELDS: Record<string, string[]> = {
    OAUTH1: ['oauth_client_id', 'oauth_client_secret'],
    OAUTH2: ['oauth_client_id', 'oauth_client_secret'],
    TBA: ['oauth_client_id', 'oauth_client_secret'],
    APP: ['app_link', 'oauth_client_id', 'oauth_client_secret'],
    CUSTOM: ['app_id', 'app_link', 'private_key', 'oauth_client_id', 'oauth_client_secret']
};

/** How each setting reads, and the settings field (its `htmlFor`) where it is filled. */
const FIELDS: Record<string, { label: string; anchor: string }> = {
    oauth_client_id: { label: 'Client ID', anchor: 'client_id' },
    oauth_client_secret: { label: 'Client secret', anchor: 'client_secret' },
    app_link: { label: 'App public link', anchor: 'app_link' },
    app_id: { label: 'App ID', anchor: 'app_id' },
    private_key: { label: 'App private key', anchor: 'private_key' }
};

export interface SetupStep {
    field: string;
    label: string;
    anchor: string | null;
    done: boolean;
}

/** The setup steps of an integration: what its auth mode requires, plus anything else the server reports missing. */
export function setupSteps(authMode: string, missingFields: string[]): SetupStep[] {
    const fields = [...(REQUIRED_FIELDS[authMode] ?? []), ...missingFields.filter((field) => !REQUIRED_FIELDS[authMode]?.includes(field))];
    return fields.map((field) => ({
        field,
        label: FIELDS[field]?.label ?? field,
        anchor: FIELDS[field]?.anchor ?? null,
        done: !missingFields.includes(field)
    }));
}

/** Brings a settings field into view and focuses its first control. */
function goToField(anchor: string) {
    const field = document.getElementById(`setting-${anchor}`);
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.querySelector<HTMLElement>('input, textarea, button')?.focus({ preventScroll: true });
}

/**
 * A step-by-step guide at the top of an integration's settings while it can't take connections yet:
 * what's left to fill, each step leading to its field, and a test connection once it's ready.
 */
export const SetupChecklist: React.FC<{ data: GetIntegration['Success']['data']; environment: ApiEnvironment }> = ({ data, environment }) => {
    const { integration, template } = data;
    const missing = integration.missing_fields;
    const displayName = integration.display_name || template.display_name;
    // Remembers that setup was under way, to say so once the last step is done instead of just vanishing.
    const wasIncomplete = useRef(missing.length > 0);
    const [justCompleted, setJustCompleted] = useState(false);

    useEffect(() => {
        if (missing.length > 0) {
            wasIncomplete.current = true;
        } else if (wasIncomplete.current) {
            setJustCompleted(true);
        }
    }, [missing.length]);

    if (integration.shared_credentials_id) {
        return null;
    }

    const testUrl = `/${environment.name}/connections/create?integration_id=${encodeURIComponent(integration.unique_key)}`;

    if (missing.length === 0) {
        if (!justCompleted) {
            return null;
        }
        return (
            <section
                aria-label="Integration setup"
                className="flex items-center justify-between gap-4 rounded-md border border-status-success-border bg-status-success-bg p-4"
            >
                <div className="flex flex-col gap-1">
                    <h2 className="text-heading-sm text-text-strong">{displayName} is ready</h2>
                    <p className="text-body-small-regular text-text-secondary">Customers can connect their accounts now. Try it first with your own.</p>
                </div>
                <ButtonLink to={testUrl} variant="primary" size="md">
                    Create a test connection
                </ButtonLink>
            </section>
        );
    }

    const steps = setupSteps(template.auth_mode, missing);
    const done = steps.filter((step) => step.done).length;
    const next = steps.find((step) => !step.done);
    const callbackUrl = environment.callback_url || defaultCallback();
    const needsCallback = ['OAUTH1', 'OAUTH2', 'TBA', 'CUSTOM'].includes(template.auth_mode);

    return (
        <section aria-label="Integration setup" className="flex flex-col rounded-md border border-border-muted bg-surface-panel">
            <div className="flex items-start justify-between gap-4 p-4">
                <div className="flex flex-col gap-1">
                    <h2 className="text-heading-sm text-text-strong">Finish setting up {displayName}</h2>
                    <p className="text-body-small-regular text-text-secondary">
                        {done} of {steps.length} done. Customers can connect once every step is.
                    </p>
                </div>
                {template.docs && (
                    <Button asChild variant="outline" size="sm">
                        <a href={template.docs} target="_blank" rel="noreferrer">
                            {displayName} setup guide <ExternalLink />
                        </a>
                    </Button>
                )}
            </div>
            <ol className="flex flex-col border-t border-border-muted">
                {needsCallback && (
                    <li className="flex flex-col gap-2 border-b border-border-muted px-4 py-3">
                        <span className="text-body-medium-medium text-text-strong">Add this callback URL to your {displayName} app</span>
                        <div className="flex items-center gap-2 rounded bg-surface-panel-inset px-3 py-1.5">
                            <code className="min-w-0 flex-1 truncate font-code text-body-small-regular text-text-secondary">{callbackUrl}</code>
                            <CopyButton text={callbackUrl} />
                        </div>
                    </li>
                )}
                {steps.map((step) => {
                    const isNext = step === next;
                    const { anchor } = step;
                    return (
                        <li
                            key={step.field}
                            className={cn(
                                'flex items-center justify-between gap-4 border-b border-border-muted px-4 py-3 last:border-b-0',
                                isNext && 'bg-surface-panel-inset'
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <span
                                    aria-hidden
                                    className={cn(
                                        'flex size-5 items-center justify-center rounded-full border',
                                        step.done ? 'border-transparent bg-status-success-text text-surface-panel' : 'border-border-strong'
                                    )}
                                >
                                    {step.done && <Check className="size-3" />}
                                </span>
                                <span className={cn('text-body-medium-medium', step.done ? 'text-text-muted' : 'text-text-strong')}>
                                    {step.done ? step.label : `Add the ${step.label.charAt(0).toLowerCase()}${step.label.slice(1)}`}
                                </span>
                            </div>
                            {!step.done && anchor && (
                                <Button variant={isNext ? 'primary' : 'outline'} size="sm" onClick={() => goToField(anchor)}>
                                    Fill in
                                </Button>
                            )}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
};
