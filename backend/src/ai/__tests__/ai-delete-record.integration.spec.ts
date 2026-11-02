import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot L3: Plaid deletes one task, contact, location, budget line, connection or interface under
// preview.
// - A task deletes through its screen service, with the counts of what goes with it and an
//   `ai_chat` audit entry naming the preview; its comments and time entries go. A comment added
//   after the preview refuses the run, even when the task's `updated_at` did not move.
// - A task that started a request is refused before any preview exists, and a task outside a
//   Business Contributor's scope reads as missing.
// - A contact deletes for its administrator, with its links counted by readable family and the
//   others left unnamed; a member and a limited person are refused, at the preview and at the run.
// - A location that still holds assets is refused (`LOCATION_IN_USE`), at the preview and at the
//   run; one without assets deletes for a member.
// - An OPEX and a CAPEX line delete through their screen services, with their versions, tasks,
//   links and dimension values gone; a request keeps its own row and loses its origin task. A
//   line with amounts in a frozen column refuses before any preview; a budget member and a
//   limited person are refused.
// - A connection deletes for an infrastructure member, its interfaces kept and unlinked.
// - An interface with bindings is refused without `delete_related_bindings`, then deleted with
//   its bindings and its integrated documents even for an applications administrator without a
//   Knowledge library right; an applications member is refused.
// - A document deletes for its Knowledge administrator: its versions, attachments, incoming and
//   outgoing citations, links, workflow and edit lock go, and a document created from it keeps
//   its row without its template. Its preview names the review and the lock without refusing. A
//   managed document is refused before any preview, a Knowledge member is refused, a library the
//   person does not read answers as missing, and linked families they do not read stay unnamed.
// - A reader is refused, a record changed between the preview and the run is refused, and two
//   deletes never enter a mutation plan.
// The AI surface checks are stubbed open: this spec tests the operation, not the routes.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-delete-record-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; tools: any; support: any };
type UserKey =
  | 'taskAdmin'
  | 'contactsAdmin'
  | 'member'
  | 'reader'
  | 'limited'
  | 'limitedLater'
  | 'bc'
  | 'budgetAdmin'
  | 'budgetMember'
  | 'limitedBudgetAdmin'
  | 'infraMember'
  | 'appsAdmin'
  | 'appsMember'
  | 'knowledgeAdmin'
  | 'knowledgeAdminNoReads'
  | 'knowledgeMember'
  | 'knowledgeReader';
