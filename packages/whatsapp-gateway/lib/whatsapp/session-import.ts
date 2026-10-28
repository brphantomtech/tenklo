import { BufferJSON } from 'baileys';

import { sessionPrefix } from './auth-state.js';

import type { Storage } from '../storage/index.js';
import type { SessionCipher } from './session-cipher.js';
import type { AuthenticationCreds } from 'baileys';

type SessionObjects = Pick<Storage, 'getSessionObject' | 'putSessionObject'>;

/** An object of a Baileys session, as auth-state.ts lays it out: `creds`, or `keys/<type>/<encodeURIComponent(id)>`. */
export interface ImportedObject {
    path: string;
    /** The object's JSON, written with BufferJSON.replacer. */
    json: string;
}

export const IMPORTED_PATH = /^(creds|keys\/[a-z0-9-]{1,64}\/[^/]{1,512})$/;

export class SessionImportError extends Error {
    constructor(
        readonly code: 'invalid_session' | 'session_exists',
        message: string
    ) {
        super(message);
    }
}

/**
 * Stores a Baileys session paired elsewhere (StackChat's worker-wpp-lib keeps the same layout), so the number moves
 * without scanning a new QR code. The objects are encrypted with this gateway's key, under the new channel's prefix.
 * Refuses a channel that already has a session: an import never overwrites one.
 */
export async function importSession({
    storage,
    cipher,
    tenantId,
    channelId,
    objects
}: {
    storage: SessionObjects;
    cipher: SessionCipher;
    tenantId: string;
    channelId: string;
    objects: ImportedObject[];
}): Promise<{ account: { jid: string; name: string | null }; objects: number }> {
    const credsObject = objects.find((o) => o.path === 'creds');
    if (!credsObject) {
        throw new SessionImportError('invalid_session', 'the session has no creds');
    }
    let creds: AuthenticationCreds;
    try {
        creds = JSON.parse(credsObject.json, BufferJSON.reviver) as AuthenticationCreds;
    } catch {
        throw new SessionImportError('invalid_session', 'the creds are not valid JSON');
    }
    if (!creds.me?.id) {
        throw new SessionImportError('invalid_session', 'the session was never paired');
    }

    const seen = new Set<string>();
    for (const object of objects) {
        if (!IMPORTED_PATH.test(object.path)) {
            throw new SessionImportError('invalid_session', `invalid object path: ${object.path.slice(0, 100)}`);
        }
        if (seen.has(object.path)) {
            throw new SessionImportError('invalid_session', `duplicated object path: ${object.path.slice(0, 100)}`);
        }
        seen.add(object.path);
    }

    const prefix = sessionPrefix(tenantId, channelId);
    if (await storage.getSessionObject(`${prefix}creds`)) {
        throw new SessionImportError('session_exists', 'this channel already has a session');
    }

    // The keys first and the creds last: a session without creds is never resumed, so a failed import leaves nothing usable.
    const ordered = [...objects.filter((o) => o.path !== 'creds'), credsObject];
    for (const object of ordered) {
        const objectKey = `${prefix}${object.path}`;
        await storage.putSessionObject(objectKey, cipher.encrypt(Buffer.from(object.json, 'utf8'), objectKey));
    }

    return { account: { jid: creds.me.id, name: creds.me.name ?? null }, objects: objects.length };
}
