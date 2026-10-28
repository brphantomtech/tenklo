import { GrammyError, HttpError } from 'grammy';
import { describe, expect, it } from 'vitest';

import { createLogger, mask, redactToken } from './logger.js';

const TOKEN = '7012345678:AAHfakeTokenForExamples_0123456789abc';

/** Logger do worker escrevendo numa lista, para conferir o que sairia no stdout. */
function capture() {
    const lines: string[] = [];
    const logger = createLogger('info', { write: (line: string) => void lines.push(line) });
    return { logger, output: () => lines.join('') };
}

describe('logger', () => {
    it('mascara ids de chat e de usuário', () => {
        expect(mask('123456789')).toBe('1234****6789');
        expect(mask(-1001234567890)).toBe('-1001****7890');
        expect(mask('42')).toBe('****');
        expect(mask(undefined)).toBe('');
    });

    it('tira o token de qualquer texto', () => {
        expect(redactToken(`request to https://api.telegram.org/bot${TOKEN}/getUpdates failed`)).toBe(
            'request to https://api.telegram.org/bot[token removido]/getUpdates failed'
        );
    });

    it('erro de rede do grammY sai sem o token da URL', () => {
        const { logger, output } = capture();
        const fetchError = Object.assign(new Error(`request to https://api.telegram.org/bot${TOKEN}/getUpdates failed, reason: refused`), {
            code: 'ECONNREFUSED'
        });
        logger.warn({ err: new HttpError("Network request for 'getUpdates' failed!", fetchError) }, 'falha');
        expect(output()).not.toContain('AAHfake');
        expect(output()).toContain('ECONNREFUSED');
    });

    it('GrammyError sai sem o payload da chamada (texto e chat)', () => {
        const { logger, output } = capture();
        const err = new GrammyError(
            "Call to 'sendMessage' failed!",
            { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
            'sendMessage',
            { chat_id: 123456789, text: 'conteúdo da campanha' }
        );
        logger.warn({ err }, 'falha');
        expect(output()).toContain('bot was blocked');
        expect(output()).not.toContain('conteúdo da campanha');
        expect(output()).not.toContain('123456789');
    });

    it('token e sealedBotToken nunca vão para o log', () => {
        const { logger, output } = capture();
        logger.info({ token: TOKEN, payload: { sealedBotToken: 'AbCd' }, text: 'segredo' }, 'x');
        expect(output()).not.toContain('AAHfake');
        expect(output()).not.toContain('AbCd');
        expect(output()).not.toContain('segredo');
    });
});
