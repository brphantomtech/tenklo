import { Readable } from 'node:stream';

import { InputFile } from 'grammy';
import { describe, expect, it } from 'vitest';

import { ObjectNotFoundError } from '../storage/index.js';
import { CAPTION_LIMIT, openInputFile, planMessage, splitText, TEXT_LIMIT } from '../telegram/content.js';

import type { MessageContent } from '../contracts/index.js';
import type { CommandError } from '../errors.js';
import type { MessagePart } from '../telegram/content.js';

const MB = 1024 * 1024;
const media = (mimeType: string, extra: Record<string, unknown> = {}) => ({ objectKey: 'tenants/t/media/1', mimeType, ...extra });

describe('splitText', () => {
    it('texto curto fica inteiro', () => {
        expect(splitText('Olá!')).toEqual(['Olá!']);
        expect(splitText('a'.repeat(TEXT_LIMIT))).toHaveLength(1);
    });

    it('prefere quebra de linha, depois espaço', () => {
        const paragraph = 'x'.repeat(3000);
        expect(splitText(`${paragraph}\n${paragraph}`)).toEqual([paragraph, paragraph]);
        const words = Array.from({ length: 1000 }, () => 'palavra').join(' ');
        const parts = splitText(words);
        expect(parts.length).toBeGreaterThan(1);
        expect(parts.every((p) => p.length <= TEXT_LIMIT && !p.startsWith(' ') && p.endsWith('palavra'))).toBe(true);
        expect(parts.join(' ')).toBe(words);
    });

    it('sem espaço, corta no limite sem separar emoji', () => {
        const text = 'a' + '😀'.repeat(3000);
        const parts = splitText(text);
        expect(parts.every((p) => p.length <= TEXT_LIMIT)).toBe(true);
        expect(parts.join('')).toBe(text);
        expect(parts[0]!.endsWith('\ud83d')).toBe(false);
    });

    it('descarta pedaços só com espaços', () => {
        expect(splitText('   ')).toEqual([]);
    });
});

describe('planMessage', () => {
    const plan = (content: MessageContent, max = 50 * MB): MessagePart[] => planMessage(content, max);
    const failure = (content: MessageContent, max = 50 * MB) => {
        try {
            plan(content, max);
        } catch (err) {
            return (err as CommandError).code;
        }
        return 'ok';
    };

    it('texto longo vira várias mensagens', () => {
        expect(plan({ kind: 'text', text: 'oi' })).toEqual([{ kind: 'text', text: 'oi' }]);
        expect(plan({ kind: 'text', text: `${'a'.repeat(4000)}\n${'b'.repeat(4000)}` })).toHaveLength(2);
        expect(failure({ kind: 'text', text: '  ' })).toBe('UNSUPPORTED_CONTENT');
    });

    it('método por tipo: voz para OGG, música para MP3', () => {
        const method = (content: MessageContent) => (plan(content)[0] as Extract<MessagePart, { kind: 'media' }>).method;
        expect(method({ kind: 'image', media: media('image/jpeg') })).toBe('sendPhoto');
        expect(method({ kind: 'video', media: media('video/mp4') })).toBe('sendVideo');
        expect(method({ kind: 'audio', media: media('audio/ogg') })).toBe('sendVoice');
        expect(method({ kind: 'audio', media: media('audio/mpeg') })).toBe('sendAudio');
        expect(method({ kind: 'document', media: media('application/pdf', { fileName: 'catalogo.pdf' }) })).toBe('sendDocument');
    });

    it('legenda até 1024 vai junto; acima disso, em texto logo depois da mídia', () => {
        expect(plan({ kind: 'image', media: media('image/png'), caption: 'Oferta' })).toEqual([
            { kind: 'media', method: 'sendPhoto', media: media('image/png'), caption: 'Oferta' }
        ]);
        const long = 'c'.repeat(CAPTION_LIMIT + 1);
        expect(plan({ kind: 'image', media: media('image/png'), caption: long })).toEqual([
            { kind: 'media', method: 'sendPhoto', media: media('image/png') },
            { kind: 'text', text: long }
        ]);
    });

    it('formato incompatível e tamanho acima do limite', () => {
        expect(failure({ kind: 'image', media: media('application/pdf') })).toBe('UNSUPPORTED_CONTENT');
        expect(failure({ kind: 'video', media: media('video/quicktime') })).toBe('UNSUPPORTED_CONTENT');
        expect(failure({ kind: 'document', media: media('application/zip', { sizeBytes: 51 * MB }) })).toBe('MEDIA_TOO_LARGE');
        // Foto tem limite próprio de 10 MB na Bot API.
        expect(failure({ kind: 'image', media: media('image/jpeg', { sizeBytes: 11 * MB }) })).toBe('MEDIA_TOO_LARGE');
    });
});

describe('openInputFile', () => {
    const part = { kind: 'media', method: 'sendDocument', media: media('application/pdf', { fileName: 'pedido.pdf' }) } as const;

    it('abre em stream, com o nome do arquivo', async () => {
        const file = await openInputFile(part, () => Promise.resolve({ stream: Readable.from([Buffer.from('pdf')]), contentLength: 3 }), 10);
        expect(file).toBeInstanceOf(InputFile);
        expect(file.filename).toBe('pedido.pdf');
    });

    it('arquivo ausente, grande demais ou falha do armazenamento', async () => {
        const code = (p: Promise<unknown>) =>
            p.then(
                () => 'ok',
                (err: CommandError) => `${err.code}:${err.retryable}`
            );
        expect(await code(openInputFile(part, (key) => Promise.reject(new ObjectNotFoundError(key)), 10))).toBe('MEDIA_NOT_FOUND:false');
        expect(await code(openInputFile(part, () => Promise.resolve({ stream: Readable.from([]), contentLength: 11 }), 10))).toBe('MEDIA_TOO_LARGE:false');
        expect(await code(openInputFile(part, () => Promise.reject(new Error('rede')), 10))).toBe('PROVIDER_ERROR:true');
    });
});
