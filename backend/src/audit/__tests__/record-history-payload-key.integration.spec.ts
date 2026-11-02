// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import {
  RECORD_HISTORY,
  payloadKeyExpression,
  recordHistoryPayloadKeyReads,
  type RecordHistoryPayloadKeyRead,
  type RecordHistoryRecord,
} from '../record-history.inventory';
import { payloadKeyAuditQuery } from '../record-history/query';

// The payload-key read (lot 2, R1c): a family that reads a child by a key of its payload needs its
// own partial index on `audit_log`. The inventory spec checks `pg_indexes` for every declared key
// (all of them, and a fictional family that proves the check catches a missing index), then the
// EXPLAIN spec fills a table with 50 000 rows of other labels and measures the exact branch query.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const FAMILY = 'test_child_reads';
const LABEL = 'test_child_contacts';
const KEY = 'contact_id';
const INDEX = `idx_audit_log_${KEY}_${FAMILY}`;
const OTHER_ROWS = 50_000;

/**
 * A family no real inventory entry uses: its only child is a contact link read by `contact_id`,
 * the shape a contact's history will declare when its family arrives.
 */
const FICTIONAL: RecordHistoryRecord = {
  table: FAMILY,
  module: 'accounts',
  level: 'reader',
  auditLabels: [],
  family: 'account',
  children: { [LABEL]: 'contact' },
  childReads: { [LABEL]: { payloadKey: KEY } },
  explicitParentLabels: [],
  exclusions: [],
};

const READ: RecordHistoryPayloadKeyRead = recordHistoryPayloadKeyReads(FICTIONAL)[0];

type IndexRow = { indexname: string; indexdef: string };
type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Relation Name'?: string;
  'Actual Rows'?: number;
  Plans?: PlanNode[];
};

