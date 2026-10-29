exports.config = { transaction: true };

/**
 * Accounts that are never charged. Their usage is still metered, so it shows on the dashboard and in reports.
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
    await knex.raw(`ALTER TABLE "_nango_accounts" ADD COLUMN IF NOT EXISTS "billing_exempt" bool NOT NULL DEFAULT false`);
};

exports.down = async function () {};
