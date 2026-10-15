import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CompanyReferenceKeys1854090000000 } from '../../migrations/1854090000000-company-reference-keys';
import { SupplierContactsSupplierKey1854080000000 } from '../../migrations/1854080000000-supplier-contacts-supplier-key';

// Migrations 1854080000000 and 1854090000000 against a seeded dirty database, each in one
// transaction rolled back at the end. Each starts from its down(), the state before it ran.
// - Company keys: a portfolio project naming a missing company stops the migration with a
//   readable list and no key changed; once the row is fixed, every reference restricts, with one
//   key per column (a duplicate key on users is dropped), the metrics still cascade, and a second
//   run changes nothing.
// - Supplier contact links: a link whose supplier is gone is deleted, the others and the contacts
//   stay, the key cascades, and a second run changes nothing.

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function inRollback(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  const slug = `${tag}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Reference keys', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return { tenantId, slug };
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

/** `table.column` → the delete actions of its single-column keys into companies. */
async function companyKeys(runner: QueryRunner): Promise<Record<string, string[]>> {
  const rows: Array<{ col: string; action: string }> = await runner.query(
    `SELECT c.conrelid::regclass::text || '.' || a.attname AS col, c.confdeltype AS action
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'companies'::regclass AND array_length(c.conkey, 1) = 1
      ORDER BY 1, 2`,
  );
  const keys: Record<string, string[]> = {};
  for (const row of rows) (keys[row.col] ??= []).push(row.action);
  return keys;
}

async function rlsStates(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relrowsecurity ORDER BY relname`,
  );
}

const RESTRICTED = [
  'application_companies.company_id',
  'departments.company_id',
  'interface_companies.company_id',
  'locations.operating_company_id',
  'portfolio_projects.company_id',
  'portfolio_requests.company_id',
  'portfolio_team_member_configs.default_company_id',
  'spend_items.paying_company_id',
  'tasks.company_id',
  'users.company_id',
];

async function testCompanyKeys() {
  await inRollback(async (runner) => {
    const migration = new CompanyReferenceKeys1854090000000();
    await migration.down(runner);
    // users carried two identical keys before the migration.
    await runner.query(`ALTER TABLE users ADD CONSTRAINT users_company_dup_test FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL`);
    const before = await companyKeys(runner);
    assert.deepEqual(before['users.company_id'], ['n', 'n']);
    assert.deepEqual(before['departments.company_id'], ['c']);
    assert.equal(before['portfolio_projects.company_id'], undefined);
    const rlsBefore = await rlsStates(runner);

    const { tenantId, slug } = await seedTenant(runner, 'co-keys');
    await setTenant(runner, tenantId);
    const companyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Keys company', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const sound = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number, company_id) VALUES ($1, 'Sound project', 1, $2) RETURNING id`, [tenantId, companyId]);
    const orphan = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number, company_id) VALUES ($1, 'Orphan project', 2, $2) RETURNING id`, [tenantId, randomUUID()]);
    await setTenant(runner, '');

    await assert.rejects(migration.up(runner), (err: Error) => {
      assert.match(err.message, /row\(s\) name a company that does not exist in their tenant\. No key was changed\./);
      assert.ok(
        err.message.includes(`tenant ${slug} (${tenantId}): portfolio_projects ${orphan}: company_id missing`),
        `the orphan is listed with its tenant, table, id and column:\n${err.message}`,
      );
      assert.ok(!err.message.includes(sound), 'the sound row is not listed');
      return true;
    });
    assert.deepEqual(await companyKeys(runner), before, 'no key was changed');
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');

    await setTenant(runner, tenantId);
    await runner.query(`UPDATE portfolio_projects SET company_id = NULL WHERE id = $1`, [orphan]);
    await setTenant(runner, '');

    await migration.up(runner);
    const after = await companyKeys(runner);
    for (const col of RESTRICTED) assert.deepEqual(after[col], ['r'], `${col}: one key, ON DELETE RESTRICT`);
    assert.deepEqual(after['company_metrics.company_id'], ['c'], 'the metrics still cascade');
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');

    await migration.up(runner);
    assert.deepEqual(await companyKeys(runner), after, 'a second run changes nothing');
  });
}

async function testSupplierContactLinks() {
  await inRollback(async (runner) => {
    const migration = new SupplierContactsSupplierKey1854080000000();
    await migration.down(runner);

    const { tenantId } = await seedTenant(runner, 'sc-key');
    await setTenant(runner, tenantId);
    const supplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Linked supplier') RETURNING id`, [tenantId]);
    const contactId = await one(
      runner,
      `INSERT INTO contacts (tenant_id, email) VALUES ($1, $2) RETURNING id`,
      [tenantId, `link-${tenantId.slice(0, 8)}@supplier-key.test`],
    );
    const kept = await one(runner, `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial') RETURNING id`, [tenantId, supplierId, contactId]);
    const orphan = await one(runner, `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'support') RETURNING id`, [tenantId, randomUUID(), contactId]);
    await setTenant(runner, '');

    await migration.up(runner);
    await setTenant(runner, tenantId);
    const links = await runner.query(`SELECT id FROM supplier_contacts WHERE tenant_id = $1`, [tenantId]);
    assert.deepEqual(links.map((row: { id: string }) => row.id), [kept], 'the orphaned link is deleted, the other kept');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM contacts WHERE id = $1`, [contactId]);
    assert.equal(n, 1, 'the contact stays');
    assert.ok(orphan);
    await setTenant(runner, '');

    const keys = await runner.query(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'supplier_contacts'::regclass AND contype = 'f' AND confrelid = 'suppliers'::regclass`,
    );
    assert.deepEqual(keys, [{ conname: 'fk_supplier_contacts_supplier', confdeltype: 'c' }]);
    await migration.up(runner);
    assert.deepEqual(
      await runner.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'supplier_contacts'::regclass AND confrelid = 'suppliers'::regclass`),
      [{ conname: 'fk_supplier_contacts_supplier' }],
      'a second run changes nothing',
    );
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testCompanyKeys, testSupplierContactLinks]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 8).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`company-reference-keys.migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('company-reference-keys.migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
