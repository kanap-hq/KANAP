import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AiIncludedModelConfirmation1853885000000 as Migration } from '../../migrations/1853885000000-ai-included-model-confirmation';

// Migration 1853885000000 (confirmation of the KANAP included model), against a real
// database, each case in a transaction that is rolled back. The migration runs as
// migrations do, without a tenant context. Each workspace's rows are written and read
// through its own app.current_tenant; assertions read this test's workspaces only.
// - the columns are added (down then up), nullable;
// - platform on the Anthropic API (no endpoint, or the api.anthropic.com host): shown as
//   Anthropic / US; a second run changes nothing;
// - a provider name already set in the platform console is kept;
// - another provider (openai, or Anthropic behind another host), or a name without a valid
//   location: nothing filled, a warning;
// - no platform row (single-tenant): nothing changes, no warning;
// - in every case no workspace is marked as confirmed, no ai_settings row is written or
//   created, and row level security of ai_settings and ai_agent_definitions is untouched.

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

/**
 * No workspace is marked as confirmed and no settings row is written or created: each
 * row is the one found before the run (same ctid), and the workspace with an enabled
 * agent but no settings row still has none. Row level security is as found.
 */
async function assertTenantDataUntouched(
  runner: QueryRunner,
  workspaces: Workspaces,
  before: Map<string, string | null>,
) {
  for (const [label, tenantId] of Object.entries(workspaces)) {
    const row = await settingsOf(runner, tenantId);
    if (label === 'agentWithoutSettings') {
      assert.equal(row, null, `${label}: no settings row created`);
      continue;
    }
    assert.ok(row, `${label}: settings row kept`);
    assert.equal(row.ctid, before.get(tenantId), `${label}: row not rewritten`);
    assert.equal(row.builtin_accepted_key, null, `${label}: not marked`);
    assert.equal(row.builtin_accepted_at, null, `${label}: not marked`);
    assert.equal(row.builtin_accepted_by, null, `${label}: not marked`);
  }
  assert.deepEqual(await rowSecurity(runner, 'ai_settings'), { enabled: true, forced: true }, 'ai_settings RLS as found');
  assert.deepEqual(await rowSecurity(runner, 'ai_agent_definitions'), { enabled: true, forced: true }, 'ai_agent_definitions RLS as found');
}

async function settingsSnapshot(runner: QueryRunner, workspaces: Workspaces): Promise<Map<string, string | null>> {
  const snapshot = new Map<string, string | null>();
  for (const tenantId of Object.values(workspaces)) {
    snapshot.set(tenantId, (await settingsOf(runner, tenantId))?.ctid ?? null);
  }
  return snapshot;
}

async function columnsOf(runner: QueryRunner) {
  const rows: Array<{ column: string; nullable: string }> = await runner.query(
    `SELECT table_name || '.' || column_name AS column, is_nullable AS nullable
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'platform_ai_config' AND column_name IN ('disclosure_name', 'disclosure_location'))
          OR (table_name = 'ai_settings' AND column_name IN ('builtin_accepted_key', 'builtin_accepted_at', 'builtin_accepted_by')))
      ORDER BY 1`,
  );
  return rows;
}

/** down() drops the columns, up() adds them back, nullable. */
async function testColumns() {
  await inRolledBackTransaction(async (runner) => {
    await clearTenant(runner);
    await captureConsole(() => migration.down(runner));
    assert.deepEqual(await columnsOf(runner), [], 'down drops the columns');
    await captureConsole(() => migration.up(runner));
    assert.deepEqual(await columnsOf(runner), [
      { column: 'ai_settings.builtin_accepted_at', nullable: 'YES' },
      { column: 'ai_settings.builtin_accepted_by', nullable: 'YES' },
      { column: 'ai_settings.builtin_accepted_key', nullable: 'YES' },
      { column: 'platform_ai_config.disclosure_location', nullable: 'YES' },
      { column: 'platform_ai_config.disclosure_name', nullable: 'YES' },
    ]);
  });
}

