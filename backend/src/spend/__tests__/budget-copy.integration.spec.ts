import 'dotenv/config';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { BUDGET_OPERATION_RUNNING_CODE, lockTenantBudgetOperations } from '../budget-locks';
import { clearBudgetColumn, columnCopyParams, planColumnCopyRun } from '../budget-column-operations';
import { allocationCopyParams, runAllocationCopy } from '../budget-allocation-operations';
import {
  AUDIT_LABELS,
  amountsService,
  assert,
  captureAudit,
  findVersion,
  freezeColumn,
  inRolledBackTransaction,
  Kind,
  MEASURES,
  readLines,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedCalendar,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
  underSavepoint,
} from './round-inputs.fixtures';

// "Copy budget columns" and "Reset a column" of Budget administration (plan
// planning/budget-tab-redesign, lot OPS): one operation copies the amounts of a
// column, the allocations, or both, of all lines or of one nature, under one
// tenant lock and in one transaction. Its result is the result of the two
// operations of each nature run one after the other; their routes are
// unchanged. Each line answers with its BL number and its nature.

const YEAR = 2031;
const NEXT = YEAR + 1;
type Audit = ReturnType<typeof captureAudit>;

function operations(audit: Audit = captureAudit(), freeze: unknown = realFreeze()) {
  const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
  return new SpendBudgetOperationsService(undefined as any, undefined as any, undefined as any, undefined as any, audit as any, freeze as any, calculator);
}

type CopyBody = Record<string, unknown>;

const copy = (runner: QueryRunner, body: CopyBody, audit?: Audit, freeze?: unknown) =>
  operations(audit, freeze).copyBudget(body as any, null, { manager: runner.manager });

const AMOUNTS = { sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: 0 };

async function seedCompany(runner: QueryRunner, tenantId: string, name: string) {
  const [{ id }] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, name],
  );
  for (const year of [YEAR, NEXT]) {
    await runner.query(`INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount) VALUES ($1, $2, $3, 10)`, [tenantId, id, year]);
  }
  return id as string;
}

/** A version of `year` with twelve months of `planned`, an allocation method and its manual rows. */
async function seedYear(
  runner: QueryRunner, kind: Kind, tenantId: string, itemId: string, year: number,
  budget: string, method: string, rows: Array<[string, number]> = [],
) {
  const versionId = await seedVersion(runner, kind, tenantId, itemId, year, 'annual');
  await seedMonths(runner, kind, tenantId, versionId, year, { planned: repeat(budget, 12) });
  await runner.query(`UPDATE spend_versions SET allocation_method = $2, notes = 'Source notes' WHERE id = $1`, [versionId, method]);
  for (const [companyId, pct] of rows) {
    await runner.query(
      `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct, is_system_generated) VALUES ($1, $2, $3, $4, false)`,
      [tenantId, versionId, companyId, pct],
    );
  }
  return versionId;
}

/**
 * Lines of both natures:
 * - OPEX "Manual" (BL-1): a 2031 budget and a manual split, no 2032;
 * - OPEX "Filled" (BL-2): 2032 already holds a budget and a manual split;
 * - OPEX "Automatic" (BL-3): headcount in 2031; 2032 on IT users without a manual row (counts as empty);
 * - CAPEX "Equipment" (BL-500001, CPX-1): a 2031 budget and a manual split;
 * - CAPEX "Next only" (BL-500002, CPX-2): a 2032 version only.
 */
async function seedWorld(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const north = await seedCompany(runner, tenantId, 'North');
  const south = await seedCompany(runner, tenantId, 'South');
  const manual = await seedItem(runner, 'opex', tenantId, 1, 'Manual');
  await seedYear(runner, 'opex', tenantId, manual, YEAR, '100', 'manual_pct', [[north, 60], [south, 40]]);
  const filled = await seedItem(runner, 'opex', tenantId, 2, 'Filled');
  await seedYear(runner, 'opex', tenantId, filled, YEAR, '50', 'manual_pct', [[north, 100]]);
  await seedYear(runner, 'opex', tenantId, filled, NEXT, '70', 'manual_pct', [[south, 100]]);
  const automatic = await seedItem(runner, 'opex', tenantId, 3, 'Automatic');
  await seedYear(runner, 'opex', tenantId, automatic, YEAR, '10', 'headcount');
  await seedYear(runner, 'opex', tenantId, automatic, NEXT, '0', 'it_users');
  const equipment = await seedItem(runner, 'capex', tenantId, 1, 'Equipment');
  await seedYear(runner, 'capex', tenantId, equipment, YEAR, '1000', 'manual_pct', [[south, 100]]);
  const nextOnly = await seedItem(runner, 'capex', tenantId, 2, 'Next only');
  await seedYear(runner, 'capex', tenantId, nextOnly, NEXT, '5', 'default');
  return { tenantId, north, south, manual, filled, automatic, equipment, nextOnly };
}

