import { GrammyError, HttpError } from 'grammy';
import { describe, expect, it } from 'vitest';

import { assertValidEvent } from '../contracts/index.js';
import { buildEvent } from '../events/publisher.js';
import {
    classifyPollError,
    classifySendError,
    entryFromChat,
    entryFromMemberUpdate,
    pacingWaitMs,
    parseRecipient,
    reconnectDelayMs,
    summarizeGroups
} from '../telegram/rules.js';
import { CHANNEL, CORRELATION, TENANT } from '../testing/fakes.js';

import type { GroupEntry } from '../telegram/rules.js';
import type { ChatFullInfo, ChatMember, ChatMemberUpdated } from 'grammy/types';

const apiError = (error_code: number, description: string, parameters: Record<string, unknown> = {}) =>
    new GrammyError('Call to sendMessage failed!', { ok: false, error_code, description, parameters }, 'sendMessage', {});

const networkError = (code: string) => new HttpError("Network request for 'sendMessage' failed!", Object.assign(new Error('falhou'), { code }));

describe('parseRecipient', () => {
    it('contato é o id positivo do usuário; grupo, o id negativo', () => {
        expect(parseRecipient({ kind: 'contact', externalId: '123456789' })).toEqual({ kind: 'contact', chatId: '123456789' });
        expect(parseRecipient({ kind: 'group', externalId: '-1001234567890' })).toEqual({ kind: 'group', chatId: '-1001234567890' });
    });

    it('recusa formatos do WhatsApp, @username e sinal trocado', () => {
        expect(parseRecipient({ kind: 'contact', externalId: '5511999990000@s.whatsapp.net' }).kind).toBe('invalid');
        expect(parseRecipient({ kind: 'contact', externalId: '@fulano' }).kind).toBe('invalid');
        expect(parseRecipient({ kind: 'contact', externalId: '-100123' }).kind).toBe('invalid');
        expect(parseRecipient({ kind: 'group', externalId: '123' }).kind).toBe('invalid');
    });
});

describe('classifySendError', () => {
    const code = (err: unknown, chatId = '123456789') => {
        const failure = classifySendError(err, chatId);
        return failure.kind === 'error' ? { code: failure.error.code, retryable: failure.error.retryable } : failure;
    };

    it.each([['Forbidden: bot was blocked by the user'], ["Forbidden: bot can't initiate conversation with a user"], ['Forbidden: user is deactivated']])(
        '%s -> RECIPIENT_BLOCKED',
        (description) => {
            expect(code(apiError(403, description))).toEqual({ code: 'RECIPIENT_BLOCKED', retryable: false });
        }
    );

    it('a mensagem do Telegram vira o errorMessage', () => {
        const failure = classifySendError(apiError(403, 'Forbidden: bot was blocked by the user'), '123456789');
        expect(failure.kind === 'error' && failure.error.message).toBe('Forbidden: bot was blocked by the user');
    });

    it('chat inexistente: destino inválido em contato, proibido em grupo', () => {
        expect(code(apiError(400, 'Bad Request: chat not found'))).toEqual({ code: 'INVALID_RECIPIENT', retryable: false });
        expect(code(apiError(400, 'Bad Request: chat not found'), '-1001234567890')).toEqual({ code: 'GROUP_SEND_FORBIDDEN', retryable: false });
    });

    it.each([
        ['Bad Request: not enough rights to send text messages to the chat', 400],
        ['Forbidden: bot is not a member of the supergroup chat', 403],
        ['Forbidden: bot was kicked from the group chat', 403],
        ['Bad Request: CHAT_WRITE_FORBIDDEN', 400]
    ])('%s -> GROUP_SEND_FORBIDDEN', (description, status) => {
        expect(code(apiError(status, description), '-1001234567890')).toEqual({ code: 'GROUP_SEND_FORBIDDEN', retryable: false });
    });

    it('grupo que virou supergrupo informa o novo id', () => {
        const failure = classifySendError(apiError(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -1009 }), '-4001');
        expect(failure.kind === 'error' && failure.error.code).toBe('GROUP_SEND_FORBIDDEN');
        expect(failure.kind === 'error' && failure.error.message).toContain('-1009');
    });

    it('401 é token revogado; 429 traz a espera pedida', () => {
        expect(classifySendError(apiError(401, 'Unauthorized'), '1')).toEqual({ kind: 'unauthorized' });
        expect(classifySendError(apiError(429, 'Too Many Requests: retry after 7', { retry_after: 7 }), '1')).toEqual({
            kind: 'rate-limited',
            retryAfterMs: 7_000
        });
    });

    it('arquivo grande e formato recusado', () => {
        expect(code(apiError(413, 'Request Entity Too Large'))).toEqual({ code: 'MEDIA_TOO_LARGE', retryable: false });
        expect(code(apiError(400, 'Bad Request: file is too big'))).toEqual({ code: 'MEDIA_TOO_LARGE', retryable: false });
        expect(code(apiError(400, 'Bad Request: IMAGE_PROCESS_FAILED'))).toEqual({ code: 'UNSUPPORTED_CONTENT', retryable: false });
    });

    it('erro desconhecido do Telegram é definitivo', () => {
        expect(code(apiError(500, 'Internal Server Error'))).toEqual({ code: 'PROVIDER_ERROR', retryable: false });
    });

    it('rede: antes de sair é retentável; depois (timeout, conexão caída) não, para não duplicar', () => {
        expect(code(networkError('ECONNREFUSED'))).toEqual({ code: 'CHANNEL_NOT_CONNECTED', retryable: true });
        expect(code(networkError('ENOTFOUND'))).toEqual({ code: 'CHANNEL_NOT_CONNECTED', retryable: true });
        expect(code(networkError('ECONNRESET'))).toEqual({ code: 'TIMEOUT', retryable: false });
        expect(code(new HttpError('x', new Error("Request to 'sendMessage' timed out after 180 seconds")))).toEqual({ code: 'TIMEOUT', retryable: false });
    });

    it('o token nunca vai para a mensagem de erro', () => {
        const failure = classifySendError(
            new Error('request to https://api.telegram.org/bot7012345678:AAHfakeTokenForExamples_0123456789abc/sendMessage failed'),
            '1'
        );
        expect(failure.kind === 'error' && failure.error.message).not.toContain('AAHfake');
    });
});

