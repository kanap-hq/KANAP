import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AllocationsUniqueKey1853730000000 as Migration } from '../../migrations/1853730000000-allocations-unique-key';
import { seedCompany } from './cost-center.fixtures';
import { Kind, seedItem, seedVersion } from './round-inputs.fixtures';

// Migration 1853730000000 (one allocation row per version, company and
// department), against a real database, each test in a transaction that is
// rolled back:
// - a database holding duplicates: rows of an earlier save of a key (the
//   union two concurrent saves used to leave) are deleted, rows of the same
//   save (a company picked on two lines of a manual split) are merged with
//   their percentages added, department NULL counting as one value; up() logs
//   what it deleted, creates the unique index, and leaves row level security
//   as it found it;
// - a clean database, and a second run: nothing deleted, nothing logged, the
//   index kept;
// - the index refuses a second row for the same key, NULL department included.

const migration = new Migration();
const LOG_PREFIX = '[Migration] AllocationsUniqueKey:';
const TABLES: Record<Kind, { table: string; index: string }> = {
  opex: { table: 'spend_allocations', index: 'uq_spend_allocations_version_company_department' },
  capex: { table: 'capex_allocations', index: 'uq_capex_allocations_version_company_department' },
};

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

type Seeded = { tenantId: string; versions: Record<Kind, string>; c1: string; c2: string; dept: string };

async function seed(runner: QueryRunner): Promise<Seeded> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Allocations key', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `alloc-key-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const c1 = (await seedCompany(runner, tenantId, 'Key company 1', 6001)).companyId;
  const c2 = (await seedCompany(runner, tenantId, 'Key company 2', 6002)).companyId;
  const [dept] = await runner.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Key department') RETURNING id`, [tenantId, c1]);
  const versions = {} as Record<Kind, string>;
  for (const kind of ['opex', 'capex'] as Kind[]) {
    const itemId = await seedItem(runner, kind, tenantId, 1);
    versions[kind] = await seedVersion(runner, kind, tenantId, itemId, 2026);
  }
  return { tenantId, versions, c1, c2, dept: dept.id };
}

