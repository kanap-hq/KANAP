import { QueryRunner } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { CapexAllocationCalculatorService } from '../../capex/capex-allocation-calculator.service';
import { CapexAllocationsService } from '../../capex/capex-allocations.service';
import { EDIT_CONFLICT_CODE } from '../../common/edit-conflicts';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { SpendAllocationsService } from '../spend-allocations.service';
import { seedCompany } from './cost-center.fixtures';
import { Kind, Measure, TABLES, amountsService, budgetOperations, freezeColumn, period, readLines, readMeasure, readRecords, realFreeze, repeat, seedItem, seedMonths, seedVersion } from './round-inputs.fixtures';
import { Outcome, Party, Race, assert, assertSucceeded, describe, httpStatus, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Edit conflicts of the budget and of the allocations (plan planning/perf-scale,
// lots 3D and 3E; decisions D2, D3, D5; Annexe A scenarios 4, 5, 6, 10, 11).
//
// The budget tab's saves carry what the user's edit started from (`base`):
// the value of each changed cell for a monthly entry, the column's twelve
// months (and its lines, for costed lines) for a yearly total, quarters or
// costed lines. Under the line's lock the server compares it with what is
// stored, and refuses a cell or column someone else changed meanwhile with
// 409 `edit_conflict` (who, when, the column now), nothing written. Two
// people on different months, or on different columns, never conflict.
// "Apply to all columns" sends no total for the other columns: the server
// spreads them from their stored totals. The Allocations tab saves method,
// driver and rows in one PUT with the signature it read; a stale one is a
// 409 and the version always keeps one split of 100 %.
//
// The parties are two people of the tenant, Marie Dupont and Jean Martin,
// whose saves go through the real audit trail: the 409 names who changed the
// column, from it.

const YEAR = 2026;
const realAudit = () => new AuditService(undefined as any);
const pad = (month: number) => String(month).padStart(2, '0');
const months12 = (value: string) => repeat(value, 12);

type Setup = { marie: string; jean: string; itemId: string; versionId: string };

async function seedPerson(runner: QueryRunner, tenantId: string, first: string, last: string): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Budget conflict race role', false, false, now(), now()) RETURNING id`,
    [tenantId, `Budget conflict role ${first}`],
  );
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, role.id, `${first.toLowerCase()}.${last.toLowerCase()}@budget-races.example`, first, last],
  );
  return user.id;
}

/** Marie and Jean, one line with its 2026 version: planned 100 and forecast 50 every month. */
async function setup(race: Race, kind: Kind, values: Partial<Record<Measure, string[]>> = { planned: months12('100'), forecast: months12('50') }): Promise<Setup> {
  return race.seedWith(async (runner) => {
    const marie = await seedPerson(runner, race.tenantId, 'Marie', 'Dupont');
    const jean = await seedPerson(runner, race.tenantId, 'Jean', 'Martin');
    const itemId = await seedItem(runner, kind, race.tenantId, 1, 'Budget conflict line');
    const versionId = await seedVersion(runner, kind, race.tenantId, itemId, YEAR);
    await seedMonths(runner, kind, race.tenantId, versionId, YEAR, values);
    return { marie, jean, itemId, versionId };
  });
}

/** One budget tab save of `userId`, on the party's request transaction. */
function save(race: Race, party: Party, kind: Kind, s: Setup, userId: string, body: Record<string, unknown>) {
  return race.start(party, (manager) => amountsService(kind, realAudit()).bulkUpsert(s.versionId, body, userId, { manager }));
}

type Cell = [month: number, measure: Measure, value: number | string];

/** A monthly entry of the cells; `base`: the value each cell started from. */
function monthly(cells: Cell[], base?: Cell[]) {
  const rows = (list: Cell[]) => {
    const byPeriod = new Map<string, Record<string, unknown>>();
    for (const [month, measure, value] of list) {
      const key = period(month, YEAR);
      byPeriod.set(key, { ...(byPeriod.get(key) ?? { period: key }), [measure]: value });
    }
    return Array.from(byPeriod.values());
  };
  return { kind: 'monthly', year: YEAR, months: rows(cells), ...(base ? { base: { months: rows(base) } } : {}) };
}

