import * as assert from 'node:assert/strict';
import { NotificationsService } from '../notifications.service';

/**
 * notifyItLeadOfTeamChange is fired without being awaited by the team endpoints of projects
 * and requests. Until its IT lead lookup was given a tenant context it always stopped on
 * zero rows; now that it runs to the end it must (1) never reject, because an unhandled
 * rejection ends the Node process, and (2) link the item by its business reference.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';
const IT_LEAD = '33333333-3333-3333-3333-333333333333';

const ALL_ON = {
  emails_enabled: true,
  workspace_settings: {
    portfolio: { enabled: true, status_changes: true, comments: true, team_additions: true, team_changes_as_lead: true },
    tasks: { enabled: true },
    budget: { enabled: true },
  },
};

function createService(options: { failTenantTransaction?: boolean } = {}) {
  const sent: Array<{ to: string; html: string; text: string }> = [];
  const tenantQueries: Array<{ sql: string; params: unknown[] }> = [];

  const createQueryRunner = () => ({
    isTransactionActive: false,
    connect: async () => {
      if (options.failTenantTransaction) throw new Error('timeout exceeded when trying to connect');
    },
    startTransaction: async () => undefined,
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
    release: async () => undefined,
    query: async () => [],
    manager: {
      query: async (sql: string, params: unknown[] = []) => {
        tenantQueries.push({ sql, params });
        // The dedupe claim (notification-dedupe.ts): every key is new here.
        if (/INSERT INTO notification_dedupe/.test(sql)) return (params[1] as string[]).map((key) => ({ dedupe_key: key }));
        if (/FROM users u/.test(sql)) return [{ id: IT_LEAD, email: 'lead@example.com', locale: 'en' }];
        if (/FROM portfolio_projects/.test(sql)) return [{ item_ref: 'PRJ-3' }];
        return [];
      },
    },
  });

  const dataSource = {
    createQueryRunner,
    query: async (sql: string) => {
      if (/SELECT slug FROM tenants/i.test(sql) || /FROM tenants/i.test(sql)) return [{ slug: 'acme', branding: null }];
      return [];
    },
  };
  const emailService = { send: async (mail: any) => { sent.push(mail); } };
  const storage = {};
  const preferences = { getForUser: async () => ALL_ON };

  const svc = new NotificationsService(dataSource as any, emailService as any, storage as any, preferences as any);
  return { svc, sent, tenantQueries };
}

const PARAMS = {
  itemType: 'project' as const,
  itemId: PROJECT,
  itemName: 'ERP rollout',
  addedUserName: 'Ada Lovelace',
  role: 'Contributor',
  itLeadId: IT_LEAD,
  actorId: '44444444-4444-4444-4444-444444444444',
  addedUserId: '55555555-5555-5555-5555-555555555555',
  tenantId: TENANT,
};

async function testResolvesWhenTheTenantTransactionFails() {
  const { svc, sent } = createService({ failTenantTransaction: true });
  // Must resolve: the callers do not await it and attach no catch.
  await svc.notifyItLeadOfTeamChange(PARAMS);
  assert.equal(sent.length, 0);
}

async function testLinksTheItemByBusinessReferenceAndFiltersByTenant() {
  const { svc, sent, tenantQueries } = createService();
  await svc.notifyItLeadOfTeamChange(PARAMS);
  // sendNotification is itself fire-and-forget; let it run.
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1, 'the IT lead is notified');
  assert.equal(sent[0].to, 'lead@example.com');
  const body = `${sent[0].html}\n${sent[0].text}`;
  assert.ok(body.includes('PRJ-3'), 'the link uses the business reference');
  assert.ok(!body.includes(PROJECT), 'the raw id does not appear in the mail');

  const userRead = tenantQueries.find((q) => /FROM users u/.test(q.sql));
  assert.ok(userRead, 'the IT lead is read inside the tenant transaction');
  assert.ok(/u\.tenant_id = \$2/.test(userRead!.sql), 'the read carries an explicit tenant predicate');
  assert.deepEqual(userRead!.params, [IT_LEAD, TENANT]);
}

async function run() {
  await testResolvesWhenTheTenantTransactionFails();
  await testLinksTheItemByBusinessReferenceAndFiltersByTenant();
}

void run();
