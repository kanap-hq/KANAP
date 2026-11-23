import * as assert from 'node:assert/strict';
import { readBudgetCsv } from '../interpret';
import { planBudgetFile, type BudgetFileAccess } from '../preflight';
import { emptyCatalog, LineHint, StoredLine } from '../types';

// Lot I6b of 26.12.1, decision P10: for a person who imports a budget file without reading the
// suppliers or the companies, the check's messages name only what the file writes. Every stored
// name below is absent from the file (a name written in another case counts as absent: the stored
// spelling is not the person's). Nothing of them may reach the report, its texts or its fields:
// the dialog and Kad's card show that report, and the model reads it. A person who reads both
// lists gets today's messages. Each right holds for its own list: the mixed cases below read one
// list and not the other, update a stored line and carry Kad's proposals. Pure: the check reads no
// database.

const HIDDEN = ['Hidden Holding SA', 'Zephyr Supplies', 'Boreal Old Supplier', 'Median Partner', 'Closed Co', 'Known Supplier', 'Gone Vendor'];

const CATALOG = emptyCatalog({
  companies: [
    { id: 'c1', name: 'Hidden Holding SA', coaId: null, disabledAt: null, baseCurrency: 'EUR' },
    { id: 'c2', name: 'Paying Co', coaId: null, disabledAt: null, baseCurrency: 'USD' },
    { id: 'c3', name: 'Closed Co', coaId: null, disabledAt: '2020-01-01T00:00:00.000Z' },
  ],
  costCenters: [{ id: 'cc1', code: 'CC-1', kind: 'cost_center', companyId: 'c1', disabledAt: null }],
  accounts: [{ id: 'a1', number: '612200', coaId: null, disabledAt: null }],
  suppliers: [
    { id: 's1', name: 'Zephyr Supplies', erpId: 'V1', disabledAt: null },
    { id: 's2', name: 'Boreal Old Supplier', erpId: 'V2', disabledAt: '2020-01-01T00:00:00.000Z' },
    { id: 's3', name: 'Median Partner', erpId: 'V3', disabledAt: null },
    { id: 's4', name: 'Known Supplier', erpId: null, disabledAt: null },
    { id: 's5', name: 'Gone Vendor', erpId: null, disabledAt: '2020-01-01T00:00:00.000Z' },
  ],
});

// Three lines of Median Partner at 1 000 in 2026: a row at 100 000 is far from their median.
const NAMES: LineHint[] = [1, 2, 3].map((n) => ({
  nature: 'opex', itemNumber: 100 + n, name: `Stored line ${n}`, supplierId: 's3', id: `l${n}`, companyId: 'c9', currency: 'USD',
  years: [{ year: 2026, versionId: `v${n}`, budgetRev: 1, totals: { planned: 100000n } }],
}));

const FILE = [
  'item_number,nature,name,company_name,account_number,supplier_name,supplier_erp_id,cost_center_code,currency,budget_2026',
  // Another company than the cost center's; a supplier name other than V1's; a currency other than the company's.
  ',opex,Row A,Paying Co,612200,Other Name,V1,CC-1,EUR,100',
  // The supplier of V2 is disabled.
  ',opex,Row B,Paying Co,612200,,V2,,EUR,100',
  // The cost center's company pays (not written); far from the median of V3's lines; a currency other than that company's.
  ',opex,Row C,,612200,,V3,CC-1,USD,100000',
  // A disabled company, written in another case.
  ',opex,Row D,closed co,612200,,,,EUR,100',
  // An unknown ERP id beside a supplier's name, written in another case.
  ',opex,Row E,Paying Co,612200,known supplier,NEW-9,,EUR,100',
  // A disabled supplier, written in another case.
  ',opex,Row F,Paying Co,612200,gone vendor,,,EUR,100',
].join('\n');

async function check(reads: boolean) {
  const read = await readBudgetCsv(`${FILE}\n`, { language: 'en', dimensionCodes: [] });
  return planBudgetFile({
    scope: 'opex', read, catalog: CATALOG, stored: [], names: NAMES,
    createSuppliers: false, canCreateSuppliers: false,
    canReadSuppliers: reads, canReadCompanies: reads,
    currentYear: 2026, labels: { budget: 'Budget' },
  }).report;
}

type Report = Awaited<ReturnType<typeof check>>;

