import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellStyle } from 'ag-grid-community';
import ReportLayout from '../../../components/reports/ReportLayout';
import AgGridBox from '../../../components/AgGridBox';
import {
  copyMasterData,
  MasterDataCopyError,
  MasterDataCopyRequest,
  MasterDataCopyResponse,
  MasterDataCopyResultItem,
  MasterDataMetric,
} from '../../../services/masterDataOperations';
import { useFreezeState } from '../../../hooks/useFreezeState';
import { useAuth } from '../../../auth/AuthContext';
import { useLocale } from '../../../i18n/useLocale';

const YEARS_SPAN = 7;
const COMPANY_METRIC_KEYS: { value: MasterDataMetric; labelKey: string }[] = [
  { value: 'headcount', labelKey: 'admin.copy.metrics.headcount' },
  { value: 'it_users', labelKey: 'admin.copy.metrics.itUsers' },
  { value: 'turnover', labelKey: 'admin.copy.metrics.turnover' },
];

type ScopeOption = 'companies' | 'departments';

type GridRow = MasterDataCopyResultItem;

function useYearOptions() {
  const currentYear = new Date().getFullYear();
  return React.useMemo(() => Array.from({ length: YEARS_SPAN }, (_, idx) => currentYear - 1 + idx), [currentYear]);
}

function metricLabel(metric: MasterDataMetric, t: any) {
  const entry = COMPANY_METRIC_KEYS.find((m) => m.value === metric);
  return entry ? t(entry.labelKey) : metric;
}

