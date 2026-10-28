import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { Browsers, downloadMediaMessage, fetchLatestBaileysVersion, isJidBroadcast, isJidNewsletter, makeWASocket, proto as waProto } from 'baileys';

import { ChannelLockedError, CommandError } from '../errors.js';
import { mask } from '../logger.js';
import { keys } from '../storage/redis.js';
import { loadSessionAuth, sessionPrefix } from './auth-state.js';
import { ChannelLock } from './channel-lock.js';
import { inboundMediaKey, lidsToResolve, mediaToDownload, receivedEventId, toReceivedPayload } from './inbound.js';
import { canSendToGroup, classifyDisconnect, jidUser, pacingDelayMs, receiptStatus, reconnectDelayMs, typingDurationMs } from './rules.js';
import { TtlCache } from './ttl-cache.js';

import type { ChannelStatus, ChannelStatusEvent, ChannelStatusReason } from '../contracts/index.js';
import type { Config } from '../env.js';
import type { EventContext, EventSink } from '../events/publisher.js';
import type { Logger } from '../logger.js';
import type { Storage } from '../storage/index.js';
import type { SessionAuth } from './auth-state.js';
import type { ChannelRegistry } from './channel-registry.js';
import type { ReceivedPayload, SelfAccount } from './inbound.js';
import type { Me, ParsedRecipient } from './rules.js';
import type { SessionCipher } from './session-cipher.js';
import type { AnyMessageContent, ConnectionState, GroupMetadata, proto, WAMessage, WAMessageUpdate, WASocket, WAVersion } from 'baileys';
import type { Redis } from 'ioredis';

// Lotes de histórico que o aparelho envia e a sessão não baixa: as mensagens antigas, que ninguém consome.
const { HistorySyncType } = waProto.HistorySync;
const SKIPPED_HISTORY_SYNCS = new Set<number>([HistorySyncType.FULL, HistorySyncType.RECENT, HistorySyncType.ON_DEMAND]);

export interface SessionDeps {
    config: Config;
    logger: Logger;
    redis: Redis;
    storage: Storage;
    cipher: SessionCipher;
    events: EventSink;
    registry: ChannelRegistry;
    onClosed: (session: ChannelSession) => void;
}

export interface SendInput {
    recipient: Exclude<ParsedRecipient, { kind: 'invalid' }>;
    /** Chamado só na hora do envio, depois da espera do ritmo e do claim, para não segurar a mídia aberta. */
    buildContent: () => Promise<AnyMessageContent>;
    /**
     * Chamado logo antes de entregar ao WhatsApp, depois da espera do ritmo. Devolve false se outra entrega do
     * mesmo comando chegou antes (o envio é abortado com DuplicateSendError).
     */
    claim: () => Promise<boolean>;
    textLength: number;
}

export class DuplicateSendError extends Error {
    constructor() {
        super('comando já enviado por outra entrega');
        this.name = 'DuplicateSendError';
    }
}

export interface SendResult {
    providerMessageId: string;
    jid: string;
}

type State = 'idle' | 'connecting' | 'qr' | 'open' | 'reconnecting' | 'closed';

const SEND_TIMEOUT_MS = 60_000;
/** Download de uma mídia recebida (vídeos grandes em conexão lenta). */
const MEDIA_DOWNLOAD_TIMEOUT_MS = 120_000;
const SENT_MESSAGE_TTL_S = 7 * 24 * 3600;
const WA_LOOKUP_TTL_S = 7 * 24 * 3600;
const WA_LOOKUP_MISS_TTL_S = 24 * 3600;
const QR_FIRST_TTL_S = 60;
const QR_NEXT_TTL_S = 20;

/**
 * Uma conexão da Baileys para um canal. Só existe na instância que tem o lock do canal.
 *
 * Os envios do canal passam por uma fila interna e saem um por vez, com intervalo aleatório entre eles
 * e "digitando..." antes de mensagens para contatos.
 */
