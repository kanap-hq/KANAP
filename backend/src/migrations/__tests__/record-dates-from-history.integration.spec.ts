// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { RecordDatesFromHistory1856277000000 as Migration } from '../1856277000000-record-dates-from-history';
import { RECORD_HISTORY, type RecordHistoryRecord } from '../../audit/record-history.inventory';
import { UPDATED_AT_TABLES } from '../../common/updated-at.inventory';
import { assert, inRolledBackTransaction, runSpecs, seedItem, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1856277000000 (the records that existed before their history dated them take the date
// of their latest history entry), against a real database, in a transaction rolled back at the end:
// - correspondence: the copy frozen in the migration is the dating code's (`audit/record-dating.ts`);
// - a dirty database of two tenants: an entry later than the date moves it to that exact instant,
//   a date later than every entry stays, a record without an entry stays, an entry in the future
//   is capped at now(), a child entry (a contact added to a contract, an amount of a budget line)
//   dates its parent, a payload key dates the record it names, an update shown as no change and an
//   export event date nothing, a row naming a deleted record raises nothing, a tenant's rows never
//   date another tenant's record;
// - the search entry of a dated record carries the new date, and nothing else of the index moves;
// - a second run changes nothing.

const migration = new Migration();

type Dating = { own: string[]; byRecord?: string[]; byParent?: string[]; byPayload?: Record<string, string[]> };

/** The correspondence of the dating code today, in the migration's shape. */
function codeDating(): Record<string, Dating> {
  const out: Record<string, Dating> = {};
  for (const entry of Object.values(RECORD_HISTORY) as RecordHistoryRecord[]) {
    if (!UPDATED_AT_TABLES[entry.table]) continue;
    const reads = Object.entries(entry.childReads ?? {});
    const byRecord = reads.filter(([, mode]) => mode === 'record').map(([label]) => label).sort();
    const byParent = Object.keys(entry.children).sort();
    const byPayload: Record<string, string[]> = {};
    for (const [label, mode] of reads) {
      if (mode === 'record') continue;
      (byPayload[mode.payloadKey] ??= []).push(label);
    }
    const dating: Dating = { own: [...entry.auditLabels].sort() };
    if (byRecord.length) dating.byRecord = byRecord;
    if (byParent.length) dating.byParent = byParent;
    if (Object.keys(byPayload).length) {
      dating.byPayload = Object.fromEntries(Object.keys(byPayload).sort().map((key) => [key, byPayload[key].sort()]));
    }
    out[entry.table] = dating;
  }
  return out;
}

/** The migration's copy, sorted the same way. */
function migrationDating(): Record<string, Dating> {
  const out: Record<string, Dating> = {};
  for (const [table, dating] of Object.entries(migration.dating)) {
    const copy: Dating = { own: [...dating.own].sort() };
    if (dating.byRecord?.length) copy.byRecord = [...dating.byRecord].sort();
    if (dating.byParent?.length) copy.byParent = [...dating.byParent].sort();
    if (dating.byPayload && Object.keys(dating.byPayload).length) {
      copy.byPayload = Object.fromEntries(Object.keys(dating.byPayload).sort().map((key) => [key, [...dating.byPayload![key]].sort()]));
    }
    out[table] = copy;
  }
  return out;
}

async function testCorrespondenceIsTheCode() {
  const code = codeDating();
  const frozen = migrationDating();
  const tables = Array.from(new Set([...Object.keys(code), ...Object.keys(frozen)])).sort();
  const problems = tables
    .filter((table) => JSON.stringify(code[table] ?? null) !== JSON.stringify(frozen[table] ?? null))
    .map((table) => `${table}: code ${JSON.stringify(code[table] ?? null)}, migration ${JSON.stringify(frozen[table] ?? null)}`);
  assert.deepEqual(
    problems,
    [],
    'audit/record-dating.ts and migration 1856277000000 no longer date the same records. Do not edit the migration: it '
      + 'has run on installed databases. When the change of the dating is deliberate, decide whether the records that '
      + 'already exist must take the dates of the rows the new correspondence reads; if so, write a new migration that '
      + 'does it with its own frozen copy, as 1856277000000 does, and point this comparison at that migration.',
  );
}

const T0 = '2020-01-01T00:00:00.000000Z';
const T_CHILD = '2024-03-01T10:00:00.123456Z';
const T_OWN = '2024-02-01T09:00:00.654321Z';
const T_LATER_DATE = '2025-01-01T00:00:00.000000Z';
const T_HIDDEN = '2025-06-01T00:00:00.000000Z';
const T_AMOUNT = '2024-05-05T05:05:05.505050Z';
const T_CONTACT = '2023-04-04T04:04:04.404040Z';
const T_B = '2024-07-07T07:07:07.707070Z';
const T_CROSS = '2025-08-08T08:08:08.808080Z';

type AuditSeed = {
  table: string;
  recordId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  parent?: { table: string; id: string } | null;
  at: string;
};

async function audit(runner: QueryRunner, tenantId: string, row: AuditSeed) {
  await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source, parent_table, parent_id, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'user', $7, $8, $9::timestamptz)`,
    [
      tenantId, row.table, row.recordId ?? null, row.action,
      row.before === undefined ? null : JSON.stringify(row.before),
      row.after === undefined ? null : JSON.stringify(row.after),
      row.parent?.table ?? null, row.parent?.id ?? null, row.at,
    ],
  );
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(`${sql} RETURNING id`, params);
  return row.id;
}

async function setDate(runner: QueryRunner, table: string, id: string, at: string) {
  await runner.query(`UPDATE public.${table} SET updated_at = $2::timestamptz WHERE id = $1`, [id, at]);
}

/** A contract with its company and supplier, dated `at`. */
async function seedContract(runner: QueryRunner, tenantId: string, tag: string, at: string): Promise<string> {
  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Brest')`, [tenantId, `Company ${tag}`]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, `Supplier ${tag}`]);
  const id = await insertId(
    runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2020-01-01')`,
    [tenantId, `Contract ${tag}`, company, supplier],
  );
  await setDate(runner, 'contracts', id, at);
  return id;
}

