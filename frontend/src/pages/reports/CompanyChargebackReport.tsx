import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import CompanySelect from '../../components/fields/CompanySelect';
import api from '../../api';
import { MetricKey, horizontalBarChartHeight, metricFileName, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { itemHref, useReportScope } from './useReportScope';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { formatPercentPoints, formatSharePercent } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
import { formatCurrency as formatMoney } from '../../i18n/formatters';
import { useTranslation } from 'react-i18next';
import { allocationMethodLabel, chargebackDepartmentLabel } from '../../utils/allocationLabels';
import { allocationWarningKey, allocationWarningText, amountFxMissingOf, isAmountFxMissingWarning, type ReportWarning } from '../../utils/allocationWarnings';
import { useAuth } from '../../auth/AuthContext';
import { chargebackCompanyIds } from '../../auth/dataAccess';
import { formatItemRef } from '../../utils/item-ref';

function baseFormatNumber(value: number | null | undefined, locale: string): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n));
}

function baseFormatCurrency(value: number | null | undefined, locale: string): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return formatter.format(n);
}

function formatPercent(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return formatPercentPoints(value, locale, 2);
}

function baseFormatCount(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return baseFormatNumber(value, locale);
}

type CompanyChargebackDepartmentRow = {
  departmentId: string | null;
  departmentName: string | null;
  amount: number;
  amountRaw: number;
  sharePct: number | null;
  headcount: number | null;
  costPerUser: number | null;
};

type CompanyChargebackItemRow = {
  versionId: string | null;
  itemId: string | null;
  /** The line's number (its BL-n reference) and nature; null when the line is not read. */
  itemNumber?: number | null;
  nature?: 'opex' | 'capex' | null;
  itemName: string;
  /** What the line column shows: the name, or `BL-n · name` for a line the person cannot read. */
  itemLabel: string;
  allocationMethod: string;
  amount: number;
  amountRaw: number;
  sharePct: number | null;
  /**
   * A limited person's report only (data-scoped access): `readable` false for a line charged to the
   * company that the person cannot read (its reference and label, no link), the paying company,
   * the allocation percentage charged to the company and the departments the shares go down to.
   */
  readable?: boolean;
  payingCompanyName?: string | null;
  allocationPct?: number | null;
  departments?: Array<string | null>;
};

type CompanyChargebackSummary = {
  id: string;
  name: string;
  total: number;
  totalRaw: number;
  paid?: number;
  paidRaw?: number;
  net?: number;
  netRaw?: number;
  headcount: number | null;
  itUsers: number | null;
  turnover: number | null;
  turnoverRaw: number | null;
  costPerUser: number | null;
  costPerUserRaw: number | null;
  costPerItUser: number | null;
  costPerItUserRaw: number | null;
  costVsTurnoverPct: number | null;
};

type CompanyChargebackReportResponse = {
  year: number;
  metric: MetricKey;
  total: number;
  totalRaw: number;
  company: CompanyChargebackSummary;
  departments: CompanyChargebackDepartmentRow[];
  items: CompanyChargebackItemRow[];
  itemsTotal: number;
  itemsTotalRaw: number;
  /** Fraction of the company's total. */
  itemsTotalShare?: number | null;
  kpis: Array<{
    companyId: string;
    companyName: string;
    amount: number;
    amountRaw: number;
    headcount: number | null;
    itUsers: number | null;
    turnover: number | null;
    turnoverRaw: number | null;
    costPerUser: number | null;
    costPerItUser: number | null;
    costVsTurnoverPct: number | null;
  }>;
  /** Null for a limited person: no group total. */
  globalKpi: {
    amount: number;
    amountRaw: number;
    headcount: number | null;
    itUsers: number | null;
    turnover: number | null;
    turnoverRaw: number | null;
    costPerUser: number | null;
    costPerItUser: number | null;
    costVsTurnoverPct: number | null;
  } | null;
  /** Set for a limited person: the shares charged to the company only. */
  dataAccessLimited?: true;
  /** A limited person's report: the numbers of the hidden lines charged to the company without a rate. */
  fxMissingHiddenLines?: number[];
  intercompany?: {
    receivables: Array<{ consumerId: string; consumerName: string; amount: number; amountRaw: number }>;
    payables: Array<{ payerId: string; payerName: string; amount: number; amountRaw: number }>;
  };
  /** The flows merged per partner by the server, largest net first; a null name is a company no row names. */
  intercompanyRows?: Array<{ partnerId: string; partnerName: string | null; receivables: number; payables: number; net: number }>;
  /** Their total row; null without a partner. */
  intercompanyTotal?: { receivables: number; payables: number; net: number } | null;
  reportingCurrency?: string;
  warnings?: ReportWarning[];
};

