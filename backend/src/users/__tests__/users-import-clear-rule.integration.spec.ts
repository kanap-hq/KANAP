import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Company } from '../../companies/company.entity';
import { Department } from '../../departments/department.entity';
import { Role } from '../../roles/role.entity';
import { RolePermission } from '../../permissions/role-permission.entity';
import { RolesService } from '../../roles/roles.service';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';

// The users import under the clearing rule of every import (D21 of 26.11.9, T-I6g of lot I6):
// only the address is required in the header; a column the file leaves out is never written; on a
// stored person a blank cell keeps the value, role and status included, so a row that names only the
// address and the first name neither demotes nor promotes anyone; `-` clears the first name, the last
// name, the company and the department (counted in `cleared`) and is refused on the address, the role
// and the status. A new person keeps today's defaults (role Contact, status contact), and `-` on one of
// their optional values is a blank cell. No import sends an e-mail: the e-mail service counts calls.

type Result = {
  ok: boolean;
  inserted: number;
  updated: number;
  unchanged?: number;
  cleared?: number;
  errors: Array<{ row: number; column?: string; code?: string; message: string }>;
  rolesToCreate?: string[];
};

const ADMIN_ACTOR = { isAdmin: true, permissions: { users: 'admin' } };

function csv(text: string): Express.Multer.File {
  return { buffer: Buffer.from(`${text}\n`, 'utf8'), originalname: 'users.csv' } as Express.Multer.File;
}

function usersService(manager: QueryRunner['manager'], mails: string[]): UsersService {
  const audit = new AuditService(manager.getRepository(AuditLog));
  // Every method of the e-mail service records its call: an import sends nothing.
  const email = new Proxy({}, { get: (_target, name) => async () => { mails.push(String(name)); } });
  return new UsersService(
    manager.getRepository(User),
    manager.getRepository(Company),
    manager.getRepository(Department),
    new RolesService(manager.getRepository(Role), manager.getRepository(RolePermission)),
    undefined as any,
    email as any,
    audit,
  );
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Users clear rule test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `users-clear-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

/** An enabled Administrator, the workspace's only one, with a company and a department. */
async function seedAdministrator(runner: QueryRunner, tenantId: string) {
  const adminRole = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description, is_system) VALUES ($1, 'Administrator', 'Administrator', true)`, [tenantId]);
  const contactRole = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description, is_system) VALUES ($1, 'Contact', 'Contact', true)`, [tenantId]);
  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Acme', 'FR', 'Paris')`, [tenantId]);
  const department = await insertId(runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'IT')`, [tenantId, company]);
  const email = `admin-${tenantId.slice(0, 8)}@example.test`;
  const id = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, company_id, department_id, status)
     VALUES ($1, $2, 'Ada', 'Lovelace', $3, $4, $5, 'enabled')`,
    [tenantId, email, adminRole, company, department]);
  return { id, email, adminRole, contactRole, company, department };
}

async function stored(runner: QueryRunner, id: string) {
  const [row] = await runner.query(
    `SELECT first_name, last_name, role_id, company_id, department_id, status FROM users WHERE id = $1`,
    [id],
  );
  return row;
}

async function run(users: UsersService, runner: QueryRunner, text: string, dryRun: boolean): Promise<Result> {
  return users.importCsv({ file: csv(text), dryRun, userId: null, roleGrant: ADMIN_ACTOR }, { manager: runner.manager }) as Promise<Result>;
}

// The address and the first name alone: the header is accepted, the Administrator keeps the role and
// the status, the workspace keeps its Administrator, and only the first name is written.
async function testAddressAndFirstNameOnly() {
  await withTenant('two', async (runner, tenantId) => {
    const mails: string[] = [];
    const users = usersService(runner.manager, mails);
    const admin = await seedAdministrator(runner, tenantId);
    for (const dryRun of [true, false]) {
      const result = await run(users, runner, `email,first_name\n${admin.email},Augusta`, dryRun);
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.deepEqual([result.inserted, result.updated, result.cleared], [0, 1, 0], `dryRun ${dryRun}`);
    }
    assert.deepEqual(await stored(runner, admin.id), {
      first_name: 'Augusta', last_name: 'Lovelace', role_id: admin.adminRole,
      company_id: admin.company, department_id: admin.department, status: 'enabled',
    });
    assert.deepEqual(mails, [], 'no e-mail');
  });
}

