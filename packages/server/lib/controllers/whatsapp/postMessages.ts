import { randomUUID } from 'node:crypto';

import * as z from 'zod';

import { pubsub } from '@nangohq/shared';
import { getLogger, requireEmptyQuery, zodErrorToHTTP } from '@nangohq/utils';

import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { belongsToSession, resolveConnectionFromHeaders } from '../../whatsapp/connections.js';
import { GatewayInvalidCommandError, sendGatewayCommand } from '../../whatsapp/gateway.js';
import { sendGatewayUnavailable, sendWhatsAppApiError } from './utils.js';

import type { PostPublicWhatsAppMessage } from '@nangohq/types';

const logger = getLogger('WhatsApp.Messages');

// The contract's message.send limits, checked here so the caller gets a 400 with the field instead of a gateway error.
const recipientSchema = z.strictObject({ kind: z.enum(['contact', 'group']), externalId: z.string().min(1).max(128) });
const mediaSchema = z.strictObject({
    objectKey: z.string().min(1).max(512),
    mimeType: z.string().min(3).max(255),
    fileName: z.string().min(1).max(255).optional(),
    sizeBytes: z.number().int().positive().optional()
});
const contentSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(65536) }),
    z.strictObject({ kind: z.enum(['image', 'video', 'audio', 'document']), media: mediaSchema, caption: z.string().max(1024).optional() })
]);
const bodySchema = z.strictObject({
    messageId: z.uuid().optional(),
    to: recipientSchema,
    content: contentSchema
});

/** Sends a message from a whatsapp-web connection. The outcome arrives in message.status webhooks. */
export const postPublicWhatsAppMessage = asyncWrapperWithEnvironment<PostPublicWhatsAppMessage>(async (req, res) => {
    const emptyQuery = requireEmptyQuery(req);
    if (emptyQuery) {
        res.status(400).send({ error: { code: 'invalid_query_params', errors: zodErrorToHTTP(emptyQuery.error) } });
        return;
    }

    const { account, environment } = res.locals;
    const resolved = await resolveConnectionFromHeaders({ headers: req.headers, account, environment });
    if (resolved.isErr()) {
        sendWhatsAppApiError(res, resolved.error);
        return;
    }

    const val = bodySchema.safeParse(req.body);
    if (!val.success) {
        res.status(400).send({ error: { code: 'invalid_body', errors: zodErrorToHTTP(val.error) } });
        return;
    }
    const { to, content } = val.data;
    const messageId = val.data.messageId ?? randomUUID();

    const target = { tenantId: environment.uuid, sessionId: resolved.value.sessionId };
    if (content.kind !== 'text' && !belongsToSession(content.media.objectKey, target)) {
        res.status(404).send({ error: { code: 'unknown_media', message: 'Unknown media: upload it with POST /whatsapp/media for this connection' } });
        return;
    }

    const sent = await sendGatewayCommand(
        { tenantId: environment.uuid, channelId: resolved.value.sessionId, gateway: resolved.value.gateway },
        { type: 'message.send', payload: { messageId, to, content } }
    );
    if (sent.isErr()) {
        if (sent.error instanceof GatewayInvalidCommandError) {
            res.status(400).send({ error: { code: 'invalid_body', message: sent.error.message } });
            return;
        }
        logger.error('failed to hand a WhatsApp message to the gateway', sent.error);
        sendGatewayUnavailable(res);
        return;
    }

    void pubsub.publisher.publish({
        subject: 'usage',
        type: 'usage.channel_messages',
        payload: {
            value: 1,
            properties: {
                accountId: account.id,
                environmentId: environment.id,
                environmentName: environment.name,
                integrationId: resolved.value.config.unique_key,
                connectionId: resolved.value.connection.connection_id,
                provider: resolved.value.config.provider
            }
        }
    });

    res.status(202).send({ messageId, commandId: sent.value.commandId });
});
