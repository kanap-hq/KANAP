import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { ensureDefaultAnalyticsAxis } from '../../analytics/analytics-axes.util';
import { ensureCapexDimensions } from '../../analytics/capex-dimensions.seed';

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

type SeededTenant = {
  tenantId: string;
  userId: string;
  limitedUserId: string;
  companyId: string;
  departmentId: string;
  supplierId: string;
  contactId: string;
  applicationId: string;
  contractId: string;
  spendItemId: string;
  capexItemId: string;
  projectId: string;
  taskId: string;
  otherTenantCompanyId: string;
  tag: string;
  conversationIds: Record<string, string>;
};

const WRITE_RESOURCES = [
  'ai_chat',
  'companies',
  'departments',
  'suppliers',
  'contacts',
  'accounts',
  'analytics',
  'business_processes',
  'locations',
  'applications',
  'infrastructure',
  'contracts',
  'budget',
  'portfolio_projects',
  'portfolio_requests',
  'tasks',
  'knowledge',
  'users',
  'incidents',
] as const;

function shortTag() {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

function itemNumber(tag: string, offset: number) {
  const digits = Number.parseInt(tag.replace(/\D/g, '').slice(0, 5) || '70000', 10);
  return 700000 + digits + offset;
}

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

function context(seed: SeededTenant, runner: QueryRunner, conversationLabel: string, userId = seed.userId) {
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
     VALUES ($1, $2, $3, 'AI capabilities integration', 'custom', 'capability-test-model', 'custom', now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, toolName, input) as any;
  assert.equal(preview.status, 'pending');
  assert.equal(preview.requires_confirmation, true);
  assert.deepEqual(preview.actions, ['approve', 'reject']);
  return preview;
}

async function approvePreview(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'preview did not execute');
  assert.equal(executed.requires_confirmation, false);
  return executed;
}

async function expectRejects(fn: () => Promise<unknown>, pattern: RegExp) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'Expected operation to reject.');
  assert.match(thrown?.message ?? JSON.stringify(thrown?.response ?? thrown), pattern);
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
  // Chat readiness now resolves through the model registry: mirror what the
  // registry backfill produces for a custom-provider tenant — one registry
  // entry assigned to chat — instead of only the legacy flat llm_* columns.
  const modelConfigRows = await runner.query(
    `INSERT INTO ai_model_configs (
       tenant_id, name, provider, model, endpoint_url, api_key_encrypted,
       supports_vision, is_default, created_at, updated_at
     )
     VALUES (
       $1, 'capability-test-model', 'custom', 'capability-test-model',
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
       'https://llm.example.test/v1', 'capability-test-model', 'test-secret',
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
) {
  await setCurrentTenant(runner, tenantId);
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (
       id, tenant_id, first_name, last_name, email, password_hash, role_id,
       mfa_enabled, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
    [userId, tenantId, firstName, email, roleId],
  );
  return userId;
}

async function seedGraph(runner: QueryRunner): Promise<SeededTenant> {
  const tag = shortTag();
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  await seedTenant(runner, tenantId, `ai-cap-${tag}`, `AI Capabilities ${tag}`);
  await seedTenant(runner, otherTenantId, `ai-cap-other-${tag}`, `Other AI Capabilities ${tag}`);

  const fullRoleId = await seedRole(
    runner,
    tenantId,
    'AI Capabilities Member',
    Object.fromEntries(WRITE_RESOURCES.map((resource) => [resource, 'member'])),
  );
  const limitedRoleId = await seedRole(runner, tenantId, 'AI Limited Member', {
    ai_chat: 'member',
    applications: 'member',
    companies: 'reader',
  });
  const otherRoleId = await seedRole(runner, otherTenantId, 'Other Member', {
    ai_chat: 'member',
    companies: 'member',
  });

  const userId = await seedUser(runner, tenantId, fullRoleId, `ai-cap-${tag}@example.test`, 'AI');
  const limitedUserId = await seedUser(runner, tenantId, limitedRoleId, `ai-limited-${tag}@example.test`, 'Limited');
  await seedUser(runner, otherTenantId, otherRoleId, `ai-other-${tag}@example.test`, 'Other');

  await setCurrentTenant(runner, tenantId);
  const companyId = randomUUID();
  const departmentId = randomUUID();
  const supplierId = randomUUID();
  const contactId = randomUUID();
  const applicationId = randomUUID();
  const contractId = randomUUID();
  const spendItemId = randomUUID();
  const capexItemId = randomUUID();
  const projectId = randomUUID();
  const taskId = randomUUID();

  await runner.query(
    `INSERT INTO companies (
       id, tenant_id, name, country_iso, city, address1, address2, postal_code,
       reg_number, vat_number, state, base_currency, notes, status, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'FR', 'Paris', '1 Capability Way', null, '75001',
       'CAP-REG', 'CAP-VAT', 'IDF', 'EUR', 'Original company note', 'enabled', now(), now()
     )`,
    [companyId, tenantId, `PLAID Capability Company ${tag}`],
  );
  await runner.query(
    `INSERT INTO company_metrics (
       id, tenant_id, company_id, fiscal_year, headcount, it_users, turnover,
       is_frozen, frozen_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, 2026, 321, 123, 456789.123, false, null, now(), now())`,
    [randomUUID(), tenantId, companyId],
  );
  await runner.query(
    `INSERT INTO departments (
       id, tenant_id, company_id, name, description, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'Capability department', 'enabled', now(), now())`,
    [departmentId, tenantId, companyId, `PLAID Capability Department ${tag}`],
  );
  await runner.query(
    `INSERT INTO department_metrics (
       id, tenant_id, department_id, fiscal_year, headcount, is_frozen, frozen_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, 2026, 77, false, null, now(), now())`,
    [randomUUID(), tenantId, departmentId],
  );
  await runner.query(
    `INSERT INTO suppliers (
       id, tenant_id, name, erp_supplier_id, notes, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'Capability supplier', 'enabled', now(), now())`,
    [supplierId, tenantId, `PLAID Capability Supplier ${tag}`, `SUP-${tag}`],
  );
  await runner.query(
    `INSERT INTO contacts (
       id, tenant_id, first_name, last_name, job_title, email, phone, mobile,
       country, notes, active, supplier_id, created_at, updated_at
     )
     VALUES ($1, $2, 'Casey', 'Contact', 'Support Lead', $3, null, null, 'FR', null, true, null, now(), now())`,
    [contactId, tenantId, `casey.${tag}@example.test`],
  );
  await runner.query(
    `INSERT INTO applications (
       id, tenant_id, name, supplier_id, category, description, editor, version,
       lifecycle, environment, criticality, data_class, hosting_model, external_facing,
       sso_enabled, mfa_supported, etl_enabled, access_methods, contains_pii,
       licensing, notes, support_notes, users_mode, users_year, users_override,
       status, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, 'line_of_business', 'Original app description',
       'Capability Editor', '1.0', 'active', 'prod', 'medium', 'internal',
       'saas', false, true, true, false, ARRAY['browser']::text[], false,
       'subscription', 'Original app note', 'Original support note',
       'manual', 2026, 40, 'enabled', now(), now()
     )`,
    [applicationId, tenantId, `PLAID Capability App ${tag}`, supplierId],
  );
  await runner.query(
    `INSERT INTO portfolio_projects (
       id, tenant_id, item_number, name, origin, status, scheduling_mode,
       execution_progress, company_id, department_id, criteria_values, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, 'fast_track', 'planned',
       'independent', 10, $5, $6, '{}'::jsonb, now(), now()
     )`,
    [projectId, tenantId, itemNumber(tag, 1), `PLAID Capability Project ${tag}`, companyId, departmentId],
  );
  await runner.query(
    `INSERT INTO tasks (
       id, tenant_id, item_number, title, description, status, due_date,
       assignee_user_id, related_object_type, related_object_id, priority_level,
       labels, creator_id, owner_ids, viewer_ids, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, 'Original task description', 'open', DATE '2026-06-01',
       null, 'project', $5, 'normal', '[]'::jsonb, $6, '[]'::jsonb, '[]'::jsonb, now(), now()
     )`,
    [taskId, tenantId, itemNumber(tag, 2), `PLAID Capability Task ${tag}`, projectId, userId],
  );
  await runner.query(
    `INSERT INTO spend_items (
       id, tenant_id, paying_company_id, product_name, description, supplier_id,
       currency, effective_start, status, notes, item_number, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'Seeded spend item', $5, 'EUR', DATE '2026-01-01', 'enabled', 'Original spend note', (SELECT COALESCE(MAX(item_number), 0) + 1 FROM spend_items WHERE tenant_id = $2), now(), now())`,
    [spendItemId, tenantId, companyId, `PLAID Capability Spend ${tag}`, supplierId],
  );
  // The OPEX number the screens show is its legacy number (`OPX-n`); the line also has its BL-n.
  await runner.query(
    `UPDATE spend_items SET legacy_number = 'OPX-' || item_number WHERE tenant_id = $1 AND id = $2`,
    [tenantId, spendItemId],
  );
  // Lot Z1: a CAPEX line is a spend line of nature 'capex', its BL number in item_number
  // (one numbering across both natures) and its CPX number in legacy_number.
  await runner.query(
    `INSERT INTO spend_items (
       id, tenant_id, nature, paying_company_id, supplier_id, product_name, ppe_type,
       investment_type, priority, currency, effective_start, status, notes,
       item_number, legacy_number, created_at, updated_at
     )
     VALUES (
       $1, $2, 'capex', $3, $4, $5, 'hardware', 'capacity', 'medium', 'EUR',
       DATE '2026-01-01', 'enabled', 'Original capex note',
       (SELECT COALESCE(MAX(item_number), 0) + 1 FROM spend_items WHERE tenant_id = $2),
       'CPX-' || (SELECT COALESCE(MAX(substring(legacy_number FROM '^CPX-([0-9]+)$')::int), 0) + 1
                  FROM spend_items WHERE tenant_id = $2 AND nature = 'capex'),
       now(), now()
     )`,
    [capexItemId, tenantId, companyId, supplierId, `PLAID Capability CAPEX ${tag}`],
  );
  await runner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     SELECT $1, 'spend', COALESCE(MAX(item_number), 0) + 1
     FROM spend_items
     WHERE tenant_id = $1
     ON CONFLICT (tenant_id, entity_type)
     DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
    [tenantId],
  );
  await runner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     SELECT $1, 'capex', COALESCE(MAX(substring(legacy_number FROM '^CPX-([0-9]+)$')::int), 0) + 1
     FROM spend_items
     WHERE tenant_id = $1 AND nature = 'capex'
     ON CONFLICT (tenant_id, entity_type)
     DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
    [tenantId],
  );
  await runner.query(
    `INSERT INTO contracts (
       id, tenant_id, name, status, company_id, supplier_id, owner_user_id,
       start_date, duration_months, auto_renewal, notice_period_months,
       yearly_amount_at_signature, currency, billing_frequency, notes,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'enabled', $4, $5, $6, DATE '2026-01-01', 12,
       false, 3, 12000, 'EUR', 'annual', 'Capability contract', now(), now()
     )`,
    [contractId, tenantId, `PLAID Capability Contract ${tag}`, companyId, supplierId, userId],
  );
  await runner.query(
    `INSERT INTO application_projects (tenant_id, application_id, project_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, applicationId, projectId],
  );

  await setCurrentTenant(runner, otherTenantId);
  const otherTenantCompanyId = randomUUID();
  await runner.query(
    `INSERT INTO companies (
       id, tenant_id, name, country_iso, city, base_currency, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'DE', 'Berlin', 'EUR', 'enabled', now(), now())`,
    [otherTenantCompanyId, otherTenantId, `Other Tenant Company ${tag}`],
  );
  await setCurrentTenant(runner, tenantId);

  return {
    tenantId,
    userId,
    limitedUserId,
    companyId,
    departmentId,
    supplierId,
    contactId,
    applicationId,
    contractId,
    spendItemId,
    capexItemId,
    projectId,
    taskId,
    otherTenantCompanyId,
    tag,
    conversationIds: {},
  };
}