type Seed = {
  tenantId: string;
  users: Record<UserKey, string>;
  task: string;
  originTask: string;
  bcTask: string;
  otherTask: string;
  driftTask: string;
  contact: string;
  location: string;
  secondLocation: string;
  asset: string;
  secondAsset: string;
  application: string;
  secondApplication: string;
  project: string;
  supplier: string;
  opexLine: string;
  capexLine: string;
  frozenLine: string;
  lineTask: string;
  capexTask: string;
  lineRequest: string;
  connection: string;
  connectionInterface: string;
  interfaceWithBindings: string;
  interfaceDependency: string;
  interfaceDocument: string;
  interfaceBinding: string;
  interfaceConnection: string;
  document: string;
  documentDerived: string;
  documentCiting: string;
  documentCited: string;
  documentHidden: string;
  documentRestricted: string;
  managedDocument: string;
  incident: string;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-delete-record.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const policy = app.get(AiPolicyService);
  policy.assertSurfaceAccess = async () => undefined;
  const { AiDeleteMutationSupportService } = require('../mutation/ai-delete-mutation-support.service');
  return {
    app,
    dataSource: app.get(DataSource),
    previews: app.get(AiMutationPreviewService),
    tools: app.get(AiToolRegistry),
    support: app.get(AiDeleteMutationSupportService),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-l3-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const role = async (name: string, permissions: Record<string, string>) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const user = async (key: string, roleId: string, dataAccessMode = 'all') => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode)
     VALUES ($1, $2, $3, 'Tester', $4, 'enabled', $5)`,
    [tenantId, `${key}-${slug}@example.test`, key, roleId, dataAccessMode]);
  const users: Record<UserKey, string> = {
    taskAdmin: await user('TaskAdmin', await role('Task Administrator', {
      ai_chat: 'member', tasks: 'admin', applications: 'reader', infrastructure: 'reader', knowledge: 'reader',
    })),
    contactsAdmin: await user('ContactsAdmin', await role('Contacts Administrator', {
      ai_chat: 'member', contacts: 'admin', suppliers: 'reader', portfolio_projects: 'reader',
    })),
    member: await user('Member', await role('Member', {
      ai_chat: 'member', tasks: 'member', contacts: 'member', locations: 'member', infrastructure: 'reader',
    })),
    reader: await user('Reader', await role('Reader', {
      ai_chat: 'member', tasks: 'reader', contacts: 'reader', locations: 'reader',
    })),
    limited: await user('Limited', await role('Limited Contacts Administrator', { ai_chat: 'member', contacts: 'admin' }), 'limited'),
    limitedLater: await user('LimitedLater', await role('Later Limited Contacts Administrator', { ai_chat: 'member', contacts: 'admin' })),
    // The built-in role's name sets the participation scope (`resolveBusinessContributorScopeForUser`).
    bc: await user('BusinessContributor', await role('Business Contributor', { ai_chat: 'member', tasks: 'admin' })),
    budgetAdmin: await user('BudgetAdmin', await role('Budget Administrator', {
      ai_chat: 'member', budget: 'admin', tasks: 'reader', applications: 'reader', contracts: 'reader',
      portfolio_projects: 'reader', portfolio_requests: 'reader', infrastructure: 'reader', contacts: 'reader',
      knowledge: 'reader',
    })),
    budgetMember: await user('BudgetMember', await role('Budget Member', { ai_chat: 'member', budget: 'member' })),
    limitedBudgetAdmin: await user('LimitedBudgetAdmin', await role('Limited Budget Administrator', {
      ai_chat: 'member', budget: 'admin',
    })),
    infraMember: await user('InfraMember', await role('Infrastructure Member', {
      ai_chat: 'member', infrastructure: 'member', applications: 'reader', knowledge: 'reader',
    })),
    // An applications administrator without any right on the Knowledge library, as the interface
    // list's delete route is: its integrated documents still go with it, as the screen does.
    appsAdmin: await user('AppsAdmin', await role('Applications Administrator', { ai_chat: 'member', applications: 'admin' })),
    appsMember: await user('AppsMember', await role('Applications Member', { ai_chat: 'member', applications: 'member' })),
    knowledgeAdmin: await user('KnowledgeAdmin', await role('Knowledge Administrator', {
      ai_chat: 'member', knowledge: 'admin', applications: 'reader', infrastructure: 'reader',
      portfolio_projects: 'reader', portfolio_requests: 'reader', tasks: 'reader', locations: 'reader', incidents: 'reader',
    })),
    // A Knowledge administrator without the read of the families its documents link to: their
    // links are counted among the other links, unnamed.
    knowledgeAdminNoReads: await user('KnowledgeOnlyAdmin', await role('Knowledge Only Administrator', {
      ai_chat: 'member', knowledge: 'admin',
    })),
    knowledgeMember: await user('KnowledgeMember', await role('Knowledge Member', { ai_chat: 'member', knowledge: 'member' })),
    knowledgeReader: await user('KnowledgeReader', await role('Knowledge Reader', { ai_chat: 'member', knowledge: 'reader' })),
  };

  const task = (number: number, title: string, assignee: string) => insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
    [tenantId, number, title, assignee]);
  const task1 = await task(1, 'Migration', users.taskAdmin);
  const originTask = await task(2, 'Origin task', users.taskAdmin);
  const bcTask = await task(3, 'BC task', users.bc);
  const otherTask = await task(4, 'Other task', users.taskAdmin);
  const driftTask = await task(8, 'Drift task', users.taskAdmin);

  // A request started from the second task: its delete is the screen's 409.
  await runner.query(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, current_situation, expected_benefits,
       origin_task_id, criteria_values, feasibility_review, priority_override, created_at, updated_at)
     VALUES ($1, 201, 'Started by a task', 'pending_review', 'Situation', 'Benefits', $2,
       '{}'::jsonb, '{}'::jsonb, false, now(), now())`,
    [tenantId, originTask],
  );

  const application = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'CheeseTrack', 'APP-1', 'enabled')`, [tenantId]);
  await runner.query(
    `INSERT INTO portfolio_activities (tenant_id, task_id, author_id, type, content, changed_fields, created_at, updated_at)
     VALUES ($1, $2, $3, 'comment', 'A comment', null, now(), now()),
            ($1, $2, $3, 'change', null, '{"status":["open","in_progress"]}'::jsonb, now(), now())`,
    [tenantId, task1, users.taskAdmin],
  );
  await runner.query(
    `INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES ($1, $2, 1.5, now())`,
    [tenantId, task1],
  );
  await runner.query(
    `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'notes.txt', 'notes.txt', 'spec/notes.txt')`,
    [tenantId, task1],
  );
  await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, task1, application]);

  const contact = await insertId(runner,
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Camille', 'Roux', $2)`,
    [tenantId, `camille-${slug}@example.test`]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fromagerie')`, [tenantId]);
  const project = await insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, origin, status, scheduling_mode, execution_progress, criteria_values)
     VALUES ($1, 1, 'Migration project', 'fast_track', 'planned', 'independent', 0, '{}'::jsonb)`, [tenantId]);
  await runner.query(`INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'other')`, [tenantId, supplier, contact]);
  await runner.query(`INSERT INTO portfolio_project_contacts (tenant_id, project_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, project, contact]);
  await runner.query(`INSERT INTO application_support_contacts (tenant_id, application_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, application, contact]);

  const location = await insertId(runner,
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-1', 'Paris DC', 'cloud')`, [tenantId]);
  const secondLocation = await insertId(runner,
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-2', 'Lyon DC', 'cloud')`, [tenantId]);
  const asset = await insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, 'srv-paris', 'server', 'prod', $2)`,
    [tenantId, location]);
  const locationContact = await insertId(runner,
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Louis', 'Site', $2)`,
    [tenantId, `louis-${slug}@example.test`]);
  await runner.query(`INSERT INTO location_contacts (tenant_id, location_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, location, locationContact]);
  await runner.query(`INSERT INTO location_user_contacts (tenant_id, location_id, user_id) VALUES ($1, $2, $3)`, [tenantId, location, users.taskAdmin]);
  await runner.query(`INSERT INTO location_links (tenant_id, location_id, url) VALUES ($1, $2, 'https://example.test/rack')`, [tenantId, location]);
  await runner.query(`INSERT INTO location_sub_items (tenant_id, location_id, name) VALUES ($1, $2, 'Rack A')`, [tenantId, location]);
  const library = await insertId(runner,
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Spec library', $2)`, [tenantId, `spec-${slug}`]);
  const document = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Rack layout', 1, 'published')`,
    [tenantId, library]);
  await runner.query(`INSERT INTO document_locations (tenant_id, document_id, location_id) VALUES ($1, $2, $3)`, [tenantId, document, location]);

  // --- Lot 2: budget lines, connections and interfaces.

  const secondApplication = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Billing', 'APP-2', 'enabled')`, [tenantId]);
  const secondAsset = await insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'srv-lyon', 'server', 'prod')`, [tenantId]);
  const company = await insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, 'Fromage Holding', 'FR', 'Lyon', 'enabled')`, [tenantId]);
  const contract = await insertId(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date)
     VALUES ($1, 'Support contract', $2, $3, '2026-01-01')`, [tenantId, company, supplier]);

  const line = async (number: number, nature: 'opex' | 'capex', name: string, legacy: string | null = null) => insertId(runner,
    `INSERT INTO spend_items (tenant_id, item_number, nature, legacy_number, product_name, currency, effective_start, paying_company_id, supplier_id)
     VALUES ($1, $2, $3, $4, $5, 'EUR', '2026-01-01', $6, $7)`,
    [tenantId, number, nature, legacy, name, company, supplier]);
  const version = async (lineId: string, year: number, planned: number) => insertId(runner,
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, $3, '2026-01-01', $4, 'default')`,
    [tenantId, lineId, `Budget ${year}`, year]).then(async (versionId) => {
      await runner.query(
        `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, $4)`,
        [tenantId, versionId, `${year}-01-01`, planned],
      );
      return versionId;
    });

  const opexLine = await line(9001, 'opex', 'ERP licence', 'OPX-9001');
  const opexVersion = await version(opexLine, 2026, 1200);
  // A second month of the same version: the card still counts one version.
  await runner.query(
    `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-02-01', 100)`,
    [tenantId, opexVersion],
  );
  await version(opexLine, 2027, 500);

  const lineTask = await insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, related_object_type, related_object_id, labels, owner_ids, viewer_ids)
     VALUES ($1, 5, 'Line task', 'open', $2, 'spend_item', $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [tenantId, users.budgetAdmin, opexLine]);
  await runner.query(
    `INSERT INTO portfolio_activities (tenant_id, task_id, author_id, type, content)
     VALUES ($1, $2, $3, 'comment', 'Line work')`, [tenantId, lineTask, users.budgetAdmin],
  );
  await runner.query(
    `INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES ($1, $2, 2, now())`,
    [tenantId, lineTask],
  );
  await runner.query(
    `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'line.txt', 'line.txt', 'spec/line.txt')`, [tenantId, lineTask],
  );
  await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, lineTask, application]);
  await runner.query(`INSERT INTO task_assets (tenant_id, task_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, lineTask, asset]);

  const lineRequest = await insertId(runner,
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, current_situation, expected_benefits,
       origin_task_id, criteria_values, feasibility_review, priority_override, created_at, updated_at)
     VALUES ($1, 202, 'Line request', 'pending_review', 'Situation', 'Benefits', $2,
       '{}'::jsonb, '{}'::jsonb, false, now(), now())`,
    [tenantId, lineTask]);
  await runner.query(`INSERT INTO portfolio_request_opex (tenant_id, request_id, opex_id) VALUES ($1, $2, $3)`, [tenantId, lineRequest, opexLine]);
  await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contract, opexLine]);
  await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [tenantId, project, opexLine]);
  await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, application, opexLine]);
  await runner.query(`INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, asset, opexLine]);
  const technology = await insertId(runner,
    `INSERT INTO technologies (tenant_id, name, item_number) VALUES ($1, 'PostgreSQL', 1)`, [tenantId]);
  await runner.query(`INSERT INTO technology_spend_items (tenant_id, technology_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, technology, opexLine]);
  const lineContact = await insertId(runner,
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Line', 'Contact', $2)`,
    [tenantId, `line-${slug}@example.test`]);
  await runner.query(`INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role) VALUES ($1, $2, $3, 'commercial')`, [tenantId, opexLine, lineContact]);
  await runner.query(`INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://example.test/line')`, [tenantId, opexLine]);
  await runner.query(
    `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path, size)
     VALUES ($1, $2, 'line.pdf', 'line.pdf', 'spec/line.pdf', 10)`, [tenantId, opexLine],
  );
  const axis = await insertId(runner,
    `INSERT INTO analytics_axes (tenant_id, code, name, is_default) VALUES ($1, 'it_tower', 'IT tower', false)`, [tenantId]);
  const category = await insertId(runner,
    `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Infrastructure')`, [tenantId, axis]);
  await runner.query(
    `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
    [tenantId, opexLine, axis, category],
  );

  const capexLine = await line(9002, 'capex', 'Server refresh', 'CPX-9002');
  await version(capexLine, 2026, 8000);
  const capexTask = await insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, related_object_type, related_object_id, labels, owner_ids, viewer_ids)
     VALUES ($1, 6, 'CAPEX task', 'open', $2, 'capex_item', $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [tenantId, users.budgetAdmin, capexLine]);
  await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [tenantId, project, capexLine]);

  const frozenLine = await line(9003, 'opex', 'Frozen line');
  await version(frozenLine, 2028, 500);
  await runner.query(
    `INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen)
     VALUES ($1, 2028, 'opex', 'budget', true)`, [tenantId],
  );

  const connection = await insertId(runner,
    `INSERT INTO connections (tenant_id, connection_reference, name, topology, source_asset_id, destination_asset_id)
     VALUES ($1, 'CON-1', 'DB link', 'server_to_server', $2, $3)`, [tenantId, asset, secondAsset]);
  await runner.query(
    `INSERT INTO connection_protocols (tenant_id, connection_id, connection_type_code) VALUES ($1, $2, 'tcp')`,
    [tenantId, connection],
  );
  await runner.query(`INSERT INTO connection_servers (tenant_id, connection_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, connection, asset]);
  await runner.query(
    `INSERT INTO connection_legs (tenant_id, connection_id, order_index, protocol_codes) VALUES ($1, $2, 1, ARRAY['tcp'])`,
    [tenantId, connection],
  );
  await runner.query(`INSERT INTO document_connections (tenant_id, document_id, connection_id) VALUES ($1, $2, $3)`, [tenantId, document, connection]);

  const appInstance = async (applicationId: string, environment: string) => insertId(runner,
    `INSERT INTO app_instances (tenant_id, application_id, environment)
     VALUES ($1, $2, $3)`, [tenantId, applicationId, environment]);
  const sourceInstance = await appInstance(application, 'prod');
  const targetInstance = await appInstance(secondApplication, 'prod');

  const iface = async (reference: string, name: string, sourceId = application, targetId = secondApplication) => insertId(runner,
    `INSERT INTO interfaces (tenant_id, interface_reference, name, source_application_id, target_application_id,
       business_purpose, data_category, integration_route_type)
     VALUES ($1, $2, $3, $4, $5, 'Orders flow', 'orders', 'direct')`,
    [tenantId, reference, name, sourceId, targetId]);
  const leg = async (interfaceId: string, order: number) => insertId(runner,
    `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type,
       integration_pattern, data_format, order_index)
     VALUES ($1, $2, 'source', 'source', 'target', 'schedule', 'batch', 'json', $3)`,
    [tenantId, interfaceId, order]);
  const binding = async (interfaceId: string, legId: string, environment: string) => insertId(runner,
    `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, interfaceId, legId, environment, sourceInstance, targetInstance]);

  // The interface the connection test unlinks but keeps.
  const connectionInterface = await iface('INT-1', 'DB orders');
  const connectionBinding = await binding(connectionInterface, await leg(connectionInterface, 1), 'prod');
  await runner.query(
    `INSERT INTO interface_connection_links (tenant_id, interface_binding_id, connection_id) VALUES ($1, $2, $3)`,
    [tenantId, connectionBinding, connection],
  );

  // The interface with bindings: its own connection, integrated document, dependency and attachment.
  const interfaceWithBindings = await iface('INT-2', 'Orders');
  const interfaceBinding = await binding(interfaceWithBindings, await leg(interfaceWithBindings, 1), 'prod');
  const interfaceConnection = await insertId(runner,
    `INSERT INTO connections (tenant_id, connection_reference, name, topology)
     VALUES ($1, 'CON-2', 'Orders MQ', 'server_to_server')`, [tenantId]);
  await runner.query(
    `INSERT INTO interface_connection_links (tenant_id, interface_binding_id, connection_id) VALUES ($1, $2, $3)`,
    [tenantId, interfaceBinding, interfaceConnection],
  );
  const interfaceDocument = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Orders specification', 2, 'published')`,
    [tenantId, library]);
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id)
     VALUES ($1, 'interfaces', $2, 'specification', $3)`, [tenantId, interfaceWithBindings, interfaceDocument],
  );
  await runner.query(`INSERT INTO document_interfaces (tenant_id, document_id, interface_id) VALUES ($1, $2, $3)`, [tenantId, interfaceDocument, interfaceWithBindings]);
  const interfaceDependency = await iface('INT-3', 'Inventory');
  await runner.query(
    `INSERT INTO interface_dependencies (tenant_id, interface_id, related_interface_id, direction)
     VALUES ($1, $2, $3, 'downstream')`, [tenantId, interfaceDependency, interfaceWithBindings],
  );
  await runner.query(
    `INSERT INTO interface_attachments (tenant_id, interface_id, kind, original_filename, stored_filename, size, storage_path)
     VALUES ($1, $2, 'spec', 'orders.pdf', 'orders.pdf', 10, 'spec/orders.pdf')`, [tenantId, interfaceWithBindings],
  );
  await runner.query(
    `INSERT INTO interface_middleware_applications (tenant_id, interface_id, application_id) VALUES ($1, $2, $3)`,
    [tenantId, interfaceWithBindings, secondApplication],
  );

  // --- Lot 3: documents.

  const incident = await insertId(runner,
    `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 1, 'Backup outage', 'major')`,
    [tenantId]);
  const runbookDocument = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status, revision, content_markdown, updated_by)
     VALUES ($1, $2, 'Operations runbook', 10, 'published', 3, 'Runbook body.', $3)`,
    [tenantId, library, users.knowledgeAdmin]);
  await runner.query(
    `INSERT INTO document_versions (tenant_id, document_id, version_number, title, content_markdown, content_plain, created_by)
     VALUES ($1, $2, 1, 'Operations runbook', 'First body.', 'First body.', $3),
            ($1, $2, 2, 'Operations runbook', 'Runbook body.', 'Runbook body.', $3)`,
    [tenantId, runbookDocument, users.knowledgeAdmin],
  );
  await runner.query(
    `INSERT INTO document_attachments (tenant_id, document_id, original_filename, stored_filename, mime_type, size, storage_path)
     VALUES ($1, $2, 'runbook.pdf', 'runbook.pdf', 'application/pdf', 10, 'spec/runbook.pdf'),
            ($1, $2, 'diagram.png', 'diagram.png', 'image/png', 20, 'spec/diagram.png')`,
    [tenantId, runbookDocument],
  );
  const documentDerived = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status, template_document_id)
     VALUES ($1, $2, 'Runbook for Lyon', 11, 'draft', $3)`, [tenantId, library, runbookDocument]);
  const documentCiting = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status)
     VALUES ($1, $2, 'Backup procedure', 12, 'published')`, [tenantId, library]);
  const documentCited = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status)
     VALUES ($1, $2, 'Network map', 13, 'published')`, [tenantId, library]);
  await runner.query(
    `INSERT INTO document_references (tenant_id, source_document_id, target_document_id)
     VALUES ($1, $2, $3), ($1, $3, $4)`,
    [tenantId, documentCiting, runbookDocument, documentCited],
  );
  for (const [table, column, target] of [
    ['document_applications', 'application_id', application],
    ['document_assets', 'asset_id', asset],
    ['document_projects', 'project_id', project],
    ['document_requests', 'request_id', lineRequest],
    ['document_tasks', 'task_id', otherTask],
    ['document_locations', 'location_id', secondLocation],
    ['document_connections', 'connection_id', interfaceConnection],
    ['document_interfaces', 'interface_id', connectionInterface],
    ['document_incidents', 'incident_id', incident],
  ] as const) {
    await runner.query(`INSERT INTO ${table} (tenant_id, document_id, ${column}) VALUES ($1, $2, $3)`, [tenantId, runbookDocument, target]);
  }
  await runner.query(
    `INSERT INTO document_workflows (tenant_id, document_id, status, requested_revision, requested_by)
     VALUES ($1, $2, 'pending_review', 3, $3)`,
    [tenantId, runbookDocument, users.knowledgeAdmin],
  );
  await runner.query(
    `INSERT INTO document_edit_locks (tenant_id, document_id, holder_user_id, lock_token_hash, expires_at)
     VALUES ($1, $2, $3, 'test-lock', now() + interval '1 hour')`,
    [tenantId, runbookDocument, users.member],
  );

  // A document whose linked families the Knowledge-only administrator does not read.
  const documentHidden = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status)
     VALUES ($1, $2, 'Hidden links', 14, 'draft')`, [tenantId, library]);
  await runner.query(
    `INSERT INTO document_applications (tenant_id, document_id, application_id) VALUES ($1, $2, $3)`,
    [tenantId, documentHidden, application],
  );
  await runner.query(
    `INSERT INTO document_assets (tenant_id, document_id, asset_id) VALUES ($1, $2, $3)`,
    [tenantId, documentHidden, asset],
  );

  // A document integrated into a project's purpose: it goes with the project, not from Knowledge.
  const managedDocument = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status)
     VALUES ($1, $2, 'Migration purpose', 3, 'published')`, [tenantId, library]);
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id)
     VALUES ($1, 'projects', $2, 'purpose', $3)`,
    [tenantId, project, managedDocument],
  );

  // A restricted library nobody may read without a membership.
  const restrictedLibrary = await insertId(runner,
    `INSERT INTO document_libraries (tenant_id, name, slug, access_mode) VALUES ($1, 'Restricted', $2, 'restricted')`,
    [tenantId, `restricted-${slug}`]);
  const documentRestricted = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status)
     VALUES ($1, $2, 'Restricted runbook', 15, 'draft')`, [tenantId, restrictedLibrary]);

  return {
    tenantId,
    users,
    task: task1,
    originTask,
    bcTask,
    otherTask,
    driftTask,
    contact,
    location,
    secondLocation,
    asset,
    secondAsset,
    application,
    secondApplication,
    project,
    supplier,
    opexLine,
    capexLine,
    frozenLine,
    lineTask,
    capexTask,
    lineRequest,
    connection,
    connectionInterface,
    interfaceWithBindings,
    interfaceDependency,
    interfaceDocument,
    interfaceBinding,
    interfaceConnection,
    document: runbookDocument,
    documentDerived,
    documentCiting,
    documentCited,
    documentHidden,
    documentRestricted,
    managedDocument,
    incident,
  };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey) {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager: runner.manager,
    conversationId: null,
  };
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  const error = await fn().then(() => null, (caught: any) => caught);
  assert.ok(error, 'refused');
  return String(error.message);
}

async function count(runner: QueryRunner, table: string, where: string, params: unknown[]): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return Number(row.n);
}

async function latestAudit(runner: QueryRunner, tenantId: string, table: string, recordId: string) {
  const [row] = await runner.query(
    `SELECT action, source, source_ref, user_id FROM audit_log
      WHERE tenant_id = $1 AND table_name = $2 AND record_id = $3
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, table, recordId],
  );
  return row;
}

