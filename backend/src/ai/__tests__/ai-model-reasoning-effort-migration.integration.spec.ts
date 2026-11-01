import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { AiModelReasoningEffort1855970000000 as Migration } from '../../migrations/1855970000000-ai-model-reasoning-effort';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from '../../analytics/__tests__/analytics-test-helpers';

// Migration 1855970000000 (the reasoning effort of an AI model), against a real database, in a
// transaction rolled back at the end: up() adds the nullable column and its check, a second up()
// changes nothing and keeps the value, down() drops both and up() after it restores them empty; a
// rerun without a current tenant clears a value outside the list, then the check refuses it.
// @database-spec (the data source opens in analytics-test-helpers).

const migration = new Migration();

async function column(runner: QueryRunner) {
  const rows: Array<Record<string, unknown>> = await runner.query(
    `SELECT is_nullable, column_default, data_type, character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'ai_model_configs'
        AND column_name = 'reasoning_effort'`,
  );
  return rows[0] ?? null;
}

async function constraintExists(runner: QueryRunner): Promise<boolean> {
  const rows = await runner.query(
    `SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_ai_model_configs_reasoning_effort'
        AND conrelid = 'ai_model_configs'::regclass`,
  );
  return rows.length === 1;
}

async function effort(runner: QueryRunner, tenantId: string, id: string): Promise<string | null> {
  const [row] = await runner.query(
    `SELECT reasoning_effort FROM ai_model_configs WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return row.reasoning_effort;
}

async function testUpRerunDownUp() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'reasoning-effort');
    await setCurrentTenant(runner, tenantId);

    await migration.up(runner);
    const added = await column(runner);
    assert.deepEqual(
      added,
      { is_nullable: 'YES', column_default: null, data_type: 'character varying', character_maximum_length: 10 },
      'the column after the migration',
    );
    assert.equal(await constraintExists(runner), true, 'up() adds the check');

    const [model] = await runner.query(
      `INSERT INTO ai_model_configs (tenant_id, name, provider, model)
       VALUES ($1, 'DeepSeek', 'custom', 'deepseek-v4') RETURNING id`,
      [tenantId],
    );
    assert.equal(await effort(runner, tenantId, model.id), null, 'a model has no effort until one is chosen');
    for (const value of ['low', 'medium', 'high', 'xhigh', 'max']) {
      await runner.query(
        `UPDATE ai_model_configs SET reasoning_effort = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, model.id, value],
      );
      assert.equal(await effort(runner, tenantId, model.id), value, `${value} is accepted`);
    }

    await migration.up(runner);
    assert.deepEqual(await column(runner), added, 'a second up() changes nothing');
    assert.equal(await effort(runner, tenantId, model.id), 'max', 'a second up() keeps the value');

    await migration.down(runner);
    assert.equal(await column(runner), null, 'down() drops the column');
    assert.equal(await constraintExists(runner), false, 'down() drops the check');

    await migration.up(runner);
    assert.deepEqual(await column(runner), added, 'up() after down() restores it');
    assert.equal(await constraintExists(runner), true, 'up() after down() restores the check');
    assert.equal(await effort(runner, tenantId, model.id), null, 'the effort is empty again');
  });
}

// A value written while the check was missing is cleared by a rerun, then refused.
async function testRerunRepairsUnknownValueThenRefusesIt() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'reasoning-effort-repair');
    await setCurrentTenant(runner, tenantId);

    await migration.up(runner);
    const [dirty] = await runner.query(
      `INSERT INTO ai_model_configs (tenant_id, name, provider, model)
       VALUES ($1, 'Dirty model', 'custom', 'dirty-model') RETURNING id`,
      [tenantId],
    );
    const [clean] = await runner.query(
      `INSERT INTO ai_model_configs (tenant_id, name, provider, model, reasoning_effort)
       VALUES ($1, 'Clean model', 'openai', 'gpt-6', 'high') RETURNING id`,
      [tenantId],
    );
    await runner.query(`ALTER TABLE ai_model_configs DROP CONSTRAINT chk_ai_model_configs_reasoning_effort`);
    await runner.query(
      `UPDATE ai_model_configs SET reasoning_effort = 'extreme' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, dirty.id],
    );

    // Migrations run without a current tenant: under FORCE RLS the repair must still see the row.
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await migration.up(runner);
    await setCurrentTenant(runner, tenantId);
    assert.equal(await constraintExists(runner), true, 'a rerun restores the check');
    assert.equal(await effort(runner, tenantId, dirty.id), null, 'the unknown value is cleared');
    assert.equal(await effort(runner, tenantId, clean.id), 'high', 'a value in the list is kept');

    await runner.query('SAVEPOINT unknown_effort');
    await assert.rejects(
      runner.query(
        `UPDATE ai_model_configs SET reasoning_effort = 'extreme' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dirty.id],
      ),
      /chk_ai_model_configs_reasoning_effort/,
      'a value outside the list is refused',
    );
    await runner.query('ROLLBACK TO SAVEPOINT unknown_effort');

    const [rls] = await runner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'ai_model_configs'::regclass`,
    );
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true }, 'RLS is enabled and forced again');
  });
}

runSpecs('ai-model-reasoning-effort-migration.integration.spec', [testUpRerunDownUp, testRerunRepairsUnknownValueThenRefusesIt]);
