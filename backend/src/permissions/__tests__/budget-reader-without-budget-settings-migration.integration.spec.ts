import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetReaderWithoutBudgetSettings1856340000000 as Migration } from '../../migrations/1856340000000-budget-reader-without-budget-settings';

// Migration 1856340000000 (the shipped Budget Reader role no longer reads the budget settings),
// against a real database, each test in a transaction that is rolled back. The database is
// migrated already: each test seeds the rows of a database of before, then runs up().
// - tenant A: the built-in Budget Reader with `budget_ops:reader` (removed, its other rights kept),
//   a copy of it made by an administrator (not built-in: kept), the built-in Budget Member and
//   Budget Administrator (kept);
// - tenant B: the built-in Budget Reader holding the right under two of its other names,
//   `budget-ops:reader` and `budget_admin:admin` (both removed, whatever the level);
// - tenant C: a role the tenant created under the name "Budget Reader", not built-in (kept);
// - row level security on role_permissions and roles as found; one log line per tenant changed;
// - a second run writes nothing; down() gives `budget_ops:reader` back to the built-in Budget
//   Readers only, up() again removes it;
// - a removal that does not hold (a trigger skips one delete) is refused, nothing left half done.
// The assertions read this test's own rows, never table-wide counts. Runs on an empty migrated
// database too (it seeds everything it reads).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const LOG_PREFIX = '[Migration] BudgetReaderWithoutBudgetSettings:';

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
  const slug = `budget-reader-${tag}-${id.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, slug, `Budget reader ${tag}`],
  );
  return { id, slug };
}

async function seedRole(runner: QueryRunner, tenantId: string, name: string, builtIn: boolean, rights: Record<string, string>): Promise<string> {
  await asTenant(runner, tenantId);
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_built_in) VALUES ($1, $2, 'seeded', $3) RETURNING id::text AS id`,
    [tenantId, name, builtIn],
  );
  for (const [resource, level] of Object.entries(rights)) {
    await runner.query(
      `INSERT INTO role_permissions (role_id, resource, level, tenant_id) VALUES ($1, $2, $3, $4)`,
      [role.id, resource, level, tenantId],
    );
  }
  return role.id;
}

let seededTenants: string[] = [];