const supportLine = (quantity: string, unitPrice: string, label = 'Support') => ({
  label, quantity_unit: 'people', quantity, unit_price: unitPrice, price_basis: 'per_month', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`,
});

/** The 409 `edit_conflict` answer of a refused party. */
function conflictOf(outcome: Outcome, who: string): { conflicts: any[]; budget_rev?: number; base_signature?: string } {
  assert.ok(!outcome.ok, `${who} must be refused with 409 edit_conflict; it succeeded`);
  assert.equal(httpStatus(outcome.error), 409, `${who}: ${describe(outcome)}`);
  const body = (outcome.error as any).getResponse();
  assert.equal(body.code, EDIT_CONFLICT_CODE, `${who}: ${describe(outcome)}`);
  return body;
}

const total = (values: string[]) => values.reduce((sum, value) => sum + Number(value), 0);

/**
 * A pauses with the line locked (right after its first amounts statement, or
 * the given one), B starts and waits for the line; A commits, then B runs on
 * what A left.
 */
async function aThenB(
  race: Race,
  kind: Kind,
  start: (party: Party) => Promise<unknown>,
  next: (party: Party) => Promise<unknown>,
  hold = sql.insertInto(TABLES[kind].amounts),
  names: [string, string] = ['A (Marie)', 'B (Jean)'],
): Promise<[Outcome, Outcome]> {
  const a = await race.open(names[0]);
  const b = await race.open(names[1]);
  const paused = race.gate(a, { label: 'holds the line', when: 'after', match: hold });
  const aWork = start(a);
  assert.equal(await progress(aWork, { party: a, gate: paused }), 'gated', `harness: ${names[0]} must pause holding the line`);
  const bWork = next(b);
  assert.equal(await progress(bWork, { party: b }), 'blocked', `${names[1]} must wait for the line ${names[0]} holds`);
  paused.release();
  return [await settle(aWork), await settle(bWork)];
}

async function sameMonth(kind: Kind) {
  await withRace(`budget-cell-${kind}`, async (race) => {
    const s = await setup(race, kind);
    const [aDone, bDone] = await aThenB(
      race, kind,
      (a) => save(race, a, kind, s, s.marie, monthly([[3, 'planned', 150]], [[3, 'planned', 100]])),
      (b) => save(race, b, kind, s, s.jean, monthly([[3, 'planned', 175]], [[3, 'planned', 100]])),
    );
    assertSucceeded(aDone, 'A');
    const body = conflictOf(bDone, 'B');
    assert.equal(body.conflicts.length, 1);
    const [conflict] = body.conflicts;
    assert.equal(conflict.field, 'planned');
    assert.deepEqual(conflict.periods, [period(3, YEAR)]);
    assert.equal(conflict.current[2], '150.00', 'the answer holds the column now');
    assert.equal(conflict.mine[2], '175.00');
    assert.equal(conflict.changed_by?.name, 'Marie Dupont', 'the answer names who changed the month, from the audit trail');
    assert.ok(conflict.changed_at, 'and when');
    assert.equal(typeof body.budget_rev, 'number');
    const planned = await race.seedWith((runner) => readMeasure(runner, kind, s.versionId, 'planned', YEAR));
    assert.equal(planned[2], '150.00', 'B wrote nothing: the month keeps A\'s value');
  });
}

async function differentMonths() {
  await withRace('budget-months', async (race) => {
    const s = await setup(race, 'opex');
    const [aDone, bDone] = await aThenB(
      race, 'opex',
      (a) => save(race, a, 'opex', s, s.marie, monthly([[3, 'planned', 150]], [[3, 'planned', 100]])),
      (b) => save(race, b, 'opex', s, s.jean, monthly([[4, 'planned', 175]], [[4, 'planned', 100]])),
    );
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B');
    const planned = await race.seedWith((runner) => readMeasure(runner, 'opex', s.versionId, 'planned', YEAR));
    assert.deepEqual([planned[2], planned[3]], ['150.00', '175.00'], 'both months are saved');
  });
}

async function differentColumns() {
  await withRace('budget-columns', async (race) => {
    const s = await setup(race, 'opex');
    const [aDone, bDone] = await aThenB(
      race, 'opex',
      (a) => save(race, a, 'opex', s, s.marie, monthly([[3, 'planned', 150]], [[3, 'planned', 100]])),
      (b) => save(race, b, 'opex', s, s.jean, monthly([[3, 'forecast', 80]], [[3, 'forecast', 50]])),
    );
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B');
    const [planned, forecast] = await race.seedWith(async (runner) => [
      await readMeasure(runner, 'opex', s.versionId, 'planned', YEAR),
      await readMeasure(runner, 'opex', s.versionId, 'forecast', YEAR),
    ]);
    assert.deepEqual([planned[2], forecast[2]], ['150.00', '80.00'], 'both columns are saved');
  });
}

/** Scenario 6: a yearly total typed over a month someone else changed in the same column. */
async function yearlyTotalAgainstMonthly() {
  await withRace('budget-yearly', async (race) => {
    const s = await setup(race, 'opex');
    const [aDone, bDone] = await aThenB(
      race, 'opex',
      (a) => save(race, a, 'opex', s, s.marie, monthly([[3, 'planned', 400]], [[3, 'planned', 100]])),
      (b) => save(race, b, 'opex', s, s.jean, {
        kind: 'annual', year: YEAR, totals: { planned: '2400.00' }, base: { columns: { planned: { months: months12('100.00') } } },
      }),
    );
    assertSucceeded(aDone, 'A');
    const [conflict] = conflictOf(bDone, 'B').conflicts;
    assert.equal(conflict.field, 'planned');
    assert.deepEqual(conflict.periods, [period(3, YEAR)], 'the month that moved');
    assert.equal(total(conflict.current), 1500, 'the column now: eleven months of 100 and March at 400');
    assert.equal(total(conflict.mine), 2400, 'the yearly total B typed');
    assert.equal(conflict.changed_by?.name, 'Marie Dupont');
    const planned = await race.seedWith((runner) => readMeasure(runner, 'opex', s.versionId, 'planned', YEAR));
    assert.equal(total(planned), 1500, 'the twelve months of A are kept');
  });
  // The other way round: the yearly total first, then a month of the same column.
  await withRace('budget-yearly-first', async (race) => {
    const s = await setup(race, 'opex');
    const [aDone, bDone] = await aThenB(
      race, 'opex',
      (a) => save(race, a, 'opex', s, s.marie, {
        kind: 'annual', year: YEAR, totals: { planned: '2400.00' }, base: { columns: { planned: { months: months12('100') } } },
      }),
      (b) => save(race, b, 'opex', s, s.jean, monthly([[3, 'planned', 130]], [[3, 'planned', 100]])),
    );
    assertSucceeded(aDone, 'A');
    const [conflict] = conflictOf(bDone, 'B').conflicts;
    assert.equal(conflict.current[2], '200.00');
    assert.equal(conflict.changed_by?.name, 'Marie Dupont');
  });
}

/** Scenario 5: "apply the distribution to all columns" while someone changes another column. */
async function applyToAllKeepsOtherColumn() {
  await withRace('budget-apply-all', async (race) => {
    const s = await setup(race, 'opex');
    // B (Jean) changes the Forecast column first and holds the line; A (Marie) spreads Budget
    // over the year and applies it to Forecast too, without sending Forecast's total.
    const [bDone, aDone] = await aThenB(
      race, 'opex',
      (b) => save(race, b, 'opex', s, s.jean, monthly([[3, 'forecast', 350]], [[3, 'forecast', 50]])),
      (a) => save(race, a, 'opex', s, s.marie, {
        kind: 'annual', year: YEAR, totals: { planned: '2400.00' }, also_measures: ['forecast'],
        spread_profile_name: 'flat', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`,
        base: { columns: { planned: { months: months12('100') } } },
      }),
      sql.insertInto(TABLES.opex.amounts),
      ['B (Jean)', 'A (Marie)'],
    );
    assertSucceeded(bDone, 'B');
    assertSucceeded(aDone, 'A');
    const [planned, forecast, records] = await race.seedWith(async (runner) => [
      await readMeasure(runner, 'opex', s.versionId, 'planned', YEAR),
      await readMeasure(runner, 'opex', s.versionId, 'forecast', YEAR),
      await readRecords(runner, 'opex', s.versionId),
    ] as const);
    assert.equal(total(planned), 2400);
    assert.equal(total(forecast), 900, 'Forecast keeps B\'s change (600 + 300): it is spread from its stored total');
    assert.deepEqual(forecast, months12('75.00'), 'and takes A\'s distribution');
    assert.equal(records.forecast?.method, 'spread');
    assert.equal(records.forecast?.last_calculation?.total, '900.00');
  });
}

