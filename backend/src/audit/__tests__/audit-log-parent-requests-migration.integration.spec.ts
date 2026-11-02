// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLogParentRequests1855940000000 as Migration } from '../../migrations/1855940000000-audit-log-parent-requests';

// Migration 1855940000000 (the request attachments read by parent), against a real database, in a
// transaction rolled back at the end. It seeds two tenants with attachment rows (after and before
// payloads), and rows that must keep no parent (an invalid uuid, a request absent from its table, a
// request of the other tenant, link sets read by record_id), plus an already-parented row, then:
// - each row naming a request of its tenant gets it as parent, tenant by tenant, in batches
//   smaller than the seed;
// - the other rows stay as they were; the counts are logged per label; RLS stays ENABLE + FORCE
//   and no statement disables it; the tenant setting is restored;
// - a second run rewrites no row;
// - down() clears the request parents of this label only; up() after it restores them.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentRequests:';
const LABELS = ['portfolio_request_attachments'];

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

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Audit parent requests', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `audit-parent-req-${tag}-${tenantId.slice(0, 8)}`],
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
    [tenantId, [...LABELS, 'portfolio_request_team', 'portfolio_request_applications']],
  );
}

type Seed = {
  requestId: string;
  /** name → row id, whose expected parent is the request */
  filled: Record<string, string>;
  kept: Record<string, string>;
};

async function seedRows(runner: QueryRunner, tenantId: string, foreignRequest: string | null): Promise<Seed> {
  const requestId = await one(
    runner,
    `INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Data platform', 1) RETURNING id`,
    [tenantId],
  );
  const filled: Seed['filled'] = {};
  const kept: Seed['kept'] = {};
  const label = 'portfolio_request_attachments';

  filled.attachment = await insertAudit(runner, tenantId, label, randomUUID(), 'create', null, { request_id: requestId, original_filename: 'brief.pdf' });
  filled.attachmentRemoved = await insertAudit(runner, tenantId, label, randomUUID(), 'delete', { request_id: requestId, original_filename: 'old.pdf' }, null);
  filled.attachmentUpper = await insertAudit(runner, tenantId, label, randomUUID(), 'create', null, { request_id: requestId.toUpperCase(), original_filename: 'upper.pdf' });
  for (let n = 0; n < 4; n += 1) {
    filled[`attachment${n}`] = await insertAudit(runner, tenantId, label, randomUUID(), 'create', null, { request_id: requestId, original_filename: `file-${n}.pdf` });
  }

  kept.invalid = await insertAudit(runner, tenantId, label, randomUUID(), 'create', null, { request_id: 'not-a-uuid' });
  // A well-formed id absent from the requests table: no parent.
  kept.missingRequest = await insertAudit(runner, tenantId, label, randomUUID(), 'create', null, { request_id: randomUUID() });
  // The other tenant's request: never a parent here.
  if (foreignRequest) {
    kept.foreignRequest = await insertAudit(runner, tenantId, label, randomUUID(), 'create', null, { request_id: foreignRequest });
  }
  // The sets written from the request are read by record_id.
  kept.team = await insertAudit(runner, tenantId, 'portfolio_request_team', requestId, 'update', { role: 'it_team', ids: [] }, { role: 'it_team', ids: [randomUUID()] });
  kept.applications = await insertAudit(runner, tenantId, 'portfolio_request_applications', requestId, 'update', { ids: [] }, { ids: [randomUUID()] });
  // Already parented: the migration must not choose another parent, and down() must keep it.
  kept.alreadyParented = await insertAudit(runner, tenantId, label, randomUUID(), 'update', null, { request_id: requestId });
  await runner.query(`UPDATE audit_log SET parent_table = 'spend_items', parent_id = $2 WHERE id = $1`, [kept.alreadyParented, randomUUID()]);
  return { requestId, filled, kept };
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

function checkSeed(byId: Map<string, any>, seed: Seed) {
  for (const [name, id] of Object.entries(seed.filled)) {
    const row = byId.get(id);
    assert.equal(row.parent_table, 'portfolio_requests', `${name}: the parent table`);
    assert.equal(row.parent_id, seed.requestId, `${name}: the parent id`);
  }
  for (const [name, id] of Object.entries(seed.kept)) {
    const row = byId.get(id);
    assert.ok(row, `${name}: the seeded row is returned`);
    if (name === 'alreadyParented') {
      assert.equal(row.parent_table, 'spend_items', `${name}: the earlier parent stays`);
    } else {
      assert.equal(row.parent_id, null, `${name}: no parent`);
      assert.equal(row.parent_table, null, `${name}: no parent table`);
    }
  }
}

async function testBackfillRerunAndDown() {
  await inRolledBackTransaction(async (runner) => {
    const otherTenant = await seedTenant(runner, 'other');
    const otherSeed = await seedRows(runner, otherTenant, null);
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId, otherSeed.requestId);
    await clearTenant(runner);

    // Batches of 4 rows: each tenant's 11-12 attachment rows take several statements.
    migration.batchSize = 4;
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
    assert.match(firstLog, / portfolio_request_attachments: \d+ filled, \d+ without a parent/);

    checkSeed(new Map((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row])), seed);
    checkSeed(new Map((await rowsOf(runner, otherTenant)).map((row: any) => [row.id, row])), otherSeed);
    for (const table of ['audit_log', 'portfolio_requests', 'tenants']) {
      const expected = table === 'tenants' ? { enabled: false, forced: false } : { enabled: true, forced: true };
      assert.deepEqual(await rowSecurity(runner, table), expected, `${table}: RLS as found`);
    }

    // A second run rewrites no row.
    const afterFirst = await rowsOf(runner, tenantId);
    const second = await captureLog(() => migration.up(runner));
    assert.ok(second.lines.join('\n').includes(PREFIX));
    const afterSecond = await rowsOf(runner, tenantId);
    assert.deepEqual(
      afterSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      afterFirst.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      'the second run rewrites no row',
    );

    // down() clears the request parents of this label, tenant by tenant, and leaves another parent alone.
    await clearTenant(runner);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down() restores the tenant setting');
    for (const tenant of [tenantId, otherTenant]) {
      const tenantSeed = tenant === tenantId ? seed : otherSeed;
      const afterDown = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      for (const id of Object.values(tenantSeed.filled)) assert.equal(afterDown.get(id).parent_id, null, 'down() clears the parent');
      assert.equal(afterDown.get(tenantSeed.kept.alreadyParented).parent_table, 'spend_items', 'down() leaves another parent');
    }

    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    checkSeed(new Map((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row])), seed);
  });
  console.log('  backfill, rerun, two tenants, absent parents, down/up: OK');
}

async function run() {
  await dataSource.initialize();
  try {
    await testBackfillRerunAndDown();
  } finally {
    await dataSource.destroy();
  }
  console.log('audit-log-parent-requests-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
