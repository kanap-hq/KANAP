import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot K1 of 26.11.9: the lifecycle of one application changed by Kad (`update_business_record`,
// `create_business_record`) follows the workspace's lifecycle states, as the Applications screen and
// the change in bulk do.
//
// - On the shipped states (Proposed, Active, Deprecated, Retired): `in_development`, which the
//   workspace does not have, is refused at the card, on a change and on a creation.
// - `Obsolète` (the shipped French name) is read as `deprecated`: the card carries the code, which
//   the card names from the shipped labels in the person's language ("Obsolète" in French), then
//   the approval writes it.
// - A state the workspace created is accepted by its name and keeps that name; a state marked
//   retired in the settings is refused on an application that does not hold it (rule P7, lot K2c of
//   26.12.1), as the screen and the change in bulk no longer offer it there.

process.env.AI_CHAT_ENABLED = 'true';
process.env.AI_SETTINGS_ENABLED = 'true';
process.env.AI_MCP_ENABLED = 'true';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; settings: any };
type Seed = { tenantId: string; userId: string; appId: string };

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return String((await runner.query(sql, params))[0].id);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-app-lifecycle-${tag}`, `AI app lifecycle ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'lifecycle-model', 'custom', 'lifecycle-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'lifecycle-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const roleId = await one(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Applications member', 'Applications member', false, false, now(), now()) RETURNING id`, [tenantId]);
  for (const [resource, level] of [['ai_chat', 'member'], ['applications', 'member']]) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, roleId, resource, level]);
  }
  const userId = await one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, 'Member', 'Tester', $2, $3, false, 'enabled', 'fr', now(), now()) RETURNING id`,
    [tenantId, `member-${tag}@example.test`, roleId]);
  const appId = await one(runner,
    `INSERT INTO applications (tenant_id, name, lifecycle) VALUES ($1, 'Alpha', 'active') RETURNING id`, [tenantId]);
  return { tenantId, userId, appId };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-application-lifecycle-write.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { ItOpsSettingsService } = require('../../it-ops-settings/it-ops-settings.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    settings: app.get(ItOpsSettingsService, { strict: false }),
  };
}

function context(s: Seed, runner: QueryRunner) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId: randomUUID(), manager: runner.manager,
  };
}

async function card(harness: Harness, ctx: any, tool: string, input: Record<string, unknown>) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI application lifecycle', 'custom', 'lifecycle-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, tool, input) as any;
  assert.equal(preview.status, 'pending', JSON.stringify(preview));
  return preview;
}

async function approve(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'the card did not execute');
}

async function refused(fn: () => Promise<unknown>, pattern: RegExp) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `Expected a refusal matching ${pattern}`);
  assert.match(String(thrown?.message ?? ''), pattern);
}

async function lifecycleOf(runner: QueryRunner, s: Seed): Promise<string> {
  const [row] = await runner.query(`SELECT lifecycle FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.appId]);
  return row.lifecycle;
}

async function inSeed(harness: Harness, test: (runner: QueryRunner, s: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(runner, await seed(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testUnknownStateRefused(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const states = (await harness.settings.getSettings(s.tenantId, { manager: runner.manager })).lifecycleStates.map((state: any) => state.code);
    assert.deepEqual(states, ['proposed', 'active', 'deprecated', 'retired'], 'the shipped lifecycle states');
    await refused(
      () => card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: 'APP-1', fields: { lifecycle: 'in_development' } }),
      /^Unknown lifecycle "in_development"\. Use one of: Proposé, Actif, Obsolète, Retiré\.$/,
    );
    await refused(
      () => card(harness, ctx, 'create_business_record', { entity_type: 'applications', fields: { name: 'Bravo', lifecycle: 'in_development' } }),
      /Unknown lifecycle "in_development"/,
    );
    assert.equal(await lifecycleOf(runner, s), 'active');
  });
}

async function testShippedStateByItsFrenchName(harness: Harness) {
  const { shippedLabelIn } = require('../../it-ops-settings/catalog-shipped-labels');
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: 'APP-1', fields: { lifecycle: 'Obsolète' } });
    assert.deepEqual(
      { from: preview.changes.lifecycle.from, to: preview.changes.lifecycle.to },
      { from: 'active', to: 'deprecated' },
      'the card carries the codes of the workspace states',
    );
    // The card names a code from the workspace state's shipped labels in the person's language.
    const states = (await harness.settings.getSettings(s.tenantId, { manager: runner.manager })).lifecycleStates;
    const name = (code: string) => shippedLabelIn('lifecycleStates', states.find((state: any) => state.code === code), 'fr');
    assert.equal(`${name('active')} → ${name('deprecated')}`, 'Actif → Obsolète');
    await approve(harness, ctx, preview);
    assert.equal(await lifecycleOf(runner, s), 'deprecated');
  });
}

async function testWorkspaceStates(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const shipped = (await harness.settings.getSettings(s.tenantId, { manager: runner.manager })).lifecycleStates;
    await harness.settings.updateSettings(s.tenantId, {
      lifecycleStates: [
        ...shipped,
        { code: 'pilot', label: 'Pilote maison' },
        { code: 'frozen', label: 'Gelé', deprecated: true },
      ],
    }, { manager: runner.manager });

    const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: 'APP-1', fields: { lifecycle: 'Pilote maison' } });
    assert.equal(preview.changes.lifecycle.to, 'pilot');
    const states = (await harness.settings.getSettings(s.tenantId, { manager: runner.manager })).lifecycleStates;
    assert.equal(states.find((state: any) => state.code === 'pilot')?.label, 'Pilote maison', 'the card names it as the workspace does');
    await approve(harness, ctx, preview);
    assert.equal(await lifecycleOf(runner, s), 'pilot');

    // A state marked retired in the settings is refused on an application that does not hold it.
    await refused(
      () => card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: 'APP-1', fields: { lifecycle: 'Gelé' } }),
      /^The lifecycle "Gelé" is retired: only a record that already holds it keeps it\. Use one of: Proposé, Actif, Obsolète, Retiré, Pilote maison\.$/,
    );
    assert.equal(await lifecycleOf(runner, s), 'pilot');
  });
}

async function run() {
  const harness = await createHarness();
  try {
    const failures: string[] = [];
    for (const test of [testUnknownStateRefused, testShippedStateByItsFrenchName, testWorkspaceStates]) {
      try {
        await test(harness);
      } catch (error) {
        failures.push(`${test.name}: ${(error as Error).message}`);
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('ai-application-lifecycle-write.integration.spec.ts passed');
  } finally {
    await harness.app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
