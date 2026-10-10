/**
 * The nature of a budget line, `spend_items.nature` (migration 1853950000000, plan
 * planning/budget-unifie.md, lot Z0): OPEX or CAPEX.
 *
 * `spend_items` will hold both natures (lot Z1 moves the CAPEX lines in). Until then every line
 * there is OPEX, and the rule holds already: the OPEX code never reads nor writes a line, nor a
 * version, month, attachment, link, contact or analytics value of a line, without the nature.
 * - Every statement that reads or locks `spend_items` names the nature (`natureAnd`, or
 *   `nature` in a TypeORM `where`).
 * - A route or function that starts from the id of a version, attachment, link or contact finds
 *   its line through `findBudgetLineOf` / `budgetLineOfChild` (`budget-locks.ts`), or through
 *   a lock that names the nature, before it reads anything else; a line or child of the other
 *   nature answers 404 there, as a line id does (`resolveToUuid`, `common/resolve-item-id.ts`).
 * - The other statements address children through the id of a line that went through one of
 *   these, and need no predicate of their own.
 *
 * The scope tables of `spend/` (`opex` / `capex` to table names) give their `opex` entry
 * `nature: 'opex'`; their `capex` entry points at the `capex_*` tables, which have no nature
 * column, until lot Z1.
 */
export type BudgetNature = 'opex' | 'capex';

/**
 * ` AND <alias>.nature = '<nature>'`: the nature predicate of a scope entry's line table, to
 * append to a predicate. Empty for an entry without a nature (a `capex_*` table). The value is
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
 * version) of a line of this nature" (the lists, counts and replacements of the OPEX links, the
 * version locks). `tenant` and `line` are SQL expressions of the row's tenant and line id (a
 * column, or a parameter for rows that carry no tenant). Empty without a nature (a `capex_*`
 * entry, whose own table holds CAPEX lines only until lot Z1).
 */
export function linkedLineOf(tenant: string, line: string, nature: BudgetNature | undefined, lineTable: string = BUDGET_LINE_TABLE): string {
  if (!nature) return '';
  return ` AND EXISTS (SELECT 1 FROM ${lineTable} nl WHERE nl.tenant_id = ${tenant} AND nl.id = ${line}${natureAnd('nl', nature)})`;
}

/**
 * Checks a scope table when its module loads: an entry whose line table is `spend_items` names its
 * nature, or the module refuses to load. Without it the entry's statements would read the lines
 * of every nature without a word once lot Z1 stores both in that table. `lineTable` gives an
 * entry's line table (`items`, `itemTable`, `table`).
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
