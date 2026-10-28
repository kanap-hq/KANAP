import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE } from '../ai-write-texts';

// Incidents written through Plaid (L4 lots 2 to 4): creating one, changing its fields, moving its
// status forward up to the closure, setting the confidentiality, then the administrator actions
// (reopen, cancel, lift the confidentiality). Every write goes through `IncidentsService`, under
// a preview the person approves, at the screen's level.
//
// - A contributor creates an incident: INC-n, the reporter, the review document, the audit
//   `source: ai_chat` and the preview's reference; a reader is refused.
// - The category is validated against the tenant's incident categories by code or exact label.
// - An incident is created open or in progress; resolved, closed and cancelled are refused.
// - A field change is undoable; a status change is not (reopening needs an administrator).
// - `open -> closed` warns, stamps closed_at and resolved_at, and freezes the record.
// - A backward status move and a change of a closed record are refused before the preview.
// - A restricted incident that would disappear for the person warns; the write succeeds.
// - Lifting the confidentiality is refused on the field path; a hidden incident reads as missing;
//   a record that becomes hidden between the preview and the approval fails at execution.
// - A plan creates an incident then moves it to in progress through `{{create_incident.ref}}`.
// - A field changed in the database between the preview and the approval gives a drift refusal.
// - An administrator reopens a closed record (timestamps cleared, `reopen` journal, audit) and
//   cancels an editable one (freeze warning, `status_change` journal); the state tool is hidden
//   from contributors and members and refused if the right goes away before the approval.
// - An administrator lifts the confidentiality of an open and of a closed record: `system`
//   journal, audit, and the linked task search index is refreshed. The field path still refuses
//   it and names the new tool.

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

type Harness = {
  app: any;
  dataSource: DataSource;
  tools: any;
  previews: any;
};

type Seed = {
  tenantId: string;
  contributorId: string;
  readerId: string;
  otherId: string;
  memberId: string;
  adminId: string;
  businessContributorId: string;
  noInfrastructureId: string;
  taskMemberId: string;
  incidents: {
    open: string;
    resolved: string;
    closed: string;
    hidden: string;
    ownConfidential: string;
    noReporter: string;
    closedConfidential: string;
  };
  links: {
    applicationMail: string;
    applicationPayroll: string;
    assetPrimary: string;
    assetSecondary: string;
    technology: string;
  };
  taskId: string;
  conversationIds: Record<string, string>;
};

function shortTag() {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tenantId: string, slug: string, name: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES (
       $1, $2, $3, 'active',
       '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
       '{"logo_version":0,"use_logo_in_dark":true}'::jsonb,
       now(), now()
     )`,
    [tenantId, slug, name],
  );
  await setCurrentTenant(runner, tenantId);
  // The managed documents (the incident review slot included), as a created tenant gets them.
  await seedManagedDocsKnowledgeAssets(
    { query: (sql: string, params?: any[]) => runner.query(sql, params) },
    tenantId,
  );
  // Chat readiness resolves through the model registry, as the capability harness does.
  const modelConfigRows = await runner.query(
    `INSERT INTO ai_model_configs (
       tenant_id, name, provider, model, endpoint_url, api_key_encrypted,
       supports_vision, is_default, created_at, updated_at
     )
     VALUES (
       $1, 'incident-write-model', 'custom', 'incident-write-model',
       'https://llm.example.test/v1', 'test-secret', true, true, now(), now()
     )
     RETURNING id`,
    [tenantId],
  );
  await runner.query(
    `INSERT INTO ai_settings (
       tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider,
       llm_endpoint_url, llm_model, llm_api_key_encrypted, web_search_enabled,
       glpi_enabled, chat_model_config_id, created_at, updated_at
     )
     VALUES (
       $1, true, true, 'custom', 'custom',
       'https://llm.example.test/v1', 'incident-write-model', 'test-secret',
       false, false, $2, now(), now()
     )`,
    [tenantId, modelConfigRows[0].id],
  );
}

async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  roleName: string,
  permissions: Record<string, 'reader' | 'contributor' | 'member' | 'admin'>,
) {
  await setCurrentTenant(runner, tenantId);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (
       id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, false, false, now(), now())`,
    [roleId, tenantId, roleName, `${roleName} role`],
  );
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(
      `INSERT INTO role_permissions (
         id, tenant_id, role_id, resource, level, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [randomUUID(), tenantId, roleId, resource, level],
    );
  }
  return roleId;
}

async function seedUser(
  runner: QueryRunner,
  tenantId: string,
  roleId: string,
  email: string,
  firstName: string,
  lastName: string,
  locale: string,
) {
  await setCurrentTenant(runner, tenantId);
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (
       id, tenant_id, first_name, last_name, email, password_hash, role_id,
       mfa_enabled, status, locale, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, null, $6, false, 'enabled', $7, now(), now())`,
    [userId, tenantId, firstName, lastName, email, roleId, locale],
  );
  return userId;
}

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const tag = shortTag();
  const tenantId = randomUUID();
  await seedTenant(runner, tenantId, `ai-incident-write-${tag}`, `AI incident write ${tag}`);

  const contributorRole = await seedRole(runner, tenantId, 'Incident Contributor', {
    ai_chat: 'member',
    incidents: 'contributor',
  });
  const readerRole = await seedRole(runner, tenantId, 'Incident Reader', {
    ai_chat: 'member',
    incidents: 'reader',
  });
  const memberRole = await seedRole(runner, tenantId, 'Incident Member', {
    ai_chat: 'member',
    incidents: 'member',
    users: 'reader',
  });
  const adminRole = await seedRole(runner, tenantId, 'Incident Administrator', {
    ai_chat: 'member',
    incidents: 'admin',
  });
  // The Business Contributor's application scope is their participation (`application_owners`).
  const businessContributorRole = await seedRole(runner, tenantId, 'Business Contributor', {
    ai_chat: 'member',
    incidents: 'contributor',
    applications: 'reader',
    infrastructure: 'reader',
  });
  // Incidents only: no read of the infrastructure, so linking an asset is refused.
  const noInfrastructureRole = await seedRole(runner, tenantId, 'Incident Contributor Without Infrastructure', {
    ai_chat: 'member',
    incidents: 'contributor',
    applications: 'reader',
  });
  // The follow-up task route needs tasks:member; the incident is read by its visibility.
  const taskMemberRole = await seedRole(runner, tenantId, 'Incident Task Member', {
    ai_chat: 'member',
    tasks: 'member',
    incidents: 'contributor',
  });

  const contributorId = await seedUser(runner, tenantId, contributorRole, `inc-write-${tag}@example.test`, 'Luc', 'Bernard', 'fr');
  const readerId = await seedUser(runner, tenantId, readerRole, `inc-read-${tag}@example.test`, 'Ada', 'Martin', 'fr');
  const otherId = await seedUser(runner, tenantId, memberRole, `inc-other-${tag}@example.test`, 'Noa', 'Petit', 'fr');
  const memberId = await seedUser(runner, tenantId, memberRole, `inc-member-${tag}@example.test`, 'Mia', 'Durand', 'fr');
  const adminId = await seedUser(runner, tenantId, adminRole, `inc-admin-${tag}@example.test`, 'Ari', 'Roux', 'fr');
  const businessContributorId = await seedUser(runner, tenantId, businessContributorRole, `inc-bc-${tag}@example.test`, 'Bea', 'Colin', 'fr');
  const noInfrastructureId = await seedUser(runner, tenantId, noInfrastructureRole, `inc-noinfra-${tag}@example.test`, 'Nils', 'Perrin', 'fr');
  const taskMemberId = await seedUser(runner, tenantId, taskMemberRole, `inc-task-${tag}@example.test`, 'Tess', 'Morel', 'fr');

  await setCurrentTenant(runner, tenantId);
  const incident = async (
    itemNumber: number,
    title: string,
    status: string,
    values: { confidential?: boolean; reporter?: string | null; owner?: string } = {},
  ) => {
    const rows = await runner.query(
      `INSERT INTO incidents (
         tenant_id, item_number, title, severity, status, detected_at,
         reporter_user_id, owner_user_id, confidential, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'major', $4, now() - interval '1 day', $5, $6, $7, now(), now())
       RETURNING id`,
      [
        tenantId, itemNumber, title, status,
        values.reporter === undefined ? contributorId : values.reporter,
        values.owner ?? contributorId, values.confidential ?? false,
      ],
    );
    return String(rows[0].id);
  };

  const incidents = {
    open: await incident(4, 'Mail outage', 'open'),
    resolved: await incident(5, 'Mail restored', 'resolved'),
    closed: await incident(6, 'Old outage', 'closed'),
    hidden: await incident(7, 'Hidden outage', 'open', { confidential: true, reporter: otherId, owner: otherId }),
    ownConfidential: await incident(8, 'Restricted outage', 'open', { confidential: true }),
    // No reporter at all, and an owner who is somebody else: rendered confidential by the
    // contributor, the person loses access and the card must warn.
    noReporter: await incident(9, 'Nobody reported it', 'open', { reporter: null, owner: otherId }),
    // A frozen restricted record: the confidentiality route accepts a closed incident.
    closedConfidential: await incident(10, 'Closed restricted outage', 'closed', { confidential: true }),
  };

  // The records the incident links target: one application in the Business Contributor's
  // participation (Mail) and one outside it (Payroll), two assets and one technology.
  const application = async (name: string, reference: string) => {
    const rows = await runner.query(
      `INSERT INTO applications (tenant_id, name, sequential_id, status)
       VALUES ($1, $2, $3, 'enabled') RETURNING id`,
      [tenantId, name, reference],
    );
    return String(rows[0].id);
  };
  const asset = async (name: string, reference: string, hostname: string | null) => {
    const rows = await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, asset_reference, hostname)
       VALUES ($1, $2, 'server', 'prod', $3, $4) RETURNING id`,
      [tenantId, name, reference, hostname],
    );
    return String(rows[0].id);
  };
  const technology = async (name: string, itemNumber: number) => {
    const rows = await runner.query(
      `INSERT INTO technologies (tenant_id, name, item_number)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, name, itemNumber],
    );
    return String(rows[0].id);
  };
  const links = {
    applicationMail: await application('Mail', 'APP-2'),
    applicationPayroll: await application('Payroll', 'APP-3'),
    assetPrimary: await asset('PAR-ESX-01', 'AST-12', 'par-esx-01'),
    assetSecondary: await asset('PAR-ESX-02', 'AST-13', null),
    technology: await technology('PostgreSQL', 3),
  };
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type)
     VALUES ($1, $2, $3, 'business')`,
    [tenantId, links.applicationMail, businessContributorId],
  );
  // The base links the link previews work from: INC-4 names Mail, INC-5 already names AST-12.
  await runner.query(
    `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`,
    [tenantId, incidents.open, links.applicationMail],
  );
  await runner.query(
    `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`,
    [tenantId, incidents.resolved, links.assetPrimary],
  );

  const taskRows = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, status, labels, owner_ids, viewer_ids, created_at, updated_at)
     VALUES ($1, 1, 'Follow-up task', 'open', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())
     RETURNING id`,
    [tenantId],
  );
  const taskId = String(taskRows[0].id);

  // The next references stay above the seeded ones: the identity is what the plans resolve.
  await runner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     VALUES ($1, 'incident', 20), ($1, 'task', 10)
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
    [tenantId],
  );

  return {
    tenantId,
    contributorId,
    readerId,
    otherId,
    memberId,
    adminId,
    businessContributorId,
    noInfrastructureId,
    taskMemberId,
    incidents,
    links,
    taskId,
    conversationIds: {},
  };
}

