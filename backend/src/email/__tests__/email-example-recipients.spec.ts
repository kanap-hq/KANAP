import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { EmailService, isExampleRecipient } from '../email.service';
import type { SendEmailOptions } from '../email.types';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScheduledNotificationsService } from '../../notifications/scheduled-notifications.service';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../notifications/notifications.constants';
import { UsersService } from '../../users/users.service';

/**
 * The demo users live on reserved `.example` domains (RFC 2606): `EmailService` never hands a
 * message for them to the transport, whoever the caller is. A message left with no recipient is
 * resolved without being sent, so no caller fails because of a demo user (an invitation answers
 * 502 when its send fails). The guard runs before `EMAIL_OVERRIDE`. The transport is a double.
 */

// Notification links come from the configured application address (common/url.ts).
if (!process.env.APP_BASE_URL) process.env.APP_BASE_URL = 'https://app.example.test';
// No pacing between two sends in this spec.
process.env.EMAIL_QUEUE_MIN_INTERVAL_MS = '1';
// The invitation link is a signed token.
process.env.JWT_SECRET ??= 'email-example-recipients-spec-secret';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ITEM = '22222222-2222-2222-2222-222222222222';
const DEMO = { userId: '33333333-3333-3333-3333-333333333333', email: 'thomas.berger@fromage-co.example', locale: 'en' };
const REAL = { userId: '44444444-4444-4444-4444-444444444444', email: 'alice@acme.test', locale: 'en' };

Logger.overrideLogger(false);

function createEmailService(override: string | null = null) {
  const previous = process.env.EMAIL_OVERRIDE;
  if (override) process.env.EMAIL_OVERRIDE = override;
  else delete process.env.EMAIL_OVERRIDE;
  const service = new EmailService();
  if (previous === undefined) delete process.env.EMAIL_OVERRIDE;
  else process.env.EMAIL_OVERRIDE = previous;

  const delivered: SendEmailOptions[] = [];
  (service as any).transport = {
    name: 'double',
    defaultMinIntervalMs: 1,
    // Every call is recorded. Like a real provider, the double refuses a reserved domain: a
    // message that reached it with a demo recipient would fail its caller.
    send: async (options: SendEmailOptions) => {
      delivered.push(options);
      const to = Array.isArray(options.to) ? options.to : [options.to];
      if (to.some((entry) => /\.example\W*$/i.test(String(entry)))) throw new Error('recipient domain refused');
    },
    getRetryDelayMs: () => null,
  };
  const recipients = () => delivered.map((mail) => (Array.isArray(mail.to) ? mail.to : [mail.to]));
  return { service, delivered, recipients };
}

const settle = (service: EmailService) => service.drain(Date.now() + 5_000);

const mail = (to: string | string[]): SendEmailOptions => ({ to, subject: 'Status changed', html: '<p>x</p>', text: 'x' });

async function testRecognisesReservedDomains() {
  for (const entry of [
    'thomas.berger@fromage-co.example',
    'Jan.Bakker@KAASMEESTER.EXAMPLE',
    '  luca.ferrari@formaggio-supremo.example  ',
    'Thomas Berger <thomas.berger@fromage-co.example>',
    '"Berger, Thomas" <thomas.berger@fromage-co.example>',
    'thomas.berger@fromage-co.example.',
    'alice@acme.test, thomas.berger@fromage-co.example',
  ]) {
    assert.equal(isExampleRecipient(entry), true, `reserved: ${entry}`);
  }
  for (const entry of ['alice@acme.test', 'Alice <alice@example.com>', 'bob@example.org', 'carol@examples.net', 'dave@my-example.io', '']) {
    assert.equal(isExampleRecipient(entry), false, `deliverable: ${entry}`);
  }
}

async function testOnlyReservedRecipientsSendsNothing() {
  const { service, delivered } = createEmailService();
  await service.send(mail('thomas.berger@fromage-co.example'));
  await service.send(mail(['Jan Bakker <jan.bakker@kaasmeester.example>', 'LUCA.FERRARI@FORMAGGIO-SUPREMO.EXAMPLE']));
  await settle(service);
  assert.equal(delivered.length, 0, 'nothing reaches the transport');
  assert.equal(service.pendingCount(), 0, 'nothing is left in the queue');
}

async function testMixedRecipientsSendsToTheRealOnesOnly() {
  const { service, recipients } = createEmailService();
  await service.send(mail(['thomas.berger@fromage-co.example', 'alice@acme.test', 'Bob <bob@example.com>']));
  await settle(service);
  assert.deepEqual(recipients(), [['alice@acme.test', 'Bob <bob@example.com>']]);
}

async function testGuardRunsBeforeTheOverride() {
  const { service, delivered } = createEmailService('qa-inbox@acme.test');
  await service.send(mail('thomas.berger@fromage-co.example'));
  await settle(service);
  assert.equal(delivered.length, 0, 'a demo recipient is not redirected to the override address');

  await service.send(mail(['thomas.berger@fromage-co.example', 'alice@acme.test']));
  await settle(service);
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].to, ['qa-inbox@acme.test'], 'the override still applies to the rest');
  assert.equal(delivered[0].subject, '[To: alice@acme.test] Status changed', 'the demo address is not even named');
}

