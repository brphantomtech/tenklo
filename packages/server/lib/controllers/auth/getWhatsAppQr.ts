import * as z from 'zod';

import db from '@nangohq/database';
import { logContextGetter } from '@nangohq/logs';
import {
    configService,
    ConnectionCreationCappedError,
    connectionService,
    errorManager,
    ErrorSourceEnum,
    getProvider,
    LogActionEnum,
    syncEndUserToConnection
} from '@nangohq/shared';
import { metrics, zodErrorToHTTP } from '@nangohq/utils';

import { connectionConfigParamsSchema, connectionCredential, providerConfigKeySchema } from '../../helpers/validation.js';
import { connectionCreated as connectionCreatedHook } from '../../hooks/hooks.js';
import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { resolveConnectionConfig, resolveOutboundWebhookUrlOverride } from '../../utils/auth.js';
import { sendGatewayCommand } from '../../whatsapp/gateway.js';
import { claimConnectionCreation, getPairing, releaseConnectionCreation, toPairingView, updatePairing } from '../../whatsapp/pairing.js';

import type { Pairing } from '../../whatsapp/pairing.js';
import type { GetPublicWhatsAppQrAuthorization, WhatsAppQrCredentials } from '@nangohq/types';
import type { NextFunction } from 'express';

const queryStringValidation = z
    .object({
        params: connectionConfigParamsSchema,
        user_scope: z.string().optional()
    })
    .and(connectionCredential);

const paramsValidation = z
    .object({
        providerConfigKey: providerConfigKeySchema,
        sessionId: z.uuid()
    })
    .strict();

/**
 * Polled by the Connect UI during a WhatsApp QR pairing: returns the current QR code, and creates the connection
 * once the gateway reports the number as connected.
 */
