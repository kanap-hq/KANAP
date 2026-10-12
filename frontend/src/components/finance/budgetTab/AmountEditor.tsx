import React from 'react';
import { Box, FormControlLabel, MenuItem, Radio, RadioGroup, TextField, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import FormattedNumberField from '../../inputs/FormattedNumberField';
import { FieldLabel } from '../../design';
import DateEUField from '../../fields/DateEUField';
import { drawerMenuItemSx, drawerSelectSx, selectKeepsFocus } from '../../../theme/formSx';
import { PanelField, PanelPeriod } from '../LinesPanel';
import { centsToDecimal, formatMoney, spreadResultText, toCents, zeroedMonthsText } from '../roundPeriod';
import type { AmountWhen, BudgetTabState } from './useBudgetTab';

const captionSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 } as const;

/**
 * "Amount": one yearly amount, when it is consumed (the whole year or a period of it) and how it is
 * spread over the months that count (flat or 4-4-5). A sentence says what it gives, counting the
 * months. Every change saves at once: the amount on leaving the field or on Enter, the rest on
 * change. F2 adds "At a date" to "When".
 */
export default function AmountEditor({ tab, i18nPrefix, disabled }: { tab: BudgetTabState; i18nPrefix: string; disabled: boolean }) {
  const {
    t, locale, year, amountInputRef, spreadAmount, onSpreadAmountChange, commitSpreadAmount, commitSpread,
    spreadProfile, onSpreadProfileChange, spreadPeriod, spreadKind, onSpreadWhenChange, onSpreadDateChange,
    spreadProblem, spreadActive, spreadBeyondItem,
  } = tab;
  const amount = Number(spreadAmount || 0);
  const amountText = amount ? formatMoney(centsToDecimal(toCents(amount))) : '';
  const result = spreadProblem ? '' : spreadResultText(t, locale, amountText, spreadProfile, spreadActive);
  // No period at all: the line's dates leave no month of the year, and the column has none of its own.
  const noPeriod = spreadPeriod.start === '' && spreadPeriod.end === '';
  const zeroedText = spreadProblem ? '' : zeroedMonthsText(t, locale, spreadActive);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 2, rowGap: 1 }}>
        <PanelField label={t('budgetTab.annualAmount')} width={150}>
          <FormattedNumberField
            value={spreadAmount}
            onChange={(e) => onSpreadAmountChange(e.target.value as unknown as number | '')}
            onBlur={commitSpreadAmount}
            onKeyDown={(e) => { if (e.key === 'Enter') commitSpread(); }}
            disabled={disabled}
            inputRef={amountInputRef}
            variant="standard" size="small" fullWidth
            placeholder={t(`${i18nPrefix}.budget.spreadPlaceholder`)}
            inputProps={{ 'aria-label': t('budgetTab.annualAmount') }}
          />
        </PanelField>
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
          <FieldLabel sx={{ mb: '2px', whiteSpace: 'nowrap' }}>{t('budgetTab.when')}</FieldLabel>
          <RadioGroup
            row
            value={spreadKind}
            onChange={(e) => onSpreadWhenChange(e.target.value as AmountWhen)}
            aria-label={t('budgetTab.when')}
            sx={{ flexWrap: 'nowrap', minHeight: 32, alignItems: 'center' }}
          >
            {(['year', 'range'] as const).map((when) => (
              <FormControlLabel
                key={when}
                value={when}
                disabled={disabled}
                control={<Radio size="small" sx={{ p: '4px' }} />}
                label={when === 'year' ? t('budgetTab.wholeYear') : t('budgetTab.aPeriod')}
                sx={{ ml: 0, mr: 1.5, '& .MuiFormControlLabel-label': { fontSize: 13, color: 'kanap.text.primary', whiteSpace: 'nowrap' } }}
              />
            ))}
          </RadioGroup>
        </Box>
        {spreadKind === 'range' && (
          <PanelPeriod>
            <DateEUField label={t('budgetTab.from')} valueYmd={spreadPeriod.start} onChangeYmd={(v) => onSpreadDateChange('start', v)} disabled={disabled} size="small" sx={{ width: 150 }} />
            <DateEUField label={t('budgetTab.to')} valueYmd={spreadPeriod.end} onChangeYmd={(v) => onSpreadDateChange('end', v)} disabled={disabled} size="small" sx={{ width: 150 }} />
          </PanelPeriod>
        )}
        <PanelField label={t('budgetTab.distribution')} width={120}>
          <TextField
            select size="small" variant="standard" value={spreadProfile}
            disabled={disabled}
            onChange={(e) => onSpreadProfileChange(e.target.value as 'flat' | '4-4-5')}
            inputProps={{ 'aria-label': t('budgetTab.distribution') }}
            SelectProps={selectKeepsFocus}
            sx={drawerSelectSx}
          >
            <MenuItem value="flat" sx={drawerMenuItemSx}>{t(`${i18nPrefix}.budget.profileFlat`)}</MenuItem>
            <MenuItem value="4-4-5" sx={drawerMenuItemSx}>{t(`${i18nPrefix}.budget.profile445`)}</MenuItem>
          </TextField>
        </PanelField>
      </Box>

      {/* What the amount gives, then only the notes that apply: a whole-year period shows none. */}
      <Box data-testid="spread-notes">
        {result && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography data-testid="spread-result" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{result}</Typography>
            {/* The 15th rule, one hover away. */}
            <Tooltip title={t('budgetTab.convention')}>
              <InfoOutlinedIcon tabIndex={0} aria-label={t('budgetTab.convention')} sx={{ fontSize: 13, color: 'kanap.text.tertiary' }} />
            </Tooltip>
          </Box>
        )}
        {noPeriod ? (
          <Typography sx={{ ...captionSx, color: 'kanap.text.secondary' }}>{t('budgetTab.noMonthInItemDates', { year })}</Typography>
        ) : spreadProblem && (
          <Typography sx={{ ...captionSx, color: 'error.main' }}>{t(`budgetTab.problem.${spreadProblem}`, { year })}</Typography>
        )}
        {zeroedText && <Typography sx={{ ...captionSx, color: 'kanap.text.secondary' }}>{zeroedText}</Typography>}
        {spreadBeyondItem && <Typography sx={{ ...captionSx, color: 'warning.main' }}>{t('budgetTab.beyondItemDates')}</Typography>}
      </Box>
    </Box>
  );
}
