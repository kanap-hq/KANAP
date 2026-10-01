import { BadRequestException } from '@nestjs/common';
import { catalogAliases, normalizeTranslations, type CatalogTranslations } from './catalog-codes';

export type ClassificationLevel = { code: string; label: string; description: string; rank: number; deprecated?: boolean; translations?: CatalogTranslations };
export type BusinessCriticalityLevel = ClassificationLevel & { maxMtdMinutes: number | null };
export type RecoveryWave = Omit<ClassificationLevel, 'rank'> & { order: number };
export type ClassificationCatalog = {
  businessCriticalityLevels: BusinessCriticalityLevel[];
  cyberCriticalityLevels: ClassificationLevel[];
  dataClasses: ClassificationLevel[];
  recoveryWaves: RecoveryWave[];
};

// Versioned defaults: migration materializes these values; edits to software defaults
// must never alter an existing tenant's catalog. Levels are listed from most to least severe;
// waves in restoration order. Ranks/orders are derived from that position on every write.
export const DEFAULT_CLASSIFICATION_CATALOG: ClassificationCatalog = {
  businessCriticalityLevels: [
    { code: 'business_critical', label: 'Critical', description: 'The activity tolerates at most four hours of interruption.', rank: 4, maxMtdMinutes: 240 },
    { code: 'high', label: 'High', description: 'The activity tolerates more than four hours, up to one day of interruption.', rank: 3, maxMtdMinutes: 1440 },
    { code: 'medium', label: 'Moderate', description: 'The activity tolerates more than one day, up to three days of interruption.', rank: 2, maxMtdMinutes: 4320 },
    { code: 'low', label: 'Low', description: 'The activity tolerates more than three days of interruption.', rank: 1, maxMtdMinutes: null },
  ],
  cyberCriticalityLevels: [
    { code: 'critical', label: 'Critical', description: 'Catastrophic consequences, serious harm to people or the environment, or widespread compromise of information systems.', rank: 4 },
    { code: 'high', label: 'High', description: 'Major harm to data, an important activity or several systems.', rank: 3 },
    { code: 'moderate', label: 'Moderate', description: 'Significant but contained harm.', rank: 2 },
    { code: 'low', label: 'Low', description: 'Limited, local consequences of a compromise.', rank: 1 },
  ],
  dataClasses: [
    { code: 'restricted', label: 'Restricted', description: 'Disclosure could cause severe harm; access is strictly limited to those who need it.', rank: 4 },
    { code: 'confidential', label: 'Confidential', description: 'Disclosure could cause significant harm; access is limited to authorised recipients.', rank: 3 },
    { code: 'internal', label: 'Internal', description: 'Information intended for internal use; disclosure has limited consequences.', rank: 2 },
    { code: 'public', label: 'Public', description: 'Information approved for public disclosure.', rank: 1 },
  ],
  recoveryWaves: [
    { code: 'foundation', label: 'V0 — Foundation', description: 'Shared prerequisites and foundation services.', order: 0 },
    { code: 'vital', label: 'V1 — Vital activities', description: 'Restore vital activities after their prerequisites.', order: 1 },
    { code: 'priority', label: 'V2 — Priority activities', description: 'Restore priority activities.', order: 2 },
    { code: 'normal', label: 'V3 — Normal operation', description: 'Return to normal operation.', order: 3 },
  ],
};

export const CLASSIFICATION_CATALOG_KEYS = ['businessCriticalityLevels', 'cyberCriticalityLevels', 'dataClasses', 'recoveryWaves'] as const;
export const CATALOG_METADATA_KEYS = {
  businessCriticalityLevels: 'business_criticality_levels', cyberCriticalityLevels: 'cyber_criticality_levels',
  dataClasses: 'data_classes', recoveryWaves: 'recovery_waves',
} as const;
/** Metadata keys written by earlier builds of this feature; removed whenever the catalog is persisted. */
export const OBSOLETE_CATALOG_METADATA_KEYS = ['business_mtd_presets', 'classification_versions', 'classification_settings_revision', 'classification_anomalies'] as const;

/** Read order is the display order: levels from most to least severe, waves in restoration order. */
export function sortCatalog(catalog: ClassificationCatalog): ClassificationCatalog {
  return {
    businessCriticalityLevels: [...catalog.businessCriticalityLevels].sort((a, b) => b.rank - a.rank),
    cyberCriticalityLevels: [...catalog.cyberCriticalityLevels].sort((a, b) => b.rank - a.rank),
    dataClasses: [...catalog.dataClasses].sort((a, b) => b.rank - a.rank),
    recoveryWaves: [...catalog.recoveryWaves].sort((a, b) => a.order - b.order),
  };
}

