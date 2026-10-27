import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
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
import api from '../../api';
import { MetricKey, horizontalBarChartHeight, metricFileName, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { useReportScope } from './useReportScope';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { formatPercentPoints, formatSharePercent } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
import { formatCurrency as formatMoney } from '../../i18n/formatters';
import { useTranslation } from 'react-i18next';
import { chargebackDepartmentLabel } from '../../utils/allocationLabels';
import { allocationWarningKey, allocationWarningText, amountFxMissingOf, isAmountFxMissingWarning, type ReportWarning } from '../../utils/allocationWarnings';

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

type GlobalChargebackDetailedRow = {
  companyId: string;
  companyName: string;
  departmentId: string | null;
  departmentName: string | null;
  amount: number;
  amountRaw: number;
  headcount: number | null;
  costPerUser: number | null;
};

type GlobalChargebackCompanyRow = {
  companyId: string;
  companyName: string;
  amount: number;
  amountRaw?: number;
  paid?: number;
  paidRaw?: number;
  net?: number;
  netRaw?: number;
  /** Fraction of the report total. */
  share?: number | null;
};

type GlobalChargebackKpiRow = {
  companyId: string;
  companyName: string;
  amount: number;
  amountRaw?: number;
  headcount: number | null;
  itUsers: number | null;
  turnover: number | null;
  /** In the company's base currency; `turnover` is in the reporting currency. */
  turnoverRaw?: number | null;
  costPerUser: number | null;
  costPerItUser: number | null;
  costVsTurnoverPct: number | null;
};

/** A row of the detailed allocations table, built by the server: a company's total row, then its departments. */
type GlobalChargebackDetailedTableRow = GlobalChargebackDetailedRow & {
  rowType: 'company' | 'department';
  /** Fraction of the report total. */
  share: number | null;
};

/** A flow netted per pair of companies; a null name is a company no row names. */
type GlobalChargebackNettedFlow = {
  payerId: string;
  payerName: string | null;
  consumerId: string;
  consumerName: string | null;
  amount: number;
};

/** The indicators' totals row, null without a company. `costVsTurnoverPct` in points. */
type GlobalChargebackKpiTotals = {
  amount: number;
  headcount: number;
  itUsers: number;
  turnover: number;
  costVsTurnoverPct: number | null;
  costPerUser: number | null;
  costPerItUser: number | null;
};

type GlobalChargebackReportResponse = {
  year: number;
  metric: MetricKey;
  total: number;
  totalRaw: number;
  detailed: GlobalChargebackDetailedRow[];
  detailedRows: GlobalChargebackDetailedTableRow[];
  companies: GlobalChargebackCompanyRow[];
  kpis: GlobalChargebackKpiRow[];
  kpiTotals: GlobalChargebackKpiTotals | null;
  nettedFlows: GlobalChargebackNettedFlow[];
  intercompanyFlows?: Array<{
    payerId: string;
    payerName: string;
    consumerId: string;
    consumerName: string;
    amount: number;
    amountRaw?: number;
  }>;
  reportingCurrency?: string;
  warnings?: ReportWarning[];
};

export default function GlobalChargebackReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const locale = useLocale();
  const now = new Date();
  const currentYear = now.getFullYear();
  const allowedYears = [currentYear - 1, currentYear, currentYear + 1];

  const [year, setYear] = useState<number>(currentYear);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  // OPEX by default: the chargeback of before; CAPEX or both on request.
  const [scope, setScope] = useReportScope('opex');
  const scopeLabel = t(`operations.scope.${scope}`);
  const [showCompanies, setShowCompanies] = useState(true);
  const [showDetailed, setShowDetailed] = useState(true);
  const [showKpis, setShowKpis] = useState(true);
  const [showFlows, setShowFlows] = useState(true);

  const companyGridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);
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

  const queryKey = ['global-chargeback-report', scope, year, metric];
  const { data, isLoading, isFetching, refetch } = useQuery<GlobalChargebackReportResponse>({
    queryKey,
    // The preselected column is the tenant's default: wait for it rather than fetch twice.
    enabled: budgetColumns.ready,
    queryFn: async () => {
      const response = await api.get<GlobalChargebackReportResponse>('/reports/chargeback/global', {
        params: { year, metric, scope },
      });
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const totalAmount = data?.total ?? 0;
  const reportingCurrency = (data?.reportingCurrency || 'EUR').toUpperCase();
  // A turnover reads as money of the reporting currency, in whole units like the costs.
  const formatTurnover = React.useCallback(
    (value: number) => formatMoney(value, locale, reportingCurrency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    [locale, reportingCurrency],
  );
  const metricLabel = budgetColumns.label(metric);
  const metricFile = metricFileName(budgetColumns, metric);

  const companyRows = data?.companies ?? [];
  const detailedRows = data?.detailedRows ?? [];

  const chartData = useMemo(() => {
    const rows: GlobalChargebackCompanyRow[] = data?.companies ?? [];
    return rows.map((row: GlobalChargebackCompanyRow) => ({ label: row.companyName, value: row.amount }));
  }, [data?.companies]);

  const detailedColumns = useMemo<ColDef[]>(() => [
    {
      colId: 'company',
      headerName: t('reports.columns.company'),
      flex: 1,
      minWidth: 220,
      // The company names its total row; its departments follow below it.
      valueGetter: (params) => (params.data?.rowType === 'company' ? params.data.companyName : ''),
    },
    {
      colId: 'department',
      headerName: t('reports.columns.department'),
      flex: 1,
      minWidth: 200,
      valueGetter: (params) => (params.data?.rowType === 'company'
        ? t('reports.columns.total')
        : chargebackDepartmentLabel(t, params.data?.departmentId, params.data?.departmentName)),
    },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      colId: 'share',
      headerName: t('reports.columns.shareOfTotal'),
      width: 160,
      type: 'rightAligned',
      valueGetter: (params) => (params.data?.share != null ? params.data.share * 100 : null),
      valueFormatter: (params) => formatShare(params.value, 1),
    },
    {
      field: 'headcount',
      headerName: t('reports.columns.headcount'),
      width: 140,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? formatCount(params.value) : ''),
    },
    {
      field: 'costPerUser',
      headerName: t('reports.columns.costPerUser'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? formatCurrency(params.value) : ''),
    },
  ], [formatCount, formatCurrency, formatNumber, formatShare, metricLabel, t]);

  const kpiRows: GlobalChargebackKpiRow[] = data?.kpis ?? [];
  const allWarnings = data?.warnings ?? [];
  // The lines left out for lack of a rate read as the budget reports' notice, above the report.
  const amountFxMissing = amountFxMissingOf(allWarnings);
  const warnings = allWarnings.filter((warning) => !isAmountFxMissingWarning(warning));

  const companyColumns = useMemo<ColDef[]>(() => [
    { field: 'companyName', headerName: t('reports.columns.company'), flex: 1, minWidth: 220 },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'paid',
      headerName: t('reports.columns.paidBooked'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'net',
      headerName: t('reports.columns.netConsumedPaid'),
      width: 180,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      colId: 'share',
      headerName: t('reports.columns.shareOfTotal'),
      width: 160,
      type: 'rightAligned',
      valueGetter: (params) => (params.data?.share != null ? params.data.share * 100 : null),
      valueFormatter: (params) => formatShare(params.value, 1),
    },
  ], [formatNumber, formatShare, metricLabel, t]);

  const nettedFlows = data?.nettedFlows ?? [];
  const flowsColumns = useMemo<ColDef[]>(() => [
    {
      field: 'payerName',
      headerName: t('reports.columns.payer'),
      flex: 1,
      minWidth: 200,
      valueGetter: (params) => params.data?.payerName || t('reports.shared.unknownCompany'),
    },
    {
      field: 'consumerName',
      headerName: t('reports.columns.consumer'),
      flex: 1,
      minWidth: 200,
      valueGetter: (params) => params.data?.consumerName || t('reports.shared.unknownCompany'),
    },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
  ], [formatNumber, metricLabel, t]);

  const chartOptions = useMemo(() => {
    return {
      title: { text: t('reports.globalChargeback.chartTitle', { year }), fontSize: 14 },
      subtitle: { text: t('reports.globalChargeback.chartSubtitle', { metric: metricLabel }), fontSize: 12 },
      footnote: { text: t('reports.globalChargeback.chartFootnote', { metric: metricLabel, total: formatCurrency(totalAmount) }), fontSize: 11 },
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
              const pct = totalAmount > 0 ? (value / totalAmount) * 100 : 0;
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
      legend: { enabled: false },
      animation: { enabled: true, duration: 700 },
    };
  }, [chartData, formatCurrency, formatNumber, locale, metricLabel, t, totalAmount, year]);

  const exportChart = () => {
    chartRef.current?.download(`global-chargeback-company-${scope}-${year}-${metricFile}`);
  };

  const kpiTotals = data?.kpiTotals ?? null;

  return (
    <ReportLayout
      title={t("reports.globalChargeback.title")}
      fxMissing={amountFxMissing}
      subtitle={t("reports.globalChargeback.subtitle")}
      filters={(
        <>
          <ItemScopeTabs allowAll value={scope} onChange={setScope} />
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
            control={<Checkbox checked={showCompanies} onChange={(_, checked) => setShowCompanies(checked)} />}
            label={t("reports.globalChargeback.companyTotals")}
          />
          <FormControlLabel
            control={<Checkbox checked={showDetailed} onChange={(_, checked) => setShowDetailed(checked)} />}
            label={t("reports.globalChargeback.detailedAllocations")}
          />
          <FormControlLabel
            control={<Checkbox checked={showKpis} onChange={(_, checked) => setShowKpis(checked)} />}
            label={t("reports.globalChargeback.includeKpis")}
          />
          <FormControlLabel
            control={<Checkbox checked={showFlows} onChange={(_, checked) => setShowFlows(checked)} />}
            label={t("reports.globalChargeback.intercompanyFlows")}
          />
        </>
      )}
      actions={(
        <Button variant="action-primary" onClick={() => refetch()} disabled={isFetching || !budgetColumns.ready}>
          {isFetching ? t('reports.shared.refreshing') : t('reports.shared.run')}
        </Button>
      )}
      tableExport={{
        url: '/reports/chargeback/global/export',
        params: { year, metric, scope },
        tables: [
          { key: 'detailed', label: t('reports.globalChargeback.detailedTitle') },
          { key: 'companies', label: t('reports.globalChargeback.companyTotalsTitle') },
          { key: 'flows', label: t('reports.globalChargeback.flowsTitle') },
          { key: 'kpis', label: t('reports.globalChargeback.kpisTitle') },
        ],
        fileBase: `chargeback-global-${scope}-${year}`,
      }}
      onExportChartPng={exportChart}
    >
      <Stack spacing={2}>
        {scope !== 'opex' && (
          <Typography role="note" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('reports.shared.capexYearAmountNote')}
          </Typography>
        )}
        <Paper variant="outlined" sx={{ p: 2 }} className="report-print-summary">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between">
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t("reports.globalChargeback.overallTotal")}</Typography>
              <Typography variant="h5" sx={{ fontWeight: 600 }}>{formatCurrency(totalAmount)}</Typography>
              <Typography variant="body2" color="text.secondary">{`${scopeLabel} • ${metricLabel} • ${year}`}</Typography>
            </Box>
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
              <Box>
                <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.companies")}</Typography>
                <Typography variant="subtitle2">{data?.companies?.length ?? 0}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.detailedLines")}</Typography>
                <Typography variant="subtitle2">{data?.detailed?.length ?? 0}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.kpiCoverage")}</Typography>
                <Typography variant="subtitle2">{kpiRows.filter((k: GlobalChargebackKpiRow) => k.headcount != null).length}/{kpiRows.length}</Typography>
              </Box>
            </Box>
          </Stack>
        </Paper>

        {warnings.length > 0 && (
          <Alert severity="warning" sx={{ whiteSpace: 'pre-wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{t("reports.shared.warningsTitle")}</Typography>
            <Box component="ul" sx={{ pl: 3, my: 0 }}>
              {warnings.map((warning, index) => (
                <Typography component="li" variant="body2" key={`${allocationWarningKey(warning)}-${index}`}>
                  {allocationWarningText(t, warning)}
                </Typography>
              ))}
            </Box>
          </Alert>
        )}

        {showCompanies && (
          <Stack spacing={2} direction={{ xs: 'column', xl: 'row' }} alignItems={{ xs: 'stretch', xl: 'flex-start' }}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.companyTotalsTitle")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.globalChargeback.companyTotalsDescription")}
              </Typography>
              <ReportGrid
                rowData={companyRows}
                columnDefs={companyColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                onGridReady={(event) => {
                  companyGridApiRef.current = event.api;
                }}
                domLayout="autoHeight"
              />
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.distributionTitle")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.globalChargeback.distributionDescription")}
              </Typography>
              <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={horizontalBarChartHeight(chartData.length)} />
            </Paper>
          </Stack>
        )}

        {showDetailed && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.detailedTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.globalChargeback.detailedDescription")}
            </Typography>
            <ReportGrid
              rowData={detailedRows}
              columnDefs={detailedColumns}
              defaultColDef={{ sortable: true, resizable: true }}
              getRowStyle={(params) => (params.data?.rowType === 'company' ? { fontWeight: 600 } : undefined)}
              domLayout="autoHeight"
            />
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.globalTotal")}</Typography>
            <Typography variant="subtitle2">{formatCurrency(totalAmount)}</Typography>
          </Paper>
        )}

        {showFlows && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.flowsTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.globalChargeback.flowsDescription")}
            </Typography>
            {nettedFlows.length > 0 ? (
              <ReportGrid
                rowData={nettedFlows}
                columnDefs={flowsColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                domLayout="autoHeight"
              />
            ) : (
              <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.noFlows")}</Typography>
            )}
          </Paper>
        )}

        {showKpis && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.kpisTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.globalChargeback.kpisDescription")}
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
                  {kpiRows.map((row) => (
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
                  {kpiRows.length > 0 && kpiTotals && (
                    <TableRow sx={{ '& > *': { fontWeight: 600 } }}>
                      <TableCell>{t("shared.total")}</TableCell>
                      <TableCell align="right">{formatCurrency(kpiTotals.amount)}</TableCell>
                      <TableCell align="right">{formatCount(kpiTotals.headcount)}</TableCell>
                      <TableCell align="right">{formatCount(kpiTotals.itUsers)}</TableCell>
                      <TableCell align="right">{kpiTotals.turnover > 0 ? formatTurnover(kpiTotals.turnover) : '—'}</TableCell>
                      <TableCell align="right">{kpiTotals.costVsTurnoverPct != null ? formatPercent(kpiTotals.costVsTurnoverPct, locale) : '—'}</TableCell>
                      <TableCell align="right">{kpiTotals.costPerUser != null ? formatCount(Math.round(kpiTotals.costPerUser)) : '—'}</TableCell>
                      <TableCell align="right">{kpiTotals.costPerItUser != null ? formatCount(Math.round(kpiTotals.costPerItUser)) : '—'}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )}

        {(isLoading || !budgetColumns.ready) && (
          <Typography variant="body2" color="text.secondary">{t("reports.shared.loadingReport")}</Typography>
        )}
      </Stack>
    </ReportLayout>
  );
}
