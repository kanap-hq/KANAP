import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CompanyReferenceKeys1854090000000 } from '../../migrations/1854090000000-company-reference-keys';
import { SupplierContactsSupplierKey1854080000000 } from '../../migrations/1854080000000-supplier-contacts-supplier-key';

// Migrations 1854080000000 and 1854090000000 against a seeded dirty database, each in one
// transaction rolled back at the end. Each starts from its down(), the state before it ran, and
// succeeds with no manual step:
// - Company keys: a department naming another tenant's company is kept under a NOT VALID key; a
//   user and a portfolio project naming a missing company are cleared, an application link to it
//   is deleted, and those keys are validated; users ends with one key (its duplicate dropped);
//   the metrics still cascade; the counts are logged. Once the department is fixed, a rerun
//   validates its key.
// - Supplier contact links: a link whose supplier is gone is deleted (logged), the others and the
//   contacts stay, and the key cascades.

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

/** `table.column` → `<action>/<validated>` of each single-column key into companies. */
async function companyKeys(runner: QueryRunner): Promise<Record<string, string[]>> {
  const rows: Array<{ col: string; action: string }> = await runner.query(
    `SELECT c.conrelid::regclass::text || '.' || a.attname AS col,
            c.confdeltype::text || '/' || CASE WHEN c.convalidated THEN 'valid' ELSE 'not valid' END AS action
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

const VALIDATED = [
  'application_companies.company_id',
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
    assert.deepEqual(before['users.company_id'], ['n/valid', 'n/valid']);
    assert.deepEqual(before['departments.company_id'], ['c/valid']);
    assert.equal(before['portfolio_projects.company_id'], undefined);
    const rlsBefore = await rlsStates(runner);

    const other = await seedTenant(runner, 'co-keys-b');
    await setTenant(runner, other.tenantId);
    const foreign = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Other tenant company', 'FR', 'Lyon') RETURNING id`, [other.tenantId]);

    const { tenantId, slug } = await seedTenant(runner, 'co-keys');
    await setTenant(runner, tenantId);
    const companyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Keys company', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const department = (name: string, company: string) =>
      one(runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, company, name]);
    await department('Sound department', companyId);
    const strayDepartment = await department('Stray department', foreign);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Keys role', 'Keys role', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const strayUser = await one(
      runner,
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, company_id)
       VALUES ($1, 'Stray', 'User', $2, null, $3, false, 'enabled', $4) RETURNING id`,
      [tenantId, `${slug}@company-keys.test`, roleId, foreign],
    );
    const sound = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number, company_id) VALUES ($1, 'Sound project', 1, $2) RETURNING id`, [tenantId, companyId]);
    const orphan = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number, company_id) VALUES ($1, 'Orphan project', 2, $2) RETURNING id`, [tenantId, randomUUID()]);
    const appId = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Keys app') RETURNING id`, [tenantId]);
    const keptLink = await one(runner, `INSERT INTO application_companies (tenant_id, application_id, company_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, appId, companyId]);
    await runner.query(`INSERT INTO application_companies (tenant_id, application_id, company_id) VALUES ($1, $2, $3)`, [tenantId, appId, foreign]);
    await setTenant(runner, '');

    const log = await logged(() => migration.up(runner));
    const after = await companyKeys(runner);
    assert.deepEqual(after['departments.company_id'], ['r/not valid'], 'the NOT NULL column keeps its row under a NOT VALID key');
    for (const col of VALIDATED) assert.deepEqual(after[col], ['r/valid'], `${col}: one validated key, ON DELETE RESTRICT`);
    assert.deepEqual(after['company_metrics.company_id'], ['c/valid'], 'the metrics still cascade');
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');
    const tenantLine = `tenant ${slug} \\(${tenantId}\\)`;
    assert.match(log, new RegExp(`${tenantLine}: departments\\.company_id: 1 row\\(s\\) name a missing companies row \\(${strayDepartment}\\)`));
    assert.match(log, new RegExp(`${tenantLine}: users\\.company_id: 1 row\\(s\\) naming a missing companies row cleared`));
    assert.match(log, new RegExp(`${tenantLine}: portfolio_projects\\.company_id: 1 row\\(s\\) naming a missing companies row cleared`));
    assert.match(log, new RegExp(`${tenantLine}: application_companies\\.company_id: 1 row\\(s\\) naming a missing companies row deleted`));

    await setTenant(runner, tenantId);
    const [user] = await runner.query(`SELECT company_id FROM users WHERE id = $1`, [strayUser]);
    assert.equal(user.company_id, null, 'the user loses the missing company');
    const projects = await runner.query(`SELECT id, company_id FROM portfolio_projects WHERE tenant_id = $1`, [tenantId]);
    const companyOf = new Map(projects.map((row: { id: string; company_id: string | null }) => [row.id, row.company_id]));
    assert.equal(companyOf.get(orphan), null, 'the orphan project loses its company');
    assert.equal(companyOf.get(sound), companyId, 'the sound project keeps it');
    const links = await runner.query(`SELECT id FROM application_companies WHERE tenant_id = $1`, [tenantId]);
    assert.deepEqual(links.map((row: { id: string }) => row.id), [keptLink], 'the stray link is deleted, the other kept');

    // Fixed in the application: the rerun validates the last key.
    await runner.query(`UPDATE departments SET company_id = $2 WHERE id = $1`, [strayDepartment, companyId]);
    await setTenant(runner, '');
    await migration.up(runner);
    const fixed = await companyKeys(runner);
    assert.deepEqual(fixed['departments.company_id'], ['r/valid'], 'a rerun validates the key once the department is fixed');
    for (const col of VALIDATED) assert.deepEqual(fixed[col], ['r/valid'], `${col}: unchanged by the rerun`);
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

    const log = await logged(() => migration.up(runner));
    assert.match(log, /supplier_contacts\.supplier_id: 1 row\(s\) naming a missing suppliers row deleted/);
    await setTenant(runner, tenantId);
    const links = await runner.query(`SELECT id FROM supplier_contacts WHERE tenant_id = $1`, [tenantId]);
    assert.deepEqual(links.map((row: { id: string }) => row.id), [kept], 'the orphaned link is deleted, the other kept');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM contacts WHERE id = $1`, [contactId]);
    assert.equal(n, 1, 'the contact stays');
    assert.ok(orphan);
    await setTenant(runner, '');

    const keys = await runner.query(
      `SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conrelid = 'supplier_contacts'::regclass AND contype = 'f' AND confrelid = 'suppliers'::regclass`,
    );
    assert.deepEqual(keys, [{ conname: 'fk_supplier_contacts_supplier', confdeltype: 'c', convalidated: true }]);
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
