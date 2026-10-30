import { randomUUID } from 'node:crypto';

import { Err, Ok } from '@nangohq/utils';

import { envs } from '../env.js';

import type { WhatsAppMessageContent, WhatsAppRecipient } from '@nangohq/types';
import type { Result } from '@nangohq/utils';

export const WHATSAPP_PROVIDER = 'whatsapp-web';
export const TELEGRAM_PROVIDER = 'telegram-channel';

/**
 * The channel gateways, one per messaging provider, all speaking the StackChat channel contract:
 * packages/whatsapp-gateway for whatsapp-web, packages/telegram-gateway for telegram-channel.
 */
export type GatewayKind = 'whatsapp' | 'telegram';

export const GATEWAY_OF_PROVIDER: Record<string, GatewayKind> = { [WHATSAPP_PROVIDER]: 'whatsapp', [TELEGRAM_PROVIDER]: 'telegram' };

/** The contract's channelType of each gateway's events. */
export const GATEWAY_OF_CHANNEL_TYPE: Record<string, GatewayKind> = { WHATSAPP_LIB: 'whatsapp', TELEGRAM: 'telegram' };

export function gatewayConfig(kind: GatewayKind): { url: string; secret: string } | null {
    const url = kind === 'telegram' ? envs.TELEGRAM_GATEWAY_URL : envs.WHATSAPP_GATEWAY_URL;
    const secret = kind === 'telegram' ? envs.TELEGRAM_GATEWAY_SECRET : envs.WHATSAPP_GATEWAY_SECRET;
    return url && secret ? { url, secret } : null;
}

/** Commands from the StackChat channel contract that the server sends to a gateway. */
export type GatewayCommand =
    | { type: 'channel.connect'; payload: { sealedBotToken?: string } }
    | { type: 'channel.disconnect'; payload: { clearSession: boolean } }
    | { type: 'groups.sync'; payload: Record<string, never> }
    | { type: 'message.send'; payload: { messageId: string; to: WhatsAppRecipient; content: WhatsAppMessageContent } };

export interface GatewayTarget {
    /** The environment uuid: one tenant per environment. */
    tenantId: string;
    /** The pairing / connection session id. */
    channelId: string;
    correlationId?: string | undefined;
    /** whatsapp when missing. */
    gateway?: GatewayKind | undefined;
}

export class GatewayInvalidCommandError extends Error {}

export function isWhatsAppGatewayEnabled(): boolean {
    return gatewayConfig('whatsapp') !== null;
}

/** Hands a command to the gateway. It only acknowledges it: the outcome comes back as events. */
export async function sendGatewayCommand(target: GatewayTarget, command: GatewayCommand): Promise<Result<{ commandId: string }>> {
    const gateway = gatewayConfig(target.gateway ?? 'whatsapp');
    if (!gateway) {
        return Err(new Error(`${target.gateway ?? 'whatsapp'}_gateway_not_configured`));
    }
    const { url, secret } = gateway;

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
        if (res.status === 400) {
            // The command is outside the contract: the caller's input, not the gateway, is wrong.
            const reply = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            return Err(new GatewayInvalidCommandError(reply?.error?.message ?? 'invalid command'));
        }
        if (!res.ok) {
            return Err(new Error(`whatsapp_gateway_rejected_command`, { cause: `${res.status} ${await res.text().catch(() => '')}` }));
        }
        return Ok({ commandId });
    } catch (err) {
        return Err(new Error('whatsapp_gateway_unreachable', { cause: err }));
    }
}

/** Logs the paired device (or the bot) out and deletes its session, for a connection that is going away. */
export async function logoutGatewaySession({
    tenantId,
    connectionConfig,
    gateway
}: {
    tenantId: string;
    connectionConfig: Record<string, unknown>;
    gateway: GatewayKind;
}): Promise<Result<void>> {
    const sessionId = connectionConfig['session_id'];
    if (typeof sessionId !== 'string' || !sessionId) {
        return Ok(undefined);
    }
    const sent = await sendGatewayCommand({ tenantId, channelId: sessionId, gateway }, { type: 'channel.disconnect', payload: { clearSession: true } });
    return sent.isErr() ? Err(sent.error) : Ok(undefined);
}

export class GatewayMediaTooLargeError extends Error {}