describe('classifyPollError', () => {
    it('401 e 404 são token inválido; 409 é outro leitor; o resto é transitório', () => {
        expect(classifyPollError(apiError(401, 'Unauthorized'))).toEqual({ kind: 'invalid-token' });
        expect(classifyPollError(apiError(404, 'Not Found'))).toEqual({ kind: 'invalid-token' });
        expect(classifyPollError(apiError(409, 'Conflict: terminated by other getUpdates request'))).toEqual({ kind: 'replaced' });
        expect(classifyPollError(apiError(429, 'Too Many Requests', { retry_after: 3 }))).toEqual({ kind: 'transient', retryAfterMs: 3_000 });
        expect(classifyPollError(networkError('ECONNRESET'))).toEqual({ kind: 'transient' });
    });
});

describe('ritmo', () => {
    it('espera o maior entre o intervalo do bot e o da conversa', () => {
        expect(pacingWaitMs(1_000, 0, undefined, 1_000)).toBe(0);
        expect(pacingWaitMs(1_000, 1_050, undefined, 1_000)).toBe(50);
        expect(pacingWaitMs(1_000, 1_050, 500, 1_000)).toBe(500);
        expect(pacingWaitMs(5_000, 0, 500, 3_000)).toBe(0);
    });

    it('backoff de reconexão cresce até 60s', () => {
        expect(reconnectDelayMs(1, () => 0.5)).toBe(2_000);
        expect(reconnectDelayMs(3, () => 0.5)).toBe(8_000);
        expect(reconnectDelayMs(20, () => 0.5)).toBe(60_000);
    });
});

