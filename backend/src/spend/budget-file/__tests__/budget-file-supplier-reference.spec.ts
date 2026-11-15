import * as assert from 'node:assert/strict';
import { readBudgetCsv } from '../interpret';
import { planBudgetFile } from '../preflight';
import { BudgetCatalog, emptyCatalog } from '../types';

// The budget file and the supplier's reference (lot R3). The file names a supplier by its ERP ID
// (`supplier_erp_id`) or its name (`supplier_name`); it has no reference column. A cell that reads
// like a Kadratis reference (`SUP-12`) keeps the meaning of its column: an ERP ID in the first, a
// name in the second, never the supplier numbered 12. No database: the catalog is built here.

const YEAR = 2026;

function catalog(): BudgetCatalog {
  return emptyCatalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [{ id: 'a1', number: '1200', coaId: 'chart', disabledAt: null }],
    // `twelve` would be SUP-12 in the workspace: no catalog row carries a reference.
    suppliers: [
      { id: 'twelve', name: 'Twelve Corp', erpId: 'F12', disabledAt: null },
      { id: 'erp-holder', name: 'ERP holder', erpId: 'SUP-12', disabledAt: null },
      { id: 'name-holder', name: 'SUP-7', erpId: null, disabledAt: null },
    ],
  });
}

async function plan(supplierName: string, supplierErpId: string) {
  const text = 'item_number,name,company_name,account_number,currency,supplier_name,supplier_erp_id\n'
    + `,Widget,Acme,1200,EUR,${supplierName},${supplierErpId}\n`;
  const read = await readBudgetCsv(text, { language: 'en', dimensionCodes: [] });
  return planBudgetFile({
    scope: 'opex', read, catalog: catalog(), stored: [], names: [],
    createSuppliers: false, canCreateSuppliers: false, currentYear: YEAR, labels: { budget: 'Budget' },
  });
}

async function testErpIdReadsAsErpId() {
  const byErp = await plan('', 'SUP-12');
  assert.equal(byErp.report.ok, true, JSON.stringify(byErp.report.errors));
  assert.equal(byErp.plans[0].body.supplier_id, 'erp-holder', 'SUP-12 in the ERP ID column is the supplier whose ERP ID it is');
  const lower = await plan('', 'sup-12');
  assert.equal(lower.plans[0].body.supplier_id, 'erp-holder');
  // An ERP ID no supplier has stays unknown, even when it reads like a reference.
  const unknown = await plan('', 'SUP-3');
  assert.equal(unknown.report.ok, false);
  assert.deepEqual(unknown.report.errors.map((error) => [error.column, error.code, error.params]), [
    ['supplier_erp_id', 'CSV_REFERENCE_NOT_FOUND', { value: 'SUP-3' }],
  ]);
}

async function testNameReadsAsName() {
  const byName = await plan('SUP-7', '');
  assert.equal(byName.report.ok, true, JSON.stringify(byName.report.errors));
  assert.equal(byName.plans[0].body.supplier_id, 'name-holder', 'SUP-7 in the name column is the supplier of that name');
  const noSuchName = await plan('SUP-12', '');
  assert.equal(noSuchName.report.ok, false, 'SUP-12 names no supplier: not the one numbered 12');
  assert.deepEqual(noSuchName.report.errors.map((error) => [error.column, error.code, error.params]), [
    ['supplier_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'SUP-12' }],
  ]);
}

async function main() {
  await testErpIdReadsAsErpId();
  await testNameReadsAsName();
  console.log('budget-file-supplier-reference.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