async function withSeededTransaction(
  harness: Harness,
  test: (runner: QueryRunner, seed: SeededTenant) => Promise<void>,
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

async function testReadDepthToolAvailabilityAndTenantIsolation(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'read-depth');
    const availableTools = await harness.tools.listAvailableTools(ctx);
    const names = new Set(availableTools.map((tool: any) => tool.name));
    for (const name of [
      'query_entities',
      'get_entity_detail',
      'create_master_data_record',
      'update_master_data_record',
      'update_entity_relations',
      'create_business_record',
      'update_business_record',
      'update_task_fields',
      'write_financial_plan',
    ]) {
      assert.equal(names.has(name), true, `${name} should be available`);
    }
    assert.equal(names.has('undo_preview'), false, 'undo is only available after an executed reversible preview');

    const companies = await harness.tools.execute(ctx, 'query_entities', {
      entity_type: 'companies',
      filters: { headcount_year: { op: 'gte', value: 300 } },
      year: 2026,
      limit: 10,
    }) as any;
    assert.equal(companies.filters_ignored.length, 0);
    const company = companies.items.find((item: any) => item.id === seed.companyId);
    assert.ok(company, 'seed company should be returned by metric filter');
    assert.equal(company.metadata.metrics_year, 2026);
    assert.equal(company.metadata.headcount, 321);
    assert.equal(company.metadata.it_users, 123);
    assert.equal(company.metadata.turnover, 456789.123);

    const companyDetail = await harness.tools.execute(ctx, 'get_entity_detail', {
      entity_type: 'companies',
      entity_id: seed.companyId,
      year: 2026,
    }) as any;
    assert.equal(companyDetail.entity.metadata.headcount, 321);
    assert.equal(companyDetail.data.selected_metrics_year, 2026);
    assert.equal(companyDetail.data.selected_metrics.headcount, 321);
    assert.ok(Array.isArray(companyDetail.data.metrics));

    const departmentDetail = await harness.tools.execute(ctx, 'get_entity_detail', {
      entity_type: 'departments',
      entity_id: seed.departmentId,
      year: 2026,
    }) as any;
    assert.equal(departmentDetail.entity.metadata.headcount, 77);
    assert.equal(departmentDetail.data.selected_metrics.headcount, 77);

    const applicationDetail = await harness.tools.execute(ctx, 'get_entity_detail', {
      entity_type: 'applications',
      entity_id: seed.applicationId,
    }) as any;
    assert.ok(applicationDetail.data.relation_counts, 'application detail should expose relation counts');
    assert.ok(applicationDetail.data.projects, 'application detail should expose linked projects');

    await expectRejects(
      () => harness.tools.execute(ctx, 'update_master_data_record', {
        entity_type: 'companies',
        ref: seed.otherTenantCompanyId,
        fields: { notes: 'Cross-tenant write must fail' },
      }),
      /not found|No companies found/i,
    );
  });
}

