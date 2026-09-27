import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { assert, inRolledBackTransaction, Kind, runSpecs, seedTenant, setTenant } from './round-inputs.fixtures';
import {
  disableCostCenter,
  ITEM_TABLE,
  itemService,
  lineBody,
  refusal,
  seedCompany,
  seedCostCenter,
  seedUser,
} from './cost-center.fixtures';

// Every OPEX and CAPEX line write goes through `item-write.util.ts`:
// - an id of another tenant (supplier, category, owners, company, account,
//   project, contract, cost center) is refused as "<Field> not found." on
//   create and update, and nothing is written;
// - id, tenant_id, item_number and timestamps in a body are ignored;
// - a group or a disabled cost center is refused as a new value, a disabled
//   current value is kept;
// - a line with a cost center and no company takes the cost center's company,
//   an explicit company is kept;
// - the chart of accounts is checked on the resulting company and account
//   (a CAPEX company change re-checks the stored account);
// - run_build is run, build or empty.
// runSpecs opens the data-source, so test:ci runs this file in its database lane.

const KINDS: Kind[] = ['opex', 'capex'];

type Refs = {
  tenantId: string;
  companyId: string;
  accountId: string;
  supplierId: string;
  categoryId: string;
  userId: string;
  projectId: string;
  contractId: string;
  costCenterId: string;
};

/** A tenant with one of each referenced record. */
async function seedRefs(runner: QueryRunner, tag: string): Promise<Refs> {
  const tenantId = await seedTenant(runner, tag);
  const { companyId, accountId } = await seedCompany(runner, tenantId, `${tag} company`);
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `${tag} supplier`]);
  const [category] = await runner.query(`INSERT INTO analytics_categories (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `${tag} category`]);
  const userId = await seedUser(runner, tenantId, `${tag}-${tenantId.slice(0, 8)}@example.com`);
  const [project] = await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, 1) RETURNING id`,
    [tenantId, `${tag} project`],
  );
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2024-01-01') RETURNING id`,
    [tenantId, `${tag} contract`, companyId, supplier.id],
  );
  const costCenterId = await seedCostCenter(runner, tenantId, { code: `${tag.toUpperCase()}-1`, name: `${tag} cost center`, companyId });
  return {
    tenantId, companyId, accountId, supplierId: supplier.id, categoryId: category.id, userId,
    projectId: project.id, contractId: contract.id, costCenterId,
  };
}

/** Tenant A holds the foreign ids; tenant B (current) is where the writes happen. */
async function withTenants(fn: (runner: QueryRunner, a: Refs, b: Refs) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedRefs(runner, 'tenant-a');
    const b = await seedRefs(runner, 'tenant-b');
    await setTenant(runner, b.tenantId);
    await fn(runner, a, b);
  });
}

function foreignFields(kind: Kind, a: Refs): Array<[string, string, string]> {
  const fields: Array<[string, string, string]> = [
    ['supplier_id', a.supplierId, 'Supplier not found.'],
    ['analytics_category_id', a.categoryId, 'Analytics category not found.'],
    ['owner_it_id', a.userId, 'IT owner not found.'],
    ['owner_business_id', a.userId, 'Business owner not found.'],
    ['paying_company_id', a.companyId, 'Paying company not found.'],
    ['account_id', a.accountId, 'Account not found.'],
    ['project_id', a.projectId, 'Project not found.'],
    ['cost_center_id', a.costCenterId, 'Cost center not found.'],
  ];
  if (kind === 'opex') fields.push(['contract_id', a.contractId, 'Contract not found.']);
  else fields.push(['company_id', a.companyId, 'Paying company not found.']);
  return fields;
}

async function count(runner: QueryRunner, kind: Kind, tenantId: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [tenantId]);
  return n;
}

async function readLine(runner: QueryRunner, kind: Kind, id: string) {
  const [row] = await runner.query(`SELECT * FROM ${ITEM_TABLE[kind]} WHERE id = $1`, [id]);
  return row;
}

async function testForeignIdsRefused(kind: Kind) {
  await withTenants(async (runner, a, b) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const line = await svc.create(lineBody(kind, 'Own line', { paying_company_id: b.companyId, account_id: b.accountId }), undefined, opts);
    const stored = await readLine(runner, kind, line.id);
    const before = await count(runner, kind, b.tenantId);

    for (const [field, id, message] of foreignFields(kind, a)) {
      // Every other field keeps B's company; the legacy company_id alias stands alone.
      const createBody = lineBody(kind, `Foreign ${field}`, { paying_company_id: b.companyId, [field]: id });
      if (field === 'company_id') delete createBody.paying_company_id;
      const onCreate = await refusal(runner, () => svc.create(createBody, undefined, opts));
      assert.equal(onCreate.message, message, `${kind} create ${field}`);
      assert.equal((onCreate as any).getStatus?.(), 400, `${kind} create ${field}: a 400`);

      const onUpdate = await refusal(runner, () => svc.update(line.id, { [field]: id }, undefined, opts));
      assert.equal(onUpdate.message, message, `${kind} update ${field}`);
    }
    assert.equal(await count(runner, kind, b.tenantId), before, `${kind}: no line written`);
    assert.deepEqual(await readLine(runner, kind, line.id), stored, `${kind}: the line is unchanged`);

    // A value that is not a uuid names nothing either.
    const notUuid = await refusal(runner, () => svc.update(line.id, { supplier_id: 'not-a-uuid' }, undefined, opts));
    assert.equal(notUuid.message, 'Supplier not found.');
  });
}

