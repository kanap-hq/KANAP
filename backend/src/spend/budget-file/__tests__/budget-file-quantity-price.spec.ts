import * as assert from 'node:assert/strict';
import { readBudgetCsv } from '../interpret';
import { planBudgetFile } from '../preflight';
import { emptyCatalog, emptyMonths, StoredLine, StoredVersion } from '../types';
import type { AmountMeasure } from '../../amounts-write.util';

// Lot B12b of 26.12.1: the budget file writes totals, never quantity × price, so its check warns of
// each row that writes an amount on an account expecting quantity and price entry (itself or through
// its consolidation account: the catalog's `quantityPrice`, read by `loadCatalog` with the rule of
// lot B12a and compared with it in `budget-line-entry-check.integration.spec.ts`). A warning among the
// consistency checks, one per row: the account by its number (never the consolidation account), the
// columns to complete by their names on screen and year. Never for an unchanged amount, a zero, a
// column hidden in the settings or after the line's end of validity; a frozen column is refused, as
// before. A line the file moves onto such an account from one that expects nothing is told of the
// columns it holds that are not built as quantity × price, even with no amount in the file (frozen
// ones left out); between two accounts that expect it, nothing more. Pure: the check reads no database.

const YEAR = 2026;
const CODE = 'BUDGET_FILE_QUANTITY_PRICE_EXPECTED';
const SHOWN: AmountMeasure[] = ['planned', 'committed', 'actual', 'expected_landing'];

const CATALOG = emptyCatalog({
  companies: [{ id: 'c1', name: 'Paying Co', coaId: null, disabledAt: null, baseCurrency: 'EUR' }],
  accounts: [
    // Ticked itself, or through its consolidation account: the catalog says it the same way.
    { id: 'tick', number: '621100', coaId: null, disabledAt: null, quantityPrice: true },
    { id: 'cons', number: '622100', coaId: null, disabledAt: null, quantityPrice: true },
    { id: 'none', number: '623000', coaId: null, disabledAt: null },
    { id: 'other', number: '624000', coaId: null, disabledAt: null },
  ],
  frozen: [`opex:${YEAR + 1}:budget`],
  shownMeasures: SHOWN,
});

function version(year: number, months: Partial<Record<AmountMeasure, number[]>>, rounds?: StoredVersion['rounds']): StoredVersion {
  const cells = emptyMonths();
  for (const [measure, values] of Object.entries(months) as Array<[AmountMeasure, number[]]>) {
    values.forEach((value, index) => { cells[measure][index] = { cents: BigInt(Math.round(value * 100)) }; });
  }
  return { id: `v${year}`, year, budgetRev: 1, months: cells, ...(rounds ? { rounds } : {}) };
}

function stored(itemNumber: number, accountId: string | null, versions: StoredVersion[], endOfValidity: string | null = null): StoredLine {
  return {
    id: `L${itemNumber}`, nature: 'opex', itemNumber, legacyNumber: null, rowVersion: 1, name: `Stored ${itemNumber}`,
    description: null, companyId: 'c1', companyName: 'Paying Co', supplierId: null, supplierName: null, supplierErpId: null,
    accountId, accountNumber: CATALOG.accounts.find((account) => account.id === accountId)?.number ?? null,
    costCenterId: null, costCenterCode: null, costCenterPath: null, runBuild: null, analytics: {},
    ownerItEmail: null, ownerBusinessEmail: null, projectNumber: null, currency: 'EUR',
    effectiveStart: '2020-01-01', endOfValidity, notes: null, versions,
  };
}

/** Built as quantity × price, its lines giving 1 200 over the year: the Budget tab's column. */
const QP_ROUND = { planned: { method: 'computed' as const, lineCount: 2, linesTotal: 120000n } };