async function testMasterDataPreviewApprovalAuditAndUndo(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'master-data');
    const preview = await executeToolPreview(harness, ctx, 'update_master_data_record', {
      entity_type: 'companies',
      ref: seed.companyId,
      fields: {
        notes: `Updated through PLAID ${seed.tag}`,
        metrics_year: 2026,
        headcount: 444,
        it_users: 222,
        turnover: 654321.123,
      },
    });

    let [beforeApproval] = await runner.query(
      `SELECT notes FROM companies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.companyId],
    );
    assert.equal(beforeApproval.notes, 'Original company note');

    const executed = await approvePreview(harness, ctx, preview);
    assert.equal(executed.target.entity_id, seed.companyId);

    const [updatedCompany] = await runner.query(
      `SELECT notes FROM companies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.companyId],
    );
    assert.equal(updatedCompany.notes, `Updated through PLAID ${seed.tag}`);
    const [updatedMetrics] = await runner.query(
      `SELECT headcount, it_users, turnover::numeric::float8 AS turnover
       FROM company_metrics
       WHERE tenant_id = $1 AND company_id = $2 AND fiscal_year = 2026`,
      [seed.tenantId, seed.companyId],
    );
    assert.equal(Number(updatedMetrics.headcount), 444);
    assert.equal(Number(updatedMetrics.it_users), 222);
    assert.equal(Number(updatedMetrics.turnover), 654321.123);

    const auditRows = await runner.query(
      `SELECT table_name, source, source_ref
       FROM audit_log
       WHERE tenant_id = $1 AND source = 'ai_chat' AND source_ref = $2
       ORDER BY table_name`,
      [seed.tenantId, preview.preview_id],
    );
    assert.deepEqual(
      auditRows.map((row: any) => [row.table_name, row.source, row.source_ref]),
      [
        ['companies', 'ai_chat', preview.preview_id],
        ['company_metrics', 'ai_chat', preview.preview_id],
      ],
    );

    const availableAfterExecution = await harness.tools.listAvailableTools(ctx);
    assert.equal(
      availableAfterExecution.some((tool: any) => tool.name === 'undo_preview'),
      true,
      'undo should become available after an executed reversible preview',
    );

    const undoPreview = await harness.tools.execute(ctx, 'undo_preview', {
      preview_id: preview.preview_id,
    }) as any;
    assert.equal(undoPreview.status, 'pending');
    await approvePreview(harness, ctx, undoPreview);

    const [restoredCompany] = await runner.query(
      `SELECT notes FROM companies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.companyId],
    );
    assert.equal(restoredCompany.notes, 'Original company note');
    const [restoredMetrics] = await runner.query(
      `SELECT headcount, it_users, turnover::numeric::float8 AS turnover
       FROM company_metrics
       WHERE tenant_id = $1 AND company_id = $2 AND fiscal_year = 2026`,
      [seed.tenantId, seed.companyId],
    );
    assert.equal(Number(restoredMetrics.headcount), 321);
    assert.equal(Number(restoredMetrics.it_users), 123);
    assert.equal(Number(restoredMetrics.turnover), 456789.123);
  });
}

async function testRelationWritesAndSupplierPropagationUndo(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'relations');
    const appRelationPreview = await executeToolPreview(harness, ctx, 'update_entity_relations', {
      entity_type: 'applications',
      ref: seed.applicationId,
      relation: 'companies',
      add: [seed.companyId],
    });
    await approvePreview(harness, ctx, appRelationPreview);
    let relationRows = await runner.query(
      `SELECT company_id
       FROM application_companies
       WHERE tenant_id = $1 AND application_id = $2`,
      [seed.tenantId, seed.applicationId],
    );
    assert.deepEqual(relationRows.map((row: any) => row.company_id), [seed.companyId]);

    const appUndoPreview = await harness.tools.execute(ctx, 'undo_preview', {
      preview_id: appRelationPreview.preview_id,
    }) as any;
    await approvePreview(harness, ctx, appUndoPreview);
    relationRows = await runner.query(
      `SELECT company_id
       FROM application_companies
       WHERE tenant_id = $1 AND application_id = $2`,
      [seed.tenantId, seed.applicationId],
    );
    assert.equal(relationRows.length, 0);

    const supplierCtx = context(seed, runner, 'supplier-relations');
    const supplierPreview = await executeToolPreview(harness, supplierCtx, 'update_entity_relations', {
      entity_type: 'suppliers',
      ref: seed.supplierId,
      relation: 'contacts',
      add: [{ contact_ref: seed.contactId, role: 'technical', is_primary: true }],
    });
    await approvePreview(harness, supplierCtx, supplierPreview);

    for (const [table, itemColumn, itemId] of [
      ['spend_item_contacts', 'spend_item_id', seed.spendItemId],
      ['spend_item_contacts', 'spend_item_id', seed.capexItemId], // the CAPEX line's contacts (lot Z1)
      ['contract_contacts', 'contract_id', seed.contractId],
    ] as const) {
      const rows = await runner.query(
        `SELECT contact_id, role, origin
         FROM ${table}
         WHERE tenant_id = $1 AND ${itemColumn} = $2`,
        [seed.tenantId, itemId],
      );
      assert.deepEqual(rows.map((row: any) => [row.contact_id, row.role, row.origin]), [
        [seed.contactId, 'technical', 'supplier'],
      ]);
    }

    const supplierUndoPreview = await harness.tools.execute(supplierCtx, 'undo_preview', {
      preview_id: supplierPreview.preview_id,
    }) as any;
    await approvePreview(harness, supplierCtx, supplierUndoPreview);
    const supplierLinks = await runner.query(
      `SELECT id FROM supplier_contacts WHERE tenant_id = $1 AND supplier_id = $2`,
      [seed.tenantId, seed.supplierId],
    );
    assert.equal(supplierLinks.length, 0);
    const propagatedRows = await runner.query(
      `SELECT count(*)::int AS count
       FROM spend_item_contacts
       WHERE tenant_id = $1 AND spend_item_id = $2`,
      [seed.tenantId, seed.spendItemId],
    );
    assert.equal(Number(propagatedRows[0].count), 0);
  });
}

async function testBusinessTaskFinancialWritesAndRbac(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const businessCtx = context(seed, runner, 'business-record');
    const spendPreview = await executeToolPreview(harness, businessCtx, 'create_business_record', {
      entity_type: 'budget_lines',
      fields: {
        nature: 'opex',
        product_name: `PLAID Created Spend ${seed.tag}`,
        paying_company_id: seed.companyId,
        supplier_id: seed.supplierId,
        currency: 'EUR',
        effective_start: '2026-02-01',
        notes: 'Created by deterministic PLAID write capability test',
      },
    });
    const spendExecution = await approvePreview(harness, businessCtx, spendPreview);
    const createdSpendId = spendExecution.target.entity_id;
    assert.ok(createdSpendId, 'created spend item id should be populated after approval');

    await assert.rejects(
      () => executeToolPreview(harness, context(seed, runner, 'business-update'), 'update_business_record', {
        entity_type: 'applications',
        ref: seed.applicationId,
        fields: { business_mtd_minutes: 1440 },
      }),
      /business_mtd_minutes is not writable for applications/,
    );
    const updateAppPreview = await executeToolPreview(harness, context(seed, runner, 'business-update'), 'update_business_record', {
      entity_type: 'applications',
      ref: seed.applicationId,
      fields: {
        criticality: 'High',
        description: `Updated app description ${seed.tag}`,
      },
    });
    await approvePreview(harness, context(seed, runner, 'business-update'), updateAppPreview);
    let [appRow] = await runner.query(
      `SELECT criticality, description FROM applications WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.applicationId],
    );
    assert.equal(appRow.criticality, 'high');
    assert.equal(appRow.description, `Updated app description ${seed.tag}`);
    const undoBusinessPreview = await harness.tools.execute(context(seed, runner, 'business-update'), 'undo_preview', {
      preview_id: updateAppPreview.preview_id,
    }) as any;
    await approvePreview(harness, context(seed, runner, 'business-update'), undoBusinessPreview);
    [appRow] = await runner.query(
      `SELECT criticality, description FROM applications WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.applicationId],
    );
    assert.equal(appRow.criticality, 'medium');
    assert.equal(appRow.description, 'Original app description');

    const taskCtx = context(seed, runner, 'task-update');
    const taskPreview = await executeToolPreview(harness, taskCtx, 'update_task_fields', {
      ref: seed.taskId,
      fields: {
        title: `PLAID Updated Task ${seed.tag}`,
        priority: 'high',
        due_date: '2026-07-15',
        labels: ['plaid', 'capability-test'],
      },
    });
    await approvePreview(harness, taskCtx, taskPreview);
    let [taskRow] = await runner.query(
      `SELECT title, priority_level, due_date::text AS due_date, labels
       FROM tasks
       WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.taskId],
    );
    assert.equal(taskRow.title, `PLAID Updated Task ${seed.tag}`);
    assert.equal(taskRow.priority_level, 'high');
    assert.equal(taskRow.due_date, '2026-07-15');
    assert.deepEqual(taskRow.labels, ['plaid', 'capability-test']);
    const taskUndoPreview = await harness.tools.execute(taskCtx, 'undo_preview', {
      preview_id: taskPreview.preview_id,
    }) as any;
    await approvePreview(harness, taskCtx, taskUndoPreview);
    [taskRow] = await runner.query(
      `SELECT title, priority_level, due_date::text AS due_date, labels
       FROM tasks
       WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.taskId],
    );
    assert.equal(taskRow.title, `PLAID Capability Task ${seed.tag}`);
    assert.equal(taskRow.priority_level, 'normal');
    assert.equal(taskRow.due_date, '2026-06-01');
    assert.deepEqual(taskRow.labels, []);

    const financialCtx = context(seed, runner, 'financial');
    const versionPreview = await executeToolPreview(harness, financialCtx, 'write_financial_plan', {
      entity_type: 'budget_lines',
      ref: createdSpendId,
      action: 'create_version',
      fields: {
        version_name: `Budget ${seed.tag}`,
        input_grain: 'annual',
        budget_year: 2026,
        as_of_date: '2026-01-01',
        allocation_method: 'manual_company',
        allocation_driver: 'headcount',
        reporting_currency: 'EUR',
      },
    });
    await approvePreview(harness, financialCtx, versionPreview);
    const [versionRow] = await runner.query(
      `SELECT id, version_name, allocation_method
       FROM spend_versions
       WHERE tenant_id = $1 AND spend_item_id = $2 AND budget_year = 2026`,
      [seed.tenantId, createdSpendId],
    );
    assert.equal(versionRow.version_name, `Budget ${seed.tag}`);
    assert.equal(versionRow.allocation_method, 'manual_company');

    // A version holds one year: amounts for another year are refused before approval.
    await assert.rejects(
      () => executeToolPreview(harness, financialCtx, 'write_financial_plan', {
        entity_type: 'budget_lines',
        ref: createdSpendId,
        action: 'upsert_amounts',
        version_ref: versionRow.id,
        amounts: { kind: 'monthly', year: 2027, months: [{ period: '2027-01-01', planned: 100 }] },
      }),
      /The amounts are for 2027, but financial version ".*" is for 2026/,
    );

    // An unknown spread profile is refused at the preview, with the message the write gives.
    const profilePreview = (amounts: Record<string, unknown>) => executeToolPreview(harness, financialCtx, 'write_financial_plan', {
      entity_type: 'budget_lines',
      ref: createdSpendId,
      action: 'upsert_amounts',
      version_ref: versionRow.id,
      amounts,
    });
    await assert.rejects(
      () => profilePreview({ kind: 'annual', year: 2026, totals: { planned: 1200 }, spread_profile_name: 'bogus' }),
      /Unknown spread profile 'bogus'\. Use flat, 4-4-5\./,
    );
    await assert.rejects(
      () => profilePreview({ kind: 'quarterly', year: 2026, measure: 'planned', Q1: 300, spread_profile_name: 'bogus' }),
      /Unknown spread profile 'bogus' for quarters\. Use equal, flat or 4-4-5\./,
    );
    const known = await profilePreview({ kind: 'annual', year: 2026, totals: { planned: 1200 }, spread_profile_name: '4-4-5' }) as any;
    assert.ok(known.preview_id, 'a known profile gets a preview');
    const knownQuarterly = await profilePreview({ kind: 'quarterly', year: 2026, measure: 'planned', Q1: 300, spread_profile_name: '4-4-5' }) as any;
    assert.ok(knownQuarterly.preview_id, 'a known quarterly profile gets a preview');

    const amountPreview = await executeToolPreview(harness, financialCtx, 'write_financial_plan', {
      entity_type: 'budget_lines',
      ref: createdSpendId,
      action: 'upsert_amounts',
      version_ref: versionRow.id,
      amounts: {
        kind: 'annual',
        year: 2026,
        totals: { planned: 12000, committed: 3000, actual: 1000, expected_landing: 11000 },
      },
    });
    // The card writes the amounts in the person's language: numbers, the year and the line's currency.
    assert.deepEqual(amountPreview.changes.amounts.amounts.to, {
      year: 2026,
      currency: 'EUR',
      column_names: {},
      totals: { planned: 12000, committed: 3000, actual: 1000, expected_landing: 11000 },
    });
    assert.equal(amountPreview.changes.amounts.amounts.from.year, 2026);
    assert.equal(amountPreview.changes.amounts.amounts.from.currency, 'EUR');
    await approvePreview(harness, financialCtx, amountPreview);
    let [amountTotals] = await runner.query(
      `SELECT
         round(sum(planned)::numeric, 2)::float8 AS planned,
         round(sum(committed)::numeric, 2)::float8 AS committed,
         round(sum(actual)::numeric, 2)::float8 AS actual,
         round(sum(expected_landing)::numeric, 2)::float8 AS expected_landing
       FROM spend_amounts
       WHERE tenant_id = $1 AND version_id = $2`,
      [seed.tenantId, versionRow.id],
    );
    assert.equal(amountTotals.planned, 12000);
    assert.equal(amountTotals.committed, 3000);
    assert.equal(amountTotals.actual, 1000);
    assert.equal(amountTotals.expected_landing, 11000);

    const amountUndoPreview = await harness.tools.execute(financialCtx, 'undo_preview', {
      preview_id: amountPreview.preview_id,
    }) as any;
    await approvePreview(harness, financialCtx, amountUndoPreview);
    [amountTotals] = await runner.query(
      `SELECT
         round(COALESCE(sum(planned), 0)::numeric, 2)::float8 AS planned,
         round(COALESCE(sum(committed), 0)::numeric, 2)::float8 AS committed,
         round(COALESCE(sum(actual), 0)::numeric, 2)::float8 AS actual,
         round(COALESCE(sum(expected_landing), 0)::numeric, 2)::float8 AS expected_landing
       FROM spend_amounts
       WHERE tenant_id = $1 AND version_id = $2`,
      [seed.tenantId, versionRow.id],
    );
    assert.equal(amountTotals.planned, 0);
    assert.equal(amountTotals.committed, 0);
    assert.equal(amountTotals.actual, 0);
    assert.equal(amountTotals.expected_landing, 0);

    // Amounts stay decimal strings on the server: the largest amount survives preview, apply and undo to the cent.
    const january = async () => (await runner.query(
      `SELECT planned::text AS planned FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2 AND period = '2026-01-01'`,
      [seed.tenantId, versionRow.id],
    ))[0]?.planned;
    const januaryPreview = (planned: unknown) => executeToolPreview(harness, financialCtx, 'write_financial_plan', {
      entity_type: 'budget_lines',
      ref: createdSpendId,
      action: 'upsert_amounts',
      version_ref: versionRow.id,
      amounts: { kind: 'monthly', year: 2026, months: [{ period: '2026-01-01', planned }] },
    });
    const largestPreview = await januaryPreview('99999999999999.99');
    const [largestInput] = await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE id = $1`, [largestPreview.preview_id]);
    assert.equal(largestInput.mutation_input.amounts.months[0].planned, '99999999999999.99', 'the preview keeps the amount to the cent');
    await approvePreview(harness, financialCtx, largestPreview);
    assert.equal(await january(), '99999999999999.99', 'the apply writes it to the cent');
    const smallerPreview = await januaryPreview(0.01);
    await approvePreview(harness, financialCtx, smallerPreview);
    assert.equal(await january(), '0.01');
    const smallerUndo = await harness.tools.execute(financialCtx, 'undo_preview', { preview_id: smallerPreview.preview_id }) as any;
    await approvePreview(harness, financialCtx, smallerUndo);
    assert.equal(await january(), '99999999999999.99', 'the undo restores it to the cent');
    await assert.rejects(() => januaryPreview('100000000000000000'), /amounts\.months\[0\]\.planned is too large\./);
    await assert.rejects(() => januaryPreview('ten'), /amounts\.months\[0\]\.planned must be a number\./);
    await approvePreview(harness, financialCtx, await januaryPreview(0));
    assert.equal(await january(), '0.00');

    const allocationPreview = await executeToolPreview(harness, financialCtx, 'write_financial_plan', {
      entity_type: 'budget_lines',
      ref: createdSpendId,
      action: 'replace_allocations',
      version_ref: versionRow.id,
      allocations: [{ company_ref: seed.companyId }],
    });
    await approvePreview(harness, financialCtx, allocationPreview);
    const allocationRows = await runner.query(
      `SELECT company_id, department_id, round(allocation_pct::numeric, 4)::float8 AS allocation_pct
       FROM spend_allocations
       WHERE tenant_id = $1 AND version_id = $2`,
      [seed.tenantId, versionRow.id],
    );
    assert.deepEqual(allocationRows.map((row: any) => [row.company_id, row.department_id, row.allocation_pct]), [
      [seed.companyId, null, 100],
    ]);

    const limitedCtx = context(seed, runner, 'rbac', seed.limitedUserId);
    await expectRejects(
      () => harness.tools.execute(limitedCtx, 'create_business_record', {
        entity_type: 'budget_lines',
        fields: {
          nature: 'capex',
          product_name: `Forbidden CAPEX ${seed.tag}`,
          paying_company_id: seed.companyId,
          currency: 'EUR',
          effective_start: '2026-01-01',
        },
      }),
      /right to modify budget lines|available/i,
    );
  });
}

