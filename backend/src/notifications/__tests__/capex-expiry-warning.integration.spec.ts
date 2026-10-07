import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ScheduledNotificationsService } from '../scheduled-notifications.service';

// Notification links come from the configured application address (common/url.ts): without one
// the emails are not built and the scheduled runs are skipped.
if (!process.env.APP_BASE_URL) process.env.APP_BASE_URL = 'https://app.example.test';

// CAPEX items warn their owners before their end of validity (disabled_at)
// exactly like OPEX items: candidates end within 30 days, a warning goes out
// when the end is 30, 14, 7 or 1 calendar day(s) away, and it carries the
// last day and the days left. The daily run covers the CAPEX items of every
// tenant, each tenant only its own. "Today" is the run's injected clock.

const REAL_TODAY = new Date().toISOString().slice(0, 10);

function ymdPlus(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function at(ymd: string, hhmm = '08:00'): Date {
  return new Date(`${ymd}T${hhmm}:00Z`);
}

function noonUtcInDays(days: number): Date {
  return at(ymdPlus(REAL_TODAY, days), '12:00');
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, tag: string, status = 'enabled') {
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status, locale)
     VALUES ($1, $2, $3, 'Owner', 'Test', $4, 'en') RETURNING id`,
    [tenantId, roleId, `${tag}-${tenantId.slice(0, 8)}@example.com`, status],
  );
  return user.id as string;
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'CAPEX expiry test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `capex-expiry-${tag}-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'CAPEX expiry role', 'CAPEX expiry role', false, false, now(), now()) RETURNING id`,
    [tenantId],
  );
  const itOwner = await seedUser(runner, tenantId, role.id, `it-${tag}`);
  const businessOwner = await seedUser(runner, tenantId, role.id, `biz-${tag}`);
  const disabledOwner = await seedUser(runner, tenantId, role.id, `off-${tag}`, 'disabled');
  return { tenantId, itOwner, businessOwner, disabledOwner };
}

type CapexSeed = { name: string; disabledAt: Date | null; itOwner?: string | null; businessOwner?: string | null };

async function seedCapex(runner: QueryRunner, tenantId: string, items: CapexSeed[]) {
  let n = 0;
  for (const { name, disabledAt, itOwner = null, businessOwner = null } of items) {
    n += 1;
    await runner.query(
      `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number,
                                disabled_at, status, owner_it_id, owner_business_id)
       VALUES ($1, $2, 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', $3, $4, $5, $6, $7)`,
      [tenantId, name, n, disabledAt, disabledAt && disabledAt.getTime() <= Date.now() ? 'disabled' : 'enabled', itOwner, businessOwner],
    );
  }
}

function recordingNotifications() {
  const received: any[] = [];
  const notifications = { notifyExpirationWarning: async (payload: any) => { received.push({ ...payload, manager: undefined }); } };
  return { received, notifications };
}

function serviceWith(notifications: unknown, ds: unknown = undefined) {
  return new ScheduledNotificationsService(
    ds as any, undefined as any, undefined as any, notifications as any, undefined as any, undefined as any,
  );
}

/** The run's per-tenant transactions become savepoints of the test transaction, on one connection. */
function savepointDataSource(outer: QueryRunner) {
  let n = 0;
  return {
    query: (sql: string, params?: unknown[]) => outer.query(sql, params),
    createQueryRunner: () => {
      const name = `capex_expiry_tenant_${++n}`;
      return {
        manager: outer.manager,
        connect: async () => undefined,
        startTransaction: () => outer.query(`SAVEPOINT ${name}`),
        commitTransaction: () => outer.query(`RELEASE SAVEPOINT ${name}`),
        rollbackTransaction: () => outer.query(`ROLLBACK TO SAVEPOINT ${name}`),
        release: async () => undefined,
        query: (sql: string, params?: unknown[]) => outer.query(sql, params),
      };
    },
  };
}

function withRunner(fn: (runner: QueryRunner) => Promise<void>) {
  return async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await fn(runner);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  };
}

