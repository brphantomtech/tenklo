import { Redis } from 'ioredis';

import type { Logger } from '../logger.js';

/** Todas as chaves do gateway ficam sob telegram:*, separadas das do servidor e do gateway do WhatsApp. */
export const KEY_PREFIX = 'telegram:';

export const keys = {
    lock: (channelId: string) => `${KEY_PREFIX}lock:${channelId}`,
    registry: () => `${KEY_PREFIX}channels`,
    command: (commandId: string) => `${KEY_PREFIX}cmd:${commandId}`,
    /** Próximo update_id a pedir no getUpdates. */
    offset: (channelId: string) => `${KEY_PREFIX}offset:${channelId}`,
    /** Hash chatId -> JSON dos grupos e canais onde o bot está (a Bot API não lista os chats do bot). */
    groups: (channelId: string) => `${KEY_PREFIX}groups:${channelId}`
};

export function createRedis(url: string, logger: Logger): Redis {
    const log = logger.child({ component: 'redis' });
    const redis = new Redis(url, {
        connectionName: 'telegram-gateway',
        maxRetriesPerRequest: 3,
        enableAutoPipelining: true
    });
    redis.on('error', (err) => log.error({ err }, 'erro na conexão com o Redis'));
    redis.on('ready', () => log.info('conectado ao Redis'));
    return redis;
}

export type { Redis };
