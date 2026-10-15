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

// F2 of the C4 review: a users CSV check creates no role. A role name the tenant
// does not have is a valid row: the check answers with `rolesToCreate` and
// writes nothing, the load creates the role, as it always has. A file that is
// refused creates no role either.

type Result = {
  ok: boolean;
  dryRun: boolean;
  inserted: number;
  updated: number;
  unchanged?: number;
  processed?: number;
  errors: Array<{ row: number; message: string }>;
  rolesToCreate?: string[];
};

const HEADERS = 'email,first_name,last_name,role,company_name,department_name,status';

function file(lines: string[]): Express.Multer.File {
  const content = `${HEADERS}\n${lines.join('\n')}\n`;
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'users.csv' } as Express.Multer.File;
}

function line(email: string, role: string): string {
  return `${email},Probe,Row,${role},,,contact`;
}

function usersService(manager: QueryRunner['manager']): UsersService {
  const audit = new AuditService(manager.getRepository(AuditLog));
  return new UsersService(
    manager.getRepository(User),
    manager.getRepository(Company),
    manager.getRepository(Department),
    new RolesService(manager.getRepository(Role), manager.getRepository(RolePermission)),
    undefined as any,
    undefined as any,
    audit,
  );
}

async function roleNames(runner: QueryRunner, tenantId: string): Promise<string[]> {
  const rows = await runner.query(`SELECT role_name FROM roles WHERE tenant_id = $1 ORDER BY role_name`, [tenantId]);
  return rows.map((row: any) => row.role_name);
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Users role check test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `users-roles-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** A role that exists before the file is read. */
async function seedRole(runner: QueryRunner, tenantId: string, name: string) {
  await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system)
     VALUES ($1, $2, $3, false)`,
    [tenantId, name, `${name} role`],
  );
}

async function testCheckCreatesNothing() {
  await withTenant('check', async (runner, tenantId) => {
    await seedRole(runner, tenantId, 'Administrator');
    const users = usersService(runner.manager);
    const before = await roleNames(runner, tenantId);

    const dry: Result = await users.importCsv(
      { file: file([line('admn@example.test', 'Admn')]), dryRun: true, userId: null },
      { manager: runner.manager },
    );

    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual(dry.rolesToCreate, ['Admn'], 'the check lists the role the load would create');
    assert.equal(dry.inserted, 1, 'the row is valid');
    assert.deepEqual(await roleNames(runner, tenantId), before, 'the check left the roles table alone');
    const [count] = await runner.query(`SELECT count(*)::int AS n FROM roles WHERE tenant_id = $1 AND role_name = 'Admn'`, [tenantId]);
    assert.equal(count.n, 0, 'no Admn role exists after the check');
  });
}

