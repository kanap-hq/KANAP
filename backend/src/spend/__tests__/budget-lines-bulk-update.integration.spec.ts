import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { writeAuditLog } from '../../audit/audit.service';
import { BULK_MAX_ROWS } from '../../common/bulk-edit/bulk-edit';
import { BudgetLinesService } from '../budget-lines.service';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import { realSummaryDeps } from './oracle/oracle-deps';
import { itemService, seedCompany, seedCostCenter, seedUser } from './cost-center.fixtures';
import { assert, AUDIT_LABELS, inRolledBackTransaction, runSpecs, seedLine, seedTenant } from './round-inputs.fixtures';

/**
 * POST /budget-lines/bulk-update (lot F1 of 26.11.8): one change applied to many lines, each line
 * through the update of one line, in the request's transaction. The dry run counts the lines that
 * would change and, per stable code, the lines refused; the write changes the others and leaves
 * the refused ones as they are. Run in a rolled-back transaction each.
 */

const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
const YEAR = new Date().getFullYear();

/** The audit service on the request's manager: real rows in `audit_log`, as the history reads them. */
const dbAudit = { log: (entry: any, opts?: { manager?: any }) => writeAuditLog(opts!.manager, entry) };

function service(): BudgetLinesService {
  return new BudgetLinesService(
    deps.allocationCalculator as any,
    deps.fxRates as any,
    undefined as any,
    undefined as any,
    itemService('opex', dbAudit),
    itemService('capex', dbAudit),
    undefined as any,
  );
}

type Seeded = Awaited<ReturnType<typeof seedBulk>>;

/**
 * Company A (chart A, account A) pays every line; company B has its own chart and account. An
 * account for CAPEX lines only on chart A, a supplier, a cost center of A, a person, a required
 * dimension (two values; OPEX line 1 holds the first) and an optional one. Three OPEX lines, two
 * CAPEX lines.
 */
