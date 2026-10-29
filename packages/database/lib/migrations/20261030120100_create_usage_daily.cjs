exports.config = { transaction: true };

/**
 * One row per environment, UTC day and metric: counters (requests, bytes transferred) add up during the day,
 * snapshots (active connections, storage) keep the day's highest reading.
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE IF NOT EXISTS "usage_daily" (
            "environment_id" integer NOT NULL REFERENCES "_nango_environments" ("id") ON DELETE CASCADE,
            "account_id" integer NOT NULL REFERENCES "_nango_accounts" ("id") ON DELETE CASCADE,
            "day" date NOT NULL,
            "metric" varchar(64) NOT NULL,
            "value" bigint NOT NULL DEFAULT 0,
            "updated_at" timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY ("environment_id", "day", "metric")
        )
    `);
    await knex.raw(`CREATE INDEX IF NOT EXISTS "usage_daily_account_id_day_idx" ON "usage_daily" ("account_id", "day")`);
};

exports.down = async function () {};