export class ChannelSession {
    private state: State = 'idle';
    private sock: WASocket | undefined;
    private auth: SessionAuth | undefined;
    private readonly lock: ChannelLock;
    private readonly log: Logger;
    private correlationId: string = randomUUID();
    private qrAttempt = 0;
    private reconnectAttempt = 0;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private stopping = false;
    // Fechada para outra instância (ou esta, ao reiniciar) assumir: envios pendentes devem voltar para a fila.
    private handingOff = false;
    private sendRestriction: NonNullable<ChannelStatusEvent['payload']['sendRestriction']> = { active: false };
    private sendChain: Promise<unknown> = Promise.resolve();
    private nextSendAt = 0;
    private readonly groups = new TtlCache<GroupMetadata>(10 * 60_000, 5_000);
    // A Baileys pede a mensagem de volta quando o destinatário não conseguiu decifrar e solicita reenvio.
    private readonly recentMessages = new TtlCache<proto.IMessage>(60 * 60_000, 2_000);

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

    /** Conectando, aguardando QR ou reconectando: vale a pena esperar em vez de falhar o envio. */
    get isTransient(): boolean {
        return this.state === 'connecting' || this.state === 'reconnecting' || this.state === 'idle';
    }

    private get ctx(): EventContext {
        return { tenantId: this.tenantId, channelId: this.channelId, correlationId: this.correlationId };
    }

    /**
     * Abre a sessão. Com `resumeOnly`, só abre se já houver sessão pareada salva (retomada após reinício).
     * Devolve false se não havia sessão para retomar. Lança ChannelLockedError se outra instância tem o lock.
     */
    async start(correlationId: string, opts: { resumeOnly?: boolean } = {}): Promise<boolean> {
        this.correlationId = correlationId;
        if (!(await this.lock.acquire(() => void this.onLockLost()))) throw new ChannelLockedError(this.channelId);

        try {
            this.auth = await loadSessionAuth(this.deps.storage, this.deps.cipher, sessionPrefix(this.tenantId, this.channelId));
            if (opts.resumeOnly && !this.auth.isRegistered()) {
                await this.deps.registry.remove(this.channelId);
                await this.lock.release();
                this.state = 'closed';
                return false;
            }
            this.state = 'connecting';
            await this.publishStatus('CONNECTING');
            await this.openSocket();
            return true;
        } catch (err) {
            await this.lock.release();
            this.state = 'closed';
            throw err;
        }
    }

    /** Repete o estado atual para o core (connect pedido de novo com a sessão já aberta). */
    async announce(correlationId: string): Promise<void> {
        this.correlationId = correlationId;
        if (this.state === 'open') await this.publishStatus('CONNECTED');
    }

    /** Desconexão pedida pelo usuário. Com clearSession, desloga o aparelho e apaga a sessão salva. */
    async disconnect(correlationId: string, clearSession: boolean): Promise<void> {
        this.correlationId = correlationId;
        this.stopping = true;
        if (clearSession && this.sock && this.state === 'open') {
            await this.sock.logout().catch((err: unknown) => this.log.warn({ err }, 'falha ao deslogar o aparelho'));
        }
        await this.terminate({ clearSession, unregister: true, status: 'DISCONNECTED', reason: 'REQUESTED' });
    }

    /** Encerramento do processo: fecha sem deslogar e sem tirar do registro, para a sessão ser retomada. */
    async shutdown(): Promise<void> {
        this.stopping = true;
        this.handingOff = true;
        await this.terminate({ clearSession: false, unregister: false });
    }

    async fetchGroups(): Promise<{ groups: GroupMetadata[]; me: Me }> {
        const sock = this.requireOpen();
        const all = await sock.groupFetchAllParticipating();
        const groups = Object.values(all);
        for (const group of groups) this.groups.set(group.id, group);
        return { groups, me: this.me(sock) };
    }

    /** Envia uma mensagem respeitando a fila e o ritmo do canal. */
    send(input: SendInput): Promise<SendResult> {
        const run = this.sendChain.catch(() => undefined).then(() => this.sendNow(input));
        this.sendChain = run;
        return run;
    }

    // ---------------------------------------------------------------------------
    // Envio
    // ---------------------------------------------------------------------------

