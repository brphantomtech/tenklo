import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate } from '@tanstack/react-router';
import { AppWindow, Check, ChevronDown, Copy, ExternalLink, Info, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMount } from 'react-use';
import * as z from 'zod';

import { AuthError } from '@nangohq/frontend';

import { ConnectionRail } from '@/components/ConnectionRail';
import { CustomInput, StandaloneInput } from '@/components/CustomInput';
import { CustomSelect } from '@/components/CustomSelect';
import { HeaderButtons } from '@/components/HeaderButtons';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { WhatsAppQr } from '@/components/WhatsAppQr';
import { triggerClose, triggerConnection, triggerError } from '@/lib/events';
import { useI18n } from '@/lib/i18n';
import { useNango } from '@/lib/nango';
import { useGlobal } from '@/lib/store';
import { telemetry } from '@/lib/telemetry';
import { cn, compactErrorDisplay, getAllowedCallbackOrigin, jsonSchemaToZod } from '@/lib/utils';

import type { RailState } from '@/components/ConnectionRail';
import type { AuthResult } from '@nangohq/frontend';
import type { AuthModeType, SimplifiedJSONSchema } from '@nangohq/types';
import type { InputHTMLAttributes } from 'react';
import type { Resolver } from 'react-hook-form';

const generateExternalId = (): string => crypto.randomUUID();

const formSchema: Record<AuthModeType, z.ZodObject> = {
    API_KEY: z.object({
        apiKey: z.string().min(1)
    }),
    BASIC: z.object({
        username: z.string().min(1),
        password: z.string().min(1)
    }),
    APP: z.object({}),
    NONE: z.object({}),
    OAUTH1: z.object({}),
    OAUTH2: z.object({}),
    OAUTH2_CC: z.object({
        client_id: z.string().min(1),
        client_secret: z.string().min(1),
        client_certificate: z.string().min(1).optional(),
        client_private_key: z.string().min(1).optional()
    }),
    JWT: z.object({
        // JWT is custom every time
    }),
    TWO_STEP: z.object({
        // TWO_STEP is custom every time
    }),
    TBA: z.object({
        oauth_client_id_override: z.string().min(1),
        oauth_client_secret_override: z.string().min(1),
        token_id: z.string().min(1),
        token_secret: z.string().min(1)
    }),
    BILL: z.object({
        username: z.string().min(1),
        password: z.string().min(1),
        organization_id: z.string().min(1),
        dev_key: z.string().min(1)
    }),
    SIGNATURE: z.object({
        username: z.string().min(1),
        password: z.string().min(1)
    }),
    AWS_SIGV4: z.object({
        role_arn: z.string().min(1)
    }),
    CUSTOM: z.object({}),
    MCP_OAUTH2: z.object({}),
    MCP_OAUTH2_GENERIC: z.object({}),
    INSTALL_PLUGIN: z.object({}),
    // The QR pairing has no form: see WhatsAppQr
    WHATSAPP_QR: z.object({})
};