async function testTaskDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'taskAdmin');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-1' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'tasks');
  assert.equal(preview.target.entity_id, s.task);
  assert.equal(preview.target.ref, 'T-1');
  assert.equal(preview.target.title, 'Migration');
  assert.equal(preview.changes.deletion.format, 'markdown');
  const impact = String(preview.changes.deletion.to);
  for (const line of ['Comments and changes: 2', 'Time entries: 1', 'Attachments: 1', 'Links to applications: 1']) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.match(preview.summary, /^Delete task "Migration"\.$/);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.task]), 0);
  assert.equal(await count(runner, 'portfolio_activities', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.task]), 0);
  assert.equal(await count(runner, 'task_time_entries', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.task]), 0);
  assert.equal(await count(runner, 'task_attachments', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.task]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'tasks', s.task);
  assert.equal(audit.action, 'delete');
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  assert.equal(audit.user_id, s.users.taskAdmin);
  console.log('  task deleted through its screen service, with its counts and AI audit: OK');
}

async function testTaskImpactDriftRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'taskAdmin');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-8' });
  // A comment added after the preview does not move the task's updated_at: the recount refuses it.
  const comment = await insertId(runner,
    `INSERT INTO portfolio_activities (tenant_id, task_id, author_id, type, content)
     VALUES ($1, $2, $3, 'comment', 'Added after preview')`,
    [s.tenantId, s.driftTask, s.users.taskAdmin]);
  const drift = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(drift.status, 'failed');
  assert.match(drift.error_message, /changed after the preview was created/);
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.driftTask]), 1);
  await runner.query(`DELETE FROM portfolio_activities WHERE tenant_id = $1 AND id = $2`, [s.tenantId, comment]);
  const next = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-8' });
  assert.equal((await h.previews.executePreview(context, next.preview_id)).status, 'executed');
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.driftTask]), 0);
  console.log('  task comment added after the preview refused, then the task deleted: OK');
}

