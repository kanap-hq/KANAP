import { BadRequestException } from '@nestjs/common';
import { catalogRefusalDetailOf, type CatalogRefusalDetail } from '../it-ops-settings/catalog-resolve';
import type { AiCatalogListName, AiCodeNamer } from './ai-code-names';
import { aiBusinessRecordCatalogList } from './mutation/ai-business-record-mutation-support.service';

/**
 * A refusal of a catalog value (rule P7, `catalogValueRefusal`) as Plaid reads it: the refused value
 * and the values the record may take by the names the screen's selector shows, in the person's
 * language, through Plaid's own naming (`AiCodeNamer`), without their codes. A name two values share
 * keeps its code, so the model can still tell them apart. The response (its code and params) stays
 * as the API answers it; only the sentence the model reads changes. Null for any other error.
 */
export function catalogRefusalForModel(error: unknown, namer: AiCodeNamer): BadRequestException | null {
  const detail = catalogRefusalDetailOf(error);
  if (!detail || !(error instanceof BadRequestException)) return null;
  const nameOf = (entry: { code: string; label?: string | null }) => catalogName(detail, entry, namer);
  const names = detail.offered.map(nameOf);
  const shared = new Set(names.filter((name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) !== index).map((name) => name.toLowerCase()));
  const allowed = detail.offered
    .map((entry, index) => (shared.has(names[index].toLowerCase()) ? `${names[index]} (${entry.code})` : names[index]))
    .join(', ');
  const value = detail.retired && detail.valueCode ? nameOf({ code: detail.valueCode, label: detail.value }) : detail.value;
  const message = detail.retired
    ? `The ${detail.what} "${value}" is retired: only a record that already holds it keeps it. Use one of: ${allowed}.`
    : value
      ? `Unknown ${detail.what} "${value}". Use one of: ${allowed}.`
      : `The ${detail.what} is required. Use one of: ${allowed}.`;
  const response = error.getResponse();
  const kept = typeof response === 'object' && response ? response as Record<string, unknown> : {};
  // The refusal keeps its code (a plain sentence gets the shared one): only its sentence changes.
  const code = kept.code ?? (detail.retired ? 'catalog_value_retired' : 'catalog_value_unknown');
  return Object.assign(new BadRequestException({ ...kept, code, message }), { catalogRefusal: detail });
}

function catalogName(detail: CatalogRefusalDetail, entry: { code: string; label?: string | null }, namer: AiCodeNamer): string {
  const named = detail.list ? namer.name({ kind: 'catalog', list: detail.list as AiCatalogListName }, entry.code) : null;
  return named || String(entry.label || '').trim() || entry.code;
}

const PREVIEW_LIST_KEYS = ['previews', 'results', 'followUpPreviews'] as const;

/** Whether a tool result holds a preview whose card shows a catalog code (`previewCatalogNamesForModel`). */
export function hasPreviewCatalogCodes(result: unknown): boolean {
  return previewsOf(result).some((preview) => catalogChanges(preview).length > 0);
}

/**
 * A preview result as Plaid reads it: a value the card shows as a catalog code (the frontend names it
 * in the person's language) reaches the model by the same name, without its code. The user's card and
 * the stored preview keep the code: the server writes by code. A code the catalog does not name stays.
 */
export function previewCatalogNamesForModel(result: unknown, namer: AiCodeNamer): unknown {
  if (!hasPreviewCatalogCodes(result)) return result;
  const named = (preview: Record<string, any>) => {
    const changes = { ...preview.changes };
    for (const [field, catalog] of catalogChanges(preview)) {
      const nameOf = (value: unknown) => {
        if (typeof value !== 'string' || !value) return value;
        const codes = catalog.many ? value.split(', ') : [value];
        return codes
          .map((code) => namer.name({ kind: 'catalog', list: catalog.list as AiCatalogListName }, code) || code)
          .join(', ');
      };
      changes[field] = { ...changes[field], from: nameOf(changes[field].from), to: nameOf(changes[field].to) };
    }
    return { ...preview, changes };
  };
  if (isPreview(result)) return named(result);
  const record = { ...(result as Record<string, unknown>) };
  for (const key of PREVIEW_LIST_KEYS) {
    if (Array.isArray(record[key])) {
      record[key] = (record[key] as unknown[]).map((entry) => (isPreview(entry) ? named(entry) : entry));
    }
  }
  return record;
}

function isPreview(value: unknown): value is Record<string, any> {
  const candidate = value as Record<string, any> | null;
  return !!candidate && typeof candidate === 'object' && typeof candidate.preview_id === 'string'
    && !!candidate.changes && typeof candidate.changes === 'object' && typeof candidate.target?.entity_type === 'string';
}

function previewsOf(result: unknown): Array<Record<string, any>> {
  if (isPreview(result)) return [result];
  if (!result || typeof result !== 'object') return [];
  return PREVIEW_LIST_KEYS.flatMap((key) => {
    const value = (result as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.filter(isPreview) : [];
  });
}

function catalogChanges(preview: Record<string, any>): Array<[string, { list: string; many: boolean }]> {
  return Object.keys(preview.changes).flatMap((field) => {
    const catalog = aiBusinessRecordCatalogList(preview.target.entity_type, field);
    return catalog && preview.changes[field] && typeof preview.changes[field] === 'object' ? [[field, catalog] as [string, { list: string; many: boolean }]] : [];
  });
}