const defaultConfiguration: Record<string, { secret: boolean; title: string; example: string }> = {
    'credentials.apiKey': { secret: true, title: 'API Key', example: 'Your API Key' },
    'credentials.username': { secret: false, title: 'User Name', example: 'Your user name' },
    'credentials.password': { secret: true, title: 'Password', example: 'Your password' },
    'credentials.pat_name': { secret: false, title: 'Personal App Token', example: 'Your PAT' },
    'credentials.pat_secret': { secret: true, title: 'Personal App Token Secret', example: 'Your PAT Secret' },
    'credentials.content_url': { secret: true, title: 'Content URL', example: 'Your content URL' },
    'credentials.client_id': { secret: false, title: 'Client ID', example: 'Your Client ID' },
    'credentials.client_secret': { secret: true, title: 'Client Secret', example: 'Your Client Secret' },
    'credentials.client_certificate': { secret: true, title: 'Client Certificate', example: 'Your Client Certificate' },
    'credentials.client_private_key': { secret: true, title: 'Private Key', example: 'Your Private Key' },
    'credentials.oauth_client_id_override': { secret: false, title: 'OAuth Client ID', example: 'Your OAuth Client ID' },
    'credentials.oauth_client_secret_override': { secret: true, title: 'OAuth Client Secret', example: 'Your OAuth Client Secret' },
    'credentials.oauth_refresh_token_override': { secret: true, title: 'Refresh Token', example: 'Your Refresh Token' },
    'credentials.token_id': { secret: true, title: 'Token ID', example: 'Your Token ID' },
    'credentials.token_secret': { secret: true, title: 'Token Secret', example: 'Token Secret' },
    'credentials.organization_id': { secret: false, title: 'Organization ID', example: 'Your Organization ID' },
    'credentials.dev_key': { secret: true, title: 'Developer Key', example: 'Your Developer Key' },
    'credentials.role_arn': { secret: false, title: 'IAM Role ARN', example: 'arn:aws:iam::123456789012:role/NangoAccessRole' },
    'credentials.issuerId': { secret: false, title: 'Issuer ID', example: 'Your Issuer ID' },
    'credentials.privateKeyId': { secret: false, title: 'Key ID', example: 'Your Key ID' },
    'credentials.privateKey': { secret: true, title: 'Private Key', example: 'Your Private Key' }
};

