// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { DATA_ACCESS_LEAVES_ACCESS_MESSAGE, DATA_ACCESS_PLACEMENT_MESSAGE, DataAccessLimitedException } from '../line-write-checks';
import { RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY } from '../reserved-operations';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { AnalyticsCategory } from '../../analytics/analytics-category.entity';
import { PREFLIGHT_STALE } from '../../spend/budget-file/import-file';
import { closedDimensionValueMessage, noLongerAvailableMessage, readOnlyLineMessage } from '../../spend/budget-file/preflight';
import { loadPreflight } from '../../spend/budget-file/load';
import { interpretBudgetFile, readBudgetCsv } from '../../spend/budget-file/interpret';
import { BudgetFileReport } from '../../spend/budget-file/types';
import { BudgetFileItems, BudgetFileImportResult } from '../../spend/budget-file/import-file';
import { budgetFileService, lineServices } from '../../spend/__tests__/budget-file.fixtures';
import { captureAudit, noFreeze } from '../../spend/__tests__/round-inputs.fixtures';
import * as budgetList from '../../spend/budget-list/budget-list.service';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { exportListQuery } from '../../spend/budget-file/export-file';
import { SpendItemsController } from '../../spend/spend-items.controller';
import { CapexItemsController } from '../../spend/capex-items.controller';
import { BudgetLinesController } from '../../spend/budget-lines.controller';
import { analyzeTables, lineImportTables } from '../../spend/budget-import-statistics';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { Label, nextItemNumber, Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 3 run 3C (planning/data-scoped-access/spec.md §3.5, §4.2, §10.11): the
 * budget file of a limited person, through the real preflight and load (`BudgetFileService`) and
 * the list engine of the export, on the reference example of lot 2 (`data-access-line-seed.ts`), in
 * one rolled-back transaction, each person in a savepoint after `applyDataAccess`.
 *
 * Marta (company ES, edit) reads L2-L5 and modifies L3-L5; Rita (INF-FR edit, INF read) modifies L1;
 * Nina (no node) owns L6 and L7; Ulla has access to all data. Dimension a2 has open values, a1 a
 * closed list.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 1 });

const OPTIONS = { language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false };

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

/** Runs `fn` as `person` in a savepoint, rolled back after. */
async function as<T>(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    return await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

type Fixture = Seed & {
  ref: Record<Label, string>;
  frName: string;
  esName: string;
  a1: string;
  a2: string;
  axis1: string;
};

function csv(columns: string[], rows: Array<Record<string, string>>): Buffer {
  return Buffer.from(`${columns.join(',')}\n${rows.map((row) => columns.map((column) => row[column] ?? '').join(',')).join('\n')}\n`, 'utf8');
}

function errorsOf(report: BudgetFileReport): string[] {
  return report.errors.map((error) => `${error.column}: ${error.message}`);
}

async function preflight(m: EntityManager, f: Fixture, person: string, file: Buffer): Promise<BudgetFileReport> {
  return budgetFileService().preflight('opex', file, { manager: m, tenantId: f.tenantId, userId: person }, OPTIONS);
}

async function load(
  m: EntityManager,
  f: Fixture,
  person: string,
  file: Buffer,
  snapshot: BudgetFileReport['snapshot'],
  items?: BudgetFileItems,
): Promise<BudgetFileImportResult> {
  const audit = captureAudit() as any;
  return budgetFileService().importFile('opex', file, snapshot, { manager: m, tenantId: f.tenantId, userId: person }, OPTIONS, {
    items: lineServices('opex', audit, items),
    audit,
    freeze: noFreeze,
  });
}

async function notesOf(m: EntityManager, id: string): Promise<string | null> {
  const [row] = await m.query(`SELECT notes FROM spend_items WHERE id = $1`, [id]);
  return row?.notes ?? null;
}

async function prepare(runner: QueryRunner, s: Seed): Promise<Fixture> {
  const q = (sql: string, params?: unknown[]) => runner.query(sql, params as any[]);
  const rows: Array<{ id: string; item_number: number }> = await q(`SELECT id, item_number FROM spend_items WHERE id = ANY($1::uuid[])`, [Object.values(s.lines)]);
  const numberOf = new Map(rows.map((row) => [row.id, Number(row.item_number)]));
  const ref = {} as Record<Label, string>;
  for (const [label, id] of Object.entries(s.lines) as Array<[Label, string]>) ref[label] = `BL-${numberOf.get(id)}`;
  const names = new Map<string, string>((await q(`SELECT id, name FROM companies WHERE id = ANY($1::uuid[])`, [[s.fr, s.es]])).map((row: any) => [row.id, row.name]));
  // The default chart of accounts and its account 6000: a new line of either company takes it.
  const [chart] = await q(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso, is_global_default) VALUES ($1, 'DA3C', 'DA 3C chart', 'FR', true) RETURNING id`,
    [s.tenantId],
  );
  await q(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6000, 'DA 3C account')`, [s.tenantId, chart.id]);
  // a2 has open values; a1 keeps the closed list (the default).
  await q(`UPDATE analytics_axes SET open_values = true WHERE id = $1`, [s.axis2]);
  const codes = new Map<string, string>((await q(`SELECT id, code FROM analytics_axes WHERE tenant_id = $1`, [s.tenantId])).map((row: any) => [row.id, row.code]));
  const [a1] = await q(`SELECT axis_id FROM spend_item_analytics_values WHERE item_id = $1`, [s.lines.L1]);
  return { ...s, ref, frName: names.get(s.fr)!, esName: names.get(s.es)!, a1: codes.get(a1.axis_id)!, a2: codes.get(s.axis2)!, axis1: a1.axis_id };
}

