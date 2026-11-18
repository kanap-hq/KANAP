import type { CsvImportContext, CsvSettledRow } from '../common/csv/csv-field.types';
import { loadSlotBodies } from '../knowledge/integrated-document-bodies';
import type { IntegratedDocumentSlotKey } from '../knowledge/integrated-document.constants';

/**
 * `settleRows` of the projects and requests imports (lot I6 of 26.11.9): the record a row updates
 * carries, as the stored value of each text that lives in a bound document (the purpose, the risks),
 * that document's text, never the table's column of the same name, which the documents replaced and
 * nothing writes any more. The clearing rule then reads the documents: a blank cell, or a file without
 * the column, writes the document's own text back (no change); `-` empties it, and the check counts it
 * when it held a text. A record with no document reads as empty.
 */
export async function settleWithSlotBodies(
  rows: Array<{ found: any | null }>,
  context: CsvImportContext,
  sourceEntityType: 'projects' | 'requests',
  slots: Record<string, IntegratedDocumentSlotKey>,
): Promise<CsvSettledRow[]> {
  const ids = rows.flatMap((row) => (row.found ? [String(row.found.id)] : []));
  const bodies = await loadSlotBodies(context.manager, context.tenantId, sourceEntityType, ids, Object.values(slots));
  return rows.map((row) => {
    if (!row.found) return { entity: null };
    const entity = { ...row.found };
    for (const [property, slot] of Object.entries(slots)) entity[property] = bodies.get(String(row.found.id))?.get(slot) ?? null;
    return { entity };
  });
}
