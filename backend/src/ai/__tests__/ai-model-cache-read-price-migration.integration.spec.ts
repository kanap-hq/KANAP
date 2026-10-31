import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { AiModelCacheReadPrice1855960000000 as Migration } from '../../migrations/1855960000000-ai-model-cache-read-price';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';

// Migration 1855960000000 (the cache read price of an AI model), against a real database, in a
// transaction rolled back at the end: up() adds the nullable column and keeps the stored prices, a
// second up() changes nothing and keeps its value, down() drops it and up() after it restores it empty.
// @database-spec (the data source opens in analytics-test-helpers).

const migration = new Migration();

async function column(runner: QueryRunner) {
  const rows: Array<Record<string, unknown>> = await runner.query(
    `SELECT is_nullable, column_default, data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'ai_model_configs'
        AND column_name = 'price_cache_read_eur_per_mtok'`,
  );
  return rows[0] ?? null;
}

async function prices(runner: QueryRunner, tenantId: string, id: string) {
  const [row] = await runner.query(
    `SELECT price_input_eur_per_mtok, price_output_eur_per_mtok, price_cache_read_eur_per_mtok
       FROM ai_model_configs WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return row;
}

async function testUpRerunDownUp() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'cache-read-price');
    await setCurrentTenant(runner, tenantId);

    await migration.up(runner);
    const added = await column(runner);
    assert.deepEqual(
      added,
      { is_nullable: 'YES', column_default: null, data_type: 'numeric', numeric_precision: 12, numeric_scale: 4 },
      'the column after the migration',
    );

    const [model] = await runner.query(
      `INSERT INTO ai_model_configs (tenant_id, name, provider, model, price_input_eur_per_mtok, price_output_eur_per_mtok)
       VALUES ($1, 'Mistral medium', 'openai', 'mistral-medium-latest', 0.4, 2) RETURNING id`,
      [tenantId],
    );
    assert.deepEqual(
      await prices(runner, tenantId, model.id),
      { price_input_eur_per_mtok: '0.4000', price_output_eur_per_mtok: '2.0000', price_cache_read_eur_per_mtok: null },
      'a model has no cache read price until one is entered',
    );
    await runner.query(
      `UPDATE ai_model_configs SET price_cache_read_eur_per_mtok = 0.04 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, model.id],
    );

    await migration.up(runner);
    assert.deepEqual(await column(runner), added, 'a second up() changes nothing');
    assert.equal((await prices(runner, tenantId, model.id)).price_cache_read_eur_per_mtok, '0.0400', 'a second up() keeps the value');

    await migration.down(runner);
    assert.equal(await column(runner), null, 'down() drops the column');

    await migration.up(runner);
    assert.deepEqual(await column(runner), added, 'up() after down() restores it');
    assert.deepEqual(
      await prices(runner, tenantId, model.id),
      { price_input_eur_per_mtok: '0.4000', price_output_eur_per_mtok: '2.0000', price_cache_read_eur_per_mtok: null },
      'the input and output prices are untouched, the cache read price is empty again',
    );
  });
}

runSpecs('ai-model-cache-read-price-migration.integration.spec', [testUpRerunDownUp]);
