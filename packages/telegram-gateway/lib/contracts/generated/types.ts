/* Gerado por StackChat_V2_Contracts/scripts/generate.mjs. Não edite à mão. */

/**
 * Qualquer comando do core para um worker.
 */
export type Command = MessageSendCommand | ChannelConnectCommand | ChannelDisconnectCommand | GroupsSyncCommand;
export type MessageContent = TextContent | MediaContent;
/**
 * Qualquer evento de um worker para o core.
 */
export type Event = ChannelQrEvent | ChannelStatusEvent | MessageStatusEvent | MessageReceivedEvent | GroupsSyncedEvent | CommandFailedEvent;
export type ChannelType = 'WHATSAPP_LIB' | 'WHATSAPP_OFC' | 'TELEGRAM' | 'INSTAGRAM';
export type ChannelStatus = 'CONNECTING' | 'QR_PENDING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'BANNED';
export type ChannelStatusReason =
    | 'REQUESTED'
    | 'LOGGED_OUT'
    | 'QR_TIMEOUT'
    | 'CONNECTION_REPLACED'
    | 'SESSION_INVALID'
    | 'BANNED'
    | 'LOCK_LOST'
    | 'SHUTDOWN'
    | 'CONNECTION_LOST'
    | 'UNKNOWN';
/**
 * Motivo de uma falha definitiva. O worker já esgotou as retentativas antes de reportar.
 */
export type ErrorCode =
    | 'CHANNEL_NOT_CONNECTED'
    | 'CHANNEL_SEND_RESTRICTED'
    | 'NOT_ON_WHATSAPP'
    | 'INVALID_RECIPIENT'
    | 'GROUP_SEND_FORBIDDEN'
    | 'RECIPIENT_BLOCKED'
    | 'MEDIA_NOT_FOUND'
    | 'MEDIA_TOO_LARGE'
    | 'UNSUPPORTED_CONTENT'
    | 'INVALID_COMMAND'
    | 'TIMEOUT'
    | 'PROVIDER_ERROR';

/**
 * Envia uma mensagem. Fila: queue_<canal>.send. O resultado volta como message.status.
 */
export interface MessageSendCommand {
    version: 1;
    /**
     * Chave de idempotência: o worker ignora um commandId já executado.
     */
    commandId: string;
    /**
     * Repetido em todos os eventos causados por este comando.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    type: 'message.send';
    payload: {
        /**
         * Id da mensagem no core, devolvido em message.status.
         */
        messageId: string;
        to: Recipient;
        content: MessageContent;
    };
    createdAt: string;
}
/**
 * Destino da mensagem. WhatsApp: em contato, o JID ou só os dígitos do telefone com DDI (o worker resolve o JID real); em grupo, o JID do grupo (@g.us). Telegram: id do chat (o do usuário, ou o do grupo ou canal, negativo).
 */
export interface Recipient {
    kind: 'contact' | 'group';
    externalId: string;
}
export interface TextContent {
    kind: 'text';
    text: string;
}
export interface MediaContent {
    kind: 'image' | 'video' | 'audio' | 'document';
    media: MediaRef;
    caption?: string;
}
/**
 * Arquivo no bucket de mídia do RustFS. O worker lê direto do bucket.
 */
export interface MediaRef {
    objectKey: string;
    mimeType: string;
    fileName?: string;
    sizeBytes?: number;
}
/**
 * Abre a sessão do canal. WhatsApp por QR Code: sem sessão salva, o worker publica channel.qr até o pareamento. Telegram: o worker valida o token do bot e passa a receber as mensagens. Fila: queue_<canal>.control.
 */
export interface ChannelConnectCommand {
    version: 1;
    /**
     * Chave de idempotência: o worker ignora um commandId já executado.
     */
    commandId: string;
    /**
     * Repetido em todos os eventos causados por este comando.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    type: 'channel.connect';
    payload: {
        /**
         * Só Telegram: token do bot (BotFather) cifrado com a chave compartilhada CHANNEL_CREDENTIALS_KEY (README, seção Telegram). O core manda em todo pedido de conexão; o worker guarda para retomar a sessão sozinho. Nem cifrado vai para log.
         */
        sealedBotToken?: string;
    };
    createdAt: string;
}
/**
 * Fecha a sessão. Com clearSession, desloga o aparelho e apaga a sessão salva. Fila: queue_<canal>.control.
 */
