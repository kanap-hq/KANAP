import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AiIncludedModelConfirmation1853880000000 as Migration } from '../../migrations/1853880000000-ai-included-model-confirmation';
import { builtinProviderKey } from '../platform/platform-ai-config.service';

// Migration 1853880000000 (confirmation of the KANAP included model), against a real
// database, each case in a transaction that is rolled back. The migration runs as
// migrations do, without a tenant context. Each workspace's rows are written and read
// through its own app.current_tenant; assertions read this test's workspaces only.
// - platform on the Anthropic API (no endpoint, or the api.anthropic.com host): shown as
//   Anthropic / US; the workspaces with the assistant or an enabled agent are marked as
//   confirmed without an author (a workspace with an enabled agent and no settings row
//   gets one); a workspace without AI, one with MCP only (MCP sends nothing to the
//   included model) and one with a draft agent only stay as they were; row level
//   security is left as found; a second run changes no row;
// - a provider name already set in the platform console is kept and used for the key;
// - another provider (openai, or Anthropic behind another host): nothing filled, nobody
//   marked, a warning;
// - no platform row (single-tenant): nothing changes, no warning.

const migration = new Migration();
const LOG_PREFIX = '[Migration] AiIncludedModelConfirmation:';
const DISCLOSURE_WARNING = 'included model disclosure not set: fill it in the platform console; workspaces will be asked to confirm';

type Captured = { logs: string[]; warnings: string[] };

async function captureConsole(fn: () => Promise<void>): Promise<Captured> {
  const captured: Captured = { logs: [], warnings: [] };
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: any[]) => { captured.logs.push(args.map(String).join(' ')); };
  console.warn = (...args: any[]) => { captured.warnings.push(args.map(String).join(' ')); };
  try {
    await fn();
    return captured;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

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

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** No tenant context, as when migrations run. */
async function clearTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Included model', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `included-model-${tag}-${tenantId.slice(0, 8)}`],
  );
  return tenantId;
}

async function insertSettings(runner: QueryRunner, tenantId: string, values: { chat: boolean; mcp: boolean }) {
  await setTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source) VALUES ($1, $2, $3, 'builtin')`,
    [tenantId, values.chat, values.mcp],
  );
}

async function insertAgent(runner: QueryRunner, tenantId: string, status: 'enabled' | 'draft') {
  await setTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO ai_agent_definitions (
       tenant_id, agent_key, name, agent_type, status, environment, max_autonomy_level, default_approval_requirement
     ) VALUES ($1, $2, 'Service desk agent', 'helpdesk', $3, 'sandbox', 'A2', 'human_for_writes')`,
    [tenantId, `included-model-${status}-${tenantId.slice(0, 8)}`, status],
  );
}

type SettingsRow = {
  ctid: string;
  chat_enabled: boolean;
  mcp_enabled: boolean;
  provider_source: string;
  web_search_enabled: boolean;
  llm_supports_vision: boolean;
  glpi_enabled: boolean;
  builtin_accepted_key: string | null;
  builtin_accepted_at: Date | null;
  builtin_accepted_by: string | null;
};

