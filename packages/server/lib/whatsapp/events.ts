import * as z from 'zod';

import db from '@nangohq/database';
import { getKVStore } from '@nangohq/kvstore';
import { logContextGetter } from '@nangohq/logs';
import { connectionService, customerKeyService, externalWebhookService } from '@nangohq/shared';
import { getLogger, report } from '@nangohq/utils';
import { forwardWebhook } from '@nangohq/webhooks';

import { connectionRefreshFailed, connectionRefreshSuccess } from '../hooks/hooks.js';
import { findConnectionBySession } from './connections.js';
import { GATEWAY_OF_CHANNEL_TYPE, sendGatewayCommand } from './gateway.js';
import { getPairing, savePairing, updatePairing } from './pairing.js';
import { saveSessionStatus } from './status.js';

import type { WhatsAppConnection } from './connections.js';
import type { Pairing } from './pairing.js';

const logger = getLogger('WhatsApp.Events');

/**
 * The envelope of the StackChat channel contract. The gateway already validated each event against the contract,
 * so only what the server reads is checked here; the rest is kept as is for forwarding.
 */
export const gatewayEventSchema = z.looseObject({
    version: z.literal(1),
    eventId: z.uuid(),
    tenantId: z.uuid(),
    channelId: z.uuid(),
    channelType: z.string().optional(),
    type: z.string().min(1),
    providerEventId: z.string().min(1),
    payload: z.looseObject({}),
    occurredAt: z.string()
});
export type GatewayEvent = z.infer<typeof gatewayEventSchema>;

/** The events a connection's webhooks receive, unchanged. channel.qr only matters to the Connect UI. */
export const FORWARDED_EVENTS = new Set(['message.received', 'message.status', 'channel.status', 'groups.synced', 'command.failed']);

/** Session endings the number has to scan a new QR code to recover from. */
const TERMINAL_REASONS = new Set(['LOGGED_OUT', 'SESSION_INVALID', 'BANNED']);

const ORPHAN_LOGOUT_TTL_MS = 10 * 60 * 1000;

