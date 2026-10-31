// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { backendPath } from '../../common/__tests__/backend-root';
import { resolveAuditParent } from '../audit-parent-rules';
import { interfaceMappingDetailParentRules } from '../record-history/records/interfaces';
import { AuditLogParentInterfaceMappings1855960000000 as Migration } from '../../migrations/1855960000000-audit-log-parent-interface-mappings';

// Migration 1855960000000 (mapping group and mapping rule audit rows linked to their interface):
// the SQL label list is compared with the TS rules, then the migration runs against a real database
// in a transaction rolled back at the end. It seeds two tenants with one row per label that has a
// parent and rows without one (an invalid uuid, a missing interface, another tenant's interface),
// then checks the fill, the counts, RLS, the restored tenant setting, the re-run and down/up.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentInterfaceMappings:';

function migrationText(): string {
  return fs.readFileSync(
    backendPath('src', 'migrations', '1855960000000-audit-log-parent-interface-mappings.ts'),
    'utf8',
  );
}

/** The quoted labels of the migration's `LABELS` list, unique and sorted. */
function migrationLabels(): string[] {
  const block = /const LABELS = \[([\s\S]*?)\] as const;/.exec(migrationText())?.[1];
  assert.ok(block, 'the migration declares its labels in one list');
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

async function testRulesMatchMigration() {
  assert.deepEqual(
    migrationLabels(),
    Object.keys(interfaceMappingDetailParentRules).sort(),
    'the migration and the write rules cover the same labels',
  );
  const manager = { query: async () => { throw new Error('a payload rule reads nothing'); } } as any;
  const interfaceId = randomUUID();
  for (const label of Object.keys(interfaceMappingDetailParentRules)) {
    const rule = interfaceMappingDetailParentRules[label];
    assert.equal(rule.from, 'payload', `${label}: a payload rule`);
    assert.equal(rule.parentTable, 'interfaces', `${label}: the interface`);
    assert.deepEqual(
      await resolveAuditParent(manager, { table: label, recordId: randomUUID(), after: { interface_id: interfaceId }, before: null }),
      { table: 'interfaces', id: interfaceId },
      `${label}: the interface parent`,
    );
    assert.deepEqual(
      await resolveAuditParent(manager, { table: label, recordId: randomUUID(), after: null, before: { interface_id: interfaceId } }),
      { table: 'interfaces', id: interfaceId },
      `${label}: a deletion keeps its interface`,
    );
  }
  console.log('  migration labels equal the TS rules, each rule reads interface_id: OK');
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
     VALUES ($1, $2, 'Interface mapping parent migration', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `if-map-parent-${tag}-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

async function seedInterface(runner: QueryRunner, tenantId: string): Promise<string> {
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
  return interfaceRow.id;
}

async function insertAudit(
  runner: QueryRunner,
  tenantId: string,
  table: string,
  recordId: string,
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
  interfaceId: string;
  filled: { group: string; rule: string };
  nullRows: { invalid: string; missing: string; otherTenant: string };
};

async function seedRows(runner: QueryRunner, tenantId: string, otherInterfaceId: string): Promise<Seed> {
  const interfaceId = await seedInterface(runner, tenantId);
  const filled = {
    group: await insertAudit(runner, tenantId, 'interface_mapping_groups', randomUUID(), 'update', { title: 'Header' }, { title: 'Header 2', interface_id: interfaceId }),
    rule: await insertAudit(runner, tenantId, 'interface_mapping_rules', randomUUID(), 'delete', { title: 'Customer id', interface_id: interfaceId }, null),
  };
  const nullRows = {
    invalid: await insertAudit(runner, tenantId, 'interface_mapping_groups', randomUUID(), 'create', null, { interface_id: 'not-a-uuid', title: 'Bad' }),
    missing: await insertAudit(runner, tenantId, 'interface_mapping_rules', randomUUID(), 'create', null, { interface_id: randomUUID(), title: 'Gone' }),
    otherTenant: await insertAudit(runner, tenantId, 'interface_mapping_rules', randomUUID(), 'update', {}, { interface_id: otherInterfaceId, title: 'Foreign' }),
  };
  return { interfaceId, filled, nullRows };
}

async function rowsOf(runner: QueryRunner, tenantId: string) {
  await setTenant(runner, tenantId);
  return runner.query(
    `SELECT id, table_name, parent_table, parent_id, ctid::text AS ctid
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
    const otherSeed = await seedRows(runner, otherTenant, randomUUID());
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId, otherSeed.interfaceId);
    await clearTenant(runner);

    migration.batchSize = 2;
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
    assert.ok(batches >= 4, `several batches per tenant (${batches})`);
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');

    for (const [tenant, tenantSeed] of [[tenantId, seed], [otherTenant, otherSeed]] as const) {
      const byId = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      assert.equal(byId.get(tenantSeed.filled.group).parent_table, 'interfaces', 'group: the parent table');
      assert.equal(byId.get(tenantSeed.filled.group).parent_id, tenantSeed.interfaceId, 'group: the interface');
      assert.equal(byId.get(tenantSeed.filled.rule).parent_table, 'interfaces', 'rule: the parent table');
      assert.equal(byId.get(tenantSeed.filled.rule).parent_id, tenantSeed.interfaceId, 'rule: the interface from before');
      for (const [name, id] of Object.entries(tenantSeed.nullRows)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, null, `${name}: no parent table`);
        assert.equal(row.parent_id, null, `${name}: no parent id`);
      }
    }
    assert.ok(firstLog.includes(`${PREFIX} 4 audit row(s) given a parent, 6 left without one`), firstLog);
    assert.ok(firstLog.includes('interface_mapping_groups: 2 filled, 2 without a parent'), firstLog);
    assert.ok(firstLog.includes('interface_mapping_rules: 2 filled, 4 without a parent'), firstLog);

    for (const table of ['audit_log', 'interfaces']) {
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

    await clearTenant(runner);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down() restores the tenant setting');
    const afterDown = await rowsOf(runner, tenantId);
    assert.equal(afterDown.find((row: any) => row.id === seed.filled.group).parent_id, null, 'down() clears the group parent');
    assert.equal(afterDown.find((row: any) => row.id === seed.filled.rule).parent_id, null, 'down() clears the rule parent');
    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    const afterDownUp = await rowsOf(runner, tenantId);
    const byIdAgain = new Map<string, any>(afterDownUp.map((row: any) => [row.id, row]));
    assert.equal(byIdAgain.get(seed.filled.rule).parent_id, seed.interfaceId, 'up() fills again after down()');
    assert.equal(byIdAgain.get(seed.nullRows.invalid).parent_id, null, 'an invalid payload stays without a parent');
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
  console.log('record-history-interface-mappings-migration.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