async function seedBulk(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'bulk-edit');
  const a = await seedCompany(runner, tenantId, 'Bulk A', 6100);
  const b = await seedCompany(runner, tenantId, 'Bulk B', 6200);
  const [capexAccount] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, nature) VALUES ($1, $2, 2100, 'Bulk capex account', 'capex') RETURNING id`,
    [tenantId, a.chartId],
  );
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Zqbulksupplier') RETURNING id`, [tenantId]);
  const costCenter = await seedCostCenter(runner, tenantId, { code: 'BLK', name: 'Bulk centre', companyId: a.companyId });
  const owner = await seedUser(runner, tenantId, `bulk-owner-${randomUUID()}@example.invalid`);
  const axis = async (code: string, required: boolean) => {
    const [row] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, required) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, code, `${code} dimension`, required],
    );
    const values: string[] = [];
    for (const name of [`${code} one`, `${code} two`]) {
      const [value] = await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, row.id, name]);
      values.push(value.id);
    }
    return { id: row.id as string, values };
  };
  const required = await axis('req', true);
  const optional = await axis('opt', false);
  const lines: Array<{ id: string; nature: 'opex' | 'capex' }> = [];
  let n = 1;
  for (const nature of ['opex', 'opex', 'opex', 'capex', 'capex'] as const) {
    const { itemId } = await seedLine(runner, nature, tenantId, YEAR, {}, n++);
    await runner.query(
      `UPDATE spend_items SET paying_company_id = $2, account_id = $3, supplier_id = $4 WHERE tenant_id = $1 AND id = $5`,
      [tenantId, a.companyId, a.accountId, supplier.id, itemId],
    );
    lines.push({ id: itemId, nature });
  }
  await runner.query(
    `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
    [tenantId, lines[0].id, required.id, required.values[0]],
  );
  return { tenantId, a, b, capexAccount: capexAccount.id as string, supplier: supplier.id as string, costCenter, owner, required, optional, lines };
}

async function column(runner: QueryRunner, id: string, name: string): Promise<string | null> {
  const [row] = await runner.query(`SELECT ${name}::text AS value FROM spend_items WHERE id = $1`, [id]);
  return row?.value ?? null;
}

async function updateRows(runner: QueryRunner, ids: string[]): Promise<number> {
  const [row] = await runner.query(
    `SELECT count(*)::int AS n FROM audit_log WHERE table_name = ANY($1::text[]) AND action = 'update' AND record_id = ANY($2::uuid[])`,
    [[AUDIT_LABELS.opex.items, AUDIT_LABELS.capex.items], ids],
  );
  return row.n;
}

async function withSeed(fn: (runner: QueryRunner, s: Seeded) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => fn(runner, await seedBulk(runner)));
}

const ids = (s: Seeded, ...indexes: number[]) => indexes.map((i) => s.lines[i].id);

const tests: Array<[string, () => Promise<void>]> = [
  ['three chosen lines of both natures: the dry run counts, writes nothing; the write changes them with one audit row each', () => withSeed(async (runner, s) => {
    const svc = service();
    const chosen = ids(s, 0, 1, 3);
    const body = { ids: chosen, changes: { cost_center_id: s.costCenter, owner_it_id: s.owner, run_build: 'build' } };
    const dry = await svc.bulkUpdate({ ...body, dry_run: true }, undefined, { manager: runner.manager });
    assert.equal(dry.dry_run, true);
    assert.equal(dry.rows, 3);
    assert.equal(dry.changes, 3);
    assert.equal(dry.unchanged, 0);
    assert.deepEqual(dry.refused, {});
    assert.ok(typeof dry.as_of === 'string' && !Number.isNaN(Date.parse(dry.as_of)));
    for (const id of chosen) assert.equal(await column(runner, id, 'cost_center_id'), null, 'the dry run wrote nothing');
    assert.equal(await updateRows(runner, chosen), 0, 'the dry run left no audit row');

    const done = await svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows }, undefined, { manager: runner.manager });
    assert.equal(done.rows, 3);
    assert.equal(done.changed, 3);
    assert.deepEqual(done.refused, {});
    for (const id of chosen) {
      assert.equal(await column(runner, id, 'cost_center_id'), s.costCenter);
      assert.equal(await column(runner, id, 'owner_it_id'), s.owner);
      assert.equal(await column(runner, id, 'run_build'), 'build');
    }
    for (const id of ids(s, 2, 4)) assert.equal(await column(runner, id, 'cost_center_id'), null, 'a line not chosen is untouched');
    assert.equal(await updateRows(runner, chosen), 3, 'one audit row per changed line');
    const [capexRow] = await runner.query(
      `SELECT before_json->>'cost_center_id' AS before, after_json->>'cost_center_id' AS after FROM audit_log WHERE table_name = $1 AND record_id = $2 AND action = 'update'`,
      [AUDIT_LABELS.capex.items, s.lines[3].id],
    );
    assert.deepEqual(capexRow, { before: null, after: s.costCenter }, 'the CAPEX line is audited under its own label, as its history reads it');

    const again = await svc.bulkUpdate({ ...body, dry_run: true }, undefined, { manager: runner.manager });
    assert.equal(again.changes, 0);
    assert.equal(again.unchanged, 3, 'lines that already hold the values are counted unchanged');
  })],

  ['every line of the filter but the excluded ones', () => withSeed(async (runner, s) => {
    const svc = service();
    const body = { all: true, filters: {}, exclude_ids: ids(s, 1), changes: { supplier_id: null } };
    const dry = await svc.bulkUpdate({ ...body, dry_run: true }, undefined, { manager: runner.manager });
    assert.equal(dry.rows, 4);
    assert.equal(dry.changes, 4);
    const done = await svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows }, undefined, { manager: runner.manager });
    assert.equal(done.changed, 4);
    for (const id of ids(s, 0, 2, 3, 4)) assert.equal(await column(runner, id, 'supplier_id'), null, 'an optional field emptied');
    assert.equal(await column(runner, s.lines[1].id, 'supplier_id'), s.supplier, 'the excluded line keeps its supplier');
  })],

  ['with all, as_of and expected_rows are required', () => withSeed(async (runner) => {
    const svc = service();
    await assert.rejects(svc.bulkUpdate({ all: true, filters: {}, changes: { run_build: 'run' }, expected_rows: 5 }, undefined, { manager: runner.manager }), /as_of is required/);
    await assert.rejects(svc.bulkUpdate({ all: true, filters: {}, changes: { run_build: 'run' }, as_of: new Date().toISOString() }, undefined, { manager: runner.manager }), /expected_rows is required/);
  })],

  ['a line that enters the filter after the count: 409 bulk_list_changed, nothing written', () => withSeed(async (runner, s) => {
    const svc = service();
    await runner.query(`UPDATE spend_items SET disabled_at = '2021-06-30T12:00:00Z', status = 'disabled' WHERE id = $1`, [s.lines[2].id]);
    const body = { all: true, filters: {}, changes: { run_build: 'run' } };
    const dry = await svc.bulkUpdate({ ...body, dry_run: true }, undefined, { manager: runner.manager });
    assert.equal(dry.rows, 4, 'the disabled line is out of the list');
    await runner.query(`UPDATE spend_items SET disabled_at = NULL, status = 'enabled' WHERE id = $1`, [s.lines[2].id]);
    await assert.rejects(
      svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows }, undefined, { manager: runner.manager }),
      (err: any) => err.status === 409 && err.getResponse().code === 'bulk_list_changed',
    );
    for (const line of s.lines) assert.equal(await column(runner, line.id, 'run_build'), null);
  })],

  ['a line created after the count is left out, without a 409', () => withSeed(async (runner, s) => {
    const svc = service();
    const body = { all: true, filters: {}, changes: { run_build: 'run' } };
    const dry = await svc.bulkUpdate({ ...body, dry_run: true }, undefined, { manager: runner.manager });
    const { itemId } = await seedLine(runner, 'opex', s.tenantId, YEAR, {}, 99);
    await runner.query(`UPDATE spend_items SET paying_company_id = $2, created_at = clock_timestamp() + interval '1 minute' WHERE id = $1`, [itemId, s.a.companyId]);
    const done = await svc.bulkUpdate({ ...body, as_of: dry.as_of, expected_rows: dry.rows }, undefined, { manager: runner.manager });
    assert.equal(done.changed, 5);
    assert.equal(await column(runner, itemId, 'run_build'), null, 'the new line stays as it is');
  })],

  ['an account outside the chart of the paying company: refused, counted, not changed', () => withSeed(async (runner, s) => {
    const svc = service();
    await runner.query(`UPDATE spend_items SET paying_company_id = $2, account_id = NULL WHERE id = $1`, [s.lines[2].id, s.b.companyId]);
    const body = { ids: ids(s, 0, 1, 2), changes: { account_id: s.b.accountId } };
    const dry = await svc.bulkUpdate({ ...body, dry_run: true }, undefined, { manager: runner.manager });
    assert.equal(dry.changes, 1);
    assert.deepEqual(dry.refused, { account_chart: 2 });
    const done = await svc.bulkUpdate(body, undefined, { manager: runner.manager });
    assert.equal(done.changed, 1);
    assert.deepEqual(done.refused, { account_chart: 2 });
    assert.equal(await column(runner, s.lines[2].id, 'account_id'), s.b.accountId);
    for (const id of ids(s, 0, 1)) assert.equal(await column(runner, id, 'account_id'), s.a.accountId, 'a refused line keeps its account');
    assert.equal(await updateRows(runner, ids(s, 0, 1)), 0, 'no audit row for a refused line');
  })],

  ['an account for one type of line: the other type is refused (both natures)', () => withSeed(async (runner, s) => {
    const svc = service();
    const done = await svc.bulkUpdate({ ids: ids(s, 0, 3, 4), changes: { account_id: s.capexAccount } }, undefined, { manager: runner.manager });
    assert.equal(done.changed, 2);
    assert.deepEqual(done.refused, { account_nature: 1 });
    assert.equal(await column(runner, s.lines[3].id, 'account_id'), s.capexAccount);
    assert.equal(await column(runner, s.lines[0].id, 'account_id'), s.a.accountId);
  })],

  ['a required dimension emptied: the line holding a value is refused, the others are unchanged', () => withSeed(async (runner, s) => {
    const svc = service();
    const done = await svc.bulkUpdate({ ids: ids(s, 0, 1, 3), changes: { analytics_values: { [s.required.id]: null } } }, undefined, { manager: runner.manager });
    assert.deepEqual(done.refused, { dimension_required: 1 });
    assert.equal(done.changed, 0);
    assert.equal(done.unchanged, 2);
    const [held] = await runner.query(`SELECT category_id::text AS v FROM spend_item_analytics_values WHERE item_id = $1 AND axis_id = $2`, [s.lines[0].id, s.required.id]);
    assert.equal(held?.v, s.required.values[0]);
  })],

  ['dimension values set and an optional one emptied', () => withSeed(async (runner, s) => {
    const svc = service();
    const set = await svc.bulkUpdate({ ids: ids(s, 0, 3), changes: { analytics_values: { [s.required.id]: s.required.values[1], [s.optional.id]: s.optional.values[0] } } }, undefined, { manager: runner.manager });
    assert.equal(set.changed, 2);
    const cleared = await svc.bulkUpdate({ ids: ids(s, 0, 3), changes: { analytics_values: { [s.optional.id]: null } } }, undefined, { manager: runner.manager });
    assert.equal(cleared.changed, 2);
    const rows = await runner.query(
      `SELECT item_id::text AS item, axis_id::text AS axis, category_id::text AS value FROM spend_item_analytics_values WHERE item_id = ANY($1::uuid[]) ORDER BY item_id, axis_id`,
      [ids(s, 0, 3)],
    );
    assert.deepEqual(rows.map((r: any) => r.value), [s.required.values[1], s.required.values[1]], 'the required value replaced, the optional one gone');
  })],

  ['a required field cannot be emptied, a field outside the list cannot be changed', () => withSeed(async (runner, s) => {
    const svc = service();
    await assert.rejects(svc.bulkUpdate({ ids: ids(s, 0), changes: { paying_company_id: null } }, undefined, { manager: runner.manager }), /cannot be emptied/);
    await assert.rejects(svc.bulkUpdate({ ids: ids(s, 0), changes: { account_id: null } }, undefined, { manager: runner.manager }), /cannot be emptied/);
    await assert.rejects(svc.bulkUpdate({ ids: ids(s, 0), changes: { product_name: 'x' } }, undefined, { manager: runner.manager }), /cannot be changed in bulk/);
    await assert.rejects(svc.bulkUpdate({ ids: ids(s, 0), changes: {} }, undefined, { manager: runner.manager }), /at least one field/);
  })],

  ['an unknown id is refused as not found, like a line the person cannot read', () => withSeed(async (runner, s) => {
    const svc = service();
    const done = await svc.bulkUpdate({ ids: [s.lines[0].id, randomUUID()], changes: { run_build: 'run' } }, undefined, { manager: runner.manager });
    assert.equal(done.rows, 2);
    assert.equal(done.changed, 1);
    assert.deepEqual(done.refused, { not_found: 1 });
  })],

  ['more than 5,000 lines: 400 bulk_too_many', () => withSeed(async (runner) => {
    const svc = service();
    const many = Array.from({ length: BULK_MAX_ROWS + 1 }, () => randomUUID());
    await assert.rejects(
      svc.bulkUpdate({ ids: many, changes: { run_build: 'run' }, dry_run: true }, undefined, { manager: runner.manager }),
      (err: any) => err.status === 400 && err.getResponse().code === 'bulk_too_many',
    );
  })],

  ['the search index follows the change', () => withSeed(async (runner, s) => {
    const svc = service();
    const [other] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Zqnewbulkvendor') RETURNING id`, [s.tenantId]);
    await svc.bulkUpdate({ ids: ids(s, 0, 3), changes: { supplier_id: other.id } }, undefined, { manager: runner.manager });
    for (const id of ids(s, 0, 3)) {
      const rows = await runner.query(`SELECT search_vector::text AS v FROM search_index WHERE tenant_id = $1 AND entity_id = $2`, [s.tenantId, id]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].v.includes('zqnewbulkvendor'), 'the new supplier is indexed');
      assert.ok(!rows[0].v.includes('zqbulksupplier'), 'the old one is gone');
    }
  })],
];

void runSpecs('budget-lines-bulk-update', tests);
