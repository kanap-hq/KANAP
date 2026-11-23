import type { EntityManager, QueryRunner } from 'typeorm';
import { UPDATED_AT_SEARCH_ENTITY_TYPES, UPDATED_AT_TABLES } from './updated-at.inventory';

/**
 * The modification date the database keeps (`doc/architecture.md`, "Modification Dates"): the
 * trigger `<table>_updated_at` of a table of `updated-at.inventory.ts`, on `stamp_updated_at()`.
 *
 * The comparison sits in the trigger's `WHEN` clause, column by column, so that a row whose
 * columns did not change never enters the function: a function that reads `NEW` as a whole would
 * copy the long texts stored apart (TOAST) on every update. The list of the columns is read from
 * the catalog when the trigger is placed: a migration that adds a column to one of these tables
 * calls `syncUpdatedAtTrigger` again (the inventory spec fails until it does).
 *
 * The application never writes the date through TypeORM (`update: false` on the entities'
 * column): a date it sets on purpose goes through `touchUpdatedAtMany`, for the rows its history
 * shows (`audit/record-dating.ts`), or `touchUpdatedAt`, for a child change the history does not show.
 */

type Executor = Pick<QueryRunner, 'query'>;

export type UpdatedAtColumn = { name: string; cast: '' | '::jsonb' | '::jsonb[]' | '::text' };

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * The columns of a table whose change dates the row: every column but `updated_at`, the generated
 * ones (a `BEFORE` trigger's `WHEN` cannot read them, and they follow other columns) and the
 * technical ones of the inventory (none for a table outside it). A type without an equality is
 * compared through a cast: `json` as `jsonb`, any other as `text`.
 */
export async function updatedAtColumns(executor: Executor, table: string): Promise<UpdatedAtColumn[]> {
  const technical = UPDATED_AT_TABLES[table] ?? [];
  const rows: Array<{ name: string; is_json: boolean; is_array: boolean; has_equality: boolean }> = await executor.query(
    `WITH cols AS (
       SELECT a.attnum, a.attname::text AS name,
              CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE a.atttypid END AS typ
         FROM pg_attribute a
         JOIN pg_type t ON t.oid = a.atttypid
        WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     ), typed AS (
       SELECT c.attnum, c.name, (t.typcategory = 'A' AND t.typelem <> 0) AS is_array,
              CASE WHEN t.typcategory = 'A' AND t.typelem <> 0 THEN t.typelem ELSE c.typ END AS cmp
         FROM cols c JOIN pg_type t ON t.oid = c.typ
     )
     SELECT name, is_array, cmp = 'json'::regtype AS is_json,
            (SELECT e.typtype = 'e' FROM pg_type e WHERE e.oid = cmp)
            OR EXISTS (SELECT 1 FROM pg_operator o WHERE o.oprname = '=' AND o.oprleft = cmp AND o.oprright = cmp)
            OR EXISTS (SELECT 1 FROM pg_cast k
                         JOIN pg_operator o ON o.oprname = '=' AND o.oprleft = k.casttarget AND o.oprright = k.casttarget
                        WHERE k.castsource = cmp AND k.castmethod = 'b') AS has_equality
       FROM typed
      ORDER BY attnum`,
    [`public.${table}`],
  );
  return rows
    .filter((row) => row.name !== 'updated_at' && !technical.includes(row.name))
    .map((row) => ({
      name: row.name,
      cast: row.is_json ? (row.is_array ? '::jsonb[]' : '::jsonb') : row.has_equality ? '' : '::text',
    }));
}

/** The `WHEN` clause of the table's trigger, for these columns. */
export function updatedAtCondition(columns: UpdatedAtColumn[]): string {
  const side = (row: 'NEW' | 'OLD') => columns.map((column) => `${row}.${quoteIdent(column.name)}${column.cast}`).join(', ');
  return `NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at AND ROW(${side('NEW')}) IS DISTINCT FROM ROW(${side('OLD')})`;
}

export type UpdatedAtTriggerOutcome = 'placed' | 'not in the inventory' | 'table missing' | 'no updated_at column';

/**
 * (Re)places the trigger of a table of the inventory from the catalog of today, without a lock
 * that blocks the readers (`CREATE OR REPLACE TRIGGER`). A table missing, or without its
 * `updated_at` column, gets no trigger: the column is never added in silence, the inventory spec
 * names the table. A table that left the inventory since the migration that names it gets none
 * either, with a log line: a migration keeps its own list of tables.
 */
export async function syncUpdatedAtTrigger(executor: Executor, table: string): Promise<UpdatedAtTriggerOutcome> {
  if (!UPDATED_AT_TABLES[table]) {
    console.log(`[updated-at] ${table} is not in common/updated-at.inventory.ts: no trigger placed`);
    return 'not in the inventory';
  }
  const [found] = await executor.query(
    `SELECT c.oid IS NOT NULL AS has_table,
            EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped) AS has_column
       FROM (SELECT to_regclass($1) AS oid) c`,
    [`public.${table}`],
  );
  if (!found?.has_table) return 'table missing';
  if (!found.has_column) return 'no updated_at column';
  const condition = updatedAtCondition(await updatedAtColumns(executor, table));
  await executor.query(
    `CREATE OR REPLACE TRIGGER ${quoteIdent(`${table}_updated_at`)} BEFORE UPDATE ON public.${quoteIdent(table)}
       FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION stamp_updated_at()`,
  );
  return 'placed';
}

/**
 * The update changed the date and nothing else (`syncSearchIndexTriggers`). The cheap test first:
 * an update that leaves the date (a status alone, a row written back as it was) never reads the
 * row as a whole, and runs the sync as before.
 */
export const SEARCH_INDEX_DATE_ONLY = `OLD.updated_at IS DISTINCT FROM NEW.updated_at AND (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at')`;

export type SearchIndexTriggerOutcome = 'placed' | 'no search index' | 'table missing' | 'no sync function';

/**
 * (Re)places the search index triggers of a table of `UPDATED_AT_SEARCH_ENTITY_TYPES`, so that an
 * update of the date alone (the dating of a history entry, `touchUpdatedAtMany`) does not compute
 * the record's search entry again:
 * - `trg_search_index_<table>`: insert and delete, on `search_index_sync_<table>()` as before;
 * - `trg_search_index_<table>_update`: every other update, same function;
 * - `trg_search_index_<table>_date`: a statement that names `updated_at` and moves it, on
 *   `search_index_stamp_source(<entity types>)`, which copies the date to the entry's
 *   `source_updated_at` (read by the assistant) and does nothing else. It does not read the row
 *   as a whole: when the update changed more (a backdate with an edit), the sync also runs and
 *   writes the same date.
 * The sync functions are left as they are. A migration that recreates `trg_search_index_<table>`
 * for every update calls this again; `__tests__/updated-at.search-index.integration.spec.ts`
 * fails until it does.
 */
export async function syncSearchIndexTriggers(executor: Executor, table: string): Promise<SearchIndexTriggerOutcome> {
  const types = UPDATED_AT_SEARCH_ENTITY_TYPES[table];
  if (!types) return 'no search index';
  const [found] = await executor.query(
    `SELECT to_regclass($1) IS NOT NULL AS has_table, to_regprocedure($2) IS NOT NULL AS has_sync`,
    [`public.${table}`, `public.search_index_sync_${table}()`],
  );
  if (!found?.has_table) return 'table missing';
  if (!found.has_sync) return 'no sync function';
  const on = `public.${quoteIdent(table)}`;
  const sync = `public.${quoteIdent(`search_index_sync_${table}`)}()`;
  const name = (suffix: string) => quoteIdent(`trg_search_index_${table}${suffix}`);
  const args = types.map((type) => `'${type.replace(/'/g, "''")}'`).join(', ');
  await executor.query(`CREATE OR REPLACE TRIGGER ${name('')} AFTER INSERT OR DELETE ON ${on} FOR EACH ROW EXECUTE FUNCTION ${sync}`);
  await executor.query(
    `CREATE OR REPLACE TRIGGER ${name('_update')} AFTER UPDATE ON ${on}
       FOR EACH ROW WHEN (NOT (${SEARCH_INDEX_DATE_ONLY})) EXECUTE FUNCTION ${sync}`,
  );
  // `UPDATE OF updated_at`: a statement that does not name the date never fires it.
  await executor.query(
    `CREATE OR REPLACE TRIGGER ${name('_date')} AFTER UPDATE OF updated_at ON ${on}
       FOR EACH ROW WHEN (OLD.updated_at IS DISTINCT FROM NEW.updated_at) EXECUTE FUNCTION public.search_index_stamp_source(${args})`,
  );
  return 'placed';
}

/**
 * Puts back the search index trigger of each table as it was before migration 1856275000000 (one
 * `trg_search_index_<table>` on every insert, update and delete): the migration's `down()`, and a
 * spec that replays an older migration (the database of that migration's time, like
 * `dropUpdatedAtTriggers`). Without `tables`: every table of `UPDATED_AT_SEARCH_ENTITY_TYPES`.
 */
export async function restoreSearchIndexTriggers(executor: Executor, tables: readonly string[] = Object.keys(UPDATED_AT_SEARCH_ENTITY_TYPES)): Promise<void> {
  for (const table of tables) {
    const [found] = await executor.query(
      `SELECT to_regclass($1) IS NOT NULL AS has_table, to_regprocedure($2) IS NOT NULL AS has_sync`,
      [`public.${table}`, `public.search_index_sync_${table}()`],
    );
    if (!found?.has_table) continue;
    const on = `public.${quoteIdent(table)}`;
    await executor.query(`DROP TRIGGER IF EXISTS ${quoteIdent(`trg_search_index_${table}_update`)} ON ${on}`);
    await executor.query(`DROP TRIGGER IF EXISTS ${quoteIdent(`trg_search_index_${table}_date`)} ON ${on}`);
    if (!found.has_sync) continue;
    await executor.query(
      `CREATE OR REPLACE TRIGGER ${quoteIdent(`trg_search_index_${table}`)} AFTER INSERT OR DELETE OR UPDATE ON ${on}
         FOR EACH ROW EXECUTE FUNCTION public.${quoteIdent(`search_index_sync_${table}`)}()`,
    );
  }
}

/** Disables or enables the trigger of each table that has it; the tables without one are left. */
export async function setUpdatedAtTriggers(executor: Executor, tables: readonly string[], state: 'disable' | 'enable'): Promise<string[]> {
  const present: Array<{ table: string }> = await executor.query(
    `SELECT c.relname::text AS table
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
        AND c.relname = ANY($1::text[]) AND t.tgname = c.relname || '_updated_at'
      ORDER BY 1`,
    [tables],
  );
  for (const { table } of present) {
    await executor.query(`ALTER TABLE public.${quoteIdent(table)} ${state === 'disable' ? 'DISABLE' : 'ENABLE'} TRIGGER ${quoteIdent(`${table}_updated_at`)}`);
  }
  return present.map((row) => row.table);
}

/**
 * Runs `fn` with the modification date triggers of these tables disabled, in the caller's
 * transaction: a migration that rewrites rows without changing what a person entered. A table
 * without its trigger (a database before migration 1856270000000) is left as it is.
 */
export async function withUpdatedAtTriggersDisabled<T>(executor: Executor, tables: readonly string[], fn: () => Promise<T>): Promise<T> {
  const disabled = await setUpdatedAtTriggers(executor, tables, 'disable');
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    // Enabled again when the transaction still runs; an aborted one rolls the disable back with it.
    // The error of `fn` is the one thrown, never the refusal of an aborted transaction.
    await setUpdatedAtTriggers(executor, disabled, 'enable').catch(() => undefined);
    throw error;
  }
  await setUpdatedAtTriggers(executor, disabled, 'enable');
  return result;
}

