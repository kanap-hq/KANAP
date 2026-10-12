import React from 'react';
import { Box, Link, MenuItem, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import FormattedNumberField from '../../inputs/FormattedNumberField';
import { StatusDot } from '../../design/StatusDot';
import { formatAmount } from '../../../i18n/formatters';
import { drawerMenuItemSx, drawerSelectSx, inlineControlSx, selectKeepsFocus, tableCellFieldSx } from '../../../theme/formSx';
import { centsToDecimal, formatMoney, toCents } from '../roundPeriod';
import { conflictTint } from './ColumnCards';
import { monthPeriod, type AmountCol, type BudgetTabState } from './useBudgetTab';

const QUARTERS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];

type MonthCellProps = {
  month: number;
  col: AmountCol;
  label: string;
  value: number;
  disabled: boolean;
  waits: boolean;
  onMonthChange: (idx: number, key: AmountCol, value: number | '') => void;
  registerCell: (month: number, el: HTMLInputElement | null) => void;
};

/** One month of the column typed by month, drawn again only when its own props change. */
const MonthCell = React.memo(function MonthCell({ month, col, label, value, disabled, waits, onMonthChange, registerCell }: MonthCellProps) {
  const inputRef = React.useCallback((el: HTMLInputElement | null) => registerCell(month, el), [registerCell, month]);
  return (
    <Box
      component="td"
      data-testid={`cell-${col}-${month + 1}`}
      data-waiting={waits ? 'true' : undefined}
      sx={{ px: 0.5, py: '2px', bgcolor: waits ? conflictTint : 'kanap.bg.hover' }}
    >
      <FormattedNumberField
        value={value}
        onChange={(e) => onMonthChange(month, col, e.target.value as unknown as number | '')}
        variant="standard" size="small" fullWidth
        disabled={disabled}
        // A month waiting for the user's choice stays as typed until the choice is made.
        InputProps={{ readOnly: waits }}
        inputRef={inputRef}
        inputProps={{ 'aria-label': label }}
        sx={tableCellFieldSx}
      />
    </Box>
  );
});

/** A month as the table reads it: grouped thousands, cents only when there are some. */
const cellText = (value: number) => formatMoney(centsToDecimal(toCents(value)));

/** A difference with the reference column: "+12 000 (+1.8%)", "-500", "0"; the percentage only over a total that is not zero. */
export function differenceText(locale: string, total: number, reference: number): string {
  const cents = toCents(total) - toCents(reference);
  // Whole units, as the totals above: a sign only on a difference that shows.
  const units = Math.round(cents / 100);
  const amount = `${units > 0 ? '+' : ''}${formatAmount(units)}`;
  const base = toCents(reference);
  if (base === 0 || cents === 0) return amount;
  const pct = new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(cents / base);
  return `${amount} (${pct})`;
}

/**
 * The year month by month for every shown column, with quarter and year totals, then the difference
 * of each column with the one picked above the table. Read only, except the active column while it
 * is typed by month. A click in a month of another column that is not frozen makes it the active
 * column and offers to type it by month. Folded into a sentence while every column is an amount
 * spread flat over the whole year (or empty); « Show / Hide the detail » for the visit.
 */
