import React, { useCallback, useMemo } from 'react';
import { MenuItem, TextField, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import { formatFte } from '../../components/finance/amountColumns';
import { useLocale } from '../../i18n/useLocale';
import { drawerMenuItemSx } from '../../theme/formSx';
import {
  fteNoticeColumns,
  fteNoticeRequest,
  readFteNotice,
  type AggregateRequest,
  type AggregateResult,
  type BudgetScope,
  type ColumnYear,
  type ReportMeasure,
} from './reportAggregates';
import { useBudgetAggregate } from './useBudgetAggregate';

export type { ReportMeasure };

/** `?measure=fte`: the budget reports sum declared FTE instead of amounts (absent: amounts). */
export const MEASURE_PARAM = 'measure';

/**
 * What a budget report sums, kept in `?measure=` like the item type in `?scope=`, so a shared link
 * opens on the same measure. Anything but `fte` reads as amounts.
 */
export function useReportMeasure(): [ReportMeasure, (next: ReportMeasure) => void] {
  const [params, setParams] = useSearchParams();
  const measure: ReportMeasure = params.get(MEASURE_PARAM) === 'fte' ? 'fte' : 'amount';
  const setMeasure = useCallback((next: ReportMeasure) => {
    setParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next === 'fte') nextParams.set(MEASURE_PARAM, 'fte');
      else nextParams.delete(MEASURE_PARAM);
      return nextParams;
    }, { replace: true });
  }, [setParams]);
  return [measure, setMeasure];
}

const MEASURES: readonly ReportMeasure[] = ['amount', 'fte'];

/** The measure picker of a budget report's filter row: amounts or declared FTE. */
export function ReportMeasureSelect({ value, onChange }: { value: ReportMeasure; onChange: (next: ReportMeasure) => void }) {
  const { t } = useTranslation('ops');
  const labels: Record<ReportMeasure, string> = { amount: t('reports.measure.amount'), fte: t('reports.measure.fte') };
  return (
    <ReportFilter label={t('reports.measure.label')} width={120}>
      <TextField
        select
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value === 'fte' ? 'fte' : 'amount')}
        SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.measure.label') } }}
        sx={reportFilterSelectSx}
      >
        {MEASURES.map((measure) => (
          <MenuItem key={measure} value={measure} sx={drawerMenuItemSx}>{labels[measure]}</MenuItem>
        ))}
      </TextField>
    </ReportFilter>
  );
}

/** Whole amounts with a space between thousands, as the budget reports always showed them. */
function formatAmount(v: unknown): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export type MeasureText = {
  fte: boolean;
  /** A value as the measure reads: a whole amount, or FTE with two decimals (blank when nobody declares one). */
  format: (value: unknown) => string;
  /** A budget column's name for the measure: `Budget` stays `Budget`, or reads `Budget FTE`. */
  column: (label: string) => string;
  /** A chart title that names no column: FTE adds the measure to it. */
  chartTitle: (title: string) => string;
  /** The title of a chart's value axis: FTE names it, amounts keep none. */
  axisTitle: { text: string } | undefined;
  /** A downloaded file's name (no extension): FTE adds `-fte`. */
  fileName: (base: string) => string;
  /** The table's CSV export parameters: FTE names the file after the chart, amounts keep the grid's default. */
  csvParams: (base: string) => { fileName: string } | undefined;
};

/** The words and formats of a report for its measure. */
export function useMeasureText(measure: ReportMeasure): MeasureText {
  const { t } = useTranslation('ops');
  const locale = useLocale();
  return useMemo<MeasureText>(() => {
    if (measure !== 'fte') {
      return {
        fte: false,
        format: formatAmount,
        column: (label) => label,
        chartTitle: (title) => title,
        axisTitle: undefined,
        fileName: (base) => base,
        csvParams: () => undefined,
      };
    }
    return {
      fte: true,
      format: (value) => formatFte(value, locale),
      column: (label) => t('reports.measure.columnFte', { column: label }),
      chartTitle: (title) => t('reports.measure.chartTitleFte', { title }),
      axisTitle: { text: t('reports.measure.fte') },
      fileName: (base) => `${base}-fte`,
      csvParams: (base) => ({ fileName: `${base}-fte.csv` }),
    };
  }, [measure, locale, t]);
}

/**
 * The one-line notice under an FTE report's key table: the columns whose FTE is declared by lines
 * whose amount no longer follows them (spread or edited by hand since). The report's request carries
 * its measures when they fit; otherwise the notice asks them on its own, over the same lines. Nothing
 * for amounts, or when no such FTE is declared.
 */
export function ReportFteNotice({
  scope,
  request,
  result,
  columnLabel,
}: {
  scope: BudgetScope;
  request: AggregateRequest | null;
  /** The report's answer to `request`. */
  result: AggregateResult | undefined;
  /** A year and column as the notice names it (`Budget 2026`). */
  columnLabel: (column: ColumnYear) => string;
}) {
  const { t } = useTranslation('ops');
  const locale = useLocale();
  const own = useMemo(() => fteNoticeRequest(request), [request]);
  const ownAnswer = useBudgetAggregate(scope, own);
  const entries = readFteNotice(request, own ? ownAnswer.data : result);
  if (entries.length === 0) return null;
  const text = fteNoticeColumns(request).length === 1
    ? t('reports.measure.detachedSingle', { count: entries[0].items, fte: formatFte(entries[0].fte, locale) })
    : t('reports.measure.detachedList', {
      list: entries
        .map((entry) => t('reports.measure.detachedEntry', { column: columnLabel(entry), count: entry.items, fte: formatFte(entry.fte, locale) }))
        .join(', '),
    });
  return (
    <Typography role="note" sx={{ mt: 1, fontSize: 13, color: 'kanap.text.secondary' }}>
      {text}
    </Typography>
  );
}
