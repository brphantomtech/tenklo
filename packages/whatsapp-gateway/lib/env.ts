import { hostname } from 'node:os';

import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const int = (def: number) => z.coerce.number().int().nonnegative().default(def);
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const schema = z
    .object({
        LOG_LEVEL: logLevel.default('info'),
        // Baileys is very chatty, so it gets its own level.
        WHATSAPP_GATEWAY_BAILEYS_LOG_LEVEL: logLevel.default('warn'),
        WHATSAPP_GATEWAY_INSTANCE_ID: z.string().min(1).default(hostname()),
        WHATSAPP_GATEWAY_PORT: int(3010),

        // Shared with the server: it signs the server's commands and the gateway's events.
        WHATSAPP_GATEWAY_SECRET: z.string().min(32),
        // Where events are delivered, e.g. http://tenklo-server:3003/internal/whatsapp/events
        WHATSAPP_GATEWAY_EVENTS_URL: z.url(),

        NANGO_REDIS_URL: z.url(),

        // Sessions are encrypted at rest. Changing the key invalidates every session (new QR for every number).
        WHATSAPP_SESSION_ENCRYPTION_KEY: z.string().min(32),

        // Media bucket: outbound media is read from it by object key, inbound media is written to it.
        WHATSAPP_S3_ENDPOINT: z.url(),
        WHATSAPP_S3_REGION: z.string().min(1).default('us-east-1'),
        WHATSAPP_S3_ACCESS_KEY: z.string().min(1),
        WHATSAPP_S3_SECRET_KEY: z.string().min(1),
        WHATSAPP_S3_BUCKET: z.string().min(1),

        // Random delay between two sends of the same number. Steady rhythm and bursts are the main automation signal.
        WHATSAPP_SEND_DELAY_MIN_MS: int(4_000),
        WHATSAPP_SEND_DELAY_MAX_MS: int(10_000),
        // "typing..." before messages to contacts.
        WHATSAPP_SEND_TYPING: bool.default(true),
        WHATSAPP_MEDIA_MAX_BYTES: int(100 * 1024 * 1024),
        // Larger inbound media is not downloaded: the message is still published, with media null.
        WHATSAPP_INBOUND_MEDIA_MAX_BYTES: int(64 * 1024 * 1024)
    })
    .refine((c) => c.WHATSAPP_SEND_DELAY_MIN_MS <= c.WHATSAPP_SEND_DELAY_MAX_MS, {
        message: 'WHATSAPP_SEND_DELAY_MIN_MS must be lower than or equal to WHATSAPP_SEND_DELAY_MAX_MS',
        path: ['WHATSAPP_SEND_DELAY_MIN_MS']
    });

export interface Config {
    LOG_LEVEL: z.infer<typeof logLevel>;
    BAILEYS_LOG_LEVEL: z.infer<typeof logLevel>;
    INSTANCE_ID: string;
    PORT: number;
    SECRET: string;
    EVENTS_URL: string;
    REDIS_URL: string;
    SESSION_ENCRYPTION_KEY: string;
    S3_ENDPOINT: string;
    S3_REGION: string;
    S3_ACCESS_KEY: string;
    S3_SECRET_KEY: string;
    S3_BUCKET_MEDIA: string;
    SEND_DELAY_MIN_MS: number;
    SEND_DELAY_MAX_MS: number;
    SEND_TYPING: boolean;
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
        BAILEYS_LOG_LEVEL: e.WHATSAPP_GATEWAY_BAILEYS_LOG_LEVEL,
        INSTANCE_ID: e.WHATSAPP_GATEWAY_INSTANCE_ID,
        PORT: e.WHATSAPP_GATEWAY_PORT,
        SECRET: e.WHATSAPP_GATEWAY_SECRET,
        EVENTS_URL: e.WHATSAPP_GATEWAY_EVENTS_URL,
        REDIS_URL: e.NANGO_REDIS_URL,
        SESSION_ENCRYPTION_KEY: e.WHATSAPP_SESSION_ENCRYPTION_KEY,
        S3_ENDPOINT: e.WHATSAPP_S3_ENDPOINT,
        S3_REGION: e.WHATSAPP_S3_REGION,
        S3_ACCESS_KEY: e.WHATSAPP_S3_ACCESS_KEY,
        S3_SECRET_KEY: e.WHATSAPP_S3_SECRET_KEY,
        S3_BUCKET_MEDIA: e.WHATSAPP_S3_BUCKET,
        SEND_DELAY_MIN_MS: e.WHATSAPP_SEND_DELAY_MIN_MS,
        SEND_DELAY_MAX_MS: e.WHATSAPP_SEND_DELAY_MAX_MS,
        SEND_TYPING: e.WHATSAPP_SEND_TYPING,
        MEDIA_MAX_BYTES: e.WHATSAPP_MEDIA_MAX_BYTES,
        INBOUND_MEDIA_MAX_BYTES: e.WHATSAPP_INBOUND_MEDIA_MAX_BYTES
    };
}
