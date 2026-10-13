import 'dotenv/config';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Read-only verification for migration 1853720000000 (budget totals per
 * version, kept by triggers in spend_version_totals, the versions of the OPEX
 * and CAPEX lines alike since lot Z1; the dormant capex_* tables are not read).
 *
 * Per tenant and line nature it recomputes, from the amounts, the sums of the
 * five columns of each version over the months of its own budget year (NULL
 * as 0), as the list engine aggregated them, and compares them with the
 * stored rows, both ways. The invariant: a version with months in its year
 * has a row holding their sums; a version without such a month has no row or
 * a row of zeros (the triggers never delete a row: its months were deleted
 * after the row was created). Reported:
 *   - missing: the version has months in its year and no totals row;
 *   - different: a stored sum differs from the recomputed one (numerically),
 *     zero for a version without any month in its year;
 * and, for information, `zero_rows`: the all-zero rows of versions without
 * months, which match. It also checks that the triggers exist and fire on the
 * app's writes (enabled in origin mode, `tgenabled` O or A: D is disabled, R
 * fires in replica sessions only): insert, update, delete and truncate on
 * each amounts table, and the budget year guard on each versions table. Each
 * tenant prints its counts and `match` or `mismatch` with the first
 * mismatches (line reference, year, column, stored and expected).
 *
 * Every tenant is read in its own READ ONLY transaction with a local
 * `app.current_tenant` (FORCE RLS) and explicit tenant_id predicates. The
 * comparison reads one snapshot, so writes running meanwhile cannot show as
 * mismatches. Exit 1 on any mismatch, on a missing or disabled trigger, when
 * the migration has not run, and on any error.
 *
 * A mismatch is repaired by recomputing the tenant's totals (the same function
 * the migration and the tenant import use), in a transaction with the tenant
 * set. Its `scope` column predates lot Z1: 'OPEX' is the spend_* family, the
 * lines of both natures; 'CAPEX' the dormant capex_* tables (lot Z2 drops them). The rebuild takes a SHARE lock on both amounts tables: it waits for
 * the budget writes already running, and every budget write that comes after
 * waits behind it. Bound that wait with a lock_timeout, and retry when it
 * expires.
 *   BEGIN;
 *   SET LOCAL lock_timeout = '5s';
 *   SELECT set_config('app.current_tenant', '<tenant id>', true);
 *   SELECT * FROM budget_version_totals_rebuild('<tenant id>');
 *   COMMIT;
 *
 * Usage:
 *   npx ts-node scripts/verify-version-totals.ts
 *   VERIFY_TENANT_SLUG=<slug> npx ts-node scripts/verify-version-totals.ts
 *
 * On a server, once the new image has migrated at boot. The server images run compiled
 * code only: TypeScript scripts run in the maintenance image, built from the same tree
 * (QA: .env.qa, prod: .env.prod), from /opt/kanap after `git pull`:
 *   docker build --target dev -t kanap-api-tools backend
 *   docker run --rm --env-file backend/.env.qa --network infra_default kanap-api-tools \
 *     npx ts-node scripts/verify-version-totals.ts
 * `infra_default` is the network of the API container (`docker network ls` lists it).
 * On-premise: the same commands with the installation's own env file and network.
 */

const MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

type Kind = {
  label: 'OPEX' | 'CAPEX';
  nature: 'opex' | 'capex';
  items: string;
  versions: string;
  itemFk: string;
  amounts: string;
  totals: string;
  prefix: string;
  /** The number of a line as its nature shows it: an OPEX line's own, a CAPEX line's CPX number. */
  number: string;
};

// One family of tables, both natures (lot Z1): each kind reads the versions of the lines of its nature.
const KINDS: Kind[] = [
  {
    label: 'OPEX', nature: 'opex', items: 'spend_items', versions: 'spend_versions', itemFk: 'spend_item_id',
    amounts: 'spend_amounts', totals: 'spend_version_totals', prefix: 'OPX', number: 'i.item_number',
  },
  {
    label: 'CAPEX', nature: 'capex', items: 'spend_items', versions: 'spend_versions', itemFk: 'spend_item_id',
    amounts: 'spend_amounts', totals: 'spend_version_totals', prefix: 'CPX',
    number: `COALESCE((substring(i.legacy_number FROM '^CPX-([0-9]+)$'))::int, i.item_number)`,
  },
];

/** ` JOIN` the version `v`'s line, of the kind's nature. */
const lineOf = (kind: Kind, v: string) => `JOIN ${kind.items} li ON li.tenant_id = ${v}.tenant_id AND li.id = ${v}.${kind.itemFk} AND li.nature = '${kind.nature}'`;

const SHOWN_PER_KIND = 20;

/** `tgenabled` of a trigger that fires on the app's writes: O (origin and local sessions) or A (always). */
const FIRING = new Set(['O', 'A']);

type TenantRow = { id: string; slug: string };

type MismatchRow = {
  ref: string | null;
  version_id: string;
  budget_year: number | null;
  months: number | null;
  missing: boolean;
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
    `SELECT to_regclass('spend_version_totals') IS NOT NULL AS present`,
  );
  return row?.present === true;
}

