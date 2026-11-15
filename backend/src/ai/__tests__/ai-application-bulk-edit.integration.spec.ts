import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot K1 of 26.11.9: Kad changes one field on many applications (`bulk_update_applications`), under
// a card the person approves, as the "Change the selection" of the applications list.
//
// - A filter of the list: the same applications as the list of the screen (enabled, retired ones
//   left out unless the filter names the lifecycle), the card in words, each application's audit
//   rows "by Kad". A state or a level by its name or its code.
// - References (APP-n); no criterion, a field outside the dozen, an ignored or invalid filter, both
//   rows and filters: refused. Every field: owners replace the role's people (empty allowed), the
//   lifecycle never empty, the business criticality among the levels still offered, or empty.
// - More than 5,000 applications refused; the list changed between the card and the approval refused.
// - An IT Landscape Reader and the shipped Business Contributor are not offered the tool; a Business
//   Contributor raised to member reaches the applications they own only, the others neither counted,
//   named nor changed; a right withdrawn refuses the approval; a frozen subscription refuses both.
// - An application held by another transaction: the bounded wait, the card stays to approve.

process.env.AI_CHAT_ENABLED = 'true';
process.env.AI_SETTINGS_ENABLED = 'true';
process.env.AI_MCP_ENABLED = 'true';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const TOOL = 'bulk_update_applications';
const CARD = 'application_bulk_edit';
const LIST_CHANGED = 'The list changed since the count: count again.';
const DATA_BUSY_CARD = 'The data this change writes was busy with another operation, so nothing was changed. Approve it again in a moment.';

type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; applications: any; policy: any; timeouts: { lockTimeoutMs: number; statementTimeoutMs: number } };
type Seed = {
  tenantId: string;
  users: Record<'member' | 'reader' | 'contributor' | 'julie' | 'marc', string>;
  roles: Record<'member' | 'contributor', string>;
  suppliers: { acme: string; beta: string };
  /**
   * APP-1 Alpha, APP-2 Bravo (low), APP-6 Foxtrot (proposed): Acme, enabled; APP-3 Charlie Acme
   * retired; APP-4 Delta Acme disabled; APP-5 Echo Beta. The contributor owns APP-1 (business, with
   * Marc in IT) and APP-5 (IT).
   */
  apps: Record<number, string>;
  conversations: Record<string, string>;
};

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return String((await runner.query(sql, params))[0].id);
}