async function testCapexOwnersAnalyticsAndApplications(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const axisId = await ensureDefaultAnalyticsAxis(runner.manager, seed.tenantId);
    const [category] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [seed.tenantId, axisId, `PLAID Capability Category ${seed.tag}`],
    );
    const [otherTenant] = await runner.query(`SELECT id FROM tenants WHERE slug = $1`, [`ai-cap-other-${seed.tag}`]);
    await setCurrentTenant(runner, otherTenant.id);
    const otherAxisId = await ensureDefaultAnalyticsAxis(runner.manager, otherTenant.id);
    const [foreignCategory] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [otherTenant.id, otherAxisId, `Other Tenant Category ${seed.tag}`],
    );
    const [foreignUser] = await runner.query(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [otherTenant.id]);
    await setCurrentTenant(runner, seed.tenantId);

    const ctx = context(seed, runner, 'capex-fields');
    await expectRejects(
      () => harness.tools.execute(ctx, 'update_business_record', {
        entity_type: 'budget_lines',
        ref: seed.capexItemId,
        fields: { analytics_category_id: foreignCategory.id },
      }),
      /^"[0-9a-f-]{36}" is not a value of the analytics dimension\.$/,
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'update_business_record', {
        entity_type: 'budget_lines',
        ref: seed.capexItemId,
        fields: { owner_it_id: foreignUser.id },
      }),
      /not found/i,
    );

    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'budget_lines',
      ref: seed.capexItemId,
      fields: {
        it_owner: seed.userId,
        business_owner: `ai-cap-${seed.tag}@example.test`,
        analytics_category: `PLAID Capability Category ${seed.tag}`,
      },
    });
    await approvePreview(harness, ctx, preview);
    const [capexRow] = await runner.query(
      `SELECT ci.owner_it_id, ci.owner_business_id, v.category_id AS analytics_category_id
         FROM spend_items ci
         LEFT JOIN spend_item_analytics_values v ON v.tenant_id = ci.tenant_id AND v.item_id = ci.id AND v.axis_id = $3
        WHERE ci.tenant_id = $1 AND ci.id = $2 AND ci.nature = 'capex'`,
      [seed.tenantId, seed.capexItemId, axisId],
    );
    assert.deepEqual(
      [capexRow.owner_it_id, capexRow.owner_business_id, capexRow.analytics_category_id],
      [seed.userId, seed.userId, category.id],
      'CAPEX owners and analytics category are set by the AI',
    );

    const relationCtx = context(seed, runner, 'capex-applications');
    const relationPreview = await executeToolPreview(harness, relationCtx, 'update_entity_relations', {
      entity_type: 'budget_lines',
      ref: seed.capexItemId,
      relation: 'applications',
      add: [seed.applicationId],
    });
    await approvePreview(harness, relationCtx, relationPreview);
    const linkRows = () => runner.query(
      `SELECT application_id FROM application_spend_items WHERE tenant_id = $1 AND spend_item_id = $2`,
      [seed.tenantId, seed.capexItemId],
    );
    assert.deepEqual((await linkRows()).map((row: any) => row.application_id), [seed.applicationId], 'the CAPEX item is linked to the application');
    const undoPreview = await harness.tools.execute(relationCtx, 'undo_preview', { preview_id: relationPreview.preview_id }) as any;
    await approvePreview(harness, relationCtx, undoPreview);
    assert.equal((await linkRows()).length, 0, 'undo removes the link');
  });
}

/**
 * The audit of an application's budget lines names the table of the line's nature, as the screens
 * do: `application_capex_items` for a CAPEX line, `application_spend_items` for an OPEX one, one
 * row per nature an update touches.
 */
async function testApplicationLineRelationAuditByNature(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    await runner.query(
      `DELETE FROM application_spend_items WHERE tenant_id = $1 AND application_id = $2`,
      [seed.tenantId, seed.applicationId],
    );
    const relation = (extra: Record<string, unknown>) => ({
      entity_type: 'applications', ref: seed.applicationId, relation: 'budget_lines', ...extra,
    });
    const auditTables = async (previewId: string) => (await runner.query(
      `SELECT table_name FROM audit_log WHERE tenant_id = $1 AND source = 'ai_chat' AND source_ref = $2 ORDER BY table_name`,
      [seed.tenantId, previewId],
    )).map((row: any) => row.table_name);

    const capexOnly = await executeToolPreview(harness, context(seed, runner, 'audit-capex-only'), 'update_entity_relations', relation({ add: [seed.capexItemId] }));
    await approvePreview(harness, context(seed, runner, 'audit-capex-only'), capexOnly);
    assert.deepEqual(await auditTables(capexOnly.preview_id), ['application_capex_items'], 'a CAPEX-only relation is audited as application_capex_items');

    const opexOnly = await executeToolPreview(harness, context(seed, runner, 'audit-opex-only'), 'update_entity_relations', relation({ add: [seed.spendItemId] }));
    await approvePreview(harness, context(seed, runner, 'audit-opex-only'), opexOnly);
    assert.deepEqual(await auditTables(opexOnly.preview_id), ['application_spend_items'], 'an OPEX-only relation is audited as application_spend_items');

    const mixed = await executeToolPreview(harness, context(seed, runner, 'audit-both'), 'update_entity_relations', relation({ remove: [seed.capexItemId, seed.spendItemId] }));
    await approvePreview(harness, context(seed, runner, 'audit-both'), mixed);
    assert.deepEqual(await auditTables(mixed.preview_id), ['application_capex_items', 'application_spend_items'], 'a mixed relation is audited under both tables');
  });
}

/**
 * The `related` sort of the task tools follows the family the assistant displays: the two stored
 * budget line types sort together as `budget_line`, not apart under `capex_item` / `spend_item`.
 */
async function testTaskRelatedSortByDisplayedFamily(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    for (const [offset, title, relatedType, relatedId] of [
      [3, `OPEX task ${seed.tag}`, 'spend_item', seed.spendItemId],
      [4, `Contract task ${seed.tag}`, 'contract', seed.contractId],
      [5, `CAPEX task sort ${seed.tag}`, 'capex_item', seed.capexItemId],
    ] as const) {
      await runner.query(
        `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids, created_at, updated_at)
         VALUES ($1, $2, $3, 'open', $4, $5, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
        [seed.tenantId, itemNumber(seed.tag, offset), title, relatedType, relatedId],
      );
    }
    const result = await harness.tools.execute(context(seed, runner, 'task-related-sort'), 'query_entities', {
      entity_type: 'tasks',
      q: seed.tag,
      sort: { field: 'related', direction: 'asc' },
      limit: 50,
    });
    const related = result.items
      .filter((item: any) => String(item.label).includes(seed.tag))
      .map((item: any) => item.metadata.related);
    assert.deepEqual(related, ['budget_line', 'budget_line', 'contract', 'project'], `tasks sort by related family (${JSON.stringify(related)})`);
  });
}

/**
 * The AI's analytics_category of a line is the default dimension's link: the
 * preview shows the link's value (never the stale item column), the approval
 * writes the link, a value of another dimension or of another tenant is not
 * found and a disabled one is refused as new. Both line types.
 */
async function testItemAnalyticsCategoryThroughTheLinks(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const axisId = await ensureDefaultAnalyticsAxis(runner.manager, seed.tenantId);
    const [nature] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'nature', 'Nature', 1) RETURNING id`,
      [seed.tenantId],
    );
    const value = async (axis: string, name: string, disabled = false): Promise<string> => {
      const [row] = await runner.query(
        `INSERT INTO analytics_categories (tenant_id, axis_id, name, status, disabled_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [seed.tenantId, axis, name, disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
      );
      return row.id;
    };
    const current = await value(axisId, `Current ${seed.tag}`);
    const stale = await value(axisId, `Stale ${seed.tag}`);
    const target = await value(axisId, `Target ${seed.tag}`);
    await value(axisId, `Retired ${seed.tag}`, true);
    const natureOnly = await value(nature.id, `Nature only ${seed.tag}`);
    // Default-dimension values restricted to one line type.
    for (const type of ['opex', 'capex']) {
      const id = await value(axisId, `${type.toUpperCase()} only ${seed.tag}`);
      await runner.query(`UPDATE analytics_categories SET applies_to = $2 WHERE id = $1`, [id, type]);
    }
    const [otherTenant] = await runner.query(`SELECT id FROM tenants WHERE slug = $1`, [`ai-cap-other-${seed.tag}`]);
    await setCurrentTenant(runner, otherTenant.id);
    const [foreign] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [otherTenant.id, await ensureDefaultAnalyticsAxis(runner.manager, otherTenant.id), `Foreign ${seed.tag}`],
    );
    await setCurrentTenant(runner, seed.tenantId);
    const ctx = context(seed, runner, 'item-analytics');

    for (const [entityType, lineNature, itemId, itemTable, linkTable] of [
      ['budget_lines', 'opex', seed.spendItemId, 'spend_items', 'spend_item_analytics_values'],
      ['budget_lines', 'capex', seed.capexItemId, 'spend_items', 'spend_item_analytics_values'],
    ] as const) {
      await runner.query(
        `INSERT INTO ${linkTable} (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
        [seed.tenantId, itemId, axisId, current],
      );
      await runner.query(`UPDATE ${itemTable} SET analytics_category_id = $2 WHERE id = $1`, [itemId, stale]);

      const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: entityType,
        ref: itemId,
        fields: { analytics_category: `Target ${seed.tag}` },
      });
      assert.equal(preview.changes.analytics_category_id.from, `Current ${seed.tag}`, `${entityType}: the preview shows the link's current value, by name`);
      assert.equal(preview.changes.analytics_category_id.to, `Target ${seed.tag}`);
      await approvePreview(harness, ctx, preview);
      const rows = await runner.query(
        `SELECT axis_id, category_id FROM ${linkTable} WHERE tenant_id = $1 AND item_id = $2`,
        [seed.tenantId, itemId],
      );
      assert.deepEqual(rows.map((row: any) => [row.axis_id, row.category_id]), [[axisId, target]], `${entityType}: the AI writes the link`);
      const [column] = await runner.query(`SELECT analytics_category_id FROM ${itemTable} WHERE id = $1`, [itemId]);
      assert.equal(column.analytics_category_id, stale, `${entityType}: the item column is not written`);

      for (const other of [natureOnly, foreign.id]) {
        await expectRejects(
          () => harness.tools.execute(ctx, 'update_business_record', { entity_type: entityType, ref: itemId, fields: { analytics_category_id: other } }),
          /^"[0-9a-f-]{36}" is not a value of the analytics dimension\.$/,
        );
      }
      await expectRejects(
        () => harness.tools.execute(ctx, 'update_business_record', { entity_type: entityType, ref: itemId, fields: { analytics_category: `Retired ${seed.tag}` } }),
        /This value is disabled/,
      );
      // A value restricted to the other line type is refused, with the write gate's message.
      const [lineType, otherType] = lineNature === 'opex' ? ['OPEX', 'CAPEX'] : ['CAPEX', 'OPEX'];
      await expectRejects(
        () => harness.tools.execute(ctx, 'update_business_record', { entity_type: entityType, ref: itemId, fields: { analytics_category: `${otherType} only ${seed.tag}` } }),
        new RegExp(`^${otherType} only ${seed.tag} is for ${otherType} lines only\\. Choose a value for ${lineType} lines\\.$`),
      );
    }
  });
}