function context(seed: Seed, runner: QueryRunner, conversationLabel: string, userId = seed.contributorId) {
  const conversationKey = `${userId}:${conversationLabel}`;
  seed.conversationIds[conversationKey] ||= randomUUID();
  return {
    tenantId: seed.tenantId,
    userId,
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    conversationId: seed.conversationIds[conversationKey],
    manager: runner.manager,
  };
}

async function executeToolPreview(
  harness: Harness,
  ctx: any,
  toolName: string,
  input: Record<string, unknown>,
) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (
       id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'AI incident writes integration', 'custom', 'incident-write-model', 'custom', now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, toolName, input) as any;
  assert.equal(preview.status, 'pending');
  assert.equal(preview.requires_confirmation, true);
  return preview;
}

async function approvePreview(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'preview did not execute');
  return executed;
}

async function approveFailingPreview(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'failed', 'the preview must fail at execution');
  return executed;
}

async function expectRejects(fn: () => Promise<unknown>, pattern: RegExp) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'Expected the operation to reject.');
  assert.match(thrown?.message ?? JSON.stringify(thrown?.response ?? thrown), pattern);
}

async function expectRejectsExactly(fn: () => Promise<unknown>, message: string) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'Expected the operation to reject.');
  assert.equal(thrown?.message ?? JSON.stringify(thrown?.response ?? thrown), message);
}

async function withSeededTransaction(
  harness: Harness,
  test: (runner: QueryRunner, seed: Seed) => Promise<void>,
) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const seed = await seedGraph(runner);
    await test(runner, seed);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for ai-incident-writes.integration.spec.ts.');
  }
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
  };
}

async function testContributorCreatesAnIncident(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'create');
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'incidents',
      fields: {
        title: 'Mail outage declared by Plaid',
        severity: 'major',
        category: 'Security',
        owner: 'Noa Petit',
        description: 'Mail is down for the whole company.',
      },
    });
    assert.equal(preview.target.ref, null, 'a creation has no reference before approval');
    const executed = await approvePreview(harness, ctx, preview);
    assert.match(String(executed.target.ref), /^INC-\d+$/, 'the card carries the new INC reference');
    assert.equal(executed.target.entity_id, (await runner.query(
      `SELECT id FROM incidents WHERE tenant_id = $1 AND item_number = $2`,
      [seed.tenantId, Number(String(executed.target.ref).split('-')[1])],
    ))[0].id);

    const [row] = await runner.query(
      `SELECT item_number, title, category, severity, status, reporter_user_id, owner_user_id,
              detected_at, created_by
         FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.equal(row.title, 'Mail outage declared by Plaid');
    assert.equal(row.category, 'security', 'the category is stored as its code');
    assert.equal(row.status, 'open');
    assert.equal(row.reporter_user_id, seed.contributorId, 'the person is the reporter by default');
    assert.equal(row.owner_user_id, seed.otherId, 'the owner was resolved by name');
    assert.ok(row.detected_at instanceof Date, 'detected_at defaults to now');
    assert.equal(row.created_by, seed.contributorId);

    const [review] = await runner.query(
      `SELECT document_id FROM integrated_document_bindings
        WHERE tenant_id = $1 AND source_entity_type = 'incidents' AND source_entity_id = $2 AND slot_key = 'review'`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.ok(review?.document_id, 'the review document is provisioned with the incident');

    const [audit] = await runner.query(
      `SELECT table_name, action, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.deepEqual(
      { table: audit.table_name, action: audit.action, source: audit.source, sourceRef: audit.source_ref },
      { table: 'incidents', action: 'create', source: 'ai_chat', sourceRef: preview.preview_id },
      'the audit names the assistant and the preview',
    );

    // A reader who can ask questions but not write incidents is not offered the tool, and the
    // preview route refuses with the exact contributor-level message.
    const readerCtx = context(seed, runner, 'reader', seed.readerId);
    await expectRejectsExactly(
      () => harness.tools.execute(readerCtx, 'create_business_record', {
        entity_type: 'incidents', fields: { title: 'Reader incident', severity: 'minor' },
      }),
      'AI tool is not available.',
    );
    await expectRejectsExactly(
      () => harness.previews.createPreview(readerCtx, 'create_business_record', {
        entity_type: 'incidents', fields: { title: 'Reader incident', severity: 'minor' },
      }),
      'You need the right to contribute to incidents, which your role does not give. An administrator can add it to your role.',
    );
  });
}

