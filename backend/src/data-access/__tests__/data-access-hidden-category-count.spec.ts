// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { DataAccessHiddenCategoryCount1855800000000 } from '../../migrations/1855800000000-data-access-hidden-category-count';
import { applyDataAccess } from '../data-access';
import { LIMITED_ROLE, PgClient, roleExists, seedPerson, seedRole } from './data-access-test-helpers';
import { nextItemNumber, seed, type Seed } from './data-access-line-seed';

/**
 * Data-scoped access (spec §6.6): `data_access_hidden_category_count(axis, values, active_from)`, the
 * hidden lines of each value of one dimension for the analytics report. On the reference example of
 * lot 2 (`data-access-line-seed.ts`): seven OPEX lines, all on the first dimension's value; Rita reads
 * L1 to L4 and hides L5 to L7; Ulla reads everything.
 *
 * The cases: 0 per requested value outside limited mode, no answer when the limited role is taken
 * without `data_access_apply()`, the exact hidden count for a limited person, the lifecycle window
 * (a line ending before `p_active_from` is left out, one without an end stays), the dimension's own
 * nature (a CAPEX-only dimension never counts an OPEX line), another tenant's value never answered,
 * SECURITY DEFINER and grants, and the migration's replay and down/up.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const YEAR = 2026;

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

async function as(runner: QueryRunner, person: string, fn: () => Promise<void>): Promise<void> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    await fn();
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

type Extra = {
  /** A CAPEX-only dimension on L6 and L7 (both made CAPEX). */
  capexAxis: string;
  capexValue: string;
};

/** A CAPEX-only dimension held by two CAPEX lines, to check the function's nature guard. */
async function seedScenario(runner: QueryRunner, s: Seed): Promise<Extra> {
  const q = async (sql: string, params?: unknown[]): Promise<any[]> => runner.query(sql, params as any[]);
  const axisId = (await q(
    `INSERT INTO analytics_axes (tenant_id, code, name, applies_to) VALUES ($1, 'capex-only', 'capex-only', 'capex') RETURNING id`,
    [s.tenantId],
  ))[0].id as string;
  const valueId = (await q(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'capex value') RETURNING id`,
    [s.tenantId, axisId],
  ))[0].id as string;
  await q(`UPDATE spend_items SET nature = 'capex' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [s.tenantId, [s.lines.L6, s.lines.L7]]);
  await q(
    `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4), ($1, $5, $3, $4)`,
    [s.tenantId, s.lines.L6, axisId, valueId, s.lines.L7],
  );
  return { capexAxis: axisId, capexValue: valueId };
}

async function hidden(runner: QueryRunner, axisId: string, values: string[], activeFrom: string | null): Promise<Array<{ category_id: string | null; n: number | null }>> {
  return runner.query(
    `SELECT category_id, n FROM data_access_hidden_category_count($1::uuid, $2::uuid[], $3::date)`,
    [axisId, values, activeFrom],
  );
}

