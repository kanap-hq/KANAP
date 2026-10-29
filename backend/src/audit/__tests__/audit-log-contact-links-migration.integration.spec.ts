// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { backendPath } from '../../common/__tests__/backend-root';
import { AuditLogContactLinks1855710000000 as Migration } from '../../migrations/1855710000000-audit-log-contact-links';
import { suppliersParentRules } from '../record-history/records/suppliers';
import { RECORD_HISTORY, recordHistoryPayloadKeyReads } from '../record-history.inventory';
import { auditPageQuery } from '../record-history/query';

// Migration 1855710000000 (the contact's link labels), against a real database, in a transaction
// rolled back at the end. It checks the migration's SQL copy against the family's declarations, then
// seeds two tenants with `supplier_contacts` rows of every action and a row without a supplier, and
// runs the migration in batches smaller than the seed:
// - each row whose payload names a uuid supplier gets parent_table = 'suppliers' and that id,
//   tenant by tenant, in several statements per tenant;
// - an invalid payload and a row already parented to another record stay as they are;
// - the counts are logged, the `contact_id` index names the contact's four labels, RLS stays
//   ENABLE + FORCE, and the tenant setting is restored;
// - a second run rewrites no row; down() drops the index and clears the parents; up() restores them;
// - the contact's own page query, measured with EXPLAIN on a journal filled with 50 000 rows of
//   other labels, reads the labels' rows through the partial index and never scans the journal.
// @database-spec: the data source of the migrated test database.

const MIGRATION_FILE = '1855710000000-audit-log-contact-links.ts';
const migration = new Migration();
const PREFIX = '[Migration] AuditLogContactLinks:';
const OTHER_ROWS = 50_000;

function source(): string {
  return fs.readFileSync(backendPath('src', 'migrations', MIGRATION_FILE), 'utf8');
}

function constString(name: string): string {
  const match = new RegExp(`const ${name} = '([^']+)'`).exec(source());
  assert.ok(match, `the migration declares ${name}`);
  return match[1];
}

function constArray(name: string): string[] {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(source())?.[1];
  assert.ok(block, `the migration declares ${name}`);
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

/** The index name the migration builds from the payload key and the family table. */
function indexName(): string {
  const match = /const INDEX_NAME = `([^`]+)`/.exec(source());
  assert.ok(match, 'the migration declares INDEX_NAME');
  return match[1].replace('${CONTACT_KEY}', constString('CONTACT_KEY'));
}

/** The migration copies the family's declarations: same label, parent table, keys and index labels. */
function testDeclarations() {
  const labels = Object.keys(suppliersParentRules);
  assert.deepEqual(labels, ['supplier_contacts'], 'the supplier family declares one link label');
  const rule = suppliersParentRules.supplier_contacts;
  assert.equal(rule.from, 'payload');
  if (rule.from === 'payload') {
    assert.equal(rule.parentTable, 'suppliers');
    assert.deepEqual([...rule.keys], ['supplier_id']);
  }

  const read = recordHistoryPayloadKeyReads(RECORD_HISTORY.contacts);
  assert.equal(read.length, 1, 'the contact reads one payload key');
  assert.equal(read[0].key, 'contact_id');
  assert.deepEqual(read[0].labels, ['capex_item_contacts', 'contract_contacts', 'spend_item_contacts', 'supplier_contacts']);

  assert.equal(constString('CONTACT_LINK_LABEL'), labels[0]);
  assert.equal(constString('PARENT_TABLE'), rule.parentTable);
  assert.equal(constString('PARENT_KEY'), 'supplier_id');
  assert.equal(constString('CONTACT_KEY'), read[0].key);
  assert.deepEqual(constArray('CONTACT_LINK_LABELS'), read[0].labels);
  assert.equal(indexName(), `idx_audit_log_${read[0].key}_contacts`);
  console.log('  migration labels, parent rule and payload key match the family declarations: OK');
}

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>): Promise<void> {
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

async function currentTenantSetting(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS value`);
  return row.value;
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Audit contact links', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `audit-contact-${tag}-${tenantId.slice(0, 8)}`],
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
  return row.id as string;
}

type Seed = {
  supplierId: string;
  filled: Record<string, string>;
  nullRows: Record<string, string>;
  existingParent: string;
};