async function testExport(runner: QueryRunner, f: Fixture) {
  const names = (content: string) => Object.entries(f.lines).filter(([label]) => content.includes(`DA line ${label} `)).map(([label]) => label).sort();
  const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
  const exportOf = async (m: EntityManager, person: string, query: Record<string, string>, all: boolean) => {
    const { ids } = await budgetList.budgetListIds(SUMMARY_SCOPES.opex, deps, exportListQuery(query, all), m);
    return budgetFileService().exportFile('opex', ids, { manager: m, tenantId: f.tenantId, userId: person }, {
      language: 'en', amountYears: '2026', columns: 'budget', detail: 'yearly',
    });
  };
  await as(runner, f.persons.marta, async (m) => {
    const all = await exportOf(m, f.persons.marta, { q: 'no-such-line' }, true);
    assert.deepEqual(names(all.content), ['L2', 'L3', 'L4', 'L5'], '"all lines": every line Marta reads, no other');
    assert.equal(all.dataAccessLimited, true, 'the export says it is calculated on the access');
    const filtered = await exportOf(m, f.persons.marta, { q: 'DA line L4' }, false);
    assert.deepEqual(names(filtered.content), ['L4'], 'the list filter');
    const hidden = await exportOf(m, f.persons.marta, { q: 'DA line L1' }, false);
    assert.deepEqual(names(hidden.content), [], 'a filter on a line out of access finds nothing');
  });
  await as(runner, f.persons.ulla, async (m) => {
    const all = await exportOf(m, f.persons.ulla, {}, true);
    assert.deepEqual(names(all.content), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    assert.equal(all.dataAccessLimited, false);
  });
  console.log('  export: the list filter and "all lines" give the visible lines only, flagged limited: OK');
}

async function testNumbers(runner: QueryRunner, f: Fixture) {
  const missing = 'BL-987654';
  await as(runner, f.persons.marta, async (m) => {
    // L1 is out of Marta's read access: exactly a number with no line, without and with a token.
    const bare = await preflight(m, f, f.persons.marta, csv(['item_number', 'notes'], [{ item_number: f.ref.L1, notes: 'x' }, { item_number: missing, notes: 'x' }]));
    assert.deepEqual(errorsOf(bare), [
      `item_number: item_number '${f.ref.L1}' does not match a line.`,
      `item_number: item_number '${missing}' does not match a line.`,
    ]);
    const tokens = await preflight(m, f, f.persons.marta, csv(['item_number', 'notes', 'kanap_token'], [
      { item_number: f.ref.L1, notes: 'x', kanap_token: 'v1' },
      { item_number: missing, notes: 'x', kanap_token: 'v1' },
    ]));
    assert.deepEqual(errorsOf(tokens), [
      `item_number: ${noLongerAvailableMessage(f.ref.L1)}`,
      `item_number: ${noLongerAvailableMessage(missing)}`,
    ]);
    assert.equal(tokens.dataAccessLimited, true);
  });
  await as(runner, f.persons.ulla, async (m) => {
    const tokens = await preflight(m, f, f.persons.ulla, csv(['item_number', 'notes', 'kanap_token'], [{ item_number: missing, notes: 'x', kanap_token: 'v1' }]));
    assert.deepEqual(errorsOf(tokens), [`item_number: ${missing} is no longer available since the export.`], 'the neutral message, for everyone');
  });
  console.log('  item_number of an invisible line: the answer of a missing number, with and without token: OK');
}

async function testReadOnly(runner: QueryRunner, f: Fixture) {
  await as(runner, f.persons.marta, async (m) => {
    // L2 (FR on INF-ES): Marta reads it through the centre of her company, and may not modify it.
    const same = csv(['item_number', 'notes'], [{ item_number: f.ref.L2, notes: '' }]);
    const unchanged = await preflight(m, f, f.persons.marta, same);
    assert.equal(unchanged.ok, true, JSON.stringify(unchanged.errors));
    assert.equal(unchanged.changes.unchanged, 1);
    assert.equal(unchanged.snapshot.lines[0].editable, false);
    const loaded = await load(m, f, f.persons.marta, same, unchanged.snapshot);
    assert.deepEqual([loaded.ok, (loaded as any).inserted, (loaded as any).updated], [true, 0, 0], 'loaded, nothing written');
    const changed = await preflight(m, f, f.persons.marta, csv(['item_number', 'notes'], [{ item_number: f.ref.L2, notes: 'Changed' }]));
    assert.deepEqual(errorsOf(changed), [`item_number: ${readOnlyLineMessage(f.ref.L2)}`]);
    assert.equal(await notesOf(m, f.lines.L2), null);
  });
  console.log('  read-only line: unchanged passes (nothing written), changed refused: OK');
}

async function testCreatePlacement(runner: QueryRunner, f: Fixture) {
  const columns = ['item_number', 'name', 'company_name', 'account_number', 'currency'];
  await as(runner, f.persons.marta, async (m) => {
    const outside = csv(columns, [{ name: 'DA 3C outside', company_name: f.frName, account_number: '6000', currency: 'EUR' }]);
    const report = await preflight(m, f, f.persons.marta, outside);
    assert.deepEqual(errorsOf(report), [`company_name: ${DATA_ACCESS_PLACEMENT_MESSAGE}`], 'preflight');
    const refused = await load(m, f, f.persons.marta, outside, { lines: [] });
    assert.equal(refused.ok, false, 'load');
    assert.deepEqual(errorsOf(refused as BudgetFileReport), [`company_name: ${DATA_ACCESS_PLACEMENT_MESSAGE}`]);
    const [none] = await m.query(`SELECT count(*)::int AS n FROM spend_items WHERE product_name = 'DA 3C outside'`);
    assert.equal(none.n, 0);

    const inside = csv(columns, [{ name: 'DA 3C inside', company_name: f.esName, account_number: '6000', currency: 'EUR' }]);
    const ok = await preflight(m, f, f.persons.marta, inside);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    const written = await load(m, f, f.persons.marta, inside, ok.snapshot);
    assert.deepEqual([written.ok, (written as any).inserted], [true, 1]);
    const [line] = await m.query(`SELECT paying_company_id FROM spend_items WHERE product_name = 'DA 3C inside'`);
    assert.equal(line?.paying_company_id, f.es, 'created, placed in her company, and readable by her');
  });
  console.log('  creation: out of placement refused at preflight and load, inside created and placed: OK');
}

async function testCentreChange(runner: QueryRunner, f: Fixture) {
  // Rita modifies L1 (FR / INF-FR); INF-ES is outside her edit access.
  await as(runner, f.persons.rita, async (m) => {
    const report = await preflight(m, f, f.persons.rita, csv(['item_number', 'cost_center_code'], [{ item_number: f.ref.L1, cost_center_code: 'INF-ES' }]));
    assert.deepEqual(errorsOf(report), [`cost_center_code: ${DATA_ACCESS_PLACEMENT_MESSAGE}`]);
  });
  // Nina has no node and owns a line on FR / INF-ES: she modifies it, she cannot move it.
  const number = nextItemNumber();
  await runner.query(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id, owner_it_id)
     VALUES ($1, 'DA 3C owned', 'EUR', '2026-01-01', $2, $3, $4, $5)`,
    [f.tenantId, number, f.fr, f.infEs, f.persons.nina],
  );
  await as(runner, f.persons.nina, async (m) => {
    const owned = await preflight(m, f, f.persons.nina, csv(['item_number', 'notes'], [{ item_number: `BL-${number}`, notes: 'Mine' }]));
    assert.equal(owned.ok, true, `the responsible person modifies the line: ${JSON.stringify(owned.errors)}`);
    const moved = await preflight(m, f, f.persons.nina, csv(['item_number', 'cost_center_code'], [{ item_number: `BL-${number}`, cost_center_code: 'INF-FR' }]));
    assert.deepEqual(errorsOf(moved), [`cost_center_code: ${DATA_ACCESS_PLACEMENT_MESSAGE}`], 'also for the responsible person');
  });
  // Nina handing L6 over would take it out of her access.
  await as(runner, f.persons.nina, async (m) => {
    const [ulla] = await m.query(`SELECT email FROM users WHERE id = $1`, [f.persons.ulla]);
    assert.ok(ulla?.email, 'the users stay readable (pickers)');
    const handed = await preflight(m, f, f.persons.nina, csv(['item_number', 'owner_it_email'], [{ item_number: `BL-${number}`, owner_it_email: ulla.email }]));
    assert.deepEqual(errorsOf(handed), [`owner_it_email: ${DATA_ACCESS_LEAVES_ACCESS_MESSAGE}`]);
  });
  console.log('  centre change outside edit access refused, owner included; a handover out of access refused: OK');
}

async function testDimensionValues(runner: QueryRunner, f: Fixture) {
  const open = `analytics:${f.a2}`;
  const closed = `analytics:${f.a1}`;
  await as(runner, f.persons.marta, async (m) => {
    const file = csv(['item_number', open], [{ item_number: f.ref.L4, [open]: 'Open from file' }]);
    const report = await preflight(m, f, f.persons.marta, file);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.deepEqual(report.creates.dimensionValues, [{ dimension: f.a2, names: ['Open from file'] }], 'will be created');
    assert.deepEqual(report.creates.refusedDimensionValues, []);
    const written = await load(m, f, f.persons.marta, file, report.snapshot);
    assert.equal(written.ok, true);
    const [held] = await m.query(
      `SELECT c.name FROM spend_item_analytics_values v JOIN analytics_categories c ON c.id = v.category_id WHERE v.item_id = $1 AND v.axis_id = $2`,
      [f.lines.L4, f.axis2],
    );
    assert.equal(held?.name, 'Open from file', 'created and set on the line');

    const refused = await preflight(m, f, f.persons.marta, csv(['item_number', closed], [{ item_number: f.ref.L4, [closed]: 'Closed new' }]));
    assert.deepEqual(errorsOf(refused), [`${closed}: ${closedDimensionValueMessage('Closed new', f.a1)}`]);
    assert.deepEqual(refused.creates.dimensionValues, []);
    assert.deepEqual(refused.creates.refusedDimensionValues, [{ dimension: f.a1, names: ['Closed new'] }], 'refused');
  });
  await as(runner, f.persons.ulla, async (m) => {
    const report = await preflight(m, f, f.persons.ulla, csv(['item_number', closed], [{ item_number: f.ref.L4, [closed]: 'Closed new' }]));
    assert.equal(report.ok, true, 'created for an unscoped person, as before');
    assert.deepEqual(report.creates.dimensionValues, [{ dimension: f.a1, names: ['Closed new'] }]);
    assert.equal('refusedDimensionValues' in report.creates, false);
  });
  console.log('  dimension values from the file: open created, closed refused to a limited person and created for an unscoped one: OK');
}

async function testPicker(runner: QueryRunner, f: Fixture) {
  const service = (m: EntityManager) => new AnalyticsCategoriesService(m.getRepository(AnalyticsCategory), captureAudit() as any);
  const call = (m: EntityManager, person: string, body: Record<string, unknown>) =>
    service(m).createFromLine(body, person, { manager: m, tenantId: f.tenantId });
  const forbidden = (code: string) => (err: any) => {
    assert.equal(err?.getStatus?.(), 403, err?.message);
    assert.equal((err.getResponse() as any).code, code);
    return true;
  };
  await as(runner, f.persons.marta, async (m) => {
    const created = await call(m, f.persons.marta, { axis_id: f.axis2, name: 'From picker', line_id: f.lines.L4 });
    assert.deepEqual([created.created, created.name, created.axis_id], [true, 'From picker', f.axis2]);
    const found = await call(m, f.persons.marta, { axis_id: f.axis2, name: 'from PICKER', line_id: f.lines.L4 });
    assert.deepEqual([found.created, found.id], [false, created.id], 'found regardless of case');
    // A new line placed in her company: allowed; in France: refused.
    assert.equal((await call(m, f.persons.marta, { axis_id: f.axis2, name: 'New line value', paying_company_id: f.es })).created, true);
    await assert.rejects(call(m, f.persons.marta, { axis_id: f.axis2, name: 'Elsewhere', paying_company_id: f.fr }), forbidden('DATA_ACCESS_LIMITED'));
    // A read-only line, a hidden line, a closed list.
    await assert.rejects(call(m, f.persons.marta, { axis_id: f.axis2, name: 'On L2', line_id: f.lines.L2 }), forbidden('DATA_ACCESS_LIMITED'));
    await assert.rejects(call(m, f.persons.marta, { axis_id: f.axis2, name: 'On L1', line_id: f.lines.L1 }), (err: any) => err?.getStatus?.() === 404);
    await assert.rejects(call(m, f.persons.marta, { axis_id: f.axis1, name: 'Closed', line_id: f.lines.L4 }), forbidden('DATA_ACCESS_LIMITED'));
    // An existing value of a closed list is still found.
    const [existing] = await m.query(`SELECT name FROM analytics_categories WHERE axis_id = $1 LIMIT 1`, [f.axis1]);
    assert.equal((await call(m, f.persons.marta, { axis_id: f.axis1, name: existing.name, line_id: f.lines.L4 })).created, false);
  });
  await as(runner, f.persons.ulla, async (m) => {
    await assert.rejects(call(m, f.persons.ulla, { axis_id: f.axis1, name: 'Closed', line_id: f.lines.L1 }), (err: any) => err?.getStatus?.() === 400);
    assert.equal((await call(m, f.persons.ulla, { axis_id: f.axis2, name: 'Ulla value', line_id: f.lines.L1 })).created, true);
  });
  console.log('  line picker: open value found or created for a line the person modifies; read-only, hidden, closed refused: OK');
}

async function testAccessChanged(runner: QueryRunner, f: Fixture) {
  const file = csv(['item_number', 'notes'], [{ item_number: f.ref.L4, notes: 'Before the change' }]);
  const report = await as(runner, f.persons.marta, (m) => preflight(m, f, f.persons.marta, file));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  const changes = [
    { what: 'her company becomes read only', sql: `UPDATE user_data_access_nodes SET access = 'read' WHERE user_id = $1` },
    { what: 'her company leaves her access', sql: `DELETE FROM user_data_access_nodes WHERE user_id = $1` },
  ];
  for (const change of changes) {
    await runner.query('SAVEPOINT access_change');
    try {
      await runner.query(change.sql, [f.persons.marta]);
      await as(runner, f.persons.marta, async (m) => {
        await assert.rejects(load(m, f, f.persons.marta, file, report.snapshot), (err: any) => {
          assert.ok(err instanceof ConflictException, `${change.what}: ${err?.message}`);
          assert.equal(err.message, PREFLIGHT_STALE);
          return true;
        });
      });
      const [row] = await runner.query(`SELECT notes FROM spend_items WHERE id = $1`, [f.lines.L4]);
      assert.equal(row.notes, null, `${change.what}: nothing written`);
    } finally {
      await runner.query('ROLLBACK TO SAVEPOINT access_change');
    }
  }
  // A write the access refuses anyway (here, the write check of the item service) rolls back with the same 409.
  await as(runner, f.persons.marta, async (m) => {
    const refusing: BudgetFileItems = {
      create: async () => { throw new DataAccessLimitedException('refused'); },
      update: async () => { throw new DataAccessLimitedException('refused'); },
    };
    await assert.rejects(load(m, f, f.persons.marta, file, report.snapshot, refusing), (err: any) => err instanceof ConflictException && err.message === PREFLIGHT_STALE);
  });
  console.log('  access reduced between preflight and load: 409 "run the preflight again", nothing written: OK');
}

function testReservedOperations() {
  const reserved = (controller: any, method: string) => Reflect.getMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, controller.prototype[method]) === true;
  for (const [controller, methods] of [
    [SpendItemsController, ['copyBudgetColumn', 'clearBudgetColumn']],
    [CapexItemsController, ['copyBudgetColumn', 'clearBudgetColumn']],
    [BudgetLinesController, ['copyBudget', 'clearBudgetColumn']],
  ] as Array<[any, string[]]>) {
    for (const method of methods) assert.ok(reserved(controller, method), `${controller.name}.${method} is reserved (403 for a limited person)`);
    for (const method of ['exportBudgetFile', 'preflightBudgetFile', 'importBudgetFile']) {
      if (controller.prototype[method]) assert.ok(!reserved(controller, method), `${controller.name}.${method}: the budget file is not reserved`);
    }
  }
  console.log('  column copy and reset stay reserved (403); the budget file routes are not: OK');
}

async function testUnscoped(runner: QueryRunner, f: Fixture) {
  await as(runner, f.persons.ulla, async (m) => {
    const columns = ['item_number', 'name', 'company_name', 'account_number', 'currency', 'notes', `analytics:${f.a1}`];
    // L6 and L7 have no company: a file updates a line only with one (a rule of before).
    const rows = (['L1', 'L2', 'L3', 'L4', 'L5'] as Label[]).map((label) => ({ item_number: f.ref[label], notes: `Ulla ${label}` } as Record<string, string>));
    rows[0][`analytics:${f.a1}`] = 'Ulla closed value';
    rows.push({ name: 'DA 3C Ulla new', company_name: f.frName, account_number: '6000', currency: 'EUR' });
    const file = csv(columns, rows);
    const read = await readBudgetCsv(file, { language: 'en', dimensionCodes: [f.a1, f.a2] });
    const loaded = await loadPreflight(m, f.tenantId, interpretBudgetFile(read, 'opex').map((row) => row.itemNumber), null);
    assert.equal(loaded.access, undefined, 'no access object: the plan of before');
    const report = await preflight(m, f, f.persons.ulla, file);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.deepEqual([report.changes.created, report.changes.updated], [1, 5]);
    assert.equal(report.dataAccessLimited, undefined);
    assert.equal(report.snapshot.lines.some((line) => 'editable' in line), false);
    const written = await load(m, f, f.persons.ulla, file, report.snapshot);
    assert.deepEqual([written.ok, (written as any).inserted, (written as any).updated, (written as any).createdDimensionValues], [true, 1, 5, true]);
    assert.equal(await notesOf(m, f.lines.L1), 'Ulla L1', 'a line no limited person of the example modifies');
  });
  console.log('  unscoped: every line, closed values created, no access flag: the file of before: OK');
}

/**
 * Spec §6.8: the statistics of a large load run after the request's commit, on a pooled connection
 * of their own, as the application role. With a pool of one connection, the connection that ran a
 * limited transaction is the one `analyzeTables` gets: the role ended with the transaction.
 */
async function testStatisticsAfterLimitedTransaction(runner: QueryRunner) {
  const [after] = await runner.query(`SELECT current_user AS name`);
  assert.notEqual(after.name, LIMITED_ROLE, 'the limited role ends with its transaction');
  await runner.release();
  const report = await analyzeTables(dataSource, lineImportTables('opex'));
  assert.deepEqual(report.analysed.sort(), [...lineImportTables('opex')].sort(), JSON.stringify(report));
  assert.deepEqual(report.notOwned, []);
  console.log('  statistics after a limited person\'s load: ANALYZE runs as the application role on every table: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  let released = false;
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access budget file: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access budget file (lot 3, run 3C)');
    testReservedOperations();
    await runner.startTransaction();
    try {
      const f = await prepare(runner, await seed(clientOf(runner)));
      await testExport(runner, f);
      await testNumbers(runner, f);
      await testReadOnly(runner, f);
      await testCreatePlacement(runner, f);
      await testCentreChange(runner, f);
      await testDimensionValues(runner, f);
      await testPicker(runner, f);
      await testAccessChanged(runner, f);
      await testUnscoped(runner, f);
      await runner.query('SAVEPOINT limited_end');
      await applyDataAccess(runner, f.persons.marta);
      const [limited] = await runner.query(`SELECT current_user AS name`);
      assert.equal(limited.name, LIMITED_ROLE);
    } finally {
      await runner.rollbackTransaction();
    }
    released = true;
    await testStatisticsAfterLimitedTransaction(runner);
  } finally {
    if (!released) await runner.release();
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
