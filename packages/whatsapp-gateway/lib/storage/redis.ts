import { Redis } from 'ioredis';

import type { Logger } from '../logger.js';

/** Todas as chaves do worker ficam sob wk:wpp_lib:*, o único prefixo que a ACL do Redis libera para ele. */
export const KEY_PREFIX = 'whatsapp_gateway:';

export const keys = {
    lock: (channelId: string) => `${KEY_PREFIX}lock:${channelId}`,
    registry: () => `${KEY_PREFIX}channels`,
    command: (commandId: string) => `${KEY_PREFIX}cmd:${commandId}`,
    sentMessage: (channelId: string, providerMessageId: string) => `${KEY_PREFIX}msg:${channelId}:${providerMessageId}`,
    waLookup: (channelId: string, phone: string) => `${KEY_PREFIX}wa:${channelId}:${phone}`
};

export function createRedis(url: string, logger: Logger): Redis {
    const log = logger.child({ component: 'redis' });
    const redis = new Redis(url, {
        connectionName: 'whatsapp-gateway',
        maxRetriesPerRequest: 3,
        enableAutoPipelining: true
    });
    redis.on('error', (err) => log.error({ err }, 'erro na conexão com o Redis'));
    redis.on('ready', () => log.info('conectado ao Redis'));
    return redis;
}

export type { Redis };
