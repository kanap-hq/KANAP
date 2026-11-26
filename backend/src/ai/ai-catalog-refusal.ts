import { BadRequestException } from '@nestjs/common';
import { catalogRefusalDetailOf, type CatalogRefusalDetail } from '../it-ops-settings/catalog-resolve';
import type { AiCatalogListName, AiCodeNamer } from './ai-code-names';

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
