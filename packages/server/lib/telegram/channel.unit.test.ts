import { createDecipheriv, hkdfSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sealBotToken } from './channel.js';

const SECRET = 'the-telegram-gateway-secret-with-32-chars';
const CHANNEL = '1B9F0E44-0C1D-4B8A-8F3E-5A6B7C8D9E02';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

/** How the telegram-gateway (and StackChat's Telegram worker) opens a sealedBotToken. */
function open(sealed: string, secret: string, channelId: string): string {
    const data = Buffer.from(sealed, 'base64');
    const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), 'stackchat:channel-credentials:v1', 32));
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(1, 13));
    decipher.setAAD(Buffer.from(channelId.toLowerCase(), 'utf8'));
    decipher.setAuthTag(data.subarray(13, 29));
    return Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString('utf8');
}

describe('sealBotToken', () => {
    it('seals the token in the format of the contract', () => {
        const sealed = sealBotToken(SECRET, TOKEN, CHANNEL);
        expect(Buffer.from(sealed, 'base64')[0]).toBe(0x01);
        expect(sealed).not.toContain(TOKEN);
        expect(open(sealed, SECRET, CHANNEL.toLowerCase())).toBe(TOKEN);
    });

    it('only opens for its channel and its secret', () => {
        const sealed = sealBotToken(SECRET, TOKEN, CHANNEL);
        expect(() => open(sealed, SECRET, '2c8e1f55-1d2e-4c9b-9f4a-6b7c8d9e0f13')).toThrow();
        expect(() => open(sealed, `${SECRET}x`, CHANNEL)).toThrow();
    });
});