async function seedRows(runner: QueryRunner, tenantId: string): Promise<Seed> {
  const [supplier] = await runner.query(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Acme Supplies') RETURNING id`,
    [tenantId],
  );
  const supplierId = supplier.id as string;
  const filled: Record<string, string> = {};
  const nullRows: Record<string, string> = {};
  filled.create = await insertAudit(runner, tenantId, 'supplier_contacts', randomUUID(), 'create', null, { supplier_id: supplierId, contact_id: randomUUID(), role: 'commercial' });
  filled.update = await insertAudit(runner, tenantId, 'supplier_contacts', randomUUID(), 'update', { supplier_id: supplierId, contact_id: randomUUID() }, { supplier_id: supplierId, contact_id: randomUUID() });
  filled.delete = await insertAudit(runner, tenantId, 'supplier_contacts', randomUUID(), 'delete', { supplier_id: supplierId, contact_id: randomUUID() }, null);
  filled.createAgain = await insertAudit(runner, tenantId, 'supplier_contacts', randomUUID(), 'create', null, { supplier_id: supplierId, contact_id: randomUUID() });
  nullRows.invalid = await insertAudit(runner, tenantId, 'supplier_contacts', randomUUID(), 'create', null, { supplier_id: 'not-a-uuid' });
  nullRows.noSupplier = await insertAudit(runner, tenantId, 'supplier_contacts', randomUUID(), 'create', null, { contact_id: randomUUID() });
  // A well-formed id absent from the suppliers table: no parent.
  nullRows.missingSupplier = await insertAudit(runner, tenantId, 'supplier_contacts', randomUUID(), 'create', null, { supplier_id: randomUUID(), contact_id: randomUUID() });
  // A row of another label with the same key value is not a link of this family.
  nullRows.contact = await insertAudit(runner, tenantId, 'contacts', randomUUID(), 'create', null, { supplier_id: supplierId });
  // A row already parented to another record is never rewritten.
  const [parented] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, parent_table, parent_id, source)
     VALUES ($1, 'supplier_contacts', $2, 'update', jsonb_build_object('supplier_id', $3::text), jsonb_build_object('supplier_id', $3::text), 'contracts', $4, 'user')
     RETURNING id`,
    [tenantId, randomUUID(), supplierId, randomUUID()],
  );
  return { supplierId, filled, nullRows, existingParent: parented.id };
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
  const [row] = await runner.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1`,
    [indexName()],
  );
  return row?.indexdef ?? null;
}

