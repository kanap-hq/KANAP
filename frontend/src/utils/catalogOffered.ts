import type { TFunction } from 'i18next';

/** A catalog entry as the settings lists give it. */
export type CatalogEntry = { code: string; label?: string | null; deprecated?: boolean };

/** A code the record holds that the catalog does not list (any more): shown under its code. */
export type HeldUnknownEntry = { code: string; label: string; deprecated: true; unknown: true };

/** The codes a record holds: one value, a list, or nothing. */
export type HeldCodes = string | null | undefined | ReadonlyArray<string | null | undefined>;

function heldList(held: HeldCodes): string[] {
  const values: ReadonlyArray<string | null | undefined> = typeof held === 'string' || held == null ? [held] : held;
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

/**
 * Rule P7 (lot K2c of 26.12.1): a value removed from a catalog is refused everywhere, except on the
 * record that already holds it. The entries a record may pick: the active ones, plus the retired ones
 * it holds. A code it holds that the catalog does not list comes first, so the record still shows
 * what it holds. The API applies the same rule (`resolveOfferedCatalogCode`).
 */
export function offeredCatalogOptions<T extends CatalogEntry>(
  options: ReadonlyArray<T> | null | undefined,
  held?: HeldCodes,
  unknownLabel: (code: string) => string = (code) => code,
): Array<T | HeldUnknownEntry> {
  const list = options ?? [];
  const codes = heldList(held);
  const known = new Set(list.map((option) => option.code));
  const unknown = codes
    .filter((code) => !known.has(code))
    .map((code): HeldUnknownEntry => ({ code, label: unknownLabel(code), deprecated: true, unknown: true }));
  return [...unknown, ...list.filter((option) => !option.deprecated || codes.includes(option.code))];
}

/** True for a held code the catalog does not list. */
export function isHeldUnknown(option: CatalogEntry | HeldUnknownEntry): option is HeldUnknownEntry {
  return (option as HeldUnknownEntry).unknown === true;
}

/**
 * The name a control shows for a catalog entry (a selector's value and options, a chip, a header): a
 * retired entry the record still holds carries the catalog's own word, "(no longer offered)", the name
 * of the settings' "No longer offered" box; a held code the catalog does not list shows as it is
 * given. Every control that shows a held retired value marks it through here.
 */
export function catalogOptionLabel(option: (CatalogEntry | HeldUnknownEntry) & { label?: string | null }, t: TFunction): string {
  const label = String(option.label || option.code);
  return option.deprecated && !isHeldUnknown(option) ? `${label} (${t('common:enumEditor.retiredSuffix')})` : label;
}
