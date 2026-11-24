import type { EntityManager } from 'typeorm';
import { localizedBudgetColumnsAiContext } from '../../budget-columns/budget-column-labels';
import { readBudgetColumns } from '../../budget-columns/budget-columns.util';
import type { LineEntryCheck } from '../../spend/budget-line-entry-check';
import { readAiScreenLanguage } from '../ai-unread-families';

/**
 * The "quantity and price entry" of one budget line as Kad reads it (`quantity_price_entry` of the
 * line's detail), in plain words rather than the rule's keys: who expects it, each column to check
 * by its name on screen and its year with how it is entered today, and that this is the whole cause
 * of `quantity_price` in the line's `to_check`. A conforming or unconcerned line says so too.
 */

/** How a column to check is entered today, after its round (`spend_round_inputs.method`). */
function enteredAs(round: { method: string } | undefined): string {
  switch (round?.method) {
    case 'spread': return 'an amount for the year (or by quarter), spread over the months';
    case 'manual': return 'amounts entered by month, by hand';
    case 'copied': return 'amounts copied from another column, not computed from quantity and price';
    case 'computed': return 'quantity and price, with every line removed';
    default: return 'amounts without a record of how they were entered (an import, or a line entered before it was recorded)';
  }
}

const WITHHELD = 'The consolidation account is named with the right on accounts (Accounts, reader level), which this person does not have. '
  + 'Tell them the setting comes from the consolidation account of the line\'s account, without naming it or any account number.';

export async function describeEntryCheckForAi(
  manager: EntityManager,
  ctx: { tenantId: string; userId?: string | null; lineId: string; lineAccount: string | null; accounts: boolean },
  check: LineEntryCheck | null,
): Promise<Record<string, unknown>> {
  if (!check?.expected) {
    return {
      status: 'not_expected',
      explanation: 'The line\'s account, and its consolidation account if it has one, expects no quantity and price entry: '
        + 'nothing on this line is to check for it (`to_check` holds no `quantity_price` for this reason).',
    };
  }
  const cons = check.consolidation_account;
  const expectedBy = check.level === 'account'
    ? `The line's account${ctx.lineAccount ? ` ${ctx.lineAccount}` : ''}`
    : cons
      ? `The consolidation account ${cons.name.trim() ? `${cons.number} - ${cons.name.trim()}` : cons.number}${ctx.lineAccount ? ` (the line's account ${ctx.lineAccount} is mapped to it)` : ''}`
      : 'The consolidation account of the line\'s account';
  const withheld = check.level === 'consolidation' && !ctx.accounts ? { consolidation_account_withheld: WITHHELD } : {};
  if (!check.to_check) {
    return {
      status: 'conforms',
      expected_by: expectedBy,
      ...withheld,
      explanation: `${expectedBy} expects quantity and price entry, and every column that counts (shown in the budget settings, not frozen, `
        + 'with a non-zero total) is built as quantity × price: the line conforms and has nothing to check.',
    };
  }
  // The columns by the names the person sees: the workspace's name, else the product name in their
  // language, or in the four languages when their profile sets none.
  const names = new Map(localizedBudgetColumnsAiContext(
    await readBudgetColumns(manager, ctx.tenantId),
    await readAiScreenLanguage(manager, ctx.tenantId, ctx.userId),
  ).map((entry) => [entry.measure, entry]));
  const rounds: Array<{ year: number; measure: string; method: string }> = await manager.query(
    `SELECT v.budget_year AS year, r.measure, r.method
       FROM spend_versions v
       JOIN spend_round_inputs r ON r.tenant_id = v.tenant_id AND r.version_id = v.id
      WHERE v.tenant_id = $1 AND v.spend_item_id = $2`,
    [ctx.tenantId, ctx.lineId],
  );
  const columns = check.columns.map(({ year, measure }) => {
    const entry = names.get(measure)!;
    const column = entry.name
      ? `${entry.name} ${year}`
      : Object.fromEntries(Object.entries(entry.names ?? {}).map(([language, name]) => [language, `${name} ${year}`]));
    return { column, entered_as: enteredAs(rounds.find((round) => Number(round.year) === year && round.measure === measure)) };
  });
  return {
    status: 'to_check',
    expected_by: expectedBy,
    ...withheld,
    columns_to_check: columns,
    explanation: `${expectedBy} expects quantity and price entry. These columns are to check because they are not built as quantity × price. `
      + 'This is the only cause of `quantity_price` in the line\'s `to_check`: nothing else on the line (supplier, contract, dimensions, amounts) causes it. '
      + 'Nothing is refused: the amounts stay as entered. To clear the mark, rebuild each of these columns in quantity and price on the line\'s Budget tab.',
  };
}
