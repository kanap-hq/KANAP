import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Checkbox, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import { useSearchParams } from 'react-router-dom';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportExclusionPicker from '../../components/reports/ReportExclusionPicker';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { useReportPrinting } from '../../components/reports/reportPrint';
import { itemHref, useReportScope } from './useReportScope';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { MetricKey, horizontalBarChartHeight, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { AnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import type { AnalyticsAxis } from '../../services/analytics';
import { drawerMenuItemSx } from '../../theme/formSx';
import { useTranslation } from 'react-i18next';
import { formatCount, formatPercentPoints, formatSharePercent } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
import { NO_ANALYTICS_VALUE, analyticsLinesRequest, analyticsNatureRequest, analyticsRequest, readAnalytics, readAnalyticsNatures, requestFirstYear, type AnalyticsNatureSplit } from './reportAggregates';
import { analyticsTable } from './reportTables';
import { useReportTableLabels } from './useReportTableLabels';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useAxisValueOptions } from './useReportOptions';
import { ReportFteNotice, ReportMeasureSelect, useMeasureText, useReportMeasure } from './reportMeasure';
import { axisListColumn, reportListLink, reportListPicks, rowListGroup } from './reportListLink';
import ReportGroupLinkCell from './ReportGroupLinkCell';
import AnalyticsGroupCell from './AnalyticsGroupCell';
import { useHiddenCategoryCounts } from './useHiddenCategoryCounts';
import { LinkCellRenderer } from '../../components/grid/renderers';

/** `?axis=<dimension id>`: the dimension the report groups on. */
const AXIS_PARAM = 'axis';
/** `?detail=lines`: the table lists the lines of every value; absent, values only. */
const DETAIL_PARAM = 'detail';
/** `?split=nature`: the table adds the OPEX and CAPEX shares, the single-year chart shows them (all natures only). */
const SPLIT_PARAM = 'split';
/** A share with no total to divide by: the report's empty value, as the grid helpers write it. */
const EMPTY_SHARE = '—';

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

export default function AnalyticsCategoryReport() {
  const { t } = useTranslation(["ops"]);
  const locale = useLocale();
  const printing = useReportPrinting();
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
  const [measure, setMeasure] = useReportMeasure();
  const [searchParams, setSearchParams] = useSearchParams();
  const detail = searchParams.get(DETAIL_PARAM) === 'lines';
  const setFlag = useCallback((param: string, value: string, next: boolean) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) params.set(param, value);
      else params.delete(param);
      return params;
    }, { replace: true });
  }, [setSearchParams]);
  // A split of OPEX-only or CAPEX-only lines says nothing: the box only counts on the all-natures tab.
  const splitWanted = searchParams.get(SPLIT_PARAM) === 'nature';
  const split = splitWanted && scope === 'all';
  const measureText = useMeasureText(measure);
  const formatNumber = measureText.format;
  const tableLabels = useReportTableLabels();
  // FTE: a year nobody declares stays blank, never a 0 (an empty cell, no slice, no point).
  const cell = (value: number | null | undefined) => (measureText.fte ? value ?? null : value || 0);
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
  // "Unassigned" first, so the lines without a value can be left out too.
  const exclusionOptions = useMemo(() => categoryOptions.options && [
    { id: NO_ANALYTICS_VALUE, label: t('reports.analyticsCategory.unassigned') },
    ...categoryOptions.options,
  ], [categoryOptions.options, t]);

  // The server groups the kept lines by their value on the dimension (none: unassigned), one sum per
  // year, the first year's largest first. Until the dimensions are known, nothing is asked: the
  // report would group on the default dimension, then again on the one in the address.
  const request = useMemo(() => (reportFilters.queryFilters == null || !analyticsAxes.ready ? null : analyticsRequest({
    axisId,
    years,
    metric,
    excludedIds: excludedCategories,
    filters: reportFilters.queryFilters,
    measure,
  })), [reportFilters.queryFilters, analyticsAxes.ready, axisId, years, metric, excludedCategories, measure]);
  const report = useBudgetAggregate(scope, request, { keepPrevious: true });
  // The lines of every value, in one aggregate: asked only when the address turns the detail on.
  const detailRequest = useMemo(() => (detail && reportFilters.queryFilters != null && analyticsAxes.ready ? analyticsLinesRequest({
    scope,
    axisId,
    years,
    metric,
    excludedIds: excludedCategories,
    filters: reportFilters.queryFilters,
    measure,
  }) : null), [detail, reportFilters.queryFilters, analyticsAxes.ready, scope, axisId, years, metric, excludedCategories, measure]);
  const detailReport = useBudgetAggregate(scope, detailRequest, { keepPrevious: true });
  // The OPEX and CAPEX sums of every value, in one aggregate: asked only when the split is on.
  const natureRequest = useMemo(() => (split && reportFilters.queryFilters != null && analyticsAxes.ready ? analyticsNatureRequest({
    axisId,
    years,
    metric,
    excludedIds: excludedCategories,
    filters: reportFilters.queryFilters,
    measure,
  }) : null), [split, reportFilters.queryFilters, analyticsAxes.ready, axisId, years, metric, excludedCategories, measure]);
  const natureReport = useBudgetAggregate(scope, natureRequest, { keepPrevious: true });
  // Loading, waiting for the filter bar or the dimensions, or the last answer kept while the new one loads.
  const busy = reportFilters.queryFilters == null || !analyticsAxes.ready || report.isLoading || report.isPlaceholderData
    || (detail && (detailReport.isLoading || detailReport.isPlaceholderData))
    || (split && (natureReport.isLoading || natureReport.isPlaceholderData));
  const labels = useMemo(() => ({ unassigned: t('reports.analyticsCategory.unassigned'), unnamed: t('reports.analyticsCategory.unnamed') }), [t]);
  // FTE: only the values that declare FTE in one of the years.
  const { groups } = useMemo(() => readAnalytics(years, report.data, labels, measure), [years, report.data, labels, measure]);

  // The report's lifecycle window: the lines still active on 1 January of its first year.
  const firstYear = requestFirstYear(request, Y);
  // A value opens the list filtered on it and on the bar, in a new tab; the total row stays plain.
  const listPicks = useMemo(() => reportListPicks(reportFilters), [reportFilters]);
  const axisColumn = axis ? axisListColumn(axis) : null;
  // The list shows the lines the row counts: the report's window, and with FTE the lines that declare it.
  const fteOnly = measure === 'fte';
  const valueLink = useCallback((row: { groupName?: string | null }) => {
    if (row.groupName === undefined || !listPicks) return null;
    const group = rowListGroup('axis', { name: row.groupName }, axisColumn);
    return group ? reportListLink(scope, group, listPicks, { firstYear, fteOnly }) : null;
  }, [scope, listPicks, axisColumn, firstYear, fteOnly]);

  // The key table (`reportTables.ts`, the same code as the export): one row per value, the total as footer.
  const table = useMemo(
    () => analyticsTable(
      { scope, years, metric, measure, dimension: dimensionLabel, detail, split },
      report.data,
      tableLabels,
      detail ? detailReport.data : undefined,
      split ? natureReport.data : undefined,
    ),
    [scope, years, metric, measure, dimensionLabel, detail, split, report.data, tableLabels, detailReport.data, natureReport.data],
  );
  // Data-scoped access: the values on screen, and the hidden lines of each of them in the report's
  // window. Nothing is asked outside limited mode, and the print view leaves these mentions out.
  const valueIds = useMemo(() => groups.map((group) => group.id).filter((id): id is string => id != null), [groups]);
  const hiddenCounts = useHiddenCategoryCounts({
    axisId,
    valueIds,
    year: firstYear,
    scope,
    enabled: report.data?.dataAccessLimited === true,
  });
  const screenRows = useMemo(() => {
    if (report.data?.dataAccessLimited !== true) return table.rows;
    const rows: typeof table.rows = [];
    let mention: (typeof table.rows)[number] | null = null;
    const flushMention = () => {
      if (mention) rows.push(mention);
      mention = null;
    };
    for (const row of table.rows) {
      if (Number(row.level ?? 0) === 0) {
        flushMention();
        rows.push(row);
        const valueId = typeof row.valueId === 'string' ? row.valueId.toLowerCase() : null;
        const count = valueId ? hiddenCounts[valueId] ?? 0 : 0;
        if (count > 0) {
          const hiddenRow = { group: t('reports.analyticsCategory.hidden', { count }), level: 1, hiddenRow: 'yes' };
          // With the detail, the mention follows the value's lines; alone, it sits right under the value.
          if (detail) mention = hiddenRow;
          else rows.push(hiddenRow);
        }
      } else {
        rows.push(row);
      }
    }
    flushMention();
    return rows;
  }, [table.rows, hiddenCounts, report.data?.dataAccessLimited, detail, t]);
  // Sorting a flat hierarchy would move lines under another value: it is off while rows are nested
  // (the detail, or a hidden-line mention under its value).
  const hierarchicalRows = detail || screenRows.some((row) => row.hiddenRow === 'yes');
  const columns = useMemo<ColDef[]>(() => table.columns.map((column): ColDef => {
    if (column.key === 'group') {
      return {
        field: column.key,
        headerName: column.header,
        flex: 1,
        minWidth: 240,
        cellRenderer: AnalyticsGroupCell,
        cellRendererParams: { getLink: valueLink },
      };
    }
    if (column.key === 'reference') {
      return {
        field: column.key,
        headerName: column.header,
        width: 110,
        cellRenderer: LinkCellRenderer,
        cellRendererParams: {
          newTab: true,
          getHref: (row: { id?: string | null; itemNumber?: number | null }) => itemHref(scope, row.id, row.itemNumber),
        },
        cellStyle: {
          color: 'var(--kanap-text-secondary)',
          fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
          fontVariantNumeric: 'tabular-nums',
          fontSize: '12px',
        },
      };
    }
    if (column.kind === 'count') {
      return {
        field: column.key,
        headerName: column.header,
        width: 100,
        type: 'rightAligned',
        valueFormatter: (p) => (p.data?.hiddenRow || p.value == null ? '' : formatCount(Number(p.value), locale)),
      };
    }
    if (column.kind === 'percent') {
      return {
        field: column.key,
        headerName: column.header,
        width: 150,
        type: 'rightAligned',
        valueFormatter: (p) => (p.data?.hiddenRow ? '' : p.value == null ? EMPTY_SHARE : formatSharePercent(Number(p.value) * 100, locale, 1)),
      };
    }
    if (column.key === 'levelLabel' || column.key === 'nature') {
      return { field: column.key, headerName: column.header, width: 100 };
    }
    return {
      field: column.key,
      headerName: column.header,
      width: 140,
      type: 'rightAligned',
      valueFormatter: (p) => (p.data?.hiddenRow ? '' : formatNumber(p.value)),
    };
  }), [table, valueLink, formatNumber, scope, locale]);

  // The column as the measure reads it: `Budget`, or `Budget FTE`.
  const metricLabel = measureText.column(budgetColumns.label(metric));

  const chartRef = useRef<ChartCardHandle>(null);

  const metricsCaption = metricLabel;

  // What the chart draws: the values, or with the detail their lines (`BL-12 · name`), read from the
  // table's own rows so the chart and the table always agree.
  const chartItems = useMemo(() => {
    if (!detail) return groups.map((group) => ({ key: group.key, label: group.label, values: group.values as Record<number, number | null> }));
    return table.rows
      .filter((row) => Number(row.level ?? 0) === 1)
      .map((row) => ({
        key: `line_${String(row.id)}`,
        label: row.reference ? `${String(row.reference)} · ${String(row.group ?? '')}` : String(row.group ?? ''),
        values: Object.fromEntries(years.map((year) => [year, (row[String(year)] as number | null | undefined) ?? null])) as Record<number, number | null>,
      }));
  }, [detail, groups, table.rows, years]);

  // The split chart (one year, all natures): one bar per value, OPEX and CAPEX stacked to 100 %, the
  // total first when there are several values. A line is all OPEX or all CAPEX, so with the detail
  // too the bars stay on the values (the table gives each line's nature).
  const splitChart = split && singleYear;
  const splitData = useMemo(() => {
    if (!splitChart) return [];
    const year = years[0];
    const { byValue, total } = readAnalyticsNatures(years, natureReport.data, measure);
    const datum = (label: string, nature: AnalyticsNatureSplit | undefined) => {
      const opex = nature?.opex[year] ?? null;
      const capex = nature?.capex[year] ?? null;
      const sum = (opex ?? 0) + (capex ?? 0);
      const known = (opex != null || capex != null) && sum !== 0;
      return {
        label,
        opex: opex ?? 0,
        capex: capex ?? 0,
        opexShare: known ? ((opex ?? 0) / sum) * 100 : null,
        capexShare: known ? ((capex ?? 0) / sum) * 100 : null,
      };
    };
    // A value with nothing to split that year (no amount, or no FTE declared) gets no bar.
    const bars = groups.map((group) => datum(group.label, byValue.get(group.id ?? ''))).filter((bar) => bar.opexShare != null);
    return bars.length >= 2 ? [datum(t('reports.columns.total'), total), ...bars] : bars;
  }, [splitChart, years, natureReport.data, measure, groups, t]);

  const chartOptions = useMemo(() => {
    if (splitChart) {
      const year = years[0];
      const natureSeries = (key: 'opex' | 'capex', name: string) => ({
        type: 'bar',
        direction: 'horizontal',
        xKey: 'label',
        yKey: key,
        yName: name,
        stacked: true,
        normalizedTo: 100,
        strokeWidth: 0,
        label: {
          formatter: ({ datum }: any) => {
            const share = datum[`${key}Share`];
            return share != null && share >= 5 ? formatPercentPoints(share, locale, 0) : '';
          },
        },
        tooltip: {
          renderer: ({ datum }: any) => {
            const share = datum[`${key}Share`];
            return {
              title: escapeTooltipText(datum.label),
              data: [
                { label: `${name} · ${metricLabel}`, value: formatNumber(datum[key]) },
                { label: t('reports.shared.share'), value: share == null ? EMPTY_SHARE : formatPercentPoints(share, locale, 1) },
              ],
            };
          },
        },
      });
      return {
        title: { text: measureText.chartTitle(t('reports.analyticsCategory.splitChartTitle', { dimension: dimensionInSentence, year })) },
        subtitle: { text: metricsCaption },
        data: splitData,
        axes: [
          { type: 'category', position: 'left', label: { padding: 8 } },
          { type: 'number', position: 'bottom', label: { formatter: ({ value }: { value: number }) => formatPercentPoints(value, locale, 0) } },
        ],
        series: [natureSeries('opex', tableLabels.natureOpex), natureSeries('capex', tableLabels.natureCapex)],
        legend: { enabled: true, position: 'bottom' },
        animation: { enabled: true, duration: 800 },
      };
    }
    if (singleYear) {
      const year = years[0];
      // FTE: a value (or a line) that declares none that year gets no slice or bar.
      const chartData = chartItems
        .map((item) => ({ label: item.label, value: cell(item.values[year]) }))
        .filter((datum) => datum.value != null);
      const total = chartData.reduce((acc, datum) => acc + (Number(datum.value) || 0), 0);
      const base = {
        title: { text: measureText.chartTitle(t('reports.analyticsCategory.chartTitleSingle', { type: scopeLabel, context: scope, dimension: dimensionInSentence, year })) },
        subtitle: { text: metricsCaption || t('reports.analyticsCategory.shareSubtitle') },
        footnote: { text: t('reports.analyticsCategory.totalLabel', { metric: metricsCaption, value: formatNumber(measureText.fte && chartData.length === 0 ? null : total) }) },
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
                      { label: t('reports.shared.share'), value: formatPercentPoints(pct, locale, 1) },
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
      for (const item of chartItems) row[item.key] = cell(item.values[yr]);
      return row;
    });
    const series = chartItems.map((group) => ({
      type: 'line',
      xKey: 'year',
      yKey: group.key,
      yName: group.label,
      // FTE: the tooltip names the measure and reads FTE; amounts keep the chart's own tooltip.
      ...(measureText.fte ? {
        tooltip: {
          renderer: ({ datum, yKey }: any) => ({
            title: escapeTooltipText(group.label),
            data: [{ label: `${metricLabel} (${datum.year})`, value: formatNumber(datum[yKey]) }],
          }),
        },
      } : {}),
    }));
    return {
      title: { text: measureText.chartTitle(t('reports.analyticsCategory.chartTitleRange', { type: scopeLabel, context: scope, dimension: dimensionInSentence, start: years[0], end: years[years.length - 1] })) },
      subtitle: { text: metricsCaption || t('reports.analyticsCategory.annualSubtitle') },
      data: chartData,
      series,
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left', ...(measureText.axisTitle ? { title: measureText.axisTitle, label: { formatter: ({ value }: { value: number }) => formatNumber(value) } } : {}) },
      ],
      legend: { enabled: true },
    };
  }, [chartItems, splitChart, splitData, singleYear, years, metricsCaption, chartType, metricLabel, scopeLabel, dimensionInSentence, measureText, formatNumber, tableLabels, locale, t]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bars take the height of their rows, so a few values do not stretch into a wall of colour.
  const chartHeight = splitChart || (singleYear && chartType === 'bar')
    ? horizontalBarChartHeight(chartOptions.data.length)
    : 520;

  return (
    <ReportLayout
      busy={busy}
      fxMissing={report.data?.fxMissing}
      title={t("reports.analyticsCategory.title")}
      subtitle={t('reports.analyticsCategory.subtitle', { type: scopeLabel, context: scope, dimension: dimensionInSentence })}
      filters={(
        <>
          <ItemScopeTabs allowAll value={scope} onChange={setScope} />
          <ReportMeasureSelect value={measure} onChange={setMeasure} />
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
          <ReportFilter label={t('reports.analyticsCategory.detail')} width={150}>
            <Checkbox
              size="small"
              checked={detail}
              onChange={(e) => setFlag(DETAIL_PARAM, 'lines', e.target.checked)}
              inputProps={{ 'aria-label': t('reports.analyticsCategory.detail') }}
              sx={{ p: '5px', alignSelf: 'flex-start' }}
            />
          </ReportFilter>
          <ReportFilter label={t('reports.analyticsCategory.split')} width={190}>
            <Checkbox
              size="small"
              checked={split}
              disabled={scope !== 'all'}
              onChange={(e) => setFlag(SPLIT_PARAM, 'nature', e.target.checked)}
              inputProps={{ 'aria-label': t('reports.analyticsCategory.split') }}
              sx={{ p: '5px', alignSelf: 'flex-start' }}
            />
          </ReportFilter>
          <ReportFilter label={t('reports.filters.chartType')} width={180}>
            <TextField
              select
              size="small"
              value={chartType}
              onChange={(e) => setChartType(e.target.value as 'pie' | 'bar')}
              disabled={!singleYear || split}
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
              options={exclusionOptions}
              loading={categoryOptions.loading}
              onFirstOpen={() => setValuesWanted(true)}
              value={excludedCategories}
              onChange={setExcludedCategories}
            />
          </ReportFilter>
        </>
      )}
      tableExport={{
        url: '/reports/budget/analytics/export',
        params: {
          scope,
          measure,
          ...reportFilters.exportParams,
          // The dimension the screen resolved (the address's, else the default one).
          axis: axisId,
          startYear,
          endYear,
          metric,
          excludeValues: excludedCategories.join(','),
          detail: detail ? 'lines' : 'values',
          split: split ? 'nature' : 'none',
        },
        fileBase: measureText.fileName(`analytics-${scope}-${years[0]}-${years[years.length - 1]}`),
      }}
      onExportChartPng={() => chartRef.current?.download(measureText.fileName(`analytics-${scope}-${years[0]}-${years[years.length - 1]}`))}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={chartHeight} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>{t("reports.shared.summaryTable")}</Typography>
          <ReportGrid
            key={hierarchicalRows ? 'hierarchy' : 'flat'}
            wrapperSx={{ height: 520 }}
            rowData={printing ? table.rows : screenRows}
            columnDefs={columns}
            defaultColDef={{ sortable: !hierarchicalRows, resizable: true }}
            pinnedBottomRowData={table.footer}
          />
          <ReportFteNotice scope={scope} request={request} result={report.data} columnLabel={(column) => `${budgetColumns.label(column.metric)} ${column.year}`} />
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