async function testOriginTaskRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'taskAdmin');
  const before = await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]);
  const message = await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-2' }));
  assert.match(message, /origin of request REQ-201/);
  assert.match(message, /Delete the request first, or change its origin task/);
  assert.equal(await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]), before);
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.originTask]), 1);
  console.log('  task that started a request refused before any preview: OK');
}

async function testBusinessContributorScope(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'bc');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-3' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_id, s.bcTask);
  // Out of scope reads as missing, exactly like a task that does not exist.
  assert.equal(await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-4' })), 'Task not found.');
  assert.equal(await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-99' })), 'Task not found.');
  console.log('  Business Contributor: in scope previews, out of scope reads as missing: OK');
}

async function testContactDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'contactsAdmin');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'contacts', ref: 'Camille Roux' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'contacts');
  assert.equal(preview.target.ref, null);
  assert.equal(preview.target.title, 'Camille Roux');
  const impact = String(preview.changes.deletion.to);
  assert.ok(impact.includes('- Links to suppliers: 1'), impact);
  assert.ok(impact.includes('- Links to projects: 1'), impact);
  assert.ok(impact.includes("- Other links: 1"), impact);
  assert.ok(!impact.includes('Links to applications'), impact);
  assert.ok(impact.includes('The linked records stay.'), impact);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'contacts', 'tenant_id = $1 AND id = $2', [s.tenantId, s.contact]), 0);
  assert.equal(await count(runner, 'supplier_contacts', 'tenant_id = $1 AND contact_id = $2', [s.tenantId, s.contact]), 0);
  assert.equal(await count(runner, 'portfolio_project_contacts', 'tenant_id = $1 AND contact_id = $2', [s.tenantId, s.contact]), 0);
  assert.equal(await count(runner, 'application_support_contacts', 'tenant_id = $1 AND contact_id = $2', [s.tenantId, s.contact]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'contacts', s.contact);
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  console.log('  contact deleted by its administrator, readable families counted, the rest unnamed: OK');
}