/** Scenario 4: two people edit the costed lines of the same column. */
async function costedLinesBothSides() {
  await withRace('budget-lines', async (race) => {
    const s = await setup(race, 'opex');
    const lines = (quantity: string, unitPrice: string) => ({
      kind: 'lines', year: YEAR, measure: 'forecast', lines: [supportLine(quantity, unitPrice)],
      base: { columns: { forecast: { months: months12('50'), lines: [] } } },
    });
    const [aDone, bDone] = await aThenB(
      race, 'opex',
      (a) => save(race, a, 'opex', s, s.marie, lines('1', '1000')),
      (b) => save(race, b, 'opex', s, s.jean, lines('3', '400')),
      sql.insertInto(TABLES.opex.lines),
    );
    assertSucceeded(aDone, 'A');
    const [conflict] = conflictOf(bDone, 'B').conflicts;
    assert.equal(conflict.field, 'forecast');
    assert.equal(total(conflict.current), 12000);
    assert.equal(conflict.current_lines?.length, 1, 'the answer holds the column\'s lines now');
    assert.equal(conflict.current_lines[0].unit_price, '1000');
    assert.equal(conflict.changed_by?.name, 'Marie Dupont');
    const stored = await race.seedWith((runner) => readLines(runner, 'opex', s.versionId, 'forecast'));
    assert.deepEqual(stored.map((l) => [Number(l.quantity), Number(l.unit_price)]), [[1, 1000]], 'A\'s lines are kept');
  });
  // Lines alone: A renames a line (the months do not move), B changes its quantity from the old lines.
  await withRace('budget-lines-label', async (race) => {
    const s = await setup(race, 'opex');
    await race.seedWith((runner) => amountsService('opex', realAudit()).bulkUpsert(
      s.versionId, { kind: 'lines', year: YEAR, measure: 'forecast', lines: [supportLine('1', '1000')] }, s.jean, { manager: runner.manager },
    ));
    const startedFrom = { months: months12('1000.00'), lines: [supportLine('1', '1000')] };
    const a = await race.open('A (Marie)');
    const b = await race.open('B (Jean)');
    const aDone = await settle(save(race, a, 'opex', s, s.marie, {
      kind: 'lines', year: YEAR, measure: 'forecast', lines: [supportLine('1', '1000', 'Support desk')], base: { columns: { forecast: startedFrom } },
    }));
    assertSucceeded(aDone, 'A');
    const bDone = await settle(save(race, b, 'opex', s, s.jean, {
      kind: 'lines', year: YEAR, measure: 'forecast', lines: [supportLine('2', '1000')], base: { columns: { forecast: startedFrom } },
    }));
    const [conflict] = conflictOf(bDone, 'B').conflicts;
    assert.deepEqual(conflict.periods, [], 'no month moved: the lines did');
    assert.equal(conflict.current_lines[0].label, 'Support desk');
    assert.equal(conflict.changed_by?.name, 'Marie Dupont', 'named from the audit row of the column\'s record');
  });
}