async function allocationOf(runner: QueryRunner, kind: Kind, itemId: string, year: number) {
  const version = await findVersion(runner, kind, itemId, year);
  if (!version) return undefined;
  const [row] = await runner.query(
    `SELECT v.allocation_method,
            COALESCE((SELECT json_agg(json_build_array(a.company_id, a.allocation_pct::float8) ORDER BY a.allocation_pct DESC, a.company_id)
                      FROM spend_allocations a WHERE a.version_id = v.id AND NOT COALESCE(a.is_system_generated, false)), '[]'::json) AS rows
     FROM spend_versions v WHERE v.id = $1`,
    [version.id],
  );
  return row as { allocation_method: string; rows: Array<[string, number]> };
}

async function budgetOf(runner: QueryRunner, kind: Kind, itemId: string, year: number) {
  const version = await findVersion(runner, kind, itemId, year);
  return version ? readMeasure(runner, kind, version.id, 'planned', year) : undefined;
}

/** Every SQL statement the runner sends while `fn` runs. */
async function statementsOf<T>(runner: QueryRunner, fn: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return (original as any)(sql, ...rest);
  };
  try {
    return { result: await fn(), statements };
  } finally {
    (runner as any).query = original;
  }
}

const byName = (results: any[]) => Object.fromEntries(results.map((r) => [r.itemName, r]));

