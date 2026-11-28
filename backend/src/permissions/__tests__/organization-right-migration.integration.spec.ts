import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { OrganizationRight1856330000000 as Migration } from '../../migrations/1856330000000-organization-right';

// Migration 1856330000000 (the `organization` right, lot A1), against a real database, each test in
// a transaction that is rolled back. The database is migrated already: each test seeds roles as a
// database of before the right holds them (the rows of its own tenants are removed first), then
// runs up(). The rule: every role that opened Branding, Authentication and the Audit log keeps them.
// - tenant A: a custom role with `users:admin` (gets organization:admin), one with `users:reader`
//   only (nothing), one with a `users:admin` row of tenant B (never read: nothing), the
//   Administrator without any `users` row (gets organization:admin), a custom role with
//   `users:admin` and an `organization:reader` row set by hand (kept), an Administrator-named row
//   below admin in tenant B (put back to admin), a custom role whose `organization` row is of
//   another tenant (rewritten to its own), custom roles with `users:admin` and an `organization`
//   row at `manager` or `member` (a level other than reader or admin: set to admin), a
//   custom role named "Administrator " with a trailing space (the guard does not read it as the
//   Administrator: nothing);
// - row level security on role_permissions and roles as found, and the counts in the log;
// - a second run writes no row; down() removes every `organization` row, up() again puts them back.
// The assertions read this test's own rows, never table-wide counts. Runs on an empty migrated
// database too (it seeds everything it reads).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const LOG_PREFIX = '[Migration] OrganizationRight:';

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
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

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = `organization-right-${tag}-${id.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, slug, `Organization right ${tag}`],
  );
  return { id, slug };
}

/** A role of the tenant with these rows, each written as the tenant given (its own by default). */
async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  rights: Record<string, string>,
  rowTenant: Record<string, string> = {},
  system = false,
): Promise<string> {
  await asTenant(runner, tenantId);
  const [created] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system) VALUES ($1, $2, 'seeded', $3) RETURNING id::text AS id`,
    [tenantId, name, system],
  );
  for (const [resource, level] of Object.entries(rights)) {
    const owner = rowTenant[resource] ?? tenantId;
    await asTenant(runner, owner);
    await runner.query(
      `INSERT INTO role_permissions (role_id, resource, level, tenant_id) VALUES ($1, $2, $3, $4)`,
      [created.id, resource, level, owner],
    );
  }
  return created.id;
}

let seededTenants: string[] = [];

/** Every right of the roles, read as each seeded tenant (`role → resource → level@tenant`). */
async function rightsOf(runner: QueryRunner, roleIds: string[]): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const id of roleIds) out[id] = {};
  for (const tenantId of seededTenants) {
    await asTenant(runner, tenantId);
    const rows: Array<{ role_id: string; resource: string; level: string }> = await runner.query(
      `SELECT role_id::text AS role_id, resource, level FROM role_permissions WHERE role_id = ANY ($1::uuid[])`,
      [roleIds],
    );
    for (const row of rows) out[row.role_id][row.resource] = `${row.level}@${tenantId === seededTenants[0] ? 'A' : 'B'}`;
  }
  return out;
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return { enabled: row.enabled, forced: row.forced };
}

interface Seeded {
  a: { id: string; slug: string };
  b: { id: string; slug: string };
  roles: Record<string, string>;
}

async function seedBeforeMigration(runner: QueryRunner): Promise<Seeded> {
  const a = await seedTenant(runner, 'a');
  const b = await seedTenant(runner, 'b');
  seededTenants = [a.id, b.id];
  const roles: Record<string, string> = {
    peopleAdmin: await seedRole(runner, a.id, 'People admin', { users: 'admin', tasks: 'reader' }),
    peopleReader: await seedRole(runner, a.id, 'People reader', { users: 'reader' }),
    stray: await seedRole(runner, a.id, 'Stray users row', { users: 'admin' }, { users: b.id }),
    administratorA: await seedRole(runner, a.id, 'Administrator', { budget: 'admin' }, {}, true),
    handSet: await seedRole(runner, a.id, 'Auditor set by hand', { users: 'admin', organization: 'reader' }),
    foreignRow: await seedRole(runner, a.id, 'Foreign organization row', { users: 'admin', organization: 'reader' }, { organization: b.id }),
    administratorB: await seedRole(runner, b.id, 'Administrator', { users: 'admin', organization: 'member' }, {}, true),
    managerRow: await seedRole(runner, a.id, 'Manager level row', { users: 'admin', organization: 'manager' }),
    memberRow: await seedRole(runner, a.id, 'Member level row', { users: 'admin', organization: 'member' }),
    trailingSpace: await seedRole(runner, a.id, 'Administrator ', { budget: 'admin' }),
    nothing: await seedRole(runner, b.id, 'Budget only', { budget: 'member' }),
  };
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return { a, b, roles };
}