async function seedRole(runner: QueryRunner, tenantId: string, name: string, permissions: Record<string, string>) {
  const roleId = await one(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $2, false, false, now(), now()) RETURNING id`, [tenantId, name]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, roleId, resource, level]);
  }
  return roleId;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, first: string, last: string) {
  return one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, false, 'enabled', 'en', now(), now()) RETURNING id`,
    [tenantId, first, last, `${first.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`, roleId]);
}

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-apps-bulk-${tag}`, `AI apps bulk ${tag}`],
  );
  await setTenant(runner, tenantId);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'bulk-model', 'custom', 'bulk-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'bulk-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const member = await seedRole(runner, tenantId, 'Bulk applications member', { ai_chat: 'member', applications: 'member' });
  const reader = await seedRole(runner, tenantId, 'Bulk applications reader', { ai_chat: 'member', applications: 'reader' });
  // The shipped Business Contributor reads the applications.
  const contributor = await seedRole(runner, tenantId, 'Business Contributor', { ai_chat: 'member', applications: 'reader' });
  const users = {
    member: await seedUser(runner, tenantId, member, 'Member', 'Tester'),
    reader: await seedUser(runner, tenantId, reader, 'Reader', 'Tester'),
    contributor: await seedUser(runner, tenantId, contributor, 'Carla', 'Contributor'),
    julie: await seedUser(runner, tenantId, reader, 'Julie', 'Bernard'),
    marc: await seedUser(runner, tenantId, reader, 'Marc', 'Petit'),
  };
  const supplier = (name: string) => one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  const suppliers = { acme: await supplier('Acme'), beta: await supplier('Beta') };
  const apps: Record<number, string> = {};
  const app = async (n: number, name: string, supplierId: string, lifecycle: string, extra: { criticality?: string; disabled?: boolean } = {}) => {
    apps[n] = await one(runner,
      `INSERT INTO applications (tenant_id, name, supplier_id, lifecycle, criticality, disabled_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, name, supplierId, lifecycle, extra.criticality ?? null, extra.disabled ? '2020-06-30' : null]);
  };
  await app(1, 'Alpha', suppliers.acme, 'active');
  await app(2, 'Bravo', suppliers.acme, 'active', { criticality: 'low' });
  await app(3, 'Charlie', suppliers.acme, 'retired');
  await app(4, 'Delta', suppliers.acme, 'active', { disabled: true });
  await app(5, 'Echo', suppliers.beta, 'active');
  await app(6, 'Foxtrot', suppliers.acme, 'proposed');
  const owner = (n: number, userId: string, type: 'business' | 'it') => runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, $4)`, [tenantId, apps[n], userId, type]);
  await owner(1, users.contributor, 'business');
  await owner(1, users.marc, 'it');
  await owner(5, users.contributor, 'it');
  return { tenantId, users, roles: { member, contributor }, suppliers, apps, conversations: {} };
}

function context(seed: Seed, runner: QueryRunner, label: string, userId = seed.users.member) {
  const key = `${userId}:${label}`;
  seed.conversations[key] ||= randomUUID();
  return {
    tenantId: seed.tenantId, userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId: seed.conversations[key], manager: runner.manager,
  };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-application-bulk-edit.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { ApplicationsService } = require('../../applications/services/applications.service');
  const { AI_BULK_EDIT_DB_TIMEOUTS } = require('../mutation/ai-bulk-edit');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    applications: app.get(ApplicationsService, { strict: false }),
    policy: app.get(AiPolicyService, { strict: false }),
    timeouts: AI_BULK_EDIT_DB_TIMEOUTS,
  };
}

async function ensureConversation(ctx: any) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI applications bulk edit integration', 'custom', 'bulk-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
}

async function card(harness: Harness, ctx: any, input: Record<string, unknown>) {
  await ensureConversation(ctx);
  const preview = await harness.tools.execute(ctx, TOOL, input) as any;
  assert.equal(preview.status, 'pending');
  assert.equal(preview.requires_confirmation, true);
  return preview;
}

async function approve(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'the card did not execute');
  return executed;
}

async function rejects(fn: () => Promise<unknown>, pattern: RegExp | string) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `Expected a refusal matching ${pattern}`);
  const message = thrown?.message ?? JSON.stringify(thrown?.response ?? thrown);
  if (typeof pattern === 'string') assert.equal(message, pattern);
  else assert.match(message, pattern);
  return thrown;
}

async function inSeed(harness: Harness, test: (runner: QueryRunner, seed: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(runner, await seedGraph(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function column(runner: QueryRunner, seed: Seed, n: number, name: 'lifecycle' | 'criticality'): Promise<string | null> {
  const [row] = await runner.query(`SELECT ${name}::text AS v FROM applications WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.apps[n]]);
  return row?.v ?? null;
}

async function owners(runner: QueryRunner, seed: Seed, n: number, type: 'business' | 'it'): Promise<string[]> {
  const rows = await runner.query(
    `SELECT user_id::text AS id FROM application_owners WHERE tenant_id = $1 AND application_id = $2 AND owner_type = $3`, [seed.tenantId, seed.apps[n], type]);
  return rows.map((row: { id: string }) => row.id).sort();
}

async function appsWith(runner: QueryRunner, seed: Seed, name: 'lifecycle' | 'criticality', value: string): Promise<string[]> {
  const rows = await runner.query(`SELECT sequential_id AS ref FROM applications WHERE tenant_id = $1 AND ${name} = $2 ORDER BY sequential_id`, [seed.tenantId, value]);
  return rows.map((row: { ref: string }) => row.ref);
}

