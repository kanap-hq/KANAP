// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { writeAuditLog, writeAuditLogs, type AuditEntry } from '../../audit/audit.service';
import { historyRecordsReading, recordsToDate } from '../../audit/record-dating';
import { RECORD_HISTORY, type RecordHistoryRecord } from '../../audit/record-history.inventory';
import { auditPageQuery } from '../../audit/record-history/query';
import { UPDATED_AT_TABLES } from '../updated-at.inventory';

// The modification date follows the history (audit/record-dating.ts):
// - inventory: for every label of every record, the records the write side dates are exactly the
//   records whose history page (record-history/query.ts) reads the row;
// - a batch of 500 rows on 500 records dates them with one statement per table;
// - two transactions dating the same two records in opposite orders do not deadlock;
// - no useless write: a record the trigger or an earlier row already dated is not written again,
//   a creation and a deletion cost nothing.

const OLD = '2020-01-02T03:04:05.000Z';
let ds: DataSource;

async function inTx(fn: (r: QueryRunner, tenantId: string) => Promise<void>) {
  const r = ds.createQueryRunner();
  await r.connect();
  await r.startTransaction();
  try {
    const tenantId = randomUUID();
    await r.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Updated at history', 'active', '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [tenantId, `updated-at-history-${tenantId.slice(0, 8)}`],
    );
    await r.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(r, tenantId);
  } finally {
    await r.rollbackTransaction().catch(() => undefined);
    await r.release();
  }
}

/** Every label of a record and the shape its page reads it by. */
function labelsOf(entry: RecordHistoryRecord): Array<{ label: string; shape: 'record_id' | 'parent' | { payloadKey: string } }> {
  const out: Array<{ label: string; shape: 'record_id' | 'parent' | { payloadKey: string } }> = [];
  for (const label of entry.auditLabels) out.push({ label, shape: 'record_id' });
  for (const label of Object.keys(entry.children)) {
    const read = entry.childReads?.[label];
    out.push({ label, shape: read === 'record' ? 'record_id' : read ? read : 'parent' });
  }
  return out;
}

/** Inventory: the write side dates exactly the records whose page reads the row. */
async function testResolutionMatchesTheRead() {
  await inTx(async (r, tenantId) => {
    const rows: Array<{ id: string; label: string; owner: string; X: string; Y: string; table: string; recordId: string; after: unknown; parent: { table: string; id: string } | null }> = [];
    for (const entry of Object.values(RECORD_HISTORY) as RecordHistoryRecord[]) {
      if (!UPDATED_AT_TABLES[entry.table]) continue;
      for (const { label, shape } of labelsOf(entry)) {
        const X = randomUUID();
        const Y = randomUUID();
        const recordId = shape === 'record_id' ? X : Y;
        const after = typeof shape === 'object' ? { [shape.payloadKey]: X } : { note: 'changed' };
        const parent = shape === 'parent' ? { table: entry.table, id: X } : null;
        const [{ id }] = await r.query(
          `INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, source, parent_table, parent_id)
           VALUES ($1, $2, 'update', '{}'::jsonb, $3::jsonb, 'system', $4, $5) RETURNING id`,
          [label, recordId, JSON.stringify(after), parent?.table ?? null, parent?.id ?? null],
        );
        rows.push({ id, label, owner: entry.table, X, Y, table: label, recordId, after, parent });
      }
    }
    const problems: string[] = [];
    let checked = 0;
    for (const row of rows) {
      const read = new Set<string>();
      for (const entry of Object.values(RECORD_HISTORY) as RecordHistoryRecord[]) {
        for (const id of [row.X, row.Y]) {
          const query = auditPageQuery(entry, tenantId, id, null, 1000);
          const found: Array<{ id: string }> = await r.query(query.sql, query.params);
          if (found.some((f) => f.id === row.id)) read.add(`${entry.table}:${id}`);
        }
      }
      const written = new Set(historyRecordsReading({ table: row.table, recordId: row.recordId, action: 'update', before: {}, after: row.after, parent: row.parent })
        .map(({ entry, id }) => `${entry.table}:${id}`));
      checked += 1;
      if (!written.has(`${row.owner}:${row.X}`)) {
        problems.push(`${row.owner} / ${row.label}: the write names no record; declare how its page reads it (childReads in record-history/records/${row.owner}.ts) or give the label a parent rule (audit-parent-rules.ts) or list it in explicitParentLabels`);
      }
      const onlyRead = [...read].filter((key) => !written.has(key));
      const onlyWritten = [...written].filter((key) => !read.has(key));
      if (onlyRead.length || onlyWritten.length) {
        problems.push(`${row.owner} / ${row.label}: audit/record-dating.ts and record-history/query.ts disagree (read only: ${onlyRead.join(', ') || 'none'}; dated only: ${onlyWritten.join(', ') || 'none'})`);
      }
    }
    console.log(`  ${checked} labels of the records with a modification date: the dated records are the records whose page reads the row`);
    assert.deepEqual(problems, []);
  });
}