/** A family index covers a read when it carries the tenant, the key expression and the label. */
function indexCovers(row: IndexRow, read: RecordHistoryPayloadKeyRead, family: string): boolean {
  if (!row.indexname.startsWith(`idx_audit_log_${read.key}_${family}`)) return false;
  if (!/ ON (?:[a-z_"]+\.)?audit_log USING /.test(row.indexdef)) return false;
  if (!row.indexdef.includes('tenant_id')) return false;
  // `pg_get_indexdef` adds a `::text` cast to the `->>` result; the expression is the same.
  if (!row.indexdef.replace(/::text/g, '').includes(payloadKeyExpression(read.key, ''))) return false;
  const whereAt = row.indexdef.indexOf(' WHERE ');
  if (whereAt < 0) return false;
  const where = row.indexdef.slice(whereAt);
  if (!where.includes('table_name')) return false;
  // The predicate names every label that carries the key.
  return read.labels.every((label) => where.includes(`'${label}'`));
}

/** The payload-key reads with no covering index, as `family.label: key` lines. */
function missingPayloadKeyIndexes(
  entries: readonly RecordHistoryRecord[],
  indexes: readonly IndexRow[],
): string[] {
  const missing: string[] = [];
  for (const entry of entries) {
    for (const read of recordHistoryPayloadKeyReads(entry)) {
      if (!indexes.some((row) => indexCovers(row, read, entry.table))) {
        missing.push(`${entry.table}.${read.labels.join(',')}: ${read.key}`);
      }
    }
  }
  return missing;
}

type SqlRunner = { query(sql: string, params?: unknown[]): Promise<any> };

async function auditIndexes(runner: SqlRunner = dataSource): Promise<IndexRow[]> {
  return runner.query(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'audit_log'
      ORDER BY indexname`,
  );
}

function createIndexSql(): string {
  return `CREATE INDEX IF NOT EXISTS ${INDEX}
            ON audit_log (tenant_id, (${payloadKeyExpression(KEY, '')}), created_at DESC, id DESC)
            WHERE table_name = ANY (ARRAY['${LABEL}'])`;
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

function walkPlan(node: PlanNode, visit: (node: PlanNode) => void): void {
  visit(node);
  for (const child of node.Plans ?? []) walkPlan(child, visit);
}

async function testInventoryIndexes() {
  const before = await auditIndexes();
  // The real families that declare a payload key (the assets and technologies of family D, the
  // contact of family B, the application's process and technology links of
  // `1855910000000-audit-log-parent-applications.ts`) have their indexes, created by their
  // migrations; the fictional family
  // below proves the check fails without one.
  assert.deepEqual(missingPayloadKeyIndexes(Object.values(RECORD_HISTORY), before), [], 'every declared payload key has its index');
  assert.deepEqual(
    missingPayloadKeyIndexes([FICTIONAL], before),
    [`${FAMILY}.${LABEL}: ${KEY}`],
    'a declared key without an index is reported',
  );

  await inRolledBackTransaction(async (runner) => {
    // The expression must be the one the page query reads; a bare `after_json` index leaves the
    // deletion case out and does not cover the read.
    await runner.query(`DROP INDEX IF EXISTS ${INDEX}`);
    await runner.query(`CREATE INDEX ${INDEX} ON audit_log (tenant_id, (after_json ->> '${KEY}')) WHERE table_name = ANY (ARRAY['${LABEL}'])`);
    assert.deepEqual(
      missingPayloadKeyIndexes([FICTIONAL], await auditIndexes(runner)),
      [`${FAMILY}.${LABEL}: ${KEY}`],
      'an index on the wrong expression does not cover the read',
    );
    await runner.query(`DROP INDEX IF EXISTS ${INDEX}`);

    // The WHERE must name the label: an index for another label never serves this child.
    await runner.query(`CREATE INDEX ${INDEX} ON audit_log (tenant_id, (${payloadKeyExpression(KEY, '')})) WHERE table_name = ANY (ARRAY['other_label'])`);
    assert.deepEqual(
      missingPayloadKeyIndexes([FICTIONAL], await auditIndexes(runner)),
      [`${FAMILY}.${LABEL}: ${KEY}`],
      'an index that does not name the label does not cover the read',
    );
    await runner.query(`DROP INDEX IF EXISTS ${INDEX}`);

    await runner.query(createIndexSql());
    assert.deepEqual(missingPayloadKeyIndexes([FICTIONAL], await auditIndexes(runner)), [], 'the family index covers the read');
    assert.deepEqual(missingPayloadKeyIndexes(Object.values(RECORD_HISTORY), await auditIndexes(runner)), [], 'the real inventory stays covered');
  });
  console.log(`  payload-key index shape and ${Object.values(RECORD_HISTORY).length} real entries: OK`);
}

async function testExplain() {
  const tenantId = randomUUID();
  const keyValue = randomUUID();
  await inRolledBackTransaction(async (runner) => {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    // The application role's FORCE RLS keeps the key as a filter (`jsonb ->> text` is not
    // leakproof), but the partial index only holds the label's rows: the plan below reads them,
    // never the other 50 000 rows of the tenant's journal.
    await runner.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, after_json, source, created_at)
       SELECT $1, 'other_' || (g % 10), gen_random_uuid(), 'create', '{}'::jsonb, 'user', now() - (g || ' seconds')::interval
         FROM generate_series(1, $2::int) g`,
      [tenantId, OTHER_ROWS],
    );
    await runner.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source, created_at)
       SELECT $1, $2, gen_random_uuid(),
              CASE WHEN g % 2 = 0 THEN 'delete' ELSE 'create' END,
              CASE WHEN g % 2 = 0 THEN jsonb_build_object('${KEY}', $3::text) ELSE NULL END,
              CASE WHEN g % 2 = 0 THEN NULL ELSE jsonb_build_object('${KEY}', $3::text) END,
              'user', now() - (g || ' seconds')::interval
         FROM generate_series(1, 40) g`,
      [tenantId, LABEL, keyValue],
    );
    await runner.query(createIndexSql());
    await runner.query(`ANALYZE audit_log`);

    for (const [label, cursor] of [
      ['first page', null],
      ['after a cursor', { at: new Date().toISOString(), id: randomUUID() }],
    ] as const) {
      const query = payloadKeyAuditQuery(READ, tenantId, keyValue, cursor, 6);
      const rows: Array<Record<string, unknown>> = await runner.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
        query.params,
      );
      const plan = (rows[0]['QUERY PLAN'] as Array<{ Plan: PlanNode }>)[0].Plan;
      const used: PlanNode[] = [];
      let seqScan = false;
      walkPlan(plan, (node) => {
        if (node['Index Name'] === INDEX) used.push(node);
        if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'audit_log') seqScan = true;
      });
      assert.ok(used.length > 0, `${label}: the branch uses ${INDEX}`);
      assert.equal(seqScan, false, `${label}: the plan does not scan the tenant journal`);
      assert.match(JSON.stringify(plan), new RegExp(`COALESCE\\(after_json, before_json\\) ->> '${KEY}'`), `${label}: the plan carries the key expression`);
      for (const node of used) {
        // The index holds the 40 label rows, never the 50 000 rows of other labels.
        assert.ok((node['Actual Rows'] ?? 0) <= 100, `${label}: the index reads the label's rows, not the journal`);
        assert.match(String(node['Index Cond'] ?? ''), /tenant_id/);
      }
    }
  });
  console.log(`  EXPLAIN on ${OTHER_ROWS} other labels: the partial index reads the label rows, not the tenant journal, first page and cursor: OK`);
}

async function run() {
  await dataSource.initialize();
  try {
    console.log('record history payload keys');
    await testInventoryIndexes();
    await testExplain();
    console.log('record-history-payload-key.integration.spec: ok');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
