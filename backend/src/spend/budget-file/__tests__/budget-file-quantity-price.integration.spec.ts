import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { amountsService, assert, inRolledBackTransaction, runSpecs, seedCalendar, seedLine, seedTenant } from '../../__tests__/round-inputs.fixtures';
import { exportBudgetFile, loadBudgetFile, preflightBudgetFile, withCell } from '../../__tests__/budget-file.fixtures';
import { readEntryChecks } from '../../budget-line-entry-check';

// Lot B12b: the budget file's warning BUDGET_FILE_QUANTITY_PRICE_EXPECTED against what the line reads
// once the file is loaded (`readEntryChecks`, the rule of the list's "To check" column): the file
// warns of a column if and only if the load leaves it to check. Cases of the adversarial review: an
// end of validity moved later on an account that expects quantity and price brings back a year
// whose amounts are not built so; moved within its year, or the amounts left as they are, nothing.
// @database-spec

const YEAR = new Date().getFullYear();

async function seedAccounts(runner: QueryRunner, tenantId: string) {
  const [coa] = await runner.query(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'L', 'Local', 'FR') RETURNING id`, [tenantId]);
  const [tick] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected) VALUES ($1, $2, 621100, 'Temporary staff', true) RETURNING id`,
    [tenantId, coa.id]);
  const [company] = await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Paying Co', 'FR', 'Brest', $2) RETURNING id`, [tenantId, coa.id]);
  return { tick: tick.id as string, company: company.id as string };
}

async function warned(runner: QueryRunner, tenantId: string, csv: string): Promise<string[]> {
  const report = await preflightBudgetFile(runner.manager, 'opex', tenantId, csv);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  return (report.warnings.consistency ?? [])
    .filter((warning: any) => warning.code === 'BUDGET_FILE_QUANTITY_PRICE_EXPECTED')
    .map((warning: any) => String(warning.params?.columns));
}

async function columnsToCheck(runner: QueryRunner, tenantId: string, id: string): Promise<string[]> {
  const check = (await readEntryChecks(runner.manager, tenantId, [id])).get(id)!;
  return check.columns.map((column) => `${column.measure} ${column.year}`);
}

/** Preflight, load, read back, then undo the load: what the file said, and what the line reads. */
async function loaded(runner: QueryRunner, tenantId: string, id: string, csv: string, what: string) {
  await runner.query('SAVEPOINT file_case');
  try {
    const warnings = await warned(runner, tenantId, csv);
    const result: any = await loadBudgetFile(runner.manager, 'opex', tenantId, csv);
    assert.equal(result.updated, 1, `${what}: the line is updated (${JSON.stringify(result).slice(0, 300)})`);
    return { warnings, after: await columnsToCheck(runner, tenantId, id) };
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT file_case');
  }
}

async function testWarnsAsTheLineReads() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'qpfile');
    const accounts = await seedAccounts(runner, tenantId);
    const svc = amountsService('opex');
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Twenty', days_by_year: { [YEAR]: Array(12).fill('20'), [YEAR - 1]: Array(12).fill('20') } });
    const qpLines = (year: number) => [{
      label: 'Dev', quantity_unit: 'people', quantity: '1', unit_price: '300', price_basis: 'per_day', frequency: 'per_month', days_per_month: '5',
      period_start: `${year}-01-01`, period_end: `${year}-12-31`, working_day_profile_id: calendarId,
    }];

    // E: on the ticked account, ended last year; last year's Budget built as quantity × price, this
    // year's spread (after its end: not looked at). Not to check.
    const e = await seedLine(runner, 'opex', tenantId, YEAR - 1, {}, 1);
    await svc.bulkUpsert(e.versionId, { kind: 'lines', year: YEAR - 1, measure: 'planned', lines: qpLines(YEAR - 1) }, null, { manager: runner.manager });
    const [{ id: thisYear }] = await runner.query(
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, $3, $4::date, $5) RETURNING id`,
      [tenantId, e.itemId, `Y${YEAR}`, `${YEAR}-01-01`, YEAR]);
    await svc.bulkUpsert(thisYear, { kind: 'annual', year: YEAR, totals: { planned: 1200 } }, null, { manager: runner.manager });
    await runner.query(`UPDATE spend_items SET account_id = $2, disabled_at = $3, paying_company_id = $4 WHERE id = $1`,
      [e.itemId, accounts.tick, `${YEAR - 1}-06-30T12:00:00Z`, accounts.company]);
    assert.deepEqual(await columnsToCheck(runner, tenantId, e.itemId), [], 'E is not to check');

    // F: on the ticked account, this year's Budget built as quantity × price.
    const f = await seedLine(runner, 'opex', tenantId, YEAR, {}, 2);
    await svc.bulkUpsert(f.versionId, { kind: 'lines', year: YEAR, measure: 'planned', lines: qpLines(YEAR) }, null, { manager: runner.manager });
    await runner.query(`UPDATE spend_items SET account_id = $2, paying_company_id = $3 WHERE id = $1`, [f.itemId, accounts.tick, accounts.company]);
    assert.deepEqual(await columnsToCheck(runner, tenantId, f.itemId), [], 'F is not to check');

    const exportOf = (id: string) => exportBudgetFile(runner.manager, 'opex', tenantId, [id], { amountYears: `${YEAR - 1},${YEAR}`, columns: 'budget' });
    const cell = (csv: string, column: string) => {
      const [header, row] = csv.replace(/^﻿/, '').split('\n');
      return row.split(',')[header.split(',').indexOf(column)];
    };

    // The end moved to this year's end, nothing else: this year's spread Budget comes back.
    const extended = await loaded(runner, tenantId, e.itemId, withCell(await exportOf(e.itemId), 'end_of_validity', `${YEAR}-12-31`), 'extended');
    assert.deepEqual(extended, { warnings: [`Budget ${YEAR}`], after: [`planned ${YEAR}`] }, 'an end moved later: warned of the year it brings back');

    // The end moved within its year: nothing comes back.
    const sameYear = await loaded(runner, tenantId, e.itemId, withCell(await exportOf(e.itemId), 'end_of_validity', `${YEAR - 1}-12-31`), 'sameYear');
    assert.deepEqual(sameYear, { warnings: [], after: [] }, 'an end moved within its year: nothing');

    // Last year's Budget given another total, the end kept: that column.
    const lastYear = await loaded(runner, tenantId, e.itemId, withCell(await exportOf(e.itemId), `budget_${YEAR - 1}`, '5000'), 'lastYear');
    assert.deepEqual(lastYear, { warnings: [`Budget ${YEAR - 1}`], after: [`planned ${YEAR - 1}`] }, 'an amount written: its column');

    // F's Budget moved by one: the column is written as a total.
    const csvF = await exportOf(f.itemId);
    const moved = await loaded(runner, tenantId, f.itemId, withCell(csvF, `budget_${YEAR}`, (Number(cell(csvF, `budget_${YEAR}`)) + 1).toFixed(2)), 'moved');
    assert.deepEqual(moved, { warnings: [`Budget ${YEAR}`], after: [`planned ${YEAR}`] }, 'a total written on a column built as quantity × price');
    console.log('  the file warns of a column if and only if the load leaves it to check: OK');
  });
}

void runSpecs('budget-file-quantity-price.integration.spec', [
  ['the file warns as the line reads once loaded', testWarnsAsTheLineReads],
]);
