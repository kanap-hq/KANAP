import 'dotenv/config';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Read-only verification for migration 1853660000000 (analytics axes: a
 * tenant's analytics dimensions, their values, one value per line and
 * dimension in spend_item_analytics_values / capex_item_analytics_values).
 *
 * Per tenant it checks:
 *   1. exactly one default dimension;
 *   2. every value belongs to a dimension of its own tenant;
 *   3. for OPEX and CAPEX lines, both directions of the pair between the
 *      legacy item column `analytics_category_id` and the default-dimension
 *      link: a legacy value has exactly one default-dimension link with the
 *      same value, and no default-dimension link exists without it;
 *   4. no link sits on a line of another tenant.
 * Lines whose legacy value belongs to another tenant got no link from the
 * migration: they are listed ("foreign legacy value") and not counted as a
 * mismatch. Each tenant prints its counts and `match` or `mismatch`.
 *
 * Modes:
 *   --strict (default): meant right after the migration. Exit 1 on any mismatch.
 *   --report: afterwards the legacy columns are no longer written, so the
 *     pair drifts as lines are edited; the drift is printed as information and
 *     the exit code stays 0 (checks 1, 2 and 4 still print mismatch).
 *
 * Every tenant is read in its own READ ONLY transaction with a local
 * `app.current_tenant` (FORCE RLS) and explicit tenant_id predicates.
 *
 * Usage:
 *   npx ts-node scripts/verify-analytics-axes.ts [--report]
 *   VERIFY_TENANT_SLUG=<slug> npx ts-node scripts/verify-analytics-axes.ts
 *
 * On a server, once the new image has migrated at boot. The server images run compiled
 * code only: TypeScript scripts run in the maintenance image, built from the same tree
 * (QA: .env.qa, prod: .env.prod), from /opt/kanap after `git pull`:
 *   docker build --target dev -t kanap-api-tools backend
 *   docker run --rm --env-file backend/.env.qa --network infra_default kanap-api-tools \
 *     npx ts-node scripts/verify-analytics-axes.ts
 * `infra_default` is the network of the API container (`docker network ls` lists it).
 * On-premise: the same commands with the installation's own env file and network.
 */

type Kind = { label: 'OPEX' | 'CAPEX'; items: string; links: string; prefix: string; name: string };

const KINDS: Kind[] = [
  { label: 'OPEX', items: 'spend_items', links: 'spend_item_analytics_values', prefix: 'OPX', name: 'product_name' },
  { label: 'CAPEX', items: 'capex_items', links: 'capex_item_analytics_values', prefix: 'CPX', name: 'description' },
];

type TenantRow = { id: string; slug: string };

async function resolveTenants(runner: QueryRunner): Promise<TenantRow[]> {
  const slug = String(process.env.VERIFY_TENANT_SLUG || '').trim();
  if (slug) {
    return runner.query(`SELECT id::text AS id, COALESCE(slug, '')::text AS slug FROM tenants WHERE slug = $1 ORDER BY slug`, [slug]);
  }
  return runner.query(`SELECT id::text AS id, COALESCE(slug, '')::text AS slug FROM tenants ORDER BY slug`);
}

