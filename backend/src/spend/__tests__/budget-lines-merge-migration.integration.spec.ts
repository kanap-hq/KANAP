import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetLinesNature1853960000000 as NatureMigration } from '../../migrations/1853960000000-budget-lines-nature';
import { BudgetLinesMerge1853970000000 as MergeMigration } from '../../migrations/1853970000000-budget-lines-merge';

// Migrations 1853960000000 and 1853970000000 (lot Z1 of plan planning/budget-unifie.md: the CAPEX
// lines move from the capex_* tables into spend_*), against a real database, each test in a
// transaction that is rolled back. Both migrations are undone first (the CAPEX lines of the
// database go back to capex_*), then a dirty database is seeded in capex_*, as production may
// hold it. Two tenants:
// - tenant A: OPEX lines OPX-1 (legacy number kept), 2 (none yet: gets OPX-2) and 3 (deleted,
//   leaving a hole the `spend` sequence remembers: the BL numbers start after it); CAPEX line
//   CPX-7 with a child in every table (version, months, totals, column round, costed line,
//   allocations, dimension value, contact, web link, attachment, application, asset, contract,
//   project and request links, a task, its search entry), a supplier that does not exist, an
//   allocation to a company that does not exist, a web link stored under tenant B; CAPEX line
//   CPX-3, created first, with a stale stored total; rows of no line (web link, attachment,
//   contract link of a line id that never existed); a `capex` sequence below its numbers;
// - tenant B: OPX-1 and CPX-1, no sequence.
// Then: UUIDs kept, BL numbers after GREATEST(highest line number, `spend` sequence - 1) in
// (created_at, id) order, legacy numbers of both natures, values, budget_rev and row_version
// kept, sums and totals (the stale one computed again), what was left out logged and named, row
// level security and triggers as found (a table found without FORCE, a trigger found disabled),
// one search entry per line, sequences, tenant isolation, a second run that changes nothing,
// refusals before any write, and down() then up() after writes made once moved. The
// assertions read this test's own rows, never table-wide counts.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const natureMigration = new NatureMigration();
const mergeMigration = new MergeMigration();
const LOG_PREFIX = '[Migration] BudgetLinesMerge:';
const YEAR = 2026;
const MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

/** The tables whose row level security and triggers the migration lifts and puts back. */
const FAMILY_TABLES = [
  'capex_items', 'capex_versions', 'capex_amounts', 'capex_version_totals', 'capex_round_inputs', 'capex_round_input_lines',
  'capex_allocations', 'capex_item_analytics_values', 'capex_item_contacts', 'capex_links', 'capex_attachments',
  'application_capex_items', 'asset_capex_items', 'contract_capex_items', 'portfolio_project_capex', 'portfolio_request_capex',
  'spend_items', 'spend_versions', 'spend_amounts', 'spend_version_totals', 'spend_round_inputs', 'spend_round_input_lines',
  'spend_allocations', 'spend_item_analytics_values', 'spend_item_contacts', 'spend_links', 'spend_attachments',
  'application_spend_items', 'asset_spend_items', 'contract_spend_items', 'portfolio_project_opex', 'portfolio_request_opex',
  'search_index', 'item_sequences',
];

/** Each child of a line: its CAPEX table and column, its spend_* table and column, the world key of the row. */
const CHILD_LINKS = [
  { key: 'itemContact', capex: 'capex_item_contacts', spend: 'spend_item_contacts', capexColumn: 'capex_item_id', spendColumn: 'spend_item_id' },
  { key: 'link', capex: 'capex_links', spend: 'spend_links', capexColumn: 'capex_item_id', spendColumn: 'spend_item_id' },
  { key: 'attachment', capex: 'capex_attachments', spend: 'spend_attachments', capexColumn: 'capex_item_id', spendColumn: 'spend_item_id' },
  { key: 'appLink', capex: 'application_capex_items', spend: 'application_spend_items', capexColumn: 'capex_item_id', spendColumn: 'spend_item_id' },
  { key: 'assetLink', capex: 'asset_capex_items', spend: 'asset_spend_items', capexColumn: 'capex_item_id', spendColumn: 'spend_item_id' },
  { key: 'contractLink', capex: 'contract_capex_items', spend: 'contract_spend_items', capexColumn: 'capex_item_id', spendColumn: 'spend_item_id' },
  { key: 'projectLink', capex: 'portfolio_project_capex', spend: 'portfolio_project_opex', capexColumn: 'capex_id', spendColumn: 'opex_id' },
  { key: 'requestLink', capex: 'portfolio_request_capex', spend: 'portfolio_request_opex', capexColumn: 'capex_id', spendColumn: 'opex_id' },
] as const;