// The seven columns with blank cells: nothing changes, the row is unchanged (today the blank role and
// status made the Administrator a Contact, which the last-administrator rule refused).
async function testBlankCellsKeep() {
  await withTenant('blank', async (runner, tenantId) => {
    const mails: string[] = [];
    const users = usersService(runner.manager, mails);
    const admin = await seedAdministrator(runner, tenantId);
    const text = `email,first_name,last_name,role,company_name,department_name,status\n${admin.email},,,,,,`;
    for (const dryRun of [true, false]) {
      const result = await run(users, runner, text, dryRun);
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.deepEqual([result.updated, result.unchanged, result.cleared], [0, 1, 0], `dryRun ${dryRun}`);
    }
    assert.deepEqual(await stored(runner, admin.id), {
      first_name: 'Ada', last_name: 'Lovelace', role_id: admin.adminRole,
      company_id: admin.company, department_id: admin.department, status: 'enabled',
    });
    // A role the row names is still checked: the Administrator made a Contact leaves no Administrator.
    const demoted = await run(users, runner, `email,role\n${admin.email},Contact`, true);
    assert.equal(demoted.ok, false);
    assert.deepEqual(demoted.errors.map((error) => error.code), ['LAST_ADMINISTRATOR']);
    const disabled = await run(users, runner, `email,status\n${admin.email},disabled`, true);
    assert.deepEqual(disabled.errors.map((error) => error.code), ['LAST_ADMINISTRATOR']);
    assert.deepEqual(mails, [], 'no e-mail');
  });
}

// `-` clears the first name, the last name, the company and the department, counted at the check and
// the load alike; `-` on the address, the role or the status refuses the row.
async function testDashClears() {
  await withTenant('dash', async (runner, tenantId) => {
    const mails: string[] = [];
    const users = usersService(runner.manager, mails);
    const admin = await seedAdministrator(runner, tenantId);
    const header = 'email,first_name,last_name,role,company_name,department_name,status';
    for (const dryRun of [true, false]) {
      const result = await run(users, runner, `${header}\n${admin.email},-,-,,-,-,`, dryRun);
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.deepEqual([result.updated, result.cleared], [1, 4], `dryRun ${dryRun}`);
    }
    assert.deepEqual(await stored(runner, admin.id), {
      first_name: null, last_name: null, role_id: admin.adminRole, company_id: null, department_id: null, status: 'enabled',
    });
    // Nothing left to clear: the same file is unchanged and clears nothing.
    const again = await run(users, runner, `${header}\n${admin.email},-,-,,-,-,`, true);
    assert.deepEqual([again.ok, again.unchanged, again.cleared], [true, 1, 0]);

    const refused = await run(users, runner, `${header}\n-,,,,,,\n${admin.email},,,-,,,-`, true);
    assert.equal(refused.ok, false);
    assert.deepEqual(
      refused.errors.map((error) => [error.row, error.column, error.code]),
      [[2, 'email', 'CSV_VALUE_CANNOT_BE_CLEARED'], [3, 'role', 'CSV_VALUE_CANNOT_BE_CLEARED'], [3, 'status', 'CSV_VALUE_CANNOT_BE_CLEARED']],
    );
    assert.deepEqual(mails, [], 'no e-mail');
  });
}

// A new person gets today's defaults: role Contact, status contact; `-` on an optional value is a
// blank cell. A company named without the department keeps the stored department only when the company
// stays the same; another company drops the department of the former one.
async function testNewPersonAndCompany() {
  await withTenant('new', async (runner, tenantId) => {
    const mails: string[] = [];
    const users = usersService(runner.manager, mails);
    const admin = await seedAdministrator(runner, tenantId);
    const email = `new-${tenantId.slice(0, 8)}@example.test`;
    const created = await run(users, runner, `email,first_name,last_name\n${email},Grace,-`, false);
    assert.equal(created.ok, true, JSON.stringify(created.errors));
    assert.deepEqual([created.inserted, created.cleared], [1, 0]);
    const [person] = await runner.query(`SELECT first_name, last_name, role_id, status FROM users WHERE tenant_id = $1 AND email = $2`, [tenantId, email]);
    assert.deepEqual(person, { first_name: 'Grace', last_name: null, role_id: admin.contactRole, status: 'contact' });

    // An invited person imported: the status is written, no invitation goes out.
    const invited = await run(users, runner, `email,status\ninvited-${tenantId.slice(0, 8)}@example.test,invited`, false);
    assert.equal(invited.ok, true, JSON.stringify(invited.errors));

    await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Globex', 'FR', 'Lyon')`, [tenantId]);
    const same = await run(users, runner, `email,company_name\n${admin.email},Acme`, true);
    assert.deepEqual([same.ok, same.unchanged], [true, 1], JSON.stringify(same.errors));
    const moved = await run(users, runner, `email,company_name\n${admin.email},Globex`, false);
    assert.deepEqual([moved.ok, moved.updated, moved.cleared], [true, 1, 1], JSON.stringify(moved.errors));
    const after = await stored(runner, admin.id);
    assert.equal(after.department_id, null, 'the department of the former company is dropped');
    assert.deepEqual(mails, [], 'no e-mail');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testAddressAndFirstNameOnly();
    await testBlankCellsKeep();
    await testDashClears();
    await testNewPersonAndCompany();
  } finally {
    await dataSource.destroy();
  }
  console.log('users-import-clear-rule.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