export default function MonthlyResult({ tab, i18nPrefix, currency }: { tab: BudgetTabState; i18nPrefix: string; currency?: string }) {
  const {
    t, locale, year, loading, loaded, shown, months, totals, activeCol, activeMode, isFrozen, waitingSet, cellWaits,
    modeSwitch, stableMonthChange, registerCell, onCellClick, labelFor, gridOpen, gridForced, toggleGrid, allEmpty, diffCol, setDiffCol,
  } = tab;
  const compared = shown.length > 1;
  // The active column is typed in the table while it is built month by month (and not about to change).
  const editableCol = loaded && activeMode === 'monthly' && !isFrozen(activeCol) && !modeSwitch ? activeCol : null;
  const headCellSx = { textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1, py: 0.75, whiteSpace: 'nowrap' } as const;
  const numCellSx = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'kanap.text.primary', px: 1, py: 0.5, whiteSpace: 'nowrap' } as const;
  const monthLabel = (mi: number) => new Date(year, mi, 1).toLocaleString(locale, { month: 'short' });
  const monthLong = (mi: number) => new Date(year, mi, 1).toLocaleString(locale, { month: 'long' });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* The tools of the result: the column the differences are taken with, show or hide the detail. */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minHeight: 28 }}>
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>
          {t('budgetTab.result.title')}{currency ? ` · ${currency.toUpperCase()}` : ''}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {gridOpen && compared && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{t('budgetTab.result.differenceWith')}</Typography>
              <TextField
                select size="small" variant="standard" value={diffCol}
                onChange={(e) => setDiffCol(e.target.value as typeof diffCol)}
                inputProps={{ 'aria-label': t('budgetTab.result.differenceWith') }}
                SelectProps={selectKeepsFocus}
                sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 110 }]}
              >
                {shown.map((c) => <MenuItem key={c.measure} value={c.measure} sx={drawerMenuItemSx}>{c.label}</MenuItem>)}
              </TextField>
            </Box>
          )}
          {/* Kept open while a column waits for a choice or is typed by month: nothing to hide then. */}
          {!gridForced && (
            <Link component="button" type="button" onClick={toggleGrid} aria-expanded={gridOpen} sx={{ fontSize: 12 }}>
              {gridOpen ? t('budgetTab.result.hide') : t('budgetTab.result.show')}
            </Link>
          )}
        </Box>
      </Box>
      {!gridOpen ? (
        <Box
          data-testid="result-folded"
          sx={{ border: '1px solid', borderColor: 'kanap.border.default', borderRadius: '8px', bgcolor: 'kanap.bg.primary', px: 1.5, py: 1.25 }}
        >
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {allEmpty ? t('budgetTab.result.foldedEmpty') : t('budgetTab.result.folded', { count: shown.length })}
          </Typography>
        </Box>
      ) : (
      <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'kanap.border.default', borderRadius: '8px', bgcolor: 'kanap.bg.primary' }}>
        <Box
          component="table"
          data-testid="monthly-result"
          sx={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', '& td, & th': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...headCellSx, textAlign: 'left' }}>{t(`${i18nPrefix}.budget.month`)}</Box>
              {shown.map((c) => {
                const waits = waitingSet.has(c.measure);
                const active = c.measure === activeCol;
                return (
                  <Box
                    component="th"
                    key={c.measure}
                    data-testid={`budget-head-${c.measure}`}
                    data-waiting={waits ? 'true' : undefined}
                    sx={{ ...headCellSx, ...(active ? { color: 'kanap.text.primary', bgcolor: 'kanap.bg.hover' } : {}), ...(waits ? { bgcolor: conflictTint } : {}) }}
                  >
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      {waits && <StatusDot color="warning.main" />}
                      {c.label}
                      {isFrozen(c.measure) && <LockOutlinedIcon titleAccess={t('budgetTab.card.frozen')} sx={{ fontSize: 12, color: 'kanap.text.tertiary' }} />}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
          <Box component="tbody">
            {QUARTERS.map((quarter, q) => (
              <React.Fragment key={q}>
                {quarter.map((mi) => (
                  <Box component="tr" key={mi}>
                    <Box component="td" sx={{ fontSize: 13, color: 'kanap.text.secondary', px: 1, py: 0.5 }}>{monthLabel(mi)}</Box>
                    {shown.map((c) => {
                      const col = c.measure;
                      const value = months[mi]?.[col] ?? 0;
                      const waits = cellWaits(monthPeriod(year, mi + 1), col);
                      if (col === editableCol) {
                        return (
                          <MonthCell
                            key={col}
                            month={mi}
                            col={col}
                            label={`${labelFor(col)} ${monthLong(mi)}`}
                            value={value}
                            disabled={loading}
                            waits={waits}
                            onMonthChange={stableMonthChange}
                            registerCell={registerCell}
                          />
                        );
                      }
                      const clickable = loaded && !loading && !isFrozen(col);
                      return (
                        <Box
                          component="td"
                          key={col}
                          data-testid={`cell-${col}-${mi + 1}`}
                          data-waiting={waits ? 'true' : undefined}
                          title={clickable && !waitingSet.has(col) ? t('budgetTab.result.cellHint') : undefined}
                          onClick={clickable ? () => onCellClick(col, mi) : undefined}
                          sx={{
                            ...numCellSx,
                            color: value === 0 ? 'kanap.text.tertiary' : 'kanap.text.primary',
                            ...(col === activeCol ? { bgcolor: 'kanap.bg.hover' } : {}),
                            ...(waits ? { bgcolor: conflictTint } : {}),
                            ...(clickable ? { cursor: 'text', '&:hover': { bgcolor: waits ? conflictTint : 'kanap.bg.hover' } } : {}),
                          }}
                        >
                          {cellText(value)}
                        </Box>
                      );
                    })}
                  </Box>
                ))}
                <Box component="tr" sx={{ bgcolor: 'kanap.bg.drawer' }}>
                  <Box component="td" sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary', px: 1, py: 0.5 }}>{t('budgetTab.result.quarter', { n: q + 1 })}</Box>
                  {shown.map((c) => (
                    <Box component="td" key={c.measure} sx={{ ...numCellSx, fontSize: 12, fontWeight: 500, color: 'kanap.text.secondary' }}>
                      {formatAmount(quarter.reduce((sum, mi) => sum + Number(months[mi]?.[c.measure] || 0), 0))}
                    </Box>
                  ))}
                </Box>
              </React.Fragment>
            ))}
          </Box>
          <Box component="tfoot">
            <Box component="tr">
              <Box component="td" sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.primary', px: 1, py: 0.75, borderBottom: 0 }}>{t(`${i18nPrefix}.budget.total`)}</Box>
              {shown.map((c) => (
                <Box component="td" key={c.measure} data-testid={`total-${c.measure}`} sx={{ ...numCellSx, fontWeight: 500, py: 0.75, ...(compared ? {} : { borderBottom: 0 }) }}>{formatAmount(totals[c.measure])}</Box>
              ))}
            </Box>
            {/* The difference of every other column with the one picked above (two columns or more). */}
            {compared && (
              <Box component="tr" data-testid="difference-row">
                <Box component="td" sx={{ fontSize: 12, color: 'kanap.text.secondary', px: 1, py: 0.75, borderBottom: 0, whiteSpace: 'nowrap' }}>
                  {t('budgetTab.result.differenceRow', { column: labelFor(diffCol) })}
                </Box>
                {shown.map((c) => (
                  <Box component="td" key={c.measure} data-testid={`difference-${c.measure}`} sx={{ ...numCellSx, fontSize: 12, color: 'kanap.text.secondary', py: 0.75, borderBottom: 0 }}>
                    {c.measure === diffCol ? '—' : differenceText(locale, totals[c.measure], totals[diffCol])}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
      )}
    </Box>
  );
}
