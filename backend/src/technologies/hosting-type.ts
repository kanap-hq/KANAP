import type { ItOpsEnumOption } from '../it-ops-settings/it-ops-settings.service';

/**
 * The hosting type of a technology (lot H1): a code of the tenant's "Hosting types" catalog
 * (`hostingTypes`, the one the locations use), each type on premises or in the cloud (`category`).
 * It replaces the former mode: installed is `on_prem`, subscribed is `saas`.
 */

export type HostingCategory = 'on_prem' | 'cloud';

/** The type a technology takes when nothing says otherwise. */
export const DEFAULT_TECHNOLOGY_HOSTING_TYPE = 'on_prem';

/** The type a mode of the shipped catalog stands for (`installed` → `on_prem`, `subscribed` → `saas`). */
export function hostingTypeOfMode(mode: unknown): string {
  return mode === 'subscribed' ? 'saas' : DEFAULT_TECHNOLOGY_HOSTING_TYPE;
}

/** The category of `code`: the catalog's, else the one the settings infer (`on_prem` and `colocation` on premises). */
export function hostingCategory(types: ItOpsEnumOption[] | undefined, code: string): HostingCategory {
  const category = (types ?? []).find((item) => item.code === code)?.category;
  if (category === 'on_prem' || category === 'cloud') return category;
  return code === 'on_prem' || code === 'colocation' ? 'on_prem' : 'cloud';
}

/**
 * Whether a technology of hosting type `code` is a cloud service: its type is of the `cloud`
 * category (`hostingCategory`), the "subscribed" side of the former mode (lot H1). A catalog entry
 * of mode `subscribed` stands for such a type (`saas`, or its own `public_cloud`).
 */
export function isCloudHostingType(types: ItOpsEnumOption[] | undefined, code: string | null | undefined): boolean {
  const normalized = String(code ?? '').trim().toLowerCase();
  return !!normalized && hostingCategory(types, normalized) === 'cloud';
}

/**
 * The codes a technology on premises may carry: the tenant's types of the `on_prem` category,
 * retired ones included, and `on_prem` and `colocation` when the catalog lacks them (a code out
 * of the catalog takes the category `hostingCategory` infers).
 */
export function onPremHostingTypes(types: ItOpsEnumOption[] | undefined): string[] {
  const list = types ?? [];
  const codes = list.filter((item) => hostingCategory(list, item.code) === 'on_prem').map((item) => item.code);
  for (const code of ['on_prem', 'colocation']) if (!list.some((item) => item.code === code)) codes.push(code);
  return codes;
}

/** Whether `code` is a type of the tenant's catalog still in use (not retired). */
export function isActiveHostingType(types: ItOpsEnumOption[] | undefined, code: string | null | undefined): boolean {
  return !!code && (types ?? []).some((item) => item.code === code && !item.deprecated);
}

/**
 * The code to write when nothing names one, the single rule of every writer (create, adoption,
 * conversion, migration): `preferred` when it is a type in use of the tenant's catalog, else the
 * first type in use of its category, else the first type in use. A retired type is never given.
 * A catalog without any type in use gives `preferred` as is: the technology then appears in the
 * missing data of the end-of-support report (`technology_without_hosting_type`).
 */
export function resolveHostingType(types: ItOpsEnumOption[] | undefined, preferred: string): string {
  const list = types ?? [];
  const active = list.filter((item) => !item.deprecated);
  if (active.some((item) => item.code === preferred)) return preferred;
  const category = hostingCategory(list, preferred);
  return active.find((item) => hostingCategory(list, item.code) === category)?.code
    ?? active[0]?.code
    ?? preferred;
}
