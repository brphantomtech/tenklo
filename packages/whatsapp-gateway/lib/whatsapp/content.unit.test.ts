import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { CommandError } from '../errors.js';
import { ObjectNotFoundError } from '../storage/index.js';
import { TENANT } from '../testing/fakes.js';
import { buildMessageContent } from './content.js';

import type { MediaContent } from '../contracts/index.js';

const KEY = `tenants/${TENANT}/media/5e1d2c3b-0000-4000-8000-00000000000a`;
const media = (kind: MediaContent['kind'], mimeType: string, extra: Partial<MediaContent> = {}): MediaContent => ({
    kind,
    media: { objectKey: KEY, mimeType, fileName: 'arquivo.bin' },
    ...extra
});
const open = (contentLength?: number) => () => Promise.resolve({ stream: Readable.from([Buffer.from('x')]), contentLength });

const expectCode = async (promise: Promise<unknown>, code: string) => {
    const err = await promise.catch((err: unknown) => err);
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).code).toBe(code);
};

describe('buildMessageContent', () => {
    it('texto passa direto', async () => {
        expect(await buildMessageContent({ kind: 'text', text: 'oi' }, open(), 100)).toEqual({ text: 'oi' });
    });

    it('imagem com legenda vira stream da mídia', async () => {
        const content = await buildMessageContent(media('image', 'image/jpeg', { caption: 'Oferta' }), open(1), 100);
        expect(content).toMatchObject({ mimetype: 'image/jpeg', caption: 'Oferta' });
        expect((content as { image: { stream: unknown } }).image.stream).toBeInstanceOf(Readable);
    });

    it('imagem sem legenda não leva caption', async () => {
        const content = await buildMessageContent(media('image', 'image/png'), open(1), 100);
        expect(content).not.toHaveProperty('caption');
    });

    it('documento leva o nome do arquivo e aceita qualquer tipo', async () => {
        const content = await buildMessageContent(media('document', 'application/pdf'), open(1), 100);
        expect(content).toMatchObject({ mimetype: 'application/pdf', fileName: 'arquivo.bin' });
    });

    it('tipo incompatível com o formato é recusado antes de ler o arquivo', async () => {
        await expectCode(buildMessageContent(media('image', 'application/pdf'), open(), 100), 'UNSUPPORTED_CONTENT');
    });

    it('arquivo grande demais é recusado pelo tamanho informado ou pelo do armazenamento', async () => {
        await expectCode(
            buildMessageContent(media('image', 'image/jpeg', { media: { objectKey: KEY, mimeType: 'image/jpeg', sizeBytes: 101 } }), open(), 100),
            'MEDIA_TOO_LARGE'
        );
        await expectCode(buildMessageContent(media('image', 'image/jpeg'), open(101), 100), 'MEDIA_TOO_LARGE');
    });

    it('arquivo ausente vira MEDIA_NOT_FOUND', async () => {
        const missing = () => {
            return Promise.reject(new ObjectNotFoundError(KEY));
        };
        await expectCode(buildMessageContent(media('image', 'image/jpeg'), missing, 100), 'MEDIA_NOT_FOUND');
    });
});
