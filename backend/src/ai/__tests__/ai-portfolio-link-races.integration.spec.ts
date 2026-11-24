// @database-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';

// A link between an application and a project (or a request) is written from both ends: the
// application's Relations tab, the project's Relations tab, and the assistant's cards on either
// record (lot K2b, second review). The project's side counts what it really wrote: when the other
// end stored the same link meanwhile, it writes nothing, so a card is refused (the direct path's
// "nothing was written") and the screen logs no second activity and no second audit row.
// Two connections: the first transaction holds its locks while the second starts.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-portfolio-link-races-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const FULL = {
  applications: 'admin', infrastructure: 'admin', budget: 'admin', contracts: 'admin', portfolio_projects: 'admin',
  portfolio_requests: 'admin', ai_chat: 'member',
} as const;

type Outcome = { ok: boolean; error?: any; waited: boolean };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-portfolio-link-races.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiRelationMutationSupportService } = require('../mutation/ai-relation-mutation-support.service');
  const { ApplicationsRelationsService } = require('../../applications/services/applications-relations.service');
  const { PortfolioRelationsService } = require('../../portfolio/portfolio-relations.service');
  const { EmailService } = require('../../email/email.service');
  const { purgeTenantTables } = require('../../admin/tenants/tenant-data-purge');
  const { TENANT_PURGE_TABLES } = require('../../admin/tenants/tenant-purge.inventory');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  // No real e-mail from a spec.
  app.get(EmailService, { strict: false }).send = async () => undefined;
  const dataSource = app.get(DataSource);
  const assistant = app.get(AiRelationMutationSupportService);
  const appTabs = app.get(ApplicationsRelationsService);
  const portfolio = app.get(PortfolioRelationsService);
  const tenantId = randomUUID();
  const failures: string[] = [];

  /** One transaction of the tenant on its own connection, committed when `fn` resolves. */
  const inTenant = async <T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const value = await fn(runner.manager);
      await runner.commitTransaction();
      return value;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  };
  const id = async (manager: EntityManager, sql: string, params: unknown[]): Promise<string> => (await manager.query(`${sql} RETURNING id`, params))[0].id;

  try {
    await dataSource.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `link-races-${tenantId.slice(0, 8)}`, `link-races-${tenantId.slice(0, 8)}`],
    );
    const writer = await inTenant(async (m) => {
      const roleId = await id(m, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Writer', 'Writer')`, [tenantId]);
      for (const [resource, level] of Object.entries(FULL)) {
        await m.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
      }
      const userId = await id(m,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Claude', 'Writer', $3, 'enabled')`,
        [tenantId, `link-races-${tenantId.slice(0, 8)}@example.test`, roleId]);
      await m.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, userId, roleId]);
      return userId;
    });
    const ctx = (manager: EntityManager) => ({
      tenantId, userId: writer, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager, conversationId: null,
    });
    const card = async (input: Record<string, unknown>) => {
      const prepared: any = await inTenant((m) => assistant.prepareUpdatePreview(ctx(m), input));
      return {
        id: randomUUID(),
        target_entity_type: prepared.targetEntityType,
        target_entity_id: prepared.targetEntityId,
        mutation_input: prepared.mutationInput,
        current_values: prepared.currentValues,
      };
    };
    /** `first` runs in a transaction held open while `second` starts on another connection. */
    const race = async (first: (m: EntityManager) => Promise<unknown>, second: (m: EntityManager) => Promise<unknown>): Promise<Outcome> => {
      let settled = false;
      let waited = false;
      let other: Promise<{ ok: boolean; error?: any }> | null = null;
      await inTenant(async (m) => {
        await first(m);
        other = inTenant((o) => second(o)).then(() => ({ ok: true }), (error: any) => ({ ok: false, error }));
        other.then(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 600));
        waited = !settled;
      });
      const outcome = await (other as unknown as Promise<{ ok: boolean; error?: any }>);
      return { ...outcome, waited };
    };
    let projectN = 0;
    const project = async () => {
      projectN += 1;
      const projectId = await inTenant((m) => id(m, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [tenantId, projectN, `Projet ${projectN}`]));
      return { id: projectId, ref: `PRJ-${projectN}` };
    };
    let requestN = 0;
    const request = async () => {
      requestN += 1;
      return inTenant((m) => id(m, `INSERT INTO portfolio_requests (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [tenantId, requestN, `Demande ${requestN}`]));
    };
    let appN = 0;
    const application = async () => {
      appN += 1;
      const appId = await inTenant((m) => id(m, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, 'enabled')`, [tenantId, `Caisse ${appN}`, `APP-${appN}`]));
      return { id: appId, ref: `APP-${appN}` };
    };
    const count = (sql: string, params: unknown[]) => inTenant(async (m) => Number((await m.query(sql, params))[0].n));
    const projectLinks = (appId: string, projectId: string) => count(
      `SELECT count(*)::int AS n FROM application_projects WHERE tenant_id = $1 AND application_id = $2 AND project_id = $3`, [tenantId, appId, projectId]);
    const requestLinks = (appId: string, requestId: string) => count(
      `SELECT count(*)::int AS n FROM portfolio_request_applications WHERE tenant_id = $1 AND application_id = $2 AND request_id = $3`, [tenantId, appId, requestId]);
    const aiRows = () => count(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND source = 'ai_chat'`, [tenantId]);
    /** The link's audit rows, from either end: the application's side or the project's (request's). */
    const linkAudits = (table: string, appId: string, ownerId: string) => count(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = $2 AND record_id IN ($3, $4)`, [tenantId, table, appId, ownerId]);
    const projectActivities = (projectId: string) => count(
      `SELECT count(*)::int AS n FROM portfolio_activities WHERE tenant_id = $1 AND project_id = $2 AND changed_fields ? 'applications'`, [tenantId, projectId]);
    const requestActivities = (requestId: string) => count(
      `SELECT count(*)::int AS n FROM portfolio_activities WHERE tenant_id = $1 AND request_id = $2 AND changed_fields ? 'applications'`, [tenantId, requestId]);
    const appTabCtx = (m: EntityManager) => ({ manager: m, tenantId, userId: writer, access: { projects: true, requests: true }, writes: {}, scopes: {}, incidentViewer: undefined });
    const projCtx = (m: EntityManager) => ({ manager: m, tenantId, userId: writer, access: { budget_lines: true, applications: true, assets: true, technologies: true, source_requests: true } });
    const reqCtx = (m: EntityManager) => ({
      manager: m, tenantId, userId: writer,
      access: { budget_lines: true, applications: true, assets: true, processes: true, resulting_projects: true },
      writes: { processes: true },
    });
    const noDeadlock = (o: Outcome) => assert.notEqual(o.error?.code, '40P01', 'no deadlock');
    const nothingWritten = (o: Outcome) => {
      assert.equal(o.ok, false, 'the approval is refused');
      assert.match(String(o.error?.message ?? ''), /nothing was written/, String(o.error?.message ?? o.error));
    };

    const cells: Array<[string, () => Promise<void>]> = [
      ['two approvals on both ends: applications.projects, then projects.applications', async () => {
        const a = await application();
        const p = await project();
        const fromApp = await card({ entity_type: 'applications', ref: a.ref, relation: 'projects', add: [p.ref] });
        const fromProject = await card({ entity_type: 'projects', ref: p.ref, relation: 'applications', add: [a.ref] });
        const before = await aiRows();
        const o = await race((m) => assistant.executePreview(ctx(m), fromApp), (m) => assistant.executePreview(ctx(m), fromProject));
        noDeadlock(o);
        assert.equal(o.waited, true, 'the second approval waits for the first');
        nothingWritten(o);
        assert.equal(await projectLinks(a.id, p.id), 1, 'one link');
        assert.equal(await aiRows() - before, 1, 'one audit row by the assistant');
        assert.equal(await projectActivities(p.id), 0, 'no activity on the project for a link it did not write');
      }],
      ['approval projects.applications held, then the application tab links the project', async () => {
        const a = await application();
        const p = await project();
        const fromProject = await card({ entity_type: 'projects', ref: p.ref, relation: 'applications', add: [a.ref] });
        const o = await race((m) => assistant.executePreview(ctx(m), fromProject), (m) => appTabs.setLink('projects', a.id, p.id, true, appTabCtx(m)));
        noDeadlock(o);
        assert.equal(o.ok, true, 'the screen answers');
        assert.equal(await projectLinks(a.id, p.id), 1, 'one link');
        assert.equal(await linkAudits('application_projects', a.id, p.id), 1, 'one audit row: the approval');
        assert.equal(await projectActivities(p.id), 1, 'one activity: the approval');
      }],
      ['application tab link held, then approval projects.applications', async () => {
        const a = await application();
        const p = await project();
        const fromProject = await card({ entity_type: 'projects', ref: p.ref, relation: 'applications', add: [a.ref] });
        const before = await aiRows();
        const o = await race((m) => appTabs.setLink('projects', a.id, p.id, true, appTabCtx(m)), (m) => assistant.executePreview(ctx(m), fromProject));
        noDeadlock(o);
        assert.equal(o.waited, true, 'the approval waits for the screen');
        nothingWritten(o);
        assert.equal(await aiRows() - before, 0, 'no audit row by the assistant');
        assert.equal(await projectLinks(a.id, p.id), 1, 'one link');
        assert.equal(await projectActivities(p.id), 0, 'no activity on the project');
      }],
      ['project tab link held, then approval projects.applications (same record)', async () => {
        const a = await application();
        const p = await project();
        const fromProject = await card({ entity_type: 'projects', ref: p.ref, relation: 'applications', add: [a.ref] });
        const before = await aiRows();
        const o = await race((m) => portfolio.setProjectLink('applications', a.id, true, projCtx(m), async () => ({ id: p.id, tenantId })), (m) => assistant.executePreview(ctx(m), fromProject));
        assert.equal(o.waited, true, 'the approval waits for the screen');
        assert.equal(o.ok, false, 'the approval is refused');
        assert.equal(o.error?.getStatus?.(), 409, 'a conflict');
        assert.equal(await aiRows() - before, 0, 'no audit row by the assistant');
        assert.equal(await projectActivities(p.id), 1, 'one activity: the screen');
      }],
      ['approval applications.projects held, then the project tab links the application', async () => {
        const a = await application();
        const p = await project();
        const fromApp = await card({ entity_type: 'applications', ref: a.ref, relation: 'projects', add: [p.ref] });
        const o = await race((m) => assistant.executePreview(ctx(m), fromApp), (m) => portfolio.setProjectLink('applications', a.id, true, projCtx(m), async () => ({ id: p.id, tenantId })));
        noDeadlock(o);
        assert.equal(o.ok, true, 'the screen answers');
        assert.equal(await projectLinks(a.id, p.id), 1, 'one link');
        assert.equal(await linkAudits('application_projects', a.id, p.id), 1, 'one audit row: the approval');
        assert.equal(await projectActivities(p.id), 0, 'no activity from the project tab for a link it did not write');
      }],
      ['screens only: the application tab and the project tab link the same pair at once', async () => {
        const a = await application();
        const p = await project();
        let second: unknown;
        const o = await race(
          (m) => appTabs.setLink('projects', a.id, p.id, true, appTabCtx(m)),
          async (m) => { second = await portfolio.setProjectLink('applications', a.id, true, projCtx(m), async () => ({ id: p.id, tenantId })); },
        );
        noDeadlock(o);
        assert.equal(o.waited, true, 'the project tab waits for the application tab');
        assert.deepEqual(second, { ok: true, changed: false }, 'the project tab wrote nothing');
        assert.equal(await projectLinks(a.id, p.id), 1, 'one link');
        assert.equal(await linkAudits('application_projects', a.id, p.id), 1, 'one audit row');
        assert.equal(await projectActivities(p.id), 0, 'no activity from the project tab');
      }],
      ['screens only: the application tab and the request tab link the same pair at once', async () => {
        const a = await application();
        const r = await request();
        let second: unknown;
        const o = await race(
          (m) => appTabs.setLink('requests', a.id, r, true, appTabCtx(m)),
          async (m) => { second = await portfolio.setRequestLink('applications', a.id, true, reqCtx(m), async () => ({ id: r, tenantId })); },
        );
        noDeadlock(o);
        assert.equal(o.waited, true, 'the request tab waits for the application tab');
        assert.deepEqual(second, { ok: true, changed: false }, 'the request tab wrote nothing');
        assert.equal(await requestLinks(a.id, r), 1, 'one link');
        assert.equal(await linkAudits('portfolio_request_applications', a.id, r), 1, 'one audit row');
        // The application tab writes the request's list through the request's own replacement: its
        // activity is the only one.
        assert.equal(await requestActivities(r), 1, 'one activity: the application tab');
      }],
      ['screens only: the request tab, then the application tab, link the same pair at once', async () => {
        const a = await application();
        const r = await request();
        let second: unknown;
        const o = await race(
          (m) => portfolio.setRequestLink('applications', a.id, true, reqCtx(m), async () => ({ id: r, tenantId })),
          async (m) => { second = await appTabs.setLink('requests', a.id, r, true, appTabCtx(m)); },
        );
        noDeadlock(o);
        assert.deepEqual(second, { ok: true, changed: false }, 'the application tab wrote nothing');
        assert.equal(await requestLinks(a.id, r), 1, 'one link');
        assert.equal(await linkAudits('portfolio_request_applications', a.id, r), 1, 'one audit row');
        assert.equal(await requestActivities(r), 1, 'one activity: the request tab');
      }],
    ];
    for (const [name, fn] of cells) {
      try {
        await fn();
        console.log(`  ok ${name}`);
      } catch (error: any) {
        failures.push(`${name}: ${error?.message ?? error}`);
        console.log(`  FAILED ${name}: ${error?.message ?? error}`);
      }
    }
  } finally {
    await inTenant((m) => purgeTenantTables(m, TENANT_PURGE_TABLES)).catch((error) => console.error(`could not purge ${tenantId}:`, error));
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch((error) => console.error(`could not delete ${tenantId}:`, error));
    await app.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('ai-portfolio-link-races: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
