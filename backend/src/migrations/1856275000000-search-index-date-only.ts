import { MigrationInterface, QueryRunner } from 'typeorm';
import { restoreSearchIndexTriggers, syncSearchIndexTriggers } from '../common/updated-at-trigger';

const LOG = '[migration 1856275000000 search-index-date-only]';

/** The tables of the modification date (migration 1856270000000) that the search index keeps. */
const TABLES: readonly string[] = [
  'accounts', 'analytics_categories', 'applications', 'assets', 'business_processes', 'chart_of_accounts',
  'companies', 'connections', 'contacts', 'contracts', 'departments', 'documents', 'incidents', 'interfaces',
  'locations', 'portfolio_projects', 'portfolio_requests', 'spend_items', 'suppliers', 'tasks', 'technologies',
  'users',
];

/**
 * An update of a record's date alone (a history entry dates its record, `audit/record-dating.ts`)
 * no longer computes the record's search entry again: the trigger `trg_search_index_<table>` that
 * ran the sync on every update is split (`syncSearchIndexTriggers`, `common/updated-at-trigger.ts`):
 * insert and delete as before; an update that changed more than `updated_at`, same sync function;
 * an update of `updated_at` alone, on `search_index_stamp_source()`, which copies the date to the
 * entry's `source_updated_at` (the date the assistant sorts and shows) and does nothing else.
 *
 * The sync functions are not redefined. `search_index_stamp_source()` is SECURITY DEFINER with its
 * `search_path` pinned, like the sync functions: the limited role of data-scoped access does not
 * write `search_index`. Writes no row; rerun-safe (`CREATE OR REPLACE`).
 */
export class SearchIndexDateOnly1856275000000 implements MigrationInterface {
  name = 'SearchIndexDateOnly1856275000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION search_index_stamp_source() RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
      BEGIN
        -- TG_ARGV: the entity types of the table's entries.
        UPDATE search_index SET source_updated_at = NEW.updated_at
         WHERE tenant_id = NEW.tenant_id AND entity_type = ANY (TG_ARGV) AND entity_id = NEW.id
           AND source_updated_at IS DISTINCT FROM NEW.updated_at;
        RETURN NULL;
      END
      $$`);

    let placed = 0;
    for (const table of TABLES) {
      const outcome = await syncSearchIndexTriggers(queryRunner, table);
      if (outcome !== 'placed') {
        console.warn(`${LOG} ${table}: ${outcome}, triggers left as they are`);
        continue;
      }
      placed += 1;
    }
    console.log(`${LOG} ${placed} of ${TABLES.length} table(s) keep their search entry on a date-only update`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await restoreSearchIndexTriggers(queryRunner, TABLES);
    await queryRunner.query(`DROP FUNCTION IF EXISTS search_index_stamp_source()`);
  }
}
