import 'dotenv/config';
import dataSource from '../../data-source';
import { waitForBackgroundWork } from '../../common/background-work';
import {
  analyzeAfterLargeImport,
  analyzeTables,
  ANALYZE_AFTER_IMPORT_ROWS,
  lineImportTables,
  writtenRows,
} from '../budget-import-statistics';
import { assert, runSpecs } from './round-inputs.fixtures';

// Statistics after a large budget import (plan planning/perf-scale, item 4C bis;
// budget-import-statistics.ts), against the database: below the threshold, a dry run or a
// refused file leave the request's transaction to the interceptor; a large import commits it,
// gives its connection back, and ANALYZE then runs on the tables it writes, in the background,
// one transaction per table; a table the role does not own or that does not exist is skipped
// and reported, never logged as analysed.
// @database-spec: run-ci-tests.js runs this file in its serial database lane.

const written = (rows: number) => ({ ok: true, dryRun: false, inserted: rows - Math.floor(rows / 2), updated: Math.floor(rows / 2) });

async function testWrittenRows() {
  assert.equal(writtenRows(written(ANALYZE_AFTER_IMPORT_ROWS)), ANALYZE_AFTER_IMPORT_ROWS, 'inserted and updated rows count');
  assert.equal(writtenRows({ ...written(5000), dryRun: true }), 0, 'a dry run writes nothing');
  assert.equal(writtenRows({ ...written(5000), ok: false }), 0, 'a refused file writes nothing');
  assert.equal(writtenRows({ ok: true, inserted: 5000, updated: 0 }), 0, 'a result that does not say it was no dry run counts nothing');
  assert.equal(writtenRows(null), 0);
  // A CAPEX import writes the spend_* tables since lot Z1: the tables of both natures are one family.
  const lineTables = ['spend_items', 'spend_item_analytics_values', 'spend_versions', 'spend_amounts', 'spend_round_inputs', 'spend_version_totals'];
  assert.deepEqual(lineImportTables('capex'), lineTables);
  assert.deepEqual(lineImportTables('opex'), lineTables);
}

/** analyze_count of the given tables, read on a connection of its own. */
async function analyzeCounts(tables: readonly string[]): Promise<Record<string, number>> {
  const rows: Array<{ name: string; n: number }> = await dataSource.query(
    `SELECT relname::text AS name, analyze_count::int AS n FROM pg_stat_user_tables WHERE relname = ANY ($1::text[])`,
    [tables],
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.n]));
}

/** A request whose transaction is open on its own runner, as TenantInitGuard leaves it. */
async function openRequest() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  return { req: { queryRunner: runner } as any, runner };
}

async function testBelowThreshold() {
  const tables = lineImportTables('opex');
  for (const result of [written(ANALYZE_AFTER_IMPORT_ROWS - 1), { ...written(50000), dryRun: true }, { ...written(50000), ok: false }]) {
    const { req, runner } = await openRequest();
    try {
      await analyzeAfterLargeImport(req, tables, result);
      assert.equal(req.queryRunner, runner, 'the request keeps its runner');
      assert.ok(runner.isTransactionActive && !runner.isReleased, 'its transaction is left to the interceptor');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (!runner.isReleased) await runner.release();
    }
  }
}

async function testLargeImport() {
  const tables = lineImportTables('opex');
  const before = await analyzeCounts(tables);
  const { req, runner } = await openRequest();
  const [{ xid }] = await runner.query(`SELECT txid_current()::text AS xid`);
  try {
    await analyzeAfterLargeImport(req, tables, written(ANALYZE_AFTER_IMPORT_ROWS));
  } finally {
    if (!runner.isReleased) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }
  assert.equal(req.queryRunner, null, 'the request gave its runner back');
  assert.equal(req._tenantRunnerReleased, true, 'the interceptor finds it released');
  assert.ok(runner.isReleased && !runner.isTransactionActive, 'its runner is released');
  const [{ status }] = await dataSource.query(`SELECT txid_status($1::bigint) AS status`, [xid]);
  assert.equal(status, 'committed', 'its transaction was committed');
  assert.equal(await waitForBackgroundWork(Date.now() + 60000), 0, 'the ANALYZE finished');
  const after = await analyzeCounts(tables);
  for (const table of tables) assert.ok(after[table] > before[table], `${table} analysed (${before[table]} -> ${after[table]})`);
}

/** Only the tables the role owns are analysed (one transaction each); the others are reported, not counted as analysed. */
async function testSkippedTables() {
  const before = await analyzeCounts(['spend_items']);
  const report = await analyzeTables(dataSource, ['pg_class', 'spend_items', 'no_such_budget_table']);
  assert.deepEqual(report, { analysed: ['spend_items'], notOwned: ['pg_class'], missing: ['no_such_budget_table'], failed: [] });
  const after = await analyzeCounts(['spend_items']);
  assert.ok(after.spend_items > before.spend_items, 'the owned table is analysed');
}

void runSpecs('budget-import-statistics.integration.spec', [
  ['rows of the file written', testWrittenRows],
  ['below the threshold, a dry run, a refused file: nothing', testBelowThreshold],
  ['a large import: committed, then its tables analysed', testLargeImport],
  ['a table the role does not own, a missing table: skipped and reported', testSkippedTables],
]);
