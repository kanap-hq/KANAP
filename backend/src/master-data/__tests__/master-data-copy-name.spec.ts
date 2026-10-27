import * as assert from 'node:assert/strict';
import {
  COPY_SKIP_REASONS,
  MasterDataOperationsService,
  companyCopyName,
  departmentCopyName,
} from '../master-data-operations.service';

/** A department the copy cannot name is null, so the screen words it. Never an English fallback. */
assert.equal(departmentCopyName(undefined), null);
assert.equal(departmentCopyName(null), null);
assert.equal(departmentCopyName({ name: '  ' }), null);
assert.equal(departmentCopyName({ name: 'Finance' }), 'Finance');
assert.equal(departmentCopyName({ name: 'Finance', company: { name: 'Fromage' } }), 'Finance (Fromage)');
assert.equal(departmentCopyName({ name: 'Finance', company: { name: '  ' } }), 'Finance');
assert.equal(departmentCopyName({ name: ' Finance ', company: { name: ' Fromage ' } }), 'Finance (Fromage)');

/** A company the copy cannot name is null, so the screen words it. */
assert.equal(companyCopyName(undefined), null);
assert.equal(companyCopyName(null), null);
assert.equal(companyCopyName({ name: '' }), null);
assert.equal(companyCopyName({ name: '  ' }), null);
assert.equal(companyCopyName({ name: 'Fromage' }), 'Fromage');
assert.equal(companyCopyName({ name: ' Fromage ' }), 'Fromage');

/** Skip reasons are codes. The screen words them. */
assert.equal(COPY_SKIP_REASONS.noSourceData, 'no_data_for_source_year');
assert.equal(COPY_SKIP_REASONS.copyFailed, 'failed_to_copy_metrics');
assert.match(COPY_SKIP_REASONS.noSourceData, /^[a-z0-9_]+$/);
assert.match(COPY_SKIP_REASONS.copyFailed, /^[a-z0-9_]+$/);

const BLANK = 'company-blank';
const MISSING = 'company-missing';
const NAMED = 'company-named';
const DEPT_BLANK = 'dept-blank';
const DEPT_NAMED = 'dept-named';

const companies = [
  { id: BLANK, name: '   ' },
  { id: NAMED, name: ' Fromage ' },
];
const companyMetrics = [
  { company_id: BLANK, fiscal_year: 2026, headcount: 4, it_users: 1, turnover: 2 },
  { company_id: MISSING, fiscal_year: 2026, headcount: 3, it_users: null, turnover: null },
  { company_id: NAMED, fiscal_year: 2025, headcount: 10, it_users: 8, turnover: 1.5 },
  { company_id: NAMED, fiscal_year: 2026, headcount: 9, it_users: 7, turnover: 1 },
];
const departments = [
  { id: DEPT_BLANK, name: '  ', company: { name: 'Fromage' } },
  { id: DEPT_NAMED, name: 'Finance', company: { name: 'Fromage' } },
];
const departmentMetrics = [
  { department_id: DEPT_BLANK, fiscal_year: 2026, headcount: 2 },
  { department_id: DEPT_NAMED, fiscal_year: 2025, headcount: 6 },
];

function rowsOf(entity: { name: string }): any[] {
  switch (entity.name) {
    case 'Company': return companies;
    case 'CompanyMetric': return companyMetrics;
    case 'Department': return departments;
    case 'DepartmentMetric': return departmentMetrics;
    default: throw new Error(`unexpected repository ${entity.name}`);
  }
}

const manager = {
  getRepository(entity: { name: string }) {
    const rows = rowsOf(entity);
    return {
      find: async (opts?: { where?: { fiscal_year?: number } }) => {
        const year = opts?.where?.fiscal_year;
        return rows.filter((row) => year == null || row.fiscal_year === year);
      },
    };
  },
  async transaction(fn: (trx: unknown) => Promise<unknown>) {
    return fn(manager);
  },
};

let companyWrites = 0;
let departmentWrites = 0;

function service() {
  return new MasterDataOperationsService(
    { manager } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      upsertForCompany: async () => {
        companyWrites += 1;
        throw new Error('database down');
      },
    } as never,
    {
      upsertForDepartment: async () => {
        departmentWrites += 1;
        throw new Error('department write failed');
      },
    } as never,
    { assertNotFrozen: async () => undefined } as never,
  );
}

const request = {
  sourceYear: 2025,
  destinationYear: 2026,
  includeCompanies: true,
  includeDepartments: true,
  companyMetrics: ['headcount', 'it_users', 'turnover'],
  userId: 'user-1',
  access: { isAdmin: true },
};

function rowsFor<T extends { entityId: string }>(results: T[], id: string): T[] {
  return results.filter((row) => row.entityId === id);
}

async function main() {
  const preview = await service().copyMasterData({ ...request, dryRun: true });
  assert.equal(companyWrites, 0, 'a dry run does not write');
  assert.equal(departmentWrites, 0, 'a dry run does not write');
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.summary.errors, 0);

  for (const id of [BLANK, MISSING]) {
    const rows = rowsFor(preview.results, id);
    assert.equal(rows.length, 3, `${id} has one row per company metric`);
    for (const row of rows) {
      assert.equal(row.entityName, null, `${id} has no name`);
      assert.equal(row.skipped, true);
      assert.equal(row.reason, COPY_SKIP_REASONS.noSourceData);
    }
  }

  const named = rowsFor(preview.results, NAMED);
  assert.equal(named.length, 3);
  for (const row of named) {
    assert.equal(row.entityName, 'Fromage');
    assert.equal(row.skipped, false);
    assert.equal(row.reason, undefined);
  }

  const blankDept = rowsFor(preview.results, DEPT_BLANK);
  assert.equal(blankDept.length, 1);
  assert.equal(blankDept[0].entityName, null);
  assert.equal(blankDept[0].reason, COPY_SKIP_REASONS.noSourceData);

  const namedDept = rowsFor(preview.results, DEPT_NAMED);
  assert.equal(namedDept.length, 1);
  assert.equal(namedDept[0].entityName, 'Finance (Fromage)');
  assert.equal(namedDept[0].skipped, false);
  assert.equal(namedDept[0].reason, undefined);

  const previewBlob = JSON.stringify(preview.results);
  assert.equal(previewBlob.includes('Unknown company'), false);
  assert.equal(previewBlob.includes('No data for source year'), false);
  assert.equal(previewBlob.includes('Failed to copy metrics'), false);

  const applied = await service().copyMasterData({ ...request, dryRun: false });
  assert.equal(companyWrites, 1);
  assert.equal(departmentWrites, 1);
  for (const row of rowsFor(applied.results, NAMED)) {
    assert.equal(row.entityName, 'Fromage');
    assert.equal(row.skipped, true);
    assert.equal(row.reason, COPY_SKIP_REASONS.copyFailed);
  }
  assert.equal(rowsFor(applied.results, DEPT_NAMED)[0].reason, COPY_SKIP_REASONS.copyFailed);
  assert.equal(rowsFor(applied.results, BLANK)[0].reason, COPY_SKIP_REASONS.noSourceData);
  assert.deepEqual(
    applied.errors.map((error) => error.message).sort(),
    ['database down', 'department write failed'],
  );
  const appliedBlob = JSON.stringify(applied.results);
  assert.equal(appliedBlob.includes('Failed to copy metrics'), false);
  assert.equal(appliedBlob.includes('Unknown company'), false);

  console.log('master-data-copy-name.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
