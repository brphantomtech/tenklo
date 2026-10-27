import { describe, expect, it } from 'vitest';

import { assertValidEvent } from '../contracts/index.js';
import { buildEvent } from '../events/publisher.js';
import { CHANNEL, CORRELATION, TENANT } from '../testing/fakes.js';
import { inboundMediaKey, lidsToResolve, mapContent, mediaToDownload, normalizeJid, receivedEventId, toReceivedPayload, truncate } from './inbound.js';

import type { InboundMessage, ReceivedPayload, SelfAccount } from './inbound.js';

const PN = '5511999990000@s.whatsapp.net';
const LID = '123456789012345@lid';
const GROUP = '120363000000000000@g.us';
const TS = 1_791_288_000; // 2026-10-06T12:00:00Z

const dm = (over: Partial<InboundMessage> = {}, key: Partial<InboundMessage['key']> = {}): InboundMessage => ({
    key: { remoteJid: PN, fromMe: false, id: '3EB0C767D26A1D8E4F', ...key },
    message: { conversation: 'Tenho interesse' },
    messageTimestamp: TS,
    pushName: 'Fulano',
    ...over
});

const inGroup = (over: Partial<InboundMessage> = {}, key: Partial<InboundMessage['key']> = {}): InboundMessage =>
    dm(over, { remoteJid: GROUP, participant: '5511988880000@s.whatsapp.net', ...key });

/** Publica pelo mesmo caminho do worker: envelope + validação contra o schema do contrato. */
const SELF: SelfAccount = { externalId: '5511900000000@s.whatsapp.net', phone: '5511900000000' };

function publishable(msg: InboundMessage, pnByLid?: Map<string, string>, self?: SelfAccount): ReceivedPayload {
    const result = toReceivedPayload(msg, pnByLid, undefined, self);
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

const skipped = (msg: InboundMessage): string => {
    const result = toReceivedPayload(msg);
    if (result.publish) throw new Error('publicou');
    return result.reason;
};

describe('toReceivedPayload: conteúdo', () => {
    it('texto em conversa individual', () => {
        expect(publishable(dm())).toEqual({
            providerMessageId: '3EB0C767D26A1D8E4F',
            chat: { type: 'contact', externalId: PN },
            from: { externalId: PN, phone: '5511999990000', name: 'Fulano' },
            sentAt: '2026-10-06T12:00:00.000Z',
            content: { kind: 'text', text: 'Tenho interesse' },
            quotedProviderMessageId: null,
            fromMe: false,
            media: null
        });
        expect(receivedEventId('ABC')).toBe('received:ABC');
    });

    it('texto estendido e timestamp Long da Baileys', () => {
        const payload = publishable(dm({ message: { extendedTextMessage: { text: 'Oi https://x.com' } }, messageTimestamp: { toNumber: () => TS } }));
        expect(payload.content).toEqual({ kind: 'text', text: 'Oi https://x.com' });
        expect(payload.sentAt).toBe('2026-10-06T12:00:00.000Z');
    });

    it('legenda de imagem, vídeo e documento; áudio sem texto', () => {
        expect(publishable(dm({ message: { imageMessage: { caption: 'Segue o comprovante' } } })).content).toEqual({
            kind: 'image',
            text: 'Segue o comprovante'
        });
        expect(publishable(dm({ message: { videoMessage: {} } })).content).toEqual({ kind: 'video', text: null });
        expect(publishable(dm({ message: { documentWithCaptionMessage: { message: { documentMessage: { caption: 'Contrato' } } } } })).content).toEqual({
            kind: 'document',
            text: 'Contrato'
        });
        expect(publishable(dm({ message: { audioMessage: { ptt: true } } })).content).toEqual({ kind: 'audio', text: null });
    });

    it('desembrulha mensagem temporária e de visualização única', () => {
        const ephemeral = dm({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'some em 24h' } } } } });
        expect(publishable(ephemeral).content).toEqual({ kind: 'text', text: 'some em 24h' });
        const viewOnce = dm({ message: { viewOnceMessageV2: { message: { imageMessage: { caption: 'uma vez' } } } } });
        expect(publishable(viewOnce).content).toEqual({ kind: 'image', text: 'uma vez' });
    });

    it('figurinha, localização, contato e tipos desconhecidos', () => {
        expect(mapContent({ stickerMessage: {} })).toMatchObject({ ok: true, kind: 'sticker', text: null });
        expect(mapContent({ locationMessage: { name: 'Loja', address: 'Rua A, 1' } })).toMatchObject({ kind: 'location', text: 'Loja - Rua A, 1' });
        expect(mapContent({ locationMessage: { degreesLatitude: 1 } })).toMatchObject({ kind: 'location', text: null });
        expect(mapContent({ contactMessage: { displayName: 'Beltrano' } })).toMatchObject({ kind: 'contact', text: 'Beltrano' });
        expect(mapContent({ productMessage: {} })).toMatchObject({ ok: true, kind: 'other', text: null });
        expect(mapContent({ pollCreationMessageV3: { name: 'Qual horário?' } })).toMatchObject({ kind: 'other', text: 'Qual horário?' });
    });

    it('resposta de botão ou lista vira texto com a opção escolhida', () => {
        expect(mapContent({ buttonsResponseMessage: { selectedDisplayText: 'Quero' } })).toMatchObject({ kind: 'text', text: 'Quero' });
        expect(mapContent({ listResponseMessage: { title: 'Plano B' } })).toMatchObject({ kind: 'text', text: 'Plano B' });
    });

    it('trunca o texto em 4096 caracteres sem cortar emoji', () => {
        const long = 'a'.repeat(4095) + '😀😀';
        const payload = publishable(dm({ message: { conversation: long } }));
        expect(Array.from(payload.content.text!)).toHaveLength(4096);
        expect(payload.content.text!.endsWith('a😀')).toBe(true);
        expect(truncate('😀'.repeat(3), 2)).toBe('😀😀');
    });
});

