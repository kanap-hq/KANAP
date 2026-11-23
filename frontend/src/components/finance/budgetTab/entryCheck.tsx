import { Box, Tooltip } from '@mui/material';
import type { TFunction } from 'i18next';
import { attentionDotSx } from '../../../theme/formSx';
import type { AmountMeasure } from '../roundPeriod';

/**
 * "Quantity and price expected" on a budget line (`GET /budget-lines/:id/entry-check`): the line's
 * account, or its consolidation account, expects its columns to be built as quantity × price, and
 * the columns that are not (every year, frozen ones left out by the server). Nothing is refused:
 * the Budget tab opens an empty column in « Quantity and price » and marks the columns to check.
 */
export type BudgetLineEntryCheck = {
  expected: boolean;
  level: 'account' | 'consolidation' | null;
  /** Named for a person who reads the accounts only. */
  consolidation_account: { number: number; name: string } | null;
  columns: Array<{ year: number; measure: AmountMeasure }>;
};

export const entryCheckKey = (lineId: string | undefined, accountId: string | null) => ['budget-line-entry-check', lineId, accountId] as const;

/** Which account expects it, in one sentence: the line's account, or its consolidation account (named when the person may read it). */
export function entryExpectedText(t: TFunction, check: BudgetLineEntryCheck): string {
  if (check.level !== 'consolidation') return t('budgetTab.entryCheck.account');
  const account = check.consolidation_account;
  if (!account) return t('budgetTab.entryCheck.consolidation');
  const name = account.name.trim();
  return t('budgetTab.entryCheck.consolidationNamed', { account: name ? `${account.number} - ${name}` : String(account.number) });
}

/** The orange dot of a column, or a year, to check: its text in a tooltip and as its accessible name. */
export function EntryCheckDot({ text, testId }: { text: string; testId?: string }) {
  return (
    <Tooltip title={text}>
      <Box
        component="span"
        role="img"
        aria-label={text}
        data-testid={testId}
        sx={{ ...attentionDotSx, position: 'relative', top: '-1px' }}
      />
    </Tooltip>
  );
}
