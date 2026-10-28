import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../env.js';
import { CommandError } from '../errors.js';
import { keys } from '../storage/redis.js';
import { ChannelRegistry } from '../telegram/channel-registry.js';
import { tokenKey } from '../telegram/channel-session.js';
import { planMessage } from '../telegram/content.js';
import { CredentialsCipher } from '../telegram/credentials.js';
import { SessionManager } from '../telegram/session-manager.js';
import { CHANNEL, CORRELATION, FakeRedis, FakeTelegram, MemoryStorage, RecordingEvents, silentLogger, TENANT, until, updatesQueue } from '../testing/fakes.js';

import type { Storage } from '../storage/index.js';
import type { SendInput } from '../telegram/channel-session.js';

const KEY = 'example-channel-credentials-key-0123456789';
const TOKEN = '7012345678:AAHfakeTokenForExamples_0123456789abc';
const BOT = {
    id: 7012345678,
    is_bot: true,
    first_name: 'Loja Exemplo',
    username: 'LojaExemploBot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false
};
const USER = { id: 123456789, is_bot: false, first_name: 'Fulano', last_name: 'de Tal', username: 'fulano' };

const config = loadConfig({
    TELEGRAM_GATEWAY_SECRET: KEY,
    TELEGRAM_GATEWAY_EVENTS_URL: 'http://localhost:3003/internal/telegram/events',
    TELEGRAM_GATEWAY_INSTANCE_ID: 'teste',
    NANGO_REDIS_URL: 'redis://localhost',
    TELEGRAM_S3_ENDPOINT: 'http://localhost:9000',
    TELEGRAM_S3_ACCESS_KEY: 'x',
    TELEGRAM_S3_SECRET_KEY: 'x',
    TELEGRAM_S3_BUCKET: 'media',
    TELEGRAM_SEND_MIN_INTERVAL_MS: '0',
    TELEGRAM_PER_CHAT_INTERVAL_MS: '0',
    TELEGRAM_PER_GROUP_INTERVAL_MS: '0'
});

