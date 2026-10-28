import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { Api, GrammyError } from 'grammy';

import { ChannelLockedError, CommandError } from '../errors.js';
import { mask } from '../logger.js';
import { keys } from '../storage/redis.js';
import { ChannelLock } from './channel-lock.js';
import { openInputFile } from './content.js';
import { botIdOf, SealedTokenError } from './credentials.js';
import { inboundMediaKey, mediaToDownload, receivedEventId, toReceivedPayload } from './inbound.js';
import {
    classifyPollError,
    classifySendError,
    entryFromChat,
    entryFromMemberUpdate,
    pacingWaitMs,
    providerMessageIdOf,
    reconnectDelayMs,
    summarizeGroups
} from './rules.js';
import { TtlCache } from './ttl-cache.js';

import type { ChannelStatus, ChannelStatusReason, GroupsSyncedEvent } from '../contracts/index.js';
import type { Config } from '../env.js';
import type { EventContext, EventSink } from '../events/publisher.js';
import type { Logger } from '../logger.js';
import type { Storage } from '../storage/index.js';
import type { ChannelRegistry } from './channel-registry.js';
import type { MessagePart, OpenMedia } from './content.js';
import type { CredentialsCipher } from './credentials.js';
import type { ReceivedPayload } from './inbound.js';
import type { GroupEntry } from './rules.js';
import type { ChatMemberUpdated, Message, Update, UserFromGetMe } from 'grammy/types';
import type { Redis } from 'ioredis';

export interface SessionDeps {
    config: Config;
    logger: Logger;
    redis: Redis;
    storage: Storage;
    credentials: CredentialsCipher;
    events: EventSink;
    registry: ChannelRegistry;
    /** Cliente da Bot API para o token. Os testes trocam por um com transformer, sem rede. */
    createApi?: (token: string) => Api;
    onClosed: (session: ChannelSession) => void;
}

export interface SendInput {
    chatId: string;
    isGroup: boolean;
    /** Chamadas planejadas por planMessage (texto longo vira várias). */
    parts: MessagePart[];
    openMedia: OpenMedia;
    /**
     * Chamado logo antes de entregar ao Telegram, depois da espera do ritmo. Devolve false se outra entrega do
     * mesmo comando chegou antes (o envio é abortado com DuplicateSendError).
     */
    claim: () => Promise<boolean>;
}

export class DuplicateSendError extends Error {
    constructor() {
        super('comando já enviado por outra entrega');
        this.name = 'DuplicateSendError';
    }
}

export interface SendResult {
    /** O da primeira mensagem, quando o envio virou várias. */
    providerMessageId: string;
    chatId: string;
}

type GroupSummary = GroupsSyncedEvent['payload']['groups'][number];

/** O grammY tipa o signal com o polyfill abort-controller; o AbortSignal nativo funciona igual (só usa addEventListener). */
type ApiSignal = NonNullable<Parameters<Api['getMe']>[0]>;

type State = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Long polling: o Telegram segura o getUpdates até 30s esperando um update. */
const POLL_TIMEOUT_S = 30;
/** Prazo de qualquer chamada à Bot API (inclui o long polling e o upload de até 50 MB). */
const API_TIMEOUT_S = 180;
const ALLOWED_UPDATES = ['message', 'my_chat_member'] as const;
/** Download de uma mídia recebida. */
const MEDIA_DOWNLOAD_TIMEOUT_MS = 120_000;
/** A Bot API pública não entrega arquivos acima de 20 MB pelo getFile. */
const BOT_API_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** 429 com espera curta é aguardado dentro da fila do bot; acima disso o comando volta para a fila de retry. */
const RATE_LIMIT_MAX_WAIT_MS = 15_000;
/** Depois da primeira parte de um texto longo, espera mais antes de desistir (desistir deixa a mensagem pela metade). */
const RATE_LIMIT_MAX_WAIT_CONTINUING_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 3;
/** Um update cuja publicação falha é tentado de novo; depois disso é descartado para não travar o bot. */
const UPDATE_MAX_ATTEMPTS = 5;

/** Objetos do canal no Postgres (schema telegram). Só o token cifrado (como veio do servidor) fica lá. */
export const sessionPrefix = (tenantId: string, channelId: string): string => `tenants/${tenantId}/channels/${channelId}/tlg/`;
export const tokenKey = (tenantId: string, channelId: string): string => `${sessionPrefix(tenantId, channelId)}token`;

