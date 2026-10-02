import React, { useMemo, useRef, useState } from 'react';
import { MenuItem, Paper, Stack, TextField, Typography, Box } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportExclusionPicker from '../../components/reports/ReportExclusionPicker';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { useReportScope } from './useReportScope';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { MetricKey, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useTranslation } from 'react-i18next';
import { consolidationRequest, readConsolidation } from './reportAggregates';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useAccountIdOptions } from './useReportOptions';

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function ConsolidationReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const now = new Date();
  const Y = now.getFullYear();
  const allowedYears = [Y - 1, Y, Y + 1];

  const [startYear, setStartYear] = useState<number>(Y);
  const [endYear, setEndYear] = useState<number>(Y);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');

  const singleYear = startYear === endYear;
  const years = useMemo(() => allowedYears.filter((yr) => yr >= startYear && yr <= endYear), [allowedYears, startYear, endYear]);

  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);
  const reportFilters = useBudgetReportFilters({ scope });
  // The tenant's accounts and the accounts the lines use (inactive ones included: their lines count
  // in their consolidation line), loaded when the picker first opens.
  const [accountsWanted, setAccountsWanted] = useState(false);
  const accountOptions = useAccountIdOptions(scope, accountsWanted);

  // The server groups the kept lines by the consolidation line of their account, one sum per year,
  // the first year's largest first; lines without one are unassigned.
  const request = useMemo(() => (reportFilters.queryFilters == null ? null : consolidationRequest({
    years,
    metric,
    excludedAccountIds: excludedAccounts,
    filters: reportFilters.queryFilters,
  })), [reportFilters.queryFilters, years, metric, excludedAccounts]);
  const report = useBudgetAggregate(scope, request, { keepPrevious: true });
  // Loading, the filter bar still reading its address, or the last answer kept while the new one loads.
  const busy = reportFilters.queryFilters == null || report.isLoading || report.isPlaceholderData;
  const unassigned = t('reports.consolidation.unassigned');
  const { groups, totals } = useMemo(() => readConsolidation(years, report.data, unassigned), [years, report.data, unassigned]);

  // Table rows
  const tableRows = useMemo(() => {
    return groups.map((g) => {
      const row: any = { group: g.label };
      for (const yr of years) row[yr] = g.values[yr] || 0;
      return row;
    });
  }, [groups, years]);

  const columns = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { field: 'group', headerName: t('reports.columns.consolidationAccount'), flex: 1, minWidth: 240 },
    ];
    for (const yr of years) {
      cols.push({ field: String(yr), headerName: String(yr), width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) });
    }
    return cols;
  }, [years]);

  const metricLabel = budgetColumns.label(metric);

  const totalsRow = useMemo(() => {
    const row: any = { group: t('reports.consolidation.totalMetric', { metric: metricLabel }) };
    for (const yr of years) row[yr] = totals[yr] ?? 0;
    return row;
  }, [totals, years, metricLabel, t]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  // Chart data and options
  const metricsCaption = metricLabel;

  const chartOptions = useMemo(() => {
    if (singleYear) {
      const year = years[0];
      const chartData = groups.map((g) => ({ label: g.label, value: g.values[year] || 0 }));
      const total = chartData.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
      const base = {
        title: { text: t('reports.consolidation.chartTitleSingle', { type: scopeLabel, year }) },
        subtitle: { text: metricsCaption || t('reports.consolidation.shareSubtitle') },
        footnote: { text: t('reports.consolidation.totalLabel', { metric: metricsCaption, value: formatNumber(total) }) },
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
    // Multi-year: line chart with one series per group
    const chartData = years.map((yr) => {
      const row: any = { year: yr };
      for (const g of groups) row[g.key] = g.values[yr] || 0;
      return row;
    });
    const series = groups.map((g) => ({ type: 'line', xKey: 'year', yKey: g.key, yName: g.label }));
    return {
      title: { text: t('reports.consolidation.chartTitleRange', { type: scopeLabel, start: years[0], end: years[years.length - 1] }) },
      subtitle: { text: metricsCaption || t('reports.consolidation.annualSubtitle') },
      data: chartData,
      series,
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left' },
      ],
      legend: { enabled: true },
    };
  }, [groups, singleYear, years, metricsCaption, chartType, metricLabel, scopeLabel, t]);

  return (
    <ReportLayout
      busy={busy}
      title={t("reports.consolidation.title")}
      subtitle={t('reports.consolidation.subtitle', { type: scopeLabel })}
      filters={(
        <>
          <ItemScopeTabs value={scope} onChange={setScope} />
          <BudgetReportFilters filters={reportFilters} />
          <TextField select size="small" label={t("reports.filters.startYear")} value={startYear} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setStartYear(v);
            if (v > endYear) setEndYear(v);
          }} InputLabelProps={{ shrink: true }}>
            {allowedYears.map((yr) => (<MenuItem key={yr} value={yr}>{yr}</MenuItem>))}
          </TextField>
          <TextField select size="small" label={t("reports.filters.endYear")} value={endYear} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setEndYear(v);
            if (v < startYear) setStartYear(v);
          }} InputLabelProps={{ shrink: true }}>
            {allowedYears.map((yr) => (<MenuItem key={yr} value={yr}>{yr}</MenuItem>))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.metric")}
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            sx={{ minWidth: 200 }}
            InputLabelProps={{ shrink: true }}
          >
            {budgetColumns.shown.map((column) => (
              <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.chartType")}
            value={chartType}
            onChange={(e) => setChartType(e.target.value as 'pie' | 'bar')}
            disabled={!singleYear}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="pie">{t("reports.filters.pieChart")}</MenuItem>
            <MenuItem value="bar">{t("reports.filters.horizontalBarChart")}</MenuItem>
          </TextField>
          <ReportExclusionPicker
            label={t('reports.filters.excludeAccounts')}
            placeholder={t('reports.filters.excludeAccountsPlaceholder')}
            selectedText={(count) => t('reports.filters.accountSelected', { count })}
            noOptionsText={t('reports.filters.noMatchingAccounts')}
            options={accountOptions.options}
            loading={accountOptions.loading}
            onFirstOpen={() => setAccountsWanted(true)}
            value={excludedAccounts}
            onChange={setExcludedAccounts}
            minWidth={280}
          />
        </>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => chartRef.current?.download(`consolidation-${scope}-${years[0]}-${years[years.length - 1]}`)}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{t("reports.shared.summaryTable")}</Typography>
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
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