/**
 * Lot A: the AI writes any analytics dimension of an OPEX or CAPEX line through
 * `analytics:<code>` (the default one stays `analytics_category`), with the write
 * gate's rules at preview. The preview stores the dimension id, so a rename between
 * preview and apply changes nothing; the edit conflict and the undo work per dimension.
 */
async function testItemAnalyticsDimensions(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const defaultAxisId = await ensureDefaultAnalyticsAxis(runner.manager, seed.tenantId);
    const axis = async (code: string, name: string, sort: number, extra: { applies_to?: string; disabled?: boolean } = {}): Promise<string> => {
      const [row] = await runner.query(
        `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, applies_to, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [seed.tenantId, code, name, sort, extra.applies_to ?? null, extra.disabled ? 'disabled' : 'enabled'],
      );
      return row.id;
    };
    const value = async (axisId: string, name: string, extra: { applies_to?: string; disabled?: boolean } = {}): Promise<string> => {
      const [row] = await runner.query(
        `INSERT INTO analytics_categories (tenant_id, axis_id, name, applies_to, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [seed.tenantId, axisId, name, extra.applies_to ?? null, extra.disabled ? 'disabled' : 'enabled'],
      );
      return row.id;
    };
    const nature = await axis('nature-cost', 'Nature de coût', 1);
    const site = await axis('site', 'Site', 2);
    const old = await axis('old', 'Old', 3, { disabled: true });
    const recurrence = await axis('recurrence', 'Recurrence', 4, { applies_to: 'opex' });
    const assetClass = await axis('asset-class', 'Asset class', 5, { applies_to: 'capex' });
    const licences = await value(nature, 'Licences');
    const services = await value(nature, 'Services');
    await value(nature, 'Hardware');
    const retired = await value(nature, 'Retired', { disabled: true });
    await value(nature, 'OPEX only', { applies_to: 'opex' });
    await value(nature, 'CAPEX only', { applies_to: 'capex' });
    const paris = await value(site, 'Paris');
    const siteLicences = await value(site, 'Licences');
    const legacy = await value(old, 'Legacy');
    const monthly = await value(recurrence, 'Monthly');
    const servers = await value(assetClass, 'Servers');
    const defaultValue = await value(defaultAxisId, `Default ${seed.tag}`);
    const ctx = context(seed, runner, 'item-dimensions');
    const key = (axisId: string) => `analytics_axis:${axisId}`;

    for (const line of [
      {
        entityType: 'budget_lines', nature: 'opex', itemId: seed.spendItemId, linkTable: 'spend_item_analytics_values', labelPlural: 'budget lines',
        lineType: 'OPEX', otherType: 'CAPEX', ownAxis: recurrence, ownCode: 'recurrence', ownValue: monthly, ownName: 'Monthly',
        otherCode: 'asset-class', otherName: 'Asset class', otherValueName: 'Servers',
        createFields: { nature: 'opex', product_name: `Dimensions ${seed.tag}`, paying_company_id: seed.companyId, currency: 'EUR', effective_start: '2026-01-01' },
      },
      {
        entityType: 'budget_lines', nature: 'capex', itemId: seed.capexItemId, linkTable: 'spend_item_analytics_values', labelPlural: 'budget lines',
        lineType: 'CAPEX', otherType: 'OPEX', ownAxis: assetClass, ownCode: 'asset-class', ownValue: servers, ownName: 'Servers',
        otherCode: 'recurrence', otherName: 'Recurrence', otherValueName: 'Monthly',
        createFields: {
          nature: 'capex', product_name: `Dimensions ${seed.tag}`,
          paying_company_id: seed.companyId, currency: 'EUR', effective_start: '2026-01-01',
        },
      },
    ]) {
      const { entityType, nature: lineNature, itemId, linkTable } = line;
      const links = async (id = itemId): Promise<Record<string, string>> => Object.fromEntries(
        (await runner.query(`SELECT axis_id, category_id FROM ${linkTable} WHERE tenant_id = $1 AND item_id = $2`, [seed.tenantId, id]))
          .map((row: any) => [row.axis_id, row.category_id]),
      );
      const setLink = (axisId: string, categoryId: string) => runner.query(
        `INSERT INTO ${linkTable} (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, item_id, axis_id) DO UPDATE SET category_id = EXCLUDED.category_id`,
        [seed.tenantId, itemId, axisId, categoryId],
      );
      const update = (fields: Record<string, unknown>, conversation = ctx) =>
        executeToolPreview(harness, conversation, 'update_business_record', { entity_type: entityType, ref: itemId, fields });
      const refusal = async (fields: Record<string, unknown>): Promise<string> => {
        try {
          await harness.tools.execute(ctx, 'update_business_record', { entity_type: entityType, ref: itemId, fields });
        } catch (error: any) {
          return String(error?.message);
        }
        assert.fail(`${entityType}: expected a refusal for ${JSON.stringify(fields)}`);
      };
      const change = (preview: any, field: string) => [preview.changes[field]?.label, preview.changes[field]?.from, preview.changes[field]?.to];

      // Create with several dimensions: the code is matched case-insensitively (its dash kept), the value by name.
      const created = await executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: entityType,
        fields: { ...line.createFields, 'analytics:Nature-Cost': 'licences', 'analytics:site': 'Paris', [`analytics:${line.ownCode}`]: line.ownName },
      });
      assert.deepEqual(change(created, key(nature)), ['Nature de coût', null, 'Licences'], `${entityType}: the dimension's name and the value's name`);
      assert.deepEqual(change(created, key(site)), ['Site', null, 'Paris']);
      const [stored] = await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE id = $1`, [created.preview_id]);
      assert.deepEqual(
        Object.keys(stored.mutation_input.fields).filter((field) => field.startsWith('analytics')).sort(),
        [key(nature), key(site), key(line.ownAxis)].sort(),
        `${entityType}: the preview stores the dimensions by id`,
      );
      // A create retried before approval returns its pending preview (the current values are part of the signature).
      const retried = await harness.tools.execute(ctx, 'create_business_record', {
        entity_type: entityType,
        fields: { ...line.createFields, 'analytics:Nature-Cost': 'licences', 'analytics:site': 'Paris', [`analytics:${line.ownCode}`]: line.ownName },
      }) as any;
      assert.deepEqual([retried.preview_id, retried.status], [created.preview_id, 'pending'], `${entityType}: the retry finds the preview`);
      const createdId = (await approvePreview(harness, ctx, created)).target.entity_id;
      assert.deepEqual(await links(createdId), { [nature]: licences, [site]: paris, [line.ownAxis]: line.ownValue }, `${entityType}: created with its values`);
      const [{ count }] = await runner.query(
        // Both natures in spend_items since lot Z1, the CAPEX title in product_name.
        `SELECT count(*)::int AS count FROM spend_items WHERE tenant_id = $1 AND nature = $3 AND product_name = $2`,
        [seed.tenantId, `Dimensions ${seed.tag}`, lineNature],
      );
      assert.equal(count, 1, `${entityType}: one line created`);

      // Update by name, then by id; a name present in two dimensions resolves within the addressed one.
      await setLink(nature, licences);
      await setLink(site, paris);
      const byName = await update({ 'analytics:nature-cost': 'services' });
      assert.deepEqual(change(byName, key(nature)), ['Nature de coût', 'Licences', 'Services'], `${entityType}: "from" and "to" are names`);
      await approvePreview(harness, ctx, byName);
      assert.equal((await links())[nature], services);
      const byId = await update({ 'analytics:nature-cost': licences, 'analytics:site': 'Licences' });
      assert.deepEqual(change(byId, key(nature)), ['Nature de coût', 'Services', 'Licences']);
      assert.deepEqual(change(byId, key(site)), ['Site', 'Paris', 'Licences']);
      await approvePreview(harness, ctx, byId);
      assert.deepEqual(await links(), { [nature]: licences, [site]: siteLicences }, `${entityType}: the Site value, not the Nature one`);

      // Back and forth in one conversation: the same change asked against another current value is a new preview.
      const backCtx = context(seed, runner, `item-dimensions-back-${entityType}`);
      const toServices = await update({ 'analytics:nature-cost': 'Services' }, backCtx);
      await approvePreview(harness, backCtx, toServices);
      await approvePreview(harness, backCtx, await update({ 'analytics:nature-cost': 'Hardware' }, backCtx));
      const servicesAgain = await update({ 'analytics:nature-cost': 'Services' }, backCtx);
      assert.notEqual(servicesAgain.preview_id, toServices.preview_id, `${entityType}: not the executed preview`);
      assert.deepEqual(change(servicesAgain, key(nature)), ['Nature de coût', 'Hardware', 'Services']);
      await approvePreview(harness, backCtx, servicesAgain);
      assert.equal((await links())[nature], services, `${entityType}: back to Services`);

      // Clear, then undo restores the previous value.
      const cleared = await update({ 'analytics:site': null });
      assert.deepEqual(change(cleared, key(site)), ['Site', 'Licences', null]);
      await approvePreview(harness, ctx, cleared);
      assert.equal((await links())[site], undefined, `${entityType}: cleared`);
      const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: cleared.preview_id }) as any;
      assert.equal(undo.status, 'pending');
      assert.deepEqual(change(undo, key(site)), ['Site', null, 'Licences']);
      await approvePreview(harness, ctx, undo);
      assert.equal((await links())[site], siteLicences, `${entityType}: undo restores the value`);

      // The default dimension: `analytics_category` and `analytics:<its code>` are the same field.
      // Its label is the dimension's name, "Analytics dimension" while it has none.
      await runner.query(`UPDATE analytics_axes SET name = NULL WHERE id = $1`, [defaultAxisId]);
      const viaCategory = await update({ analytics_category: `Default ${seed.tag}` });
      assert.deepEqual(Object.keys(viaCategory.changes), ['analytics_category_id']);
      assert.deepEqual(change(viaCategory, 'analytics_category_id'), ['Analytics dimension', null, `Default ${seed.tag}`]);
      await approvePreview(harness, ctx, viaCategory);
      assert.equal((await links())[defaultAxisId], defaultValue);
      assert.equal(await refusal({ analytics_category: 'Paris' }), '"Paris" is not a value of the analytics dimension.');
      await runner.query(`UPDATE analytics_axes SET name = 'Budget class' WHERE id = $1`, [defaultAxisId]);
      assert.equal(await refusal({ 'analytics:default': 'Paris' }), '"Paris" is not a value of the Budget class dimension.');
      const viaCode = await update({ 'analytics:default': null });
      assert.deepEqual(Object.keys(viaCode.changes), ['analytics_category_id']);
      assert.deepEqual(change(viaCode, 'analytics_category_id'), ['Budget class', `Default ${seed.tag}`, null]);
      // A value changed in the app meanwhile: the conflict names the default dimension.
      await setLink(defaultAxisId, defaultValue);
      const defaultConflictCtx = context(seed, runner, `item-dimensions-default-${entityType}`);
      const defaultConflict = await update({ analytics_category: null }, defaultConflictCtx);
      await runner.query(`DELETE FROM ${linkTable} WHERE tenant_id = $1 AND item_id = $2 AND axis_id = $3`, [seed.tenantId, itemId, defaultAxisId]);
      const defaultFailed = await harness.previews.executePreview(defaultConflictCtx, defaultConflict.preview_id) as any;
      assert.equal(defaultFailed.error_message, 'Budget class changed after the preview was created.');
      await setLink(defaultAxisId, defaultValue);
      await approvePreview(harness, ctx, viaCode);
      assert.equal((await links())[defaultAxisId], undefined);
      assert.equal(
        await refusal({ analytics_category: `Default ${seed.tag}`, 'analytics:default': `Default ${seed.tag}` }),
        'Field analytics_category_id was provided more than once.',
      );
      assert.equal(await refusal({ 'analytics:site': 'Paris', 'analytics:SITE': 'Paris' }), 'Field analytics:site was provided more than once.');

      // Refusals at preview, with the write gate's messages.
      const unknown = await refusal({ 'analytics:nope': 'x' });
      assert.match(unknown, new RegExp(`^analytics:nope is not writable for ${line.labelPlural}\\. Writable fields: .*analytics_category_id.*, analytics:nature-cost, analytics:site, analytics:${line.ownCode}\\.$`));
      assert.doesNotMatch(unknown, /analytics:old|analytics:default/, `${entityType}: neither the disabled dimension nor the default one by code`);
      assert.doesNotMatch(unknown, new RegExp(`analytics:${line.otherCode}`), `${entityType}: no dimension of the other line type`);
      assert.equal(await refusal({ 'analytics:old': 'Legacy' }), 'The Old dimension is disabled. Enable it or leave it out.');
      assert.equal(
        await refusal({ [`analytics:${line.otherCode}`]: line.otherValueName }),
        `The ${line.otherName} dimension is for ${line.otherType} lines only. Leave it out.`,
      );
      assert.equal(await refusal({ 'analytics:nature-cost': 'Paris' }), '"Paris" is not a value of the Nature de coût dimension.');
      assert.equal(await refusal({ 'analytics:nature-cost': paris }), `"${paris}" is not a value of the Nature de coût dimension.`);
      assert.equal(await refusal({ 'analytics:nature-cost': 'Retired' }), 'This value is disabled.');
      assert.equal(
        await refusal({ 'analytics:nature-cost': `${line.otherType} only` }),
        `${line.otherType} only is for ${line.otherType} lines only. Choose a value for ${line.lineType} lines.`,
      );

      // The line's current value passes as a no-op: a disabled value, a disabled dimension, none on the other type's dimension.
      await setLink(nature, retired);
      await setLink(old, legacy);
      const noOp = await update({
        'analytics:nature-cost': 'Retired', 'analytics:old': 'Legacy', [`analytics:${line.otherCode}`]: null, notes: `No-op ${seed.tag}`,
      });
      assert.deepEqual(Object.keys(noOp.changes), ['notes'], `${entityType}: only the notes change`);
      await approvePreview(harness, ctx, noOp);
      assert.equal(await refusal({ 'analytics:old': null }), 'The Old dimension is disabled. Enable it or leave it out.');

      // A rename of the dimension (code and name) between preview and apply changes nothing.
      const beforeRename = await update({ 'analytics:nature-cost': 'Services' });
      assert.deepEqual(change(beforeRename, key(nature)), ['Nature de coût', 'Retired', 'Services']);
      await runner.query(`UPDATE analytics_axes SET code = 'nature-renamed', name = 'Nature renamed' WHERE id = $1`, [nature]);
      await approvePreview(harness, ctx, beforeRename);
      assert.equal((await links())[nature], services, `${entityType}: applied after the rename`);

      // A value changed in the app between preview and apply: an edit conflict, named after the dimension.
      const conflicting = await update({ 'analytics:nature-renamed': 'Licences' });
      await setLink(nature, retired);
      const failed = await harness.previews.executePreview(ctx, conflicting.preview_id) as any;
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error_message, 'Nature renamed changed after the preview was created.');
      assert.equal((await links())[nature], retired, `${entityType}: nothing written`);
      await runner.query(`UPDATE analytics_axes SET code = 'nature-cost', name = 'Nature de coût' WHERE id = $1`, [nature]);

      // An undo whose dimension was deleted since is refused in plain words.
      const tempCode = `temp-${line.lineType.toLowerCase()}`;
      const temp = await axis(tempCode, `Temp ${line.lineType}`, 6);
      await value(temp, 'Temp value');
      const onTemp = await update({ [`analytics:${tempCode}`]: 'Temp value' });
      await approvePreview(harness, ctx, onTemp);
      await runner.query(`DELETE FROM ${linkTable} WHERE tenant_id = $1 AND axis_id = $2`, [seed.tenantId, temp]);
      await runner.query(`DELETE FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2`, [seed.tenantId, temp]);
      await runner.query(`DELETE FROM analytics_axes WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, temp]);
      await expectRejects(() => harness.tools.execute(ctx, 'undo_preview', { preview_id: onTemp.preview_id }), /^This dimension no longer exists\.$/);
    }
  });
}

