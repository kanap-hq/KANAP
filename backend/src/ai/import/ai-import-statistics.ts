import { importAnalyzeTables } from '../../spend/budget-file/import-file';
import { ANALYZE_AFTER_IMPORT_ROWS, writtenRows } from '../../spend/budget-import-statistics';
import type { AiMutationPreviewDto } from '../ai.types';

/**
 * The tables to analyse once an approval in Kad is committed (lot I5 of 26.11.9, T-I5d): Kad does
 * what the import dialog does (`analyzeAfterLargeImport`, `spend/budget-import-statistics.ts`).
 * A budget file load this approval executed, which wrote at least ANALYZE_AFTER_IMPORT_ROWS rows of
 * its file, has the dialog's tables analysed: the line tables, the suppliers and the dimension values
 * when it created some (`importAnalyzeTables`). The dialog analyses after the budget file only: a row
 * import (applications, suppliers, ...) analyses nothing, here either.
 *
 * `previews`: the cards as the approval answered them. A card counts only when it is executed and its
 * execution is this approval's (`executed_at` from `approvedSince` on): a card executed by an earlier
 * approval comes back as it is, and its load was analysed then. Every budget file is read with the
 * scope `opex`: Kad loads the one file of both natures through the OPEX route's service, and both
 * natures write the same tables.
 */
export function importTablesToAnalyze(previews: readonly AiMutationPreviewDto[], approvedSince: number): string[] {
  const tables = new Set<string>();
  for (const preview of previews) {
    const mapping = preview.import_mapping;
    const result = mapping?.result;
    if (preview.status !== 'executed' || mapping?.import_key !== 'budget_lines' || !result) continue;
    if (!preview.executed_at || Date.parse(preview.executed_at) < approvedSince) continue;
    const written = writtenRows({ ok: result.ok, dryRun: result.dry_run, inserted: result.inserted, updated: result.updated });
    if (written < ANALYZE_AFTER_IMPORT_ROWS) continue;
    const created = { createdSuppliers: result.created_suppliers === true, createdDimensionValues: result.created_dimension_values === true };
    for (const table of importAnalyzeTables('opex', created)) tables.add(table);
  }
  return [...tables];
}