describe('grupos', () => {
    const BOT = { id: 7012345678, is_bot: true, first_name: 'Loja' };
    const memberUpdate = (chat: Record<string, unknown>, newMember: Record<string, unknown>): ChatMemberUpdated =>
        ({
            chat,
            from: { id: 1, is_bot: false, first_name: 'Dono' },
            date: 1,
            old_chat_member: { status: 'left', user: BOT },
            new_chat_member: { user: BOT, ...newMember }
        }) as unknown as ChatMemberUpdated;
    const admin = (over: Record<string, unknown> = {}) => ({ status: 'administrator', can_post_messages: true, ...over });

    it('bot adicionado a um supergrupo como membro', () => {
        const entry = entryFromMemberUpdate(memberUpdate({ id: -1001, type: 'supergroup', title: 'Clientes' }, { status: 'member' }));
        expect(entry).toEqual({
            id: '-1001',
            type: 'supergroup',
            title: 'Clientes',
            membersCount: null,
            status: 'member',
            canPostMessages: null,
            canSendMessages: null,
            membersCanSend: null
        });
        expect(summarizeGroups([entry!])).toEqual([
            { externalId: '-1001', name: 'Clientes', participantsCount: 0, isAdmin: false, announce: false, canSend: true }
        ]);
    });

    it('bot removido ou que saiu: null; conversa individual: ignorada', () => {
        expect(entryFromMemberUpdate(memberUpdate({ id: -1001, type: 'group', title: 'G' }, { status: 'kicked', until_date: 0 }))).toBeNull();
        expect(entryFromMemberUpdate(memberUpdate({ id: -1001, type: 'group', title: 'G' }, { status: 'left' }))).toBeNull();
        expect(entryFromMemberUpdate(memberUpdate({ id: -1001, type: 'group', title: 'G' }, { status: 'restricted', is_member: false }))).toBeNull();
        expect(entryFromMemberUpdate(memberUpdate({ id: 42, type: 'private', first_name: 'A' }, { status: 'kicked', until_date: 0 }))).toBeUndefined();
    });

    it('promoção mantém o que já se sabia do grupo', () => {
        const previous: GroupEntry = {
            id: '-1001',
            type: 'supergroup',
            title: 'Clientes',
            membersCount: 120,
            status: 'member',
            canPostMessages: null,
            canSendMessages: null,
            membersCanSend: false
        };
        const entry = entryFromMemberUpdate(memberUpdate({ id: -1001, type: 'supergroup', title: 'Clientes' }, admin()), previous)!;
        expect(entry).toMatchObject({ status: 'administrator', membersCount: 120, membersCanSend: false });
        expect(summarizeGroups([entry])[0]).toMatchObject({ isAdmin: true, announce: true, canSend: true, participantsCount: 120 });
        expect(summarizeGroups([previous])[0]).toMatchObject({ isAdmin: false, announce: true, canSend: false });
    });

    it('canal: sempre announce; só envia como administrador com direito de publicar', () => {
        const channel = { id: -1009, type: 'channel', title: 'Novidades' };
        const can = entryFromMemberUpdate(memberUpdate(channel, admin()))!;
        const cannot = entryFromMemberUpdate(memberUpdate(channel, admin({ can_post_messages: false })))!;
        expect(summarizeGroups([can])[0]).toMatchObject({ announce: true, isAdmin: true, canSend: true });
        expect(summarizeGroups([cannot])[0]).toMatchObject({ announce: true, isAdmin: true, canSend: false });
    });

    it('bot restrito sem permissão de mensagem não envia', () => {
        const entry = entryFromMemberUpdate(
            memberUpdate({ id: -1001, type: 'supergroup', title: 'G' }, { status: 'restricted', is_member: true, can_send_messages: false })
        )!;
        expect(summarizeGroups([entry])[0]).toMatchObject({ isAdmin: false, canSend: false });
    });

    it('a partir do getChat: permissões do grupo e número de membros', () => {
        const chat = { id: -1001, type: 'supergroup', title: 'Avisos', permissions: { can_send_messages: false } } as unknown as ChatFullInfo;
        const entry = entryFromChat(chat, 1520, { status: 'member', user: BOT } as ChatMember)!;
        expect(summarizeGroups([entry])[0]).toEqual({
            externalId: '-1001',
            name: 'Avisos',
            participantsCount: 1520,
            isAdmin: false,
            announce: true,
            canSend: false
        });
        expect(entryFromChat(chat, 1520, { status: 'left', user: BOT } as ChatMember)).toBeNull();
    });

    it('lista ordenada pelo nome e válida no contrato', () => {
        const groups = summarizeGroups([
            entryFromMemberUpdate(memberUpdate({ id: -1002, type: 'group', title: 'Zeta' }, { status: 'member' }))!,
            entryFromMemberUpdate(memberUpdate({ id: -1001, type: 'supergroup', title: 'Ágape' }, admin()))!
        ]);
        expect(groups.map((g) => g.name)).toEqual(['Ágape', 'Zeta']);
        const event = buildEvent({ tenantId: TENANT, channelId: CHANNEL, correlationId: CORRELATION }, 'groups.synced', 'groups:x', { groups });
        expect(() => assertValidEvent(event)).not.toThrow();
    });
});