/** A base equal to what is stored, or the same change made twice, is no conflict. */
async function baseEqualToCurrent() {
  await withRace('budget-same', async (race) => {
    const s = await setup(race, 'opex');
    const [aDone, bDone] = await aThenB(
      race, 'opex',
      (a) => save(race, a, 'opex', s, s.marie, monthly([[3, 'planned', 300]], [[3, 'planned', 100]])),
      (b) => save(race, b, 'opex', s, s.jean, monthly([[3, 'planned', 300]], [[3, 'planned', 100]])),
    );
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B (the same value as A)');
    const c = await race.open('C');
    assertSucceeded(await settle(save(race, c, 'opex', s, s.jean, monthly([[3, 'planned', 320]], [[3, 'planned', '300.00']]))), 'a base equal to the stored value');
    assertSucceeded(await settle(save(race, c, 'opex', s, s.jean, {
      kind: 'annual', year: YEAR, totals: { forecast: 1200 }, base: { columns: { forecast: { months: months12('50.00') } } },
    })), 'a yearly total from the stored months');
    // Without a base, nothing is compared (the AI, the CSV imports, older clients): the last write wins, as before.
    assertSucceeded(await settle(save(race, c, 'opex', s, s.jean, monthly([[3, 'planned', 10]]))), 'no base');
    const planned = await race.seedWith((runner) => readMeasure(runner, 'opex', s.versionId, 'planned', YEAR));
    assert.equal(planned[2], '10.00');
  });
}

