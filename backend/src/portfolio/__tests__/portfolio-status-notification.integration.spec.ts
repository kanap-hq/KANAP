// @database-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';

// A project's status change notifies its leads without being awaited (`notifyStatusChange`). The
// notification runs after the request's transaction is committed and its connection handed back:
// it never reads through the request's entity manager (AGENTS.md, "Known traps"), and still links
// the project by its business reference (PRJ-n). No mail leaves: `EmailService.send` is replaced.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'portfolio-status-notification-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
// Notification links come from the configured application address (common/url.ts).
process.env.APP_BASE_URL ||= 'https://app.example.test';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for portfolio-status-notification.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { EmailService } = require('../../email/email.service');
  const { NotificationsService } = require('../../notifications/notifications.service');
  const { PortfolioStatusService } = require('../services/portfolio-status.service');
  const { waitForBackgroundWork } = require('../../common/background-work');
  const { purgeTenantTables } = require('../../admin/tenants/tenant-data-purge');
  const { TENANT_PURGE_TABLES } = require('../../admin/tenants/tenant-purge.inventory');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const sent: Array<{ to: string; html: string }> = [];
  app.get(EmailService).send = async (mail: { to: string; html: string }) => { sent.push(mail); };
  const notifications = app.get(NotificationsService);
  // Status changes are off by default: the lead has them on.
  (notifications as any).preferencesService.getForUser = async () => ({
    emails_enabled: true,
    workspace_settings: {
      portfolio: { enabled: true, status_changes: true, comments: true, team_additions: true, team_changes_as_lead: true },
      tasks: { enabled: true },
      budget: { enabled: true },
    },
  });
  const dataSource = app.get(DataSource);
  const status = app.get(PortfolioStatusService);
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

  try {
    await dataSource.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `status-notice-${tenantId.slice(0, 8)}`, `status-notice-${tenantId.slice(0, 8)}`],
    );
    const seed = await inTenant(async (m) => {
      const roleId = await id(m, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Projets', 'Projets')`, [tenantId]);
      await m.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'portfolio_projects', 'admin')`, [tenantId, roleId]);
      const person = async (first: string) => {
        const userId = await id(m,
          `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, $3, 'Test', $4, 'enabled', 'en')`,
          [tenantId, `${first.toLowerCase()}-${tenantId.slice(0, 8)}@example.test`, first, roleId]);
        await m.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, userId, roleId]);
        return userId;
      };
      const author = await person('Author');
      const lead = await person('Lead');
      const project = await id(m,
        `INSERT INTO portfolio_projects (tenant_id, item_number, name, status, business_lead_id) VALUES ($1, 7, 'Affinage', 'waiting_list', $2)`,
        [tenantId, lead]);
      return { author, project };
    });

    // The notification waits until the request's connection is handed back.
    let handedBack!: () => void;
    const gate = new Promise<void>((resolve) => { handedBack = resolve; });
    const slugOf = (notifications as any).getTenantSlug.bind(notifications);
    (notifications as any).getTenantSlug = async (...args: unknown[]) => {
      await gate;
      return slugOf(...args);
    };

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await status.addComment(seed.project, 'Planned for spring', null, tenantId, seed.author, {
      manager: runner.manager, isDecision: true, decisionOutcome: 'approved', newStatus: 'planned',
    });
    await runner.commitTransaction();
    await runner.release();
    handedBack();
    const left = await waitForBackgroundWork(Date.now() + 15_000);
    assert.equal(left, 0, 'the notification ends');

    assert.equal(sent.length, 1, `one mail, to the lead (${sent.map((mail) => mail.to).join(', ')})`);
    assert.match(sent[0].to, /^lead-/, 'the lead is notified, the author is not');
    assert.ok(sent[0].html.includes('/portfolio/projects/PRJ-7'), `the mail links the project by its reference (${sent[0].html.match(/portfolio\/projects\/[^"<\s]+/)?.[0]})`);
    console.log('  project status change notified after the request: OK');
    console.log('portfolio-status-notification.integration.spec: ok');
  } finally {
    await inTenant((m) => purgeTenantTables(m, TENANT_PURGE_TABLES)).catch((error) => console.error(`could not purge ${tenantId}:`, error));
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch((error) => console.error(`could not delete ${tenantId}:`, error));
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