function formatValue(value: number | null, locale: string, metric: MasterDataMetric) {
  if (value == null) return '—';
  const options = metric === 'turnover'
    ? { minimumFractionDigits: 0, maximumFractionDigits: 3 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  return Number(value).toLocaleString(locale, options);
}

export default function MasterDataCopyPage() {
  const theme = useTheme();
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const years = useYearOptions();
  const { hasLevel } = useAuth();
  const canManageCompanies = hasLevel('companies', 'admin') || hasLevel('budget_ops', 'admin');
  const canManageDepartments = hasLevel('departments', 'admin') || hasLevel('budget_ops', 'admin');

  const [sourceYear, setSourceYear] = React.useState<number>(years[0] ?? new Date().getFullYear());
  const [destinationYear, setDestinationYear] = React.useState<number>(years[1] ?? years[0] ?? new Date().getFullYear());
  const [selectedScopes, setSelectedScopes] = React.useState<ScopeOption[]>(['companies']);
  const [companyMetrics, setCompanyMetrics] = React.useState<MasterDataMetric[]>(['headcount', 'it_users', 'turnover']);
  const [previewData, setPreviewData] = React.useState<GridRow[]>([]);
  const [summary, setSummary] = React.useState<MasterDataCopyResponse['summary'] | null>(null);
  const [errors, setErrors] = React.useState<MasterDataCopyError[]>([]);
  const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isProcessing, setIsProcessing] = React.useState<boolean>(false);
  const [hasPreview, setHasPreview] = React.useState<boolean>(false);

  React.useEffect(() => {
    setSelectedScopes((prev) => {
      const allowed = prev.filter((scope) => (scope === 'companies' ? canManageCompanies : canManageDepartments));
      if (allowed.length > 0) return allowed;
      if (canManageCompanies) return ['companies'];
      if (canManageDepartments) return ['departments'];
      return [];
    });
  }, [canManageCompanies, canManageDepartments]);

  React.useEffect(() => {
    setPreviewData([]);
    setSummary(null);
    setErrors([]);
    setHasPreview(false);
    setFeedback(null);
  }, [sourceYear, destinationYear, selectedScopes, companyMetrics]);

  const includeCompanies = selectedScopes.includes('companies') && canManageCompanies;
  const includeDepartments = selectedScopes.includes('departments') && canManageDepartments;

  const { data: freezeData, isLoading: freezeLoading } = useFreezeState(destinationYear);
  const companiesFrozen = freezeData?.summary?.scopes.companies.frozen ?? false;
  const departmentsFrozen = freezeData?.summary?.scopes.departments.frozen ?? false;
  const blockedScopes: ScopeOption[] = [];
  if (includeCompanies && companiesFrozen) blockedScopes.push('companies');
  if (includeDepartments && departmentsFrozen) blockedScopes.push('departments');
  const hasFrozenBlocking = blockedScopes.length > 0;

  const gridApiRef = React.useRef<any>(null);

  const columns = React.useMemo<ColDef[]>(() => [
    {
      field: 'entityType',
      headerName: t('admin.copy.columns.type'),
      width: 120,
      valueFormatter: (params) => (params.value === 'company' ? t('admin.copy.entityTypes.company') : t('admin.copy.entityTypes.department')),
      cellStyle: (params) => params.data?.skipped ? { color: theme.palette.warning.dark } : undefined,
    },
    {
      field: 'entityName',
      headerName: t('admin.copy.columns.name'),
      flex: 1,
      minWidth: 220,
      cellStyle: (params) => params.data?.skipped ? { color: theme.palette.warning.dark } : undefined,
    },
    {
      field: 'metric',
      headerName: t('admin.copy.columns.metric'),
      width: 160,
      valueFormatter: (params) => metricLabel(params.value as MasterDataMetric, t),
      cellStyle: (params) => params.data?.skipped ? { color: theme.palette.warning.dark } : undefined,
    },
    {
      field: 'sourceValue',
      headerName: t('admin.copy.columns.sourceValue'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatValue(params.value ?? null, locale, params.data.metric),
      cellStyle: (params) => params.data?.skipped ? { color: theme.palette.warning.dark } : undefined,
    },
    {
      field: 'destinationValue',
      headerName: t('admin.copy.columns.currentDestination'),
      width: 180,
      type: 'rightAligned',
      valueFormatter: (params) => formatValue(params.value ?? null, locale, params.data.metric),
      cellStyle: (params) => params.data?.skipped ? { color: theme.palette.warning.dark } : undefined,
    },
    {
      field: 'newValue',
      headerName: t('admin.copy.columns.newValue'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatValue(params.value ?? null, locale, params.data.metric),
      cellStyle: (params): CellStyle => {
        if (params.data?.skipped) {
          return {
            color: theme.palette.warning.dark,
            backgroundColor: theme.palette.warning[50] || theme.palette.action.hover,
            fontWeight: '600',
          };
        }
        return { fontWeight: '600' };
      },
    },
    {
      field: 'reason',
      headerName: t('admin.copy.columns.status'),
      flex: 1,
      minWidth: 200,
      valueGetter: (params) => {
        if (params.data?.skipped) {
          return params.data.reason ?? t('admin.copy.status.skipped');
        }
        return t('admin.copy.status.readyToCopy');
      },
      cellStyle: (params) => params.data?.skipped ? { color: theme.palette.warning.dark } : { color: theme.palette.success.dark },
    },
  ], [locale, t, theme]);

  const disabledScopes: Record<ScopeOption, boolean> = React.useMemo(() => ({
    companies: !canManageCompanies,
    departments: !canManageDepartments,
  }), [canManageCompanies, canManageDepartments]);

  const handleScopeChange = (event: SelectChangeEvent<string[]>) => {
    const values = event.target.value as string[];
    setSelectedScopes(values.filter((v): v is ScopeOption => v === 'companies' || v === 'departments'));
  };

  const handleMetricChange = (event: SelectChangeEvent<string[]>) => {
    const values = (event.target.value as string[]).filter((v) => v === 'headcount' || v === 'it_users' || v === 'turnover');
    setCompanyMetrics(values as MasterDataMetric[]);
  };

  const buildPayload = React.useCallback((dryRun: boolean): MasterDataCopyRequest => ({
    sourceYear,
    destinationYear,
    includeCompanies,
    includeDepartments,
    companyMetrics: includeCompanies ? companyMetrics : [],
    dryRun,
  }), [sourceYear, destinationYear, includeCompanies, includeDepartments, companyMetrics]);

  const runOperation = async (dryRun: boolean) => {
    setIsProcessing(true);
    setFeedback(null);
    try {
      const response = await copyMasterData(buildPayload(dryRun));
      setPreviewData(response.results);
      setSummary(response.summary);
      setErrors(response.errors ?? []);
      setHasPreview(true);
      if (!response.success && response.errors.length > 0) {
        setFeedback({ type: 'error', message: t('admin.copy.copyErrors') });
      } else {
        setFeedback({ type: dryRun ? 'success' : 'success', message: dryRun ? t('admin.copy.dryRunCompleted') : t('admin.copy.copyCompleted') });
      }
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || t('admin.copy.operationFailed');
      setFeedback({ type: 'error', message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDryRun = () => runOperation(true);
  const handleCopy = () => runOperation(false);

  const disableActions =
    isProcessing ||
    selectedScopes.length === 0 ||
    (!includeCompanies && !includeDepartments) ||
    (includeCompanies && companyMetrics.length === 0) ||
    hasFrozenBlocking ||
    freezeLoading;

  const disableCopy = disableActions || !hasPreview;

  const summaryCards = (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Typography variant="body2" color="text.secondary">{t('admin.copy.summary.totalRows')}</Typography>
        <Typography variant="subtitle2">{summary?.totalItems.toLocaleString(locale) ?? '0'}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Typography variant="body2" color="text.secondary">{t('admin.copy.summary.readyToCopy')}</Typography>
        <Typography variant="subtitle2" sx={{ color: 'success.main' }}>{summary?.processed.toLocaleString(locale) ?? '0'}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Typography variant="body2" color="text.secondary">{t('admin.copy.summary.skipped')}</Typography>
        <Typography variant="subtitle2" sx={{ color: 'warning.main' }}>{summary?.skipped.toLocaleString(locale) ?? '0'}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Typography variant="body2" color="text.secondary">{t('admin.copy.summary.errors')}</Typography>
        <Typography variant="subtitle2" sx={{ color: 'error.main' }}>{summary?.errors.toLocaleString(locale) ?? '0'}</Typography>
      </Box>
    </Box>
  );

  return (
    <ReportLayout
      rootTo="/master-data/operations"
      rootLabel={t('nav:sidebar.masterData.administration')}
      title={t('admin.copy.title')}
      subtitle={t('admin.copy.subtitle')}
      filters={
        <>
          <TextField
            select
            size="small"
            label={t('admin.copy.sourceYear')}
            value={sourceYear}
            onChange={(e) => setSourceYear(Number(e.target.value))}
            sx={{ width: 150 }}
          >
            {years.map((year) => (
              <MenuItem key={year} value={year}>{year}</MenuItem>
            ))}
          </TextField>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="master-data-scope-label">{t('admin.copy.dataSources')}</InputLabel>
            <Select
              labelId="master-data-scope-label"
              multiple
              value={selectedScopes}
              onChange={handleScopeChange}
              label={t('admin.copy.dataSources')}
              renderValue={(selected) => selected.map((value) => value === 'companies' ? t('admin.freeze.scopeCompanies') : t('admin.freeze.scopeDepartments')).join(', ')}
            >
              <MenuItem value="companies" disabled={disabledScopes.companies}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">{t('admin.freeze.scopeCompanies')}</Typography>
                  {disabledScopes.companies && <Typography variant="caption" color="text.secondary">{t('admin.copy.noAdminAccess')}</Typography>}
                </Stack>
              </MenuItem>
              <MenuItem value="departments" disabled={disabledScopes.departments}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">{t('admin.freeze.scopeDepartments')}</Typography>
                  {disabledScopes.departments && <Typography variant="caption" color="text.secondary">No admin access</Typography>}
                </Stack>
              </MenuItem>
            </Select>
          </FormControl>
          <TextField
            select
            size="small"
            label={t('admin.copy.destinationYear')}
            value={destinationYear}
            onChange={(e) => setDestinationYear(Number(e.target.value))}
            sx={{ width: 170 }}
          >
            {years.map((year) => (
              <MenuItem key={year} value={year}>{year}</MenuItem>
            ))}
          </TextField>
          {includeCompanies && (
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="company-metrics-label">{t('admin.copy.companyMetrics')}</InputLabel>
              <Select
                labelId="company-metrics-label"
                multiple
                value={companyMetrics}
                onChange={handleMetricChange}
                label={t('admin.copy.companyMetrics')}
                renderValue={(selected) => selected.map((m) => metricLabel(m, t)).join(', ')}
              >
                {COMPANY_METRIC_KEYS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    <Typography variant="body2">{t(option.labelKey)}</Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </>
      }
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={handleDryRun}
            disabled={disableActions}
            startIcon={isProcessing ? <CircularProgress size={16} /> : undefined}
          >
            {isProcessing && !hasPreview ? t('admin.copy.processing') : t('admin.copy.dryRunBtn')}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleCopy}
            disabled={disableCopy}
            startIcon={isProcessing && hasPreview ? <CircularProgress size={16} /> : undefined}
          >
            {isProcessing && hasPreview ? t('admin.copy.copyingBtn') : t('admin.copy.copyDataBtn')}
          </Button>
        </Stack>
      }
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
    >
      <Stack spacing={2}>
        {hasFrozenBlocking && (
          <Alert severity="error">
            {blockedScopes.map((scope) => scope === 'companies'
              ? t('admin.copy.frozenCompanies', { year: destinationYear })
              : t('admin.copy.frozenDepartments', { year: destinationYear })
            ).join(' ')}
          </Alert>
        )}
        {includeCompanies && companyMetrics.length === 0 && (
          <Alert severity="warning">{t('admin.copy.selectMetricWarning')}</Alert>
        )}
        {feedback && (
          <Alert severity={feedback.type} onClose={() => setFeedback(null)}>{feedback.message}</Alert>
        )}
        {errors.length > 0 && (
          <Alert severity="error">
            {errors.length === 1 ? t('admin.copy.oneItemFailed') : t('admin.copy.multipleItemsFailed', { count: errors.length })}
            {' '}{t('admin.copy.reviewTable')}
          </Alert>
        )}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('admin.copy.dataPreview')}</Typography>
          <Box component={AgGridBox}>
            <AgGridReact
              rowData={previewData}
              columnDefs={columns}
              defaultColDef={{ sortable: true, resizable: true }}
              onGridReady={(event) => { gridApiRef.current = event.api; }}
              domLayout="autoHeight"
              suppressRowClickSelection
            />
          </Box>
          {summaryCards}
        </Paper>
        {previewData.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('admin.copy.dryRunHint')}
          </Typography>
        )}
        {isProcessing && (
          <Typography variant="body2" color="text.secondary">{t('admin.copy.processing')}</Typography>
        )}
      </Stack>
    </ReportLayout>
  );
}