async function testCategoryIsResolvedByCodeOrLabel(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'category');
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: 'incidents',
        fields: { title: 'Unknown category', severity: 'minor', category: 'Nope' },
      }),
      /Unknown incident category "Nope"\. Valid incident categories: .*Security/,
    );
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'incidents',
      fields: { title: 'Security incident', severity: 'major', category: 'Security' },
    });
    assert.equal(preview.changes.category.to, 'security');
    const executed = await approvePreview(harness, ctx, preview);
    const [row] = await runner.query(`SELECT category FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, executed.target.entity_id]);
    assert.equal(row.category, 'security');
  });
}

async function testCreationStatusesAreOpenOrInProgress(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'create-status');
    for (const status of ['resolved', 'closed']) {
      await expectRejects(
        () => executeToolPreview(harness, ctx, 'create_business_record', {
          entity_type: 'incidents', fields: { title: 'Already done', severity: 'minor', status },
        }),
        /created open or in progress/,
      );
    }
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: 'incidents', fields: { title: 'Cancelled', severity: 'minor', status: 'cancelled' },
      }),
      /Cancelling an incident is a separate action/,
    );
    // In progress is accepted at creation, without inventing a resolution step.
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'incidents', fields: { title: 'Already started', severity: 'minor', status: 'in_progress' },
    });
    assert.equal(preview.changes.status.to, 'in_progress');
    const executed = await approvePreview(harness, ctx, preview);
    const [row] = await runner.query(`SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, executed.target.entity_id]);
    assert.equal(row.status, 'in_progress');
  });
}

async function testFieldChangeIsUndoable(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'undo');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents',
      ref: 'INC-4',
      fields: { title: 'Mail outage resolved', severity: 'minor' },
    });
    assert.deepEqual(Object.keys(preview.changes), ['title', 'severity']);
    await approvePreview(harness, ctx, preview);
    let [row] = await runner.query(`SELECT title, severity FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.incidents.open]);
    assert.deepEqual(row, { title: 'Mail outage resolved', severity: 'minor' });

    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    assert.equal(undo.status, 'pending');
    await approvePreview(harness, ctx, undo);
    [row] = await runner.query(`SELECT title, severity FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.incidents.open]);
    assert.deepEqual(row, { title: 'Mail outage', severity: 'major' });
  });
}

async function testClosureWarnsAndIsNotUndoable(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'closure');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents', ref: 'INC-4', fields: { status: 'closed' },
    });
    assert.equal(preview.changes.status.from, 'open');
    assert.equal(preview.changes.status.to, 'closed');
    assert.equal(
      preview.changes.closure_warning.to,
      "Cette clôture fige l'incident : seul un administrateur pourra le rouvrir.",
      'the card says the record freezes',
    );
    const executed = await approvePreview(harness, ctx, preview);
    assert.equal(executed.target.ref, 'INC-4');
    const [row] = await runner.query(
      `SELECT status, closed_at, resolved_at FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(row.status, 'closed');
    assert.ok(row.closed_at instanceof Date, 'closed_at is stamped');
    assert.ok(row.resolved_at instanceof Date, 'resolved_at is stamped by the closure');
    await expectRejects(
      () => harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }),
      /status change cannot be undone|needs an administrator/,
    );
  });
}

async function testBackwardStatusAndFrozenRecordAreRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'refusals');
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'incidents', ref: 'INC-5', fields: { status: 'open' },
      }),
      /Status cannot move backwards/,
    );
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'incidents', ref: 'INC-6', fields: { title: 'After the closure' },
      }),
      /This incident is closed\. Reopen it to make changes/,
    );
  });
}

async function testConfidentialityWarnsOnLostAccess(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'confidential');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents',
      ref: 'INC-4',
      fields: { confidential: true, reporter: 'Noa Petit', owner: 'Noa Petit' },
    });
    assert.equal(
      preview.changes.access_warning.to,
      "Après cette modification, seuls les administrateurs du registre, le déclarant et le responsable pourront l'ouvrir. Vous serez renvoyé vers le registre.",
    );
    const executed = await approvePreview(harness, ctx, preview);
    const [row] = await runner.query(
      `SELECT confidential, reporter_user_id, owner_user_id FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.deepEqual(row, { confidential: true, reporter_user_id: seed.otherId, owner_user_id: seed.otherId });
  });
}

async function testLiftingConfidentialityIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'lift');
    // The field path refuses it and points to the incident screen, where the administrator acts.
    await expectRejectsExactly(
      () => executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'incidents', ref: 'INC-8', fields: { confidential: false },
      }),
      'Lifting the confidentiality needs a register administrator: use the incident screen.',
    );
  });
}

async function testHiddenIncidentReadsAsMissing(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'hidden');
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'incidents', ref: 'INC-7', fields: { title: 'Never written' },
      }),
      /No incidents found matching "INC-7"/,
    );
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'incidents', ref: seed.incidents.hidden, fields: { title: 'Never written either' },
      }),
      /No incidents found matching/,
    );
  });
}

async function testIncidentHiddenBetweenPreviewAndApprovalFails(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'hidden-between');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents', ref: 'INC-4', fields: { description: 'Written before the change' },
    });
    await runner.query(
      `UPDATE incidents SET confidential = true, reporter_user_id = $3, owner_user_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.open, seed.otherId],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.match(String(failed.error_message), /Incident not found/);
    const [row] = await runner.query(`SELECT description FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.incidents.open]);
    assert.notEqual(row.description, 'Written before the change');
  });
}

async function testPlanCreatesThenMovesTheIncident(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'plan');
    await ctx.manager.query(
      `INSERT INTO ai_conversations (
         id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'AI incident plan', 'custom', 'incident-write-model', 'custom', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [ctx.conversationId, ctx.tenantId, ctx.userId],
    );
    const plan = await harness.tools.execute(ctx, 'prepare_mutation_plan', {
      summary: 'Create the incident, then start it',
      operations: [
        {
          operation_id: 'create_incident',
          tool_name: 'create_business_record',
          input: {
            entity_type: 'incidents',
            fields: { title: 'Plan incident', severity: 'major' },
          },
        },
        {
          operation_id: 'start_incident',
          tool_name: 'update_business_record',
          depends_on: ['create_incident'],
          input: {
            entity_type: 'incidents',
            ref: '{{create_incident.ref}}',
            fields: { status: 'in_progress' },
          },
        },
      ],
    }) as any;
    assert.equal(plan.previews.length, 1, 'the dependent step waits for the creation');
    assert.equal(plan.deferred.length, 1);
    const created = await approvePreview(harness, ctx, plan.previews[0]);
    assert.match(String(created.target.ref), /^INC-\d+$/);
    const previews = await harness.previews.listConversationPreviews(ctx, ctx.conversationId) as any[];
    const started = previews.find((preview: any) => preview.target.ref === created.target.ref && preview.status === 'pending');
    assert.ok(started, 'the deferred step is prepared once the creation ran');
    assert.equal(started.changes.status.to, 'in_progress');
    await approvePreview(harness, ctx, started);
    const [row] = await runner.query(`SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, created.target.entity_id]);
    assert.equal(row.status, 'in_progress');
  });
}

