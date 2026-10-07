import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ScheduledNotificationsService } from '../scheduled-notifications.service';

// Notification links come from the configured application address (common/url.ts): without one
// the emails are not built and the scheduled runs are skipped.
if (!process.env.APP_BASE_URL) process.env.APP_BASE_URL = 'https://app.example.test';

// The expiry warnings. Candidates are the deadlines within 30 days; a
// warning goes out only when the deadline is 30, 14, 7 or 1 calendar day(s)
// away. OPEX items read the end of validity (disabled_at): the warning carries
// its last day and the days left. Contracts warn on the cancellation deadline
// and on the end date, each on its own schedule. The daily run covers
// contracts and OPEX items of every tenant, each tenant only its own. "Today"
// is the run's injected clock, at 08:00 UTC like the scheduled task.

const REAL_TODAY = new Date().toISOString().slice(0, 10);

/** `ymd` moved by `days` calendar days. */
function ymdPlus(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A UTC instant on the calendar date `ymd`. */
function at(ymd: string, hhmm = '08:00'): Date {
  return new Date(`${ymd}T${hhmm}:00Z`);
}

function noonUtcInDays(days: number): Date {
  return at(ymdPlus(REAL_TODAY, days), '12:00');
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Expiry warning test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `expiry-${tag}-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Expiry test role', 'Expiry test role', false, false, now(), now()) RETURNING id`,
    [tenantId],
  );
  const [owner] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status, locale)
     VALUES ($1, $2, $3, 'Owner', 'Test', 'enabled', 'en') RETURNING id`,
    [tenantId, role.id, `owner-${tag}-${tenantId.slice(0, 8)}@example.com`],
  );
  return { tenantId, ownerId: owner.id as string };
}

async function seedOpex(runner: QueryRunner, tenantId: string, ownerId: string, items: Array<[string, Date | null]>) {
  let n = 0;
  for (const [name, disabledAt] of items) {
    n += 1;
    await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, disabled_at, status, owner_it_id)
       VALUES ($1, $2, 'EUR', '2020-01-01', $3, $4, $5, $6)`,
      [tenantId, name, n, disabledAt, disabledAt && disabledAt.getTime() <= Date.now() ? 'disabled' : 'enabled', ownerId],
    );
  }
}

type ContractSeed = { name: string; start: string; months: number; notice: number; disabledAt?: string | null };

/** Contracts of one tenant; returns their ids by name. */
async function seedContracts(runner: QueryRunner, tenantId: string, ownerId: string, contracts: ContractSeed[]) {
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Expiry company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Expiry supplier') RETURNING id`, [tenantId]);
  const ids = new Map<string, string>();
  for (const { name, start, months, notice, disabledAt = null } of contracts) {
    const [row] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months, owner_user_id, disabled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [tenantId, name, company.id, supplier.id, start, months, notice, ownerId, disabledAt, disabledAt ? 'disabled' : 'enabled'],
    );
    ids.set(name, row.id);
  }
  return ids;
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

/**
 * The daily run's own per-tenant transactions become savepoints of the test
 * transaction, on one connection: the statements are the service's own and
 * nothing is left behind in the shared database.
 */
