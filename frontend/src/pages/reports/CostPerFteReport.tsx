import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import RemoveIcon from '@mui/icons-material/RemoveCircleOutline';
import AddIcon from '@mui/icons-material/Add';
import type { ColDef, ColGroupDef } from 'ag-grid-community';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReportGrid from '../../components/reports/ReportGrid';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { formatFte } from '../../components/finance/amountColumns';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useLocale } from '../../i18n/useLocale';
import { drawerMenuItemSx } from '../../theme/formSx';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { useReportScope } from './useReportScope';
import { metricFileName, metricKeys, MetricKey, resolveMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import {
  COST_PER_FTE_CHART_GROUPS,
  costPerFteRequests,
  dailyRateRequests,
  readCostPerFte,
  readDailyRate,
  type ColumnYear,
  type CostPerFteNotice,
  type DailyRate,
} from './reportAggregates';
import { compareNames, useBudgetAggregates } from './useBudgetAggregate';
import { formatAmount, ReportNoticeLine } from './reportMeasure';
import { GROUP_FILE_NAME, ReportGroupFilters, useReportGroup } from './reportGroup';
import { gridTextMeasure, valueColumnWidth } from './reportValueWidth';

/** The most year and column pairs the report compares. */
export const MAX_COLUMNS = 4;

/** A pair as picked: no column yet means the default column (and follows it). */
type PickedColumn = { year: number; metric: MetricKey | null };

/** `?view=rate`: the average daily rate; absent (or anything else): the cost per FTE. */
const VIEW_PARAM = 'view';
type View = 'fte' | 'rate';
const VIEWS: readonly View[] = ['fte', 'rate'];

/** The view in the address, so a shared link opens on it; switching keeps every other parameter. */
function useReportView(): [View, (next: View) => void] {
  const [params, setParams] = useSearchParams();
  const view: View = params.get(VIEW_PARAM) === 'rate' ? 'rate' : 'fte';
  const setView = useCallback((next: View) => {
    setParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next === 'rate') nextParams.set(VIEW_PARAM, 'rate');
      else nextParams.delete(VIEW_PARAM);
      return nextParams;
    }, { replace: true });
  }, [setParams]);
  return [view, setView];
}

/**
 * The three values of a pair in each view, as the grid's field ids: what the rows count (`c0_fte`,
 * `c0_days`), its cost (`c0_cost`) and the cost of one unit (`c0_ratio`, `c0_rate`).
 */
type ValueKind = 'fte' | 'days' | 'cost' | 'ratio' | 'rate';
const VALUES: Record<View, readonly [ValueKind, ValueKind, ValueKind]> = { fte: ['fte', 'cost', 'ratio'], rate: ['days', 'cost', 'rate'] };
const fieldOf = (index: number, kind: ValueKind) => `c${index}_${kind}`;
type Cell = Partial<Record<ValueKind, number | null>>;
/** What either view reads: rows and totals per pair, the notices (`monthly` in the daily rate only). */
type ViewData = Pick<DailyRate, 'sortColumn' | 'detached' | 'noDetail' | 'monthly'> & {
  rows: Array<{ key: string; label: string; cells: Cell[] }>;
  total: Cell[];
};

/** An amount, blank when there is none (a ratio without FTE, a cost without staff). */
const money = (value: unknown) => (value == null ? '' : formatAmount(value));

/**
 * Days grouped like the amounts next to them (`formatAmount`: a space between thousands), with only the
 * decimals the value needs, two at most (`1 341.7`); blank when there are none.
 */
