// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLogParentContractsIncidents1855900000000 as Migration } from '../../migrations/1855900000000-audit-log-parent-contracts-incidents';

// Migration 1855900000000 (the contract and incident children, and the tasks of both), against a
// real database, in a transaction rolled back at the end. It seeds two tenants with one audit row
// per label (after and before payloads, the record_id fallback of the supplier sync and of the
// assistant's web links, a task of each
// type), and rows that must keep no parent (an invalid uuid, a record absent from its table, a
// record of the other tenant, a project task, a standalone task, a link set read by record_id),
// plus an already-parented row, then:
// - each row naming a contract or an incident of its tenant gets the matching parent, tenant by
//   tenant, in batches smaller than the seed;
// - the other rows stay as they were; the counts are logged per label; RLS stays ENABLE + FORCE
//   and no statement disables it; the tenant setting is restored;
// - a second run rewrites no row;
// - down() clears the parents of these labels only; up() after it restores them.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentContractsIncidents:';
const LABELS = ['contract_contacts', 'contract_links', 'contract_attachments', 'contract_compliance_items', 'incident_attachments', 'tasks'];

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
     VALUES ($1, $2, 'Audit parent contracts', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `audit-parent-ci-${tag}-${tenantId.slice(0, 8)}`],
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
    [tenantId, [...LABELS, 'application_contracts', 'incident_assets']],
  );
}

type Seed = {
  contractId: string;
  incidentId: string;
  /** name → [row id, expected parent table] */
  filled: Record<string, [string, 'contracts' | 'incidents']>;
  kept: Record<string, string>;
};