async function rowsOf(runner: QueryRunner, tenantId: string) {
  await setTenant(runner, tenantId);
  return runner.query(
    `SELECT id, table_name, record_id, parent_table, parent_id, ctid::text AS ctid FROM audit_log WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
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

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Relation Name'?: string;
  'Actual Rows'?: number;
  Plans?: PlanNode[];
};

function walkPlan(node: PlanNode, visit: (node: PlanNode) => void): void {
  visit(node);
  for (const child of node.Plans ?? []) walkPlan(child, visit);
}

async function testBackfillRerunAndDown() {
  const index = indexName();
  await inRolledBackTransaction(async (runner) => {
    // Start from the pre-migration state: no index, no parent of this family.
    await runner.query(`DROP INDEX IF EXISTS ${index}`);
    const otherTenant = await seedTenant(runner, 'other');
    const otherSeed = await seedRows(runner, otherTenant);
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId);
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
    assert.ok(batches >= 2 * 4, `several batches per tenant (${batches})`);
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');
    assert.deepEqual(
      await columns(runner),
      [
        { column_name: 'parent_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
        { column_name: 'parent_table', data_type: 'text', is_nullable: 'YES', column_default: null },
      ],
      'the parent columns are as lot 1 left them',
    );
    const indexdef = await indexDefinition(runner);
    assert.ok(indexdef, 'the contact index exists');
    assert.match(indexdef, new RegExp(`tenant_id`));
    assert.match(indexdef, new RegExp(`COALESCE\\(after_json, before_json\\) ->> '${constString('CONTACT_KEY')}'`));
    assert.match(indexdef, new RegExp(`WHERE \\(table_name = ANY \\(ARRAY\\[`));
    for (const label of constArray('CONTACT_LINK_LABELS')) {
      assert.ok(indexdef.includes(`'${label}'`), `the index names ${label}`);
    }
    for (const table of ['audit_log', 'suppliers', 'tenants']) {
      const expected = table === 'tenants' ? { enabled: false, forced: false } : { enabled: true, forced: true };
      assert.deepEqual(await rowSecurity(runner, table), expected, `${table}: RLS as found`);
    }

    for (const [tenant, tenantSeed] of [[tenantId, seed], [otherTenant, otherSeed]] as const) {
      const byId = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      for (const [name, id] of Object.entries(tenantSeed.filled)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, 'suppliers', `${name}: the supplier table`);
        assert.equal(row.parent_id, tenantSeed.supplierId, `${name}: the supplier id`);
      }
      for (const [name, id] of Object.entries(tenantSeed.nullRows)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, null, `${name}: no parent table`);
        assert.equal(row.parent_id, null, `${name}: no parent id`);
      }
      const parented = byId.get(tenantSeed.existingParent);
      assert.equal(parented.parent_table, 'contracts', 'a row already parented keeps its parent');
      assert.notEqual(parented.parent_id, tenantSeed.supplierId, 'a row already parented is not rewritten');
    }

    assert.ok(firstLog.includes(`${PREFIX} 8 audit row(s) given a supplier, 6 left without one`), firstLog);
    assert.ok(firstLog.includes('supplier_contacts: 8 filled, 6 without a parent'), firstLog);
    assert.ok(firstLog.includes(`index ${index}: `), firstLog);
    assert.ok(firstLog.includes('supplier_contacts, contract_contacts, spend_item_contacts, capex_item_contacts'), firstLog);

    // A second run touches no row and says so.
    const afterFirst = await rowsOf(runner, tenantId);
    const second = await captureLog(() => migration.up(runner));
    const secondLog = second.lines.join('\n');
    assert.ok(secondLog.includes(`${PREFIX} no audit row to fill, nothing changed`), secondLog);
    const afterSecond = await rowsOf(runner, tenantId);
    assert.deepEqual(
      afterSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      afterFirst.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      'the second run rewrites no row',
    );

    // A real revert has no tenant positioned; down() drops the index and clears the parents this
    // family filled, tenant by tenant; up() restores both.
    await clearTenant(runner);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down() restores the tenant setting');
    assert.equal(await indexDefinition(runner), null, 'down() drops the index');
    const afterDown = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
    for (const id of Object.values(seed.filled)) assert.equal(afterDown.get(id).parent_id, null, 'down() clears the parent');
    assert.equal(afterDown.get(seed.existingParent).parent_table, 'contracts', 'down() keeps another family parent');

    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    const afterDownUp = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
    for (const [name, id] of Object.entries(seed.filled)) {
      assert.equal(afterDownUp.get(id).parent_id, seed.supplierId, `${name}: filled again after down/up`);
    }
  });
  console.log('  backfill over two tenants in batches, rerun untouched, down and up, RLS and tenant setting: OK');
}

async function testExplain() {
  const tenantId = randomUUID();
  const contactId = randomUUID();
  const key = constString('CONTACT_KEY');
  const labels = constArray('CONTACT_LINK_LABELS');
  await inRolledBackTransaction(async (runner) => {
    await setTenant(runner, tenantId);
    // The application role's FORCE RLS keeps the key as a filter, but the partial index only holds
    // the four labels' rows: the plan below reads them, never the other 50 000 rows of the tenant.
    await runner.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, after_json, source, created_at)
       SELECT $1, 'other_' || (g % 10), gen_random_uuid(), 'create', '{}'::jsonb, 'user', now() - (g || ' seconds')::interval
         FROM generate_series(1, $2::int) g`,
      [tenantId, OTHER_ROWS],
    );
    await runner.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source, created_at)
       SELECT $1, ($3::text[])[1 + (g % 4)], gen_random_uuid(),
              CASE WHEN g % 2 = 0 THEN 'delete' ELSE 'create' END,
              CASE WHEN g % 2 = 0 THEN jsonb_build_object('${key}', $2::text) ELSE NULL END,
              CASE WHEN g % 2 = 0 THEN NULL ELSE jsonb_build_object('${key}', $2::text) END,
              'user', now() - (g || ' seconds')::interval
         FROM generate_series(1, 48) g`,
      [tenantId, contactId, labels],
    );
    await runner.query(`ANALYZE audit_log`);

    const query = auditPageQuery(RECORD_HISTORY.contacts, tenantId, contactId, null, 51);
    const rows: Array<Record<string, unknown>> = await runner.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
      query.params,
    );
    const plan = (rows[0]['QUERY PLAN'] as Array<{ Plan: PlanNode }>)[0].Plan;
    const index = indexName();
    const used: PlanNode[] = [];
    let seqScan = false;
    walkPlan(plan, (node) => {
      if (node['Index Name'] === index) used.push(node);
      if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'audit_log') seqScan = true;
    });
    assert.ok(used.length > 0, `the contact page uses ${index}`);
    assert.equal(seqScan, false, 'the contact page does not scan the tenant journal');
    for (const node of used) {
      assert.ok((node['Actual Rows'] ?? 0) <= 100, 'the index reads the labels rows, not the journal');
      assert.match(String(node['Index Cond'] ?? ''), /tenant_id/);
    }
    console.log(`  EXPLAIN on ${OTHER_ROWS} other labels: the contact page reads its four labels through ${index}: OK`);
  });
}

async function run() {
  await dataSource.initialize();
  try {
    console.log('audit log contact links migration');
    testDeclarations();
    await testBackfillRerunAndDown();
    await testExplain();
    console.log('audit-log-contact-links-migration.integration.spec: ok');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