async function testReviewLockIsRelayed(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'review-lock');
    // The incident needs its review document to lock: create one through the tool.
    const creation = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'incidents',
      fields: { title: 'Incident with a locked review', severity: 'minor' },
    });
    const created = await approvePreview(harness, ctx, creation);
    const [binding] = await runner.query(
      `SELECT document_id FROM integrated_document_bindings
        WHERE tenant_id = $1 AND source_entity_type = 'incidents' AND source_entity_id = $2 AND slot_key = 'review'`,
      [seed.tenantId, created.target.entity_id],
    );
    await runner.query(
      `INSERT INTO document_edit_locks (tenant_id, document_id, holder_user_id, lock_token_hash, expires_at)
       VALUES ($1, $2, $3, 'another-user-token', now() + interval '1 hour')`,
      [seed.tenantId, binding.document_id, seed.otherId],
    );
    const closure = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents', ref: String(created.target.ref), fields: { status: 'closed' },
    });
    const failed = await approveFailingPreview(harness, ctx, closure);
    assert.equal(
      failed.error_message,
      'La revue de l\'incident est en cours de modification par une autre personne : rien n\'a été modifié. Réessayez quand cette modification sera enregistrée ou son verrou levé.',
      'the 423 is relayed as a readable sentence in the person\'s language',
    );
    assert.ok(PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE.startsWith('The incident review is being edited'));
    const [row] = await runner.query(`SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, created.target.entity_id]);
    assert.equal(row.status, 'open', 'the failed closure wrote nothing');
  });
}

async function testDriftIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'drift');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents', ref: 'INC-4', fields: { title: 'Preview title' },
    });
    await runner.query(`UPDATE incidents SET title = 'Changed elsewhere' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.incidents.open]);
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.match(String(failed.error_message), /Title changed after the preview was created/);
    const [row] = await runner.query(`SELECT title FROM incidents WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.incidents.open]);
    assert.equal(row.title, 'Changed elsewhere', 'nothing of the preview is written');
  });
}

async function testIncidentStateDriftIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'state-drift', seed.adminId);
    const preview = await executeToolPreview(harness, ctx, 'change_incident_state', {
      ref: 'INC-4', action: 'cancel', reason: 'Before the drift',
    });
    await runner.query(
      `UPDATE incidents SET status = 'in_progress' WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.match(String(failed.error_message), /INC-4 changed after the preview was created/);
    const [row] = await runner.query(
      `SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(row.status, 'in_progress', 'the refused cancellation wrote nothing');
  });
}

async function testConfidentialityDriftIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'confidentiality-drift', seed.adminId);
    const preview = await executeToolPreview(harness, ctx, 'set_incident_confidentiality', {
      ref: 'INC-8', confidential: false,
    });
    // The flag was lifted elsewhere: the preview would write nothing and must not read executed.
    await runner.query(
      `UPDATE incidents SET confidential = false WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.ownConfidential],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.match(String(failed.error_message), /INC-8 changed after the preview was created/);
    assert.equal(failed.status, 'failed');
    const [row] = await runner.query(
      `SELECT confidential FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.ownConfidential],
    );
    assert.equal(row.confidential, false);
    const audits = await runner.query(
      `SELECT 1 FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND source = 'ai_chat' AND source_ref = $3`,
      [seed.tenantId, seed.incidents.ownConfidential, preview.preview_id],
    );
    assert.equal(audits.length, 0, 'the refused execution wrote no audit row');
  });
}

async function testReporterFallbackOnlyOnCreate(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'no-reporter');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents', ref: 'INC-9', fields: { confidential: true },
    });
    assert.equal(
      preview.changes.access_warning.to,
      "Après cette modification, seuls les administrateurs du registre, le déclarant et le responsable pourront l'ouvrir. Vous serez renvoyé vers le registre.",
      'an incident without a reporter does not fall back to the person on update',
    );
    await approvePreview(harness, ctx, preview);
    const [row] = await runner.query(
      `SELECT confidential, reporter_user_id FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.noReporter],
    );
    assert.equal(row.confidential, true);
    assert.equal(row.reporter_user_id, null, 'the missing reporter stays missing');
  });
}

async function testDetectedAtCannotBeCleared(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'detected-null');
    await expectRejectsExactly(
      () => executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'incidents', ref: 'INC-4', fields: { detected_at: null },
      }),
      'Detected cannot be empty.',
    );
    await expectRejectsExactly(
      () => executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: 'incidents', fields: { title: 'No detection', severity: 'minor', detected_at: null },
      }),
      'Detected cannot be empty.',
    );
  });
}

async function testDeprecatedIncidentCategory(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'deprecated-category');
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'incidents',
      fields: { title: 'Security incident', severity: 'major', category: 'Security' },
    });
    const executed = await approvePreview(harness, ctx, preview);
    await runner.query(
      `UPDATE tenants
          SET metadata = jsonb_set(
            jsonb_set(metadata, '{it_ops}', COALESCE(metadata->'it_ops', '{}'::jsonb), true),
            '{it_ops,incident_categories}',
            $2::jsonb,
            true
          )
        WHERE id = $1`,
      [seed.tenantId, JSON.stringify([
        { code: 'security', label: 'Security', deprecated: true },
        { code: 'infrastructure', label: 'Infrastructure' },
      ])],
    );

    // A new value cannot take a deprecated category, and the refusal does not list it.
    await expectRejectsExactly(
      () => executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: 'incidents',
        fields: { title: 'Another security incident', severity: 'minor', category: 'Security' },
      }),
      'Unknown incident category "Security". Valid incident categories: Infrastructure.',
    );

    // The record that already holds it can keep it while another field changes.
    const update = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents',
      ref: String(executed.target.ref),
      fields: { title: 'Security incident kept', category: 'Security' },
    });
    assert.equal(update.changes.category, undefined, 'the unchanged category is not a change');
    await approvePreview(harness, ctx, update);
    const [row] = await runner.query(
      `SELECT title, category FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.deepEqual(row, { title: 'Security incident kept', category: 'security' });

    // Undoing a move away from the retired category would restore it: the screen refuses the
    // same way, but the sentence names the original value instead of "Unknown category".
    const moved = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents',
      ref: String(executed.target.ref),
      fields: { category: 'Infrastructure' },
    });
    assert.equal(moved.changes.category.to, 'infrastructure');
    await approvePreview(harness, ctx, moved);
    await expectRejectsExactly(
      () => harness.tools.execute(ctx, 'undo_preview', { preview_id: moved.preview_id }),
      'The incident\'s original category "Security" was removed; choose an active category.',
    );
    const [afterUndo] = await runner.query(
      `SELECT category FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.equal(afterUndo.category, 'infrastructure', 'the refused undo restored the retired category');
  });
}

async function testMemberAndAdminAreAccepted(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const memberCtx = context(seed, runner, 'member', seed.memberId);
    const memberPreview = await executeToolPreview(harness, memberCtx, 'create_business_record', {
      entity_type: 'incidents',
      fields: { title: 'Incident logged by a member', severity: 'minor' },
    });
    const created = await approvePreview(harness, memberCtx, memberPreview);
    assert.match(String(created.target.ref), /^INC-\d+$/);

    const adminCtx = context(seed, runner, 'admin', seed.adminId);
    const note = await executeToolPreview(harness, adminCtx, 'add_incident_note', {
      ref: 'INC-4',
      content: 'Administrator note.',
    });
    await approvePreview(harness, adminCtx, note);
    const [entry] = await runner.query(
      `SELECT author_id FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'note'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(entry.author_id, seed.adminId);
  });
}

async function testRoleDowngradedBetweenPreviewAndApprovalIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'downgrade');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'incidents', ref: 'INC-4', fields: { description: 'Written before the downgrade' },
    });
    await runner.query(
      `UPDATE role_permissions SET level = 'reader'
        WHERE tenant_id = $1 AND resource = 'incidents'
          AND role_id = (SELECT role_id FROM users WHERE tenant_id = $1 AND id = $2)`,
      [seed.tenantId, seed.contributorId],
    );
    await expectRejectsExactly(
      () => harness.previews.executePreview(ctx, preview.preview_id),
      'You need the right to contribute to incidents, which your role does not give. An administrator can add it to your role.',
    );
    const [row] = await runner.query(
      `SELECT description FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.notEqual(row.description, 'Written before the downgrade', 'the refused approval wrote nothing');
  });
}