type World = {
  a: string; slugA: string; b: string; slugB: string;
  companyA: string; supplierA: string;
  o1: string; o2: string; ob1: string;
  c1: string; c2: string; cb1: string;
  v1: string; v2: string; vb1: string;
  round1: string; roundLine1: string;
  allocValid: string; allocOrphan: string;
  axis: string; category: string;
  itemContact: string; link: string; attachment: string;
  appLink: string; assetLink: string; contractLink: string; projectLink: string; requestLink: string;
  task: string;
  orphanLink: string; orphanAttachment: string; orphanContractLink: string; foreignLink: string;
  /** As stored in capex_* once seeded (triggers bumped them). */
  c1RowVersion: number; v1BudgetRev: number;
};

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function noTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

/** Rows read as a tenant (row level security applies), the setting cleared afterwards. */
async function readAs(runner: QueryRunner, tenantId: string, sql: string, params: unknown[] = []): Promise<any[]> {
  await asTenant(runner, tenantId);
  try {
    return await runner.query(sql, params);
  } finally {
    await noTenant(runner);
  }
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = `z1-${tag}-${id.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, slug, `Budget lines merge ${tag}`],
  );
  return { id, slug };
}

/** One row inserted as the tenant, its id returned (`id` given by the caller). */
async function insert(runner: QueryRunner, tenantId: string, table: string, values: Record<string, unknown>): Promise<string> {
  await asTenant(runner, tenantId);
  const id = (values.id as string | undefined) ?? randomUUID();
  const row = { id, tenant_id: tenantId, ...values };
  const columns = Object.keys(row);
  // Table and column names come from this file only.
  await runner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
  return id;
}

async function seedOpexLine(runner: QueryRunner, tenantId: string, itemNumber: number, legacy: string | null) {
  return insert(runner, tenantId, 'spend_items', {
    product_name: `OPEX line ${itemNumber}`, currency: 'EUR', effective_start: '2024-01-01', item_number: itemNumber,
    legacy_number: legacy, created_at: '2023-01-01T00:00:00Z', updated_at: '2023-01-01T00:00:00Z',
  });
}

async function seedCapexLine(runner: QueryRunner, tenantId: string, itemNumber: number, created: string, extra: Record<string, unknown> = {}) {
  return insert(runner, tenantId, 'capex_items', {
    description: `CAPEX line ${itemNumber}`, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium',
    currency: 'EUR', effective_start: '2024-01-01', item_number: itemNumber, created_at: created, updated_at: created, ...extra,
  });
}

async function seedCapexVersion(runner: QueryRunner, tenantId: string, lineId: string, months: Array<Partial<Record<(typeof MEASURES)[number], string>>>) {
  const versionId = await insert(runner, tenantId, 'capex_versions', {
    capex_item_id: lineId, version_name: `Budget ${YEAR}`, input_grain: 'monthly', as_of_date: `${YEAR}-01-01`, budget_year: YEAR,
    allocation_method: 'manual_pct', reporting_currency: 'EUR',
  });
  for (const [index, values] of months.entries()) {
    await insert(runner, tenantId, 'capex_amounts', { version_id: versionId, period: `${YEAR}-${String(index + 1).padStart(2, '0')}-01`, ...values });
  }
  return versionId;
}

/** Lot Z1 undone, then the dirty database before it. Migrations run without a tenant. */
async function seedBeforeMigration(runner: QueryRunner): Promise<World> {
  await captureLog(async () => {
    await mergeMigration.down(runner);
    await natureMigration.down(runner);
  });
  const { id: a, slug: slugA } = await seedTenant(runner, 'a');
  const { id: b, slug: slugB } = await seedTenant(runner, 'b');
  const companyA = await insert(runner, a, 'companies', { name: 'Z1 company', country_iso: 'FR', city: 'Lyon' });
  const supplierA = await insert(runner, a, 'suppliers', { name: 'Z1 supplier' });

  const o1 = await seedOpexLine(runner, a, 1, 'OPX-1');
  const o2 = await seedOpexLine(runner, a, 2, null);
  const o3 = await seedOpexLine(runner, a, 3, 'OPX-3');
  await asTenant(runner, a);
  await runner.query(`DELETE FROM spend_items WHERE id = $1`, [o3]);
  await runner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'spend', 4), ($1, 'capex', 5)
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = EXCLUDED.next_val`,
    [a],
  );

  // CPX-3, created first: BL-4; its stored total is stale.
  const c2 = await seedCapexLine(runner, a, 3, '2024-01-01T00:00:00Z', { supplier_id: supplierA });
  const v2 = await seedCapexVersion(runner, a, c2, [{ planned: '50.00' }, { planned: '70.00' }]);
  await asTenant(runner, a);
  await runner.query(`UPDATE capex_version_totals SET planned = 999 WHERE version_id = $1`, [v2]);

  // CPX-7: every child, a supplier and an allocation company that do not exist.
  const c1 = await seedCapexLine(runner, a, 7, '2024-06-01T00:00:00Z', {
    description: 'Servers', notes: 'Rack notes', priority: 'high', investment_type: 'capacity', ppe_type: 'software',
    supplier_id: randomUUID(), paying_company_id: companyA, legacy_effective_end: '2030-12-31', run_build: 'build',
  });
  const v1 = await seedCapexVersion(runner, a, c1, Array.from({ length: 12 }, (_, i) => ({ planned: '100.50', actual: '10.00', forecast: i === 0 ? '0.12' : null as any })));
  const round1 = await insert(runner, a, 'capex_round_inputs', {
    version_id: v1, measure: 'planned', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, method: 'computed', fte: 0,
  });
  const roundLine1 = await insert(runner, a, 'capex_round_input_lines', {
    round_input_id: round1, sort: 1, label: 'Licences', quantity_unit: 'pieces', quantity: 3, unit_price: 402,
    price_basis: 'per_piece', frequency: 'once', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-01-31`,
  });
  const allocValid = await insert(runner, a, 'capex_allocations', { version_id: v1, company_id: companyA, allocation_pct: 60 });
  const allocOrphan = await insert(runner, a, 'capex_allocations', { version_id: v1, company_id: randomUUID(), allocation_pct: 40 });
  const axis = await insert(runner, a, 'analytics_axes', { code: 'z1-axis', name: 'Z1 axis' });
  const category = await insert(runner, a, 'analytics_categories', { axis_id: axis, name: 'Z1 category' });
  await asTenant(runner, a);
  await runner.query(`INSERT INTO capex_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [a, c1, axis, category]);
  const contact = await insert(runner, a, 'contacts', { email: `z1-${a.slice(0, 8)}@example.com` });
  const itemContact = await insert(runner, a, 'capex_item_contacts', { capex_item_id: c1, contact_id: contact, role: 'technical' });
  const link = await insert(runner, a, 'capex_links', { capex_item_id: c1, description: 'Quote', url: 'https://example.com/quote' });
  const attachment = await insert(runner, a, 'capex_attachments', {
    capex_item_id: c1, original_filename: 'quote.pdf', stored_filename: 'q.pdf', mime_type: 'application/pdf', size: 12, storage_path: `files/${a}/q.pdf`,
  });
  const application = await insert(runner, a, 'applications', { name: 'Z1 application' });
  const appLink = await insert(runner, a, 'application_capex_items', { application_id: application, capex_item_id: c1 });
  const asset = await insert(runner, a, 'assets', { name: 'Z1 asset', kind: 'server', environment: 'prod' });
  const assetLink = await insert(runner, a, 'asset_capex_items', { asset_id: asset, capex_item_id: c1 });
  const contract = await insert(runner, a, 'contracts', { name: 'Z1 contract', company_id: companyA, supplier_id: supplierA, start_date: '2024-01-01' });
  const contractLink = await insert(runner, a, 'contract_capex_items', { contract_id: contract, capex_item_id: c1 });
  const project = await insert(runner, a, 'portfolio_projects', { name: 'Z1 project', item_number: 1 });
  const projectLink = await insert(runner, a, 'portfolio_project_capex', { project_id: project, capex_id: c1 });
  const request = await insert(runner, a, 'portfolio_requests', { name: 'Z1 request', item_number: 1 });
  const requestLink = await insert(runner, a, 'portfolio_request_capex', { request_id: request, capex_id: c1 });
  const task = await insert(runner, a, 'tasks', { title: 'Z1 task', item_number: 1, related_object_type: 'capex_item', related_object_id: c1 });
  // An edit after the children: the row_version moves.
  await asTenant(runner, a);
  await runner.query(`UPDATE capex_items SET notes = notes WHERE id = $1`, [c1]);

  // Rows of no line, and a row of tenant B under tenant A's line (no foreign key ever checked them).
  const ghost = randomUUID();
  const orphanLink = await insert(runner, a, 'capex_links', { capex_item_id: ghost, url: 'https://example.com/ghost' });
  const orphanAttachment = await insert(runner, a, 'capex_attachments', {
    capex_item_id: ghost, original_filename: 'ghost.pdf', stored_filename: 'g.pdf', storage_path: `files/${a}/g.pdf`,
  });
  const orphanContractLink = await insert(runner, a, 'contract_capex_items', { contract_id: contract, capex_item_id: ghost });
  const foreignLink = await insert(runner, b, 'capex_links', { capex_item_id: c1, url: 'https://example.com/foreign' });

  const ob1 = await seedOpexLine(runner, b, 1, 'OPX-1');
  const cb1 = await seedCapexLine(runner, b, 1, '2025-01-01T00:00:00Z');
  const vb1 = await seedCapexVersion(runner, b, cb1, [{ planned: '5.00' }]);

  const [stored] = await readAs(
    runner, a,
    `SELECT (SELECT row_version FROM capex_items WHERE id = $1) AS row_version, (SELECT budget_rev FROM capex_versions WHERE id = $2) AS budget_rev`,
    [c1, v1],
  );
  return {
    a, slugA, b, slugB, companyA, supplierA, o1, o2, ob1, c1, c2, cb1, v1, v2, vb1, round1, roundLine1, allocValid, allocOrphan,
    axis, category, itemContact, link, attachment, appLink, assetLink, contractLink, projectLink, requestLink, task,
    orphanLink, orphanAttachment, orphanContractLink, foreignLink,
    c1RowVersion: Number(stored.row_version), v1BudgetRev: Number(stored.budget_rev),
  };
}

