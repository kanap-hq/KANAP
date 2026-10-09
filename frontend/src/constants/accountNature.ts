import {
  LINE_TYPES,
  lineTypeUsageConflict,
  lineTypeUsageLabel,
  parseLineTypeUsage,
  type LineType,
  type LineTypeCounts,
} from './lineTypeUsage';

/**
 * The budget lines an account may be used on (`accounts.nature`): OPEX lines only, CAPEX lines
 * only, or both when null. The UI calls it "Used for": "Nature" would clash with a tenant's own
 * analytics dimensions. Same values and labels as a dimension's "Used for" (`lineTypeUsage`).
 */
export const ACCOUNT_NATURES = LINE_TYPES;
export type AccountNature = LineType;

/** The stored value as the API sends it: 'opex', 'capex', or null for both. */
export const parseAccountNature = parseLineTypeUsage;

/** "OPEX and CAPEX", "OPEX only" or "CAPEX only". */
export const accountNatureLabel = lineTypeUsageLabel;

/** The lines of each kind that use an account (`GET /accounts/:id`, `line_counts`). */
export type AccountLineCounts = LineTypeCounts;

/**
 * The lines that keep an account they could no longer choose: the CAPEX lines of an account set
 * to OPEX only, or the reverse. Null when none.
 */
export const accountNatureConflict = lineTypeUsageConflict;
