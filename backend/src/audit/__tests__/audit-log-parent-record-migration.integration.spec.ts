// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLogParentRecord1855500000000 as Migration } from '../../migrations/1855500000000-audit-log-parent-record';

// Migration 1855500000000 (audit rows linked to their budget line), against a real database, in a
// transaction rolled back at the end. It starts from the pre-migration shape (the two columns
// dropped), seeds two tenants with one row per label with its parent and rows without one (an
// invalid payload uuid, a version deleted since, application and technology links written from
// that side, an application link naming the other tenant's line), then:
// - the labels of a line's children get parent_table = 'spend_items' and the line id, tenant by
//   tenant, in batches smaller than the seed (several statements per tenant);
// - the line's own row stays NULL (read by record_id), and so do the rows without a parent;
// - the counts are logged per label, the index exists, RLS stays ENABLE + FORCE on every table
//   and no statement of the migration disables or relaxes it; the tenant setting is restored;
// - a second run rewrites no row and says so;
// - down() drops the index and the columns, and up() after it restores them.
// @database-spec: the data source of the migrated test database.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentRecord:';

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
     VALUES ($1, $2, 'Audit parent migration', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `audit-parent-${tag}-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

async function seedLineAndVersion(runner: QueryRunner, tenantId: string): Promise<{ lineId: string; versionId: string }> {
  const lineId = randomUUID();
  const versionId = randomUUID();
  await runner.query(
    `INSERT INTO spend_items (id, tenant_id, product_name, currency, effective_start, item_number)
     VALUES ($1, $2, 'Migration line', 'EUR', '2026-01-01', 1)`,
    [lineId, tenantId],
  );
  await runner.query(
    `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year)
     VALUES ($1, $2, $3, 'Y2026', 'monthly', '2026-01-01', 2026)`,
    [versionId, tenantId, lineId],
  );
  return { lineId, versionId };
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

async function columns(runner: QueryRunner) {
  return runner.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'audit_log' AND column_name IN ('parent_table', 'parent_id')
      ORDER BY column_name`,
  );
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

async function indexDefinition(runner: QueryRunner) {
  const [row] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_audit_log_tenant_parent_created'`);
  return row?.indexdef ?? null;
}