async function testFilterAsTheList(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'filter');
    const preview = await card(harness, ctx, { field: 'criticality', value: 'High', filters: { supplier: ['Acme'] } });
    assert.equal(preview.summary, 'Change Business criticality on 3 applications.');
    assert.equal(preview.changes[CARD].format, 'markdown');
    assert.equal(
      preview.changes[CARD].to,
      'Filter: Supplier "Acme"\n\nScope: enabled applications, retired ones left out\n\nBusiness criticality → High\n\n3 applications to change'
      + '\n\n- APP-1 Alpha\n- APP-2 Bravo\n- APP-6 Foxtrot',
    );
    assert.equal(preview.target.title, '3 applications');
    assert.equal(JSON.stringify(preview).includes(seed.apps[1]), false, 'no application uuid on the card');
    assert.equal(await column(runner, seed, 1, 'criticality'), null, 'the card writes nothing');
    // The same filter on the screen's list: the grid model its column sends, its scope.
    const listed = await harness.applications.listIds(
      { filters: { supplier_name: { filterType: 'set', values: ['Acme'] } } },
      { manager: runner.manager, tenantId: seed.tenantId },
    );
    const executed = await approve(harness, ctx, preview);
    assert.equal(executed.summary, 'Business criticality changed on 3 applications.');
    const written = await runner.query(`SELECT id::text AS id FROM applications WHERE tenant_id = $1 AND criticality = 'high'`, [seed.tenantId]);
    assert.deepEqual(written.map((row: { id: string }) => row.id).sort(), [...listed.ids].sort(), 'the applications of the screen list, no other');
    assert.deepEqual(await appsWith(runner, seed, 'criticality', 'high'), ['APP-1', 'APP-2', 'APP-6']);
    // One audit row per application, by Kad with the card's reference, the person as author.
    const audit = await runner.query(
      `SELECT record_id::text AS id, source, source_ref, user_id::text AS user_id FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'applications' AND action = 'update' AND record_id = ANY($2::uuid[])`,
      [seed.tenantId, Object.values(seed.apps)],
    );
    assert.equal(audit.length, 3, 'one audit row per changed application, no second row');
    assert.ok(audit.every((row: any) => row.source === 'ai_chat' && row.source_ref === preview.preview_id && row.user_id === seed.users.member));

    // The lifecycle named, by its name: the retired application, the disabled one still out.
    const retired = context(seed, runner, 'retired');
    const it = await card(harness, retired, { field: 'owners_it', value: ['Julie Bernard'], filters: { lifecycle: ['Retired'], supplier: ['Acme'] } });
    assert.equal(
      it.changes[CARD].to,
      'Filter: Lifecycle "Retired"; Supplier "Acme"\n\nScope: enabled applications\n\nIT owners → Julie Bernard\n\n1 application to change\n\n- APP-3 Charlie',
    );
    await approve(harness, retired, it);
    assert.deepEqual(await owners(runner, seed, 3, 'it'), [seed.users.julie]);
    const ownersAudit = await runner.query(
      `SELECT source, source_ref FROM audit_log WHERE tenant_id = $1 AND table_name = 'application_owners' AND record_id = $2`,
      [seed.tenantId, seed.apps[3]],
    );
    assert.deepEqual(ownersAudit, [{ source: 'ai_chat', source_ref: it.preview_id }], 'the owners row says by Kad too');
    console.log('  a filter reaches the applications of the screen list, audited by Kad: OK');
  });
}

