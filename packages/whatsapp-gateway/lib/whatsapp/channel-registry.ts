import { keys } from '../storage/redis.js';

import type { Redis } from 'ioredis';

/**
 * Canais que devem ficar conectados. Entra quando a sessão abre e sai quando o usuário desconecta, o aparelho
 * é deslogado ou o número é banido. Ao subir, o worker retoma as sessões daqui sem precisar do core.
 */
export class ChannelRegistry {
    constructor(private readonly redis: Redis) {}

    async add(channelId: string, tenantId: string): Promise<void> {
        await this.redis.hset(keys.registry(), channelId, tenantId);
    }

    async remove(channelId: string): Promise<void> {
        await this.redis.hdel(keys.registry(), channelId);
    }

    async has(channelId: string): Promise<boolean> {
        return (await this.redis.hexists(keys.registry(), channelId)) === 1;
    }

    async list(): Promise<Array<{ channelId: string; tenantId: string }>> {
        const all = await this.redis.hgetall(keys.registry());
        return Object.entries(all).map(([channelId, tenantId]) => ({ channelId, tenantId }));
    }
}
