import React from 'react';
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { alpha, type Theme } from '@mui/material/styles';
import { StatusDot } from '../../design/StatusDot';
import { formatAmount } from '../../../i18n/formatters';
import { activeMonths, chipLines, linesText, periodText } from '../roundPeriod';
import type { AmountCol, BudgetTabState } from './useBudgetTab';

/** The tint of a column waiting for the user's choice, on its card and in the result table. */
export const conflictTint = (theme: Theme) => alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.08);

const multilineTooltip = { tooltip: { sx: { whiteSpace: 'pre-line' } } } as const;

/**
 * How a column is built, in short lines: how its amounts were produced ("Spread flat", "Quantity
 * and price · 1 line · 0.40 FTE", "Copied from Budget 2025 +2%", "Edited by hand"), then its period
 * ("9 months, April to December"). A column with nothing yet says so; a column whose line has no
 * month in the year says that. Hover lists the column's lines.
 */
export function ColumnHowText({ tab, col, testId }: { tab: BudgetTabState; col: AmountCol; testId?: string }) {
  const { t, locale, year, loaded, recordFor, periodFor, roundInputs, storedAmounts, currentCents, labelFor } = tab;
  // Until this year's data is in, the previous year's periods would be read against this year.
  if (!loaded) return <Box data-testid={testId} sx={{ minHeight: '1.4em' }} />;
  const record = recordFor(col);
  const period = periodFor(col, roundInputs, storedAmounts);
  const text = period ? periodText(t, locale, activeMonths(year, period.start, period.end)) : '';
  const empty = !record && currentCents(col) === 0;
  // The chip, one block per line of it, as units that wrap whole ("Quantity and price ·" then "3
  // lines · 1.00 FTE"); a unit longer than the line still wraps inside it.
  const chip = chipLines(t, locale, record, labelFor).map((units, line) => (
    <Box component="span" key={line} sx={{ display: 'block' }}>
      {units.map((unit, i) => (
        <React.Fragment key={unit}>
          {i > 0 && ' '}
          <Box component="span" sx={{ display: 'inline-block', maxWidth: '100%' }}>{unit}</Box>
        </React.Fragment>
      ))}
    </Box>
  ));
  return (
    <Tooltip title={linesText(t, locale, record)} componentsProps={multilineTooltip} describeChild>
      {/* How the column was produced, then its period: one line each, never run together. */}
      <Box component="span" data-testid={testId} sx={{ display: 'block', fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4, minWidth: 0 }}>
        {!text ? t('budgetTab.noMonthInItemDates', { year }) : empty ? t('budgetTab.notEntered') : (
          <>
            {chip}
            <Box component="span" sx={{ display: 'block' }}>{text}</Box>
          </>
        )}
      </Box>
    </Tooltip>
  );
}

/**
 * One card per shown column (1 to 5, named freely): its name, a lock when frozen, a dot while it
 * waits for the user's choice, its total and how it is built. A click makes it the active column.
 * Nothing here depends on a column's name or rank.
 */
export default function ColumnCards({ tab }: { tab: BudgetTabState }) {
  const { t, shown, activeCol, totals, waitingSet, isFrozen, selectColumn } = tab;
  return (
    <Box
      role="group"
      aria-label={t('budgetTab.columns')}
      sx={{
        display: 'grid',
        gap: 1.25,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: `repeat(${shown.length}, minmax(0, 1fr))` },
      }}
    >
      {shown.map((c) => {
        const active = c.measure === activeCol;
        const frozen = isFrozen(c.measure);
        const waits = waitingSet.has(c.measure);
        const total = totals[c.measure];
        return (
          <ButtonBase
            key={c.measure}
            data-testid={`budget-column-${c.measure}`}
            data-waiting={waits ? 'true' : undefined}
            aria-pressed={active}
            onClick={() => selectColumn(c.measure)}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
              gap: 0.5,
              minWidth: 0,
              textAlign: 'left',
              px: 1.5,
              py: 1.25,
              border: '1px solid',
              borderColor: active ? 'primary.main' : 'kanap.border.default',
              borderRadius: '8px',
              bgcolor: waits ? conflictTint : 'kanap.bg.primary',
              boxShadow: (theme: Theme) => (active ? `0 0 0 1px ${theme.palette.primary.main}` : 'none'),
              transition: 'background-color 120ms ease',
              '&:hover': { bgcolor: waits ? conflictTint : 'kanap.bg.hover' },
              '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '1px' },
            }}
          >
            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 12, color: 'kanap.text.secondary', minWidth: 0 }}>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</Box>
              {frozen && <LockOutlinedIcon titleAccess={t('budgetTab.card.frozen')} sx={{ fontSize: 12, color: 'kanap.text.tertiary', flex: 'none' }} />}
              {waits && (
                <Box component="span" title={t('budgetTab.card.waiting')} sx={{ ml: 'auto', display: 'inline-flex' }}>
                  <StatusDot color="warning.main" />
                </Box>
              )}
            </Box>
            <Typography
              component="span"
              sx={{ fontSize: 18, fontWeight: 500, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', color: total === 0 ? 'kanap.text.tertiary' : 'kanap.text.primary' }}
            >
              {formatAmount(total)}
            </Typography>
            <ColumnHowText tab={tab} col={c.measure} testId={`period-line-${c.measure}`} />
          </ButtonBase>
        );
      })}
    </Box>
  );
}
