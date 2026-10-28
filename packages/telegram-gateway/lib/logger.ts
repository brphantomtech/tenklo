import { pino } from 'pino';

import type { DestinationStream, Logger } from 'pino';

export type { Logger };

// O token do bot aparece na URL da Bot API (https://api.telegram.org/bot<token>/sendMessage) e, por isso, em mensagens
// de erro de rede. Qualquer texto que vá para log ou evento passa por aqui antes.
const TOKEN = /\d{5,}:[A-Za-z0-9_-]{30,}/g;

export function redactToken(text: string): string {
    return text.replace(TOKEN, '[token removido]');
}

/**
 * Serializa só o que ajuda a diagnosticar. O GrammyError traz o payload da chamada (texto, legenda, chat_id) e o
 * HttpError, o erro do fetch com a URL: nenhum dos dois vai inteiro para o log.
 */
function serializeError(value: unknown): unknown {
    if (!(value instanceof Error)) return value;
    const err = value as Error & { code?: unknown; error_code?: unknown; description?: unknown; method?: unknown; error?: unknown };
    const out: Record<string, unknown> = { type: err.name, message: redactToken(err.message) };
    if (err.stack) out['stack'] = redactToken(err.stack);
    if (typeof err.code === 'string' || typeof err.code === 'number') out['code'] = err.code;
    if (typeof err.error_code === 'number') out['error_code'] = err.error_code;
    if (typeof err.description === 'string') out['description'] = redactToken(err.description);
    if (typeof err.method === 'string') out['method'] = err.method;
    const inner = err.error ?? err['cause'];
    if (inner instanceof Error) out['cause'] = serializeError(inner);
    return out;
}

/** `destination` só nos testes; em produção, stdout. */
export function createLogger(level: string, destination?: DestinationStream): Logger {
    const options = {
        level,
        base: { service: 'telegram-gateway' },
        timestamp: pino.stdTimeFunctions.isoTime,
        serializers: { err: serializeError },
        // Segunda barreira (OBSERVABILIDADE.md, seção 5): conteúdo de mensagem e segredos nunca vão para o log.
        redact: {
            paths: [
                'text',
                '*.text',
                'caption',
                '*.caption',
                'payload.content',
                'token',
                '*.token',
                'sealedBotToken',
                '*.sealedBotToken',
                'payload.sealedBotToken'
            ],
            censor: '[removido]'
        }
    };
    return destination ? pino(options, destination) : pino(options);
}

/** Mascara ids de chat e de usuário: 123456789 -> 1234****6789, -1001234567890 -> -1001****7890. */
export function mask(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === '') return '';
    const text = String(value);
    const sign = text.startsWith('-') ? '-' : '';
    const digits = text.replace(/^-/, '');
    return digits.length <= 8 ? `${sign}****` : `${sign}${digits.slice(0, 4)}****${digits.slice(-4)}`;
}