function formatDays(value: unknown): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const [whole, fraction] = String(Math.round(n * 100) / 100).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? `.${fraction}` : ''}`;
}

/** Chronological: by year, then in the budget columns' fixed order; each pair once. */
function distinctColumns(columns: readonly ColumnYear[]): ColumnYear[] {
  const byKey = new Map<string, ColumnYear>();
  for (const column of columns) byKey.set(`${column.year}:${column.metric}`, column);
  return Array.from(byKey.values()).sort((a, b) => a.year - b.year || metricKeys.indexOf(a.metric) - metricKeys.indexOf(b.metric));
}

function cellValues(kinds: readonly ValueKind[], index: number, cell: Cell | undefined): Record<string, number | null> {
  return Object.fromEntries(kinds.map((kind) => [fieldOf(index, kind), cell?.[kind] ?? null]));
}

export default function CostPerFteReport() {
  const { t } = useTranslation(['ops']);
  const locale = useLocale();
  const budgetColumns = useBudgetColumns();
  const Y = new Date().getFullYear();
  const allowedYears = useMemo(() => [Y - 2, Y - 1, Y, Y + 1, Y + 2], [Y]);
  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);
  const fte = useCallback((value: unknown) => formatFte(value, locale), [locale]);
  const [view, setView] = useReportView();
  const kinds = VALUES[view];
  const [countKind, costKind, ratioKind] = kinds;

  // The default column for the previous and the current year, until the user picks others.
  const [picked, setPicked] = useState<PickedColumn[]>([{ year: Y - 1, metric: null }, { year: Y, metric: null }]);
  const selections = useMemo<ColumnYear[]>(
    () => picked.map((pair) => ({ year: pair.year, metric: resolveMetric(budgetColumns, pair.metric) })),
    [picked, budgetColumns],
  );
  const columns = useMemo(() => distinctColumns(selections), [selections]);
  const columnLabel = useCallback((column: ColumnYear) => `${budgetColumns.label(column.metric)} ${column.year}`, [budgetColumns]);
  const yearsNeeded = useMemo(() => Array.from(new Set(columns.map((column) => column.year))), [columns]);

  const reportFilters = useBudgetReportFilters({ scope, years: yearsNeeded });
  const grouping = useReportGroup(reportFilters.analyticsAxes);
  const { kind, group, header: groupHeader, inSentence: groupInSentence, labels } = grouping;

  // One request per pair: per group, the staff cost and FTE (or the day cost and days); on the total row, the notices.
  const requests = useMemo(() => {
    if (reportFilters.queryFilters == null || group == null) return null;
    const params = { scope, columns, group, filters: reportFilters.queryFilters };
    return view === 'rate' ? dailyRateRequests(params) : costPerFteRequests(params);
  }, [reportFilters.queryFilters, scope, columns, group, view]);
  const report = useBudgetAggregates(scope, requests, { keepPrevious: true });
  const busy = requests == null || report.isLoading || report.isPlaceholderData;
  // While a new pair loads, the kept answers may hold fewer pairs: read nothing rather than shifted columns.
  const results = report.data && report.data.length === columns.length ? report.data : undefined;
  // The two views ask measures of other names, so an answer of one never stands in for the other.
  const data = useMemo<ViewData>(
    () => (view === 'rate'
      ? readDailyRate(columns, results, labels, compareNames)
      : { ...readCostPerFte(columns, results, labels, compareNames), monthly: [] }),
    [view, columns, results, labels],
  );

  const tableRows = useMemo(() => data.rows.map((row) => ({
    group: row.label,
    ...Object.assign({}, ...columns.map((_, index) => cellValues(kinds, index, row.cells[index]))),
  })), [data.rows, columns, kinds]);
  const totalRow = useMemo(() => ({
    group: t('reports.columns.total'),
    ...Object.assign({}, ...columns.map((_, index) => cellValues(kinds, index, data.total[index]))),
  }), [data.total, columns, kinds, t]);

  const formats = useMemo<Record<ValueKind, (value: unknown) => string>>(
    () => ({ fte, days: formatDays, cost: money, ratio: money, rate: money }),
    [fte],
  );

  // The value columns of a kind share one width, measured from their values before the grid lays out;
  // the group column flexes into the rest and shows its full name on hover.
  const textMetrics = useMemo(() => gridTextMeasure(), []);
  const widths = useMemo(() => {
    const width = (kindOf: ValueKind) => valueColumnWidth({
      rows: tableRows,
      total: totalRow,
      ids: columns.map((_, index) => fieldOf(index, kindOf)),
      format: formats[kindOf],
      measure: textMetrics.measure,
      cellPadding: textMetrics.cellPadding,
    });
    return Object.fromEntries(kinds.map((kindOf) => [kindOf, width(kindOf)])) as Partial<Record<ValueKind, number>>;
  }, [tableRows, totalRow, columns, kinds, formats, textMetrics]);

  const valueHeaders = useMemo<Record<ValueKind, string>>(() => ({
    fte: t('reports.measure.fte'),
    days: t('reports.costPerFte.days'),
    cost: view === 'rate' ? t('reports.costPerFte.dayCost') : t('reports.costPerFte.staffCost'),
    ratio: t('reports.costPerFte.costPerFte'),
    rate: t('reports.costPerFte.dailyRate'),
  }), [t, view]);
  const columnDefs = useMemo<Array<ColDef | ColGroupDef>>(() => [
    { field: 'group', headerName: groupHeader, flex: 1, minWidth: 180, tooltipField: 'group' },
    ...columns.map((column, index): ColGroupDef => ({
      groupId: `c${index}`,
      headerName: columnLabel(column),
      children: kinds.map((kindOf): ColDef => ({
        field: fieldOf(index, kindOf),
        colId: fieldOf(index, kindOf),
        headerName: valueHeaders[kindOf],
        headerTooltip: `${columnLabel(column)} · ${valueHeaders[kindOf]}`,
        type: 'rightAligned',
        width: widths[kindOf],
        valueFormatter: (p) => formats[kindOf](p.value),
      })),
    })),
  ], [groupHeader, columns, columnLabel, kinds, valueHeaders, widths, formats]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  const chartTitle = t(view === 'rate' ? 'reports.costPerFte.rateChartTitle' : 'reports.costPerFte.chartTitle', { type: scopeLabel, group: groupInSentence });
  const chartCategories = useMemo(() => [
    { key: 'total', label: t('reports.columns.total'), cells: data.total },
    ...data.rows.slice(0, COST_PER_FTE_CHART_GROUPS).map((row) => ({ key: `group:${row.key}`, label: row.label, cells: row.cells })),
  ], [data, t]);
  const chartOptions = useMemo(() => {
    const labelOf = new Map(chartCategories.map((category) => [category.key, category.label]));
    return {
      title: { text: chartTitle },
      data: chartCategories.map((category) => ({
        key: category.key,
        label: category.label,
        ...Object.assign({}, ...columns.map((_, index) => cellValues(kinds, index, category.cells[index]))),
      })),
      // Categories by key (two items may share a name), shown by name.
      axes: [
        { type: 'category', position: 'left', label: { padding: 8, formatter: ({ value }: { value: string }) => labelOf.get(value) ?? '' } },
        {
          type: 'number',
          position: 'bottom',
          title: { text: valueHeaders[ratioKind] },
          label: { formatter: ({ value }: { value: number }) => money(value) },
        },
      ],
      series: columns.map((column, index) => ({
        type: 'bar',
        direction: 'horizontal',
        xKey: 'key',
        yKey: fieldOf(index, ratioKind),
        yName: columnLabel(column),
        strokeWidth: 0,
        tooltip: {
          enabled: true,
          renderer: ({ datum }: any) => ({
            title: escapeTooltipText(datum.label),
            data: [
              { label: t('reports.filters.column'), value: escapeTooltipText(columnLabel(column)) },
              { label: valueHeaders[ratioKind], value: formats[ratioKind](datum[fieldOf(index, ratioKind)]) },
              { label: valueHeaders[countKind], value: formats[countKind](datum[fieldOf(index, countKind)]) },
              { label: valueHeaders[costKind], value: formats[costKind](datum[fieldOf(index, costKind)]) },
            ],
          }),
        },
      })),
      legend: { enabled: true, position: 'bottom' },
      animation: { enabled: true, duration: 800 },
    };
  }, [chartCategories, chartTitle, columns, columnLabel, kinds, countKind, costKind, ratioKind, valueHeaders, formats, t]);
  const chartHeight = Math.max(260, Math.min(900, 140 + chartCategories.length * (12 + 14 * columns.length)));

  const first = columns[0];
  const fileName = `${view === 'rate' ? 'daily-rate' : 'cost-per-fte'}-${scope}-${GROUP_FILE_NAME[kind]}-${first ? `${first.year}-${metricFileName(budgetColumns, first.metric)}` : Y}`;

  // The notices name each pair concerned: "Budget 2026 (2 items, 1.50 FTE)".
  const noticeList = (entries: readonly CostPerFteNotice[]) => entries
    .map((entry) => t('reports.measure.detachedEntry', { column: columnLabel(entry), count: entry.items, fte: fte(entry.fte) }))
    .join(', ');

  const pickedLabel = (base: string, index: number) => `${base} ${index + 1}`;
  const addPair = () => setPicked((prev) => {
    const metric = resolveMetric(budgetColumns, null);
    const taken = new Set(selections.map((pair) => `${pair.year}:${pair.metric}`));
    const latest = Math.max(...prev.map((pair) => pair.year));
    const year = [latest + 1, ...allowedYears].find((yr) => allowedYears.includes(yr) && !taken.has(`${yr}:${metric}`)) ?? Y;
    return prev.concat({ year, metric: null });
  });

  return (
    <ReportLayout
      busy={busy}
      title={t('reports.costPerFte.title')}
      subtitle={t('reports.costPerFte.subtitle', { type: scopeLabel, group: groupInSentence })}
      filters={(
        <>
          <ItemScopeTabs value={scope} onChange={setScope} />
          <BudgetReportFilters filters={reportFilters} />
          <ReportGroupFilters state={grouping} />
          <ReportFilter label={t('reports.costPerFte.show')} width={150}>
            <TextField
              select
              size="small"
              value={view}
              onChange={(e) => setView(e.target.value === 'rate' ? 'rate' : 'fte')}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.costPerFte.show') } }}
              sx={reportFilterSelectSx}
            >
              {VIEWS.map((option) => (
                <MenuItem key={option} value={option} sx={drawerMenuItemSx}>
                  {t(option === 'rate' ? 'reports.costPerFte.dailyRate' : 'reports.costPerFte.costPerFte')}
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.costPerFte.columns')} width={260}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1 }}>
              {selections.map((pair, index) => (
                <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <TextField
                    select
                    size="small"
                    value={pair.year}
                    onChange={(e) => {
                      const year = parseInt(e.target.value, 10);
                      setPicked((prev) => prev.map((it, i) => (i === index ? { ...it, year } : it)));
                    }}
                    SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': pickedLabel(t('reports.filters.year'), index) } }}
                    sx={{ ...reportFilterSelectSx, width: 84 }}
                  >
                    {allowedYears.map((yr) => (<MenuItem key={yr} value={yr} sx={drawerMenuItemSx}>{yr}</MenuItem>))}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    value={pair.metric}
                    onChange={(e) => {
                      const metric = e.target.value as MetricKey;
                      setPicked((prev) => prev.map((it, i) => (i === index ? { ...it, metric } : it)));
                    }}
                    SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': pickedLabel(t('reports.filters.column'), index) } }}
                    sx={{ ...reportFilterSelectSx, width: 140 }}
                  >
                    {budgetColumns.shown.map((column) => (
                      <MenuItem key={column.key} value={column.key} sx={drawerMenuItemSx}>{column.label}</MenuItem>
                    ))}
                  </TextField>
                  <IconButton
                    size="small"
                    aria-label={pickedLabel(t('common:buttons.remove'), index)}
                    disabled={selections.length <= 1}
                    onClick={() => setPicked((prev) => prev.filter((_, i) => i !== index))}
                    sx={{ color: 'kanap.text.secondary' }}
                  >
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Button size="small" startIcon={<AddIcon />} disabled={selections.length >= MAX_COLUMNS} onClick={addPair}>
                {t('reports.budgetColumnsCompare.addSelection')}
              </Button>
            </Box>
          </ReportFilter>
        </>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.({ fileName: `${fileName}.csv` })}
      onExportChartPng={() => chartRef.current?.download(fileName)}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={chartHeight} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>{t('reports.shared.summaryTable')}</Typography>
          {/* AG Grid re-flexes only the flex columns right of a resized column, and the group column is the
              first: new widths or pairs remount the grid so the group column takes exactly the room left. */}
          <ReportGrid
            key={`${view}-${columns.length}-${kinds.map((kindOf) => widths[kindOf]).join('-')}`}
            wrapperClassName="kanap-dense-grid"
            domLayout="autoHeight"
            rowData={tableRows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
            pinnedBottomRowData={[totalRow]}
          />
          {data.detached.length > 0 && (
            <ReportNoticeLine>
              {`${t('reports.measure.detachedList', { list: noticeList(data.detached) })} ${t('reports.costPerFte.detachedNote')}`}
            </ReportNoticeLine>
          )}
          {data.noDetail.length > 0 && (
            <ReportNoticeLine>{t('reports.costPerFte.noDetail', { list: noticeList(data.noDetail) })}</ReportNoticeLine>
          )}
          {data.monthly.length > 0 && (
            <ReportNoticeLine>
              {t('reports.costPerFte.monthlyLeftOut', {
                list: data.monthly.map((entry) => t('reports.costPerFte.monthlyEntry', { column: columnLabel(entry), amount: formatAmount(entry.amount) })).join(', '),
              })}
            </ReportNoticeLine>
          )}
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