/** 500 rows on 500 records of two tables: one dating statement per table, every record dated. */
async function testBatchDatesWithOneStatementPerTable() {
  await inTx(async (r) => {
    const suppliers: string[] = (await r.query(
      `INSERT INTO suppliers (tenant_id, name, updated_at) SELECT app_current_tenant(), 'Supplier ' || g, $1 FROM generate_series(1, 250) g RETURNING id`,
      [OLD],
    )).map((row: { id: string }) => row.id);
    const company: string = (await r.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES (app_current_tenant(), 'Company', 'FR', 'Brest', 1) RETURNING id`,
    ))[0].id;
    const contracts: string[] = (await r.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number, updated_at)
       SELECT app_current_tenant(), 'Contract ' || g, $1, $2, '2026-01-01', g, $3 FROM generate_series(1, 250) g RETURNING id`,
      [company, suppliers[0], OLD],
    )).map((row: { id: string }) => row.id);
    const entries: AuditEntry[] = [
      ...suppliers.map((id) => ({ table: 'suppliers', recordId: id, action: 'update', before: { notes: 'a' }, after: { notes: 'b' } })),
      ...contracts.map((id) => ({ table: 'contract_contacts', recordId: randomUUID(), action: 'create', before: null, after: { contract_id: id, contact_id: randomUUID(), role: 'commercial' } })),
    ];
    const manager = r.manager;
    const query = manager.query.bind(manager);
    const statements: string[] = [];
    (manager as any).query = (sql: string, params?: unknown[]) => {
      if (/^\s*WITH touched AS \(\s*UPDATE/.test(sql)) statements.push(/UPDATE public\."(\w+)"/.exec(sql)?.[1] ?? '?');
      return query(sql, params);
    };
    try {
      await writeAuditLogs(manager, entries);
    } finally {
      delete (manager as any).query;
    }
    const [dated] = await r.query(
      `SELECT (SELECT count(*)::int FROM suppliers WHERE id = ANY($1::uuid[]) AND updated_at = now()) AS suppliers,
              (SELECT count(*)::int FROM contracts WHERE id = ANY($2::uuid[]) AND updated_at = now()) AS contracts`,
      [suppliers, contracts],
    );
    console.log(`  500 rows: dating statements ${JSON.stringify(statements)}, dated ${JSON.stringify(dated)}`);
    // A contract's contact link is in the contract's history and in the contact's (by `contact_id`).
    assert.deepEqual(statements, ['contacts', 'contracts', 'suppliers'], 'one statement per table, tables in order');
    assert.deepEqual(dated, { suppliers: 250, contracts: 250 });
  });
}

