import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { envs } from '../env.js';
import { isWhatsAppGatewayEnabled, logoutWhatsAppSession, sendGatewayCommand } from './gateway.js';

const SECRET = 'a-shared-secret-with-more-than-32-chars';
const TENANT = '7d0c3a52-4f7e-4d55-9b6e-2f7f4c1a9e01';
const SESSION = '1b9f0e44-0c1d-4b8a-8f3e-5a6b7c8d9e02';

describe('whatsapp gateway client', () => {
    const original = { url: envs.WHATSAPP_GATEWAY_URL, secret: envs.WHATSAPP_GATEWAY_SECRET };
    const fetchMock = vi.fn<typeof fetch>();

    beforeEach(() => {
        envs.WHATSAPP_GATEWAY_URL = 'http://gateway:3010';
        envs.WHATSAPP_GATEWAY_SECRET = SECRET;
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        envs.WHATSAPP_GATEWAY_URL = original.url;
        envs.WHATSAPP_GATEWAY_SECRET = original.secret;
        vi.unstubAllGlobals();
    });

    it('sends a contract command with the shared secret', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

        const res = await sendGatewayCommand({ tenantId: TENANT, channelId: SESSION }, { type: 'channel.connect', payload: {} });

        expect(res.isOk()).toBe(true);
        const [url, init] = fetchMock.mock.calls[0]!;
        expect((url as URL).href).toBe('http://gateway:3010/v1/commands');
        expect(init?.headers).toMatchObject({ authorization: `Bearer ${SECRET}` });
        expect(JSON.parse(init?.body as string)).toMatchObject({
            version: 1,
            tenantId: TENANT,
            channelId: SESSION,
            type: 'channel.connect',
            payload: {},
            commandId: expect.any(String),
            correlationId: expect.any(String)
        });
    });

    it('reports a rejected command', async () => {
        fetchMock.mockResolvedValue(new Response('bad', { status: 400 }));

        const res = await sendGatewayCommand({ tenantId: TENANT, channelId: SESSION }, { type: 'channel.connect', payload: {} });

        expect(res.isErr()).toBe(true);
    });

    it('is disabled without configuration', async () => {
        envs.WHATSAPP_GATEWAY_URL = undefined;

        expect(isWhatsAppGatewayEnabled()).toBe(false);
        const res = await sendGatewayCommand({ tenantId: TENANT, channelId: SESSION }, { type: 'channel.connect', payload: {} });
        expect(res.isErr()).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('logs out the session of a connection, and does nothing without one', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

        expect((await logoutWhatsAppSession({ tenantId: TENANT, connectionConfig: {} })).isOk()).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();

        expect((await logoutWhatsAppSession({ tenantId: TENANT, connectionConfig: { session_id: SESSION } })).isOk()).toBe(true);
        expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toMatchObject({
            channelId: SESSION,
            type: 'channel.disconnect',
            payload: { clearSession: true }
        });
    });
});
