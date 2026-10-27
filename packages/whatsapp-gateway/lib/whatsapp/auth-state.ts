import { BufferJSON, initAuthCreds, proto } from 'baileys';

import type { Storage } from '../storage/index.js';
import type { SessionCipher } from './session-cipher.js';
import type { AuthenticationCreds, AuthenticationState, SignalDataSet, SignalDataTypeMap } from 'baileys';

type SessionObjects = Pick<Storage, 'getSessionObject' | 'putSessionObject' | 'deleteSessionObjects' | 'deleteSessionPrefix'>;

export interface SessionAuth {
    readonly state: AuthenticationState;
    /** Sessão pareada (já leu o QR). */
    isRegistered(): boolean;
    saveCreds(): Promise<void>;
    /** Espera as gravações pendentes. */
    flush(): Promise<void>;
    /** Apaga a sessão inteira do armazenamento. */
    clear(): Promise<void>;
}

const IO_CONCURRENCY = 16;

export const sessionPrefix = (tenantId: string, channelId: string) => `tenants/${tenantId}/channels/${channelId}/wpp_lib/`;

/**
 * Estado de autenticação da Baileys persistido no RustFS, criptografado, com um objeto por chave do Signal.
 *
 * Um objeto por chave (e não um arquivo único) porque a sessão cresce com cada contato que recebe mensagem:
 * regravar um blob de vários MB a cada envio de campanha seria caro. As chaves são lidas sob demanda e ficam
 * em memória enquanto a sessão estiver aberta; toda gravação é concluída antes de a Baileys seguir.
 *
 *   tenants/<tenantId>/channels/<channelId>/wpp_lib/creds
 *   tenants/<tenantId>/channels/<channelId>/wpp_lib/keys/<tipo>/<id>
 */
export async function loadSessionAuth(objects: SessionObjects, cipher: SessionCipher, prefix: string): Promise<SessionAuth> {
    const credsKey = `${prefix}creds`;
    const keyPath = (type: string, id: string) => `${prefix}keys/${type}/${encodeURIComponent(id)}`;

    const read = async <T>(objectKey: string): Promise<T | undefined> => {
        const data = await objects.getSessionObject(objectKey);
        if (!data) return undefined;
        return JSON.parse(cipher.decrypt(data, objectKey).toString('utf8'), BufferJSON.reviver) as T;
    };

    // Gravações da mesma chave em sequência, para a mais nova nunca ser sobrescrita por uma antiga.
    const chains = new Map<string, Promise<void>>();
    const enqueue = (objectKey: string, op: () => Promise<void>): Promise<void> => {
        const next = (chains.get(objectKey) ?? Promise.resolve()).catch(() => undefined).then(op);
        chains.set(objectKey, next);
        void next
            .finally(() => {
                if (chains.get(objectKey) === next) chains.delete(objectKey);
            })
            .catch(() => undefined);
        return next;
    };
    const write = (objectKey: string, value: unknown) =>
        enqueue(objectKey, () => objects.putSessionObject(objectKey, cipher.encrypt(Buffer.from(JSON.stringify(value, BufferJSON.replacer)), objectKey)));
    const remove = (objectKey: string) => enqueue(objectKey, () => objects.deleteSessionObjects([objectKey]));

    const creds: AuthenticationCreds = (await read<AuthenticationCreds>(credsKey)) ?? initAuthCreds();

    // null = sabidamente ausente, para não consultar o armazenamento de novo.
    const cache = new Map<string, unknown>();

    const state: AuthenticationState = {
        creds,
        keys: {
            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                const result: { [id: string]: SignalDataTypeMap[T] } = {};
                await mapLimit(ids, IO_CONCURRENCY, async (id) => {
                    const objectKey = keyPath(type, id);
                    let value = cache.get(objectKey);
                    if (value === undefined) {
                        value = (await read(objectKey)) ?? null;
                        if (value !== null && type === 'app-state-sync-key') {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
                        }
                        cache.set(objectKey, value);
                    }
                    if (value !== null) result[id] = value as SignalDataTypeMap[T];
                });
                return result;
            },
            set: async (data: SignalDataSet) => {
                const ops: Array<() => Promise<void>> = [];
                for (const [type, entries] of Object.entries(data)) {
                    for (const [id, value] of Object.entries(entries ?? {})) {
                        const objectKey = keyPath(type, id);
                        cache.set(objectKey, value ?? null);
                        ops.push(() => (value ? write(objectKey, value) : remove(objectKey)));
                    }
                }
                await mapLimit(ops, IO_CONCURRENCY, (op) => op());
            }
        }
    };

    return {
        state,
        isRegistered: () => !!creds.registered || !!creds.me?.id,
        saveCreds: () => write(credsKey, creds),
        flush: async () => {
            while (chains.size) await Promise.allSettled(chains.values());
        },
        clear: async () => {
            while (chains.size) await Promise.allSettled(chains.values());
            cache.clear();
            await objects.deleteSessionPrefix(prefix);
        }
    };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) await fn(items[index++]!);
    });
    await Promise.all(workers);
}
