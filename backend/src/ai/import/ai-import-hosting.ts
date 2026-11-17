import type { EntityManager } from 'typeorm';
import type { CsvLanguage } from '../../common/csv-sheet';
import { catalogAliases } from '../../it-ops-settings/catalog-codes';
import { shippedLabelIn, shippedLabelsOf } from '../../it-ops-settings/catalog-shipped-labels';
import type { ItOpsEnumOption } from '../../it-ops-settings/it-ops-settings.service';
import type { AiImportHostingSite } from '../ai.types';
import type { AiImportFileContent } from './ai-import-mapping';

/**
 * The hosting categories, by code and by the words the card names them with in each language
 * (`ai.json`, `hosting.onPremises` and `hosting.cloud`).
 */
const HOSTING_CATEGORY_WORDS = ['on_prem', 'cloud', 'on-prem', 'sur site', 'On-Premise', 'local'] as const;

/**
 * The words that name a hosting (lot I3 of 26.11.9, fixes D, T-I3f): each hosting type of the
 * catalog by its code, its name, its translations and its shipped names in every language, and the
 * hosting categories. The model's values never turn one into a server's type: the cell stays as
 * written, and the import refuses it as the screen does.
 */
export function hostingWords(hostingTypes: readonly ItOpsEnumOption[]): string[] {
  const words = new Set<string>(HOSTING_CATEGORY_WORDS);
  for (const option of hostingTypes) {
    for (const word of [...catalogAliases(option), ...shippedLabelsOf('hostingTypes', option)]) words.add(word);
  }
  return [...words];
}

/**
 * How the servers of an import are hosted (lot I3 of 26.11.9, T-I3f): a server's hosting is its
 * site's, never its type. Each site the file names by reference (`LOC-n`), once, in the order of the
 * file: its reference, its name, its hosting type (code, label in `language` as the location screen
 * shows it, category `on_prem` or `cloud` from the catalog) and its provider. One read of the
 * tenant's locations, in the person's transaction; a reference that names no site is left to the
 * import's own error.
 */
export async function serverHosting(
  manager: EntityManager,
  tenantId: string,
  file: AiImportFileContent,
  hostingTypes: readonly ItOpsEnumOption[],
  language: CsvLanguage,
): Promise<AiImportHostingSite[]> {
  const index = file.columns.findIndex((column) => column.column === 'location_reference');
  if (index < 0) return [];
  const references: string[] = [];
  for (const row of file.rows) {
    const cell = row[index];
    const reference = typeof cell === 'string' ? cell.trim().toUpperCase() : '';
    if (reference && !references.includes(reference)) references.push(reference);
  }
  if (references.length === 0) return [];
  const sites: Array<{ ref: string; name: string; hosting_type: string; provider: string | null }> = await manager.query(
    `SELECT upper(location_reference) AS ref, name, hosting_type, NULLIF(btrim(provider), '') AS provider
       FROM locations
      WHERE tenant_id = $1 AND upper(location_reference) = ANY($2::text[])`,
    [tenantId, references],
  );
  const byReference = new Map(sites.map((site) => [site.ref, site]));
  return references.flatMap((reference) => {
    const site = byReference.get(reference);
    if (!site) return [];
    const option = hostingTypes.find((entry) => entry.code === site.hosting_type);
    const category = option?.category === 'on_prem' || option?.category === 'cloud' ? option.category : null;
    return [{
      ref: site.ref,
      name: site.name,
      hostingType: site.hosting_type,
      label: option ? shippedLabelIn('hostingTypes', option, language) ?? (option.label || site.hosting_type) : site.hosting_type,
      category,
      provider: site.provider,
    }];
  });
}