async function rowSecurity(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ name: string; enabled: boolean; forced: boolean }> = await runner.query(
    `SELECT relname AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = ANY (SELECT to_regclass(x)::oid FROM unnest($1::text[]) x)`,
    [FAMILY_TABLES],
  );
  return Object.fromEntries(rows.map((row) => [row.name, `${row.enabled}/${row.forced}`]));
}

async function triggerStates(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ name: string; enabled: string }> = await runner.query(
    `SELECT c.relname || '.' || t.tgname AS name, t.tgenabled::text AS enabled
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.oid = ANY (SELECT to_regclass(x)::oid FROM unnest($1::text[]) x)`,
    [FAMILY_TABLES],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.enabled]));
}

async function lineOf(runner: QueryRunner, tenantId: string, id: string) {
  const [row] = await readAs(
    runner, tenantId,
    `SELECT nature, item_number, legacy_number, product_name, description, notes, supplier_id, paying_company_id, ppe_type::text,
            investment_type::text, priority::text, run_build::text, legacy_effective_end::text, contract_id, row_version,
            created_at, updated_at
       FROM spend_items WHERE id = $1`,
    [id],
  );
  return row;
}

/** What the lines of the world and their children read, both tenants (the second run must leave it as it is). */
async function readWorld(runner: QueryRunner, world: World) {
  const out: Record<string, unknown> = {};
  for (const tenantId of [world.a, world.b]) {
    const lines = [world.o1, world.o2, world.ob1, world.c1, world.c2, world.cb1];
    out[`lines ${tenantId}`] = await readAs(runner, tenantId, `SELECT to_jsonb(s) AS row FROM spend_items s WHERE s.id = ANY($1) ORDER BY s.id`, [lines]);
    out[`versions ${tenantId}`] = await readAs(runner, tenantId, `SELECT to_jsonb(v) AS row FROM spend_versions v WHERE v.spend_item_id = ANY($1) ORDER BY v.id`, [lines]);
    out[`months ${tenantId}`] = await readAs(
      runner, tenantId,
      `SELECT to_jsonb(m) AS row FROM spend_amounts m WHERE m.version_id IN (SELECT id FROM spend_versions WHERE spend_item_id = ANY($1)) ORDER BY m.id`,
      [lines],
    );
    out[`totals ${tenantId}`] = await readAs(
      runner, tenantId,
      `SELECT to_jsonb(t) AS row FROM spend_version_totals t WHERE t.version_id IN (SELECT id FROM spend_versions WHERE spend_item_id = ANY($1)) ORDER BY t.version_id`,
      [lines],
    );
    for (const child of CHILD_LINKS) {
      out[`${child.spend} ${tenantId}`] = await readAs(
        runner, tenantId, `SELECT to_jsonb(x) AS row FROM ${child.spend} x WHERE x.${child.spendColumn} = ANY($1) ORDER BY x.id`, [lines],
      );
    }
    out[`search ${tenantId}`] = await readAs(
      runner, tenantId,
      `SELECT entity_type, entity_id, ref_prefix, ref_number, label, status FROM search_index WHERE entity_id = ANY($1) ORDER BY entity_id, entity_type`,
      [lines],
    );
    out[`sequences ${tenantId}`] = await readAs(
      runner, tenantId, `SELECT entity_type, next_val FROM item_sequences WHERE tenant_id = $1 AND entity_type IN ('spend', 'capex') ORDER BY 1`, [tenantId],
    );
  }
  return out;
}

