import { timingSafeEqual } from 'node:crypto';

import express from 'express';

import type { CommandDispatcher } from './commands/dispatcher.js';
import type { Logger } from './logger.js';
import type { Express, NextFunction, Request, Response } from 'express';

/**
 * Internal API, reachable only by the Tenklo server.
 *
 * - POST /v1/commands: a command from the StackChat contract (channel.connect, channel.disconnect, groups.sync,
 *   message.send). Answers 202 once accepted; the outcome arrives as events.
 * - GET /health/live and /health/ready.
 */
export function createServer({
    dispatcher,
    secret,
    isReady,
    logger
}: {
    dispatcher: Pick<CommandDispatcher, 'submit'>;
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

    app.use((_req, res) => {
        res.status(404).json({ error: { code: 'not_found' } });
    });

    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        logger.error({ err }, 'unhandled error in the gateway API');
        res.status(500).json({ error: { code: 'server_error' } });
    });

    return app;
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