const EXPECTED_AFTER_UP = (roles: Record<string, string>) => ({
  [roles.peopleAdmin]: { users: 'admin@A', tasks: 'reader@A', organization: 'admin@A' },
  [roles.peopleReader]: { users: 'reader@A' },
  [roles.stray]: { users: 'admin@B' },
  [roles.administratorA]: { budget: 'admin@A', organization: 'admin@A' },
  [roles.handSet]: { users: 'admin@A', organization: 'reader@A' },
  [roles.foreignRow]: { users: 'admin@A', organization: 'admin@A' },
  [roles.administratorB]: { users: 'admin@B', organization: 'admin@B' },
  [roles.managerRow]: { users: 'admin@A', organization: 'admin@A' },
  [roles.memberRow]: { users: 'admin@A', organization: 'admin@A' },
  [roles.trailingSpace]: { budget: 'admin@A' },
  [roles.nothing]: { budget: 'member@B' },
});

function linesOf(lines: string[], text: string): string[] {
  return lines.filter((line) => line.includes(text));
}

async function testGrant() {
  await inRolledBackTransaction(async (runner) => {
    const { a, b, roles } = await seedBeforeMigration(runner);
    const security = {
      role_permissions: await rowSecurity(runner, 'role_permissions'),
      roles: await rowSecurity(runner, 'roles'),
    };
    const { lines } = await captureLog(() => migration.up(runner));

    assert.deepEqual(await rightsOf(runner, Object.values(roles)), EXPECTED_AFTER_UP(roles));
    for (const table of ['role_permissions', 'roles'] as const) {
      assert.deepEqual(await rowSecurity(runner, table), security[table], `${table}: row level security as found`);
    }

    // The log: roles given the right per tenant, the rows rewritten or kept below admin, the counts.
    assert.equal(linesOf(lines, `tenant ${a.slug} (${a.id}): 2 role(s) given organization:admin`).length, 1, lines.join('\n'));
    assert.equal(linesOf(lines, `tenant ${b.slug} (${b.id}): `).filter((line) => line.includes('given')).length, 0, lines.join('\n'));
    const named = (name: string, tenant: { id: string; slug: string }) =>
      linesOf(lines, `tenant ${tenant.slug} (${tenant.id}): role "${name}" (`);
    const ends = (name: string, tenant: { id: string; slug: string }, text: string) => {
      const found = named(name, tenant);
      assert.equal(found.length, 1, `${name}: one line\n${lines.join('\n')}`);
      assert.ok(found[0].endsWith(`: ${text}`), `${name}: ${found[0]}`);
    };
    ends('Auditor set by hand', a, 'organization=reader -> kept');
    ends('Foreign organization row', a, `organization=reader (row of tenant ${b.id}, never read) -> organization=admin`);
    ends('Administrator', b, 'organization=member -> organization=admin');
    ends('Manager level row', a, 'organization=manager -> organization=admin');
    ends('Member level row', a, 'organization=member -> organization=admin');
    for (const [name, tenant] of [['People admin', a], ['Administrator', a], ['Administrator ', a], ['People reader', a], ['Stray users row', a], ['Budget only', b]] as const) {
      assert.equal(named(name, tenant).length, 0, `${name}: not named`);
    }
    assert.ok(lines.every((line) => line.startsWith(LOG_PREFIX)), 'every line is prefixed');
    const summary = lines.find((line) => line.includes('done in'));
    assert.match(
      summary ?? '',
      /done in \d+ ms: \d+ role\(s\) of \d+ tenant\(s\) planned \(\d+ Administrator, \d+ with users:admin\); \d+ organization:admin row\(s\) added, \d+ row\(s\) set to admin \(\d+ of them at a level other than reader or admin\), \d+ row\(s\) already there kept$/,
      lines.join('\n'),
    );
  });
}

