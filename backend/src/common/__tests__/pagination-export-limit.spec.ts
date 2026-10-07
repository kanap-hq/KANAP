import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from './backend-root';
import { MAX_EXPORT_LIMIT, MAX_LIST_LIMIT, parseExportPagination, parsePagination } from '../pagination';

/**
 * The whole-set paths (CSV exports, "select all" ids, filter-value lists) build a query
 * with an explicit large `limit` and hand it to a delegate that parses it with the list
 * parser — which silently reduced it to MAX_LIST_LIMIT rows. They now set a server-side
 * `exportAll` flag that selects the export bound instead.
 *
 * These tests pin both bounds and guard that the flag stays wired, because the failure mode
 * is silence: a truncated export looks like a complete one.
 */

function testListCapIsUnchanged() {
  assert.equal(parsePagination({ limit: '10000' }).limit, MAX_LIST_LIMIT);
  assert.equal(parsePagination({ limit: '999999' }).limit, MAX_LIST_LIMIT);
}

function testExportPaginationHonoursTheRequestedLimit() {
  assert.equal(parseExportPagination({ limit: '10000' }).limit, 10000);
  assert.equal(parseExportPagination({ limit: '100000' }).limit, MAX_EXPORT_LIMIT);
}

function testExportBoundIsStillBounded() {
  // Deliberately not unbounded: a whole-tenant read is a memory risk.
  assert.ok(MAX_EXPORT_LIMIT > MAX_LIST_LIMIT);
  assert.equal(parseExportPagination({ limit: '5000000' }).limit, MAX_EXPORT_LIMIT);
}

function testDefaultsAndPageArithmeticAreIdentical() {
  const list = parsePagination({});
  const exp = parseExportPagination({});
  assert.equal(list.limit, 20);
  assert.equal(exp.limit, 20);
  assert.equal(list.page, exp.page);
  assert.equal(exp.skip, (exp.page - 1) * exp.limit);
}

function testAFilterListCanActuallyExceedTheListCap() {
  // The reported symptom: a filter-value list built with limit 10000 returned at most 1000
  // distinct values, so a column filter silently missed values beyond the first 1000 rows.
  assert.equal(parsePagination({ limit: '10000' }).limit, 1000);
  assert.equal(parseExportPagination({ limit: '10000' }).limit, 10000);
}

function testClientCannotRaiseTheCeilingOnAListPath() {
  // The flag is server-side: nothing in the query string can select the export bound.
  for (const query of [
    { limit: '50000' },
    { limit: '50000', exportAll: 'true' },
    { limit: '50000', exportAll: 1 },
  ]) {
    assert.equal(
      parsePagination(query).limit,
      MAX_LIST_LIMIT,
      `parsePagination must ignore ${JSON.stringify(query)} beyond the list cap`,
    );
  }
}

/**
 * Source-level guard: every writer that asks for the whole set must pass the flag, and every
 * delegate that receives it must actually branch on it. The CAPEX item export is not one of
 * them any more: it reads every item without the list pagination, so it has no cap at all
 * (`spend/__tests__/budget-summary.integration.spec.ts` checks an ended line is in the file).
 */
function testWholeSetPathsPassTheExportFlag() {
  // The TypeScript sources, also when this spec runs compiled.
  const srcRoot = backendPath('src');

  const CALL_SITES = [
    'companies/companies.service.ts',
    'contracts/contracts.service.ts',
    'departments/departments.service.ts',
    'suppliers/suppliers.service.ts',
    'business-processes/business-processes.service.ts',
    'admin/coa-templates/admin-coa-templates.service.ts',
  ];
  const missing = CALL_SITES.filter((relative) => {
    const source = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    return !source.includes('exportAll: true');
  });
  assert.deepEqual(missing, [], `these files must pass \`exportAll: true\` on their whole-set path`);

  const DELEGATES = [
    'companies/companies.service.ts',
    'contracts/contracts.service.ts',
    'departments/departments.service.ts',
    'suppliers/suppliers.service.ts',
    'business-processes/business-processes.service.ts',
    'admin/coa-templates/admin-coa-templates.service.ts',
  ];
  const notBranching = DELEGATES.filter((relative) => {
    const source = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    return !source.includes('opts?.exportAll');
  });
  assert.deepEqual(notBranching, [], 'these files must branch on `opts?.exportAll`');
}

async function run() {
  testListCapIsUnchanged();
  testExportPaginationHonoursTheRequestedLimit();
  testExportBoundIsStillBounded();
  testDefaultsAndPageArithmeticAreIdentical();
  testAFilterListCanActuallyExceedTheListCap();
  testClientCannotRaiseTheCeilingOnAListPath();
  testWholeSetPathsPassTheExportFlag();
}

void run();