export const Go: React.FC = () => {
    const { isPreview, provider, integration, session, isSingleIntegration, detectClosedAuthWindow, setIsDirty, isAuthLink } = useGlobal();
    const nango = useNango();
    const { t } = useI18n();

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<AuthResult>();
    const [error, setError] = useState<string | null>(null);
    const [connectionFailed, setConnectionFailed] = useState(false);
    const [showErrorDetails, setShowErrorDetails] = useState(false);

    const integrationConfigFallbackFields = useMemo<Record<string, SimplifiedJSONSchema>>(() => {
        if (!provider || provider.auth_mode !== 'TWO_STEP') {
            return {};
        }
        return Object.fromEntries(
            Object.entries(provider.integration_config ?? {})
                .filter(([name]) => !(provider.credentials && name in provider.credentials))
                .map(([name, schema]) => [name, { ...schema, optional: false }])
        );
    }, [provider]);

    const preconfiguredParams = session && integration ? session.integrations_config_defaults?.[integration.unique_key]?.connection_config || {} : {};
    const initialExternalId = useMemo(() => {
        const value = preconfiguredParams['external_id'] as string | undefined;
        return value && value.length > 0 ? value : generateExternalId();
    }, [preconfiguredParams]);
    const [awsExternalId] = useState(initialExternalId);
    const [externalIdCopied, setExternalIdCopied] = useState(false);
    const externalIdCopyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const displayName = useMemo(() => {
        return integration?.display_name ?? provider?.display_name ?? '';
    }, [integration, provider]);

    const [docsConnectUrl, urlOverride] = useMemo(() => {
        if (!integration?.unique_key) return [null, false];
        const override = session?.overrides?.[integration?.unique_key]?.docs_connect;
        if (override) return [override, true];
        return [provider?.docs_connect, false];
    }, [provider, integration, session]);
    useMount(() => {
        if (integration) {
            telemetry('view:integration', { integration: integration.unique_key });
        }
        // on unmount always clear popup and state
        return () => {
            nango?.clear();
            if (externalIdCopyTimeout.current) {
                clearTimeout(externalIdCopyTimeout.current);
            }
        };
    });
    const handleCopyExternalId = useCallback(() => {
        if (!awsExternalId) {
            return;
        }
        const onSuccess = () => {
            setExternalIdCopied(true);
            if (externalIdCopyTimeout.current) {
                clearTimeout(externalIdCopyTimeout.current);
            }
            externalIdCopyTimeout.current = setTimeout(() => setExternalIdCopied(false), 2000);
        };
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard
                .writeText(awsExternalId)
                .then(onSuccess)
                .catch((err: unknown) => {
                    console.error('Failed to copy to clipboard:', err);
                });
        } else {
            // Fallback for iframes or older browsers where Clipboard API is unavailable
            const textarea = document.createElement('textarea');
            textarea.value = awsExternalId;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                onSuccess();
            } catch (err) {
                console.error('Fallback copy failed:', err);
            }
            document.body.removeChild(textarea);
        }
    }, [awsExternalId]);

    const { resolver, shouldAutoTrigger, orderedFields } = useMemo<{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolver: Resolver<any>;
        shouldAutoTrigger: boolean;
        orderedFields: [string, number][];
    }>(() => {
        if (!provider) {
            return { shouldAutoTrigger: false, resolver: () => ({ values: {}, errors: {} }), orderedFields: [] };
        }

        const baseForm = formSchema[provider.auth_mode];
        const credentialsShape: Record<string, z.ZodType> = { ...baseForm.shape };

        // To order fields we use incremented int starting high because we don't know yet which fields will be sorted
        // It's a lazy algorithm that works most of the time
        const orderedFields: Record<string, number> = {};
        let hiddenFields = 0;
        let order = 99;

        // Base credentials are usually the first in the list so we start here
        for (const name of Object.keys(credentialsShape)) {
            if ((name === 'client_certificate' || name === 'client_private_key') && provider.require_client_certificate !== true) {
                continue;
            }
            if (name === 'client_secret' && provider.token_request_auth_method === 'private_key_jwt') {
                credentialsShape['client_secret'] = z.string().optional();
                continue;
            }
            order += 1;
            orderedFields[`credentials.${name}`] = order;
        }

        // Modify base form with credentials specific
        for (const [name, schema] of Object.entries({ ...provider.credentials, ...integrationConfigFallbackFields })) {
            if (schema.automated) {
                continue;
            }

            // Already set at the integration level (integration_config) — don't ask the end user for it.
            if (integration?.preconfigured_credentials?.includes(name)) {
                continue;
            }

            credentialsShape[name] = jsonSchemaToZod(schema);

            // In case the field only exists in provider.yaml (TWO_STEP)
            const fullName = `credentials.${name}`;
            if (!orderedFields[fullName]) {
                order += 1;
                orderedFields[fullName] = order;
            }
            if (schema.hidden) {
                hiddenFields += 1;
            }
        }

        // Append connectionConfig object
        const additionalFields: Record<string, z.ZodType> = {};
        for (const [name, schema] of Object.entries(provider.connection_config || [])) {
            if (schema.automated) {
                continue;
            }

            if (integration?.preconfigured_connection_config?.includes(name)) {
                continue;
            }

            additionalFields[name] = jsonSchemaToZod(schema);

            if (schema.order) {
                // If there is an order prop, it will goes before credentials
                orderedFields[`params.${name}`] = schema.order;
            } else {
                // Otherwise it's after
                order += 1;
                orderedFields[`params.${name}`] = order;
            }
            const isPreconfigured = typeof preconfiguredParams[name] !== 'undefined';
            if (isPreconfigured || schema.hidden) {
                hiddenFields += 1;
            }
        }

        const assertionOptionFields: Record<string, z.ZodType> = {};
        for (const [name, schema] of Object.entries(provider.assertion_option || [])) {
            assertionOptionFields[name] = jsonSchemaToZod(schema);

            const fullName = `assertion_option.${name}`;
            if (!orderedFields[fullName]) {
                order += 1;
                orderedFields[fullName] = order;
            }
            if (schema.hidden) {
                hiddenFields += 1;
            }
        }

        if (provider.auth_mode === 'OAUTH2' && Object.keys(preconfiguredParams).length > 0) {
            // For OAUTH2, allow users to override client credentials if preconfigured with empty values
            const allowedOverrides = ['oauth_client_id_override', 'oauth_client_secret_override', 'oauth_refresh_token_override'];
            for (const key of allowedOverrides) {
                if (key in preconfiguredParams && !additionalFields[key] && !(key in credentialsShape)) {
                    credentialsShape[key] = z.string().optional();
                    order += 1;
                    orderedFields[`credentials.${key}`] = order;
                }
            }
        }

        // Only add objects if they have something otherwise it breaks react-form
        const fields = z.object({
            ...(Object.keys(credentialsShape).length > 0 ? { credentials: z.object(credentialsShape) } : {}),
            ...(Object.keys(additionalFields).length > 0 ? { params: z.object(additionalFields) } : {}),
            ...(Object.keys(assertionOptionFields).length > 0 ? { assertion_option: z.object(assertionOptionFields) } : {})
        });

        const fieldCount =
            (fields.shape.credentials ? Object.keys(fields.shape.credentials.shape).length : 0) +
            (fields.shape.params ? Object.keys(fields.shape.params?.shape).length : 0) +
            (fields.shape.assertion_option ? Object.keys(fields.shape.assertion_option.shape).length : 0);
        const resolver = zodResolver(fields);
        return {
            shouldAutoTrigger: fieldCount - hiddenFields <= 0,
            resolver,
            orderedFields: Object.entries(orderedFields).sort((a, b) => (a[1] < b[1] ? -1 : 1))
        };
    }, [provider, integration, preconfiguredParams, integrationConfigFallbackFields]);

    const form = useForm<z.infer<(typeof formSchema)['API_KEY']>>({
        resolver: resolver,
        mode: 'onChange',
        reValidateMode: 'onChange'
    });
    const isDirty = Object.keys(form.formState.dirtyFields).length;

    useEffect(() => {
        if (isDirty) {
            setIsDirty(true);
        }
    }, [isDirty, setIsDirty]);
    useEffect(() => {
        if (result) {
            telemetry('view:success');
            setIsDirty(false);
        }
    }, [result, setIsDirty]);
    useEffect(() => {
        if (connectionFailed) {
            telemetry('view:credentials_error');
        }
    }, [connectionFailed]);

    const apiURL = useGlobal((state) => state.apiURL);
    const allowedCallbackOrigin = useMemo(() => getAllowedCallbackOrigin(apiURL), [apiURL]);

    useEffect(() => {
        const sendAck = (evt: MessageEvent) => {
            try {
                if (evt.source && evt.source !== window && typeof (evt.source as Window).postMessage === 'function') {
                    (evt.source as Window).postMessage({ type: 'nango_oauth_callback_ack' }, evt.origin);
                }
            } catch {
                // ignore
            }
        };
        const isAllowedSource = (evt: MessageEvent) => {
            // only messages from the nango callback window  are accepted;
            if (!evt.origin || evt.source === window) return false;
            if (!allowedCallbackOrigin || evt.origin !== allowedCallbackOrigin) return false;
            return true;
        };
        const handleOAuthCallbackError = (evt: MessageEvent) => {
            if (evt.data?.type !== 'nango_oauth_callback_error' || !evt.data?.payload) return;
            if (!isAllowedSource(evt)) return;
            const { message } = evt.data.payload as { message: string; errorType?: string };
            const fallback = t('go.authorizationFailed');
            const displayMessage = message || fallback;
            setLoading(false);
            setConnectionFailed(true);
            setError(displayMessage);
            triggerError('connection_validation_failed', displayMessage);
            sendAck(evt);
        };
        const handleOAuthCallbackSuccess = (evt: MessageEvent) => {
            if (evt.data?.type !== 'nango_oauth_callback_success') return;
            if (!isAllowedSource(evt)) return;
            sendAck(evt);
        };
        window.addEventListener('message', handleOAuthCallbackError);
        window.addEventListener('message', handleOAuthCallbackSuccess);
        return () => {
            window.removeEventListener('message', handleOAuthCallbackError);
            window.removeEventListener('message', handleOAuthCallbackSuccess);
        };
    }, [t, allowedCallbackOrigin]);

    const onSubmit = useCallback(
        async (v: Record<string, unknown>) => {
            if (isPreview || !integration || loading || !provider || !nango) {
                return;
            }

            const values = v as { credentials: Record<string, string>; params: Record<string, string>; assertion_option?: Record<string, string> };

            telemetry('click:connect');
            setLoading(true);
            setError(null);
            // we don't care if it was already opened
            nango.clear();

            try {
                let res: AuthResult;
                // Legacy stuff because types were mixed together inappropriately
                if (provider.auth_mode === 'NONE') {
                    res = await nango.create(integration.unique_key, { ...values });
                } else if (
                    (provider.auth_mode === 'OAUTH2' && !provider.installation) ||
                    provider.auth_mode === 'OAUTH1' ||
                    provider.auth_mode === 'CUSTOM' ||
                    provider.auth_mode === 'APP' ||
                    provider.auth_mode === 'MCP_OAUTH2' ||
                    provider.auth_mode === 'MCP_OAUTH2_GENERIC' ||
                    provider.auth_mode === 'INSTALL_PLUGIN'
                ) {
                    res = await nango.auth(integration.unique_key, {
                        ...values,
                        detectClosedAuthWindow
                    });
                } else {
                    const params = { ...values['params'] };
                    if (provider.auth_mode === 'AWS_SIGV4') {
                        params['external_id'] = awsExternalId;
                    }
                    res = await nango.auth(integration.unique_key, {
                        params,
                        credentials: { ...values['credentials'], type: provider.auth_mode } as Record<string, string>,
                        detectClosedAuthWindow,
                        ...(provider.installation && { installation: provider.installation }),
                        assertionOption: values['assertion_option'] || {}
                    });
                }
                setResult(res);
                triggerConnection(res);
            } catch (err) {
                if (err instanceof AuthError) {
                    if (err.type === 'blocked_by_browser') {
                        telemetry('popup:blocked_by_browser');
                        const errorMsg = t('go.popupBlocked');
                        setError(errorMsg);
                        triggerError(err.type, errorMsg);
                        return;
                    } else if (err.type === 'window_closed') {
                        telemetry('popup:closed_early');
                        const errorMsg = t('go.popupClosed');
                        setError(errorMsg);
                        triggerError(err.type, errorMsg);
                        return;
                    } else if (err.type === 'connection_test_failed') {
                        setConnectionFailed(true);
                        const errorMsg = t('go.invalidCredentials', { provider: displayName });
                        setError(errorMsg);
                        triggerError(err.type, errorMsg);
                        return;
                    } else if (err.type === 'connection_validation_failed') {
                        setConnectionFailed(true);
                        const errorMsg = err.message || t('go.invalidCredentials', { provider: displayName });
                        setError(errorMsg);
                        triggerError(err.type, errorMsg);
                        return;
                    } else if (err.type === 'resource_capped') {
                        setConnectionFailed(true);
                        const errorMsg = t('go.resourceCapped');
                        setError(errorMsg);
                        triggerError(err.type, errorMsg);
                        return;
                    }
                }

                setConnectionFailed(true);
                const errorMsg = err instanceof Error ? err.message : 'Unknown error';
                setError(errorMsg);
                triggerError(err instanceof AuthError ? err.type : 'unknown_error', errorMsg);
            } finally {
                setLoading(false);
            }
        },
        [provider, integration, loading, nango, t, detectClosedAuthWindow, displayName, awsExternalId]
    );

    if (!provider || !integration) {
        // typescript pleasing or if we enter the URL directly
        return <Navigate to="/" />;
    }

    // The flow is list → authorize → done; a single-integration session skips the list.
    const step = isSingleIntegration ? { current: 1, total: 2 } : { current: 2, total: 3 };
    const doneStep = { current: step.total, total: step.total };

    const hero = ({ title, state, description, as: Heading = 'h1' }: { title: string; state: RailState; description?: string; as?: 'h1' | 'h2' }) => (
        <div className="flex flex-col items-center gap-5 text-center animate-rise">
            <ConnectionRail logo={integration.logo} name={integration.display_name} state={state} />
            <div className="flex flex-col gap-1.5">
                <Heading className="text-title text-text-primary" id="connect-ui-title">
                    {title}
                </Heading>
                {description && <p className="mx-auto max-w-[38ch] text-body text-text-secondary">{description}</p>}
            </div>
        </div>
    );

    const docsFooter = docsConnectUrl && (
        <footer className="pt-6 text-center text-body-sm text-text-tertiary">
            {t('common.needHelp')}{' '}
            <Link
                className="inline-flex items-center gap-1 rounded-sm font-medium text-text-primary underline decoration-hairline-hover underline-offset-4 transition-colors hover:decoration-current focus-default"
                target="_blank"
                to={docsConnectUrl}
                onClick={() => telemetry('click:doc')}
            >
                {t('common.viewGuide')}
                <ExternalLink aria-hidden="true" className="size-3.5 text-text-tertiary" strokeWidth={1.75} />
            </Link>
        </footer>
    );

    if (result) {
        return (
            <>
                <HeaderButtons isAuthLink={isAuthLink} step={doneStep} />
                <main className="flex flex-1 flex-col justify-center gap-8 py-6">
                    {hero({
                        title: t('go.success'),
                        state: 'connected',
                        as: 'h2',
                        description: `${t('go.successMessage', { provider: provider.display_name })}${isAuthLink ? ` ${t('go.closeTab')}` : ''}`
                    })}
                    {!isAuthLink && (
                        <Button className="w-full" loading={loading} size={'lg'} onClick={() => triggerClose('click:finish')}>
                            {t('common.finish')}
                        </Button>
                    )}
                </main>
            </>
        );
    }

    if (connectionFailed) {
        return (
            <div className="flex flex-1 flex-col">
                <HeaderButtons isAuthLink={isAuthLink} step={step} />
                <main className="flex flex-1 flex-col justify-center gap-6 py-6">
                    {hero({ title: t('go.connectionFailed'), state: 'failed', as: 'h2', description: t('go.connectionErrorGeneric') })}

                    {error && (
                        <div className="w-full overflow-hidden rounded-xl border border-hairline bg-elevated">
                            <button
                                aria-controls="error-details-panel"
                                aria-expanded={showErrorDetails}
                                className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-body-sm font-medium text-text-primary transition-colors hover:bg-ov-1 focus-inset"
                                type="button"
                                onClick={() => setShowErrorDetails((v) => !v)}
                            >
                                <span>{showErrorDetails ? t('go.hideErrorDetails') : t('go.showErrorDetails')}</span>
                                <ChevronDown
                                    aria-hidden="true"
                                    className={cn('size-4 shrink-0 text-text-tertiary transition-transform duration-200', showErrorDetails && 'rotate-180')}
                                    strokeWidth={1.75}
                                />
                            </button>
                            {showErrorDetails && (
                                <div className="border-t border-hairline px-4 py-3" id="error-details-panel">
                                    <pre className="overflow-x-hidden font-mono text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-text-secondary">
                                        {compactErrorDisplay(error)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}

                    <Button
                        className="w-full"
                        loading={loading}
                        size={'lg'}
                        onClick={() => {
                            setConnectionFailed(false);
                            setError(null);
                            setShowErrorDetails(false);
                        }}
                    >
                        {t('common.back')}
                    </Button>
                </main>
                {docsFooter}
            </div>
        );
    }

    if (provider.auth_mode === 'WHATSAPP_QR') {
        return (
            <div className="flex flex-1 flex-col">
                <HeaderButtons backLink={!isSingleIntegration ? '/integrations' : undefined} isAuthLink={isAuthLink} step={step} />
                <main className="flex flex-1 flex-col justify-center gap-5 py-3">
                    {hero({ title: t('go.linkAccount', { provider: displayName }), state: 'idle' })}
                    <WhatsAppQr
                        isPreview={isPreview}
                        nango={nango}
                        providerConfigKey={integration.unique_key}
                        onError={(type, message) => {
                            setConnectionFailed(true);
                            setError(message);
                            triggerError(type, message);
                        }}
                        onSuccess={(res) => {
                            setResult(res);
                            triggerConnection(res);
                        }}
                    />
                </main>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col">
            <HeaderButtons
                backLink={!isSingleIntegration ? '/integrations' : undefined}
                isAuthLink={isAuthLink}
                step={step}
                onClickBack={() => {
                    setIsDirty(false);
                }}
            />
            <main className="flex flex-1 flex-col justify-center gap-7 py-6">
                {hero({ title: t('go.linkAccount', { provider: displayName }), state: loading ? 'connecting' : 'idle' })}

                {/* Only on first connect: the customer puts this in their IAM trust policy. On reconnect the
                    stored external_id is reused server-side, so we hide it to avoid showing a fresh, misleading value. */}
                {provider.auth_mode === 'AWS_SIGV4' && awsExternalId && !session?.isReconnecting && (
                    <div className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-elevated p-4">
                        <p className="text-body-sm text-text-secondary">Use this External ID when configuring your IAM trust policy.</p>
                        <div className="flex items-center gap-2">
                            <StandaloneInput readOnly className="font-mono text-xs" value={awsExternalId} />
                            <Button className="w-20 shrink-0" type="button" variant="secondary" onClick={handleCopyExternalId}>
                                {externalIdCopied ? (
                                    <Check aria-hidden="true" className="size-4 text-primary" strokeWidth={2} />
                                ) : (
                                    <Copy aria-hidden="true" className="size-4" strokeWidth={1.75} />
                                )}
                                {externalIdCopied ? 'Copied' : 'Copy'}
                            </Button>
                        </div>
                    </div>
                )}

                {error && (
                    <p
                        aria-live="assertive"
                        className="flex gap-2.5 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-3 text-body-sm text-warning-fg"
                        role="alert"
                    >
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                        {compactErrorDisplay(error)}
                    </p>
                )}

                {!error && shouldAutoTrigger && !form.formState.isValid && (
                    <p
                        aria-live="assertive"
                        className="flex gap-2.5 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-3 text-body-sm text-warning-fg"
                        role="alert"
                    >
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                        {t('go.invalidPreconfigured')}
                    </p>
                )}

                <Form {...form}>
                    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(onSubmit)}>
                        {orderedFields.length > 0 && (
                            <div className={cn('flex flex-col gap-5 empty:hidden')}>
                                {orderedFields.map(([name]) => {
                                    const [type, key] = name.split('.') as ['credentials' | 'params' | 'assertion_option', string];

                                    const definition =
                                        type === 'credentials'
                                            ? (provider.credentials?.[key] ?? integrationConfigFallbackFields[key])
                                            : provider[type === 'params' ? 'connection_config' : 'assertion_option']?.[key];
                                    // Not all fields have a definition in providers.yaml so we fallback to default
                                    const base = name in defaultConfiguration ? defaultConfiguration[name] : undefined;
                                    const labelOverride = type === 'credentials' ? integration?.credentials_label?.[key] : undefined;
                                    const source = type === 'credentials' ? {} : preconfiguredParams;
                                    const isPreconfigured = typeof source[key] !== 'undefined';
                                    const isOptional = definition && 'optional' in definition && definition.optional === true;
                                    const label = labelOverride || definition?.title || base?.title;

                                    return (
                                        <FormField
                                            key={name}
                                            control={form.control}
                                            defaultValue={
                                                isPreconfigured
                                                    ? source[key]
                                                    : (definition?.default_value ??
                                                      (definition?.hidden ? undefined : definition?.enum && !isOptional ? definition.enum[0] : ''))
                                            }
                                            // disabled={Boolean(definition?.hidden)} DO NOT disable it breaks the form
                                            name={name}
                                            render={({ field }) => {
                                                return (
                                                    <FormItem
                                                        className={cn(
                                                            (isPreconfigured &&
                                                                (provider.auth_mode !== 'OAUTH2' ||
                                                                    source[key] !== '' ||
                                                                    ![
                                                                        'oauth_client_id_override',
                                                                        'oauth_client_secret_override',
                                                                        'oauth_refresh_token_override'
                                                                    ].includes(key))) ||
                                                                definition?.hidden ||
                                                                definition?.automated
                                                                ? 'hidden'
                                                                : null
                                                        )}
                                                    >
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-1.5">
                                                                <FormLabel className="text-body-sm font-medium text-text-primary">
                                                                    {label} {!isOptional && <span className="text-error">*</span>}
                                                                </FormLabel>
                                                                {isOptional && (
                                                                    <span className="rounded-full bg-ov-2 px-1.5 py-px text-[11px] font-medium text-text-tertiary">
                                                                        optional
                                                                    </span>
                                                                )}
                                                                {docsConnectUrl && (
                                                                    <Link
                                                                        aria-label={t('go.fieldDocumentation', {
                                                                            field: label || key
                                                                        })}
                                                                        className="grid size-5 place-items-center rounded-md text-text-tertiary transition-colors hover:text-text-primary focus-default"
                                                                        target="_blank"
                                                                        to={`${docsConnectUrl}${urlOverride ? '' : `${definition?.doc_section}`}`}
                                                                        onClick={() => telemetry('click:doc_section')}
                                                                    >
                                                                        <Info aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                                                                    </Link>
                                                                )}
                                                            </div>
                                                            {!labelOverride && definition?.description && (
                                                                <FormDescription>{definition.description}</FormDescription>
                                                            )}
                                                        </div>
                                                        <FormControl>
                                                            {definition?.enum && definition.enum.length > 0 ? (
                                                                <CustomSelect
                                                                    aria-required={!isOptional}
                                                                    name={field.name}
                                                                    optional={isOptional}
                                                                    options={definition.enum}
                                                                    placeholder={definition.title}
                                                                    value={field.value as string | undefined}
                                                                    onChange={field.onChange}
                                                                />
                                                            ) : (
                                                                <CustomInput
                                                                    aria-required={!isOptional}
                                                                    fieldLabel={label}
                                                                    placeholder={labelOverride ? '' : definition?.example || definition?.title || base?.example}
                                                                    prefix={definition?.prefix}
                                                                    suffix={definition?.suffix}
                                                                    {...(field as InputHTMLAttributes<HTMLInputElement>)}
                                                                    autoComplete="off"
                                                                    type={definition?.secret || base?.secret ? 'password' : 'text'}
                                                                />
                                                            )}
                                                        </FormControl>
                                                        <FormMessage className="p-0" />
                                                    </FormItem>
                                                );
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        )}

                        {shouldAutoTrigger && (
                            <div className="flex gap-3 rounded-xl border border-hairline bg-elevated p-4 text-body-sm text-text-secondary">
                                <AppWindow aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-tertiary" strokeWidth={1.75} />
                                <p>
                                    {t('go.willConnect', { provider: displayName })}
                                    {provider.auth_mode === 'OAUTH2' && ` ${t('go.popupWarning')}`}
                                </p>
                            </div>
                        )}

                        <Button
                            className="w-full"
                            disabled={!form.formState.isValid || Object.keys(form.formState.errors).length > 0}
                            loading={loading}
                            size="lg"
                            type="submit"
                        >
                            {error ? t('common.tryAgain') : loading ? t('common.connecting') : t('go.connect')}
                        </Button>
                    </form>
                </Form>
            </main>
            {docsFooter}
        </div>
    );
};