/* ---- Allocations (lot 3E) ---- */

function allocations(kind: Kind) {
  return kind === 'opex'
    ? new SpendAllocationsService(undefined as any, undefined as any, new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any), realAudit() as any)
    : new CapexAllocationsService(undefined as any, undefined as any, new CapexAllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any), realAudit() as any);
}

const ALLOCATIONS = { opex: 'spend_allocations', capex: 'capex_allocations' } as const;

async function seedAllocations(race: Race, kind: Kind, s: Setup) {
  return race.seedWith(async (runner) => {
    const companies: string[] = [];
    for (const [i, name] of ['Company 1', 'Company 2', 'Company 3'].entries()) {
      const { companyId } = await seedCompany(runner, race.tenantId, name, 7001 + i);
      await runner.query(
        `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users, turnover) VALUES ($1, $2, $3, $4, $5, $6)`,
        [race.tenantId, companyId, YEAR, [30, 10, 20][i], [30, 10, 20][i], [30, 10, 20][i]],
      );
      companies.push(companyId);
    }
    await runner.query(`UPDATE ${TABLES[kind].versions} SET allocation_method = 'manual_pct' WHERE id = $1`, [s.versionId]);
    await runner.query(
      `INSERT INTO ${ALLOCATIONS[kind]} (tenant_id, version_id, company_id, department_id, allocation_pct) VALUES ($1, $2, $3, NULL, 100)`,
      [race.tenantId, s.versionId, companies[0]],
    );
    return companies;
  });
}

/** Scenarios 10 and 11: two saves of one version's allocation, each method, driver and rows in one PUT. */
async function allocationsBothSides(kind: Kind) {
  await withRace(`allocations-put-${kind}`, async (race) => {
    const s = await setup(race, kind, {});
    const [c1, c2, c3] = await seedAllocations(race, kind, s);
    const read = await race.seedWith((runner) => allocations(kind).listForVersion(s.versionId, { manager: runner.manager, tenantId: race.tenantId }));
    const startedFrom = read.base_signature;
    assert.ok(startedFrom && read.method === 'manual_pct', 'the list gives the signature and the stored method');
    const put = (party: Party, userId: string, body: Record<string, unknown>) => race.start(party, (manager) => allocations(kind).put(s.versionId, body, userId, { manager, tenantId: race.tenantId }));

    // A (Marie) changes the method to "by company"; B (Jean) saves new percentages read with the old one.
    const [aDone, bDone] = await aThenB(
      race, kind,
      (a) => put(a, s.marie, { method: 'manual_company', driver: 'headcount', rows: [{ company_id: c1, department_id: null }, { company_id: c2, department_id: null }], base_signature: startedFrom }),
      (b) => put(b, s.jean, { method: 'manual_pct', rows: [{ company_id: c1, department_id: null, allocation_pct: 50 }, { company_id: c3, department_id: null, allocation_pct: 50 }], base_signature: startedFrom }),
      sql.insertInto(ALLOCATIONS[kind]),
    );
    assertSucceeded(aDone, 'A');
    const body = conflictOf(bDone, 'B');
    const [conflict] = body.conflicts;
    assert.equal(conflict.field, 'allocations');
    assert.equal(conflict.current.method, 'manual_company', 'the answer holds the allocation now');
    assert.equal(conflict.mine.method, 'manual_pct');
    assert.equal(conflict.changed_by?.name, 'Marie Dupont');
    assert.ok(body.base_signature && body.base_signature !== startedFrom, 'and the signature to overwrite it with');

    const stored = async () => race.seedWith(async (runner) => ({
      method: (await runner.query(`SELECT allocation_method FROM ${TABLES[kind].versions} WHERE id = $1`, [s.versionId]))[0].allocation_method,
      rows: await runner.query(`SELECT company_id, allocation_pct FROM ${ALLOCATIONS[kind]} WHERE version_id = $1`, [s.versionId]) as Array<{ company_id: string; allocation_pct: string }>,
    }));
    let now = await stored();
    assert.equal(now.method, 'manual_company', 'B\'s percentages were never read with A\'s method');
    assert.equal(now.rows.length, 2);
    assert.ok(Math.abs(total(now.rows.map((r) => r.allocation_pct)) - 100) < 0.01, 'one split of 100 %');

    // « Overwrite »: B sends again with the signature of the answer.
    const c = await race.open('B again');
    const overwrite = await settle(put(c, s.jean, {
      method: 'manual_pct', rows: [{ company_id: c1, department_id: null, allocation_pct: 50 }, { company_id: c3, department_id: null, allocation_pct: 50 }], base_signature: body.base_signature,
    }));
    assertSucceeded(overwrite, 'B overwriting');
    now = await stored();
    assert.equal(now.method, 'manual_pct');
    assert.deepEqual(now.rows.map((r) => `${r.company_id}:${Number(r.allocation_pct)}`).sort(), [`${c1}:50`, `${c3}:50`].sort());
    // The same change made twice is no conflict, even from a stale signature.
    assertSucceeded(await settle(put(c, s.marie, {
      method: 'manual_pct', rows: [{ company_id: c1, department_id: null, allocation_pct: 50 }, { company_id: c3, department_id: null, allocation_pct: 50 }], base_signature: startedFrom,
    })), 'the same allocation again');
  });
}