/**
 * Lot C1a: the PP&E type, investment type and priority of a CAPEX line are the values of the
 * dimensions every tenant starts with. A create without them is refused naming the first one; the
 * former field keys are no longer writable; the values pass under `analytics:<code>`.
 */
async function testCapexCriteriaAreDimensions(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    await ensureCapexDimensions(runner.manager, seed.tenantId);
    const ctx = context(seed, runner, 'capex-criteria');
    const fields = { nature: 'capex', product_name: `Criteria ${seed.tag}`, paying_company_id: seed.companyId, currency: 'EUR', effective_start: '2026-01-01' };
    const create = (extra: Record<string, unknown>) =>
      harness.tools.execute(ctx, 'create_business_record', { entity_type: 'budget_lines', fields: { ...fields, ...extra } });

    await expectRejects(() => create({}), /^PP&E type is required for budget line creation\.$/);
    await expectRejects(() => create({ ppe_type: 'hardware' }), /^"?ppe_type"? is not writable for budget lines\./);
    await expectRejects(
      () => create({ 'analytics:ppe_type': 'Hardware', 'analytics:investment_type': 'Capacity' }),
      /^Priority is required for budget line creation\.$/,
    );
    const created = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'budget_lines',
      fields: { ...fields, 'analytics:ppe_type': 'Hardware', 'analytics:investment_type': 'Capacity', 'analytics:priority': 'High' },
    });
    const createdId = (await approvePreview(harness, ctx, created)).target.entity_id;
    const values = await runner.query(
      `SELECT a.code, c.name FROM spend_item_analytics_values v
         JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id
         JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND v.item_id = $2 ORDER BY a.sort_order`,
      [seed.tenantId, createdId],
    );
    assert.deepEqual(values.map((row: any) => `${row.code}=${row.name}`), ['ppe_type=Hardware', 'investment_type=Capacity', 'priority=High']);
  });
}

/**
 * Lot D2: a required dimension. The create preview is refused without a value on it (in the style
 * of the other create-time fields) and passes with one; an update preview clearing a held value is
 * refused with the write gate's message. A disabled required dimension and one of the other line
 * type are not checked.
 */