async function testOwnIdsAccepted(kind: Kind) {
  await withTenants(async (runner, _a, b) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const body: Record<string, unknown> = {
      paying_company_id: b.companyId, account_id: b.accountId, supplier_id: b.supplierId, analytics_category_id: b.categoryId,
      owner_it_id: b.userId, owner_business_id: b.userId, project_id: b.projectId, cost_center_id: b.costCenterId, run_build: 'build',
    };
    if (kind === 'opex') body.contract_id = b.contractId;
    const saved = await svc.create(lineBody(kind, 'Every reference', body), undefined, opts);
    const row = await readLine(runner, kind, saved.id);
    for (const [field, value] of Object.entries(body)) assert.equal(row[field], value, `${kind}: ${field} stored`);
    const got = await svc.get(saved.id, opts);
    assert.equal(got.cost_center_id, b.costCenterId, `${kind}: the detail returns cost_center_id`);
    assert.equal(got.run_build, 'build', `${kind}: the detail returns run_build`);
  });
}

async function testTechnicalColumnsIgnored(kind: Kind) {
  await withTenants(async (runner, a, b) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const forcedId = randomUUID();
    const saved = await svc.create(lineBody(kind, 'Technical columns', {
      paying_company_id: b.companyId,
      id: forcedId,
      tenant_id: a.tenantId,
      item_number: 987654,
      created_at: '2001-01-01T00:00:00Z',
      legacy_effective_end: '2001-01-01',
      unknown_column: 'dropped',
    }), undefined, opts);
    const row = await readLine(runner, kind, saved.id);
    assert.notEqual(row.id, forcedId, `${kind}: id is not taken from the body`);
    assert.equal(row.tenant_id, b.tenantId, `${kind}: tenant_id is the current tenant`);
    assert.notEqual(row.item_number, 987654, `${kind}: item_number is assigned`);
    assert.notEqual(new Date(row.created_at).getUTCFullYear(), 2001, `${kind}: created_at is not taken from the body`);

    await svc.update(saved.id, { id: randomUUID(), tenant_id: a.tenantId, item_number: 987654, notes: 'still here' }, undefined, opts);
    const after = await readLine(runner, kind, saved.id);
    assert.equal(after.tenant_id, b.tenantId);
    assert.equal(after.item_number, row.item_number);
    assert.equal(after.notes, 'still here', `${kind}: the writable field of the same body is written`);
  });
}

async function testCostCenterAssignment(kind: Kind) {
  await withTenants(async (runner, _a, b) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const group = await seedCostCenter(runner, b.tenantId, { code: 'GRP', name: 'Group', kind: 'group' });
    const retired = await seedCostCenter(runner, b.tenantId, { code: 'OLD', name: 'Retired', companyId: b.companyId, disabled: true });

    const onGroup = await refusal(runner, () => svc.create(lineBody(kind, 'On a group', { paying_company_id: b.companyId, cost_center_id: group }), undefined, opts));
    assert.equal(onGroup.message, 'Choose a cost center, not a group.');
    const onDisabled = await refusal(runner, () => svc.create(lineBody(kind, 'On a disabled node', { paying_company_id: b.companyId, cost_center_id: retired }), undefined, opts));
    assert.equal(onDisabled.message, 'This cost center is disabled.');

    // A line on a node that is disabled afterwards keeps it through any update.
    const line = await svc.create(lineBody(kind, 'Kept', { paying_company_id: b.companyId, cost_center_id: b.costCenterId }), undefined, opts);
    await disableCostCenter(runner, b.costCenterId);
    await svc.update(line.id, { notes: 'edited' }, undefined, opts);
    await svc.update(line.id, { cost_center_id: b.costCenterId, notes: 'edited again' }, undefined, opts);
    assert.equal((await readLine(runner, kind, line.id)).cost_center_id, b.costCenterId, `${kind}: the disabled current value is kept`);
    const toGroup = await refusal(runner, () => svc.update(line.id, { cost_center_id: group }, undefined, opts));
    assert.equal(toGroup.message, 'Choose a cost center, not a group.');
    const toRetired = await refusal(runner, () => svc.update(line.id, { cost_center_id: retired }, undefined, opts));
    assert.equal(toRetired.message, 'This cost center is disabled.');

    await svc.update(line.id, { cost_center_id: null }, undefined, opts);
    assert.equal((await readLine(runner, kind, line.id)).cost_center_id, null, `${kind}: null clears the cost center`);
  });
}