/**
 * Drops the trigger of each table that has it, and returns those tables. The trigger's `WHEN`
 * names every column it compares: PostgreSQL refuses to drop or retype such a column while the
 * trigger stands ("cannot drop column ... because other objects depend on it"): do not follow the
 * hint to use `CASCADE`, which drops the trigger for good. A migration that drops or retypes a
 * column of these tables drops the trigger first, then calls `syncUpdatedAtTrigger` for the table; a spec that replays an older migration
 * drops it inside its rolled-back transaction (the database of that migration's time). Without
 * `tables`: every table of the inventory.
 */
export async function dropUpdatedAtTriggers(executor: Executor, tables: readonly string[] = Object.keys(UPDATED_AT_TABLES)): Promise<string[]> {
  const present: Array<{ table: string }> = await executor.query(
    `SELECT c.relname::text AS table
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
        AND c.relname = ANY($1::text[]) AND t.tgname = c.relname || '_updated_at'
      ORDER BY 1`,
    [tables],
  );
  for (const { table } of present) {
    await executor.query(`DROP TRIGGER ${quoteIdent(`${table}_updated_at`)} ON public.${quoteIdent(table)}`);
  }
  return present.map((row) => row.table);
}

/**
 * Dates records of the inventory on purpose, in the caller's transaction and tenant, in one
 * statement: the history shows an entry of theirs (`audit/record-dating.ts`), or a child changed
 * that the history does not show (`touchUpdatedAt`). The only place the application writes the
 * date. A row whose date is already the transaction's `now()` (the trigger or an earlier call
 * dated it) is not written again.
 *
 * The dating never waits: the rows are locked `FOR NO KEY UPDATE SKIP LOCKED`, in id order. A row
 * another transaction holds at that instant is left: that transaction is writing it (its own
 * change dates it), or holds it without changing it (a lock taken before a write, a budget
 * operation holding its lines), and then the record keeps its date while its history gains the
 * entry, an accepted gap. Waiting instead made the dating a new lock the gesture did not hold
 * before: a deadlock against a gesture locking the same records in the other order, and the wait
 * of a long operation. The locks this transaction holds itself never make a row skipped.
 * Returns the number of rows written (0 also for a record missing in the tenant, one held
 * elsewhere, or one the person may only read under data-scoped access: the lock passes the UPDATE
 * policy, so such a row is not selected, without an error).
 */
