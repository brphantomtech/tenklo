import { createCipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';

import { connectionService } from '@nangohq/shared';
import { Err, Ok } from '@nangohq/utils';

import { envs } from '../env.js';
import { forgetSession } from '../whatsapp/connections.js';
import { sendGatewayCommand } from '../whatsapp/gateway.js';

import type { DBConnection, DBEnvironment } from '@nangohq/types';
import type { Result } from '@nangohq/utils';

const SEAL_INFO = 'stackchat:channel-credentials:v1';

/**
 * Seals a bot token for the channel.connect of the StackChat contract (sealedBotToken): AES-256-GCM with a key derived
 * from the secret shared with the telegram-gateway, the channel id as associated data.
 * Format: base64(0x01 | nonce 12 | tag 16 | ciphertext).
 */
export function sealBotToken(secret: string, token: string, channelId: string): string {
    const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), SEAL_INFO, 32));
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(channelId.toLowerCase(), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([0x01]), nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Starts (or restarts, with a new token) the bot of a telegram-channel connection in the gateway. The connection keeps
 * its session id across token changes, so its events and conversations stay attached to it.
 */
export async function connectTelegramChannel({
    connection,
    environment
}: {
    connection: Pick<DBConnection, 'id' | 'connection_id' | 'provider_config_key' | 'environment_id' | 'connection_config'>;
    environment: Pick<DBEnvironment, 'uuid'>;
}): Promise<Result<{ sessionId: string }>> {
    const secret = envs.TELEGRAM_GATEWAY_SECRET;
    if (!envs.TELEGRAM_GATEWAY_URL || !secret) {
        return Err(new Error('telegram_gateway_not_configured'));
    }

    const found = await connectionService.getConnection(connection.connection_id, connection.provider_config_key, connection.environment_id);
    const credentials = found.response?.credentials as { type?: string; apiKey?: string } | undefined;
    if (credentials?.type !== 'API_KEY' || !credentials.apiKey) {
        return Err(new Error('telegram_channel_without_bot_token'));
    }

    const configured: unknown = connection.connection_config['session_id'];
    const sessionId = typeof configured === 'string' && configured ? configured : randomUUID();
    if (sessionId !== configured) {
        await connectionService.updateConnectionConfig(connection, { session_id: sessionId });
    }
    forgetSession({ tenantId: environment.uuid, sessionId });

    const sent = await sendGatewayCommand(
        { tenantId: environment.uuid, channelId: sessionId, gateway: 'telegram' },
        { type: 'channel.connect', payload: { sealedBotToken: sealBotToken(secret, credentials.apiKey, sessionId) } }
    );
    return sent.isErr() ? Err(sent.error) : Ok({ sessionId });
}