    private async sendNow(input: SendInput): Promise<SendResult> {
        const jid = await this.resolveJid(this.requireOpen(), input.recipient);

        const wait = this.nextSendAt - Date.now();
        if (wait > 0) await sleep(wait);
        // A conexão pode ter caído (ou sido refeita, com outro socket) durante a espera.
        const sock = this.requireOpen();

        if (!(await input.claim())) throw new DuplicateSendError();
        const content = await input.buildContent();
        const isGroup = input.recipient.kind === 'group';
        try {
            if (!isGroup && this.deps.config.SEND_TYPING) {
                await sock.sendPresenceUpdate('composing', jid).catch(() => undefined);
                await sleep(typingDurationMs(input.textLength));
                await sock.sendPresenceUpdate('paused', jid).catch(() => undefined);
            }
            const sent = await withTimeout(sock.sendMessage(jid, content), SEND_TIMEOUT_MS);
            const providerMessageId = sent?.key.id;
            if (!providerMessageId) throw new CommandError('PROVIDER_ERROR', false, 'o WhatsApp não devolveu o id da mensagem');
            if (sent.message) this.recentMessages.set(providerMessageId, sent.message);
            return { providerMessageId, jid };
        } catch (err) {
            throw toCommandError(err);
        } finally {
            this.nextSendAt = Date.now() + pacingDelayMs(this.deps.config.SEND_DELAY_MIN_MS, this.deps.config.SEND_DELAY_MAX_MS);
        }
    }

    private async resolveJid(sock: WASocket, recipient: SendInput['recipient']): Promise<string> {
        if (recipient.kind === 'group') {
            let group = this.groups.get(recipient.jid);
            if (!group) {
                try {
                    group = await sock.groupMetadata(recipient.jid);
                    this.groups.set(group.id, group);
                } catch {
                    throw new CommandError('GROUP_SEND_FORBIDDEN', false, 'o número não participa do grupo');
                }
            }
            if (!canSendToGroup(group, this.me(sock))) {
                throw new CommandError('GROUP_SEND_FORBIDDEN', false, 'só administradores enviam mensagens neste grupo');
            }
            return recipient.jid;
        }

        if (this.sendRestriction.active && (!this.sendRestriction.until || Date.parse(this.sendRestriction.until) > Date.now())) {
            throw new CommandError('CHANNEL_SEND_RESTRICTED', false, 'o WhatsApp está bloqueando envios deste número');
        }
        if (recipient.kind === 'contact-jid') return recipient.jid;

        const cacheKey = keys.waLookup(this.channelId, recipient.phone);
        const cached = await this.deps.redis.get(cacheKey);
        if (cached) {
            if (cached === '-') throw new CommandError('NOT_ON_WHATSAPP', false, 'o número não tem WhatsApp');
            return cached;
        }
        let found: { jid: string; exists: boolean } | undefined;
        try {
            found = (await sock.onWhatsApp(recipient.phone))?.find((r) => r.exists);
        } catch (err) {
            throw toCommandError(err);
        }
        if (!found) {
            await this.deps.redis.set(cacheKey, '-', 'EX', WA_LOOKUP_MISS_TTL_S);
            throw new CommandError('NOT_ON_WHATSAPP', false, 'o número não tem WhatsApp');
        }
        await this.deps.redis.set(cacheKey, found.jid, 'EX', WA_LOOKUP_TTL_S);
        return found.jid;
    }

    private requireOpen(): WASocket {
        if (this.state === 'open' && this.sock) return this.sock;
        throw new CommandError('CHANNEL_NOT_CONNECTED', this.isTransient || this.handingOff, `canal ${this.state}`);
    }

    private me(sock: WASocket): Me {
        return { id: sock.user?.id ?? '', lid: sock.user?.lid };
    }

    // ---------------------------------------------------------------------------
    // Conexão
    // ---------------------------------------------------------------------------

