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
// - Lot K2e of 26.12.1: the card lists each application it changes (up to 200) with its value
//   before; a box leaves one out (the card recounted and replaced, the exclusion signed by the
//   approval), ticked again, all left out refused; refusals of the route; the list never reaches the model.

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

/** The card's list as the screen gets it: reference, name, value before, kept. */
function listed(preview: any): Array<[string, string, string, boolean]> {
  assert.ok(preview.bulk_edit, 'the card lists its applications');
  return preview.bulk_edit.rows.map((row: any) => [row.ref, row.title, row.before, row.kept]);
}

async function column(runner: QueryRunner, seed: Seed, n: number, name: 'lifecycle' | 'criticality' | 'category' | 'cyber_criticality' | 'classification_revision'): Promise<string | null> {
  const [row] = await runner.query(`SELECT ${name}::text AS v FROM applications WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.apps[n]]);
  return row?.v ?? null;
}

async function owners(runner: QueryRunner, seed: Seed, n: number, type: 'business' | 'it'): Promise<string[]> {
  const rows = await runner.query(
    `SELECT user_id::text AS id FROM application_owners WHERE tenant_id = $1 AND application_id = $2 AND owner_type = $3`, [seed.tenantId, seed.apps[n], type]);
  return rows.map((row: { id: string }) => row.id).sort();
}

async function appsWith(runner: QueryRunner, seed: Seed, name: 'lifecycle' | 'criticality' | 'category' | 'cyber_criticality', value: string): Promise<string[]> {
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
      'Filter: Supplier "Acme"\n\nScope: enabled applications, retired ones left out\n\nBusiness criticality → High\n\n3 applications to change',
    );
    // The card lists each application it changes, with its value before (lot K2e of 26.12.1).
    assert.deepEqual(listed(preview), [['APP-1', 'Alpha', 'Empty', true], ['APP-2', 'Bravo', 'Low', true], ['APP-6', 'Foxtrot', 'Empty', true]]);
    assert.deepEqual([preview.bulk_edit.field, preview.bulk_edit.after, preview.bulk_edit.kept, preview.bulk_edit.excluded], ['Business criticality', 'High', 3, 0]);
    assert.equal(preview.target.title, '3 applications');
    // The ids are the boxes' only (the list the model never reads): none elsewhere on the card.
    assert.equal(JSON.stringify({ ...preview, bulk_edit: null }).includes(seed.apps[1]), false, 'no application uuid on the card');
    assert.equal(await column(runner, seed, 1, 'criticality'), null, 'the card writes nothing');
    // The same filter on the screen's list: the grid model its column sends, its scope.
    const screen = await harness.applications.listIds(
      { filters: { supplier_name: { filterType: 'set', values: ['Acme'] } } },
      { manager: runner.manager, tenantId: seed.tenantId },
    );
    const executed = await approve(harness, ctx, preview);
    assert.equal(executed.summary, 'Business criticality changed on 3 applications.');
    const written = await runner.query(`SELECT id::text AS id FROM applications WHERE tenant_id = $1 AND criticality = 'high'`, [seed.tenantId]);
    assert.deepEqual(written.map((row: { id: string }) => row.id).sort(), [...screen.ids].sort(), 'the applications of the screen list, no other');
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
      'Filter: Lifecycle "Retired"; Supplier "Acme"\n\nScope: enabled applications\n\nIT owners → Julie Bernard\n\n1 application to change',
    );
    assert.deepEqual(listed(it), [['APP-3', 'Charlie', 'Empty', true]]);
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
    assert.equal(preview.changes[CARD].to, 'Chosen applications: APP-2, APP-5\n\nLifecycle → Deprecated\n\n2 applications to change');
    assert.deepEqual(listed(preview), [['APP-2', 'Bravo', 'Active', true], ['APP-5', 'Echo', 'Active', true]]);
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
        'Filter: Category "Line of business"\n\nScope: enabled applications, retired ones left out\n\nBusiness criticality → High\n\n2 applications to change',
        `the category given as ${value}`,
      );
    }
    await rejects(() => harness.tools.execute(ctx, TOOL, { field: 'criticality', value: 'High', filters: { category: ['Nope'] } }),
      /^"Nope" is not a value of the applications filter category\. It takes: Line of business \(line_of_business\), Security \(security\), or null \(not set\)\.$/);
    console.log('  the category is a catalog, by name, translated name or code: OK');
  });
}

/**
 * The card names a catalog value as the screen shows it in the person's language: the shipped name
 * of a value the workspace keeps as shipped, the workspace's own name for a value it created. The
 * tool's result, which the model reads, carries those names and no code. A shipped value is also
 * taken by the name the screen shows for it.
 */
async function testCatalogWordsInThePersonsLanguage(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    await runner.query(
      `UPDATE tenants SET metadata = metadata || jsonb_build_object('it_ops', jsonb_build_object('application_categories', $2::jsonb)) WHERE id = $1`,
      [seed.tenantId, JSON.stringify([
        { code: 'line_of_business', label: 'Line-of-business' },
        { code: 'atelier', label: 'Atelier' },
      ])],
    );
    await runner.query(`UPDATE applications SET category = 'atelier' WHERE tenant_id = $1`, [seed.tenantId]);
    await runner.query(`UPDATE applications SET category = 'line_of_business' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.apps[1]]);
    // In French, the values as the French screen names them; in German, their codes; in English, the shown names.
    const cases = [
      ['fr', 'Filtre : Catégorie « Métier », « Atelier »\n\nPérimètre : applications activées, hors retirées\n\nCriticité business → Élevée\n\n4 applications à modifier'],
      ['de', 'Filter: Kategorie „Fachanwendung“, „Atelier“\n\nUmfang: aktivierte Anwendungen, ohne ausgemusterte\n\nGeschäftskritikalität → Hoch\n\n4 Anwendungen zu ändern'],
      ['en', 'Filter: Category "Line of business", "Atelier"\n\nScope: enabled applications, retired ones left out\n\nBusiness criticality → High\n\n4 applications to change'],
    ] as const;
    const inputs = {
      fr: { value: 'Élevée', category: ['Métier', 'Atelier'] },
      de: { value: 'high', category: ['line_of_business', 'atelier'] },
      en: { value: 'High', category: ['Line of business', 'Atelier'] },
    };
    for (const [language, expected] of cases) {
      await runner.query(`UPDATE users SET locale = $3 WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.users.member, language]);
      const preview = await card(harness, context(seed, runner, `catalog-${language}`), { field: 'criticality', value: inputs[language].value, filters: { category: inputs[language].category } });
      assert.equal(preview.changes[CARD].to.split('\n\n- ')[0], expected, `the card in ${language}`);
      const result = JSON.stringify(preview);
      for (const code of ['line_of_business', 'Line-of-business', '"high"']) assert.equal(result.includes(code), false, `${language}: no ${code} in the tool's result`);
    }
    console.log('  catalog values named as the screen does, in the person\'s language: OK');
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

/**
 * The category and the cyber criticality (decision D15 of 26.11.9): "move these four applications
 * from Analytics to Infrastructure" gives one card, named as the screen does in the person's
 * language; the approval changes the four, each audited by Kad. The cyber criticality the same way,
 * with its classification revision, and emptied. A value no longer offered is refused, by its code too.
 */
async function testCategoryAndCyberCriticality(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    // The shipped categories: four enabled applications in Analytics, the retired one too (left out by the scope).
    await runner.query(`UPDATE applications SET category = 'analytics' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [seed.tenantId, [seed.apps[1], seed.apps[2], seed.apps[3], seed.apps[5], seed.apps[6]]]);
    await runner.query(`UPDATE users SET locale = 'fr' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.users.member]);
    const ctx = context(seed, runner, 'category-cyber');
    const preview = await card(harness, ctx, { field: 'category', value: 'Infrastructure', filters: { category: ['Analytique'] } });
    assert.equal(
      preview.changes[CARD].to.split('\n\n- ')[0],
      'Filtre : Catégorie « Analytique »\n\nPérimètre : applications activées, hors retirées\n\nCatégorie → Infrastructure\n\n4 applications à modifier',
    );
    const executed = await approve(harness, ctx, preview);
    assert.equal(executed.status, 'executed');
    assert.deepEqual(await appsWith(runner, seed, 'category', 'infrastructure'), ['APP-1', 'APP-2', 'APP-5', 'APP-6']);
    assert.equal(await column(runner, seed, 3, 'category'), 'analytics', 'the retired application is out of the scope');
    const audit = await runner.query(
      `SELECT before_json->>'category' AS before, after_json->>'category' AS after, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'applications' AND action = 'update' AND record_id = ANY($2::uuid[])`,
      [seed.tenantId, Object.values(seed.apps)],
    );
    assert.equal(audit.length, 4, 'one audit row per application');
    assert.ok(audit.every((row: any) => row.before === 'analytics' && row.after === 'infrastructure' && row.source === 'ai_chat' && row.source_ref === preview.preview_id), 'each history says by Kad');

    // The cyber criticality by its French name, then emptied.
    const revision = Number(await column(runner, seed, 1, 'classification_revision'));
    const cyber = await card(harness, ctx, { field: 'cyber_criticality', value: 'Élevée', rows: ['APP-1', 'APP-2', 'APP-5', 'APP-6'] });
    assert.match(cyber.changes[CARD].to, /\n\nCriticité cyber → Élevée\n\n4 applications à modifier/);
    await approve(harness, ctx, cyber);
    assert.deepEqual(await appsWith(runner, seed, 'cyber_criticality', 'high'), ['APP-1', 'APP-2', 'APP-5', 'APP-6']);
    assert.equal(Number(await column(runner, seed, 1, 'classification_revision')), revision + 1, 'the classification review is due again');
    const cyberAudit = await runner.query(
      `SELECT source_ref FROM audit_log WHERE tenant_id = $1 AND table_name = 'applications' AND after_json->>'cyber_criticality' = 'high'`, [seed.tenantId]);
    assert.equal(cyberAudit.length, 4);
    assert.ok(cyberAudit.every((row: any) => row.source_ref === cyber.preview_id), 'by Kad');
    await runner.query(`UPDATE users SET locale = 'en' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.users.member]);
    const english = context(seed, runner, 'category-cyber-en');
    const cleared = await card(harness, english, { field: 'cyber_criticality', value: null, rows: ['APP-1'] });
    assert.match(cleared.changes[CARD].to, /\n\nCyber criticality → Empty\n\n1 application to change/);
    assert.equal(cleared.summary, 'Change Cyber criticality on 1 application.');
    await approve(harness, english, cleared);
    assert.equal(await column(runner, seed, 1, 'cyber_criticality'), null);

    // Never empty; a category or a level no longer offered is refused, by its name or its code.
    await rejects(() => harness.tools.execute(english, TOOL, { field: 'category', value: null, rows: ['APP-1'] }), 'The category of an application cannot be emptied.');
    await runner.query(
      `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('it_ops', jsonb_build_object('application_categories', $2::jsonb, 'cyber_criticality_levels', $3::jsonb)) WHERE id = $1`,
      [seed.tenantId,
        JSON.stringify([{ code: 'infrastructure', label: 'Infrastructure' }, { code: 'atelier', label: 'Atelier' }, { code: 'analytics', label: 'Analytics', deprecated: true }]),
        JSON.stringify([{ code: 'high', label: 'High', rank: 2 }, { code: 'legacy', label: 'Legacy', rank: 1, deprecated: true }])],
    );
    for (const value of ['analytics', 'Analytics']) {
      await rejects(() => harness.tools.execute(english, TOOL, { field: 'category', value, rows: ['APP-1'] }),
        `"${value}" is not a category offered in this workspace. The categories: Infrastructure (infrastructure), Atelier (atelier).`);
    }
    await rejects(() => harness.tools.execute(english, TOOL, { field: 'cyber_criticality', value: 'legacy', rows: ['APP-1'] }),
      '"legacy" is not a cyber criticality level offered in this workspace. The levels: High (high).');
    // A category the workspace created keeps its name on the card.
    const own = await card(harness, english, { field: 'category', value: 'atelier', rows: ['APP-1'] });
    assert.match(own.changes[CARD].to, /\n\nCategory → Atelier\n\n1 application to change/);
    console.log('  the category and the cyber criticality: one card, by Kad, values no longer offered refused: OK');
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
      'Filter: Lifecycle "Active"\n\nScope: enabled applications\n\nBusiness criticality → Critical\n\n2 applications to change',
    );
    assert.deepEqual(listed(own), [['APP-1', 'Alpha', 'Empty', true], ['APP-5', 'Echo', 'Empty', true]], 'its own applications only');
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

/** The route of the card's boxes (lot K2e of 26.12.1), as the screen calls it: the whole list of the ids left out. */
async function exclude(harness: Harness, ctx: any, preview: any, excluded: unknown, userId = ctx.userId, conversationId = ctx.conversationId) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const controller = harness.app.get(AiImportFileController);
  return controller.exclude(conversationId, preview.preview_id, { excluded }, { user: { sub: userId }, headers: {} }, { tenantId: ctx.tenantId, manager: ctx.manager }) as Promise<any>;
}

async function previewRow(runner: QueryRunner, seed: Seed, id: string) {
  const [row] = await runner.query(
    `SELECT id::text AS id, tool_name, status, mutation_input, current_values, error_message FROM ai_mutation_previews WHERE tenant_id = $1 AND id = $2`,
    [seed.tenantId, id],
  );
  return row;
}

async function httpStatus(fn: () => Promise<unknown>, status: number, pattern?: RegExp) {
  const thrown = await rejects(fn, pattern ?? /./);
  assert.equal(thrown?.getStatus?.(), status, `expected a ${status}, got ${thrown?.getStatus?.()}: ${thrown?.message}`);
}

/**
 * The card lists each application it changes (lot K2e of 26.12.1): a box leaves one out, the card is
 * recounted and replaced, the application stays listed unticked and can be ticked again; the
 * approval signs the applications left out and writes only those kept; the list stays on the card,
 * each application changed marked.
 */
async function testLeaveOutAndApprove(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'leave-out');
    const first = await card(harness, ctx, { field: 'criticality', value: 'High', rows: ['APP-1', 'APP-2', 'APP-6'] });
    const second = await exclude(harness, ctx, first, [seed.apps[2].toUpperCase()]);
    assert.equal(second.status, 'pending');
    assert.notEqual(second.preview_id, first.preview_id, 'a new card');
    assert.equal(second.replaces_preview_id, first.preview_id, 'it replaces the first one');
    assert.equal((await previewRow(runner, seed, first.preview_id)).status, 'expired', 'the first card can no longer be approved');
    assert.deepEqual(listed(second), [['APP-1', 'Alpha', 'Empty', true], ['APP-2', 'Bravo', 'Low', false], ['APP-6', 'Foxtrot', 'Empty', true]]);
    assert.deepEqual([second.bulk_edit.kept, second.bulk_edit.excluded], [2, 1]);
    assert.equal(second.changes[CARD].to, 'Chosen applications: APP-1, APP-2, APP-6\n\nBusiness criticality → High\n\n2 applications to change, 1 left out');
    assert.equal(second.summary, 'Change Business criticality on 2 applications.');
    assert.deepEqual((await previewRow(runner, seed, second.preview_id)).mutation_input.excluded, [seed.apps[2]], 'the card stores the application left out');

    // What the approval signs: the hash of the card's input holds the applications left out.
    const { AiActionRequestService } = require('../control-plane/action-request/ai-action-request.service');
    const actions = harness.app.get(AiActionRequestService);
    const stored = await previewRow(runner, seed, second.preview_id);
    const { excluded: _left, ...without } = stored.mutation_input;
    assert.notEqual(actions.inputHashForPreview(stored), actions.inputHashForPreview({ ...stored, mutation_input: without }), 'removing the exclusion changes the hash');
    assert.notEqual(
      actions.inputHashForPreview(stored),
      actions.inputHashForPreview({ ...stored, mutation_input: { ...stored.mutation_input, excluded: [seed.apps[1], seed.apps[2]].sort() } }),
      'adding one changes it too',
    );

    // Ticked again: the whole list kept, the chain's root still the first card.
    const third = await exclude(harness, ctx, second, []);
    assert.equal(third.replaces_preview_id, first.preview_id);
    assert.deepEqual(listed(third).map((row) => row[3]), [true, true, true]);
    assert.equal(third.changes[CARD].to, 'Chosen applications: APP-1, APP-2, APP-6\n\nBusiness criticality → High\n\n3 applications to change');
    assert.equal((await previewRow(runner, seed, third.preview_id)).mutation_input.excluded, undefined);
    const fourth = await exclude(harness, ctx, third, [seed.apps[2]]);

    // The approval goes through the durable approval: the action signs the hash of the card with its exclusion.
    const { AiApprovalService } = require('../control-plane/approval/ai-approval.service');
    const { action } = await harness.app.get(AiApprovalService).approvePreviewFromChat(ctx, fourth.preview_id);
    assert.equal(action.input_hash, actions.inputHashForPreview(await previewRow(runner, seed, fourth.preview_id)));
    const executed = await approve(harness, ctx, fourth);
    assert.equal(executed.summary, 'Business criticality changed on 2 applications.');
    assert.deepEqual(await appsWith(runner, seed, 'criticality', 'high'), ['APP-1', 'APP-6'], 'the kept applications only');
    assert.equal(await column(runner, seed, 2, 'criticality'), 'low', 'the application left out is left as it is');
    const audit = await runner.query(
      `SELECT record_id::text AS id, source_ref FROM audit_log WHERE tenant_id = $1 AND table_name = 'applications' AND action = 'update' AND record_id = ANY($2::uuid[])`,
      [seed.tenantId, Object.values(seed.apps)],
    );
    assert.deepEqual(audit.map((row: any) => row.id).sort(), [seed.apps[1], seed.apps[6]].sort(), 'audited: the kept applications only');
    assert.ok(audit.every((row: any) => row.source_ref === fourth.preview_id));
    assert.deepEqual(executed.bulk_edit.rows.map((row: any) => [row.ref, row.kept, row.changed]), [['APP-1', true, true], ['APP-2', false, false], ['APP-6', true, true]]);

    // An approved, replaced or expired card is no longer changed; neither is another person's, nor one of another conversation.
    await httpStatus(() => exclude(harness, ctx, fourth, []), 409, /no longer be changed/);
    await httpStatus(() => exclude(harness, ctx, first, []), 409, /no longer be changed/);
    const replaced = await harness.previews.executePreview(ctx, first.preview_id) as any;
    assert.equal(replaced.status, 'expired', 'the replaced card is not approved');
    console.log('  a box leaves an application out, ticked again, the approval writes the kept ones only: OK');
  });
}

/** Refusals of the boxes: every application left out, an id the card does not list, someone else's card, an expired one. */
async function testLeaveOutRefusals(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'leave-out-refusals');
    const preview = await card(harness, ctx, { field: 'lifecycle', value: 'deprecated', rows: ['APP-1', 'APP-2'] });
    // Every application left out: listed unticked, the approval refused, the card stays pending.
    const none = await exclude(harness, ctx, preview, [seed.apps[1], seed.apps[2]]);
    assert.deepEqual(listed(none), [['APP-1', 'Alpha', 'Active', false], ['APP-2', 'Bravo', 'Active', false]]);
    assert.equal(none.changes[CARD].to, 'Chosen applications: APP-1, APP-2\n\nLifecycle → Deprecated\n\n0 applications to change, 2 left out');
    // The card says why it cannot be approved before any approval: the screen greys Approve out.
    assert.equal(none.error_message, 'Every record of this card is left out: there is nothing to approve.');
    const refused = await harness.previews.executePreview(ctx, none.preview_id) as any;
    assert.equal(refused.status, 'pending');
    assert.equal(refused.error_message, 'Every record of this card is left out: there is nothing to approve.');
    assert.deepEqual(await appsWith(runner, seed, 'lifecycle', 'deprecated'), [], 'nothing written');
    await runner.query(`UPDATE users SET locale = 'fr' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.users.member]);
    // The person's language is read once per context (one request): a new request reads French.
    const french = await harness.previews.executePreview({ ...ctx }, none.preview_id) as any;
    assert.equal(french.error_message, "Toutes les fiches de cette carte sont écartées : il n'y a rien à approuver.");
    await runner.query(`UPDATE users SET locale = 'en' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.users.member]);
    // One ticked again: approvable.
    const one = await exclude(harness, ctx, none, [seed.apps[2]]);
    assert.equal(one.bulk_edit.kept, 1);
    assert.equal(one.error_message, null, 'a card with a record kept says nothing of a refusal');

    await httpStatus(() => exclude(harness, ctx, one, [randomUUID()]), 400, /^Only an application this card lists can be left out\.$/);
    await httpStatus(() => exclude(harness, ctx, one, [seed.apps[5]]), 400, /^Only an application this card lists can be left out\.$/);
    await httpStatus(() => exclude(harness, ctx, one, ['APP-1']), 400, /record ids/);
    await httpStatus(() => exclude(harness, ctx, one, 'APP-1'), 400, /list of record ids/);
    await httpStatus(() => exclude(harness, ctx, one, Array.from({ length: 201 }, () => randomUUID())), 400, /At most 200/);
    // Someone else's card, or the card under another conversation: not found.
    await httpStatus(() => exclude(harness, ctx, one, [], seed.users.reader), 404);
    await httpStatus(() => exclude(harness, ctx, one, [], ctx.userId, randomUUID()), 404);
    // An expired card.
    await runner.query(`UPDATE ai_mutation_previews SET expires_at = now() - interval '1 minute' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, one.preview_id]);
    await httpStatus(() => exclude(harness, ctx, one, []), 409, /no longer be changed/);
    assert.equal((await previewRow(runner, seed, one.preview_id)).status, 'pending', 'a refused change leaves the card as it was');
    console.log('  every application left out refused, foreign id, someone else\'s card, expired card: OK');
  });
}