describe('toReceivedPayload: citação e reação', () => {
    it('resposta com citação em grupo: chat é o grupo e from é o participante', () => {
        const msg = inGroup(
            {
                pushName: 'Ciclana',
                message: { extendedTextMessage: { text: 'Quero participar!', contextInfo: { stanzaId: '3EB0A1B2C3D4E5F6', participant: PN } } }
            },
            { id: '3EB0D1E2F3A4B5C6D7E8' }
        );
        expect(publishable(msg)).toMatchObject({
            chat: { type: 'group', externalId: GROUP },
            from: { externalId: '5511988880000@s.whatsapp.net', phone: '5511988880000', name: 'Ciclana' },
            content: { kind: 'text', text: 'Quero participar!' },
            quotedProviderMessageId: '3EB0A1B2C3D4E5F6'
        });
    });

    it('citação numa mídia com legenda', () => {
        const msg = dm({ message: { imageMessage: { caption: 'esta?', contextInfo: { stanzaId: 'Q1' } } } });
        expect(publishable(msg).quotedProviderMessageId).toBe('Q1');
    });

    it('reação: kind reaction, texto = emoji e a mensagem reagida como citada', () => {
        const msg = dm({ message: { reactionMessage: { text: '👍', key: { id: '3EB0A1B2C3D4E5F6', fromMe: true, remoteJid: PN } } } });
        expect(publishable(msg)).toMatchObject({ content: { kind: 'reaction', text: '👍' }, quotedProviderMessageId: '3EB0A1B2C3D4E5F6' });
    });

    it('reação removida (texto vazio) não é publicada', () => {
        expect(skipped(dm({ message: { reactionMessage: { text: '', key: { id: 'X' } } } }))).toBe('reação removida');
    });
});