/** Anthropic API without endpoint: identity filled; no workspace touched; a second run changes nothing. */
async function testAnthropicDirectFillsTheIdentityOnly() {
  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, { provider: 'anthropic' });
    const workspaces = await seedWorkspaces(runner, 'direct');
    const before = await settingsSnapshot(runner, workspaces);

    await clearTenant(runner);
    const first = await captureConsole(() => migration.up(runner));

    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'US' });
    await assertTenantDataUntouched(runner, workspaces, before);
    assert.deepEqual(
      first.logs.filter((line) => line.startsWith(LOG_PREFIX)),
      [`${LOG_PREFIX} included model shown as Anthropic, processed in US`],
    );
    assert.deepEqual(first.warnings, []);

    // A second run changes nothing.
    const [platformBefore] = await runner.query(`SELECT ctid::text AS ctid FROM platform_ai_config`);
    await clearTenant(runner);
    const second = await captureConsole(() => migration.up(runner));
    const [platformAfter] = await runner.query(`SELECT ctid::text AS ctid FROM platform_ai_config`);
    assert.equal(platformAfter.ctid, platformBefore.ctid, 'the platform row is not rewritten');
    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'US' });
    await assertTenantDataUntouched(runner, workspaces, before);
    assert.deepEqual(
      second.logs.filter((line) => line.startsWith(LOG_PREFIX)),
      [`${LOG_PREFIX} included model disclosure already set, nothing to do`],
      'the second run says so',
    );
    assert.deepEqual(second.warnings, []);
  });
}

/** The api.anthropic.com host counts as the Anthropic API; a name set in the console is kept. */
async function testAnthropicHostAndExistingName() {
  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, { provider: 'anthropic', endpoint_url: 'https://api.anthropic.com/v1' });
    const workspaces = await seedWorkspaces(runner, 'host');
    const before = await settingsSnapshot(runner, workspaces);
    await clearTenant(runner);
    await captureConsole(() => migration.up(runner));
    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'US' });
    await assertTenantDataUntouched(runner, workspaces, before);
  });

  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, { provider: 'anthropic', disclosure_name: 'Anthropic', disclosure_location: 'EU' });
    const workspaces = await seedWorkspaces(runner, 'named');
    const before = await settingsSnapshot(runner, workspaces);
    await clearTenant(runner);
    const captured = await captureConsole(() => migration.up(runner));
    assert.deepEqual(await platformDisclosure(runner), { disclosure_name: 'Anthropic', disclosure_location: 'EU' }, 'kept');
    await assertTenantDataUntouched(runner, workspaces, before);
    assert.deepEqual(captured.warnings, []);
  });
}

/** Another provider, Anthropic behind another host, or a name without a valid location: nothing filled, a warning. */
async function testOtherProviderLeavesEverythingEmpty() {
  for (const platform of [
    { provider: 'openai' },
    { provider: 'anthropic', endpoint_url: 'https://llm-gateway.example.com/v1' },
    { provider: 'anthropic', disclosure_name: 'Anthropic' },
  ]) {
    await inRolledBackTransaction(async (runner) => {
      await setPlatform(runner, platform);
      const workspaces = await seedWorkspaces(runner, 'other');
      const before = await settingsSnapshot(runner, workspaces);
      await clearTenant(runner);
      const captured = await captureConsole(() => migration.up(runner));
      assert.deepEqual(
        await platformDisclosure(runner),
        { disclosure_name: platform.disclosure_name ?? null, disclosure_location: null },
        JSON.stringify(platform),
      );
      await assertTenantDataUntouched(runner, workspaces, before);
      assert.deepEqual(captured.warnings, [`${LOG_PREFIX} ${DISCLOSURE_WARNING}`], `${JSON.stringify(platform)}: warned`);
    });
  }
}

/** No platform row, as in single-tenant installations: nothing changes, no warning. */
async function testEmptyPlatformChangesNothing() {
  await inRolledBackTransaction(async (runner) => {
    await setPlatform(runner, null);
    const workspaces = await seedWorkspaces(runner, 'empty');
    const before = await settingsSnapshot(runner, workspaces);
    await clearTenant(runner);
    const captured = await captureConsole(() => migration.up(runner));
    await assertTenantDataUntouched(runner, workspaces, before);
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
    await testColumns();
    await testAnthropicDirectFillsTheIdentityOnly();
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
