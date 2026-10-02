import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forgetAllAllocations } from '../../components/finance/allocationsCache';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import { drawerMenuItemSx } from '../../theme/formSx';
import { useTranslation } from 'react-i18next';
import AgGridBox from '../../components/AgGridBox';
import { useLocale } from '../../i18n/useLocale';
import { AllocationRuleResolution, fetchAllocationRule } from '../../services/allocationRules';
import {
  AllocationCopyOperation,
  AllocationCopyResult,
  AllocationCopyResponse,
  BudgetScope,
  copyAllocations,
} from '../../services/budgetOperations';
import { useKanapDialogs } from '../../components/design';
import ItemScopeTabs, { useDefaultBudgetScope } from './ItemScopeTabs';



export default function CopyAllocationsPage() {
  const { t } = useTranslation(['ops']);
  const dialogs = useKanapDialogs();

  const formatActionLabel = (action: AllocationCopyResult['action']) => {
    const key = `operations.copyAllocations.actionLabels.${action}`;
    const label = t(key);
    return label !== key ? label : action;
  };
  const locale = useLocale();
  const theme = useTheme();
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = useMemo(() => Array.from({ length: 7 }, (_, i) => currentYear - 1 + i), [currentYear]);

  const [scope, setScope] = useState<BudgetScope>(useDefaultBudgetScope());
  const [sourceYear, setSourceYear] = useState<number>(currentYear);
  const [destinationYear, setDestinationYear] = useState<number>(currentYear + 1);
  const [overwrite, setOverwrite] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<AllocationCopyResult[]>([]);
  const [summary, setSummary] = useState<AllocationCopyResponse['summary'] | null>(null);

  const queryClient = useQueryClient();
  const gridApiRef = useRef<any>(null);

  const isSameYear = sourceYear === destinationYear;

  // Items left on the default allocation follow the default configured for their own year,
  // and the copy does not carry that setting over: surface the difference in the dry run.
  const { data: sourceRule } = useQuery({
    queryKey: ['allocation-rule', sourceYear],
    queryFn: () => fetchAllocationRule(sourceYear),
    staleTime: 60_000,
    retry: false,
  });
  const { data: destinationRule } = useQuery({
    queryKey: ['allocation-rule', destinationYear],
    queryFn: () => fetchAllocationRule(destinationYear),
    staleTime: 60_000,
    retry: false,
  });

  const resolutionLabel = React.useCallback(
    (rule: AllocationRuleResolution | undefined): string => {
      if (!rule) return '';
      if (rule.mode === 'manual_company') {
        return t('operations.copyAllocations.defaultManualLabel', { count: rule.company_ids?.length ?? 0 });
      }
      return t(`opex.allocations.${rule.method === 'it_users' ? 'itUsers' : rule.method}`);
    },
    [t],
  );

  const defaultBasisChanged =
    !!sourceRule && !!destinationRule
    && (sourceRule.mode !== destinationRule.mode || sourceRule.method !== destinationRule.method);

  const stats = useMemo(() => {
    if (previewData.length === 0) {
      return {
        total: 0,
        toCopy: 0,
        skipped: 0,
        errors: 0,
        skippedDueToDestination: 0,
        onDefault: 0,
      };
    }
    let toCopy = 0;
    let skipped = 0;
    let errors = 0;
    let skippedDestination = 0;
    let onDefault = 0;
    for (const row of previewData) {
      if (row.action === 'copy') toCopy += 1;
      else if (row.action === 'error') errors += 1;
      else {
        skipped += 1;
        if (row.action === 'skip_destination_has_data') skippedDestination += 1;
      }
      if (row.sourceMethod === 'default') onDefault += 1;
    }
    return {
      total: previewData.length,
      toCopy,
      skipped,
      errors,
      skippedDueToDestination: skippedDestination,
      onDefault,
    };
  }, [previewData]);

  const columns = useMemo<ColDef[]>(() => [
    {
      field: 'itemName',
      headerName: t('operations.copyAllocations.product'),
      flex: 1.2,
      minWidth: 220,
    },
    {
      field: 'action',
      headerName: t('operations.copyAllocations.action'),
      width: 180,
      valueFormatter: (params) => formatActionLabel(params.value),
      cellStyle: (params) => {
        const action = params.data?.action as AllocationCopyResult['action'];
        if (action === 'copy') {
          return { color: theme.palette.success.dark, fontWeight: '500' };
        }
        if (action === 'error') {
          return { color: theme.palette.error.dark, fontWeight: '500' };
        }
        return { color: theme.palette.text.secondary, fontWeight: '500' };
      },
    },
    {
      field: 'sourceMethodLabel',
      headerName: t('operations.copyAllocations.sourceLabel', { year: sourceYear }),
      width: 180,
      valueGetter: (params) => params.data?.sourceMethodLabel || '—',
    },
    {
      field: 'destinationMethodLabel',
      headerName: t('operations.copyAllocations.destinationLabel', { year: destinationYear }),
      width: 200,
      valueGetter: (params) => params.data?.destinationMethodLabel || '—',
    },
    {
      field: 'resultMethodLabel',
      headerName: t('operations.copyAllocations.resultAfterCopy'),
      width: 200,
      valueGetter: (params) => params.data?.resultMethodLabel || '—',
    },
  ], [destinationYear, sourceYear, t, theme]);

  const handleDryRun = async () => {
    const payload: AllocationCopyOperation = {
      sourceYear,
      destinationYear,
      overwrite,
      dryRun: true,
    };
    setIsProcessing(true);
    try {
      const response = await copyAllocations(scope, payload);
      setPreviewData(response.results);
      setSummary(response.summary);
    } catch (error) {
      console.error('Dry run failed', error);
      await dialogs.alert(t('operations.copyAllocations.dryRunFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    const payload: AllocationCopyOperation = {
      sourceYear,
      destinationYear,
      overwrite,
      dryRun: false,
    };
    setIsProcessing(true);
    try {
      const response = await copyAllocations(scope, payload);
      forgetAllAllocations(queryClient);
      await dialogs.alert(t('operations.copyAllocations.copyCompleted', { processed: response.summary.processed, skipped: response.summary.skipped, errors: response.summary.errors }));
      await queryClient.invalidateQueries({ queryKey: [scope === 'opex' ? 'spend-items-summary' : 'capex-items-summary'] });
      setPreviewData([]);
      setSummary(null);
    } catch (error) {
      console.error('Copy failed', error);
      await dialogs.alert(t('operations.copyAllocations.copyFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ReportLayout
      rootTo="/ops/operations"
      rootLabel={t('operations.title')}
      title={t('operations.copyAllocations.title')}
      subtitle={t('operations.copyAllocations.subtitle')}
      filters={
        <>
          <ItemScopeTabs
            value={scope}
            onChange={(next) => {
              setScope(next);
              setPreviewData([]);
              setSummary(null);
            }}
          />
          <ReportFilter label={t('operations.copyAllocations.sourceYear')} width={120}>
            <TextField
              select
              size="small"
              value={sourceYear}
              onChange={(e) => {
                setSourceYear(parseInt(e.target.value, 10));
                setPreviewData([]);
                setSummary(null);
              }}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('operations.copyAllocations.sourceYear') } }}
              sx={reportFilterSelectSx}
            >
              {years.map((year) => (
                <MenuItem key={year} value={year} sx={drawerMenuItemSx}>
                  {year}
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('operations.copyAllocations.destinationYear')} width={120}>
            <TextField
              select
              size="small"
              value={destinationYear}
              onChange={(e) => {
                setDestinationYear(parseInt(e.target.value, 10));
                setPreviewData([]);
                setSummary(null);
              }}
              SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('operations.copyAllocations.destinationYear') } }}
              sx={reportFilterSelectSx}
            >
              {years.map((year) => (
                <MenuItem key={year} value={year} sx={drawerMenuItemSx}>
                  {year}
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <FormControlLabel
            control={
              <Switch
                checked={overwrite}
                onChange={(e) => {
                  setOverwrite(e.target.checked);
                  setPreviewData([]);
                  setSummary(null);
                }}
                size="small"
              />
            }
            label={t('operations.copyAllocations.overwriteExisting')}
          />
        </>
      }
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={handleDryRun}
            disabled={isProcessing || isSameYear}
          >
            {isProcessing ? t('operations.copyAllocations.processing') : t('operations.copyAllocations.dryRun')}
          </Button>
          <Button
            variant="contained"
            onClick={handleCopy}
            disabled={isProcessing || previewData.length === 0 || isSameYear}
          >
            {isProcessing ? t('operations.copyAllocations.processing') : t('operations.copyAllocations.copyData')}
          </Button>
        </Stack>
      }
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        {isSameYear && (
          <Alert severity="warning">{t('operations.copyAllocations.sameYearWarning')}</Alert>
        )}

        {summary && (
          <Alert severity={summary.errors > 0 ? 'error' : summary.skipped > 0 ? 'info' : 'success'}>
            {t("operations.copyAllocations.summaryReady", { processed: summary.processed, skipped: summary.skipped, errors: summary.errors })}
          </Alert>
        )}

        {stats.skippedDueToDestination > 0 && !overwrite && (
          <Alert severity="warning">
            {t("operations.copyAllocations.skippedDueToDestination", { count: stats.skippedDueToDestination, year: destinationYear })}
          </Alert>
        )}

        {stats.onDefault > 0 && defaultBasisChanged && (
          <Alert severity="warning">
            {t("operations.copyAllocations.defaultBasisWarning", {
              count: stats.onDefault,
              sourceYear,
              destinationYear,
              sourceLabel: resolutionLabel(sourceRule),
              destinationLabel: resolutionLabel(destinationRule),
            })}
          </Alert>
        )}

        {previewData.length > 0 ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>
              {t('operations.copyAllocations.preview')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t("operations.copyAllocations.showingItems", { total: stats.total.toLocaleString(locale), toCopy: stats.toCopy.toLocaleString(locale), skipped: stats.skipped.toLocaleString(locale), errors: stats.errors.toLocaleString(locale) })}
            </Typography>
            <Box component={AgGridBox}>
              <AgGridReact
                rowData={previewData}
                columnDefs={columns}
                defaultColDef={{ sortable: true, resizable: true }}
                domLayout="autoHeight"
                onGridReady={(event) => { gridApiRef.current = event.api; }}
              />
            </Box>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t("operations.copyAllocations.dryRunPrompt")}
            </Typography>
          </Paper>
        )}
      </Stack>
    </ReportLayout>
  );
}
