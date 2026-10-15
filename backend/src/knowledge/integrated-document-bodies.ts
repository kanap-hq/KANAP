import type { CsvImportContext, CsvImportRow } from '../common/csv/csv-field.types';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { normalizeMarkdownRichText } from '../common/markdown-worker';
import { IntegratedDocumentSlotKey } from './integrated-document.constants';

/** The Markdown of the bound documents of some records, by record id then slot. No binding, no entry. */
export async function loadSlotBodies(
  manager: { query: (sql: string, params: unknown[]) => Promise<any[]> },
  tenantId: string,
  sourceEntityType: 'projects' | 'requests' | 'incidents',
  ids: string[],
  slots: IntegratedDocumentSlotKey[],
): Promise<Map<string, Map<string, string>>> {
  const bodies = new Map<string, Map<string, string>>();
  if (ids.length === 0) return bodies;
  const rows: Array<{ source_entity_id: string; slot_key: string; content_markdown: string | null }> = await manager.query(
    `SELECT b.source_entity_id::text AS source_entity_id, b.slot_key, d.content_markdown
     FROM integrated_document_bindings b
     JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1
       AND b.source_entity_type = $2
       AND b.source_entity_id = ANY($3::uuid[])
       AND b.slot_key = ANY($4::text[])`,
    [tenantId, sourceEntityType, ids, slots],
  );
  for (const row of rows) {
    if (!bodies.has(row.source_entity_id)) bodies.set(row.source_entity_id, new Map());
    bodies.get(row.source_entity_id)!.set(row.slot_key, row.content_markdown ?? '');
  }
  return bodies;
}

/**
 * Whether `value` says what the bound document says. Both sides are normalized as a write
 * normalizes them: a stored text saved before that normalization reads the same.
 */
export async function sameSlotBody(stored: string | undefined, value: unknown, fieldName: string): Promise<boolean> {
  if (stored === undefined) return false;
  if (value === stored || ((value === null || value === '') && stored === '')) return true;
  try {
    const next = (await normalizeMarkdownRichText(value, { fieldName })) || '';
    if (next === stored) return true;
    return next === ((await normalizeMarkdownRichText(stored, { fieldName, enforceSizeLimit: false })) || '');
  } catch {
    // Too large or too complex: the write refuses it, so it is not "unchanged".
    return false;
  }
}

/**
 * `sameAsStored` for a CSV import whose texts live in bound documents: each property in `slots`
 * is compared with its document and left out of the column comparison, the rest goes through
 * `normalize` (values as the commit stores them) and `sameStoredValues`. With `blankKeepsDocument`, a
 * blank cell leaves the document as it is (the incident review).
 */
export async function sameAsStoredWithDocuments(
  rows: CsvImportRow[],
  context: CsvImportContext,
  sourceEntityType: 'projects' | 'requests' | 'incidents',
  slots: Record<string, IntegratedDocumentSlotKey>,
  normalize: (next: Record<string, any>, stored: Record<string, any>) => void,
  opts: { blankKeepsDocument?: boolean } = {},
): Promise<boolean[]> {
  const bodies = await loadSlotBodies(
    context.manager, context.tenantId, sourceEntityType,
    rows.map((row) => row.existingEntity.id), Object.values(slots),
  );
  return Promise.all(rows.map(async (row) => {
    const next: Record<string, any> = { ...row.parsed };
    for (const [property, slot] of Object.entries(slots)) {
      const value = next[property];
      delete next[property];
      if (value === undefined) continue;
      if (opts.blankKeepsDocument && (value === null || String(value).trim() === '')) continue;
      if (!await sameSlotBody(bodies.get(row.existingEntity.id)?.get(slot), value, property)) return false;
    }
    try {
      normalize(next, row.existingEntity);
    } catch {
      return false;
    }
    return sameStoredValues(row.existingEntity, next);
  }));
}
