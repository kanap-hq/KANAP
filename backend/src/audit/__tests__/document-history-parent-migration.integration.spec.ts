// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES } from '../audit-parent-rules';
import { DocumentHistoryParent1855740000000 as Migration } from '../../migrations/1855740000000-document-history-parent';

// Migration 1855740000000 (audit rows linked to their Knowledge document), against a real
// database, in a transaction rolled back at the end. It seeds two tenants with attachment rows
// whose payload names their document (after, before, an explicit parent to leave untouched, an
// invalid uuid and a missing key), then:
// - the label of a document's child gets parent_table = 'documents' and its document id, tenant by
//   tenant, in batches smaller than the seed (several statements per tenant);
// - the document's own audit rows stay NULL (read by record_id), and so do the rows without a
//   usable payload or already parented;
// - counts are logged per label, RLS stays ENABLE + FORCE on every table and no statement relaxes
//   it, the tenant setting is restored;
// - a second run rewrites no row and says so;
// - down() clears the attachment parents and up() fills them again;
// - the migration's label list is the one of the TypeScript rule.
// @database-spec: the data source of the migrated test database.

const migration = new Migration();
const PREFIX = '[Migration] DocumentHistoryParent:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
     VALUES ($1, $2, 'Document history parent migration', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `doc-history-parent-${tag}-${tenantId.slice(0, 8)}`],
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
  parent?: { table: string; id: string },
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source, parent_table, parent_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'user', $7, $8) RETURNING id`,
    [tenantId, table, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
      parent?.table ?? null, parent?.id ?? null],
  );
  return row.id;
}

/** The attachment rows the migration can fill, across every tenant already in the database. */
async function fillableBaseline(runner: QueryRunner): Promise<number> {
  const tenants: Array<{ id: string }> = await runner.query(`SELECT id FROM tenants`);
  let total = 0;
  for (const tenant of tenants) {
    await setTenant(runner, tenant.id);
    const [row] = await runner.query(
      `SELECT count(*)::int AS n
         FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'document_attachments' AND parent_id IS NULL
          AND (COALESCE(after_json->>'document_id', before_json->>'document_id')) ~ $2`,
      [tenant.id, UUID.source],
    );
    total += Number(row.n);
  }
  return total;
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
    `SELECT id, table_name, record_id, parent_table, parent_id, ctid::text AS ctid
       FROM audit_log WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
}

type Seed = {
  documentId: string;
  filled: Record<string, { id: string; parentId: string }>;
  nullRows: Record<string, string>;
  explicit: { id: string; parentId: string; ctid: string };
};

