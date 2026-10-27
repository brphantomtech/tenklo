import { randomUUID } from 'node:crypto';

import * as z from 'zod';

import { defaultOperationExpiration, endUserToMeta, logContextGetter } from '@nangohq/logs';
import { configService, connectionService, errorManager, ErrorSourceEnum, getProvider, LogActionEnum } from '@nangohq/shared';
import { zodErrorToHTTP } from '@nangohq/utils';

import { connectionConfigParamsSchema, connectionCredential, connectionIdSchema, providerConfigKeySchema } from '../../helpers/validation.js';
import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { errorRestrictConnectionId, isIntegrationAllowed } from '../../utils/auth.js';
import { hmacCheck } from '../../utils/hmac.js';
import { isWhatsAppGatewayEnabled, sendGatewayCommand } from '../../whatsapp/gateway.js';
import { savePairing, toPairingView } from '../../whatsapp/pairing.js';

import type { LogContext } from '@nangohq/logs';
import type { PostPublicWhatsAppQrAuthorization } from '@nangohq/types';
import type { NextFunction } from 'express';

const queryStringValidation = z
    .object({
        connection_id: connectionIdSchema.optional(),
        params: connectionConfigParamsSchema,
        user_scope: z.string().optional()
    })
    .and(connectionCredential);

const paramsValidation = z
    .object({
        providerConfigKey: providerConfigKeySchema
    })
    .strict();

/**
 * Starts a WhatsApp QR pairing: asks the gateway to open a new session, whose QR codes the Connect UI then polls
 * (GetPublicWhatsAppQrAuthorization). The connection itself is created once the QR is scanned.
 */
export const postPublicWhatsAppQrAuthorization = asyncWrapperWithEnvironment<PostPublicWhatsAppQrAuthorization>(async (req, res, next: NextFunction) => {
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
    const queryString: PostPublicWhatsAppQrAuthorization['Querystring'] = queryStringVal.data;
    const { providerConfigKey }: PostPublicWhatsAppQrAuthorization['Params'] = paramsVal.data;
    let connectionId = queryString.connection_id || connectionService.generateConnectionId();
    const hmac = 'hmac' in queryString ? queryString.hmac : undefined;
    const isConnectSession = res.locals['authType'] === 'connectSession';

    if (isConnectSession && queryString.connection_id) {
        errorRestrictConnectionId(res);
        return;
    }

    let logCtx: LogContext | undefined;

    try {
        logCtx =
            isConnectSession && connectSession.operationId
                ? logContextGetter.get({ id: connectSession.operationId, accountId: account.id })
                : await logContextGetter.create(
                      {
                          operation: { type: 'auth', action: 'create_connection' },
                          meta: { authType: 'whatsappQr', connectSession: endUserToMeta(res.locals.endUser) },
                          expiresAt: defaultOperationExpiration.auth()
                      },
                      { account, environment }
                  );

        if (!isConnectSession) {
            const checked = await hmacCheck({ environment, logCtx, providerConfigKey, connectionId, hmac, res });
            if (!checked) {
                return;
            }
        }

        const config = await configService.getProviderConfig(providerConfigKey, environment.id);
        if (!config) {
            void logCtx.error('Unknown provider config');
            await logCtx.failed();
            res.status(404).send({ error: { code: 'unknown_provider_config' } });
            return;
        }

        const provider = getProvider(config.provider);
        if (!provider) {
            void logCtx.error('Unknown provider');
            await logCtx.failed();
            res.status(404).send({ error: { code: 'unknown_provider_template' } });
            return;
        }

        if (provider.auth_mode !== 'WHATSAPP_QR') {
            void logCtx.error('Provider does not support WHATSAPP_QR auth', { provider: config.provider });
            await logCtx.failed();
            res.status(400).send({ error: { code: 'invalid_auth_mode' } });
            return;
        }

        if (!(await isIntegrationAllowed({ config, res, logCtx }))) {
            return;
        }

        if (!isWhatsAppGatewayEnabled()) {
            void logCtx.error('The WhatsApp gateway is not configured on this instance');
            await logCtx.failed();
            res.status(503).send({ error: { code: 'whatsapp_gateway_unavailable', message: 'The WhatsApp gateway is not configured' } });
            return;
        }

        // Reconnect mechanism
        if (isConnectSession && connectSession.connectionId) {
            const connection = await connectionService.getConnectionById(connectSession.connectionId);
            if (!connection) {
                void logCtx.error('Invalid connection');
                await logCtx.failed();
                res.status(400).send({ error: { code: 'invalid_connection' } });
                return;
            }
            connectionId = connection.connection_id;
        }

        await logCtx.enrichOperation({ integrationId: config.id!, integrationName: config.unique_key, providerName: config.provider });

        // Every pairing gets a new session: a reconnect replaces the old one once the new QR is scanned.
        const sessionId = randomUUID();
        const sent = await sendGatewayCommand({ tenantId: environment.uuid, channelId: sessionId }, { type: 'channel.connect', payload: {} });
        if (sent.isErr()) {
            void logCtx.error('Failed to reach the WhatsApp gateway', { error: sent.error });
            await logCtx.failed();
            res.status(503).send({ error: { code: 'whatsapp_gateway_unavailable', message: 'The WhatsApp gateway did not accept the request' } });
            return;
        }

        const pairing = {
            sessionId,
            accountId: account.id,
            environmentId: environment.id,
            tenantId: environment.uuid,
            providerConfigKey,
            connectionId,
            operationId: logCtx.id,
            status: 'starting' as const,
            qr: null,
            qrExpiresAt: null,
            error: null,
            account: null,
            connectionCreated: false
        };
        await savePairing(pairing);
        void logCtx.info('WhatsApp pairing started, waiting for the QR code to be scanned', { sessionId });

        res.status(200).send(toPairingView(pairing));
    } catch (err) {
        if (logCtx) {
            void logCtx.error('Error while starting the WhatsApp pairing', { error: err });
            await logCtx.failed();
        }

        errorManager.report(err, {
            source: ErrorSourceEnum.PLATFORM,
            operation: LogActionEnum.AUTH,
            environmentId: environment.id,
            metadata: { providerConfigKey, connectionId }
        });

        next(err);
    }
});
