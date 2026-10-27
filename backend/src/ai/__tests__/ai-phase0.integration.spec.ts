import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { AiEntityService } from '../ai-entity.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';
import { AiPhase0Foundation1843500000000 } from '../../migrations/1843500000000-ai-phase0-foundation';

async function assertAiFoundationTablesAndPolicies() {
  const tableRows = await dataSource.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename IN ('ai_settings', 'ai_api_keys', 'ai_conversations', 'ai_messages')
     ORDER BY tablename ASC`,
  );
  assert.deepEqual(
    tableRows.map((row: any) => row.tablename),
    ['ai_api_keys', 'ai_conversations', 'ai_messages', 'ai_settings'],
  );

  const policyRows = await dataSource.query(
    `SELECT tablename, policyname
     FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('ai_settings', 'ai_api_keys', 'ai_conversations', 'ai_messages')
     ORDER BY tablename ASC, policyname ASC`,
  );
  const policies = policyRows.map((row: any) => `${row.tablename}:${row.policyname}`);
  for (const table of ['ai_settings', 'ai_api_keys', 'ai_conversations', 'ai_messages']) {
    assert.equal(policies.includes(`${table}:${table}_tenant_isolation`), true);
  }
}

async function seedTenant(runner: any, tenantId: string, slug: string, name: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, name],
  );
}

async function setCurrentTenant(runner: any, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function testAiMigrationRoleSeedingIsNonDestructive() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const collidingTenant = randomUUID();
  const freshTenant = randomUUID();
  const collidingRoleId = randomUUID();

  try {
    await seedTenant(runner, collidingTenant, `ai-collision-${collidingTenant.slice(0, 8)}`, 'AI Collision Tenant');
    await seedTenant(runner, freshTenant, `ai-fresh-${freshTenant.slice(0, 8)}`, 'AI Fresh Tenant');

    await setCurrentTenant(runner, collidingTenant);
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'AI Chat User', 'Tenant custom role', false, false, now(), now())`,
      [collidingRoleId, collidingTenant],
    );

    const migration = new AiPhase0Foundation1843500000000();
    await migration.up(runner);

    const collisionRows = await runner.query(
      `SELECT is_built_in, role_description
       FROM roles
       WHERE id = $1`,
      [collidingRoleId],
    );
    assert.equal(collisionRows.length, 1);
    assert.equal(collisionRows[0].is_built_in, false);
    assert.equal(collisionRows[0].role_description, 'Tenant custom role');

    const collisionPerms = await runner.query(
      `SELECT resource, level
       FROM role_permissions
       WHERE role_id = $1`,
      [collidingRoleId],
    );
    assert.equal(collisionPerms.length, 0);

    await setCurrentTenant(runner, freshTenant);
    const seededRows = await runner.query(
      `SELECT is_built_in, role_description
       FROM roles
       WHERE tenant_id = $1
         AND role_name = 'AI Chat User'`,
      [freshTenant],
    );
    assert.equal(seededRows.length, 1);
    assert.equal(seededRows[0].is_built_in, true);
    assert.equal(
      seededRows[0].role_description,
      'Can use read-only AI chat tools that respect existing business permissions',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAiEntityServiceAgainstRealQueries() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  const tenantOne = randomUUID();
  const tenantTwo = randomUUID();
  const taskOne = randomUUID();
  const taskTwo = randomUUID();
  const requestOne = randomUUID();
  const requestTwo = randomUUID();
  const projectOne = randomUUID();
  const projectDependencyOne = randomUUID();

  try {
    await seedTenant(runner, tenantOne, `ai-phase0-${tenantOne.slice(0, 8)}`, 'AI Phase 0 Tenant One');
    await seedTenant(runner, tenantTwo, `ai-phase0-${tenantTwo.slice(0, 8)}`, 'AI Phase 0 Tenant Two');

    await setCurrentTenant(runner, tenantOne);
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids, created_at, updated_at)
       VALUES ($1, $2, 101, 'AI hardening task', 'Tenant one task', 'open', null, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
      [taskOne, tenantOne],
    );
    await runner.query(
      `INSERT INTO portfolio_requests (
         id, tenant_id, item_number, name, origin_task_id, status,
         current_situation, expected_benefits,
         criteria_values, feasibility_review, priority_override, created_at, updated_at
       )
       VALUES (
         $1, $2, 201, 'AI hardening request', $3, 'pending_review',
         'Manual portfolio coordination slows delivery.',
         'Faster AI rollout with clearer delivery signals.',
         '{}'::jsonb, '{}'::jsonb, false, now(), now()
       )`,
      [requestOne, tenantOne, taskOne],
    );
    await runner.query(
      `INSERT INTO portfolio_projects (
         id, tenant_id, item_number, name, origin, status, execution_progress, planned_end, created_at, updated_at
       )
       VALUES ($1, $2, 301, 'AI delivery project', 'fast_track', 'planned', 35, DATE '2026-05-15', now(), now())`,
      [projectOne, tenantOne],
    );
    await runner.query(
      `INSERT INTO portfolio_projects (
         id, tenant_id, item_number, name, origin, status, execution_progress, planned_end, created_at, updated_at
       )
       VALUES ($1, $2, 302, 'AI dependency project', 'legacy', 'in_progress', 70, DATE '2026-04-30', now(), now())`,
      [projectDependencyOne, tenantOne],
    );
    await runner.query(
      `INSERT INTO portfolio_request_projects (tenant_id, request_id, project_id)
       VALUES ($1, $2, $3)`,
      [tenantOne, requestOne, projectOne],
    );
    await runner.query(
      `INSERT INTO portfolio_request_dependencies (tenant_id, request_id, depends_on_project_id, dependency_type, created_at)
       VALUES ($1, $2, $3, 'blocks', now())`,
      [tenantOne, requestOne, projectDependencyOne],
    );
    await runner.query(
      `INSERT INTO portfolio_project_dependencies (tenant_id, project_id, depends_on_project_id, dependency_type, created_at)
       VALUES ($1, $2, $3, 'blocks', now())`,
      [tenantOne, projectOne, projectDependencyOne],
    );

    await setCurrentTenant(runner, tenantTwo);
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids, created_at, updated_at)
       VALUES ($1, $2, 101, 'AI hardening task other tenant', 'Tenant two task', 'open', null, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
      [taskTwo, tenantTwo],
    );
    await runner.query(
      `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, origin_task_id, status, criteria_values, feasibility_review, priority_override, created_at, updated_at)
       VALUES ($1, $2, 201, 'AI hardening request other tenant', $3, 'pending_review', '{}'::jsonb, '{}'::jsonb, false, now(), now())`,
      [requestTwo, tenantTwo, taskTwo],
    );

    const entityService = new AiEntityService(
      {
        search: async () => ({ items: [], total: 0 }),
        listReadableLibraryIdsForUser: async () => null,
        getKnowledgeContextForEntity: async () => ({
          access: 'granted',
          total: 0,
          groups: [],
        }),
      } as any,
      {
        listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
        canReadKnowledge: async () => true,
        canReadEntityType: async () => true,
        assertEntityTypeReadAccess: async () => undefined,
      } as any,
    );

    await setCurrentTenant(runner, tenantOne);
    const tenantOneContext = {
      tenantId: tenantOne,
      userId: randomUUID(),
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    const refSearch = await entityService.searchAll(tenantOneContext, {
      query: 'T-101',
      entity_types: ['tasks', 'requests'],
      limit: 10,
    });
    assert.equal(refSearch.items.length, 1);
    assert.equal(refSearch.items[0].id, taskOne);
    assert.equal(refSearch.items[0].ref, 'T-101');

    const textSearch = await entityService.searchAll(tenantOneContext, {
      query: 'AI hardening',
      entity_types: ['tasks', 'requests'],
      limit: 10,
    });
    assert.deepEqual(
      textSearch.items.map((item: any) => item.id).sort(),
      [requestOne, taskOne].sort(),
    );
    assert.equal(textSearch.items.some((item: any) => item.id === taskTwo || item.id === requestTwo), false);

    const requestSummarySearch = await entityService.searchAll(tenantOneContext, {
      query: 'portfolio coordination',
      entity_types: ['requests'],
      limit: 10,
    });
    assert.equal(requestSummarySearch.items.length, 1);
    assert.equal(requestSummarySearch.items[0].id, requestOne);
    assert.equal(
      requestSummarySearch.items[0].summary,
      'Manual portfolio coordination slows delivery.',
    );

    const projectRefSearch = await entityService.searchAll(tenantOneContext, {
      query: 'PRJ-301',
      entity_types: ['projects'],
      limit: 10,
    });
    assert.equal(projectRefSearch.items.length, 1);
    assert.equal(projectRefSearch.items[0].id, projectOne);
    assert.equal(projectRefSearch.items[0].ref, 'PRJ-301');
    assert.equal(projectRefSearch.items[0].summary?.includes('Origin: fast_track'), true);

    const taskContext = await entityService.getEntityContext(tenantOneContext, {
      entity_type: 'tasks',
      entity_id: taskOne,
    });
    assert.equal(taskContext.entity.id, taskOne);
    assert.equal(taskContext.entity.ref, 'T-101');
    assert.equal(taskContext.related.length, 1);
    assert.equal(taskContext.related[0].relation, 'converted_request');
    assert.equal(taskContext.related[0].items[0].id, requestOne);
    assert.equal(taskContext.related[0].items[0].ref, 'REQ-201');
    assert.equal(
      taskContext.related[0].items[0].summary,
      'Manual portfolio coordination slows delivery.',
    );

    const requestContext = await entityService.getEntityContext(tenantOneContext, {
      entity_type: 'requests',
      entity_id: requestOne,
    });
    assert.equal(requestContext.entity.id, requestOne);
    assert.equal(requestContext.entity.ref, 'REQ-201');
    assert.equal(
      requestContext.entity.summary,
      'Manual portfolio coordination slows delivery.',
    );
    assert.equal(
      requestContext.entity.metadata.current_situation,
      'Manual portfolio coordination slows delivery.',
    );
    assert.equal(
      requestContext.entity.metadata.expected_benefits,
      'Faster AI rollout with clearer delivery signals.',
    );
    assert.equal(requestContext.related.length, 2);
    assert.equal(requestContext.related[0].relation, 'resulting_projects');
    assert.deepEqual(
      requestContext.related[0].items.map((item: any) => item.id),
      [projectOne],
    );
    assert.equal(requestContext.related[1].relation, 'dependencies');
    assert.deepEqual(
      requestContext.related[1].items.map((item: any) => item.id),
      [projectDependencyOne],
    );

    const projectContext = await entityService.getEntityContext(tenantOneContext, {
      entity_type: 'projects',
      entity_id: projectOne,
    });
    assert.equal(projectContext.entity.id, projectOne);
    assert.equal(projectContext.entity.ref, 'PRJ-301');
    assert.equal(projectContext.entity.metadata.origin, 'fast_track');
    assert.equal(projectContext.entity.metadata.execution_progress, 35);
    assert.equal(projectContext.related.length, 2);
    assert.equal(projectContext.related[0].relation, 'source_requests');
    assert.deepEqual(
      projectContext.related[0].items.map((item: any) => item.id),
      [requestOne],
    );
    assert.equal(projectContext.related[1].relation, 'dependencies');
    assert.deepEqual(
      projectContext.related[1].items.map((item: any) => item.id),
      [projectDependencyOne],
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedAiExecutionTestData(tenantOne: string, tenantTwo: string) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    await seedTenant(runner, tenantOne, `ai-exec-${tenantOne.slice(0, 8)}`, 'AI Execution Tenant One');
    await seedTenant(runner, tenantTwo, `ai-exec-${tenantTwo.slice(0, 8)}`, 'AI Execution Tenant Two');

    await setCurrentTenant(runner, tenantOne);
    await runner.query(
      `INSERT INTO ai_settings (
         tenant_id,
         chat_enabled,
         mcp_enabled,
         llm_provider,
         llm_model,
         created_at,
         updated_at
       )
       VALUES ($1, true, false, 'openai', 'gpt-4o-mini', now(), now())`,
      [tenantOne],
    );

    await setCurrentTenant(runner, tenantTwo);
    await runner.query(
      `INSERT INTO ai_settings (
         tenant_id,
         chat_enabled,
         mcp_enabled,
         llm_provider,
         llm_model,
         created_at,
         updated_at
       )
       VALUES ($1, false, true, 'custom', 'tenant-two-model', now(), now())`,
      [tenantTwo],
    );

    await runner.commitTransaction();
  } catch (error) {
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction();
    }
    throw error;
  } finally {
    await runner.release();
  }
}

