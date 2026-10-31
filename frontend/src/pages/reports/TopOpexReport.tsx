import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportExclusionPicker from '../../components/reports/ReportExclusionPicker';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { itemHref, useReportScope } from './useReportScope';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { metricFileName, MetricKey, useReportMetric } from './reportMetrics';
import { drawnSliceTotal, percentPoints, pieSliceLabel } from './pieSliceLabel';
import { escapeTooltipText, tooltipContent } from './tooltipText';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useTranslation } from 'react-i18next';
import { formatPercentPoints } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { excludedAccountValues, readTopItems, topItemsRequest } from './reportAggregates';
import { topLinesTable } from './reportTables';
import { useReportTableLabels } from './useReportTableLabels';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useAccountLabelOptions, useItemOptions } from './useReportOptions';
import { ReportFteNotice, ReportMeasureSelect, useMeasureText, useReportMeasure } from './reportMeasure';

export default function TopOpexReport() {
  const { t } = useTranslation(["ops"]);
  const locale = useLocale();
  const budgetColumns = useBudgetColumns();
  const now = new Date();
  const Y = now.getFullYear();
  const [year, setYear] = useState<number>(Y);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const [topCount, setTopCount] = useState<number>(10);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');
  const [measure, setMeasure] = useReportMeasure();
  const measureText = useMeasureText(measure);
  const formatNumber = measureText.format;
  // The column as the measure reads it: `Budget`, or `Budget FTE`.
  const metricLabel = measureText.column(budgetColumns.label(metric));
  const tableLabels = useReportTableLabels();
  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);

  const reportFilters = useBudgetReportFilters({ scope });
  // The exclusion pickers offer every line and account of the window; they load when first opened.
  const [itemsWanted, setItemsWanted] = useState(false);
  const [accountsWanted, setAccountsWanted] = useState(false);
  const itemOptions = useItemOptions(scope, itemsWanted);
  const accountOptions = useAccountLabelOptions(scope, accountsWanted);
  // Lines and the accounts they use differ between OPEX and CAPEX: a type switch drops both exclusions.
  useEffect(() => {
    setExcludedIds([]);
    setExcludedAccounts([]);
  }, [scope]);

  // The server keeps the lines of the filter bar, leaves out the excluded lines and accounts, and
  // returns the top lines and the total of every kept line. The preselected column is the tenant
  // default: wait for the setting, or the product default is asked first.
  const request = useMemo(() => (!budgetColumns.ready || reportFilters.queryFilters == null ? null : topItemsRequest({
    scope,
    year,
    metric,
    topCount,
    excludedIds,
    excludedAccounts: excludedAccountValues(excludedAccounts, accountOptions.options ?? []),
    filters: reportFilters.queryFilters,
    measure,
  })), [budgetColumns.ready, reportFilters.queryFilters, scope, year, metric, topCount, excludedIds, excludedAccounts, accountOptions.options, measure]);
  const report = useBudgetAggregate(scope, request, { keepPrevious: true });
  // Loading, the column setting or the filter bar still unread, or the last answer kept while the new one loads.
  const busy = !budgetColumns.ready || reportFilters.queryFilters == null || report.isLoading || report.isPlaceholderData;
  // FTE: the lines that declare none are left out, and no line declaring any leaves the total blank.
  const { processed, totalMetric: knownTotal, topSelectionTotal } = useMemo(() => readTopItems(report.data, measure), [report.data, measure]);
  const totalMetric = knownTotal ?? 0;

  // The key table (`reportTables.ts`, the same code as the export): the share of the total is a fraction.
  const table = useMemo(() => topLinesTable({ year, metric, measure }, report.data, tableLabels), [year, metric, measure, report.data, tableLabels]);
  const columns = useMemo<ColDef[]>(() => table.columns.map((column): ColDef => {
    if (column.key === 'reference') {
      return {
        field: column.key,
        headerName: column.header,
        width: 110,
        cellStyle: {
          color: 'var(--kanap-text-secondary)',
          fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
          fontVariantNumeric: 'tabular-nums',
          fontSize: '12px',
        },
      };
    }
    if (column.key === 'name') {
      return {
        field: column.key,
        headerName: column.header,
        flex: 1,
        minWidth: 220,
        cellRenderer: LinkCellRenderer,
        cellRendererParams: { newTab: true, getHref: (row: { id?: string | null; itemNumber?: number }) => itemHref(scope, row.id, row.itemNumber) },
      };
    }
    if (column.kind === 'percent') {
      return { field: column.key, headerName: column.header, width: 160, type: 'rightAligned', valueFormatter: (p) => (p.value != null ? `${Math.round(p.value * 100)}%` : '') };
    }
    return { field: column.key, headerName: column.header, width: 160, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) };
  }), [table, scope, formatNumber]);

  const chartRef = useRef<ChartCardHandle>(null);

  const chartData = useMemo(() => processed.map((r) => ({ name: r.name, value: r.value })), [processed]);
  const chartOptions = useMemo(() => {
    // The pie is read as parts of what it draws. An "others" slice counts once it is in `chartData`.
    const drawnTotal = drawnSliceTotal(chartData.map((row) => row.value));
    const base = {
      title: { text: t('reports.topOpex.chartTitle', { count: chartData.length, type: scopeLabel, context: scope, metric: metricLabel, year }) },
      // Slice labels are shares of the slices drawn. Bar tooltips stay shares of the annual total.
      subtitle: {
        text: chartType === 'pie'
          ? t('reports.topOpex.pieShareSubtitle', { count: chartData.length, metric: metricLabel })
          : t('reports.topOpex.shareSubtitle', { metric: metricLabel }),
      },
      footnote: { text: `${t('reports.topOpex.totalMetric', { metric: metricLabel })}: ${formatNumber(knownTotal)}` },
      data: chartData,
      legend: { enabled: false },
      animation: { enabled: true, duration: 800 },
    };
    if (chartType === 'pie') {
      return {
        ...base,
        series: [
          {
            type: 'pie',
            calloutLabelKey: 'name',
            sectorLabelKey: 'value',
            angleKey: 'value',
            calloutLabel: { offset: 20 },
            sectorLabel: {
              positionOffset: 30,
              formatter: ({ datum, angleKey }: any) => pieSliceLabel(Number(datum[angleKey] || 0), drawnTotal),
            },
            strokeWidth: 1,
            tooltip: {
              enabled: true,
              renderer: (params: any) => {
                const { datum, angleKey } = params;
                const value = Number(datum[angleKey] || 0);
                const data = [
                  { label: metricLabel, value: formatNumber(value) },
                  { label: t('reports.shared.share'), value: formatPercentPoints(percentPoints(value, drawnTotal), locale, 1) },
                  { label: t('reports.topOpex.shareOfAllLines'), value: formatPercentPoints(percentPoints(value, totalMetric), locale, 1) },
                ];
                return { title: escapeTooltipText(datum.name), content: tooltipContent(data), data };
              },
            },
          },
        ],
      };
    }
    return {
      ...base,
      axes: [
        { type: 'category', position: 'left', label: { padding: 8 } },
        {
          type: 'number',
          position: 'bottom',
          ...(measureText.axisTitle ? { title: measureText.axisTitle } : {}),
          label: {
            formatter: ({ value }: { value: number }) => formatNumber(value),
          },
        },
      ],
      series: [
        {
          type: 'bar',
          direction: 'horizontal',
          xKey: 'name',
          yKey: 'value',
          strokeWidth: 0,
          label: {
            formatter: ({ value }: { value: number }) => formatNumber(value),
          },
          tooltip: {
            enabled: true,
            renderer: ({ datum }: any) => {
              const value = Number(datum.value || 0);
              const pct = totalMetric > 0 ? (value / totalMetric) * 100 : 0;
              return {
                title: escapeTooltipText(datum.name),
                data: [
                  { label: metricLabel, value: formatNumber(value) },
                  { label: t('reports.shared.share'), value: formatPercentPoints(pct, locale, 1) },
                ],
              };
            },
          },
        },
      ],
    };
  }, [chartData, totalMetric, knownTotal, year, chartType, metricLabel, scopeLabel, measureText, formatNumber, locale, t]);

  const selectionSharePct = useMemo(() => (
    topSelectionTotal != null && totalMetric > 0 ? Math.round((topSelectionTotal / totalMetric) * 100) : null
  ), [topSelectionTotal, totalMetric]);

  return (
    <ReportLayout
      busy={busy}
      fxMissing={report.data?.fxMissing}
      title={t("reports.topOpex.title")}
      subtitle={t('reports.topOpex.subtitle', { type: scopeLabel, context: scope, metric: metricLabel })}
      filters={(
        <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: { xs: 1, md: 1.5 },
          rowGap: { xs: 1, md: 1.5 },
          alignItems: 'flex-start',
        }}
        >
          <ItemScopeTabs allowAll value={scope} onChange={setScope} />
          <ReportMeasureSelect value={measure} onChange={setMeasure} />
          <BudgetReportFilters filters={reportFilters} />
          <TextField select size="small" label={t("reports.filters.year")} value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} sx={{ minWidth: 140 }}>
            <MenuItem value={Y - 1}>{Y - 1}</MenuItem>
            <MenuItem value={Y}>{Y}</MenuItem>
            <MenuItem value={Y + 1}>{Y + 1}</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.metric")}
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            sx={{ minWidth: 180 }}
          >
            {budgetColumns.shown.map((column) => (
              <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            label={t("reports.filters.topCount")}
            value={topCount}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10);
              setTopCount(Number.isNaN(next) ? 1 : Math.max(1, next));
            }}
            inputProps={{ min: 1, step: 1 }}
            sx={{ minWidth: 150 }}
          />
          <TextField
            select
            size="small"
            label={t("reports.filters.chartType")}
            value={chartType}
            onChange={(e) => setChartType(e.target.value as 'pie' | 'bar')}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="pie">{t("reports.filters.pieChart")}</MenuItem>
            <MenuItem value="bar">{t("reports.filters.horizontalBarChart")}</MenuItem>
          </TextField>
          <ReportExclusionPicker
            label={t('reports.filters.excludeItems')}
            placeholder={t('reports.filters.excludeItemsPlaceholder')}
            selectedText={(count) => t('reports.filters.itemSelected', { count })}
            noOptionsText={t('reports.filters.noMatchingItems')}
            options={itemOptions.options}
            loading={itemOptions.loading}
            onFirstOpen={() => setItemsWanted(true)}
            value={excludedIds}
            onChange={setExcludedIds}
          />
          <ReportExclusionPicker
            label={t('reports.filters.excludeAccounts')}
            placeholder={t('reports.filters.excludeAccountsPlaceholder')}
            selectedText={(count) => t('reports.filters.accountSelected', { count })}
            noOptionsText={t('reports.filters.noMatchingAccounts')}
            options={accountOptions.options?.map((option) => ({ id: option.id, label: option.name }))}
            loading={accountOptions.loading}
            onFirstOpen={() => setAccountsWanted(true)}
            value={excludedAccounts}
            onChange={setExcludedAccounts}
          />
        </Box>
      )}
      tableExport={{
        url: '/reports/budget/top-lines/export',
        params: {
          scope,
          measure,
          ...reportFilters.exportParams,
          year,
          metric,
          top: topCount,
          excludeIds: excludedIds.join(','),
          // Account labels may hold commas: a JSON list.
          excludeAccounts: excludedAccounts.length ? JSON.stringify(excludedAccounts) : undefined,
        },
        fileBase: measureText.fileName(`top${processed.length}-${scope}-${year}-${metric}`),
      }}
      onExportChartPng={() => chartRef.current?.download(measureText.fileName(`top${processed.length}-${scope}-${year}-${metricFileName(budgetColumns, metric)}-${chartType}`))}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{t("reports.shared.keyTable")}</Typography>
          <ReportGrid
            rowData={table.rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            domLayout="autoHeight"
          />
          <ReportFteNotice scope={scope} request={request} result={report.data} columnLabel={(column) => `${budgetColumns.label(column.metric)} ${column.year}`} />
          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" color="text.secondary">{t('reports.topOpex.topTotal', { count: processed.length })}</Typography>
              <Typography variant="subtitle2">{formatNumber(topSelectionTotal)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {selectionSharePct == null ? '—' : t('reports.topOpex.ofFilteredMetric', { pct: selectionSharePct })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" color="text.secondary">{t('reports.topOpex.totalMetric', { metric: metricLabel })}</Typography>
              <Typography variant="subtitle2">{formatNumber(knownTotal)}</Typography>
            </Box>
          </Box>
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
