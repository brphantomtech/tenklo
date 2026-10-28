// Regras do canal sem dependência de rede ou relógio: fáceis de testar e de revisar.

import { GrammyError, HttpError } from 'grammy';

import { CommandError } from '../errors.js';
import { redactToken } from '../logger.js';

import type { GroupsSyncedEvent, Recipient } from '../contracts/index.js';
import type { ChatFullInfo, ChatMember, ChatMemberUpdated } from 'grammy/types';

// ---------------------------------------------------------------------------
// Destinatário
// ---------------------------------------------------------------------------

export type ParsedRecipient = { kind: 'contact' | 'group'; chatId: string } | { kind: 'invalid'; reason: string };

/**
 * O destino é o id do chat: o do usuário (positivo) na conversa individual; o do grupo, supergrupo ou canal
 * (negativo) em grupo. Não aceita @username: o bot só fala com quem já iniciou a conversa, e aí o core tem o id.
 */
export function parseRecipient(to: Recipient): ParsedRecipient {
    const value = to.externalId.trim();
    if (to.kind === 'group') {
        return /^-\d{1,20}$/.test(value) ? { kind: 'group', chatId: value } : { kind: 'invalid', reason: 'id de grupo do Telegram deve ser negativo' };
    }
    return /^\d{1,20}$/.test(value) ? { kind: 'contact', chatId: value } : { kind: 'invalid', reason: 'id de usuário do Telegram deve ser numérico' };
}

export const isGroupChatId = (chatId: string): boolean => chatId.startsWith('-');

/** providerMessageId do Telegram: o id da mensagem só é único dentro da conversa. */
export const providerMessageIdOf = (chatId: string | number, messageId: number): string => `${chatId}:${messageId}`;

// ---------------------------------------------------------------------------
// Ritmo e reconexão
// ---------------------------------------------------------------------------

/**
 * Quanto esperar antes do próximo envio: o intervalo mínimo do bot (`nextGlobalAt`) e o da conversa (1/s em conversa
 * individual, ~20/min em grupo), contado a partir do último envio para ela.
 */
export function pacingWaitMs(now: number, nextGlobalAt: number, lastChatAt: number | undefined, chatIntervalMs: number): number {
    const chatReadyAt = lastChatAt === undefined ? 0 : lastChatAt + chatIntervalMs;
    return Math.max(0, nextGlobalAt - now, chatReadyAt - now);
}

/** Backoff exponencial com jitter: 2s, 4s, 8s... até 60s. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
    const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
    return Math.round(base * (0.8 + random() * 0.4));
}

// ---------------------------------------------------------------------------
// Erros da Bot API
// ---------------------------------------------------------------------------

/** Falhas de rede em que a requisição não chegou ao Telegram: dá para tentar de novo sem risco de duplicar. */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'UND_ERR_CONNECT_TIMEOUT']);