async function testContactRefusals(h: Harness, runner: QueryRunner, s: Seed) {
  const member = await refusal(() => h.previews.createPreview(ctx(runner, s, 'member'), 'delete_record', {
    entity_type: 'contacts', ref: 'Camille Roux',
  }));
  assert.match(member, /contacts/);
  const limited = ctx(runner, s, 'limited');
  assert.equal(
    await refusal(() => h.previews.createPreview(limited, 'delete_record', { entity_type: 'contacts', ref: 'Camille Roux' })),
    'This action is reserved to people with access to all data.',
  );
  assert.equal(await count(runner, 'contacts', 'tenant_id = $1 AND id = $2', [s.tenantId, s.contact]), 1);

  // A preview asked before the access became limited is refused when it runs, and the contact stays.
  const later = ctx(runner, s, 'limitedLater');
  const preview = await h.previews.createPreview(later, 'delete_record', { entity_type: 'contacts', ref: 'Camille Roux' });
  await runner.query(`UPDATE users SET data_access_mode = 'limited' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedLater]);
  const message = await refusal(() => h.previews.executePreview(later, preview.preview_id));
  assert.equal(message, 'This action is reserved to people with access to all data.');
  assert.equal(await count(runner, 'contacts', 'tenant_id = $1 AND id = $2', [s.tenantId, s.contact]), 1);
  await runner.query(`UPDATE users SET data_access_mode = 'all' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedLater]);
  console.log('  contact refused to a member and to a limited person, at the preview and at the run: OK');
}

async function testLocationDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'member');
  // A location that still holds an asset is refused before any preview, with the asset counted.
  const before = await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]);
  const refused = await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'locations', ref: 'LOC-1' }));
  assert.equal(refused, 'Cannot delete location "Paris DC": it still holds 1 asset. Move it to another location first.');
  assert.equal(await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]), before);
  assert.equal(await count(runner, 'assets', 'tenant_id = $1 AND id = $2 AND location_id = $3', [s.tenantId, s.asset, s.location]), 1);

  // Moved to another location, the asset no longer holds it.
  const gouda = (await runner.query(
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-3', 'Gouda DC', 'cloud') RETURNING id`,
    [s.tenantId],
  ))[0].id as string;
  await runner.query(`UPDATE assets SET location_id = $3 WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.asset, gouda]);

  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'locations', ref: 'LOC-1' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'locations');
  assert.equal(preview.target.ref, 'LOC-1');
  assert.equal(preview.target.title, 'LOC-1 - Paris DC');
  const impact = String(preview.changes.deletion.to);
  for (const line of [
    'Links to contacts: 2',
    'Links: 1',
    'Sub-items: 1',
    // The member does not read the documents: their link is counted, not named.
    'Other links: 1',
  ]) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.ok(!impact.includes('Links to documents'), impact);
  assert.ok(!/asset/i.test(impact), impact);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'locations', 'tenant_id = $1 AND id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'assets', 'tenant_id = $1 AND id = $2 AND location_id = $3', [s.tenantId, s.asset, gouda]), 1);
  assert.equal(await count(runner, 'location_contacts', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'location_user_contacts', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'location_links', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'location_sub_items', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'document_locations', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'locations', s.location);
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);

  // An asset placed there between the preview and the run: the run is refused the same way.
  const empty = (await runner.query(
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-4', 'Delft DC', 'cloud') RETURNING id`,
    [s.tenantId],
  ))[0].id as string;
  const late = await h.previews.createPreview(context, 'delete_record', { entity_type: 'locations', ref: 'LOC-4' });
  await runner.query(`UPDATE assets SET location_id = $3 WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.asset, empty]);
  const failed = await h.previews.executePreview(context, late.preview_id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error_message, 'Cannot delete location "Delft DC": it still holds 1 asset. Move it to another location first.');
  assert.equal(await count(runner, 'locations', 'tenant_id = $1 AND id = $2', [s.tenantId, empty]), 1);
  console.log('  location with assets refused at the preview and at the run; without them, deleted by a member, audit names the preview: OK');
}

async function testOpexLineDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'budgetAdmin');
  let preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'budget_lines', ref: 'BL-9001' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'budget_lines');
  assert.equal(preview.target.entity_id, s.opexLine);
  assert.equal(preview.target.ref, 'BL-9001');
  assert.equal(preview.target.title, 'ERP licence');
  const impact = String(preview.changes.deletion.to);
  for (const line of [
    'Versions with amounts: 2',
    'Years with amounts: 2',
    'Deleted tasks: 1',
    'Requests that lose their origin task: 1',
    'Attachments: 1',
    'Links to contracts: 1',
    'Links to projects: 1',
    'Links to requests: 1',
    'Links to applications: 1',
    'Links to assets: 1',
    'Links to technologies: 1',
    'Links to contacts: 1',
    'Links: 1',
    'Dimension values: 1',
  ]) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.ok(impact.includes('The linked records stay.'), impact);

  // A task added after the preview does not move the line's updated_at: the recount refuses the
  // run, and the line stays.
  const extraTask = await insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, related_object_type, related_object_id, labels, owner_ids, viewer_ids)
     VALUES ($1, 7, 'Added after preview', 'open', $2, 'spend_item', $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [s.tenantId, s.users.budgetAdmin, s.opexLine]);
  const drift = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(drift.status, 'failed');
  assert.match(drift.error_message, /changed after the preview was created/);
  assert.equal(await count(runner, 'spend_items', 'tenant_id = $1 AND id = $2', [s.tenantId, s.opexLine]), 1);
  await runner.query(`DELETE FROM tasks WHERE tenant_id = $1 AND id = $2`, [s.tenantId, extraTask]);

  // Its exact title names it too, as in `write_financial_plan`.
  preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'budget_lines', ref: 'erp licence' });
  assert.equal(preview.target.entity_id, s.opexLine);
  await h.previews.rejectPreview(context, preview.preview_id);
  preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'budget_lines', ref: 'OPX-9001' });
  assert.equal(preview.target.entity_id, s.opexLine);
  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'spend_items', 'tenant_id = $1 AND id = $2', [s.tenantId, s.opexLine]), 0);
  for (const [table, column] of [
    ['spend_versions', 'spend_item_id'],
    ['spend_attachments', 'spend_item_id'],
    ['spend_links', 'spend_item_id'],
    ['spend_item_contacts', 'spend_item_id'],
    ['spend_item_analytics_values', 'item_id'],
    ['contract_spend_items', 'spend_item_id'],
    ['portfolio_project_opex', 'opex_id'],
    ['portfolio_request_opex', 'opex_id'],
    ['application_spend_items', 'spend_item_id'],
    ['asset_spend_items', 'spend_item_id'],
    ['technology_spend_items', 'spend_item_id'],
  ]) {
    assert.equal(await count(runner, table, `tenant_id = $1 AND ${column} = $2`, [s.tenantId, s.opexLine]), 0, table);
  }
  assert.equal(await count(runner, 'spend_amounts', 'tenant_id = $1 AND version_id IN (SELECT id FROM spend_versions WHERE spend_item_id = $2)', [s.tenantId, s.opexLine]), 0);
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.lineTask]), 0);
  assert.equal(await count(runner, 'task_time_entries', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.lineTask]), 0);
  assert.equal(await count(runner, 'portfolio_activities', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.lineTask]), 0);
  const [request] = await runner.query(
    `SELECT origin_task_id FROM portfolio_requests WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lineRequest],
  );
  assert.equal(request.origin_task_id, null);
  assert.equal(await count(runner, 'portfolio_activities', `tenant_id = $1 AND request_id = $2 AND changed_fields ? 'origin_task_id'`, [s.tenantId, s.lineRequest]), 1);
  const audit = await latestAudit(runner, s.tenantId, 'spend_items', s.opexLine);
  assert.equal(audit.action, 'delete');
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  assert.equal(audit.user_id, s.users.budgetAdmin);
  console.log('  OPEX line deleted through its screen service, its versions, tasks and links gone, the request origin cleared: OK');
}

