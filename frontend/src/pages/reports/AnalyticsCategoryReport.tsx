import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import { useSearchParams } from 'react-router-dom';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportExclusionPicker from '../../components/reports/ReportExclusionPicker';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { useReportScope } from './useReportScope';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { MetricKey, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { AnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import type { AnalyticsAxis } from '../../services/analytics';
import { drawerMenuItemSx } from '../../theme/formSx';
import { useTranslation } from 'react-i18next';
import { analyticsRequest, readAnalytics } from './reportAggregates';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useAxisValueOptions } from './useReportOptions';

/** `?axis=<dimension id>`: the dimension the report groups on. */
const AXIS_PARAM = 'axis';

/**
 * The dimension named in the address when it is enabled, else the default one. Kept in the address
 * with `replace`, like the item type, so a link opens the report on that dimension.
 */
function useReportAxis(axes: AnalyticsAxes): [AnalyticsAxis | null, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(AXIS_PARAM);
  const axis = axes.enabled.find((candidate) => candidate.id === raw) ?? axes.defaultAxis ?? axes.enabled[0] ?? null;
  const setAxis = useCallback((id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(AXIS_PARAM, id);
      return next;
    }, { replace: true });
  }, [setParams]);
  return [axis, setAxis];
}

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function AnalyticsCategoryReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const now = new Date();
  const Y = now.getFullYear();
  const allowedYears = [Y - 1, Y, Y + 1];

  const [startYear, setStartYear] = useState<number>(Y);
  const [endYear, setEndYear] = useState<number>(Y);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');

  const singleYear = startYear === endYear;
  const years = useMemo(() => allowedYears.filter((yr) => yr >= startYear && yr <= endYear), [allowedYears, startYear, endYear]);

  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);
  const reportFilters = useBudgetReportFilters({ scope });
  const analyticsAxes = reportFilters.analyticsAxes;
  const [axis, setAxis] = useReportAxis(analyticsAxes);
  const axisId = axis?.id ?? null;
  // Headers and the picker take the label; sentences take the name, or a lowercase form for the default
  // dimension without one ("OPEX by analytics dimension").
  const dimensionLabel = axis ? analyticsAxes.label(axis) : t('reports.columns.analyticsCategory');
  const dimensionInSentence = axis?.name?.trim() || t('reports.analyticsCategory.defaultDimensionInSentence');
  // Values belong to one dimension and lines differ between OPEX and CAPEX: either switch drops the exclusions.
  useEffect(() => {
    setExcludedCategories((prev) => (prev.length > 0 ? [] : prev));
  }, [scope, axisId]);
  // The dimension's values and the ones the lines hold, loaded when the picker first opens.
  const [valuesWanted, setValuesWanted] = useState(false);
  const categoryOptions = useAxisValueOptions(scope, axisId, valuesWanted);

  // The server groups the kept lines by their value on the dimension (none: unassigned), one sum per
  // year, the first year's largest first. Until the dimensions are known, nothing is asked: the
  // report would group on the default dimension, then again on the one in the address.
  const request = useMemo(() => (reportFilters.queryFilters == null || !analyticsAxes.ready ? null : analyticsRequest({
    axisId,
    years,
    metric,
    excludedIds: excludedCategories,
    filters: reportFilters.queryFilters,
  })), [reportFilters.queryFilters, analyticsAxes.ready, axisId, years, metric, excludedCategories]);
  const report = useBudgetAggregate(scope, request, { keepPrevious: true });
  const isLoading = report.isLoading;
  const labels = useMemo(() => ({ unassigned: t('reports.analyticsCategory.unassigned'), unnamed: t('reports.analyticsCategory.unnamed') }), [t]);
  const { groups, totals } = useMemo(() => readAnalytics(years, report.data, labels), [years, report.data, labels]);

  const tableRows = useMemo(() => groups.map((group) => {
    const row: any = { group: group.label };
    for (const yr of years) row[yr] = group.values[yr] || 0;
    return row;
  }), [groups, years]);

  const columns = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { field: 'group', headerName: dimensionLabel, flex: 1, minWidth: 240 },
    ];
    for (const yr of years) {
      cols.push({ field: String(yr), headerName: String(yr), width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) });
    }
    return cols;
  }, [years, dimensionLabel]);

  const metricLabel = budgetColumns.label(metric);

  const totalsRow = useMemo(() => {
    const row: any = { group: t('reports.analyticsCategory.totalMetric', { metric: metricLabel }) };
    for (const yr of years) row[yr] = totals[yr] ?? 0;
    return row;
  }, [totals, years, metricLabel, t]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  const metricsCaption = metricLabel;

  const chartOptions = useMemo(() => {
    if (singleYear) {
      const year = years[0];
      const chartData = groups.map((group) => ({ label: group.label, value: group.values[year] || 0 }));
      const total = chartData.reduce((acc, datum) => acc + (Number(datum.value) || 0), 0);
      const base = {
        title: { text: t('reports.analyticsCategory.chartTitleSingle', { type: scopeLabel, dimension: dimensionInSentence, year }) },
        subtitle: { text: metricsCaption || t('reports.analyticsCategory.shareSubtitle') },
        footnote: { text: t('reports.analyticsCategory.totalLabel', { metric: metricsCaption, value: formatNumber(total) }) },
        data: chartData,
        legend: { enabled: false },
        animation: { enabled: true, duration: 800 },
      } as const;
      if (chartType === 'bar') {
        return {
          ...base,
          axes: [
            { type: 'category', position: 'left', label: { padding: 8 } },
            {
              type: 'number',
              position: 'bottom',
              label: {
                formatter: ({ value }: { value: number }) => formatNumber(value),
              },
            },
          ],
          series: [
            {
              type: 'bar',
              direction: 'horizontal',
              xKey: 'label',
              yKey: 'value',
              strokeWidth: 0,
              label: {
                formatter: ({ value }: { value: number }) => formatNumber(value),
              },
              tooltip: {
                enabled: true,
                renderer: ({ datum }: any) => {
                  const value = Number(datum.value || 0);
                  const pct = total > 0 ? (value / total) * 100 : 0;
                  return {
                    title: escapeTooltipText(datum.label),
                    data: [
                      { label: metricLabel, value: formatNumber(value) },
                      { label: t('reports.shared.share'), value: `${pct.toFixed(1)}%` },
                    ],
                  };
                },
              },
            },
          ],
        };
      }
      return {
        ...base,
        series: [
          {
            type: 'pie',
            calloutLabelKey: 'label',
            sectorLabelKey: 'value',
            angleKey: 'value',
            calloutLabel: { offset: 20 },
            sectorLabel: {
              positionOffset: 30,
              formatter: ({ datum, angleKey }: any) => {
                const value = Number(datum[angleKey] || 0);
                const pct = total > 0 ? (value / total) * 100 : 0;
                const shown = Math.round(pct);
                return shown >= 5 ? `${shown}%` : '';
              },
            },
            strokeWidth: 1,
          },
        ],
      };
    }
    const chartData = years.map((yr) => {
      const row: any = { year: yr };
      for (const group of groups) row[group.key] = group.values[yr] || 0;
      return row;
    });
    const series = groups.map((group) => ({ type: 'line', xKey: 'year', yKey: group.key, yName: group.label }));
    return {
      title: { text: t('reports.analyticsCategory.chartTitleRange', { type: scopeLabel, dimension: dimensionInSentence, start: years[0], end: years[years.length - 1] }) },
      subtitle: { text: metricsCaption || t('reports.analyticsCategory.annualSubtitle') },
      data: chartData,
      series,
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left' },
      ],
      legend: { enabled: true },
    };
  }, [groups, singleYear, years, metricsCaption, chartType, metricLabel, scopeLabel, dimensionInSentence, t]);

  return (
    <ReportLayout
      title={t("reports.analyticsCategory.title")}
      subtitle={t('reports.analyticsCategory.subtitle', { type: scopeLabel, dimension: dimensionInSentence })}
      filters={(
        <>
          <ItemScopeTabs value={scope} onChange={setScope} />
          {axis && analyticsAxes.enabled.length >= 2 && (
            <ReportFilter label={t('reports.filters.dimension')} width={200}>
              <TextField
                select
                size="small"
                value={axis.id}
                onChange={(e) => setAxis(String(e.target.value))}
                SelectProps={{
                  MenuProps: reportFilterMenuProps,
                  inputProps: { 'aria-label': t('reports.filters.dimension') },
                }}
                sx={reportFilterSelectSx}
              >
                {analyticsAxes.enabled.map((option) => (
                  <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>{analyticsAxes.label(option)}</MenuItem>
                ))}
              </TextField>
            </ReportFilter>
          )}
          <BudgetReportFilters filters={reportFilters} />
          <ReportFilter label={t('reports.filters.startYear')} width={100}>
            <TextField
              select
              size="small"
              value={startYear}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setStartYear(v);
                if (v > endYear) setEndYear(v);
              }}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.startYear') } }}
              sx={reportFilterSelectSx}
            >
              {allowedYears.map((yr) => (<MenuItem key={yr} value={yr} sx={drawerMenuItemSx}>{yr}</MenuItem>))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.filters.endYear')} width={100}>
            <TextField
              select
              size="small"
              value={endYear}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setEndYear(v);
                if (v < startYear) setStartYear(v);
              }}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.endYear') } }}
              sx={reportFilterSelectSx}
            >
              {allowedYears.map((yr) => (<MenuItem key={yr} value={yr} sx={drawerMenuItemSx}>{yr}</MenuItem>))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.filters.metric')} width={200}>
            <TextField
              select
              size="small"
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.metric') } }}
              sx={reportFilterSelectSx}
            >
              {budgetColumns.shown.map((column) => (
                <MenuItem key={column.key} value={column.key} sx={drawerMenuItemSx}>{column.label}</MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.filters.chartType')} width={180}>
            <TextField
              select
              size="small"
              value={chartType}
              onChange={(e) => setChartType(e.target.value as 'pie' | 'bar')}
              disabled={!singleYear}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.chartType') } }}
              sx={reportFilterSelectSx}
            >
              <MenuItem value="pie" sx={drawerMenuItemSx}>{t('reports.filters.pieChart')}</MenuItem>
              <MenuItem value="bar" sx={drawerMenuItemSx}>{t('reports.filters.horizontalBarChart')}</MenuItem>
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.filters.excludeCategories')} width={280}>
            <ReportExclusionPicker
              inFilter
              label={t('reports.filters.excludeCategories')}
              placeholder={t('reports.filters.excludeCategoriesPlaceholder')}
              selectedText={(count) => t('reports.filters.categorySelected', { count })}
              noOptionsText={t('reports.filters.noMatchingCategories')}
              options={categoryOptions.options}
              loading={categoryOptions.loading}
              onFirstOpen={() => setValuesWanted(true)}
              value={excludedCategories}
              onChange={setExcludedCategories}
            />
          </ReportFilter>
        </>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => chartRef.current?.download(`analytics-${scope}-${years[0]}-${years[years.length - 1]}`)}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>{t("reports.shared.summaryTable")}</Typography>
          <ReportGrid
            wrapperSx={{ height: 520 }}
            rowData={tableRows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
            pinnedBottomRowData={[totalsRow]}
          />
        </Paper>
      </Stack>
      <ReportDataStatus loading={isLoading} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