/** What the notification services read from the database, for one tenant. */
function fakeDataSource(rows: { users?: any[] } = {}) {
  const query = async (sql: string, params: any[] = []) => {
    if (/FROM tenants/i.test(sql) && /status = 'active'/.test(sql)) return [{ id: TENANT, slug: 'acme' }];
    if (/FROM tenants/i.test(sql)) return [{ slug: 'acme', branding: null }];
    if (/INSERT INTO notification_dedupe/.test(sql)) return (params[1] as string[]).map((key) => ({ dedupe_key: key }));
    if (/FROM users u/.test(sql)) return rows.users ?? [];
    return [];
  };
  const runner = () => ({
    manager: { query },
    isTransactionActive: true,
    connect: async () => undefined,
    startTransaction: async () => undefined,
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
    release: async () => undefined,
    query,
  });
  return { query, createQueryRunner: runner };
}

const OPTED_IN = (() => {
  const prefs = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES));
  prefs.emails_enabled = true;
  for (const workspace of Object.values(prefs.workspace_settings) as any[]) {
    for (const key of Object.keys(workspace)) workspace[key] = true;
  }
  return prefs;
})();

function notificationsWith(emailService: EmailService, dataSource = fakeDataSource()) {
  const preferences = { getForUser: async () => OPTED_IN };
  return new NotificationsService(dataSource as any, emailService, {} as any, preferences as any);
}

async function testEventNotification() {
  const { service, recipients } = createEmailService();
  const notifications = notificationsWith(service);
  await notifications.notifyStatusChange({
    itemType: 'project',
    itemId: ITEM,
    itemName: 'ERP rollout',
    oldStatus: 'planned',
    newStatus: 'in_progress',
    recipients: [DEMO, REAL],
    tenantId: TENANT,
  });
  await settle(service);
  assert.deepEqual(recipients(), [[REAL.email]], 'event notification: only the real user is e-mailed');
}

async function testDueDateReminder() {
  const { service, recipients } = createEmailService();
  const notifications = notificationsWith(service);
  await notifications.notifyExpirationWarning({
    itemType: 'contract',
    itemId: ITEM,
    itemName: 'Cloud hosting',
    expirationDate: '2026-10-20',
    daysRemaining: 14,
    warningType: 'cancellation_deadline',
    recipients: [DEMO, REAL],
    tenantId: TENANT,
  });
  await settle(service);
  assert.deepEqual(recipients(), [[REAL.email]], 'due-date reminder: only the real user is e-mailed');
}

async function testWeeklyReview() {
  const { service, recipients } = createEmailService();
  const user = (who: typeof DEMO) => ({
    user_id: who.userId,
    tenant_id: TENANT,
    weekly_review_day: 1,
    weekly_review_hour: 8,
    timezone: 'Europe/Paris',
    weekly_review_last_sent_at: null,
    preferences_updated_at: null,
    email: who.email,
    first_name: 'Demo',
    last_name: 'User',
    locale: 'en',
  });
  const dataSource = fakeDataSource({ users: [user(DEMO), user(REAL)] });
  const scheduledTasks = { register: () => undefined };
  const scheduled = new ScheduledNotificationsService(
    dataSource as any,
    service,
    {} as any,
    notificationsWith(service, dataSource),
    {} as any,
    scheduledTasks as any,
  );
  const summary = await scheduled.sendWeeklyReviews();
  await settle(service);
  assert.deepEqual(recipients(), [[REAL.email]], 'weekly review: only the real user is e-mailed');
  assert.equal(summary.sent, 2, 'the demo user counts as served: the run does not fail or retry on it');
  assert.deepEqual(summary.errors, []);
}

async function testInvitation() {
  const { service, delivered } = createEmailService();
  const user: any = {
    id: DEMO.userId, email: DEMO.email, tenant_id: TENANT, status: 'enabled', locale: 'en',
    role: { role_name: 'Reader' }, external_auth_provider: null,
  };
  const repo = { findOne: async () => ({ ...user }), save: async (row: any) => row, manager: {} };
  const tokens = { create: (row: any) => row, save: async () => undefined };
  const manager: any = { getRepository: (entity: { name?: string }) => (entity?.name === 'User' ? repo : tokens) };
  const users = new UsersService(repo as any, {} as any, {} as any, {} as any, {} as any, service, { log: async () => undefined } as any);
  const commitThenRun = async (fn: () => Promise<void>) => { await fn(); };

  const result = await users.inviteUser(DEMO.userId, 'admin-1', 'https://acme.kanap.net', { manager, commitThenRun });
  assert.equal(result.status, 'enabled', 'the invitation of a demo user resolves (no 502)');
  await settle(service);
  assert.equal(delivered.length, 0, 'invitation: nothing is sent to the demo user');
}

async function main() {
  await testRecognisesReservedDomains();
  await testOnlyReservedRecipientsSendsNothing();
  await testMixedRecipientsSendsToTheRealOnesOnly();
  await testGuardRunsBeforeTheOverride();
  await testEventNotification();
  await testDueDateReminder();
  await testWeeklyReview();
  await testInvitation();
  console.log('email-example-recipients.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
