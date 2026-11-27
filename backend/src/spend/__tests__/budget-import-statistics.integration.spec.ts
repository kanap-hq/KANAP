import 'dotenv/config';
import { Logger } from '@nestjs/common';
import dataSource from '../../data-source';
import { backgroundWorkCount, waitForBackgroundWork } from '../../common/background-work';
import { DATA_ACCESS_SYNC_LOCK } from '../../data-access/data-access-availability';
import {
  analyzeAfterLargeImport,
  analyzeTables,
  ANALYZE_AFTER_IMPORT_ROWS,
  lineImportTables,
  writtenRows,
} from '../budget-import-statistics';
import { assert, runSpecs } from './round-inputs.fixtures';
import { DemoDataService } from '../../demo-data/demo-data.service';

// Statistics after a large budget import (plan planning/perf-scale, item 4C bis;
// budget-import-statistics.ts), against the database: below the threshold, a dry run or a
// refused file leave the request's transaction to the interceptor; a large import commits it,
// gives its connection back, and ANALYZE then runs on the tables it writes, in the background,
// one transaction per table; a table the role does not own or that does not exist is skipped
// and reported, never logged as analysed. Lot B12b: a sample data load ends with the same ANALYZE
// (`DemoDataService.analyzeAfterLoad`, tracked as background work, never rejecting); an ANALYZE waits
// for an autovacuum that holds its table (PostgreSQL cancels it after `deadlock_timeout`), skips its
// table while the data access policies are synchronised (the sync's advisory lock), and gives up on a
// lock held past 5 s. The sync against an ANALYZE, replayed: no deadlock.
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
  assert.deepEqual(report, { analysed: ['spend_items'], notOwned: ['pg_class'], missing: ['no_such_budget_table'], busy: [], failed: [] });
  const after = await analyzeCounts(['spend_items']);
  assert.ok(after.spend_items > before.spend_items, 'the owned table is analysed');
}

/** A sample data load: the budget tables analysed once it is done, in the background, without failing it. */
async function testAfterSampleData() {
  const tables = lineImportTables('opex');
  const before = await analyzeCounts(tables);
  const warnings: string[] = [];
  const service = { dataSource, logger: { warn: (line: string) => warnings.push(line), log: () => undefined } };
  const started = Date.now();
  // The log line names the sample data load, not an import.
  const logged: string[] = [];
  const log = Logger.prototype.log;
  Logger.prototype.log = function (this: Logger, message: any, ...rest: any[]) {
    logged.push(String(message));
    return log.call(this, message, ...rest);
  };
  let elapsed: number;
  try {
    // Private to the service: called as its load calls it, once the loader is done.
    const returned = (DemoDataService.prototype as any).analyzeAfterLoad.call(service);
    assert.ok(backgroundWorkCount() > 0, 'tracked as background work: a stop waits for it');
    assert.equal(await waitForBackgroundWork(Date.now() + 60000), 0, 'tracked as background work, and finished');
    await returned;
    elapsed = Date.now() - started;
  } finally {
    Logger.prototype.log = log;
  }
  assert.ok(logged.some((line) => line.startsWith('ANALYZE after a sample data load: spend_items')), `the log says what wrote the tables: ${logged.join(' | ')}`);
  const after = await analyzeCounts(tables);
  for (const table of tables) assert.ok(after[table] > before[table], `${table} analysed (${before[table]} -> ${after[table]})`);
  assert.deepEqual(warnings, [], 'no failure');
  console.log(`  ANALYZE of ${tables.join(', ')} after a sample data load: ${elapsed} ms`);
}

/** A connection of its own holding `lock` (SQL run in its transaction) until `release()`. */
async function holdLock(sql: string, params: unknown[] = []) {
  const holder = dataSource.createQueryRunner();
  await holder.connect();
  await holder.startTransaction();
  await holder.query(sql, params);
  return async () => {
    await holder.rollbackTransaction().catch(() => undefined);
    await holder.release();
  };
}

/**
 * An autovacuum on the table holds the lock an ANALYZE needs, and PostgreSQL cancels it once it has
 * blocked another session for `deadlock_timeout`: the ANALYZE waits past that and runs. Here the lock
 * is held as long (a little more than `deadlock_timeout`), then let go.
 */
async function testWaitsPastAnAutovacuum() {
  const [{ ms }] = await dataSource.query(`SELECT setting::int AS ms FROM pg_settings WHERE name = 'deadlock_timeout'`);
  const release = await holdLock('LOCK TABLE spend_items IN SHARE UPDATE EXCLUSIVE MODE');
  const held = Number(ms) + 200;
  const timer = setTimeout(() => void release(), held);
  try {
    const started = Date.now();
    const report = await analyzeTables(dataSource, ['spend_items']);
    const waited = Date.now() - started;
    assert.deepEqual([report.analysed, report.failed], [['spend_items'], []], 'analysed once the lock was let go');
    assert.ok(waited >= held - 50, `waited ${waited} ms, past deadlock_timeout (${ms} ms)`);
  } finally {
    clearTimeout(timer);
    await release().catch(() => undefined);
  }
}

