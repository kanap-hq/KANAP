import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import type { ColDef } from 'ag-grid-community';
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
import { metricFileName, MetricKey, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { MONTHS, readStaffing, requestFirstYear, staffingChartSeries, staffingRequest } from './reportAggregates';
import { compareNames, useBudgetAggregate } from './useBudgetAggregate';
import { ReportNoticeLine } from './reportMeasure';
import { GROUP_FILE_NAME, ReportGroupFilters, useGroupLinks, useReportGroup } from './reportGroup';
import ReportGroupLinkCell from './ReportGroupLinkCell';
import { gridTextMeasure, valueColumnWidth } from './reportValueWidth';

const monthField = (month: number) => `m${month}`;
/**
 * The fourteen value columns (twelve months, average, peak), all as wide as the widest value among them
 * (a uniform grid reads better). The width is known before the grid lays out, so the group column's flex
 * takes exactly the room left; `headerTooltip` shows a cut header in full.
 */
export const VALUE_COLUMN_IDS: readonly string[] = [...MONTHS.map(monthField), 'average', 'peak'];

export default function StaffingByMonthReport() {
  const { t } = useTranslation(['ops']);
  const locale = useLocale();
  const budgetColumns = useBudgetColumns();
  const Y = new Date().getFullYear();
  const [year, setYear] = useState<number>(Y);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const columnLabel = budgetColumns.label(metric);
  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);
  const fte = useCallback((value: unknown) => formatFte(value, locale), [locale]);

  const reportFilters = useBudgetReportFilters({ scope });
  const grouping = useReportGroup(reportFilters.analyticsAxes);
  // The group as the first column names it, as a sentence names it, and its rows without a key.
  const { kind, group, header: groupHeader, inSentence: groupInSentence, labels } = grouping;

  // One request: per group, the twelve monthly FTE of the column; on the total row, the notices.
  const request = useMemo(() => (reportFilters.queryFilters == null || group == null ? null : staffingRequest({
    scope,
    year,
    metric,
    group,
    filters: reportFilters.queryFilters,
  })), [reportFilters.queryFilters, scope, year, metric, group]);
  const report = useBudgetAggregate(scope, request, { keepPrevious: true });
  // A group name opens its item, or the list of the lines the row counts (the group, the bar, the
  // report's window, the lines that declare FTE), in a new tab.
  const groupLink = useGroupLinks(scope, grouping, reportFilters, { firstYear: requestFirstYear(request, Y), fteOnly: true });
  const busy = request == null || report.isLoading || report.isPlaceholderData;
  const staffing = useMemo(() => readStaffing(report.data, labels, compareNames), [report.data, labels]);

  const monthNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { month: 'short' });
    return MONTHS.map((month) => format.format(new Date(year, month - 1, 1)));
  }, [locale, year]);

  const tableRows = useMemo(() => staffing.rows.map((row) => ({
    group: row.label,
    groupKey: row.key,
    groupName: row.name,
    ...Object.fromEntries(MONTHS.map((month, i) => [monthField(month), row.months[i]])),
    average: row.average,
    peak: row.peak,
  })), [staffing.rows]);
  const totalRow = useMemo(() => ({
    group: t('reports.columns.total'),
    ...Object.fromEntries(MONTHS.map((month, i) => [monthField(month), staffing.total.months[i]])),
    average: staffing.total.average,
    peak: staffing.total.peak,
  }), [staffing.total, t]);

  // Fifteen columns on the dense grid: the fourteen value columns share one width, measured from their
  // values before the grid lays out; the group column flexes into the rest and shows its full name on hover.
  const textMetrics = useMemo(() => gridTextMeasure(), []);
  const valueWidth = useMemo(() => valueColumnWidth({
    rows: tableRows,
    total: totalRow,
    ids: VALUE_COLUMN_IDS,
    format: fte,
    measure: textMetrics.measure,
    cellPadding: textMetrics.cellPadding,
  }), [tableRows, totalRow, fte, textMetrics]);
  const columns = useMemo<ColDef[]>(() => {
    const value = (field: string, headerName: string): ColDef => ({
      field,
      colId: field,
      headerName,
      headerTooltip: headerName,
      type: 'rightAligned',
      width: valueWidth,
      valueFormatter: (p) => fte(p.value),
    });
    return [
      {
        field: 'group',
        headerName: groupHeader,
        flex: 1,
        minWidth: 180,
        tooltipField: 'group',
        cellRenderer: ReportGroupLinkCell,
        cellRendererParams: { getLink: groupLink },
      },
      ...MONTHS.map((month, i) => value(monthField(month), monthNames[i])),
      value('average', t('reports.staffing.average')),
      value('peak', t('reports.staffing.peak')),
    ];
  }, [groupHeader, groupLink, monthNames, fte, valueWidth, t]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  const chartOptions = useMemo(() => {
    const { series, others } = staffingChartSeries(staffing.rows);
    const areas = others ? [...series.map((row) => ({ label: row.label, months: row.months })), { label: t('reports.staffing.others'), months: others }] : series;
    const data = monthNames.map((month, i) => ({
      month,
      ...Object.fromEntries(areas.map((area, index) => [`s${index}`, area.months[i]])),
    }));
    return {
      title: { text: t('reports.staffing.chartTitle', { type: scopeLabel, group: groupInSentence, column: columnLabel, year }) },
      data,
      series: areas.map((area, index) => ({
        type: 'area',
        xKey: 'month',
        yKey: `s${index}`,
        yName: area.label,
        stacked: true,
        tooltip: {
          renderer: ({ datum, yKey }: any) => ({
            title: escapeTooltipText(area.label),
            data: [{ label: datum.month, value: fte(datum[yKey]) }],
          }),
        },
      })),
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left', title: { text: t('reports.measure.fte') }, label: { formatter: ({ value }: { value: number }) => fte(value) } },
      ],
      legend: { enabled: true, position: 'bottom' },
      animation: { enabled: true, duration: 800 },
    };
  }, [staffing.rows, monthNames, scopeLabel, groupInSentence, columnLabel, year, fte, t]);

  const fileName = `staffing-${scope}-${year}-${metricFileName(budgetColumns, metric)}-${GROUP_FILE_NAME[kind]}`;

  return (
    <ReportLayout
      busy={busy}
      title={t('reports.staffing.title')}
      subtitle={t('reports.staffing.subtitle', { type: scopeLabel, group: groupInSentence })}
      filters={(
        <>
          <ItemScopeTabs value={scope} onChange={setScope} />
          <BudgetReportFilters filters={reportFilters} />
          <ReportFilter label={t('reports.filters.year')} width={100}>
            <TextField
              select
              size="small"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.year') } }}
              sx={reportFilterSelectSx}
            >
              {[Y - 1, Y, Y + 1].map((yr) => (<MenuItem key={yr} value={yr} sx={drawerMenuItemSx}>{yr}</MenuItem>))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.filters.column')} width={180}>
            <TextField
              select
              size="small"
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.column') } }}
              sx={reportFilterSelectSx}
            >
              {budgetColumns.shown.map((column) => (
                <MenuItem key={column.key} value={column.key} sx={drawerMenuItemSx}>{column.label}</MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportGroupFilters state={grouping} />
        </>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.({ fileName: `${fileName}.csv` })}
      onExportChartPng={() => chartRef.current?.download(fileName)}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>{t('reports.shared.summaryTable')}</Typography>
          {/* AG Grid re-flexes only the flex columns right of a resized column, and the group column is the
              first: a new shared width remounts the grid so the group column takes exactly the room left. */}
          <ReportGrid
            key={`staffing-${valueWidth}`}
            wrapperClassName="kanap-dense-grid"
            domLayout="autoHeight"
            rowData={tableRows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
            pinnedBottomRowData={[totalRow]}
          />
          {staffing.detached && (
            <ReportNoticeLine>{t('reports.measure.detachedSingle', { count: staffing.detached.items, fte: fte(staffing.detached.fte) })}</ReportNoticeLine>
          )}
          {staffing.noDetail && (
            <ReportNoticeLine>{t('reports.staffing.noDetail', { count: staffing.noDetail.items, fte: fte(staffing.noDetail.fte) })}</ReportNoticeLine>
          )}
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
