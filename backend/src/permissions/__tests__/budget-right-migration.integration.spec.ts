import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetRight1853990000000 as Migration } from '../../migrations/1853990000000-budget-right';

// Migration 1853990000000 (one budget right, lot R), against a real database, each test in a
// transaction that is rolled back. The database is migrated already: each test seeds roles that
// still hold `opex` / `capex` rows, as a database of before lot R does, then runs up(). The rule:
// each role keeps the access it had, `budget` = the highest effective `opex`/`capex` level as the
// guard of before lot R read it.
// - tenant A: a role with `opex:admin` and `capex:reader` (admin), `opex` only (member), `capex`
//   only (reader), `opex:manager` and `capex:reader` (reader: `manager` gave no access),
//   `manager` on both (no budget right), a `budget:admin` row of before with `opex`/`capex` at
//   reader (lowered to reader), a `budget:admin` row alone (deleted), both at member (member, not
//   listed), another right left alone (`tasks`), an `opex` row whose tenant is not its role's
//   (never read: no budget right, named with both tenants' slugs), and the built-in Budget
//   Administrator with the description seeded before lot R (updated);
// - tenant B: a role with `opex:reader` and `capex:admin` (admin), listed under its tenant, and a
//   built-in Budget Administrator whose description was changed by hand (left as it is);
// - tenant C, merged already (a `budget` row, no `opex`/`capex`): left alone;
// - row level security on role_permissions and roles as found;
// - a second run writes nothing; down() puts the merged level back on `opex` and `capex`, removes
//   `budget` and puts the description back, up() again merges them back;
// - a merge that does not hold (a trigger lowers one level) is refused with the role named, and
//   nothing is left half done.
// The assertions read this test's own rows, never table-wide counts. Runs on an empty migrated
// database too (it seeds everything it reads).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const LOG_PREFIX = '[Migration] BudgetRight:';

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
  const slug = `budget-right-${tag}-${id.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, slug, `Budget right ${tag}`],
  );
  return { id, slug };
}

const BUDGET_ADMIN_BEFORE = 'Full control over budget management including OPEX, CAPEX, contracts, and reporting';
const BUDGET_ADMIN_AFTER = 'Full control over budget management including budget lines, contracts, and reporting';
const HAND_WRITTEN = 'Our budget owners, OPEX and CAPEX';

/** A role of the tenant with these rows, each written as the tenant given (its own by default). */
async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  rights: Record<string, string>,
  rowTenant: Record<string, string> = {},
  role: { description?: string; builtIn?: boolean } = {},
): Promise<string> {
  await asTenant(runner, tenantId);
  const [created] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_built_in) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
    [tenantId, name, role.description ?? 'seeded', role.builtIn ?? false],
  );
  const roleRow = created;
  for (const [resource, level] of Object.entries(rights)) {
    const owner = rowTenant[resource] ?? tenantId;
    await asTenant(runner, owner);
    await runner.query(
      `INSERT INTO role_permissions (role_id, resource, level, tenant_id) VALUES ($1, $2, $3, $4)`,
      [roleRow.id, resource, level, owner],
    );
  }
  return roleRow.id;
}

/** The description of a role, read as its tenant. */
async function descriptionOf(runner: QueryRunner, tenantId: string, roleId: string): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(`SELECT role_description FROM roles WHERE id = $1`, [roleId]);
  return row.role_description;
}

/** Every right of the roles, as each seeded tenant sees it (`role → resource → level`). */
async function rightsOf(runner: QueryRunner, roleIds: string[]): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const id of roleIds) out[id] = {};
  // The rows of the test's tenants, one tenant at a time (FORCE row level security).
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

let seededTenants: string[] = [];

interface Seeded {
  a: { id: string; slug: string };
  b: { id: string; slug: string };
  c: { id: string; slug: string };
  roles: Record<string, string>;
}

async function seedBeforeMigration(runner: QueryRunner): Promise<Seeded> {
  const a = await seedTenant(runner, 'a');
  const b = await seedTenant(runner, 'b');
  const c = await seedTenant(runner, 'c');
  seededTenants = [a.id, b.id, c.id];
  const roles: Record<string, string> = {
    asymmetric: await seedRole(runner, a.id, 'Asymmetric', { opex: 'admin', capex: 'reader' }),
    opexOnly: await seedRole(runner, a.id, 'OPEX only', { opex: 'member', tasks: 'reader' }),
    capexOnly: await seedRole(runner, a.id, 'CAPEX only', { capex: 'reader' }),
    manager: await seedRole(runner, a.id, 'Legacy manager', { opex: 'manager', capex: 'reader' }),
    managerOnly: await seedRole(runner, a.id, 'Manager only', { opex: 'manager', capex: 'manager' }),
    higherBudget: await seedRole(runner, a.id, 'Budget already', { budget: 'admin', opex: 'reader', capex: 'reader' }),
    budgetOnly: await seedRole(runner, a.id, 'Budget alone', { budget: 'admin' }),
    symmetric: await seedRole(runner, a.id, 'Symmetric', { opex: 'member', capex: 'member', contracts: 'reader' }),
    stray: await seedRole(runner, a.id, 'Stray row', { opex: 'admin' }, { opex: b.id }),
    budgetAdminA: await seedRole(runner, a.id, 'Budget Administrator', { opex: 'admin', capex: 'admin' }, {}, { description: BUDGET_ADMIN_BEFORE, builtIn: true }),
    otherTenant: await seedRole(runner, b.id, 'Other tenant', { opex: 'reader', capex: 'admin' }),
    budgetAdminB: await seedRole(runner, b.id, 'Budget Administrator', { opex: 'admin', capex: 'admin' }, {}, { description: HAND_WRITTEN, builtIn: true }),
    merged: await seedRole(runner, c.id, 'Merged already', { budget: 'member' }),
  };
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return { a, b, c, roles };
}

const EXPECTED_AFTER_UP = (roles: Record<string, string>) => ({
  [roles.asymmetric]: { budget: 'admin' },
  [roles.opexOnly]: { budget: 'member', tasks: 'reader' },
  [roles.capexOnly]: { budget: 'reader' },
  [roles.manager]: { budget: 'reader' },
  [roles.managerOnly]: {},
  [roles.higherBudget]: { budget: 'reader' },
  [roles.budgetOnly]: {},
  [roles.symmetric]: { budget: 'member', contracts: 'reader' },
  [roles.stray]: {},
  [roles.budgetAdminA]: { budget: 'admin' },
  [roles.otherTenant]: { budget: 'admin' },
  [roles.budgetAdminB]: { budget: 'admin' },
  [roles.merged]: { budget: 'member' },
});

function linesOf(lines: string[], text: string): string[] {
  return lines.filter((line) => line.includes(text));
}

async function testMerge() {
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

    // The built-in Budget Administrator: the description seeded before lot R is updated, one changed by hand is kept.
    assert.equal(await descriptionOf(runner, a.id, roles.budgetAdminA), BUDGET_ADMIN_AFTER);
    assert.equal(await descriptionOf(runner, b.id, roles.budgetAdminB), HAND_WRITTEN);

    // The log: roles merged per tenant, each role listed with its rows before and its level after, a summary.
    assert.equal(linesOf(lines, `tenant ${a.slug} (${a.id}): 10 role(s) merged into budget`).length, 1, lines.join('\n'));
    assert.equal(linesOf(lines, `tenant ${b.slug} (${b.id}): 2 role(s) merged into budget`).length, 1, lines.join('\n'));
    assert.equal(linesOf(lines, c.slug).length, 0, 'a tenant merged already is not touched');
    const named = (name: string, tenant = a) => linesOf(lines, `tenant ${tenant.slug} (${tenant.id}): role "${name}" (`);
    const ends = (name: string, text: string, tenant = a) => {
      const found = named(name, tenant);
      assert.equal(found.length, 1, `${name}: one line\n${lines.join('\n')}`);
      assert.ok(found[0].endsWith(`: ${text}`), `${name}: ${found[0]}`);
    };
    ends('Asymmetric', 'opex=admin, capex=reader -> budget=admin');
    ends('OPEX only', 'opex=member, capex=none -> budget=member');
    ends('CAPEX only', 'opex=none, capex=reader -> budget=reader');
    ends('Legacy manager', 'opex=manager (no access), capex=reader -> budget=reader');
    ends('Manager only', 'opex=manager (no access), capex=manager (no access) -> no budget right');
    ends('Budget already', 'opex=reader, capex=reader, budget=admin (no effect before lot R) -> budget=reader');
    ends('Budget alone', 'opex=none, capex=none, budget=admin (no effect before lot R) -> no budget right');
    ends('Stray row', `opex=admin (row of tenant ${b.slug} (${b.id}), never read), capex=none -> no budget right`);
    ends('Other tenant', 'opex=reader, capex=admin -> budget=admin', b);
    assert.equal(named('Symmetric').length, 0, 'a role with the same level on both is not listed');
    assert.equal(named('Budget Administrator').length + named('Budget Administrator', b).length, 0, 'admin on both: not listed');
    assert.ok(lines.every((line) => line.startsWith(LOG_PREFIX)), 'every line is prefixed');
    assert.ok(
      lines.some((line) => /done in \d+ ms: \d+ role\(s\) of \d+ tenant\(s\) merged, \d+ with a budget right, \d+ without; \d+ listed above; \d+ opex\/capex row\(s\) removed; \d+ built-in Budget Administrator description\(s\) updated$/.test(line)),
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
    assert.equal(linesOf(second.lines, a.slug).length + linesOf(second.lines, b.slug).length, 0, 'nothing of the test tenants is merged again');
    assert.ok(second.lines.some((line) => line.includes('no opex or capex right left; nothing to merge')), second.lines.join('\n'));
  });
}

async function testDownThenUp() {
  await inRolledBackTransaction(async (runner) => {
    const { a, b, roles } = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const { lines } = await captureLog(() => migration.down(runner));
    assert.deepEqual(await rightsOf(runner, Object.values(roles)), {
      // The merged level on both: the levels that differed before up() and the rows it deleted are not restorable.
      [roles.asymmetric]: { opex: 'admin', capex: 'admin' },
      [roles.opexOnly]: { opex: 'member', capex: 'member', tasks: 'reader' },
      [roles.capexOnly]: { opex: 'reader', capex: 'reader' },
      [roles.manager]: { opex: 'reader', capex: 'reader' },
      [roles.managerOnly]: {},
      [roles.higherBudget]: { opex: 'reader', capex: 'reader' },
      [roles.budgetOnly]: {},
      [roles.symmetric]: { opex: 'member', capex: 'member', contracts: 'reader' },
      [roles.stray]: {},
      [roles.budgetAdminA]: { opex: 'admin', capex: 'admin' },
      [roles.otherTenant]: { opex: 'admin', capex: 'admin' },
      [roles.budgetAdminB]: { opex: 'admin', capex: 'admin' },
      [roles.merged]: { opex: 'member', capex: 'member' },
    });
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM role_permissions WHERE resource = 'budget'`);
    assert.equal(n, 0, 'no budget row is left (for the tenant set, none at all)');
    assert.equal(await descriptionOf(runner, a.id, roles.budgetAdminA), BUDGET_ADMIN_BEFORE, 'the description of before is back');
    assert.equal(await descriptionOf(runner, b.id, roles.budgetAdminB), HAND_WRITTEN, 'a description changed by hand is kept');
    assert.ok(lines.some((line) => /reverted in \d+ ms: .*not restorable/.test(line)), lines.join('\n'));

    await captureLog(() => migration.up(runner));
    assert.deepEqual(await rightsOf(runner, Object.values(roles)), EXPECTED_AFTER_UP(roles));
    assert.equal(await descriptionOf(runner, a.id, roles.budgetAdminA), BUDGET_ADMIN_AFTER);
  });
}