    private async openSocket(): Promise<void> {
        const auth = this.auth!;
        const version = await waVersion(this.log);
        const sock = makeWASocket({
            ...(version ? { version } : {}),
            auth: auth.state,
            logger: this.deps.logger.child({ component: 'baileys', channelId: this.channelId }, { level: this.deps.config.BAILEYS_LOG_LEVEL }),
            browser: Browsers.ubuntu('Tenklo'),
            // Sem marcar online: o celular continua recebendo as notificações.
            markOnlineOnConnect: false,
            syncFullHistory: false,
            // Só os lotes pequenos, que trazem os nomes e o mapeamento LID -> telefone; sem eles a Baileys perde os
            // LIDs e a sessão fica instável. As mensagens antigas chegam como 'append' e não viram message.received.
            shouldSyncHistoryMessage: ({ syncType }) => syncType == null || !SKIPPED_HISTORY_SYNCS.has(syncType),
            generateHighQualityLinkPreview: false,
            shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidNewsletter(jid),
            cachedGroupMetadata: (jid) => Promise.resolve(this.groups.get(jid)),
            getMessage: (key) => Promise.resolve(key.id ? this.recentMessages.get(key.id) : undefined)
        });
        this.sock = sock;

        sock.ev.on('creds.update', () => {
            // Depois de fechada (e talvez apagada), a sessão não pode ser regravada por um evento atrasado.
            if (this.state === 'closed') return;
            auth.saveCreds().catch((err: unknown) => this.log.error({ err }, 'falha ao salvar as credenciais da sessão'));
        });
        sock.ev.on('connection.update', (update) => {
            if (sock !== this.sock) return;
            this.onConnectionUpdate(sock, update).catch((err: unknown) => this.log.error({ err }, 'erro ao tratar mudança de conexão'));
        });
        sock.ev.on('messages.update', (updates) => {
            this.onMessagesUpdate(updates).catch((err: unknown) => this.log.warn({ err }, 'erro ao tratar recibos de mensagem'));
        });
        sock.ev.on('messages.upsert', ({ messages, type }) => {
            // 'append' é histórico e sincronização entre aparelhos; só 'notify' é mensagem nova.
            if (sock !== this.sock || type !== 'notify') return;
            this.onMessagesUpsert(sock, messages).catch((err: unknown) => this.log.error({ err }, 'erro ao tratar mensagens recebidas'));
        });
        sock.ev.on('groups.update', (updates) => {
            for (const update of updates) {
                const current = update.id ? this.groups.get(update.id) : undefined;
                if (current) this.groups.set(current.id, { ...current, ...update });
            }
        });
    }

    private async onConnectionUpdate(sock: WASocket, update: Partial<ConnectionState>): Promise<void> {
        if (update.qr) {
            this.qrAttempt++;
            if (this.qrAttempt === 1) {
                this.state = 'qr';
                await this.publishStatus('QR_PENDING');
            }
            const ttl = this.qrAttempt === 1 ? QR_FIRST_TTL_S : QR_NEXT_TTL_S;
            await this.deps.events.publish(this.ctx, 'channel.qr', `qr:${randomUUID()}`, {
                qr: update.qr,
                attempt: this.qrAttempt,
                expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
            });
        }

        if (update.reachoutTimeLock) {
            const lock = update.reachoutTimeLock;
            this.sendRestriction = {
                active: !!lock.isActive,
                ...(lock.timeEnforcementEnds ? { until: new Date(lock.timeEnforcementEnds).toISOString() } : {}),
                ...(lock.enforcementType ? { enforcementType: String(lock.enforcementType) } : {})
            };
            if (this.sendRestriction.active) this.log.warn({ sendRestriction: this.sendRestriction }, 'WhatsApp restringiu os envios do número');
            if (this.state === 'open') await this.publishStatus('CONNECTED');
        }

        if (update.connection === 'open') {
            this.state = 'open';
            this.reconnectAttempt = 0;
            this.qrAttempt = 0;
            await this.deps.registry.add(this.channelId, this.tenantId);
            this.log.info({ account: mask(sock.user?.id) }, 'canal conectado');
            await this.publishStatus('CONNECTED');
        }

        if (update.connection === 'close') {
            await this.onClose(update.lastDisconnect?.error);
        }
    }

    private async onClose(error: unknown): Promise<void> {
        if (this.stopping) return;
        const statusCode = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const decision = classifyDisconnect(statusCode, this.auth?.isRegistered() ?? false);
        this.log.info({ statusCode, decision }, 'conexão fechada');

        if (decision.action === 'restart') {
            this.state = 'connecting';
            await this.openSocket();
            return;
        }
        if (decision.action === 'reconnect') {
            this.reconnectAttempt++;
            if (this.state !== 'reconnecting') {
                this.state = 'reconnecting';
                await this.publishStatus('RECONNECTING', 'CONNECTION_LOST');
            }
            const delay = reconnectDelayMs(this.reconnectAttempt);
            this.reconnectTimer = setTimeout(() => {
                if (this.stopping) return;
                this.openSocket().catch((err: unknown) => {
                    this.log.error({ err }, 'falha ao reabrir a conexão');
                    void this.onClose(err);
                });
            }, delay);
            return;
        }
        this.stopping = true;
        await this.terminate({ clearSession: decision.clearSession, unregister: true, status: decision.status, reason: decision.reason });
    }