/** A requisição não saiu da máquina (DNS, conexão recusada)? Procura o código no erro do fetch e nas causas. */
export function failedBeforeSending(err: unknown): boolean {
    let current: unknown = err instanceof HttpError ? err.error : err;
    for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
        const code = (current as { code?: unknown }).code;
        if (typeof code === 'string' && NOT_SENT_CODES.has(code)) return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

export type SendFailure = { kind: 'rate-limited'; retryAfterMs: number } | { kind: 'unauthorized' } | { kind: 'error'; error: CommandError };

const RECIPIENT_BLOCKED = /blocked by the user|can't initiate conversation|user is deactivated|bot was stopped/i;
const TO_BOT = /can't send messages to bots/i;
const GROUP_FORBIDDEN =
    /not a member|was kicked|not enough rights|have no rights|need administrator rights|chat_write_forbidden|chat_restricted|topic_closed|chat_send_\w+_forbidden/i;
const CHAT_NOT_FOUND = /chat not found|peer_id_invalid|user not found/i;
const TOO_LARGE = /too big|too large|entity too large/i;
const UNSUPPORTED =
    /wrong file|wrong type|wrong remote file|image_process_failed|photo_invalid|photo_save_file_invalid|video_file_invalid|file must be non-empty|message is too long|caption is too long|text is empty|failed to get http url content|webpage_/i;

const fail = (code: ConstructorParameters<typeof CommandError>[0], retryable: boolean, message: string): SendFailure => ({
    kind: 'error',
    error: new CommandError(code, retryable, redactToken(message).slice(0, 500))
});

/**
 * Traduz o erro de um envio. Erros que o Telegram devolveu (GrammyError) dizem com certeza que a mensagem não saiu.
 * Falha de rede antes da requisição sair é retentável; depois de sair (timeout, conexão caída), a mensagem pode ter
 * chegado e retentar arriscaria duplicar: vira falha definitiva, como no worker do WhatsApp.
 */
export function classifySendError(err: unknown, chatId: string): SendFailure {
    if (err instanceof CommandError) return { kind: 'error', error: err };
    const group = isGroupChatId(chatId);

    if (err instanceof GrammyError) {
        const description = err.description ?? '';
        switch (err.error_code) {
            case 401:
                return { kind: 'unauthorized' };
            case 429:
                return { kind: 'rate-limited', retryAfterMs: Math.max(1, err.parameters?.retry_after ?? 5) * 1000 };
            case 413:
                return fail('MEDIA_TOO_LARGE', false, description || 'arquivo grande demais para a Bot API');
        }
        if (err.parameters?.migrate_to_chat_id) {
            return fail('GROUP_SEND_FORBIDDEN', false, `o grupo virou supergrupo; o novo id é ${err.parameters.migrate_to_chat_id}`);
        }
        if (TO_BOT.test(description)) return fail('INVALID_RECIPIENT', false, description);
        if (RECIPIENT_BLOCKED.test(description)) return fail('RECIPIENT_BLOCKED', false, description);
        if (GROUP_FORBIDDEN.test(description)) return fail('GROUP_SEND_FORBIDDEN', false, description);
        if (CHAT_NOT_FOUND.test(description)) return fail(group ? 'GROUP_SEND_FORBIDDEN' : 'INVALID_RECIPIENT', false, description);
        if (TOO_LARGE.test(description)) return fail('MEDIA_TOO_LARGE', false, description);
        if (UNSUPPORTED.test(description)) return fail('UNSUPPORTED_CONTENT', false, description);
        if (err.error_code === 403) return fail(group ? 'GROUP_SEND_FORBIDDEN' : 'RECIPIENT_BLOCKED', false, description);
        return fail('PROVIDER_ERROR', false, `${err.error_code}: ${description}`);
    }

    if (err instanceof HttpError) {
        if (failedBeforeSending(err)) return fail('CHANNEL_NOT_CONNECTED', true, 'sem conexão com a Bot API; a mensagem não saiu');
        return fail('TIMEOUT', false, 'sem resposta da Bot API; a mensagem pode ter saído');
    }

    const message = err instanceof Error ? err.message : String(err);
    return fail('PROVIDER_ERROR', false, message);
}

export type PollFailure = { kind: 'invalid-token' } | { kind: 'replaced' } | { kind: 'transient'; retryAfterMs?: number };

/** Erro do getUpdates (ou do getMe na abertura). */
export function classifyPollError(err: unknown): PollFailure {
    if (err instanceof GrammyError) {
        // 404 é o que a Bot API responde para um token com formato válido mas que não existe.
        if (err.error_code === 401 || err.error_code === 404) return { kind: 'invalid-token' };
        // Outro getUpdates com o mesmo token (outro sistema usando o bot) ou um webhook configurado.
        if (err.error_code === 409) return { kind: 'replaced' };
        if (err.error_code === 429) return { kind: 'transient', retryAfterMs: Math.max(1, err.parameters?.retry_after ?? 5) * 1000 };
    }
    return { kind: 'transient' };
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

/** O que o worker guarda de cada grupo ou canal onde o bot está (hash wk:tlg:groups:<channelId>). */
export interface GroupEntry {
    id: string;
    type: 'group' | 'supergroup' | 'channel';
    title: string;
    membersCount: number | null;
    /** Situação do bot no chat. */
    status: 'creator' | 'administrator' | 'member' | 'restricted';
    /** Canal: o bot administrador pode publicar. */
    canPostMessages: boolean | null;
    /** Bot restrito no grupo: ainda pode mandar mensagens. */
    canSendMessages: boolean | null;
    /** Permissão padrão do grupo: membros comuns mandam mensagens (false = só administradores). */
    membersCanSend: boolean | null;
}

type GroupChatType = GroupEntry['type'];
const isGroupChatType = (type: string): type is GroupChatType => type === 'group' || type === 'supergroup' || type === 'channel';

/** Situação do bot a partir do ChatMember; null se ele não está mais no chat. */
export function botMembership(member: ChatMember): Pick<GroupEntry, 'status' | 'canPostMessages' | 'canSendMessages'> | null {
    switch (member.status) {
        case 'creator':
            return { status: 'creator', canPostMessages: true, canSendMessages: null };
        case 'administrator':
            return { status: 'administrator', canPostMessages: member.can_post_messages ?? null, canSendMessages: null };
        case 'member':
            return { status: 'member', canPostMessages: null, canSendMessages: null };
        case 'restricted':
            return member.is_member ? { status: 'restricted', canPostMessages: null, canSendMessages: member.can_send_messages } : null;
        default:
            return null;
    }
}

/**
 * my_chat_member: o bot entrou, saiu ou mudou de permissão num chat. Devolve a entrada nova, null se o bot saiu (ou foi
 * removido) e undefined se não é grupo nem canal (conversa individual: usuário bloqueou ou desbloqueou o bot).
 */
export function entryFromMemberUpdate(update: ChatMemberUpdated, previous?: GroupEntry): GroupEntry | null | undefined {
    const { chat } = update;
    if (!isGroupChatType(chat.type)) return undefined;
    const membership = botMembership(update.new_chat_member);
    if (!membership) return null;
    return {
        id: String(chat.id),
        type: chat.type,
        title: ('title' in chat && chat.title) || previous?.title || String(chat.id),
        membersCount: previous?.membersCount ?? null,
        ...membership,
        membersCanSend: previous?.membersCanSend ?? null
    };
}

/** Entrada a partir de getChat + getChatMemberCount + getChatMember(bot), usada no groups.sync. */
export function entryFromChat(chat: ChatFullInfo, membersCount: number | null, botMember: ChatMember): GroupEntry | null {
    if (!isGroupChatType(chat.type)) return null;
    const membership = botMembership(botMember);
    if (!membership) return null;
    return {
        id: String(chat.id),
        type: chat.type,
        title: chat.title ?? String(chat.id),
        membersCount,
        ...membership,
        membersCanSend: chat.type === 'channel' ? null : (chat.permissions?.can_send_messages ?? null)
    };
}

type GroupSummary = GroupsSyncedEvent['payload']['groups'][number];

export function summarizeGroup(entry: GroupEntry): GroupSummary {
    const isAdmin = entry.status === 'creator' || entry.status === 'administrator';
    if (entry.type === 'channel') {
        // Em canal só administrador publica, e precisa do direito de publicar.
        return {
            externalId: entry.id,
            name: entry.title,
            participantsCount: entry.membersCount ?? 0,
            isAdmin,
            announce: true,
            canSend: entry.status === 'creator' || (entry.status === 'administrator' && entry.canPostMessages !== false)
        };
    }
    const announce = entry.membersCanSend === false;
    const canSend = isAdmin || (entry.status === 'restricted' ? entry.canSendMessages === true : !announce);
    return { externalId: entry.id, name: entry.title, participantsCount: entry.membersCount ?? 0, isAdmin, announce, canSend };
}

export function summarizeGroups(entries: GroupEntry[]): GroupSummary[] {
    return entries.map(summarizeGroup).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
