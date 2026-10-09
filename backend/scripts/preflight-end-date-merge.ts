import 'dotenv/config';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Read-only preflight for migration 1853620000000 (one end date per budget
 * item: `effective_end` merges into `disabled_at`, at 12:00 UTC of that day).
 *
 * Per tenant, for OPEX and CAPEX items, it lists:
 *   1. conflicts: both dates set on different days (`disabled_at` wins, the
 *      effective end is dropped); both set on the same UTC day are counted
 *      apart as "same day, kept";
 *   2. items the merge disables: their effective end is past and their stored
 *      status is `enabled` today;
 *   3. items whose past `disabled_at` still carries status `enabled` (the
 *      migration's status reconciliation flips them too);
 *   4. items the merge gives an end of validity while they hold amounts in a
 *      later budget year, which the summary views then stop counting;
 *   5. every item the merge gives an end of validity (no `disabled_at` yet),
 *      past and future, with the new date. OPEX items ending within 30 days
 *      are flagged: their owners get an expiry warning.
 * The rows the migration changes are exactly sections 5 + 3 (section 2 is
 * part of 5); the totals line checks that against the migration's own
 * WHERE clauses.
 *
 * Once migrated (`legacy_effective_end` exists), sections 1-5 are replaced by
 * the rows `down()` would not revert: `disabled_at` no longer the merged
 * value of `legacy_effective_end` (edited since, or a conflict kept).
 *
 * `--totals` prints, per tenant, item type and budget year, the amount totals
 * the summary views count (items without an end of validity, or whose UTC
 * year is at least the budget year). Run it before and after the migration
 * and diff the outputs.
 *
 * Every tenant is read in its own READ ONLY transaction with a local
 * `app.current_tenant` (FORCE RLS) and explicit tenant_id predicates.
 *
 * Usage:
 *   npm run preflight:end-date-merge [-- --totals]
 *   PREFLIGHT_TENANT_SLUG=<slug> npm run preflight:end-date-merge
 *
 * On a server (QA: .env.qa / compose.qa.yml, prod: .env.prod / compose.prod.yml),
 * in this order, from /opt/kanap after `git pull`. The server images run compiled code only:
 * the TypeScript script runs in the maintenance image, built from the same tree.
 *   1. docker compose --env-file backend/.env.qa -f infra/compose.qa.yml build api web
 *      docker build --target dev -t kanap-api-tools backend
 *   2. docker run --rm --env-file backend/.env.qa --network infra_default kanap-api-tools \
 *        npx ts-node scripts/preflight-end-date-merge.ts
 *      The same command with `--totals` at the end prints the totals.
 *      The maintenance image reads the database without migrating it.
 *      `infra_default` is the network of the API container (`docker network ls` lists it).
 *   3. Review the report; resolve conflicts by hand or accept them.
 *   4. docker compose --env-file backend/.env.qa -f infra/compose.qa.yml up -d api web
 *      (the new container migrates at boot).
 *   5. Run the command of step 2 with `--totals` again and diff with the totals of step 2.
 * On-premise: the same order with the installation's own env file, compose file and network.
 */

type Kind = { label: 'OPEX' | 'CAPEX'; items: string; versions: string; amounts: string; itemFk: string; prefix: string; name: string };

const KINDS: Kind[] = [
  { label: 'OPEX', items: 'spend_items', versions: 'spend_versions', amounts: 'spend_amounts', itemFk: 'spend_item_id', prefix: 'OPX', name: 'product_name' },
  { label: 'CAPEX', items: 'capex_items', versions: 'capex_versions', amounts: 'capex_amounts', itemFk: 'capex_item_id', prefix: 'CPX', name: 'description' },
];

const MEASURES = ['planned', 'forecast', 'committed', 'actual', 'expected_landing'] as const;
const MEASURE_LABELS: Record<(typeof MEASURES)[number], string> = {
  planned: 'budget',
  forecast: 'forecast',
  committed: 'revision',
  actual: 'actual',
  expected_landing: 'landing',
};

type TenantRow = { id: string; slug: string };
type Totals = {
  conflicts: number;
  sameDay: number;
  newlyDisabled: number;
  staleStatus: number;
  maskedItems: number;
  endPast: number;
  endFuture: number;
  expiryWarnings: number;
  migrationRows: number;
};

const MERGED = (col: string) => `((${col} + time '12:00') AT TIME ZONE 'UTC')`;

function iso(value: unknown): string {
  if (value == null) return '-';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function ymd(value: unknown): string {
  if (value == null) return '-';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function money(value: unknown): string {
  const n = Number(value ?? 0);
  return n.toFixed(2);
}

async function resolveTenants(runner: QueryRunner): Promise<TenantRow[]> {
  const slug = String(process.env.PREFLIGHT_TENANT_SLUG || '').trim();
  if (slug) {
    return runner.query(`SELECT id::text AS id, COALESCE(slug, '')::text AS slug FROM tenants WHERE slug = $1 ORDER BY slug`, [slug]);
  }
  return runner.query(`SELECT id::text AS id, COALESCE(slug, '')::text AS slug FROM tenants ORDER BY slug`);
}

async function alreadyMigrated(runner: QueryRunner): Promise<boolean> {
  const rows = await runner.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name IN ('spend_items', 'capex_items') AND column_name = 'legacy_effective_end'`,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function inTenant<T>(runner: QueryRunner, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await runner.query('BEGIN READ ONLY');
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return await fn();
  } finally {
    await runner.query('ROLLBACK');
  }
}

async function inspectKind(runner: QueryRunner, tenantId: string, kind: Kind, totals: Totals) {
  const ref = `'${kind.prefix}-' || i.item_number`;

  // Both dates set: on the same UTC day they agree (a date set in the app is
  // the end of the local day), only a different day is a conflict.
  const bothSet = await runner.query(
    `SELECT ${ref} AS ref, i.${kind.name} AS name, i.effective_end, i.disabled_at,
            (i.disabled_at AT TIME ZONE 'UTC')::date = i.effective_end AS same_day
     FROM ${kind.items} i
     WHERE i.tenant_id = $1 AND i.effective_end IS NOT NULL AND i.disabled_at IS NOT NULL
     ORDER BY i.item_number`,
    [tenantId],
  );
  const conflicts = bothSet.filter((r: any) => !r.same_day);
  const sameDay = bothSet.filter((r: any) => r.same_day);
  // Every row step 2 of the migration dates, with its new end of validity.
  const getsEnd = await runner.query(
    `SELECT ${ref} AS ref, i.${kind.name} AS name, i.effective_end, i.status::text AS status,
            ${MERGED('i.effective_end')} AS new_end,
            ${MERGED('i.effective_end')} <= now() AS past,
            ${MERGED('i.effective_end')} <= now() + interval '30 days' AS within_30_days,
            ${kind.label === 'OPEX' ? '(i.owner_it_id IS NOT NULL OR i.owner_business_id IS NOT NULL)' : 'false'} AS has_owner
     FROM ${kind.items} i
     WHERE i.tenant_id = $1 AND i.disabled_at IS NULL AND i.effective_end IS NOT NULL
     ORDER BY i.item_number`,
    [tenantId],
  );
  const newlyDisabled = getsEnd.filter((r: any) => r.past && r.status === 'enabled');
  const staleStatus = await runner.query(
    `SELECT ${ref} AS ref, i.${kind.name} AS name, i.disabled_at
     FROM ${kind.items} i
     WHERE i.tenant_id = $1 AND i.disabled_at IS NOT NULL AND i.disabled_at <= now() AND i.status = 'enabled'
     ORDER BY i.item_number`,
    [tenantId],
  );
  // One query for every masked (item, year): amounts inside each version's own budget year,
  // the way the summary views aggregate them.
  const masked = await runner.query(
    `SELECT ${ref} AS ref, i.item_number, i.${kind.name} AS name, i.effective_end, v.budget_year,
            ${MEASURES.map((m) => `COALESCE(SUM(a.${m}), 0) AS ${m}`).join(', ')}
     FROM ${kind.items} i
     JOIN ${kind.versions} v ON v.${kind.itemFk} = i.id AND v.tenant_id = i.tenant_id
     JOIN ${kind.amounts} a ON a.version_id = v.id AND a.tenant_id = v.tenant_id
       AND EXTRACT(YEAR FROM a.period) = v.budget_year
     WHERE i.tenant_id = $1 AND i.disabled_at IS NULL AND i.effective_end IS NOT NULL
       AND v.budget_year > EXTRACT(YEAR FROM i.effective_end)
     GROUP BY i.id, i.item_number, i.${kind.name}, i.effective_end, v.budget_year
     HAVING ${MEASURES.map((m) => `COALESCE(SUM(a.${m}), 0) <> 0`).join(' OR ')}
     ORDER BY i.item_number, v.budget_year`,
    [tenantId],
  );
  const maskedItems = new Set(masked.map((r: any) => r.ref));
  // What up() changes, counted from its own WHERE clauses: rows it dates, and
  // rows whose status it flips (dated now or already past).
  const [changed] = await runner.query(
    `SELECT count(*)::int AS n
     FROM ${kind.items} i
     WHERE i.tenant_id = $1
       AND ((i.disabled_at IS NULL AND i.effective_end IS NOT NULL)
         OR (i.status <> 'disabled' AND COALESCE(i.disabled_at, ${MERGED('i.effective_end')}) <= now()))`,
    [tenantId],
  );
  const endPast = getsEnd.filter((r: any) => r.past);
  const endFuture = getsEnd.filter((r: any) => !r.past);
  const warned = kind.label === 'OPEX' ? endFuture.filter((r: any) => r.within_30_days && r.has_owner) : [];

  console.log(
    `  ${kind.label}: conflicts=${conflicts.length} same_day_kept=${sameDay.length} newly_disabled=${newlyDisabled.length}`
    + ` stale_status=${staleStatus.length} masked_items=${maskedItems.size} (masked_item_years=${masked.length})`
    + ` gets_end_of_validity=${getsEnd.length} (past=${endPast.length} future=${endFuture.length})`
    + ` rows_the_migration_changes=${changed.n}`,
  );
  for (const r of conflicts) {
    console.log(`    [conflict] ${r.ref} "${r.name}": effective_end=${ymd(r.effective_end)} disabled_at=${iso(r.disabled_at)} -> disabled_at wins`);
  }
  for (const r of sameDay) {
    console.log(`    [same day, kept] ${r.ref} "${r.name}": effective_end=${ymd(r.effective_end)} disabled_at=${iso(r.disabled_at)}`);
  }
  for (const r of newlyDisabled) {
    console.log(`    [newly disabled] ${r.ref} "${r.name}": effective_end=${ymd(r.effective_end)} status enabled -> disabled`);
  }
  for (const r of staleStatus) {
    console.log(`    [stale status] ${r.ref} "${r.name}": disabled_at=${iso(r.disabled_at)} status=enabled -> disabled`);
  }
  for (const r of masked) {
    const amounts = MEASURES.map((m) => `${MEASURE_LABELS[m]}=${money(r[m])}`).join(' ');
    console.log(`    [masked year] ${r.ref} "${r.name}": effective_end=${ymd(r.effective_end)} year ${r.budget_year}: ${amounts}`);
  }
  for (const r of getsEnd) {
    let note = r.past ? 'past' : 'future';
    if (!r.past && kind.label === 'OPEX' && r.within_30_days) {
      note += r.has_owner ? ', within 30 days: owners will get an expiry warning' : ', within 30 days (no owner, no warning)';
    }
    console.log(`    [gets end of validity] ${r.ref} "${r.name}": ${iso(r.new_end)} (${note})`);
  }

  totals.conflicts += conflicts.length;
  totals.sameDay += sameDay.length;
  totals.newlyDisabled += newlyDisabled.length;
  totals.staleStatus += staleStatus.length;
  totals.maskedItems += maskedItems.size;
  totals.endPast += endPast.length;
  totals.endFuture += endFuture.length;
  totals.expiryWarnings += warned.length;
  totals.migrationRows += Number(changed.n);
}

/** Migrated state: the rows down() leaves as they are. */
async function inspectNotReverted(runner: QueryRunner, tenantId: string, kind: Kind): Promise<number> {
  const rows = await runner.query(
    `SELECT '${kind.prefix}-' || i.item_number AS ref, i.${kind.name} AS name, i.legacy_effective_end, i.disabled_at
     FROM ${kind.items} i
     WHERE i.tenant_id = $1 AND i.legacy_effective_end IS NOT NULL
       AND i.disabled_at IS DISTINCT FROM ${MERGED('i.legacy_effective_end')}
     ORDER BY i.item_number`,
    [tenantId],
  );
  console.log(`  ${kind.label}: already migrated; not reverted by down()=${rows.length}`);
  for (const r of rows) {
    console.log(`    [not reverted] ${r.ref} "${r.name}": legacy_effective_end=${ymd(r.legacy_effective_end)} disabled_at=${iso(r.disabled_at)}`);
  }
  return rows.length;
}

async function printTotals(runner: QueryRunner, tenantId: string, kind: Kind) {
  const rows = await runner.query(
    `SELECT v.budget_year, count(DISTINCT i.id)::int AS items,
            ${MEASURES.map((m) => `COALESCE(SUM(a.${m}), 0) AS ${m}`).join(', ')}
     FROM ${kind.items} i
     JOIN ${kind.versions} v ON v.${kind.itemFk} = i.id AND v.tenant_id = i.tenant_id
     LEFT JOIN ${kind.amounts} a ON a.version_id = v.id AND a.tenant_id = v.tenant_id
       AND EXTRACT(YEAR FROM a.period) = v.budget_year
     WHERE i.tenant_id = $1
       AND (i.disabled_at IS NULL OR EXTRACT(YEAR FROM i.disabled_at AT TIME ZONE 'UTC') >= v.budget_year)
     GROUP BY v.budget_year
     ORDER BY v.budget_year`,
    [tenantId],
  );
  console.log(`  ${kind.label} totals counted by the summary views: ${rows.length} budget year(s)`);
  for (const r of rows) {
    const amounts = MEASURES.map((m) => `${MEASURE_LABELS[m]}=${money(r[m])}`).join(' ');
    console.log(`    ${r.budget_year}: items=${r.items} ${amounts}`);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const totalsMode = process.argv.includes('--totals');

  const ds = new DataSource({ type: 'postgres', url: databaseUrl, ssl: false } as any);
  await ds.initialize();
  const runner = ds.createQueryRunner();
  await runner.connect();
  try {
    const migrated = await alreadyMigrated(runner);
    const tenants = await resolveTenants(runner);
    console.log(`preflight-end-date-merge: ${tenants.length} tenant(s), mode=${totalsMode ? 'totals' : 'report'}, now=${new Date().toISOString()}`);
    if (tenants.length === 0) return;
    const totals: Totals = {
      conflicts: 0, sameDay: 0, newlyDisabled: 0, staleStatus: 0, maskedItems: 0,
      endPast: 0, endFuture: 0, expiryWarnings: 0, migrationRows: 0,
    };
    let notReverted = 0;

    for (const tenant of tenants) {
      console.log(`\nTenant ${tenant.slug || '(no slug)'} (${tenant.id})`);
      await inTenant(runner, tenant.id, async () => {
        for (const kind of KINDS) {
          if (totalsMode) await printTotals(runner, tenant.id, kind);
          else if (migrated) notReverted += await inspectNotReverted(runner, tenant.id, kind);
          else await inspectKind(runner, tenant.id, kind, totals);
        }
      });
    }

    if (!totalsMode && migrated) {
      console.log('\nTotals across tenants (OPEX + CAPEX):');
      console.log(`  not reverted by down(): ${notReverted} (the status reconciliation is not undone either)`);
    } else if (!totalsMode) {
      const sections = totals.endPast + totals.endFuture + totals.staleStatus;
      console.log('\nTotals across tenants (OPEX + CAPEX):');
      console.log(`  1. conflicts (disabled_at kept): ${totals.conflicts}; same day, kept: ${totals.sameDay}`);
      console.log(`  2. newly disabled by the merge: ${totals.newlyDisabled} (part of 5)`);
      console.log(`  3. stale status also flipped: ${totals.staleStatus}`);
      console.log(`  4. items with later years masked: ${totals.maskedItems}`);
      console.log(`  5. gets an end of validity: ${totals.endPast + totals.endFuture} (past ${totals.endPast}, future ${totals.endFuture}; OPEX expiry warnings within 30 days: ${totals.expiryWarnings})`);
      console.log(
        `  rows the migration changes (sections 5 + 3): ${sections}; counted from its WHERE clauses: ${totals.migrationRows}`
        + ` -> ${sections === totals.migrationRows ? 'match' : 'MISMATCH, do not migrate before checking'}`,
      );
    }
  } finally {
    await runner.release();
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
