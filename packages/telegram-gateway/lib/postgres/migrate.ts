import { migrateSchema, migrationsLocation } from '@nangohq/migrations';

import { TELEGRAM_MIGRATIONS_TABLE, TELEGRAM_SCHEMA } from './schema.js';

import type { Result } from '@nangohq/utils';
import type { Knex } from 'knex';

export function migrate({ knex, schema = TELEGRAM_SCHEMA }: { knex: Knex; schema?: string }): Promise<Result<void>> {
    return migrateSchema({ knex, schema, tableName: TELEGRAM_MIGRATIONS_TABLE, ...migrationsLocation(import.meta.url) });
}
