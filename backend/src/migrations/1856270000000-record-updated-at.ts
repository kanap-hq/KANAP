import { MigrationInterface, QueryRunner } from 'typeorm';
import { syncUpdatedAtTrigger } from '../common/updated-at-trigger';

const LOG = '[migration 1856270000000 record-updated-at]';

/**
 * The tables whose `updated_at` the assistant and the MCP server show, sort and filter on, plus
 * the lists of the screens that sort on it. Their technical columns (a change of those alone is no
 * edit) are those of `common/updated-at.inventory.ts`, with the reason of each, which a spec
 * compares with the database.
 */
const TABLES: readonly string[] = [
  'accounts', 'analytics_axes', 'analytics_categories', 'applications', 'assets', 'business_processes',
  'chart_of_accounts', 'companies', 'connections', 'contacts', 'contracts', 'departments', 'documents',
  'incidents', 'interfaces', 'locations', 'portfolio_projects', 'portfolio_requests', 'roles', 'spend_items',
  'suppliers', 'tasks', 'technologies', 'technology_versions', 'technology_vulnerabilities', 'users',
  'working_day_profiles',
];

/**
 * The modification date the database keeps: one `BEFORE UPDATE` trigger per table, named
 * `<table>_updated_at`, on one shared function that reads no table (`common/updated-at-trigger.ts`).
 *
 * - The trigger's `WHEN` compares the row column by column, the technical columns aside, the list
 *   read from the catalog when the trigger is placed: a row written back as it was, or changed in
 *   its technical columns only, never enters the function and keeps its date. The function only
 *   sets `now()`: it never reads `NEW` as a whole, which would copy the long texts stored apart
 *   (TOAST) on every update.
 * - A statement that writes `updated_at` itself keeps its value (a service that dates the change
 *   of a child row on its record, a writer that backdates).
 * - A type without an equality (`json`) is compared through a cast, so that no update fails.
 *
 * Writes no row: the dates already stored stay. A migration that rewrites rows of these tables
 * without changing what a person entered wraps its update in `withUpdatedAtTriggersDisabled`; one
 * that adds a column to them calls `syncUpdatedAtTrigger` (`doc/architecture.md`, "Modification
 * Dates").
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
        NEW.updated_at := now();
        RETURN NEW;
      END
      $$`);

    let placed = 0;
    for (const table of TABLES) {
      const outcome = await syncUpdatedAtTrigger(queryRunner, table);
      if (outcome !== 'placed') {
        // Left without a trigger rather than given a column: the spec of the inventory names it.
        console.warn(`${LOG} ${table}: ${outcome}, no trigger placed`);
        continue;
      }
      placed += 1;
    }
    console.log(`${LOG} ${placed} of ${TABLES.length} table(s) keep their modification date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      const [found] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS has_table`, [`public.${table}`]);
      if (found?.has_table) await queryRunner.query(`DROP TRIGGER IF EXISTS ${table}_updated_at ON ${table}`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS stamp_updated_at()`);
  }
}
