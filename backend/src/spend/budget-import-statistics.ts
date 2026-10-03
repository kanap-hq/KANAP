import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { trackBackgroundWork } from '../common/background-work';
import { createRequestCommitThenRun } from '../common/import-connection';

/**
 * Planner statistics after a large budget import (plan planning/perf-scale, item 4C bis).
 *
 * Why: a first import on a new tenant (an on-premise install, a tenant reloaded after a purge)
 * fills tables whose statistics were taken while they were small or empty. Until autovacuum
 * analyses them again (a minute or more after the commit, and never when the import changed
 * less than 10% of a large shared table), the planner reads them as a few rows: lists and
 * reports pick nested loops over thousands of rows (lot 2A measured 74 ms instead of 8 ms for
 * a list of 300 lines). The budget triggers no longer depend on these statistics (migration
 * 1853850000000); the reads after the import still do.
 *
 * How: once the import has written at least ANALYZE_AFTER_IMPORT_ROWS rows of its file, the
 * request's transaction is committed and its connection given back before the answer goes out
 * (`createRequestCommitThenRun`, as the user invitation does), then `ANALYZE` runs on the
 * tables the import writes, on a pooled connection of its own, in the background: the answer
 * does not wait for it, a stop does (`trackBackgroundWork`). ANALYZE reads a sample of each
 * table (30,000 rows at most with the default target), blocks no read or write, and gives up
 * after 5 s waiting for a table's lock (another ANALYZE or VACUUM on it). It runs after the
 * commit, outside the request transaction: inside it, ANALYZE would hold its table locks until
 * the import commits and delay the answer, and an import that then failed would leave row
 * counts that include its rolled-back rows (ANALYZE writes them in place, whatever becomes of
 * its transaction). A failure is a warning: autovacuum analyses the tables later anyway. A
 * role that does not own the tables gets a warning from PostgreSQL and nothing is analysed.
 *
 * The CSV project rewrites the importers (decision D6); this stays a call at the end of the
 * three import routes (budget rows, OPEX lines, CAPEX lines).
 */
export const ANALYZE_AFTER_IMPORT_ROWS = 1000;

const LOCK_TIMEOUT = '5s';
const STATEMENT_TIMEOUT = '5min';

const logger = new Logger('BudgetImportStatistics');

type Scope = 'opex' | 'capex';

const BUDGET_TABLES: Record<Scope, readonly string[]> = {
  opex: ['spend_versions', 'spend_amounts', 'spend_round_inputs', 'spend_version_totals'],
  capex: ['capex_versions', 'capex_amounts', 'capex_round_inputs', 'capex_version_totals'],
};

const LINE_TABLES: Record<Scope, readonly string[]> = {
  opex: ['spend_items', 'spend_item_analytics_values'],
  capex: ['capex_items', 'capex_item_analytics_values'],
};

/** What the budget rows import writes: versions, months, round inputs and totals of both types. */
export const BUDGET_ROWS_IMPORT_TABLES: readonly string[] = [...BUDGET_TABLES.opex, ...BUDGET_TABLES.capex];

/** What a line import writes: the lines, their analytics values, and their budget tables. */
export function lineImportTables(scope: Scope): readonly string[] {
  return [...LINE_TABLES[scope], ...BUDGET_TABLES[scope]];
}

type ImportResult = { ok?: boolean; dryRun?: boolean; inserted?: number; updated?: number } | null | undefined;

/** Rows of the file the import wrote (inserted or updated): none for a dry run or a refused file. */
export function writtenRows(result: ImportResult): number {
  if (!result || result.ok === false || result.dryRun !== false) return 0;
  return (Number(result.inserted) || 0) + (Number(result.updated) || 0);
}

/**
 * Call last in an import route, with the request and the import's result: below the threshold
 * it does nothing (the interceptor commits as usual); above it, it commits the request and
 * starts the ANALYZE. The route must not query after it.
 */
export async function analyzeAfterLargeImport(req: any, tables: readonly string[], result: ImportResult): Promise<void> {
  if (writtenRows(result) < ANALYZE_AFTER_IMPORT_ROWS) return;
  const dataSource: DataSource | undefined = req?.queryRunner?.connection;
  if (!dataSource) return;
  await createRequestCommitThenRun(req)(async () => {
    void trackBackgroundWork(analyzeTables(dataSource, tables));
  });
}

/** ANALYZE of `tables` in one short transaction of its own; never throws. */
export async function analyzeTables(dataSource: DataSource, tables: readonly string[]): Promise<void> {
  const started = Date.now();
  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    await runner.query(`SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)`, [LOCK_TIMEOUT, STATEMENT_TIMEOUT]);
    await runner.query(`ANALYZE ${tables.join(', ')}`);
    await runner.commitTransaction();
    logger.log(`ANALYZE after a large import: ${tables.join(', ')} (${Date.now() - started} ms)`);
  } catch (error) {
    if (runner.isTransactionActive && !runner.isReleased) await runner.rollbackTransaction().catch(() => undefined);
    const code = (error as any)?.driverError?.code ?? (error as any)?.code;
    logger.warn(`ANALYZE after a large import did not run (${code ?? (error as Error)?.message}); autovacuum will analyse ${tables.join(', ')}`);
  } finally {
    if (!runner.isReleased) await runner.release().catch(() => undefined);
  }
}
