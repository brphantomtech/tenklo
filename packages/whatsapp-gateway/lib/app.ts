import db from '@nangohq/database';

import { CommandDispatcher } from './commands/dispatcher.js';
import { loadConfig } from './env.js';
import { HttpEventPublisher } from './events/publisher.js';
import { createCommandRouter } from './handlers/router.js';
import { createLogger, silenceSignalSessionDumps } from './logger.js';
import { migrate } from './postgres/migrate.js';
import { createServer } from './server.js';
import { Storage } from './storage/index.js';
import { S3Media } from './storage/media.js';
import { createRedis } from './storage/redis.js';
import { PostgresSessionObjects } from './storage/sessions.js';
import { ChannelRegistry } from './whatsapp/channel-registry.js';
import { SessionCipher } from './whatsapp/session-cipher.js';
import { importSession } from './whatsapp/session-import.js';
import { SessionManager } from './whatsapp/session-manager.js';

async function main(): Promise<void> {
    const config = loadConfig();
    const logger = createLogger(config.LOG_LEVEL);
    silenceSignalSessionDumps(logger);
    logger.info({ instanceId: config.INSTANCE_ID }, 'starting whatsapp-gateway');

    const migrated = await migrate({ knex: db.knex });
    if (migrated.isErr()) throw migrated.error;

    const redis = createRedis(config.REDIS_URL, logger);
    const storage = new Storage(new PostgresSessionObjects(db.knex), new S3Media(config));
    const events = new HttpEventPublisher(config.EVENTS_URL, config.SECRET, logger);
    const registry = new ChannelRegistry(redis);
    const cipher = new SessionCipher(config.SESSION_ENCRYPTION_KEY);
    const manager = new SessionManager({
        config,
        logger,
        redis,
        storage,
        cipher,
        events,
        registry
    });

    const router = createCommandRouter({ manager, registry, storage, redis, events, logger, mediaMaxBytes: config.MEDIA_MAX_BYTES });
    const dispatcher = new CommandDispatcher(router.handle, router.onInvalid, logger);

    // Resume before taking commands, so sends that arrive find their sessions already opening.
    manager.resumeAll();

    const isReady = async () => redis.status === 'ready' && (await db.knex.raw('SELECT 1').then(() => true));
    const server = createServer({
        dispatcher,
        media: storage,
        mediaMaxBytes: config.MEDIA_MAX_BYTES,
        sessions: { import: (input) => importSession({ storage, cipher, ...input }) },
        secret: config.SECRET,
        isReady,
        logger
    }).listen(config.PORT, () => {
        logger.info({ port: config.PORT }, 'whatsapp-gateway ready');
    });

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, 'shutting down');
        server.close();
        await dispatcher.stop();
        // Close without logging out: this instance (or the next one) resumes them without a new QR.
        await manager.shutdown();
        redis.disconnect();
        storage.destroy();
        await db.destroy();
        logger.info('stopped');
        process.exit(0);
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
    // Invalid configuration fails before the logger exists.
    console.error(err);
    process.exit(1);
});