/** All: both natures, both parts, one tenant lock, the lines of both natures locked first; BL numbers and natures. */
async function testAllCopiesBothNatures() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-all');
    const body = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts: AMOUNTS, allocations: true };

    const preview = await copy(runner, { ...body, dryRun: true });
    assert.deepEqual([preview.success, preview.dryRun, preview.scope], [true, true, 'all']);
    const lines = byName(preview.results);
    assert.deepEqual(
      preview.results.map((r: any) => [r.itemName, r.nature, r.itemNumber, r.reference]).sort(),
      [
        ['Automatic', 'opex', 3, 'BL-3'], ['Equipment', 'capex', 500001, 'BL-500001'], ['Filled', 'opex', 2, 'BL-2'],
        ['Manual', 'opex', 1, 'BL-1'], ['Next only', 'capex', 500002, 'BL-500002'],
      ],
      'one entry per line with its own number (never the CPX number) and its nature',
    );
    assert.deepEqual(
      Object.fromEntries(preview.results.map((r: any) => [r.itemName, [r.amounts.skip, r.amounts.newValue, r.allocations.action]])),
      {
        Manual: [null, 1200, 'copy'],
        Filled: ['destination_filled', 840, 'skip_destination_has_data'],
        Automatic: [null, 120, 'copy'],
        Equipment: [null, 12000, 'copy'],
        'Next only': ['no_source', 60, 'skip_missing_source_version'],
      },
      'each part says what it does or why it skips',
    );
    // An automatic method without a manual row counts as empty: its method is replaced, and the preview says so.
    assert.deepEqual(
      [lines.Automatic.allocations.destinationMethod, lines.Automatic.allocations.resultMethod],
      ['it_users', 'headcount'],
    );
    assert.deepEqual(preview.summary, {
      lines: 5,
      amounts: { totalItems: 5, processed: 3, skipped: 2, errors: 0 },
      allocations: { totalItems: 5, processed: 3, skipped: 2, errors: 0 },
    });
    assert.equal(await findVersion(runner, 'opex', w.manual, NEXT), undefined, 'the preview writes nothing');

    const audit = captureAudit();
    const { result: done, statements } = await statementsOf(runner, () => copy(runner, body, audit));
    assert.equal(statements.filter((sql) => /pg_try_advisory_xact_lock/.test(sql)).length, 1, 'one tenant lock for both natures and parts');
    const bothNatures = statements.findIndex((sql) => /nature IN \('opex', 'capex'\) ORDER BY id FOR NO KEY UPDATE/.test(sql));
    const firstVersionLock = statements.findIndex((sql) => /FROM spend_versions WHERE tenant_id = \$1 AND id = ANY\(\$2::uuid\[\]\).*FOR NO KEY UPDATE/s.test(sql));
    assert.ok(bothNatures >= 0 && bothNatures < firstVersionLock, 'the lines of both natures are locked in one statement before any version');
    // No part locks a line of its own afterwards: each works on the lines held (`heldLines`).
    const lineLocks = statements.filter((sql) => /FROM spend_items WHERE tenant_id = \$1 AND id = ANY\(\$2::uuid\[\]\).*FOR NO KEY UPDATE/s.test(sql));
    assert.equal(lineLocks.length, 1, 'one statement locks lines, in id order');
    assert.deepEqual(done.summary, {
      lines: 5,
      amounts: { totalItems: 5, processed: 3, skipped: 2, errors: 0 },
      allocations: { totalItems: 5, processed: 3, skipped: 2, errors: 0 },
    });
    assert.deepEqual(byName(done.results).Manual.amounts.newValue, 1200, 'a real copy lists what it did');

    assert.deepEqual(await budgetOf(runner, 'opex', w.manual, NEXT), repeat('100.00', 12));
    assert.deepEqual(await budgetOf(runner, 'capex', w.equipment, NEXT), repeat('1000.00', 12));
    assert.deepEqual(await budgetOf(runner, 'opex', w.filled, NEXT), repeat('70.00', 12), 'a filled destination keeps its amounts');
    assert.deepEqual(await allocationOf(runner, 'opex', w.manual, NEXT), { allocation_method: 'manual_pct', rows: [[w.north, 60], [w.south, 40]] });
    assert.deepEqual(await allocationOf(runner, 'opex', w.filled, NEXT), { allocation_method: 'manual_pct', rows: [[w.south, 100]] }, 'a manual destination is kept');
    assert.deepEqual((await allocationOf(runner, 'opex', w.automatic, NEXT))!.allocation_method, 'headcount', 'an automatic destination takes the source method');
    assert.deepEqual(await allocationOf(runner, 'capex', w.equipment, NEXT), { allocation_method: 'manual_pct', rows: [[w.south, 100]] });

    // The copy rows of each part say which copy wrote them: its scope, the nature, the parts.
    const tagged = audit.entries.filter((e) => e.after?.operation === 'budget_column_copy' || e.after?.operation === 'allocation_copy');
    assert.ok(tagged.length >= 4);
    for (const entry of tagged) {
      const nature = entry.table.startsWith('capex_') ? 'capex' : 'opex';
      assert.deepEqual(entry.after.budgetCopy, { scope: 'all', nature, parts: ['amounts', 'allocations'] }, `${entry.table}: tagged`);
    }
    assert.ok(audit.entries.some((e) => e.table === AUDIT_LABELS.capex.items && e.recordId === w.equipment && e.after?.operation === 'budget_column_copy'));
  });
}

/** A frozen CAPEX column refuses the whole copy before anything is written; a failure late in the CAPEX allocations keeps nothing either. */
async function testFailureWritesNothing() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-fail');
    const body = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts: AMOUNTS, allocations: true };

    await freezeColumn(runner, 'capex', w.tenantId, NEXT, 'budget');
    await assert.rejects(
      () => underSavepoint(runner, () => copy(runner, body)),
      (err: unknown) => err instanceof ForbiddenException && /CAPEX/.test((err as Error).message),
      'the freeze refusal names the nature',
    );
    await assert.rejects(() => underSavepoint(runner, () => copy(runner, { ...body, dryRun: true })), ForbiddenException, 'the preview too');
    assert.equal(await findVersion(runner, 'opex', w.manual, NEXT), undefined, 'nothing written in OPEX');
    // OPEX alone is not held up by the CAPEX freeze; the allocations have no freeze.
    await underSavepoint(runner, async () => {
      await copy(runner, { ...body, scope: 'opex' });
      throw new Error('rolled back');
    }).catch((err) => assert.equal((err as Error).message, 'rolled back'));
    await underSavepoint(runner, async () => {
      await copy(runner, { ...body, amounts: null });
      throw new Error('rolled back');
    }).catch((err) => assert.equal((err as Error).message, 'rolled back'));
    await runner.query(`DELETE FROM freeze_states WHERE tenant_id = $1`, [w.tenantId]);

    // The last write of the copy (the CAPEX allocation) fails: the amounts of both natures and the OPEX allocations go with it.
    const failing = captureAudit((entry) => entry.table === AUDIT_LABELS.capex.allocations);
    await assert.rejects(() => underSavepoint(runner, () => copy(runner, body, failing)), /forced failure/);
    assert.ok(failing.entries.some((e) => e.table === AUDIT_LABELS.opex.items), 'the OPEX amounts were written before the failure');
    assert.ok(failing.entries.some((e) => e.table === AUDIT_LABELS.opex.allocations), 'and the OPEX allocations');
    assert.equal(await findVersion(runner, 'opex', w.manual, NEXT), undefined, 'the OPEX version created by the copy is rolled back');
    assert.equal(await findVersion(runner, 'capex', w.equipment, NEXT), undefined, 'the CAPEX one too');
    assert.deepEqual(await budgetOf(runner, 'opex', w.automatic, NEXT), repeat('0.00', 12), 'the OPEX amounts are rolled back');
    assert.equal((await allocationOf(runner, 'opex', w.automatic, NEXT))!.allocation_method, 'it_users', 'the OPEX allocations are rolled back');
  });
}

