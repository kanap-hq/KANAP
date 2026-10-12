import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetLineSearchRef1854020000000 } from '../../migrations/1854020000000-budget-line-search-ref';
import { BudgetLineNature1853950000000 } from '../../migrations/1853950000000-budget-line-nature';
import { CAPEX_REFRESH } from '../../migrations/1853980000000-capex-criteria-dimensions';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';
import { AiEntityService } from '../ai-entity.service';

// @database-spec: dirty indexes, two tenants, both natures and independent native/legacy numbers.
const migration = new BudgetLineSearchRef1854020000000();
const service = new AiEntityService({} as any, {
  listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
} as any);
const bodies = (r: QueryRunner) => r.query(`SELECT proname, pg_get_functiondef(oid) AS body FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname IN ('search_index_refresh_spend_items', 'search_index_refresh_capex_items') ORDER BY proname`);
const modes = (r: QueryRunner) => r.query(`SELECT tgname, tgenabled FROM pg_trigger
  WHERE tgrelid IN ('spend_items'::regclass, 'search_index'::regclass) AND NOT tgisinternal ORDER BY tgname`);
async function indexed(r: QueryRunner, tenant: string) {
  await setCurrentTenant(r, tenant);
  return r.query(`SELECT entity_type, entity_id, ref_prefix, ref_number, extra_json, search_vector, indexed_at, ctid::text AS tuple FROM search_index
    WHERE tenant_id = $1 AND entity_type IN ('spend_items', 'capex_items') ORDER BY entity_id`, [tenant]);
}
async function lines(r: QueryRunner, tenant: string) {
  await setCurrentTenant(r, tenant);
  return r.query(`SELECT to_jsonb(s) AS row FROM spend_items s WHERE tenant_id = $1 AND nature IN ('opex', 'capex') ORDER BY id`, [tenant]);
}
async function asMigration(r: QueryRunner, reverse = false) {
  await r.query(`SELECT set_config('app.current_tenant', '', true)`);
  if (reverse) await migration.down(r); else await migration.up(r);
  const [{ tenant }] = await r.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
  assert.equal(tenant, '', 'tenant context restored');
}
async function find(r: QueryRunner, tenant: string, query: string) {
  await setCurrentTenant(r, tenant);
  return service.searchAll({ tenantId: tenant, surface: 'chat', manager: r.manager } as any,
    { query, entity_types: ['spend_items', 'capex_items'], limit: 20 });
}
async function seed(r: QueryRunner, tenant: string, nature: string, number: number, legacy: string | null) {
  await setCurrentTenant(r, tenant);
  const id = randomUUID();
  await r.query(`INSERT INTO spend_items (id, tenant_id, nature, item_number, legacy_number, product_name, description, notes, currency, effective_start)
    VALUES ($1, $2, $3, $4, $5, 'Budget test', 'Searchable description', 'Separate notes', 'EUR', '2026-01-01')`, [id, tenant, nature, number, legacy]);
  return id;
}
async function dirtyDatabase() {
  await withRollback(async (r) => {
    await asMigration(r, true);
    const previous = await bodies(r);
    await new BudgetLineNature1853950000000().up(r);
    await r.query(CAPEX_REFRESH);
    assert.deepEqual(await bodies(r), previous, 'down restores deployed bodies byte for byte');
    const a = await seedTenant(r, 'u9-a'), b = await seedTenant(r, 'u9-b');
    const opex = await seed(r, a, 'opex', 12, 'OPX-12');
    const capex = await seed(r, a, 'capex', 103, 'CPX-3');
    await seed(r, a, 'opex', 3, null); // CPX-3 must resolve the legacy number, not BL-3.
    const moved = await seed(r, a, 'opex', 204, 'CPX-4');
    const newCapex = await seed(r, a, 'capex', 205, null);
    const foreign = await seed(r, b, 'capex', 103, 'CPX-3');
    for (const tenant of [a, b]) {
      await setCurrentTenant(r, tenant);
      await r.query(`UPDATE search_index SET ref_prefix = 'BAD', ref_number = -1, search_vector = ''::tsvector
        WHERE tenant_id = $1 AND entity_type IN ('spend_items', 'capex_items')`, [tenant]);
    }
    await r.query('ALTER TABLE spend_items DISABLE TRIGGER trg_search_index_spend_items');
    for (const mode of ['REPLICA', 'ALWAYS']) {
      await r.query(`CREATE TRIGGER u9_${mode.toLowerCase()} BEFORE UPDATE ON spend_items FOR EACH ROW EXECUTE FUNCTION search_index_sync_spend_items()`);
      await r.query(`ALTER TABLE spend_items ENABLE ${mode} TRIGGER u9_${mode.toLowerCase()}`);
    }
    const originalModes = await modes(r), beforeA = await lines(r, a), beforeB = await lines(r, b);
    await asMigration(r);
    assert.deepEqual(await lines(r, a), beforeA, 'all line fields, row_version and updated_at unchanged');
    assert.deepEqual(await lines(r, b), beforeB);
    assert.deepEqual(await modes(r), originalModes, 'O/D/R/A modes restored');
    const afterA = await indexed(r, a), afterB = await indexed(r, b);
    for (const row of [...afterA, ...afterB]) assert.equal(row.ref_prefix, 'BL');
    assert.equal(afterA.find((row: any) => row.entity_id === capex).ref_number, 103);
    for (const [query, id, ref] of [['BL-12', opex, 'BL-12'], ['OPX-12', opex, 'BL-12'], ['CPX-3', capex, 'BL-103'], ['CPX-4', moved, 'BL-204'], ['BL-205', newCapex, 'BL-205']]) {
      const found = await find(r, a, query);
      assert.equal(found.items[0]?.id, id, query);
      assert.equal(found.items[0]?.ref, ref, query);
      assert.ok(found.items.every((row) => row.id !== foreign), 'tenant isolation');
    }
    assert.equal((await find(r, b, 'CPX-3')).items[0]?.id, foreign);
    await asMigration(r);
    assert.deepEqual(await indexed(r, a), afterA, 'rerun preserves content and indexed_at');
    assert.deepEqual(await indexed(r, b), afterB);
    const nativeBodies = await bodies(r);
    await asMigration(r, true);
    assert.deepEqual(await bodies(r), previous, 'down restores exact bodies');
    const legacy = (await indexed(r, a)).find((row: any) => row.entity_id === capex);
    assert.equal(legacy.ref_prefix, 'CPX');
    assert.equal(legacy.ref_number, 3);
    await asMigration(r);
    assert.deepEqual(await bodies(r), nativeBodies, 'down then up restores native bodies');
    assert.deepEqual(await lines(r, a), beforeA);
    const query = r.query.bind(r);
    let injected = false;
    (r as any).query = async (sql: string, params?: unknown[]) => {
      if (!injected && sql.startsWith('SELECT search_index_refresh_spend_items')) {
        injected = true;
        return query('SELECT 1 / 0');
      }
      return query(sql, params);
    };
    await assert.rejects(asMigration(r), /division by zero/);
    (r as any).query = query;
    assert.deepEqual(await modes(r), originalModes, 'failure restores modes');
    assert.deepEqual(await bodies(r), nativeBodies, 'failure restores functions');
  });
}
async function ownTransactionFailure() {
  const r = dataSource.createQueryRunner();
  await r.connect();
  try {
    const before = await modes(r), query = r.query.bind(r);
    let injected = false;
    (r as any).query = async (sql: string, params?: unknown[]) => {
      if (!injected && sql.includes('CREATE OR REPLACE FUNCTION')) { injected = true; return query('SELECT 1 / 0'); }
      return query(sql, params);
    };
    await assert.rejects(migration.up(r), /division by zero/);
    (r as any).query = query;
    assert.equal(r.isTransactionActive, false);
    assert.deepEqual(await modes(r), before);
  } finally { await r.release(); }
}
void runSpecs('budget-line-search-ref-migration', [dirtyDatabase, ownTransactionFailure]);