export function catalogFromMetadata(raw: Record<string, any> = {}): ClassificationCatalog {
  const result = structuredClone(DEFAULT_CLASSIFICATION_CATALOG);
  for (const key of CLASSIFICATION_CATALOG_KEYS) {
    if (raw[CATALOG_METADATA_KEYS[key]] !== undefined) (result as any)[key] = structuredClone(raw[CATALOG_METADATA_KEYS[key]]);
  }
  // Preserve the old confidentiality order when upgrading a customised tenant.
  result.dataClasses = result.dataClasses.map((item, index) => ({ ...item, rank: item.rank ?? index + 1, description: item.description ?? DEFAULT_CLASSIFICATION_CATALOG.dataClasses.find((d) => d.code === item.code)?.description ?? '' }));
  return sortCatalog(result);
}

export function catalogToMetadata(catalog: ClassificationCatalog): Record<string, unknown> {
  return Object.fromEntries(CLASSIFICATION_CATALOG_KEYS.map((key) => [CATALOG_METADATA_KEYS[key], catalog[key]]));
}

export function validateDuration(value: unknown, field: string, allowZero = false): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 2147483647) {
    throw new BadRequestException(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer number of minutes, at most 2147483647, or null`);
  }
  return value;
}

/**
 * Validates a catalog and assigns ranks/orders from array position: the first level is the most
 * severe, the first wave is restored first. Incoming rank/order values are ignored.
 */
export function validateClassificationCatalog(catalog: ClassificationCatalog): ClassificationCatalog {
  const next = structuredClone(catalog);
  for (const key of CLASSIFICATION_CATALOG_KEYS) {
    const list = next[key];
    if (!Array.isArray(list) || list.length === 0 || list.length > 100) throw new BadRequestException(`${key} requires 1 to 100 options`);
    const codes = new Set<string>();
    const labels = new Set<string>();
    list.forEach((item: any, index) => {
      if (typeof item.code !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(item.code) || codes.has(item.code)) throw new BadRequestException(`${key}: codes must be unique, stable lowercase identifiers`);
      codes.add(item.code);
      if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 200 || typeof item.description !== 'string' || item.description.length > 4000) throw new BadRequestException(`${key}: label and description are required strings`);
      const label = item.label.trim().toLowerCase();
      if (labels.has(label)) throw new BadRequestException(`${key}: names must be unique`);
      labels.add(label);
      if (item.deprecated !== undefined && typeof item.deprecated !== 'boolean') throw new BadRequestException(`${key}: deprecated must be boolean`);
      item.label = item.label.trim();
      item.description = item.description.trim();
      const translations = normalizeTranslations(item.translations);
      if (translations) item.translations = translations; else delete item.translations;
      if (key === 'recoveryWaves') { delete item.rank; item.order = index; }
      else { delete item.order; item.rank = list.length - index; }
      if (key === 'businessCriticalityLevels') item.maxMtdMinutes = validateDuration(item.maxMtdMinutes ?? null, 'maxMtdMinutes');
    });
    if (!list.some((item) => !item.deprecated)) throw new BadRequestException(`${key}: at least one active option is required`);
  }
  return next;
}

export function resolveClassificationOption(value: unknown, options: Array<{ code: string; label: string; deprecated?: boolean; translations?: CatalogTranslations }>, existing?: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException('Classification must be a tenant code or unambiguous label; use null to clear it');
  const text = value.trim().toLowerCase();
  // Code, name and translated names are aliases; an input matching several entries is refused.
  const matches = [...new Map(options.filter((item) => catalogAliases(item).includes(text)).map((item) => [item.code, item])).values()];
  if (matches.length !== 1) throw new BadRequestException(`Unknown or ambiguous classification "${value}"; consult the tenant classification catalog`);
  if (matches[0].deprecated && matches[0].code !== existing) throw new BadRequestException(`Classification "${value}" is deprecated and cannot be newly assigned`);
  return matches[0].code;
}

export function highestClassification(values: Array<string | null | undefined>, levels: Array<{ code: string; rank: number }>): { code: string | null; incomplete: boolean } {
  const byCode = new Map(levels.map((item) => [item.code, item]));
  const known = values.flatMap((value) => value && byCode.has(value) ? [byCode.get(value)!] : []);
  return { code: known.sort((a, b) => b.rank - a.rank)[0]?.code ?? null, incomplete: known.length !== values.length || !values.length };
}

/**
 * SQL reading the catalog rank of the classification code `codeExpression`, for sorting by
 * severity. The levels are bound as `:<codesParam>` (codes) and `:<ranksParam>` (ranks), in
 * the same order; a value outside the catalog ranks null, so a NULLS LAST sort puts it last.
 */
export function classificationRankSql(codeExpression: string, codesParam: string, ranksParam: string): string {
  return `(SELECT r.rank FROM UNNEST(CAST(:${codesParam} AS text[]), CAST(:${ranksParam} AS float8[])) AS r(code, rank) WHERE r.code = ${codeExpression})`;
}
