import 'dotenv/config';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Read-only verification for migration 1853720000000 (budget totals per
 * version, kept by triggers in spend_version_totals / capex_version_totals).
 *
 * Per tenant and item type it recomputes, from the amounts, the sums of the
 * five columns of each version over the months of its own budget year (NULL
 * as 0), as the list engine aggregated them, and compares them with the
 * stored rows, both ways:
 *   - missing: the version has months in its year and no totals row;
 *   - extra: a totals row for a version without any month in its year;
 *   - different: a stored sum differs from the recomputed one (numerically).
 * It also checks that the three triggers of each amounts table exist and are
 * enabled. Each tenant prints its counts and `match` or `mismatch` with the
 * first mismatches (line reference, year, column, stored and expected).
 *
 * Every tenant is read in its own READ ONLY transaction with a local
 * `app.current_tenant` (FORCE RLS) and explicit tenant_id predicates. The
 * comparison reads one snapshot, so writes running meanwhile cannot show as
 * mismatches. Exit 1 on any mismatch.
 *
 * A mismatch is repaired by recomputing the tenant's totals (the same function
 * the migration and the tenant import use), in a transaction with the tenant set:
 *   SELECT set_config('app.current_tenant', '<tenant id>', true);
 *   SELECT * FROM budget_version_totals_rebuild('<tenant id>');
 *
 * Usage:
 *   npx ts-node scripts/verify-version-totals.ts
 *   VERIFY_TENANT_SLUG=<slug> npx ts-node scripts/verify-version-totals.ts
 *
 * On a server (QA: .env.qa / compose.qa.yml, prod: .env.prod / compose.prod.yml),
 * once the new image has migrated at boot:
 *   docker compose --env-file backend/.env.qa -f infra/compose.qa.yml exec api npx ts-node scripts/verify-version-totals.ts
 * On-premise: the same command with the installation's own compose file.
 */

const MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

type Kind = { label: 'OPEX' | 'CAPEX'; items: string; versions: string; itemFk: string; amounts: string; totals: string; prefix: string };

const KINDS: Kind[] = [
  { label: 'OPEX', items: 'spend_items', versions: 'spend_versions', itemFk: 'spend_item_id', amounts: 'spend_amounts', totals: 'spend_version_totals', prefix: 'OPX' },
  { label: 'CAPEX', items: 'capex_items', versions: 'capex_versions', itemFk: 'capex_item_id', amounts: 'capex_amounts', totals: 'capex_version_totals', prefix: 'CPX' },
];

const SHOWN_PER_KIND = 20;

type TenantRow = { id: string; slug: string };

type MismatchRow = {
  ref: string | null;
  version_id: string;
  budget_year: number | null;
  months: number | null;
  missing: boolean;
  extra: boolean;
} & Record<string, string | number | boolean | null>;

async function resolveTenants(runner: QueryRunner): Promise<TenantRow[]> {
  const slug = String(process.env.VERIFY_TENANT_SLUG || '').trim();
  if (slug) {
    return runner.query(`SELECT id::text AS id, COALESCE(slug, '')::text AS slug FROM tenants WHERE slug = $1 ORDER BY slug`, [slug]);
  }
  return runner.query(`SELECT id::text AS id, COALESCE(slug, '')::text AS slug FROM tenants ORDER BY slug`);
}

