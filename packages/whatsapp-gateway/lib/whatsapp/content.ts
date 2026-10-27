import { CommandError } from '../errors.js';
import { ObjectNotFoundError } from '../storage/index.js';

import type { MessageContent } from '../contracts/index.js';
import type { MediaObject } from '../storage/index.js';
import type { AnyMessageContent } from 'baileys';

export type OpenMedia = (objectKey: string) => Promise<MediaObject>;

// O WhatsApp só exibe estes formatos como imagem ou vídeo; o resto precisa ir como documento.
const ACCEPTED: Record<'image' | 'video' | 'audio', RegExp> = {
    image: /^image\/(jpeg|png|webp)$/,
    video: /^video\/(mp4|3gpp)$/,
    audio: /^audio\//
};

/** Converte o conteúdo do contrato no formato da Baileys. A mídia é lida do RustFS em stream, sem bufferizar. */
export async function buildMessageContent(content: MessageContent, openMedia: OpenMedia, maxBytes: number): Promise<AnyMessageContent> {
    if (content.kind === 'text') return { text: content.text };

    const { media, caption } = content;
    const mimetype = media.mimeType.toLowerCase();
    if (content.kind !== 'document' && !ACCEPTED[content.kind].test(mimetype)) {
        throw new CommandError('UNSUPPORTED_CONTENT', false, `${mimetype} não pode ser enviado como ${content.kind}`);
    }
    if (media.sizeBytes !== undefined && media.sizeBytes > maxBytes) {
        throw new CommandError('MEDIA_TOO_LARGE', false, `arquivo com ${media.sizeBytes} bytes; o limite é ${maxBytes}`);
    }

    let object: MediaObject;
    try {
        object = await openMedia(media.objectKey);
    } catch (err) {
        if (err instanceof ObjectNotFoundError) throw new CommandError('MEDIA_NOT_FOUND', false, 'arquivo não encontrado no armazenamento');
        throw new CommandError('PROVIDER_ERROR', true, 'falha ao ler o arquivo no armazenamento');
    }
    if (object.contentLength !== undefined && object.contentLength > maxBytes) {
        object.stream.destroy();
        throw new CommandError('MEDIA_TOO_LARGE', false, `arquivo com ${object.contentLength} bytes; o limite é ${maxBytes}`);
    }

    const upload = { stream: object.stream };
    switch (content.kind) {
        case 'image':
            return { image: upload, mimetype, ...(caption ? { caption } : {}) };
        case 'video':
            return { video: upload, mimetype, ...(caption ? { caption } : {}) };
        case 'audio':
            return { audio: upload, mimetype };
        case 'document':
            return { document: upload, mimetype, fileName: media.fileName ?? 'arquivo', ...(caption ? { caption } : {}) };
    }
}
