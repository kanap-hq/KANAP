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

// Company and department names are unique whatever their case. The users import finds
// them that way, and the result of a row does not depend on the rows before it: a name
// in any case resolves to the same company or department, and a name that matches
// nothing is refused on every row that writes it. The spec only runs the check.

type Result = {
  ok: boolean;
  dryRun: boolean;
  inserted: number;
  updated: number;
  unchanged?: number;
  errors: Array<{ row: number; column?: string; code?: string; message: string }>;
};

const ADMIN_ACTOR = { isAdmin: true, permissions: { users: 'admin' } };
const COMPANY = 'Harbor Supplies Inc.';
const DEPARTMENT = 'Procurement';

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

async function withTenant(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Users import name case', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `users-case-${tenantId.slice(0, 8)}`],
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

/** Two people already in the company and its department, so a check that resolves the same names leaves both rows unchanged. */
async function seed(runner: QueryRunner, tenantId: string) {
  const role = await insertId(
    runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system) VALUES ($1, 'Contact', 'Contact', true)`,
    [tenantId],
  );
  const company = await insertId(
    runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Paris')`,
    [tenantId, COMPANY],
  );
  const department = await insertId(
    runner,
    `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3)`,
    [tenantId, company, DEPARTMENT],
  );
  const people: Array<{ id: string; email: string }> = [];
  for (const first of ['Ada', 'Grace']) {
    const email = `${first.toLowerCase()}-${tenantId.slice(0, 8)}@example.test`;
    const id = await insertId(
      runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, company_id, department_id, status)
       VALUES ($1, $2, $3, 'Hopper', $4, $5, $6, 'contact')`,
      [tenantId, email, first, role, company, department],
    );
    people.push({ id, email });
  }
  return { company, department, people };
}

async function check(users: UsersService, runner: QueryRunner, text: string): Promise<Result> {
  return users.importCsv(
    { file: csv(text), dryRun: true, userId: null, roleGrant: ADMIN_ACTOR },
    { manager: runner.manager },
  ) as Promise<Result>;
}

async function counts(runner: QueryRunner, tenantId: string) {
  const [users] = await runner.query(`SELECT count(*)::int AS n FROM users WHERE tenant_id = $1`, [tenantId]);
  const [tokens] = await runner.query(`SELECT count(*)::int AS n FROM password_reset_tokens WHERE tenant_id = $1`, [tenantId]);
  return { users: users.n as number, tokens: tokens.n as number };
}

async function storedCompany(runner: QueryRunner, id: string) {
  const [row] = await runner.query(`SELECT company_id, department_id FROM users WHERE id = $1`, [id]);
  return row as { company_id: string; department_id: string };
}

// The first row writes the stored names in another case, the second writes them exactly.
// Both resolve to that company and that department: each row is unchanged.
async function testOtherCaseThenExact() {
  await withTenant(async (runner, tenantId) => {
    const mails: string[] = [];
    const users = usersService(runner.manager, mails);
    const { company, department, people } = await seed(runner, tenantId);
    const before = await counts(runner, tenantId);
    const [first, second] = people;

    const result = await check(
      users,
      runner,
      [
        'email,company_name,department_name',
        `${first.email},${COMPANY.toLowerCase()},${DEPARTMENT.toLowerCase()}`,
        `${second.email},${COMPANY},${DEPARTMENT}`,
      ].join('\n'),
    );

    assert.equal(result.dryRun, true);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 0, 2]);
    assert.deepEqual(await storedCompany(runner, first.id), { company_id: company, department_id: department });
    assert.deepEqual(await storedCompany(runner, second.id), { company_id: company, department_id: department });
    assert.deepEqual(await counts(runner, tenantId), before, 'the check wrote nothing');
    assert.deepEqual(mails, [], 'no invitation');
  });
}

// A company or a department that matches nothing is refused on every row, in either case.
async function testUnknownNameOnEveryRow() {
  await withTenant(async (runner, tenantId) => {
    const mails: string[] = [];
    const users = usersService(runner.manager, mails);
    const { people } = await seed(runner, tenantId);
    const before = await counts(runner, tenantId);
    const [first, second] = people;

    const company = await check(
      users,
      runner,
      [
        'email,company_name',
        `${first.email},missing supplies`,
        `${second.email},Missing Supplies`,
      ].join('\n'),
    );
    assert.equal(company.ok, false);
    assert.deepEqual(
      company.errors.map((error) => [error.row, error.column, error.code, error.message]),
      [
        [2, 'company_name', 'CSV_REFERENCE_NOT_FOUND', "Unknown company 'missing supplies'"],
        [3, 'company_name', 'CSV_REFERENCE_NOT_FOUND', "Unknown company 'Missing Supplies'"],
      ],
    );

    const department = await check(
      users,
      runner,
      [
        'email,company_name,department_name',
        `${first.email},${COMPANY.toLowerCase()},no such desk`,
        `${second.email},${COMPANY},No Such Desk`,
      ].join('\n'),
    );
    assert.equal(department.ok, false);
    assert.deepEqual(
      department.errors.map((error) => [error.row, error.column, error.code, error.message]),
      [
        [2, 'department_name', 'CSV_REFERENCE_NOT_FOUND', `Unknown department 'no such desk' for company '${COMPANY}'`],
        [3, 'department_name', 'CSV_REFERENCE_NOT_FOUND', `Unknown department 'No Such Desk' for company '${COMPANY}'`],
      ],
    );

    assert.deepEqual(await counts(runner, tenantId), before, 'the check wrote nothing');
    assert.deepEqual(mails, [], 'no invitation');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testOtherCaseThenExact();
    await testUnknownNameOnEveryRow();
  } finally {
    await dataSource.destroy();
  }
  console.log('users-import-name-case.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