/**
 * Um bot do Telegram (canal) em long polling. Só existe na instância que tem o lock do canal: a Bot API recusa
 * dois getUpdates simultâneos com o mesmo token.
 *
 * Os envios do bot passam por uma fila interna e saem um por vez, respeitando os limites do Telegram (intervalo
 * mínimo do bot, 1 mensagem/s por conversa e ~20/min por grupo).
 */
export class ChannelSession {
    private state: State = 'idle';
    private api: Api | undefined;
    private token: string | undefined;
    private bot: UserFromGetMe | undefined;
    /** Token recebido no comando e ainda não salvo: só é gravado depois de o getMe confirmar que ele funciona. */
    private pendingSealed: string | undefined;
    private readonly lock: ChannelLock;
    private readonly log: Logger;
    private correlationId: string = randomUUID();
    private reconnectAttempt = 0;
    private stopping = false;
    // Fechada para outra instância (ou esta, ao reiniciar) assumir: envios pendentes devem voltar para a fila.
    private handingOff = false;
    private readonly abort = new AbortController();
    private offset: number | undefined;
    private failedUpdate: { id: number; attempts: number } | undefined;
    private sendChain: Promise<unknown> = Promise.resolve();
    private nextSendAt = 0;
    private readonly lastSentToChat = new TtlCache<number>(60_000, 10_000);

    constructor(
        readonly tenantId: string,
        readonly channelId: string,
        private readonly deps: SessionDeps
    ) {
        this.log = deps.logger.child({ tenantId: tenantId, channelId: channelId });
        this.lock = new ChannelLock(deps.redis, channelId, deps.config.INSTANCE_ID, this.log);
    }

    get isOpen(): boolean {
        return this.state === 'open';
    }

    get isClosed(): boolean {
        return this.state === 'closed';
    }

    /** Conectando ou reconectando: vale a pena esperar em vez de falhar o envio. */
    get isTransient(): boolean {
        return this.state === 'connecting' || this.state === 'reconnecting' || this.state === 'idle';
    }

    private get apiSignal(): ApiSignal {
        return this.abort.signal as unknown as ApiSignal;
    }

    private get ctx(): EventContext {
        return { tenantId: this.tenantId, channelId: this.channelId, correlationId: this.correlationId };
    }

    /**
     * Abre a sessão com o token do comando ou, sem ele, com o salvo. Com `resumeOnly` (retomada após reinício), só abre
     * se houver token salvo. Devolve false se não abriu (nada para retomar ou token que não abre). Lança
     * ChannelLockedError se outra instância tem o lock e CommandError sem token nenhum.
     */
    async start(correlationId: string, sealedBotToken?: string, opts: { resumeOnly?: boolean } = {}): Promise<boolean> {
        this.correlationId = correlationId;
        if (!(await this.lock.acquire(() => void this.onLockLost()))) throw new ChannelLockedError(this.channelId);

        let sealed: string | undefined;
        try {
            sealed = sealedBotToken ?? (await this.deps.storage.getSessionObject(tokenKey(this.tenantId, this.channelId)))?.toString('utf8');
            if (!sealed && opts.resumeOnly) await this.deps.registry.remove(this.channelId);
        } catch (err) {
            await this.lock.release();
            this.state = 'closed';
            throw err;
        }
        if (!sealed) {
            await this.lock.release();
            this.state = 'closed';
            if (opts.resumeOnly) return false;
            throw new CommandError('INVALID_COMMAND', false, 'channel.connect do Telegram sem sealedBotToken e sem token salvo');
        }

        try {
            this.token = this.deps.credentials.open(sealed, this.channelId);
        } catch (err) {
            if (!(err instanceof SealedTokenError)) throw err;
            // Segredo diferente do servidor ou valor adulterado: não adianta tentar de novo com o mesmo valor.
            this.log.error({ err }, 'o token do bot não abre; confira TELEGRAM_GATEWAY_SECRET');
            await this.terminate({ clearToken: true, unregister: true, status: 'DISCONNECTED', reason: 'SESSION_INVALID' });
            return false;
        }
        if (sealedBotToken) this.pendingSealed = sealedBotToken;

        this.api = this.deps.createApi?.(this.token) ?? new Api(this.token, { apiRoot: this.deps.config.TELEGRAM_API_ROOT, timeoutSeconds: API_TIMEOUT_S });
        const stored = await this.deps.redis.get(keys.offset(this.channelId)).catch(() => null);
        this.offset = stored ? Number(stored) || undefined : undefined;
        this.state = 'connecting';
        await this.publishStatus('CONNECTING');
        void this.run();
        return true;
    }

