import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractComplianceItems1854040000000 as Migration } from '../../migrations/1854040000000-contract-compliance-items';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1854040000000 (the contracts' compliance register), against a real database, in
// transactions rolled back at the end:
// - as migrated: the table, its keys, RLS enabled and forced, the policy with USING and WITH CHECK,
//   UNIQUE (tenant_id, id) on contracts marked as this migration's;
// - a second up() changes nothing;
// - down() then up(), on a database without contracts and on one holding contracts of two tenants:
//   the same shape again, and the table takes rows for its own tenant's contracts only.

const migration = new Migration();

async function shape(runner: QueryRunner) {
  const [table] = await runner.query(
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c
      WHERE c.relname = 'contract_compliance_items' AND c.relnamespace = current_schema()::regnamespace`,
  );
  const constraints: Array<{ conname: string; def: string }> = await runner.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'contract_compliance_items'::regclass ORDER BY conname`,
  );
  const policies: Array<{ polname: string; using: string; check: string; cmd: string }> = await runner.query(
    `SELECT polname, pg_get_expr(polqual, polrelid) AS using, pg_get_expr(polwithcheck, polrelid) AS check, polcmd AS cmd
       FROM pg_policy WHERE polrelid = 'contract_compliance_items'::regclass ORDER BY polname`,
  );
  const contractKeys: Array<{ conname: string; mark: string | null }> = await runner.query(
    `SELECT conname, obj_description(oid, 'pg_constraint') AS mark FROM pg_constraint
      WHERE conrelid = 'contracts'::regclass AND contype = 'u' ORDER BY conname`,
  );
  return { table, constraints, policies, contractKeys };
}

function assertShape(s: Awaited<ReturnType<typeof shape>>, label: string) {
  assert.deepEqual(s.table, { rls: true, forced: true }, `${label}: RLS enabled and forced`);
  const byName = new Map(s.constraints.map((c) => [c.conname, c.def]));
  assert.equal(
    byName.get('contract_compliance_items_contract_fk'),
    'FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts(tenant_id, id) ON DELETE CASCADE',
    `${label}: the contract by tenant and id`,
  );
  assert.equal(byName.get('contract_compliance_items_contract_requirement_key'), 'UNIQUE (tenant_id, contract_id, requirement)', label);
  assert.ok(byName.has('contract_compliance_items_state_check'), label);
  assert.ok(byName.has('contract_compliance_items_reference_check'), label);
  assert.deepEqual(s.policies, [{
    polname: 'contract_compliance_items_tenant_isolation',
    using: '(tenant_id = app_current_tenant())',
    check: '(tenant_id = app_current_tenant())',
    cmd: '*',
  }], `${label}: one policy, USING and WITH CHECK`);
  assert.deepEqual(s.contractKeys, [{ conname: 'contracts_tenant_id_id_key', mark: 'ContractComplianceItems1854040000000' }], `${label}: contracts key`);
}

async function testMigratedAndRerun() {
  await inRolledBackTransaction(async (runner) => {
    const before = await shape(runner);
    assertShape(before, 'migrated');
    await migration.up(runner);
    assert.deepEqual(await shape(runner), before, 'a second up() changes nothing');
  });
}

async function seedContract(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const companyId = await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`, [tenantId, `Mig company ${tag}`]);
  const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Mig supplier ${tag}`]);
  const contractId = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, `Mig contract ${tag}`, companyId, supplierId],
  );
  return { tenantId, contractId };
}

async function testDownUp(seeded: boolean) {
  await inRolledBackTransaction(async (runner) => {
    const contracts = seeded ? [await seedContract(runner, 'ccm-a'), await seedContract(runner, 'ccm-b')] : [];
    await migration.down(runner);
    const [{ table }] = await runner.query(`SELECT to_regclass('contract_compliance_items') AS table`);
    assert.equal(table, null, 'down() drops the table');
    const keys = await runner.query(`SELECT 1 FROM pg_constraint WHERE conrelid = 'contracts'::regclass AND conname = 'contracts_tenant_id_id_key'`);
    assert.equal(keys.length, 0, "down() drops this migration's key on contracts");

    await migration.up(runner);
    assertShape(await shape(runner), seeded ? 'down, up on contracts' : 'down, up on no contract');
    await migration.up(runner);
    assertShape(await shape(runner), 'up again');

    if (seeded) {
      const [a, b] = contracts;
      await setTenant(runner, a.tenantId);
      await runner.query(`INSERT INTO contract_compliance_items (contract_id, requirement, state) VALUES ($1, 'exit_plan', 'present')`, [a.contractId]);
      const [{ tenant_id }] = await runner.query(`SELECT tenant_id FROM contract_compliance_items WHERE contract_id = $1`, [a.contractId]);
      assert.equal(tenant_id, a.tenantId, 'the tenant defaults to the session one');
      await runner.query('SAVEPOINT cross_tenant');
      await assert.rejects(
        runner.query(`INSERT INTO contract_compliance_items (contract_id, requirement, state) VALUES ($1, 'exit_plan', 'present')`, [b.contractId]),
        /contract_compliance_items_contract_fk/,
        "another tenant's contract is refused",
      );
      await runner.query('ROLLBACK TO SAVEPOINT cross_tenant');
      await assert.rejects(
        runner.query(`INSERT INTO contract_compliance_items (contract_id, requirement, state) VALUES ($1, 'exit_plan', 'present')`, [a.contractId]),
        /contract_compliance_items_contract_requirement_key/,
        'one row per contract and requirement',
      );
      await runner.query('ROLLBACK TO SAVEPOINT cross_tenant');
    }
  });
}

void runSpecs('contract-compliance-migration.integration.spec', [
  ['testMigratedAndRerun', testMigratedAndRerun],
  ['testDownUpWithoutContracts', () => testDownUp(false)],
  ['testDownUpWithContracts', () => testDownUp(true)],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
