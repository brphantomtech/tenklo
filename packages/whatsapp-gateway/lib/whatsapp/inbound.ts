// Mensagens recebidas (messages.upsert da Baileys) -> payload do evento message.received.
// Regras puras: sem socket, rede ou relógio. As consultas externas (LID -> telefone, download da mídia) são feitas pela
// sessão: o mapa de telefones chega aqui pronto, e o arquivo é gravado depois, a partir de `mediaToDownload`.

import type { EventPayload } from '../contracts/index.js';
import type { proto } from 'baileys';

export type ReceivedPayload = EventPayload<'message.received'>;
export type ReceivedKind = ReceivedPayload['content']['kind'];

/** O que o worker usa de um WAMessage da Baileys 7. */
export interface InboundMessage {
    key: {
        remoteJid?: string | null;
        /** Em conversa individual, o outro endereço do contato (telefone se remoteJid é @lid, e vice-versa). */
        remoteJidAlt?: string | null;
        fromMe?: boolean | null;
        id?: string | null;
        /** Em grupo, o remetente. */
        participant?: string | null;
        participantAlt?: string | null;
    };
    message?: proto.IMessage | null;
    messageTimestamp?: number | { toNumber(): number } | null;
    pushName?: string | null;
    messageStubType?: number | null;
}

export const TEXT_MAX = 4096;
const NAME_MAX = 256;

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

/**
 * Protocolo ou sistema: não são mensagens escritas por alguém. Inclui apagar, editar e configurações da conversa
 * (protocolMessage), distribuição de chaves, fixar/manter na conversa, votos e reações cifrados de enquete,
 * evento e comentário, placeholders, cabeçalho de álbum (as fotos chegam como mensagens próprias), histórico,
 * chamadas e interações com status.
 */
const IGNORED = new Set<string>([
    'protocolMessage',
    'senderKeyDistributionMessage',
    'fastRatchetKeySenderKeyDistributionMessage',
    'messageContextInfo',
    'keepInChatMessage',
    'pinInChatMessage',
    'pollUpdateMessage',
    'encReactionMessage',
    'encCommentMessage',
    'encEventResponseMessage',
    'secretEncryptedMessage',
    'placeholderMessage',
    'deviceSentMessage',
    'albumMessage',
    'messageHistoryBundle',
    'messageHistoryNotice',
    'stickerSyncRmrMessage',
    'callLogMesssage',
    'scheduledCallEditMessage',
    'limitSharingMessage',
    'botInvokeMessage',
    'botTaskMessage',
    'botForwardedMessage',
    'call',
    'chat',
    'statusMentionMessage',
    'groupStatusMentionMessage',
    'statusNotificationMessage',
    'statusAddYours',
    'statusQuotedMessage',
    'statusStickerInteractionMessage',
    'statusQuestionAnswerMessage'
]);

/** Status postado num grupo: é status, não conversa. Precisa ser visto antes de desembrulhar a mensagem. */
const STATUS_WRAPPERS = ['groupStatusMessage', 'groupStatusMessageV2'] as const;

/** Embrulhos que só carregam outra mensagem (temporária, visualização única, documento com legenda, filho de álbum). */
const WRAPPERS = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
    'associatedChildMessage'
] as const;

type Msg = proto.IMessage;
type Mapper = (m: Msg) => { kind: ReceivedKind; text: string | null | undefined };