async function testTheLoadCreatesIt() {
  await withTenant('load', async (runner, tenantId) => {
    const users = usersService(runner.manager);
    const email = `newcomer-${randomUUID().slice(0, 8)}@example.test`;

    const dry: Result = await users.importCsv(
      { file: file([line(email, 'Admn')]), dryRun: true, userId: null },
      { manager: runner.manager },
    );
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));

    const loaded: Result = await users.importCsv(
      { file: file([line(email, 'Admn')]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.equal(loaded.processed, 1);
    assert.ok((await roleNames(runner, tenantId)).includes('Admn'), 'the load created the role');

    const [row] = await runner.query(
      `SELECT u.email, r.role_name
         FROM users u JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1 AND u.email = $2`,
      [tenantId, email],
    );
    assert.deepEqual(row, { email, role_name: 'Admn' }, 'the user carries the created role');
  });
}

async function testRefusedFileCreatesNothing() {
  await withTenant('refused', async (runner, tenantId) => {
    await seedRole(runner, tenantId, 'Administrator');
    const users = usersService(runner.manager);
    const before = await roleNames(runner, tenantId);

    // The second row has no valid email, so the whole file is refused.
    const result: Result = await users.importCsv(
      { file: file([line('ok@example.test', 'Admn'), line('not-an-email', 'Admn')]), dryRun: false, userId: null },
      { manager: runner.manager },
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.rolesToCreate, [], 'a refused file offers nothing to create');
    assert.deepEqual(await roleNames(runner, tenantId), before, 'a refused load creates no role');
  });
}

async function testKnownRolesAreNotListed() {
  await withTenant('known', async (runner, tenantId) => {
    await seedRole(runner, tenantId, 'Administrator');
    const users = usersService(runner.manager);

    const dry: Result = await users.importCsv(
      {
        file: file([
          line('one@example.test', 'Administrator'),
          line('two@example.test', 'Administrator'),
          line('three@example.test', 'Admn'),
          line('four@example.test', 'admn'),
        ]),
        dryRun: true,
        userId: null,
      },
      { manager: runner.manager },
    );

    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual(dry.rolesToCreate, ['Admn'], 'a stored role is not listed, and one name is listed once');
  });
}

async function testBlankRoleAsksForTheDefault() {
  await withTenant('default', async (runner, tenantId) => {
    const users = usersService(runner.manager);
    const dry: Result = await users.importCsv(
      { file: file([`contact-${randomUUID().slice(0, 8)}@example.test,Probe,Row,,,,contact`]), dryRun: true, userId: null },
      { manager: runner.manager },
    );
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual(dry.rolesToCreate, ['Contact'], 'a blank role cell asks for the default role');
  });
}

// A re-imported row equal to the stored user counts as unchanged: the load does
// not write it, so it leaves no audit line. Dry run and load give the same counts.
async function testIdenticalRowsUnchanged() {
  await withTenant('unchanged', async (runner, tenantId) => {
    await seedRole(runner, tenantId, 'Administrator');
    const [company] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Acme', 'FR', 'Paris') RETURNING id`,
      [tenantId],
    );
    await runner.query(
      `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance')`,
      [tenantId, company.id],
    );
    const users = usersService(runner.manager);
    const same = 'Same.Person@example.test';
    const other = 'other.person@example.test';
    const original = [
      `${same},Ada,Lovelace,administrator,Acme,Finance,Enabled`,
      `${other},Alan,Turing,Administrator,,,disabled`,
    ];
    const first: Result = await users.importCsv(
      { file: file(original), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(first.ok, true, JSON.stringify(first.errors));
    assert.equal(first.inserted, 2);

    const auditCount = async (email: string): Promise<number> => {
      const [row] = await runner.query(
        `SELECT count(*)::int AS n FROM audit_log a JOIN users u ON u.id = a.record_id AND u.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND a.table_name = 'users' AND u.email = $2`,
        [tenantId, email],
      );
      return row.n;
    };
    const sameAudit = await auditCount(same);
    const otherAudit = await auditCount(other);

    const again = file([original[0], `${other},Alan,Turing,Administrator,,,enabled`]);
    const dry: Result = await users.importCsv({ file: again, dryRun: true, userId: null }, { manager: runner.manager });
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual(
      { inserted: dry.inserted, updated: dry.updated, unchanged: dry.unchanged },
      { inserted: 0, updated: 1, unchanged: 1 },
      'the check counts the identical row as unchanged',
    );

    const loaded: Result = await users.importCsv({ file: again, dryRun: false, userId: null }, { manager: runner.manager });
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual(
      { inserted: loaded.inserted, updated: loaded.updated, unchanged: loaded.unchanged },
      { inserted: 0, updated: 1, unchanged: 1 },
      'the load gives the counts of the check',
    );
    assert.equal(await auditCount(same), sameAudit, 'the identical user is not written');
    assert.equal(await auditCount(other), otherAudit + 1, 'the changed user is written');
    const [row] = await runner.query(`SELECT status FROM users WHERE tenant_id = $1 AND email = $2`, [tenantId, other]);
    assert.equal(row.status, 'enabled');

    // A role the load would create is a change, even when the user is otherwise identical.
    const newRole = file([`${same},Ada,Lovelace,Auditor,Acme,Finance,enabled`]);
    const dryRole: Result = await users.importCsv({ file: newRole, dryRun: true, userId: null }, { manager: runner.manager });
    assert.deepEqual({ updated: dryRole.updated, unchanged: dryRole.unchanged }, { updated: 1, unchanged: 0 });
  });
}

async function main() {
  await dataSource.initialize();
  const tests: Array<[string, () => Promise<void>]> = [
    ['testCheckCreatesNothing', testCheckCreatesNothing],
    ['testTheLoadCreatesIt', testTheLoadCreatesIt],
    ['testRefusedFileCreatesNothing', testRefusedFileCreatesNothing],
    ['testKnownRolesAreNotListed', testKnownRolesAreNotListed],
    ['testBlankRoleAsksForTheDefault', testBlankRoleAsksForTheDefault],
    ['testIdenticalRowsUnchanged', testIdenticalRowsUnchanged],
  ];
  let failed = 0;
  try {
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`not ok - ${name}`);
        console.error(err);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failed > 0) {
    console.error(`users-import-roles.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('users-import-roles.integration.spec: ok');
}

void main();
