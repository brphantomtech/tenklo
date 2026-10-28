import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGatewayEvent } from './events.js';
import { getPairing, savePairing, toPairingView } from './pairing.js';
import { getSessionStatus } from './status.js';

import type { WhatsAppConnection } from './connections.js';
import type { GatewayEvent } from './events.js';
import type { Pairing } from './pairing.js';

const logCtx = vi.hoisted(() => ({ error: vi.fn(), failed: vi.fn() }));
vi.mock('@nangohq/logs', () => ({ logContextGetter: { get: () => logCtx, create: () => Promise.resolve(logCtx) } }));

const mocks = vi.hoisted(() => ({
    findConnectionBySession: vi.fn(),
    sendGatewayCommand: vi.fn(),
    forwardWebhook: vi.fn(),
    connectionRefreshFailed: vi.fn(),
    connectionRefreshSuccess: vi.fn()
}));
vi.mock('./connections.js', () => ({ findConnectionBySession: mocks.findConnectionBySession }));
vi.mock('./gateway.js', () => ({ sendGatewayCommand: mocks.sendGatewayCommand, GATEWAY_OF_CHANNEL_TYPE: { WHATSAPP_LIB: 'whatsapp', TELEGRAM: 'telegram' } }));
vi.mock('@nangohq/webhooks', () => ({ forwardWebhook: mocks.forwardWebhook }));
vi.mock('../hooks/hooks.js', () => ({ connectionRefreshFailed: mocks.connectionRefreshFailed, connectionRefreshSuccess: mocks.connectionRefreshSuccess }));
vi.mock('@nangohq/database', () => ({ default: { knex: {} } }));
vi.mock('@nangohq/shared', () => ({
    externalWebhookService: { get: () => Promise.resolve({ primary_url: 'https://customer.test/webhooks', secondary_url: null }) },
    customerKeyService: { getWebhookSigningKeyForEnv: () => Promise.resolve({ isErr: () => false, value: 'signing-key' }) },
    connectionService: { getWebhookUrlOverridesByConnectionIds: () => Promise.resolve(new Map()) }
}));

const TENANT = '7d0c3a52-4f7e-4d55-9b6e-2f7f4c1a9e01';

function pairingFixture(overrides: Partial<Pairing> = {}): Pairing {
    return {
        sessionId: randomUUID(),
        accountId: 1,
        environmentId: 2,
        tenantId: TENANT,
        providerConfigKey: 'whatsapp',
        connectionId: 'conn-1',
        operationId: 'op-1',
        status: 'starting',
        qr: null,
        qrExpiresAt: null,
        error: null,
        account: null,
        connectionCreated: false,
        ...overrides
    };
}

function connectionFixture(sessionId: string): WhatsAppConnection {
    return {
        account: { id: 1 },
        environment: { id: 2, uuid: TENANT },
        connection: { id: 10, connection_id: 'conn-1', provider_config_key: 'whatsapp' },
        config: { id: 3, unique_key: 'whatsapp', provider: 'whatsapp-web', forward_webhooks: true },
        provider: { auth_mode: 'WHATSAPP_QR' },
        sessionId
    } as unknown as WhatsAppConnection;
}

function event(sessionId: string, type: string, payload: Record<string, unknown>, tenantId = TENANT): GatewayEvent {
    return {
        version: 1,
        eventId: randomUUID(),
        tenantId,
        channelId: sessionId,
        type,
        providerEventId: randomUUID(),
        payload,
        occurredAt: new Date().toISOString()
    };
}