    /** O token cifrado abre para o mesmo token desta sessão? Um connect com outro token reabre a sessão. */
    usesToken(sealedBotToken: string): boolean {
        try {
            return this.deps.credentials.open(sealedBotToken, this.channelId) === this.token;
        } catch {
            return false;
        }
    }

    /** Repete o estado atual para o core (connect pedido de novo com a sessão já aberta). */
    async announce(correlationId: string): Promise<void> {
        this.correlationId = correlationId;
        if (this.state === 'open') await this.publishStatus('CONNECTED');
    }

    /**
     * Desconexão pedida pelo usuário. Com clearSession, apaga o token salvo, o offset e a lista de grupos. O bot não é
     * deslogado (logOut tiraria o bot da Bot API por 10 minutos); ele só deixa de ser lido.
     */
    async disconnect(correlationId: string, clearSession: boolean): Promise<void> {
        this.correlationId = correlationId;
        await this.terminate({ clearToken: clearSession, clearState: clearSession, unregister: true, status: 'DISCONNECTED', reason: 'REQUESTED' });
    }

    /** Encerramento do processo (ou troca de token): fecha sem tirar do registro, para a sessão ser retomada. */
    async shutdown(): Promise<void> {
        this.handingOff = true;
        await this.terminate({ clearToken: false, unregister: false });
    }

    /** Envia uma mensagem respeitando a fila e o ritmo do bot. */
    send(input: SendInput): Promise<SendResult> {
        const run = this.sendChain.catch(() => undefined).then(() => this.sendNow(input));
        this.sendChain = run;
        return run;
    }

    // ---------------------------------------------------------------------------
    // Envio
    // ---------------------------------------------------------------------------

    private async sendNow(input: SendInput): Promise<SendResult> {
        this.requireOpen();
        await this.waitTurn(input);
        // A sessão pode ter caído durante a espera.
        const api = this.requireOpen();

        if (!(await input.claim())) throw new DuplicateSendError();
        let first: string | undefined;
        for (const [index, part] of input.parts.entries()) {
            if (index > 0) await this.waitTurn(input);
            try {
                const sent = await this.deliver(api, input, part, first !== undefined);
                first ??= providerMessageIdOf(input.chatId, sent.message_id);
            } catch (err) {
                if (first === undefined) throw err;
                // A primeira parte já saiu: reportar FAILED faria o core reenviar tudo. Fica SENT, com o resto perdido.
                this.log.warn({ err, part: index + 1, parts: input.parts.length, to: mask(input.chatId) }, 'mensagem longa enviada só em parte');
                break;
            }
        }
        return { providerMessageId: first!, chatId: input.chatId };
    }