async function testAdminReopensAClosedIncident(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'reopen', seed.adminId);
    await runner.query(
      `UPDATE incidents SET resolved_at = now(), closed_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.closed],
    );
    const preview = await executeToolPreview(harness, ctx, 'change_incident_state', {
      ref: 'INC-6',
      action: 'reopen',
      reason: 'Mail is down again.',
    });
    assert.equal(preview.summary, "Réouverture de l'incident « INC-6 - Old outage ».");
    assert.equal(preview.changes.status.from, 'closed');
    assert.equal(preview.changes.status.to, 'in_progress');
    assert.equal(preview.changes.reason.to, 'Mail is down again.');
    assert.equal(preview.changes.reason.label, 'Raison');
    assert.equal(preview.changes.closure_warning, undefined);
    const executed = await approvePreview(harness, ctx, preview);
    assert.equal(executed.target.ref, 'INC-6');
    assert.equal(executed.status, 'executed');

    const [row] = await runner.query(
      `SELECT status, resolved_at, closed_at FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.closed],
    );
    assert.deepEqual(row, { status: 'in_progress', resolved_at: null, closed_at: null });

    const [entry] = await runner.query(
      `SELECT kind, content, changed_fields, author_id FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'reopen'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.closed],
    );
    assert.equal(entry.kind, 'reopen');
    assert.equal(entry.content, 'Mail is down again.');
    assert.equal(entry.author_id, seed.adminId);
    assert.deepEqual(entry.changed_fields.status, { from: 'closed', to: 'in_progress' });

    const [audit] = await runner.query(
      `SELECT table_name, action, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.closed],
    );
    assert.deepEqual(
      { table: audit.table_name, action: audit.action, source: audit.source, sourceRef: audit.source_ref },
      { table: 'incidents', action: 'update', source: 'ai_chat', sourceRef: preview.preview_id },
    );

    // The state tool has no reversal preview.
    await expectRejects(
      () => harness.previews.createReversePreview(ctx, preview.preview_id),
      /Undo is not supported for this preview type/,
    );
  });
}

async function testIncidentStateRightsAndRefusals(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const adminCtx = context(seed, runner, 'state-admin', seed.adminId);
    const contributorCtx = context(seed, runner, 'state-contributor');
    const memberCtx = context(seed, runner, 'state-member', seed.memberId);
    const adminTools = (await harness.tools.listAvailableTools(adminCtx) as any[]).map((tool) => tool.name);
    assert.ok(adminTools.includes('change_incident_state'), 'the admin is offered the state tool');
    assert.ok(adminTools.includes('set_incident_confidentiality'), 'the admin is offered the confidentiality tool');
    for (const [role, ctx] of [['contributor', contributorCtx], ['member', memberCtx]] as const) {
      const tools = (await harness.tools.listAvailableTools(ctx) as any[]).map((tool) => tool.name);
      assert.equal(tools.includes('change_incident_state'), false, `${role}: no state tool`);
      assert.equal(tools.includes('set_incident_confidentiality'), false, `${role}: no confidentiality tool`);
      await expectRejectsExactly(
        () => harness.tools.execute(ctx, 'change_incident_state', { ref: 'INC-6', action: 'reopen', reason: 'Again' }),
        'AI tool is not available.',
      );
      await expectRejectsExactly(
        () => harness.previews.createPreview(ctx, 'change_incident_state', { ref: 'INC-6', action: 'reopen', reason: 'Again' }),
        'You need the right to administer incidents, which your role does not give. An administrator can add it to your role.',
      );
    }

    // Reopening an open incident is refused before the preview, with the service's sentence.
    await expectRejectsExactly(
      () => executeToolPreview(harness, adminCtx, 'change_incident_state', {
        ref: 'INC-4', action: 'reopen', reason: 'Not needed',
      }),
      'Only resolved, closed or cancelled incidents can be reopened.',
    );
    // An empty reason never reaches a preview.
    await expectRejects(
      () => executeToolPreview(harness, adminCtx, 'change_incident_state', {
        ref: 'INC-6', action: 'reopen', reason: '   ',
      }),
      /Invalid input for change_incident_state|Reason is required/,
    );
    // A reference that matches nothing reads as missing. A register administrator sees every
    // restricted incident (the viewer's `isAdmin`), so a confidential record is not hidden here.
    await expectRejectsExactly(
      () => executeToolPreview(harness, adminCtx, 'change_incident_state', {
        ref: 'INC-99', action: 'reopen', reason: 'Missing',
      }),
      'No incidents found matching "INC-99".',
    );
    // Cancelling a frozen record is refused before the preview.
    await expectRejectsExactly(
      () => executeToolPreview(harness, adminCtx, 'change_incident_state', {
        ref: 'INC-6', action: 'cancel', reason: 'Frozen',
      }),
      'This incident is closed. Reopen it to make changes.',
    );
  });
}

async function testAdminCancelsAnIncident(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'cancel', seed.adminId);
    const preview = await executeToolPreview(harness, ctx, 'change_incident_state', {
      ref: 'INC-4',
      action: 'cancel',
      reason: 'Duplicate of INC-6.',
    });
    assert.equal(preview.summary, "Annulation de l'incident « INC-4 - Mail outage ».");
    assert.equal(preview.changes.status.from, 'open');
    assert.equal(preview.changes.status.to, 'cancelled');
    assert.equal(preview.changes.reason.to, 'Duplicate of INC-6.');
    assert.equal(preview.changes.closure_warning, undefined);
    assert.equal(
      preview.changes.cancel_warning.to,
      "Cette annulation fige l'incident : seul un administrateur pourra le rouvrir.",
      'a cancellation carries its own freeze warning',
    );
    const executed = await approvePreview(harness, ctx, preview);
    assert.equal(executed.status, 'executed');

    const [row] = await runner.query(
      `SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(row.status, 'cancelled');
    const [entry] = await runner.query(
      `SELECT kind, content, changed_fields, author_id FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'status_change'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(entry.content, 'Duplicate of INC-6.');
    assert.equal(entry.author_id, seed.adminId);
    assert.deepEqual(entry.changed_fields.status, { from: 'open', to: 'cancelled' });
    const [audit] = await runner.query(
      `SELECT source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.deepEqual({ source: audit.source, sourceRef: audit.source_ref }, { source: 'ai_chat', sourceRef: preview.preview_id });
  });
}

async function testIncidentStateDowngradeBetweenPreviewAndApprovalIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'state-downgrade', seed.adminId);
    const preview = await executeToolPreview(harness, ctx, 'change_incident_state', {
      ref: 'INC-4', action: 'cancel', reason: 'Before the downgrade',
    });
    await runner.query(
      `UPDATE role_permissions SET level = 'contributor'
        WHERE tenant_id = $1 AND resource = 'incidents'
          AND role_id = (SELECT role_id FROM users WHERE tenant_id = $1 AND id = $2)`,
      [seed.tenantId, seed.adminId],
    );
    await expectRejectsExactly(
      () => harness.previews.executePreview(ctx, preview.preview_id),
      'You need the right to administer incidents, which your role does not give. An administrator can add it to your role.',
    );
    const [row] = await runner.query(
      `SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(row.status, 'open', 'the refused approval wrote nothing');
  });
}

