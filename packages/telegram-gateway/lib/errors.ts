import type { ErrorCode } from './contracts/index.js';

/**
 * Falha conhecida ao executar um comando. `retryable` indica se vale tentar de novo mais tarde
 * (canal reconectando, timeout); as demais viram FAILED na hora.
 */
export class CommandError extends Error {
    constructor(
        readonly code: ErrorCode,
        readonly retryable: boolean,
        message: string
    ) {
        super(message);
        this.name = 'CommandError';
    }
}

/** A sessão do canal está aberta em outra instância. */
export class ChannelLockedError extends Error {
    constructor(channelId: string) {
        super(`A sessão do canal ${channelId} está aberta em outra instância`);
        this.name = 'ChannelLockedError';
    }
}
