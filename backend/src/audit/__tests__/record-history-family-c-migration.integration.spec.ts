// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES, resolveAuditParent } from '../audit-parent-rules';
import { connectionsParentRules } from '../record-history/records/connections';
import { interfacesParentRules } from '../record-history/records/interfaces';
import { locationsParentRules } from '../record-history/records/locations';
import { AuditLogParentRecordFamilyC1855720000000 as Migration } from '../../migrations/1855720000000-audit-log-parent-record-family-c';

// Migration 1855720000000 (audit rows of family C linked to their site, connection or interface):
// the SQL label list is compared with the TS rules, then the migration runs against a real database
// in a transaction rolled back at the end. It seeds two tenants with one row per label with its
// parent and rows without one (an invalid payload uuid, a key of another family, an interface set
// written with the interface in record_id), then checks the fill, the counts, RLS, the restored
// tenant setting, the re-run and down/up.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentRecordFamilyC:';

const RULES: Readonly<Record<string, unknown>> = {
  ...locationsParentRules,
  ...connectionsParentRules,
  ...interfacesParentRules,
};

function migrationText(): string {
  return fs.readFileSync(
    backendPath('src', 'migrations', '1855720000000-audit-log-parent-record-family-c.ts'),
    'utf8',
  );
}

/** The quoted labels of the migration's `LABELS` block, unique and sorted. */
function migrationLabels(): string[] {
  const block = /const LABELS = \{([\s\S]*?)\n\} as const;/.exec(migrationText())?.[1];
  assert.ok(block, 'the migration declares its labels in one block');
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

async function testRulesMatchMigration() {
  assert.deepEqual(migrationLabels(), Object.keys(RULES).sort(), 'the migration and the write rules cover the same labels');
  for (const [label, rule] of Object.entries(RULES)) {
    assert.equal((rule as any).from, 'payload', `${label}: a payload rule`);
    assert.equal((rule as any).parentTable, label.startsWith('location') ? 'locations'
      : label.startsWith('connection') ? 'connections' : 'interfaces', `${label}: the physical parent table`);
  }
  for (const label of ['interface_legs', 'interface_owners', 'interface_companies', 'interface_dependencies',
    'interface_key_identifiers', 'interface_data_residency', 'locations', 'connections', 'interfaces']) {
    assert.equal(AUDIT_PARENT_RULES[label], undefined, `${label}: no rule, read by record_id`);
  }

  const manager = { query: async () => { throw new Error('a payload rule reads nothing'); } } as any;
  const location = randomUUID();
  const connection = randomUUID();
  const interfaceId = randomUUID();
  for (const label of Object.keys(locationsParentRules)) {
    assert.deepEqual(
      await resolveAuditParent(manager, { table: label, recordId: randomUUID(), after: { location_id: location }, before: null }),
      { table: 'locations', id: location },
      `${label}: the site parent`,
    );
  }
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'connection_legs', recordId: randomUUID(), after: null, before: { connection_id: connection } }),
    { table: 'connections', id: connection },
    'a deleted segment keeps its connection',
  );
  for (const label of Object.keys(interfacesParentRules)) {
    assert.deepEqual(
      await resolveAuditParent(manager, { table: label, recordId: randomUUID(), after: { interface_id: interfaceId }, before: null }),
      { table: 'interfaces', id: interfaceId },
      `${label}: the interface parent`,
    );
  }
  console.log('  migration labels equal the TS rules, each rule reads its own key: OK');
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
     VALUES ($1, $2, 'Family C parent migration', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `family-c-parent-${tag}-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

async function seedParents(runner: QueryRunner, tenantId: string): Promise<{ location: string; connection: string; interfaceId: string }> {
  const [location]: Array<{ id: string }> = await runner.query(
    `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Paris DC', 'cloud', 'LOC-1') RETURNING id`,
    [tenantId],
  );
  const [connection]: Array<{ id: string }> = await runner.query(
    `INSERT INTO connections (tenant_id, name, topology, connection_reference) VALUES ($1, 'Core link', 'server_to_server', 'CONN-1') RETURNING id`,
    [tenantId],
  );
  const [application]: Array<{ id: string }> = await runner.query(
    `INSERT INTO applications (tenant_id, name, sequential_id) VALUES ($1, 'Ledger', 'APP-1') RETURNING id`,
    [tenantId],
  );
  const [interfaceRow]: Array<{ id: string }> = await runner.query(
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id,
                             data_category, integration_route_type, interface_reference)
     VALUES ($1, 'Orders sync', 'Orders', $2, $2, 'operational', 'direct', 'INT-1') RETURNING id`,
    [tenantId, application.id],
  );
  return { location: location.id, connection: connection.id, interfaceId: interfaceRow.id };
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

type Seed = {
  location: string;
  connection: string;
  interfaceId: string;
  filled: Record<string, string>;
  nullRows: Record<string, string>;
};

async function seedRows(runner: QueryRunner, tenantId: string, other: { location: string; connection: string; interfaceId: string }): Promise<Seed> {
  const parents = await seedParents(runner, tenantId);
  const filled: Record<string, string> = {};
  const nullRows: Record<string, string> = {};

  filled.userContact = await insertAudit(runner, tenantId, 'location_user_contacts', randomUUID(), 'create', null, { location_id: parents.location });
  filled.contact = await insertAudit(runner, tenantId, 'location_contacts', randomUUID(), 'delete', { location_id: parents.location }, null);
  filled.link = await insertAudit(runner, tenantId, 'location_links', randomUUID(), 'create', null, { location_id: parents.location });
  filled.subItem = await insertAudit(runner, tenantId, 'location_sub_items', randomUUID(), 'create', null, { location_id: parents.location });
  filled.leg = await insertAudit(runner, tenantId, 'connection_legs', randomUUID(), 'create', null, { connection_id: parents.connection });
  filled.binding = await insertAudit(runner, tenantId, 'interface_bindings', randomUUID(), 'create', null, { interface_id: parents.interfaceId });
  filled.interfaceLink = await insertAudit(runner, tenantId, 'interface_links', randomUUID(), 'delete', { interface_id: parents.interfaceId }, null);
  filled.mappingSet = await insertAudit(runner, tenantId, 'interface_mapping_sets', randomUUID(), 'update', {}, { interface_id: parents.interfaceId });
  filled.attachment = await insertAudit(runner, tenantId, 'interface_attachments', randomUUID(), 'create', null, { interface_id: parents.interfaceId });

  // The sets name the interface in record_id: no parent, and no payload key to backfill.
  nullRows.interfaceSet = await insertAudit(runner, tenantId, 'interface_legs', parents.interfaceId, 'update', [], []);
  // A payload key that is not a uuid, or names another family's record, gives no parent.
  nullRows.invalid = await insertAudit(runner, tenantId, 'location_links', randomUUID(), 'create', null, { location_id: 'not-a-uuid' });
  nullRows.otherFamily = await insertAudit(runner, tenantId, 'connection_legs', randomUUID(), 'create', null, { location_id: parents.location });
  nullRows.otherTenant = await insertAudit(runner, tenantId, 'location_links', randomUUID(), 'create', null, { location_id: other.location });
  nullRows.otherTenantConnection = await insertAudit(runner, tenantId, 'connection_legs', randomUUID(), 'create', null, { connection_id: other.connection });
  nullRows.otherTenantInterface = await insertAudit(runner, tenantId, 'interface_bindings', randomUUID(), 'create', null, { interface_id: other.interfaceId });
  // The record's own row, with a child label's key: the label is not one of ours.
  nullRows.record = await insertAudit(runner, tenantId, 'locations', parents.location, 'update', {}, { location_id: parents.location });
  return { ...parents, filled, nullRows };
}

async function rowsOf(runner: QueryRunner, tenantId: string) {
  await setTenant(runner, tenantId);
  return runner.query(
    `SELECT id, table_name, record_id, parent_table, parent_id, ctid::text AS ctid
       FROM audit_log WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
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