const monthsSum = (runner: QueryRunner, tenantId: string, table: 'capex_amounts' | 'spend_amounts', versionId: string) =>
  readAs(
    runner, tenantId,
    `SELECT ${MEASURES.map((m) => `coalesce(sum(${m}), 0)::text AS ${m}`).join(', ')} FROM ${table} WHERE version_id = $1`,
    [versionId],
  ).then((rows) => rows[0]);

const storedTotals = (runner: QueryRunner, tenantId: string, table: 'capex_version_totals' | 'spend_version_totals', versionId: string) =>
  readAs(runner, tenantId, `SELECT ${MEASURES.map((m) => `${m}::text AS ${m}`).join(', ')} FROM ${table} WHERE version_id = $1`, [versionId])
    .then((rows) => rows[0]);

async function testUp() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBeforeMigration(runner);
    const sourceSums = await monthsSum(runner, world.a, 'capex_amounts', world.v1);
    const v1Totals = await storedTotals(runner, world.a, 'capex_version_totals', world.v1);
    await captureLog(() => natureMigration.up(runner));
    // Found as is: a table without FORCE, a trigger disabled by hand. Both must come back so.
    await runner.query(`ALTER TABLE spend_links NO FORCE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE spend_versions DISABLE TRIGGER spend_versions_budget_year_guard`);
    const rlsBefore = await rowSecurity(runner);
    const triggersBefore = await triggerStates(runner);

    const { lines: log } = await captureLog(() => mergeMigration.up(runner));

    assert.deepEqual(await rowSecurity(runner), rlsBefore, 'row level security as found');
    assert.deepEqual(await triggerStates(runner), triggersBefore, 'triggers as found');
    const [{ tenant }] = await runner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS tenant`);
    assert.equal(tenant, '', 'the tenant setting found (none) is put back');

    // Numbers: BL after GREATEST(highest number 2, spend sequence 4 - 1) in (created_at, id) order; legacy numbers of both natures.
    const c1 = await lineOf(runner, world.a, world.c1);
    const c2 = await lineOf(runner, world.a, world.c2);
    const cb1 = await lineOf(runner, world.b, world.cb1);
    assert.deepEqual([c2.item_number, c2.legacy_number, c2.nature], [4, 'CPX-3', 'capex'], 'CPX-3, created first, is BL-4');
    assert.deepEqual([c1.item_number, c1.legacy_number, c1.nature], [5, 'CPX-7', 'capex'], 'CPX-7 is BL-5');
    assert.deepEqual([cb1.item_number, cb1.legacy_number], [2, 'CPX-1'], "tenant B's CPX-1 is BL-2 (after its OPX-1, no sequence)");
    assert.equal((await lineOf(runner, world.a, world.o1)).legacy_number, 'OPX-1', 'an OPEX legacy number is kept');
    assert.equal((await lineOf(runner, world.a, world.o2)).legacy_number, 'OPX-2', 'an OPEX line without one gets OPX-n');
    assert.equal((await lineOf(runner, world.b, world.ob1)).legacy_number, 'OPX-1', "tenant B's OPEX line is untouched");

    // Values.
    assert.deepEqual(
      [c1.product_name, c1.description, c1.notes, c1.ppe_type, c1.investment_type, c1.priority, c1.run_build, c1.legacy_effective_end, c1.paying_company_id, c1.contract_id],
      ['Servers', null, 'Rack notes', 'software', 'capacity', 'high', 'build', '2030-12-31', world.companyA, null],
      'title, notes, enums and the other columns copied',
    );
    assert.equal(c1.supplier_id, null, 'a supplier the tenant does not have is left empty');
    assert.equal(c2.supplier_id, world.supplierA, 'an existing supplier is kept');
    assert.equal(c1.row_version, world.c1RowVersion, 'row_version kept');
    assert.equal(new Date(c1.created_at).toISOString(), '2024-06-01T00:00:00.000Z', 'created_at kept');

    // Children: same UUIDs, under the line.
    const [version] = await readAs(runner, world.a, `SELECT spend_item_id, budget_rev, budget_year, version_name FROM spend_versions WHERE id = $1`, [world.v1]);
    assert.deepEqual([version.spend_item_id, Number(version.budget_rev), version.budget_year], [world.c1, world.v1BudgetRev, YEAR], 'the version, its budget_rev kept');
    assert.deepEqual(await monthsSum(runner, world.a, 'spend_amounts', world.v1), sourceSums, 'each measure of the months sums the same');
    assert.deepEqual(await storedTotals(runner, world.a, 'spend_version_totals', world.v1), v1Totals, 'a correct total is copied as stored');
    assert.equal((await storedTotals(runner, world.a, 'spend_version_totals', world.v2)).planned, '120.00', 'a stale total is computed again from its months');
    const ids = async (table: string, idList: string[]) =>
      (await readAs(runner, world.a, `SELECT id FROM ${table} WHERE id = ANY($1) ORDER BY id`, [idList])).map((row: { id: string }) => row.id);
    assert.deepEqual(await ids('spend_round_inputs', [world.round1]), [world.round1], 'the column round');
    assert.deepEqual(await ids('spend_round_input_lines', [world.roundLine1]), [world.roundLine1], 'the costed line');
    assert.deepEqual(await ids('spend_allocations', [world.allocValid, world.allocOrphan]), [world.allocValid], 'the allocation to a missing company is left out');
    const dimension = await readAs(runner, world.a, `SELECT category_id FROM spend_item_analytics_values WHERE item_id = $1`, [world.c1]);
    assert.deepEqual(dimension, [{ category_id: world.category }], 'the dimension value');
    for (const child of CHILD_LINKS) {
      const rows = await readAs(runner, world.a, `SELECT id, ${child.spendColumn} AS line FROM ${child.spend} WHERE ${child.spendColumn} = $1`, [world.c1]);
      assert.deepEqual(rows, [{ id: world[child.key], line: world.c1 }], `${child.spend}: the row of ${child.capex}, same UUID`);
    }
    assert.deepEqual(
      await ids('spend_links', [world.orphanLink, world.foreignLink]).then(async (found) => [...found, ...await ids('spend_attachments', [world.orphanAttachment]), ...await ids('contract_spend_items', [world.orphanContractLink])]),
      [],
      'rows of no line, and a row of another tenant than its line, are not copied',
    );
    const foreignAsB = await readAs(runner, world.b, `SELECT id FROM spend_links WHERE id = $1`, [world.foreignLink]);
    assert.deepEqual(foreignAsB, [], 'nor visible to the tenant it named');
    const [task] = await readAs(runner, world.a, `SELECT related_object_type, related_object_id FROM tasks WHERE id = $1`, [world.task]);
    assert.deepEqual([task.related_object_type, task.related_object_id], ['capex_item', world.c1], 'the task keeps its type and line id');

    // One search entry per line, of its own type.
    const search = await readAs(
      runner, world.a,
      `SELECT entity_type, entity_id, ref_prefix, ref_number, label LIKE '%Servers%' AS titled FROM search_index WHERE entity_id = ANY($1) ORDER BY entity_id, entity_type`,
      [[world.c1, world.c2, world.o1]],
    );
    assert.deepEqual(
      search.filter((row: any) => row.entity_id === world.c1),
      [{ entity_type: 'capex_items', entity_id: world.c1, ref_prefix: 'CPX', ref_number: 7, titled: true }],
      'the CAPEX line: one entry, CPX number and title',
    );
    assert.deepEqual(search.filter((row: any) => row.entity_id === world.c2).map((row: any) => [row.entity_type, row.ref_number]), [['capex_items', 3]]);
    assert.deepEqual(search.filter((row: any) => row.entity_id === world.o1).map((row: any) => [row.entity_type, row.ref_number]), [['spend_items', 1]]);

    // Sequences: spend after the last BL, capex above every CPX number.
    const sequences = async (tenantId: string) => Object.fromEntries(
      (await readAs(runner, tenantId, `SELECT entity_type, next_val FROM item_sequences WHERE tenant_id = $1 AND entity_type IN ('spend', 'capex')`, [tenantId]))
        .map((row: any) => [row.entity_type, Number(row.next_val)]),
    );
    assert.deepEqual(await sequences(world.a), { spend: 6, capex: 8 }, 'tenant A: spend after BL-5, capex after CPX-7');
    assert.deepEqual(await sequences(world.b), { spend: 3, capex: 2 }, 'tenant B: both sequences created');

    // A tenant never reads the other's lines.
    assert.deepEqual(await readAs(runner, world.a, `SELECT id FROM spend_items WHERE id = ANY($1)`, [[world.cb1, world.ob1]]), [], 'tenant A does not see B');
    assert.deepEqual(await readAs(runner, world.a, `SELECT id FROM spend_versions WHERE id = $1`, [world.vb1]), [], "nor B's version");
    assert.equal((await readAs(runner, world.b, `SELECT id FROM spend_items WHERE id = $1`, [world.cb1])).length, 1, 'tenant B sees its line');

    // The log: the plan, then per tenant what moved and what was left out, named.
    const lineOfTenant = (prefix: string) => log.find((line) => line.startsWith(prefix));
    assert.ok(lineOfTenant(`${LOG_PREFIX} check: tenant ${world.slugA} (${world.a}): 2 CAPEX line(s) to move after number 3`), 'the plan of tenant A');
    assert.match(lineOfTenant(`${LOG_PREFIX} check: tenant ${world.slugA}`)!, /; 1 unknown supplier\(s\) to leave empty$/);
    const logA = lineOfTenant(`${LOG_PREFIX} tenant ${world.slugA} (${world.a}): `);
    assert.ok(logA, 'a log line for tenant A');
    for (const part of [
      '2 line(s) (BL-4 to BL-5)', ', 2 version(s)', ', 14 month(s)', ', 2 version total(s)', ', 1 column round(s)', ', 1 costed line(s)',
      ', 1 allocation(s)', ', 1 dimension value(s)', ', 1 contact(s)', ', 1 web link(s)', ', 1 attachment(s)', ', 1 application link(s)',
      ', 1 asset link(s)', ', 1 contract link(s)', ', 1 project link(s)', ', 1 request link(s)',
      'left out: 1 allocation(s) (company or department missing, or parent left out), 1 web link(s) (row of another tenant than its line), 1 unknown supplier(s) left empty',
      '; 1 stale version total(s) computed again',
      `capex_allocations ${world.allocOrphan}`, `capex_links ${world.foreignLink}`, `supplier of line ${world.c1}`,
    ]) {
      assert.ok(logA!.includes(part), `tenant A's log line has "${part}": ${logA}`);
    }
    const logB = lineOfTenant(`${LOG_PREFIX} tenant ${world.slugB} (${world.b}): `);
    assert.ok(logB?.includes('1 line(s) (BL-2 to BL-2)') && logB.includes('left out: nothing'), `tenant B's log line: ${logB}`);
    assert.ok(log.some((line) => /^\[Migration\] BudgetLinesMerge: all tenants \(\d+\): capex: /.test(line)), 'the totals per nature are logged');

    // The dormant rows stay where they were (lot Z2 drops them).
    assert.equal((await readAs(runner, world.a, `SELECT id FROM capex_items WHERE id = $1`, [world.c1])).length, 1, 'capex_items keeps its row');
  });
}

