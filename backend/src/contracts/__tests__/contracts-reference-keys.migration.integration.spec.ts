import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsReferenceKeys1854070000000 } from '../../migrations/1854070000000-contracts-reference-keys';

// Migration 1854070000000 against a seeded dirty database, in one transaction rolled back at the
// end (the keys are dropped first, so it runs whether the database has them or not). It succeeds
// with no manual step: contracts whose supplier or company is missing are kept under NOT VALID
// keys, a missing owner is cleared under a validated key, and the counts are logged. Once the
// contracts are fixed, a rerun validates the keys.

const KEYS = ['fk_contracts_supplier', 'fk_contracts_company', 'fk_contracts_owner_user'];

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** name → `<action>/<validated>`. */
async function keys(runner: QueryRunner): Promise<Record<string, string>> {
  const rows = await runner.query(
    `SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conrelid = 'contracts'::regclass AND contype = 'f' AND conname = ANY($1)`,
    [KEYS],
  );
  return Object.fromEntries(rows.map((row: any) => [row.conname, `${row.confdeltype}/${row.convalidated ? 'valid' : 'not valid'}`]));
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

/** Runs `fn` and returns what it logged. */
async function logged(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

async function testMigrationKeepsOrphansUnderNotValidKeys() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    for (const name of KEYS) await runner.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ${name}`);
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
    const contract = (name: string, company: string, supplier: string, owner: string | null) =>
      one(
        runner,
        `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date)
         VALUES ($1, $2, $3, $4, $5, '2024-01-01') RETURNING id`,
        [tenantId, name, company, supplier, owner],
      );
    const sound = await contract('Sound contract', companyId, supplierId, ownerId);
    const noSupplier = await contract('No supplier contract', companyId, randomUUID(), null);
    const noCompany = await contract('No company contract', randomUUID(), supplierId, null);
    const goneOwner = await contract('Gone owner contract', companyId, supplierId, randomUUID());
    await setTenant(runner, '');

    const migration = new ContractsReferenceKeys1854070000000();
    const log = await logged(() => migration.up(runner));
    assert.deepEqual(await keys(runner), {
      fk_contracts_supplier: 'r/not valid',
      fk_contracts_company: 'r/not valid',
      fk_contracts_owner_user: 'n/valid',
    }, 'NOT VALID keys on the NOT NULL columns, a validated key on the owner');
    assert.match(log, new RegExp(`tenant ${slug} \\(${tenantId}\\): contracts\\.supplier_id: 1 row\\(s\\) name a missing suppliers row \\(${noSupplier}\\)`));
    assert.match(log, new RegExp(`tenant ${slug} \\(${tenantId}\\): contracts\\.company_id: 1 row\\(s\\) name a missing companies row \\(${noCompany}\\)`));
    assert.match(log, new RegExp(`tenant ${slug} \\(${tenantId}\\): contracts\\.owner_user_id: 1 row\\(s\\) naming a missing users row cleared`));
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');
    const [{ tenant }] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
    assert.equal(tenant ?? '', '', 'the migration leaves no tenant set');

    await setTenant(runner, tenantId);
    const rows = await runner.query(`SELECT id, owner_user_id FROM contracts WHERE tenant_id = $1`, [tenantId]);
    const ownerOf = new Map(rows.map((row: { id: string; owner_user_id: string | null }) => [row.id, row.owner_user_id]));
    assert.equal(rows.length, 4, 'every contract is kept');
    assert.equal(ownerOf.get(goneOwner), null, 'the missing owner is cleared');
    assert.equal(ownerOf.get(sound), ownerId, 'an existing owner is kept');

    // Fixed in the application: the rerun validates the keys.
    await runner.query(`UPDATE contracts SET supplier_id = $2 WHERE id = $1`, [noSupplier, supplierId]);
    await runner.query(`UPDATE contracts SET company_id = $2 WHERE id = $1`, [noCompany, companyId]);
    await setTenant(runner, '');
    await migration.up(runner);
    assert.deepEqual(await keys(runner), {
      fk_contracts_supplier: 'r/valid',
      fk_contracts_company: 'r/valid',
      fk_contracts_owner_user: 'n/valid',
    }, 'a rerun validates the keys once the contracts are fixed');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testMigrationKeepsOrphansUnderNotValidKeys();
  } finally {
    await dataSource.destroy();
  }
  console.log('contracts-reference-keys.migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