async function seedRows(runner: QueryRunner, tenantId: string): Promise<Seed> {
  // The documents exist: the backfill only sets a parent that is in the same tenant.
  const [library] = await runner.query(
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Spec library', $2) RETURNING id`,
    [tenantId, `spec-${randomUUID().slice(0, 8)}`],
  );
  const [document] = await runner.query(
    `INSERT INTO documents (tenant_id, item_number, title, library_id) VALUES ($1, 1, 'Doc', $2) RETURNING id`,
    [tenantId, library.id],
  );
  const [otherDocument] = await runner.query(
    `INSERT INTO documents (tenant_id, item_number, title, library_id) VALUES ($1, 2, 'Other doc', $2) RETURNING id`,
    [tenantId, library.id],
  );
  const documentId = document.id as string;
  const otherDocumentId = otherDocument.id as string;
  const filled: Record<string, { id: string; parentId: string }> = {};
  const nullRows: Record<string, string> = {};

  filled.after = {
    id: await insertAudit(runner, tenantId, 'document_attachments', randomUUID(), 'create', null, { document_id: documentId }),
    parentId: documentId,
  };
  filled.before = {
    id: await insertAudit(runner, tenantId, 'document_attachments', randomUUID(), 'delete', { document_id: otherDocumentId }, null),
    parentId: otherDocumentId,
  };
  nullRows.invalid = await insertAudit(runner, tenantId, 'document_attachments', randomUUID(), 'create', null, { document_id: 'not-a-uuid' });
  nullRows.missing = await insertAudit(runner, tenantId, 'document_attachments', randomUUID(), 'create', null, { original_filename: 'x.pdf' });
  // A well-formed id absent from the documents table: no parent.
  nullRows.missingParent = await insertAudit(runner, tenantId, 'document_attachments', randomUUID(), 'create', null, { document_id: randomUUID() });

  // A row the write rule already parented: the migration must not rewrite it.
  const explicitId = await insertAudit(
    runner,
    tenantId,
    'document_attachments',
    randomUUID(),
    'update',
    { document_id: otherDocumentId },
    { document_id: documentId },
    { table: 'documents', id: documentId },
  );
  const [explicit] = await runner.query(`SELECT ctid::text AS ctid FROM audit_log WHERE id = $1`, [explicitId]);

  // The document's own rows: read by record_id, never a parent.
  nullRows.documentCreate = await insertAudit(runner, tenantId, 'documents', documentId, 'create', null, { title: 'Doc' });
  nullRows.documentUpdate = await insertAudit(runner, tenantId, 'documents', documentId, 'update', { title: 'Doc' }, { title: 'Doc 2' });

  return { documentId, filled, nullRows, explicit: { id: explicitId, parentId: documentId, ctid: explicit.ctid } };
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

function migrationLabels(): string[] {
  const text = fs.readFileSync(backendPath('src', 'migrations', '1855740000000-document-history-parent.ts'), 'utf8');
  const block = /const LABELS = \[([^\]]*)\]/.exec(text)?.[1];
  assert.ok(block, 'the migration declares its labels');
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

function testLabelsMatchRules() {
  const ruleLabels = Object.entries(AUDIT_PARENT_RULES)
    .filter(([, rule]) => rule.parentTable === 'documents')
    .map(([label]) => label)
    .sort();
  assert.deepEqual(migrationLabels(), ruleLabels, 'the migration and the document write rules cover the same labels');
  const rule = AUDIT_PARENT_RULES.document_attachments;
  assert.equal(rule.from, 'payload');
  assert.deepEqual(rule.from === 'payload' ? rule.keys : [], ['document_id']);
  const text = fs.readFileSync(backendPath('src', 'migrations', '1855740000000-document-history-parent.ts'), 'utf8');
  assert.match(text, /SET parent_table = 'documents'/, 'the migration writes the document table');
}

async function testBackfillRerunAndDown() {
  await inRolledBackTransaction(async (runner) => {
    // Start from the pre-migration data: the columns exist (185550) and no document parent is set.
    await clearTenant(runner);
    const baseline = await fillableBaseline(runner);

    const otherTenant = await seedTenant(runner, 'other');
    const otherSeed = await seedRows(runner, otherTenant);
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId);
    await clearTenant(runner);

    // Batches of 2 rows: the six attachment rows of each tenant take several statements.
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
    assert.ok(batches >= 2 * 3, `several batches per tenant (${batches})`);
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');
    for (const table of ['audit_log', 'document_attachments', 'documents', 'tenants']) {
      const expected = table === 'tenants' ? { enabled: false, forced: false } : { enabled: true, forced: true };
      assert.deepEqual(await rowSecurity(runner, table), expected, `${table}: RLS as found`);
    }

    const expectedFilled = baseline + Object.keys(seed.filled).length + Object.keys(otherSeed.filled).length;
    assert.ok(firstLog.includes(`${PREFIX} ${expectedFilled} audit row(s) given a parent`), firstLog);
    assert.match(firstLog, /document_attachments: \d+ filled, \d+ without a parent/);
    assert.match(firstLog, /documents: 4 document row\(s\), parent NULL by design \(read by record_id\)/);

    for (const [tenant, tenantSeed] of [[tenantId, seed], [otherTenant, otherSeed]] as const) {
      const byId = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      for (const [name, entry] of Object.entries(tenantSeed.filled)) {
        const row = byId.get(entry.id);
        assert.equal(row.parent_table, 'documents', `${name}: the document table`);
        assert.equal(row.parent_id, entry.parentId, `${name}: the document id`);
      }
      for (const [name, id] of Object.entries(tenantSeed.nullRows)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, null, `${name}: no parent table`);
        assert.equal(row.parent_id, null, `${name}: no parent id`);
      }
      if (tenant === tenantId) {
        const explicit = byId.get(seed.explicit.id);
        assert.equal(explicit.parent_id, seed.explicit.parentId, 'an already parented row is not rewritten');
        assert.equal(explicit.ctid, seed.explicit.ctid, 'nor touched at all');
      }
    }

    // A second run touches no row and says so.
    const beforeSecond = await rowsOf(runner, tenantId);
    const second = await captureLog(() => migration.up(runner));
    const secondLog = second.lines.join('\n');
    assert.ok(secondLog.includes(`${PREFIX} no audit row to fill, nothing changed`), secondLog);
    const afterSecond = await rowsOf(runner, tenantId);
    assert.deepEqual(
      afterSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      beforeSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      'the second run rewrites no row',
    );

    // A real revert has no tenant positioned: down() clears the attachment parents per tenant;
    // up() fills them again.
    await clearTenant(runner);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down restores the tenant setting');
    const afterDown = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
    for (const [name, entry] of Object.entries(seed.filled)) {
      assert.equal(afterDown.get(entry.id).parent_id, null, `${name}: down clears the parent`);
    }

    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    const afterUp = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
    for (const [name, entry] of Object.entries(seed.filled)) {
      assert.equal(afterUp.get(entry.id).parent_id, entry.parentId, `${name}: filled again after down/up`);
    }
    assert.equal(afterUp.get(seed.nullRows.invalid).parent_id, null, 'the invalid payload still has no parent');
    assert.equal(afterUp.get(seed.nullRows.documentUpdate).parent_id, null, 'the document own row still has no parent');
  });
}

async function run() {
  await dataSource.initialize();
  try {
    testLabelsMatchRules();
    await testBackfillRerunAndDown();
  } finally {
    await dataSource.destroy();
  }
  console.log('document-history-parent-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
