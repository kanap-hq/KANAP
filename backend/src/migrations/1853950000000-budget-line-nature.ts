import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] BudgetLineNature:';
const NATURE_CHECK = 'spend_items_nature_check';
const LEGACY_INDEX = 'uq_spend_items_tenant_legacy_number';
const INDEXES = [
  { name: 'idx_spend_items_tenant_nature', columns: '(tenant_id, nature)' },
  { name: 'idx_spend_items_tenant_project', columns: '(tenant_id, project_id)' },
];
/**
 * The line triggers the repair and the backfill must not fire: the freshness counter
 * (`row_version`, 1853740000000: a legacy number is no change of the line, and a new counter
 * would void every exported budget file's token and tell every open workspace the line changed)
 * and the line's search entry (it reads neither column).
 */
const QUIET_TRIGGERS = ['spend_items_row_version', 'trg_search_index_spend_items'];

/* ---- The search entry of an OPEX line (1853940000000's body, with or without the nature) ---- */

const ANALYTICS_EXTRA = `CASE WHEN la.analytics_display IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('analytics', la.analytics_display) END`;
const ANALYTICS_VECTOR = `search_index_tsv('B', la.analytics_text)`;
const UPSERT = `ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
        ref_prefix = EXCLUDED.ref_prefix,
        ref_number = EXCLUDED.ref_number,
        label = EXCLUDED.label,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        extra_json = EXCLUDED.extra_json,
        search_vector = EXCLUDED.search_vector,
        source_updated_at = EXCLUDED.source_updated_at,
        indexed_at = EXCLUDED.indexed_at`;

/**
 * `search_index_refresh_spend_items` as 1853940000000 generates it; with `opexOnly`, the entries
 * of type `spend_items` are the lines of nature `opex` only: the upsert reads those, and the purge
 * removes an entry whose line is gone or of another nature. Nothing else differs, so down() puts
 * back the body of 1853940000000 to the character (a spec compares them). No SET clause, as
 * before: PL/pgSQL keeps each path's plan for the session (1853940000000).
 */
function spendRefreshSql(opexOnly: boolean): string {
  const nature = (alias: string) => (opexOnly ? ` AND ${alias}.nature = 'opex'` : '');
  const byIds = (ids: boolean, column: string) => (ids ? `\n           AND ${column} = ANY (p_ids)` : '');
  const purge = (ids: boolean) => `DELETE FROM search_index si_del
         WHERE si_del.tenant_id = p_tenant
           AND si_del.entity_type = 'spend_items'${byIds(ids, 'si_del.entity_id')}
           AND NOT EXISTS (
             SELECT 1 FROM spend_items src
             WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant${nature('src')}
           );`;
  const upsert = (ids: boolean) => `INSERT INTO search_index (
          tenant_id, entity_type, entity_id, ref_prefix, ref_number,
          label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
        )
        ${SPEND_SELECT}
        ${SPEND_FROM}
         WHERE si.tenant_id = p_tenant${nature('si')}${byIds(ids, 'si.id')}
        ${UPSERT};`;
  return `
    CREATE OR REPLACE FUNCTION search_index_refresh_spend_items(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
    RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN
      IF p_ids IS NULL THEN
        ${purge(false)}
        ${upsert(false)}
      ELSE
        ${purge(true)}
        ${upsert(true)}
      END IF;
    END
    $fn$
  `;
}

const SPEND_SELECT = `SELECT si.tenant_id,
             'spend_items',
             si.id,
             'OPX',
             si.item_number,
             si.product_name,
             COALESCE(
               NULLIF(si.description, ''),
               NULLIF(CONCAT_WS(' | ', sup.name, comp.name, NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), '')), '')
             ),
             si.status::text,
             jsonb_build_object(
               'supplier', sup.name,
               'paying_company', comp.name,
               'account', NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), ''),
               'contract', (
                 SELECT c.name
                 FROM contract_spend_items csi
                 JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
                 WHERE csi.spend_item_id = si.id
                 ORDER BY csi.created_at DESC
                 LIMIT 1
               )
             ) || ${ANALYTICS_EXTRA},
             search_index_tsv('A', CONCAT_WS(' ', 'OPX-' || si.item_number::text, si.product_name))
               || search_index_tsv('B', si.currency)
               || ${ANALYTICS_VECTOR}
               || search_index_tsv('C', CONCAT_WS(' ', si.description, sup.name, comp.name, acc.account_name, acc.account_number::text, si.notes, (
                 SELECT string_agg(c.name, ' ')
                 FROM contract_spend_items csi
                 JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
                 WHERE csi.spend_item_id = si.id
               ))),
             si.updated_at,
             now()`;