async function migrated(runner: QueryRunner): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT to_regclass('spend_version_totals') IS NOT NULL AND to_regclass('capex_version_totals') IS NOT NULL AS present`,
  );
  return row?.present === true;
}

/** Triggers of the amounts tables that are missing or disabled (`tgenabled = 'D'`). */
async function inspectTriggers(runner: QueryRunner): Promise<string[]> {
  const problems: string[] = [];
  for (const kind of KINDS) {
    for (const event of ['insert', 'update', 'delete']) {
      const name = `${kind.amounts}_version_totals_${event}`;
      const [row] = await runner.query(
        `SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2`,
        [kind.amounts, name],
      );
      if (!row) problems.push(`trigger ${name} is missing`);
      else if (row.enabled === 'D') problems.push(`trigger ${name} is disabled`);
    }
  }
  return problems;
}

async function inTenant<T>(runner: QueryRunner, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await runner.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return await fn();
  } finally {
    await runner.query('ROLLBACK');
  }
}

/** One item type of one tenant: counts and mismatches. Returns the number of mismatches. */
async function inspectKind(runner: QueryRunner, tenantId: string, kind: Kind): Promise<number> {
  const sums = MEASURES.map((m) => `sum(coalesce(a.${m}, 0)) AS ${m}`).join(', ');
  const compared = (alias: string) => `(${MEASURES.map((m) => `${alias}.${m}`).join(', ')})`;
  const rows: MismatchRow[] = await runner.query(
    `WITH expected AS (
       SELECT a.version_id, count(*)::int AS months, ${sums}
         FROM ${kind.amounts} a
         JOIN ${kind.versions} v ON v.id = a.version_id AND v.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1
          AND a.period >= make_date(v.budget_year, 1, 1) AND a.period < make_date(v.budget_year + 1, 1, 1)
        GROUP BY a.version_id
     ),
     stored AS (
       SELECT t.version_id, ${MEASURES.map((m) => `t.${m}`).join(', ')}
         FROM ${kind.totals} t
        WHERE t.tenant_id = $1
     )
     SELECT '${kind.prefix}-' || i.item_number AS ref,
            coalesce(e.version_id, s.version_id) AS version_id, v.budget_year,
            e.months, (s.version_id IS NULL) AS missing, (e.version_id IS NULL) AS extra,
            ${MEASURES.map((m) => `e.${m}::text AS expected_${m}, s.${m}::text AS stored_${m}`).join(', ')}
       FROM expected e
       FULL JOIN stored s ON s.version_id = e.version_id
       LEFT JOIN ${kind.versions} v ON v.tenant_id = $1 AND v.id = coalesce(e.version_id, s.version_id)
       LEFT JOIN ${kind.items} i ON i.tenant_id = $1 AND i.id = v.${kind.itemFk}
      WHERE e.version_id IS NULL OR s.version_id IS NULL OR ${compared('e')} IS DISTINCT FROM ${compared('s')}
      ORDER BY i.item_number NULLS LAST, v.budget_year, 2`,
    [tenantId],
  );
  const [counts] = await runner.query(
    `SELECT (SELECT count(*)::int FROM ${kind.versions} WHERE tenant_id = $1) AS versions,
            (SELECT count(*)::int FROM ${kind.amounts} WHERE tenant_id = $1) AS months,
            (SELECT count(*)::int FROM ${kind.totals} WHERE tenant_id = $1) AS totals`,
    [tenantId],
  );
  const missing = rows.filter((row) => row.missing).length;
  const extra = rows.filter((row) => row.extra).length;
  const different = rows.length - missing - extra;
  console.log(
    `  ${kind.label}: versions=${counts.versions} months=${counts.months} totals_rows=${counts.totals}`
    + ` missing=${missing} extra=${extra} different=${different}`,
  );
  for (const row of rows.slice(0, SHOWN_PER_KIND)) {
    const where = `${row.ref ?? `version ${row.version_id}`} ${row.budget_year ?? '(no version)'}`;
    if (row.missing) {
      console.log(`    [missing] ${where}: ${row.months} month(s), no totals row`);
    } else if (row.extra) {
      console.log(`    [extra] ${where}: totals row without any month in the version's year`);
    } else {
      const columns = MEASURES
        .filter((m) => row[`expected_${m}`] !== row[`stored_${m}`] && Number(row[`expected_${m}`]) !== Number(row[`stored_${m}`]))
        .map((m) => `${m} stored ${row[`stored_${m}`]}, expected ${row[`expected_${m}`]}`);
      console.log(`    [different] ${where}: ${columns.join('; ')}`);
    }
  }
  if (rows.length > SHOWN_PER_KIND) console.log(`    … ${rows.length - SHOWN_PER_KIND} more`);
  return rows.length;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const ds = new DataSource({ type: 'postgres', url: databaseUrl, ssl: false } as any);
  await ds.initialize();
  const runner = ds.createQueryRunner();
  await runner.connect();
  let failed = false;
  try {
    if (!(await migrated(runner))) {
      console.log('verify-version-totals: migration 1853720000000 has not run on this database (no totals tables).');
      failed = true;
      return;
    }
    const tenants = await resolveTenants(runner);
    console.log(`verify-version-totals: ${tenants.length} tenant(s), now=${new Date().toISOString()}`);
    const triggerProblems = await inspectTriggers(runner);
    for (const problem of triggerProblems) console.log(`  [mismatch] ${problem}`);
    let mismatches = 0;
    for (const tenant of tenants) {
      console.log(`\nTenant ${tenant.slug || '(no slug)'} (${tenant.id})`);
      const problems = await inTenant(runner, tenant.id, async () => {
        let count = 0;
        for (const kind of KINDS) count += await inspectKind(runner, tenant.id, kind);
        return count;
      });
      console.log(`  -> ${problems > 0 ? 'mismatch' : 'match'}`);
      if (problems > 0) mismatches += 1;
    }
    console.log(`\nTotals: tenants=${tenants.length} mismatch=${mismatches} triggers=${triggerProblems.length ? 'mismatch' : 'match'}`);
    failed = mismatches > 0 || triggerProblems.length > 0;
  } finally {
    await runner.release();
    await ds.destroy();
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
