import React from 'react';
import { Box, Button, Checkbox, FormControlLabel, Link, MenuItem, Tab, Tabs, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { formatAmount } from '../../../i18n/formatters';
import LinesPanel from '../LinesPanel';
import { columnPeriodProblem, followsLines, formatMoney, hasLines, isOneDay, joinList, monthSpanText, periodForEdit, periodMonths, type RoundInput } from '../roundPeriod';
import { drawerMenuItemSx, drawerSelectSx, selectKeepsFocus } from '../../../theme/formSx';
import AmountEditor from './AmountEditor';
import { ColumnHowText } from './ColumnCards';
import type { AmountCol, BudgetTabState, ColumnMode, ModeSwitch } from './useBudgetTab';

const captionSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 } as const;
const MODES: ColumnMode[] = ['amount', 'lines', 'monthly'];

/** What the lines kept as a reference gave, when the record still says it (`lines_result`, or the computation a hand edit kept). */
function referenceTotal(record: RoundInput): string {
  const calc = record.last_calculation;
  if (!calc) return '';
  const total = calc.kind === 'computed' ? calc.total : calc.lines_result?.total;
  return total ? formatMoney(total) : '';
}

/** The question asked before a mode change on a column with amounts: what changes, what stays. */
function switchMessage(tab: BudgetTabState, change: ModeSwitch): string {
  const { t, locale, year, recordFor, currentCents, defaultPeriod } = tab;
  const record = recordFor(change.col);
  const amount = formatAmount(currentCents(change.col) / 100);
  const keepsLines = hasLines(record) ? ` ${t('budgetTab.switch.linesStay')}` : '';
  if (change.to === 'amount') {
    // The months the spread will cover: the column's period within the line's dates.
    const span = defaultPeriod && !columnPeriodProblem(year, defaultPeriod.start, defaultPeriod.end)
      ? monthSpanText(t, locale, periodMonths(year, defaultPeriod.start, defaultPeriod.end))
      : '';
    const question = span ? t('budgetTab.switch.toAmountSpan', { amount, span }) : t('budgetTab.switch.toAmount', { amount });
    return `${question}${keepsLines}`;
  }
  if (change.to === 'monthly') return `${t('budgetTab.switch.toMonthly')}${keepsLines}`;
  const reference = hasLines(record) && !followsLines(record);
  return `${t('budgetTab.switch.toLines')} ${reference
    ? t('budgetTab.switch.reuseLines', { count: record!.lines.length })
    : t('budgetTab.switch.replaced', { amount })}`;
}

/** A percentage as typed ("-10", "2,5"): a number above -100, else null. */
export function parsePercentage(text: string): number | null {
  const compact = text.trim().replace(/\s/g, '').replace(',', '.');
  if (compact === '') return null;
  const value = Number(compact);
  return Number.isFinite(value) && value > -100 ? value : null;
}

/**
 * « Start from »: an empty column takes another shown column with amounts, adjusted by a percentage
 * (0 by default), as « Copy budget columns » would on this line and year.
 */
function StartFrom({ tab, disabled }: { tab: BudgetTabState; disabled: boolean }) {
  const { t, startSources, startFrom, totals } = tab;
  const [source, setSource] = React.useState<AmountCol>(startSources[0].measure);
  const [percentage, setPercentage] = React.useState('0');
  const picked = startSources.some((c) => c.measure === source) ? source : startSources[0].measure;
  const value = parsePercentage(percentage);
  const textSx = { fontSize: 12, color: 'kanap.text.secondary' } as const;
  return (
    <Box data-testid="start-from" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.75 }}>
      <Typography component="span" sx={textSx}>{t('budgetTab.start.label')}</Typography>
      <TextField
        select size="small" variant="standard" value={picked}
        disabled={disabled}
        onChange={(e) => setSource(e.target.value as AmountCol)}
        inputProps={{ 'aria-label': t('budgetTab.start.source') }}
        SelectProps={selectKeepsFocus}
        sx={[drawerSelectSx, { width: 'auto', minWidth: 180 }]}
      >
        {startSources.map((c) => (
          <MenuItem key={c.measure} value={c.measure} sx={drawerMenuItemSx}>
            {t('budgetTab.start.option', { column: c.label, amount: formatAmount(totals[c.measure]) })}
          </MenuItem>
        ))}
      </TextField>
      <Typography component="span" sx={textSx}>{t('budgetTab.start.adjusted')}</Typography>
      <TextField
        size="small" variant="standard" value={percentage}
        disabled={disabled}
        onChange={(e) => setPercentage(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value !== null && !disabled) startFrom(picked, value); }}
        inputProps={{ 'aria-label': t('budgetTab.start.percentage'), inputMode: 'decimal' }}
        error={value === null}
        sx={{ width: 72, '& input': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
      />
      <Typography component="span" sx={textSx}>%</Typography>
      <Button variant="action" disabled={disabled || value === null} onClick={() => { if (value !== null) startFrom(picked, value); }}>
        {t('budgetTab.start.apply')}
      </Button>
      <Typography component="span" sx={captionSx}>{t('budgetTab.start.orBelow')}</Typography>
    </Box>
  );
}

