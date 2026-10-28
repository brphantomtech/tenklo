import { describe, expect, it } from 'vitest';

import { botIdOf, CredentialsCipher, sealBotToken, SealedTokenError } from './credentials.js';

// Vetor de teste do repositório de contratos do StackChat (o servidor do Tenklo e o worker antigo fecham igual).
const KEY = 'example-channel-credentials-key-0123456789';
const TOKEN = '7012345678:AAHfakeTokenForExamples_0123456789abc';
const CHANNEL = '2c8e1f55-1d2e-4c9b-9a4f-6b7c8d9e0f03';
const SEALED = 'ATjl6+TkcKhwAvpLPdjEoToC91lLLkEW0VaxQ+OP2JfnqXjYhlWmyef1ANNjxyaTGF16CADZCLvpHVyrsEa69ITqC7dT3RLPHnJMnQ8=';

describe('CredentialsCipher', () => {
    const cipher = new CredentialsCipher(KEY);

    it('abre o vetor de teste do contrato', () => {
        expect(cipher.open(SEALED, CHANNEL)).toBe(TOKEN);
    });

    it('sealBotToken fecha um token que o gateway abre', () => {
        const sealed = sealBotToken(KEY, TOKEN, CHANNEL);
        expect(sealed).not.toContain(TOKEN);
        expect(cipher.open(sealed, CHANNEL)).toBe(TOKEN);
    });

    it('o channelId em maiúsculas abre igual (AAD em minúsculas)', () => {
        expect(cipher.open(SEALED, CHANNEL.toUpperCase())).toBe(TOKEN);
    });

    it('fecha no mesmo formato: com o mesmo nonce, dá o vetor', () => {
        const nonce = Buffer.from(SEALED, 'base64').subarray(1, 13);
        expect(cipher.seal(TOKEN, CHANNEL, nonce)).toBe(SEALED);
        expect(cipher.open(cipher.seal(TOKEN, CHANNEL), CHANNEL)).toBe(TOKEN);
    });

    it('não abre com outra chave, em outro canal ou adulterado', () => {
        expect(() => new CredentialsCipher(KEY + 'x').open(SEALED, CHANNEL)).toThrow(SealedTokenError);
        expect(() => cipher.open(SEALED, '1b9f0e44-0c1d-4b8a-8f3e-5a6b7c8d9e02')).toThrow(SealedTokenError);
        const tampered = Buffer.from(SEALED, 'base64');
        tampered[tampered.length - 1]! ^= 1;
        expect(() => cipher.open(tampered.toString('base64'), CHANNEL)).toThrow(SealedTokenError);
        const otherVersion = Buffer.from(SEALED, 'base64');
        otherVersion[0] = 2;
        expect(() => cipher.open(otherVersion.toString('base64'), CHANNEL)).toThrow(/versão/);
    });

    it('recusa conteúdo que não é token de bot', () => {
        expect(() => cipher.open(cipher.seal('não é token', CHANNEL), CHANNEL)).toThrow(/formato/);
    });

    it('o erro não carrega o token', () => {
        try {
            new CredentialsCipher(KEY + 'x').open(SEALED, CHANNEL);
        } catch (err) {
            expect(String((err as Error).message)).not.toContain('AAH');
        }
    });

    it('id do bot a partir do token', () => {
        expect(botIdOf(TOKEN)).toBe('7012345678');
        expect(botIdOf('lixo')).toBe('');
    });
});