/** Two transactions dating the same two records in opposite orders: no deadlock, both commit. */
async function testOppositeOrdersDoNotDeadlock() {
  const tenantId = randomUUID();
  const setup = ds.createQueryRunner();
  await setup.connect();
  const ids: string[] = [];
  try {
    await setup.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Updated at order', 'active', '{}'::jsonb, '{}'::jsonb, now(), now())`,
      [tenantId, `updated-at-order-${tenantId.slice(0, 8)}`],
    );
    await setup.startTransaction();
    await setup.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (const name of ['First', 'Second']) {
      ids.push((await setup.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]))[0].id);
    }
    await setup.commitTransaction();

    const open = async () => {
      const q = ds.createQueryRunner();
      await q.connect();
      await q.startTransaction();
      await q.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await q.query(`SET LOCAL lock_timeout = '10s'`);
      return q;
    };
    const entry = (id: string): AuditEntry => ({ table: 'suppliers', recordId: id, action: 'update', before: { notes: 'a' }, after: { notes: 'b' } });
    const first = await open();
    const second = await open();
    try {
      await writeAuditLogs(first.manager, [entry(ids[0]), entry(ids[1])]);
      const waiting = writeAuditLogs(second.manager, [entry(ids[1]), entry(ids[0])]).then(() => 'done', (error) => `failed: ${error?.message}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await first.commitTransaction();
      const outcome = await waiting;
      await second.commitTransaction();
      console.log(`  opposite orders: the second transaction ${outcome}`);
      assert.equal(outcome, 'done', 'the second transaction waits for the first, then dates both records');
    } finally {
      for (const q of [first, second]) {
        if (q.isTransactionActive) await q.rollbackTransaction().catch(() => undefined);
        await q.release();
      }
    }
  } finally {
    await setup.startTransaction();
    await setup.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await setup.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await setup.query(`DELETE FROM suppliers WHERE tenant_id = $1`, [tenantId]);
    await setup.commitTransaction();
    await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await setup.release();
  }
}

/** No useless write: a record already dated in the transaction keeps its row version. */
async function testNoUselessWrite() {
  await inTx(async (r) => {
    const supplier: string = (await r.query(`INSERT INTO suppliers (tenant_id, name, updated_at) VALUES (app_current_tenant(), 'Supplier', $1) RETURNING id`, [OLD]))[0].id;
    const ctid = async () => String((await r.query(`SELECT ctid::text AS ctid FROM suppliers WHERE id = $1`, [supplier]))[0].ctid);
    const outcome: Record<string, string> = {};

    // The trigger dates the row, then its audit row and a child's row find it dated.
    await r.query(`UPDATE suppliers SET notes = 'Changed' WHERE id = $1`, [supplier]);
    const dated = await ctid();
    await writeAuditLog(r.manager, { table: 'suppliers', recordId: supplier, action: 'update', before: { notes: null }, after: { notes: 'Changed' } });
    await writeAuditLog(r.manager, { table: 'supplier_contacts', recordId: randomUUID(), action: 'create', before: null, after: { supplier_id: supplier, contact_id: randomUUID(), role: 'commercial' } });
    outcome['dated by the trigger, then two rows'] = (await ctid()) === dated ? 'row kept' : 'row written again';

    // A record not dated yet is written once, by the first row only.
    await r.query(`UPDATE suppliers SET updated_at = $2 WHERE id = $1`, [supplier, OLD]);
    const aged = await ctid();
    await writeAuditLog(r.manager, { table: 'supplier_contacts', recordId: randomUUID(), action: 'create', before: null, after: { supplier_id: supplier, contact_id: randomUUID(), role: 'commercial' } });
    const once = await ctid();
    await writeAuditLog(r.manager, { table: 'supplier_contacts', recordId: randomUUID(), action: 'create', before: null, after: { supplier_id: supplier, contact_id: randomUUID(), role: 'technical' } });
    outcome['aged, then two child rows'] = once !== aged && (await ctid()) === once ? 'written once' : 'not written once';

    // A creation and a deletion: nothing to date, no statement.
    const born: string = (await r.query(`INSERT INTO suppliers (tenant_id, name, updated_at) VALUES (app_current_tenant(), 'Born', $1) RETURNING id`, [OLD]))[0].id;
    const gone = randomUUID();
    const planned = recordsToDate([
      { table: 'suppliers', recordId: born, action: 'create', before: null, after: { name: 'Born' } },
      { table: 'suppliers', recordId: gone, action: 'delete', before: { name: 'Gone' }, after: null },
    ]);
    outcome['a creation and a deletion'] = planned.size === 0 ? 'no statement' : `statements for ${[...planned.keys()].join(', ')}`;
    await writeAuditLog(r.manager, { table: 'suppliers', recordId: gone, action: 'delete', before: { name: 'Gone' }, after: null });

    // A row written back as it was is no entry of the history: no date.
    const unchanged = recordsToDate([{ table: 'suppliers', recordId: supplier, action: 'update', before: { name: 'Supplier', notes: 'Changed' }, after: { name: 'Supplier', notes: 'Changed' } }]);
    outcome['an update that changes nothing'] = unchanged.size === 0 ? 'no statement' : 'a statement';

    // The rows no history shows: the notification claims written in SQL, an export event.
    const outside = recordsToDate([
      { table: 'expiry_reminders', recordId: supplier, action: 'create', before: null, after: { key: 'k' } },
      { table: 'vulnerability_notifications', recordId: supplier, action: 'create', before: null, after: { key: 'k' } },
      { table: 'export', recordId: null, action: 'export', before: null, after: { rows: 3 } },
    ]);
    outcome['rows outside every history'] = outside.size === 0 ? 'no statement' : 'a statement';

    console.log(Object.entries(outcome).map(([name, result]) => `  ${name}: ${result}`).join('\n'));
    assert.deepEqual(outcome, {
      'rows outside every history': 'no statement',
      'dated by the trigger, then two rows': 'row kept',
      'aged, then two child rows': 'written once',
      'a creation and a deletion': 'no statement',
      'an update that changes nothing': 'no statement',
    });
  });
}

async function main() {
  ds = dataSource;
  await ds.initialize();
  let failed = 0;
  try {
    for (const [name, fn] of [
      ['the dated records are the records whose page reads the row', testResolutionMatchesTheRead],
      ['a batch dates with one statement per table', testBatchDatesWithOneStatementPerTable],
      ['opposite orders do not deadlock', testOppositeOrdersDoNotDeadlock],
      ['no useless write', testNoUselessWrite],
    ] as const) {
      try {
        await fn();
        console.log(`ok - ${name}`);
      } catch (error: any) {
        failed += 1;
        console.log(`not ok - ${name}\n${error?.stack ?? error}`);
      }
    }
  } finally {
    await ds.destroy();
  }
  if (failed) throw new Error(`${failed} test(s) failed`);
}

void main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
