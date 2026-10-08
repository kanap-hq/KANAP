import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import RemoveIcon from '@mui/icons-material/RemoveCircleOutline';
import AddIcon from '@mui/icons-material/Add';
import type { ColDef, ColGroupDef } from 'ag-grid-community';
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
  readCostPerFte,
  type ColumnYear,
  type CostPerFteCell,
  type CostPerFteNotice,
} from './reportAggregates';
import { compareNames, useBudgetAggregates } from './useBudgetAggregate';
import { formatAmount, ReportNoticeLine } from './reportMeasure';
import { GROUP_FILE_NAME, ReportGroupFilters, useReportGroup } from './reportGroup';
import { gridTextMeasure, valueColumnWidth } from './reportValueWidth';

/** The most year and column pairs the report compares. */
export const MAX_COLUMNS = 4;

/** A pair as picked: no column yet means the default column (and follows it). */
type PickedColumn = { year: number; metric: MetricKey | null };

/** The three values of a pair, as the grid's field ids (`c0_fte`, `c0_cost`, `c0_ratio`). */
const VALUES = ['fte', 'cost', 'ratio'] as const;
type ValueKind = (typeof VALUES)[number];
const fieldOf = (index: number, kind: ValueKind) => `c${index}_${kind}`;

/** An amount, blank when there is none (a ratio without FTE, a cost without staff). */
const money = (value: unknown) => (value == null ? '' : formatAmount(value));

/** Chronological: by year, then in the budget columns' fixed order; each pair once. */
function distinctColumns(columns: readonly ColumnYear[]): ColumnYear[] {
  const byKey = new Map<string, ColumnYear>();
  for (const column of columns) byKey.set(`${column.year}:${column.metric}`, column);
  return Array.from(byKey.values()).sort((a, b) => a.year - b.year || metricKeys.indexOf(a.metric) - metricKeys.indexOf(b.metric));
}

function cellValues(index: number, cell: CostPerFteCell | undefined): Record<string, number | null> {
  return { [fieldOf(index, 'fte')]: cell?.fte ?? null, [fieldOf(index, 'cost')]: cell?.cost ?? null, [fieldOf(index, 'ratio')]: cell?.ratio ?? null };
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

  // One request per pair: per group, the staff cost and FTE; on the total row, the notices.
  const requests = useMemo(() => (reportFilters.queryFilters == null || group == null ? null : costPerFteRequests({
    scope,
    columns,
    group,
    filters: reportFilters.queryFilters,
  })), [reportFilters.queryFilters, scope, columns, group]);
  const report = useBudgetAggregates(scope, requests, { keepPrevious: true });
  const busy = requests == null || report.isLoading || report.isPlaceholderData;
  // While a new pair loads, the kept answers may hold fewer pairs: read nothing rather than shifted columns.
  const results = report.data && report.data.length === columns.length ? report.data : undefined;
  const data = useMemo(() => readCostPerFte(columns, results, labels, compareNames), [columns, results, labels]);

  const tableRows = useMemo(() => data.rows.map((row) => ({
    group: row.label,
    ...Object.assign({}, ...columns.map((_, index) => cellValues(index, row.cells[index]))),
  })), [data.rows, columns]);
  const totalRow = useMemo(() => ({
    group: t('reports.columns.total'),
    ...Object.assign({}, ...columns.map((_, index) => cellValues(index, data.total[index]))),
  }), [data.total, columns, t]);

  // The value columns of a kind share one width, measured from their values before the grid lays out;
  // the group column flexes into the rest and shows its full name on hover.
  const textMetrics = useMemo(() => gridTextMeasure(), []);
  const widths = useMemo(() => {
    const width = (kindOf: ValueKind, format: (value: unknown) => string) => valueColumnWidth({
      rows: tableRows,
      total: totalRow,
      ids: columns.map((_, index) => fieldOf(index, kindOf)),
      format,
      measure: textMetrics.measure,
      cellPadding: textMetrics.cellPadding,
    });
    return { fte: width('fte', fte), cost: width('cost', money), ratio: width('ratio', money) } as Record<ValueKind, number>;
  }, [tableRows, totalRow, columns, fte, textMetrics]);

  const valueHeaders = useMemo<Record<ValueKind, string>>(() => ({
    fte: t('reports.measure.fte'),
    cost: t('reports.costPerFte.staffCost'),
    ratio: t('reports.costPerFte.costPerFte'),
  }), [t]);
  const columnDefs = useMemo<Array<ColDef | ColGroupDef>>(() => [
    { field: 'group', headerName: groupHeader, flex: 1, minWidth: 180, tooltipField: 'group' },
    ...columns.map((column, index): ColGroupDef => ({
      groupId: `c${index}`,
      headerName: columnLabel(column),
      children: VALUES.map((kindOf): ColDef => ({
        field: fieldOf(index, kindOf),
        colId: fieldOf(index, kindOf),
        headerName: valueHeaders[kindOf],
        headerTooltip: `${columnLabel(column)} · ${valueHeaders[kindOf]}`,
        type: 'rightAligned',
        width: widths[kindOf],
        valueFormatter: (p) => (kindOf === 'fte' ? fte(p.value) : money(p.value)),
      })),
    })),
  ], [groupHeader, columns, columnLabel, valueHeaders, widths, fte]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  const chartTitle = t('reports.costPerFte.chartTitle', { type: scopeLabel, group: groupInSentence });
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
        ...Object.assign({}, ...columns.map((_, index) => cellValues(index, category.cells[index]))),
      })),
      // Categories by key (two items may share a name), shown by name.
      axes: [
        { type: 'category', position: 'left', label: { padding: 8, formatter: ({ value }: { value: string }) => labelOf.get(value) ?? '' } },
        {
          type: 'number',
          position: 'bottom',
          title: { text: valueHeaders.ratio },
          label: { formatter: ({ value }: { value: number }) => money(value) },
        },
      ],
      series: columns.map((column, index) => ({
        type: 'bar',
        direction: 'horizontal',
        xKey: 'key',
        yKey: fieldOf(index, 'ratio'),
        yName: columnLabel(column),
        strokeWidth: 0,
        tooltip: {
          enabled: true,
          renderer: ({ datum }: any) => ({
            title: escapeTooltipText(datum.label),
            data: [
              { label: t('reports.filters.column'), value: escapeTooltipText(columnLabel(column)) },
              { label: valueHeaders.ratio, value: money(datum[fieldOf(index, 'ratio')]) },
              { label: valueHeaders.fte, value: fte(datum[fieldOf(index, 'fte')]) },
              { label: valueHeaders.cost, value: money(datum[fieldOf(index, 'cost')]) },
            ],
          }),
        },
      })),
      legend: { enabled: true, position: 'bottom' },
      animation: { enabled: true, duration: 800 },
    };
  }, [chartCategories, chartTitle, columns, columnLabel, valueHeaders, fte, t]);
  const chartHeight = Math.max(260, Math.min(900, 140 + chartCategories.length * (12 + 14 * columns.length)));

  const first = columns[0];
  const fileName = `cost-per-fte-${scope}-${GROUP_FILE_NAME[kind]}-${first ? `${first.year}-${metricFileName(budgetColumns, first.metric)}` : Y}`;

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
            key={`cost-per-fte-${columns.length}-${widths.fte}-${widths.cost}-${widths.ratio}`}
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
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