/**
 * A filter, its applications left out by `exclude_ids`; the list changed after the exclusion; the
 * exclusion taken off the stored card behind the approval's back: refused, nothing written.
 */
async function testLeaveOutOfAFilter(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'leave-out-filter');
    const preview = await card(harness, ctx, { field: 'criticality', value: 'Critical', filters: { supplier: ['Acme'] } });
    const kept = await exclude(harness, ctx, preview, [seed.apps[6]]);
    const stored = await previewRow(runner, seed, kept.preview_id);
    assert.equal(stored.mutation_input.selection.all, true, 'the filter stays the selection');
    assert.deepEqual(stored.mutation_input.excluded, [seed.apps[6]]);
    assert.equal(kept.changes[CARD].to, 'Filter: Supplier "Acme"\n\nScope: enabled applications, retired ones left out\n\nBusiness criticality → Critical\n\n2 applications to change, 1 left out');

    // The exclusion taken off the stored card: the approval reaches APP-6 again and refuses the list.
    const { excluded: _left, ...without } = stored.mutation_input;
    await runner.query(`UPDATE ai_mutation_previews SET mutation_input = $3::jsonb WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, kept.preview_id, JSON.stringify(without)]);
    const tampered = await harness.previews.executePreview(ctx, kept.preview_id) as any;
    assert.equal(tampered.status, 'failed');
    assert.equal(tampered.error_message, LIST_CHANGED);
    assert.deepEqual(await appsWith(runner, seed, 'criticality', 'business_critical'), [], 'nothing written');

    // The list changed between the exclusion and the approval: an application leaves the filter.
    const again = await exclude(harness, ctx, await card(harness, ctx, { field: 'criticality', value: 'Critical', filters: { supplier: ['Acme'] } }), [seed.apps[6]]);
    await runner.query(`UPDATE applications SET supplier_id = $2 WHERE tenant_id = $1 AND id = $3`, [seed.tenantId, seed.suppliers.beta, seed.apps[2]]);
    const changed = await harness.previews.executePreview(ctx, again.preview_id) as any;
    assert.equal(changed.status, 'failed');
    assert.equal(changed.error_message, LIST_CHANGED);
    assert.deepEqual(await appsWith(runner, seed, 'criticality', 'business_critical'), [], 'nothing written');

    // Counted again on a fresh card: the filter's applications less the one left out.
    const fresh = await exclude(harness, ctx, await card(harness, ctx, { field: 'criticality', value: 'Critical', filters: { supplier: ['Acme'] } }), [seed.apps[6]]);
    await approve(harness, ctx, fresh);
    assert.deepEqual(await appsWith(runner, seed, 'criticality', 'business_critical'), ['APP-1']);
    console.log('  a filter less the applications left out; the list changed or the exclusion taken off: refused: OK');
  });
}

/** Up to 200 applications listed; beyond, the count and five examples, and the model is told to offer narrowing. */
async function testListUpTo200(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const gamma = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Gamma') RETURNING id`, [seed.tenantId]);
    await runner.query(
      `INSERT INTO applications (tenant_id, name, supplier_id, lifecycle) SELECT $1, 'Mass ' || n, $2, 'active' FROM generate_series(1, 200) AS n`,
      [seed.tenantId, gamma],
    );
    const ctx = context(seed, runner, 'two-hundred');
    const listedCard = await card(harness, ctx, { field: 'criticality', value: 'Low', filters: { supplier: ['Gamma'] } });
    assert.equal(listedCard.bulk_edit.rows.length, 200, '200 applications listed');
    assert.equal(listedCard.assistant_note, undefined);
    assert.ok(listedCard.changes[CARD].to.endsWith('\n\n200 applications to change'));
    await runner.query(`INSERT INTO applications (tenant_id, name, supplier_id, lifecycle) VALUES ($1, 'Mass 201', $2, 'active')`, [seed.tenantId, gamma]);
    const counted = await card(harness, ctx, { field: 'criticality', value: 'Low', filters: { supplier: ['Gamma'] } });
    assert.equal(counted.bulk_edit, undefined, '201: counted, not listed');
    assert.match(counted.changes[CARD].to, /\n\n201 applications to change\n\n- APP-\d+ Mass 1\n/);
    assert.equal((counted.changes[CARD].to.match(/\n- /g) ?? []).length, 6, 'five examples and "and n more"');
    assert.match(counted.assistant_note, /^This card changes 201 applications: more than 200, so it counts them without listing them.*narrow/);
    await httpStatus(() => exclude(harness, ctx, counted, [seed.apps[1]]), 400, /does not list its applications/);
    console.log('  200 applications listed, 201 counted with five examples and a note to narrow: OK');
  });
}

