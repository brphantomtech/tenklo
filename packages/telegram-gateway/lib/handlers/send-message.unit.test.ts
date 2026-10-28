import { beforeEach, describe, expect, it } from 'vitest';

import { CommandError } from '../errors.js';
import { handleSendMessage } from '../handlers/send-message.js';
import { keys } from '../storage/redis.js';
import { ChannelRegistry } from '../telegram/channel-registry.js';
import { DuplicateSendError } from '../telegram/channel-session.js';
import { CHANNEL, CORRELATION, FakeRedis, RecordingEvents, silentLogger, TENANT } from '../testing/fakes.js';

import type { CommandOf, MessageContent } from '../contracts/index.js';
import type { SendMessageDeps } from '../handlers/send-message.js';
import type { Storage } from '../storage/index.js';
import type { SendInput, SendResult } from '../telegram/channel-session.js';
import type { SessionManager } from '../telegram/session-manager.js';

const COMMAND_ID = 'c0000000-0000-4000-8000-000000000011';
const MESSAGE_ID = 'a0000000-0000-4000-8000-000000000011';

const command = (
    externalId = '123456789',
    content: MessageContent = { kind: 'text', text: 'Olá! Obrigado por falar com a gente.' },
    kind: 'contact' | 'group' = 'contact'
): CommandOf<'message.send'> => ({
    version: 1,
    commandId: COMMAND_ID,
    correlationId: CORRELATION,
    tenantId: TENANT,
    channelId: CHANNEL,
    type: 'message.send',
    payload: { messageId: MESSAGE_ID, to: { kind, externalId }, content },
    createdAt: '2026-10-14T12:01:00Z'
});

/** Sessão falsa: executa claim + "envio" e registra o que foi enviado. */
class FakeSession {
    isOpen = true;
    isTransient = false;
    sent: SendInput[] = [];
    failWith: CommandError | undefined;

    async send(input: SendInput): Promise<SendResult> {
        if (this.failWith) throw this.failWith;
        if (!(await input.claim())) throw new DuplicateSendError();
        this.sent.push(input);
        return { providerMessageId: `${input.chatId}:10`, chatId: input.chatId };
    }
}

