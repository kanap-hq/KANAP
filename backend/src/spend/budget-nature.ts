/**
 * The nature of a budget line, `spend_items.nature` (migration 1853950000000, plan
 * planning/budget-unifie.md): OPEX or CAPEX.
 *
 * `spend_items` and its family hold both natures since lot Z1 (migration 1853970000000 moved the
 * CAPEX lines in; the `capex_*` tables stay, dormant, until lot Z2). The rule: no code reads nor
 * writes a line, nor a version, month, attachment, link, contact or analytics value of a line,
 * without its nature.
 * - Every statement that reads or locks `spend_items` names the nature (`natureAnd`, or
 *   `nature` in a TypeORM `where`).
 * - A route or function that starts from the id of a version, attachment or link finds
 *   its line through `findBudgetLineOf` / `budgetLineOfChild` (`budget-locks.ts`), or through
 *   a lock that names the nature, before it reads anything else; a line or child of the other
 *   nature answers 404 there, as a line id does (`resolveToUuid`, `common/resolve-item-id.ts`).
 * - The other statements address children through the id of a line that went through one of
 *   these, and need no predicate of their own.
 *
 * The scope tables of `spend/` (`opex` / `capex` to table names) point both entries at the
 * `spend_*` tables, each with its `nature` (`assertScopeNatures` refuses an entry without one).
 * The `/capex-items*` and `/capex-versions*` routes are aliases on the same services, with the
 * CAPEX contract of before (`budget-line-presentation.ts`).
 */
export type BudgetNature = 'opex' | 'capex';

/**
 * ` AND <alias>.nature = '<nature>'`: the nature predicate of a scope entry's line table, to
 * append to a predicate. Empty without a nature (a table other than `spend_items`). The value is
 * one of two constants, never the caller's input.
 */
export function natureAnd(alias: string | null, nature: BudgetNature | undefined): string {
  if (!nature) return '';
  if (nature !== 'opex' && nature !== 'capex') throw new Error(`Unknown budget line nature: ${String(nature)}`);
  return ` AND ${alias ? `${alias}.` : ''}nature = '${nature}'`;
}

/** The table of the budget lines: every scope entry that reads it names a nature. */
export const BUDGET_LINE_TABLE = 'spend_items';

/**
 * ` AND EXISTS (...)`: the line a row names is a line of `nature`, the one form of "a link (or a
 * version) of a line of this nature" (the lists, counts and replacements of the links, the
 * version locks). `tenant` and `line` are SQL expressions of the row's tenant and line id (a
 * column, or a parameter for rows that carry no tenant). Empty without a nature.
 */
export function linkedLineOf(tenant: string, line: string, nature: BudgetNature | undefined, lineTable: string = BUDGET_LINE_TABLE): string {
  if (!nature) return '';
  return ` AND EXISTS (SELECT 1 FROM ${lineTable} nl WHERE nl.tenant_id = ${tenant} AND nl.id = ${line}${natureAnd('nl', nature)})`;
}

/**
 * Checks a scope table when its module loads: an entry whose line table is `spend_items` names its
 * nature, or the module refuses to load. Without it the entry's statements would read the lines
 * of both natures without a word. `lineTable` gives an entry's line table (`items`, `itemTable`,
 * `table`).
 */
export function assertScopeNatures<E extends { nature?: BudgetNature }>(
  name: string,
  entries: Readonly<Record<string, E>> | ReadonlyArray<E>,
  lineTable: (entry: E) => string,
): void {
  for (const [key, entry] of Object.entries(entries) as Array<[string, E]>) {
    if (lineTable(entry) === BUDGET_LINE_TABLE && !entry.nature) {
      throw new Error(`${name}: the entry "${key}" reads ${BUDGET_LINE_TABLE} without a nature; give it one (spend/budget-nature.ts).`);
    }
  }
}

/** The two natures, in display order. */
export const BUDGET_NATURES: readonly BudgetNature[] = ['opex', 'capex'];

/**
 * The prefix of a line's reference before the single numbering: OPX-n, CPX-n, kept in
 * `spend_items.legacy_number`. A CAPEX line keeps its CPX number there (lot Z1); the CAPEX API and
 * the old screens show that number, the line's own number is its BL-n reference.
 */
export const LEGACY_PREFIX: Record<BudgetNature, 'OPX' | 'CPX'> = { opex: 'OPX', capex: 'CPX' };

/** The neutral reference of every line (decision U3): `BL-<item_number>`. */
export const BUDGET_LINE_PREFIX = 'BL';

export function budgetLineReference(itemNumber: number | string | null | undefined): string | null {
  return itemNumber == null || itemNumber === '' ? null : `${BUDGET_LINE_PREFIX}-${itemNumber}`;
}

/** The number of a legacy reference of `nature` (`CPX-12` gives 12), else null. */
export function legacyNumberOf(nature: BudgetNature, legacy: string | null | undefined): number | null {
  const match = typeof legacy === 'string' ? legacy.match(/^([A-Z]+)-(\d+)$/) : null;
  return match && match[1] === LEGACY_PREFIX[nature] ? Number.parseInt(match[2], 10) : null;
}

/**
 * The number a line shows in the API of its nature, as SQL: an OPEX line its own number; a CAPEX
 * line its CPX number (`legacy_number`), its own number when it has none (never for a line moved
 * or created as CAPEX). What the CAPEX list sorts, filters and searches on, as before lot Z1.
 */
export function lineNumberSql(alias: string, nature: BudgetNature | undefined): string {
  if (nature !== 'capex') return `${alias}.item_number`;
  return `COALESCE((substring(${alias}.legacy_number FROM '^CPX-([0-9]+)$'))::int, ${alias}.item_number)`;
}

/**
 * The tables of the single family by their CAPEX name: the label a CAPEX line's rows keep in the
 * audit log (G.9), so the history of a line reads the same names before and after lot Z1.
 */
const CAPEX_AUDIT_LABELS: Record<string, string> = {
  spend_items: 'capex_items',
  spend_versions: 'capex_versions',
  spend_amounts: 'capex_amounts',
  spend_allocations: 'capex_allocations',
  spend_round_inputs: 'capex_round_inputs',
  spend_round_input_lines: 'capex_round_input_lines',
  spend_item_analytics_values: 'capex_item_analytics_values',
  spend_item_contacts: 'capex_item_contacts',
  spend_links: 'capex_links',
  spend_attachments: 'capex_attachments',
  application_spend_items: 'application_capex_items',
  asset_spend_items: 'asset_capex_items',
  contract_spend_items: 'contract_capex_items',
  portfolio_project_opex: 'portfolio_project_capex',
  portfolio_request_opex: 'portfolio_request_capex',
};

/** The audit label of a table of the family for a row of a line of `nature`: its CAPEX name for a CAPEX line. */
export function auditTableOf(nature: BudgetNature, table: string): string {
  if (nature !== 'capex') return table;
  const label = CAPEX_AUDIT_LABELS[table];
  if (!label) throw new Error(`No CAPEX audit label for ${table}`);
  return label;
}
