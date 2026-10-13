// @database-spec: uses the PostgreSQL transaction harness.
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { CapexNotesToDescription1854010000000 } from '../../migrations/1854010000000-capex-notes-to-description';
import { inRolledBackTransaction, runSpecs, seedTenant, setTenant } from './round-inputs.fixtures';

const migration = new CapexNotesToDescription1854010000000();
const silence = async (fn: () => Promise<void>) => {
  const log = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); return lines; } finally { console.log = log; }
};

async function states(runner: QueryRunner) {
  return {
    rls: await runner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'spend_items'::regclass`),
    triggers: await runner.query(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'spend_items'::regclass AND NOT tgisinternal ORDER BY tgname`),
  };
}

async function seed(runner: QueryRunner) {
  const tenants = [await seedTenant(runner, 'description-a'), await seedTenant(runner, 'description-b')];
  const rows: Array<{ tenantId: string; id: string; nature: string; description: string | null; notes: string | null; moved: boolean }> = [];
  for (const tenantId of tenants) {
    await setTenant(runner, tenantId);
    for (const [index, [nature, description, notes, moved]] of [
      ['capex', null, 'Server refresh\n', true],
      ['capex', '  ', 'Second description', true],
      ['capex', 'Existing description', 'Existing notes', false],
      ['capex', null, null, false],
      ['capex', '', '  ', false],
      ['opex', null, 'OPEX notes', false],
    ].entries()) {
      const [row] = await runner.query(
        `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, description, notes, currency, effective_start)
         VALUES ($1, $2, $3, 'Migration title', $4, $5, 'EUR', '2026-01-01') RETURNING id`,
        [tenantId, nature, 9800 + index, description, notes],
      );
      rows.push({ tenantId, id: row.id, nature: nature as string, description: description as string | null, notes: notes as string | null, moved: moved as boolean });
    }
  }
  return rows;
}

async function read(runner: QueryRunner, rows: Awaited<ReturnType<typeof seed>>) {
  const result = [];
  for (const row of rows) {
    await setTenant(runner, row.tenantId);
    const [line] = await runner.query(
      `SELECT i.description, i.notes, i.row_version, i.updated_at, x.search_vector::text AS vector
         FROM spend_items i LEFT JOIN search_index x ON x.tenant_id = i.tenant_id AND x.entity_id = i.id
          AND x.entity_type = CASE WHEN i.nature = 'capex' THEN 'capex_items' ELSE 'spend_items' END
        WHERE i.tenant_id = $1 AND i.id = $2 AND i.nature = $3`, [row.tenantId, row.id, row.nature],
    );
    assert.ok(line.vector, 'the seeded line has a real search vector');
    result.push(line);
  }
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return result;
}

runSpecs('capex-notes-to-description-migration.integration.spec', [
  ['dirty database, two tenants, rerun, down, freshness and search vectors', async () => {
    await inRolledBackTransaction(async (runner) => {
      const rows = await seed(runner);
      const before = await read(runner, rows);
      const state = await states(runner);
      const logs = await silence(() => migration.up(runner));
      assert.equal(logs.filter((line) => line.includes(': 2 line(s) moved')).length, 2);
      const after = await read(runner, rows);
      rows.forEach((row, index) => {
        assert.deepEqual(after[index], { ...before[index], ...(row.moved ? { description: row.notes, notes: null } : {}) });
      });
      assert.deepEqual(await states(runner), state);
      const rerun = await silence(() => migration.up(runner));
      assert.ok(rerun.at(-1)?.endsWith('total 0 line(s)'));
      assert.deepEqual(await read(runner, rows), after);
      await silence(() => migration.down(runner));
      const down = await read(runner, rows);
      rows.forEach((row, index) => {
        if (row.moved) assert.deepEqual(down[index], { ...before[index], description: null });
        if (row.description === 'Existing description' || row.nature === 'opex') assert.deepEqual(down[index], before[index]);
        assert.equal(down[index].row_version, before[index].row_version);
        assert.equal(down[index].vector, before[index].vector);
      });
      assert.deepEqual(await states(runner), state);
    });
  }],
  ['nondefault RLS and disabled/always/replica trigger states restored', async () => {
    await inRolledBackTransaction(async (runner) => {
      await seed(runner);
      await runner.query(`ALTER TABLE spend_items NO FORCE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE spend_items DISABLE TRIGGER spend_items_row_version`);
      await runner.query(`ALTER TABLE spend_items ENABLE ALWAYS TRIGGER trg_search_index_spend_items`);
      await runner.query(`CREATE FUNCTION u2_replica_probe() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`);
      await runner.query(`CREATE TRIGGER u2_replica_probe BEFORE UPDATE ON spend_items FOR EACH ROW EXECUTE FUNCTION u2_replica_probe()`);
      await runner.query(`ALTER TABLE spend_items ENABLE REPLICA TRIGGER u2_replica_probe`);
      const state = await states(runner);
      await silence(() => migration.up(runner));
      assert.deepEqual(await states(runner), state);
    });
  }],
  ['a SQL error restores RLS and triggers before returning to the caller', async () => {
    await inRolledBackTransaction(async (runner) => {
      const state = await states(runner);
      const query = runner.query.bind(runner);
      runner.query = (async (sql: string, ...args: any[]) => {
        if (sql.includes('WITH moved AS')) return query('SELECT missing_u2_column FROM spend_items');
        return (query as any)(sql, ...args);
      }) as typeof runner.query;
      try { await assert.rejects(() => migration.up(runner), (error: any) => error.code === '42703'); }
      finally { runner.query = query; }
      assert.deepEqual(await states(runner), state);
    });
  }],
]).catch((error) => { console.error(error); process.exit(1); });
