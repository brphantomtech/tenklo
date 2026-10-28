import { randomUUID } from 'node:crypto';

import * as z from 'zod';

import { logContextGetter } from '@nangohq/logs';
import { configService, connectionService, getProvider } from '@nangohq/shared';
import { getLogger, requireEmptyQuery, zodErrorToHTTP } from '@nangohq/utils';

import { connectionEndUserTagsSchema, connectionIdSchema, providerConfigKeySchema } from '../../helpers/validation.js';
import { connectionCreated as connectionCreatedHook } from '../../hooks/hooks.js';
import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { GatewaySessionRejectedError, importGatewaySession, isWhatsAppGatewayEnabled, sendGatewayCommand, WHATSAPP_PROVIDER } from '../../whatsapp/gateway.js';
import { sendGatewayUnavailable } from './utils.js';

import type { PostPublicWhatsAppSessionImport, WhatsAppQrCredentials } from '@nangohq/types';

const logger = getLogger('WhatsApp.SessionImport');

const headersSchema = z.object({ 'provider-config-key': providerConfigKeySchema });
const bodySchema = z.strictObject({
    connection_id: connectionIdSchema.optional(),
    tags: connectionEndUserTagsSchema.optional(),
    objects: z
        .array(z.strictObject({ path: z.string().min(1).max(600), json: z.string().min(2) }))
        .min(1)
        .max(500_000)
});

/** The number of a paired device's JID: 5511999990000:12@s.whatsapp.net -> 5511999990000. */
export function phoneOfJid(jid: string): string | null {
    const user = jid.split('@')[0]?.split(':')[0] ?? '';
    return /^\d{8,15}$/.test(user) ? user : null;
}

/**
 * Creates a whatsapp-web connection from a session paired elsewhere: the gateway stores it under a new session id,
 * the connection points to it, and the gateway connects it. The number keeps working without a new QR code.
 */
export const postPublicWhatsAppSessionImport = asyncWrapperWithEnvironment<PostPublicWhatsAppSessionImport>(async (req, res) => {
    const emptyQuery = requireEmptyQuery(req);
    if (emptyQuery) {
        res.status(400).send({ error: { code: 'invalid_query_params', errors: zodErrorToHTTP(emptyQuery.error) } });
        return;
    }
    if (!isWhatsAppGatewayEnabled()) {
        res.status(503).send({ error: { code: 'whatsapp_gateway_unavailable', message: 'The WhatsApp gateway is not configured on this Tenklo instance' } });
        return;
    }

    const headers = headersSchema.safeParse(req.headers);
    if (!headers.success) {
        res.status(400).send({ error: { code: 'invalid_headers', errors: zodErrorToHTTP(headers.error) } });
        return;
    }
    const body = bodySchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).send({ error: { code: 'invalid_body', errors: zodErrorToHTTP(body.error) } });
        return;
    }

    const { account, environment } = res.locals;
    const providerConfigKey = headers.data['provider-config-key'];
    const connectionId = body.data.connection_id ?? randomUUID();

    const config = await configService.getProviderConfig(providerConfigKey, environment.id);
    const provider = config ? getProvider(config.provider) : null;
    if (!config || !provider) {
        res.status(404).send({ error: { code: 'unknown_provider_config', message: 'Unknown integration' } });
        return;
    }
    if (config.provider !== WHATSAPP_PROVIDER) {
        res.status(400).send({ error: { code: 'invalid_connection', message: `The integration is not a ${WHATSAPP_PROVIDER} integration` } });
        return;
    }

    const existing = await connectionService.getConnection(connectionId, providerConfigKey, environment.id);
    if (existing.response) {
        res.status(409).send({ error: { code: 'connection_exists', message: 'A connection with this id already exists' } });
        return;
    }

    const sessionId = randomUUID();
    const imported = await importGatewaySession({ tenantId: environment.uuid, sessionId, objects: body.data.objects });
    if (imported.isErr()) {
        if (imported.error instanceof GatewaySessionRejectedError) {
            res.status(400).send({ error: { code: 'invalid_session', message: imported.error.message } });
            return;
        }
        logger.error('failed to import a WhatsApp session into the gateway', imported.error);
        sendGatewayUnavailable(res);
        return;
    }

    const phone = phoneOfJid(imported.value.jid);
    const logCtx = await logContextGetter.create(
        { operation: { type: 'auth', action: 'create_connection' } },
        { account, environment, integration: config.id ? { id: config.id, name: config.unique_key, provider: config.provider } : undefined }
    );

    try {
        const credentials: WhatsAppQrCredentials = { type: 'WHATSAPP_QR', session_id: sessionId, phone, name: imported.value.name };
        const [created] = await connectionService.upsertAuthConnection({
            connectionId,
            providerConfigKey,
            credentials,
            connectionConfig: { session_id: sessionId, ...(phone ? { phone } : {}) },
            metadata: {},
            config,
            environment,
            tags: body.data.tags
        });
        if (!created) {
            throw new Error('failed to create the connection');
        }

        await logCtx.enrichOperation({ connectionId: created.connection.id, connectionName: created.connection.connection_id });
        void logCtx.info('WhatsApp session imported', { sessionId, objects: body.data.objects.length });
        await logCtx.success();

        void connectionCreatedHook(
            { connection: created.connection, environment, account, auth_mode: 'WHATSAPP_QR', operation: created.operation, endUser: undefined },
            account,
            config,
            logContextGetter,
            undefined
        );

        const connected = await sendGatewayCommand({ tenantId: environment.uuid, channelId: sessionId }, { type: 'channel.connect', payload: {} });
        if (connected.isErr()) {
            // The connection exists and the session is stored: the gateway also resumes it on its next start.
            logger.error(`failed to connect the imported WhatsApp session ${sessionId}`, connected.error);
        }

        res.status(201).send({ connection_id: connectionId, provider_config_key: providerConfigKey, session_id: sessionId, phone, name: imported.value.name });
    } catch (err) {
        void logCtx.error('Failed to create the connection of an imported WhatsApp session', { error: err, sessionId });
        await logCtx.failed();
        // Leaves no stored session behind without a connection.
        await sendGatewayCommand({ tenantId: environment.uuid, channelId: sessionId }, { type: 'channel.disconnect', payload: { clearSession: true } });
        throw err;
    }
});