/** A column copy or clear writes no amounts audit row: its row on the line names who ran it. */
async function columnOperationsAreNamed() {
  await withRace('budget-column-ops', async (race) => {
    const s = await setup(race, 'opex');
    const ops = budgetOperations('opex', realAudit());
    await race.seedWith((runner) => ops.copyBudgetColumn({
      sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'forecast', percentageIncrease: 0, overwrite: true, dryRun: false,
    }, s.jean, { manager: runner.manager }));
    const party = await race.open('Marie');
    let [conflict] = conflictOf(await settle(save(race, party, 'opex', s, s.marie, monthly([[3, 'forecast', 80]], [[3, 'forecast', 50]]))), 'Marie after the copy').conflicts;
    assert.equal(conflict.current[2], '100.00');
    assert.equal(conflict.changed_by?.name, 'Jean Martin', 'the copy names who ran it');

    await race.seedWith((runner) => ops.clearBudgetColumn({ year: YEAR, column: 'forecast' }, s.jean, { manager: runner.manager }));
    [conflict] = conflictOf(await settle(save(race, party, 'opex', s, s.marie, monthly([[3, 'forecast', 80]], [[3, 'forecast', 100]]))), 'Marie after the clear').conflicts;
    assert.equal(conflict.current[2], '0.00');
    assert.equal(conflict.changed_by?.name, 'Jean Martin', 'the clear names who ran it');
  });
}

/** Removing costed lines leaves the months as stored: a month changed meanwhile is no conflict; lines changed meanwhile are. */
async function removingLinesComparesLinesOnly() {
  await withRace('budget-lines-removal', async (race) => {
    const s = await setup(race, 'opex');
    await race.seedWith((runner) => amountsService('opex', realAudit()).bulkUpsert(
      s.versionId, { kind: 'lines', year: YEAR, measure: 'forecast', lines: [supportLine('1', '1000')] }, s.jean, { manager: runner.manager },
    ));
    const startedFrom = { months: months12('1000.00'), lines: [supportLine('1', '1000')] };
    const party = await race.open('Parties');
    assertSucceeded(await settle(save(race, party, 'opex', s, s.marie, monthly([[3, 'forecast', 1200]], [[3, 'forecast', 1000]]))), 'Marie\'s month');
    assertSucceeded(await settle(save(race, party, 'opex', s, s.jean, {
      kind: 'lines', year: YEAR, measure: 'forecast', lines: [], base: { columns: { forecast: startedFrom } },
    })), 'removing the lines after a month changed');
    const [forecast, lines] = await race.seedWith(async (runner) => [
      await readMeasure(runner, 'opex', s.versionId, 'forecast', YEAR),
      await readLines(runner, 'opex', s.versionId, 'forecast'),
    ] as const);
    assert.equal(forecast[2], '1200.00', 'Marie\'s month stays');
    assert.equal(lines.length, 0);

    // Lines changed meanwhile: the removal is refused.
    await race.seedWith((runner) => amountsService('opex', realAudit()).bulkUpsert(
      s.versionId, { kind: 'lines', year: YEAR, measure: 'forecast', lines: [supportLine('1', '1000', 'Desk')] }, s.marie, { manager: runner.manager },
    ));
    const [conflict] = conflictOf(await settle(save(race, party, 'opex', s, s.jean, {
      kind: 'lines', year: YEAR, measure: 'forecast', lines: [], base: { columns: { forecast: { months: months12('1000.00'), lines: [] } } },
    })), 'removing lines someone else wrote').conflicts;
    assert.deepEqual(conflict.periods, []);
    assert.equal(conflict.current_lines[0].label, 'Desk');
  });
}