function savepointDataSource(outer: QueryRunner) {
  let n = 0;
  return {
    query: (sql: string, params?: unknown[]) => outer.query(sql, params),
    createQueryRunner: () => {
      const name = `expiry_tenant_${++n}`;
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

const testOpexWindow = withRunner(async (runner) => {
  const { tenantId, ownerId } = await seedTenant(runner, 'opex');
  await seedOpex(runner, tenantId, ownerId, [
    ['Ends in 14 days', noonUtcInDays(14)],
    ['Ends in 10 days', noonUtcInDays(10)],
    ['Ends in 40 days', noonUtcInDays(40)],
    ['Ended 5 days ago', noonUtcInDays(-5)],
    ['No end', null],
  ]);

  const { received, notifications } = recordingNotifications();
  const svc = serviceWith(notifications);
  const count = await (svc as any).checkOpexExpirationsForTenant(runner.manager, tenantId, at(REAL_TODAY));

  assert.equal(count, 2, 'two OPEX items end within 30 days');
  assert.equal(received.length, 1, 'one warning sent: 14 days is a reminder day, 10 is not');
  const [warning] = received;
  assert.equal(warning.itemType, 'opex');
  assert.equal(warning.itemName, 'Ends in 14 days');
  assert.equal(warning.expirationDate, ymdPlus(REAL_TODAY, 14), 'the last service day');
  assert.equal(warning.daysRemaining, 14, 'days left counted in calendar days');
  assert.equal(warning.warningType, 'expiration');
  assert.equal(warning.tenantId, tenantId);
  assert.deepEqual(warning.recipients.map((r: any) => r.userId), [ownerId], 'the IT owner is warned');
});

const testDailyRunTwoTenants = withRunner(async (runner) => {
  // "Ends soon" contracts run over next month: the run is 7 days before its last day.
  const [y, m] = REAL_TODAY.split('-').map(Number);
  const nextMonthStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const nextMonthEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const today = ymdPlus(nextMonthEnd, -7);

  const tenants = [];
  for (const tag of ['a', 'b']) {
    const { tenantId, ownerId } = await seedTenant(runner, tag);
    await seedOpex(runner, tenantId, ownerId, [
      [`Opex ${tag} ends soon`, at(ymdPlus(today, 7), '12:00')],
      [`Opex ${tag} ends later`, at(ymdPlus(today, 40), '12:00')],
    ]);
    await seedContracts(runner, tenantId, ownerId, [
      { name: `Contract ${tag} ends soon`, start: nextMonthStart, months: 1, notice: 3 },
      { name: `Contract ${tag} ends next year`, start: today, months: 12, notice: 1 },
      { name: `Contract ${tag} disabled`, start: nextMonthStart, months: 1, notice: 3, disabledAt: new Date(Date.now() - 86_400_000).toISOString() },
    ]);
    tenants.push({ tag, tenantId, ownerId });
  }

  const { received, notifications } = recordingNotifications();
  const svc = serviceWith(notifications, savepointDataSource(runner));
  const summary = await svc.checkExpirations(at(today));

  assert.deepEqual(summary.errors, [], 'no tenant fails');
  for (const { tag, tenantId, ownerId } of tenants) {
    const own = received.filter((w) => w.tenantId === tenantId);
    const warned = own.map((w) => `${w.itemType}:${w.warningType}:${w.itemName}:${w.daysRemaining}`).sort();
    assert.deepEqual(
      warned,
      [`contract:expiration:Contract ${tag} ends soon:7`, `opex:expiration:Opex ${tag} ends soon:7`],
      `tenant ${tag}: its contract and its OPEX item ending in 7 days`,
    );
    for (const warning of own) {
      assert.deepEqual(warning.recipients.map((r: any) => r.userId), [ownerId], `tenant ${tag}: only its own owner is warned`);
    }
    const other = tenants.find((t) => t.tenantId !== tenantId)!;
    assert.ok(own.every((w) => !String(w.itemName).includes(` ${other.tag} `)), `tenant ${tag}: none of the other tenant's items`);
  }
});

const OFFSETS = [31, 30, 29, 14, 7, 2, 1, 0];
const REMINDER_OFFSETS = [30, 14, 7, 1];

const testReminderSchedule = withRunner(async (runner) => {
  const year = Number(REAL_TODAY.slice(0, 4)) + 1;
  const { tenantId, ownerId } = await seedTenant(runner, 'schedule');
  const contracts = await seedContracts(runner, tenantId, ownerId, [
    // Ends on 31 December, cancellation deadline on 30 September: three months apart.
    { name: 'Notice far', start: `${year}-01-01`, months: 12, notice: 3 },
    // Ends on 29 March, cancellation deadline on the last day of February, 29 days before.
    { name: 'Notice close', start: `${year - 1}-03-30`, months: 12, notice: 1 },
  ]);
  await seedOpex(runner, tenantId, ownerId, [
    ['Ends at noon', at(`${year}-06-15`, '12:00')],
    ['Ends late evening', at(`${year}-06-15`, '21:59')],
  ]);

  const { received, notifications } = recordingNotifications();
  const svc = serviceWith(notifications);
  const runContracts = async (today: string) => {
    received.length = 0;
    await (svc as any).checkContractExpirationsForTenant(runner.manager, tenantId, at(today));
    return received.map((w) => ({ ...w }));
  };
  const runOpex = async (today: string) => {
    received.length = 0;
    await (svc as any).checkOpexExpirationsForTenant(runner.manager, tenantId, at(today));
    return received.map((w) => ({ ...w }));
  };

  // Contract, cancellation deadline: the end date is three months later, never a candidate here.
  const farId = contracts.get('Notice far');
  const deadline = `${year}-09-30`;
  const cancellationDays: number[] = [];
  for (const k of OFFSETS) {
    const warnings = (await runContracts(ymdPlus(deadline, -k))).filter((w) => w.itemId === farId);
    for (const w of warnings) {
      assert.equal(w.warningType, 'cancellation_deadline', `${k} days before the deadline: only the deadline is warned`);
      assert.equal(w.expirationDate, deadline);
      assert.equal(w.daysRemaining, k, `${k} days before the deadline: days left`);
      assert.deepEqual(w.recipients.map((r: any) => r.userId), [ownerId]);
      cancellationDays.push(k);
    }
  }
  assert.deepEqual(cancellationDays, REMINDER_OFFSETS, 'cancellation deadline warned 30, 14, 7 and 1 day(s) before, once each');

  // Contract, end date: the cancellation deadline has passed.
  const end = `${year}-12-31`;
  const endDays: number[] = [];
  for (const k of OFFSETS) {
    const warnings = (await runContracts(ymdPlus(end, -k))).filter((w) => w.itemId === farId);
    for (const w of warnings) {
      assert.equal(w.warningType, 'expiration', `${k} days before the end: only the end date is warned`);
      assert.equal(w.expirationDate, end);
      assert.equal(w.daysRemaining, k, `${k} days before the end: days left`);
      endDays.push(k);
    }
  }
  assert.deepEqual(endDays, REMINDER_OFFSETS, 'end date warned 30, 14, 7 and 1 day(s) before, once each');

  // OPEX: the UTC calendar date of the end of validity counts, not its time.
  const opexEnd = `${year}-06-15`;
  const opexDays = new Map<string, number[]>();
  for (const k of OFFSETS) {
    for (const w of await runOpex(ymdPlus(opexEnd, -k))) {
      assert.equal(w.expirationDate, opexEnd, `${w.itemName}: the last service day`);
      assert.equal(w.daysRemaining, k, `${w.itemName}, ${k} days before: days left`);
      opexDays.set(w.itemName, [...(opexDays.get(w.itemName) ?? []), k]);
    }
  }
  assert.deepEqual(opexDays.get('Ends at noon'), REMINDER_OFFSETS, 'OPEX ending at noon warned 30, 14, 7 and 1 day(s) before');
  assert.deepEqual(opexDays.get('Ends late evening'), REMINDER_OFFSETS, 'OPEX ending at 21:59Z warned on the same days');

  // Contract whose deadline and end date are 29 days apart: every day from 62 days before
  // the end through the end, each warning follows its own schedule; the day before the
  // deadline, the end is 30 days away and both go out.
  const closeId = contracts.get('Notice close');
  const closeEnd = `${year}-03-29`;
  const closeDeadline = ymdPlus(closeEnd, -29);
  const expected: string[] = [];
  const actual: string[] = [];
  for (let k = 62; k >= 0; k--) {
    const today = ymdPlus(closeEnd, -k);
    for (const [type, date] of [['cancellation_deadline', closeDeadline], ['expiration', closeEnd]] as const) {
      const left = REMINDER_OFFSETS.find((d) => ymdPlus(date, -d) === today);
      if (left !== undefined) expected.push(`${today} ${type} ${date} ${left}`);
    }
    for (const w of (await runContracts(today)).filter((x) => x.itemId === closeId)) {
      actual.push(`${today} ${w.warningType} ${w.expirationDate} ${w.daysRemaining}`);
    }
  }
  assert.equal(expected.length, 8, 'four reminders per deadline');
  assert.deepEqual(actual, expected, 'deadline and end date each warned on their own days');
  const dayBeforeDeadline = ymdPlus(closeDeadline, -1);
  assert.deepEqual(
    actual.filter((line) => line.startsWith(dayBeforeDeadline)),
    [`${dayBeforeDeadline} cancellation_deadline ${closeDeadline} 1`, `${dayBeforeDeadline} expiration ${closeEnd} 30`],
    'the day before the deadline: deadline in 1 day, end in 30 days',
  );
});

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['opex window', testOpexWindow],
      ['daily run, two tenants', testDailyRunTwoTenants],
      ['reminder schedule', testReminderSchedule],
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
    throw new Error(`opex-expiry-warning.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('opex-expiry-warning.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