async function dateOf(runner: QueryRunner, table: string, id: string): Promise<string> {
  const [row] = await runner.query(`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM public.${table} WHERE id = $1`, [id]);
  return row.at;
}

async function nowText(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`);
  return row.at;
}

type IndexRow = { entity_id: string; ctid: string; rest: string; source_updated_at: string | null };

async function searchIndex(runner: QueryRunner, tenantIds: string[]): Promise<Map<string, IndexRow>> {
  const out = new Map<string, IndexRow>();
  for (const tenantId of tenantIds) {
    await setTenant(runner, tenantId);
    const rows: IndexRow[] = await runner.query(
      `SELECT entity_type || ':' || entity_id AS entity_id, ctid::text AS ctid, (to_jsonb(s) - 'source_updated_at')::text AS rest,
              to_char(source_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_updated_at
         FROM search_index s WHERE tenant_id = $1`,
      [tenantId],
    );
    for (const row of rows) out.set(row.entity_id, row);
  }
  return out;
}

/** Runs up() as a release does: no tenant set; returns its log lines. */
async function up(runner: QueryRunner): Promise<string[]> {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await migration.up(runner);
  } finally {
    console.log = log;
  }
  return lines;
}

async function testDirtyDatabase() {
  await inRolledBackTransaction(async (runner) => {
    const tenantB = await seedTenant(runner, 'dates-b');
    const contractB = await seedContract(runner, tenantB, 'B', T0);
    await audit(runner, tenantB, { table: 'contract_contacts', action: 'create', after: { contract_id: contractB }, parent: { table: 'contracts', id: contractB }, at: T_B });

    const tenantA = await seedTenant(runner, 'dates-a');
    const child = await seedContract(runner, tenantA, 'child', T0);
    const own = await seedContract(runner, tenantA, 'own', T0);
    const later = await seedContract(runner, tenantA, 'later', T_LATER_DATE);
    const none = await seedContract(runner, tenantA, 'none', T0);
    const future = await seedContract(runner, tenantA, 'future', T0);
    const hidden = await seedContract(runner, tenantA, 'hidden', T0);
    const earlier = await seedContract(runner, tenantA, 'earlier', T0);
    const contact = await insertId(runner, `INSERT INTO contacts (tenant_id, email) VALUES ($1, $2)`, [tenantA, `dates-${tenantA.slice(0, 8)}@example.test`]);
    await setDate(runner, 'contacts', contact, T0);
    const line = await seedItem(runner, 'opex', tenantA, 1, 'Dated line');
    await setDate(runner, 'spend_items', line, T0);

    // A contact added to a contract: the contract (parent) and the contact (payload key) are dated.
    await audit(runner, tenantA, {
      table: 'contract_contacts', recordId: randomUUID(), action: 'create',
      after: { contract_id: child, contact_id: contact.toUpperCase(), role: 'commercial' },
      parent: { table: 'contracts', id: child }, at: T_CHILD,
    });
    await audit(runner, tenantA, { table: 'contract_contacts', action: 'create', after: { contact_id: contact }, parent: { table: 'contracts', id: child }, at: T_CONTACT });
    // An amount of a budget line dates the line.
    await audit(runner, tenantA, { table: 'spend_amounts', recordId: randomUUID(), action: 'create', after: { planned: 1200 }, parent: { table: 'spend_items', id: line }, at: T_AMOUNT });
    // The contract's own change, older than its child's: the latest entry wins.
    await audit(runner, tenantA, { table: 'contracts', recordId: child, action: 'update', before: { name: 'A' }, after: { name: 'B' }, at: T_OWN });
    await audit(runner, tenantA, { table: 'contracts', recordId: own, action: 'update', before: { name: 'A' }, after: { name: 'B' }, at: T_OWN });
    // Its own creation dates nothing.
    await audit(runner, tenantA, { table: 'contracts', recordId: own, action: 'create', after: { name: 'A' }, at: T_HIDDEN });
    // A record whose date is later than its entries.
    await audit(runner, tenantA, { table: 'contracts', recordId: later, action: 'update', before: { name: 'A' }, after: { name: 'B' }, at: T_OWN });
    // An entry in the future.
    await audit(runner, tenantA, { table: 'contracts', recordId: future, action: 'update', before: { name: 'A' }, after: { name: 'B' }, at: '2999-01-01T00:00:00Z' });
    // Rows the history does not show: a save that changed nothing, an export.
    await audit(runner, tenantA, { table: 'contracts', recordId: hidden, action: 'update', before: { name: 'Same' }, after: { name: 'Same' }, at: T_HIDDEN });
    await audit(runner, tenantA, { table: 'export', recordId: hidden, action: 'export', after: { format: 'csv' }, at: T_HIDDEN });
    // The latest update shows no change, an earlier one does: the earlier one dates the record.
    await audit(runner, tenantA, { table: 'contracts', recordId: earlier, action: 'update', before: { name: 'A' }, after: { name: 'B' }, at: T_OWN });
    await audit(runner, tenantA, { table: 'contracts', recordId: earlier, action: 'update', before: { name: 'B' }, after: { name: 'B' }, at: T_HIDDEN });
    // Rows naming deleted records, and a row of tenant A naming tenant B's contract.
    await audit(runner, tenantA, { table: 'contracts', recordId: randomUUID(), action: 'update', before: { name: 'A' }, after: { name: 'B' }, at: T_HIDDEN });
    await audit(runner, tenantA, { table: 'contract_contacts', action: 'delete', before: { contract_id: randomUUID(), contact_id: randomUUID() }, parent: { table: 'contracts', id: randomUUID() }, at: T_HIDDEN });
    await audit(runner, tenantA, { table: 'contract_contacts', action: 'create', after: { contract_id: contractB }, parent: { table: 'contracts', id: contractB }, at: T_CROSS });

    const indexBefore = await searchIndex(runner, [tenantA, tenantB]);
    assert.ok(indexBefore.has(`contracts:${child}`), 'the contract has a search entry to follow its date');

    const first = await up(runner);
    const now = await nowText(runner);
    await setTenant(runner, tenantA);
    assert.equal(await dateOf(runner, 'contracts', child), T_CHILD, 'a child entry dates its contract, at its exact instant');
    assert.equal(await dateOf(runner, 'contacts', contact), T_CHILD, 'the payload key dates the contact it names, upper-case or not');
    assert.equal(await dateOf(runner, 'spend_items', line), T_AMOUNT, 'an amount dates its budget line');
    assert.equal(await dateOf(runner, 'contracts', own), T_OWN, 'its own change dates a record; its creation does not');
    assert.equal(await dateOf(runner, 'contracts', later), T_LATER_DATE, 'a date later than every entry stays');
    assert.equal(await dateOf(runner, 'contracts', none), T0, 'a record without an entry keeps its date');
    assert.equal(await dateOf(runner, 'contracts', future), now, 'an entry in the future is capped at now()');
    assert.equal(await dateOf(runner, 'contracts', hidden), T0, 'a save that changed nothing and an export date nothing');
    assert.equal(await dateOf(runner, 'contracts', earlier), T_OWN, 'under a latest update that shows no change, an earlier one dates the record');
    await setTenant(runner, tenantB);
    assert.equal(await dateOf(runner, 'contracts', contractB), T_B, "a tenant's rows never date another tenant's record");

    const dated = new Map<string, string>([
      [`contracts:${child}`, T_CHILD], [`contracts:${own}`, T_OWN], [`contracts:${future}`, now], [`contracts:${earlier}`, T_OWN],
      [`contacts:${contact}`, T_CHILD], [`spend_items:${line}`, T_AMOUNT], [`contracts:${contractB}`, T_B],
    ]);
    const indexAfter = await searchIndex(runner, [tenantA, tenantB]);
    assert.deepEqual(Array.from(indexAfter.keys()).sort(), Array.from(indexBefore.keys()).sort(), 'no search entry added or removed');
    for (const [key, before] of indexBefore) {
      const after = indexAfter.get(key)!;
      assert.equal(after.rest, before.rest, `${key}: the search entry keeps everything but its date`);
      if (dated.has(key)) {
        assert.equal(after.source_updated_at, dated.get(key), `${key}: the search entry carries the new date`);
      } else {
        assert.equal(after.ctid, before.ctid, `${key}: an entry of a record not dated is not rewritten`);
      }
    }

    assert.ok(first.some((line) => /contracts: \d+ record\(s\) dated/.test(line)), `the count by table is logged: ${first.join(' | ')}`);
    const second = await up(runner);
    assert.ok(second.some((line) => / 0 record\(s\) dated in \d+ tenant\(s\)/.test(line)), `a second run dates nothing: ${second.join(' | ')}`);
    await setTenant(runner, tenantA);
    assert.equal(await dateOf(runner, 'contracts', child), T_CHILD, 'a second run leaves the dates');
  });
}

/** A statement that fails in the middle of the loop: up() raises that statement's error. */
async function testFailureMidLoop() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'dates-boom');
    const contract = await seedContract(runner, tenantId, 'boom', T0);
    await audit(runner, tenantId, { table: 'contracts', recordId: contract, action: 'update', before: { name: 'A' }, after: { name: 'B' }, at: T_OWN });
    await runner.query(`CREATE FUNCTION pg_temp.dates_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'dates boom: the real cause'; END $$`);
    await runner.query(`CREATE TRIGGER dates_boom BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION pg_temp.dates_boom()`);
    let message = 'no error';
    try {
      await up(runner);
    } catch (err) {
      message = (err as Error).message;
    }
    assert.match(message, /dates boom: the real cause/, `up() raises the failing statement's own error: ${message}`);
  });
}

async function testDownDoesNothing() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'dates-down');
    const contract = await seedContract(runner, tenantId, 'down', T_LATER_DATE);
    await migration.down();
    assert.equal(await dateOf(runner, 'contracts', contract), T_LATER_DATE);
  });
}

runSpecs('record-dates-from-history migration', [
  ['the frozen correspondence is the dating code', testCorrespondenceIsTheCode],
  ['a dirty database of two tenants', testDirtyDatabase],
  ['a failure in the middle of the loop raises its own cause', testFailureMidLoop],
  ['down() leaves the dates', testDownDoesNothing],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
