import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import {
  context,
  expectRefused,
  seedCompany,
  seedLine,
  seedTenant,
  seedUser,
  services,
  setCurrentTenant,
  withRollback,
} from './cost-center-test-helpers';

// Cross-tenant negative spec for cost_centers: forced RLS with the named
// policy; tenant B can neither read nor change tenant A's nodes through the
// service; B cannot use A's group as a parent, A's company, or A's user as an
// owner; and the (tenant_id, …) foreign keys refuse A's node on B's line or as
// B's parent even through raw SQL, where RLS alone would not (foreign-key
// checks bypass RLS).

async function testTableIsTenantIsolated() {
  const [table] = await dataSource.query(
    `SELECT c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'cost_centers'`,
  );
  assert.ok(table, 'cost_centers is missing: run the migrations first');
  assert.equal(table.relrowsecurity, true, 'RLS is not enabled');
  assert.equal(table.relforcerowsecurity, true, 'FORCE RLS is not enabled');
  const policies = await dataSource.query(
    `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cost_centers'`,
  );
  assert.equal(policies.length, 1);
  assert.equal(policies[0].policyname, 'cost_centers_tenant_isolation');
  assert.equal(policies[0].cmd, 'ALL');
  assert.match(policies[0].qual, /tenant_id = app_current_tenant\(\)/);
  assert.match(policies[0].with_check, /tenant_id = app_current_tenant\(\)/);

  const keys = await dataSource.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conname IN ('cost_centers_parent_fk', 'spend_items_cost_center_fk', 'capex_items_cost_center_fk')
     ORDER BY conname`,
  );
  assert.deepEqual(keys.map((key: any) => key.conname), ['capex_items_cost_center_fk', 'cost_centers_parent_fk', 'spend_items_cost_center_fk']);
  for (const key of keys) {
    assert.match(key.def, /FOREIGN KEY \(tenant_id, (parent_id|cost_center_id)\) REFERENCES cost_centers\(tenant_id, id\)/);
  }
}

async function testServiceRefusesOtherTenantsNodes() {
  await withRollback(async (runner) => {
    const tenantA = await seedTenant(runner, 'iso-a');
    const companyA = await seedCompany(runner, tenantA, 'Company A');
    const userA = await seedUser(runner, tenantA, `cc-iso-a-${randomUUID().slice(0, 8)}@example.test`);
    const a = services(runner.manager);
    const ctxA = context(runner.manager, tenantA);
    const groupA = await a.svc.create({ code: 'GA', kind: 'group', name: 'Group A' }, ctxA);
    const leafA = await a.svc.create({ code: 'CA', kind: 'cost_center', name: 'Center A', company_id: companyA, parent_id: groupA.id }, ctxA);
    const lineA = await seedLine(runner, 'opex', tenantA, leafA.id);

    const tenantB = await seedTenant(runner, 'iso-b');
    const companyB = await seedCompany(runner, tenantB, 'Company B');
    const b = services(runner.manager);
    const ctxB = context(runner.manager, tenantB);

    // Reads: nothing of A is visible to B.
    assert.deepEqual(await b.svc.tree(ctxB), { nodes: [], companies: {}, owners: {} });
    assert.deepEqual(await b.svc.count(ctxB), { count: 0 });
    assert.equal((await b.svc.list({ includeDisabled: '1' }, ctxB)).total, 0);
    assert.equal((await b.svc.listIds({ includeDisabled: '1' }, ctxB)).total, 0);
    await expectRefused(runner, /Cost center not found/, () => b.svc.get(leafA.id, ctxB));
    const exported = await b.csv.exportCsv('data', ctxB);
    assert.doesNotMatch(exported.content, /GA|CA/);

    // Writes on A's nodes: not found for B.
    await expectRefused(runner, /Cost center not found/, () => b.svc.update(leafA.id, { name: 'Taken over' }, ctxB));
    await expectRefused(runner, /Cost center not found/, () => b.del.delete(leafA.id, ctxB));
    const bulk = await b.del.bulkDelete([groupA.id, leafA.id], ctxB);
    assert.deepEqual(bulk.deleted, []);
    assert.deepEqual(bulk.failed.map((entry) => entry.name), ['Unknown', 'Unknown'], 'no name of A leaks to B');

    // A's group, company and user cannot be referenced by B.
    await expectRefused(runner, /Parent group not found/, () =>
      b.svc.create({ code: 'CB', kind: 'cost_center', name: 'Center B', company_id: companyB, parent_id: groupA.id }, ctxB));
    await expectRefused(runner, /Company not found/, () =>
      b.svc.create({ code: 'CB', kind: 'cost_center', name: 'Center B', company_id: companyA }, ctxB));
    await expectRefused(runner, /Owner not found/, () =>
      b.svc.create({ code: 'CB', kind: 'cost_center', name: 'Center B', company_id: companyB, owner_user_id: userA }, ctxB));
    const leafB = await b.svc.create({ code: 'CB', kind: 'cost_center', name: 'Center B', company_id: companyB }, ctxB);
    await expectRefused(runner, /Parent group not found/, () => b.svc.update(leafB.id, { parent_id: groupA.id }, ctxB));
    await expectRefused(runner, /Company not found/, () => b.svc.update(leafB.id, { company_id: companyA }, ctxB));
    await expectRefused(runner, /Owner not found/, () => b.svc.update(leafB.id, { owner_user_id: userA }, ctxB));
    // The same code in another tenant is fine: codes are unique per tenant.
    const sameCode = await b.svc.create({ code: 'GA', kind: 'group', name: 'Group B' }, ctxB);
    assert.equal(sameCode.code, 'GA');

    // CSV: A's company and parent codes do not resolve for B.
    const file = (content: string) => ({ buffer: Buffer.from(content, 'utf8'), originalname: 'cost_centers.csv' } as Express.Multer.File);
    const header = 'code;kind;name;parent_code;company_name;owner_email;description;status;disabled_at';
    const csvResult = await b.csv.importCsv(
      { file: file(`${header}\nCB-2;cost_center;Other;CA;Company A;;;enabled;\n`), dryRun: true },
      ctxB,
    );
    assert.equal(csvResult.ok, false);
    assert.deepEqual(csvResult.errors.map((error) => error.message), ["Unknown company 'Company A'.", "Unknown parent code 'CA'."]);

    // Raw SQL in B's session: RLS refuses a row for A, and the composite keys
    // refuse A's node as B's parent or on B's line.
    await expectRefused(runner, /row-level security/i, () => runner.query(
      `INSERT INTO cost_centers (tenant_id, code, kind, name) VALUES ($1, 'RAW', 'group', 'Raw')`,
      [tenantA],
    ));
    await expectRefused(runner, /cost_centers_parent_fk/, () => runner.query(
      `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id) VALUES ($1, 'RAW', 'group', 'Raw', $2)`,
      [tenantB, groupA.id],
    ));
    await expectRefused(runner, /cost_centers_parent_fk/, () => runner.query(
      `UPDATE cost_centers SET parent_id = $2 WHERE tenant_id = $1 AND id = $3`,
      [tenantB, groupA.id, sameCode.id],
    ));
    const lineB = await seedLine(runner, 'opex', tenantB, null);
    await expectRefused(runner, /spend_items_cost_center_fk/, () => runner.query(
      `UPDATE spend_items SET cost_center_id = $2 WHERE tenant_id = $1 AND id = $3`,
      [tenantB, leafA.id, lineB],
    ));
    await expectRefused(runner, /capex_items_cost_center_fk/, () => seedLine(runner, 'capex', tenantB, leafA.id));
    // B's own node is accepted on B's line.
    await runner.query(`UPDATE spend_items SET cost_center_id = $2 WHERE tenant_id = $1 AND id = $3`, [tenantB, leafB.id, lineB]);

    // B's writes left A's tree as it was.
    await setCurrentTenant(runner, tenantA);
    const treeA = await a.svc.tree(ctxA);
    assert.deepEqual(treeA.nodes.map((node) => [node.code, node.name]), [['GA', 'Group A'], ['CA', 'Center A']]);
    assert.deepEqual(await a.svc.count(ctxA), { count: 2 });
    const [line] = await runner.query(`SELECT cost_center_id FROM spend_items WHERE tenant_id = $1 AND id = $2`, [tenantA, lineA]);
    assert.equal(line.cost_center_id, leafA.id);
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testTableIsTenantIsolated, testServiceRefusesOtherTenantsNodes]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`cost-centers-tenant-isolation.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('cost-centers-tenant-isolation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