async function testCancelReviewLockIsRelayed(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'cancel-lock', seed.adminId);
    const creation = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'incidents',
      fields: { title: 'Incident with a locked review', severity: 'minor' },
    });
    const created = await approvePreview(harness, ctx, creation);
    const [binding] = await runner.query(
      `SELECT document_id FROM integrated_document_bindings
        WHERE tenant_id = $1 AND source_entity_type = 'incidents' AND source_entity_id = $2 AND slot_key = 'review'`,
      [seed.tenantId, created.target.entity_id],
    );
    await runner.query(
      `INSERT INTO document_edit_locks (tenant_id, document_id, holder_user_id, lock_token_hash, expires_at)
       VALUES ($1, $2, $3, 'another-user-token', now() + interval '1 hour')`,
      [seed.tenantId, binding.document_id, seed.otherId],
    );
    const cancellation = await executeToolPreview(harness, ctx, 'change_incident_state', {
      ref: String(created.target.ref), action: 'cancel', reason: 'Duplicate.',
    });
    const failed = await approveFailingPreview(harness, ctx, cancellation);
    assert.equal(
      failed.error_message,
      'La revue de l\'incident est en cours de modification par une autre personne : rien n\'a été modifié. Réessayez quand cette modification sera enregistrée ou son verrou levé.',
      'the 423 of the review lock is relayed as at the closure',
    );
    const [row] = await runner.query(
      `SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, created.target.entity_id],
    );
    assert.equal(row.status, 'open', 'the failed cancellation wrote nothing');
  });
}

async function testAdminLiftsConfidentialityOnOpenAndClosed(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'confidentiality-admin', seed.adminId);
    const linkedTask = async (itemNumber: number, title: string, incidentId: string) => {
      const rows = await runner.query(
        `INSERT INTO tasks (
           tenant_id, item_number, title, status, labels, owner_ids, viewer_ids,
           related_object_type, related_object_id, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'open', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'incident', $4, now(), now())
         RETURNING id`,
        [seed.tenantId, itemNumber, title, incidentId],
      );
      const id = String(rows[0].id);
      // The refresh is what puts the task back in the search index.
      await runner.query(
        `DELETE FROM search_index WHERE tenant_id = $1 AND entity_type = 'tasks' AND entity_id = $2`,
        [seed.tenantId, id],
      );
      return id;
    };
    const indexed = async (taskId: string) => (await runner.query(
      `SELECT 1 FROM search_index WHERE tenant_id = $1 AND entity_type = 'tasks' AND entity_id = $2`,
      [seed.tenantId, taskId],
    )).length === 1;

    // An open restricted incident.
    const openTask = await linkedTask(2, 'Open restricted follow-up', seed.incidents.ownConfidential);
    assert.equal(await indexed(openTask), false, 'the task starts outside the search index');
    const openPreview = await executeToolPreview(harness, ctx, 'set_incident_confidentiality', {
      ref: 'INC-8', confidential: false,
    });
    assert.equal(openPreview.summary, "Levée de la confidentialité de l'incident « INC-8 - Restricted outage ».");
    assert.equal(openPreview.changes.confidential.from, 'Yes');
    assert.equal(openPreview.changes.confidential.to, 'No');
    assert.equal(openPreview.changes.access_warning, undefined);
    await approvePreview(harness, ctx, openPreview);
    const [openRow] = await runner.query(
      `SELECT confidential, status FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.ownConfidential],
    );
    assert.deepEqual(openRow, { confidential: false, status: 'open' });
    const [openEntry] = await runner.query(
      `SELECT kind, changed_fields FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'system'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.ownConfidential],
    );
    assert.equal(openEntry.kind, 'system');
    assert.deepEqual(openEntry.changed_fields.confidential, { from: true, to: false });
    assert.equal(await indexed(openTask), true, 'lifting the confidentiality refreshed the linked task index');
    const [openAudit] = await runner.query(
      `SELECT source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.ownConfidential],
    );
    assert.deepEqual(
      { source: openAudit.source, sourceRef: openAudit.source_ref },
      { source: 'ai_chat', sourceRef: openPreview.preview_id },
    );

    // A closed restricted incident: the confidence route accepts a frozen record.
    const closedTask = await linkedTask(3, 'Closed restricted follow-up', seed.incidents.closedConfidential);
    assert.equal(await indexed(closedTask), false);
    const closedPreview = await executeToolPreview(harness, ctx, 'set_incident_confidentiality', {
      ref: 'INC-10', confidential: false,
    });
    assert.equal(closedPreview.summary, "Levée de la confidentialité de l'incident « INC-10 - Closed restricted outage ».");
    await approvePreview(harness, ctx, closedPreview);
    const [closedRow] = await runner.query(
      `SELECT confidential, status FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.incidents.closedConfidential],
    );
    assert.deepEqual(closedRow, { confidential: false, status: 'closed' }, 'a closed record accepts the lift');
    assert.equal(await indexed(closedTask), true, 'the closed record refreshed its linked task index');
    const [closedEntry] = await runner.query(
      `SELECT kind, changed_fields FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'system'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.closedConfidential],
    );
    assert.equal(closedEntry.kind, 'system');
    assert.deepEqual(closedEntry.changed_fields.confidential, { from: true, to: false });
  });
}

async function testContributorIsRefusedConfidentiality(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'confidentiality-contributor');
    await expectRejectsExactly(
      () => harness.previews.createPreview(ctx, 'set_incident_confidentiality', {
        ref: 'INC-8', confidential: false,
      }),
      'You need the right to administer incidents, which your role does not give. An administrator can add it to your role.',
    );
    await expectRejectsExactly(
      () => harness.tools.execute(ctx, 'set_incident_confidentiality', {
        ref: 'INC-8', confidential: false,
      }),
      'AI tool is not available.',
    );
  });
}

async function testContributorAddsANote(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'note');
    const content = '13:05 failover to the secondary site.\nMail is back for 40 users.';
    const preview = await executeToolPreview(harness, ctx, 'add_incident_note', {
      ref: 'INC-4',
      content,
      occurred_at: '2026-10-27T13:05:00+02:00',
    });
    assert.equal(preview.changes.note.to, content);
    assert.equal(preview.changes.occurred_at.to, '2026-10-27T11:05:00.000Z');
    const executed = await approvePreview(harness, ctx, preview);
    assert.equal(executed.target.ref, 'INC-4');

    const [entry] = await runner.query(
      `SELECT id, kind, content, author_id, occurred_at FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'note'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(entry.kind, 'note');
    assert.equal(entry.content, content);
    assert.equal(entry.author_id, seed.contributorId);
    assert.equal(new Date(entry.occurred_at).toISOString(), '2026-10-27T11:05:00.000Z');

    // The journal is the trace: the note service writes no audit row of its own.
    const audits = await runner.query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'incident_entries'`,
      [seed.tenantId, entry.id],
    );
    assert.equal(audits.length, 0);

    // The journal only takes additions: the operation has no reversal preview.
    await expectRejects(
      () => harness.previews.createReversePreview(ctx, preview.preview_id),
      /Undo is not supported for this preview type/,
    );
  });
}

async function testNoteRefusals(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const readerCtx = context(seed, runner, 'note-reader', seed.readerId);
    await expectRejectsExactly(
      () => harness.previews.createPreview(readerCtx, 'add_incident_note', { ref: 'INC-4', content: 'Reader note' }),
      'You need the right to contribute to incidents, which your role does not give. An administrator can add it to your role.',
    );

    const ctx = context(seed, runner, 'note-refusals');
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'add_incident_note', { ref: 'INC-6', content: 'After closure' }),
      /This incident is closed\. Reopen it to make changes/,
    );
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'add_incident_note', { ref: 'INC-7', content: 'Never written' }),
      /No incidents found matching "INC-7"/,
    );
  });
}

