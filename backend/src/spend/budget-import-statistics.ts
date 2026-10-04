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
 * does not wait for it, a stop does (`trackBackgroundWork`). One short transaction per table:
 * ANALYZE reads a sample of it (30,000 rows at most with the default target), blocks no read or
 * write, and gives up after 5 s waiting for its lock (another ANALYZE or VACUUM on it). A table
 * the KANAP role does not own is skipped and named in the log. It runs after the
 * commit, outside the request transaction: inside it, ANALYZE would hold its table locks until
 * the import commits and delay the answer, and an import that then failed would leave row
 * counts that include its rolled-back rows (ANALYZE writes them in place, whatever becomes of
 * its transaction). A failure is a warning: autovacuum analyses the tables later anyway.
 *
 * It is the last call of the budget file load routes (`POST /spend-items/budget-file/import`
 * and the CAPEX twin).
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

export type AnalyzeReport = { analysed: string[]; notOwned: string[]; missing: string[]; failed: string[] };

const errorCode = (error: unknown) => (error as any)?.driverError?.code ?? (error as any)?.code ?? (error as Error)?.message;

/**
 * ANALYZE of each of `tables` the current role may analyse, one short transaction per table (a
 * table's lock is held only while it is sampled). A table the role does not own (the same check
 * as 1853820000000: owner or member of the owner role) or that does not exist is skipped and
 * logged; PostgreSQL would only warn and skip it. Never throws.
 */
export async function analyzeTables(dataSource: DataSource, tables: readonly string[]): Promise<AnalyzeReport> {
  const started = Date.now();
  const report: AnalyzeReport = { analysed: [], notOwned: [], missing: [], failed: [] };
  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    const states: Array<{ name: string; present: boolean; owned: boolean }> = await runner.query(
      `SELECT t.name, c.oid IS NOT NULL AS present, COALESCE(pg_has_role(current_user, c.relowner, 'USAGE'), false) AS owned
         FROM unnest($1::text[]) WITH ORDINALITY AS t(name, n)
         LEFT JOIN pg_class c ON c.oid = to_regclass(t.name)
        ORDER BY t.n`,
      [tables],
    );
    for (const state of states) {
      if (!state.present) { report.missing.push(state.name); continue; }
      if (!state.owned) { report.notOwned.push(state.name); continue; }
      try {
        await runner.startTransaction();
        await runner.query(`SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)`, [LOCK_TIMEOUT, STATEMENT_TIMEOUT]);
        await runner.query(`ANALYZE ${state.name}`);
        await runner.commitTransaction();
        report.analysed.push(state.name);
      } catch (error) {
        if (runner.isTransactionActive && !runner.isReleased) await runner.rollbackTransaction().catch(() => undefined);
        report.failed.push(`${state.name} (${errorCode(error)})`);
        if (runner.isReleased) break;
      }
    }
  } catch (error) {
    report.failed.push(`(${errorCode(error)})`);
  } finally {
    if (!runner.isReleased) await runner.release().catch(() => undefined);
  }
  if (report.analysed.length) logger.log(`ANALYZE after a large import: ${report.analysed.join(', ')} (${Date.now() - started} ms)`);
  if (report.notOwned.length) {
    logger.warn(`ANALYZE after a large import skipped ${report.notOwned.join(', ')}: the KANAP role does not own them (as their owner: ANALYZE ${report.notOwned.join(', ')}); autovacuum will analyse them`);
  }
  if (report.missing.length) logger.warn(`ANALYZE after a large import: no table ${report.missing.join(', ')}`);
  if (report.failed.length) logger.warn(`ANALYZE after a large import did not run for ${report.failed.join(', ')}; autovacuum will analyse them`);
  return report;
}