const STORED: StoredLine[] = [
  // 101: on the ticked account, its budget built as quantity × price (1 200).
  stored(101, 'tick', [version(YEAR, { planned: Array(12).fill(100) }, QP_ROUND)]),
  // 102: on an account that expects nothing, a spread budget of 1 200.
  stored(102, 'none', [version(YEAR, { planned: Array(12).fill(100) })]),
  // 103: on the ticked account, entered by month (100 in January and February).
  stored(103, 'tick', [version(YEAR, { committed: [100, 100] })]),
  // 104: on the ticked account, ended in the previous year.
  stored(104, 'tick', [], `${YEAR - 1}-06-30T12:00:00.000Z`),
  // 105: on an account that expects nothing, a spread budget this year and one next year (frozen).
  stored(105, 'none', [version(YEAR, { planned: Array(12).fill(100) }), version(YEAR + 1, { planned: Array(12).fill(75) })]),
  // 106: on an account that expects nothing, its budget built as quantity × price.
  stored(106, 'none', [version(YEAR, { planned: Array(12).fill(100) }, QP_ROUND)]),
  // 107: on an account ticked through its consolidation account, a spread budget (already to check).
  stored(107, 'cons', [version(YEAR, { planned: Array(12).fill(100) })]),
  // 108: on an account that expects nothing, a spread budget and a revision entered by month.
  stored(108, 'none', [version(YEAR, { planned: Array(12).fill(100), committed: [50] })]),
];

const HEADER = `item_number,nature,name,company_name,account_number,currency,budget_${YEAR},revision_${YEAR},forecast_${YEAR},budget_${YEAR + 1}`;

async function check(rows: string[], header = HEADER) {
  const read = await readBudgetCsv(`${[header, ...rows].join('\n')}\n`, { language: 'en', dimensionCodes: [] });
  return planBudgetFile({
    scope: 'opex', read, catalog: CATALOG, stored: STORED, names: [],
    createSuppliers: false, canCreateSuppliers: false, canReadSuppliers: true, canReadCompanies: true,
    currentYear: YEAR, labels: { budget: 'Budget', revision: 'Revision', forecast: 'Forecast' },
  }).report;
}

const warnings = (report: Awaited<ReturnType<typeof check>>) =>
  (report.warnings.consistency ?? []).filter((warning) => warning.code === CODE).map((warning) => [warning.line, warning.message, warning.params]);

async function testRowsThatWarn() {
  const report = await check([
    // A new line on the ticked account: its budget will be to check.
    `,opex,New on the account,Paying Co,621100,EUR,1200,,,`,
    // A new line on an account ticked through its consolidation account: the line's own account is named.
    `,opex,New on the consolidation,Paying Co,622100,EUR,500,300,,`,
    // 101 changes the total its lines build: no longer quantity × price.
    `BL-101,opex,Stored 101,,,,1500,,,`,
    // 102 moves onto the ticked account and changes its budget.
    `BL-102,opex,Stored 102,,621100,,900,,,`,
  ]);
  assert.equal(report.ok, true, 'a warning, never a refusal');
  assert.deepEqual(warnings(report), [
    [2, `Account 621100 expects quantity and price entry: complete Budget ${YEAR} on the line's Budget tab.`, { account: '621100', columns: `Budget ${YEAR}` }],
    [3, `Account 622100 expects quantity and price entry: complete Budget ${YEAR}, Revision ${YEAR} on the line's Budget tab.`,
      { account: '622100', columns: `Budget ${YEAR}, Revision ${YEAR}` }],
    [4, `Account 621100 expects quantity and price entry: complete Budget ${YEAR} on the line's Budget tab.`, { account: '621100', columns: `Budget ${YEAR}` }],
    [5, `Account 621100 expects quantity and price entry: complete Budget ${YEAR} on the line's Budget tab.`, { account: '621100', columns: `Budget ${YEAR}` }],
  ]);
  assert.equal(report.warnings.consistencyCount, (report.warnings.consistency ?? []).length, 'counted with the other consistency warnings');
  console.log('  a new line, an account ticked through its consolidation account, a changed total, a line moved onto the account: one warning each: OK');
}