async function testLinksPreviewExecutionAndUndo(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'links', seed.businessContributorId);
    const preview = await executeToolPreview(harness, ctx, 'update_incident_links', {
      ref: 'INC-4',
      assets: { add: ['AST-12'] },
      technologies: { add: ['TEC-3'] },
      applications: { remove: ['APP-2'] },
    });
    assert.equal(preview.changes.linked_assets.to, '**Ajoutés**\n- AST-12 - PAR-ESX-01');
    assert.equal(preview.changes.linked_applications.to, '**Retirés**\n- APP-2 - Mail');
    assert.equal(preview.changes.linked_technologies.to, '**Ajoutés**\n- TEC-3 - PostgreSQL');
    await approvePreview(harness, ctx, preview);

    const assets = await runner.query(
      `SELECT a.asset_reference FROM incident_assets l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.incident_id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.deepEqual(assets.map((row: any) => row.asset_reference), ['AST-12']);
    const applications = await runner.query(
      `SELECT 1 FROM incident_applications WHERE tenant_id = $1 AND incident_id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(applications.length, 0, 'the application was unlinked');
    const technologies = await runner.query(
      `SELECT t.name FROM incident_technologies l
         JOIN technologies t ON t.id = l.technology_id AND t.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.incident_id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.deepEqual(technologies.map((row: any) => row.name), ['PostgreSQL']);

    const entries = await runner.query(
      `SELECT changed_fields FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'link_change'
        ORDER BY created_at, id`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(entries.length, 3, 'one link_change entry per link');
    assert.deepEqual(
      entries.map((row: any) => Object.keys(row.changed_fields)[0]).sort(),
      ['applications', 'assets', 'technologies'],
    );
    const audits = await runner.query(
      `SELECT table_name, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND source = 'ai_chat'
          AND table_name IN ('incident_assets', 'incident_applications', 'incident_technologies')
        ORDER BY table_name`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.deepEqual(
      audits.map((row: any) => ({ table: row.table_name, source: row.source, sourceRef: row.source_ref })),
      [
        { table: 'incident_applications', source: 'ai_chat', sourceRef: preview.preview_id },
        { table: 'incident_assets', source: 'ai_chat', sourceRef: preview.preview_id },
        { table: 'incident_technologies', source: 'ai_chat', sourceRef: preview.preview_id },
      ],
    );

    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    assert.equal(undo.status, 'pending');
    assert.equal(undo.changes.linked_applications.to, '**Ajoutés**\n- APP-2 - Mail');
    assert.equal(undo.changes.linked_assets.to, '**Retirés**\n- AST-12 - PAR-ESX-01');
    await approvePreview(harness, ctx, undo);

    const restored = await runner.query(
      `SELECT a.asset_reference FROM incident_assets l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.incident_id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(restored.length, 0, 'the undo removed the added asset');
    const restoredApps = await runner.query(
      `SELECT app.sequential_id FROM incident_applications l
         JOIN applications app ON app.id = l.application_id AND app.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.incident_id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.deepEqual(restoredApps.map((row: any) => row.sequential_id), ['APP-2'], 'the undo restored the removed application');
    const restoredTech = await runner.query(
      `SELECT 1 FROM incident_technologies WHERE tenant_id = $1 AND incident_id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(restoredTech.length, 0, 'the undo removed the added technology');
  });
}

async function testAlreadyLinkedAndAbsentLinksWriteNothing(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'links-noop', seed.businessContributorId);
    const before = await runner.query(
      `SELECT 1 FROM incident_assets WHERE tenant_id = $1 AND incident_id = $2`,
      [seed.tenantId, seed.incidents.resolved],
    );
    assert.equal(before.length, 1, 'the seed links AST-12 to INC-5');
    // All the requested links are already linked or already absent: no card is created.
    await expectRejectsExactly(
      () => executeToolPreview(harness, ctx, 'update_incident_links', {
        ref: 'INC-5',
        assets: { add: ['AST-12'] },
        applications: { remove: ['APP-2'] },
      }),
      'Nothing to change: AST-12 - PAR-ESX-01 is already linked; APP-2 - Mail is not linked.',
    );

    const after = await runner.query(
      `SELECT 1 FROM incident_assets WHERE tenant_id = $1 AND incident_id = $2`,
      [seed.tenantId, seed.incidents.resolved],
    );
    assert.equal(after.length, 1, 'nothing was written for a link already present');
    const entries = await runner.query(
      `SELECT 1 FROM incident_entries WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'link_change'`,
      [seed.tenantId, seed.incidents.resolved],
    );
    assert.equal(entries.length, 0, 'no journal entry for a no-op link');
    const audits = await runner.query(
      `SELECT 1 FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2
          AND table_name IN ('incident_assets', 'incident_applications')`,
      [seed.tenantId, seed.incidents.resolved],
    );
    assert.equal(audits.length, 0, 'no audit row for a no-op link');
  });
}

async function testLinkWithoutInfrastructureReadIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'links-no-infra', seed.noInfrastructureId);
    await expectRejectsExactly(
      () => executeToolPreview(harness, ctx, 'update_incident_links', {
        ref: 'INC-4', assets: { add: ['AST-12'] },
      }),
      'You need the right to read IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.',
    );
  });
}

async function testBusinessContributorApplicationScope(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'links-bc', seed.businessContributorId);
    const preview = await executeToolPreview(harness, ctx, 'update_incident_links', {
      ref: 'INC-5',
      applications: { add: ['APP-2'] },
    });
    await approvePreview(harness, ctx, preview);
    const linked = await runner.query(
      `SELECT app.sequential_id FROM incident_applications l
         JOIN applications app ON app.id = l.application_id AND app.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.incident_id = $2`,
      [seed.tenantId, seed.incidents.resolved],
    );
    assert.deepEqual(linked.map((row: any) => row.sequential_id), ['APP-2']);

    await expectRejectsExactly(
      () => executeToolPreview(harness, ctx, 'update_incident_links', {
        ref: 'INC-5', applications: { add: ['APP-3'] },
      }),
      'Application "APP-3" not found.',
    );
  });
}

async function testFrozenIncidentRefusesLinks(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'links-frozen', seed.businessContributorId);
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_incident_links', {
        ref: 'INC-6', assets: { add: ['AST-12'] },
      }),
      /This incident is closed\. Reopen it to make changes/,
    );
  });
}

async function testLinkDriftIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'links-drift', seed.businessContributorId);
    const preview = await executeToolPreview(harness, ctx, 'update_incident_links', {
      ref: 'INC-4', assets: { add: ['AST-12'] },
    });
    // The screen links the same asset between the preview and the approval.
    await runner.query(
      `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`,
      [seed.tenantId, seed.incidents.open, seed.links.assetPrimary],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(
      failed.error_message,
      'Links on INC-4 changed after the preview was created.',
      'the 409 conflict is relayed',
    );
    const links = await runner.query(
      `SELECT 1 FROM incident_assets WHERE tenant_id = $1 AND incident_id = $2`,
      [seed.tenantId, seed.incidents.open],
    );
    assert.equal(links.length, 1, 'the screen link stays, nothing of the preview is written');
  });
}

async function testTaskOnIncident(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'task', seed.taskMemberId);
    const preview = await executeToolPreview(harness, ctx, 'create_task', {
      title: 'Follow up the mail outage',
      relation_type: 'incident',
      relation_ref: 'INC-4',
    });
    assert.match(String(preview.changes.relation.to), /INC-4/);
    const executed = await approvePreview(harness, ctx, preview);
    const [task] = await runner.query(
      `SELECT title, related_object_type, related_object_id FROM tasks WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.equal(task.title, 'Follow up the mail outage');
    assert.equal(task.related_object_type, 'incident');
    assert.equal(task.related_object_id, seed.incidents.open);
    const [audit] = await runner.query(
      `SELECT source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'tasks'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.deepEqual({ source: audit.source, sourceRef: audit.source_ref }, { source: 'ai_chat', sourceRef: preview.preview_id });
  });
}

