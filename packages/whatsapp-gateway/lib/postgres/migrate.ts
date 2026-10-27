import { migrateSchema, migrationsLocation } from '@nangohq/migrations';

import { WHATSAPP_MIGRATIONS_TABLE, WHATSAPP_SCHEMA } from './schema.js';

import type { Result } from '@nangohq/utils';
import type { Knex } from 'knex';

export function migrate({ knex, schema = WHATSAPP_SCHEMA }: { knex: Knex; schema?: string }): Promise<Result<void>> {
    return migrateSchema({ knex, schema, tableName: WHATSAPP_MIGRATIONS_TABLE, ...migrationsLocation(import.meta.url) });
}
