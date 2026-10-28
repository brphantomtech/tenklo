import { hostname } from 'node:os';

import { z } from 'zod';

const int = (def: number) => z.coerce.number().int().nonnegative().default(def);
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const schema = z.object({
    LOG_LEVEL: logLevel.default('info'),
    TELEGRAM_GATEWAY_INSTANCE_ID: z.string().min(1).default(hostname()),
    TELEGRAM_GATEWAY_PORT: int(3011),

    // Shared with the server: it authenticates the server's commands and the gateway's events, and seals the bot
    // tokens the server sends in channel.connect (sealedBotToken).
    TELEGRAM_GATEWAY_SECRET: z.string().min(32),
    // Where events are delivered, e.g. http://tenklo-server:3003/internal/telegram/events
    TELEGRAM_GATEWAY_EVENTS_URL: z.url(),

    NANGO_REDIS_URL: z.url(),

    // Media bucket: outbound media is read from it by object key, inbound media is written to it.
    TELEGRAM_S3_ENDPOINT: z.url(),
    TELEGRAM_S3_REGION: z.string().min(1).default('us-east-1'),
    TELEGRAM_S3_ACCESS_KEY: z.string().min(1),
    TELEGRAM_S3_SECRET_KEY: z.string().min(1),
    TELEGRAM_S3_BUCKET: z.string().min(1),

    // Bot API server. Only changed for a local Bot API server (telegram-bot-api) or in tests.
    TELEGRAM_API_ROOT: z
        .url()
        .default('https://api.telegram.org')
        .transform((v) => v.replace(/\/+$/, '')),

    // Send pace of each bot. Telegram limits: ~30 messages/s overall, 1/s per chat, 20/min per group.
    TELEGRAM_SEND_MIN_INTERVAL_MS: int(50),
    TELEGRAM_PER_CHAT_INTERVAL_MS: int(1_000),
    TELEGRAM_PER_GROUP_INTERVAL_MS: int(3_000),
    // The Bot API refuses uploads above 50 MB (photos: 10 MB).
    TELEGRAM_MEDIA_MAX_BYTES: int(50 * 1024 * 1024),
    // Larger inbound media is not downloaded: the message is still published, with media null.
    TELEGRAM_INBOUND_MEDIA_MAX_BYTES: int(20 * 1024 * 1024)
});

export interface Config {
    LOG_LEVEL: z.infer<typeof logLevel>;
    INSTANCE_ID: string;
    PORT: number;
    SECRET: string;
    EVENTS_URL: string;
    REDIS_URL: string;
    S3_ENDPOINT: string;
    S3_REGION: string;
    S3_ACCESS_KEY: string;
    S3_SECRET_KEY: string;
    S3_BUCKET_MEDIA: string;
    TELEGRAM_API_ROOT: string;
    SEND_MIN_INTERVAL_MS: number;
    PER_CHAT_INTERVAL_MS: number;
    PER_GROUP_INTERVAL_MS: number;
    MEDIA_MAX_BYTES: number;
    INBOUND_MEDIA_MAX_BYTES: number;
}

/** Missing or invalid configuration stops the process at startup, never in the middle of a send. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const result = schema.safeParse(env);
    if (!result.success) {
        const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid configuration:\n${issues}`);
    }
    const e = result.data;
    return {
        LOG_LEVEL: e.LOG_LEVEL,
        INSTANCE_ID: e.TELEGRAM_GATEWAY_INSTANCE_ID,
        PORT: e.TELEGRAM_GATEWAY_PORT,
        SECRET: e.TELEGRAM_GATEWAY_SECRET,
        EVENTS_URL: e.TELEGRAM_GATEWAY_EVENTS_URL,
        REDIS_URL: e.NANGO_REDIS_URL,
        S3_ENDPOINT: e.TELEGRAM_S3_ENDPOINT,
        S3_REGION: e.TELEGRAM_S3_REGION,
        S3_ACCESS_KEY: e.TELEGRAM_S3_ACCESS_KEY,
        S3_SECRET_KEY: e.TELEGRAM_S3_SECRET_KEY,
        S3_BUCKET_MEDIA: e.TELEGRAM_S3_BUCKET,
        TELEGRAM_API_ROOT: e.TELEGRAM_API_ROOT,
        SEND_MIN_INTERVAL_MS: e.TELEGRAM_SEND_MIN_INTERVAL_MS,
        PER_CHAT_INTERVAL_MS: e.TELEGRAM_PER_CHAT_INTERVAL_MS,
        PER_GROUP_INTERVAL_MS: e.TELEGRAM_PER_GROUP_INTERVAL_MS,
        MEDIA_MAX_BYTES: e.TELEGRAM_MEDIA_MAX_BYTES,
        INBOUND_MEDIA_MAX_BYTES: e.TELEGRAM_INBOUND_MEDIA_MAX_BYTES
    };
}