async function testCapexLineDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'budgetAdmin');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'budget_lines', ref: 'CPX-9002' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'budget_lines');
  assert.equal(preview.target.entity_id, s.capexLine);
  assert.equal(preview.target.ref, 'BL-9002');
  assert.equal(preview.target.title, 'Server refresh');
  const impact = String(preview.changes.deletion.to);
  for (const line of ['Versions with amounts: 1', 'Years with amounts: 1', 'Deleted tasks: 1', 'Links to projects: 1']) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.ok(impact.includes('The linked records stay.'), `the L3 closing in:\n${impact}`);
  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'spend_items', 'tenant_id = $1 AND id = $2', [s.tenantId, s.capexLine]), 0);
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.capexTask]), 0);
  assert.equal(await count(runner, 'spend_versions', 'tenant_id = $1 AND spend_item_id = $2', [s.tenantId, s.capexLine]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'capex_items', s.capexLine);
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  console.log('  CAPEX line deleted through its screen service, its CAPEX task gone, audit under capex_items: OK');
}

async function testFrozenLineRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'budgetAdmin');
  const before = await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]);
  const message = await refusal(() => h.previews.createPreview(context, 'delete_record', {
    entity_type: 'budget_lines', ref: 'BL-9003',
  }));
  assert.match(message, /frozen budget column/);
  assert.match(message, /2028/);
  assert.equal(await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]), before);
  assert.equal(await count(runner, 'spend_items', 'tenant_id = $1 AND id = $2', [s.tenantId, s.frozenLine]), 1);
  console.log('  line with amounts in a frozen column refused before any preview: OK');
}

async function testBudgetLineRefusals(h: Harness, runner: QueryRunner, s: Seed) {
  // A budget member cannot delete a line.
  const member = await refusal(() => h.previews.createPreview(ctx(runner, s, 'budgetMember'), 'delete_record', {
    entity_type: 'budget_lines', ref: 'BL-9001',
  }));
  assert.match(member, /budget/);
  // A limited person is refused at the preview and again at the run.
  const limited = ctx(runner, s, 'limitedBudgetAdmin');
  await runner.query(`UPDATE users SET data_access_mode = 'limited' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedBudgetAdmin]);
  try {
    assert.equal(
      await refusal(() => h.previews.createPreview(limited, 'delete_record', { entity_type: 'budget_lines', ref: 'BL-9001' })),
      'This action is reserved to people with access to all data.',
    );
  } finally {
    await runner.query(`UPDATE users SET data_access_mode = 'all' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedBudgetAdmin]);
  }
  const preview = await h.previews.createPreview(limited, 'delete_record', { entity_type: 'budget_lines', ref: 'BL-9001' });
  await runner.query(`UPDATE users SET data_access_mode = 'limited' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedBudgetAdmin]);
  try {
    assert.equal(
      await refusal(() => h.previews.executePreview(limited, preview.preview_id)),
      'This action is reserved to people with access to all data.',
    );
    assert.equal(await count(runner, 'spend_items', 'tenant_id = $1 AND id = $2', [s.tenantId, s.opexLine]), 1);
  } finally {
    await runner.query(`UPDATE users SET data_access_mode = 'all' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedBudgetAdmin]);
  }
  await h.previews.rejectPreview(limited, preview.preview_id).catch(() => undefined);
  console.log('  line refused to a budget member and to a limited person, at the preview and at the run: OK');
}

async function testConnectionDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'infraMember');
  // The bindings flag belongs to interfaces: on another family it is refused, no preview made.
  assert.match(await refusal(() => h.previews.createPreview(context, 'delete_record', {
    entity_type: 'connections', ref: 'CON-1', delete_related_bindings: true,
  })), /interfaces only/);
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'connections', ref: 'CON-1' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'connections');
  assert.equal(preview.target.entity_id, s.connection);
  assert.equal(preview.target.ref, 'CON-1');
  assert.equal(preview.target.title, 'CON-1 - DB link');
  const impact = String(preview.changes.deletion.to);
  for (const line of [
    'Hops: 1',
    'Links to servers: 1',
    'Protocols: 1',
    'Interfaces that will lose this connection: 1',
    'Links to documents: 1',
  ]) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.ok(impact.includes('The interfaces themselves are not deleted.'), impact);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'connections', 'tenant_id = $1 AND id = $2', [s.tenantId, s.connection]), 0);
  for (const table of ['connection_legs', 'connection_servers', 'connection_protocols']) {
    assert.equal(await count(runner, table, 'tenant_id = $1 AND connection_id = $2', [s.tenantId, s.connection]), 0, table);
  }
  assert.equal(await count(runner, 'document_connections', 'tenant_id = $1 AND connection_id = $2', [s.tenantId, s.connection]), 0);
  assert.equal(await count(runner, 'interfaces', 'tenant_id = $1 AND id = $2', [s.tenantId, s.connectionInterface]), 1);
  assert.equal(await count(runner, 'interface_bindings', 'tenant_id = $1 AND interface_id = $2', [s.tenantId, s.connectionInterface]), 1);
  assert.equal(await count(runner, 'interface_connection_links', 'tenant_id = $1 AND connection_id = $2', [s.tenantId, s.connection]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'connections', s.connection);
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  console.log('  connection deleted by an infrastructure member, its interfaces kept and unlinked: OK');
}