async function migrated(runner: QueryRunner): Promise<boolean> {
  const [row] = await runner.query(`SELECT to_regclass('analytics_axes') IS NOT NULL AS present`);
  return row?.present === true;
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

/** Structural checks (1, 2): always a mismatch when they fail. */
async function inspectDimensions(runner: QueryRunner, tenantId: string): Promise<number> {
  const axes = await runner.query(
    `SELECT a.code, a.name, a.is_default, a.status::text AS status, a.sort_order,
            (SELECT count(*)::int FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = a.id) AS value_count
       FROM analytics_axes a
      WHERE a.tenant_id = $1
      ORDER BY a.sort_order, lower(coalesce(a.name, '')), a.code`,
    [tenantId],
  );
  const defaults = axes.filter((axis: any) => axis.is_default).length;
  const [orphans] = await runner.query(
    `SELECT count(*)::int AS n
       FROM analytics_categories c
      WHERE c.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM analytics_axes a WHERE a.tenant_id = c.tenant_id AND a.id = c.axis_id)`,
    [tenantId],
  );
  const [values] = await runner.query(
    `SELECT count(*)::int AS n FROM analytics_categories WHERE tenant_id = $1`,
    [tenantId],
  );
  console.log(`  dimensions=${axes.length} default=${defaults} values=${values.n} values_without_own_dimension=${orphans.n}`);
  for (const axis of axes) {
    console.log(
      `    [dimension] ${axis.code}${axis.is_default ? ' (default)' : ''} name=${axis.name == null ? '(none)' : `"${axis.name}"`}`
      + ` status=${axis.status} order=${axis.sort_order} values=${axis.value_count}`,
    );
  }
  let problems = 0;
  if (defaults !== 1) {
    console.log(`    [mismatch] ${defaults} default dimension(s), expected exactly 1`);
    problems += 1;
  }
  if (Number(orphans.n) > 0) {
    console.log(`    [mismatch] ${orphans.n} value(s) without a dimension of this tenant`);
    problems += 1;
  }
  return problems;
}

/** Pair check (3) and foreign links (4) for one item type. Returns [pair drift, structural problems]. */
async function inspectKind(runner: QueryRunner, tenantId: string, kind: Kind): Promise<[number, number]> {
  const ref = `'${kind.prefix}-' || i.item_number`;
  // One row per line holding a legacy value or a default-dimension link.
  const rows = await runner.query(
    `SELECT ${ref} AS ref, i.${kind.name} AS name,
            i.analytics_category_id AS legacy_id, lc.name AS legacy_name, (lc.id IS NULL) AS legacy_foreign,
            l.category_id AS link_id, kc.name AS link_name
       FROM ${kind.items} i
       LEFT JOIN analytics_categories lc ON lc.id = i.analytics_category_id AND lc.tenant_id = i.tenant_id
       LEFT JOIN (${kind.links} l
                  JOIN analytics_axes a ON a.id = l.axis_id AND a.tenant_id = l.tenant_id AND a.is_default)
         ON l.item_id = i.id AND l.tenant_id = i.tenant_id
       LEFT JOIN analytics_categories kc ON kc.id = l.category_id AND kc.tenant_id = l.tenant_id
      WHERE i.tenant_id = $1 AND (i.analytics_category_id IS NOT NULL OR l.category_id IS NOT NULL)
      ORDER BY i.item_number`,
    [tenantId],
  );
  const [lines] = await runner.query(`SELECT count(*)::int AS n FROM ${kind.items} WHERE tenant_id = $1`, [tenantId]);
  const [links] = await runner.query(
    `SELECT count(*)::int AS all_links,
            count(*) FILTER (WHERE a.is_default)::int AS default_links
       FROM ${kind.links} l
       JOIN analytics_axes a ON a.id = l.axis_id AND a.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1`,
    [tenantId],
  );
  const [foreignLinks] = await runner.query(
    `SELECT count(*)::int AS n
       FROM ${kind.links} l
      WHERE l.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM ${kind.items} i WHERE i.id = l.item_id AND i.tenant_id = l.tenant_id)`,
    [tenantId],
  );

  let pairs = 0;
  const drift: string[] = [];
  const foreign: string[] = [];
  for (const row of rows) {
    if (row.legacy_id && row.legacy_foreign) {
      foreign.push(`    [foreign legacy value] ${row.ref} "${row.name}": analytics_category_id ${row.legacy_id} belongs to another tenant; no link${row.link_id ? `, but the line now holds "${row.link_name}"` : ''}`);
      continue;
    }
    if (row.legacy_id && row.link_id && row.legacy_id === row.link_id) {
      pairs += 1;
      continue;
    }
    if (row.legacy_id && !row.link_id) drift.push(`    [legacy only] ${row.ref} "${row.name}": legacy "${row.legacy_name}", no default-dimension link`);
    else if (!row.legacy_id && row.link_id) drift.push(`    [link only] ${row.ref} "${row.name}": default-dimension link "${row.link_name}", no legacy value`);
    else drift.push(`    [different] ${row.ref} "${row.name}": legacy "${row.legacy_name}", default-dimension link "${row.link_name}"`);
  }
  console.log(
    `  ${kind.label}: lines=${lines.n} links=${links.all_links} default_links=${links.default_links}`
    + ` matching_pairs=${pairs} drift=${drift.length} foreign_legacy_values=${foreign.length} links_on_other_tenant_lines=${foreignLinks.n}`,
  );
  for (const line of [...drift, ...foreign]) console.log(line);
  if (Number(foreignLinks.n) > 0) console.log(`    [mismatch] ${foreignLinks.n} link(s) on lines of another tenant`);
  return [drift.length, Number(foreignLinks.n) > 0 ? 1 : 0];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const reportMode = process.argv.includes('--report');

  const ds = new DataSource({ type: 'postgres', url: databaseUrl, ssl: false } as any);
  await ds.initialize();
  const runner = ds.createQueryRunner();
  await runner.connect();
  let failed = false;
  try {
    if (!(await migrated(runner))) {
      console.log('verify-analytics-axes: migration 1853660000000 has not run on this database (no analytics_axes table).');
      failed = true;
      return;
    }
    const tenants = await resolveTenants(runner);
    console.log(`verify-analytics-axes: ${tenants.length} tenant(s), mode=${reportMode ? 'report' : 'strict'}, now=${new Date().toISOString()}`);
    let mismatches = 0;
    let driftTotal = 0;
    for (const tenant of tenants) {
      console.log(`\nTenant ${tenant.slug || '(no slug)'} (${tenant.id})`);
      const [structural, drift] = await inTenant(runner, tenant.id, async () => {
        let structuralProblems = await inspectDimensions(runner, tenant.id);
        let tenantDrift = 0;
        for (const kind of KINDS) {
          const [kindDrift, kindProblems] = await inspectKind(runner, tenant.id, kind);
          tenantDrift += kindDrift;
          structuralProblems += kindProblems;
        }
        return [structuralProblems, tenantDrift];
      });
      const tenantMismatch = structural > 0 || (!reportMode && drift > 0);
      console.log(`  -> ${tenantMismatch ? 'mismatch' : 'match'}${reportMode && drift > 0 ? ` (drift since the migration: ${drift} line(s), information only)` : ''}`);
      if (tenantMismatch) mismatches += 1;
      driftTotal += drift;
    }
    console.log(`\nTotals: tenants=${tenants.length} mismatch=${mismatches} pair_drift=${driftTotal}`);
    failed = mismatches > 0;
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