export interface ChannelDisconnectCommand {
    version: 1;
    /**
     * Chave de idempotência: o worker ignora um commandId já executado.
     */
    commandId: string;
    /**
     * Repetido em todos os eventos causados por este comando.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    type: 'channel.disconnect';
    payload: {
        clearSession: boolean;
    };
    createdAt: string;
}
/**
 * Pede a lista de grupos de que o número participa. O resultado volta como groups.synced. Fila: queue_<canal>.control.
 */
export interface GroupsSyncCommand {
    version: 1;
    /**
     * Chave de idempotência: o worker ignora um commandId já executado.
     */
    commandId: string;
    /**
     * Repetido em todos os eventos causados por este comando.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    type: 'groups.sync';
    payload: {};
    createdAt: string;
}
/**
 * Novo QR Code para parear o aparelho. O core repassa à tela e não grava. Nunca registrar o conteúdo em log.
 */
export interface ChannelQrEvent {
    version: 1;
    eventId: string;
    /**
     * O do comando que causou o evento; um novo quando o evento é espontâneo.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    type: 'channel.qr';
    /**
     * Chave de deduplicação no core: (channelId, providerEventId) é único.
     */
    providerEventId: string;
    payload: {
        /**
         * Conteúdo a ser desenhado como QR Code.
         */
        qr: string;
        /**
         * Número do QR nesta tentativa de conexão.
         */
        attempt: number;
        expiresAt?: string;
    };
    occurredAt: string;
}
/**
 * Mudança de estado da conexão do canal.
 */
export interface ChannelStatusEvent {
    version: 1;
    eventId: string;
    /**
     * O do comando que causou o evento; um novo quando o evento é espontâneo.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    type: 'channel.status';
    /**
     * Chave de deduplicação no core: (channelId, providerEventId) é único.
     */
    providerEventId: string;
    payload: {
        status: ChannelStatus;
        reason?: ChannelStatusReason;
        account?: {
            /**
             * WhatsApp: JID do número conectado. Telegram: id do bot.
             */
            externalId: string;
            phone?: string;
            name?: string;
            /**
             * Telegram: @username do bot, sem o @ (link t.me/<username>).
             */
            username?: string;
        };
        sendRestriction?: {
            /**
             * O WhatsApp está bloqueando envios para quem não é contato (reachout timelock).
             */
            active: boolean;
            until?: string;
            enforcementType?: string;
        };
    };
    occurredAt: string;
}
/**
 * Situação de uma mensagem enviada. Em grupos, só SENT e FAILED.
 */
export interface MessageStatusEvent {
    version: 1;
    eventId: string;
    /**
     * O do comando que causou o evento; um novo quando o evento é espontâneo.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    type: 'message.status';
    /**
     * Chave de deduplicação no core: (channelId, providerEventId) é único.
     */
    providerEventId: string;
    payload: {
        messageId: string;
        status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
        providerMessageId?: string;
        /**
         * JID efetivo do destino, resolvido pelo worker (ex.: telefone com ou sem o nono dígito).
         */
        recipientExternalId?: string;
        errorCode?: ErrorCode;
        /**
         * Texto técnico, sem conteúdo da mensagem.
         */
        errorMessage?: string;
    };
    occurredAt: string;
}
/**
 * Mensagem de uma conversa do número conectado: recebida de um contato ou num grupo, ou enviada pelo próprio número em outro aparelho (fromMe, só em conversa individual). Não inclui as enviadas por este worker (voltam em message.status), status e broadcasts, canais (@newsletter) nem mensagens de protocolo ou sistema. providerEventId = received:<providerMessageId>.
 */
export interface MessageReceivedEvent {
    version: 1;
    eventId: string;
    /**
     * O do comando que causou o evento; um novo quando o evento é espontâneo.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    type: 'message.received';
    /**
     * Chave de deduplicação no core: (channelId, providerEventId) é único. Sempre received:<providerMessageId>.
     */
    providerEventId: string;
    payload: {
        /**
         * Id da mensagem no provedor. Telegram: <chatId>:<messageId>, porque o id da mensagem só é único dentro da conversa.
         */
        providerMessageId: string;
        /**
         * Conversa onde a mensagem chegou: o contato (conversa individual) ou o grupo.
         */
        chat: {
            type: 'contact' | 'group';
            /**
             * Id da conversa. WhatsApp: JID do contato (@s.whatsapp.net ou @lid) ou do grupo (@g.us). Telegram: id do chat (o do usuário na conversa individual; negativo em grupo).
             */
            externalId: string;
        };
        /**
         * Quem enviou. Em conversa individual, o próprio contato; em grupo, o participante; com fromMe, o número conectado.
         */
        from: {
            /**
             * Id do remetente. WhatsApp: JID (@s.whatsapp.net ou @lid). Telegram: id do usuário.
             */
            externalId: string;
            /**
             * Dígitos do telefone com DDI, quando o worker consegue resolver (inclusive a partir de um @lid); null quando não.
             */
            phone: string | null;
            /**
             * Nome de exibição do remetente (WhatsApp: pushName; Telegram: nome e sobrenome), quando disponível.
             */
            name: string | null;
            /**
             * Só Telegram: @username do remetente, sem o @, quando ele tem um. Opcional.
             */
            username?: string | null;
        };
        /**
         * Horário da mensagem segundo o provedor.
         */
        sentAt: string;
        content: {
            kind: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'reaction' | 'other';
            /**
             * Texto da mensagem ou legenda da mídia, truncado em 4096 caracteres; em reação, o emoji; null quando não há texto.
             */
            text: string | null;
        };
        /**
         * providerMessageId da mensagem respondida (resposta com citação) ou, em reação, da mensagem reagida; null quando não há.
         */
        quotedProviderMessageId: string | null;
        /**
         * true: enviada pelo próprio número em outro aparelho (celular, WhatsApp Web), nunca por este worker. Só em conversa individual; chat é o contato. Ausente equivale a false.
         */
        fromMe?: boolean;
        /**
         * Arquivo da mensagem (imagem, vídeo, áudio, documento, figurinha), já gravado pelo worker no bucket de mídia. null quando a mensagem não tem arquivo, ou quando ele não pôde ser baixado ou passa do limite. Ausente: worker sem suporte a mídia recebida.
         */
        media?: {
            /**
             * Chave no bucket de mídia: tenants/<tenantId>/inbox/<channelId>/<providerMessageId>.
             */
            objectKey: string;
            contentType: string;
            /**
             * Nome original (documentos); null quando não há.
             */
            fileName: string | null;
            sizeBytes: number;
        } | null;
    };
    occurredAt: string;
}
/**
 * Foto completa dos grupos de que o número participa. Substitui a lista anterior do canal.
 */
export interface GroupsSyncedEvent {
    version: 1;
    eventId: string;
    /**
     * O do comando que causou o evento; um novo quando o evento é espontâneo.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    type: 'groups.synced';
    /**
     * Chave de deduplicação no core: (channelId, providerEventId) é único.
     */
    providerEventId: string;
    payload: {
        groups: {
            /**
             * WhatsApp: JID do grupo (@g.us). Telegram: id do grupo ou canal (número negativo).
             */
            externalId: string;
            name: string;
            participantsCount: number;
            isAdmin: boolean;
            /**
             * Só administradores enviam mensagens.
             */
            announce: boolean;
            /**
             * O número conectado pode enviar no grupo.
             */
            canSend: boolean;
        }[];
    };
    occurredAt: string;
}
/**
 * Um comando de controle (connect, disconnect, groups.sync) falhou de forma definitiva. Falhas de message.send voltam como message.status FAILED.
 */
export interface CommandFailedEvent {
    version: 1;
    eventId: string;
    /**
     * O do comando que causou o evento; um novo quando o evento é espontâneo.
     */
    correlationId: string;
    tenantId: string;
    channelId: string;
    channelType: ChannelType;
    type: 'command.failed';
    /**
     * Chave de deduplicação no core: (channelId, providerEventId) é único.
     */
    providerEventId: string;
    payload: {
        commandId: string;
        commandType: string;
        errorCode: ErrorCode;
        errorMessage?: string;
    };
    occurredAt: string;
}