/** The triggers the totals rely on that are missing or do not fire on the app's writes (`tgenabled` D or R). */
async function inspectTriggers(runner: QueryRunner): Promise<string[]> {
  const expected = [
    ...['insert', 'update', 'delete', 'truncate'].map((event) => ({ table: 'spend_amounts', name: `spend_amounts_version_totals_${event}` })),
    { table: 'spend_versions', name: 'spend_versions_budget_year_guard' },
  ];
  const problems: string[] = [];
  for (const { table, name } of expected) {
    const [row] = await runner.query(
      `SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2`,
      [table, name],
    );
    if (!row) problems.push(`trigger ${name} on ${table} is missing`);
    else if (row.enabled === 'D') problems.push(`trigger ${name} on ${table} is disabled`);
    else if (!FIRING.has(row.enabled)) problems.push(`trigger ${name} on ${table} fires in replica sessions only (tgenabled ${row.enabled})`);
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
  // A version without months in its year expects zeros: its row, if any, must hold zeros.
  const expectedOrZero = `(${MEASURES.map((m) => `coalesce(e.${m}, 0)`).join(', ')})`;
  const storedValues = `(${MEASURES.map((m) => `s.${m}`).join(', ')})`;
  const rows: MismatchRow[] = await runner.query(
    `WITH expected AS (
       SELECT a.version_id, count(*)::int AS months, ${sums}
         FROM ${kind.amounts} a
         JOIN ${kind.versions} v ON v.id = a.version_id AND v.tenant_id = a.tenant_id
         ${lineOf(kind, 'v')}
        WHERE a.tenant_id = $1
          AND EXTRACT(YEAR FROM a.period) = v.budget_year
        GROUP BY a.version_id
     ),
     stored AS (
       SELECT t.version_id, ${MEASURES.map((m) => `t.${m}`).join(', ')}
         FROM ${kind.totals} t
         JOIN ${kind.versions} v ON v.id = t.version_id AND v.tenant_id = t.tenant_id
         ${lineOf(kind, 'v')}
        WHERE t.tenant_id = $1
     )
     SELECT '${kind.prefix}-' || ${kind.number} AS ref,
            coalesce(e.version_id, s.version_id) AS version_id, v.budget_year,
            coalesce(e.months, 0) AS months, (s.version_id IS NULL) AS missing,
            ${MEASURES.map((m) => `coalesce(e.${m}, 0)::text AS expected_${m}, s.${m}::text AS stored_${m}`).join(', ')}
       FROM expected e
       FULL JOIN stored s ON s.version_id = e.version_id
       LEFT JOIN ${kind.versions} v ON v.tenant_id = $1 AND v.id = coalesce(e.version_id, s.version_id)
       LEFT JOIN ${kind.items} i ON i.tenant_id = $1 AND i.id = v.${kind.itemFk}
      WHERE s.version_id IS NULL OR ${expectedOrZero} IS DISTINCT FROM ${storedValues}
      ORDER BY ${kind.number} NULLS LAST, v.budget_year, 2`,
    [tenantId],
  );
  const [counts] = await runner.query(
    `SELECT (SELECT count(*)::int FROM ${kind.versions} v ${lineOf(kind, 'v')} WHERE v.tenant_id = $1) AS versions,
            (SELECT count(*)::int FROM ${kind.amounts} a JOIN ${kind.versions} v ON v.id = a.version_id AND v.tenant_id = a.tenant_id ${lineOf(kind, 'v')} WHERE a.tenant_id = $1) AS months,
            (SELECT count(*)::int FROM ${kind.totals} t JOIN ${kind.versions} v ON v.id = t.version_id AND v.tenant_id = t.tenant_id ${lineOf(kind, 'v')} WHERE t.tenant_id = $1) AS totals,
            (SELECT count(*)::int FROM ${kind.totals} t
              JOIN ${kind.versions} tv ON tv.id = t.version_id AND tv.tenant_id = t.tenant_id ${lineOf(kind, 'tv')}
              WHERE t.tenant_id = $1 AND (${MEASURES.map((m) => `t.${m}`).join(', ')}) = (${MEASURES.map(() => '0').join(', ')})
                AND NOT EXISTS (
                  SELECT 1 FROM ${kind.amounts} a JOIN ${kind.versions} v ON v.id = a.version_id AND v.tenant_id = a.tenant_id
                   WHERE a.tenant_id = $1 AND a.version_id = t.version_id AND EXTRACT(YEAR FROM a.period) = v.budget_year
                )) AS zero_rows`,
    [tenantId],
  );
  const missing = rows.filter((row) => row.missing).length;
  const different = rows.length - missing;
  console.log(
    `  ${kind.label}: versions=${counts.versions} months=${counts.months} totals_rows=${counts.totals}`
    + ` zero_rows=${counts.zero_rows} missing=${missing} different=${different}`,
  );
  for (const row of rows.slice(0, SHOWN_PER_KIND)) {
    const where = `${row.ref ?? `version ${row.version_id}`} ${row.budget_year ?? '(no version)'}`;
    if (row.missing) {
      console.log(`    [missing] ${where}: ${row.months} month(s), no totals row`);
    } else {
      const columns = MEASURES
        .filter((m) => row[`expected_${m}`] !== row[`stored_${m}`] && Number(row[`expected_${m}`]) !== Number(row[`stored_${m}`]))
        .map((m) => `${m} stored ${row[`stored_${m}`]}, expected ${row[`expected_${m}`]}`);
      console.log(`    [different] ${where} (${row.months} month(s) in its year): ${columns.join('; ')}`);
    }
  }
  if (rows.length > SHOWN_PER_KIND) console.log(`    … ${rows.length - SHOWN_PER_KIND} more`);
  return rows.length;
}

/** True when every tenant matches and every trigger fires; false on any mismatch or when the migration has not run. */
async function main(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const ds = new DataSource({ type: 'postgres', url: databaseUrl, ssl: false } as any);
  await ds.initialize();
  const runner = ds.createQueryRunner();
  await runner.connect();
  try {
    if (!(await migrated(runner))) {
      console.log('verify-version-totals: migration 1853720000000 has not run on this database (no totals tables).');
      return false;
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
    return mismatches === 0 && triggerProblems.length === 0;
  } finally {
    await runner.release();
    await ds.destroy();
  }
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
