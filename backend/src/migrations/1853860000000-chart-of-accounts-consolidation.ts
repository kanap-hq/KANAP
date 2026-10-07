import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] ChartOfAccountsConsolidation:';
const INDEX = 'uq_coa_tenant_consolidation';

/**
 * Tables written by the repair, the backfill and the resync: the charts, the accounts, and the
 * search index their triggers refresh.
 */
const TABLES = ['chart_of_accounts', 'accounts', 'search_index'];

type ChartRow = { tenant_id: string; slug: string | null; code: string };
type TenantCount = { tenant_id: string; slug: string | null; count: number };

/**
 * The consolidation chart (plan planning/coa-consolidation-chart.md): at most
 * one chart per tenant holds the group accounts every local account maps to.
 * Until now the tenant's global default chart played that role implicitly.
 *
 * 1. `chart_of_accounts.is_consolidation boolean NOT NULL DEFAULT false`.
 * 2. With row level security disabled on chart_of_accounts, accounts and
 *    search_index (migrations run without app.current_tenant and FORCE binds
 *    the owner, so the UPDATEs would see no row; the search triggers of charts
 *    and accounts write into search_index, whose WITH CHECK would refuse the
 *    write), restored to the state found afterwards:
 *    - repair: a tenant with several consolidation charts keeps one, its
 *      global default first, then the earliest (created_at, id). Only a
 *      database where the column existed without the index can hold this;
 *    - backfill: every tenant without a consolidation chart gets its global
 *      default chart (if it has one) as consolidation chart;
 *    - resync: the consolidation name and description of an account are now
 *      derived from the consolidation chart's account of its consolidation
 *      number. Every account mapped to an account of its tenant's
 *      consolidation chart takes that account's name and description, when
 *      they differ (typed by hand until now). Accounts whose number is absent
 *      from the consolidation chart keep theirs.
 *    The counts are logged, then each chart touched (tenant slug, chart code)
 *    and the accounts resynced per tenant.
 * 3. The partial unique index `(tenant_id) WHERE is_consolidation`.
 *
 * A second run repairs, backfills and resyncs nothing (its counts are 0).
 * down() drops the index and the column (resynced names stay).
 */
export class ChartOfAccountsConsolidation1853860000000 implements MigrationInterface {
  name = 'ChartOfAccountsConsolidation1853860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_consolidation boolean NOT NULL DEFAULT false`,
    );

    const { repaired, backfilled, resynced } = await withoutRowSecurity(queryRunner, TABLES, async () => ({
      repaired: await repair(queryRunner),
      backfilled: await backfill(queryRunner),
      resynced: await resync(queryRunner),
    }));
    const accountsResynced = resynced.reduce((sum, row) => sum + row.count, 0);
    console.log(
      `${LOG_PREFIX} ${backfilled.length} tenant(s) got their global default chart as consolidation chart, `
        + `${repaired.length} duplicate consolidation chart(s) cleared, `
        + `${accountsResynced} account(s) resynced from the consolidation chart`,
    );
    logRows('global default made the consolidation chart', backfilled);
    logRows('consolidation role cleared (duplicate)', repaired);
    for (const row of resynced) {
      console.log(`  tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): ${row.count} account(s) resynced from the consolidation chart`);
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON chart_of_accounts (tenant_id) WHERE is_consolidation`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ${INDEX}`);
    await queryRunner.query(`ALTER TABLE chart_of_accounts DROP COLUMN IF EXISTS is_consolidation`);
  }
}

/** One consolidation chart per tenant: the global default first, then the earliest. */
async function repair(queryRunner: QueryRunner): Promise<ChartRow[]> {
  return queryRunner.query(`
    WITH ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY tenant_id ORDER BY is_global_default DESC, created_at ASC, id ASC
      ) AS rn
      FROM chart_of_accounts
      WHERE is_consolidation
    ),
    cleared AS (
      UPDATE chart_of_accounts c
      SET is_consolidation = false
      FROM ranked r
      WHERE c.id = r.id AND r.rn > 1
      RETURNING c.tenant_id, c.code
    )
    SELECT cleared.tenant_id, t.slug, cleared.code
    FROM cleared
    LEFT JOIN tenants t ON t.id = cleared.tenant_id
    ORDER BY t.slug NULLS LAST, cleared.tenant_id, cleared.code
  `);
}

/** A tenant without a consolidation chart gets its global default chart, when it has one. */
async function backfill(queryRunner: QueryRunner): Promise<ChartRow[]> {
  return queryRunner.query(`
    WITH marked AS (
      UPDATE chart_of_accounts c
      SET is_consolidation = true
      WHERE c.is_global_default
        AND NOT EXISTS (
          SELECT 1 FROM chart_of_accounts o
          WHERE o.tenant_id = c.tenant_id AND o.is_consolidation
        )
      RETURNING c.tenant_id, c.code
    )
    SELECT marked.tenant_id, t.slug, marked.code
    FROM marked
    LEFT JOIN tenants t ON t.id = marked.tenant_id
    ORDER BY t.slug NULLS LAST, marked.tenant_id, marked.code
  `);
}

/**
 * The consolidation name and description of every account mapped to an account of its
 * tenant's consolidation chart become that account's, where they differ. Counted per tenant.
 */
async function resync(queryRunner: QueryRunner): Promise<TenantCount[]> {
  return queryRunner.query(`
    WITH src AS (
      SELECT ca.tenant_id, ca.account_number, ca.account_name, ca.description
      FROM accounts ca
      JOIN chart_of_accounts cc ON cc.id = ca.coa_id AND cc.tenant_id = ca.tenant_id
      WHERE cc.is_consolidation
    ),
    changed AS (
      UPDATE accounts a
      SET consolidation_account_name = src.account_name,
          consolidation_account_description = src.description,
          updated_at = now()
      FROM src
      WHERE src.tenant_id = a.tenant_id
        AND src.account_number = a.consolidation_account_number
        AND (a.consolidation_account_name IS DISTINCT FROM src.account_name
             OR a.consolidation_account_description IS DISTINCT FROM src.description)
      RETURNING a.tenant_id
    )
    SELECT changed.tenant_id, t.slug, COUNT(*)::int AS count
    FROM changed
    LEFT JOIN tenants t ON t.id = changed.tenant_id
    GROUP BY changed.tenant_id, t.slug
    ORDER BY t.slug NULLS LAST, changed.tenant_id
  `);
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was
 * found, also when `fn` fails. After a failed statement the transaction is
 * aborted and refuses the restore: its rollback restores the state then, and
 * the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
      [table],
    );
    if (!state) continue;
    states.push({ table, enabled: !!state.enabled, forced: !!state.forced });
    if (state.enabled) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
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

function logRows(what: string, rows: ChartRow[]) {
  for (const row of rows) {
    console.log(`  tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): ${row.code}, ${what}`);
  }
}