async function currentTenantSetting(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS value`);
  return row.value;
}

async function testBackfillRerunAndDown() {
  await inRolledBackTransaction(async (runner) => {
    const otherTenant = await seedTenant(runner, 'other');
    const otherSeed = await seedRows(runner, otherTenant, { location: randomUUID(), connection: randomUUID(), interfaceId: randomUUID() });
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId, otherSeed);
    await clearTenant(runner);

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
    const batches = recorded.statements.filter((sql) => /WITH candidates AS/.test(sql)).length;
    assert.ok(batches >= 2 * 4, `several batches per tenant (${batches})`);
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');

    for (const [tenant, tenantSeed] of [[tenantId, seed], [otherTenant, otherSeed]] as const) {
      const byId = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      for (const [name, id] of Object.entries(tenantSeed.filled)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, name === 'leg' ? 'connections'
          : name === 'subItem' || name === 'contact' || name === 'link' || name === 'userContact' ? 'locations' : 'interfaces', `${name}: the parent table`);
        assert.equal(row.parent_id, name === 'leg' ? tenantSeed.connection
          : name === 'subItem' || name === 'contact' || name === 'link' || name === 'userContact' ? tenantSeed.location : tenantSeed.interfaceId, `${name}: the parent id`);
      }
      // The two cross-tenant rows are filled with the *same* tenant's parent: the payload is read
      // as a value, never as a row of another tenant, and the history query still filters by tenant.
      for (const [name, id] of Object.entries(tenantSeed.nullRows)) {
        if (name === 'otherTenant' || name === 'otherTenantConnection' || name === 'otherTenantInterface') continue;
        const row = byId.get(id);
        assert.equal(row.parent_table, null, `${name}: no parent table`);
        assert.equal(row.parent_id, null, `${name}: no parent id`);
      }
    }
    assert.ok(firstLog.includes(`${PREFIX} 24 audit row(s) given a parent, 4 left without one`), firstLog);
    for (const expected of [
      'location_user_contacts: 2 filled, 0 without a parent',
      'location_contacts: 2 filled, 0 without a parent',
      'location_links: 4 filled, 2 without a parent',
      'location_sub_items: 2 filled, 0 without a parent',
      'connection_legs: 4 filled, 2 without a parent',
      'interface_links: 2 filled, 0 without a parent',
      'interface_bindings: 4 filled, 0 without a parent',
      'interface_mapping_sets: 2 filled, 0 without a parent',
      'interface_attachments: 2 filled, 0 without a parent',
    ]) {
      assert.ok(firstLog.includes(expected), `logged: ${expected}`);
    }

    for (const table of ['audit_log', 'locations', 'connections', 'interfaces']) {
      assert.deepEqual(await rowSecurity(runner, table), { enabled: true, forced: true }, `${table}: RLS as found`);
    }

    const afterFirst = await rowsOf(runner, tenantId);
    const second = await captureLog(() => migration.up(runner));
    assert.ok(second.lines.join('\n').includes(`${PREFIX} no audit row to fill, nothing changed`), second.lines.join('\n'));
    const afterSecond = await rowsOf(runner, tenantId);
    assert.deepEqual(
      afterSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      afterFirst.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      'the second run rewrites no row',
    );

    await migration.down(runner);
    const afterDown = await rowsOf(runner, tenantId);
    for (const [name, id] of Object.entries(seed.filled)) {
      const row = afterDown.find((candidate: any) => candidate.id === id);
      assert.equal(row.parent_id, null, `${name}: down() clears the parent`);
    }
    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    const afterDownUp = await rowsOf(runner, tenantId);
    const byIdAgain = new Map<string, any>(afterDownUp.map((row: any) => [row.id, row]));
    assert.equal(byIdAgain.get(seed.filled.binding).parent_id, seed.interfaceId, 'up() fills again after down()');
    assert.equal(byIdAgain.get(seed.nullRows.interfaceSet).parent_id, null, 'the interface set stays without a parent');
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testRulesMatchMigration();
    await testBackfillRerunAndDown();
  } finally {
    await dataSource.destroy();
  }
  console.log('record-history-family-c-migration.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
