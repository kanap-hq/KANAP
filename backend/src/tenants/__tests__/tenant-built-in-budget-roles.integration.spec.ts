import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServices, cleanupTenants, inTenant, runSpecs } from '../../admin/tenants/__tests__/tenant-reset-test-helpers';

// The shipped budget roles and budget administration (`budget_ops`): the Budget Reader reads the
// budget lines, not the budget settings; the Budget Member reads them; the Budget Administrator
// changes them. A new tenant gets these rights, and seeding the defaults again (as the tenant
// reset does) merges the shipped rights without bringing `budget_ops` back to the Budget Reader.
// The tenant is committed (the services open their own transactions) and removed at the end.
// @database-spec: opens the data source through runSpecs, so run-ci-tests.js runs this file on a database lane.

async function rightsOf(tenantId: string, roleName: string): Promise<Record<string, string>> {
  const rows: Array<{ resource: string; level: string }> = await inTenant(tenantId, (manager) => manager.query(
    `SELECT rp.resource, rp.level
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
      WHERE r.tenant_id = $1 AND r.role_name = $2 AND r.is_built_in`,
    [tenantId, roleName],
  ));
  return Object.fromEntries(rows.map((row) => [row.resource, row.level]));
}

async function assertBudgetRoles(tenantId: string, when: string) {
  const reader = await rightsOf(tenantId, 'Budget Reader');
  assert.equal(reader.budget, 'reader', `${when}: the Budget Reader reads the budget lines`);
  assert.equal(reader.companies, 'reader', `${when}: the Budget Reader keeps its other rights`);
  for (const name of ['budget_ops', 'budget-ops', 'budget_operations', 'budget-admin', 'budget_admin']) {
    assert.equal(reader[name], undefined, `${when}: the Budget Reader holds no ${name} right`);
  }
  assert.equal((await rightsOf(tenantId, 'Budget Member')).budget_ops, 'reader', `${when}: the Budget Member reads budget administration`);
  assert.equal((await rightsOf(tenantId, 'Budget Administrator')).budget_ops, 'admin', `${when}: the Budget Administrator changes it`);
}

async function testNewTenantThenSeedAgain() {
  const svc = buildServices();
  let tenantId: string | undefined;
  try {
    tenantId = (await svc.tenants.createTenant({ slug: `budget-roles-${randomUUID().slice(0, 8)}`, name: 'Built-in budget roles', language: 'en' })).id;
    await assertBudgetRoles(tenantId, 'new tenant');

    await inTenant(tenantId, (manager) => svc.tenants.seedTenantDefaults(manager, tenantId!));
    await assertBudgetRoles(tenantId, 'defaults seeded again');
  } finally {
    await cleanupTenants([tenantId]);
  }
}

runSpecs('tenant-built-in-budget-roles.integration.spec', [testNewTenantThenSeedAgain]);