describe('ChannelSession com a Bot API simulada', () => {
    const credentials = new CredentialsCipher(KEY);
    const sealed = credentials.seal(TOKEN, CHANNEL);
    let redis: FakeRedis;
    let events: RecordingEvents;
    let storage: MemoryStorage;
    let telegram: FakeTelegram;
    let manager: SessionManager;

    beforeEach(() => {
        redis = new FakeRedis();
        events = new RecordingEvents();
        storage = new MemoryStorage();
        telegram = new FakeTelegram().on('getMe', () => ({ result: BOT })).on('getUpdates', updatesQueue([]));
        manager = new SessionManager({
            config,
            logger: silentLogger,
            redis: redis.asRedis(),
            storage: storage as unknown as Storage,
            credentials,
            events,
            registry: new ChannelRegistry(redis.asRedis()),
            createApi: telegram.createApi
        });
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    const statuses = () => events.ofType('channel.status').map((e) => e.payload);
    const connect = async () => {
        await manager.connect(TENANT, CHANNEL, CORRELATION, sealed);
        await until(() => manager.get(CHANNEL)?.isOpen === true);
    };

    it('connect valida o token, guarda o valor cifrado e publica CONNECTED com a conta do bot', async () => {
        await connect();
        expect(statuses()).toEqual([
            { status: 'CONNECTING' },
            { status: 'CONNECTED', account: { externalId: '7012345678', name: 'Loja Exemplo', username: 'LojaExemploBot' } }
        ]);
        expect(storage.sessions.get(tokenKey(TENANT, CHANNEL))?.toString()).toBe(sealed);
        expect(await redis.hexists(keys.registry(), CHANNEL)).toBe(1);
        expect(telegram.callsOf('deleteWebhook')).toHaveLength(1);
        await until(() => telegram.callsOf('getUpdates').length > 0);
        expect(telegram.callsOf('getUpdates')[0]!.payload).toMatchObject({ timeout: 30, allowed_updates: ['message', 'my_chat_member'] });
    });

    it('token revogado (401) publica DISCONNECTED com SESSION_INVALID e não guarda nada', async () => {
        telegram.on('getMe', () => ({ error_code: 401, description: 'Unauthorized' }));
        await manager.connect(TENANT, CHANNEL, CORRELATION, sealed);
        await until(() => statuses().length === 2);
        expect(statuses()[1]).toEqual({ status: 'DISCONNECTED', reason: 'SESSION_INVALID' });
        expect(storage.sessions.size).toBe(0);
        expect(await redis.hexists(keys.registry(), CHANNEL)).toBe(0);
        expect(manager.get(CHANNEL)).toBeUndefined();
    });

    it('valor que não abre com a chave publica SESSION_INVALID sem chamar o Telegram', async () => {
        await manager.connect(TENANT, CHANNEL, CORRELATION, new CredentialsCipher(KEY + 'outra').seal(TOKEN, CHANNEL));
        expect(statuses()).toEqual([{ status: 'DISCONNECTED', reason: 'SESSION_INVALID' }]);
        expect(telegram.calls).toHaveLength(0);
    });

    it('connect sem token e sem token salvo é comando inválido', async () => {
        await expect(manager.connect(TENANT, CHANNEL, CORRELATION)).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
    });

    it('outro leitor do mesmo bot (409) encerra com CONNECTION_REPLACED', async () => {
        telegram.on('getUpdates', () => ({ error_code: 409, description: 'Conflict: terminated by other getUpdates request' }));
        await manager.connect(TENANT, CHANNEL, CORRELATION, sealed);
        await until(() => statuses().some((s) => s.status === 'DISCONNECTED'));
        expect(statuses().at(-1)).toEqual({ status: 'DISCONNECTED', reason: 'CONNECTION_REPLACED' });
        // O token continua salvo: o usuário pode reconectar depois de parar o outro sistema.
        expect(storage.sessions.size).toBe(1);
    });

    it('mensagem recebida vira message.received e o offset só avança depois da publicação', async () => {
        telegram.on(
            'getUpdates',
            updatesQueue([
                [
                    {
                        update_id: 500,
                        message: {
                            message_id: 1,
                            date: 1_791_288_000,
                            chat: { id: USER.id, type: 'private', first_name: 'Fulano' },
                            from: USER,
                            text: '/start promo'
                        }
                    }
                ]
            ])
        );
        await connect();
        await until(() => events.ofType('message.received').length === 1);
        const [received] = events.ofType('message.received');
        expect(received!.providerEventId).toBe('received:123456789:1');
        expect(received!.payload.content).toEqual({ kind: 'text', text: '/start promo' });
        await until(() => redis.data.get(keys.offset(CHANNEL)) === '501');
        await until(() => telegram.callsOf('getUpdates').some((c) => c.payload['offset'] === 501));
    });

    it('foto recebida é baixada e gravada no bucket antes de publicar', async () => {
        const downloads: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            downloads.push(url);
            return Promise.resolve(new Response(Buffer.from('jpeg'), { headers: { 'content-length': '4' } }));
        });
        telegram
            .on(
                'getUpdates',
                updatesQueue([
                    [
                        {
                            update_id: 700,
                            message: {
                                message_id: 5,
                                date: 1_791_288_000,
                                chat: { id: USER.id, type: 'private', first_name: 'Fulano' },
                                from: USER,
                                photo: [{ file_id: 'foto-grande', file_unique_id: 'u', width: 800, height: 600, file_size: 4 }],
                                caption: 'Olha esse'
                            }
                        }
                    ]
                ])
            )
            .on('getFile', () => ({ result: { file_id: 'foto-grande', file_unique_id: 'u', file_path: 'photos/file_1.jpg' } }));
        try {
            await connect();
            await until(() => events.ofType('message.received').length === 1);
        } finally {
            vi.unstubAllGlobals();
        }
        const objectKey = `tenants/${TENANT}/inbox/${CHANNEL}/123456789_5`;
        expect(events.ofType('message.received')[0]!.payload).toMatchObject({
            content: { kind: 'image', text: 'Olha esse' },
            media: { objectKey, contentType: 'image/jpeg', fileName: null, sizeBytes: 4 }
        });
        expect(storage.media.get(objectKey)).toEqual({ body: Buffer.from('jpeg'), contentType: 'image/jpeg' });
        expect(downloads).toEqual([`https://api.telegram.org/file/bot${TOKEN}/photos/file_1.jpg`]);
    });

    it('bot adicionado a um grupo atualiza a lista e publica groups.synced', async () => {
        telegram
            .on(
                'getUpdates',
                updatesQueue([
                    [
                        {
                            update_id: 600,
                            my_chat_member: {
                                chat: { id: -1001234567890, type: 'supergroup', title: 'Novidades da Loja' },
                                from: USER,
                                date: 1,
                                old_chat_member: { status: 'left', user: BOT },
                                new_chat_member: { status: 'administrator', user: BOT, can_post_messages: true }
                            }
                        }
                    ]
                ])
            )
            .on('getChat', () => ({
                result: { id: -1001234567890, type: 'supergroup', title: 'Novidades da Loja', permissions: { can_send_messages: false } }
            }))
            .on('getChatMemberCount', () => ({ result: 1520 }))
            .on('getChatMember', () => ({ result: { status: 'administrator', user: BOT, can_post_messages: true } }));
        await connect();
        await until(() => events.ofType('groups.synced').length === 1);
        const [synced] = events.ofType('groups.synced');
        expect(synced!.providerEventId).toMatch(/^groups:[0-9a-f-]{36}$/);
        expect(synced!.payload.groups).toEqual([
            { externalId: '-1001234567890', name: 'Novidades da Loja', participantsCount: 1520, isAdmin: true, announce: true, canSend: true }
        ]);

        // groups.sync: o bot foi removido do grupo enquanto o worker estava fora.
        telegram.on('getChat', () => ({ error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' }));
        expect(await manager.get(CHANNEL)!.syncGroups()).toEqual([]);
        expect(await redis.hgetall(keys.groups(CHANNEL))).toEqual({});
    });

    describe('envio', () => {
        const input = (text: string, chatId = '123456789'): SendInput => ({
            chatId,
            isGroup: chatId.startsWith('-'),
            parts: planMessage({ kind: 'text', text }, 1024),
            openMedia: (key) => storage.openMedia(key),
            claim: () => Promise.resolve(true)
        });

        it('texto: sendMessage e providerMessageId <chatId>:<message_id>', async () => {
            telegram.on('sendMessage', (p) => ({ result: { message_id: 10, date: 1, chat: { id: Number(p['chat_id']), type: 'private' }, text: p['text'] } }));
            await connect();
            expect(await manager.get(CHANNEL)!.send(input('Olá!'))).toEqual({ providerMessageId: '123456789:10', chatId: '123456789' });
            expect(telegram.callsOf('sendMessage')[0]!.payload).toMatchObject({ chat_id: '123456789', text: 'Olá!' });
        });

        it('texto longo sai em várias mensagens e reporta a primeira', async () => {
            let id = 20;
            telegram.on('sendMessage', () => ({ result: { message_id: id++, date: 1, chat: { id: 1, type: 'private' } } }));
            await connect();
            const result = await manager.get(CHANNEL)!.send(input(`${'a'.repeat(4000)}\n${'b'.repeat(4000)}`));
            expect(result.providerMessageId).toBe('123456789:20');
            expect(telegram.callsOf('sendMessage')).toHaveLength(2);
        });

        it('documento: upload em stream com o nome do arquivo', async () => {
            await storage.putMedia('tenants/t/media/1', Buffer.from('%PDF'), 'application/pdf');
            telegram.on('sendDocument', () => ({ result: { message_id: 30, date: 1, chat: { id: 1, type: 'private' } } }));
            await connect();
            const parts = planMessage(
                { kind: 'document', media: { objectKey: 'tenants/t/media/1', mimeType: 'application/pdf', fileName: 'catalogo.pdf' }, caption: 'Catálogo' },
                1024
            );
            const result = await manager.get(CHANNEL)!.send({ ...input('x'), parts });
            expect(result.providerMessageId).toBe('123456789:30');
            const payload = telegram.callsOf('sendDocument')[0]!.payload;
            expect(payload).toMatchObject({ chat_id: '123456789', caption: 'Catálogo' });
            expect((payload['document'] as { filename?: string }).filename).toBe('catalogo.pdf');
        });

        it('bloqueado pelo usuário vira RECIPIENT_BLOCKED', async () => {
            telegram.on('sendMessage', () => ({ error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
            await connect();
            const err = await manager
                .get(CHANNEL)!
                .send(input('Olá!'))
                .catch((err: unknown) => err);
            expect(err).toBeInstanceOf(CommandError);
            expect(err).toMatchObject({ code: 'RECIPIENT_BLOCKED', retryable: false });
        });

        it('429 curto: espera o retry_after dentro da fila do bot e envia', async () => {
            let calls = 0;
            telegram.on('sendMessage', () =>
                ++calls === 1
                    ? { error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } }
                    : { result: { message_id: 11, date: 1, chat: { id: 1, type: 'private' } } }
            );
            await connect();
            const started = Date.now();
            expect((await manager.get(CHANNEL)!.send(input('Olá!'))).providerMessageId).toBe('123456789:11');
            expect(Date.now() - started).toBeGreaterThanOrEqual(900);
        });

        it('429 longo devolve o comando para a fila de retry', async () => {
            telegram.on('sendMessage', () => ({ error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 120 } }));
            await connect();
            await expect(manager.get(CHANNEL)!.send(input('Olá!'))).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
        });

        it('token revogado durante o envio encerra a sessão', async () => {
            telegram.on('sendMessage', () => ({ error_code: 401, description: 'Unauthorized' }));
            await connect();
            await expect(manager.get(CHANNEL)!.send(input('Olá!'))).rejects.toMatchObject({ code: 'CHANNEL_NOT_CONNECTED', retryable: false });
            await until(() => statuses().some((s) => s.status === 'DISCONNECTED'));
            expect(statuses().at(-1)).toEqual({ status: 'DISCONNECTED', reason: 'SESSION_INVALID' });
            expect(storage.sessions.size).toBe(0);
        });
    });

    it('disconnect com clearSession apaga o token e tira do registro', async () => {
        await connect();
        await manager.disconnect(TENANT, CHANNEL, CORRELATION, true);
        expect(statuses().at(-1)).toEqual({ status: 'DISCONNECTED', reason: 'REQUESTED' });
        expect(storage.sessions.size).toBe(0);
        expect(await redis.hexists(keys.registry(), CHANNEL)).toBe(0);
        expect(telegram.callsOf('logOut')).toHaveLength(0);
    });

    it('retomada após reinício usa o token salvo, sem o core', async () => {
        await connect();
        await manager.shutdown();
        expect(await redis.hexists(keys.registry(), CHANNEL)).toBe(1);

        manager.resumeAll();
        await until(() => manager.get(CHANNEL)?.isOpen === true);
        expect(telegram.callsOf('getMe')).toHaveLength(2);
    });

    it('connect repetido com o mesmo token só repete o status', async () => {
        await connect();
        await manager.connect(TENANT, CHANNEL, CORRELATION, credentials.seal(TOKEN, CHANNEL));
        expect(statuses().map((s) => s.status)).toEqual(['CONNECTING', 'CONNECTED', 'CONNECTED']);
        expect(telegram.callsOf('getMe')).toHaveLength(1);
    });
});