type Props = {
  tab: BudgetTabState;
  i18nPrefix: string;
  effectiveStart?: string | null;
  endOfValidity?: string | null;
  payingCompanyCountry?: string | null;
  /** One column only: no cards above, so the editor says how the column is built itself. */
  single: boolean;
};

/**
 * How the active column is built: Amount, Quantity and price, or By month, always offered. A change
 * on a column with amounts asks first, in place. Under the mode: its editor, then « Use for other
 * columns too » and « Clear column ». A frozen column is read only, with no field; a column waiting
 * for the user's choice is read only until the banner's choice is made.
 */
export default function ColumnEditor({ tab, i18nPrefix, effectiveStart, endOfValidity, payingCompanyCountry, single }: Props) {
  const {
    t, year, loading, loaded, activeCol, activeMode, labelFor, isFrozen, isWaiting, recordFor, currentCents, totals,
    modeSwitch, requestMode, cancelModeSwitch, confirmModeSwitch, storedAmounts, suggestion, reuseLines,
  } = tab;
  const col = activeCol;
  const label = labelFor(col);
  const title = t('budgetTab.editorTitle', { column: label, year });
  const record = recordFor(col);

  const surfaceSx = {
    display: 'flex', flexDirection: 'column', gap: 1.75, minWidth: 0,
    border: '1px solid', borderColor: 'kanap.border.default', borderRadius: '8px', bgcolor: 'kanap.bg.drawer', px: 2, py: 1.75,
  } as const;

  // A frozen column, or every column for a budget reader: read only, with no field.
  const frozenCol = isFrozen(col);
  if (frozenCol || tab.readOnly) {
    return (
      <Box data-testid="column-editor" data-frozen={frozenCol ? 'true' : undefined} data-read-only={frozenCol ? undefined : 'true'} data-ready={loaded && !loading ? 'true' : undefined} sx={surfaceSx}>
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', color: 'kanap.text.secondary' }}>
          <LockOutlinedIcon sx={{ fontSize: 14, mt: '3px', color: 'kanap.text.tertiary' }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>{frozenCol ? t('budgetTab.frozen.title', { column: label, year }) : title}</Typography>
            <Typography sx={captionSx}>{frozenCol ? t('budgetTab.frozen.hint') : t('budgetTab.readOnlyHint')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'kanap.text.primary' }}>{formatAmount(totals[col])}</Typography>
              <ColumnHowText tab={tab} col={col} />
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  const waits = isWaiting(col);
  const disabled = loading || !loaded || waits;
  const pending = modeSwitch && modeSwitch.col === col ? modeSwitch : null;
  const shownMode = pending ? pending.to : activeMode;
  const reference = hasLines(record) && !followsLines(record) ? record : null;
  const referenceAmount = reference ? referenceTotal(reference) : '';

  const referenceNote = reference && (
    <Typography data-testid="lines-reference" sx={captionSx}>
      {referenceAmount
        ? t('budgetTab.referenceAmount', { count: reference.lines.length, amount: referenceAmount })
        : t('budgetTab.reference', { count: reference.lines.length })}
      {!waits && (
        <>
          {' '}
          <Link component="button" type="button" onClick={() => reuseLines(col)} sx={{ fontSize: 12, verticalAlign: 'baseline' }}>
            {t('budgetTab.lines.useAgain')}
          </Link>
        </>
      )}
    </Typography>
  );
  const waitingNote = waits && (
    <Typography sx={{ ...captionSx, color: 'warning.main' }}>{t('budgetTab.conflict.waiting')}</Typography>
  );

  let body: React.ReactNode = null;
  if (!loaded) body = null;
  else if (pending) {
    body = (
      <Box
        role="group"
        aria-label={t('budgetTab.modes')}
        data-testid="mode-switch"
        sx={{
          border: '1px solid', borderColor: 'warning.main', borderRadius: '6px', px: 1.5, py: 1.25, bgcolor: 'kanap.bg.primary',
          display: 'flex', flexWrap: 'wrap', gap: 1.25, alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <Typography sx={{ fontSize: 12, color: 'kanap.text.primary', maxWidth: '66ch' }}>{switchMessage(tab, pending)}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="action" onClick={cancelModeSwitch}>{t('common:buttons.cancel')}</Button>
          <Button variant="action-primary" onClick={confirmModeSwitch}>{t('budgetTab.switch.confirm')}</Button>
        </Box>
      </Box>
    );
  } else if (activeMode === 'amount') {
    body = (
      <>
        <AmountEditor tab={tab} i18nPrefix={i18nPrefix} disabled={disabled} />
        {referenceNote}
        {waitingNote}
      </>
    );
  } else if (activeMode === 'lines') {
    // New lines start on the column's period; an amount at a date gives them the line's dates instead.
    const own = periodForEdit(year, record, storedAmounts[col], suggestion);
    const linesPeriod = own && isOneDay(own.start, own.end) ? suggestion ?? own : own;
    // One panel per year and column: it starts from the column's stored lines and keeps what is
    // typed across its own saves.
    body = (
      <Box sx={{ minWidth: 0 }}>
        <LinesPanel
          key={`${year}:${col}`}
          year={year}
          record={record}
          period={linesPeriod}
          itemStart={effectiveStart}
          itemEnd={endOfValidity}
          frozen={waits}
          frozenHint={t('budgetTab.conflict.waiting')}
          waiting={waits}
          reloadSignal={tab.linesReload}
          startLines={tab.parkedLines}
          payingCompanyCountry={payingCompanyCountry}
          pendingRef={tab.linesPendingRef}
          columnName={labelFor}
          onSave={(lines, startedFrom) => tab.saveLines(col, lines, startedFrom)}
        />
      </Box>
    );
  } else {
    body = (
      <>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('budgetTab.monthlyHint', { column: label })}</Typography>
        {referenceNote}
        {waitingNote}
      </>
    );
  }

  const canClear = !waits && loaded && (!!record || currentCents(col) !== 0);
  const footer = loaded && !pending && !waits && (tab.alsoOffered || canClear) && (
    <Box
      data-testid="editor-footer"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'center', fontSize: 12, color: 'kanap.text.secondary', pt: 1.25, borderTop: '1px solid', borderColor: 'kanap.border.soft' }}
    >
      {tab.alsoOffered && (tab.alsoOpen ? (
        <>
          <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{t('budgetTab.also.label')}</Typography>
          {tab.alsoTargets.map((c) => (
            <FormControlLabel
              key={c.measure}
              control={<Checkbox size="small" checked={tab.alsoChecked.includes(c.measure)} onChange={(e) => tab.toggleAlso(c.measure, e.target.checked)} sx={{ p: '2px', mr: 0.5 }} />}
              label={c.label}
              sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 13, color: 'kanap.text.primary' } }}
            />
          ))}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="action" onClick={tab.closeAlso}>{t('common:buttons.cancel')}</Button>
            <Button variant="action-primary" onClick={tab.applyAlso} disabled={tab.alsoChecked.length === 0}>{t('budgetTab.also.apply')}</Button>
          </Box>
          <Typography sx={{ ...captionSx, flexBasis: '100%' }}>
            {activeMode === 'amount' ? t('budgetTab.also.amountHint') : t('budgetTab.also.linesHint')}
            {tab.keepLinesColumns.length > 0 && ` ${t('budgetTab.keepLines', { count: tab.keepLinesColumns.length, columns: joinList(t, tab.keepLinesColumns.map((c) => c.label)) })}`}
          </Typography>
        </>
      ) : (
        <Link component="button" type="button" onClick={tab.openAlso} sx={{ fontSize: 12 }}>{t('budgetTab.also.open')}</Link>
      ))}
      {canClear && (
        <Link component="button" type="button" onClick={() => { void tab.clearColumn(col); }} sx={{ fontSize: 12, ml: 'auto' }}>
          {t(`${i18nPrefix}.budget.clearColumn`)}
        </Link>
      )}
    </Box>
  );

  return (
    <Box data-testid="column-editor" data-waiting={waits ? 'true' : undefined} data-ready={loaded && !loading ? 'true' : undefined} sx={surfaceSx}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h3" sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>{title}</Typography>
          {single && <ColumnHowText tab={tab} col={col} testId={`period-line-${col}`} />}
        </Box>
        {/* The three ways to build a column, always offered. */}
        <Tabs value={shownMode} onChange={(_, mode: ColumnMode) => requestMode(mode)} aria-label={t('budgetTab.modes')}>
          {MODES.map((mode) => (
            <Tab key={mode} value={mode} label={t(`budgetTab.mode.${mode}`)} disabled={disabled} />
          ))}
        </Tabs>
      </Box>
      {/* An empty column can start from another one. */}
      {loaded && !pending && !waits && tab.startSources.length > 0 && <StartFrom key={`${year}:${col}`} tab={tab} disabled={disabled} />}
      {tab.startNote && (
        <Typography data-testid="start-note" sx={captionSx}>{t('budgetTab.start.prorated', { column: labelFor(tab.startNote.source) })}</Typography>
      )}
      {body}
      {footer}
    </Box>
  );
}