    private async onLockLost(): Promise<void> {
        if (this.stopping) return;
        this.log.error('lock da sessão perdido para outra instância; fechando a conexão local');
        this.stopping = true;
        this.handingOff = true;
        await this.terminate({ clearSession: false, unregister: false });
    }

    private async terminate(opts: { clearSession: boolean; unregister: boolean; status?: ChannelStatus; reason?: ChannelStatusReason }): Promise<void> {
        if (this.state === 'closed') return;
        this.state = 'closed';
        clearTimeout(this.reconnectTimer);
        const sock = this.sock;
        this.sock = undefined;
        // Falha ao fechar um socket que já caiu não importa.
        await Promise.resolve()
            .then(() => sock?.end(undefined))
            .catch(() => undefined);
        try {
            if (opts.clearSession) await this.auth?.clear();
            else await this.auth?.flush();
        } catch (err) {
            this.log.error({ err }, 'falha ao gravar ou apagar a sessão');
        }
        if (opts.unregister) await this.deps.registry.remove(this.channelId).catch(() => undefined);
        await this.lock.release();
        this.groups.clear();
        this.recentMessages.clear();
        if (opts.status)
            await this.publishStatus(opts.status, opts.reason).catch((err: unknown) => this.log.error({ err }, 'falha ao publicar o status final'));
        this.deps.onClosed(this);
    }

    // ---------------------------------------------------------------------------
    // Recibos e status
    // ---------------------------------------------------------------------------

    /** Entregue e lido, só para mensagens individuais enviadas por este worker. */
    private async onMessagesUpdate(updates: WAMessageUpdate[]): Promise<void> {
        for (const { key, update } of updates) {
            const status = receiptStatus(update.status);
            if (!status || !key.fromMe || !key.id || key.remoteJid?.endsWith('@g.us')) continue;
            const stored = await this.deps.redis.get(keys.sentMessage(this.channelId, key.id));
            if (!stored) continue;
            const { messageId, correlationId } = JSON.parse(stored) as { messageId: string; correlationId: string };
            await this.deps.events.publish({ ...this.ctx, correlationId }, 'message.status', `${key.id}:${status}`, {
                messageId,
                status,
                providerMessageId: key.id
            });
        }
    }

    /**
     * Mensagens recebidas viram message.received (regras em inbound.ts), e as próprias escritas em outro aparelho também
     * (fromMe). As enviadas por este worker ficam de fora: o resultado delas já vai no message.status. A mídia é gravada no
     * bucket antes de publicar. Cada mensagem é independente: uma falha não impede as outras. O evento é espontâneo, com
     * correlationId novo.
     */
    private async onMessagesUpsert(sock: WASocket, messages: WAMessage[]): Promise<void> {
        for (const msg of messages) {
            try {
                if (msg.key.fromMe && msg.key.id && (await this.sentByThisWorker(msg.key.id))) continue;
                const pnByLid = new Map<string, string>();
                for (const lid of lidsToResolve(msg)) {
                    // Consulta local (mapeamento LID -> telefone guardado pela Baileys na sessão), sem ida ao WhatsApp.
                    const pn = await sock.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
                    if (pn) pnByLid.set(lid, pn);
                }
                const result = toReceivedPayload(msg, pnByLid, undefined, this.selfAccount());
                if (!result.publish) {
                    this.log.debug({ providerMessageId: msg.key.id, reason: result.reason }, 'mensagem recebida não publicada');
                    continue;
                }
                const payload = { ...result.payload, media: (await this.storeInboundMedia(sock, msg, result.payload)) ?? null };
                await this.deps.events.publish(
                    { ...this.ctx, correlationId: randomUUID() },
                    'message.received',
                    receivedEventId(payload.providerMessageId),
                    payload
                );
            } catch (err) {
                this.log.error({ err, providerMessageId: msg.key.id }, 'falha ao publicar mensagem recebida');
            }
        }
    }

    /** A mensagem própria saiu deste worker (envio do core), e não de outro aparelho do número? */
    private async sentByThisWorker(providerMessageId: string): Promise<boolean> {
        if (this.recentMessages.get(providerMessageId)) return true;
        return (await this.deps.redis.exists(keys.sentMessage(this.channelId, providerMessageId))) > 0;
    }

    private selfAccount(): SelfAccount | undefined {
        const phone = jidUser(this.sock?.user?.id);
        return phone ? { externalId: `${phone}@s.whatsapp.net`, phone: /^\d{8,15}$/.test(phone) ? phone : null } : undefined;
    }