/** A per-day line: two people on `calendarId`, the whole source year. */
function consultantLine(calendarId: string) {
  return {
    label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '100', price_basis: 'per_day', frequency: 'per_month',
    days_per_month: null, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, working_day_profile_id: calendarId,
  };
}

/** Every nature is decided before any is written: a CAPEX calendar change to confirm refuses the copy before the OPEX amounts are written. */
async function testCalendarDecidedForBothNatures() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-calendar');
    const calendarId = await seedCalendar(runner, w.tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: repeat('20', 12) } });
    const lines = await seedItem(runner, 'capex', w.tenantId, 3, 'Per day');
    const versionId = await seedVersion(runner, 'capex', w.tenantId, lines, YEAR, 'annual');
    await amountsService('capex').bulkUpsert(versionId, { kind: 'lines', year: YEAR, measure: 'planned', lines: [consultantLine(calendarId)] }, null, { manager: runner.manager });
    const body = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts: AMOUNTS };

    const preview = await copy(runner, { ...body, dryRun: true });
    assert.deepEqual(byName(preview.results)['Per day'].amounts.calendarIssues.map((i: any) => i.kind), ['missing']);
    const audit = captureAudit();
    await assert.rejects(() => underSavepoint(runner, () => copy(runner, body, audit)), BadRequestException);
    assert.equal(audit.entries.length, 0, 'nothing written, OPEX included');
    assert.equal(await findVersion(runner, 'opex', w.manual, NEXT), undefined);

    await copy(runner, { ...body, amounts: { ...AMOUNTS, acceptCalendarChanges: true } });
    assert.deepEqual(await budgetOf(runner, 'opex', w.manual, NEXT), repeat('100.00', 12));
    const destination = (await findVersion(runner, 'capex', lines, NEXT))!;
    assert.equal((await readLines(runner, 'capex', destination.id, 'planned')).length, 1, 'the CAPEX lines travel as a reference');
  });
}

/** Amounts only: no allocation is touched; a created version takes the default method. Same year, another column: allowed. */
async function testAmountsOnly() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-amounts');
    const done = await copy(runner, { scope: 'opex', sourceYear: YEAR, destinationYear: NEXT, amounts: { ...AMOUNTS, percentageIncrease: 10 } });
    assert.deepEqual(Object.keys(done.summary).sort(), ['amounts', 'lines']);
    assert.ok(done.results.every((r: any) => r.amounts && !('allocations' in r) && r.nature === 'opex'));
    assert.deepEqual(await budgetOf(runner, 'opex', w.manual, NEXT), repeat('110.00', 12));
    assert.deepEqual(await allocationOf(runner, 'opex', w.manual, NEXT), { allocation_method: 'default', rows: [] });
    assert.equal((await allocationOf(runner, 'opex', w.automatic, NEXT))!.allocation_method, 'it_users');
    assert.equal(await findVersion(runner, 'capex', w.equipment, NEXT), undefined, 'CAPEX left alone');

    const sameYear = await copy(runner, {
      scope: 'opex', sourceYear: YEAR, destinationYear: YEAR, amounts: { sourceColumn: 'budget', destinationColumn: 'revision' },
    });
    assert.equal(sameYear.summary.amounts?.processed, 3);
    const version = (await findVersion(runner, 'opex', w.manual, YEAR))!;
    assert.deepEqual(await readMeasure(runner, 'opex', version.id, 'committed', YEAR), repeat('100.00', 12));
  });
}