async function testTaskRefusals(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const taskCtx = context(seed, runner, 'task-refusals', seed.taskMemberId);
    await expectRejects(
      () => executeToolPreview(harness, taskCtx, 'create_task', {
        title: 'After closure', relation_type: 'incident', relation_ref: 'INC-6',
      }),
      /This incident is closed\. Reopen it to make changes/,
    );
    await expectRejects(
      () => executeToolPreview(harness, taskCtx, 'create_task', {
        title: 'Never written', relation_type: 'incident', relation_ref: 'INC-7',
      }),
      /No incident found matching "INC-7"/,
    );

    // Without tasks:member, the screen's follow-up route is closed to the person.
    const contributorCtx = context(seed, runner, 'task-no-right');
    await expectRejectsExactly(
      () => harness.previews.createPreview(contributorCtx, 'create_task', {
        title: 'No right', relation_type: 'incident', relation_ref: 'INC-4',
      }),
      'You need the right to modify tasks, which your role does not give. An administrator can add it to your role.',
    );

    // Attaching an existing task to an incident applies the same visibility and closure lock.
    await expectRejects(
      () => executeToolPreview(harness, taskCtx, 'update_task_fields', {
        ref: 'T-1', fields: { relation_type: 'incident', relation_ref: 'INC-6' },
      }),
      /This incident is closed\. Reopen it to make changes/,
    );
    await expectRejects(
      () => executeToolPreview(harness, taskCtx, 'update_task_fields', {
        ref: 'T-1', fields: { relation_type: 'incident', relation_ref: 'INC-7' },
      }),
      /No incident found matching "INC-7"/,
    );
  });
}

async function testPlanCreatesThenLinksTheIncident(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'plan-link', seed.businessContributorId);
    await runner.query(
      `INSERT INTO ai_conversations (
         id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'AI incident link plan', 'custom', 'incident-write-model', 'custom', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [ctx.conversationId, ctx.tenantId, ctx.userId],
    );
    const plan = await harness.tools.execute(ctx, 'prepare_mutation_plan', {
      summary: 'Create the incident, then link it to an asset',
      operations: [
        {
          operation_id: 'create_business_record',
          tool_name: 'create_business_record',
          input: {
            entity_type: 'incidents',
            fields: { title: 'Plan linked incident', severity: 'major' },
          },
        },
        {
          operation_id: 'link_incident',
          tool_name: 'update_incident_links',
          depends_on: ['create_business_record'],
          input: {
            ref: '{{create_business_record.ref}}',
            assets: { add: ['AST-12'] },
          },
        },
      ],
    }) as any;
    assert.equal(plan.previews.length, 1, 'the link step waits for the creation');
    assert.equal(plan.deferred.length, 1);
    const created = await approvePreview(harness, ctx, plan.previews[0]);
    assert.match(String(created.target.ref), /^INC-\d+$/);
    const previews = await harness.previews.listConversationPreviews(ctx, ctx.conversationId) as any[];
    const linked = previews.find((preview: any) => preview.tool_name === 'update_incident_links' && preview.status === 'pending');
    assert.ok(linked, 'the deferred link preview is prepared once the incident exists');
    assert.equal(linked.target.ref, created.target.ref);
    assert.equal(linked.changes.linked_assets.to, '**Ajoutés**\n- AST-12 - PAR-ESX-01');
    await approvePreview(harness, ctx, linked);
    const links = await runner.query(
      `SELECT a.asset_reference FROM incident_assets l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.incident_id = $2`,
      [seed.tenantId, created.target.entity_id],
    );
    assert.deepEqual(links.map((row: any) => row.asset_reference), ['AST-12']);
  });
}

async function testPlanCreatesThenAddsANote(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'plan-note');
    await runner.query(
      `INSERT INTO ai_conversations (
         id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'AI incident note plan', 'custom', 'incident-write-model', 'custom', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [ctx.conversationId, ctx.tenantId, ctx.userId],
    );
    const plan = await harness.tools.execute(ctx, 'prepare_mutation_plan', {
      summary: 'Create the incident, then add a note',
      operations: [
        {
          operation_id: 'create_business_record',
          tool_name: 'create_business_record',
          input: {
            entity_type: 'incidents',
            fields: { title: 'Plan note incident', severity: 'minor' },
          },
        },
        {
          operation_id: 'note_incident',
          tool_name: 'add_incident_note',
          depends_on: ['create_business_record'],
          input: {
            ref: '{{create_business_record.ref}}',
            content: 'Created by the plan.',
          },
        },
      ],
    }) as any;
    assert.equal(plan.previews.length, 1);
    assert.equal(plan.deferred.length, 1);
    const created = await approvePreview(harness, ctx, plan.previews[0]);
    const previews = await harness.previews.listConversationPreviews(ctx, ctx.conversationId) as any[];
    const note = previews.find((preview: any) => preview.tool_name === 'add_incident_note' && preview.status === 'pending');
    assert.ok(note, 'the deferred note preview is prepared once the incident exists');
    assert.equal(note.target.ref, created.target.ref);
    await approvePreview(harness, ctx, note);
    const [entry] = await runner.query(
      `SELECT content FROM incident_entries
        WHERE tenant_id = $1 AND incident_id = $2 AND kind = 'note'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, created.target.entity_id],
    );
    assert.equal(entry.content, 'Created by the plan.');
  });
}

async function run() {
  const harness = await createHarness();
  try {
    await testContributorCreatesAnIncident(harness);
    await testCategoryIsResolvedByCodeOrLabel(harness);
    await testCreationStatusesAreOpenOrInProgress(harness);
    await testFieldChangeIsUndoable(harness);
    await testClosureWarnsAndIsNotUndoable(harness);
    await testBackwardStatusAndFrozenRecordAreRefused(harness);
    await testConfidentialityWarnsOnLostAccess(harness);
    await testLiftingConfidentialityIsRefused(harness);
    await testHiddenIncidentReadsAsMissing(harness);
    await testIncidentHiddenBetweenPreviewAndApprovalFails(harness);
    await testPlanCreatesThenMovesTheIncident(harness);
    await testDriftIsRefused(harness);
    await testIncidentStateDriftIsRefused(harness);
    await testConfidentialityDriftIsRefused(harness);
    await testReviewLockIsRelayed(harness);
    await testReporterFallbackOnlyOnCreate(harness);
    await testDetectedAtCannotBeCleared(harness);
    await testDeprecatedIncidentCategory(harness);
    await testMemberAndAdminAreAccepted(harness);
    await testRoleDowngradedBetweenPreviewAndApprovalIsRefused(harness);
    await testAdminReopensAClosedIncident(harness);
    await testIncidentStateRightsAndRefusals(harness);
    await testAdminCancelsAnIncident(harness);
    await testIncidentStateDowngradeBetweenPreviewAndApprovalIsRefused(harness);
    await testCancelReviewLockIsRelayed(harness);
    await testAdminLiftsConfidentialityOnOpenAndClosed(harness);
    await testContributorIsRefusedConfidentiality(harness);
    await testContributorAddsANote(harness);
    await testNoteRefusals(harness);
    await testLinksPreviewExecutionAndUndo(harness);
    await testAlreadyLinkedAndAbsentLinksWriteNothing(harness);
    await testLinkWithoutInfrastructureReadIsRefused(harness);
    await testBusinessContributorApplicationScope(harness);
    await testFrozenIncidentRefusesLinks(harness);
    await testLinkDriftIsRefused(harness);
    await testTaskOnIncident(harness);
    await testTaskRefusals(harness);
    await testPlanCreatesThenLinksTheIncident(harness);
    await testPlanCreatesThenAddsANote(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-incident-writes.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
