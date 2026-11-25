/** Names a catalog value of a settings list (`connectionTypes`, `ssh`) in `language`, or null. */
export type CatalogValueNamer = (list: string, code: string, language: string) => string | null;

let namer: CatalogValueNamer | null = null;

/**
 * The namer the catalog localization registers (`utils/itOpsSettingsLocalization.ts`): the error
 * messages read it here without loading the settings and their translations themselves.
 */
export function registerCatalogValueNamer(next: CatalogValueNamer): void {
  namer = next;
}

/**
 * The name a refused catalog value takes in a message (`catalog_value_retired`): the name the field's
 * selector shows, in `language`. The refusal says which list and which code (`list`, `valueCode`);
 * null when it does not, or when no screen has loaded the catalogs, so the message keeps the name
 * the server gave.
 */
export function catalogValueName(params: Record<string, unknown>, language: string): string | null {
  const list = typeof params.list === 'string' ? params.list : '';
  const code = typeof params.valueCode === 'string' ? params.valueCode : '';
  if (!list || !code || !namer) return null;
  return namer(list, code, language);
}
