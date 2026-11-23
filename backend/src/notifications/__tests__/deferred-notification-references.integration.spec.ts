// @database-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';

// The notifications a request starts without awaiting them (a contract's status, a task's status, a
// share) run after its transaction is committed and its connection handed back: they never read
// through the request's entity manager (AGENTS.md, "Known traps") and still link the record by its
// business reference. One case per family; `portfolio-status-notification.integration.spec.ts` holds
// the projects. No mail leaves: `EmailService.send` is replaced.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'deferred-notification-references-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
// Notification links come from the configured application address (common/url.ts).
process.env.APP_BASE_URL ||= 'https://app.example.test';

const ON = {
  emails_enabled: true,
  workspace_settings: {
    portfolio: { enabled: true, status_changes: true, comments: true, team_additions: true, team_changes_as_lead: true },
    tasks: { enabled: true, as_assignee: true, as_requestor: true, as_viewer: true, status_changes: true, comments: true },
    budget: { enabled: true, expiration_warnings: true, status_changes: true, comments: true },
    technologies: { enabled: false, vulnerabilities: false },
  },
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for deferred-notification-references.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { EmailService } = require('../../email/email.service');
  const { NotificationsService } = require('../notifications.service');
  const { ContractsService } = require('../../contracts/contracts.service');
  const { TasksUnifiedService } = require('../../tasks/tasks-unified.service');
  const { ApplicationsCrudService } = require('../../applications/services/applications-crud.service');
  const { waitForBackgroundWork } = require('../../common/background-work');
  const { purgeTenantTables } = require('../../admin/tenants/tenant-data-purge');
  const { TENANT_PURGE_TABLES } = require('../../admin/tenants/tenant-purge.inventory');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const sent: Array<{ to: string; html: string }> = [];
  app.get(EmailService).send = async (mail: { to: string; html: string }) => { sent.push(mail); };
  const notifications = app.get(NotificationsService);
  (notifications as any).preferencesService.getForUser = async () => ON;
  const dataSource = app.get(DataSource);
  const tenantId = randomUUID();

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

  // The notification waits until the request's connection is handed back.
  const slugOf = (notifications as any).getTenantSlug.bind(notifications);
  let gate: Promise<void> = Promise.resolve();
  (notifications as any).getTenantSlug = async (...args: unknown[]) => {
    await gate;
    return slugOf(...args);
  };
  /** The gesture in the request's transaction, committed and handed back before its mail is built. */
  const request = async (gesture: (manager: EntityManager) => Promise<unknown>) => {
    let handedBack!: () => void;
    gate = new Promise<void>((resolve) => { handedBack = resolve; });
    sent.length = 0;
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    try {
      await gesture(runner.manager);
      await runner.commitTransaction();
    } finally {
      await runner.release();
      handedBack();
    }
    assert.equal(await waitForBackgroundWork(Date.now() + 15_000), 0, 'the notification ends');
    return sent.map((mail) => mail.html);
  };

  const failures: string[] = [];
  try {
    await dataSource.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `deferred-notice-${tenantId.slice(0, 8)}`, `deferred-notice-${tenantId.slice(0, 8)}`],
    );
    const seed = await inTenant(async (m) => {
      const roleId = await id(m, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Tout', 'Tout')`, [tenantId]);
      for (const resource of ['contracts', 'tasks', 'applications', 'budget']) {
        await m.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'admin')`, [tenantId, roleId, resource]);
      }
      const person = async (first: string) => {
        const userId = await id(m,
          `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, $3, 'Test', $4, 'enabled', 'en')`,
          [tenantId, `${first.toLowerCase()}-${tenantId.slice(0, 8)}@example.test`, first, roleId]);
        await m.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, userId, roleId]);
        return userId;
      };
      const author = await person('Author');
      const owner = await person('Owner');
      const company = await id(m, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Corderie', 'FR', 'Roscoff')`, [tenantId]);
      const supplier = await id(m, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fournisseur')`, [tenantId]);
      const contract = await id(m,
        `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number, owner_user_id) VALUES ($1, 'Contrat', $2, $3, '2026-01-01', 3, $4)`,
        [tenantId, company, supplier, owner]);
      const task = await id(m,
        `INSERT INTO tasks (tenant_id, title, item_number, status, assignee_user_id) VALUES ($1, 'Relance', 4, 'open', $2)`,
        [tenantId, owner]);
      const application = await id(m, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Caisse', 'APP-5', 'enabled')`, [tenantId]);
      return { author, owner, contract, task, application };
    });

    const cases: Array<{ name: string; path: string; gesture: (m: EntityManager) => Promise<unknown> }> = [
      {
        name: 'contract status',
        path: '/ops/contracts/CTR-3/overview',
        gesture: (m) => app.get(ContractsService).update(seed.contract, { status: 'disabled' } as any, seed.author, { manager: m }),
      },
      {
        name: 'task status',
        path: '/portfolio/tasks/T-4',
        gesture: (m) => app.get(TasksUnifiedService).updateById(seed.task, { status: 'in_progress' } as any, seed.author, { manager: m, tenantId }),
      },
      {
        name: 'task share',
        path: '/portfolio/tasks/T-4',
        gesture: (m) => app.get(TasksUnifiedService).share(seed.task, { recipient_user_ids: [seed.owner], message: 'À voir' } as any, tenantId, seed.author, { manager: m }),
      },
      {
        name: 'application share',
        path: '/it/applications/APP-5/overview',
        gesture: (m) => app.get(ApplicationsCrudService).shareApplication(seed.application, { recipient_user_ids: [seed.owner], message: 'À voir' } as any, tenantId, seed.author, { manager: m }),
      },
    ];
    for (const c of cases) {
      try {
        const mails = await request(c.gesture);
        assert.ok(mails.length > 0, `${c.name}: a mail is built`);
        for (const html of mails) {
          assert.ok(html.includes(c.path), `${c.name}: the mail links ${c.path} (${html.match(/https:\/\/[^"<\s]+/g)?.join(' ')})`);
        }
        console.log(`  ${c.name} notified after the request: OK`);
      } catch (error: any) {
        failures.push(String(error?.message ?? error));
        console.log(`  ${c.name}: FAILED`);
      }
    }
  } finally {
    await inTenant((m) => purgeTenantTables(m, TENANT_PURGE_TABLES)).catch((error) => console.error(`could not purge ${tenantId}:`, error));
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch((error) => console.error(`could not delete ${tenantId}:`, error));
    await app.close();
  }
  if (failures.length > 0) {
    console.error(`\n${failures.join('\n\n')}`);
    process.exit(1);
  }
  console.log('deferred-notification-references.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