const qrPayload = z.object({ qr: z.string().min(1), expiresAt: z.string().optional() });
const statusPayload = z.object({
    status: z.enum(['CONNECTING', 'QR_PENDING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'BANNED']),
    reason: z.string().optional(),
    account: z.object({ externalId: z.string(), phone: z.string().optional(), name: z.string().optional(), username: z.string().optional() }).optional(),
    sendRestriction: z.object({ active: z.boolean(), until: z.string().optional(), enforcementType: z.string().optional() }).optional()
});
type StatusPayload = z.infer<typeof statusPayload>;

/**
 * Routes an event of the gateway. A session is either pairing (the Connect UI follows it), behind a connection (its
 * events go to the customer's webhooks), or neither: an orphan, logged out so it stops holding a WhatsApp session or polling a bot.
 */
export async function handleGatewayEvent(event: GatewayEvent): Promise<void> {
    const stored = await getPairing(event.channelId);
    const pairing = stored && stored.tenantId === event.tenantId ? stored : null;
    if (pairing && !pairing.connectionCreated) {
        await onPairingEvent(pairing, event);
    }

    const target = await findConnectionBySession({ tenantId: event.tenantId, sessionId: event.channelId });
    if (!target && !pairing) {
        await logOutOrphan(event);
        return;
    }

    const status = event.type === 'channel.status' ? statusPayload.safeParse(event.payload) : null;
    if (status?.success) {
        // Saved while pairing too: the CONNECTED that ends a pairing arrives before its connection exists.
        await saveSessionStatus(event.channelId, {
            status: status.data.status,
            reason: status.data.reason ?? null,
            account: status.data.account ?? null,
            sendRestriction: status.data.sendRestriction ?? null,
            updatedAt: event.occurredAt
        });
    }
    if (!target) {
        return;
    }

    if (status?.success) {
        await onConnectionStatus(target, status.data);
    }

    if (FORWARDED_EVENTS.has(event.type)) {
        await forwardToWebhooks(target, event);
    }
}

async function onPairingEvent(pairing: Pairing, event: GatewayEvent): Promise<void> {
    if (event.type === 'channel.qr') {
        const payload = qrPayload.safeParse(event.payload);
        if (!payload.success) {
            return;
        }
        await updatePairing(event.channelId, (current) => {
            if (current.status === 'connected' || current.status === 'failed' || current.connectionCreated) {
                return null;
            }
            return { ...current, status: 'qr', qr: payload.data.qr, qrExpiresAt: payload.data.expiresAt ?? null };
        });
        return;
    }

    if (event.type !== 'channel.status') {
        return;
    }
    const payload = statusPayload.safeParse(event.payload);
    if (!payload.success) {
        return;
    }
    const { status, reason, account } = payload.data;

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

/** Flags the connection while its number is logged out or banned. */
async function onConnectionStatus(target: WhatsAppConnection, payload: StatusPayload): Promise<void> {
    const { account, environment, connection, config, provider } = target;

    if (payload.status === 'CONNECTED') {
        // Clears a previous logout or ban error, and tells the customer the connection recovered.
        await connectionRefreshSuccess({ connection, config, account, environment, provider });
        return;
    }

    const reason = payload.status === 'BANNED' ? 'BANNED' : payload.status === 'DISCONNECTED' ? payload.reason : undefined;
    if (!reason || !TERMINAL_REASONS.has(reason)) {
        return;
    }

    const logCtx = await logContextGetter.create(
        { operation: { type: 'auth', action: 'connection_test' } },
        {
            account,
            environment,
            integration: config.id ? { id: config.id, name: config.unique_key, provider: config.provider } : undefined,
            connection: { id: connection.id, name: connection.connection_id }
        }
    );
    void logCtx.error('The WhatsApp number disconnected: it has to scan a new QR code', { sessionId: target.sessionId, reason });
    await logCtx.failed();

    await connectionRefreshFailed({
        account,
        connection,
        environment,
        provider,
        config,
        logCtx,
        authError: {
            type: `whatsapp_${reason.toLowerCase()}`,
            description: 'The WhatsApp session ended: reconnect the number by scanning a new QR code'
        },
        action: 'connection_test'
    });
}

/** Sends a contract event to the connection's webhooks, as a forwarded webhook whose payload is the event itself. */
async function forwardToWebhooks(target: WhatsAppConnection, event: GatewayEvent): Promise<void> {
    const { account, environment, connection, config } = target;

    const webhookSettings = await externalWebhookService.get(environment.id);
    if (!webhookSettings) {
        return;
    }
    const signingKey = await customerKeyService.getWebhookSigningKeyForEnv(db.knex, environment.id);
    if (signingKey.isErr()) {
        report(new Error('whatsapp_forward_failed', { cause: signingKey.error }), { connectionId: connection.id });
        return;
    }
    const webhookUrlOverrideByConnectionId = await connectionService.getWebhookUrlOverridesByConnectionIds({
        connectionIds: [connection.connection_id],
        provider_config_key: config.unique_key,
        environment_id: environment.id
    });

    // Not awaited: a slow customer endpoint must not hold the gateway, which only retries when this server fails.
    void forwardWebhook({
        integration: config,
        account,
        environment,
        secret: signingKey.value,
        webhookSettings,
        connectionIds: [connection.connection_id],
        webhookUrlOverrideByConnectionId,
        payload: event,
        webhookOriginalHeaders: {},
        logContextGetter
    }).catch((err: unknown) => {
        logger.error(`error forwarding a WhatsApp event for ${config.unique_key}`, err);
    });
}

/**
 * A session that belongs to no pairing and no connection: its pairing expired before the connection was created, or
 * its connection was deleted without its session being logged out (deleting an integration, for instance). Logged out
 * at most once per ORPHAN_LOGOUT_TTL_MS, so the events it sends while closing don't trigger new logouts.
 */
async function logOutOrphan(event: GatewayEvent): Promise<void> {
    if (event.type === 'channel.status') {
        const payload = statusPayload.safeParse(event.payload);
        if (payload.success && (payload.data.status === 'DISCONNECTED' || payload.data.status === 'BANNED')) {
            return;
        }
    }

    const kv = await getKVStore();
    try {
        await kv.set(`whatsapp:orphan:${event.channelId}`, '1', { canOverride: false, ttlMs: ORPHAN_LOGOUT_TTL_MS });
    } catch {
        return;
    }

    logger.info(`Logging out orphan WhatsApp session ${event.channelId}`);
    const gateway = (event.channelType && GATEWAY_OF_CHANNEL_TYPE[event.channelType]) || 'whatsapp';
    const sent = await sendGatewayCommand(
        { tenantId: event.tenantId, channelId: event.channelId, gateway },
        { type: 'channel.disconnect', payload: { clearSession: true } }
    );
    if (sent.isErr()) {
        logger.error(`failed to log out orphan WhatsApp session ${event.channelId}`, sent.error);
    }
}
