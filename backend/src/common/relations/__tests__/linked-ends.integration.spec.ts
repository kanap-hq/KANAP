// @database-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';

// A link between a project and an application, an asset or a budget line, and between an
// application and a budget line, is read in the History of both records, whichever end posts or
// removes it: the project's Relations tab, the other record's tab, a bulk replacement from either
// end, the assistant from either end (lot K2f, `common/relations/linked-ends.ts`). Each record gets
// one entry naming the other by reference, by the person; both modification dates move; a save
// without a change writes nothing and dates nothing; another workspace sees nothing.
// The last cells race the two ends on two connections: no deadlock, one link, one entry per record.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'linked-ends-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const FULL: Record<string, string> = {
  applications: 'admin', infrastructure: 'admin', budget: 'admin', contracts: 'admin', portfolio_projects: 'admin',
  portfolio_requests: 'admin', business_processes: 'admin', tasks: 'admin', incidents: 'admin', ai_chat: 'member',
};

type Rec = { id: string; ref: string; table: string };
type Expect = { rec: Rec; other: Rec; event: 'added' | 'removed' };
type Outcome = { ok: boolean; error?: any; waited: boolean };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for linked-ends.integration.spec.ts.');
  const { AppModule } = require('../../../app.module');
  const { AiPolicyService } = require('../../../ai/ai-policy.service');
  const { AiMutationPreviewService } = require('../../../ai/ai-mutation-preview.service');
  const { EmailService } = require('../../../email/email.service');
  const { RecordHistoryService } = require('../../../audit/record-history.service');
  const { PortfolioRelationsService } = require('../../../portfolio/portfolio-relations.service');
  const { PortfolioProjectsService } = require('../../../portfolio/services/portfolio-projects.service');
  const { PortfolioRequestsService } = require('../../../portfolio/portfolio-requests.service');
  const { IntegratedDocumentsService } = require('../../../knowledge/integrated-documents.service');
  const { ApplicationsRelationsService } = require('../../../applications/services/applications-relations.service');
  const { ApplicationsService } = require('../../../applications/services/applications.service');
  const { AssetRelationsTabService } = require('../../../assets/asset-relations-tab.service');
  const { AssetsService } = require('../../../assets/services/assets.service');
  const { BudgetLinesService } = require('../../../spend/budget-lines.service');
  const { SpendItemsService } = require('../../../spend/spend-items.service');
  const { purgeTenantTables } = require('../../../admin/tenants/tenant-data-purge');
  const { TENANT_PURGE_TABLES } = require('../../../admin/tenants/tenant-purge.inventory');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  // No real e-mail from a spec.
  app.get(EmailService, { strict: false }).send = async () => undefined;
  const dataSource = app.get(DataSource);
  const previews = app.get(AiMutationPreviewService);
  const portfolio = app.get(PortfolioRelationsService);
  const projects = app.get(PortfolioProjectsService);
  const requests = app.get(PortfolioRequestsService);
  const appTabs = app.get(ApplicationsRelationsService);
  const apps = app.get(ApplicationsService);
  const assetTab = app.get(AssetRelationsTabService);
  const assets = app.get(AssetsService);
  const lines = app.get(BudgetLinesService);
  const opexItems = app.get(SpendItemsService);
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const failures: string[] = [];

  /** One committed transaction of `tenant` on its own connection. */
  const inTenant = async <T>(fn: (manager: EntityManager) => Promise<T>, tenant = tenantId): Promise<T> => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant]);
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
    for (const tenant of [tenantId, otherTenantId]) {
      await dataSource.query(
        `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
        [tenant, `linked-ends-${tenant.slice(0, 8)}`, `linked-ends-${tenant.slice(0, 8)}`],
      );
    }
    const writer = await inTenant(async (m) => {
      const roleId = await id(m, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Writer', 'Writer')`, [tenantId]);
      for (const [resource, level] of Object.entries(FULL)) {
        await m.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
      }
      const userId = await id(m,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Claude', 'Writer', $3, 'enabled')`,
        [tenantId, `linked-ends-${tenantId.slice(0, 8)}@example.test`, roleId]);
      await m.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, userId, roleId]);
      return userId;
    });

    let n = 0;
    const project = async (tenant = tenantId): Promise<Rec> => {
      n += 1;
      // Far above the numbers the tenant's counter hands out (a converted request's project).
      const number = 1000 + n;
      const rid = await inTenant((m) => id(m, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [tenant, number, `Projet ${n}`]), tenant);
      return { id: rid, ref: `PRJ-${number}`, table: 'portfolio_projects' };
    };
    const application = async (tenant = tenantId): Promise<Rec> => {
      n += 1;
      const rid = await inTenant((m) => id(m, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, 'enabled')`, [tenant, `Caisse ${n}`, `APP-${n}`]), tenant);
      return { id: rid, ref: `APP-${n}`, table: 'applications' };
    };
    const request = async (status = 'approved'): Promise<Rec> => {
      n += 1;
      const rid = await inTenant((m) => id(m, `INSERT INTO portfolio_requests (tenant_id, item_number, name, status) VALUES ($1, $2, $3, $4)`, [tenantId, 1000 + n, `Demande ${n}`, status]));
      return { id: rid, ref: `REQ-${n}`, table: 'portfolio_requests' };
    };
    const asset = async (): Promise<Rec> => {
      n += 1;
      const name = `srv-${n}`;
      const rid = await inTenant((m) => id(m, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'server', 'prod')`, [tenantId, name]));
      return { id: rid, ref: name, table: 'assets' };
    };
    const line = async (nature: 'opex' | 'capex' = 'opex'): Promise<Rec> => {
      n += 1;
      const rid = await inTenant((m) => id(m,
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature) VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4)`,
        [tenantId, `Ligne ${n}`, n, nature]));
      return { id: rid, ref: `BL-${n}`, table: 'spend_items' };
    };

    /** The History entries of `rec` that name `other` with `event`, as the page shows them. */
    const entries = async (rec: Rec, other: Rec, event: 'added' | 'removed') => inTenant(async (m) => {
      const page = await new RecordHistoryService().list(
        { tenantId, userId: writer, isAdmin: false, permissions: FULL, manager: m }, rec.table, rec.id, { limit: 200 },
      );
      return page.items.filter((item: any) => item.changes.some((c: any) => c.event === event
        && String((event === 'added' ? c.after : c.before)?.id ?? '').toLowerCase() === other.id.toLowerCase()));
    });
    const dateOf = (rec: Rec, tenant = tenantId) => inTenant(async (m) => String((await m.query(
      `SELECT updated_at::text AS d FROM ${rec.table} WHERE tenant_id = $1 AND id = $2`, [tenant, rec.id]))[0]?.d), tenant);
    const auditCount = (tenant = tenantId) => inTenant(async (m) => Number((await m.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [tenant]))[0].n), tenant);

    const projCtx = (m: EntityManager) => ({ manager: m, tenantId, userId: writer, access: { budget_lines: true, applications: true, assets: true, technologies: true, source_requests: true } });
    const owner = (rec: Rec) => async () => ({ id: rec.id, tenantId });
    const appCtx = (m: EntityManager) => ({
      manager: m, tenantId, userId: writer,
      access: { budget_lines: true, contracts: true, incidents: true, processes: true, projects: true, requests: true, tasks: true, technologies: true },
      writes: { technologies: true, processes: true, incidents: true }, scopes: {}, incidentViewer: { userId: writer, isAdmin: true } as any,
    });
    const assetCtx = (m: EntityManager) => ({
      manager: m, tenantId, userId: writer,
      access: { assets: true, budget_lines: true, contracts: true, projects: true, tasks: true, incidents: true } as any,
      writes: { incidents: true }, scopes: {}, incidentViewer: { userId: writer, isAdmin: true } as any,
    });
    const lineCtx = (m: EntityManager) => ({
      manager: m, userId: writer,
      access: { projects: true, applications: true, technologies: true, contracts: true, assets: true },
    });
    const kadCtx = (m: EntityManager) => ({ tenantId, userId: writer, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: m, conversationId: null });
    const kad = (input: Record<string, unknown>) => async (m: EntityManager) => {
      const preview = await previews.createPreview(kadCtx(m), 'update_entity_relations', input);
      const executed = await previews.executePreview(kadCtx(m), preview.preview_id);
      assert.equal(executed.status, 'executed', `the card runs (${executed.error_message ?? executed.summary ?? ''})`);
    };

    /**
     * Runs `gesture` in its own transaction; each expected record then shows exactly one new entry
     * naming the other, by the writer (or the assistant for him), and a new modification date.
     */
    const marked = async (gesture: (m: EntityManager) => Promise<unknown>, expects: Expect[], actor: 'user' | 'assistant' = 'user') => {
      const before = await Promise.all(expects.map(async (e) => ({ count: (await entries(e.rec, e.other, e.event)).length, date: await dateOf(e.rec) })));
      await inTenant(gesture);
      for (const [i, e] of expects.entries()) {
        const found = await entries(e.rec, e.other, e.event);
        assert.equal(found.length - before[i].count, 1, `${e.rec.ref}: one entry "${e.other.ref} ${e.event}" (${found.length - before[i].count})`);
        const last = found[0] as any;
        assert.equal(last.actor?.kind, actor, `${e.rec.ref}: the entry's author is the ${actor} (${JSON.stringify(last.actor)})`);
        assert.notEqual(await dateOf(e.rec), before[i].date, `${e.rec.ref}: its modification date moves`);
      }
    };
    /** A gesture that changes nothing writes no audit row and dates nothing. */
    const unchanged = async (gesture: (m: EntityManager) => Promise<unknown>, recs: Rec[]) => {
      const rows = await auditCount();
      const dates = await Promise.all(recs.map((rec) => dateOf(rec)));
      await inTenant(gesture);
      assert.equal(await auditCount(), rows, 'no audit row');
      for (const [i, rec] of recs.entries()) assert.equal(await dateOf(rec), dates[i], `${rec.ref}: its date stays`);
    };

    const cells: Array<[string, () => Promise<void>]> = [
      // Project and application (`application_projects`).
      ['project tab adds then removes an application', async () => {
        const p = await project(); const a = await application();
        await marked((m) => portfolio.setProjectLink('applications', a.id, true, projCtx(m), owner(p)), [{ rec: p, other: a, event: 'added' }, { rec: a, other: p, event: 'added' }]);
        await marked((m) => portfolio.setProjectLink('applications', a.id, false, projCtx(m), owner(p)), [{ rec: p, other: a, event: 'removed' }, { rec: a, other: p, event: 'removed' }]);
      }],
      ['project bulk replacement with two applications marks each application', async () => {
        const p = await project(); const a1 = await application(); const a2 = await application();
        await marked((m) => projects.bulkReplaceLinkedApplications(p.id, [a1.id, a2.id], { manager: m, userId: writer }),
          [{ rec: a1, other: p, event: 'added' }, { rec: a2, other: p, event: 'added' }, { rec: p, other: a1, event: 'added' }]);
        await marked((m) => projects.bulkReplaceLinkedApplications(p.id, [], { manager: m, userId: writer }),
          [{ rec: a1, other: p, event: 'removed' }, { rec: a2, other: p, event: 'removed' }]);
      }],
      ['application tab adds then removes a project', async () => {
        const p = await project(); const a = await application();
        await marked((m) => appTabs.setLink('projects', a.id, p.id, true, appCtx(m)), [{ rec: p, other: a, event: 'added' }, { rec: a, other: p, event: 'added' }]);
        await unchanged((m) => appTabs.setLink('projects', a.id, p.id, true, appCtx(m)), [p, a]);
        await marked((m) => appTabs.setLink('projects', a.id, p.id, false, appCtx(m)), [{ rec: p, other: a, event: 'removed' }, { rec: a, other: p, event: 'removed' }]);
      }],
      ['application bulk replacement with two projects marks each project', async () => {
        const p1 = await project(); const p2 = await project(); const a = await application();
        await marked((m) => apps.bulkReplaceProjects(a.id, [p1.id, p2.id], writer, { manager: m }),
          [{ rec: p1, other: a, event: 'added' }, { rec: p2, other: a, event: 'added' }, { rec: a, other: p1, event: 'added' }]);
        await unchanged((m) => apps.bulkReplaceProjects(a.id, [p1.id, p2.id], writer, { manager: m }), [p1, p2, a]);
        await marked((m) => apps.bulkReplaceProjects(a.id, [p2.id], writer, { manager: m }), [{ rec: p1, other: a, event: 'removed' }, { rec: a, other: p1, event: 'removed' }]);
      }],
      ['the assistant links a project from the application, and an application from the project', async () => {
        const p = await project(); const a = await application(); const a2 = await application();
        await marked(kad({ entity_type: 'applications', ref: a.ref, relation: 'projects', add: [p.ref] }), [{ rec: p, other: a, event: 'added' }, { rec: a, other: p, event: 'added' }], 'assistant');
        await marked(kad({ entity_type: 'projects', ref: p.ref, relation: 'applications', add: [a2.ref] }), [{ rec: p, other: a2, event: 'added' }, { rec: a2, other: p, event: 'added' }], 'assistant');
      }],
      // Project and asset (`asset_projects`).
      ['project tab adds an asset, project bulk replacement with two assets', async () => {
        const p = await project(); const s1 = await asset(); const s2 = await asset();
        await marked((m) => portfolio.setProjectLink('assets', s1.id, true, projCtx(m), owner(p)), [{ rec: p, other: s1, event: 'added' }, { rec: s1, other: p, event: 'added' }]);
        await marked((m) => projects.bulkReplaceLinkedAssets(p.id, [s2.id], { manager: m, userId: writer }),
          [{ rec: s1, other: p, event: 'removed' }, { rec: s2, other: p, event: 'added' }]);
      }],
      ['asset tab adds then removes a project', async () => {
        const p = await project(); const s = await asset();
        await marked((m) => assetTab.setLink('projects', s.id, p.id, true, assetCtx(m)), [{ rec: p, other: s, event: 'added' }, { rec: s, other: p, event: 'added' }]);
        await unchanged((m) => assetTab.setLink('projects', s.id, p.id, true, assetCtx(m)), [p, s]);
        await marked((m) => assetTab.setLink('projects', s.id, p.id, false, assetCtx(m)), [{ rec: p, other: s, event: 'removed' }, { rec: s, other: p, event: 'removed' }]);
      }],
      ['asset bulk replacement with two projects marks the asset and each project', async () => {
        const p1 = await project(); const p2 = await project(); const s = await asset();
        await marked((m) => assets.bulkReplaceProjects(s.id, [p1.id, p2.id], tenantId, writer, { manager: m, tenantId }),
          [{ rec: p1, other: s, event: 'added' }, { rec: p2, other: s, event: 'added' }, { rec: s, other: p1, event: 'added' }, { rec: s, other: p2, event: 'added' }]);
        await unchanged((m) => assets.bulkReplaceProjects(s.id, [p1.id, p2.id], tenantId, writer, { manager: m, tenantId }), [p1, p2, s]);
      }],
      ['the assistant links a project from the asset', async () => {
        const p = await project(); const s = await asset();
        await marked(kad({ entity_type: 'assets', ref: s.ref, relation: 'projects', add: [p.ref] }), [{ rec: p, other: s, event: 'added' }, { rec: s, other: p, event: 'added' }], 'assistant');
      }],
      // Project and budget line (`portfolio_project_opex`, both natures).
      ['project tab adds a line, project bulk replacement with two lines', async () => {
        const p = await project(); const l1 = await line(); const l2 = await line(); const l3 = await line();
        await marked((m) => portfolio.setProjectLink('budget_lines', l1.id, true, projCtx(m), owner(p)), [{ rec: p, other: l1, event: 'added' }, { rec: l1, other: p, event: 'added' }]);
        await marked((m) => projects.bulkReplaceOpex(p.id, [l2.id, l3.id], { manager: m, userId: writer }),
          [{ rec: l1, other: p, event: 'removed' }, { rec: l2, other: p, event: 'added' }, { rec: l3, other: p, event: 'added' }, { rec: p, other: l2, event: 'added' }]);
      }],
      ['line tab adds then removes a project, OPEX and CAPEX', async () => {
        const p = await project(); const l = await line(); const c = await line('capex');
        await marked((m) => lines.setRelation('projects', l.id, p.id, true, lineCtx(m)), [{ rec: p, other: l, event: 'added' }, { rec: l, other: p, event: 'added' }]);
        await unchanged((m) => lines.setRelation('projects', l.id, p.id, true, lineCtx(m)), [p, l]);
        await marked((m) => lines.setRelation('projects', l.id, p.id, false, lineCtx(m)), [{ rec: p, other: l, event: 'removed' }, { rec: l, other: p, event: 'removed' }]);
        await marked((m) => lines.setRelation('projects', c.id, p.id, true, lineCtx(m)), [{ rec: p, other: c, event: 'added' }, { rec: c, other: p, event: 'added' }]);
      }],
      ['line bulk replacement with two projects marks the line and each project', async () => {
        const p1 = await project(); const p2 = await project(); const l = await line();
        await marked((m) => opexItems.bulkReplaceProjects(l.id, [p1.id, p2.id], { manager: m, userId: writer }),
          [{ rec: p1, other: l, event: 'added' }, { rec: p2, other: l, event: 'added' }, { rec: l, other: p1, event: 'added' }, { rec: l, other: p2, event: 'added' }]);
        await unchanged((m) => opexItems.bulkReplaceProjects(l.id, [p1.id, p2.id], { manager: m, userId: writer }), [p1, p2, l]);
      }],
      ['the assistant links a project from the line', async () => {
        const p = await project(); const l = await line();
        await marked(kad({ entity_type: 'budget_lines', ref: l.ref, relation: 'projects', add: [p.ref] }), [{ rec: p, other: l, event: 'added' }, { rec: l, other: p, event: 'added' }], 'assistant');
      }],
      // Application and budget line (`application_spend_items`).
      ['application tab adds then removes a line, application bulk replacement with two lines', async () => {
        const a = await application(); const l1 = await line(); const l2 = await line(); const c = await line('capex');
        await marked((m) => appTabs.setLink('budget_lines', a.id, l1.id, true, appCtx(m)), [{ rec: l1, other: a, event: 'added' }, { rec: a, other: l1, event: 'added' }]);
        await marked((m) => appTabs.setLink('budget_lines', a.id, l1.id, false, appCtx(m)), [{ rec: l1, other: a, event: 'removed' }, { rec: a, other: l1, event: 'removed' }]);
        await marked((m) => apps.bulkReplaceLinkedSpendItems(a.id, [l1.id, l2.id], writer, { manager: m }),
          [{ rec: l1, other: a, event: 'added' }, { rec: l2, other: a, event: 'added' }, { rec: a, other: l2, event: 'added' }]);
        await marked((m) => appTabs.setLink('budget_lines', a.id, c.id, true, appCtx(m)), [{ rec: c, other: a, event: 'added' }, { rec: a, other: c, event: 'added' }]);
      }],
      ['line tab adds an application, line bulk replacement with two applications', async () => {
        const a1 = await application(); const a2 = await application(); const l = await line();
        await marked((m) => lines.setRelation('applications', l.id, a1.id, true, lineCtx(m)), [{ rec: a1, other: l, event: 'added' }, { rec: l, other: a1, event: 'added' }]);
        await marked((m) => opexItems.bulkReplaceApplications(l.id, [a2.id], writer, { manager: m }),
          [{ rec: a1, other: l, event: 'removed' }, { rec: a2, other: l, event: 'added' }, { rec: l, other: a2, event: 'added' }]);
        await unchanged((m) => opexItems.bulkReplaceApplications(l.id, [a2.id], writer, { manager: m }), [a2, l]);
      }],
      ['the assistant links a line from the application, and an application from the line', async () => {
        const a = await application(); const a2 = await application(); const l = await line(); const l2 = await line();
        await marked(kad({ entity_type: 'applications', ref: a.ref, relation: 'budget_lines', add: [l.ref] }), [{ rec: l, other: a, event: 'added' }, { rec: a, other: l, event: 'added' }], 'assistant');
        await marked(kad({ entity_type: 'budget_lines', ref: l2.ref, relation: 'applications', add: [a2.ref] }), [{ rec: a2, other: l2, event: 'added' }, { rec: l2, other: a2, event: 'added' }], 'assistant');
      }],
      // A request's lines (written from the request only), and the lines a converted request hands to its project.
      ['request bulk replacement with two lines marks each line', async () => {
        const r = await request(); const l1 = await line(); const l2 = await line();
        await marked((m) => requests.bulkReplaceOpex(r.id, [l1.id, l2.id], { manager: m, userId: writer }),
          [{ rec: l1, other: r, event: 'added' }, { rec: l2, other: r, event: 'added' }, { rec: r, other: l1, event: 'added' }]);
      }],
      ['a request converted to a project hands its lines to the project, on both histories', async () => {
        const r = await request(); const l1 = await line(); const l2 = await line();
        await inTenant((m) => requests.bulkReplaceOpex(r.id, [l1.id, l2.id], { manager: m, userId: writer }));
        // The request's purpose document is not this spec's subject.
        app.get(IntegratedDocumentsService, { strict: false }).createProjectPurposeFromRequest = async () => undefined;
        const converted: any = await inTenant((m) => projects.convertFromRequest(r.id, {}, tenantId, writer, { manager: m, userId: writer }));
        const p: Rec = { id: converted.id, ref: 'the new project', table: 'portfolio_projects' };
        for (const l of [l1, l2]) {
          assert.equal((await entries(l, p, 'added')).length, 1, `${l.ref}: one entry "project added"`);
          assert.equal((await entries(p, l, 'added')).length, 1, `the project: one entry "${l.ref} added"`);
        }
      }],
      ['another workspace sees nothing', async () => {
        const p = await project(otherTenantId); const a = await application(otherTenantId);
        const date = await dateOf(p, otherTenantId);
        const mine = await application();
        await assert.rejects(inTenant((m) => appTabs.setLink('projects', mine.id, p.id, true, appCtx(m))), 'a project of another workspace is not found');
        await assert.rejects(inTenant((m) => apps.bulkReplaceProjects(mine.id, [p.id], writer, { manager: m })), 'not in a bulk replacement either');
        assert.equal(await auditCount(otherTenantId), 0, 'no audit row in the other workspace');
        assert.equal(await dateOf(p, otherTenantId), date, 'its project keeps its date');
        assert.ok(a.id);
      }],
    ];

    // Two connections: `first` holds its transaction while `second` starts.
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
    const linkCount = (table: string, a: string, aId: string, b: string, bId: string) => inTenant(async (m) => Number((await m.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND ${a} = $2 AND ${b} = $3`, [tenantId, aId, bId]))[0].n));
    /** Both records show the link once, whoever wrote it. */
    const once = async (o: Outcome, pairs: Array<[Rec, Rec]>) => {
      assert.notEqual(o.error?.code, '40P01', 'no deadlock');
      assert.equal(o.ok, true, `the second gesture answers (${o.error?.message ?? ''})`);
      for (const [rec, other] of pairs) {
        assert.equal((await entries(rec, other, 'added')).length, 1, `${rec.ref}: one entry "${other.ref} added"`);
      }
    };
    cells.push(
      ['race: the application tab and the project tab link the same pair at once', async () => {
        const p = await project(); const a = await application();
        const o = await race((m) => appTabs.setLink('projects', a.id, p.id, true, appCtx(m)), (m) => portfolio.setProjectLink('applications', a.id, true, projCtx(m), owner(p)));
        await once(o, [[p, a], [a, p]]);
        assert.equal(await linkCount('application_projects', 'application_id', a.id, 'project_id', p.id), 1, 'one link');
      }],
      ['race: the project tab, then the application tab, link the same pair', async () => {
        const p = await project(); const a = await application();
        const o = await race((m) => portfolio.setProjectLink('applications', a.id, true, projCtx(m), owner(p)), (m) => appTabs.setLink('projects', a.id, p.id, true, appCtx(m)));
        await once(o, [[p, a], [a, p]]);
      }],
      ['race: an application bulk replacement crosses a link added from the project', async () => {
        const p1 = await project(); const p2 = await project(); const a = await application();
        const o = await race((m) => apps.bulkReplaceProjects(a.id, [p1.id, p2.id], writer, { manager: m }), (m) => portfolio.setProjectLink('applications', a.id, true, projCtx(m), owner(p1)));
        await once(o, [[p1, a], [p2, a], [a, p1], [a, p2]]);
      }],
      ['race: a link added from the project crosses an application bulk replacement', async () => {
        const p1 = await project(); const p2 = await project(); const a = await application();
        const o = await race((m) => portfolio.setProjectLink('applications', a.id, true, projCtx(m), owner(p1)), (m) => apps.bulkReplaceProjects(a.id, [p1.id, p2.id], writer, { manager: m }));
        await once(o, [[p1, a], [p2, a], [a, p1], [a, p2]]);
      }],
      ['race: a project bulk replacement crosses a link added from the asset', async () => {
        const p = await project(); const s1 = await asset(); const s2 = await asset();
        const o = await race((m) => projects.bulkReplaceLinkedAssets(p.id, [s1.id, s2.id], { manager: m, userId: writer }), (m) => assetTab.setLink('projects', s1.id, p.id, true, assetCtx(m)));
        await once(o, [[p, s1], [p, s2], [s1, p], [s2, p]]);
      }],
      ['race: the line tab and the project tab link the same pair at once', async () => {
        const p = await project(); const l = await line();
        const o = await race((m) => lines.setRelation('projects', l.id, p.id, true, lineCtx(m)), (m) => portfolio.setProjectLink('budget_lines', l.id, true, projCtx(m), owner(p)));
        await once(o, [[p, l], [l, p]]);
      }],
      ['race: the application tab and the line tab link the same pair at once', async () => {
        const a = await application(); const l = await line();
        const o = await race((m) => appTabs.setLink('budget_lines', a.id, l.id, true, appCtx(m)), (m) => lines.setRelation('applications', l.id, a.id, true, lineCtx(m)));
        await once(o, [[a, l], [l, a]]);
      }],
    );

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
    for (const tenant of [tenantId, otherTenantId]) {
      await inTenant((m) => purgeTenantTables(m, TENANT_PURGE_TABLES), tenant).catch((error) => console.error(`could not purge ${tenant}:`, error));
      await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenant]).catch((error) => console.error(`could not delete ${tenant}:`, error));
    }
    await app.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('linked-ends: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
