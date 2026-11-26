import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';

// Lot K2c of 26.12.1: what Kad writes in a field a catalog holds, and the record it compares with.
//
// - The access methods of an application come from the tenant's catalog: a code or a name (in any
//   language the app shows) is accepted and written as its code, an unknown value is refused with
//   the list of the values allowed.
// - Rule P7: a category or a lifecycle state retired from the catalog is refused on an application
//   that does not hold it.
// - Kad reads the record as the screen reads it before the card and at the approval: an operating
//   system, a connection's protocols, an interface's middleware applications are not columns of
//   their tables, and the card used to compare with an empty value, then saw a drift and gave up.
//   Every field Kad writes on an update must be in that read (one family after the other).
// - An interface's specification is a document: an update names its own tool.

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

type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; settings: any; support: any };
type Seed = {
  tenantId: string; userId: string; appId: string; companyId: string; supplierId: string; accountId: string; locationId: string;
  sourceAppId: string; targetAppId: string; middlewareAppId: string; otherMiddlewareAppId: string; sourceAssetId: string; targetAssetId: string;
};

const PERMISSIONS: Record<string, string> = {
  ai_chat: 'member', companies: 'reader', departments: 'reader', applications: 'member', infrastructure: 'member', contracts: 'member',
  budget: 'member', portfolio_projects: 'member', portfolio_requests: 'member', incidents: 'member',
};

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
    [tenantId, `ai-catalog-${tag}`, `AI catalog ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'catalog-model', 'custom', 'catalog-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'catalog-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const roleId = await one(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Catalog member', 'Catalog member', false, false, now(), now()) RETURNING id`, [tenantId]);
  for (const [resource, level] of Object.entries(PERMISSIONS)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, roleId, resource, level]);
  }
  const userId = await one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, 'Member', 'Tester', $2, $3, false, 'enabled', 'fr', now(), now()) RETURNING id`,
    [tenantId, `member-${tag}@example.test`, roleId]);
  const chart = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, 'Chart', 'FR') RETURNING id`, [tenantId, `C${tag}`]);
  const companyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Catalog company', 'FR', 'Lyon', $2) RETURNING id`, [tenantId, chart]);
  const accountId = await one(runner, `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6100, 'Software') RETURNING id`, [tenantId, chart]);
  const supplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Catalog supplier') RETURNING id`, [tenantId]);
  const locationId = await one(runner,
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-1', 'Paris DC', 'cloud') RETURNING id`, [tenantId]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const app = (name: string) => one(runner, `INSERT INTO applications (tenant_id, name, status, lifecycle) VALUES ($1, $2, 'enabled', 'active') RETURNING id`, [tenantId, name]);
  const appId = await app('Alpha');
  const sourceAppId = await app('Orders');
  const targetAppId = await app('Billing');
  const middlewareAppId = await app('Bus One');
  const otherMiddlewareAppId = await app('Bus Two');
  const asset = (name: string) => one(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, $2, 'server', 'prod', $3) RETURNING id`, [tenantId, name, locationId]);
  const sourceAssetId = await asset('srv-orders');
  const targetAssetId = await asset('srv-billing');
  return { tenantId, userId, appId, companyId, supplierId, accountId, locationId, sourceAppId, targetAppId, middlewareAppId, otherMiddlewareAppId, sourceAssetId, targetAssetId };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-catalog-values-write.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { ItOpsSettingsService } = require('../../it-ops-settings/it-ops-settings.service');
  const { AiBusinessRecordMutationSupportService } = require('../mutation/ai-business-record-mutation-support.service');
  const { NotificationsService } = require('../../notifications/notifications.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // A project's, a request's or an incident's write notifies people: nothing is sent from this spec.
  const notifications = app.get(NotificationsService, { strict: false });
  for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(notifications))) {
    if (method.startsWith('notify')) notifications[method] = async () => undefined;
  }
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    settings: app.get(ItOpsSettingsService, { strict: false }),
    support: app.get(AiBusinessRecordMutationSupportService, { strict: false }),
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
     VALUES ($1, $2, $3, 'AI catalog values', 'custom', 'catalog-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, tool, input) as any;
  assert.equal(preview.status, 'pending', JSON.stringify(preview));
  return preview;
}

async function approve(harness: Harness, ctx: any, preview: any): Promise<string> {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'the card did not execute');
  return String(executed.target?.entity_id ?? '');
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

async function appRow(runner: QueryRunner, s: Seed) {
  const [row] = await runner.query(`SELECT category, lifecycle, access_methods FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.appId]);
  return row;
}

