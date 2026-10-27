import { randomUUID } from 'node:crypto';

import { Err, Ok } from '@nangohq/utils';

import { envs } from '../env.js';

import type { Result } from '@nangohq/utils';

export const WHATSAPP_PROVIDER = 'whatsapp-web';

/** Commands from the StackChat channel contract that the server sends to the whatsapp-gateway. */
export type GatewayCommand = { type: 'channel.connect'; payload: Record<string, never> } | { type: 'channel.disconnect'; payload: { clearSession: boolean } };

export interface GatewayTarget {
    /** The environment uuid: one tenant per environment. */
    tenantId: string;
    /** The pairing / connection session id. */
    channelId: string;
    correlationId?: string | undefined;
}

export function isWhatsAppGatewayEnabled(): boolean {
    return Boolean(envs.WHATSAPP_GATEWAY_URL && envs.WHATSAPP_GATEWAY_SECRET);
}

/** Hands a command to the gateway. It only acknowledges it: the outcome comes back as events. */
export async function sendGatewayCommand(target: GatewayTarget, command: GatewayCommand): Promise<Result<{ commandId: string }>> {
    const url = envs.WHATSAPP_GATEWAY_URL;
    const secret = envs.WHATSAPP_GATEWAY_SECRET;
    if (!url || !secret) {
        return Err(new Error('whatsapp_gateway_not_configured'));
    }

    const commandId = randomUUID();
    const body = {
        version: 1,
        commandId,
        correlationId: target.correlationId ?? randomUUID(),
        tenantId: target.tenantId,
        channelId: target.channelId,
        type: command.type,
        payload: command.payload,
        createdAt: new Date().toISOString()
    };

    try {
        const res = await fetch(new URL('/v1/commands', url), {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) {
            return Err(new Error(`whatsapp_gateway_rejected_command`, { cause: `${res.status} ${await res.text().catch(() => '')}` }));
        }
        return Ok({ commandId });
    } catch (err) {
        return Err(new Error('whatsapp_gateway_unreachable', { cause: err }));
    }
}

/** Logs the paired device out and deletes its session, for a connection that is going away. */
export async function logoutWhatsAppSession({
    tenantId,
    connectionConfig
}: {
    tenantId: string;
    connectionConfig: Record<string, unknown>;
}): Promise<Result<void>> {
    const sessionId = connectionConfig['session_id'];
    if (typeof sessionId !== 'string' || !sessionId) {
        return Ok(undefined);
    }
    const sent = await sendGatewayCommand({ tenantId, channelId: sessionId }, { type: 'channel.disconnect', payload: { clearSession: true } });
    return sent.isErr() ? Err(sent.error) : Ok(undefined);
}