async function testWindow(runner: QueryRunner, s: Seed, extra: Extra): Promise<void> {
  // Outside limited mode: one row per requested value, 0, whatever the window.
  await as(runner, s.persons.ulla, async () => {
    assert.deepEqual(await hidden(runner, s.axis1, [s.category1], null), [{ category_id: s.category1, n: 0 }]);
    assert.deepEqual(await hidden(runner, s.axis1, [s.category1], `${YEAR}-01-01`), [{ category_id: s.category1, n: 0 }]);
    assert.deepEqual(await hidden(runner, s.axis1, [s.category2], null), [], 'a value of another dimension answers no row');
  });

  // The limited role taken without data_access_apply(): the all-NULL answer of a set function.
  await runner.query('SAVEPOINT without_apply');
  try {
    await runner.query(`SET LOCAL ROLE ${LIMITED_ROLE}`);
    const none = await hidden(runner, s.axis1, [s.category1], `${YEAR}-01-01`);
    assert.equal(none.length, 1);
    assert.equal(none[0].category_id, null);
    assert.equal(none[0].n, null);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT without_apply');
  }

  // Rita hides L5, L6 and L7. A line ending before the window is left out; none counts them all.
  await runner.query(`UPDATE spend_items SET disabled_at = '2025-06-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L5]);
  await runner.query(`UPDATE spend_items SET disabled_at = '2027-03-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L6]);
  await runner.query(`UPDATE spend_items SET disabled_at = '2026-09-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L7]);
  await as(runner, s.persons.rita, async () => {
    assert.deepEqual(await hidden(runner, s.axis1, [s.category1], null), [{ category_id: s.category1, n: 3 }], 'no window: every hidden line');
    assert.deepEqual(await hidden(runner, s.axis1, [s.category1], `${YEAR}-01-01`), [{ category_id: s.category1, n: 2 }], 'the line ended in 2025 is out');
    assert.deepEqual(await hidden(runner, s.axis1, [s.category1], '2027-01-01'), [{ category_id: s.category1, n: 1 }], 'the line ending in March 2027 stays');
    assert.deepEqual(await hidden(runner, s.axis1, [s.category1], '2027-04-01'), [], 'no hidden line in that window: no row');
    assert.deepEqual(await hidden(runner, s.axis1, [s.category2], `${YEAR}-01-01`), [], 'a value of another dimension is never counted');
  });

  // The CAPEX-only dimension counts only the two CAPEX lines of its nature; Rita reads neither.
  await as(runner, s.persons.rita, async () => {
    assert.deepEqual(await hidden(runner, extra.capexAxis, [extra.capexValue], null), [{ category_id: extra.capexValue, n: 2 }]);
  });
  await as(runner, s.persons.ulla, async () => {
    assert.deepEqual(await hidden(runner, extra.capexAxis, [extra.capexValue], null), [{ category_id: extra.capexValue, n: 0 }]);
  });

  // Another tenant's value is never answered from this tenant, and its own hidden line counts there.
  await as(runner, s.persons.ulla, async () => {
    const q = async (sql: string, params?: unknown[]): Promise<any[]> => runner.query(sql, params as any[]);
    const otherTenant = (await q(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now()) RETURNING id`,
      [`da-hidden-${s.tenantId.slice(0, 8)}`, `Other ${s.tenantId.slice(0, 8)}`],
    ))[0].id as string;
    await q(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenant]);
    const otherLine = (await q(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number)
       VALUES ($1, 'Other tenant line', 'EUR', '2026-01-01', $2) RETURNING id`, [otherTenant, nextItemNumber()],
    ))[0].id as string;
    const otherAxis = (await q(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'b1', 'b1') RETURNING id`, [otherTenant]))[0].id as string;
    const otherValue = (await q(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'b1 value') RETURNING id`, [otherTenant, otherAxis]))[0].id as string;
    await q(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [otherTenant, otherLine, otherAxis, otherValue]);
    const otherRole = await seedRole(clientOf(runner), otherTenant, 'Other role');
    const otherPerson = await seedPerson(clientOf(runner), otherTenant, 'limited', otherRole);
    await applyDataAccess(runner, otherPerson);
    assert.deepEqual(await hidden(runner, otherAxis, [otherValue], null), [{ category_id: otherValue, n: 1 }], 'the other tenant counts its own hidden line');
    assert.deepEqual(await hidden(runner, s.axis1, [s.category1], null), [], 'the first tenant\'s value is not counted from another tenant');
    await q(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    await applyDataAccess(runner, s.persons.ulla);
  });

  const [fn] = await runner.query(
    `SELECT p.prosecdef AS definer, p.proconfig AS config, pg_get_functiondef(p.oid) AS definition,
            EXISTS (
              SELECT 1 FROM aclexplode(coalesce(p.proacl, '{}')) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
            ) AS public_execute
       FROM pg_proc p
      WHERE p.oid = 'public.data_access_hidden_category_count(uuid, uuid[], date)'::regprocedure`,
  );
  assert.equal(fn.definer, true, 'SECURITY DEFINER');
  assert.ok((fn.config ?? []).includes('search_path=public, pg_temp'), 'search_path = public, pg_temp');
  assert.equal(fn.public_execute, false, 'EXECUTE revoked from PUBLIC');
  assert.match(fn.definition, /SECURITY DEFINER/);
  console.log('  SQL function: 0 outside limited mode, NULL without apply, tenant, axis, nature and window scoped, SECURITY DEFINER: OK');
}

async function testMigrationReplay(runner: QueryRunner): Promise<void> {
  const definition = async () => (await runner.query(
    `SELECT pg_get_functiondef('public.data_access_hidden_category_count(uuid, uuid[], date)'::regprocedure) AS definition`,
  ))[0].definition as string;
  const before = await definition();
  const migration = new DataAccessHiddenCategoryCount1855800000000();
  await migration.up(runner);
  assert.equal(await definition(), before, 'the migration replays without changing the function');

  await runner.query('SAVEPOINT migration_down');
  try {
    await migration.down(runner);
    const [gone] = await runner.query(`SELECT to_regprocedure('public.data_access_hidden_category_count(uuid, uuid[], date)') IS NULL AS gone`);
    assert.equal(gone.gone, true, 'down drops the function');
    await migration.up(runner);
    assert.equal(await definition(), before, 'up restores the same function');
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT migration_down');
  }
  console.log('  migration: up twice and down/up leave the same function: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access hidden category count: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access hidden category count');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      const extra = await seedScenario(runner, s);
      await testWindow(runner, s, extra);
      await testMigrationReplay(runner);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
