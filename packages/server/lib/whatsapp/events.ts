import * as z from 'zod';

import { logContextGetter } from '@nangohq/logs';

import { getPairing, savePairing, updatePairing } from './pairing.js';

/**
 * The envelope of the StackChat channel contract. The gateway already validated each event against the contract,
 * so only what the server reads is checked here; the rest is kept as is for forwarding.
 */
export const gatewayEventSchema = z.looseObject({
    version: z.literal(1),
    eventId: z.uuid(),
    tenantId: z.uuid(),
    channelId: z.uuid(),
    type: z.string().min(1),
    providerEventId: z.string().min(1),
    payload: z.looseObject({}),
    occurredAt: z.string()
});
export type GatewayEvent = z.infer<typeof gatewayEventSchema>;

const qrPayload = z.object({ qr: z.string().min(1), expiresAt: z.string().optional() });
const statusPayload = z.object({
    status: z.enum(['CONNECTING', 'QR_PENDING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'BANNED']),
    reason: z.string().optional(),
    account: z.object({ externalId: z.string(), phone: z.string().optional(), name: z.string().optional() }).optional()
});

export async function handleGatewayEvent(event: GatewayEvent): Promise<void> {
    switch (event.type) {
        case 'channel.qr':
            await onQr(event);
            return;
        case 'channel.status':
            await onStatus(event);
            return;
        default:
            return;
    }
}

async function onQr(event: GatewayEvent): Promise<void> {
    const payload = qrPayload.safeParse(event.payload);
    if (!payload.success) {
        return;
    }
    await updatePairing(event.channelId, (pairing) => {
        if (pairing.tenantId !== event.tenantId || pairing.status === 'connected' || pairing.status === 'failed') {
            return null;
        }
        return { ...pairing, status: 'qr', qr: payload.data.qr, qrExpiresAt: payload.data.expiresAt ?? null };
    });
}

async function onStatus(event: GatewayEvent): Promise<void> {
    const payload = statusPayload.safeParse(event.payload);
    if (!payload.success) {
        return;
    }
    const { status, reason, account } = payload.data;

    const pairing = await getPairing(event.channelId);
    if (!pairing || pairing.tenantId !== event.tenantId || pairing.connectionCreated) {
        return;
    }

    if (status === 'CONNECTED' && account) {
        await savePairing({
            ...pairing,
            status: 'connected',
            qr: null,
            qrExpiresAt: null,
            account: { jid: account.externalId, phone: account.phone ?? null, name: account.name ?? null }
        });
        return;
    }

    if ((status === 'DISCONNECTED' || status === 'BANNED') && pairing.status !== 'failed') {
        const error = (reason ?? status).toLowerCase();
        await savePairing({ ...pairing, status: 'failed', qr: null, qrExpiresAt: null, error });

        const logCtx = logContextGetter.get({ id: pairing.operationId, accountId: pairing.accountId });
        void logCtx.error('WhatsApp pairing failed', { sessionId: pairing.sessionId, status, reason });
        await logCtx.failed();
    }
}
