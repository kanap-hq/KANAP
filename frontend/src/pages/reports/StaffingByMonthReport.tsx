import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import type { ColDef } from 'ag-grid-community';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReportGrid from '../../components/reports/ReportGrid';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { formatFte } from '../../components/finance/amountColumns';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { AnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import type { AnalyticsAxis } from '../../services/analytics';
import { useLocale } from '../../i18n/useLocale';
import { drawerMenuItemSx } from '../../theme/formSx';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { useReportScope } from './useReportScope';
import { metricFileName, MetricKey, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { MONTHS, readStaffing, staffingChartSeries, staffingRequest, type StaffingGroup } from './reportAggregates';
import { compareNames, useBudgetAggregate } from './useBudgetAggregate';
import { ReportNoticeLine } from './reportMeasure';

/** `?group=`: `item`, `supplier` or `axis:<dimension id>`; absent (or `costCenter`): by cost center. */
export const GROUP_PARAM = 'group';
const AXIS_PREFIX = 'axis:';

type GroupKind = StaffingGroup['kind'];
const GROUP_KINDS: readonly GroupKind[] = ['costCenter', 'item', 'supplier', 'axis'];
/** The grouping in a downloaded file's name. */
const GROUP_FILE_NAME: Record<GroupKind, string> = { costCenter: 'cost-center', item: 'item', supplier: 'supplier', axis: 'dimension' };

/**
 * The grouping in the address. A dimension that is unknown or disabled reads as the default one, and
 * as cost center when no dimension is enabled; null while the dimensions load (nothing is asked yet).
 */
function useStaffingGroup(axes: AnalyticsAxes): {
  kind: GroupKind;
  axis: AnalyticsAxis | null;
  group: StaffingGroup | null;
  setKind: (kind: GroupKind) => void;
  setAxis: (id: string) => void;
} {
  const [params, setParams] = useSearchParams();
  const raw = params.get(GROUP_PARAM) ?? '';
  const wantsAxis = raw.startsWith(AXIS_PREFIX);
  const axisId = wantsAxis ? raw.slice(AXIS_PREFIX.length) : null;
  const axis = wantsAxis ? axes.enabled.find((candidate) => candidate.id === axisId) ?? axes.defaultAxis ?? axes.enabled[0] ?? null : null;
  const kind: GroupKind = wantsAxis ? (axis || !axes.ready ? 'axis' : 'costCenter') : raw === 'item' || raw === 'supplier' ? raw : 'costCenter';
  const groupAxisId = kind === 'axis' ? axis?.id ?? null : null;
  const group = useMemo<StaffingGroup | null>(() => {
    if (kind !== 'axis') return { kind };
    return groupAxisId ? { kind: 'axis', axisId: groupAxisId } : null;
  }, [kind, groupAxisId]);

  const write = useCallback((value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(GROUP_PARAM, value);
      else next.delete(GROUP_PARAM);
      return next;
    }, { replace: true });
  }, [setParams]);
  const fallbackAxisId = axis?.id ?? axes.defaultAxis?.id ?? axes.enabled[0]?.id ?? null;
  const setKind = useCallback((next: GroupKind) => {
    if (next === 'axis') {
      if (fallbackAxisId) write(`${AXIS_PREFIX}${fallbackAxisId}`);
    } else write(next === 'costCenter' ? null : next);
  }, [write, fallbackAxisId]);
  const setAxis = useCallback((id: string) => write(`${AXIS_PREFIX}${id}`), [write]);
  return { kind, axis, group, setKind, setAxis };
}

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
  const analyticsAxes = reportFilters.analyticsAxes;
  const { kind, axis, group, setKind, setAxis } = useStaffingGroup(analyticsAxes);
  const groupKinds = GROUP_KINDS.filter((option) => option !== 'axis' || analyticsAxes.enabled.length > 0 || kind === 'axis');

  // The group as the first column names it, as a sentence names it, and its rows without a key.
  const groupHeader = kind === 'axis' && axis ? analyticsAxes.label(axis) : t(`reports.staffing.groups.${kind}`);
  const groupInSentence = kind === 'axis'
    ? axis?.name?.trim() || t('reports.analyticsCategory.defaultDimensionInSentence')
    : t(`reports.staffing.groupsInSentence.${kind}`);
  const labels = useMemo(() => ({
    none: kind === 'item' ? '' : t(`reports.staffing.none.${kind}`),
    unnamed: t('reports.analyticsCategory.unnamed'),
  }), [kind, t]);

  // One request: per group, the twelve monthly FTE of the column; on the total row, the notices.
  const request = useMemo(() => (reportFilters.queryFilters == null || group == null ? null : staffingRequest({
    scope,
    year,
    metric,
    group,
    filters: reportFilters.queryFilters,
  })), [reportFilters.queryFilters, scope, year, metric, group]);
  const report = useBudgetAggregate(scope, request, { keepPrevious: true });
  const busy = request == null || report.isLoading || report.isPlaceholderData;
  const staffing = useMemo(() => readStaffing(report.data, labels, compareNames), [report.data, labels]);

  const monthNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { month: 'short' });
    return MONTHS.map((month) => format.format(new Date(year, month - 1, 1)));
  }, [locale, year]);

  const monthField = (month: number) => `m${month}`;
  const tableRows = useMemo(() => staffing.rows.map((row) => ({
    group: row.label,
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

  const columns = useMemo<ColDef[]>(() => [
    { field: 'group', headerName: groupHeader, flex: 1, minWidth: 220 },
    ...MONTHS.map((month, i): ColDef => ({
      field: monthField(month),
      headerName: monthNames[i],
      width: 88,
      type: 'rightAligned',
      valueFormatter: (p) => fte(p.value),
    })),
    { field: 'average', headerName: t('reports.staffing.average'), width: 110, type: 'rightAligned', valueFormatter: (p) => fte(p.value) },
    { field: 'peak', headerName: t('reports.staffing.peak'), width: 100, type: 'rightAligned', valueFormatter: (p) => fte(p.value) },
  ], [groupHeader, monthNames, fte, t]);

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
          <ReportFilter label={t('reports.staffing.groupBy')} width={180}>
            <TextField
              select
              size="small"
              value={kind}
              onChange={(e) => setKind(e.target.value as GroupKind)}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.staffing.groupBy') } }}
              sx={reportFilterSelectSx}
            >
              {groupKinds.map((option) => (
                <MenuItem key={option} value={option} sx={drawerMenuItemSx}>{t(`reports.staffing.groups.${option}`)}</MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          {kind === 'axis' && axis && analyticsAxes.enabled.length >= 2 && (
            <ReportFilter label={t('reports.filters.dimension')} width={200}>
              <TextField
                select
                size="small"
                value={axis.id}
                onChange={(e) => setAxis(String(e.target.value))}
                SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.dimension') } }}
                sx={reportFilterSelectSx}
              >
                {analyticsAxes.enabled.map((option) => (
                  <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>{analyticsAxes.label(option)}</MenuItem>
                ))}
              </TextField>
            </ReportFilter>
          )}
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
          <ReportGrid
            wrapperSx={{ height: 520 }}
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