/** "Apply to all columns" with a frozen column is refused before any month is created or locked. */
async function applyToAllChecksFreezeFirst() {
  await withRace('budget-apply-all-frozen', async (race) => {
    const s = await setup(race, 'opex', {});
    await race.seedWith(async (runner) => {
      await runner.query(`DELETE FROM spend_amounts WHERE version_id = $1`, [s.versionId]);
      await freezeColumn(runner, 'opex', race.tenantId, YEAR, 'forecast');
    });
    const party = await race.open('Marie');
    // Paused at its first month written, if it ever writes one.
    const created = race.gate(party, { label: 'creates a month', when: 'before', match: sql.insertInto('spend_amounts') });
    const work = race.start(party, (manager) => amountsService('opex', realAudit(), realFreeze()).bulkUpsert(s.versionId, {
      kind: 'annual', year: YEAR, totals: { planned: '1200.00' }, also_measures: ['forecast'], spread_profile_name: 'flat',
    }, s.marie, { manager }));
    assert.equal(await progress(work, { party, gate: created }), 'settled', 'the spread is refused before any month is created or locked');
    const done = await settle(work);
    assert.ok(!done.ok && httpStatus(done.error) === 403, `a frozen column refuses the spread (403, frozen): ${describe(done)}`);
  });
}

/** A PUT whose rows are not allocation rows is a 400, never a 500. */
async function putRefusesMalformedRows() {
  await withRace('allocations-put-rows', async (race) => {
    const s = await setup(race, 'opex', {});
    const party = await race.open('Marie');
    for (const rows of [[null], [{ company_id: 'not-an-id', allocation_pct: 100 }], [{ company_id: 12 }], 'all']) {
      const done = await settle(race.start(party, (manager) => allocations('opex').put(s.versionId, { method: 'manual_pct', rows }, s.marie, { manager, tenantId: race.tenantId })));
      assert.ok(!done.ok && httpStatus(done.error) === 400, `rows ${JSON.stringify(rows)} must be refused with 400: ${describe(done)}`);
    }
  });
}

void runRaceSpecs('Budget and allocation edit conflicts (lots 3D, 3E)', [
  ['3D: the same month on both sides, the second save is refused with who and when (OPEX)', () => sameMonth('opex')],
  ['3D: the same month on both sides, the second save is refused with who and when (CAPEX)', () => sameMonth('capex')],
  ['3D: two months of one column on both sides are both saved', differentMonths],
  ['3D: two columns of one month on both sides are both saved', differentColumns],
  ['Annexe A #6: a yearly total against a monthly edit of the same column is refused, both ways', yearlyTotalAgainstMonthly],
  ['Annexe A #5: "apply to all columns" keeps a concurrent edit of another column', applyToAllKeepsOtherColumn],
  ['Annexe A #4: costed lines edited on both sides, the second is refused (months or lines)', costedLinesBothSides],
  ['3D: a base equal to the stored value, or the same change twice, is no conflict; no base compares nothing', baseEqualToCurrent],
  ['Annexe A #10, #11: allocation PUTs on both sides, the second is refused, one split of 100 % (OPEX)', () => allocationsBothSides('opex')],
  ['Annexe A #10, #11: allocation PUTs on both sides, the second is refused, one split of 100 % (CAPEX)', () => allocationsBothSides('capex')],
  ['3D: a column copy or clear names who ran it', columnOperationsAreNamed],
  ['3D: removing costed lines compares the lines only', removingLinesComparesLinesOnly],
  ['3D: "apply to all columns" checks the freeze before it creates a month', applyToAllChecksFreezeFirst],
  ['3E: a PUT with malformed rows is a 400', putRefusesMalformedRows],
]);
