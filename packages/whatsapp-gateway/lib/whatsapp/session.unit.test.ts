import { describe, expect, it } from 'vitest';

import { CHANNEL, TENANT } from '../testing/fakes.js';
import { loadSessionAuth, sessionPrefix } from './auth-state.js';
import { SessionCipher } from './session-cipher.js';

const SECRET = 'uma-chave-de-teste-com-mais-de-32-caracteres';

describe('SessionCipher', () => {
    const cipher = new SessionCipher(SECRET);

    it('cifra e decifra', () => {
        const data = cipher.encrypt(Buffer.from('segredo'), 'a/b');
        expect(data.includes(Buffer.from('segredo'))).toBe(false);
        expect(cipher.decrypt(data, 'a/b').toString()).toBe('segredo');
    });

    it('não decifra com outra chave de objeto, outra senha ou dado adulterado', () => {
        const data = cipher.encrypt(Buffer.from('segredo'), 'a/b');
        expect(() => cipher.decrypt(data, 'a/c')).toThrow();
        expect(() => new SessionCipher(SECRET + 'x').decrypt(data, 'a/b')).toThrow();
        const tampered = Buffer.from(data);
        tampered[tampered.length - 1]! ^= 1;
        expect(() => cipher.decrypt(tampered, 'a/b')).toThrow();
    });
});

class MemoryObjects {
    readonly objects = new Map<string, Buffer>();
    gets = 0;
    getSessionObject(key: string) {
        this.gets++;
        return Promise.resolve(this.objects.get(key));
    }
    putSessionObject(key: string, body: Buffer) {
        this.objects.set(key, body);
        return Promise.resolve();
    }
    deleteSessionObjects(keys: string[]) {
        for (const k of keys) this.objects.delete(k);
        return Promise.resolve();
    }
    deleteSessionPrefix(prefix: string) {
        for (const k of [...this.objects.keys()]) if (k.startsWith(prefix)) this.objects.delete(k);
        return Promise.resolve();
    }
}

describe('loadSessionAuth', () => {
    const cipher = new SessionCipher(SECRET);
    const prefix = sessionPrefix(TENANT, CHANNEL);

    it('sessão nova não está pareada e recebe credenciais iniciais', async () => {
        const auth = await loadSessionAuth(new MemoryObjects(), cipher, prefix);
        expect(auth.isRegistered()).toBe(false);
        expect(auth.state.creds.noiseKey.private).toBeInstanceOf(Uint8Array);
    });

    it('persiste credenciais e chaves (com Buffer) e recarrega igual', async () => {
        const objects = new MemoryObjects();
        const auth = await loadSessionAuth(objects, cipher, prefix);
        auth.state.creds.me = { id: '5511988880000:12@s.whatsapp.net' };
        await auth.saveCreds();
        await auth.state.keys.set({ session: { '5511977770000.0': Buffer.from([1, 2, 3]) }, 'lid-mapping': { '5511977770000': '123@lid' } });

        const keysWritten = [...objects.objects.keys()];
        expect(keysWritten).toContain(`${prefix}creds`);
        expect(keysWritten).toContain(`${prefix}keys/session/5511977770000.0`);

        const reloaded = await loadSessionAuth(objects, cipher, prefix);
        expect(reloaded.isRegistered()).toBe(true);
        expect(Buffer.from(reloaded.state.creds.noiseKey.private)).toEqual(Buffer.from(auth.state.creds.noiseKey.private));
        const sessions = await reloaded.state.keys.get('session', ['5511977770000.0', 'inexistente']);
        expect(Buffer.from(sessions['5511977770000.0']!)).toEqual(Buffer.from([1, 2, 3]));
        expect(sessions).not.toHaveProperty('inexistente');
        expect(await reloaded.state.keys.get('lid-mapping', ['5511977770000'])).toEqual({ '5511977770000': '123@lid' });
    });

    it('guarda ausência em cache e apaga chave com null', async () => {
        const objects = new MemoryObjects();
        const auth = await loadSessionAuth(objects, cipher, prefix);
        await auth.state.keys.get('pre-key', ['1']);
        await auth.state.keys.get('pre-key', ['1']);
        expect(objects.gets).toBe(2); // creds + a primeira consulta da chave

        await auth.state.keys.set({ 'pre-key': { '2': { public: Buffer.from([1]), private: Buffer.from([2]) } } });
        expect(objects.objects.has(`${prefix}keys/pre-key/2`)).toBe(true);
        await auth.state.keys.set({ 'pre-key': { '2': null } });
        expect(objects.objects.has(`${prefix}keys/pre-key/2`)).toBe(false);
        expect(await auth.state.keys.get('pre-key', ['2'])).toEqual({});
    });

    it('clear apaga só a sessão deste canal', async () => {
        const objects = new MemoryObjects();
        objects.objects.set('tenants/outro/channels/x/wpp_lib/creds', Buffer.from('x'));
        const auth = await loadSessionAuth(objects, cipher, prefix);
        await auth.saveCreds();
        await auth.clear();
        expect([...objects.objects.keys()]).toEqual(['tenants/outro/channels/x/wpp_lib/creds']);
    });

    it('ids com caracteres especiais viram chaves de objeto seguras', async () => {
        const objects = new MemoryObjects();
        const auth = await loadSessionAuth(objects, cipher, prefix);
        await auth.state.keys.set({ 'sender-key': { '120363@g.us::5511:3@s.whatsapp.net': Buffer.from([9]) } });
        const [key] = [...objects.objects.keys()].filter((k) => k.includes('sender-key'));
        expect(key).toBe(`${prefix}keys/sender-key/120363%40g.us%3A%3A5511%3A3%40s.whatsapp.net`);
    });
});