/** Allocations only: no amount is written. */
async function testAllocationsOnly() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-allocations');
    const done = await copy(runner, { scope: 'capex', sourceYear: YEAR, destinationYear: NEXT, allocations: true });
    assert.deepEqual(Object.keys(done.summary).sort(), ['allocations', 'lines']);
    assert.ok(done.results.every((r: any) => r.allocations && !('amounts' in r) && r.nature === 'capex'));
    assert.deepEqual(await allocationOf(runner, 'capex', w.equipment, NEXT), { allocation_method: 'manual_pct', rows: [[w.south, 100]] });
    assert.deepEqual(await budgetOf(runner, 'capex', w.equipment, NEXT), repeat('0.00', 12), 'no amount copied');
    assert.equal(await findVersion(runner, 'opex', w.manual, NEXT), undefined, 'OPEX left alone');
  });
}

/** Both parts with overwrite: the filled destination takes the source amounts and split. */
async function testOverwrite() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-overwrite');
    const body = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts: AMOUNTS, allocations: true, overwrite: true };
    const preview = await copy(runner, { ...body, dryRun: true });
    const filled = byName(preview.results).Filled;
    assert.deepEqual([filled.amounts.skip, filled.amounts.newValue, filled.allocations.action], [null, 600, 'copy']);
    await copy(runner, body);
    assert.deepEqual(await budgetOf(runner, 'opex', w.filled, NEXT), repeat('50.00', 12));
    assert.deepEqual(await allocationOf(runner, 'opex', w.filled, NEXT), { allocation_method: 'manual_pct', rows: [[w.north, 100]] });
  });
}

/** Refusals: no part, allocations within one year, -100 %, an unknown scope, a column onto itself. */
async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    await seedWorld(runner, 'copy-refusals');
    const base = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, dryRun: true };
    const refused = async (body: CopyBody, message: RegExp) => {
      await assert.rejects(() => underSavepoint(runner, () => copy(runner, body)), (err: unknown) => err instanceof BadRequestException && message.test((err as Error).message), JSON.stringify(body));
    };
    await refused({ ...base }, /Choose what to copy/);
    await refused({ ...base, amounts: null, allocations: false }, /Choose what to copy/);
    await refused({ ...base, destinationYear: YEAR, allocations: true }, /Allocations belong to a year/);
    await refused({ ...base, destinationYear: YEAR, amounts: { sourceColumn: 'budget', destinationColumn: 'revision' }, allocations: true }, /Allocations belong to a year/);
    await refused({ ...base, amounts: { ...AMOUNTS, percentageIncrease: -100 } }, /above -100/);
    await refused({ ...base, amounts: { ...AMOUNTS, percentageIncrease: '-150' } }, /above -100/);
    await refused({ ...base, scope: 'both', allocations: true }, /scope must be/);
    await refused({ ...base, amounts: 'budget' }, /amounts must give/);
    await refused({ ...base, destinationYear: YEAR, amounts: AMOUNTS }, /onto itself/);
    await refused({ ...base, amounts: { ...AMOUNTS, sourceColumn: 'nope' } }, /sourceColumn must be one of/);
  });
}