async function testRerun() {
  await inRolledBackTransaction(async (runner) => {
    const { a, b, roles } = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const stamps = async () => {
      const out: string[] = [];
      for (const tenantId of seededTenants) {
        await asTenant(runner, tenantId);
        const rows: Array<{ id: string; updated_at: Date }> = await runner.query(
          `SELECT id::text AS id, updated_at FROM role_permissions WHERE role_id = ANY ($1::uuid[]) ORDER BY id`,
          [Object.values(roles)],
        );
        out.push(...rows.map((row) => `${row.id}@${new Date(row.updated_at).toISOString()}`));
      }
      return out;
    };
    const before = await stamps();
    const second = await captureLog(() => migration.up(runner));
    assert.deepEqual(await rightsOf(runner, Object.values(roles)), EXPECTED_AFTER_UP(roles));
    assert.deepEqual(await stamps(), before, 'a second run writes no row');
    // Only the row kept below admin is named again; nothing is given or rewritten.
    const ofTests = [...linesOf(second.lines, a.slug), ...linesOf(second.lines, b.slug)];
    assert.deepEqual(ofTests.map((line) => line.slice(line.lastIndexOf(': ') + 2)), ['organization=reader -> kept'], second.lines.join('\n'));
    assert.match(second.lines.join('\n'), / 0 organization:admin row\(s\) added, 0 row\(s\) set to admin \(0 of them at a level other than reader or admin\), /);
  });
}

async function testDownThenUp() {
  await inRolledBackTransaction(async (runner) => {
    const { roles } = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const { lines } = await captureLog(() => migration.down(runner));
    const after = await rightsOf(runner, Object.values(roles));
    for (const [role, rights] of Object.entries(after)) {
      assert.equal(rights.organization, undefined, `${role}: no organization row after down()`);
    }
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM role_permissions WHERE resource = 'organization'`);
    assert.equal(n, 0, 'no organization row left (without a tenant, none at all is visible)');
    assert.ok(lines.some((line) => /reverted in \d+ ms: \d+ organization row\(s\) removed/.test(line)), lines.join('\n'));
    assert.deepEqual(await rowSecurity(runner, 'role_permissions'), { enabled: true, forced: true }, 'row level security back after down()');

    await captureLog(() => migration.up(runner));
    const again = EXPECTED_AFTER_UP(roles);
    // The rows set by hand went with down(): the custom role gets organization:admin back, as its users:admin gives.
    again[roles.handSet] = { users: 'admin@A', organization: 'admin@A' };
    assert.deepEqual(await rightsOf(runner, Object.values(roles)), again);
  });
}

async function testRefusedWhenTheRightDoesNotHold() {
  await inRolledBackTransaction(async (runner) => {
    const { roles } = await seedBeforeMigration(runner);
    const security = await rowSecurity(runner, 'role_permissions');
    // A trigger that lowers the Administrator's new row: the check after the writes refuses it.
    await runner.query(`
      CREATE FUNCTION organization_right_spec_lower() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.resource = 'organization' AND NEW.role_id = '${roles.administratorA}'::uuid THEN NEW.level := 'reader'; END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`
      CREATE TRIGGER organization_right_spec_lower BEFORE INSERT OR UPDATE ON role_permissions
      FOR EACH ROW EXECUTE FUNCTION organization_right_spec_lower()`);
    await runner.query('SAVEPOINT before_up');
    await assert.rejects(
      () => captureLog(() => migration.up(runner)),
      (error: Error) => {
        assert.match(error.message, new RegExp(`${roles.administratorA} organization=reader .*nothing was changed`));
        return true;
      },
    );
    assert.deepEqual(await rowSecurity(runner, 'role_permissions'), security, 'row level security as found after the refusal');
    await runner.query('ROLLBACK TO SAVEPOINT before_up');
    const rights = await rightsOf(runner, [roles.administratorA]);
    assert.deepEqual(rights[roles.administratorA], { budget: 'admin@A' });
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testGrant, testRerun, testDownThenUp, testRefusedWhenTheRightDoesNotHold]) {
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
    throw new Error(`organization-right-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('organization-right-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