/** The settings row of one workspace, read through its own context; null when it has none. */
async function settingsOf(runner: QueryRunner, tenantId: string): Promise<SettingsRow | null> {
  await setTenant(runner, tenantId);
  const rows = await runner.query(
    `SELECT ctid::text AS ctid, chat_enabled, mcp_enabled, provider_source, web_search_enabled,
            llm_supports_vision, glpi_enabled, builtin_accepted_key, builtin_accepted_at, builtin_accepted_by
       FROM ai_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

async function setPlatform(
  runner: QueryRunner,
  row: { provider: string; endpoint_url?: string | null; disclosure_name?: string | null; disclosure_location?: string | null } | null,
) {
  await runner.query(`DELETE FROM platform_ai_config`);
  if (!row) return;
  await runner.query(
    `INSERT INTO platform_ai_config (provider, model, api_key_encrypted, endpoint_url, disclosure_name, disclosure_location)
     VALUES ($1, 'included-model', 'encrypted-key', $2, $3, $4)`,
    [row.provider, row.endpoint_url ?? null, row.disclosure_name ?? null, row.disclosure_location ?? null],
  );
}

async function platformDisclosure(runner: QueryRunner) {
  const [row] = await runner.query(`SELECT disclosure_name, disclosure_location FROM platform_ai_config`);
  return row ?? null;
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

type Workspaces = {
  chat: string;
  agentOnly: string;
  mcpOnly: string;
  agentWithoutSettings: string;
  draftAgentOnly: string;
  noAi: string;
};

/** One workspace per situation the migration tells apart. */
async function seedWorkspaces(runner: QueryRunner, tag: string): Promise<Workspaces> {
  const workspaces: Workspaces = {
    chat: await seedTenant(runner, `${tag}-chat`),
    agentOnly: await seedTenant(runner, `${tag}-agent`),
    mcpOnly: await seedTenant(runner, `${tag}-mcp`),
    agentWithoutSettings: await seedTenant(runner, `${tag}-agent-nosettings`),
    draftAgentOnly: await seedTenant(runner, `${tag}-draft`),
    noAi: await seedTenant(runner, `${tag}-none`),
  };
  await insertSettings(runner, workspaces.chat, { chat: true, mcp: false });
  await insertSettings(runner, workspaces.agentOnly, { chat: false, mcp: false });
  await insertAgent(runner, workspaces.agentOnly, 'enabled');
  await insertSettings(runner, workspaces.mcpOnly, { chat: false, mcp: true });
  await insertAgent(runner, workspaces.agentWithoutSettings, 'enabled');
  await insertSettings(runner, workspaces.draftAgentOnly, { chat: false, mcp: false });
  await insertAgent(runner, workspaces.draftAgentOnly, 'draft');
  await insertSettings(runner, workspaces.noAi, { chat: false, mcp: false });
  return workspaces;
}

async function assertNobodyMarked(runner: QueryRunner, workspaces: Workspaces) {
  for (const [label, tenantId] of Object.entries(workspaces)) {
    const row = await settingsOf(runner, tenantId);
    if (label === 'agentWithoutSettings') {
      assert.equal(row, null, `${label}: no settings row created`);
      continue;
    }
    assert.equal(row?.builtin_accepted_key, null, `${label}: not marked`);
    assert.equal(row?.builtin_accepted_at, null, `${label}: not marked`);
  }
}

/** Anthropic API without endpoint: identity filled, workspaces using AI marked, the others kept. */
async function testAnthropicDirectMarksWorkspacesUsingAi() {
  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, { provider: 'anthropic' });
    const workspaces = await seedWorkspaces(runner, 'direct');
    const before = {
      noAi: await settingsOf(runner, workspaces.noAi),
      mcpOnly: await settingsOf(runner, workspaces.mcpOnly),
      draftAgentOnly: await settingsOf(runner, workspaces.draftAgentOnly),
    };

    await clearTenant(runner);
    const first = await captureConsole(() => migration.up(runner));

    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'US' });
    const key = builtinProviderKey({ provider: 'anthropic', endpointHost: '', name: 'Anthropic', location: 'US' });
    assert.equal(key, 'anthropic||Anthropic|US', 'the key the service computes');

    for (const label of ['chat', 'agentOnly', 'agentWithoutSettings'] as const) {
      const row = await settingsOf(runner, workspaces[label]);
      assert.ok(row, `${label}: has a settings row`);
      assert.equal(row.builtin_accepted_key, key, `${label}: marked as confirmed`);
      assert.ok(row.builtin_accepted_at instanceof Date, `${label}: confirmation date set`);
      assert.equal(row.builtin_accepted_by, null, `${label}: no author (presumed)`);
    }
    const created = await settingsOf(runner, workspaces.agentWithoutSettings);
    assert.deepEqual(
      {
        chat_enabled: created?.chat_enabled,
        mcp_enabled: created?.mcp_enabled,
        provider_source: created?.provider_source,
        web_search_enabled: created?.web_search_enabled,
        llm_supports_vision: created?.llm_supports_vision,
        glpi_enabled: created?.glpi_enabled,
      },
      {
        chat_enabled: false,
        mcp_enabled: false,
        provider_source: 'builtin',
        web_search_enabled: false,
        llm_supports_vision: true,
        glpi_enabled: false,
      },
      'the created row has the defaults of AiSettingsService.get',
    );
    for (const label of ['noAi', 'mcpOnly', 'draftAgentOnly'] as const) {
      const row = await settingsOf(runner, workspaces[label]);
      assert.equal(row?.builtin_accepted_key, null, `${label}: not marked`);
      assert.equal(row?.ctid, before[label]?.ctid, `${label}: row not rewritten`);
    }

    assert.deepEqual(await rowSecurity(runner, 'ai_settings'), { enabled: true, forced: true }, 'ai_settings RLS as found');
    assert.deepEqual(await rowSecurity(runner, 'ai_agent_definitions'), { enabled: true, forced: true }, 'ai_agent_definitions RLS as found');

    assert.ok(first.logs.includes(`${LOG_PREFIX} included model shown as Anthropic, processed in US`), first.logs.join('\n'));
    const summary = first.logs.find((line) => line.includes('workspace(s) already using AI marked as confirmed'));
    const counted = Number(/ (\d+) workspace\(s\)/.exec(summary ?? '')?.[1] ?? 0);
    assert.ok(counted >= 3, `the marked workspaces are counted (${summary})`);
    assert.match(summary ?? '', /\(\d+ AI settings row\(s\) created\)/);
    assert.deepEqual(first.warnings, []);

    // A second run changes nothing.
    const afterFirst = new Map<string, string | undefined>();
    for (const tenantId of Object.values(workspaces)) afterFirst.set(tenantId, (await settingsOf(runner, tenantId))?.ctid);
    await clearTenant(runner);
    const second = await captureConsole(() => migration.up(runner));
    for (const tenantId of Object.values(workspaces)) {
      assert.equal((await settingsOf(runner, tenantId))?.ctid, afterFirst.get(tenantId), 'the second run rewrites no row');
    }
    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'US' });
    assert.deepEqual(
      second.logs.filter((line) => line.startsWith(LOG_PREFIX)),
      [`${LOG_PREFIX} no workspace to mark as confirmed for anthropic||Anthropic|US`],
      'the second run says so',
    );
  });
}

/** The api.anthropic.com host counts as the Anthropic API; a name set in the console is kept. */
async function testAnthropicHostAndExistingName() {
  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, { provider: 'anthropic', endpoint_url: 'https://api.anthropic.com/v1' });
    const tenantId = await seedTenant(runner, 'host');
    await insertSettings(runner, tenantId, { chat: true, mcp: false });
    await clearTenant(runner);
    await captureConsole(() => migration.up(runner));
    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'US' });
    assert.equal(
      (await settingsOf(runner, tenantId))?.builtin_accepted_key,
      'anthropic|api.anthropic.com|Anthropic|US',
      'the endpoint host is part of the key',
    );
  });

  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, { provider: 'anthropic', disclosure_name: 'Anthropic', disclosure_location: 'EU' });
    const tenantId = await seedTenant(runner, 'named');
    await insertSettings(runner, tenantId, { chat: true, mcp: false });
    await clearTenant(runner);
    const captured = await captureConsole(() => migration.up(runner));
    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'EU' }, 'kept');
    assert.equal(
      (await settingsOf(runner, tenantId))?.builtin_accepted_key,
      builtinProviderKey({ provider: 'anthropic', endpointHost: '', name: 'Anthropic', location: 'EU' }),
    );
    assert.deepEqual(captured.warnings, []);
  });
}

/** Another provider, or Anthropic behind another host: nothing filled, nobody marked, a warning. */
async function testOtherProviderLeavesEverythingEmpty() {
  for (const platform of [
    { provider: 'openai' },
    { provider: 'anthropic', endpoint_url: 'https://llm-gateway.example.com/v1' },
  ]) {
    await inRolledBackTransaction(async (runner) => {
      await setPlatform(runner, platform);
      const workspaces = await seedWorkspaces(runner, 'other');
      await clearTenant(runner);
      const captured = await captureConsole(() => migration.up(runner));
      assert.deepEqual(await platformDisclosure(runner), { disclosure_name: null, disclosure_location: null }, platform.provider);
      await assertNobodyMarked(runner, workspaces);
      assert.deepEqual(captured.warnings, [`${LOG_PREFIX} ${DISCLOSURE_WARNING}`], `${JSON.stringify(platform)}: warned`);
    });
  }
}

/** No platform row, as in single-tenant installations: nothing changes, no warning. */
async function testEmptyPlatformChangesNothing() {
  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, null);
    const workspaces = await seedWorkspaces(runner, 'empty');
    await clearTenant(runner);
    const captured = await captureConsole(() => migration.up(runner));
    await assertNobodyMarked(runner, workspaces);
    assert.deepEqual(captured.warnings, []);
    assert.deepEqual(
      captured.logs.filter((line) => line.startsWith(LOG_PREFIX)),
      [`${LOG_PREFIX} no included model is configured, nothing to do`],
    );
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM platform_ai_config`);
    assert.equal(n, 0, 'no platform row is created');
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testAnthropicDirectMarksWorkspacesUsingAi();
    await testAnthropicHostAndExistingName();
    await testOtherProviderLeavesEverythingEmpty();
    await testEmptyPlatformChangesNothing();
  } finally {
    await dataSource.destroy();
  }
  console.log('ai-included-model-confirmation-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
