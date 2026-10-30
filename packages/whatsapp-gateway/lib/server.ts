import { timingSafeEqual } from 'node:crypto';

import express from 'express';

import { ObjectNotFoundError } from './storage/index.js';
import { SessionImportError } from './whatsapp/session-import.js';

import type { CommandDispatcher } from './commands/dispatcher.js';
import type { Logger } from './logger.js';
import type { Storage } from './storage/index.js';
import type { ImportedObject, importSession } from './whatsapp/session-import.js';
import type { Express, NextFunction, Request, Response } from 'express';

/** Where the gateway keeps media: tenants/<tenantId>/<inbox|media>/<channelId>/<name>. The server picks the key. */
export const MEDIA_KEY = /^tenants\/[0-9a-f-]{36}\/(inbox|media)\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/;

/**
 * Internal API, reachable only by the Tenklo server.
 *
 * - POST /v1/commands: a command from the StackChat contract (channel.connect, channel.disconnect, groups.sync,
 *   message.send). Answers 202 once accepted; the outcome arrives as events.
 * - PUT /v1/media?key=: stores a file in the media bucket (the body, with its content-type).
 * - GET /v1/media?key=: streams a file from the media bucket.
 * - POST /v1/media/usage: bytes of media each channel keeps ({ channels: [{ tenantId, channelId }] }), for metering.
 * - PUT /v1/sessions/:tenantId/:channelId: imports a Baileys session paired elsewhere ({ objects: [{ path, json }] }).
 *   Answers 201 with the paired account; the server then connects the channel.
 * - GET /health/live and /health/ready.
 */
export function createServer({
    dispatcher,
    media,
    mediaMaxBytes,
    sessions,
    secret,
    isReady,
    logger
}: {
    dispatcher: Pick<CommandDispatcher, 'submit'>;
    media: Pick<Storage, 'openMedia' | 'putMedia' | 'mediaUsage'>;
    mediaMaxBytes: number;
    sessions: { import: (input: { tenantId: string; channelId: string; objects: ImportedObject[] }) => ReturnType<typeof importSession> };
    secret: string;
    isReady: () => Promise<boolean>;
    logger: Logger;
}): Express {
    const app = express();
    app.disable('x-powered-by');

    app.get('/health/live', (_req, res) => {
        res.status(200).send('Healthy');
    });

    app.get('/health/ready', async (_req, res) => {
        const ready = await isReady().catch(() => false);
        res.status(ready ? 200 : 503).send(ready ? 'Healthy' : 'Unhealthy');
    });

    app.post('/v1/commands', requireSecret(secret), express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
        const result = await dispatcher.submit(req.body);
        if (!result.accepted) {
            res.status(400).json({ error: { code: 'invalid_command', message: result.error } });
            return;
        }
        res.status(202).json({ commandId: result.commandId });
    });

    app.put('/v1/media', requireSecret(secret), express.raw({ type: () => true, limit: mediaMaxBytes }), async (req: Request, res: Response) => {
        const key = mediaKey(req);
        if (!key) {
            res.status(400).json({ error: { code: 'invalid_key' } });
            return;
        }
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (body.length === 0) {
            res.status(400).json({ error: { code: 'empty_body' } });
            return;
        }
        await media.putMedia(key, body, req.header('content-type') || 'application/octet-stream');
        res.status(201).json({ objectKey: key, sizeBytes: body.length });
    });

    app.post('/v1/media/usage', requireSecret(secret), express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
        const channels = parseChannels(req.body);
        if (!channels) {
            res.status(400).json({
                error: { code: 'invalid_channels', message: `expected { channels: [{ tenantId, channelId }] }, at most ${MAX_USAGE_CHANNELS}` }
            });
            return;
        }
        const usage = await Promise.all(channels.map(async (c) => ({ ...c, bytes: await media.mediaUsage(c.tenantId, c.channelId) })));
        res.status(200).json({ channels: usage });
    });

    app.get('/v1/media', requireSecret(secret), async (req: Request, res: Response) => {
        const key = mediaKey(req);
        if (!key) {
            res.status(400).json({ error: { code: 'invalid_key' } });
            return;
        }
        try {
            const object = await media.openMedia(key);
            res.status(200).setHeader('content-type', object.contentType || 'application/octet-stream');
            if (object.contentLength !== undefined) {
                res.setHeader('content-length', String(object.contentLength));
            }
            object.stream.on('error', (err) => {
                logger.warn({ err }, 'media stream failed');
                res.destroy(err);
            });
            object.stream.pipe(res);
        } catch (err) {
            if (err instanceof ObjectNotFoundError) {
                res.status(404).json({ error: { code: 'not_found' } });
                return;
            }
            throw err;
        }
    });

    app.put(
        '/v1/sessions/:tenantId/:channelId',
        requireSecret(secret),
        express.json({ limit: SESSION_IMPORT_MAX_BYTES }),
        async (req: Request, res: Response) => {
            const tenantId = req.params['tenantId'];
            const channelId = req.params['channelId'];
            if (!tenantId || !channelId || !UUID.test(tenantId) || !UUID.test(channelId)) {
                res.status(400).json({ error: { code: 'invalid_channel' } });
                return;
            }
            const objects = parseImportedObjects(req.body);
            if (!objects) {
                res.status(400).json({ error: { code: 'invalid_session', message: 'expected { objects: [{ path, json }] }' } });
                return;
            }
            try {
                const imported = await sessions.import({ tenantId, channelId, objects });
                logger.info({ tenantId, channelId, objects: imported.objects }, 'sessão importada');
                res.status(201).json(imported);
            } catch (err) {
                if (err instanceof SessionImportError) {
                    res.status(err.code === 'session_exists' ? 409 : 400).json({ error: { code: err.code, message: err.message } });
                    return;
                }
                throw err;
            }
        }
    );

    app.use((_req, res) => {
        res.status(404).json({ error: { code: 'not_found' } });
    });

    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (isTooLarge(err)) {
            res.status(413).json({ error: { code: 'media_too_large', maxBytes: mediaMaxBytes } });
            return;
        }
        logger.error({ err }, 'unhandled error in the gateway API');
        res.status(500).json({ error: { code: 'server_error' } });
    });

    return app;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A session grows with every contact it messaged: a few MB for a busy number. */