async function testInterfaceDelete(h: Harness, runner: QueryRunner, s: Seed) {
  // A member of the applications may not delete an interface, as the list's admin button.
  const member = await refusal(() => h.previews.createPreview(ctx(runner, s, 'appsMember'), 'delete_record', {
    entity_type: 'interfaces', ref: 'INT-2',
  }));
  assert.match(member, /applications/);

  const context = ctx(runner, s, 'appsAdmin');
  const before = await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]);
  // Without the flag, the screen's refusal, with the number of bindings and what to ask again.
  const refused = await refusal(() => h.previews.createPreview(context, 'delete_record', {
    entity_type: 'interfaces', ref: 'INT-2',
  }));
  assert.match(refused, /1 binding/);
  assert.match(refused, /delete_related_bindings/);
  assert.equal(await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]), before);
  assert.equal(await count(runner, 'interfaces', 'tenant_id = $1 AND id = $2', [s.tenantId, s.interfaceWithBindings]), 1);

  const preview = await h.previews.createPreview(context, 'delete_record', {
    entity_type: 'interfaces', ref: 'INT-2', delete_related_bindings: true,
  });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_id, s.interfaceWithBindings);
  assert.equal(preview.target.ref, 'INT-2');
  assert.equal(preview.target.title, 'INT-2 - Orders');
  const impact = String(preview.changes.deletion.to);
  for (const line of [
    'Bindings: 1',
    'Links to connections: 1',
    'Links to dependent interfaces: 1',
    'Attachments: 1',
    'Links to applications: 2',
    // The applications administrator has no right on the Knowledge library: its two documents
    // are counted without being named.
    'Other links: 2',
  ]) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.ok(!impact.includes('Integrated documents'), impact);
  assert.ok(!impact.includes('Links to documents'), impact);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'interfaces', 'tenant_id = $1 AND id = $2', [s.tenantId, s.interfaceWithBindings]), 0);
  assert.equal(await count(runner, 'interface_bindings', 'tenant_id = $1 AND id = $2', [s.tenantId, s.interfaceBinding]), 0);
  assert.equal(await count(runner, 'interface_connection_links', 'tenant_id = $1 AND connection_id = $2', [s.tenantId, s.interfaceConnection]), 0);
  assert.equal(await count(runner, 'integrated_document_bindings', 'tenant_id = $1 AND source_entity_type = $2 AND source_entity_id = $3', [s.tenantId, 'interfaces', s.interfaceWithBindings]), 0);
  assert.equal(await count(runner, 'documents', 'tenant_id = $1 AND id = $2', [s.tenantId, s.interfaceDocument]), 0);
  assert.equal(await count(runner, 'document_interfaces', 'tenant_id = $1 AND interface_id = $2', [s.tenantId, s.interfaceWithBindings]), 0);
  assert.equal(await count(runner, 'interface_dependencies', 'tenant_id = $1 AND interface_id = $2', [s.tenantId, s.interfaceDependency]), 0);
  assert.equal(await count(runner, 'interface_attachments', 'tenant_id = $1 AND interface_id = $2', [s.tenantId, s.interfaceWithBindings]), 0);
  assert.equal(await count(runner, 'interfaces', 'tenant_id = $1 AND id = $2', [s.tenantId, s.interfaceDependency]), 1);
  assert.equal(await count(runner, 'connections', 'tenant_id = $1 AND id = $2', [s.tenantId, s.interfaceConnection]), 1);
  assert.equal(await count(runner, 'applications', 'tenant_id = $1 AND id = $2', [s.tenantId, s.application]), 1);
  const audit = await latestAudit(runner, s.tenantId, 'interfaces', s.interfaceWithBindings);
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  console.log('  interface refused without the bindings flag, deleted with its bindings and integrated documents, without a library right: OK');
}

async function testDocumentRefusals(h: Harness, runner: QueryRunner, s: Seed) {
  // A Knowledge member may not delete a document: the route is its administrator's.
  const member = await refusal(() => h.previews.createPreview(ctx(runner, s, 'knowledgeMember'), 'delete_record', {
    entity_type: 'documents', ref: 'DOC-10',
  }));
  assert.match(member, /knowledge/);

  // A document integrated into a record goes with that record: the screen's 409, no preview.
  const before = await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]);
  const managed = await refusal(() => h.previews.createPreview(ctx(runner, s, 'knowledgeAdmin'), 'delete_record', {
    entity_type: 'documents', ref: 'DOC-3',
  }));
  assert.match(managed, /deleted with their record/);
  assert.equal(await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]), before);
  assert.equal(await count(runner, 'documents', 'tenant_id = $1 AND id = $2', [s.tenantId, s.managedDocument]), 1);

  // A document in a library the person does not read answers as a missing document.
  const outside = await refusal(() => h.support.prepare(ctx(runner, s, 'knowledgeReader'), 'documents', 'DOC-15'));
  assert.match(outside, /Library not found/);

  // Linked families the person does not read stay unnamed, as on the document page.
  const hiddenContext = ctx(runner, s, 'knowledgeAdminNoReads');
  const hidden = await h.previews.createPreview(hiddenContext, 'delete_record', {
    entity_type: 'documents', ref: 'DOC-14',
  });
  const hiddenImpact = String(hidden.changes.deletion.to);
  assert.match(hiddenImpact, /Other links: 2/);
  assert.ok(!hiddenImpact.includes('Links to applications'), hiddenImpact);
  assert.ok(!hiddenImpact.includes('Links to assets'), hiddenImpact);
  await h.previews.rejectPreview(hiddenContext, hidden.preview_id);
  console.log('  document refused to a member, a managed document refused without a preview, a library out of reach reads as missing, unread families unnamed: OK');
}

