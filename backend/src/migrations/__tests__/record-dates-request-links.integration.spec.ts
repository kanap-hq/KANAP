// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { RecordDatesRequestLinks1856290000000 as Migration } from '../1856290000000-record-dates-request-links';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1856290000000 (lot K2f: the applications and assets take the date of the request links
// their history now reads), against a real database, in a transaction rolled back at the end. Its
// correspondence is compared with the code by `record-dates-from-history.integration.spec.ts`.
// - a dirty database of two tenants: a request link row naming the application in `record_id`, or
//   the asset as parent, moves its date to that exact instant; a row written before K2f (the request
//   in `record_id`, no parent) dates neither; a date later than the entry stays; an entry in the
//   future is capped at now(); a row naming a deleted record raises nothing; a tenant's rows never
//   date another tenant's record;
// - a second run changes nothing; down() leaves the dates.

const migration = new Migration();

const T0 = '2020-01-01T00:00:00.000000Z';
const T_APP = '2024-03-01T10:00:00.123456Z';
const T_ASSET = '2024-04-02T11:00:00.654321Z';
const T_OLD_FORM = '2025-02-02T02:02:02.020202Z';
const T_LATER_DATE = '2025-06-01T00:00:00.000000Z';
const T_B = '2024-07-07T07:07:07.707070Z';
const T_CROSS = '2025-08-08T08:08:08.808080Z';

type AuditSeed = { table: string; recordId?: string | null; action: string; before?: unknown; after?: unknown; parent?: { table: string; id: string } | null; at: string };

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

async function dated(runner: QueryRunner, table: string, id: string, at: string): Promise<string> {
  await runner.query(`UPDATE public.${table} SET updated_at = $2::timestamptz WHERE id = $1`, [id, at]);
  return id;
}

async function application(runner: QueryRunner, tenantId: string, tag: string, at = T0): Promise<string> {
  return dated(runner, 'applications', await insertId(runner, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, 'enabled')`, [tenantId, `App ${tag}`, `APP-RL-${tag}`]), at);
}

async function asset(runner: QueryRunner, tenantId: string, tag: string, at = T0): Promise<string> {
  return dated(runner, 'assets', await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'server', 'prod')`, [tenantId, `srv-${tag}`]), at);
}

async function request(runner: QueryRunner, tenantId: string, n: number): Promise<string> {
  return insertId(runner, `INSERT INTO portfolio_requests (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [tenantId, 990000 + n, `Request ${n}`]);
}

async function dateOf(runner: QueryRunner, table: string, id: string): Promise<string> {
  const [row] = await runner.query(`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM public.${table} WHERE id = $1`, [id]);
  return row.at;
}

async function nowText(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`);
  return row.at;
}

/** Runs up() as a release does: no tenant set; returns its log lines. */
async function up(runner: QueryRunner, run: Migration = migration): Promise<string[]> {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await run.up(runner);
  } finally {
    console.log = log;
  }
  return lines;
}