/** The list never reaches the model: the dispatcher's output, which the tool message carries, holds the counts only. */
async function testTheModelReadsNoList(harness: Harness) {
  await inSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'model-view');
    await ensureConversation(ctx);
    const { AiCapabilityDispatcherService } = require('../control-plane/dispatcher/ai-capability-dispatcher.service');
    const dispatched = await harness.app.get(AiCapabilityDispatcherService).execute(ctx, {
      capabilityName: TOOL,
      input: { field: 'criticality', value: 'High', filters: { supplier: ['Acme'] } },
      execution: { surface: 'chat', trigger_kind: 'human_user' },
    }) as any;
    const forModel = JSON.stringify(dispatched.output);
    assert.equal(dispatched.output.bulk_edit, '[REDACTED]', 'the list is taken out of the tool message');
    for (const word of ['Alpha', 'Bravo', 'Foxtrot', seed.apps[1], seed.apps[2], seed.apps[6]]) {
      assert.equal(forModel.includes(word), false, `the model never reads ${word}`);
    }
    assert.match(dispatched.output.changes[CARD].to, /3 applications to change$/, 'it reads the counts');
    assert.equal(dispatched.previews[0].bulk_edit.rows.length, 3, 'the card on the screen lists them');
    console.log('  the list goes to the screen, never to the model: OK');
  });
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
    await testCatalogWordsInThePersonsLanguage(harness);
    await testEveryField(harness);
    await testCategoryAndCyberCriticality(harness);
    await testCapAndListChanged(harness);
    await testRightsContributorAndSubscription(harness);
    await testHeldApplication(harness);
    await testLeaveOutAndApprove(harness);
    await testLeaveOutRefusals(harness);
    await testLeaveOutOfAFilter(harness);
    await testListUpTo200(harness);
    await testTheModelReadsNoList(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-application-bulk-edit.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
