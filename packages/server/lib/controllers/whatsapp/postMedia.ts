import { randomUUID } from 'node:crypto';

import * as z from 'zod';

import { getLogger, zodErrorToHTTP } from '@nangohq/utils';

import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { outboundMediaKey, resolveConnectionFromHeaders } from '../../whatsapp/connections.js';
import { GatewayMediaTooLargeError, putGatewayMedia } from '../../whatsapp/gateway.js';
import { sendGatewayUnavailable, sendWhatsAppApiError } from './utils.js';

import type { PostPublicWhatsAppMedia } from '@nangohq/types';

const logger = getLogger('WhatsApp.Media');

const querySchema = z.strictObject({ file_name: z.string().min(1).max(255).optional() });

/**
 * Uploads a file to send from a whatsapp-web connection: the raw body, with its Content-Type. Answers the media
 * reference to put in a message's content.
 */
export const postPublicWhatsAppMedia = asyncWrapperWithEnvironment<PostPublicWhatsAppMedia>(async (req, res) => {
    const query = querySchema.safeParse(req.query);
    if (!query.success) {
        res.status(400).send({ error: { code: 'invalid_query_params', errors: zodErrorToHTTP(query.error) } });
        return;
    }

    const { account, environment } = res.locals;
    const resolved = await resolveConnectionFromHeaders({ headers: req.headers, account, environment });
    if (resolved.isErr()) {
        sendWhatsAppApiError(res, resolved.error);
        return;
    }

    const body: unknown = req.body;
    const mimeType = req.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!Buffer.isBuffer(body) || body.length === 0 || !mimeType || mimeType.length < 3) {
        res.status(400).send({ error: { code: 'invalid_body', message: 'Send the file as the raw request body, with its Content-Type' } });
        return;
    }

    const fileName = query.data.file_name;
    const objectKey = outboundMediaKey({ tenantId: environment.uuid, sessionId: resolved.value.sessionId, name: randomUUID() });
    const stored = await putGatewayMedia({ objectKey, body, contentType: mimeType });
    if (stored.isErr()) {
        if (stored.error instanceof GatewayMediaTooLargeError) {
            res.status(413).send({ error: { code: 'media_too_large', message: 'The file is larger than the WhatsApp gateway accepts' } });
            return;
        }
        logger.error('failed to store a WhatsApp media', stored.error);
        sendGatewayUnavailable(res);
        return;
    }

    res.status(201).send({ objectKey, mimeType, sizeBytes: body.length, ...(fileName ? { fileName } : {}) });
});