/** Snapshot of what a copy leaves on the destination year: versions, months, records, lines, allocations. */
async function destinationState(runner: QueryRunner, tenantId: string) {
  const versions: Array<{ id: string; item: string; nature: string }> = await runner.query(
    `SELECT v.id, i.product_name AS item, i.nature FROM spend_versions v JOIN spend_items i ON i.id = v.spend_item_id
     WHERE v.tenant_id = $1 AND v.budget_year = $2 ORDER BY i.product_name`,
    [tenantId, NEXT],
  );
  const state: Record<string, unknown> = {};
  for (const version of versions) {
    const kind = version.nature as Kind;
    const [meta] = await runner.query(`SELECT version_name, input_grain::text AS input_grain, allocation_method, notes FROM spend_versions WHERE id = $1`, [version.id]);
    const months: Record<string, string[]> = {};
    for (const measure of MEASURES) months[measure] = await readMeasure(runner, kind, version.id, measure, NEXT);
    const records = Object.fromEntries(Object.entries(await readRecords(runner, kind, version.id)).map(([measure, r]) => [
      measure, { period: [r.period_start, r.period_end], method: r.method, profile: r.spread_profile_name, calculation: r.last_calculation, fte: r.fte },
    ]));
    const lines: Record<string, unknown> = {};
    for (const measure of Object.keys(records)) {
      lines[measure] = (await readLines(runner, kind, version.id, measure as any)).map(({ id: _id, tenant_id: _tenant, ...line }) => line);
    }
    const [{ rows }] = await runner.query(
      `SELECT COALESCE(json_agg(json_build_array(company_id, department_id, allocation_pct::text, is_system_generated) ORDER BY company_id, allocation_pct), '[]'::json) AS rows
       FROM spend_allocations WHERE version_id = $1`,
      [version.id],
    );
    state[`${version.nature}:${version.item}`] = { meta, months, records, lines, allocations: rows };
  }
  return state;
}

/** The result is the one of the two operations of each nature run one after the other: amounts, then allocations. */
async function testSameAsTheOperationsChained() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-chained');
    const service = (audit: Audit) => operations(audit);
    const run = async (fn: (audit: Audit) => Promise<unknown>) => {
      const audit = captureAudit();
      await runner.query('SAVEPOINT chained');
      try {
        await fn(audit);
        return { state: await destinationState(runner, w.tenantId), audit };
      } finally {
        await runner.query('ROLLBACK TO SAVEPOINT chained');
      }
    };
    for (const overwrite of [false, true]) {
      const amounts = { ...AMOUNTS, percentageIncrease: 3 };
      const unified = await run((audit) => copy(runner, { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts, allocations: true, overwrite }, audit));
      const chained = await run(async (audit) => {
        const column = { sourceYear: YEAR, destinationYear: NEXT, ...amounts, overwrite, dryRun: false };
        const allocations = { sourceYear: YEAR, destinationYear: NEXT, overwrite, dryRun: false };
        for (const nature of ['opex', 'capex'] as const) await service(audit).copyBudgetColumn(column as any, null, { manager: runner.manager, nature });
        for (const nature of ['opex', 'capex'] as const) await service(audit).copyAllocations(allocations, null, { manager: runner.manager, nature });
      });
      assert.ok(Object.keys(unified.state).length >= 5, 'the snapshot holds the lines');
      assert.deepEqual(unified.state, chained.state, `overwrite ${overwrite}: same destination as the two operations chained`);
      const shape = (audit: Audit) => audit.entries.map((e) => {
        const { budgetCopy: _tag, ...after } = (e.after ?? {}) as Record<string, unknown>;
        return JSON.stringify([e.table, e.action, after.operation ?? null, after.destinationColumn ?? null]);
      }).sort();
      assert.deepEqual(shape(unified.audit), shape(chained.audit), `overwrite ${overwrite}: the same audit rows`);
    }
  });
}

/** One bulk operation at a time: while another holds the tenant lock, a real copy or clear gets a 409; a preview goes through. */
async function testOperationRunning() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-lock');
    const other = dataSource.createQueryRunner();
    await other.connect();
    await other.startTransaction();
    try {
      await lockTenantBudgetOperations(other.manager, w.tenantId);
      const body = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts: AMOUNTS, allocations: true };
      const running = (err: unknown) => err instanceof ConflictException && (err.getResponse() as any)?.code === BUDGET_OPERATION_RUNNING_CODE;
      await assert.rejects(() => underSavepoint(runner, () => copy(runner, body)), running, 'a real copy is refused with operation_running');
      await assert.rejects(
        () => underSavepoint(runner, () => operations().clearBudgetColumns({ scope: 'all', year: YEAR, column: 'forecast' } as any, null, { manager: runner.manager })),
        running,
        'a reset too',
      );
      const preview = await copy(runner, { ...body, dryRun: true });
      assert.equal(preview.summary.lines, 5, 'a preview takes no lock');
    } finally {
      await other.rollbackTransaction();
      await other.release();
    }
  });
}

