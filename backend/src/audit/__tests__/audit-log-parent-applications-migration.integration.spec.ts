// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLogParentApplications1855910000000 as Migration } from '../../migrations/1855910000000-audit-log-parent-applications';

// Migration 1855910000000 (the application children), against a real database, in a transaction
// rolled back at the end. It seeds two tenants with the deployments, web links and attachments
// that name their application in the payload, the assignments that name a deployment, and rows
// that must keep no parent (an invalid uuid, an application or a deployment that does not exist,
// a deployment of the other tenant, a set read by record_id, an already-parented row), then:
// - each row whose application exists in the tenant gets it as parent, tenant by tenant, in
//   batches smaller than the seed; an assignment gets the application of its deployment;
// - the counts are logged per label, the partial index exists with the history's expression and
//   labels, RLS stays ENABLE + FORCE and no statement touches it; the tenant setting is restored;
// - a second run rewrites no row;
// - down() drops the index and clears the parents it set; up() after it restores them.
// @database-spec: the data source of the migrated test database.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentApplications:';
const INDEX = 'idx_audit_log_application_id_applications';

const LABELS = ['app_instances', 'application_links', 'application_attachments', 'app_asset_assignments'];
const INDEX_LABELS = ['application_business_processes', 'application_technologies'];

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function clearTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Audit parent applications', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `audit-parent-app-${tag}-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

async function insertAudit(
  runner: QueryRunner,
  tenantId: string,
  table: string,
  recordId: string | null,
  action: string,
  before: unknown,
  after: unknown,
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'user') RETURNING id`,
    [tenantId, table, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
  return row.id;
}

async function indexDefinition(runner: QueryRunner, name: string) {
  const [row] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [name]);
  return row?.indexdef ?? null;
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

async function rowsOf(runner: QueryRunner, tenantId: string) {
  await setTenant(runner, tenantId);
  return runner.query(
    `SELECT id, table_name, parent_table, parent_id, ctid::text AS ctid
       FROM audit_log WHERE tenant_id = $1 AND table_name = ANY($2::text[]) ORDER BY id`,
    [tenantId, [...LABELS, 'applications', 'application_owners']],
  );
}

type Seed = {
  applicationId: string;
  instanceId: string;
  filled: Record<string, string>;
  kept: Record<string, string>;
};

async function seedRows(runner: QueryRunner, tenantId: string, foreignInstance: string | null): Promise<Seed> {
  await setTenant(runner, tenantId);
  // The parent rows exist: the backfill only sets an application that is in the same tenant.
  const [application] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Billing') RETURNING id`, [tenantId]);
  const applicationId = application.id as string;
  const [instance] = await runner.query(
    `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`,
    [tenantId, applicationId],
  );
  const instanceId = instance.id as string;
  const filled: Record<string, string> = {};
  const kept: Record<string, string> = {};

  filled.instance = await insertAudit(runner, tenantId, 'app_instances', instanceId, 'create', null, { application_id: applicationId, environment: 'prod' });
  filled.instanceDeleted = await insertAudit(runner, tenantId, 'app_instances', randomUUID(), 'delete', { application_id: applicationId, environment: 'dev' }, null);
  filled.link = await insertAudit(runner, tenantId, 'application_links', randomUUID(), 'delete', { application_id: applicationId, url: 'https://example.invalid' }, null);
  filled.attachment = await insertAudit(runner, tenantId, 'application_attachments', randomUUID(), 'create', null, { application_id: applicationId, original_filename: 'note.txt' });
  filled.assignment = await insertAudit(runner, tenantId, 'app_asset_assignments', randomUUID(), 'create', null, { app_instance_id: instanceId, asset_id: randomUUID(), role: 'db' });
  filled.assignmentRemoved = await insertAudit(runner, tenantId, 'app_asset_assignments', randomUUID(), 'delete', { app_instance_id: instanceId, asset_id: randomUUID() }, null);

  kept.invalid = await insertAudit(runner, tenantId, 'application_links', randomUUID(), 'create', null, { application_id: 'not-a-uuid' });
  kept.missingApplication = await insertAudit(runner, tenantId, 'application_attachments', randomUUID(), 'create', null, { application_id: randomUUID() });
  // The deployment was deleted: no rule can find the application.
  kept.missingInstance = await insertAudit(runner, tenantId, 'app_asset_assignments', randomUUID(), 'delete', { app_instance_id: randomUUID() }, null);
  if (foreignInstance) {
    // A deployment of the other tenant is never read.
    kept.foreignInstance = await insertAudit(runner, tenantId, 'app_asset_assignments', randomUUID(), 'create', null, { app_instance_id: foreignInstance });
  }
  kept.recordMode = await insertAudit(runner, tenantId, 'application_owners', applicationId, 'update', [], ['it:' + randomUUID()]);
  kept.alreadyParented = await insertAudit(runner, tenantId, 'application_links', randomUUID(), 'update', { application_id: applicationId }, null);
  await runner.query(`UPDATE audit_log SET parent_table = 'cost_centers', parent_id = $2 WHERE id = $1`, [kept.alreadyParented, randomUUID()]);
  kept.outsideFamily = await insertAudit(runner, tenantId, 'applications', applicationId, 'update', { name: 'before' }, { name: 'after' });
  await runner.query(`UPDATE audit_log SET parent_table = 'cost_centers', parent_id = $2 WHERE id = $1`, [kept.outsideFamily, randomUUID()]);
  return { applicationId, instanceId, filled, kept };
}