async function testReferencesAndRefusals(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'rows');
    // A reference as typed (a bare number, lower case) is shown by its key.
    const preview = await card(harness, ctx, { field: 'lifecycle', value: 'deprecated', rows: ['2', 'app-5'] });
    assert.equal(preview.changes[CARD].to, 'Chosen applications: APP-2, APP-5\n\nLifecycle → Deprecated\n\n2 applications to change\n\n- APP-2 Bravo\n- APP-5 Echo');
    await approve(harness, ctx, preview);
    assert.deepEqual(await appsWith(runner, seed, 'lifecycle', 'deprecated'), ['APP-2', 'APP-5']);

    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', rows: ['APP-2', 'APP-999'] }), 'No application APP-999 in this workspace.');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', rows: ['BL-2'] }), '"BL-2" is not an application reference (APP-12).');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', filters: {} }), /^Name the applications to change/);
    // A part of the filter without a value is no criterion: never the whole list, never the retired applications.
    for (const filters of [{ lifecycle: { not: [] } }, { supplier: [] }, { supplier: '' }, { supplier: ['Acme'], lifecycle: [] }, { criticality: { not: [] } }]) {
      await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'criticality', value: 'High', filters }), /^Name the applications to change/);
    }
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', filters: { environment: ['prod'] } }),
      /^These applications filters cannot choose applications to change: environment\. Use lifecycle, criticality, cyber_criticality/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', filters: { criticality: ['Ultra'] } }),
      /^"Ultra" is not a value of the applications filter criticality\. It takes: Critical \(business_critical\), High \(high\)/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', filters: { external_facing: ['maybe'] } }),
      /^These applications filters cannot be used: external_facing \(takes true, false\)/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', filters: { supplier: { not: ['Acme'] } } }),
      /^These applications filters cannot be used: supplier\./);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', rows: ['APP-1'], filters: { supplier: ['Acme'] } }), /rows|filters/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: null, rows: ['APP-1'] }), 'The lifecycle of an application cannot be emptied.');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'Sunset', rows: ['APP-1'] }), /^"Sunset" is not a lifecycle state of this workspace\. The states: Proposed \(proposed\), Active \(active\)/);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'criticality', value: ['high', 'low'], rows: ['APP-1'] }), 'criticality takes one value.');
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'active', rows: ['APP-1'] }), /^Nothing to change/);
    await rejects(() => harness.tools.execute(ctx, 'prepare_mutation_plan', {
      operations: [{ operation_id: 'bulk', tool_name: TOOL, input: { field: 'lifecycle', value: 'retired', rows: ['APP-1'] } }],
    }), /cannot be part of a mutation plan/);
    console.log('  references, refusals in words, never a plan step: OK');
  });
}

