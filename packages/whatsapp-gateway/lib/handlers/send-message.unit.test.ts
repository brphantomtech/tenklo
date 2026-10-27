import { beforeEach, describe, expect, it } from 'vitest';

import { CommandError } from '../errors.js';
import { keys } from '../storage/redis.js';
import { CHANNEL, CORRELATION, FakeRedis, RecordingEvents, silentLogger, TENANT } from '../testing/fakes.js';
import { ChannelRegistry } from '../whatsapp/channel-registry.js';
import { handleSendMessage } from './send-message.js';

import type { CommandOf } from '../contracts/index.js';
import type { Storage } from '../storage/index.js';
import type { SendInput, SendResult } from '../whatsapp/channel-session.js';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { SendMessageDeps } from './send-message.js';

const COMMAND_ID = 'c0000000-0000-4000-8000-000000000001';
const MESSAGE_ID = 'a0000000-0000-4000-8000-000000000001';

const command = (externalId = '5511999990000'): CommandOf<'message.send'> => ({
    version: 1,
    commandId: COMMAND_ID,
    correlationId: CORRELATION,
    tenantId: TENANT,
    channelId: CHANNEL,
    type: 'message.send',
    payload: { messageId: MESSAGE_ID, to: { kind: 'contact', externalId }, content: { kind: 'text', text: 'Olá, Maria!' } },
    createdAt: '2026-10-01T12:00:00Z'
});

/** Sessão falsa: executa claim + "envio" e registra o que foi enviado. */
class FakeSession {
    isOpen = true;
    isTransient = false;
    sent: SendInput[] = [];
    failWith: CommandError | undefined;
    remembered: string[] = [];

    async send(input: SendInput): Promise<SendResult> {
        if (this.failWith) throw this.failWith;
        if (!(await input.claim())) {
            const { DuplicateSendError } = await import('../whatsapp/channel-session.js');
            throw new DuplicateSendError();
        }
        this.sent.push(input);
        return { providerMessageId: '3EB0AAAA', jid: '5511999990000@s.whatsapp.net' };
    }

    rememberSent(providerMessageId: string) {
        this.remembered.push(providerMessageId);
        return Promise.resolve();
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

    it('envia, publica SENT e grava o resultado para reentregas', async () => {
        expect(await run()).toBe('done');
        expect(session!.sent).toHaveLength(1);
        expect(session!.remembered).toEqual(['3EB0AAAA']);
        const [status] = events.ofType('message.status');
        expect(status!.payload).toEqual({
            messageId: MESSAGE_ID,
            status: 'SENT',
            providerMessageId: '3EB0AAAA',
            recipientExternalId: '5511999990000@s.whatsapp.net'
        });
        expect(status!.correlationId).toBe(CORRELATION);
        expect(JSON.parse(redis.data.get(keys.command(COMMAND_ID))!)).toMatchObject({ state: 'done' });
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
        expect(await run(command('123'))).toBe('done');
        expect(session!.sent).toHaveLength(0);
        expect(events.ofType('message.status')[0]!.payload).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_RECIPIENT' });
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
        session!.failWith = new CommandError('CHANNEL_NOT_CONNECTED', true, 'caiu');
        expect(await run()).toBe('retry');
        expect(redis.data.has(keys.command(COMMAND_ID))).toBe(false);

        session!.failWith = new CommandError('NOT_ON_WHATSAPP', false, 'o número não tem WhatsApp');
        expect(await run()).toBe('done');
        expect(events.ofType('message.status')[0]!.payload).toMatchObject({ status: 'FAILED', errorCode: 'NOT_ON_WHATSAPP' });
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
