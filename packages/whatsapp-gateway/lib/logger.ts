import { pino } from 'pino';

import type { Logger } from 'pino';

export type { Logger };

export function createLogger(level: string): Logger {
    return pino({
        level,
        base: { service: 'whatsapp-gateway' },
        timestamp: pino.stdTimeFunctions.isoTime,
        // Segunda barreira (OBSERVABILIDADE.md, seção 5): conteúdo de mensagem, QR e segredos nunca vão para o log.
        redact: {
            paths: ['qr', '*.qr', 'text', '*.text', 'caption', '*.caption', 'payload.content', 'creds', '*.creds'],
            censor: '[removido]'
        }
    });
}

/** Mascara telefones e JIDs: 5511999990000@s.whatsapp.net -> 5511****0000@s.whatsapp.net. */
export function mask(value: string | undefined | null): string {
    if (!value) return '';
    const [user = '', server] = value.split('@');
    const digits = user.split(':')[0] ?? '';
    const masked = digits.length <= 8 ? '****' : `${digits.slice(0, 4)}****${digits.slice(-4)}`;
    return server ? `${masked}@${server}` : masked;
}