/** A lock held past the ANALYZE's 5 s: it gives up, reports the table, never throws. */
async function testGivesUpOnALongLock() {
  const release = await holdLock('LOCK TABLE spend_items IN SHARE UPDATE EXCLUSIVE MODE');
  try {
    const started = Date.now();
    const report = await analyzeTables(dataSource, ['spend_items']);
    const waited = Date.now() - started;
    assert.deepEqual([report.analysed, report.failed], [[], ['spend_items (55P03)']], 'gave up on the lock, reported');
    assert.ok(waited >= 4900 && waited < 8000, `gave up after ${waited} ms`);
  } finally {
    await release();
  }
}

/** While the data access policies are synchronised (the sync's advisory lock held), the ANALYZE skips its table at once. */
async function testSkipsWhileTheSyncRuns() {
  const release = await holdLock(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [DATA_ACCESS_SYNC_LOCK]);
  const warnings: string[] = [];
  const warn = Logger.prototype.warn;
  Logger.prototype.warn = function (this: Logger, message: any) { warnings.push(String(message)); };
  try {
    const started = Date.now();
    const report = await analyzeTables(dataSource, ['spend_items', 'spend_versions']);
    const waited = Date.now() - started;
    assert.deepEqual([report.analysed, report.busy, report.failed], [[], ['spend_items', 'spend_versions'], []], 'skipped, reported');
    assert.ok(waited < 1000, `skipped at once (${waited} ms)`);
    assert.ok(warnings.some((line) => /skipped spend_items, spend_versions: the data access policies were being synchronised/.test(line)), `logged: ${warnings.join(' | ')}`);
  } finally {
    Logger.prototype.warn = warn;
    await release();
  }
  const report = await analyzeTables(dataSource, ['spend_items']);
  assert.deepEqual(report.analysed, ['spend_items'], 'the lock let go: analysed');
}

/**
 * The reviewer's probe of lot B12b, replayed: a transaction does what `data_access_sync_policies()`
 * does to a table (a grant, which updates its `pg_class` row, then its policies, which take the
 * table's exclusive lock) while an ANALYZE of the table starts in between. Without the sync's lock
 * the two wait for each other and PostgreSQL cancels one (deadlock); with it, twenty times, none:
 * the ANALYZE skips its turn or the sync waits for it.
 */
async function testNoDeadlockWithTheSync() {
  const [{ present }] = await dataSource.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`);
  if (!present) {
    if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
    console.log('  skip - kanap_data_limited not installed');
    return;
  }
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const trial = async (withLock: boolean, analyzeAfterMs: number) => {
    const sync = dataSource.createQueryRunner();
    await sync.connect();
    let syncError: string | null = null;
    let report: Awaited<ReturnType<typeof analyzeTables>> | null = null;
    try {
      await sync.startTransaction();
      const run = (async () => {
        try {
          await sync.query(`SET LOCAL lock_timeout = '5s'`);
          if (withLock) await sync.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [DATA_ACCESS_SYNC_LOCK]);
          await sync.query(`GRANT SELECT ON spend_items TO kanap_data_limited`);
          await sync.query(`SELECT pg_sleep(0.4)`);
          await sync.query(`LOCK TABLE spend_items IN ACCESS EXCLUSIVE MODE`);
        } catch (error) {
          syncError = (error as any)?.driverError?.code ?? (error as any)?.code ?? String(error);
        }
      })();
      await pause(analyzeAfterMs);
      report = await analyzeTables(dataSource, ['spend_items']);
      await run;
    } finally {
      await sync.rollbackTransaction().catch(() => undefined);
      await sync.release();
    }
    return { syncError, report: report! };
  };

  // PostgreSQL cancels one side of a deadlock with 40P01: the sync's error, or the ANALYZE's report.
  const control = await trial(false, 150);
  assert.ok(control.syncError === '40P01' || control.report.failed.some((f) => f.includes('40P01')),
    `without the lock, the probe deadlocks (sync ${control.syncError}, ANALYZE ${JSON.stringify(control.report)})`);

  const outcomes: string[] = [];
  for (let n = 0; n < 20; n += 1) {
    const { syncError, report } = await trial(true, 20 + (n % 10) * 35);
    assert.equal(syncError, null, `trial ${n + 1}: the sync went through`);
    assert.equal(report.failed.length, 0, `trial ${n + 1}: the ANALYZE did not fail (${report.failed.join(', ')})`);
    outcomes.push(report.busy.length ? 'skipped' : 'analysed');
  }
  console.log(`  the sync against an ANALYZE: control deadlocked; with the lock, 20 trials: ${outcomes.filter((o) => o === 'skipped').length} skipped, ${outcomes.filter((o) => o === 'analysed').length} analysed, no deadlock`);
}

void runSpecs('budget-import-statistics.integration.spec', [
  ['rows of the file written', testWrittenRows],
  ['below the threshold, a dry run, a refused file: nothing', testBelowThreshold],
  ['a large import: committed, then its tables analysed', testLargeImport],
  ['a table the role does not own, a missing table: skipped and reported', testSkippedTables],
  ['a sample data load: its tables analysed in the background', testAfterSampleData],
  ['an autovacuum on the table: waited for, then analysed', testWaitsPastAnAutovacuum],
  ['a lock held past 5 s: given up, reported', testGivesUpOnALongLock],
  ['the data access sync running: skipped at once, logged', testSkipsWhileTheSyncRuns],
  ['the sync against an ANALYZE, twenty times: no deadlock', testNoDeadlockWithTheSync],
]);
