import { getKVStore } from '@nangohq/kvstore';

import type { WhatsAppConnectionStatus } from '@nangohq/types';

/** Refreshed on every status change; a session quiet for this long reports UNKNOWN until the next one. */
const STATUS_TTL_MS = 30 * 24 * 3600 * 1000;

const key = (sessionId: string) => `whatsapp:status:${sessionId}`;

/** The last channel.status of a session, kept by the server so it is known whichever gateway instance holds the session. */
export async function saveSessionStatus(sessionId: string, status: Omit<WhatsAppConnectionStatus, 'updatedAt'> & { updatedAt: string }): Promise<void> {
    const kv = await getKVStore();
    await kv.set(key(sessionId), JSON.stringify(status), { canOverride: true, ttlMs: STATUS_TTL_MS });
}

export async function getSessionStatus(sessionId: string): Promise<WhatsAppConnectionStatus> {
    const kv = await getKVStore();
    const raw = await kv.get(key(sessionId));
    if (!raw) {
        return { status: 'UNKNOWN', reason: null, account: null, sendRestriction: null, updatedAt: null };
    }
    return JSON.parse(raw) as WhatsAppConnectionStatus;
}
