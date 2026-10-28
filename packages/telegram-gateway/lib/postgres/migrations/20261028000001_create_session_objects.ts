import { SESSION_OBJECTS_TABLE } from '../schema.js';

import type { Knex } from 'knex';

/**
 * One row per stored object of a channel: today only the bot token, sealed as the server sent it
 * (tenants/<tenantId>/channels/<channelId>/tlg/token).
 *
 * `key` uses the C collation so the btree serves the `LIKE 'prefix%'` scans that delete a whole channel.
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
