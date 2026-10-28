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

// A libsignal (usada pela Baileys) escreve no console a sessão Signal inteira, com as chaves privadas, ao abrir e
// fechar sessões ("Closing session: SessionEntry {...}"). Essas mensagens viram uma linha de debug, sem os objetos.
const SIGNAL_SESSION_DUMP = /^(Closing session|Opening session|Removing old closed session|Session already (closed|open)|Migrating session)/;

export function silenceSignalSessionDumps(logger: Logger): void {
    for (const method of ['info', 'warn', 'log'] as const) {
        const original = console[method].bind(console);
        console[method] = (...args: unknown[]) => {
            const [first] = args;
            if (typeof first === 'string' && SIGNAL_SESSION_DUMP.test(first)) {
                logger.debug({ component: 'libsignal' }, first.replace(/:\s*$/, ''));
                return;
            }
            original(...args);
        };
    }
}

/** Mascara telefones e JIDs: 5511999990000@s.whatsapp.net -> 5511****0000@s.whatsapp.net. */
export function mask(value: string | undefined | null): string {
    if (!value) return '';
    const [user = '', server] = value.split('@');
    const digits = user.split(':')[0] ?? '';
    const masked = digits.length <= 8 ? '****' : `${digits.slice(0, 4)}****${digits.slice(-4)}`;
    return server ? `${masked}@${server}` : masked;
}
