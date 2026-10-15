import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsReferenceKeys1854070000000 } from '../../migrations/1854070000000-contracts-reference-keys';

// Migration 1854070000000 against a seeded dirty database, in one transaction rolled back at the
// end (the keys are dropped first, so it runs whether the database has them or not): a contract
// whose supplier is missing stops it with a readable list and no key added; once that contract
// is fixed it adds the three keys, clears an owner that does not exist, and a second run changes
// nothing.

const KEYS = { fk_contracts_supplier: 'r', fk_contracts_company: 'r', fk_contracts_owner_user: 'n' } as const;

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function keys(runner: QueryRunner): Promise<Record<string, string>> {
  const rows = await runner.query(
    `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'contracts'::regclass AND contype = 'f' AND conname = ANY($1)`,
    [Object.keys(KEYS)],
  );
  return Object.fromEntries(rows.map((row: { conname: string; confdeltype: string }) => [row.conname, row.confdeltype]));
}

async function rlsStates(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN ('contracts', 'suppliers', 'companies', 'users')
      ORDER BY relname`,
  );
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

async function testMigrationRefusesOrphansThenAddsTheKeys() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    for (const name of Object.keys(KEYS)) await runner.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ${name}`);
    const rlsBefore = await rlsStates(runner);

    const tenantId = randomUUID();
    const slug = `ctr-keys-${tenantId.slice(0, 8)}`;
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Contract keys', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug],
    );
    await setTenant(runner, tenantId);
    const companyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Keys company', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const supplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Keys supplier') RETURNING id`, [tenantId]);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Keys role', 'Keys role', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const ownerId = await one(
      runner,
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
       VALUES ($1, 'Keys', 'Owner', $2, null, $3, false, 'enabled') RETURNING id`,
      [tenantId, `${slug}@contract-keys.test`, roleId],
    );
    const contract = (name: string, supplier: string, owner: string | null) =>
      one(
        runner,
        `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date)
         VALUES ($1, $2, $3, $4, $5, '2024-01-01') RETURNING id`,
        [tenantId, name, companyId, supplier, owner],
      );
    const sound = await contract('Sound contract', supplierId, ownerId);
    const orphan = await contract('Orphan contract', randomUUID(), null);
    const ownerless = await contract('Gone owner contract', supplierId, randomUUID());
    await setTenant(runner, '');

    const migration = new ContractsReferenceKeys1854070000000();
    await assert.rejects(migration.up(runner), (err: Error) => {
      assert.match(err.message, /contract\(s\) name a supplier or a company that does not exist in their tenant\. No key was added\./);
      assert.ok(
        err.message.includes(`tenant ${slug} (${tenantId}): contract ${orphan} "Orphan contract": supplier missing`),
        `the orphan is listed with its tenant, id, name and missing reference:\n${err.message}`,
      );
      assert.ok(!err.message.includes(sound) && !err.message.includes(ownerless), 'the other contracts are not listed');
      return true;
    });
    assert.deepEqual(await keys(runner), {}, 'no key was added');
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');

    await setTenant(runner, tenantId);
    const [before] = await runner.query(`SELECT owner_user_id FROM contracts WHERE id = $1`, [ownerless]);
    assert.notEqual(before.owner_user_id, null, 'the refused run cleared nothing');
    await runner.query(`UPDATE contracts SET supplier_id = $2 WHERE id = $1`, [orphan, supplierId]);
    await setTenant(runner, '');

    await migration.up(runner);
    assert.deepEqual(await keys(runner), KEYS, 'the three keys, RESTRICT on supplier and company, SET NULL on owner');
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');
    const [{ tenant }] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
    assert.equal(tenant ?? '', '', 'the migration leaves no tenant set');

    await setTenant(runner, tenantId);
    const owners = await runner.query(`SELECT id, owner_user_id FROM contracts WHERE tenant_id = $1`, [tenantId]);
    const ownerOf = new Map(owners.map((row: { id: string; owner_user_id: string | null }) => [row.id, row.owner_user_id]));
    assert.equal(ownerOf.get(ownerless), null, 'the missing owner is cleared');
    assert.equal(ownerOf.get(sound), ownerId, 'an existing owner is kept');
    await setTenant(runner, '');

    await migration.up(runner);
    assert.deepEqual(await keys(runner), KEYS, 'a second run changes nothing');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testMigrationRefusesOrphansThenAddsTheKeys();
  } finally {
    await dataSource.destroy();
  }
  console.log('contracts-reference-keys.migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
