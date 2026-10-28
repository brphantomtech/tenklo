import { InputFile } from 'grammy';

import { CommandError } from '../errors.js';
import { ObjectNotFoundError } from '../storage/index.js';

import type { MediaContent, MessageContent } from '../contracts/index.js';
import type { MediaObject } from '../storage/index.js';

export type OpenMedia = (objectKey: string) => Promise<MediaObject>;

/** Limites da Bot API (em unidades UTF-16, como o próprio Telegram conta). */
export const TEXT_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;
/** sendPhoto recusa fotos acima de 10 MB; os demais uploads vão até 50 MB (MEDIA_MAX_BYTES). */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export type MediaMethod = 'sendPhoto' | 'sendVideo' | 'sendAudio' | 'sendVoice' | 'sendDocument';

/** Uma chamada à Bot API. Um message.send pode virar várias (texto longo, legenda longa). */
export type MessagePart = { kind: 'text'; text: string } | { kind: 'media'; method: MediaMethod; media: MediaContent['media']; caption?: string };

// Formatos que o Telegram exibe como foto, vídeo ou áudio; o resto precisa ir como documento.
const ACCEPTED: Record<'image' | 'video' | 'audio', RegExp> = {
    image: /^image\/(jpeg|png|webp)$/,
    video: /^video\/mp4$/,
    audio: /^audio\//
};

/**
 * Divide um texto em pedaços de até `max` unidades, preferindo quebra de linha e depois espaço, sem cortar emoji ao
 * meio. Pedaços só com espaços são descartados (o Telegram recusa mensagem vazia).
 */
export function splitText(text: string, max = TEXT_LIMIT): string[] {
    const parts: string[] = [];
    let rest = text;
    while (rest.length > max) {
        const window = rest.slice(0, max + 1);
        let cut = window.lastIndexOf('\n');
        if (cut < max / 2) cut = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\t'));
        let skip = 1;
        if (cut < max / 2) {
            // Sem quebra boa na segunda metade: corta no limite, sem separar um par substituto (emoji).
            cut = max;
            const code = rest.charCodeAt(cut - 1);
            if (code >= 0xd800 && code <= 0xdbff) cut--;
            skip = 0;
        }
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut + skip);
    }
    parts.push(rest);
    return parts.filter((p) => p.trim().length > 0);
}

/**
 * Valida o conteúdo do contrato e planeja as chamadas, sem abrir arquivo nem falar com o Telegram. Legenda acima de
 * 1024 caracteres vai como texto logo depois da mídia.
 */
export function planMessage(content: MessageContent, maxBytes: number): MessagePart[] {
    if (content.kind === 'text') {
        const parts = splitText(content.text);
        if (!parts.length) throw new CommandError('UNSUPPORTED_CONTENT', false, 'texto vazio');
        return parts.map((text) => ({ kind: 'text', text }));
    }

    const { media, caption } = content;
    const mimetype = media.mimeType.toLowerCase();
    if (content.kind !== 'document' && !ACCEPTED[content.kind].test(mimetype)) {
        throw new CommandError('UNSUPPORTED_CONTENT', false, `${mimetype} não pode ser enviado como ${content.kind}`);
    }
    const limit = content.kind === 'image' ? Math.min(maxBytes, PHOTO_MAX_BYTES) : maxBytes;
    if (media.sizeBytes !== undefined && media.sizeBytes > limit) {
        throw new CommandError('MEDIA_TOO_LARGE', false, `arquivo com ${media.sizeBytes} bytes; o limite é ${limit}`);
    }

    const method = mediaMethod(content.kind, mimetype);
    const text = caption?.trim() ? caption : undefined;
    if (!text || text.length <= CAPTION_LIMIT) return [{ kind: 'media', method, media, ...(text ? { caption: text } : {}) }];
    return [{ kind: 'media', method, media }, ...splitText(text).map((t): MessagePart => ({ kind: 'text', text: t }))];
}

function mediaMethod(kind: MediaContent['kind'], mimetype: string): MediaMethod {
    switch (kind) {
        case 'image':
            return 'sendPhoto';
        case 'video':
            return 'sendVideo';
        // OGG/Opus é mensagem de voz (o balão com a onda); MP3 e M4A vão como música, com player.
        case 'audio':
            return /^audio\/(ogg|opus)$/.test(mimetype) ? 'sendVoice' : 'sendAudio';
        case 'document':
            return 'sendDocument';
    }
}

/** Limite de bytes do método (a foto tem limite próprio na Bot API). */
export function partMaxBytes(part: Extract<MessagePart, { kind: 'media' }>, maxBytes: number): number {
    return part.method === 'sendPhoto' ? Math.min(maxBytes, PHOTO_MAX_BYTES) : maxBytes;
}

/** Abre o arquivo do bucket em stream, sem bufferizar, já no formato de upload do grammY. */
export async function openInputFile(part: Extract<MessagePart, { kind: 'media' }>, openMedia: OpenMedia, maxBytes: number): Promise<InputFile> {
    let object: MediaObject;
    try {
        object = await openMedia(part.media.objectKey);
    } catch (err) {
        if (err instanceof ObjectNotFoundError) throw new CommandError('MEDIA_NOT_FOUND', false, 'arquivo não encontrado no armazenamento');
        throw new CommandError('PROVIDER_ERROR', true, 'falha ao ler o arquivo no armazenamento');
    }
    const limit = partMaxBytes(part, maxBytes);
    if (object.contentLength !== undefined && object.contentLength > limit) {
        object.stream.destroy();
        throw new CommandError('MEDIA_TOO_LARGE', false, `arquivo com ${object.contentLength} bytes; o limite é ${limit}`);
    }
    return new InputFile(object.stream, part.media.fileName ?? defaultFileName(part.method, part.media.mimeType));
}

function defaultFileName(method: MediaMethod, mimeType: string): string {
    const ext = mimeType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg').replace('mpeg', 'mp3') || 'bin';
    const base = { sendPhoto: 'foto', sendVideo: 'video', sendAudio: 'audio', sendVoice: 'voz', sendDocument: 'arquivo' }[method];
    return `${base}.${ext}`;
}