async function testRefusedWhenTheMergeDoesNotHold() {
  await inRolledBackTransaction(async (runner) => {
    const { roles } = await seedBeforeMigration(runner);
    const security = await rowSecurity(runner, 'role_permissions');
    // A trigger that lowers the merged level of one role: the check after the merge refuses it.
    await runner.query(`
      CREATE FUNCTION budget_right_spec_lower() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.resource = 'budget' AND NEW.role_id = '${roles.asymmetric}'::uuid THEN NEW.level := 'reader'; END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`
      CREATE TRIGGER budget_right_spec_lower BEFORE INSERT OR UPDATE ON role_permissions
      FOR EACH ROW EXECUTE FUNCTION budget_right_spec_lower()`);
    await runner.query('SAVEPOINT before_up');
    await assert.rejects(
      () => captureLog(() => migration.up(runner)),
      (error: Error) => {
        assert.match(error.message, new RegExp(`${roles.asymmetric} budget=reader \\(expected admin\\); nothing was changed`));
        return true;
      },
    );
    assert.deepEqual(await rowSecurity(runner, 'role_permissions'), security, 'row level security as found after the refusal');
    // The migration runs in the transaction of the pending migrations: its rollback leaves the rows as they were.
    await runner.query('ROLLBACK TO SAVEPOINT before_up');
    const rights = await rightsOf(runner, [roles.asymmetric]);
    assert.deepEqual(rights[roles.asymmetric], { opex: 'admin', capex: 'reader' });
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testMerge, testRerun, testDownThenUp, testRefusedWhenTheMergeDoesNotHold]) {
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
    throw new Error(`budget-right-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('budget-right-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
