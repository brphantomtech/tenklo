import type { ApiError, Endpoint } from '../api.js';

/** An event of the whatsapp-gateway (StackChat channel contract envelope). Internal: only the gateway calls it. */
export type PostInternalWhatsAppEvent = Endpoint<{
    Method: 'POST';
    Path: '/internal/whatsapp/events';
    Body: Record<string, unknown>;
    Success: never;
    Error: ApiError<'unauthorized'> | ApiError<'invalid_body'>;
}>;
