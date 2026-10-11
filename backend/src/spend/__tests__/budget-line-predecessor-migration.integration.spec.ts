import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetLinePredecessor1854000000000 as Migration } from '../../migrations/1854000000000-budget-line-predecessor';

// Migration 1854000000000 (the line a budget line continues, lot M of plan
// planning/budget-unifie.md), against a real database, each test in a transaction that is rolled
// back. The column is dropped (down), then added again by hand without its key and index, as a
// database someone touched could hold it, so the repair has something to do. Tenant A: a line
// continued by two lines (the earlier one keeps it, the later one is cleared), a line naming
// itself, a line naming a line of tenant B, a line naming no line (all three cleared); tenant B:
// one line. Then: row_version, updated_at and the search entries untouched, row level security
// and the line triggers as found, the key refuses a line of another tenant and a second
// successor, a delete clears the reference only, a second run changes nothing, down() drops the
// column and up() adds it again. The assertions read this test's own rows: the column dropped
// first, only they hold a reference when up() repairs.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const LOG_PREFIX = '[Migration] BudgetLinePredecessor:';
const TRIGGERS = ['spend_items_row_version', 'trg_search_index_spend_items'];

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

async function noTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `predecessor-${tag}-${tenantId.slice(0, 8)}`, `Budget line predecessor ${tag}`],
  );
  return tenantId;
}

type Line = { tenantId: string; id: string };

async function seedLine(runner: QueryRunner, tenantId: string, itemNumber: number, created: string, predecessor: string | null = null): Promise<Line> {
  await asTenant(runner, tenantId);
  const id = randomUUID();
  await runner.query(
    `INSERT INTO spend_items (id, tenant_id, product_name, currency, effective_start, item_number, created_at, updated_at, predecessor_id)
     VALUES ($1, $2, $3, 'EUR', '2026-01-01', $4, $5, $5, $6)`,
    [id, tenantId, `Predecessor line ${itemNumber}`, itemNumber, created, predecessor === 'self' ? id : predecessor],
  );
  return { tenantId, id };
}

async function readLine(runner: QueryRunner, line: Line) {
  await asTenant(runner, line.tenantId);
  const [row] = await runner.query(
    `SELECT s.predecessor_id, s.row_version, s.updated_at,
            (SELECT x.indexed_at FROM search_index x WHERE x.tenant_id = s.tenant_id AND x.entity_id = s.id) AS indexed_at
       FROM spend_items s WHERE s.id = $1`,
    [line.id],
  );
  await noTenant(runner);
  return row as { predecessor_id: string | null; row_version: number; updated_at: Date; indexed_at: Date | null };
}

async function states(runner: QueryRunner) {
  const [security] = await runner.query(`SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'spend_items'::regclass`);
  const triggers: Array<{ tgname: string; tgenabled: string }> = await runner.query(
    `SELECT tgname, tgenabled::text AS tgenabled FROM pg_trigger WHERE tgrelid = 'spend_items'::regclass AND tgname = ANY($1) ORDER BY tgname`,
    [TRIGGERS],
  );
  return { security, triggers };
}

