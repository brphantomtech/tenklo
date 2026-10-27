import * as z from 'zod';

import { accountService, configService, connectionService, getProvider } from '@nangohq/shared';
import { Err, Ok, zodErrorToHTTP } from '@nangohq/utils';

import { connectionIdSchema, providerConfigKeySchema } from '../helpers/validation.js';
import { isWhatsAppGatewayEnabled, WHATSAPP_PROVIDER } from './gateway.js';

import type { Config } from '@nangohq/shared';
import type { DBConnectionDecrypted, DBEnvironment, DBTeam, Provider } from '@nangohq/types';
import type { Result } from '@nangohq/utils';

/** A whatsapp-web connection with everything the events and the public API need around it. */
export interface WhatsAppConnection {
    account: DBTeam;
    environment: DBEnvironment;
    connection: DBConnectionDecrypted;
    config: Config;
    provider: Provider;
    sessionId: string;
}

/** An HTTP error the public API answers with. */
export class WhatsAppApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: 'invalid_headers' | 'unknown_connection' | 'invalid_connection' | 'whatsapp_gateway_unavailable',
        message?: string,
        readonly errors?: ReturnType<typeof zodErrorToHTTP>
    ) {
        super(message ?? code);
    }
}

const headersSchema = z.object({
    'provider-config-key': providerConfigKeySchema,
    'connection-id': connectionIdSchema
});

/** Resolves the connection a public /whatsapp request is about, from its Connection-Id and Provider-Config-Key headers. */
export async function resolveConnectionFromHeaders({
    headers,
    account,
    environment
}: {
    headers: unknown;
    account: DBTeam;
    environment: DBEnvironment;
}): Promise<Result<WhatsAppConnection, WhatsAppApiError>> {
    if (!isWhatsAppGatewayEnabled()) {
        return Err(new WhatsAppApiError(503, 'whatsapp_gateway_unavailable', 'The WhatsApp gateway is not configured on this Tenklo instance'));
    }

    const val = headersSchema.safeParse(headers);
    if (!val.success) {
        return Err(new WhatsAppApiError(400, 'invalid_headers', undefined, zodErrorToHTTP(val.error)));
    }
    const providerConfigKey = val.data['provider-config-key'];
    const connectionId = val.data['connection-id'];

    const config = await configService.getProviderConfig(providerConfigKey, environment.id);
    const found = await connectionService.getConnection(connectionId, providerConfigKey, environment.id);
    if (!config || !found.success || !found.response) {
        return Err(new WhatsAppApiError(404, 'unknown_connection', 'Unknown connection'));
    }

    const provider = getProvider(config.provider);
    const sessionId: unknown = found.response.connection_config['session_id'];
    if (config.provider !== WHATSAPP_PROVIDER || !provider || typeof sessionId !== 'string') {
        return Err(new WhatsAppApiError(400, 'invalid_connection', `The connection is not a ${WHATSAPP_PROVIDER} connection`));
    }

    return Ok({ account, environment, connection: found.response, config, provider, sessionId });
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: WhatsAppConnection | null; expiresAt: number }>();

/**
 * Finds the connection a gateway session belongs to. Events arrive for every message, so the lookup is cached for a
 * short while; null when the session belongs to no connection (a pairing in progress, or an orphan).
 */
export async function findConnectionBySession({ tenantId, sessionId }: { tenantId: string; sessionId: string }): Promise<WhatsAppConnection | null> {
    const cacheKey = `${tenantId}:${sessionId}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }

    const value = await lookupConnectionBySession({ tenantId, sessionId });
    // A miss is not cached: the connection of a pairing is created right after its CONNECTED event.
    if (value) {
        if (cache.size > 5_000) {
            cache.clear();
        }
        cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value;
}

export function forgetSession({ tenantId, sessionId }: { tenantId: string; sessionId: string }): void {
    cache.delete(`${tenantId}:${sessionId}`);
}

async function lookupConnectionBySession({ tenantId, sessionId }: { tenantId: string; sessionId: string }): Promise<WhatsAppConnection | null> {
    const context = await accountService.getAccountContext({ environmentUuid: tenantId });
    if (!context) {
        return null;
    }
    const { account, environment } = context;

    const connections = await connectionService.findConnectionsByConnectionConfigValue('session_id', sessionId, environment.id);
    const connection = connections?.[0];
    if (!connection) {
        return null;
    }

    const config = await configService.getProviderConfig(connection.provider_config_key, environment.id);
    const provider = config ? getProvider(config.provider) : null;
    if (!config || !provider || config.provider !== WHATSAPP_PROVIDER) {
        return null;
    }

    return { account, environment, connection, config, provider, sessionId };
}

/** Media of a connection's session live under these prefixes; nothing outside them is served or sent for it. */
export function mediaPrefixes({ tenantId, sessionId }: { tenantId: string; sessionId: string }): string[] {
    return [`tenants/${tenantId}/inbox/${sessionId}/`, `tenants/${tenantId}/media/${sessionId}/`];
}

export function outboundMediaKey({ tenantId, sessionId, name }: { tenantId: string; sessionId: string; name: string }): string {
    // The contract's MediaRef only accepts keys under tenants/<tenantId>/media/.
    return `tenants/${tenantId}/media/${sessionId}/${name}`;
}

export function belongsToSession(objectKey: string, target: { tenantId: string; sessionId: string }): boolean {
    return mediaPrefixes(target).some((prefix) => {
        const name = objectKey.slice(prefix.length);
        return objectKey.startsWith(prefix) && name.length > 0 && !name.includes('/');
    });
}