function sentences(report: Report) {
  return [
    ...report.errors.map((error) => [error.line, error.column, error.code, error.message]),
    ...report.warnings.supplierNames.map((warning) => [warning.line, 'supplier_name', warning.code, warning.message]),
    ...(report.warnings.costCenterCompanies ?? []).map((warning) => [warning.line, 'company_name', warning.code, warning.message]),
    ...(report.warnings.consistency ?? []).map((warning) => [warning.line, null, warning.code, warning.message]),
  ];
}

// Without the right to read the suppliers and the companies: no stored name anywhere in the report.
async function testNothingNamedWithoutTheLists() {
  const report = await check(false);
  const serialized = JSON.stringify(report);
  for (const name of HIDDEN) assert.equal(serialized.includes(name), false, `${name} is named: ${serialized}`);
  assert.deepEqual(sentences(report), [
    [3, 'supplier_erp_id', 'BUDGET_FILE_SUPPLIER_ERP_DISABLED', 'The supplier for ERP id \'V2\' is disabled.'],
    [5, 'company_name', 'BUDGET_FILE_DISABLED', 'Company \'closed co\' is disabled.'],
    [6, 'supplier_erp_id', 'BUDGET_FILE_SUPPLIER_ERP_UNKNOWN',
      'ERP id \'NEW-9\' is unknown and \'known supplier\' is already a supplier. Add the ERP id in Master data > Suppliers or leave it empty.'],
    [7, 'supplier_name', 'BUDGET_FILE_DISABLED', 'Supplier \'gone vendor\' is disabled.'],
    [2, 'supplier_name', 'BUDGET_FILE_SUPPLIER_NAME_DIFFERS_UNREAD', 'supplier_name \'Other Name\' does not match the supplier for ERP id \'V1\'.'],
    [2, 'company_name', 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY_UNREAD', 'Cost center CC-1 belongs to another company. The line is paid by Paying Co.'],
    [2, null, 'BUDGET_FILE_CURRENCY_NOT_COMPANY_UNREAD', 'EUR is not the currency of the paying company (USD).'],
    [4, null, 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER_UNREAD', 'Budget 2026 at 100 000, against a median of 1 000 on 3 lines of the same supplier.'],
    [4, null, 'BUDGET_FILE_CURRENCY_NOT_COMPANY_UNREAD', 'USD is not the currency of the paying company (EUR).'],
  ]);
  // The row of another company than its cost center's carries no name of the cost center's company.
  assert.equal(report.warnings.costCenterCompanies?.[0].costCenterCompany, undefined);
  console.log('  without the suppliers and the companies: only the file\'s values are named: OK');
}

// With both lists: today's messages, which name the stored records.
async function testTodaysMessagesWithTheLists() {
  const report = await check(true);
  assert.deepEqual(sentences(report), [
    [3, 'supplier_name', 'BUDGET_FILE_DISABLED', 'Supplier \'Boreal Old Supplier\' is disabled.'],
    [5, 'company_name', 'BUDGET_FILE_DISABLED', 'Company \'Closed Co\' is disabled.'],
    [6, 'supplier_erp_id', 'BUDGET_FILE_SUPPLIER_ERP_UNKNOWN',
      'ERP id \'NEW-9\' is unknown and \'Known Supplier\' is already a supplier. Add the ERP id in Master data > Suppliers or leave it empty.'],
    [7, 'supplier_name', 'BUDGET_FILE_DISABLED', 'Supplier \'Gone Vendor\' is disabled.'],
    [2, 'supplier_name', 'BUDGET_FILE_SUPPLIER_NAME_DIFFERS', 'supplier_name \'Other Name\' does not match the supplier for ERP id \'V1\' (Zephyr Supplies).'],
    [2, 'company_name', 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY', 'Cost center CC-1 belongs to Hidden Holding SA. The line is paid by Paying Co.'],
    [2, null, 'BUDGET_FILE_CURRENCY_NOT_COMPANY', 'EUR is not the currency of Paying Co (USD).'],
    [4, null, 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER', 'Budget 2026 at 100 000, against a median of 1 000 on 3 lines of Median Partner.'],
    [4, null, 'BUDGET_FILE_CURRENCY_NOT_COMPANY', 'USD is not the currency of Hidden Holding SA (EUR).'],
  ]);
  assert.equal(report.warnings.costCenterCompanies?.[0].costCenterCompany, 'Hidden Holding SA');
  console.log('  with the suppliers and the companies: today\'s messages: OK');
}

// Mixed rights, after the review of lot I6b: each right covers its own list only. A stored line the
// file updates (its currency and amount: the median of its supplier, the currency of its stored
// company), another company than its cost center's, and Kad's proposals on both columns (a supplier
// the file writes without accents, an enabled company for a disabled one). The whole serialized
// report names no stored record of a list the person does not read; Kad's own words in a refused
// proposal are Kad's, not the list's.
const MIXED_COMPANIES = ['Hidden Holding SA', 'Paying Co', 'Closed Co'];
const MIXED_SUPPLIERS = ['Zephyr Supplies', 'Boreal Old', 'Median Partner', 'Société Cachée'];

const MIXED_CATALOG = emptyCatalog({
  companies: [
    { id: 'c1', name: 'Hidden Holding SA', coaId: null, disabledAt: null, baseCurrency: 'EUR' },
    { id: 'c2', name: 'Paying Co', coaId: null, disabledAt: null, baseCurrency: 'USD' },
    { id: 'c3', name: 'Closed Co', coaId: null, disabledAt: '2020-01-01T00:00:00.000Z' },
  ],
  costCenters: [{ id: 'cc1', code: 'CC-1', kind: 'cost_center', companyId: 'c1', disabledAt: null }],
  accounts: [{ id: 'a1', number: '612200', coaId: null, disabledAt: null }],
  suppliers: [
    { id: 's1', name: 'Zephyr Supplies', erpId: 'V1', disabledAt: null },
    { id: 's2', name: 'Boreal Old', erpId: 'V2', disabledAt: '2020-01-01T00:00:00.000Z' },
    { id: 's3', name: 'Median Partner', erpId: 'V3', disabledAt: null },
    { id: 's4', name: 'Société Cachée', erpId: null, disabledAt: null },
  ],
});

const MIXED_STORED: StoredLine = {
  id: 'L200', nature: 'opex', itemNumber: 200, legacyNumber: null, rowVersion: 1, name: 'Stored line',
  description: null, companyId: 'c1', companyName: 'Hidden Holding SA', supplierId: 's1', supplierName: 'Zephyr Supplies',
  supplierErpId: 'V1', accountId: 'a1', accountNumber: '612200', costCenterId: 'cc1', costCenterCode: 'CC-1', costCenterPath: null,
  runBuild: null, analytics: {}, ownerItEmail: null, ownerBusinessEmail: null, projectNumber: null, currency: 'EUR',
  effectiveStart: '2026-01-01', endOfValidity: null, notes: null, versions: [],
};

// Three USD lines of Zephyr Supplies at 1 000: the update at 100 000 in USD is far from their median.
const MIXED_NAMES: LineHint[] = [1, 2, 3].map((n) => ({
  nature: 'opex', itemNumber: 300 + n, name: `Other line ${n}`, supplierId: 's1', id: `h${n}`, companyId: 'c2', currency: 'USD',
  years: [{ year: 2026, versionId: `v${n}`, budgetRev: 1, totals: { planned: 100000n } }],
}));

const MIXED_FILE = [
  'item_number,nature,name,company_name,account_number,supplier_name,supplier_erp_id,cost_center_code,currency,budget_2026',
  // The stored line: only its currency and amount change (its company, supplier and cost center kept).
  'BL-200,opex,Stored line,,,,,,USD,100000',
  // Another company than the cost center's, written in another case.
  ',opex,Row B,paying co,612200,,,CC-1,USD,100',
  // A supplier written without accents, which Kad proposes too.
  ',opex,Row C,paying co,612200,Societe Cachee,,,USD,100',
  // A disabled company, written in another case; Kad proposes an enabled one.
  ',opex,Row D,closed co,612200,,,,USD,100',
].join('\n');

async function mixedCheck(suppliers: boolean, companies: boolean, access?: BudgetFileAccess) {
  const read = await readBudgetCsv(`${MIXED_FILE}\n`, { language: 'en', dimensionCodes: [] });
  return planBudgetFile({
    scope: 'opex', read, catalog: MIXED_CATALOG, stored: [MIXED_STORED], names: MIXED_NAMES,
    createSuppliers: false, canCreateSuppliers: false,
    canReadSuppliers: suppliers, canReadCompanies: companies,
    currentYear: 2026, labels: { budget: 'Budget' },
    ...(access ? { access } : {}),
    matching: { choices: [], proposals: { supplier_name: { 'Societe Cachee': 'Société Cachée' }, company_name: { 'closed co': 'Paying Co' } } },
  }).report;
}

/** The stored names of `hidden` the serialized report carries, Kad's words in a refused proposal set aside. */
function leaks(report: Report, hidden: string[]): string[] {
  const copy = JSON.parse(JSON.stringify(report));
  for (const entry of copy.matching?.refusedProposals ?? []) if (entry.reason === 'missing') entry.target = '';
  const text = JSON.stringify(copy);
  return hidden.filter((name) => text.includes(name));
}

async function testEachRightForItsOwnList() {
  const limited = (): BudgetFileAccess => ({ editable: new Set(['L200']), places: new Map(), wanted: new Map() });
  const cases: Array<{ label: string; suppliers: boolean; companies: boolean; access?: BudgetFileAccess; codes: unknown[][]; matches: unknown[][]; refused: unknown[][] }> = [
    {
      label: 'suppliers only', suppliers: true, companies: false,
      codes: [
        [5, 'BUDGET_FILE_DISABLED'],
        [3, 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY_UNREAD'],
        [2, 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER'],
        [2, 'BUDGET_FILE_CURRENCY_NOT_COMPANY_UNREAD'],
      ],
      matches: [['supplier_name', 'Societe Cachee', 'Société Cachée', 'server']],
      refused: [['company_name', 'closed co', 'Paying Co', 'missing']],
    },
    {
      label: 'companies only', suppliers: false, companies: true,
      codes: [
        [4, 'CSV_REFERENCE_NOT_FOUND'],
        [3, 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY'],
        [2, 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER_UNREAD'],
        [2, 'BUDGET_FILE_CURRENCY_NOT_COMPANY'],
      ],
      matches: [['company_name', 'closed co', 'Paying Co', 'model']],
      refused: [['supplier_name', 'Societe Cachee', 'Société Cachée', 'missing']],
    },
    ...[undefined, limited()].map((access) => ({
      label: access ? 'neither, limited to the stored line' : 'neither', suppliers: false, companies: false, access,
      codes: [
        [4, 'CSV_REFERENCE_NOT_FOUND'],
        [5, 'BUDGET_FILE_DISABLED'],
        [3, 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY_UNREAD'],
        [2, 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER_UNREAD'],
        [2, 'BUDGET_FILE_CURRENCY_NOT_COMPANY_UNREAD'],
      ],
      matches: [],
      refused: [['supplier_name', 'Societe Cachee', 'Société Cachée', 'missing'], ['company_name', 'closed co', 'Paying Co', 'missing']],
    })),
  ];
  for (const entry of cases) {
    const report = await mixedCheck(entry.suppliers, entry.companies, entry.access);
    const hidden = [...(entry.suppliers ? [] : MIXED_SUPPLIERS), ...(entry.companies ? [] : MIXED_COMPANIES)];
    assert.deepEqual(leaks(report, hidden), [], `${entry.label}: ${JSON.stringify(report)}`);
    const sort = (list: unknown[][]) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(sort(sentences(report).map(([line, , code]) => [line, code])), sort(entry.codes), `${entry.label}: the sentences`);
    assert.deepEqual((report.matching?.matches ?? []).map((match) => [match.column, match.value, match.target, match.origin]), entry.matches, `${entry.label}: the matches`);
    assert.deepEqual(
      sort((report.matching?.refusedProposals ?? []).map((refused) => [refused.column, refused.value, refused.target, refused.reason])),
      sort(entry.refused),
      `${entry.label}: Kad's refused proposals`,
    );
    // The list the person reads is still named: each right holds for its own list.
    const serialized = JSON.stringify(report);
    if (entry.suppliers) assert.ok(serialized.includes('Zephyr Supplies'), `${entry.label}: the supplier is named`);
    if (entry.companies) assert.ok(serialized.includes('Hidden Holding SA'), `${entry.label}: the company is named`);
  }
  console.log('  suppliers only, companies only, neither, neither limited: each right names its own list only: OK');
}

async function main() {
  await testNothingNamedWithoutTheLists();
  await testTodaysMessagesWithTheLists();
  await testEachRightForItsOwnList();
  console.log('budget-file-unread-names.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