async function schema(runner: QueryRunner) {
  const [row] = await runner.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'spend_items' AND column_name = 'predecessor_id') AS column,
            (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'spend_items'::regclass AND c.conname = 'spend_items_predecessor_fk') AS fk,
            (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE ic.relname = 'uq_spend_items_tenant_predecessor') AS index`,
  );
  return row as { column: boolean; fk: string | null; index: string | null };
}

async function expectDbError(runner: QueryRunner, fn: () => Promise<unknown>, code: string) {
  await runner.query('SAVEPOINT expected_error');
  await assert.rejects(fn, (err: any) => err?.code === code, `error ${code}`);
  await runner.query('ROLLBACK TO SAVEPOINT expected_error');
}

async function testRepairAndRerun() {
  await inRolledBackTransaction(async (runner) => {
    const found = await states(runner);
    const migrated = await schema(runner);
    assert.equal(migrated.fk, 'FOREIGN KEY (tenant_id, predecessor_id) REFERENCES spend_items(tenant_id, id) ON DELETE SET NULL (predecessor_id)');
    assert.match(String(migrated.index), /UNIQUE INDEX uq_spend_items_tenant_predecessor ON public\.spend_items USING btree \(tenant_id, predecessor_id\) WHERE \(predecessor_id IS NOT NULL\)/);

    await captureLog(() => migration.down(runner));
    assert.deepEqual(await schema(runner), { column: false, fk: null, index: null }, 'down() drops the column, its key and index');
    // By hand: the column alone, no key, no index.
    await runner.query(`ALTER TABLE spend_items ADD COLUMN predecessor_id uuid`);
    const tenantA = await seedTenant(runner, 'a');
    const tenantB = await seedTenant(runner, 'b');
    const other = await seedLine(runner, tenantB, 920001, '2025-01-01T00:00:00Z');
    const continued = await seedLine(runner, tenantA, 920001, '2025-01-01T00:00:00Z');
    const first = await seedLine(runner, tenantA, 920002, '2025-02-01T00:00:00Z', continued.id);
    const second = await seedLine(runner, tenantA, 920003, '2025-03-01T00:00:00Z', continued.id);
    const self = await seedLine(runner, tenantA, 920004, '2025-04-01T00:00:00Z', 'self');
    const foreign = await seedLine(runner, tenantA, 920005, '2025-05-01T00:00:00Z', other.id);
    const unknown = await seedLine(runner, tenantA, 920006, '2025-06-01T00:00:00Z', randomUUID());
    const lines = { other, continued, first, second, self, foreign, unknown };
    type Read = Awaited<ReturnType<typeof readLine>>;
    const readAll = async (): Promise<Record<string, Read>> => {
      const out: Record<string, Read> = {};
      for (const [key, line] of Object.entries(lines)) out[key] = await readLine(runner, line);
      return out;
    };
    const before = await readAll();
    await noTenant(runner);

    const { lines: log } = await captureLog(() => migration.up(runner));
    assert.deepEqual(log, [
      `${LOG_PREFIX} column predecessor_id ready, 5 reference(s) found, 3 naming no line of its tenant cleared, 1 second successor(s) cleared, foreign key added: spend_items_predecessor_fk`,
    ]);
    const after = await readAll();
    assert.deepEqual(
      Object.fromEntries(Object.entries(after).map(([key, row]) => [key, row.predecessor_id])),
      { other: null, continued: null, first: continued.id, second: null, self: null, foreign: null, unknown: null },
      'the earliest successor keeps its reference; the others are cleared',
    );
    for (const key of Object.keys(lines)) {
      const { predecessor_id: _b, ...was } = before[key];
      const { predecessor_id: _a, ...is } = after[key];
      void _a; void _b;
      assert.deepEqual(is, was, `${key}: row_version, updated_at and the search entry untouched`);
    }
    assert.deepEqual(await states(runner), found, 'row level security and the line triggers as found');
    assert.deepEqual(await schema(runner), migrated, 'the same key and index as a fresh run');

    // The key and the index refuse a line of another tenant and a second successor.
    await asTenant(runner, tenantA);
    await expectDbError(runner, () => runner.query(`UPDATE spend_items SET predecessor_id = $2 WHERE id = $1`, [second.id, other.id]), '23503');
    await expectDbError(runner, () => runner.query(`UPDATE spend_items SET predecessor_id = $2 WHERE id = $1`, [second.id, continued.id]), '23505');

    // A second run changes nothing.
    await noTenant(runner);
    const rerun = await captureLog(() => migration.up(runner));
    assert.deepEqual(rerun.lines, [
      `${LOG_PREFIX} column predecessor_id ready, 1 reference(s) found, 0 naming no line of its tenant cleared, 0 second successor(s) cleared, foreign key already present`,
    ]);
    assert.equal((await readLine(runner, first)).predecessor_id, continued.id);

    // down() and up() again: the references go with the column.
    const down = await captureLog(() => migration.down(runner));
    assert.deepEqual(down.lines, [`${LOG_PREFIX} column predecessor_id dropped, 1 link(s) between lines removed`]);
    assert.deepEqual(await schema(runner), { column: false, fk: null, index: null });
    await captureLog(() => migration.up(runner));
    assert.deepEqual(await schema(runner), migrated);
    assert.equal((await readLine(runner, first)).predecessor_id, null);
  });
}

async function testDeleteClearsReference() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'delete');
    const continued = await seedLine(runner, tenantId, 920101, '2025-01-01T00:00:00Z');
    const successor = await seedLine(runner, tenantId, 920102, '2025-02-01T00:00:00Z', continued.id);
    await asTenant(runner, tenantId);
    await runner.query(`DELETE FROM spend_items WHERE id = $1`, [continued.id]);
    const row = await readLine(runner, successor);
    assert.equal(row.predecessor_id, null, 'the delete of the line continued clears the reference (row level security on)');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const [label, test] of [
      ['repair, key, index, second run, down and up', testRepairAndRerun],
      ['a delete clears the reference only', testDeleteClearsReference],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`budget-line-predecessor-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('budget-line-predecessor-migration.integration.spec: ok');
}

void main();
