import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { envs } from '../env.js';
import {
    GatewayInvalidCommandError,
    GatewayMediaTooLargeError,
    isWhatsAppGatewayEnabled,
    logoutGatewaySession,
    openGatewayMedia,
    putGatewayMedia,
    sendGatewayCommand
} from './gateway.js';

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

    it('reports a command outside the contract apart from a gateway failure', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'invalid_command', message: 'bad text' } }, { status: 400 }));
        const invalid = await sendGatewayCommand({ tenantId: TENANT, channelId: SESSION }, { type: 'channel.connect', payload: {} });
        expect(invalid.isErr() && invalid.error).toBeInstanceOf(GatewayInvalidCommandError);
        expect(invalid.isErr() && invalid.error.message).toBe('bad text');

        fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
        const failed = await sendGatewayCommand({ tenantId: TENANT, channelId: SESSION }, { type: 'channel.connect', payload: {} });
        expect(failed.isErr() && failed.error).not.toBeInstanceOf(GatewayInvalidCommandError);
    });

    it("sends a telegram connection's commands to the telegram gateway, with its own secret", async () => {
        const original = { url: envs.TELEGRAM_GATEWAY_URL, secret: envs.TELEGRAM_GATEWAY_SECRET };
        envs.TELEGRAM_GATEWAY_URL = 'http://telegram:3011';
        envs.TELEGRAM_GATEWAY_SECRET = 'the-telegram-gateway-secret-with-32-chars';
        try {
            fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

            const res = await sendGatewayCommand({ tenantId: TENANT, channelId: SESSION, gateway: 'telegram' }, { type: 'groups.sync', payload: {} });

            expect(res.isOk()).toBe(true);
            const [url, init] = fetchMock.mock.calls[0]!;
            expect((url as URL).href).toBe('http://telegram:3011/v1/commands');
            expect(init?.headers).toMatchObject({ authorization: 'Bearer the-telegram-gateway-secret-with-32-chars' });
        } finally {
            envs.TELEGRAM_GATEWAY_URL = original.url;
            envs.TELEGRAM_GATEWAY_SECRET = original.secret;
        }
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

        expect((await logoutGatewaySession({ tenantId: TENANT, connectionConfig: {}, gateway: 'whatsapp' })).isOk()).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();

        expect((await logoutGatewaySession({ tenantId: TENANT, connectionConfig: { session_id: SESSION }, gateway: 'whatsapp' })).isOk()).toBe(true);
        expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toMatchObject({
            channelId: SESSION,
            type: 'channel.disconnect',
            payload: { clearSession: true }
        });
    });

    describe('media', () => {
        const KEY = `tenants/${TENANT}/media/${SESSION}/file`;

        it('stores a file under the key the server picked', async () => {
            fetchMock.mockResolvedValue(Response.json({ objectKey: KEY, sizeBytes: 3 }, { status: 201 }));

            const res = await putGatewayMedia({ objectKey: KEY, body: Buffer.from('abc'), contentType: 'image/png' });

            expect(res.isOk()).toBe(true);
            const [url, init] = fetchMock.mock.calls[0]!;
            expect((url as URL).searchParams.get('key')).toBe(KEY);
            expect(init).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/png', authorization: `Bearer ${SECRET}` } });
        });

        it('reports a file above the gateway limit', async () => {
            fetchMock.mockResolvedValue(new Response(null, { status: 413 }));

            const res = await putGatewayMedia({ objectKey: KEY, body: Buffer.from('abc'), contentType: 'image/png' });

            expect(res.isErr() && res.error).toBeInstanceOf(GatewayMediaTooLargeError);
        });

        it('opens a file, and answers null for a missing one', async () => {
            fetchMock.mockResolvedValueOnce(new Response('abc', { status: 200, headers: { 'content-type': 'image/png' } }));
            const found = await openGatewayMedia(KEY);
            expect(found.isOk() && (await found.value?.text())).toBe('abc');

            fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
            const missing = await openGatewayMedia(KEY);
            expect(missing.isOk() && missing.value).toBeNull();
        });
    });
});
