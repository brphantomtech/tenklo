import { describe, expect, it } from 'vitest';

import { assertValidEvent } from '../contracts/index.js';
import { buildEvent } from '../events/publisher.js';
import { inboundMediaKey, mapContent, mediaToDownload, receivedEventId, toReceivedPayload, truncate } from '../telegram/inbound.js';
import { CHANNEL, CORRELATION, TENANT } from '../testing/fakes.js';

import type { ReceivedPayload } from '../telegram/inbound.js';
import type { Message } from 'grammy/types';

const USER = { id: 123456789, is_bot: false, first_name: 'Fulano', last_name: 'de Tal', username: 'fulano' };
const GROUP = { id: -1001234567890, type: 'supergroup' as const, title: 'Clientes VIP' };
const TS = 1_791_288_000; // 2026-10-06T12:00:00Z

const dm = (over: Record<string, unknown> = {}): Message =>
    ({
        message_id: 1,
        date: TS,
        chat: { id: USER.id, type: 'private', first_name: USER.first_name },
        from: USER,
        text: '/start promo-outubro',
        ...over
    }) as unknown as Message;

const inGroup = (over: Record<string, unknown> = {}): Message => dm({ chat: GROUP, message_id: 77, text: 'Quero!', ...over });

/** Publica pelo mesmo caminho do worker: envelope + validação contra o schema do contrato. */
function publishable(msg: Message): ReceivedPayload {
    const result = toReceivedPayload(msg);
    if (!result.publish) throw new Error(`não publicou: ${result.reason}`);
    const event = buildEvent(
        { tenantId: TENANT, channelId: CHANNEL, correlationId: CORRELATION },
        'message.received',
        receivedEventId(result.payload.providerMessageId),
        result.payload
    );
    assertValidEvent(event);
    return result.payload;
}

const skipped = (msg: Message): string => {
    const result = toReceivedPayload(msg);
    if (result.publish) throw new Error('publicou');
    return result.reason;
};

describe('toReceivedPayload: conversa e remetente', () => {
    it('/start na conversa individual chega como texto, igual ao exemplo do contrato', () => {
        expect(publishable(dm())).toEqual({
            providerMessageId: '123456789:1',
            chat: { type: 'contact', externalId: '123456789' },
            from: { externalId: '123456789', phone: null, name: 'Fulano de Tal', username: 'fulano' },
            sentAt: '2026-10-06T12:00:00.000Z',
            content: { kind: 'text', text: '/start promo-outubro' },
            quotedProviderMessageId: null,
            media: null
        });
    });

    it('mensagem em supergrupo: chat é o grupo, from é o participante', () => {
        const payload = publishable(inGroup());
        expect(payload.chat).toEqual({ type: 'group', externalId: '-1001234567890' });
        expect(payload.from.externalId).toBe('123456789');
        expect(payload.providerMessageId).toBe('-1001234567890:77');
    });

    it('grupo comum também é group', () => {
        expect(publishable(inGroup({ chat: { id: -4001234567, type: 'group', title: 'Família' } })).chat.type).toBe('group');
    });

    it('sem sobrenome nem username', () => {
        const payload = publishable(dm({ from: { id: 42, is_bot: false, first_name: 'Ana' }, chat: { id: 42, type: 'private', first_name: 'Ana' } }));
        expect(payload.from).toEqual({ externalId: '42', phone: null, name: 'Ana', username: null });
    });

    it('resposta com citação aponta para <chatId>:<messageId> da mensagem respondida', () => {
        const payload = publishable(inGroup({ reply_to_message: { message_id: 55, date: TS, chat: GROUP } }));
        expect(payload.quotedProviderMessageId).toBe('-1001234567890:55');
    });

    it('mensagem de tópico (resposta à criação do tópico) não é citação', () => {
        const payload = publishable(
            inGroup({
                is_topic_message: true,
                message_thread_id: 3,
                reply_to_message: { message_id: 3, date: TS, chat: GROUP, forum_topic_created: { name: 'Dúvidas', icon_color: 1 } }
            })
        );
        expect(payload.quotedProviderMessageId).toBeNull();
    });
});

describe('toReceivedPayload: o que não é publicado', () => {
    it('mensagens de bots, inclusive do próprio', () => {
        expect(skipped(inGroup({ from: { id: 7012345678, is_bot: true, first_name: 'Loja' } }))).toBe('bot');
    });

    it('posts de canal', () => {
        expect(skipped(dm({ chat: { id: -1009876543210, type: 'channel', title: 'Novidades' } }))).toBe('canal');
    });

    it('enviada em nome de um chat (administrador anônimo, post automático do canal)', () => {
        expect(skipped(inGroup({ sender_chat: GROUP, from: { id: 777000, is_bot: false, first_name: 'Telegram' } }))).toBe('enviada em nome de um chat');
    });

    it.each([
        ['new_chat_members', { new_chat_members: [USER] }],
        ['left_chat_member', { left_chat_member: USER }],
        ['pinned_message', { pinned_message: { message_id: 1, date: TS, chat: GROUP } }],
        ['new_chat_title', { new_chat_title: 'Outro nome' }],
        ['migrate_to_chat_id', { migrate_to_chat_id: -1001 }],
        ['forum_topic_created', { forum_topic_created: { name: 'x', icon_color: 1 } }],
        ['video_chat_started', { video_chat_started: {} }]
    ])('aviso de serviço: %s', (_name, fields) => {
        expect(skipped(inGroup({ text: undefined, ...fields }))).toBe('serviço');
    });
});

