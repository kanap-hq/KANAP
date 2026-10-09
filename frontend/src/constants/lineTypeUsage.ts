import type { TFunction } from 'i18next';

/**
 * The budget lines a record may be used on: OPEX lines only, CAPEX lines only, or both when null.
 * Accounts (`accounts.nature`) and analytics dimensions (`analytics_axes.applies_to`) store it the
 * same way. The UI calls it "Used for".
 */
export const LINE_TYPES = ['opex', 'capex'] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** The stored value as the API sends it: 'opex', 'capex', or null for both. */
export function parseLineTypeUsage(raw: unknown): LineType | null {
  return raw === 'opex' || raw === 'capex' ? raw : null;
}

/** "OPEX and CAPEX", "OPEX only" or "CAPEX only". */
export function lineTypeUsageLabel(t: TFunction, usage: unknown): string {
  const value = parseLineTypeUsage(usage);
  return t(`master-data:shared.lineTypeUsage.${value ?? 'both'}`);
}

/** A record limited to one type, or for both (null or absent), applies to lines of `lineType`. */
export function usageAllowsLineType(usage: unknown, lineType: LineType): boolean {
  const value = parseLineTypeUsage(usage);
  return value == null || value === lineType;
}

/** The lines of each type that use a record (`line_counts` of an account, `opex_count` / `capex_count` of a dimension). */
export type LineTypeCounts = { opex: number; capex: number };

/**
 * The lines that keep a record they could no longer choose: the CAPEX lines of a record set to
 * OPEX only, or the reverse. Null when none.
 */
export function lineTypeUsageConflict(
  usage: LineType | null,
  lineCounts: LineTypeCounts | null | undefined,
): { scope: LineType; count: number } | null {
  if (!usage || !lineCounts) return null;
  const scope: LineType = usage === 'opex' ? 'capex' : 'opex';
  const count = Number(lineCounts[scope] ?? 0);
  return count > 0 ? { scope, count } : null;
}
