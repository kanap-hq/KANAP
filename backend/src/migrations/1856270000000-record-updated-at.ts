import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG = '[migration 1856270000000 record-updated-at]';

/**
 * The tables whose `updated_at` the assistant and the MCP server show, sort and filter on, plus
 * the lists of the screens that sort on it, with the columns a system writer changes on its own
 * (a change of those alone is no edit). The list as of this migration: the living copy is
 * `common/updated-at.inventory.ts`, which a spec compares with the database.
 *
 * - `status` on the tables of the lifecycle status sync (`cleanup/lifecycle-status-sync.service.ts`):
 *   the stored status catches up with a passed end of validity, the person changed nothing.
 * - `sort_order` of the analytics dimensions and values: a reorder of the list is no edit of the
 *   record (`analytics/analytics-axes.service.ts`, the reorder specs).
 * - `row_version`: the budget line's concurrency counter, written by its own trigger.
 * - `priority_score`: the score the criteria compute; the criteria values carry the change.
 * - `search_vector`: the document's search index.
 * - users: the sign-in stamps and secrets (`last_login_at`, `external_synced_at`, `password_hash`,
 *   `mfa_secret`).
 */
const TABLES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['accounts', ['status']],
  ['analytics_axes', ['status', 'sort_order']],
  ['analytics_categories', ['status', 'sort_order']],
  ['applications', []],
  ['assets', []],
  ['business_processes', ['status']],
  ['chart_of_accounts', []],
  ['companies', ['status']],
  ['connections', []],
  ['contacts', []],
  ['contracts', ['status']],
  ['departments', ['status']],
  ['documents', ['search_vector']],
  ['incidents', []],
  ['interfaces', []],
  ['locations', []],
  ['portfolio_projects', ['priority_score']],
  ['portfolio_requests', ['priority_score']],
  ['roles', []],
  ['spend_items', ['status', 'row_version']],
  ['suppliers', ['status']],
  ['tasks', []],
  ['technologies', []],
  ['technology_versions', []],
  ['technology_vulnerabilities', []],
  ['users', ['last_login_at', 'external_synced_at', 'password_hash', 'mfa_secret']],
  ['working_day_profiles', ['status']],
];

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The modification date the database keeps: one `BEFORE UPDATE` trigger per table, named
 * `<table>_updated_at`, on one shared function that reads no table.
 *
 * - A statement that writes `updated_at` itself keeps its value (a service that dates the change
 *   of a child row on its record, a writer that backdates).
 * - Otherwise a row whose columns changed, the technical ones aside, takes `now()`; a row written
 *   back as it was, or changed in its technical columns only, keeps its date.
 * - The rows are compared as `jsonb` in the body, with no `WHEN (OLD.* IS DISTINCT FROM NEW.*)`:
 *   a whole-row comparison fails on every update once a column has no equality (`json`), as the
 *   budget line's `row_version` trigger found (1853740000000).
 *
 * Writes no row: the dates already stored stay. A migration that rewrites rows of these tables
 * without changing what a person entered disables the trigger by name around its update
 * (`doc/architecture.md`, "Modification dates").
 */
export class RecordUpdatedAt1856270000000 implements MigrationInterface {
  name = 'RecordUpdatedAt1856270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION stamp_updated_at() RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $$
      BEGIN
        IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
          RETURN NEW;
        END IF;
        IF (to_jsonb(NEW) - coalesce(TG_ARGV, '{}'::text[])) IS DISTINCT FROM (to_jsonb(OLD) - coalesce(TG_ARGV, '{}'::text[])) THEN
          NEW.updated_at := now();
        END IF;
        RETURN NEW;
      END
      $$`);

    let placed = 0;
    for (const [table, technical] of TABLES) {
      const [found] = await queryRunner.query(
        `SELECT c.oid IS NOT NULL AS has_table,
                EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped) AS has_column
           FROM (SELECT to_regclass($1) AS oid) c`,
        [`public.${table}`],
      );
      if (!found?.has_table || !found?.has_column) {
        // Left without a trigger rather than given a column: the spec of the inventory names it.
        console.warn(`${LOG} ${table}: ${found?.has_table ? 'no updated_at column' : 'table missing'}, no trigger placed`);
        continue;
      }
      const args = technical.map(quoteLiteral).join(', ');
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${table}_updated_at ON ${table}`);
      await queryRunner.query(
        `CREATE TRIGGER ${table}_updated_at BEFORE UPDATE ON ${table}
           FOR EACH ROW EXECUTE FUNCTION stamp_updated_at(${args})`,
      );
      placed += 1;
    }
    console.log(`${LOG} ${placed} of ${TABLES.length} table(s) keep their modification date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table] of TABLES) {
      const [found] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS has_table`, [`public.${table}`]);
      if (found?.has_table) await queryRunner.query(`DROP TRIGGER IF EXISTS ${table}_updated_at ON ${table}`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS stamp_updated_at()`);
  }
}