async function testAccessMethods(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const byCode = await card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: s.appId, fields: { access_methods: ['web'] } });
    assert.equal(byCode.changes.access_methods.to, 'web', 'the card carries the code, which the screen names');
    await approve(harness, ctx, byCode);
    // The shipped French name of `vdi`, as the person reads it.
    const byName = await card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: s.appId, fields: { access_methods: ['Web', 'VDI / bureau à distance'] } });
    assert.deepEqual({ from: byName.changes.access_methods.from, to: byName.changes.access_methods.to }, { from: 'web', to: 'web, vdi' });
    await approve(harness, ctx, byName);
    assert.deepEqual((await appRow(runner, s)).access_methods, ['web', 'vdi']);
    await refused(
      () => card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: s.appId, fields: { access_methods: ['Citrix'] } }),
      // Kad reads the values by the names the person's selector shows, without their codes (rejeu du pilote).
      /^Unknown access method "Citrix"\. Use one of: Web, Application installée localement, Application mobile, IHM propriétaire \(interface industrielle\), Terminal \/ ligne de commande, VDI \/ bureau à distance, Borne\.$/,
    );
    const created = await card(harness, ctx, 'create_business_record', { entity_type: 'applications', fields: { name: 'Zulu', access_methods: 'mobile, kiosk' } });
    assert.equal(created.changes.access_methods.to, 'mobile, kiosk');
    const zulu = await approve(harness, ctx, created);
    const [row] = await runner.query(`SELECT access_methods FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, zulu]);
    assert.deepEqual(row.access_methods, ['mobile', 'kiosk'], 'a creation writes the access methods');
  });
}

async function testRetiredValues(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const current = await harness.settings.getSettings(s.tenantId, { manager: runner.manager });
    await harness.settings.updateSettings(s.tenantId, {
      applicationCategories: [...current.applicationCategories, { code: 'mainframe', label: 'Mainframe', deprecated: true }],
      lifecycleStates: [...current.lifecycleStates, { code: 'frozen', label: 'Gelé', deprecated: true }],
      accessMethods: current.accessMethods.map((option: any) => (option.code === 'kiosk' ? { ...option, deprecated: true } : option)),
    }, { manager: runner.manager });
    for (const fields of [{ category: 'Mainframe' }, { lifecycle: 'Gelé' }, { access_methods: ['kiosk'] }]) {
      await refused(
        () => card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: s.appId, fields }),
        /retired|Valid values/,
      );
    }
    await refused(
      () => card(harness, ctx, 'create_business_record', { entity_type: 'applications', fields: { name: 'Yankee', category: 'mainframe' } }),
      /retired/,
    );
    // The application that holds them keeps them: another change goes through, and the card writes.
    await runner.query(`UPDATE applications SET category = 'mainframe', lifecycle = 'frozen', access_methods = '{kiosk}' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.appId]);
    const kept = await card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: s.appId, fields: { access_methods: ['kiosk', 'web'], version: '2' } });
    await approve(harness, ctx, kept);
    assert.deepEqual(await appRow(runner, s), { category: 'mainframe', lifecycle: 'frozen', access_methods: ['kiosk', 'web'] });
  });
}

