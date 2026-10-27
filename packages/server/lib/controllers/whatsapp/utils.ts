import type { WhatsAppApiError } from '../../whatsapp/connections.js';
import type { Response } from 'express';

export function sendWhatsAppApiError(res: Response, err: WhatsAppApiError): void {
    res.status(err.status).send({ error: { code: err.code, ...(err.errors ? { errors: err.errors } : { message: err.message }) } });
}

/** The gateway is down or refused the request: the caller can retry later. */
export function sendGatewayUnavailable(res: Response): void {
    res.status(503).send({ error: { code: 'whatsapp_gateway_unavailable', message: 'The WhatsApp gateway did not accept the request, retry later' } });
}
