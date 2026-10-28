export const TELEGRAM_SCHEMA = 'telegram';
export const SESSION_OBJECTS_TABLE = 'session_objects';

// knex's own tracking table, kept inside the gateway schema so it cannot interfere with the server's migrations.
export const TELEGRAM_MIGRATIONS_TABLE = 'migrations';
