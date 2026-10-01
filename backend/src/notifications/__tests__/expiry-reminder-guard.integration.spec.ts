import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { NotificationsService } from '../notifications.service';
import { ScheduledNotificationsService } from '../scheduled-notifications.service';
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPreferencesData } from '../notifications.constants';

// The expiry reminder guard is durable: two runs of the daily check on the
// same day send a reminder once, also when the api restarted in between (a
// new service, nothing in memory). The guard rows are system rows of the
// tenant's audit log (`expiry_reminders`), committed on their own; the next
// reminder day is not blocked.

const TODAY = new Date().toISOString().slice(0, 10);

function ymdPlus(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const at = (ymd: string, hhmm = '08:00') => new Date(`${ymd}T${hhmm}:00Z`);

function optedIn(): NotificationPreferencesData {
  const prefs: NotificationPreferencesData = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES));
  prefs.emails_enabled = true;
  prefs.workspace_settings.budget.enabled = true;
  prefs.workspace_settings.budget.expiration_warnings = true;
  return prefs;
}

/** A fresh api: its own services, nothing in memory, the real database. */
function startApi(sent: string[]) {
  const email = { send: async (mail: { to: string }) => { sent.push(mail.to); } };
  const preferences = { getForUser: async () => optedIn() };
  const notifications = new NotificationsService(dataSource, email as any, {} as any, preferences as any);
  return new ScheduledNotificationsService(undefined as any, undefined as any, undefined as any, notifications, undefined as any, undefined as any);
}

async function seed(runner: QueryRunner) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Expiry guard test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `expiry-guard-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Expiry guard role', 'Expiry guard role', false, false, now(), now()) RETURNING id`,
    [tenantId],
  );
  const email = `guard-${tenantId.slice(0, 8)}@example.com`;
  const [owner] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status, locale)
     VALUES ($1, $2, $3, 'Owner', 'Test', 'enabled', 'en') RETURNING id`,
    [tenantId, role.id, email],
  );
  // Ends in 14 days: a reminder day.
  await runner.query(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, disabled_at, owner_it_id)
     VALUES ($1, 'Guarded line', 'EUR', '2020-01-01', 1, $2, $3)`,
    [tenantId, at(ymdPlus(TODAY, 14), '12:00'), owner.id],
  );
  return { tenantId, email };
}

async function guardRows(tenantId: string): Promise<number> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [{ n }] = await manager.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'expiry_reminders'`,
      [tenantId],
    );
    return n as number;
  });
}

async function testTwoRunsSameDaySendOnce() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  let tenantId: string | null = null;
  try {
    const seeded = await seed(runner);
    tenantId = seeded.tenantId;
    const sent: string[] = [];
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const run = (api: ScheduledNotificationsService, day: string) =>
      (api as any).checkOpexExpirationsForTenant(runner.manager, seeded.tenantId, at(day));

    const first = startApi(sent);
    await run(first, TODAY);
    await flush();
    assert.deepEqual(sent, [seeded.email], 'the first run of the day sends the reminder');
    await run(first, TODAY);
    await flush();
    assert.deepEqual(sent, [seeded.email], 'a second run the same day sends nothing');

    const restarted = startApi(sent);
    await run(restarted, TODAY);
    await flush();
    assert.deepEqual(sent, [seeded.email], 'a run after an api restart the same day sends nothing');
    assert.equal(await guardRows(seeded.tenantId), 1, 'one guard row, committed on its own');

    await run(restarted, ymdPlus(TODAY, 7));
    await flush();
    assert.deepEqual(sent, [seeded.email, seeded.email], 'the next reminder day (7 days left) is sent');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    if (tenantId) {
      await dataSource.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
      });
    }
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testTwoRunsSameDaySendOnce();
  } finally {
    await dataSource.destroy();
  }
  console.log('expiry-reminder-guard.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