    /** Uma chamada à Bot API, esperando o 429 quando ele é curto (o Telegram recusou sem enviar, então é seguro repetir). */
    private async deliver(api: Api, input: SendInput, part: MessagePart, continuing: boolean): Promise<Message> {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.call(api, input.chatId, part, input.openMedia);
            } catch (err) {
                const failure = classifySendError(err, input.chatId);
                if (failure.kind === 'unauthorized') {
                    void this.onTokenInvalid();
                    throw new CommandError('CHANNEL_NOT_CONNECTED', false, 'o token do bot foi revogado');
                }
                if (failure.kind === 'error') throw failure.error;

                // O limite vale para o bot inteiro: os próximos envios também esperam.
                this.nextSendAt = Math.max(this.nextSendAt, Date.now() + failure.retryAfterMs);
                const maxWait = continuing ? RATE_LIMIT_MAX_WAIT_CONTINUING_MS : RATE_LIMIT_MAX_WAIT_MS;
                if (failure.retryAfterMs > maxWait || attempt >= RATE_LIMIT_MAX_ATTEMPTS) {
                    throw new CommandError('PROVIDER_ERROR', true, `limite de envio do Telegram (aguardar ${Math.ceil(failure.retryAfterMs / 1000)}s)`);
                }
                this.log.warn({ retryAfterMs: failure.retryAfterMs, to: mask(input.chatId) }, 'limite de envio do Telegram; aguardando');
                await sleep(failure.retryAfterMs);
                this.requireOpen();
            } finally {
                const now = Date.now();
                this.nextSendAt = Math.max(this.nextSendAt, now + this.deps.config.SEND_MIN_INTERVAL_MS);
                this.lastSentToChat.set(input.chatId, now);
            }
        }
    }

    private async call(api: Api, chatId: string, part: MessagePart, openMedia: OpenMedia): Promise<Message> {
        if (part.kind === 'text') return api.sendMessage(chatId, part.text);
        const file = await openInputFile(part, openMedia, this.deps.config.MEDIA_MAX_BYTES);
        const other = part.caption ? { caption: part.caption } : {};
        switch (part.method) {
            case 'sendPhoto':
                return api.sendPhoto(chatId, file, other);
            case 'sendVideo':
                return api.sendVideo(chatId, file, { ...other, supports_streaming: true });
            case 'sendAudio':
                return api.sendAudio(chatId, file, other);
            case 'sendVoice':
                return api.sendVoice(chatId, file, other);
            case 'sendDocument':
                return api.sendDocument(chatId, file, other);
        }
    }

    private async waitTurn(input: SendInput): Promise<void> {
        const interval = input.isGroup ? this.deps.config.PER_GROUP_INTERVAL_MS : this.deps.config.PER_CHAT_INTERVAL_MS;
        const wait = pacingWaitMs(Date.now(), this.nextSendAt, this.lastSentToChat.get(input.chatId), interval);
        if (wait > 0) await sleep(wait);
    }

    private requireOpen(): Api {
        if (this.state === 'open' && this.api) return this.api;
        throw new CommandError('CHANNEL_NOT_CONNECTED', this.isTransient || this.handingOff, `canal ${this.state}`);
    }

    // ---------------------------------------------------------------------------
    // Conexão e long polling
    // ---------------------------------------------------------------------------

    /** Laço de leitura: abre (getMe), lê os updates e reconecta com backoff em falhas de rede. */
    private async run(): Promise<void> {
        while (!this.stopping) {
            try {
                if (this.state !== 'open') await this.open();
                const updates = await this.api!.getUpdates(
                    { ...(this.offset !== undefined ? { offset: this.offset } : {}), timeout: POLL_TIMEOUT_S, allowed_updates: [...ALLOWED_UPDATES] },
                    this.apiSignal
                );
                await this.processUpdates(updates);
            } catch (err) {
                if (this.stopping) break;
                await this.onPollError(err).catch((err: unknown) => this.log.error({ err: err }, 'erro ao tratar falha da leitura de updates'));
            }
        }
    }

    /** Confere o token (getMe) e garante o long polling: um webhook configurado faria o getUpdates responder 409. */
    private async open(): Promise<void> {
        const api = this.api!;
        await api.deleteWebhook({ drop_pending_updates: false }, this.apiSignal);
        this.bot = await api.getMe(this.apiSignal);
        if (this.stopping) return;

        if (this.pendingSealed) {
            await this.deps.storage.putSessionObject(tokenKey(this.tenantId, this.channelId), Buffer.from(this.pendingSealed, 'utf8'));
            this.pendingSealed = undefined;
        }
        const reconnected = this.state === 'reconnecting';
        this.state = 'open';
        this.reconnectAttempt = 0;
        await this.deps.registry.add(this.channelId, this.tenantId);
        this.log.info({ bot: mask(this.bot.id), reconnected }, 'canal conectado');
        await this.publishStatus('CONNECTED');
    }

    private async onPollError(err: unknown): Promise<void> {
        const failure = classifyPollError(err);
        if (failure.kind === 'invalid-token') {
            this.log.warn({ err }, 'token do bot inválido ou revogado');
            await this.terminate({ clearToken: true, unregister: true, status: 'DISCONNECTED', reason: 'SESSION_INVALID' });
            return;
        }
        if (failure.kind === 'replaced') {
            // Outro sistema lê os updates do mesmo bot (ou configurou um webhook). Não disputa.
            this.log.warn({ err }, 'outro processo está lendo os updates deste bot');
            await this.terminate({ clearToken: false, unregister: true, status: 'DISCONNECTED', reason: 'CONNECTION_REPLACED' });
            return;
        }

        this.reconnectAttempt++;
        if (failure.retryAfterMs === undefined) {
            if (this.state === 'open') {
                this.state = 'reconnecting';
                this.log.warn({ err }, 'conexão com a Bot API perdida; reconectando');
                await this.publishStatus('RECONNECTING', 'CONNECTION_LOST');
            } else {
                this.log.warn({ err, attempt: this.reconnectAttempt }, 'falha ao falar com a Bot API; nova tentativa');
            }
        }
        await this.pause(Math.max(failure.retryAfterMs ?? 0, reconnectDelayMs(this.reconnectAttempt)));
    }

    /** Espera que termina antes se a sessão for fechada. */
    private async pause(ms: number): Promise<void> {
        await sleep(ms, undefined, { signal: this.abort.signal }).catch(() => undefined);
    }

    private async onTokenInvalid(): Promise<void> {
        if (this.stopping) return;
        this.log.warn('token do bot revogado durante um envio');
        await this.terminate({ clearToken: true, unregister: true, status: 'DISCONNECTED', reason: 'SESSION_INVALID' });
    }

    private async onLockLost(): Promise<void> {
        if (this.stopping) return;
        this.log.error('lock da sessão perdido para outra instância; parando a leitura local');
        this.handingOff = true;
        await this.terminate({ clearToken: false, unregister: false });
    }

    private async terminate(opts: {
        clearToken: boolean;
        /** Também apaga o offset e a lista de grupos (desconexão com clearSession). */
        clearState?: boolean;
        unregister: boolean;
        status?: ChannelStatus;
        reason?: ChannelStatusReason;
    }): Promise<void> {
        if (this.state === 'closed') return;
        this.state = 'closed';
        this.stopping = true;
        this.abort.abort();
        try {
            if (opts.clearToken) await this.deps.storage.deleteSessionPrefix(sessionPrefix(this.tenantId, this.channelId));
            if (opts.clearState) await this.deps.redis.del(keys.offset(this.channelId), keys.groups(this.channelId));
        } catch (err) {
            this.log.error({ err }, 'falha ao apagar o token ou o estado do canal');
        }
        if (opts.unregister) await this.deps.registry.remove(this.channelId).catch(() => undefined);
        await this.lock.release();
        this.lastSentToChat.clear();
        if (opts.status)
            await this.publishStatus(opts.status, opts.reason).catch((err: unknown) => this.log.error({ err }, 'falha ao publicar o status final'));
        this.deps.onClosed(this);
    }

    // ---------------------------------------------------------------------------
    // Updates
    // ---------------------------------------------------------------------------

    /**
     * Trata os updates em ordem. O offset só avança depois de o update ser publicado: num reinício, o Telegram entrega de
     * novo o que não foi confirmado (o core deduplica pelo providerEventId). Se o tratamento falhar (gravação da mídia, por exemplo), o
     * mesmo update é tentado de novo com backoff, até UPDATE_MAX_ATTEMPTS.
     */
    private async processUpdates(updates: Update[]): Promise<void> {
        for (const update of updates) {
            if (this.stopping) return;
            try {
                await this.handleUpdate(update);
            } catch (err) {
                const attempts = this.failedUpdate?.id === update.update_id ? this.failedUpdate.attempts + 1 : 1;
                if (attempts < UPDATE_MAX_ATTEMPTS) {
                    this.failedUpdate = { id: update.update_id, attempts };
                    this.log.warn({ err, updateId: update.update_id, attempts }, 'falha ao tratar update; nova tentativa');
                    await this.pause(reconnectDelayMs(attempts));
                    return;
                }
                this.log.error({ err, updateId: update.update_id }, 'update descartado depois de várias falhas');
            }
            this.failedUpdate = undefined;
            this.offset = update.update_id + 1;
            await this.deps.redis
                .set(keys.offset(this.channelId), String(this.offset))
                .catch((err: unknown) => this.log.warn({ err }, 'falha ao gravar o offset dos updates'));
        }
    }

    private async handleUpdate(update: Update): Promise<void> {
        if (update.message) await this.onMessage(update.message);
        else if (update.my_chat_member) await this.onMyChatMember(update.my_chat_member);
    }

    /**
     * Mensagem nova vira message.received (regras em inbound.ts). A mídia é gravada no bucket antes de publicar. O
     * evento é espontâneo, com correlationId novo.
     */
    private async onMessage(message: Message): Promise<void> {
        if (message.migrate_to_chat_id) await this.onGroupMigrated(String(message.chat.id), String(message.migrate_to_chat_id));
        const result = toReceivedPayload(message);
        if (!result.publish) {
            this.log.debug({ chat: mask(message.chat.id), reason: result.reason }, 'mensagem recebida não publicada');
            return;
        }
        const payload = { ...result.payload, media: await this.storeInboundMedia(message, result.payload) };
        await this.deps.events.publish({ ...this.ctx, correlationId: randomUUID() }, 'message.received', receivedEventId(payload.providerMessageId), payload);
    }

    /**
     * Baixa o arquivo (getFile + download) e grava no bucket de mídia. Acima do limite (INBOUND_MEDIA_MAX_BYTES e 20 MB
     * da Bot API) ou com falha no download, a mensagem sai com media null: perder o arquivo é melhor que perder a mensagem.
     */
    private async storeInboundMedia(message: Message, payload: ReceivedPayload): Promise<NonNullable<ReceivedPayload['media']> | null> {
        const media = mediaToDownload(message);
        if (!media) return null;
        const max = this.inboundMaxBytes();
        if (media.sizeBytes !== undefined && media.sizeBytes > max) {
            this.log.info({ providerMessageId: payload.providerMessageId, sizeBytes: media.sizeBytes }, 'mídia recebida acima do limite; não baixada');
            return null;
        }
        try {
            const file = await this.api!.getFile(media.fileId, this.apiSignal);
            if (!file.file_path) return null;
            const body = await this.download(file.file_path, max);
            if (!body) return null;
            const objectKey = inboundMediaKey(this.tenantId, this.channelId, payload.providerMessageId);
            await this.deps.storage.putMedia(objectKey, body, media.contentType);
            return { objectKey, contentType: media.contentType, fileName: media.fileName, sizeBytes: body.length };
        } catch (err) {
            this.log.warn({ err, providerMessageId: payload.providerMessageId }, 'falha ao baixar a mídia recebida; publicada sem o arquivo');
            return null;
        }
    }

    private inboundMaxBytes(): number {
        const max = this.deps.config.INBOUND_MEDIA_MAX_BYTES;
        // Um servidor local da Bot API não tem o limite de 20 MB.
        return this.deps.config.TELEGRAM_API_ROOT === 'https://api.telegram.org' ? Math.min(max, BOT_API_DOWNLOAD_MAX_BYTES) : max;
    }

    /** O link de download leva o token: nunca vai para log nem para erro. */
    private async download(filePath: string, max: number): Promise<Buffer | undefined> {
        const url = `${this.deps.config.TELEGRAM_API_ROOT}/file/bot${this.token}/${filePath}`;
        const res = await fetch(url, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS)]) }).catch(() => {
            throw new Error('falha de rede ao baixar o arquivo');
        });
        if (!res.ok) {
            await res.body?.cancel().catch(() => undefined);
            throw new Error(`download do arquivo respondeu ${res.status}`);
        }
        const length = Number(res.headers.get('content-length'));
        if (length > max) {
            await res.body?.cancel().catch(() => undefined);
            return undefined;
        }
        const body = Buffer.from(await res.arrayBuffer());
        return body.length > max ? undefined : body;
    }

    // ---------------------------------------------------------------------------
    // Grupos
    // ---------------------------------------------------------------------------

    /**
     * O bot entrou, saiu ou mudou de permissão num grupo ou canal. A Bot API não lista os chats do bot, então o worker
     * guarda cada um no Redis e republica a lista completa (groups.synced) quando ela muda.
     */
    private async onMyChatMember(update: ChatMemberUpdated): Promise<void> {
        const key = keys.groups(this.channelId);
        const chatId = String(update.chat.id);
        const previousRaw = await this.deps.redis.hget(key, chatId);
        const previous = previousRaw ? (JSON.parse(previousRaw) as GroupEntry) : undefined;
        const fromUpdate = entryFromMemberUpdate(update, previous);
        if (fromUpdate === undefined) return;
        let entry: GroupEntry | null = null;
        if (fromUpdate === null) {
            if (!previous) return;
            await this.deps.redis.hdel(key, chatId);
            this.log.info({ chat: mask(chatId) }, 'bot saiu do grupo');
        } else {
            // Completa com o número de membros e as permissões do grupo; sem isso, fica o que veio no update.
            entry = (await this.fetchEntry(chatId).catch(() => null)) ?? fromUpdate;
            await this.deps.redis.hset(key, chatId, JSON.stringify(entry));
            this.log.info({ chat: mask(chatId), status: entry.status }, 'bot entrou ou mudou de permissão no grupo');
        }
        const changed = JSON.stringify(summarizeGroups(previous ? [previous] : [])) !== JSON.stringify(summarizeGroups(entry ? [entry] : []));
        if (changed) await this.publishGroups(`groups:${randomUUID()}`, randomUUID());
    }

    /** Grupo que virou supergrupo ganha id novo: o antigo sai da lista e o novo entra. */
    private async onGroupMigrated(oldId: string, newId: string): Promise<void> {
        const key = keys.groups(this.channelId);
        if (!(await this.deps.redis.hdel(key, oldId))) return;
        const entry = await this.fetchEntry(newId).catch(() => undefined);
        if (entry) await this.deps.redis.hset(key, newId, JSON.stringify(entry));
        await this.publishGroups(`groups:${randomUUID()}`, randomUUID());
    }

    /**
     * Resposta ao groups.sync: atualiza cada chat conhecido na Bot API e tira os que o bot já não está. Falha de rede num
     * chat mantém a última informação dele.
     */
    async syncGroups(): Promise<GroupSummary[]> {
        this.requireOpen();
        const key = keys.groups(this.channelId);
        const all = await this.deps.redis.hgetall(key);
        for (const chatId of Object.keys(all)) {
            try {
                const entry = await this.fetchEntry(chatId);
                if (entry) await this.deps.redis.hset(key, chatId, JSON.stringify(entry));
                else await this.deps.redis.hdel(key, chatId);
            } catch (err) {
                const migratedTo = err instanceof GrammyError ? err.parameters?.migrate_to_chat_id : undefined;
                if (migratedTo) {
                    await this.deps.redis.hdel(key, chatId);
                    const entry = await this.fetchEntry(String(migratedTo)).catch(() => undefined);
                    if (entry) await this.deps.redis.hset(key, entry.id, JSON.stringify(entry));
                    continue;
                }
                if (err instanceof GrammyError && err.error_code === 401) throw new CommandError('CHANNEL_NOT_CONNECTED', false, 'o token do bot foi revogado');
                this.log.warn({ err, chat: mask(chatId) }, 'não foi possível atualizar o grupo; mantida a última informação');
            }
        }
        return this.groupSummaries();
    }

    /** null: o bot não está mais no chat (removido, chat apagado). Lança em falha de rede ou outro erro. */
    private async fetchEntry(chatId: string): Promise<GroupEntry | null> {
        const api = this.requireOpen();
        try {
            const chat = await api.getChat(chatId, this.apiSignal);
            const count = await api.getChatMemberCount(chatId, this.apiSignal).catch(() => null);
            const member = await api.getChatMember(chatId, this.bot?.id ?? Number(botIdOf(this.token ?? '')), this.apiSignal);
            return entryFromChat(chat, count, member);
        } catch (err) {
            if (err instanceof GrammyError && !err.parameters?.migrate_to_chat_id && (err.error_code === 400 || err.error_code === 403)) {
                // "chat not found", "bot was kicked", "bot is not a member": o bot saiu.
                return null;
            }
            throw err;
        }
    }

    private async groupSummaries(): Promise<GroupSummary[]> {
        const all = await this.deps.redis.hgetall(keys.groups(this.channelId));
        return summarizeGroups(Object.values(all).map((v) => JSON.parse(v) as GroupEntry));
    }

    private async publishGroups(providerEventId: string, correlationId: string): Promise<void> {
        await this.deps.events.publish({ ...this.ctx, correlationId }, 'groups.synced', providerEventId, { groups: await this.groupSummaries() });
    }

    // ---------------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------------

    private async publishStatus(status: ChannelStatus, reason?: ChannelStatusReason): Promise<void> {
        const bot = this.bot;
        await this.deps.events.publish(this.ctx, 'channel.status', `status:${randomUUID()}`, {
            status,
            ...(reason ? { reason } : {}),
            ...(status === 'CONNECTED' && bot
                ? {
                      account: {
                          externalId: String(bot.id),
                          ...(bot.first_name ? { name: bot.first_name } : {}),
                          ...(bot.username ? { username: bot.username } : {})
                      }
                  }
                : {})
        });
    }
}