/** Reset in All: both natures cleared under one lock; a frozen CAPEX column refuses it with nothing cleared. */
async function testClearAll() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'clear-all');
    await freezeColumn(runner, 'capex', w.tenantId, YEAR, 'budget');
    const clear = (scope: string) => operations().clearBudgetColumns({ scope, year: YEAR, column: 'budget' } as any, null, { manager: runner.manager });
    await assert.rejects(
      () => underSavepoint(runner, () => clear('all')),
      (err: unknown) => err instanceof ForbiddenException && /CAPEX/.test((err as Error).message),
    );
    assert.deepEqual(await budgetOf(runner, 'opex', w.manual, YEAR), repeat('100.00', 12), 'nothing cleared in OPEX');
    await runner.query(`DELETE FROM freeze_states WHERE tenant_id = $1`, [w.tenantId]);

    const { result, statements } = await statementsOf(runner, () => clear('all'));
    assert.deepEqual(result, { success: true, scope: 'all', summary: { totalItems: 5, cleared: 4, skipped: 1, errors: 0 } });
    assert.equal(statements.filter((sql) => /pg_try_advisory_xact_lock/.test(sql)).length, 1, 'one tenant lock');
    for (const [kind, itemId] of [['opex', w.manual], ['opex', w.filled], ['opex', w.automatic], ['capex', w.equipment]] as Array<[Kind, string]>) {
      assert.deepEqual(await budgetOf(runner, kind, itemId, YEAR), repeat('0.00', 12), `${kind} ${itemId} cleared`);
    }
    assert.deepEqual(await budgetOf(runner, 'opex', w.filled, NEXT), repeat('70.00', 12), 'another year is untouched');
    await assert.rejects(() => underSavepoint(runner, () => clear('nope')), BadRequestException);
  });
}

/** The routes of each nature answer as before: no BL number, no skip reason, no line without a source version. */
async function testRoutesOfEachNatureUnchanged() {
  await inRolledBackTransaction(async (runner) => {
    await seedWorld(runner, 'copy-legacy');
    const column = await operations().copyBudgetColumn(
      { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: NEXT, destinationColumn: 'budget', percentageIncrease: 0, overwrite: false, dryRun: true },
      null,
      { manager: runner.manager, nature: 'capex' },
    );
    assert.deepEqual(column.summary, { totalItems: 2, processed: 1, skipped: 1, errors: 0 });
    assert.deepEqual(column.results.map((r: any) => Object.keys(r).sort()), [
      ['calendarIssues', 'currentDestinationValue', 'fromLines', 'itemId', 'itemName', 'newValue', 'prorated', 'skipped', 'sourceValue'],
    ], 'the line without a source version is not listed');
    const allocations = await operations().copyAllocations({ sourceYear: YEAR, destinationYear: NEXT, dryRun: true }, null, { manager: runner.manager, nature: 'capex' });
    assert.ok(allocations.results.length === 2 && allocations.results.every((r: any) => !('itemNumber' in r)));
    const real = await operations().copyAllocations({ sourceYear: YEAR, destinationYear: NEXT }, null, { manager: runner.manager, nature: 'capex' });
    assert.deepEqual([real.results, real.summary], [[], { totalItems: 2, processed: 1, skipped: 1, errors: 0 }]);
  });
}

/**
 * A real copy answers what its preview answered, line by line and part by part, with and without
 * overwrite: the lines whose destination version the amounts create during the copy included (their
 * allocations part reads the destination as before the copy, no version).
 */
async function testRealCopyAnswersAsPreview() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-as-preview');
    // A CAPEX line on an automatic method without a 2032 version: the amounts create it during the copy.
    const automatic = await seedItem(runner, 'capex', w.tenantId, 3, 'Automatic CAPEX');
    await seedYear(runner, 'capex', w.tenantId, automatic, YEAR, '40', 'headcount');
    for (const overwrite of [false, true]) {
      await runner.query('SAVEPOINT as_preview');
      try {
        const body = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts: { ...AMOUNTS, percentageIncrease: 5 }, allocations: true, overwrite };
        const preview = await copy(runner, { ...body, dryRun: true });
        const done = await copy(runner, body);
        const lines = byName(preview.results);
        assert.deepEqual([lines.Manual.allocations.destinationMethod, lines['Automatic CAPEX'].allocations.destinationMethod], [null, null], 'no 2032 version before the copy');
        assert.equal(done.results.length, preview.results.length, `overwrite ${overwrite}: as many lines`);
        preview.results.forEach((line: any, i: number) => {
          assert.deepEqual(done.results[i], line, `overwrite ${overwrite}: ${line.itemName} answered as in the preview`);
        });
        assert.deepEqual(done.summary, preview.summary, `overwrite ${overwrite}: same summary`);
        assert.equal((await allocationOf(runner, 'capex', automatic, NEXT))!.allocation_method, 'headcount', 'the copy itself is done');
      } finally {
        await runner.query('ROLLBACK TO SAVEPOINT as_preview');
      }
    }
  });
}