async function cleanupAiExecutionTestData(tenantIds: string[]) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    await runner.query(
      `DELETE FROM ai_settings
       WHERE tenant_id = ANY($1::uuid[])`,
      [tenantIds],
    );
    await runner.query(
      `DELETE FROM tenants
       WHERE id = ANY($1::uuid[])`,
      [tenantIds],
    );
    await runner.commitTransaction();
  } catch (error) {
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction();
    }
    throw error;
  } finally {
    await runner.release();
  }
}

async function testAiTenantExecutionKeepsTenantContextAcrossQueries() {
  const tenantOne = randomUUID();
  const tenantTwo = randomUUID();
  await seedAiExecutionTestData(tenantOne, tenantTwo);

  try {
    const executor = new AiTenantExecutionService(dataSource);
    const result = await executor.run(tenantOne, async (manager) => {
      const currentTenantRows = await manager.query(
        `SELECT current_setting('app.current_tenant', true) AS tenant_id`,
      );
      const appTenantRows = await manager.query(
        `SELECT app_current_tenant()::text AS tenant_id`,
      );
      const countRows = await manager.query(
        `SELECT COUNT(*)::int AS total
         FROM ai_settings`,
      );
      const settingsRows = await manager.query(
        `SELECT tenant_id::text AS tenant_id, chat_enabled, mcp_enabled
         FROM ai_settings
         ORDER BY tenant_id ASC`,
      );

      return {
        currentTenant: currentTenantRows[0]?.tenant_id ?? null,
        appTenant: appTenantRows[0]?.tenant_id ?? null,
        totalSettings: countRows[0]?.total ?? null,
        settingsRows,
      };
    });

    assert.equal(result.currentTenant, tenantOne);
    assert.equal(result.appTenant, tenantOne);
    assert.equal(result.totalSettings, 1);
    assert.equal(result.settingsRows.length, 1);
    assert.equal(result.settingsRows[0]?.tenant_id, tenantOne);
    assert.equal(result.settingsRows[0]?.chat_enabled, true);
    assert.equal(result.settingsRows[0]?.mcp_enabled, false);
  } finally {
    await cleanupAiExecutionTestData([tenantOne, tenantTwo]);
  }
}

async function run() {
  await dataSource.initialize();
  try {
    await assertAiFoundationTablesAndPolicies();
    await testAiMigrationRoleSeedingIsNonDestructive();
    await testAiEntityServiceAgainstRealQueries();
    await testAiTenantExecutionKeepsTenantContextAcrossQueries();
  } finally {
    await dataSource.destroy();
  }
}

void run();