async function testItemRequiredDimensions(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const defaultAxisId = await ensureDefaultAnalyticsAxis(runner.manager, seed.tenantId);
    await runner.query(`UPDATE analytics_axes SET name = NULL WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, defaultAxisId]);
    const axis = async (code: string, name: string, extra: { applies_to?: string; disabled?: boolean } = {}): Promise<string> => {
      const [row] = await runner.query(
        `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, applies_to, status, required)
         VALUES ($1, $2, $3, 1, $4, $5, true) RETURNING id`,
        [seed.tenantId, code, name, extra.applies_to ?? null, extra.disabled ? 'disabled' : 'enabled'],
      );
      return row.id;
    };
    const menu = await axis('menu', 'Menu');
    await axis('gone', 'Gone', { disabled: true });
    const [{ id: fromage }] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Fromage') RETURNING id`,
      [seed.tenantId, menu],
    );
    const ctx = context(seed, runner, 'item-required-dimensions');

    for (const line of [
      {
        entityType: 'budget_lines', nature: 'opex', itemId: seed.spendItemId, linkTable: 'spend_item_analytics_values', label: 'budget line', other: 'capex',
        createFields: { nature: 'opex', product_name: `Required ${seed.tag}`, paying_company_id: seed.companyId, currency: 'EUR', effective_start: '2026-01-01' },
      },
      {
        entityType: 'budget_lines', nature: 'capex', itemId: seed.capexItemId, linkTable: 'spend_item_analytics_values', label: 'budget line', other: 'opex',
        createFields: {
          nature: 'capex', product_name: `Required ${seed.tag}`,
          paying_company_id: seed.companyId, currency: 'EUR', effective_start: '2026-01-01',
        },
      },
    ]) {
      const { entityType, itemId, linkTable } = line;
      // Required, but for the other line type only: never checked here.
      const otherCode = `recipe-${line.other}`;
      const otherAxis = await axis(otherCode, `Recipe ${line.other}`, { applies_to: line.other });
      const create = (fields: Record<string, unknown>) =>
        harness.tools.execute(ctx, 'create_business_record', { entity_type: entityType, fields });

      await expectRejects(() => create(line.createFields), new RegExp(`^Menu is required for ${line.label} creation\\.$`));
      await expectRejects(() => create({ ...line.createFields, 'analytics:menu': null }), new RegExp(`^Menu is required for ${line.label} creation\\.$`));
      const created = await executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: entityType, fields: { ...line.createFields, 'analytics:menu': 'Fromage' },
      });
      const createdId = (await approvePreview(harness, ctx, created)).target.entity_id;
      const [link] = await runner.query(
        `SELECT category_id FROM ${linkTable} WHERE tenant_id = $1 AND item_id = $2 AND axis_id = $3`,
        [seed.tenantId, createdId, menu],
      );
      assert.equal(link?.category_id, fromage, `${entityType}: created with the required value`);

      // The default dimension required: its label is the default one while it has no name.
      await runner.query(`UPDATE analytics_axes SET required = true WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, defaultAxisId]);
      await expectRejects(
        () => create({ ...line.createFields, 'analytics:menu': 'Fromage' }),
        new RegExp(`^Analytics dimension is required for ${line.label} creation\\.$`),
      );
      await runner.query(`UPDATE analytics_axes SET required = false WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, defaultAxisId]);

      // Update: clearing a held value is refused with the gate's message.
      await runner.query(
        `INSERT INTO ${linkTable} (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, item_id, axis_id) DO UPDATE SET category_id = EXCLUDED.category_id`,
        [seed.tenantId, itemId, menu, fromage],
      );
      await expectRejects(
        () => harness.tools.execute(ctx, 'update_business_record', { entity_type: entityType, ref: itemId, fields: { 'analytics:menu': null } }),
        /^The Menu dimension is required\. Choose a value\.$/,
      );
      // The next line type is the one this dimension is for.
      await runner.query(`UPDATE analytics_axes SET required = false WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, otherAxis]);
    }
  });
}

/** Lot A: a value created by the AI lands in a named dimension; its dimension cannot change afterwards. */
async function testAnalyticsValueInANamedDimension(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const defaultAxisId = await ensureDefaultAnalyticsAxis(runner.manager, seed.tenantId);
    const [nature] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'nature-cost', 'Nature de coût', 1) RETURNING id`,
      [seed.tenantId],
    );
    const ctx = context(seed, runner, 'analytics-values');
    const create = async (fields: Record<string, unknown>) => {
      const preview = await executeToolPreview(harness, ctx, 'create_master_data_record', { entity_type: 'analytics_categories', fields });
      const executed = await approvePreview(harness, ctx, preview);
      const [row] = await runner.query(
        `SELECT axis_id, name FROM analytics_categories WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, executed.target.entity_id],
      );
      return { preview, row };
    };

    const named = await create({ name: `Hardware ${seed.tag}`, dimension: 'NATURE de coût' });
    assert.equal(named.row.axis_id, nature.id, 'by name, case-insensitive');
    assert.equal(named.preview.changes.dimension.to, 'Nature de coût');
    assert.equal((await create({ name: `Software ${seed.tag}`, dimension: 'Nature-Cost' })).row.axis_id, nature.id, 'by code');
    assert.equal((await create({ name: `Default ${seed.tag}` })).row.axis_id, defaultAxisId, 'the default dimension when omitted');
    // The keys and labels the prompt gives the model.
    assert.equal((await create({ name: `Keyed ${seed.tag}`, dimension: 'analytics:nature-cost' })).row.axis_id, nature.id, 'analytics:<code>');
    assert.equal((await create({ name: `Category ${seed.tag}`, dimension: 'analytics_category' })).row.axis_id, defaultAxisId, 'analytics_category');
    assert.equal((await create({ name: `Label ${seed.tag}`, dimension: 'Analytics dimension' })).row.axis_id, defaultAxisId, 'the default label');

    // Checked at preview as the value service will: an enabled dimension, a coherent "used for".
    await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, status) VALUES ($1, 'old', 'Old', 2, 'disabled')`,
      [seed.tenantId],
    );
    await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, applies_to) VALUES ($1, 'recurrence', 'Recurrence', 3, 'opex')`,
      [seed.tenantId],
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'create_master_data_record', { entity_type: 'analytics_categories', fields: { name: `X ${seed.tag}`, dimension: 'old' } }),
      /^The Old dimension is disabled\. Enable it to add values\.$/,
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'create_master_data_record', {
        entity_type: 'analytics_categories', fields: { name: `X ${seed.tag}`, dimension: 'recurrence', applies_to: 'capex' },
      }),
      /^The Recurrence dimension is for OPEX lines only\.$/,
    );

    await expectRejects(
      () => harness.tools.execute(ctx, 'create_master_data_record', { entity_type: 'analytics_categories', fields: { name: `X ${seed.tag}`, dimension: 'nope' } }),
      /^No analytics dimension has the code or name "nope"\.$/,
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'update_master_data_record', {
        entity_type: 'analytics_categories', ref: `Hardware ${seed.tag}`, fields: { dimension: 'default' },
      }),
      /^A value cannot move to another dimension\. Leave out dimension\.$/,
    );
    // Its own dimension is a no-op.
    const sameDimension = await executeToolPreview(harness, ctx, 'update_master_data_record', {
      entity_type: 'analytics_categories', ref: `Hardware ${seed.tag}`, fields: { dimension: 'nature-cost', description: 'Kept here' },
    });
    assert.deepEqual(Object.keys(sameDimension.changes), ['description']);
    await expectRejects(
      () => harness.tools.execute(ctx, 'update_master_data_record', {
        entity_type: 'analytics_categories', ref: `Hardware ${seed.tag}`, fields: { dimension: 'Nature de coût' },
      }),
      /^analytics category already has the requested values\.$/,
    );
  });
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for ai-write-capabilities.integration.spec.ts.');
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

/**
 * A budget line is named by its business references, whatever its nature: BL-n its own
 * number, OPX-n a spend line's legacy number, CPX-n a CAPEX line's (case-insensitive).
 */
async function testBudgetLinesByBusinessReference(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const [spend] = await runner.query(`SELECT item_number FROM spend_items WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.spendItemId]);
    const [capex] = await runner.query(
      `SELECT item_number, substring(legacy_number FROM '^CPX-([0-9]+)$')::int AS cpx_number FROM spend_items WHERE tenant_id = $1 AND id = $2 AND nature = 'capex'`,
      [seed.tenantId, seed.capexItemId],
    );
    const cases = [
      { itemId: seed.spendItemId, refs: [`OPX-${spend.item_number}`, `BL-${spend.item_number}`] },
      { itemId: seed.capexItemId, refs: [`cpx-${capex.cpx_number}`, `BL-${capex.item_number}`] },
    ];
    for (const { itemId, refs } of cases) {
      for (const ref of refs) {
        const ctx = context(seed, runner, `by-reference-${ref}`);
        const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
          entity_type: 'budget_lines',
          ref,
          fields: { notes: `Notes by ${ref}` },
        });
        assert.equal(preview.target.entity_id, itemId, `${ref} targets the seeded line`);
        await approvePreview(harness, ctx, preview);
        const [row] = await runner.query(`SELECT notes FROM spend_items WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, itemId]);
        assert.equal(row.notes, `Notes by ${ref}`, `${ref} updates the line`);
      }
    }

    // OPX-n reads only the old OPEX number. A line with BL-12012 but no OPX-12012 is found by
    // BL-12012 and by its bare number, never by OPX-12012: the write is refused as a missing line.
    const [blOnly] = await runner.query(
      `INSERT INTO spend_items (
         tenant_id, paying_company_id, product_name, currency, effective_start, status, item_number
       )
       VALUES ($1, $2, $3, 'EUR', DATE '2026-01-01', 'enabled', 12012)
       RETURNING id`,
      [seed.tenantId, seed.companyId, `BL only ${seed.tag}`],
    );
    for (const ref of ['BL-12012', '12012']) {
      const ctx = context(seed, runner, `by-reference-${ref}`);
      const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
        entity_type: 'budget_lines',
        ref,
        fields: { notes: `Notes by ${ref}` },
      });
      assert.equal(preview.target.entity_id, blOnly.id, `${ref} targets BL-12012`);
    }
    await expectRejects(
      () => harness.tools.execute(context(seed, runner, 'by-reference-opx-missing'), 'update_business_record', {
        entity_type: 'budget_lines', ref: 'OPX-12012', fields: { notes: 'Never written' },
      }),
      /No budget lines found matching "OPX-12012"/,
    );
    const [untouched] = await runner.query(`SELECT notes FROM spend_items WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, blOnly.id]);
    assert.equal(untouched.notes, null, 'OPX-12012 wrote nothing on BL-12012');
  });
}

/**
 * Issue 127: a line asked for with an amount is one preview and one approval. The card shows the
 * amount; the approval creates the line, its version of that year and the amounts; the financial
 * plan tool then finds the new line by its BL-n reference.
 */