async function rowsOf(runner: QueryRunner, tenantId: string) {
  await setTenant(runner, tenantId);
  return runner.query(
    `SELECT id, table_name, record_id, parent_table, parent_id, ctid::text AS ctid FROM audit_log WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
}

type Seed = {
  lineId: string;
  versionId: string;
  filled: Record<string, string>;
  nullRows: Record<string, string>;
};

async function seedRows(runner: QueryRunner, tenantId: string, otherTenantLine?: string): Promise<Seed> {
  const { lineId, versionId } = await seedLineAndVersion(runner, tenantId);
  const goneVersion = randomUUID();
  const filled: Record<string, string> = {};
  const nullRows: Record<string, string> = {};

  filled.linkAfter = await insertAudit(runner, tenantId, 'spend_links', randomUUID(), 'create', null, { spend_item_id: lineId });
  filled.linkBefore = await insertAudit(runner, tenantId, 'spend_links', randomUUID(), 'delete', { spend_item_id: lineId }, null);
  filled.capexLink = await insertAudit(runner, tenantId, 'capex_links', randomUUID(), 'create', null, { capex_item_id: lineId });
  filled.attachment = await insertAudit(runner, tenantId, 'spend_attachments', randomUUID(), 'create', null, { spend_item_id: lineId });
  filled.capexAttachment = await insertAudit(runner, tenantId, 'capex_attachments', randomUUID(), 'delete', { capex_item_id: lineId }, null);
  filled.contactPayload = await insertAudit(runner, tenantId, 'spend_item_contacts', randomUUID(), 'create', null, { spend_item_id: lineId });
  filled.contactSync = await insertAudit(runner, tenantId, 'spend_item_contacts', lineId, 'update', ['c:commercial'], ['c:technical']);
  filled.capexContact = await insertAudit(runner, tenantId, 'capex_item_contacts', randomUUID(), 'create', null, { capex_item_id: lineId });
  filled.task = await insertAudit(runner, tenantId, 'spend_tasks', randomUUID(), 'create', null, { related_object_id: lineId });
  filled.application = await insertAudit(runner, tenantId, 'application_spend_items', lineId, 'update', [], [lineId]);
  filled.capexApplication = await insertAudit(runner, tenantId, 'application_capex_items', lineId, 'update', [], [lineId]);
  filled.technology = await insertAudit(runner, tenantId, 'technology_spend_items', lineId, 'update', [], [lineId]);
  filled.version = await insertAudit(runner, tenantId, 'spend_versions', versionId, 'update', {}, {});
  filled.capexVersion = await insertAudit(runner, tenantId, 'capex_versions', versionId, 'update', {}, {});
  filled.amount = await insertAudit(runner, tenantId, 'spend_amounts', versionId, 'update', [], []);
  filled.capexAmount = await insertAudit(runner, tenantId, 'capex_amounts', versionId, 'update', [], []);
  filled.allocation = await insertAudit(runner, tenantId, 'spend_allocations', versionId, 'update', [], []);
  filled.capexAllocation = await insertAudit(runner, tenantId, 'capex_allocations', versionId, 'update', [], []);
  filled.roundAfter = await insertAudit(runner, tenantId, 'spend_round_inputs', randomUUID(), 'create', null, { version_id: versionId });
  filled.roundBefore = await insertAudit(runner, tenantId, 'capex_round_inputs', randomUUID(), 'delete', { version_id: versionId }, null);

  // The line itself, an invalid payload id, and a version deleted since: no parent.
  nullRows.line = await insertAudit(runner, tenantId, 'spend_items', lineId, 'create', null, { product_name: 'Migration line' });
  nullRows.invalid = await insertAudit(runner, tenantId, 'spend_links', randomUUID(), 'create', null, { spend_item_id: 'not-a-uuid' });
  nullRows.goneVersion = await insertAudit(runner, tenantId, 'spend_amounts', goneVersion, 'update', [], []);
  // Links written from the application or the technology: record_id is that object, the payload
  // lists line ids. No parent, and never the object.
  nullRows.appSide = await insertAudit(runner, tenantId, 'application_spend_items', randomUUID(), 'update', [], [lineId]);
  nullRows.capexAppSide = await insertAudit(runner, tenantId, 'application_capex_items', randomUUID(), 'update', [lineId], []);
  nullRows.techSide = await insertAudit(runner, tenantId, 'technology_spend_items', randomUUID(), 'update', [], [lineId]);
  // A record_id that is a line of another tenant is not a line of this one.
  if (otherTenantLine) {
    nullRows.otherTenantLine = await insertAudit(runner, tenantId, 'application_spend_items', otherTenantLine, 'update', [], []);
  }
  return { lineId, versionId, filled, nullRows };
}

/** Records every statement the migration sends through `runner`. */
function recordStatements(runner: QueryRunner): { statements: string[]; stop: () => void } {
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return (original as any)(sql, ...rest);
  };
  return { statements, stop: () => { (runner as any).query = original; } };
}

async function currentTenantSetting(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS value`);
  return row.value;
}

