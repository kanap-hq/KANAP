import type { CsvImportContext, CsvSettledRow } from '../common/csv/csv-field.types';
import { prepareRecoveredContent } from '../common/markdown-worker';
import { loadSlotBodies } from '../knowledge/integrated-document-bodies';
import type { IntegratedDocumentSlotKey } from '../knowledge/integrated-document.constants';
import type { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';

/**
 * `settleRows` of the projects and requests imports (lot I6 of 26.11.9): the record a row updates
 * carries, as the stored value of each text that lives in a bound document (the purpose, the risks),
 * that document's text, never the table's column of the same name, which the documents replaced and
 * nothing writes any more. The clearing rule then reads the documents: a blank cell, or a file without
 * the column, writes the document's own text back (no change); `-` empties it, and the check counts it
 * when it held a text. A record with no document yet (older than the documents, never opened since)
 * still holds its text in that column, which the screen turns into its document when opened: the
 * import reads it there (pass G), as the Markdown the screen makes of it (`prepareRecoveredContent`:
 * a text saved as HTML converted, pass H), and a load that writes the record first repairs it as the
 * screen does (`repairBeforeSlotWrite`).
 */
export async function settleWithSlotBodies(
  rows: Array<{ found: any | null }>,
  context: CsvImportContext,
  sourceEntityType: 'projects' | 'requests',
  slots: Record<string, IntegratedDocumentSlotKey>,
): Promise<CsvSettledRow[]> {
  const ids = rows.flatMap((row) => (row.found ? [String(row.found.id)] : []));
  const bodies = await loadSlotBodies(context.manager, context.tenantId, sourceEntityType, ids, Object.values(slots));
  return Promise.all(rows.map(async (row) => {
    if (!row.found) return { entity: null };
    const entity = { ...row.found };
    for (const [property, slot] of Object.entries(slots)) {
      entity[property] = bodies.get(String(row.found.id))?.get(slot) ?? await prepareRecoveredContent(row.found[property]);
    }
    return { entity };
  }));
}

/**
 * At the load, before a row that updates a record writes the text of `slot` (pass H): a record with
 * no document for it yet first gets the one the screen makes when it opens the record
 * (`repairSourceSlot`: the column's text as Markdown, its inline images migrated). Returns whether the
 * row's value is still to be written: not when it is the text the import read for that record
 * (`stored`, by `settleWithSlotBodies`), which the repaired document now holds.
 */
export async function repairBeforeSlotWrite(
  documents: IntegratedDocumentsService,
  sourceEntityType: 'projects' | 'requests',
  recordId: string,
  slot: IntegratedDocumentSlotKey,
  value: unknown,
  stored: unknown,
  context: CsvImportContext,
): Promise<boolean> {
  const repaired = await documents.repairSourceSlot(sourceEntityType, recordId, slot, {
    manager: context.manager,
    actorUserId: context.userId ?? null,
    audit: context.audit,
  });
  return !repaired.created || (value ?? '') !== (stored ?? '');
}