async function testDirtyDatabase(run: Migration) {
  await inRolledBackTransaction(async (runner) => {
    const tenantB = await seedTenant(runner, 'req-links-b');
    const appB = await application(runner, tenantB, 'B');
    await audit(runner, tenantB, { table: 'portfolio_request_applications', recordId: appB, action: 'update', before: [], after: [randomUUID()], at: T_B });

    const tenantA = await seedTenant(runner, 'req-links-a');
    const r1 = await request(runner, tenantA, 1);
    const appMarked = await application(runner, tenantA, 'marked');
    const appOldForm = await application(runner, tenantA, 'old-form');
    const appLater = await application(runner, tenantA, 'later', T_LATER_DATE);
    const appFuture = await application(runner, tenantA, 'future');
    const assetByParent = await asset(runner, tenantA, 'parent');
    const assetByRecord = await asset(runner, tenantA, 'record');

    // The row a request's replacement writes on the application (K2f): the application in `record_id`.
    await audit(runner, tenantA, { table: 'portfolio_request_applications', recordId: appMarked, action: 'update', before: [], after: [r1], at: T_APP });
    // The request's own row, as before K2f: the request in `record_id`, no parent, the application in
    // the payload only. The application's history does not read it: it dates nothing.
    await audit(runner, tenantA, { table: 'portfolio_request_applications', recordId: r1, action: 'update', before: { ids: [] }, after: { ids: [appOldForm] }, at: T_OLD_FORM });
    await audit(runner, tenantA, { table: 'portfolio_request_applications', recordId: appLater, action: 'update', before: [], after: [r1], at: T_APP });
    await audit(runner, tenantA, { table: 'portfolio_request_applications', recordId: appFuture, action: 'update', before: [], after: [r1], at: '2999-01-01T00:00:00Z' });
    // An asset named as parent, another in `record_id`.
    await audit(runner, tenantA, { table: 'portfolio_request_assets', recordId: r1, action: 'update', before: { ids: [] }, after: { ids: [assetByParent] }, parent: { table: 'assets', id: assetByParent }, at: T_ASSET });
    await audit(runner, tenantA, { table: 'portfolio_request_assets', recordId: assetByRecord, action: 'update', before: { ids: [] }, after: { ids: [r1] }, at: T_ASSET });
    // A row naming a deleted application, and a row of tenant A naming tenant B's application.
    await audit(runner, tenantA, { table: 'portfolio_request_applications', recordId: randomUUID(), action: 'update', before: [], after: [r1], at: T_APP });
    await audit(runner, tenantA, { table: 'portfolio_request_applications', recordId: appB, action: 'update', before: [], after: [r1], at: T_CROSS });

    const first = await up(runner, run);
    const now = await nowText(runner);
    await setTenant(runner, tenantA);
    assert.equal(await dateOf(runner, 'applications', appMarked), T_APP, 'the request link on the application dates it, at its exact instant');
    assert.equal(await dateOf(runner, 'applications', appOldForm), T0, 'a row written before K2f (the request in record_id) dates no application');
    assert.equal(await dateOf(runner, 'applications', appLater), T_LATER_DATE, 'a date later than the entry stays');
    assert.equal(await dateOf(runner, 'applications', appFuture), now, 'an entry in the future is capped at now()');
    assert.equal(await dateOf(runner, 'assets', assetByParent), T_ASSET, 'the asset named as parent is dated');
    assert.equal(await dateOf(runner, 'assets', assetByRecord), T_ASSET, 'the asset in record_id is dated');
    await setTenant(runner, tenantB);
    assert.equal(await dateOf(runner, 'applications', appB), T_B, "a tenant's rows never date another tenant's record");

    assert.ok(first.some((line) => /applications: \d+ record\(s\) dated/.test(line)), `the count by table is logged: ${first.join(' | ')}`);
    const second = await up(runner, run);
    assert.ok(second.some((line) => / 0 record\(s\) dated in \d+ tenant\(s\)/.test(line)), `a second run dates nothing: ${second.join(' | ')}`);
    await setTenant(runner, tenantA);
    assert.equal(await dateOf(runner, 'applications', appMarked), T_APP, 'a second run leaves the dates');
  });
}

async function testOnlyTwoFamilies() {
  assert.deepEqual(Object.keys(migration.dating).sort(), ['applications', 'assets'], 'the migration dates applications and assets only');
}

async function testDownDoesNothing() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'req-links-down');
    const app = await application(runner, tenantId, 'down', T_LATER_DATE);
    await migration.down();
    assert.equal(await dateOf(runner, 'applications', app), T_LATER_DATE);
  });
}

/** The same migration with tiny bounds: several batches of records, several reads per record. */
function smallBounds(): Migration {
  const small = new Migration();
  small.batchSize = 2;
  small.perRecord = 2;
  return small;
}

runSpecs('record-dates-request-links migration', [
  ['it dates applications and assets only', testOnlyTwoFamilies],
  ['a dirty database of two tenants', () => testDirtyDatabase(migration)],
  ['the same, by batches of 2 records and 2 rows per record', () => testDirtyDatabase(smallBounds())],
  ['down() leaves the dates', testDownDoesNothing],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