async function testSecondRun() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBeforeMigration(runner);
    await captureLog(() => natureMigration.up(runner));
    await captureLog(() => mergeMigration.up(runner));
    const first = await readWorld(runner, world);
    const { lines } = await captureLog(() => mergeMigration.up(runner));
    assert.deepEqual(await readWorld(runner, world), first, 'a second run changes nothing');
    assert.deepEqual(lines.filter((line) => line.includes(world.a) || line.includes(world.b)), [], 'and logs nothing for these tenants');

    // A CAPEX line moved without its legacy number gets it back, nothing else moves.
    await asTenant(runner, world.a);
    await runner.query(`UPDATE spend_items SET legacy_number = NULL WHERE id = $1`, [world.c1]);
    await noTenant(runner);
    const third = await captureLog(() => mergeMigration.up(runner));
    assert.equal((await lineOf(runner, world.a, world.c1)).legacy_number, 'CPX-7', 'the CPX number completed');
    assert.ok(third.lines.some((line) => line.includes(`tenant ${world.slugA} (${world.a}): nothing to move; 1 CAPEX legacy number(s) completed`)), 'and logged');
  });
}

/** Refusals before any write: each in a savepoint, the world untouched afterwards. */
async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBeforeMigration(runner);
    await captureLog(() => natureMigration.up(runner));
    const refused = async (label: string, prepare: () => Promise<void>, pattern: RegExp, run: () => Promise<unknown> = () => mergeMigration.up(runner)) => {
      await runner.query('SAVEPOINT refusal');
      try {
        await prepare();
        await noTenant(runner);
        await assert.rejects(() => captureLog(run), (err: Error) => pattern.test(err.message), label);
      } finally {
        await runner.query('ROLLBACK TO SAVEPOINT refusal');
      }
    };
    await refused(
      'a CAPEX line whose UUID an OPEX line holds',
      () => insert(runner, world.a, 'capex_items', {
        id: world.o1, description: 'Clash', ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR',
        effective_start: '2024-01-01', item_number: 99,
      }).then(() => undefined),
      new RegExp(`CAPEX line\\(s\\) ${world.o1} share their UUID with another line of spend_items; nothing was changed`),
    );
    await refused(
      'a CPX number another line already holds',
      async () => { await asTenant(runner, world.a); await runner.query(`UPDATE spend_items SET legacy_number = 'CPX-7' WHERE id = $1`, [world.o1]); },
      new RegExp(`CAPEX line\\(s\\) ${world.c1}: their CPX number is already another line's legacy number`),
    );
    await refused(
      'a totals trigger found disabled',
      async () => { await runner.query(`ALTER TABLE spend_amounts DISABLE TRIGGER spend_amounts_version_totals_insert`); },
      /the totals trigger\(s\) spend_amounts_version_totals_insert \(D\) do not fire/,
    );
    const [{ n }] = await readAs(runner, world.a, `SELECT count(*)::int AS n FROM spend_items WHERE id = ANY($1)`, [[world.c1, world.c2]]);
    assert.equal(n, 0, 'nothing moved by a refused run');

    await captureLog(() => mergeMigration.up(runner));
    await refused(
      'down(): a CAPEX line without its enums',
      async () => { await asTenant(runner, world.a); await runner.query(`UPDATE spend_items SET priority = NULL WHERE id = $1`, [world.c1]); },
      new RegExp(`down: CAPEX line\\(s\\) ${world.c1} have no PP&E type, investment type or priority`),
      () => mergeMigration.down(runner),
    );
    await refused(
      'down(): a CAPEX line with a contract',
      async () => {
        const [contract] = await readAs(runner, world.a, `SELECT contract_id AS id FROM contract_spend_items WHERE id = $1`, [world.contractLink]);
        await asTenant(runner, world.a);
        await runner.query(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [world.c1, contract.id]);
      },
      new RegExp(`down: CAPEX line\\(s\\) ${world.c1} have a contract_id`),
      () => mergeMigration.down(runner),
    );
    await refused(
      "the nature's down() while CAPEX lines are in spend_items",
      async () => undefined,
      /line\(s\) of nature capex are in spend_items; .*Revert 1853970000000 \(BudgetLinesMerge\) first/,
      () => natureMigration.down(runner),
    );
  });
}

