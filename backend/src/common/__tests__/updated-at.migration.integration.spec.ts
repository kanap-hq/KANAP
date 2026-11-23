// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { RecordUpdatedAt1856270000000 as Migration } from '../../migrations/1856270000000-record-updated-at';
import { UPDATED_AT_TABLES } from '../updated-at.inventory';
import { syncUpdatedAtTrigger } from '../updated-at-trigger';
import { assert, inRolledBackTransaction, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1856270000000 (the modification date the database keeps), against a real database,
// in transactions rolled back at the end:
// - down() then up(), twice: the triggers present are those of the inventory, each with its WHEN
//   clause, a second up() changes nothing, and down() leaves neither a trigger nor the function;
// - imperfect database: a table of the list without its `updated_at` column gets no trigger
//   (a column is never added in silence) and the others get theirs.

const migration = new Migration();

async function triggers(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ table: string; definition: string }> = await runner.query(
    `SELECT c.relname AS table, pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgname = c.relname || '_updated_at'
      ORDER BY c.relname`,
  );
  return Object.fromEntries(rows.map((row) => [row.table, row.definition]));
}

async function hasFunction(runner: QueryRunner) {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'stamp_updated_at'`);
  return row.n === 1;
}

/** The tables placed, each with the trigger's form: before update, its WHEN clause, the shared function. */
function assertPlaced(definitions: Record<string, string>, tables: string[], label: string) {
  assert.deepEqual(Object.keys(definitions), [...tables].sort(), `${label}: the tables of the inventory`);
  for (const [table, definition] of Object.entries(definitions)) {
    assert.ok(
      definition.startsWith(`CREATE TRIGGER ${table}_updated_at BEFORE UPDATE ON public.${table} FOR EACH ROW WHEN (`)
        && definition.endsWith(') EXECUTE FUNCTION stamp_updated_at()'),
      `${label}: ${definition}`,
    );
  }
}

async function testDownThenUpTwice() {
  await inRolledBackTransaction(async (runner) => {
    for (const round of [1, 2]) {
      await migration.down(runner);
      assert.deepEqual(await triggers(runner), {}, `round ${round}: down() leaves no trigger`);
      assert.equal(await hasFunction(runner), false, `round ${round}: down() drops the function`);
      await migration.down(runner);
      assert.deepEqual(await triggers(runner), {}, `round ${round}: a second down() changes nothing`);
      await migration.up(runner);
      const placed = await triggers(runner);
      assertPlaced(placed, Object.keys(UPDATED_AT_TABLES), `round ${round}: up()`);
      await migration.up(runner);
      assert.deepEqual(await triggers(runner), placed, `round ${round}: a second up() changes nothing`);
    }
  });
}

async function testMissingColumnIsNamedNotAdded() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    await runner.query(`ALTER TABLE roles DROP COLUMN updated_at`);
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
    try {
      await migration.up(runner);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(warnings, ['[migration 1856270000000 record-updated-at] roles: no updated_at column, no trigger placed']);
    const [column] = await runner.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'roles' AND column_name = 'updated_at'`,
    );
    assert.equal(column.n, 0, 'the column is not added');
    assertPlaced(await triggers(runner), Object.keys(UPDATED_AT_TABLES).filter((table) => table !== 'roles'), 'the other tables get their trigger');
  });
}

/** A column with no equality (`json`) added to a table of the list, the trigger synced: its updates still run and date the row. */
async function testColumnWithoutEquality() {
  await inRolledBackTransaction(async (runner) => {
    const [{ id: tenantId }] = await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES (gen_random_uuid(), 'updated-at-json-' || substr(md5(random()::text), 1, 8), 'Updated at json', 'active', '{}'::jsonb, '{}'::jsonb, now(), now()) RETURNING id`,
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await runner.query(`ALTER TABLE roles ADD COLUMN probe json`);
    const [role] = await runner.query(
      `INSERT INTO roles (tenant_id, role_name, probe, updated_at) VALUES ($1, 'Json role', '{"a":1}', '2020-01-02T03:04:05Z') RETURNING id`,
      [tenantId],
    );
    // The trigger compares the columns it found when it was placed: the new column is not one of them.
    await runner.query(`UPDATE roles SET probe = '{"a":0}' WHERE id = $1`, [role.id]);
    const [unseen] = await runner.query(`SELECT updated_at FROM roles WHERE id = $1`, [role.id]);
    assert.equal(unseen.updated_at.toISOString(), '2020-01-02T03:04:05.000Z', 'a column added after the trigger does not date the row');
    assert.equal(await syncUpdatedAtTrigger(runner, 'roles'), 'placed');
    await runner.query(`UPDATE roles SET probe = '{"a":1}' WHERE id = $1`, [role.id]);
    await runner.query(`UPDATE roles SET updated_at = '2020-01-02T03:04:05Z' WHERE id = $1`, [role.id]);
    await runner.query(`UPDATE roles SET probe = '{"a":1}' WHERE id = $1`, [role.id]);
    const [same] = await runner.query(`SELECT updated_at FROM roles WHERE id = $1`, [role.id]);
    assert.equal(same.updated_at.toISOString(), '2020-01-02T03:04:05.000Z', 'the same json keeps the date');
    await runner.query(`UPDATE roles SET probe = '{"a":2}' WHERE id = $1`, [role.id]);
    const [changed] = await runner.query(`SELECT updated_at = now() AS now FROM roles WHERE id = $1`, [role.id]);
    assert.equal(changed.now, true, 'another json dates the row');
  });
}

void runSpecs('updated-at.migration.integration.spec', [
  ['down then up, twice', testDownThenUpTwice],
  ['a column without equality', testColumnWithoutEquality],
  ['a missing column is named, not added', testMissingColumnIsNamedNotAdded],
]);