async function testLineCreatedWithItsAmountInOneApproval(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'line-with-amount');
    const fields = {
      nature: 'opex',
      product_name: `QA Test ${seed.tag}`,
      paying_company_id: seed.companyId,
      currency: 'EUR',
      effective_start: '2026-01-01',
    };
    await expectRejects(
      () => harness.tools.execute(ctx, 'create_business_record', {
        entity_type: 'applications', fields: { name: `No amounts ${seed.tag}` }, amounts: { kind: 'annual', year: 2026, totals: { planned: 1 } },
      }),
      /amounts is only accepted when creating a budget line/,
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'create_business_record', {
        entity_type: 'budget_lines', fields, amounts: { kind: 'annual', year: 2026, totals: { planned: 'twelve' } },
      }),
      /amounts\.totals\.planned must be a number/,
    );
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'budget_lines',
      fields,
      amounts: { kind: 'annual', year: 2026, totals: { planned: 12000 } },
    });
    assert.equal(preview.changes.amounts.from, null);
    assert.match(preview.changes.amounts.to, /2026/);
    assert.match(preview.changes.amounts.to, /12000/);
    assert.deepEqual(preview.changes.amounts.amounts, {
      from: null,
      to: { year: 2026, currency: 'EUR', column_names: {}, totals: { planned: 12000 } },
    });

    const executed = await approvePreview(harness, ctx, preview);
    const lineId = executed.target.entity_id;
    const [version] = await runner.query(
      `SELECT id, version_name, budget_year FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2`,
      [seed.tenantId, lineId],
    );
    assert.equal(version.version_name, 'Y2026');
    assert.equal(version.budget_year, 2026);
    const [totals] = await runner.query(
      `SELECT round(sum(planned)::numeric, 2)::float8 AS planned FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2`,
      [seed.tenantId, version.id],
    );
    assert.equal(totals.planned, 12000);

    const [line] = await runner.query(`SELECT item_number FROM spend_items WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, lineId]);
    const byReference = await executeToolPreview(harness, ctx, 'write_financial_plan', {
      entity_type: 'budget_lines',
      ref: `BL-${line.item_number}`,
      action: 'upsert_amounts',
      version_ref: '2026',
      amounts: { kind: 'annual', year: 2026, totals: { planned: 13000 } },
    });
    assert.equal(byReference.target.entity_id, lineId, 'BL-n names the new line');
  });
}

/**
 * One budget line family on the write surface: `nature` is required on creation and refused on
 * update, `contract_id` is refused on a CAPEX line, old entity types do not pass the schema, a
 * task on either nature stores its own `related_object_type`, relations accept both natures, and
 * the financial plan writes the OPEX and the CAPEX line through the one family.
 */
async function testBudgetLineSingleFamilyWrites(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'budget-family');
    const base = { paying_company_id: seed.companyId, currency: 'EUR', effective_start: '2026-01-01' };

    await expectRejects(
      () => harness.tools.execute(ctx, 'create_business_record', {
        entity_type: 'budget_lines',
        fields: { product_name: `No nature ${seed.tag}`, ...base },
      }),
      /nature is required to create a budget line: opex or capex/,
    );

    for (const nature of ['capex', 'opex'] as const) {
      const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: 'budget_lines',
        fields: { nature, product_name: `Family ${nature} ${seed.tag}`, ...base },
      });
      const created = await approvePreview(harness, ctx, preview);
      const [row] = await runner.query(
        `SELECT nature FROM spend_items WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, created.target.entity_id],
      );
      assert.equal(row.nature, nature, `the created line is ${nature}`);
    }

    const before = await runner.query(`SELECT count(*)::int AS n FROM ai_mutation_previews WHERE tenant_id = $1`, [seed.tenantId]);
    await expectRejects(
      () => harness.tools.execute(ctx, 'update_business_record', {
        entity_type: 'budget_lines', ref: seed.spendItemId, fields: { nature: 'capex', notes: 'Never written' },
      }),
      /The nature of a budget line cannot be changed here: change the line type in the budget screen\./,
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'update_business_record', {
        entity_type: 'budget_lines', ref: seed.capexItemId, fields: { contract_id: seed.contractId },
      }),
      /A contract cannot be written on a CAPEX line/,
    );
    const [after] = await runner.query(`SELECT count(*)::int AS n FROM ai_mutation_previews WHERE tenant_id = $1`, [seed.tenantId]);
    assert.equal(after.n, before[0].n, 'both refusals happen before any preview');

    await expectRejects(
      () => harness.tools.execute(ctx, 'create_business_record', {
        entity_type: 'spend_items', fields: { product_name: `Old type ${seed.tag}` },
      }),
      /must be one of/,
    );

    const task = await executeToolPreview(harness, ctx, 'create_task', {
      title: `CAPEX task ${seed.tag}`,
      relation_type: 'budget_line',
      relation_ref: seed.capexItemId,
    });
    await approvePreview(harness, ctx, task);
    const [taskRow] = await runner.query(
      `SELECT related_object_type FROM tasks WHERE tenant_id = $1 AND title = $2`,
      [seed.tenantId, `CAPEX task ${seed.tag}`],
    );
    assert.equal(taskRow.related_object_type, 'capex_item', 'the stored task type comes from the line nature');

    const relation = await executeToolPreview(harness, ctx, 'update_entity_relations', {
      entity_type: 'applications',
      ref: seed.applicationId,
      relation: 'budget_lines',
      add: [seed.spendItemId, seed.capexItemId],
    });
    // Two lines of the same title stay distinct on the card: each carries its BL-n reference.
    const lineLabels = await runner.query(
      `SELECT item_number, product_name FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [seed.tenantId, [seed.spendItemId, seed.capexItemId]],
    );
    for (const line of lineLabels) {
      assert.ok(
        String(relation.changes.budget_lines.to).includes(`BL-${line.item_number} - ${line.product_name}`),
        `the relation preview names BL-${line.item_number} - ${line.product_name} (${relation.changes.budget_lines.to})`,
      );
    }
    await approvePreview(harness, ctx, relation);
    const links = await runner.query(
      `SELECT spend_item_id FROM application_spend_items WHERE tenant_id = $1 AND application_id = $2`,
      [seed.tenantId, seed.applicationId],
    );
    assert.deepEqual(links.map((row: any) => row.spend_item_id).sort(), [seed.spendItemId, seed.capexItemId].sort(), 'one relation, both natures');

    for (const ref of [seed.spendItemId, seed.capexItemId]) {
      const version = await executeToolPreview(harness, ctx, 'write_financial_plan', {
        entity_type: 'budget_lines',
        ref,
        action: 'create_version',
        fields: { version_name: `Plan ${seed.tag}`, input_grain: 'annual', budget_year: 2027, as_of_date: '2027-01-01' },
      });
      await approvePreview(harness, ctx, version);
      const [row] = await runner.query(
        `SELECT count(*)::int AS n FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2 AND budget_year = 2027`,
        [seed.tenantId, ref],
      );
      assert.equal(row.n, 1, 'the financial plan writes the line through its nature');
    }
  });
}

/**
 * A preview executed before the one budget line family (`spend_items` / `capex_items`): its card
 * still loads in the conversation, and its undo is refused with a readable 400, not a 500. A
 * relation preview of the old type is the same: its stored `spend_items` relation no longer exists,
 * yet it must not make the conversation's list fail.
 */
async function testLegacyBudgetLinePreviewUndoRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'legacy-preview');
    await runner.query(
      `INSERT INTO ai_conversations (
         id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'AI capabilities integration', 'custom', 'capability-test-model', 'custom', now(), now())`,
      [ctx.conversationId, ctx.tenantId, ctx.userId],
    );
    const [legacy] = await runner.query(
      `INSERT INTO ai_mutation_previews (
         tenant_id, conversation_id, user_id, tool_name, target_entity_type, target_entity_id,
         mutation_input, current_values, status, executed_at, expires_at, created_at
       )
       VALUES ($1, $2, $3, 'update_business_record', 'spend_items', $4,
               '{"action":"update","entity_type":"spend_items","fields":{"notes":"Legacy"}}'::jsonb,
               '{"target_ref":"BL-1","target_title":"Legacy line","values":{"notes":"Before"}}'::jsonb,
               'executed', now(), now() + interval '1 hour', now()) RETURNING id`,
      [seed.tenantId, ctx.conversationId, ctx.userId, seed.spendItemId],
    );
    // An old relation preview on a current family: only its relation names the old type.
    const [legacyRelation] = await runner.query(
      `INSERT INTO ai_mutation_previews (
         tenant_id, conversation_id, user_id, tool_name, target_entity_type, target_entity_id,
         mutation_input, current_values, status, executed_at, expires_at, created_at
       )
       VALUES ($1, $2, $3, 'update_entity_relations', 'applications', $4,
               '{"action":"update_relations","entity_type":"applications","relation":"spend_items","next_items":[]}'::jsonb,
               '{"target_ref":"APP-1","target_title":"Legacy relation","items":[]}'::jsonb,
               'executed', now(), now() + interval '1 hour', now()) RETURNING id`,
      [seed.tenantId, ctx.conversationId, ctx.userId, seed.applicationId],
    );
    // A preview no operation can present: the list still loads, with a neutral card.
    const [unknown] = await runner.query(
      `INSERT INTO ai_mutation_previews (
         tenant_id, conversation_id, user_id, tool_name, target_entity_type, target_entity_id,
         mutation_input, current_values, status, executed_at, expires_at, created_at
       )
       VALUES ($1, $2, $3, 'a_tool_removed_since', 'applications', $4,
               '{"action":"update"}'::jsonb, '{"target_title":"Removed tool"}'::jsonb,
               'executed', now(), now() + interval '1 hour', now()) RETURNING id`,
      [seed.tenantId, ctx.conversationId, ctx.userId, seed.applicationId],
    );
    const listed = await harness.previews.listConversationPreviews(ctx, ctx.conversationId);
    const card = listed.find((preview: any) => preview.preview_id === legacy.id);
    assert.ok(card, 'the old preview still lists');
    assert.equal(card.target.entity_type, 'spend_items', 'its card keeps the stored type: no link, no error');
    assert.deepEqual(card.changes, {}, 'no field labels for an old type');
    const relationCard = listed.find((preview: any) => preview.preview_id === legacyRelation.id);
    assert.ok(relationCard, 'the old relation preview still lists');
    assert.equal(relationCard.target.entity_type, 'applications', 'its card keeps the stored family');
    assert.deepEqual(relationCard.changes, {}, 'no field labels for an old relation');
    assert.match(String(relationCard.summary), /before a Plaid update/, 'the card says it predates the change');
    assert.ok(listed.some((preview: any) => preview.preview_id === unknown.id), 'a preview that cannot present still lists');
    assert.deepEqual(listed.find((preview: any) => preview.preview_id === unknown.id).changes, {}, 'its card is neutral');

    for (const [previewId, what] of [[legacy.id, 'old line'], [legacyRelation.id, 'old relation']] as const) {
      let refusal: any = null;
      try {
        await harness.previews.createReversePreview(ctx, previewId);
      } catch (error) {
        refusal = error;
      }
      assert.ok(refusal, `the undo of the ${what} preview is refused`);
      assert.equal(refusal.getStatus?.(), 400, `the undo of the ${what} preview is a clean 4xx, not a 500`);
      assert.match(String(refusal.message), /before a Plaid update and can no longer be undone here: use the screen\./);
    }
  });
}

async function run() {
  const harness = await createHarness();
  try {
    await testReadDepthToolAvailabilityAndTenantIsolation(harness);
    await testMasterDataPreviewApprovalAuditAndUndo(harness);
    await testRelationWritesAndSupplierPropagationUndo(harness);
    await testBusinessTaskFinancialWritesAndRbac(harness);
    await testCapexOwnersAnalyticsAndApplications(harness);
    await testApplicationLineRelationAuditByNature(harness);
    await testTaskRelatedSortByDisplayedFamily(harness);
    await testItemAnalyticsCategoryThroughTheLinks(harness);
    await testItemAnalyticsDimensions(harness);
    await testItemRequiredDimensions(harness);
    await testCapexCriteriaAreDimensions(harness);
    await testAnalyticsValueInANamedDimension(harness);
    await testBudgetLinesByBusinessReference(harness);
    await testLineCreatedWithItsAmountInOneApproval(harness);
    await testBudgetLineSingleFamilyWrites(harness);
    await testLegacyBudgetLinePreviewUndoRefused(harness);
  } finally {
    await harness.app.close();
  }
}

run().catch((error) => {
  // Keep integration failures visible when Nest logger is disabled for quieter passing runs.
  console.error(error?.stack || error);
  process.exit(1);
});