/** down() after writes made once moved, then up() again: nothing lost, legacy numbers kept, new BL numbers. */
async function testRoundTrip() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBeforeMigration(runner);
    await captureLog(() => natureMigration.up(runner));
    await captureLog(() => mergeMigration.up(runner));

    // Writes on the moved lines: a title, a month, a deleted line, two new CAPEX lines (one without a CPX number).
    await asTenant(runner, world.a);
    await runner.query(`UPDATE spend_items SET product_name = 'Servers v2' WHERE id = $1`, [world.c1]);
    await runner.query(`UPDATE spend_amounts SET planned = planned + 1 WHERE version_id = $1 AND period = $2`, [world.v1, `${YEAR}-03-01`]);
    await runner.query(`DELETE FROM spend_links WHERE spend_item_id = $1`, [world.c2]);
    await runner.query(`DELETE FROM spend_items WHERE id = $1`, [world.c2]);
    const newLine = (itemNumber: number, legacy: string | null, created: string) => insert(runner, world.a, 'spend_items', {
      nature: 'capex', product_name: `New CAPEX ${itemNumber}`, ppe_type: 'hardware', investment_type: 'security', priority: 'low',
      currency: 'EUR', effective_start: '2025-01-01', item_number: itemNumber, legacy_number: legacy, created_at: created, updated_at: created,
    });
    const c4 = await newLine(6, 'CPX-8', '2025-01-01T00:00:00Z');
    const c5 = await newLine(7, null, '2025-02-01T00:00:00Z');
    await asTenant(runner, world.a);
    await runner.query(`UPDATE item_sequences SET next_val = 8 WHERE tenant_id = $1 AND entity_type = 'spend'`, [world.a]);
    const [{ row_version: c1RowVersion }] = await readAs(runner, world.a, `SELECT row_version FROM spend_items WHERE id = $1`, [world.c1]);
    const sums = await monthsSum(runner, world.a, 'spend_amounts', world.v1);
    await noTenant(runner);

    await captureLog(() => mergeMigration.down(runner));
    const back = await readAs(
      runner, world.a,
      `SELECT id, item_number, description, ppe_type::text, investment_type::text, priority::text, notes, row_version FROM capex_items WHERE id = ANY($1) ORDER BY item_number`,
      [[world.c1, world.c2, c4, c5]],
    );
    assert.deepEqual(
      back.map((row: any) => [row.id, row.item_number, row.description]),
      [[world.c1, 7, 'Servers v2'], [c4, 8, 'New CAPEX 6'], [c5, 9, 'New CAPEX 7']],
      'down(): the lines back with their CPX numbers (one given after every CPX number); the deleted line stays deleted',
    );
    assert.equal(back[0].row_version, c1RowVersion, 'down(): row_version kept');
    assert.deepEqual(await monthsSum(runner, world.a, 'capex_amounts', world.v1), sums, 'down(): the months back, the edit included');
    assert.deepEqual(await storedTotals(runner, world.a, 'capex_version_totals', world.v1), sums, 'down(): the totals equal the months');
    assert.deepEqual(await readAs(runner, world.a, `SELECT id FROM capex_versions WHERE id = $1`, [world.v2]), [], "down(): the deleted line's version is gone");
    for (const child of CHILD_LINKS) {
      const rows = await readAs(runner, world.a, `SELECT id FROM ${child.capex} WHERE ${child.capexColumn} = $1`, [world.c1]);
      assert.deepEqual(rows.map((row: any) => row.id), [world[child.key]], `down(): ${child.capex} back`);
    }
    assert.deepEqual(await readAs(runner, world.a, `SELECT id FROM spend_items WHERE nature = 'capex' AND id = ANY($1)`, [[world.c1, c4, c5]]), [], 'down(): spend_items holds no CAPEX line of the tenant');
    assert.equal((await readAs(runner, world.a, `SELECT id FROM capex_links WHERE id = $1`, [world.orphanLink])).length, 1, 'down(): a row of no line is left alone');
    const [{ next_val: capexNext }] = await readAs(runner, world.a, `SELECT next_val FROM item_sequences WHERE tenant_id = $1 AND entity_type = 'capex'`, [world.a]);
    assert.equal(Number(capexNext), 10, 'down(): the capex sequence after CPX-9');

    await captureLog(() => mergeMigration.up(runner));
    const again = await readAs(
      runner, world.a,
      `SELECT id, item_number, legacy_number, product_name FROM spend_items WHERE id = ANY($1) ORDER BY item_number`,
      [[world.c1, c4, c5]],
    );
    assert.deepEqual(
      again.map((row: any) => [row.id, row.item_number, row.legacy_number, row.product_name]),
      [[world.c1, 8, 'CPX-7', 'Servers v2'], [c4, 9, 'CPX-8', 'New CAPEX 6'], [c5, 10, 'CPX-9', 'New CAPEX 7']],
      'up() again: new BL numbers after the spend sequence (a number is never given twice), legacy numbers kept',
    );
    assert.deepEqual(await monthsSum(runner, world.a, 'spend_amounts', world.v1), sums, 'up() again: the months');
    assert.deepEqual(await storedTotals(runner, world.a, 'spend_version_totals', world.v1), sums, 'up() again: the totals');
    for (const child of CHILD_LINKS) {
      const rows = await readAs(runner, world.a, `SELECT id FROM ${child.spend} WHERE ${child.spendColumn} = $1`, [world.c1]);
      assert.deepEqual(rows.map((row: any) => row.id), [world[child.key]], `up() again: ${child.spend}`);
    }
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testUp, testSecondRun, testRefusals, testRoundTrip]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 6).join('\n    ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`budget-lines-merge-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('budget-lines-merge-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