/** Stores a file in the gateway's media bucket under a key the server picked. */
export async function putGatewayMedia({
    objectKey,
    body,
    contentType,
    gateway: kind = 'whatsapp'
}: {
    objectKey: string;
    body: Buffer;
    contentType: string;
    gateway?: GatewayKind;
}): Promise<Result<void>> {
    const gateway = gatewayConfig(kind);
    if (!gateway) {
        return Err(new Error(`${kind}_gateway_not_configured`));
    }
    const { url, secret } = gateway;
    try {
        const res = await fetch(mediaUrl(url, objectKey), {
            method: 'PUT',
            headers: { 'content-type': contentType, authorization: `Bearer ${secret}` },
            body: new Uint8Array(body),
            signal: AbortSignal.timeout(120_000)
        });
        if (res.status === 413) {
            return Err(new GatewayMediaTooLargeError('media_too_large'));
        }
        if (!res.ok) {
            return Err(new Error('whatsapp_gateway_rejected_media', { cause: `${res.status} ${await res.text().catch(() => '')}` }));
        }
        return Ok(undefined);
    } catch (err) {
        return Err(new Error('whatsapp_gateway_unreachable', { cause: err }));
    }
}

/** Opens a file of the gateway's media bucket. null when it does not exist. */
export async function openGatewayMedia(objectKey: string, kind: GatewayKind = 'whatsapp'): Promise<Result<Response | null>> {
    const gateway = gatewayConfig(kind);
    if (!gateway) {
        return Err(new Error(`${kind}_gateway_not_configured`));
    }
    const { url, secret } = gateway;
    try {
        const res = await fetch(mediaUrl(url, objectKey), { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120_000) });
        if (res.status === 404) {
            return Ok(null);
        }
        if (!res.ok || !res.body) {
            return Err(new Error('whatsapp_gateway_rejected_media', { cause: `${res.status}` }));
        }
        return Ok(res);
    } catch (err) {
        return Err(new Error('whatsapp_gateway_unreachable', { cause: err }));
    }
}

export interface GatewayChannel {
    tenantId: string;
    channelId: string;
}

/** Bytes of media each channel keeps in the gateway's bucket, for metering. */
export async function getGatewayMediaUsage(kind: GatewayKind, channels: GatewayChannel[]): Promise<Result<(GatewayChannel & { bytes: number })[]>> {
    const gateway = gatewayConfig(kind);
    if (!gateway) {
        return Err(new Error(`${kind}_gateway_not_configured`));
    }
    const { url, secret } = gateway;
    try {
        const res = await fetch(new URL('/v1/media/usage', url), {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
            body: JSON.stringify({ channels }),
            signal: AbortSignal.timeout(120_000)
        });
        if (!res.ok) {
            return Err(new Error(`${kind}_gateway_rejected_media_usage`, { cause: `${res.status}` }));
        }
        const json = (await res.json()) as { channels: (GatewayChannel & { bytes: number })[] };
        return Ok(json.channels);
    } catch (err) {
        return Err(new Error(`${kind}_gateway_unreachable`, { cause: err }));
    }
}

export class GatewaySessionRejectedError extends Error {
    constructor(
        readonly code: 'invalid_session' | 'session_exists',
        message: string
    ) {
        super(message);
    }
}

/**
 * Hands the gateway a Baileys session paired elsewhere, as plaintext objects ({ path, json }), for it to store
 * encrypted under the new session id. Answers the paired account.
 */
export async function importGatewaySession({
    tenantId,
    sessionId,
    objects
}: {
    tenantId: string;
    sessionId: string;
    objects: { path: string; json: string }[];
}): Promise<Result<{ jid: string; name: string | null }>> {
    const url = envs.WHATSAPP_GATEWAY_URL;
    const secret = envs.WHATSAPP_GATEWAY_SECRET;
    if (!url || !secret) {
        return Err(new Error('whatsapp_gateway_not_configured'));
    }
    try {
        const res = await fetch(new URL(`/v1/sessions/${tenantId}/${sessionId}`, url), {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
            body: JSON.stringify({ objects }),
            signal: AbortSignal.timeout(120_000)
        });
        const reply = (await res.json().catch(() => null)) as {
            account?: { jid: string; name: string | null };
            error?: { code?: string; message?: string };
        } | null;
        if (res.status === 400 || res.status === 409) {
            const code = reply?.error?.code === 'session_exists' ? 'session_exists' : 'invalid_session';
            return Err(new GatewaySessionRejectedError(code, reply?.error?.message ?? code));
        }
        if (!res.ok || !reply?.account) {
            return Err(new Error('whatsapp_gateway_rejected_session', { cause: `${res.status}` }));
        }
        return Ok(reply.account);
    } catch (err) {
        return Err(new Error('whatsapp_gateway_unreachable', { cause: err }));
    }
}

function mediaUrl(base: string, objectKey: string): URL {
    const url = new URL('/v1/media', base);
    url.searchParams.set('key', objectKey);
    return url;
}