async function testRowsThatDoNotWarn() {
  const report = await check([
    // 101 unchanged: its column stays quantity × price.
    `BL-101,opex,Stored 101,,,,1200,,,`,
    // A new line on an account that expects nothing.
    `,opex,New elsewhere,Paying Co,623000,EUR,1200,,,`,
    // A zero total; the Forecast column hidden in the settings.
    `,opex,New at zero,Paying Co,621100,EUR,0,,800,`,
    // 102 moves off to no expected account, its budget changed.
    `BL-102,opex,Stored 102,,623000,,700,,,`,
    // 104 ended last year: its column of this year is not to check.
    `BL-104,opex,Stored 104,,,,400,,,`,
  ]);
  assert.equal(report.ok, true);
  assert.deepEqual(warnings(report), [], JSON.stringify(report.warnings.consistency));
  console.log('  an unchanged amount, another account, a zero, a hidden column, after the end of validity: no warning: OK');
}

async function testAccountMoves() {
  const report = await check([
    // 105 onto the ticked account, no amount in the file: its budget of this year (next year's is frozen).
    `BL-105,opex,Stored 105,,621100,,,,,`,
    // 108 onto an account ticked through its consolidation account: both its columns, named once.
    `BL-108,opex,Stored 108,,622100,,,,,`,
    // 102 onto the ticked account with its budget changed too: one warning, the column once.
    `BL-102,opex,Stored 102,,621100,,900,,,`,
  ]);
  assert.equal(report.ok, true);
  assert.deepEqual(warnings(report), [
    [2, `Account 621100 expects quantity and price entry: complete Budget ${YEAR} on the line's Budget tab.`, { account: '621100', columns: `Budget ${YEAR}` }],
    [3, `Account 622100 expects quantity and price entry: complete Budget ${YEAR}, Revision ${YEAR} on the line's Budget tab.`,
      { account: '622100', columns: `Budget ${YEAR}, Revision ${YEAR}` }],
    [4, `Account 621100 expects quantity and price entry: complete Budget ${YEAR} on the line's Budget tab.`, { account: '621100', columns: `Budget ${YEAR}` }],
  ]);
  const quiet = await check([
    // 105 onto another account that expects nothing.
    `BL-105,opex,Stored 105,,624000,,,,,`,
    // 106 onto the ticked account: every amount already built as quantity × price.
    `BL-106,opex,Stored 106,,621100,,,,,`,
    // 107 from one expected account to another, no amount changed: the line already was to check.
    `BL-107,opex,Stored 107,,621100,,,,,`,
  ]);
  assert.equal(quiet.ok, true);
  assert.deepEqual(warnings(quiet), [], JSON.stringify(quiet.warnings.consistency));
  console.log('  a line moved onto an expected account, amounts or not, frozen columns left out; another account, quantity × price, already expected: OK');
}

async function testFrozenColumnRefused() {
  const report = await check([`,opex,New frozen,Paying Co,621100,EUR,,,,900`]);
  assert.equal(report.ok, false, 'a frozen column is refused, as before');
  assert.deepEqual(report.errors.map((error) => error.code), ['BUDGET_FILE_FROZEN']);
  assert.deepEqual(warnings(report), [], 'and not warned of');
  console.log('  a frozen column: refused, not warned of: OK');
}

async function testMonthlyAmounts() {
  const header = `item_number,nature,name,revision_${YEAR}_01,revision_${YEAR}_02`;
  // 103's revision by month, January kept at 100 and February at -100: the year nets to zero.
  const netZero = await check([`BL-103,opex,Stored 103,100,-100`], header);
  assert.deepEqual(warnings(netZero), [], 'a year that nets to zero once written');
  // February changed alone: the year once written still holds January's stored 100.
  const changed = await check([`BL-103,opex,Stored 103,100,250`], header);
  assert.deepEqual(warnings(changed).map(([line, , params]) => [line, params]), [[2, { account: '621100', columns: `Revision ${YEAR}` }]]);
  console.log('  monthly amounts: the stored months kept, a year netting to zero not warned of: OK');
}

async function main() {
  await testRowsThatWarn();
  await testRowsThatDoNotWarn();
  await testAccountMoves();
  await testFrozenColumnRefused();
  await testMonthlyAmounts();
  console.log('budget-file-quantity-price.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