async function testBackfillRerunAndDown() {
  await inRolledBackTransaction(async (runner) => {
    // Start from the pre-migration shape, on a database that ran the migration at boot.
    await runner.query(`DROP INDEX IF EXISTS idx_audit_log_tenant_parent_created`);
    await runner.query(`ALTER TABLE audit_log DROP COLUMN IF EXISTS parent_id`);
    await runner.query(`ALTER TABLE audit_log DROP COLUMN IF EXISTS parent_table`);
    assert.deepEqual(await columns(runner), [], 'the pre-migration shape');

    const otherTenant = await seedTenant(runner, 'other');
    const otherSeed = await seedRows(runner, otherTenant);
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId, otherSeed.lineId);
    await clearTenant(runner);

    // Batches of 4 rows: the 25-odd candidates of each tenant take several statements.
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
    assert.ok(batches >= 2 * 6, `several batches per tenant (${batches})`);
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');
    assert.deepEqual(
      await columns(runner),
      [
        { column_name: 'parent_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
        { column_name: 'parent_table', data_type: 'text', is_nullable: 'YES', column_default: null },
      ],
      'the two columns are nullable, without a default',
    );
    assert.match(await indexDefinition(runner), /\(tenant_id, parent_table, parent_id, created_at DESC\) WHERE \(parent_id IS NOT NULL\)/);
    for (const table of ['audit_log', 'spend_versions', 'spend_items', 'tenants']) {
      const expected = table === 'tenants' ? { enabled: false, forced: false } : { enabled: true, forced: true };
      assert.deepEqual(await rowSecurity(runner, table), expected, `${table}: RLS as found`);
    }

    const afterFirst = await rowsOf(runner, tenantId);
    for (const [tenant, tenantSeed] of [[tenantId, seed], [otherTenant, otherSeed]] as const) {
      const byId = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      for (const [name, id] of Object.entries(tenantSeed.filled)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, 'spend_items', `${name}: the physical line table`);
        assert.equal(row.parent_id, tenantSeed.lineId, `${name}: the line id`);
      }
      for (const [name, id] of Object.entries(tenantSeed.nullRows)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, null, `${name}: no parent table`);
        assert.equal(row.parent_id, null, `${name}: no parent id`);
      }
    }

    assert.ok(firstLog.includes(`${PREFIX} 40 audit row(s) given a parent, 11 left without one`), firstLog);
    for (const expected of [
      'spend_links: 4 filled, 2 without a parent',
      'capex_links: 2 filled, 0 without a parent',
      'spend_attachments: 2 filled, 0 without a parent',
      'capex_attachments: 2 filled, 0 without a parent',
      'spend_item_contacts: 4 filled, 0 without a parent',
      'capex_item_contacts: 2 filled, 0 without a parent',
      'spend_tasks: 2 filled, 0 without a parent',
      'application_spend_items: 2 filled, 3 without a parent',
      'application_capex_items: 2 filled, 2 without a parent',
      'technology_spend_items: 2 filled, 2 without a parent',
      'spend_versions: 2 filled, 0 without a parent',
      'capex_versions: 2 filled, 0 without a parent',
      'spend_amounts: 2 filled, 2 without a parent',
      'capex_amounts: 2 filled, 0 without a parent',
      'spend_allocations: 2 filled, 0 without a parent',
      'capex_allocations: 2 filled, 0 without a parent',
      'spend_round_inputs: 2 filled, 0 without a parent',
      'capex_round_inputs: 2 filled, 0 without a parent',
      'spend_items: 2 line row(s), parent NULL by design (read by record_id)',
    ]) {
      assert.ok(firstLog.includes(expected), `logged: ${expected}`);
    }

    // A second run touches no row and says so.
    const second = await captureLog(() => migration.up(runner));
    const secondLog = second.lines.join('\n');
    assert.ok(secondLog.includes(`${PREFIX} no audit row to fill, nothing changed`), secondLog);
    const afterSecond = await rowsOf(runner, tenantId);
    assert.deepEqual(
      afterSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      afterFirst.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      'the second run rewrites no row',
    );

    // down() drops the index and both columns; up() restores and fills them.
    await migration.down(runner);
    assert.equal(await indexDefinition(runner), null, 'down() drops the index');
    assert.deepEqual(await columns(runner), [], 'down() drops the columns');

    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    const afterDownUp = await rowsOf(runner, tenantId);
    const byIdAgain = new Map<string, any>(afterDownUp.map((row: any) => [row.id, row]));
    for (const [name, id] of Object.entries(seed.filled)) {
      assert.equal(byIdAgain.get(id).parent_id, seed.lineId, `${name}: filled again after down/up`);
    }
    assert.equal(byIdAgain.get(seed.nullRows.goneVersion).parent_id, null, 'the deleted version still has no parent');
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testBackfillRerunAndDown();
  } finally {
    await dataSource.destroy();
  }
  console.log('audit-log-parent-record-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