    /**
     * Baixa o arquivo da mensagem e grava no bucket de mídia. Sem arquivo, acima de INBOUND_MEDIA_MAX_BYTES ou com falha
     * no download, a mensagem sai com media null (o tipo e a legenda continuam): perder o arquivo é melhor que perder a
     * mensagem.
     */
    private async storeInboundMedia(sock: WASocket, msg: WAMessage, payload: ReceivedPayload): Promise<ReceivedPayload['media']> {
        const media = mediaToDownload(msg.message);
        if (!media) return null;
        const max = this.deps.config.INBOUND_MEDIA_MAX_BYTES;
        if (media.sizeBytes !== undefined && media.sizeBytes > max) {
            this.log.info({ providerMessageId: payload.providerMessageId, sizeBytes: media.sizeBytes }, 'mídia recebida acima do limite; não baixada');
            return null;
        }
        try {
            const body = await withTimeout(
                downloadMediaMessage(msg, 'buffer', {}, { logger: this.log, reuploadRequest: (m) => sock.updateMediaMessage(m) }),
                MEDIA_DOWNLOAD_TIMEOUT_MS
            );
            if (body.length > max) return null;
            const objectKey = inboundMediaKey(this.tenantId, this.channelId, payload.providerMessageId);
            await this.deps.storage.putMedia(objectKey, body, media.contentType);
            return { objectKey, contentType: media.contentType, fileName: media.fileName, sizeBytes: body.length };
        } catch (err) {
            this.log.warn({ err, providerMessageId: payload.providerMessageId }, 'falha ao baixar a mídia recebida; publicada sem o arquivo');
            return null;
        }
    }

    /** Guarda a ligação entre o id do WhatsApp e o id do core, para os recibos que chegam depois. */
    async rememberSent(providerMessageId: string, messageId: string, correlationId: string): Promise<void> {
        await this.deps.redis.set(keys.sentMessage(this.channelId, providerMessageId), JSON.stringify({ messageId, correlationId }), 'EX', SENT_MESSAGE_TTL_S);
    }

    private async publishStatus(status: ChannelStatus, reason?: ChannelStatusReason): Promise<void> {
        const user = this.sock?.user;
        const phone = jidUser(user?.id);
        await this.deps.events.publish(this.ctx, 'channel.status', `status:${randomUUID()}`, {
            status,
            ...(reason ? { reason } : {}),
            ...(status === 'CONNECTED' ? { sendRestriction: this.sendRestriction } : {}),
            ...(status === 'CONNECTED' && phone
                ? {
                      account: {
                          externalId: `${phone}@s.whatsapp.net`,
                          ...(/^\d{8,15}$/.test(phone) ? { phone } : {}),
                          ...(user?.name ? { name: user.name } : {})
                      }
                  }
                : {})
        });
    }
}

// ---------------------------------------------------------------------------

let cachedVersion: { version: WAVersion; at: number } | undefined;

/** Versão do WhatsApp Web, atualizada a cada 6h. Versão desatualizada faz o WhatsApp recusar a conexão. */
async function waVersion(log: Logger): Promise<WAVersion | undefined> {
    if (cachedVersion && Date.now() - cachedVersion.at < 6 * 3600_000) return cachedVersion.version;
    try {
        const { version, error } = await fetchLatestBaileysVersion();
        if (!error) cachedVersion = { version, at: Date.now() };
        return version;
    } catch (err) {
        log.warn({ err }, 'não foi possível obter a versão mais recente do WhatsApp Web; usando a padrão da Baileys');
        return cachedVersion?.version;
    }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new CommandError('TIMEOUT', false, `sem resposta do WhatsApp em ${ms / 1000}s`)), ms);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Erros da Baileys com cara de conexão caída (o envio não chegou a sair) podem ser retentados.
 * Os demais viram falha definitiva: retentar arriscaria mensagem duplicada.
 */
function toCommandError(err: unknown): CommandError {
    if (err instanceof CommandError) return err;
    const statusCode = (err as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
    if (statusCode === 428 || statusCode === 408 || statusCode === 503) {
        return new CommandError('CHANNEL_NOT_CONNECTED', true, 'conexão com o WhatsApp caiu durante o envio');
    }
    const message = err instanceof Error ? err.message : String(err);
    return new CommandError('PROVIDER_ERROR', false, message.slice(0, 500));
}
