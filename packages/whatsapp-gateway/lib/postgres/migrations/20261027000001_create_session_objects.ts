import { SESSION_OBJECTS_TABLE } from '../schema.js';

import type { Knex } from 'knex';

/**
 * One row per Baileys auth object (the creds, and one per Signal key), already encrypted by the gateway.
 *
 * `key` uses the C collation so the btree serves the `LIKE 'prefix%'` scans that delete a whole session.
 */
export async function up(knex: Knex, schema: string): Promise<void> {
    await knex.raw(
        `
        CREATE TABLE IF NOT EXISTS ??.?? (
            key        text COLLATE "C" PRIMARY KEY,
            data       bytea       NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        `,
        [schema, SESSION_OBJECTS_TABLE]
    );
}