/** The category is the workspace's catalog: taken by its name, a translated name or its code; the card names it. */
async function testCategoryAsACatalog(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    await runner.query(
      `UPDATE tenants SET metadata = metadata || jsonb_build_object('it_ops', jsonb_build_object('application_categories', $2::jsonb)) WHERE id = $1`,
      [seed.tenantId, JSON.stringify([
        { code: 'line_of_business', label: 'Line of business', translations: { fr: { label: 'Métier' } } },
        { code: 'security', label: 'Security' },
      ])],
    );
    // A new application is line_of_business by default: all Security, then two of line of business.
    await runner.query(`UPDATE applications SET category = 'security' WHERE tenant_id = $1`, [seed.tenantId]);
    await runner.query(`UPDATE applications SET category = 'line_of_business' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [seed.tenantId, [seed.apps[1], seed.apps[2]]]);
    const ctx = context(seed, runner, 'category');
    for (const value of ['Line of business', 'Métier', 'line_of_business']) {
      const preview = await card(harness, ctx, { field: 'criticality', value: 'High', filters: { category: [value] } });
      assert.equal(
        preview.changes[CARD].to,
        'Filter: Category "Line of business"\n\nScope: enabled applications, retired ones left out\n\nBusiness criticality → High\n\n2 applications to change\n\n- APP-1 Alpha\n- APP-2 Bravo',
        `the category given as ${value}`,
      );
    }
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'criticality', value: 'High', filters: { category: ['Nope'] } }),
      /^"Nope" is not a value of the applications filter category\. It takes: Line of business \(line_of_business\), Security \(security\), or null \(not set\)\.$/);
    console.log('  the category is a catalog, by name, translated name or code: OK');
  });
}

async function testEveryField(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'fields');
    const run = async (input: Record<string, unknown>) => approve(harness, ctx, await card(harness, ctx, input));
    // Business owners: the people given replace the role's; the IT owners stay.
    const business = await card(harness, ctx, { field: 'owners_business', value: ['Julie Bernard', 'marc petit'], rows: ['APP-1'] });
    assert.match(business.changes[CARD].to, /\n\nBusiness owners → Julie Bernard, Marc Petit\n\n1 application to change/);
    await approve(harness, ctx, business);
    assert.deepEqual(await owners(runner, seed, 1, 'business'), [seed.users.julie, seed.users.marc].sort());
    assert.deepEqual(await owners(runner, seed, 1, 'it'), [seed.users.marc], 'the other role keeps its people');
    // An empty list leaves the role with nobody.
    const emptied = await card(harness, ctx, { field: 'owners_business', value: [], rows: ['APP-1'] });
    assert.match(emptied.changes[CARD].to, /\n\nBusiness owners → Empty\n\n/);
    await approve(harness, ctx, emptied);
    assert.deepEqual(await owners(runner, seed, 1, 'business'), []);
    await run({ field: 'owners_it', value: null, rows: ['APP-1'] });
    assert.deepEqual(await owners(runner, seed, 1, 'it'), []);
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'owners_it', value: ['Nobody Here'], rows: ['APP-1'] }), 'No person found matching "Nobody Here".');
    // The lifecycle by its code; the business criticality by its name, then emptied.
    await run({ field: 'lifecycle', value: 'proposed', rows: ['APP-1'] });
    assert.equal(await column(runner, seed, 1, 'lifecycle'), 'proposed');
    await run({ field: 'criticality', value: 'moderate', rows: ['APP-1'] });
    assert.equal(await column(runner, seed, 1, 'criticality'), 'medium');
    const cleared = await card(harness, ctx, { field: 'criticality', value: null, rows: ['APP-1', 'APP-2'] });
    assert.match(cleared.changes[CARD].to, /\n\nBusiness criticality → Empty\n\n2 applications to change/);
    await approve(harness, ctx, cleared);
    assert.equal(await column(runner, seed, 2, 'criticality'), null);
    // A level no longer offered is never newly assigned.
    await runner.query(
      `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('it_ops', jsonb_build_object('business_criticality_levels', $2::jsonb)) WHERE id = $1`,
      [seed.tenantId, JSON.stringify([
        { code: 'business_critical', label: 'Critical', description: 'd', rank: 4, maxMtdMinutes: 240 },
        { code: 'high', label: 'High', description: 'd', rank: 3, maxMtdMinutes: 1440, deprecated: true },
        { code: 'medium', label: 'Moderate', description: 'd', rank: 2, maxMtdMinutes: 4320 },
        { code: 'low', label: 'Low', description: 'd', rank: 1, maxMtdMinutes: null },
      ])],
    );
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'criticality', value: 'High', rows: ['APP-1'] }),
      /^"High" is not a business criticality level offered in this workspace\. The levels: Critical \(business_critical\), Moderate \(medium\), Low \(low\)\.$/);
    console.log('  every field: owners replaced or emptied, lifecycle, criticality set and emptied: OK');
  });
}

async function testCapAndListChanged(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'cap');
    await runner.query(
      `INSERT INTO applications (tenant_id, name, supplier_id, lifecycle)
       SELECT $1, 'Mass ' || n, $2, 'active' FROM generate_series(1, 5001) AS n`,
      [seed.tenantId, seed.suppliers.beta],
    );
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'deprecated', filters: { supplier: ['Beta'] } }),
      'These filters reach 5002 rows, more than 5000 at once: narrow them.');

    // The list changes between the card and its approval: an application leaves the filter.
    const changed = context(seed, runner, 'changed');
    const preview = await card(harness, changed, { field: 'criticality', value: 'low', filters: { supplier: ['Acme'] } });
    await runner.query(`UPDATE applications SET supplier_id = $2 WHERE tenant_id = $1 AND id = $3`, [seed.tenantId, seed.suppliers.beta, seed.apps[6]]);
    const failed = await harness.previews.executePreview(changed, preview.preview_id) as any;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_message, LIST_CHANGED);
    assert.deepEqual(await appsWith(runner, seed, 'criticality', 'low'), ['APP-2'], 'nothing written');
    console.log('  more than 5,000 applications and a list that changed are refused: OK');
  });
}

async function testRightsContributorAndSubscription(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const offered = async (ctx: any) => (await harness.tools.listAvailableTools(ctx) as Array<{ name: string }>).some((tool) => tool.name === TOOL);
    const readerCtx = context(seed, runner, 'reader', seed.users.reader);
    assert.equal(await offered(readerCtx), false, 'an IT Landscape Reader is not offered the tool');
    await rejects(() => harness.tools.execute(readerCtx, TOOL, { field: 'lifecycle', value: 'retired', rows: ['APP-1'] }), 'AI tool is not available.');
    const contributorCtx = context(seed, runner, 'contributor', seed.users.contributor);
    assert.equal(await offered(contributorCtx), false, 'the shipped Business Contributor is not offered the tool');

    // The Business Contributor raised to member: its own applications only, the others neither
    // counted, named nor changed.
    await runner.query(`UPDATE role_permissions SET level = 'member' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'applications'`, [seed.tenantId, seed.roles.contributor]);
    assert.equal(await offered(contributorCtx), true, 'a Business Contributor raised to member is');
    await ensureConversation(contributorCtx);
    const own = await card(harness, contributorCtx, { field: 'criticality', value: 'Critical', filters: { lifecycle: ['Active'] } });
    assert.equal(
      own.changes[CARD].to,
      'Filter: Lifecycle "Active"\n\nScope: enabled applications\n\nBusiness criticality → Critical\n\n2 applications to change\n\n- APP-1 Alpha\n- APP-5 Echo',
    );
    assert.equal(JSON.stringify(own).includes('Bravo'), false, 'an application outside the scope is never named');
    await rejects(() => harness.tools.execute(contributorCtx, TOOL, { field: 'criticality', value: 'Critical', rows: ['APP-2'] }), 'No application APP-2 in this workspace.');
    await approve(harness, contributorCtx, own);
    assert.deepEqual(await appsWith(runner, seed, 'criticality', 'business_critical'), ['APP-1', 'APP-5']);
    assert.equal(await column(runner, seed, 2, 'criticality'), 'low', 'an application outside the scope is left as it is');
    // The approval passed the scope too: without it, the filter reaches APP-2 and the list changed.

    const ctx = context(seed, runner, 'rights');
    // The right withdrawn before the approval.
    const preview = await card(harness, ctx, { field: 'lifecycle', value: 'retired', rows: ['APP-6'] });
    await runner.query(`UPDATE role_permissions SET level = 'reader' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'applications'`, [seed.tenantId, seed.roles.member]);
    await rejects(() => harness.previews.executePreview(ctx, preview.preview_id), /applications/i);
    assert.equal(await column(runner, seed, 6, 'lifecycle'), 'proposed', 'the refused approval wrote nothing');
    await runner.query(`UPDATE role_permissions SET level = 'member' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'applications'`, [seed.tenantId, seed.roles.member]);

    // A frozen subscription (cloud billing configured, past due beyond its grace): the real check.
    const pending = await card(harness, ctx, { field: 'lifecycle', value: 'retired', rows: ['APP-6'] });
    await runner.query(
      `INSERT INTO subscriptions (tenant_id, status, stripe_subscription_id, stripe_customer_id, plan_name, seat_limit, active_seats,
                                  collection_method, latest_invoice_status, latest_invoice_created)
       VALUES ($1, 'past_due', $2, $3, 'Kadratis Cloud', NULL, 1, 'charge_automatically', 'open', now() - interval '60 days')`,
      [seed.tenantId, `sub_${seed.tenantId.slice(0, 8)}`, `cus_${seed.tenantId.slice(0, 8)}`],
    );
    const stripe = harness.policy.stripeConfig;
    const configured = stripe.isConfigured;
    stripe.isConfigured = () => true;
    try {
      const refusal = (error: any) => error?.getResponse?.()?.error === 'SUBSCRIPTION_FROZEN';
      await assert.rejects(harness.tools.execute(ctx, TOOL, { field: 'lifecycle', value: 'retired', rows: ['APP-2'] }), refusal);
      await assert.rejects(harness.previews.executePreview(ctx, pending.preview_id), refusal);
    } finally {
      stripe.isConfigured = configured;
    }
    assert.equal(await column(runner, seed, 6, 'lifecycle'), 'proposed', 'nothing written while frozen');
    console.log('  reader, shipped and raised Business Contributor, right withdrawn, frozen subscription: OK');
  });
}

/**
 * One step of the chat in its own transaction, committed, as each tool call and each approval
 * runs (`AiTenantExecutionService.runWithContext`). A refused step is rolled back.
 */
async function step<T>(harness: Harness, seed: Seed, label: string, fn: (ctx: any) => Promise<T>): Promise<T> {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await setTenant(runner, seed.tenantId);
    const ctx = context(seed, runner, label);
    await ensureConversation(ctx);
    const result = await fn(ctx);
    await runner.commitTransaction();
    return result;
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

/** An application held by another transaction. The rows are committed (a tenant deleted after) so another connection holds it. */
async function testHeldApplication(harness: Harness) {
  const seeding = harness.dataSource.createQueryRunner();
  await seeding.connect();
  await seeding.startTransaction();
  const seed = await seedGraph(seeding);
  await seeding.commitTransaction();
  await seeding.release();
  const saved = { ...harness.timeouts };
  const other = harness.dataSource.createQueryRunner();
  await other.connect();
  try {
    harness.timeouts.lockTimeoutMs = 300;
    const first = await step(harness, seed, 'held', (ctx) => card(harness, ctx, { field: 'criticality', value: 'low', rows: ['APP-1'] }));
    await other.startTransaction();
    await setTenant(other, seed.tenantId);
    await other.query(`SELECT id FROM applications WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [seed.tenantId, seed.apps[1]]);
    const started = Date.now();
    await rejects(() => step(harness, seed, 'held', (ctx) => harness.tools.execute(ctx, TOOL, { field: 'criticality', value: 'high', rows: ['APP-1'] })),
      /busy|lock/i);
    const held = await step(harness, seed, 'held', (ctx) => harness.previews.executePreview(ctx, first.preview_id)) as any;
    assert.ok(Date.now() - started < 10_000, 'the turn gives up after the bounded wait');
    assert.equal(held.status, 'pending', 'the card stays to approve');
    assert.equal(held.error_message, DATA_BUSY_CARD);
    await other.rollbackTransaction();
    await step(harness, seed, 'held', (ctx) => approve(harness, ctx, first));
    const [row] = await step<Array<{ criticality: string | null }>>(harness, seed, 'read', (ctx) => ctx.manager.query(`SELECT criticality FROM applications WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.apps[1]]));
    assert.equal(row.criticality, 'low');
    console.log('  an application held elsewhere: the bounded wait, the card stays to approve: OK');
  } finally {
    Object.assign(harness.timeouts, saved);
    if (other.isTransactionActive) await other.rollbackTransaction();
    await other.release();
    await dropTenant(harness, seed.tenantId);
  }
}

/** Deletes a committed test tenant: every table with a tenant_id, in passes until the keys allow it. */
async function dropTenant(harness: Harness, tenantId: string) {
  const tables: string[] = (await harness.dataSource.query(
    `SELECT c.relname AS name FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND c.relname <> 'tenants'`,
  )).map((row: { name: string }) => row.name);
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await setTenant(runner, tenantId);
    let left = tables;
    for (let pass = 0; pass < 8 && left.length > 0; pass++) {
      const failed: string[] = [];
      for (const table of left) {
        await runner.query('SAVEPOINT drop_tenant');
        try {
          await runner.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [tenantId]);
          await runner.query('RELEASE SAVEPOINT drop_tenant');
        } catch {
          await runner.query('ROLLBACK TO SAVEPOINT drop_tenant');
          failed.push(table);
        }
      }
      left = failed;
    }
    await runner.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  const harness = await createHarness();
  try {
    await testFilterAsTheList(harness);
    await testReferencesAndRefusals(harness);
    await testCategoryAsACatalog(harness);
    await testEveryField(harness);
    await testCapAndListChanged(harness);
    await testRightsContributorAndSubscription(harness);
    await testHeldApplication(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-application-bulk-edit.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
