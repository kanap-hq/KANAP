import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { NotificationsService } from '../notifications.service';
import { claimNotificationKeys, notificationDedupeKey } from '../notification-dedupe';

// Event notifications go out at most once per recipient, item and trigger within 5 minutes.
// The window used to live in each API process's memory; with several processes (API_WORKERS > 1)
// two quick changes answered by two processes both mailed. It is now claimed in the database
// (notification_dedupe, tenant-scoped). Two DataSources stand for two processes.

async function seedTenant(): Promise<string> {
  const id = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Dedupe spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, `dedupe-${id.slice(0, 8)}`],
  );
  return id;
}

async function testOneClaimAcrossProcesses(other: DataSource, tenantId: string) {
  const key = notificationDedupeKey(randomUUID(), 'project', randomUUID(), 'status_change');
  // Ten claims at once from the two processes: exactly one wins.
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => claimNotificationKeys(i % 2 ? other : dataSource, tenantId, [key])),
  );
  assert.equal(results.filter((claimed) => claimed.has(key)).length, 1, 'one claim wins, nine are deduplicated');
  assert.equal((await claimNotificationKeys(other, tenantId, [key])).size, 0, 'within the window: nothing to send');

  // The window passed (the stored date moved 6 minutes back): sendable again, once.
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await manager.query(`UPDATE notification_dedupe SET sent_at = sent_at - interval '6 minutes' WHERE tenant_id = $1 AND dedupe_key = $2`, [tenantId, key]);
  });
  const after = await Promise.all([claimNotificationKeys(dataSource, tenantId, [key]), claimNotificationKeys(other, tenantId, [key])]);
  assert.equal(after.filter((claimed) => claimed.has(key)).length, 1, 'after the window: sent once more');
}

async function testKeysAreIndependentAndTenantScoped(tenantId: string, otherTenantId: string) {
  const user = randomUUID();
  const item = randomUUID();
  const status = notificationDedupeKey(user, 'task', item, 'status_change');
  const comment = notificationDedupeKey(user, 'task', item, 'comment');
  const claimed = await claimNotificationKeys(dataSource, tenantId, [status, comment, status]);
  assert.deepEqual([...claimed].sort(), [comment, status].sort(), 'each trigger has its own window; a repeated key counts once');
  assert.equal((await claimNotificationKeys(dataSource, otherTenantId, [status])).size, 1, 'another tenant has its own windows');
  const [{ n }] = await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenantId]);
    return manager.query(`SELECT count(*)::int AS n FROM notification_dedupe WHERE dedupe_key = ANY($1)`, [[status, comment]]);
  });
  assert.equal(n, 1, 'RLS: a tenant sees only its own rows');
}

async function testServiceSendsOnceAcrossProcesses(other: DataSource, tenantId: string) {
  const sent: string[] = [];
  const emailService = { send: async (mail: any) => { sent.push(mail.to); } };
  const preferences = {
    getForUser: async () => ({
      emails_enabled: true,
      workspace_settings: { portfolio: { enabled: true, status_changes: true }, tasks: { enabled: true }, budget: { enabled: true } },
    }),
  };
  const make = (ds: DataSource) => {
    const svc = new NotificationsService(ds, emailService as any, {} as any, preferences as any);
    (svc as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
    return svc;
  };
  const processA = make(dataSource);
  const processB = make(other);
  const params = {
    itemType: 'project' as const,
    itemId: randomUUID(),
    itemName: 'ERP rollout',
    oldStatus: 'in_progress',
    newStatus: 'done',
    recipients: [{ userId: randomUUID(), email: 'owner@example.com', name: 'Owner', locale: 'en' }],
    tenantId,
  };
  // Two status changes of one project, a moment apart, answered by two processes.
  await Promise.all([processA.notifyStatusChange(params as any), processB.notifyStatusChange({ ...params, oldStatus: 'done', newStatus: 'in_progress' } as any)]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(sent, ['owner@example.com'], 'the owner gets one email, not one per process');
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const other = new DataSource({ ...(dataSource.options as any), poolSize: 6 });
  await other.initialize();
  const tenants = [await seedTenant(), await seedTenant()];
  const failures: string[] = [];
  try {
    for (const [label, test] of [
      ['testOneClaimAcrossProcesses', () => testOneClaimAcrossProcesses(other, tenants[0])],
      ['testKeysAreIndependentAndTenantScoped', () => testKeysAreIndependentAndTenantScoped(tenants[0], tenants[1])],
      ['testServiceSendsOnceAcrossProcesses', () => testServiceSendsOnceAcrossProcesses(other, tenants[0])],
    ] as const) {
      try {
        await test();
        console.log(`ok - ${label}`);
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await dataSource.query(`DELETE FROM tenants WHERE id = ANY($1)`, [tenants]);
    await other.destroy();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`notification-dedupe.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('notification-dedupe.integration.spec: ok');
  process.exitCode = 0;
}

void main();