describe('handleSendMessage', () => {
    let redis: FakeRedis;
    let events: RecordingEvents;
    let session: FakeSession | undefined;
    let deps: SendMessageDeps;

    beforeEach(() => {
        redis = new FakeRedis();
        events = new RecordingEvents();
        session = new FakeSession();
        deps = {
            manager: { get: () => session } as unknown as SessionManager,
            registry: new ChannelRegistry(redis.asRedis()),
            storage: {} as Storage,
            redis: redis.asRedis(),
            events,
            logger: silentLogger,
            mediaMaxBytes: 1024
        };
    });

    const run = (cmd = command(), canRetry = true) => handleSendMessage(cmd, { attempt: canRetry ? 0 : 3, canRetry }, deps);

    it('envia, publica SENT com o id do chat e grava o resultado para reentregas', async () => {
        expect(await run()).toBe('done');
        expect(session!.sent).toHaveLength(1);
        expect(session!.sent[0]).toMatchObject({ chatId: '123456789', isGroup: false, parts: [{ kind: 'text' }] });
        const [status] = events.ofType('message.status');
        expect(status!.payload).toEqual({
            messageId: MESSAGE_ID,
            status: 'SENT',
            providerMessageId: '123456789:10',
            recipientExternalId: '123456789'
        });
        expect(status!.providerEventId).toBe('123456789:10:SENT');
        expect(status!.channelType).toBe('TELEGRAM');
        expect(status!.correlationId).toBe(CORRELATION);
        expect(JSON.parse(redis.data.get(keys.command(COMMAND_ID))!)).toMatchObject({ state: 'done' });
    });

    it('grupo vai com o id negativo e o ritmo de grupo', async () => {
        expect(await run(command('-1001234567890', undefined, 'group'))).toBe('done');
        expect(session!.sent[0]).toMatchObject({ chatId: '-1001234567890', isGroup: true });
    });

    it('texto longo é planejado em várias partes', async () => {
        await run(command(undefined, { kind: 'text', text: `${'a'.repeat(4000)}\n${'b'.repeat(4000)}` }));
        expect(session!.sent[0]!.parts).toHaveLength(2);
    });

    it('reentrega de comando já enviado republica SENT sem enviar de novo', async () => {
        await run();
        await run();
        expect(session!.sent).toHaveLength(1);
        const statuses = events.ofType('message.status');
        expect(statuses).toHaveLength(2);
        expect(statuses[1]!.providerEventId).toBe(statuses[0]!.providerEventId);
    });

    it('destinatário inválido vira FAILED sem tocar no canal', async () => {
        expect(await run(command('5511999990000@s.whatsapp.net'))).toBe('done');
        expect(session!.sent).toHaveLength(0);
        expect(events.ofType('message.status')[0]!.payload).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_RECIPIENT' });
    });

    it('conteúdo incompatível vira FAILED antes de tocar no canal', async () => {
        const content: MessageContent = { kind: 'image', media: { objectKey: 'tenants/t/media/1', mimeType: 'application/pdf' } };
        expect(await run(command(undefined, content))).toBe('done');
        expect(session!.sent).toHaveLength(0);
        expect(events.ofType('message.status')[0]!.payload).toMatchObject({ status: 'FAILED', errorCode: 'UNSUPPORTED_CONTENT' });
    });

    it('canal desconectado e fora do registro falha na hora', async () => {
        session = undefined;
        expect(await run()).toBe('done');
        expect(events.ofType('message.status')[0]!.payload).toMatchObject({ status: 'FAILED', errorCode: 'CHANNEL_NOT_CONNECTED' });
    });

    it('canal que deveria estar conectado (no registro) volta para a fila enquanto der', async () => {
        session = undefined;
        await redis.hset(keys.registry(), CHANNEL, TENANT);
        expect(await run()).toBe('retry');
        expect(events.events).toHaveLength(0);
        expect(await run(command(), false)).toBe('done');
        expect(events.ofType('message.status')[0]!.payload).toMatchObject({ status: 'FAILED', errorCode: 'CHANNEL_NOT_CONNECTED' });
    });

    it('falha temporária devolve para a fila sem deixar marca; definitiva vira FAILED', async () => {
        session!.failWith = new CommandError('PROVIDER_ERROR', true, 'limite de envio do Telegram (aguardar 30s)');
        expect(await run()).toBe('retry');
        expect(redis.data.has(keys.command(COMMAND_ID))).toBe(false);

        session!.failWith = new CommandError('RECIPIENT_BLOCKED', false, 'Forbidden: bot was blocked by the user');
        expect(await run()).toBe('done');
        expect(events.ofType('message.status')[0]!.payload).toEqual({
            messageId: MESSAGE_ID,
            status: 'FAILED',
            errorCode: 'RECIPIENT_BLOCKED',
            errorMessage: 'Forbidden: bot was blocked by the user'
        });
        expect(events.ofType('message.status')[0]!.providerEventId).toBe(`failed:${COMMAND_ID}`);
    });

    it('comando marcado como em processamento por um processo que caiu vira FAILED (sem reenviar)', async () => {
        await redis.set(keys.command(COMMAND_ID), JSON.stringify({ state: 'processing' }));
        expect(await run()).toBe('done');
        expect(session!.sent).toHaveLength(0);
        expect(events.ofType('message.status')[0]!.payload).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' });
    });

    it('entrega duplicada que perde a vez no claim não publica nada', async () => {
        const first = run();
        const second = run();
        await Promise.all([first, second]);
        expect(session!.sent).toHaveLength(1);
        expect(events.ofType('message.status').filter((e) => e.payload.status === 'SENT')).toHaveLength(1);
        expect(events.ofType('message.status').filter((e) => e.payload.status === 'FAILED')).toHaveLength(0);
    });
});
