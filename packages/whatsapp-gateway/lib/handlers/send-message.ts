import { CommandError } from '../errors.js';
import { mask } from '../logger.js';
import { keys } from '../storage/redis.js';
import { DuplicateSendError } from '../whatsapp/channel-session.js';
import { buildMessageContent } from '../whatsapp/content.js';
import { parseRecipient } from '../whatsapp/rules.js';

import type { AttemptInfo, HandlerResult } from '../commands/dispatcher.js';
import type { CommandOf, ErrorCode } from '../contracts/index.js';
import type { EventContext, EventSink } from '../events/publisher.js';
import type { Logger } from '../logger.js';
import type { Storage } from '../storage/index.js';
import type { ChannelRegistry } from '../whatsapp/channel-registry.js';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { Redis } from 'ioredis';

type SendCommand = CommandOf<'message.send'>;

type Outcome = { state: 'processing' } | { state: 'done'; providerMessageId: string; jid: string } | { state: 'failed'; code: ErrorCode; message: string };

const DONE_TTL_S = 7 * 24 * 3600;
// Só cobre a entrega em si (digitando + envio); a espera do ritmo acontece antes da marcação.
const PROCESSING_TTL_S = 10 * 60;

// Comandos sendo enviados por este processo: uma entrega duplicada deles não é "envio interrompido".
const inFlight = new Set<string>();

export interface SendMessageDeps {
    manager: SessionManager;
    registry: ChannelRegistry;
    storage: Storage;
    redis: Redis;
    events: EventSink;
    logger: Logger;
    mediaMaxBytes: number;
}

/**
 * message.send com idempotência por commandId (ARQUITETURA.md, 4.5): uma reentrega nunca envia de novo.
 *
 * Se o processo cair no meio do envio, não dá para saber se a mensagem saiu. Nesse caso o comando é
 * encerrado como FAILED em vez de arriscar mandar duas vezes para o cliente final.
 */
export async function handleSendMessage(command: SendCommand, info: AttemptInfo, deps: SendMessageDeps): Promise<HandlerResult> {
    const { redis, events } = deps;
    const ctx: EventContext = { tenantId: command.tenantId, channelId: command.channelId, correlationId: command.correlationId };
    const { messageId, to, content } = command.payload;
    const log = deps.logger.child({
        tenantId: command.tenantId,
        channelId: command.channelId,
        correlationId: command.correlationId,
        messageId
    });
    const idemKey = keys.command(command.commandId);
    let claimed = false;

    /**
     * Registra a falha e avisa o core. Sem ter marcado o comando (falha antes da entrega), só grava se ninguém
     * gravou ainda: outra entrega do mesmo comando pode ter enviado nesse meio-tempo.
     */
    const fail = async (code: ErrorCode, message: string, overwrite = claimed): Promise<HandlerResult> => {
        const value = JSON.stringify({ state: 'failed', code, message } satisfies Outcome);
        const written = overwrite ? await redis.set(idemKey, value, 'EX', DONE_TTL_S) : await redis.set(idemKey, value, 'EX', DONE_TTL_S, 'NX');
        if (written !== 'OK') return 'done';
        await events.publish(ctx, 'message.status', `failed:${command.commandId}`, { messageId, status: 'FAILED', errorCode: code, errorMessage: message });
        log.warn({ errorCode: code, error: message, to: mask(to.externalId) }, 'mensagem não enviada');
        return 'done';
    };

    // 1. Já processado? Republica o resultado (o evento anterior pode ter se perdido) e encerra.
    const prior = await redis.get(idemKey);
    if (prior) {
        const outcome = JSON.parse(prior) as Outcome;
        if (outcome.state === 'done') {
            await events.publish(ctx, 'message.status', `${outcome.providerMessageId}:SENT`, {
                messageId,
                status: 'SENT',
                providerMessageId: outcome.providerMessageId,
                recipientExternalId: outcome.jid
            });
            return 'done';
        }
        if (outcome.state === 'failed') {
            await events.publish(ctx, 'message.status', `failed:${command.commandId}`, {
                messageId,
                status: 'FAILED',
                errorCode: outcome.code,
                errorMessage: outcome.message
            });
            return 'done';
        }
        if (inFlight.has(command.commandId)) return 'done';
        return fail('PROVIDER_ERROR', 'envio interrompido; não é possível saber se a mensagem saiu', true);
    }

    // 2. Validações que não dependem do canal.
    const recipient = parseRecipient(to);
    if (recipient.kind === 'invalid') return fail('INVALID_RECIPIENT', recipient.reason);

    // 3. Canal: sem sessão aqui, espera se ele deveria estar conectado (retomada após reinício).
    const session = deps.manager.get(command.channelId);
    if (!session || !session.isOpen) {
        const expected = session ? session.isTransient : await deps.registry.has(command.channelId);
        if (expected && info.canRetry) return 'retry';
        return fail('CHANNEL_NOT_CONNECTED', 'o canal não está conectado');
    }

    // 4. Envia pela fila do canal. A marcação "em processamento" só é feita na hora de entregar ao WhatsApp,
    //    para um reinício durante a espera do ritmo não ser confundido com envio interrompido.
    inFlight.add(command.commandId);
    try {
        const result = await session.send({
            recipient,
            textLength: content.kind === 'text' ? content.text.length : (content.caption?.length ?? 0),
            buildContent: () => buildMessageContent(content, (key) => deps.storage.openMedia(key), deps.mediaMaxBytes),
            claim: async () => {
                const ok = await redis.set(idemKey, JSON.stringify({ state: 'processing' } satisfies Outcome), 'EX', PROCESSING_TTL_S, 'NX');
                claimed = ok === 'OK';
                return claimed;
            }
        });
        await session.rememberSent(result.providerMessageId, messageId, command.correlationId);
        await redis.set(
            idemKey,
            JSON.stringify({ state: 'done', providerMessageId: result.providerMessageId, jid: result.jid } satisfies Outcome),
            'EX',
            DONE_TTL_S
        );
        await events.publish(ctx, 'message.status', `${result.providerMessageId}:SENT`, {
            messageId,
            status: 'SENT',
            providerMessageId: result.providerMessageId,
            recipientExternalId: result.jid
        });
        log.info({ to: mask(result.jid) }, 'mensagem enviada');
        return 'done';
    } catch (err) {
        // Outra entrega do mesmo comando chegou antes ao WhatsApp; ela publica o resultado.
        if (err instanceof DuplicateSendError) return 'done';
        if (err instanceof CommandError) {
            if (err.retryable && info.canRetry) {
                if (claimed) await redis.del(idemKey);
                log.warn({ errorCode: err.code, attempt: info.attempt }, 'falha temporária; mensagem volta para a fila');
                return 'retry';
            }
            return fail(err.code, err.message);
        }
        log.error({ err }, 'erro inesperado no envio');
        return fail('PROVIDER_ERROR', 'erro inesperado no worker');
    } finally {
        inFlight.delete(command.commandId);
    }
}