/** Em ordem de prioridade: a primeira chave presente decide o tipo. */
const MAPPERS: Array<[keyof Msg, Mapper]> = [
    ['reactionMessage', (m) => ({ kind: 'reaction', text: m.reactionMessage?.text })],
    ['conversation', (m) => ({ kind: 'text', text: m.conversation })],
    ['extendedTextMessage', (m) => ({ kind: 'text', text: m.extendedTextMessage?.text })],
    ['imageMessage', (m) => ({ kind: 'image', text: m.imageMessage?.caption })],
    ['videoMessage', (m) => ({ kind: 'video', text: m.videoMessage?.caption })],
    ['ptvMessage', (m) => ({ kind: 'video', text: m.ptvMessage?.caption })],
    ['audioMessage', () => ({ kind: 'audio', text: null })],
    ['documentMessage', (m) => ({ kind: 'document', text: m.documentMessage?.caption })],
    ['stickerMessage', () => ({ kind: 'sticker', text: null })],
    ['lottieStickerMessage', () => ({ kind: 'sticker', text: null })],
    ['locationMessage', (m) => ({ kind: 'location', text: joinText(m.locationMessage?.name, m.locationMessage?.address) })],
    ['liveLocationMessage', (m) => ({ kind: 'location', text: m.liveLocationMessage?.caption })],
    ['contactMessage', (m) => ({ kind: 'contact', text: m.contactMessage?.displayName })],
    ['contactsArrayMessage', (m) => ({ kind: 'contact', text: m.contactsArrayMessage?.displayName })],
    // Clique num botão ou numa lista: a opção escolhida é a resposta.
    ['buttonsResponseMessage', (m) => ({ kind: 'text', text: m.buttonsResponseMessage?.selectedDisplayText })],
    ['templateButtonReplyMessage', (m) => ({ kind: 'text', text: m.templateButtonReplyMessage?.selectedDisplayText })],
    ['listResponseMessage', (m) => ({ kind: 'text', text: m.listResponseMessage?.title })],
    ['interactiveResponseMessage', (m) => ({ kind: 'text', text: m.interactiveResponseMessage?.body?.text })],
    ['pollCreationMessage', (m) => ({ kind: 'other', text: m.pollCreationMessage?.name })],
    ['pollCreationMessageV2', (m) => ({ kind: 'other', text: m.pollCreationMessageV2?.name })],
    ['pollCreationMessageV3', (m) => ({ kind: 'other', text: m.pollCreationMessageV3?.name })],
    ['pollCreationMessageV4', () => ({ kind: 'other', text: null })],
    ['pollCreationMessageV5', () => ({ kind: 'other', text: null })],
    ['eventMessage', (m) => ({ kind: 'other', text: m.eventMessage?.name })],
    ['groupInviteMessage', (m) => ({ kind: 'other', text: m.groupInviteMessage?.caption })]
];

function joinText(...parts: Array<string | null | undefined>): string | null {
    const text = parts.filter((p) => p?.trim()).join(' - ');
    return text || null;
}

/** Texto até `max` caracteres (code points, como o maxLength do JSON Schema), sem cortar emoji ao meio. */
export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const chars = Array.from(text);
    return chars.length <= max ? text : chars.slice(0, max).join('');
}

function unwrap(message: Msg): Msg {
    let current = message;
    for (let i = 0; i < 5; i++) {
        const wrapper = WRAPPERS.map((w) => current[w]).find((w) => w?.message);
        if (!wrapper?.message) break;
        current = wrapper.message;
    }
    return current;
}

/** stanzaId do contextInfo da mensagem interna: a mensagem citada numa resposta. */
function quotedId(message: Msg, key: string): string | null {
    const inner = (message as Record<string, unknown>)[key];
    if (typeof inner !== 'object' || !inner) return null;
    return (inner as { contextInfo?: proto.IContextInfo | null }).contextInfo?.stanzaId || null;
}

function present(message: Msg, key: string): boolean {
    const value = (message as Record<string, unknown>)[key];
    return value !== undefined && value !== null && value !== '';
}

export type ContentResult = { ok: true; kind: ReceivedKind; text: string | null; quotedProviderMessageId: string | null } | { ok: false; reason: string };

export function mapContent(raw: Msg | null | undefined): ContentResult {
    if (!raw) return { ok: false, reason: 'sem conteúdo' };
    if (STATUS_WRAPPERS.some((w) => present(raw, w))) return { ok: false, reason: 'status' };
    const message = unwrap(raw);

    const mapped = MAPPERS.find(([key]) => present(message, key));
    if (mapped) {
        const [key, map] = mapped;
        const { kind, text } = map(message);
        if (kind === 'reaction') {
            // Reação removida chega com texto vazio: não é uma interação nova.
            if (!text) return { ok: false, reason: 'reação removida' };
            return { ok: true, kind, text: truncate(text, TEXT_MAX), quotedProviderMessageId: message.reactionMessage?.key?.id || null };
        }
        return { ok: true, kind, text: text ? truncate(text, TEXT_MAX) : null, quotedProviderMessageId: quotedId(message, key) };
    }

    // Tipo de mensagem que o worker não conhece (produto, pedido, pagamento, novidades do WhatsApp): "other".
    const other = Object.keys(message).find((k) => k.endsWith('Message') && !IGNORED.has(k) && present(message, k));
    if (other) return { ok: true, kind: 'other', text: null, quotedProviderMessageId: quotedId(message, other) };
    return { ok: false, reason: 'protocolo ou sistema' };
}