describe('mapContent', () => {
    const content = (fields: Record<string, unknown>) => {
        const result = mapContent(dm({ text: undefined, ...fields }));
        if (!result.ok) throw new Error(result.reason);
        return { kind: result.kind, text: result.text };
    };
    const photo = [
        { file_id: 'p-small', file_unique_id: 'a', width: 90, height: 90, file_size: 1_000 },
        { file_id: 'p-big', file_unique_id: 'b', width: 1280, height: 1280, file_size: 200_000 }
    ];

    it.each([
        ['foto com legenda', { photo, caption: 'olha' }, { kind: 'image', text: 'olha' }],
        ['vídeo', { video: { file_id: 'v', file_unique_id: 'v', width: 1, height: 1, duration: 1 } }, { kind: 'video', text: null }],
        ['GIF', { animation: { file_id: 'g', file_unique_id: 'g', width: 1, height: 1, duration: 1 } }, { kind: 'video', text: null }],
        ['vídeo redondo', { video_note: { file_id: 'n', file_unique_id: 'n', length: 1, duration: 1 } }, { kind: 'video', text: null }],
        ['voz', { voice: { file_id: 'o', file_unique_id: 'o', duration: 3 } }, { kind: 'audio', text: null }],
        ['áudio', { audio: { file_id: 'a', file_unique_id: 'a', duration: 3 } }, { kind: 'audio', text: null }],
        ['documento', { document: { file_id: 'd', file_unique_id: 'd' }, caption: 'nota' }, { kind: 'document', text: 'nota' }],
        [
            'figurinha',
            { sticker: { file_id: 's', file_unique_id: 's', type: 'regular', width: 1, height: 1, is_animated: false, is_video: false, emoji: '😀' } },
            { kind: 'sticker', text: '😀' }
        ],
        ['localização', { location: { latitude: -23.5, longitude: -46.6 } }, { kind: 'location', text: null }],
        [
            'local',
            { location: { latitude: -23.5, longitude: -46.6 }, venue: { location: { latitude: 0, longitude: 0 }, title: 'Loja', address: 'Rua A, 1' } },
            { kind: 'location', text: 'Loja - Rua A, 1' }
        ],
        ['contato', { contact: { phone_number: '+5511999990000', first_name: 'Maria', last_name: 'Silva' } }, { kind: 'contact', text: 'Maria Silva' }],
        ['enquete', { poll: { id: '1', question: 'Qual?', options: [] } }, { kind: 'other', text: 'Qual?' }],
        ['dado', { dice: { emoji: '🎲', value: 3 } }, { kind: 'other', text: null }]
    ])('%s', (_name, fields, expected) => {
        expect(content(fields)).toEqual(expected);
    });

    it('texto truncado em 4096 caracteres, sem cortar emoji', () => {
        const long = '😀'.repeat(5000);
        expect(Array.from(content({ text: long }).text!)).toHaveLength(4096);
        expect(truncate('abc', 2)).toBe('ab');
    });
});

describe('mediaToDownload', () => {
    const media = (fields: Record<string, unknown>) => mediaToDownload(dm({ text: undefined, ...fields }));

    it('foto: o maior tamanho, como JPEG', () => {
        const photo = [
            { file_id: 'p-small', file_unique_id: 'a', width: 90, height: 90, file_size: 1_000 },
            { file_id: 'p-big', file_unique_id: 'b', width: 1280, height: 1280, file_size: 200_000 }
        ];
        expect(media({ photo })).toEqual({ fileId: 'p-big', contentType: 'image/jpeg', fileName: null, sizeBytes: 200_000 });
    });

    it('documento com nome e tipo', () => {
        expect(media({ document: { file_id: 'd', file_unique_id: 'd', file_name: 'pedido.pdf', mime_type: 'application/pdf', file_size: 10 } })).toEqual({
            fileId: 'd',
            contentType: 'application/pdf',
            fileName: 'pedido.pdf',
            sizeBytes: 10
        });
    });

    it('voz sem mime_type cai em audio/ogg; figurinha animada é tgsticker', () => {
        expect(media({ voice: { file_id: 'o', file_unique_id: 'o', duration: 3 } })?.contentType).toBe('audio/ogg');
        expect(
            media({ sticker: { file_id: 's', file_unique_id: 's', type: 'regular', width: 1, height: 1, is_animated: true, is_video: false } })?.contentType
        ).toBe('application/x-tgsticker');
    });

    it('texto e localização não têm arquivo', () => {
        expect(mediaToDownload(dm())).toBeUndefined();
        expect(media({ location: { latitude: 0, longitude: 0 } })).toBeUndefined();
    });

    it('chave no bucket segue o contrato', () => {
        const payload = publishable(dm({ text: undefined, photo: [{ file_id: 'p', file_unique_id: 'p', width: 1, height: 1 }] }));
        const objectKey = inboundMediaKey(TENANT, CHANNEL, payload.providerMessageId);
        expect(objectKey).toBe(`tenants/${TENANT}/inbox/${CHANNEL}/123456789_1`);
        const event = buildEvent(
            { tenantId: TENANT, channelId: CHANNEL, correlationId: CORRELATION },
            'message.received',
            receivedEventId(payload.providerMessageId),
            {
                ...payload,
                media: { objectKey, contentType: 'image/jpeg', fileName: null, sizeBytes: 10 }
            }
        );
        expect(() => assertValidEvent(event)).not.toThrow();
    });
});