async function testCompanyFill(kind: Kind) {
  await withTenants(async (runner, _a, b) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const other = await seedCompany(runner, b.tenantId, 'Other company', 7000);

    const filled = await svc.create(lineBody(kind, 'Filled', { cost_center_id: b.costCenterId, account_id: b.accountId }), undefined, opts);
    assert.equal((await readLine(runner, kind, filled.id)).paying_company_id, b.companyId, `${kind}: the company comes from the cost center`);

    const kept = await svc.create(lineBody(kind, 'Explicit', { paying_company_id: other.companyId, cost_center_id: b.costCenterId }), undefined, opts);
    assert.equal((await readLine(runner, kind, kept.id)).paying_company_id, other.companyId, `${kind}: an explicit company is kept`);

    const none = await refusal(runner, () => svc.create(lineBody(kind, 'No company'), undefined, opts));
    assert.equal(none.message, 'Paying company is required.');

    // An update that clears the company refills it from the line's cost center.
    await svc.update(kept.id, { paying_company_id: null }, undefined, opts);
    assert.equal((await readLine(runner, kind, kept.id)).paying_company_id, b.companyId, `${kind}: a cleared company is refilled`);
  });
}

async function testChartOfAccountsOnResultingLine(kind: Kind) {
  await withTenants(async (runner, _a, b) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const other = await seedCompany(runner, b.tenantId, 'Second chart company', 7000);
    const line = await svc.create(lineBody(kind, 'Charted', { paying_company_id: b.companyId, account_id: b.accountId }), undefined, opts);

    // Only the company changes: the stored account is of the first chart.
    const companyOnly = await refusal(runner, () => svc.update(line.id, { paying_company_id: other.companyId }, undefined, opts));
    assert.match(companyOnly.message, /Chart of Accounts/, `${kind}: a company change re-checks the stored account`);
    const accountOnly = await refusal(runner, () => svc.update(line.id, { account_id: other.accountId }, undefined, opts));
    assert.match(accountOnly.message, /Chart of Accounts/, `${kind}: an account change is checked against the stored company`);

    await svc.update(line.id, { paying_company_id: other.companyId, account_id: other.accountId }, undefined, opts);
    const row = await readLine(runner, kind, line.id);
    assert.equal(row.paying_company_id, other.companyId);
    assert.equal(row.account_id, other.accountId);

    // A line already mismatched (older data) takes unrelated edits, and a body that
    // repeats its stored company and account; moving it to yet another chart is still refused.
    await runner.query(`UPDATE ${ITEM_TABLE[kind]} SET account_id = $2 WHERE id = $1`, [line.id, b.accountId]);
    await svc.update(line.id, { notes: 'unrelated edit' }, undefined, opts);
    await svc.update(line.id, { paying_company_id: other.companyId, account_id: b.accountId, notes: 'same pair' }, undefined, opts);
    assert.equal((await readLine(runner, kind, line.id)).notes, 'same pair', `${kind}: a mismatched line takes unrelated edits`);
    const third = await seedCompany(runner, b.tenantId, 'Third chart company', 8000);
    const moved = await refusal(runner, () => svc.update(line.id, { paying_company_id: third.companyId }, undefined, opts));
    assert.match(moved.message, /Chart of Accounts/, `${kind}: a company change onto another chart is still refused`);
  });
}

async function testRunBuild(kind: Kind) {
  await withTenants(async (runner, _a, b) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const line = await svc.create(lineBody(kind, 'Run line', { paying_company_id: b.companyId, run_build: 'run' }), undefined, opts);
    assert.equal((await readLine(runner, kind, line.id)).run_build, 'run');
    const invalid = await refusal(runner, () => svc.update(line.id, { run_build: 'maintain' }, undefined, opts));
    assert.equal(invalid.message, 'Run or build must be run, build or empty.');
    await svc.update(line.id, { run_build: 'BUILD' }, undefined, opts);
    assert.equal((await readLine(runner, kind, line.id)).run_build, 'build');
    await svc.update(line.id, { run_build: null }, undefined, opts);
    assert.equal((await readLine(runner, kind, line.id)).run_build, null);
  });
}

void runSpecs('item-write-tenant.integration.spec', KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
  [`another tenant's ids are refused (${kind})`, () => testForeignIdsRefused(kind)],
  [`own ids are written (${kind})`, () => testOwnIdsAccepted(kind)],
  [`technical columns are ignored (${kind})`, () => testTechnicalColumnsIgnored(kind)],
  [`cost center assignment (${kind})`, () => testCostCenterAssignment(kind)],
  [`company fill (${kind})`, () => testCompanyFill(kind)],
  [`chart of accounts on the resulting line (${kind})`, () => testChartOfAccountsOnResultingLine(kind)],
  [`run or build (${kind})`, () => testRunBuild(kind)],
])).catch((err) => {
  console.error(err);
  process.exit(1);
});
