import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGatewayEvent } from './events.js';
import { getPairing, savePairing, toPairingView } from './pairing.js';

import type { GatewayEvent } from './events.js';
import type { Pairing } from './pairing.js';

const logCtx = vi.hoisted(() => ({ error: vi.fn(), failed: vi.fn() }));
vi.mock('@nangohq/logs', () => ({ logContextGetter: { get: () => logCtx } }));

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

function event(pairing: Pairing, type: string, payload: Record<string, unknown>, tenantId = TENANT): GatewayEvent {
    return {
        version: 1,
        eventId: randomUUID(),
        tenantId,
        channelId: pairing.sessionId,
        type,
        providerEventId: randomUUID(),
        payload,
        occurredAt: new Date().toISOString()
    };
}

describe('handleGatewayEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stores each QR code of a pairing', async () => {
        const pairing = pairingFixture();
        await savePairing(pairing);

        await handleGatewayEvent(event(pairing, 'channel.qr', { qr: 'qr-1', attempt: 1, expiresAt: '2026-10-27T12:01:00.000Z' }));
        await handleGatewayEvent(event(pairing, 'channel.qr', { qr: 'qr-2', attempt: 2 }));

        const stored = await getPairing(pairing.sessionId);
        expect(stored).toMatchObject({ status: 'qr', qr: 'qr-2', qrExpiresAt: null });
        expect(toPairingView(stored!)).toMatchObject({ status: 'qr', qr: 'qr-2' });
    });

    it('marks the pairing connected with the paired account, without exposing it as connected yet', async () => {
        const pairing = pairingFixture({ status: 'qr', qr: 'qr-1' });
        await savePairing(pairing);

        await handleGatewayEvent(
            event(pairing, 'channel.status', {
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
    });

    it('fails the pairing when the QR expires', async () => {
        const pairing = pairingFixture({ status: 'qr', qr: 'qr-1' });
        await savePairing(pairing);

        await handleGatewayEvent(event(pairing, 'channel.status', { status: 'DISCONNECTED', reason: 'QR_TIMEOUT' }));

        expect(await getPairing(pairing.sessionId)).toMatchObject({ status: 'failed', error: 'qr_timeout', qr: null });
        expect(logCtx.failed).toHaveBeenCalledOnce();
    });

    it('ignores the events of another tenant', async () => {
        const pairing = pairingFixture();
        await savePairing(pairing);

        await handleGatewayEvent(event(pairing, 'channel.qr', { qr: 'qr-1', attempt: 1 }, randomUUID()));

        expect(await getPairing(pairing.sessionId)).toMatchObject({ status: 'starting', qr: null });
    });

    it('leaves a pairing alone once its connection exists', async () => {
        const pairing = pairingFixture({ status: 'connected', connectionCreated: true });
        await savePairing(pairing);

        await handleGatewayEvent(event(pairing, 'channel.status', { status: 'DISCONNECTED', reason: 'LOGGED_OUT' }));

        expect(await getPairing(pairing.sessionId)).toMatchObject({ status: 'connected', error: null });
        expect(logCtx.failed).not.toHaveBeenCalled();
    });

    it('ignores events for unknown sessions', async () => {
        await expect(handleGatewayEvent(event(pairingFixture(), 'channel.qr', { qr: 'qr-1', attempt: 1 }))).resolves.toBeUndefined();
    });
});