/** An asset that has an operating system: the card shows it as "from", and the approval writes the new one. */
async function testOperatingSystem(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const server = await approve(harness, ctx, await card(harness, ctx, 'create_business_record', {
      entity_type: 'assets', fields: { name: 'srv-os', kind: 'virtual_machine', provider: 'other', environment: 'prod', location_id: s.locationId, operating_system: 'Ubuntu 24.04' },
    }));
    const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'assets', ref: server, fields: { operating_system: 'Windows Server 2022' } });
    assert.match(String(preview.changes.operating_system.from), /Ubuntu 24\.04/, 'the card reads the operating system the server has');
    await approve(harness, ctx, preview);
    const snapshot = await harness.support.getRecordSnapshot(ctx, 'assets', server);
    assert.match(String(snapshot.operating_system), /Windows Server 2022/);

    // The card shows what the server will hold, as the write resolves the text (rejeu du pilote, K2c).
    const written = async (typed: string, shown: string) => {
      const os = await card(harness, ctx, 'update_business_record', { entity_type: 'assets', ref: server, fields: { operating_system: typed } });
      assert.equal(os.changes.operating_system.to, shown, `the card of "${typed}"`);
      await approve(harness, ctx, os);
      assert.equal((await harness.support.getRecordSnapshot(ctx, 'assets', server)).operating_system, shown, `the server after "${typed}"`);
    };
    // 1. A known version: the catalog's label.
    await written('Debian 12', 'Debian 12 (Bookworm)');
    // What the server already holds, typed another way, is no change: no card, nothing written.
    await refused(
      () => card(harness, ctx, 'update_business_record', { entity_type: 'assets', ref: server, fields: { operating_system: 'Debian 12' } }),
      /already has the requested values/,
    );
    const unchanged = await card(harness, ctx, 'update_business_record', { entity_type: 'assets', ref: server, fields: { operating_system: 'debian 12', name: 'srv-os-2' } });
    assert.deepEqual(Object.keys(unchanged.changes), ['name'], 'the operating system is no line of the card');
    // 2. No known system: the write creates the technology and its version, as typed.
    await written('Zorglub OS 3', 'Zorglub OS 3');
    // 3. A name alone, several versions: the write picks none, the technology without a version.
    await written('Debian', 'Debian');
  });
}

/** A connection's protocols, and its servers: compared as the screen reads them. */
async function testConnectionProtocol(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const connection = await approve(harness, ctx, await card(harness, ctx, 'create_business_record', {
      entity_type: 'connections', fields: { name: 'Orders link', topology: 'server_to_server', source_asset_id: s.sourceAssetId, destination_asset_id: s.targetAssetId, protocol_codes: ['https'] },
    }));
    const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'connections', ref: connection, fields: { protocol_codes: ['ssh'] } });
    assert.equal(preview.changes.protocol_codes.from, 'https', 'the card reads the protocols the connection has');
    await approve(harness, ctx, preview);
    const [row] = await runner.query(`SELECT array_agg(connection_type_code) AS codes FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2`, [s.tenantId, connection]);
    assert.deepEqual(row.codes, ['ssh']);
    const snapshot = await harness.support.getRecordSnapshot(ctx, 'connections', connection);
    assert.ok(Array.isArray(snapshot.servers) && snapshot.servers.every((id: unknown) => typeof id === 'string'), 'the servers read as ids, as Kad writes them');
  });
}

/** An interface's middleware applications; its specification is a document with its own tool. */
async function testInterfaceMiddleware(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const intf = await approve(harness, ctx, await card(harness, ctx, 'create_business_record', {
      entity_type: 'interfaces',
      fields: {
        name: 'Orders to billing', business_purpose: 'Invoices', data_category: 'master_data', integration_route_type: 'via_middleware',
        source_application_id: s.sourceAppId, target_application_id: s.targetAppId, middleware_application_ids: [s.middlewareAppId],
      },
    }));
    const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'interfaces', ref: intf, fields: { middleware_application_ids: [s.otherMiddlewareAppId] } });
    assert.match(String(preview.changes.middleware_application_ids.from), new RegExp(s.middlewareAppId), 'the card reads the middleware the interface has');
    await approve(harness, ctx, preview);
    const rows = await runner.query(`SELECT application_id FROM interface_middleware_applications WHERE tenant_id = $1 AND interface_id = $2`, [s.tenantId, intf]);
    assert.deepEqual(rows.map((row: any) => row.application_id), [s.otherMiddlewareAppId]);
    await refused(
      () => card(harness, ctx, 'update_business_record', { entity_type: 'interfaces', ref: intf, fields: { specification_markdown: 'New text' } }),
      /update_document_content/,
    );
  });
}