/**
 * The lines in play are locked first, in id order; a line that enters the scope after that lock (a
 * line created meanwhile) is not locked out of order: the operation is refused with a 409 `retry`
 * and writes nothing.
 */
async function testLineAfterTheLockRefused() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner, 'copy-held');
    const retry = (err: unknown) => err instanceof ConflictException && (err.getResponse() as any)?.code === 'retry';
    // Through the operation: a CAPEX line with a 2031 budget appears right after the lines are locked.
    const original = runner.query.bind(runner);
    let added: string | null = null;
    (runner as any).query = async (sql: string, ...rest: unknown[]) => {
      const answer = await (original as any)(sql, ...rest);
      if (!added && /nature IN \('opex', 'capex'\) ORDER BY id FOR NO KEY UPDATE/.test(sql)) {
        added = await seedItem(runner, 'capex', w.tenantId, 9, 'Created meanwhile');
        await seedYear(runner, 'capex', w.tenantId, added, YEAR, '10', 'default');
      }
      return answer;
    };
    try {
      const body = { scope: 'all', sourceYear: YEAR, destinationYear: NEXT, amounts: AMOUNTS, allocations: true };
      await assert.rejects(() => underSavepoint(runner, () => copy(runner, body)), retry, 'refused with a 409 retry');
    } finally {
      (runner as any).query = original;
    }
    assert.ok(added, 'harness: the line was created after the lock');
    assert.equal(await findVersion(runner, 'opex', w.manual, NEXT), undefined, 'nothing written');

    // Each part refuses a line outside the set its caller holds (the line above went with the savepoint).
    const extra = await seedItem(runner, 'capex', w.tenantId, 9, 'Created meanwhile');
    await seedYear(runner, 'capex', w.tenantId, extra, YEAR, '10', 'default');
    const held = new Set([w.manual, w.filled, w.automatic, w.equipment]);
    const deps = { manager: runner.manager, audit: captureAudit() as any, freeze: realFreeze() as any, calculator: new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any) };
    const params = columnCopyParams({ sourceYear: YEAR, destinationYear: NEXT, sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: 0, overwrite: false, dryRun: false });
    await assert.rejects(() => planColumnCopyRun(deps, 'capex', params, w.tenantId, { heldLines: held }), retry, 'the amounts');
    await assert.rejects(
      () => runAllocationCopy(deps, 'capex', allocationCopyParams({ sourceYear: YEAR, destinationYear: NEXT }), w.tenantId, null, { heldLines: held }),
      retry,
      'the allocations',
    );
    await assert.rejects(() => clearBudgetColumn(deps, 'capex', { year: YEAR, column: 'budget' }, null, { heldLines: held }), retry, 'the reset');
    // With the line held, each part goes through.
    const all = new Set([...held, extra]);
    const run = await planColumnCopyRun(deps, 'capex', params, w.tenantId, { heldLines: all });
    assert.equal(run.plans.length, 2, 'Equipment and the new line are planned');
  });
}

void runSpecs('budget-copy.integration.spec', [
  ['a real copy answers what its preview answered', testRealCopyAnswersAsPreview],
  ['a line entering the scope after the lock is refused', testLineAfterTheLockRefused],
  ['all copies both natures, one lock, BL numbers', testAllCopiesBothNatures],
  ['a failure writes nothing', testFailureWritesNothing],
  ['the calendar confirmation is decided for both natures first', testCalendarDecidedForBothNatures],
  ['amounts only', testAmountsOnly],
  ['allocations only', testAllocationsOnly],
  ['both parts with overwrite', testOverwrite],
  ['refusals', testRefusals],
  ['same as the two operations chained', testSameAsTheOperationsChained],
  ['operation running', testOperationRunning],
  ['reset in all', testClearAll],
  ['the routes of each nature are unchanged', testRoutesOfEachNatureUnchanged],
]);
