import { SESSION_OBJECTS_TABLE, WHATSAPP_SCHEMA } from '../postgres/schema.js';

import type { Knex } from 'knex';

/** Encrypted Baileys auth objects in Postgres, one row per object key. */
export class PostgresSessionObjects {
    constructor(
        private readonly knex: Knex,
        private readonly schema: string = WHATSAPP_SCHEMA
    ) {}

    private table() {
        return this.knex.withSchema(this.schema).table(SESSION_OBJECTS_TABLE);
    }

    async getSessionObject(key: string): Promise<Buffer | undefined> {
        const row = await this.table().select<{ data: Buffer }[]>('data').where({ key }).first();
        return row?.data;
    }

    async putSessionObject(key: string, body: Buffer): Promise<void> {
        await this.table().insert({ key, data: body, updated_at: this.knex.fn.now() }).onConflict('key').merge(['data', 'updated_at']);
    }

    async deleteSessionObjects(keys: string[]): Promise<void> {
        for (let i = 0; i < keys.length; i += 1000) {
            await this.table()
                .whereIn('key', keys.slice(i, i + 1000))
                .delete();
        }
    }

    /** Deletes a whole session. */
    async deleteSessionPrefix(prefix: string): Promise<void> {
        await this.table()
            .where('key', 'like', `${escapeLike(prefix)}%`)
            .delete();
    }
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