const testCapexWindow = withRunner(async (runner) => {
  const { tenantId, itOwner, businessOwner, disabledOwner } = await seedTenant(runner, 'window');
  await seedCapex(runner, tenantId, [
    { name: 'Ends in 14 days', disabledAt: noonUtcInDays(14), itOwner, businessOwner },
    { name: 'Ends in 10 days', disabledAt: noonUtcInDays(10), itOwner },
    { name: 'Ends in 40 days', disabledAt: noonUtcInDays(40), itOwner },
    { name: 'Ended 5 days ago', disabledAt: noonUtcInDays(-5), itOwner },
    { name: 'No end', disabledAt: null, itOwner },
    { name: 'Ends in 7 days, no owner', disabledAt: noonUtcInDays(7) },
    { name: 'Ends in 7 days, disabled owner', disabledAt: noonUtcInDays(7), itOwner: disabledOwner },
  ]);

  const { received, notifications } = recordingNotifications();
  const svc = serviceWith(notifications);
  const count = await (svc as any).checkCapexExpirationsForTenant(runner.manager, tenantId, at(REAL_TODAY));

  assert.equal(count, 3, 'three CAPEX items with an owner end within 30 days');
  assert.equal(received.length, 1, 'one warning: 14 days is a reminder day, 10 is not, a disabled owner is never warned');
  const [warning] = received;
  assert.equal(warning.itemType, 'capex');
  assert.equal(warning.itemName, 'Ends in 14 days', 'the CAPEX description names the item');
  assert.equal(warning.expirationDate, ymdPlus(REAL_TODAY, 14), 'the last service day');
  assert.equal(warning.daysRemaining, 14);
  assert.equal(warning.warningType, 'expiration');
  assert.equal(warning.tenantId, tenantId);
  assert.deepEqual(warning.recipients.map((r: any) => r.userId), [itOwner, businessOwner], 'both owners are warned');
});

const OFFSETS = [31, 30, 29, 14, 7, 2, 1, 0];
const REMINDER_OFFSETS = [30, 14, 7, 1];

const testCapexReminderSchedule = withRunner(async (runner) => {
  const year = Number(REAL_TODAY.slice(0, 4)) + 1;
  const { tenantId, itOwner } = await seedTenant(runner, 'schedule');
  await seedCapex(runner, tenantId, [
    { name: 'Ends at noon', disabledAt: at(`${year}-06-15`, '12:00'), itOwner },
    { name: 'Ends late evening', disabledAt: at(`${year}-06-15`, '21:59'), itOwner },
  ]);

  const { received, notifications } = recordingNotifications();
  const svc = serviceWith(notifications);
  const end = `${year}-06-15`;
  const days = new Map<string, number[]>();
  for (const k of OFFSETS) {
    received.length = 0;
    await (svc as any).checkCapexExpirationsForTenant(runner.manager, tenantId, at(ymdPlus(end, -k)));
    for (const w of received) {
      assert.equal(w.expirationDate, end, `${w.itemName}: the last service day`);
      assert.equal(w.daysRemaining, k, `${w.itemName}, ${k} days before: days left`);
      days.set(w.itemName, [...(days.get(w.itemName) ?? []), k]);
    }
  }
  assert.deepEqual(days.get('Ends at noon'), REMINDER_OFFSETS, 'warned 30, 14, 7 and 1 day(s) before');
  assert.deepEqual(days.get('Ends late evening'), REMINDER_OFFSETS, 'an end at 21:59Z is warned on the same days');
});

const testDailyRunTwoTenants = withRunner(async (runner) => {
  const today = ymdPlus(REAL_TODAY, 3);
  const tenants = [];
  for (const tag of ['a', 'b']) {
    const { tenantId, itOwner } = await seedTenant(runner, `run-${tag}`);
    await seedCapex(runner, tenantId, [
      { name: `Capex ${tag} ends soon`, disabledAt: at(ymdPlus(today, 7), '12:00'), itOwner },
      { name: `Capex ${tag} ends later`, disabledAt: at(ymdPlus(today, 40), '12:00'), itOwner },
    ]);
    tenants.push({ tag, tenantId, itOwner });
  }

  const { received, notifications } = recordingNotifications();
  const svc = serviceWith(notifications, savepointDataSource(runner));
  const summary = await svc.checkExpirations(at(today));

  assert.deepEqual(summary.errors, [], 'no tenant fails');
  assert.ok(summary.capexWarnings >= 2, 'the run summary counts the CAPEX candidates');
  for (const { tag, tenantId, itOwner } of tenants) {
    const own = received.filter((w) => w.tenantId === tenantId);
    assert.deepEqual(
      own.map((w) => `${w.itemType}:${w.itemName}:${w.daysRemaining}`),
      [`capex:Capex ${tag} ends soon:7`],
      `tenant ${tag}: its CAPEX item ending in 7 days`,
    );
    assert.deepEqual(own[0].recipients.map((r: any) => r.userId), [itOwner], `tenant ${tag}: only its own owner is warned`);
  }
});

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['capex window', testCapexWindow],
      ['capex reminder schedule', testCapexReminderSchedule],
      ['daily run, two tenants', testDailyRunTwoTenants],
    ] as const) {
      try {
        await test();
      } catch (err) {
        failures.push(`${name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`capex-expiry-warning.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('capex-expiry-warning.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
