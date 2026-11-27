import React from 'react';
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

/** Which account expects it: the line's account, or its consolidation account (named when the person may read it). */
function entryReason(t: TFunction, check: BudgetLineEntryCheck): string {
  if (check.level !== 'consolidation') return t('budgetTab.entryCheck.account');
  const account = check.consolidation_account;
  if (!account) return t('budgetTab.entryCheck.consolidation');
  const name = account.name.trim();
  return t('budgetTab.entryCheck.consolidationNamed', { account: name ? `${account.number} - ${name}` : String(account.number) });
}

/**
 * The reason in one sentence, the problem and what is expected (D13): alone, on the dot of a column
 * to check and on the icon beside the editor's title; followed by the columns to check (`columns`,
 * already joined) on the dot of a year.
 */
export function entryExpectedText(t: TFunction, check: BudgetLineEntryCheck, columns?: string): string {
  const reason = entryReason(t, check);
  return columns ? t('budgetTab.entryCheck.withColumns', { reason, columns }) : t('budgetTab.entryCheck.sentence', { reason });
}

/**
 * The orange dot of a column to check: its text in a tooltip and as its accessible name. The tooltip
 * opens above the dot, clear of its card's title and amount, on hover and while `focused` (its card
 * has the keyboard focus: the dot itself is no tab stop).
 */
export function EntryCheckDot({ text, testId, focused = false }: { text: string; testId?: string; focused?: boolean }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <Tooltip title={text} placement="top" open={hovered || focused} onOpen={() => setHovered(true)} onClose={() => setHovered(false)}>
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
