import { timingSafeEqual } from 'node:crypto';

import express from 'express';

import { ObjectNotFoundError } from './storage/index.js';

import type { CommandDispatcher } from './commands/dispatcher.js';
import type { Logger } from './logger.js';
import type { Storage } from './storage/index.js';
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
 * - GET /health/live and /health/ready.
 */
export function createServer({
    dispatcher,
    media,
    mediaMaxBytes,
    secret,
    isReady,
    logger
}: {
    dispatcher: Pick<CommandDispatcher, 'submit'>;
    media: Pick<Storage, 'openMedia' | 'putMedia'>;
    mediaMaxBytes: number;
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