const SPEND_FROM = `FROM spend_items si
        LEFT JOIN suppliers sup ON sup.id = si.supplier_id AND sup.tenant_id = si.tenant_id
        LEFT JOIN companies comp ON comp.id = si.paying_company_id AND comp.tenant_id = si.tenant_id
        LEFT JOIN accounts acc ON acc.id = si.account_id AND acc.tenant_id = si.tenant_id
        LEFT JOIN LATERAL search_index_line_analytics(si.tenant_id, 'opex', si.id) la ON true`;

/** An UPDATE through the query runner returns [rows, count]: every count goes through a CTE. */
async function countChanged(queryRunner: QueryRunner, update: string): Promise<number> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(
    `WITH changed AS (${update} RETURNING 1) SELECT count(*)::int AS n FROM changed`,
  );
  return n;
}

/**
 * The nature of a budget line (plan planning/budget-unifie.md, lot Z0): `spend_items` learns
 * whether a line is OPEX or CAPEX, before lot Z1 moves the CAPEX lines into it. No data moves:
 * every line of `spend_items` is OPEX.
 *
 * 1. `spend_items.nature text NOT NULL DEFAULT 'opex'`, CHECK `spend_items_nature_check`
 *    (`opex`, `capex`). The default keeps every raw insert of the specs and scripts working; the
 *    code writes the nature itself.
 * 2. `spend_items.legacy_number text NULL`, unique per tenant when set
 *    (`uq_spend_items_tenant_legacy_number`): the reference a line had before the single `BL`
 *    numbering (OPX-n, later CPX-n), still accepted where a reference is typed.
 * 3. Indexes `(tenant_id, nature)` and `(tenant_id, project_id)`.
 * 4. With row level security off on `spend_items` (migrations run without app.current_tenant)
 *    and the line triggers above off, both restored as found, also on failure:
 *    - a nature outside the CHECK, or NULL, is set to `opex`, and a legacy number another line of
 *      the tenant also holds is cleared on the later lines (created_at, id): only a column added
 *      by hand can hold either;
 *    - every OPEX line without a legacy number gets `OPX-<item_number>`, unless another line of
 *      its tenant already holds that value (left empty, counted).
 *    `updated_at`, `row_version` and the search entries are left alone. The counts are logged.
 * 5. `search_index_refresh_spend_items` indexes the OPEX lines only (type `spend_items`, OPX),
 *    and purges an entry whose line is gone or of another nature. Every line being OPEX, no entry
 *    changes: no reindex.
 *
 * Each step is skipped when already done: a second run sets and changes nothing. down() refuses
 * while a line of another nature than OPEX exists (dropping the column would make it an OPEX
 * line), then puts back 1853940000000's refresh body and drops the indexes, the constraint and
 * both columns.
 */
export class BudgetLineNature1853950000000 implements MigrationInterface {
  name = 'BudgetLineNature1853950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS nature text NOT NULL DEFAULT 'opex'`);
    await queryRunner.query(`ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS legacy_number text`);

    const counts = await withoutRowSecurity(queryRunner, ['spend_items'], () =>
      withoutTriggers(queryRunner, 'spend_items', QUIET_TRIGGERS, async () => {
        const natures = await countChanged(
          queryRunner,
          `UPDATE spend_items SET nature = 'opex' WHERE nature IS NULL OR nature NOT IN ('opex', 'capex')`,
        );
        const duplicates = await countChanged(
          queryRunner,
          `UPDATE spend_items s SET legacy_number = NULL
            WHERE s.legacy_number IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM spend_items o
                 WHERE o.tenant_id = s.tenant_id AND o.legacy_number = s.legacy_number
                   AND (o.created_at, o.id) < (s.created_at, s.id)
              )`,
        );
        const numbered = await countChanged(
          queryRunner,
          `UPDATE spend_items s SET legacy_number = 'OPX-' || s.item_number
            WHERE s.nature = 'opex' AND s.legacy_number IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM spend_items o
                 WHERE o.tenant_id = s.tenant_id AND o.legacy_number = 'OPX-' || s.item_number
              )`,
        );
        const [{ n: unnumbered }]: Array<{ n: number }> = await queryRunner.query(
          `SELECT count(*)::int AS n FROM spend_items WHERE nature = 'opex' AND legacy_number IS NULL`,
        );
        return { natures, duplicates, numbered, unnumbered };
      }));

