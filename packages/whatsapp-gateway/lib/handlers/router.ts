import { ChannelLockedError, CommandError } from '../errors.js';
import { summarizeGroups } from '../whatsapp/rules.js';
import { handleSendMessage } from './send-message.js';

import type { CommandHandler, HandlerResult, InvalidHandler } from '../commands/dispatcher.js';
import type { Command, ErrorCode } from '../contracts/index.js';
import type { EventContext } from '../events/publisher.js';
import type { SendMessageDeps } from './send-message.js';

/**
 * Despacha pelo tipo do comando, não pela fila: um comando publicado na fila errada ainda é executado.
 * Falhas definitivas de controle viram command.failed; as de envio, message.status FAILED.
 */
export function createCommandRouter(deps: SendMessageDeps): { handle: CommandHandler; onInvalid: InvalidHandler } {
    const { manager, events, logger } = deps;

    const commandFailed = async (command: Command, code: ErrorCode, message: string): Promise<HandlerResult> => {
        logger.warn({ channelId: command.channelId, commandType: command.type, errorCode: code, error: message }, 'comando de controle falhou');
        await events.publish(ctxOf(command), 'command.failed', `failed:${command.commandId}`, {
            commandId: command.commandId,
            commandType: command.type,
            errorCode: code,
            errorMessage: message.slice(0, 500)
        });
        return 'done';
    };

    /** Erro inesperado ou lock com outra instância: tenta de novo enquanto der; depois, falha definitiva. */
    const retryOrFail = async (command: Command, canRetry: boolean, err: unknown): Promise<HandlerResult> => {
        if (canRetry) {
            logger.warn({ err, commandType: command.type, channelId: command.channelId }, 'comando será retentado');
            return 'retry';
        }
        const message = err instanceof ChannelLockedError ? 'a sessão do canal está aberta em outra instância' : 'erro inesperado no worker';
        return commandFailed(command, 'PROVIDER_ERROR', message);
    };

    const handle: CommandHandler = async (command, info) => {
        switch (command.type) {
            case 'message.send':
                return handleSendMessage(command, info, deps);

            case 'channel.connect':
                try {
                    await manager.connect(command.tenantId, command.channelId, command.correlationId);
                    return 'done';
                } catch (err) {
                    return retryOrFail(command, info.canRetry, err);
                }

            case 'channel.disconnect':
                try {
                    await manager.disconnect(command.tenantId, command.channelId, command.correlationId, command.payload.clearSession);
                    return 'done';
                } catch (err) {
                    return retryOrFail(command, info.canRetry, err);
                }

            case 'groups.sync': {
                const session = manager.get(command.channelId);
                if (!session?.isOpen) {
                    if (session?.isTransient && info.canRetry) return 'retry';
                    return commandFailed(command, 'CHANNEL_NOT_CONNECTED', 'o canal não está conectado');
                }
                try {
                    const { groups, me } = await session.fetchGroups();
                    await events.publish(ctxOf(command), 'groups.synced', `groups:${command.commandId}`, {
                        groups: summarizeGroups(groups, me)
                    });
                    return 'done';
                } catch (err) {
                    if (err instanceof CommandError && !err.retryable) return commandFailed(command, err.code, err.message);
                    return retryOrFail(command, info.canRetry, err);
                }
            }
        }
    };

    /** Comando fora do contrato. Se for um envio identificável, o core recebe FAILED em vez de ficar PENDING. */
    const onInvalid: InvalidHandler = async (raw, error) => {
        const cmd = raw as Partial<{
            type: string;
            tenantId: string;
            channelId: string;
            correlationId: string;
            commandId: string;
            payload: { messageId?: string };
        }>;
        const messageId = cmd.payload?.messageId;
        if (cmd.type !== 'message.send' || !cmd.tenantId || !cmd.channelId || !cmd.correlationId || !cmd.commandId || !messageId) return;
        try {
            await events.publish(
                { tenantId: cmd.tenantId, channelId: cmd.channelId, correlationId: cmd.correlationId },
                'message.status',
                `failed:${cmd.commandId}`,
                { messageId, status: 'FAILED', errorCode: 'INVALID_COMMAND', errorMessage: error.slice(0, 500) }
            );
        } catch (err) {
            // Ids malformados também invalidam o evento; a mensagem fica na DLQ para análise.
            logger.warn({ err }, 'não foi possível avisar o core sobre o comando inválido');
        }
    };

    return { handle, onInvalid };
}

function ctxOf(command: Command): EventContext {
    return { tenantId: command.tenantId, channelId: command.channelId, correlationId: command.correlationId };
}
