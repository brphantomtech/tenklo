// Mensagens recebidas (update "message" da Bot API) -> payload do evento message.received.
// Regras puras: sem rede ou relógio. O download da mídia é feito pela sessão, a partir de `mediaToDownload`.

import { providerMessageIdOf } from './rules.js';

import type { EventPayload } from '../contracts/index.js';
import type { Message } from 'grammy/types';

export type ReceivedPayload = EventPayload<'message.received'>;
export type ReceivedKind = ReceivedPayload['content']['kind'];

export const TEXT_MAX = 4096;
const NAME_MAX = 256;
const USERNAME = /^[A-Za-z0-9_]{4,32}$/;

/** Texto até `max` caracteres (code points, como o maxLength do JSON Schema), sem cortar emoji ao meio. */
export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const chars = Array.from(text);
    return chars.length <= max ? text : chars.slice(0, max).join('');
}

function joinText(separator: string, ...parts: Array<string | null | undefined>): string | null {
    const text = parts.filter((p) => p?.trim()).join(separator);
    return text || null;
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

/**
 * Avisos de serviço: alguém entrou ou saiu, o grupo mudou de nome ou foto, virou supergrupo, mensagem fixada, tópicos,
 * videochamadas, pagamentos, presentes etc. Não são mensagens escritas por alguém.
 */
const SERVICE_KEYS = new Set<string>([
    'new_chat_members',
    'left_chat_member',
    'new_chat_title',
    'new_chat_photo',
    'delete_chat_photo',
    'group_chat_created',
    'supergroup_chat_created',
    'channel_chat_created',
    'message_auto_delete_timer_changed',
    'migrate_to_chat_id',
    'migrate_from_chat_id',
    'pinned_message',
    'successful_payment',
    'refunded_payment',
    'users_shared',
    'chat_shared',
    'connected_website',
    'write_access_allowed',
    'passport_data',
    'proximity_alert_triggered',
    'boost_added',
    'chat_background_set',
    'giveaway_created',
    'giveaway_completed',
    'gift',
    'gift_upgrade_sent',
    'unique_gift',
    'paid_message_price_changed',
    'direct_message_price_changed',
    'web_app_data',
    'checklist_tasks_done',
    'checklist_tasks_added',
    'managed_bot_created',
    'poll_option_added',
    'poll_option_deleted'
]);
const SERVICE_PREFIXES = /^(forum_topic_|general_forum_topic_|video_chat_|suggested_post_|chat_owner_|community_chat_)/;

type Mapper = (m: Message) => { kind: ReceivedKind; text: string | null | undefined };

/** Em ordem de prioridade: a primeira chave presente decide o tipo. O texto da mídia é a legenda. */
const MAPPERS: Array<[keyof Message, Mapper]> = [
    ['text', (m) => ({ kind: 'text', text: m.text })],
    ['photo', (m) => ({ kind: 'image', text: m.caption })],
    // GIF e vídeo redondo também são vídeo.
    ['animation', (m) => ({ kind: 'video', text: m.caption })],
    ['video', (m) => ({ kind: 'video', text: m.caption })],
    ['video_note', () => ({ kind: 'video', text: null })],
    ['voice', (m) => ({ kind: 'audio', text: m.caption })],
    ['audio', (m) => ({ kind: 'audio', text: m.caption })],
    ['document', (m) => ({ kind: 'document', text: m.caption })],
    ['sticker', (m) => ({ kind: 'sticker', text: m.sticker?.emoji })],
    ['venue', (m) => ({ kind: 'location', text: joinText(' - ', m.venue?.title, m.venue?.address) })],
    ['location', () => ({ kind: 'location', text: null })],
    ['contact', (m) => ({ kind: 'contact', text: joinText(' ', m.contact?.first_name, m.contact?.last_name) })],
    ['poll', (m) => ({ kind: 'other', text: m.poll?.question })]
];

function present(message: Message, key: string): boolean {
    const value = (message as unknown as Record<string, unknown>)[key];
    return value !== undefined && value !== null && value !== '' && value !== false;
}

export type ContentResult = { ok: true; kind: ReceivedKind; text: string | null } | { ok: false; reason: string };

export function mapContent(message: Message): ContentResult {
    const mapped = MAPPERS.find(([key]) => present(message, key));
    if (mapped) {
        const { kind, text } = mapped[1](message);
        return { ok: true, kind, text: text ? truncate(text, TEXT_MAX) : null };
    }
    const keys = Object.keys(message).filter((k) => present(message, k));
    if (keys.some((k) => SERVICE_KEYS.has(k) || SERVICE_PREFIXES.test(k))) return { ok: false, reason: 'serviço' };
    // Dado, jogo, história, fatura, sorteio, lista de tarefas e tipos novos da Bot API: "other", com a legenda se houver.
    return { ok: true, kind: 'other', text: message.caption ? truncate(message.caption, TEXT_MAX) : null };
}

// ---------------------------------------------------------------------------
// Mídia
// ---------------------------------------------------------------------------

export interface MediaToDownload {
    fileId: string;
    contentType: string;
    fileName: string | null;
    /** Tamanho anunciado pelo Telegram; ausente em alguns arquivos. */
    sizeBytes: number | undefined;
}

const cleanType = (mime: string | undefined, fallback: string): string => mime?.split(';')[0]?.trim().toLowerCase() || fallback;

/** O arquivo da mensagem, se ela tem um (foto, vídeo, GIF, vídeo redondo, voz, áudio, documento, figurinha). */
export function mediaToDownload(message: Message): MediaToDownload | undefined {
    if (message.photo?.length) {
        // O Telegram manda a mesma foto em vários tamanhos, do menor para o maior.
        const largest = message.photo.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
        return { fileId: largest.file_id, contentType: 'image/jpeg', fileName: null, sizeBytes: largest.file_size };
    }
    if (message.animation) {
        const a = message.animation;
        return { fileId: a.file_id, contentType: cleanType(a.mime_type, 'video/mp4'), fileName: null, sizeBytes: a.file_size };
    }
    if (message.video) {
        const v = message.video;
        return { fileId: v.file_id, contentType: cleanType(v.mime_type, 'video/mp4'), fileName: null, sizeBytes: v.file_size };
    }
    if (message.video_note) {
        return { fileId: message.video_note.file_id, contentType: 'video/mp4', fileName: null, sizeBytes: message.video_note.file_size };
    }
    if (message.voice) {
        const v = message.voice;
        return { fileId: v.file_id, contentType: cleanType(v.mime_type, 'audio/ogg'), fileName: null, sizeBytes: v.file_size };
    }
    if (message.audio) {
        const a = message.audio;
        return { fileId: a.file_id, contentType: cleanType(a.mime_type, 'audio/mpeg'), fileName: null, sizeBytes: a.file_size };
    }
    if (message.document) {
        const d = message.document;
        const fileName = d.file_name?.trim() || null;
        return {
            fileId: d.file_id,
            contentType: cleanType(d.mime_type, 'application/octet-stream'),
            fileName: fileName ? truncate(fileName, 255) : null,
            sizeBytes: d.file_size
        };
    }
    if (message.sticker) {
        const s = message.sticker;
        const contentType = s.is_animated ? 'application/x-tgsticker' : s.is_video ? 'video/webm' : 'image/webp';
        return { fileId: s.file_id, contentType, fileName: null, sizeBytes: s.file_size };
    }
    return undefined;
}

/**
 * Chave da mídia recebida no bucket (o prefixo que o contrato exige em `media.objectKey`). O providerMessageId do
 * Telegram é `<chatId>:<messageId>`; o ":" vira "_" porque o nome do arquivo no bucket só aceita [A-Za-z0-9._-] (é o
 * formato que o servidor serve em GET /v1/media).
 */
export const inboundMediaKey = (tenantId: string, channelId: string, providerMessageId: string): string =>
    `tenants/${tenantId}/inbox/${channelId}/${providerMessageId.replace(/:/g, '_')}`;

// ---------------------------------------------------------------------------
// Mensagem -> payload
// ---------------------------------------------------------------------------

export type InboundResult = { publish: true; payload: ReceivedPayload } | { publish: false; reason: string };

/**
 * Decide se a mensagem vira message.received e monta o payload (com `media: null`; a sessão preenche depois de gravar o
 * arquivo). Conversa individual vira chat `contact`; grupo e supergrupo, chat `group`. Descarta canais, mensagens de bots
 * (inclusive as do próprio), mensagens enviadas em nome de um chat (administrador anônimo, post de canal no grupo de
 * discussão) e avisos de serviço. Mensagens editadas e posts de canal nem chegam: não estão no allowed_updates.
 */
export function toReceivedPayload(message: Message, now: () => Date = () => new Date()): InboundResult {
    const { chat, from } = message;
    if (chat.type === 'channel') return { publish: false, reason: 'canal' };
    if (!from) return { publish: false, reason: 'sem remetente' };
    if (from.is_bot) return { publish: false, reason: 'bot' };
    if (message.sender_chat) return { publish: false, reason: 'enviada em nome de um chat' };

    const content = mapContent(message);
    if (!content.ok) return { publish: false, reason: content.reason };

    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    const chatId = String(chat.id);
    const providerMessageId = providerMessageIdOf(chatId, message.message_id);
    const name = joinText(' ', from.first_name, from.last_name);
    const username = from.username && USERNAME.test(from.username) ? from.username : null;

    // Em supergrupo com tópicos, toda mensagem do tópico "responde" à criação dele: isso não é citação.
    const reply = message.reply_to_message;
    const quoted = reply && !reply.forum_topic_created ? providerMessageIdOf(chatId, reply.message_id) : null;

    const sentAt = message.date > 0 ? new Date(message.date * 1000) : now();
    return {
        publish: true,
        payload: {
            providerMessageId,
            chat: { type: isGroup ? 'group' : 'contact', externalId: chatId },
            from: { externalId: String(from.id), phone: null, name: name ? truncate(name, NAME_MAX) : null, username },
            sentAt: sentAt.toISOString(),
            content: { kind: content.kind, text: content.text },
            quotedProviderMessageId: quoted,
            media: null
        }
    };
}

export const receivedEventId = (providerMessageId: string): string => `received:${providerMessageId}`;
