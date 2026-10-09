import type { TFunction } from 'i18next';

/**
 * The budget lines an account may be used on (`accounts.nature`): OPEX lines only, CAPEX lines
 * only, or both when null. The UI calls it "Used for": "Nature" would clash with a tenant's own
 * analytics dimensions.
 */
export const ACCOUNT_NATURES = ['opex', 'capex'] as const;
export type AccountNature = (typeof ACCOUNT_NATURES)[number];

/** The stored value as the API sends it: 'opex', 'capex', or null for both. */
export function parseAccountNature(raw: unknown): AccountNature | null {
  return raw === 'opex' || raw === 'capex' ? raw : null;
}

/** "OPEX and CAPEX", "OPEX only" or "CAPEX only". */
export function accountNatureLabel(t: TFunction, nature: unknown): string {
  const value = parseAccountNature(nature);
  return t(`master-data:accounts.nature.${value ?? 'both'}`);
}

/** The lines of each kind that use an account (`GET /accounts/:id`, `line_counts`). */
export type AccountLineCounts = { opex: number; capex: number };

/**
 * The lines that keep an account they could no longer choose: the CAPEX lines of an account set
 * to OPEX only, or the reverse. Null when none.
 */
export function accountNatureConflict(
  nature: AccountNature | null,
  lineCounts: AccountLineCounts | null | undefined,
): { scope: AccountNature; count: number } | null {
  if (!nature || !lineCounts) return null;
  const scope: AccountNature = nature === 'opex' ? 'capex' : 'opex';
  const count = Number(lineCounts[scope] ?? 0);
  return count > 0 ? { scope, count } : null;
}