// ---------------------------------------------------------------------------
// Mídia
// ---------------------------------------------------------------------------

/** Mensagens com arquivo que o worker baixa, e o tipo padrão quando a Baileys não informa o mimetype. */
const MEDIA_KEYS: Array<[keyof Msg, string]> = [
    ['imageMessage', 'image/jpeg'],
    ['videoMessage', 'video/mp4'],
    ['ptvMessage', 'video/mp4'],
    ['audioMessage', 'audio/ogg'],
    ['documentMessage', 'application/octet-stream'],
    ['stickerMessage', 'image/webp']
];

export interface MediaToDownload {
    contentType: string;
    fileName: string | null;
    /** Tamanho anunciado pelo WhatsApp; ausente em algumas mensagens antigas. */
    sizeBytes: number | undefined;
}

function toNumber(value: number | { toNumber(): number } | null | undefined): number | undefined {
    const n = typeof value === 'number' ? value : value && typeof value === 'object' ? value.toNumber() : undefined;
    return n !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** O arquivo da mensagem, se ela tem um (imagem, vídeo, áudio, documento, figurinha). */
export function mediaToDownload(raw: Msg | null | undefined): MediaToDownload | undefined {
    if (!raw) return undefined;
    const message = unwrap(raw);
    for (const [key, fallback] of MEDIA_KEYS) {
        const media = message[key] as
            | { mimetype?: string | null; fileName?: string | null; fileLength?: number | { toNumber(): number } | null }
            | null
            | undefined;
        if (!media) continue;
        const fileName = key === 'documentMessage' ? media.fileName?.trim() || null : null;
        return {
            contentType: media.mimetype?.split(';')[0]?.trim() || fallback,
            fileName: fileName ? truncate(fileName, 255) : null,
            sizeBytes: toNumber(media.fileLength)
        };
    }
    return undefined;
}

/** Chave da mídia recebida no bucket (a mesma que o contrato exige em `media.objectKey`). */
export const inboundMediaKey = (tenantId: string, channelId: string, providerMessageId: string): string =>
    `tenants/${tenantId}/inbox/${channelId}/${providerMessageId}`;

// ---------------------------------------------------------------------------
// Endereços
// ---------------------------------------------------------------------------

/** Remove o aparelho (`:12`) e converte os domínios equivalentes: c.us e hosted -> s.whatsapp.net, hosted.lid -> lid. */
export function normalizeJid(jid: string | null | undefined): string | undefined {
    if (!jid) return undefined;
    const at = jid.indexOf('@');
    if (at <= 0) return undefined;
    const user = jid.slice(0, at).split(':')[0]!.split('_')[0]!;
    const server = jid.slice(at + 1);
    if (!user) return undefined;
    switch (server) {
        case 's.whatsapp.net':
        case 'c.us':
        case 'hosted':
            return `${user}@s.whatsapp.net`;
        case 'lid':
        case 'hosted.lid':
            return `${user}@lid`;
        case 'g.us':
            return `${user}@g.us`;
        default:
            return undefined;
    }
}

const isPn = (jid: string | undefined): jid is string => !!jid?.endsWith('@s.whatsapp.net');
const isLid = (jid: string | undefined): jid is string => !!jid?.endsWith('@lid');

/** LIDs que a sessão precisa traduzir para telefone (os que vieram sem o endereço alternativo). */
export function lidsToResolve(msg: InboundMessage): string[] {
    const group = msg.key.remoteJid?.endsWith('@g.us');
    const primary = normalizeJid(group ? msg.key.participant : msg.key.remoteJid);
    const alt = normalizeJid(group ? msg.key.participantAlt : msg.key.remoteJidAlt);
    return isLid(primary) && !isPn(alt) ? [primary] : [];
}

/** Endereço de um usuário: o JID de telefone quando conhecido (é o que volta no SENT), senão o @lid. */
function resolveUser(primaryRaw: string | null | undefined, altRaw: string | null | undefined, pnByLid: ReadonlyMap<string, string>) {
    const primary = normalizeJid(primaryRaw);
    const alt = normalizeJid(altRaw);
    const lid = isLid(primary) ? primary : isLid(alt) ? alt : undefined;
    const pn = isPn(primary) ? primary : isPn(alt) ? alt : lid ? normalizeJid(pnByLid.get(lid)) : undefined;
    const externalId = (isPn(pn) ? pn : undefined) ?? lid;
    const digits = isPn(pn) ? pn.split('@')[0]! : '';
    return { externalId, phone: /^\d{8,15}$/.test(digits) ? digits : null };
}

function timestamp(value: InboundMessage['messageTimestamp']): Date | undefined {
    const seconds = typeof value === 'number' ? value : value && typeof value === 'object' ? value.toNumber() : undefined;
    return seconds && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
}

// ---------------------------------------------------------------------------
// Mensagem -> payload
// ---------------------------------------------------------------------------

export type InboundResult = { publish: true; payload: ReceivedPayload } | { publish: false; reason: string };

/** O número conectado: o `from` das mensagens próprias. */
export interface SelfAccount {
    externalId: string;
    phone: string | null;
}

/**
 * Decide se a mensagem vira message.received e monta o payload (com `media: null`; a sessão preenche depois de gravar o
 * arquivo). Descarta status e broadcasts, canais, Meta AI, notificações de sistema (stubs, inclusive mensagens que não
 * puderam ser decifradas), conteúdo de protocolo e mensagens próprias em grupo. As próprias em conversa individual
 * (escritas no celular ou no WhatsApp Web) saem com `fromMe: true` e o número conectado em `from`; sem `self`, também são
 * descartadas. A sessão descarta antes as enviadas por este worker. `pnByLid` traz o telefone dos LIDs listados em
 * `lidsToResolve`.
 */
export function toReceivedPayload(
    msg: InboundMessage,
    pnByLid: ReadonlyMap<string, string> = new Map(),
    now: () => Date = () => new Date(),
    self?: SelfAccount
): InboundResult {
    const { key } = msg;
    const fromMe = !!key.fromMe;
    if (fromMe && (!self || key.remoteJid?.endsWith('@g.us'))) return { publish: false, reason: 'própria' };
    if (!key.id) return { publish: false, reason: 'sem id' };
    const remote = key.remoteJid ?? '';
    if (remote.endsWith('@broadcast')) return { publish: false, reason: 'status ou broadcast' };
    if (remote.endsWith('@newsletter')) return { publish: false, reason: 'canal' };
    if (msg.messageStubType) return { publish: false, reason: 'sistema' };

    const isGroup = remote.endsWith('@g.us');
    const chatJid = normalizeJid(remote);
    if (!chatJid || (!isGroup && !isPn(chatJid) && !isLid(chatJid))) return { publish: false, reason: 'conversa não suportada' };

    const content = mapContent(msg.message);
    if (!content.ok) return { publish: false, reason: content.reason };

    // Na própria, o "outro lado" da conversa individual é o contato (remoteJid); quem enviou é o número conectado.
    const contact = isGroup ? resolveUser(key.participant, key.participantAlt, pnByLid) : resolveUser(key.remoteJid, key.remoteJidAlt, pnByLid);
    if (!contact.externalId) return { publish: false, reason: 'remetente desconhecido' };

    const name = msg.pushName?.trim();
    const from = fromMe
        ? { externalId: self!.externalId, phone: self!.phone, name: null }
        : { externalId: contact.externalId, phone: contact.phone, name: name ? truncate(name, NAME_MAX) : null };
    return {
        publish: true,
        payload: {
            providerMessageId: key.id,
            chat: { type: isGroup ? 'group' : 'contact', externalId: isGroup ? chatJid : contact.externalId },
            from,
            sentAt: (timestamp(msg.messageTimestamp) ?? now()).toISOString(),
            content: { kind: content.kind, text: content.text },
            quotedProviderMessageId: content.quotedProviderMessageId,
            fromMe,
            media: null
        }
    };
}

export const receivedEventId = (providerMessageId: string): string => `received:${providerMessageId}`;