/**
 * Lot K2c, second pass: the catalog fields of an asset, a connection and an interface take a code or
 * a name the app shows in any language, and follow rule P7; a server role too (by its code or name;
 * a retired role only on the assignment that holds it).
 */
async function testCatalogFieldsByName(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const current = await harness.settings.getSettings(s.tenantId, { manager: runner.manager });
    await harness.settings.updateSettings(s.tenantId, {
      serverKinds: [...current.serverKinds, { code: 'mainframe', label: 'Mainframe', deprecated: true }],
      connectionTypes: current.connectionTypes.map((option: any) => (option.code === 'tcp' ? { ...option, deprecated: true } : option)),
      serverRoles: current.serverRoles.map((option: any) => (option.code === 'backup' ? { ...option, deprecated: true } : option)),
    }, { manager: runner.manager });
    // An asset's type by its French name, written as its code.
    const kind = await card(harness, ctx, 'update_business_record', { entity_type: 'assets', ref: s.sourceAssetId, fields: { kind: 'Serveur physique' } });
    assert.equal(kind.changes.kind.to, 'physical_server');
    await approve(harness, ctx, kind);
    await refused(() => card(harness, ctx, 'update_business_record', { entity_type: 'assets', ref: s.sourceAssetId, fields: { kind: 'Mainframe' } }), /retired/);
    // A connection's protocol by its name; a retired one only on the connection that holds it.
    const connection = await approve(harness, ctx, await card(harness, ctx, 'create_business_record', {
      entity_type: 'connections', fields: { name: 'Names link', topology: 'server_to_server', source_asset_id: s.sourceAssetId, destination_asset_id: s.targetAssetId, protocol_codes: ['Agent Zabbix'] },
    }));
    const [protocols] = await runner.query(`SELECT array_agg(connection_type_code) AS codes FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2`, [s.tenantId, connection]);
    assert.deepEqual(protocols.codes, ['zabbix']);
    await refused(() => card(harness, ctx, 'update_business_record', { entity_type: 'connections', ref: connection, fields: { protocol_codes: ['tcp'] } }), /retired/);
    const lifecycle = await card(harness, ctx, 'update_business_record', { entity_type: 'connections', ref: connection, fields: { lifecycle: 'Obsolète' } });
    assert.equal(lifecycle.changes.lifecycle.to, 'deprecated');
    // An interface's data category by its German name.
    const intf = await approve(harness, ctx, await card(harness, ctx, 'create_business_record', {
      entity_type: 'interfaces',
      fields: { name: 'Names interface', business_purpose: 'Names', data_category: 'Transaktionsdaten', source_application_id: s.sourceAppId, target_application_id: s.targetAppId },
    }));
    const [intfRow] = await runner.query(`SELECT data_category FROM interfaces WHERE tenant_id = $1 AND id = $2`, [s.tenantId, intf]);
    assert.equal(intfRow.data_category, 'transactional');

    // Server roles: by the French name; a retired role refused on a new assignment, kept on the one that holds it.
    await runner.query(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [s.tenantId, s.appId]);
    const assign = (add: unknown[]) => card(harness, ctx, 'update_entity_relations', { entity_type: 'applications', ref: s.appId, relation: 'asset_assignments', add });
    await approve(harness, ctx, await assign([{ environment: 'prod', asset_ref: 'srv-orders', role: "Serveur d'applications" }]));
    const roles = async () => (await runner.query(
      `SELECT role FROM app_asset_assignments WHERE tenant_id = $1 ORDER BY role`, [s.tenantId])).map((row: any) => row.role);
    assert.deepEqual(await roles(), ['app']);
    // The refusal Kad reads, French profile: the names of the selector, no code, no English label.
    await refused(() => assign([{ environment: 'prod', asset_ref: 'srv-billing', role: 'backup' }]), /^The role "Serveur de sauvegarde" is retired: only a record that already holds it keeps it\. Use one of: (?!.*\(app\)|.*Application server).*Serveur d'applications/);
    await runner.query(
      `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role)
       SELECT $1, id, $3, 'backup' FROM app_instances WHERE tenant_id = $1 AND application_id = $2`, [s.tenantId, s.appId, s.targetAssetId]);
    // Named again with another row: the assignment that holds the retired role keeps it.
    await approve(harness, ctx, await assign([
      { environment: 'prod', asset_ref: 'srv-billing', role: 'backup', notes: 'kept' },
      { environment: 'prod', asset_ref: 'srv-billing', role: 'app' },
    ]));
    assert.deepEqual(await roles(), ['app', 'app', 'backup']);
    await refused(() => assign([{ environment: 'prod', asset_ref: 'srv-orders', role: 'Citrix' }]), /^(?!.*\(app\)|.*Application server)Unknown role "Citrix"\. Use one of: .*Serveur d'applications/);
  });
}