async function insertRow(runner: QueryRunner, kind: Kind, s: Seeded, companyId: string, departmentId: string | null, pct: number, createdAt: string) {
  const [row] = await runner.query(
    `INSERT INTO ${TABLES[kind].table} (tenant_id, version_id, company_id, department_id, allocation_pct, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [s.tenantId, s.versions[kind], companyId, departmentId, pct, createdAt],
  );
  return row.id as string;
}

async function rowsOf(runner: QueryRunner, kind: Kind, s: Seeded) {
  return runner.query(
    `SELECT id, company_id, department_id, allocation_pct::float AS pct FROM ${TABLES[kind].table} WHERE version_id = $1 ORDER BY id`,
    [s.versions[kind]],
  );
}

async function indexDef(runner: QueryRunner, kind: Kind): Promise<string | undefined> {
  const [row] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [TABLES[kind].index]);
  return row?.indexdef;
}

async function rowSecurity(runner: QueryRunner, kind: Kind) {
  const [row] = await runner.query(`SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`, [TABLES[kind].table]);
  return row;
}

/** Duplicates of a database written before the fix: deduplicated, then indexed. */
async function testDuplicatesThenIndex() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    const s = await seed(runner);
    const expected: Record<Kind, Array<{ id: string; pct: number }>> = { opex: [], capex: [] };
    for (const kind of ['opex', 'capex'] as Kind[]) {
      // Company 1 without department: two earlier saves, then a save that picked it on two lines (25 + 15).
      await insertRow(runner, kind, s, s.c1, null, 60, '2026-01-01T10:00:00Z');
      await insertRow(runner, kind, s, s.c1, null, 50, '2026-01-01T10:00:01Z');
      const lineA = await insertRow(runner, kind, s, s.c1, null, 25, '2026-01-01T10:00:02Z');
      const lineB = await insertRow(runner, kind, s, s.c1, null, 15, '2026-01-01T10:00:02Z');
      expected[kind].push({ id: lineA < lineB ? lineA : lineB, pct: 40 });
      // Company 1 + department: an earlier save, then the latest.
      expected[kind].push({ id: await insertRow(runner, kind, s, s.c1, s.dept, 30, '2026-01-01T10:00:05Z'), pct: 30 });
      await insertRow(runner, kind, s, s.c1, s.dept, 20, '2026-01-01T10:00:04Z');
      // Company 2: one row.
      expected[kind].push({ id: await insertRow(runner, kind, s, s.c2, null, 10, '2026-01-01T10:00:00Z'), pct: 10 });
    }

    const { lines } = await captureLog(() => migration.up(runner));
    for (const kind of ['opex', 'capex'] as Kind[]) {
      const rows = await rowsOf(runner, kind, s);
      const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
      assert.deepEqual(
        rows.map((r: any) => ({ id: r.id, pct: Number(r.pct) })).sort(byId),
        [...expected[kind]].sort(byId),
        `${kind}: the latest save of each key is kept, its lines merged`,
      );
      const def = await indexDef(runner, kind);
      assert.match(String(def), /CREATE UNIQUE INDEX .* \(version_id, company_id, (department_id\) NULLS NOT DISTINCT|COALESCE\(department_id)/, `${kind}: the unique index`);
      assert.deepEqual(await rowSecurity(runner, kind), { enabled: true, forced: true }, `${kind}: row level security as found`);
      const summary = lines.find((l) => l.startsWith(`${LOG_PREFIX} ${TABLES[kind].table}:`));
      assert.ok(
        summary?.includes('4 duplicate row(s) deleted on 1 version(s): 3 of an earlier save') && summary.includes('1 merged'),
        `${kind}: the counts are logged (${summary})`,
      );
    }
    assert.equal(lines.filter((l) => l.includes('  deleted ') && l.includes('(older save;')).length, 6, 'each row of an earlier save is named');
    assert.equal(lines.filter((l) => l.includes('  deleted ') && l.includes('(merged;')).length, 2, 'each merged row is named');

    // The index refuses a second row of a key, NULL department included.
    for (const kind of ['opex', 'capex'] as Kind[]) {
      for (const department of [null, s.dept]) {
        await runner.query('SAVEPOINT dup');
        await assert.rejects(
          insertRow(runner, kind, s, s.c1, department, 1, '2026-02-01T00:00:00Z'),
          (err: any) => err?.code === '23505' && err?.constraint === TABLES[kind].index,
          `${kind}: a second row for company 1 / ${department ? 'department' : 'no department'} is refused`,
        );
        await runner.query('ROLLBACK TO SAVEPOINT dup');
      }
    }
  });
}

/** A clean database, and a second run: nothing deleted, nothing logged, the index kept. */
async function testCleanAndRerun() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    const s = await seed(runner);
    for (const kind of ['opex', 'capex'] as Kind[]) {
      await insertRow(runner, kind, s, s.c1, null, 50, '2026-01-01T10:00:00Z');
      await insertRow(runner, kind, s, s.c1, s.dept, 25, '2026-01-01T10:00:00Z');
      await insertRow(runner, kind, s, s.c2, null, 25, '2026-01-01T10:00:00Z');
    }
    const first = await captureLog(() => migration.up(runner));
    assert.deepEqual(first.lines.filter((l) => l.startsWith(LOG_PREFIX)), [], 'a clean database logs nothing');
    const defs = { opex: await indexDef(runner, 'opex'), capex: await indexDef(runner, 'capex') };
    const second = await captureLog(() => migration.up(runner));
    assert.deepEqual(second.lines, [], 'a second run logs nothing');
    for (const kind of ['opex', 'capex'] as Kind[]) {
      assert.equal((await rowsOf(runner, kind, s)).length, 3, `${kind}: no row deleted`);
      assert.equal(await indexDef(runner, kind), defs[kind], `${kind}: the index is kept as it was`);
    }
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testDuplicatesThenIndex, testCleanAndRerun]) {
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
    throw new Error(`allocations-unique-key-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('allocations-unique-key-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