export async function touchUpdatedAtMany(manager: Pick<EntityManager, 'query'>, table: string, ids: readonly string[]): Promise<number> {
  if (!UPDATED_AT_TABLES[table]) throw new Error(`${table} is not in common/updated-at.inventory.ts`);
  const sorted = Array.from(new Set(ids.map((id) => id.toLowerCase()))).sort();
  if (sorted.length === 0) return 0;
  const name = `public.${quoteIdent(table)}`;
  const [row] = await manager.query(
    `WITH touched AS (
       UPDATE ${name} SET updated_at = now()
        WHERE id IN (SELECT id FROM ${name}
                      WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[]) AND updated_at IS DISTINCT FROM now()
                      ORDER BY id FOR NO KEY UPDATE SKIP LOCKED)
        RETURNING 1
     )
     SELECT count(*)::int AS count FROM touched`,
    [sorted],
  );
  return row.count;
}

/**
 * Dates one record whose child changed without an entry in its history (a document's
 * contributors, a connection's protocols): called after the save, and only when the child really
 * changed. A child with a history entry needs no call: the entry dates the record.
 */
export async function touchUpdatedAt(manager: Pick<EntityManager, 'query'>, table: string, id: string): Promise<number> {
  return touchUpdatedAtMany(manager, table, [id]);
}
