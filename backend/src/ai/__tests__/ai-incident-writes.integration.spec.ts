import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE } from '../ai-write-texts';

// Incidents written through Plaid (L4 lot 2): creating one, changing its fields, moving its
// status forward up to the closure, and setting the confidentiality. Every write goes through
// `IncidentsService`, under a preview the person approves, at the screen's contributor level.
//
// - A contributor creates an incident: INC-n, the reporter, the review document, the audit
//   `source: ai_chat` and the preview's reference; a reader is refused.
// - The category is validated against the tenant's incident categories by code or exact label.
// - An incident is created open or in progress; resolved, closed and cancelled are refused.
// - A field change is undoable; a status change is not (reopening needs an administrator).
// - `open -> closed` warns, stamps closed_at and resolved_at, and freezes the record.
// - A backward status move and a change of a closed record are refused before the preview.
// - A restricted incident that would disappear for the person warns; the write succeeds.
// - Lifting the confidentiality is refused; a hidden incident reads as missing; a record that
//   becomes hidden between the preview and the approval fails at execution.
// - A plan creates an incident then moves it to in progress through `{{create_incident.ref}}`.
// - A field changed in the database between the preview and the approval gives a drift refusal.

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
  incidents: {
    open: string;
    resolved: string;
    closed: string;
    hidden: string;
    ownConfidential: string;
  };
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

  const contributorId = await seedUser(runner, tenantId, contributorRole, `inc-write-${tag}@example.test`, 'Luc', 'Bernard', 'fr');
  const readerId = await seedUser(runner, tenantId, readerRole, `inc-read-${tag}@example.test`, 'Ada', 'Martin', 'fr');
  const otherId = await seedUser(runner, tenantId, memberRole, `inc-other-${tag}@example.test`, 'Noa', 'Petit', 'fr');

  await setCurrentTenant(runner, tenantId);
  const incident = async (
    itemNumber: number,
    title: string,
    status: string,
    values: { confidential?: boolean; reporter?: string; owner?: string } = {},
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
        values.reporter ?? contributorId, values.owner ?? contributorId, values.confidential ?? false,
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
  };
  // The next INC number stays above the seeded ones: the identity is what the plan resolves.
  await runner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'incident', 20)
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
    [tenantId],
  );

  return {
    tenantId,
    contributorId,
    readerId,
    otherId,
    incidents,
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

    // A reader who can ask questions but not write incidents gets no preview.
    const readerCtx = context(seed, runner, 'reader', seed.readerId);
    await expectRejects(
      () => harness.tools.execute(readerCtx, 'create_business_record', {
        entity_type: 'incidents', fields: { title: 'Reader incident', severity: 'minor' },
      }),
      /incidents|right|available/i,
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
      /Cancelling an incident is not available/,
    );
    // In progress is accepted at creation, without inventing a resolution step.
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'incidents', fields: { title: 'Already started', severity: 'minor', status: 'in_progress' },
    });
    assert.equal(preview.changes.status.to, 'En cours');
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
    assert.equal(preview.changes.status.from, 'Ouvert');
    assert.equal(preview.changes.status.to, 'Clôturé');
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
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'incidents', ref: 'INC-8', fields: { confidential: false },
      }),
      /Lifting the confidentiality/,
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
    assert.equal(started.changes.status.to, 'En cours');
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
    await testReviewLockIsRelayed(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-incident-writes.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
