import { getKVStore } from '@nangohq/kvstore';

import type { WhatsAppQrPairing } from '@nangohq/types';

/** Long enough for several QR rotations; a connect session lasts 30 minutes. */
const PAIRING_TTL_MS = 30 * 60 * 1000;
const CLAIM_TTL_MS = 60 * 1000;

/**
 * A QR pairing in progress, between the Connect UI asking for a QR and the connection being created.
 * The gateway's channel.qr / channel.status events move it forward; the Connect UI polls it.
 */
export interface Pairing {
    sessionId: string;
    accountId: number;
    environmentId: number;
    /** The environment uuid, which the gateway reports as tenantId. */
    tenantId: string;
    providerConfigKey: string;
    /** The connection the pairing creates (or reconnects) once the QR is scanned. */
    connectionId: string;
    /** The log operation the pairing reports to. */
    operationId: string;
    status: WhatsAppQrPairing['status'];
    qr: string | null;
    qrExpiresAt: string | null;
    error: string | null;
    account: { jid: string; phone: string | null; name: string | null } | null;
    /** Set once the connection exists. */
    connectionCreated: boolean;
}

const key = (sessionId: string) => `whatsapp:pairing:${sessionId}`;

export async function getPairing(sessionId: string): Promise<Pairing | null> {
    const kv = await getKVStore();
    const raw = await kv.get(key(sessionId));
    return raw ? (JSON.parse(raw) as Pairing) : null;
}

export async function savePairing(pairing: Pairing): Promise<void> {
    const kv = await getKVStore();
    await kv.set(key(pairing.sessionId), JSON.stringify(pairing), { canOverride: true, ttlMs: PAIRING_TTL_MS });
}

/** Applies a change to a pairing, if it still exists. */
export async function updatePairing(sessionId: string, change: (pairing: Pairing) => Pairing | null): Promise<Pairing | null> {
    const pairing = await getPairing(sessionId);
    if (!pairing) {
        return null;
    }
    const next = change(pairing);
    if (next) {
        await savePairing(next);
    }
    return next ?? pairing;
}

/** Only one poll creates the connection: the others see it created on a later poll. */
export async function claimConnectionCreation(sessionId: string): Promise<boolean> {
    const kv = await getKVStore();
    try {
        await kv.set(`${key(sessionId)}:claim`, '1', { canOverride: false, ttlMs: CLAIM_TTL_MS });
        return true;
    } catch {
        return false;
    }
}

export async function releaseConnectionCreation(sessionId: string): Promise<void> {
    const kv = await getKVStore();
    await kv.delete(`${key(sessionId)}:claim`);
}

export function toPairingView(pairing: Pairing): WhatsAppQrPairing {
    return {
        session_id: pairing.sessionId,
        // "connected" is only reported once the connection exists, so the Connect UI can close right away.
        status: pairing.status === 'connected' && !pairing.connectionCreated ? 'starting' : pairing.status,
        qr: pairing.status === 'qr' ? pairing.qr : null,
        qr_expires_at: pairing.status === 'qr' ? pairing.qrExpiresAt : null,
        error: pairing.error
    };
}
