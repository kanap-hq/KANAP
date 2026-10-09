import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AUTH_EVENT_RETENTION_DAYS } from '../../audit/security-events';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { AUTH_EVENT_RETENTION_TASK_NAME, AuthEventRetentionService } from '../auth-event-retention.service';

// Retention of the sign-in and session events, on a real database, in a
// rolled-back transaction: the daily task deletes the `auth` rows of the audit
// log older than 365 days, in every tenant, and keeps the younger ones and every
// other row of the audit log whatever its age (data changes, exports).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function insertRow(runner: QueryRunner, tenantId: string, table: string, label: string, days: number) {
  await setTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, action, after_json, source, source_ref, created_at)
     VALUES ($1, $2, 'login', '{}'::jsonb, 'user', $3, now() - make_interval(days => $4::int))`,
    [tenantId, table, label, days],
  );
}

async function labels(runner: QueryRunner, tenantId: string): Promise<string[]> {
  await setTenant(runner, tenantId);
  const rows: Array<{ source_ref: string }> = await runner.query(
    `SELECT source_ref FROM audit_log WHERE tenant_id = $1 ORDER BY source_ref`,
    [tenantId],
  );
  return rows.map((row) => row.source_ref);
}

async function testRetentionDeletesOldSignInEventsOnly() {
  assert.equal(AUTH_EVENT_RETENTION_DAYS, 365);
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'auth-retention-a');
    const b = await seedTenant(runner, 'auth-retention-b');
    const seeds: Array<[string, string, string, number]> = [
      [a, 'auth', 'a-auth-366', 366],
      [a, 'auth', 'a-auth-364', 364],
      [a, 'auth', 'a-auth-today', 0],
      [a, 'users', 'a-users-800', 800],
      [a, 'export', 'a-export-400', 400],
      [a, 'roles', 'a-roles-366', 366],
      [b, 'auth', 'b-auth-500', 500],
      [b, 'auth', 'b-auth-10', 10],
      [b, 'tenants', 'b-tenants-900', 900],
    ];
    for (const [tenantId, table, label, days] of seeds) await insertRow(runner, tenantId, table, label, days);

    const registered: any[] = [];
    const task = new AuthEventRetentionService(dataSource, { register: (reg: any) => registered.push(reg) } as any);
    task.onModuleInit();
    assert.equal(registered.length, 1);
    assert.equal(registered[0].name, AUTH_EVENT_RETENTION_TASK_NAME);
    assert.match(registered[0].description, /365 days/);

    const summary = await task.run({ manager: runner.manager });
    assert.deepEqual(summary.errors, []);
    assert.ok(summary.tenantsProcessed >= 2);
    assert.ok(summary.purged >= 2, `purged ${summary.purged}`);
    assert.deepEqual(await labels(runner, a), ['a-auth-364', 'a-auth-today', 'a-export-400', 'a-roles-366', 'a-users-800']);
    assert.deepEqual(await labels(runner, b), ['b-auth-10', 'b-tenants-900']);
  });
}

runSpecs('auth event retention', [
  ['the retention task deletes sign-in events older than 365 days, per tenant, and nothing else', testRetentionDeletesOldSignInEventsOnly],
]);
