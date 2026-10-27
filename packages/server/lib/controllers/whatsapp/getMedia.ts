import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import * as z from 'zod';

import { getLogger, zodErrorToHTTP } from '@nangohq/utils';

import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { belongsToSession, resolveConnectionFromHeaders } from '../../whatsapp/connections.js';
import { openGatewayMedia } from '../../whatsapp/gateway.js';
import { sendGatewayUnavailable, sendWhatsAppApiError } from './utils.js';

import type { GetPublicWhatsAppMedia } from '@nangohq/types';
import type { ReadableStream } from 'node:stream/web';

const logger = getLogger('WhatsApp.Media');

const querySchema = z.strictObject({ object_key: z.string().min(1).max(512) });

/** Downloads a file of a whatsapp-web connection: one it received (message.received media) or one uploaded for it. */
export const getPublicWhatsAppMedia = asyncWrapperWithEnvironment<GetPublicWhatsAppMedia>(async (req, res) => {
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

    const objectKey = query.data.object_key;
    const notFound = () => res.status(404).send({ error: { code: 'unknown_media', message: 'Unknown media' } });
    if (!belongsToSession(objectKey, { tenantId: environment.uuid, sessionId: resolved.value.sessionId })) {
        notFound();
        return;
    }

    const opened = await openGatewayMedia(objectKey);
    if (opened.isErr()) {
        logger.error('failed to read a WhatsApp media', opened.error);
        sendGatewayUnavailable(res);
        return;
    }
    const file = opened.value;
    if (!file?.body) {
        notFound();
        return;
    }

    res.status(200);
    res.setHeader('content-type', file.headers.get('content-type') ?? 'application/octet-stream');
    const length = file.headers.get('content-length');
    if (length) {
        res.setHeader('content-length', length);
    }
    try {
        await pipeline(Readable.fromWeb(file.body as ReadableStream<Uint8Array>), res);
    } catch (err) {
        logger.warning('WhatsApp media download interrupted', err);
        res.destroy();
    }
});