describe('toReceivedPayload: @lid', () => {
    it('conversa por @lid com o telefone no remoteJidAlt usa o JID do telefone', () => {
        const payload = publishable(dm({}, { remoteJid: LID, remoteJidAlt: '5511999990000:3@s.whatsapp.net' }));
        expect(payload.chat).toEqual({ type: 'contact', externalId: PN });
        expect(payload.from).toMatchObject({ externalId: PN, phone: '5511999990000' });
        expect(lidsToResolve(dm({}, { remoteJid: LID, remoteJidAlt: PN }))).toEqual([]);
    });

    it('@lid sem alternativo é resolvido pelo mapeamento da sessão', () => {
        const msg = dm({}, { remoteJid: `123456789012345:7@lid` });
        expect(lidsToResolve(msg)).toEqual([LID]);
        const payload = publishable(msg, new Map([[LID, '5521988887777:0@s.whatsapp.net']]));
        expect(payload.chat.externalId).toBe('5521988887777@s.whatsapp.net');
        expect(payload.from).toMatchObject({ externalId: '5521988887777@s.whatsapp.net', phone: '5521988887777' });
    });

    it('@lid sem mapeamento sai com o próprio @lid e phone null', () => {
        const payload = publishable(dm({ pushName: null }, { remoteJid: LID }));
        expect(payload.chat).toEqual({ type: 'contact', externalId: LID });
        expect(payload.from).toEqual({ externalId: LID, phone: null, name: null });
    });

    it('participante @lid em grupo: participantAlt ou mapeamento', () => {
        const withAlt = inGroup({}, { participant: LID, participantAlt: '5511977770000@s.whatsapp.net' });
        expect(publishable(withAlt).from).toMatchObject({ externalId: '5511977770000@s.whatsapp.net', phone: '5511977770000' });
        expect(publishable(withAlt).chat.externalId).toBe(GROUP);

        const noAlt = inGroup({}, { participant: LID });
        expect(lidsToResolve(noAlt)).toEqual([LID]);
        expect(publishable(noAlt, new Map([[LID, '5511977770000@s.whatsapp.net']])).from.phone).toBe('5511977770000');
    });
});

describe('toReceivedPayload: descartes', () => {
    it('mensagens próprias, status, broadcast e canais', () => {
        expect(skipped(dm({}, { fromMe: true }))).toBe('própria');
        expect(skipped(dm({}, { remoteJid: 'status@broadcast', participant: PN }))).toBe('status ou broadcast');
        expect(skipped(dm({}, { remoteJid: '1234567890@broadcast' }))).toBe('status ou broadcast');
        expect(skipped(dm({}, { remoteJid: '120363999999999999@newsletter' }))).toBe('canal');
        expect(skipped(inGroup({ message: { groupStatusMessageV2: { message: { imageMessage: {} } } } }))).toBe('status');
    });

    it('protocolo: apagar, editar, configuração de temporárias, chaves, fixar, voto de enquete', () => {
        const protocol = (message: NonNullable<InboundMessage['message']>) => skipped(dm({ message }));
        expect(protocol({ protocolMessage: { type: 0, key: { id: 'X' } } })).toBe('protocolo ou sistema'); // REVOKE
        expect(protocol({ editedMessage: { message: { protocolMessage: { type: 14, editedMessage: { conversation: 'novo' } } } } })).toBe(
            'protocolo ou sistema'
        );
        expect(protocol({ protocolMessage: { type: 3, ephemeralExpiration: 86400 } })).toBe('protocolo ou sistema');
        expect(protocol({ senderKeyDistributionMessage: { groupId: GROUP }, messageContextInfo: {} })).toBe('protocolo ou sistema');
        expect(protocol({ pinInChatMessage: { type: 1 } })).toBe('protocolo ou sistema');
        expect(protocol({ pollUpdateMessage: {} })).toBe('protocolo ou sistema');
        expect(protocol({ encReactionMessage: {} })).toBe('protocolo ou sistema');
    });

    it('sistema: stubs (entrou no grupo, não decifrada) e mensagem sem conteúdo', () => {
        expect(skipped(inGroup({ message: null, messageStubType: 27 }))).toBe('sistema');
        expect(skipped(dm({ message: null, messageStubType: 2 }))).toBe('sistema');
        expect(skipped(dm({ message: null }))).toBe('sem conteúdo');
    });

    it('sem id, Meta AI ou remetente desconhecido', () => {
        expect(skipped(dm({}, { id: null }))).toBe('sem id');
        expect(skipped(dm({}, { remoteJid: '13135550002@bot' }))).toBe('conversa não suportada');
        expect(skipped(inGroup({}, { participant: null }))).toBe('remetente desconhecido');
    });
});

