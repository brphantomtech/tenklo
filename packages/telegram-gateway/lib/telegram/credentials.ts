import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Formato do contrato (StackChat_V2_Contracts/README.md, "Telegram"), o mesmo do worker do StackChat:
//   base64( 0x01 | nonce[12] | tag[16] | texto cifrado ), AES-256-GCM, AAD = channelId em minúsculas.
//   chave = HKDF-SHA256(ikm = UTF-8 do segredo, salt vazio, info = "stackchat:channel-credentials:v1", 32 bytes)
// No Tenklo, o segredo é o TELEGRAM_GATEWAY_SECRET, compartilhado com o servidor, que fecha o token no channel.connect.

const VERSION = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const INFO = 'stackchat:channel-credentials:v1';

/** O token do BotFather: <id do bot>:<segredo>. */
const BOT_TOKEN = /^(\d{5,20}):[A-Za-z0-9_-]{30,}$/;

/** O valor não abre: chave diferente da do core, valor de outro canal ou adulterado. */
export class SealedTokenError extends Error {
    constructor(reason: string) {
        super(`sealedBotToken inválido: ${reason}`);
        this.name = 'SealedTokenError';
    }
}

/** Abre (e, no console de desenvolvimento e nos testes, fecha) o token do bot que o core manda no channel.connect. */
export class CredentialsCipher {
    private readonly key: Buffer;

    constructor(secret: string) {
        this.key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), INFO, 32));
    }

    open(sealed: string, channelId: string): string {
        const data = Buffer.from(sealed, 'base64');
        if (data.length <= HEADER_BYTES) throw new SealedTokenError('curto demais');
        if (data[0] !== VERSION) throw new SealedTokenError(`versão ${data[0]} desconhecida`);
        const nonce = data.subarray(1, 1 + NONCE_BYTES);
        const tag = data.subarray(1 + NONCE_BYTES, HEADER_BYTES);
        const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
        decipher.setAAD(aad(channelId));
        decipher.setAuthTag(tag);
        let token: string;
        try {
            token = Buffer.concat([decipher.update(data.subarray(HEADER_BYTES)), decipher.final()]).toString('utf8');
        } catch {
            throw new SealedTokenError('não abre com TELEGRAM_GATEWAY_SECRET (segredo diferente do servidor ou valor de outro canal)');
        }
        if (!BOT_TOKEN.test(token)) throw new SealedTokenError('o conteúdo não tem o formato de um token de bot');
        return token;
    }

    seal(token: string, channelId: string, nonce: Buffer = randomBytes(NONCE_BYTES)): string {
        const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
        cipher.setAAD(aad(channelId));
        const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
        return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
    }
}

function aad(channelId: string): Buffer {
    return Buffer.from(channelId.toLowerCase(), 'utf8');
}

/** Fecha o token para o channel.connect (o que o servidor faz antes de mandar o comando). */
export function sealBotToken(secret: string, token: string, channelId: string): string {
    return new CredentialsCipher(secret).seal(token, channelId);
}

/** Id do bot, que vem antes do ":" no token (o mesmo que o getMe devolve). */
export function botIdOf(token: string): string {
    return BOT_TOKEN.exec(token)?.[1] ?? '';
}