type CompanyChargebackKpiRow = CompanyChargebackReportResponse['kpis'][number];

export default function CompanyChargebackReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const locale = useLocale();
  // A limited person opens the companies of their company nodes only (null: every company).
  const { dataAccess } = useAuth();
  const allowedCompanyIds = useMemo(() => chargebackCompanyIds(dataAccess), [dataAccess]);
  const noCompanyInAccess = allowedCompanyIds != null && allowedCompanyIds.size === 0;
  const now = new Date();
  const currentYear = now.getFullYear();
  const allowedYears = [currentYear - 1, currentYear, currentYear + 1];

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [year, setYear] = useState<number>(currentYear);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  // OPEX by default: the chargeback of before; CAPEX or both on request.
  const [scope, setScope] = useReportScope('opex');
  const scopeLabel = t(`operations.scope.${scope}`);
  const [showDepartments, setShowDepartments] = useState(true);
  const [showItems, setShowItems] = useState(true);
  const [showKpis, setShowKpis] = useState(true);
  const [showIntercompany, setShowIntercompany] = useState(true);

  const chartRef = useRef<ChartCardHandle>(null);

  const queryKey = ['company-chargeback-report', scope, companyId, year, metric];
  const { data, isLoading, isFetching, refetch } = useQuery<CompanyChargebackReportResponse>({
    queryKey,
    // The preselected column is the tenant's default: wait for it rather than fetch twice.
    enabled: Boolean(companyId) && budgetColumns.ready,
    queryFn: async () => {
      const response = await api.get<CompanyChargebackReportResponse>('/reports/chargeback/company', {
        params: { companyId, year, metric, scope },
      });
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const metricLabel = budgetColumns.label(metric);
  const metricFile = metricFileName(budgetColumns, metric);
  const reportingCurrency = (data?.reportingCurrency || 'EUR').toUpperCase();
  // A turnover reads as money of the reporting currency, in whole units like the costs.
  const formatTurnover = React.useCallback(
    (value: number) => formatMoney(value, locale, reportingCurrency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    [locale, reportingCurrency],
  );
  const departments = data?.departments ?? [];
  const limitedReport = data?.dataAccessLimited === true;
  // A line the person cannot read: its reference and label (`itemLabel`), without a link (no `itemId`).
  const items = data?.items ?? [];
  const kpiRows = data?.kpis ?? [];
  const globalKpi = data?.globalKpi;
  const allWarnings = data?.warnings ?? [];
  // The lines left out for lack of a rate read as the budget reports' notice, above the report.
  const amountFxMissing = amountFxMissingOf(allWarnings);
  const warnings = allWarnings.filter((warning) => !isAmountFxMissingWarning(warning));
  // Lines the person cannot read, charged to the company and left out for lack of a rate: by reference, no link.
  const fxMissingHiddenLines = data?.fxMissingHiddenLines ?? [];
  const formatNumber = React.useCallback(
    (value: number | null | undefined) => baseFormatNumber(value, locale),
    [locale],
  );
  const formatCurrency = React.useCallback(
    (value: number | null | undefined) => baseFormatCurrency(value, locale),
    [locale],
  );
  const formatCount = React.useCallback(
    (value: number | null | undefined) => baseFormatCount(value, locale),
    [locale],
  );
  const formatShare = React.useCallback(
    (value: unknown, fractionDigits: number) => formatSharePercent(value, locale, fractionDigits),
    [locale],
  );

  // Intercompany rows (partner, receivables, payables, net)
  const intercompanyColumns = useMemo<ColDef[]>(() => [
    {
      field: 'partnerName',
      headerName: t('reports.columns.company'),
      flex: 1,
      minWidth: 220,
      valueGetter: (p: any) => p.data?.partnerName || t('reports.shared.unknownCompany'),
    },
    { field: 'receivables', headerName: t('reports.columns.receivables'), width: 160, type: 'rightAligned', valueFormatter: (p: any) => formatNumber(p.value) },
    { field: 'payables', headerName: t('reports.columns.payables'), width: 160, type: 'rightAligned', valueFormatter: (p: any) => formatNumber(p.value) },
    { field: 'net', headerName: t('reports.columns.net'), width: 160, type: 'rightAligned', valueFormatter: (p: any) => formatNumber(p.value) },
  ], [formatNumber, t]);

  const intercompanyRows = data?.intercompanyRows ?? [];
  const intercompanyPinnedBottom = useMemo(() => {
    const total = data?.intercompanyTotal;
    if (!total || !intercompanyRows.length) return [];
    return [{ partnerName: t('reports.columns.total'), ...total }];
  }, [data?.intercompanyTotal, intercompanyRows.length, t]);

  const departmentColumns = useMemo<ColDef[]>(() => [
    {
      field: 'departmentName',
      headerName: t('reports.columns.department'),
      flex: 1,
      minWidth: 200,
      valueGetter: (params) => chargebackDepartmentLabel(t, params.data?.departmentId, params.data?.departmentName),
    },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'sharePct',
      headerName: t('reports.columns.shareOfTotal'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (params) => formatShare(params.value, 2),
    },
    {
      field: 'headcount',
      headerName: t('reports.columns.headcount'),
      width: 130,
      type: 'rightAligned',
      valueFormatter: (params) => formatCount(params.value),
    },
    {
      field: 'costPerUser',
      headerName: t('reports.columns.costPerUser'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
  ], [formatCount, formatNumber, formatShare, metricLabel, t]);

  const itemColumns = useMemo<ColDef[]>(() => [
    {
      field: 'itemLabel',
      headerName: t('reports.columns.item'),
      flex: 1,
      minWidth: 220,
      cellRenderer: LinkCellRenderer,
      // Each line by its BL reference, whatever its nature; common costs (no line) and the total row stay plain text.
      cellRendererParams: { newTab: true, getHref: (row: Partial<CompanyChargebackItemRow>) => itemHref(row.nature ?? scope, row.itemId, row.itemNumber) },
    },
    ...(limitedReport ? [{ field: 'payingCompanyName', headerName: t('reports.columns.payer'), minWidth: 160 } as ColDef] : []),
    {
      colId: 'allocationMethod',
      headerName: t('reports.columns.allocationMethod'),
      minWidth: 180,
      valueGetter: (params) => allocationMethodLabel(t, params.data?.allocationMethod),
    },
    ...(limitedReport ? [
      {
        field: 'allocationPct',
        headerName: t('reports.columns.allocationPct'),
        width: 130,
        type: 'rightAligned',
        valueFormatter: (params: any) => formatShare(params.value, 2),
      } as ColDef,
      {
        colId: 'departments',
        headerName: t('reports.columns.department'),
        minWidth: 160,
        valueGetter: (params: any) => (params.data?.departments ?? [])
          .map((name: string | null) => (name?.trim() ? name : t('ops:reports.shared.unknownDepartment')))
          .join(', '),
      } as ColDef,
    ] : []),
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'sharePct',
      headerName: t('reports.columns.shareOfTotal'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (params) => formatShare(params.value, 2),
    },
  ], [formatNumber, formatShare, limitedReport, metricLabel, scope, t]);

  const chartData = useMemo(() => {
    return departments.map((row: CompanyChargebackDepartmentRow) => ({
      label: chargebackDepartmentLabel(t, row.departmentId, row.departmentName),
      value: row.amount,
    }));
  }, [departments, t]);

  const itemsPinnedBottom = useMemo(() => {
    if (!data) return [];
    const share = data.itemsTotalShare;
    return [{
      itemLabel: t('reports.columns.total'),
      allocationMethod: '',
      amount: data.itemsTotal,
      amountRaw: data.itemsTotalRaw,
      sharePct: share != null ? share * 100 : null,
    } as Partial<CompanyChargebackItemRow>];
  }, [data, t]);

  const chartOptions = useMemo(() => {
    if (!data?.company) {
      return null;
    }
    return {
      title: { text: t('reports.companyChargeback.chartTitle', { name: data.company.name }), fontSize: 14 },
      subtitle: { text: t('reports.companyChargeback.chartSubtitle', { metric: metricLabel }), fontSize: 12 },
      footnote: { text: t('reports.companyChargeback.chartFootnote', { metric: metricLabel, total: formatCurrency(data.total) }), fontSize: 11 },
      data: chartData,
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
              const total = data?.total ?? 0;
              const pct = total > 0 ? (value / total) * 100 : 0;
              return {
                title: escapeTooltipText(datum.label),
                data: [
                  { label: metricLabel, value: formatNumber(value) },
                  { label: t('reports.shared.share'), value: formatPercentPoints(pct, locale, 2) },
                ],
              };
            },
          },
        },
      ],
      legend: { enabled: false },
      animation: { enabled: true, duration: 700 },
    };
  }, [chartData, data?.company, data?.total, formatCurrency, formatNumber, locale, metricLabel, t]);

  const exportChart = () => {
    if (!companyId) return;
    chartRef.current?.download(`company-chargeback-departments-${scope}-${companyId}-${year}-${metricFile}`);
  };

  const companySummary = data?.company;

  const isReady = Boolean(companyId);

  return (
    <ReportLayout
      title={t("reports.companyChargeback.title")}
      fxMissing={isReady ? amountFxMissing : undefined}
      subtitle={t("reports.companyChargeback.subtitle")}
      filters={(
        <>
          <ItemScopeTabs allowAll value={scope} onChange={setScope} />
          <Box sx={{ minWidth: 240 }}>
            <CompanySelect
              label={t("reports.filters.company")}
              value={companyId}
              onChange={setCompanyId}
              size="small"
              allowedCompanyIds={allowedCompanyIds}
            />
          </Box>
          <TextField
            select
            size="small"
            label={t("reports.filters.year")}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            sx={{ minWidth: 120 }}
          >
            {allowedYears.map((yr) => (
              <MenuItem key={yr} value={yr}>{yr}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.column")}
            value={metric}
            onChange={(event) => setMetric(event.target.value as MetricKey)}
            sx={{ minWidth: 160 }}
          >
            {budgetColumns.shown.map((column) => (
              <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={showDepartments} onChange={(_, checked) => setShowDepartments(checked)} />}
            label={t("reports.companyChargeback.departmentTotals")}
          />
          <FormControlLabel
            control={<Checkbox checked={showItems} onChange={(_, checked) => setShowItems(checked)} />}
            label={t("reports.companyChargeback.chargebackItems")}
          />
          <FormControlLabel
            control={<Checkbox checked={showKpis} onChange={(_, checked) => setShowKpis(checked)} />}
            label={t("reports.companyChargeback.chargebackKpis")}
          />
          <FormControlLabel
            control={<Checkbox checked={showIntercompany} onChange={(_, checked) => setShowIntercompany(checked)} />}
            label={t("reports.companyChargeback.flowsTitle")}
          />
        </>
      )}
      actions={(
        <Button
          variant="action-primary"
          onClick={() => refetch()}
          disabled={!companyId || isFetching || !budgetColumns.ready}
        >
          {!companyId ? t('reports.companyChargeback.selectCompany') : isFetching ? t('reports.shared.refreshing') : t('reports.shared.run')}
        </Button>
      )}
      tableExport={isReady ? {
        url: '/reports/chargeback/company/export',
        params: { companyId, year, metric, scope },
        tables: [
          { key: 'departments', label: t('reports.companyChargeback.departmentTotals') },
          { key: 'items', label: t('reports.companyChargeback.chargebackItems') },
          { key: 'intercompany', label: t('reports.companyChargeback.flowsTitle') },
          { key: 'kpis', label: t('reports.companyChargeback.kpisTitle') },
        ],
        fileBase: `chargeback-company-${scope}-${year}`,
      } : undefined}
      onExportChartPng={isReady ? exportChart : undefined}
    >
      <Stack spacing={2}>
        {scope !== 'opex' && (
          <Typography role="note" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('reports.shared.capexYearAmountNote')}
          </Typography>
        )}
        {!isReady && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.selectCompanyTitle")}</Typography>
            <Typography variant="body2" color="text.secondary">
              {noCompanyInAccess ? t('reports.companyChargeback.noCompanyInAccess') : t('reports.companyChargeback.selectCompanyDescription')}
            </Typography>
          </Paper>
        )}

        {isReady && companySummary && (
          <Paper variant="outlined" sx={{ p: 2 }} className="report-print-summary">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between">
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{companySummary.name}</Typography>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>{formatCurrency(companySummary.total)}</Typography>
                <Typography variant="body2" color="text.secondary">{`${scopeLabel} • ${metricLabel} • ${year} • ${reportingCurrency}`}</Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' } }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t('reports.columns.headcount')}</Typography>
                  <Typography variant="subtitle2">{formatCount(companySummary.headcount)}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.itUsers")}</Typography>
                  <Typography variant="subtitle2">{formatCount(companySummary.itUsers)}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.costPerUser")}</Typography>
                  <Typography variant="subtitle2">{companySummary.costPerUser != null ? formatCurrency(companySummary.costPerUser) : '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.costPerItUser")}</Typography>
                  <Typography variant="subtitle2">{companySummary.costPerItUser != null ? formatCurrency(companySummary.costPerItUser) : '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.itCostsVsTurnover")}</Typography>
                  <Typography variant="subtitle2">{companySummary.costVsTurnoverPct != null ? formatPercent(companySummary.costVsTurnoverPct, locale) : '—'}</Typography>
                </Box>
              </Box>
            </Stack>
          </Paper>
        )}

        {isReady && (warnings.length > 0 || fxMissingHiddenLines.length > 0) && (
          <Alert severity="warning" sx={{ whiteSpace: 'pre-wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{t("reports.shared.warningsTitle")}</Typography>
            <Box component="ul" sx={{ pl: 3, my: 0 }}>
              {warnings.map((warning, index) => (
                <Typography component="li" variant="body2" key={`${allocationWarningKey(warning)}-${index}`}>
                  {allocationWarningText(t, warning)}
                </Typography>
              ))}
              {fxMissingHiddenLines.length > 0 && (
                <Typography component="li" variant="body2">
                  {t("reports.companyChargeback.fxMissingHiddenLines", {
                    count: fxMissingHiddenLines.length,
                    references: fxMissingHiddenLines.map((n) => formatItemRef('budget', n)).join(', '),
                  })}
                </Typography>
              )}
            </Box>
          </Alert>
        )}

        {isReady && showDepartments && departments.length > 0 && (
          <Stack spacing={2} direction={{ xs: 'column', xl: 'row' }} alignItems={{ xs: 'stretch', xl: 'flex-start' }}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.departmentTotals")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.companyChargeback.departmentTotalsDescription")}
              </Typography>
              <ReportGrid
                rowData={departments}
                columnDefs={departmentColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                domLayout="autoHeight"
              />
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.departmentDistribution")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.companyChargeback.departmentDistributionDescription")}
              </Typography>
              {chartOptions ? (
                <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={horizontalBarChartHeight(chartData.length)} />
              ) : (
                <Typography variant="body2" color="text.secondary">{t("reports.shared.chartUnavailable")}</Typography>
              )}
            </Paper>
          </Stack>
        )}

        {isReady && showDepartments && departments.length === 0 && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('reports.companyChargeback.departmentTotals')}</Typography>
            <Typography variant="body2" color="text.secondary">{t("reports.companyChargeback.noDepartmentAllocations")}</Typography>
          </Paper>
        )}

        {isReady && showItems && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.chargebackItems")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.companyChargeback.chargebackItemsDescription")}
            </Typography>
            {items.length > 0 ? (
              <ReportGrid
                rowData={items}
                columnDefs={itemColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                pinnedBottomRowData={itemsPinnedBottom}
                domLayout="autoHeight"
              />
            ) : (
              <Typography variant="body2" color="text.secondary">{t("reports.companyChargeback.noChargebackItems")}</Typography>
            )}
          </Paper>
        )}

        {isReady && showIntercompany && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.flowsTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.companyChargeback.flowsDescription")}
            </Typography>
            {intercompanyRows.length > 0 ? (
              <ReportGrid
                rowData={intercompanyRows}
                columnDefs={intercompanyColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                pinnedBottomRowData={intercompanyPinnedBottom}
                domLayout="autoHeight"
              />
            ) : (
              <Typography variant="body2" color="text.secondary">{t('reports.companyChargeback.noFlows')}</Typography>
            )}
          </Paper>
        )}

        {isReady && showKpis && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.kpisTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.companyChargeback.kpisDescription")}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t("reports.columns.company")}</TableCell>
                    <TableCell align="right">{metricLabel}</TableCell>
                    <TableCell align="right">{t("reports.columns.headcount")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itUsers")}</TableCell>
                    <TableCell align="right">{t("reports.columns.turnover")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itCostsVsTurnover")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itCostsPerUser")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itCostsPerItUser")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {kpiRows.map((row: CompanyChargebackKpiRow) => (
                    <TableRow key={row.companyId} hover>
                      <TableCell>{row.companyName}</TableCell>
                      <TableCell align="right">{formatCurrency(row.amount)}</TableCell>
                      <TableCell align="right">{formatCount(row.headcount)}</TableCell>
                      <TableCell align="right">{formatCount(row.itUsers)}</TableCell>
                      <TableCell align="right">{row.turnover != null ? formatTurnover(row.turnover) : '—'}</TableCell>
                      <TableCell align="right">{row.costVsTurnoverPct != null ? formatPercent(row.costVsTurnoverPct, locale) : '—'}</TableCell>
                      <TableCell align="right">{row.costPerUser != null ? formatCount(Math.round(row.costPerUser)) : '—'}</TableCell>
                      <TableCell align="right">{row.costPerItUser != null ? formatCount(Math.round(row.costPerItUser)) : '—'}</TableCell>
                    </TableRow>
                  ))}
                  {kpiRows.length === 0 && (
                    <TableRow>
                      <TableCell align="center" colSpan={8} sx={{ color: 'text.secondary' }}>
                        {t('reports.shared.noDataForYear')}
                      </TableCell>
                    </TableRow>
                  )}
                  {kpiRows.length > 0 && globalKpi && (
                    <TableRow sx={{ '& > *': { fontWeight: 600 } }}>
                      <TableCell>{t("reports.companyChargeback.globalTotals")}</TableCell>
                      <TableCell align="right">{formatCurrency(globalKpi.amount)}</TableCell>
                      <TableCell align="right">{formatCount(globalKpi.headcount)}</TableCell>
                      <TableCell align="right">{formatCount(globalKpi.itUsers)}</TableCell>
                      <TableCell align="right">{globalKpi.turnover != null ? formatTurnover(globalKpi.turnover) : '—'}</TableCell>
                      <TableCell align="right">{globalKpi.costVsTurnoverPct != null ? formatPercent(globalKpi.costVsTurnoverPct, locale) : '—'}</TableCell>
                      <TableCell align="right">{globalKpi.costPerUser != null ? formatCount(Math.round(globalKpi.costPerUser)) : '—'}</TableCell>
                      <TableCell align="right">{globalKpi.costPerItUser != null ? formatCount(Math.round(globalKpi.costPerItUser)) : '—'}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )}

        {isReady && (isLoading || !budgetColumns.ready) && (
          <Typography variant="body2" color="text.secondary">{t("reports.shared.loadingReport")}</Typography>
        )}
      </Stack>
    </ReportLayout>
  );
}