async function seedRows(runner: QueryRunner, tenantId: string, foreignContract: string | null): Promise<Seed> {
  const company = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, 'Alpha Co', 'FR', 'Lyon', 'enabled') RETURNING id`, [tenantId]);
  const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Acme Supplies') RETURNING id`, [tenantId]);
  const contractId = await one(
    runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Support Contract', $2, $3, '2026-01-01') RETURNING id`,
    [tenantId, company, supplier],
  );
  const incidentId = await one(
    runner,
    `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 1, 'Outage', 'major') RETURNING id`,
    [tenantId],
  );
  const filled: Seed['filled'] = {};
  const kept: Seed['kept'] = {};
  const contact = randomUUID();

  filled.contactLink = [await insertAudit(runner, tenantId, 'contract_contacts', randomUUID(), 'create', null, { contract_id: contractId, contact_id: contact, role: 'commercial' }), 'contracts'];
  filled.contactRemoved = [await insertAudit(runner, tenantId, 'contract_contacts', randomUUID(), 'delete', { contract_id: contractId, contact_id: contact }, null), 'contracts'];
  filled.supplierSync = [await insertAudit(runner, tenantId, 'contract_contacts', contractId, 'update', [`${contact}:commercial`], []), 'contracts'];
  filled.webLink = [await insertAudit(runner, tenantId, 'contract_links', randomUUID(), 'update', { contract_id: contractId, url: 'https://example.invalid' }, null), 'contracts'];
  // The assistant's whole-set replacement of the web links: the contract in record_id.
  filled.assistantLinks = [await insertAudit(runner, tenantId, 'contract_links', contractId, 'update', [], [{ key: 'https://example.invalid/a', label: 'Terms', payload: { url: 'https://example.invalid/a', description: 'Terms' } }]), 'contracts'];
  filled.attachment = [await insertAudit(runner, tenantId, 'contract_attachments', randomUUID(), 'create', null, { contract_id: contractId, original_filename: 'signed.pdf' }), 'contracts'];
  filled.compliance = [await insertAudit(runner, tenantId, 'contract_compliance_items', randomUUID(), 'create', null, { contract_id: contractId, requirement: 'exit_plan', state: 'present' }), 'contracts'];
  filled.incidentAttachment = [await insertAudit(runner, tenantId, 'incident_attachments', randomUUID(), 'delete', { incident_id: incidentId, original_filename: 'log.txt' }, { incident_id: incidentId, original_filename: 'log.txt', deleted_at: '2026-10-29T10:00:00Z' }), 'incidents'];
  filled.contractTask = [await insertAudit(runner, tenantId, 'tasks', randomUUID(), 'create', null, { title: 'Decide', related_object_type: 'contract', related_object_id: contractId }), 'contracts'];
  filled.incidentTask = [await insertAudit(runner, tenantId, 'tasks', randomUUID(), 'delete', { title: 'Fix', related_object_type: 'incident', related_object_id: incidentId }, null), 'incidents'];

  kept.invalid = await insertAudit(runner, tenantId, 'contract_links', randomUUID(), 'create', null, { contract_id: 'not-a-uuid' });
  // A well-formed id absent from the contracts table: no parent.
  kept.missingContract = await insertAudit(runner, tenantId, 'contract_attachments', randomUUID(), 'create', null, { contract_id: randomUUID() });
  // A contact link whose payload names no contract falls back on record_id: here the link id, absent.
  kept.contactNoContract = await insertAudit(runner, tenantId, 'contract_contacts', randomUUID(), 'create', null, { contact_id: contact });
  kept.missingIncident = await insertAudit(runner, tenantId, 'tasks', randomUUID(), 'create', null, { related_object_type: 'incident', related_object_id: randomUUID() });
  // The other tenant's contract: never a parent here.
  if (foreignContract) {
    kept.foreignContract = await insertAudit(runner, tenantId, 'tasks', randomUUID(), 'create', null, { related_object_type: 'contract', related_object_id: foreignContract });
  }
  kept.projectTask = await insertAudit(runner, tenantId, 'tasks', randomUUID(), 'create', null, { related_object_type: 'project', related_object_id: contractId });
  kept.standaloneTask = await insertAudit(runner, tenantId, 'tasks', randomUUID(), 'update', { title: 'A' }, { title: 'B', related_object_type: null, related_object_id: null });
  kept.linkSet = await insertAudit(runner, tenantId, 'application_contracts', contractId, 'update', { ids: [] }, { ids: [randomUUID()] });
  kept.incidentLinks = await insertAudit(runner, tenantId, 'incident_assets', incidentId, 'update', [], [randomUUID()]);
  // Already parented: the migration must not choose another parent, and down() must keep it.
  kept.alreadyParented = await insertAudit(runner, tenantId, 'tasks', randomUUID(), 'update', null, { related_object_type: 'contract', related_object_id: contractId });
  await runner.query(`UPDATE audit_log SET parent_table = 'spend_items', parent_id = $2 WHERE id = $1`, [kept.alreadyParented, randomUUID()]);
  return { contractId, incidentId, filled, kept };
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
  for (const [name, [id, table]] of Object.entries(seed.filled)) {
    const row = byId.get(id);
    assert.equal(row.parent_table, table, `${name}: the parent table`);
    assert.equal(row.parent_id, table === 'contracts' ? seed.contractId : seed.incidentId, `${name}: the parent id`);
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
    const seed = await seedRows(runner, tenantId, otherSeed.contractId);
    await clearTenant(runner);

    // Batches of 4 rows: each tenant's 19-20 rows take several statements.
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
    assert.ok(recorded.statements.filter((sql) => /WITH candidates AS/.test(sql)).length >= 2 * 4, 'several batches per tenant');
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');
    assert.ok(firstLog.includes(PREFIX), firstLog);
    for (const label of LABELS) assert.ok(firstLog.includes(`  ${label}:`), `logged: ${label}`);
    assert.match(firstLog, / tasks: \d+ filled, \d+ without a parent/);

    checkSeed(new Map((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row])), seed);
    checkSeed(new Map((await rowsOf(runner, otherTenant)).map((row: any) => [row.id, row])), otherSeed);
    for (const table of ['audit_log', 'contracts', 'incidents', 'tenants']) {
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

    // down() clears the parents of these labels, tenant by tenant, and leaves another parent alone.
    await clearTenant(runner);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down() restores the tenant setting');
    for (const tenant of [tenantId, otherTenant]) {
      const tenantSeed = tenant === tenantId ? seed : otherSeed;
      const afterDown = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      for (const [id] of Object.values(tenantSeed.filled)) assert.equal(afterDown.get(id).parent_id, null, 'down() clears the parent');
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
  console.log('audit-log-parent-contracts-incidents-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