export const getPublicWhatsAppQrAuthorization = asyncWrapperWithEnvironment<GetPublicWhatsAppQrAuthorization>(async (req, res, next: NextFunction) => {
    const queryStringVal = queryStringValidation.safeParse(req.query);
    if (!queryStringVal.success) {
        res.status(400).send({ error: { code: 'invalid_query_params', errors: zodErrorToHTTP(queryStringVal.error) } });
        return;
    }

    const paramsVal = paramsValidation.safeParse(req.params);
    if (!paramsVal.success) {
        res.status(400).send({ error: { code: 'invalid_uri_params', errors: zodErrorToHTTP(paramsVal.error) } });
        return;
    }

    const { account, environment, connectSession } = res.locals;
    const { providerConfigKey, sessionId }: GetPublicWhatsAppQrAuthorization['Params'] = paramsVal.data;
    const isConnectSession = res.locals['authType'] === 'connectSession';

    const pairing = await getPairing(sessionId);
    if (!pairing || pairing.environmentId !== environment.id || pairing.providerConfigKey !== providerConfigKey) {
        res.status(404).send({ error: { code: 'unknown_whatsapp_pairing', message: 'Unknown or expired WhatsApp pairing' } });
        return;
    }

    const reply = (current: Pairing) => {
        res.status(200).send({ ...toPairingView(current), providerConfigKey, connectionId: current.connectionCreated ? current.connectionId : null });
    };

    if (pairing.status !== 'connected' || pairing.connectionCreated || !pairing.account) {
        reply(pairing);
        return;
    }

    // Connected but no connection yet: this poll creates it, unless a concurrent one already is.
    if (!(await claimConnectionCreation(sessionId))) {
        reply(pairing);
        return;
    }

    const logCtx = logContextGetter.get({ id: pairing.operationId, accountId: account.id });
    const connectionId = pairing.connectionId;

    try {
        const config = await configService.getProviderConfig(providerConfigKey, environment.id);
        const provider = config ? getProvider(config.provider) : null;
        if (!config || !provider) {
            void logCtx.error('Unknown provider config');
            await logCtx.failed();
            res.status(404).send({ error: { code: 'unknown_provider_config' } });
            return;
        }

        // A reconnect pairs a new session: the one it replaces is logged out once the connection points to the new one.
        const existing = await connectionService.getConnection(connectionId, providerConfigKey, environment.id);
        const replacedSessionId = existing.response?.connection_config['session_id'] as string | undefined;

        const credentials: WhatsAppQrCredentials = {
            type: 'WHATSAPP_QR',
            session_id: sessionId,
            phone: pairing.account.phone,
            name: pairing.account.name
        };
        const connectionConfig = {
            ...resolveConnectionConfig({ params: queryStringVal.data.params, connectSession, providerConfigKey }),
            session_id: sessionId,
            ...(pairing.account.phone ? { phone: pairing.account.phone } : {})
        };

        const [updatedConnection] = await connectionService.upsertAuthConnection({
            connectionId,
            providerConfigKey,
            credentials,
            connectionConfig,
            webhookUrlOverride: resolveOutboundWebhookUrlOverride({ connectSession }),
            metadata: {},
            config,
            environment,
            tags: connectSession?.tags
        });
        if (!updatedConnection) {
            void logCtx.error('Failed to create connection');
            await logCtx.failed();
            res.status(500).send({ error: { code: 'server_error', message: 'failed to create connection' } });
            return;
        }

        if (isConnectSession) {
            await syncEndUserToConnection(db.knex, { connectSession, connection: updatedConnection.connection, account, environment });
        }

        const updated = await updatePairing(sessionId, (p) => ({ ...p, connectionCreated: true }));

        if (replacedSessionId && replacedSessionId !== sessionId) {
            const loggedOut = await sendGatewayCommand(
                { tenantId: environment.uuid, channelId: replacedSessionId },
                { type: 'channel.disconnect', payload: { clearSession: true } }
            );
            if (loggedOut.isErr()) {
                void logCtx.warn('Failed to log out the replaced WhatsApp session', { error: loggedOut.error, sessionId: replacedSessionId });
            }
        }

        await logCtx.enrichOperation({ connectionId: updatedConnection.connection.id, connectionName: updatedConnection.connection.connection_id });
        void logCtx.info('WhatsApp connection creation was successful', { sessionId });
        await logCtx.success();

        req.audit = {
            ...req.audit,
            connectionUpsert: {
                operation: updatedConnection.operation,
                connectionId: updatedConnection.connection.connection_id,
                providerConfigKey: updatedConnection.connection.provider_config_key,
                account: { id: account.id, uuid: account.uuid },
                environment: { uuid: environment.uuid, name: environment.name },
                endUser: res.locals.endUser
            }
        };

        void connectionCreatedHook(
            {
                connection: updatedConnection.connection,
                environment,
                account,
                auth_mode: 'WHATSAPP_QR',
                operation: updatedConnection.operation,
                endUser: res.locals.endUser
            },
            account,
            config,
            logContextGetter,
            undefined
        );

        metrics.increment(metrics.Types.AUTH_SUCCESS, 1, { auth_mode: provider.auth_mode, provider: config.provider, providerConfigKey: config.unique_key });

        reply(updated ?? { ...pairing, connectionCreated: true });
    } catch (err) {
        await releaseConnectionCreation(sessionId);
        void logCtx.error('Error during WhatsApp connection creation', { error: err });

        errorManager.report(err, {
            source: ErrorSourceEnum.PLATFORM,
            operation: LogActionEnum.AUTH,
            environmentId: environment.id,
            metadata: { providerConfigKey, connectionId }
        });

        metrics.increment(metrics.Types.AUTH_FAILURE, 1, { auth_mode: 'WHATSAPP_QR' });

        if (err instanceof ConnectionCreationCappedError) {
            await logCtx.failed();
            res.status(err.status).send({ error: { code: 'resource_capped', message: err.message } });
            return;
        }
        next(err);
    }
});