async function testDocumentDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'knowledgeAdmin');
  const preview = await h.previews.createPreview(context, 'delete_record', {
    entity_type: 'documents', ref: 'DOC-10',
  });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'documents');
  assert.equal(preview.target.entity_id, s.document);
  assert.equal(preview.target.ref, 'DOC-10');
  assert.equal(preview.target.title, 'Operations runbook');
  const impact = String(preview.changes.deletion.to);
  for (const line of [
    'Versions: 2',
    'Attachments: 2',
    'Documents that cite it: 1',
    'Documents it cites: 1',
    'Links to applications: 1',
    'Links to assets: 1',
    'Links to projects: 1',
    'Links to requests: 1',
    'Links to tasks: 1',
    'Links to locations: 1',
    'Links to connections: 1',
    'Links to interfaces: 1',
    'Links to incidents: 1',
    'Documents created from it: 1',
    'In review. The delete remains possible.',
    'Locked for editing by Member Tester. The delete remains possible.',
  ]) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.ok(impact.includes('The linked records stay.'), impact);

  // The delete waits, as every delete: another document cannot be prepared meanwhile.
  assert.match(
    await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'documents', ref: 'DOC-13' })),
    /one at a time/,
  );

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'documents', 'tenant_id = $1 AND id = $2', [s.tenantId, s.document]), 0);
  for (const [table, column] of [
    ['document_versions', 'document_id'],
    ['document_attachments', 'document_id'],
    ['document_references', 'source_document_id'],
    ['document_references', 'target_document_id'],
    ['document_applications', 'document_id'],
    ['document_assets', 'document_id'],
    ['document_projects', 'document_id'],
    ['document_requests', 'document_id'],
    ['document_tasks', 'document_id'],
    ['document_locations', 'document_id'],
    ['document_connections', 'document_id'],
    ['document_interfaces', 'document_id'],
    ['document_incidents', 'document_id'],
    ['document_workflows', 'document_id'],
    ['document_edit_locks', 'document_id'],
  ] as const) {
    assert.equal(await count(runner, table, `tenant_id = $1 AND ${column} = $2`, [s.tenantId, s.document]), 0, table);
  }
  const [derived] = await runner.query(`SELECT template_document_id FROM documents WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.documentDerived]);
  assert.equal(derived.template_document_id, null, 'the derived document keeps its row and loses its template');
  assert.equal(await count(runner, 'documents', 'tenant_id = $1 AND id = $2', [s.tenantId, s.documentDerived]), 1);
  assert.equal(await count(runner, 'documents', 'tenant_id = $1 AND id = $2', [s.tenantId, s.documentCiting]), 1);
  assert.equal(await count(runner, 'documents', 'tenant_id = $1 AND id = $2', [s.tenantId, s.documentCited]), 1);
  const audit = await latestAudit(runner, s.tenantId, 'documents', s.document);
  assert.equal(audit.action, 'delete');
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);

  // A version added after the preview does not move `documents.updated_at`: what the delete takes
  // is recounted, and the run is refused as a changed document.
  const drift = await h.previews.createPreview(context, 'delete_record', { entity_type: 'documents', ref: 'DOC-12' });
  await runner.query(
    `INSERT INTO document_versions (tenant_id, document_id, version_number, title, content_markdown, content_plain)
     VALUES ($1, $2, 1, 'Backup procedure', 'New body.', 'New body.')`,
    [s.tenantId, s.documentCiting],
  );
  const drifted = await h.previews.executePreview(context, drift.preview_id);
  assert.equal(drifted.status, 'failed');
  assert.equal(drifted.error_message, 'Document changed after the preview was created.');
  assert.equal(await count(runner, 'documents', 'tenant_id = $1 AND id = $2', [s.tenantId, s.documentCiting]), 1);
  console.log('  document deleted by its administrator, versions, links and workflow gone, derived document kept without its template, audit names the preview, a version added after the preview refused: OK');
}

async function testReaderRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const message = await refusal(() => h.previews.createPreview(ctx(runner, s, 'reader'), 'delete_record', {
    entity_type: 'locations', ref: 'LOC-2',
  }));
  assert.match(message, /locations/);
  assert.equal(await count(runner, 'locations', 'tenant_id = $1 AND id = $2', [s.tenantId, s.secondLocation]), 1);
  console.log('  reader refused: OK');
}

async function testDriftRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'member');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'locations', ref: 'LOC-2' });
  await runner.query(`UPDATE locations SET name = 'Lyon DC moved', updated_at = clock_timestamp() WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.secondLocation]);
  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'failed');
  assert.equal(executed.error_message, 'Location changed after the preview was created.');
  assert.equal(await count(runner, 'locations', 'tenant_id = $1 AND id = $2', [s.tenantId, s.secondLocation]), 1);
  console.log('  record changed between preview and run refused: OK');
}

async function testOnePendingDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'taskAdmin');
  const first = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-3' });
  assert.equal(first.status, 'pending');
  // While one delete waits, another record's delete is refused: no batch approval deletes two.
  assert.match(
    await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-4' })),
    /one at a time/,
  );
  await h.previews.rejectPreview(context, first.preview_id);
  const next = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-4' });
  assert.equal(next.status, 'pending');
  await h.previews.rejectPreview(context, next.preview_id);
  console.log('  one pending delete at a time, the next once the first is answered: OK');
}

async function testDeleteNeverInPlan(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await count(runner, 'ai_mutation_plans', 'tenant_id = $1', [s.tenantId]);
  await assert.rejects(
    () => h.previews.createMutationPlan(ctx(runner, s, 'taskAdmin'), {
      summary: 'Delete two records.',
      operations: [
        { operation_id: 'task_3', tool_name: 'delete_record', input: { entity_type: 'tasks', ref: 'T-3' } },
        { operation_id: 'task_4', tool_name: 'delete_record', input: { entity_type: 'tasks', ref: 'T-4' } },
      ],
    }),
    /one record at a time and cannot be part of a mutation plan/,
  );
  assert.equal(await count(runner, 'ai_mutation_plans', 'tenant_id = $1', [s.tenantId]), before);
  console.log('  two delete previews never enter a mutation plan: OK');
}

async function testDeleteRecordIsChatOnly(h: Harness, runner: QueryRunner, s: Seed) {
  const chat = await h.tools.listAvailableTools(ctx(runner, s, 'taskAdmin'));
  assert.ok(chat.some((tool: { name: string }) => tool.name === 'delete_record'));
  const mcp = await h.tools.listAvailableTools({ ...ctx(runner, s, 'taskAdmin'), surface: 'mcp' as const, authMethod: 'api_key' as const });
  assert.ok(!mcp.some((tool: { name: string }) => tool.name === 'delete_record'));
  console.log('  delete_record offered on chat only: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testTaskDelete(harness, runner, s);
      await testTaskImpactDriftRefused(harness, runner, s);
      await testOriginTaskRefused(harness, runner, s);
      await testBusinessContributorScope(harness, runner, s);
      await testContactRefusals(harness, runner, s);
      await testContactDelete(harness, runner, s);
      await testLocationDelete(harness, runner, s);
      await testFrozenLineRefused(harness, runner, s);
      await testBudgetLineRefusals(harness, runner, s);
      await testOpexLineDelete(harness, runner, s);
      await testCapexLineDelete(harness, runner, s);
      await testConnectionDelete(harness, runner, s);
      await testInterfaceDelete(harness, runner, s);
      await testDocumentRefusals(harness, runner, s);
      await testDocumentDelete(harness, runner, s);
      await testReaderRefused(harness, runner, s);
      await testDriftRefused(harness, runner, s);
      await testOnePendingDelete(harness, runner, s);
      await testDeleteNeverInPlan(harness, runner, s);
      await testDeleteRecordIsChatOnly(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-delete-record.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