    // A column added by hand may lack the default or NOT NULL: both are set again.
    await queryRunner.query(`ALTER TABLE spend_items ALTER COLUMN nature SET DEFAULT 'opex'`);
    await queryRunner.query(`ALTER TABLE spend_items ALTER COLUMN nature SET NOT NULL`);
    const [existing] = await queryRunner.query(
      `SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'spend_items' AND c.conname = $1`,
      [NATURE_CHECK],
    );
    if (!existing) {
      await queryRunner.query(`ALTER TABLE spend_items ADD CONSTRAINT ${NATURE_CHECK} CHECK (nature IN ('opex', 'capex'))`);
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${LEGACY_INDEX} ON spend_items (tenant_id, legacy_number) WHERE legacy_number IS NOT NULL`,
    );
    for (const index of INDEXES) {
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${index.name} ON spend_items ${index.columns}`);
    }
    await queryRunner.query(spendRefreshSql(true));

    console.log(
      `${LOG_PREFIX} columns nature and legacy_number ready, ${counts.numbered} line(s) given their legacy number, `
        + `${counts.unnumbered} OPEX line(s) left without one, ${counts.natures} invalid nature(s) set to opex, `
        + `${counts.duplicates} duplicate legacy number(s) cleared, `
        + (existing ? 'constraint already present' : `constraint added: ${NATURE_CHECK}`)
        + '; the search index reads OPEX lines only',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [column] = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'spend_items' AND column_name = 'nature'`,
    );
    if (column) {
      const others = await withoutRowSecurity(queryRunner, ['spend_items'], async () => {
        const [{ n }]: Array<{ n: number }> = await queryRunner.query(
          `SELECT count(*)::int AS n FROM spend_items WHERE nature <> 'opex'`,
        );
        return n;
      });
      if (others > 0) {
        throw new Error(
          `${LOG_PREFIX} ${others} line(s) of spend_items are not OPEX; dropping the nature would make them OPEX lines. `
            + 'Move them out first (the down() of the migration that moved them in).',
        );
      }
    }
    await queryRunner.query(spendRefreshSql(false));
    for (const index of INDEXES) await queryRunner.query(`DROP INDEX IF EXISTS ${index.name}`);
    await queryRunner.query(`DROP INDEX IF EXISTS ${LEGACY_INDEX}`);
    await queryRunner.query(`ALTER TABLE spend_items DROP CONSTRAINT IF EXISTS ${NATURE_CHECK}`);
    await queryRunner.query(`ALTER TABLE spend_items DROP COLUMN IF EXISTS legacy_number`);
    await queryRunner.query(`ALTER TABLE spend_items DROP COLUMN IF EXISTS nature`);
  }
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails (1853910000000). After a failed statement the transaction is aborted and refuses the
 * restore: its rollback restores the state then, and the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
      [table],
    );
    states.push({ table, enabled: !!state?.enabled, forced: !!state?.forced });
  }
  for (const state of states) {
    if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} DISABLE ROW LEVEL SECURITY`);
  }
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.table} FORCE ROW LEVEL SECURITY`);
      }
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}

/** How `pg_trigger.tgenabled` reads back once enabled again: origin (the default), always, replica. */
const ENABLE_TRIGGER: Record<string, string> = { O: 'ENABLE TRIGGER', A: 'ENABLE ALWAYS TRIGGER', R: 'ENABLE REPLICA TRIGGER' };

/**
 * Runs `fn` with the named triggers of `table` disabled, those that exist and are enabled, then
 * enables each as found (1853880000000's `withoutTrigger`, for several); restored like
 * `withoutRowSecurity`.
 */
async function withoutTriggers<T>(queryRunner: QueryRunner, table: string, triggers: string[], fn: () => Promise<T>): Promise<T> {
  const found: Array<{ trigger: string; enable: string }> = [];
  for (const trigger of triggers) {
    const [state] = await queryRunner.query(
      `SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2 AND NOT tgisinternal`,
      [table, trigger],
    );
    const enable = state ? ENABLE_TRIGGER[String(state.enabled)] : undefined;
    if (enable) found.push({ trigger, enable });
  }
  for (const { trigger } of found) await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const { trigger, enable } of found) await queryRunner.query(`ALTER TABLE ${table} ${enable} ${trigger}`);
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
