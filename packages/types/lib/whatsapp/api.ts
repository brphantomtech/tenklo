import type { ApiEndpoint, ApiError, Endpoint } from '../api.js';
import type { NoAudit } from '../audit-trail/event.js';

/** An event of the whatsapp-gateway (StackChat channel contract envelope). Internal: only the gateway calls it. */
export type PostInternalWhatsAppEvent = Endpoint<{
    Method: 'POST';
    Path: '/internal/whatsapp/events';
    Body: Record<string, unknown>;
    Success: never;
    Error: ApiError<'unauthorized'> | ApiError<'invalid_body'>;
}>;

// The public WhatsApp API keeps the StackChat channel contract shapes (camelCase), so a message built for the
// contract's message.send can be sent as is, and the webhooks carry the contract events unchanged.

/** In a contact, externalId is the JID or just the phone digits with the country code. In a group, the group JID (@g.us). */
export interface WhatsAppRecipient {
    kind: 'contact' | 'group';
    externalId: string;
}

/** A file in the WhatsApp media bucket, as returned by POST /whatsapp/media. */
export interface WhatsAppMediaRef {
    objectKey: string;
    mimeType: string;
    fileName?: string | undefined;
    sizeBytes?: number | undefined;
}

export type WhatsAppMessageContent =
    | { kind: 'text'; text: string }
    | { kind: 'image' | 'video' | 'audio' | 'document'; media: WhatsAppMediaRef; caption?: string | undefined };

export type WhatsAppChannelStatus = 'CONNECTING' | 'QR_PENDING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'BANNED';

/** The last channel.status the gateway reported for a connection's session. */
export interface WhatsAppConnectionStatus {
    status: WhatsAppChannelStatus | 'UNKNOWN';
    reason: string | null;
    account: { externalId: string; phone?: string | undefined; name?: string | undefined } | null;
    sendRestriction: { active: boolean; until?: string | undefined; enforcementType?: string | undefined } | null;
    updatedAt: string | null;
}

interface WhatsAppConnectionHeaders {
    'provider-config-key': string;
    'connection-id': string;
}

type WhatsAppConnectionError =
    | ApiError<'invalid_headers'>
    | ApiError<'unknown_connection'>
    | ApiError<'invalid_connection'>
    | ApiError<'whatsapp_gateway_unavailable'>;

export type PostPublicWhatsAppMessage = ApiEndpoint<{
    Audit: NoAudit;
    Method: 'POST';
    Path: '/whatsapp/messages';
    Headers: WhatsAppConnectionHeaders;
    Body: {
        /** Returned in the message.status webhooks. Generated when missing. */
        messageId?: string | undefined;
        to: WhatsAppRecipient;
        content: WhatsAppMessageContent;
    };
    Success: { messageId: string; commandId: string };
    Error: WhatsAppConnectionError | ApiError<'invalid_body'> | ApiError<'unknown_media'>;
}>;

export type PostPublicWhatsAppMedia = ApiEndpoint<{
    Audit: NoAudit;
    Method: 'POST';
    Path: '/whatsapp/media';
    Headers: WhatsAppConnectionHeaders;
    Querystring: { file_name?: string | undefined };
    Success: WhatsAppMediaRef & { sizeBytes: number };
    Error: WhatsAppConnectionError | ApiError<'invalid_query_params'> | ApiError<'invalid_body'> | ApiError<'media_too_large'>;
}>;

export type GetPublicWhatsAppMedia = ApiEndpoint<{
    Audit: NoAudit;
    Method: 'GET';
    Path: '/whatsapp/media';
    Headers: WhatsAppConnectionHeaders;
    Querystring: { object_key: string };
    /** The file itself. */
    Success: never;
    Error: WhatsAppConnectionError | ApiError<'invalid_query_params'> | ApiError<'unknown_media'>;
}>;

export type PostPublicWhatsAppGroupsSync = ApiEndpoint<{
    Audit: NoAudit;
    Method: 'POST';
    Path: '/whatsapp/groups/sync';
    Headers: WhatsAppConnectionHeaders;
    /** The groups arrive in a groups.synced webhook. */
    Success: { commandId: string };
    Error: WhatsAppConnectionError;
}>;

export type GetPublicWhatsAppStatus = ApiEndpoint<{
    Audit: NoAudit;
    Method: 'GET';
    Path: '/whatsapp/status';
    Headers: WhatsAppConnectionHeaders;
    Success: WhatsAppConnectionStatus;
    Error: WhatsAppConnectionError;
}>;