describe('handleGatewayEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findConnectionBySession.mockResolvedValue(null);
        mocks.sendGatewayCommand.mockResolvedValue({ isErr: () => false, value: { commandId: 'c1' } });
        mocks.forwardWebhook.mockResolvedValue({ isOk: () => true });
    });

    describe('a pairing', () => {
        it('stores each QR code', async () => {
            const pairing = pairingFixture();
            await savePairing(pairing);

            await handleGatewayEvent(event(pairing.sessionId, 'channel.qr', { qr: 'qr-1', attempt: 1, expiresAt: '2026-10-27T12:01:00.000Z' }));
            await handleGatewayEvent(event(pairing.sessionId, 'channel.qr', { qr: 'qr-2', attempt: 2 }));

            const stored = await getPairing(pairing.sessionId);
            expect(stored).toMatchObject({ status: 'qr', qr: 'qr-2', qrExpiresAt: null });
            expect(toPairingView(stored!)).toMatchObject({ status: 'qr', qr: 'qr-2' });
        });

        it('is marked connected with the paired account, without exposing it as connected yet', async () => {
            const pairing = pairingFixture({ status: 'qr', qr: 'qr-1' });
            await savePairing(pairing);

            await handleGatewayEvent(
                event(pairing.sessionId, 'channel.status', {
                    status: 'CONNECTED',
                    account: { externalId: '5511999990000@s.whatsapp.net', phone: '5511999990000', name: 'Ana' }
                })
            );

            const stored = await getPairing(pairing.sessionId);
            expect(stored).toMatchObject({
                status: 'connected',
                qr: null,
                account: { jid: '5511999990000@s.whatsapp.net', phone: '5511999990000', name: 'Ana' }
            });
            // The connection is created by the next poll; until then the Connect UI keeps waiting.
            expect(toPairingView(stored!).status).toBe('starting');
            expect(toPairingView({ ...stored!, connectionCreated: true }).status).toBe('connected');
            // Kept for the status API: the connection doesn't exist yet when this CONNECTED arrives.
            expect(await getSessionStatus(pairing.sessionId)).toMatchObject({ status: 'CONNECTED', account: { phone: '5511999990000' } });
        });

        it('fails when the QR expires', async () => {
            const pairing = pairingFixture({ status: 'qr', qr: 'qr-1' });
            await savePairing(pairing);

            await handleGatewayEvent(event(pairing.sessionId, 'channel.status', { status: 'DISCONNECTED', reason: 'QR_TIMEOUT' }));

            expect(await getPairing(pairing.sessionId)).toMatchObject({ status: 'failed', error: 'qr_timeout', qr: null });
            expect(logCtx.failed).toHaveBeenCalledOnce();
        });

        it('ignores the events of another tenant', async () => {
            const pairing = pairingFixture();
            await savePairing(pairing);

            await handleGatewayEvent(event(pairing.sessionId, 'channel.qr', { qr: 'qr-1', attempt: 1 }, randomUUID()));

            expect(await getPairing(pairing.sessionId)).toMatchObject({ status: 'starting', qr: null });
        });

        it('is left alone once its connection exists', async () => {
            const pairing = pairingFixture({ status: 'connected', connectionCreated: true });
            await savePairing(pairing);
            mocks.findConnectionBySession.mockResolvedValue(connectionFixture(pairing.sessionId));

            await handleGatewayEvent(event(pairing.sessionId, 'channel.status', { status: 'DISCONNECTED', reason: 'LOGGED_OUT' }));

            expect(await getPairing(pairing.sessionId)).toMatchObject({ status: 'connected', error: null });
        });
    });

    describe('a connection session', () => {
        it('forwards the contract events, unchanged, to the connection webhooks', async () => {
            const sessionId = randomUUID();
            mocks.findConnectionBySession.mockResolvedValue(connectionFixture(sessionId));
            const received = event(sessionId, 'message.received', { providerMessageId: 'ABC', content: { kind: 'text', text: 'hi' } });

            await handleGatewayEvent(received);

            expect(mocks.forwardWebhook).toHaveBeenCalledOnce();
            expect(mocks.forwardWebhook.mock.calls[0]![0]).toMatchObject({ connectionIds: ['conn-1'], payload: received, secret: 'signing-key' });
        });

        it('does not forward QR codes', async () => {
            const sessionId = randomUUID();
            mocks.findConnectionBySession.mockResolvedValue(connectionFixture(sessionId));

            await handleGatewayEvent(event(sessionId, 'channel.qr', { qr: 'qr-1', attempt: 1 }));

            expect(mocks.forwardWebhook).not.toHaveBeenCalled();
        });

        it('keeps the last status and clears a previous error when the number connects', async () => {
            const sessionId = randomUUID();
            mocks.findConnectionBySession.mockResolvedValue(connectionFixture(sessionId));
            const account = { externalId: '5511999990000@s.whatsapp.net', phone: '5511999990000' };

            await handleGatewayEvent(event(sessionId, 'channel.status', { status: 'CONNECTED', account, sendRestriction: { active: false } }));

            expect(await getSessionStatus(sessionId)).toMatchObject({ status: 'CONNECTED', account, sendRestriction: { active: false }, reason: null });
            expect(mocks.connectionRefreshSuccess).toHaveBeenCalledOnce();
            expect(mocks.connectionRefreshFailed).not.toHaveBeenCalled();
            expect(mocks.forwardWebhook).toHaveBeenCalledOnce();
        });

        it.each([
            ['DISCONNECTED', 'LOGGED_OUT', 'whatsapp_logged_out'],
            ['DISCONNECTED', 'SESSION_INVALID', 'whatsapp_session_invalid'],
            ['BANNED', undefined, 'whatsapp_banned']
        ])('flags the connection on %s %s', async (status, reason, errorType) => {
            const sessionId = randomUUID();
            mocks.findConnectionBySession.mockResolvedValue(connectionFixture(sessionId));

            await handleGatewayEvent(event(sessionId, 'channel.status', { status, ...(reason ? { reason } : {}) }));

            expect(mocks.connectionRefreshFailed).toHaveBeenCalledOnce();
            expect(mocks.connectionRefreshFailed.mock.calls[0]![0]).toMatchObject({ authError: { type: errorType }, action: 'connection_test' });
        });

        it('does not flag a transient disconnection', async () => {
            const sessionId = randomUUID();
            mocks.findConnectionBySession.mockResolvedValue(connectionFixture(sessionId));

            await handleGatewayEvent(event(sessionId, 'channel.status', { status: 'RECONNECTING', reason: 'CONNECTION_LOST' }));
            await handleGatewayEvent(event(sessionId, 'channel.status', { status: 'DISCONNECTED', reason: 'SHUTDOWN' }));

            expect(mocks.connectionRefreshFailed).not.toHaveBeenCalled();
            expect(await getSessionStatus(sessionId)).toMatchObject({ status: 'DISCONNECTED', reason: 'SHUTDOWN' });
        });
    });

    describe('an orphan session', () => {
        it('is logged out once', async () => {
            const sessionId = randomUUID();

            await handleGatewayEvent(event(sessionId, 'channel.status', { status: 'CONNECTED' }));
            await handleGatewayEvent(event(sessionId, 'message.received', {}));

            expect(mocks.sendGatewayCommand).toHaveBeenCalledOnce();
            expect(mocks.sendGatewayCommand).toHaveBeenCalledWith(
                { tenantId: TENANT, channelId: sessionId, gateway: 'whatsapp' },
                { type: 'channel.disconnect', payload: { clearSession: true } }
            );
        });

        it("logs a bot out through the telegram gateway, from the event's channel type", async () => {
            const sessionId = randomUUID();

            await handleGatewayEvent({ ...event(sessionId, 'channel.status', { status: 'CONNECTED' }), channelType: 'TELEGRAM' });

            expect(mocks.sendGatewayCommand).toHaveBeenCalledWith(
                { tenantId: TENANT, channelId: sessionId, gateway: 'telegram' },
                { type: 'channel.disconnect', payload: { clearSession: true } }
            );
            expect(mocks.forwardWebhook).not.toHaveBeenCalled();
        });

        it('is left alone while it closes', async () => {
            await handleGatewayEvent(event(randomUUID(), 'channel.status', { status: 'DISCONNECTED', reason: 'LOGGED_OUT' }));

            expect(mocks.sendGatewayCommand).not.toHaveBeenCalled();
        });

        it('does not include a pairing in progress, even one with no connection yet', async () => {
            const pairing = pairingFixture({ status: 'connected' });
            await savePairing(pairing);

            await handleGatewayEvent(event(pairing.sessionId, 'message.received', {}));

            expect(mocks.sendGatewayCommand).not.toHaveBeenCalled();
        });
    });
});