async function currentTenantSetting(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS value`);
  return row.value;
}

function recordStatements(runner: QueryRunner): { statements: string[]; stop: () => void } {
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return (original as any)(sql, ...rest);
  };
  return { statements, stop: () => { (runner as any).query = original; } };
}

async function testBackfillRerunAndDown() {
  await inRolledBackTransaction(async (runner) => {
    await runner.query(`DROP INDEX IF EXISTS ${INDEX}`);

    const otherTenant = await seedTenant(runner, 'other');
    const otherSeed = await seedRows(runner, otherTenant, null);
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId, otherSeed.instanceId);
    await clearTenant(runner);

    // Batches of 3 rows: each tenant's 10-13 rows take several statements.
    migration.batchSize = 3;
    const recorded = recordStatements(runner);
    let first;
    try {
      first = await captureLog(() => migration.up(runner));
    } finally {
      recorded.stop();
      migration.batchSize = 50000;
    }
    const firstLog = first.lines.join('\n');
    const statements = recorded.statements.join('\n');
    assert.doesNotMatch(statements, /ROW LEVEL SECURITY|row_security/i, 'the migration never touches RLS');
    assert.ok(recorded.statements.filter((sql) => /WITH candidates AS/.test(sql)).length >= 2 * 3, 'several batches per tenant');
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');
    assert.ok(firstLog.includes(PREFIX), firstLog);
    for (const label of LABELS) assert.ok(firstLog.includes(`  ${label}:`), `logged: ${label}`);
    assert.ok(firstLog.includes('app_asset_assignments: 4 filled, 3 without a parent'), firstLog);

    for (const tenant of [tenantId, otherTenant]) {
      const byId = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      const tenantSeed = tenant === tenantId ? seed : otherSeed;
      for (const [name, id] of Object.entries(tenantSeed.filled)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, 'applications', `${name}: the parent table`);
        assert.equal(row.parent_id, tenantSeed.applicationId, `${name}: the parent id`);
      }
      for (const [name, id] of Object.entries(tenantSeed.kept)) {
        const row = byId.get(id);
        assert.ok(row, `${name}: the seeded row is returned`);
        if (name === 'alreadyParented' || name === 'outsideFamily') {
          assert.equal(row.parent_table, 'cost_centers', `${name}: the earlier parent stays`);
        } else {
          assert.equal(row.parent_id, null, `${name}: no parent`);
          assert.equal(row.parent_table, null, `${name}: no parent table`);
        }
      }
    }
    const index = await indexDefinition(runner, INDEX);
    assert.ok(index, 'the application index exists');
    assert.match(index, /\(tenant_id, lower\(\(COALESCE\(after_json, before_json\) ->> 'application_id'::text\)\), created_at DESC, id DESC\)/);
    for (const label of INDEX_LABELS) assert.ok(index.includes(`'${label}'`), `the index names ${label}`);
    for (const table of ['audit_log', 'applications', 'app_instances', 'tenants']) {
      const expected = table === 'tenants' ? { enabled: false, forced: false } : { enabled: true, forced: true };
      assert.deepEqual(await rowSecurity(runner, table), expected, `${table}: RLS as found`);
    }

    const afterFirst = await rowsOf(runner, tenantId);
    const second = await captureLog(() => migration.up(runner));
    assert.ok(second.lines.join('\n').includes(PREFIX));
    const afterSecond = await rowsOf(runner, tenantId);
    assert.deepEqual(
      afterSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      afterFirst.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      'the second run rewrites no row',
    );

    await clearTenant(runner);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down() restores the tenant setting');
    assert.equal(await indexDefinition(runner, INDEX), null, 'down() drops the index');
    for (const tenant of [tenantId, otherTenant]) {
      const afterDown = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      const tenantSeed = tenant === tenantId ? seed : otherSeed;
      for (const id of Object.values(tenantSeed.filled)) assert.equal(afterDown.get(id).parent_id, null, 'down() clears the parent');
      assert.equal(afterDown.get(tenantSeed.kept.alreadyParented).parent_table, 'cost_centers', 'down() leaves another parent');
      assert.equal(afterDown.get(tenantSeed.kept.outsideFamily).parent_table, 'cost_centers', 'down() leaves another parent');
    }

    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    const afterDownUp = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
    for (const [name, id] of Object.entries(seed.filled)) assert.ok(afterDownUp.get(id).parent_id, `${name}: filled again after down/up`);
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testBackfillRerunAndDown();
  } finally {
    await dataSource.destroy();
  }
  console.log('audit-log-parent-applications-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