const SESSION_IMPORT_MAX_BYTES = 64 * 1024 * 1024;

function parseImportedObjects(body: unknown): ImportedObject[] | null {
    const objects = (body as { objects?: unknown } | null)?.objects;
    if (!Array.isArray(objects) || objects.length === 0) return null;
    const valid = objects.every(
        (o: unknown) => typeof o === 'object' && o !== null && typeof (o as ImportedObject).path === 'string' && typeof (o as ImportedObject).json === 'string'
    );
    return valid ? (objects as ImportedObject[]).map(({ path, json }) => ({ path, json })) : null;
}

const MAX_USAGE_CHANNELS = 500;
const CHANNEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseChannels(body: unknown): { tenantId: string; channelId: string }[] | null {
    const channels = (body as { channels?: unknown } | null)?.channels;
    if (!Array.isArray(channels) || channels.length > MAX_USAGE_CHANNELS) return null;
    const valid = channels.every((c: unknown) => {
        const { tenantId, channelId } = (c ?? {}) as { tenantId?: unknown; channelId?: unknown };
        return typeof tenantId === 'string' && CHANNEL_UUID.test(tenantId) && typeof channelId === 'string' && CHANNEL_UUID.test(channelId);
    });
    return valid ? (channels as { tenantId: string; channelId: string }[]).map(({ tenantId, channelId }) => ({ tenantId, channelId })) : null;
}

function mediaKey(req: Request): string | null {
    const key = req.query['key'];
    return typeof key === 'string' && MEDIA_KEY.test(key) ? key : null;
}

function isTooLarge(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.too.large';
}

function requireSecret(secret: string) {
    const expected = Buffer.from(`Bearer ${secret}`);
    return (req: Request, res: Response, next: NextFunction) => {
        const received = Buffer.from(req.header('authorization') ?? '');
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
            res.status(401).json({ error: { code: 'unauthorized' } });
            return;
        }
        next();
    };
}
