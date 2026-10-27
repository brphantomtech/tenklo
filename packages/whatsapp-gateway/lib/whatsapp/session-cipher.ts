import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM para a sessão da Baileys no RustFS (README da raiz, SESSION_ENCRYPTION_KEY).
 * A chave do objeto entra como dado autenticado: um arquivo copiado para outra chave não decifra.
 *
 * Formato: [versão 1 byte][IV 12][tag 16][texto cifrado]
 */
export class SessionCipher {
    private readonly key: Buffer;

    constructor(secret: string) {
        this.key = Buffer.from(hkdfSync('sha256', secret, 'stackchat-session', 'wpp_lib-session-v1', 32));
    }

    encrypt(plain: Buffer, objectKey: string): Buffer {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(Buffer.from(objectKey));
        const body = Buffer.concat([cipher.update(plain), cipher.final()]);
        return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
    }

    decrypt(data: Buffer, objectKey: string): Buffer {
        if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== VERSION) {
            throw new Error('Sessão em formato desconhecido');
        }
        const iv = data.subarray(1, 1 + IV_BYTES);
        const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
        const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
        decipher.setAAD(Buffer.from(objectKey));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
    }
}
