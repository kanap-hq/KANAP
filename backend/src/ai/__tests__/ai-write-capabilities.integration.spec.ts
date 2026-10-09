import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { ensureDefaultAnalyticsAxis } from '../../analytics/analytics-axes.util';

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
  'opex',
  'capex',
  'portfolio_projects',
  'portfolio_requests',
  'tasks',
  'knowledge',
  'users',
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
    `INSERT INTO capex_items (
       id, tenant_id, paying_company_id, supplier_id, description, ppe_type,
       investment_type, priority, currency, effective_start, status, notes,
       item_number, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'hardware', 'capacity', 'medium', 'EUR',
       DATE '2026-01-01', 'enabled', 'Original capex note',
       (SELECT COALESCE(MAX(item_number), 0) + 1 FROM capex_items WHERE tenant_id = $2), now(), now()
     )`,
    [capexItemId, tenantId, companyId, supplierId, `PLAID Capability CAPEX ${tag}`],
  );
  await runner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     SELECT $1, 'capex', COALESCE(MAX(item_number), 0) + 1
     FROM capex_items
     WHERE tenant_id = $1
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
      ['capex_item_contacts', 'capex_item_id', seed.capexItemId],
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
      entity_type: 'spend_items',
      fields: {
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
      entity_type: 'spend_items',
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
        entity_type: 'spend_items',
        ref: createdSpendId,
        action: 'upsert_amounts',
        version_ref: versionRow.id,
        amounts: { kind: 'monthly', year: 2027, months: [{ period: '2027-01-01', planned: 100 }] },
      }),
      /The amounts are for 2027, but financial version ".*" is for 2026/,
    );

    // An unknown spread profile is refused at the preview, with the message the write gives.
    const profilePreview = (amounts: Record<string, unknown>) => executeToolPreview(harness, financialCtx, 'write_financial_plan', {
      entity_type: 'spend_items',
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
      entity_type: 'spend_items',
      ref: createdSpendId,
      action: 'upsert_amounts',
      version_ref: versionRow.id,
      amounts: {
        kind: 'annual',
        year: 2026,
        totals: { planned: 12000, committed: 3000, actual: 1000, expected_landing: 11000 },
      },
    });
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
      entity_type: 'spend_items',
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
      entity_type: 'spend_items',
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
        entity_type: 'capex_items',
        fields: {
          description: `Forbidden CAPEX ${seed.tag}`,
          ppe_type: 'hardware',
          investment_type: 'capacity',
          priority: 'medium',
          paying_company_id: seed.companyId,
          currency: 'EUR',
          effective_start: '2026-01-01',
        },
      }),
      /capex:member|permission|available/i,
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
        entity_type: 'capex_items',
        ref: seed.capexItemId,
        fields: { analytics_category_id: foreignCategory.id },
      }),
      /Analytics Category not found/,
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'update_business_record', {
        entity_type: 'capex_items',
        ref: seed.capexItemId,
        fields: { owner_it_id: foreignUser.id },
      }),
      /not found/i,
    );

    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'capex_items',
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
         FROM capex_items ci
         LEFT JOIN capex_item_analytics_values v ON v.tenant_id = ci.tenant_id AND v.item_id = ci.id AND v.axis_id = $3
        WHERE ci.tenant_id = $1 AND ci.id = $2`,
      [seed.tenantId, seed.capexItemId, axisId],
    );
    assert.deepEqual(
      [capexRow.owner_it_id, capexRow.owner_business_id, capexRow.analytics_category_id],
      [seed.userId, seed.userId, category.id],
      'CAPEX owners and analytics category are set by the AI',
    );

    const relationCtx = context(seed, runner, 'capex-applications');
    const relationPreview = await executeToolPreview(harness, relationCtx, 'update_entity_relations', {
      entity_type: 'capex_items',
      ref: seed.capexItemId,
      relation: 'applications',
      add: [seed.applicationId],
    });
    await approvePreview(harness, relationCtx, relationPreview);
    const linkRows = () => runner.query(
      `SELECT application_id FROM application_capex_items WHERE tenant_id = $1 AND capex_item_id = $2`,
      [seed.tenantId, seed.capexItemId],
    );
    assert.deepEqual((await linkRows()).map((row: any) => row.application_id), [seed.applicationId], 'the CAPEX item is linked to the application');
    const undoPreview = await harness.tools.execute(relationCtx, 'undo_preview', { preview_id: relationPreview.preview_id }) as any;
    await approvePreview(harness, relationCtx, undoPreview);
    assert.equal((await linkRows()).length, 0, 'undo removes the link');
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

    for (const [entityType, itemId, itemTable, linkTable] of [
      ['spend_items', seed.spendItemId, 'spend_items', 'spend_item_analytics_values'],
      ['capex_items', seed.capexItemId, 'capex_items', 'capex_item_analytics_values'],
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
      assert.equal(preview.changes.analytics_category_id.from, current, `${entityType}: the preview shows the link's current value`);
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
          /Analytics Category not found/,
        );
      }
      await expectRejects(
        () => harness.tools.execute(ctx, 'update_business_record', { entity_type: entityType, ref: itemId, fields: { analytics_category: `Retired ${seed.tag}` } }),
        /This value is disabled/,
      );
      // A value restricted to the other line type is refused, with the write gate's message.
      const [lineType, otherType] = entityType === 'spend_items' ? ['OPEX', 'CAPEX'] : ['CAPEX', 'OPEX'];
      await expectRejects(
        () => harness.tools.execute(ctx, 'update_business_record', { entity_type: entityType, ref: itemId, fields: { analytics_category: `${otherType} only ${seed.tag}` } }),
        new RegExp(`^${otherType} only ${seed.tag} is for ${otherType} lines only\\. Choose a value for ${lineType} lines\\.$`),
      );
    }
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

async function run() {
  const harness = await createHarness();
  try {
    await testReadDepthToolAvailabilityAndTenantIsolation(harness);
    await testMasterDataPreviewApprovalAuditAndUndo(harness);
    await testRelationWritesAndSupplierPropagationUndo(harness);
    await testBusinessTaskFinancialWritesAndRbac(harness);
    await testCapexOwnersAnalyticsAndApplications(harness);
    await testItemAnalyticsCategoryThroughTheLinks(harness);
  } finally {
    await harness.app.close();
  }
}

run().catch((error) => {
  // Keep integration failures visible when Nest logger is disabled for quieter passing runs.
  console.error(error?.stack || error);
  process.exit(1);
});
