import { keys } from '../storage/redis.js';

import type { Logger } from '../logger.js';
import type { Redis } from 'ioredis';

const TTL_MS = 30_000;
const HEARTBEAT_MS = 10_000;

// Só renova ou apaga se o lock ainda for desta instância.
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Uma sessão da Baileys só pode estar aberta em uma instância (ARQUITETURA.md, 8.1).
 * O lock tem TTL e é renovado a cada 10s; se a instância travar ou cair, ele expira sozinho em 30s.
 */
export class ChannelLock {
    private timer: NodeJS.Timeout | undefined;
    private readonly key: string;

    constructor(
        private readonly redis: Redis,
        channelId: string,
        private readonly owner: string,
        private readonly logger: Logger
    ) {
        this.key = keys.lock(channelId);
    }

    /** Tenta adquirir; se conseguir, mantém renovado até `release`. `onLost` é chamado se outra instância assumir. */
    async acquire(onLost: () => void): Promise<boolean> {
        const ok = (await this.redis.set(this.key, this.owner, 'PX', TTL_MS, 'NX')) === 'OK';
        if (!ok) {
            // A mesma instância reiniciando antes de o TTL expirar ainda é a dona.
            if ((await this.redis.get(this.key)) !== this.owner) return false;
            await this.redis.pexpire(this.key, TTL_MS);
        }
        this.timer = setInterval(() => {
            this.redis
                .eval(RENEW, 1, this.key, this.owner, TTL_MS)
                .then((renewed) => {
                    if (renewed === 0) {
                        this.stopHeartbeat();
                        onLost();
                    }
                })
                .catch((err: unknown) => this.logger.warn({ err }, 'falha ao renovar o lock da sessão'));
        }, HEARTBEAT_MS);
        this.timer.unref();
        return true;
    }

    async release(): Promise<void> {
        this.stopHeartbeat();
        await this.redis.eval(RELEASE, 1, this.key, this.owner).catch((err: unknown) => this.logger.warn({ err }, 'falha ao liberar o lock da sessão'));
    }

    private stopHeartbeat(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}