/**
 * Every field Kad writes on an update is in the read it compares with (`getRecordSnapshot`, the
 * screen's read): one record of each family, created through Kad's cards.
 */
async function testEveryWritableFieldIsRead(harness: Harness) {
  const { AI_BUSINESS_RECORD_ENTITY_TYPES, aiBusinessRecordUpdateFields } = require('../mutation/ai-business-record-mutation-support.service');
  await inSeed(harness, async (runner, s) => {
    const ctx = context(s, runner);
    const creations: Record<string, Record<string, unknown>> = {
      applications: { name: 'Keys app' },
      assets: { name: 'srv-keys', kind: 'virtual_machine', provider: 'other', environment: 'prod', location_id: s.locationId },
      contracts: { name: 'Keys contract', company_id: s.companyId, supplier_id: s.supplierId, start_date: '2026-01-01' },
      projects: { name: 'Keys project', origin: 'fast_track' },
      requests: { name: 'Keys request' },
      interfaces: { name: 'Keys interface', business_purpose: 'Keys', data_category: 'master_data', source_application_id: s.sourceAppId, target_application_id: s.targetAppId },
      connections: { name: 'Keys connection', topology: 'server_to_server', source_asset_id: s.sourceAssetId, destination_asset_id: s.targetAssetId, protocol_codes: ['https'] },
      budget_lines: { nature: 'opex', product_name: 'Keys line', paying_company_id: s.companyId, account_id: s.accountId, currency: 'EUR', effective_start: '2026-01-01' },
      incidents: { title: 'Keys incident', severity: 'minor' },
      technologies: { name: 'Keys technology', family: 'database', from_catalog: false },
    };
    const missing: string[] = [];
    for (const entityType of AI_BUSINESS_RECORD_ENTITY_TYPES as string[]) {
      const input = creations[entityType];
      assert.ok(input, `a creation for ${entityType}`);
      const id = await approve(harness, ctx, await card(harness, ctx, 'create_business_record', { entity_type: entityType, fields: input }));
      const snapshot = await harness.support.getRecordSnapshot(ctx, entityType, id);
      for (const field of aiBusinessRecordUpdateFields(entityType) as string[]) {
        if (!(field in snapshot)) missing.push(`${entityType}.${field}`);
      }
    }
    assert.deepEqual(missing, [], 'fields Kad writes on an update and does not read back');
  });
}

async function run() {
  const harness = await createHarness();
  try {
    const failures: string[] = [];
    for (const test of [testAccessMethods, testRetiredValues, testOperatingSystem, testConnectionProtocol, testInterfaceMiddleware, testCatalogFieldsByName, testEveryWritableFieldIsRead]) {
      try {
        await test(harness);
      } catch (error) {
        failures.push(`${test.name}: ${(error as Error).message}`);
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('ai-catalog-values-write.integration.spec.ts passed');
  } finally {
    await harness.app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