/** Every right of the roles, as each seeded tenant sees it (`role → resource → level`). */
async function rightsOf(runner: QueryRunner, roleIds: string[]): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const id of roleIds) out[id] = {};
  for (const tenantId of seededTenants) {
    await asTenant(runner, tenantId);
    const rows: Array<{ role_id: string; resource: string; level: string }> = await runner.query(
      `SELECT role_id::text AS role_id, resource, level FROM role_permissions WHERE role_id = ANY ($1::uuid[])`,
      [roleIds],
    );
    for (const row of rows) out[row.role_id][row.resource] = row.level;
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

type Tenant = { id: string; slug: string };
interface Seeded { a: Tenant; b: Tenant; c: Tenant; roles: Record<string, string> }

async function seedBeforeMigration(runner: QueryRunner): Promise<Seeded> {
  const a = await seedTenant(runner, 'a');
  const b = await seedTenant(runner, 'b');
  const c = await seedTenant(runner, 'c');
  seededTenants = [a.id, b.id, c.id];
  const roles: Record<string, string> = {
    readerA: await seedRole(runner, a.id, 'Budget Reader', true, { budget: 'reader', budget_ops: 'reader', companies: 'reader' }),
    copyA: await seedRole(runner, a.id, 'Budget Reader (copy)', false, { budget: 'reader', budget_ops: 'reader' }),
    memberA: await seedRole(runner, a.id, 'Budget Member', true, { budget: 'member', budget_ops: 'reader' }),
    adminA: await seedRole(runner, a.id, 'Budget Administrator', true, { budget: 'admin', budget_ops: 'admin' }),
    readerB: await seedRole(runner, b.id, 'Budget Reader', true, { budget: 'reader', 'budget-ops': 'reader', budget_admin: 'admin' }),
    namedC: await seedRole(runner, c.id, 'Budget Reader', false, { budget: 'reader', budget_ops: 'reader' }),
  };
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return { a, b, c, roles };
}

const EXPECTED_AFTER_UP = (roles: Record<string, string>) => ({
  [roles.readerA]: { budget: 'reader', companies: 'reader' },
  [roles.copyA]: { budget: 'reader', budget_ops: 'reader' },
  [roles.memberA]: { budget: 'member', budget_ops: 'reader' },
  [roles.adminA]: { budget: 'admin', budget_ops: 'admin' },
  [roles.readerB]: { budget: 'reader' },
  [roles.namedC]: { budget: 'reader', budget_ops: 'reader' },
});

const linesOf = (lines: string[], text: string) => lines.filter((line) => line.includes(text));

async function testRemoval() {
  await inRolledBackTransaction(async (runner) => {
    const { a, b, c, roles } = await seedBeforeMigration(runner);
    const security = {
      role_permissions: await rowSecurity(runner, 'role_permissions'),
      roles: await rowSecurity(runner, 'roles'),
    };
    const { lines } = await captureLog(() => migration.up(runner));

    assert.deepEqual(await rightsOf(runner, Object.values(roles)), EXPECTED_AFTER_UP(roles));
    for (const table of ['role_permissions', 'roles'] as const) {
      assert.deepEqual(await rowSecurity(runner, table), security[table], `${table}: row level security as found`);
    }

    const lineA = linesOf(lines, `tenant ${a.slug} (${a.id}): built-in role "Budget Reader" (${roles.readerA}):`);
    assert.equal(lineA.length, 1, lines.join('\n'));
    assert.ok(lineA[0].endsWith(': budget_ops=reader removed'), lineA[0]);
    const lineB = linesOf(lines, `tenant ${b.slug} (${b.id}): built-in role "Budget Reader" (${roles.readerB}):`);
    assert.equal(lineB.length, 1, lines.join('\n'));
    assert.ok(lineB[0].endsWith(': budget-ops=reader, budget_admin=admin removed'), lineB[0]);
    assert.equal(linesOf(lines, c.slug).length, 0, 'a role the tenant named Budget Reader is not touched');
    assert.ok(lines.every((line) => line.startsWith(LOG_PREFIX)), 'every line is prefixed');
    assert.ok(
      lines.some((line) => /done in \d+ ms: \d+ row\(s\) removed from \d+ built-in Budget Reader role\(s\) of \d+ tenant\(s\)$/.test(line)),
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
    assert.equal(linesOf(second.lines, a.slug).length + linesOf(second.lines, b.slug).length, 0, 'nothing of the test tenants is removed again');
    assert.ok(second.lines.some((line) => line.includes('no built-in Budget Reader holds budget administration; nothing to remove')), second.lines.join('\n'));
  });
}

async function testDownThenUp() {
  await inRolledBackTransaction(async (runner) => {
    const { roles } = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const { lines } = await captureLog(() => migration.down(runner));
    assert.deepEqual(await rightsOf(runner, Object.values(roles)), {
      ...EXPECTED_AFTER_UP(roles),
      // The built-in Budget Readers read budget administration again; the alias rows and the
      // level of before up() are not restorable.
      [roles.readerA]: { budget: 'reader', budget_ops: 'reader', companies: 'reader' },
      [roles.readerB]: { budget: 'reader', budget_ops: 'reader' },
    });
    assert.ok(lines.some((line) => /reverted in \d+ ms: \d+ built-in Budget Reader role\(s\) read budget administration again/.test(line)), lines.join('\n'));

    // A second down() writes nothing more.
    const again = await captureLog(() => migration.down(runner));
    assert.ok(again.lines.some((line) => / 0 built-in Budget Reader role\(s\) read budget administration again/.test(line)), again.lines.join('\n'));

    await captureLog(() => migration.up(runner));
    assert.deepEqual(await rightsOf(runner, Object.values(roles)), EXPECTED_AFTER_UP(roles));
  });
}

async function testRefusedWhenTheRemovalDoesNotHold() {
  await inRolledBackTransaction(async (runner) => {
    const { roles } = await seedBeforeMigration(runner);
    const security = await rowSecurity(runner, 'role_permissions');
    // A trigger that skips the delete of one row: the check after the removal refuses it.
    await runner.query(`
      CREATE FUNCTION budget_reader_spec_keep() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.role_id = '${roles.readerA}'::uuid THEN RETURN NULL; END IF;
        RETURN OLD;
      END $$`);
    await runner.query(`
      CREATE TRIGGER budget_reader_spec_keep BEFORE DELETE ON role_permissions
      FOR EACH ROW EXECUTE FUNCTION budget_reader_spec_keep()`);
    await runner.query('SAVEPOINT before_up');
    await assert.rejects(
      () => captureLog(() => migration.up(runner)),
      (error: Error) => {
        assert.match(error.message, /up: 1 budget administration row\(s\) left on a built-in Budget Reader; nothing was changed/);
        return true;
      },
    );
    assert.deepEqual(await rowSecurity(runner, 'role_permissions'), security, 'row level security as found after the refusal');
    // The migration runs in the transaction of the pending migrations: its rollback leaves the rows as they were.
    await runner.query('ROLLBACK TO SAVEPOINT before_up');
    const rights = await rightsOf(runner, [roles.readerB]);
    assert.deepEqual(rights[roles.readerB], { budget: 'reader', 'budget-ops': 'reader', budget_admin: 'admin' });
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testRemoval, testRerun, testDownThenUp, testRefusedWhenTheRemovalDoesNotHold]) {
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
    throw new Error(`budget-reader-without-budget-settings-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('budget-reader-without-budget-settings-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