describe('toReceivedPayload: enviadas pelo próprio número em outro aparelho', () => {
    it('conversa individual: fromMe, chat é o contato e from é o número conectado', () => {
        const payload = publishable(dm({ pushName: 'Eu mesmo', message: { conversation: 'Já te mando' } }, { fromMe: true }), undefined, SELF);
        expect(payload.fromMe).toBe(true);
        expect(payload.chat).toEqual({ type: 'contact', externalId: PN });
        expect(payload.from).toEqual({ externalId: SELF.externalId, phone: SELF.phone, name: null });
        expect(payload.content).toEqual({ kind: 'text', text: 'Já te mando' });
    });

    it('em grupo ou sem saber o número conectado, não é publicada', () => {
        expect(toReceivedPayload(inGroup({}, { fromMe: true }), undefined, undefined, SELF)).toEqual({ publish: false, reason: 'própria' });
        expect(skipped(dm({}, { fromMe: true }))).toBe('própria');
    });

    it('as do contato saem com fromMe false e media null (a sessão preenche a mídia)', () => {
        const payload = publishable(dm());
        expect(payload.fromMe).toBe(false);
        expect(payload.media).toBeNull();
    });
});

describe('mediaToDownload', () => {
    it('tipo, nome (só documento) e tamanho, desembrulhando temporária', () => {
        expect(mediaToDownload({ imageMessage: { mimetype: 'image/jpeg', fileLength: 2048 } })).toEqual({
            contentType: 'image/jpeg',
            fileName: null,
            sizeBytes: 2048
        });
        expect(
            mediaToDownload({
                documentWithCaptionMessage: {
                    message: {
                        documentMessage: { mimetype: 'application/pdf', fileName: ' nota.pdf ', fileLength: { toNumber: () => 10 } as unknown as number }
                    }
                }
            }) // Long do protobuf
        ).toEqual({ contentType: 'application/pdf', fileName: 'nota.pdf', sizeBytes: 10 });
        expect(mediaToDownload({ audioMessage: { mimetype: 'audio/ogg; codecs=opus' } })).toEqual({
            contentType: 'audio/ogg',
            fileName: null,
            sizeBytes: undefined
        });
        expect(mediaToDownload({ stickerMessage: {} })?.contentType).toBe('image/webp');
    });

    it('texto, localização e contato não têm arquivo', () => {
        expect(mediaToDownload({ conversation: 'oi' })).toBeUndefined();
        expect(mediaToDownload({ locationMessage: { degreesLatitude: 1 } })).toBeUndefined();
        expect(mediaToDownload(null)).toBeUndefined();
    });

    it('a chave no bucket passa no contrato', () => {
        const payload = {
            ...publishable(dm({ message: { imageMessage: { caption: 'foto' } } })),
            media: { objectKey: inboundMediaKey(TENANT, CHANNEL, '3EB0C767D26A1D8E4F'), contentType: 'image/jpeg', fileName: null, sizeBytes: 2048 }
        };
        expect(() =>
            assertValidEvent(buildEvent({ tenantId: TENANT, channelId: CHANNEL, correlationId: CORRELATION }, 'message.received', 'received:x', payload))
        ).not.toThrow();
    });
});

describe('normalizeJid', () => {
    it('tira o aparelho e unifica domínios', () => {
        expect(normalizeJid('5511999990000:12@s.whatsapp.net')).toBe(PN);
        expect(normalizeJid('5511999990000@c.us')).toBe(PN);
        expect(normalizeJid('5511999990000@hosted')).toBe(PN);
        expect(normalizeJid('123456789012345:3@hosted.lid')).toBe(LID);
        expect(normalizeJid(GROUP)).toBe(GROUP);
        expect(normalizeJid('x@bot')).toBeUndefined();
        expect(normalizeJid(undefined)).toBeUndefined();
    });
});
