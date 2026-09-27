import * as assert from 'node:assert/strict';
import { NotificationsService } from '../notifications.service';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesData,
} from '../notifications.constants';

/**
 * Expiry warnings (contract cancellation deadline / end date, OPEX and CAPEX end of validity) go only
 * to users who opted in: emails on, budget notifications on, expiration warnings on. The
 * same-day guard must only record a recipient who is actually emailed, so a user who opts in
 * after a skipped run still gets the reminder. The guard stops a same-day re-run of the task
 * from resending, survives the 5-minute dedupe cleanup, and never blocks the next reminder.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const ITEM = '22222222-2222-2222-2222-222222222222';
const ALICE = { userId: '33333333-3333-3333-3333-333333333333', email: 'alice@example.com', locale: 'en' };
const BOB = { userId: '44444444-4444-4444-4444-444444444444', email: 'bob@example.com', locale: 'en' };

function prefs(opts: { emails: boolean; budget: boolean; warnings: boolean }): NotificationPreferencesData {
  const p: NotificationPreferencesData = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES));
  p.emails_enabled = opts.emails;
  p.workspace_settings.budget.enabled = opts.budget;
  p.workspace_settings.budget.expiration_warnings = opts.warnings;
  return p;
}

const OPTED_IN = prefs({ emails: true, budget: true, warnings: true });

const HOUR_MS = 60 * 60 * 1000;

function createService() {
  const sent: Array<{ to: string }> = [];
  // Stored preferences per user; a user absent from the map gets the defaults (all off),
  // as NotificationPreferencesService.getForUser does when no row exists.
  const stored = new Map<string, NotificationPreferencesData>();

  const dataSource = {
    query: async (sql: string) => (/FROM tenants/i.test(sql) ? [{ slug: 'acme', branding: null }] : []),
  };
  const emailService = { send: async (mail: any) => { sent.push(mail); } };
  const preferences = {
    getForUser: async (userId: string) =>
      stored.get(userId) ?? JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)),
  };

  const svc = new NotificationsService(dataSource as any, emailService as any, {} as any, preferences as any);
  // The dedupe clock, moved by the guard cases.
  const clock = { now: Date.UTC(2026, 9, 6, 8) };
  (svc as any).now = () => clock.now;
  return { svc, sent, stored, clock };
}

// A reminder 14 days before a deadline on 2026-10-20, sent by the 08:00 UTC run of 2026-10-06.
async function warn(
  svc: NotificationsService,
  itemType: 'contract' | 'opex' | 'capex',
  recipients: typeof ALICE[],
  daysRemaining = 14,
) {
  await svc.notifyExpirationWarning({
    itemType,
    itemId: ITEM,
    itemName: 'Cloud hosting',
    expirationDate: '2026-10-20',
    daysRemaining,
    warningType: itemType === 'contract' ? 'cancellation_deadline' : 'expiration',
    recipients,
    tenantId: TENANT,
  });
  // sendNotification is fire-and-forget; let it run.
  await new Promise((resolve) => setImmediate(resolve));
}

async function casesFor(itemType: 'contract' | 'opex' | 'capex') {
  const label = (s: string) => `[${itemType}] ${s}`;

  {
    const { svc, sent } = createService();
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 0, label('no stored preferences (defaults) → no email'));
  }

  {
    const { svc, sent, stored } = createService();
    stored.set(ALICE.userId, prefs({ emails: true, budget: true, warnings: false }));
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 0, label('expiration warnings off → no email'));
  }

  {
    const { svc, sent, stored } = createService();
    stored.set(ALICE.userId, prefs({ emails: false, budget: true, warnings: true }));
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 0, label('emails off → no email'));
  }

  {
    const { svc, sent, stored } = createService();
    stored.set(ALICE.userId, OPTED_IN);
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 1, label('opted in → exactly one email'));
    assert.equal(sent[0].to, ALICE.email);

    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 1, label('same item and warning again right after → deduped'));
  }

  {
    const { svc, sent, stored, clock } = createService();
    stored.set(ALICE.userId, OPTED_IN);
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 1, label('first run of the day → one email'));

    clock.now += 2 * HOUR_MS;
    (svc as any).cleanupDedupeCache();
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 1, label('re-run two hours later, after the 5-minute cleanup → still deduped'));

    clock.now += 7 * 24 * HOUR_MS - 2 * HOUR_MS;
    (svc as any).cleanupDedupeCache();
    await warn(svc, itemType, [ALICE], 7);
    assert.equal(sent.length, 2, label('next reminder day (7 days left) → emailed'));
    assert.equal((svc as any).expiryRemindersSent.size, 1, label('the previous reminder guard is cleaned after 24 hours'));
  }

  {
    const { svc, sent, stored } = createService();
    stored.set(ALICE.userId, OPTED_IN);
    await warn(svc, itemType, [ALICE], 14);
    await warn(svc, itemType, [ALICE], 7);
    assert.equal(sent.length, 2, label('a different reminder day is never blocked by the guard'));
  }

  {
    const { svc, sent, stored } = createService();
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 0, label('not opted in on the first run → no email'));

    stored.set(ALICE.userId, OPTED_IN);
    await warn(svc, itemType, [ALICE]);
    assert.equal(sent.length, 1, label('opts in later → emailed on the next run'));
    assert.equal(sent[0].to, ALICE.email);
  }

  {
    const { svc, sent, stored } = createService();
    stored.set(BOB.userId, OPTED_IN);
    await warn(svc, itemType, [ALICE, BOB]);
    assert.deepEqual(sent.map((m) => m.to), [BOB.email], label('two recipients, only the opted-in one is emailed'));
  }
}

async function run() {
  await casesFor('contract');
  await casesFor('opex');
  await casesFor('capex');
  console.log('expiry-warning-opt-in: all cases passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
