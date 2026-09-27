import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Stack,
  TextField,
  MenuItem,
  Paper,
  Typography,
  Switch,
  FormControlLabel,
  Alert,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import { useTranslation } from 'react-i18next';
import AgGridBox from '../../components/AgGridBox';
import { useOpexSummaryAll, pickYearSlot } from '../reports/useOpexSummary';
import { useCapexSummaryAll } from '../reports/useCapexSummary';
import { useQueryClient } from '@tanstack/react-query';
import { copyBudgetColumn, BudgetColumn, BudgetOperationResult, BudgetScope } from '../../services/budgetOperations';
import { useFreezeState } from '../../hooks/useFreezeState';
import { FreezeColumn } from '../../services/freeze';
import { useLocale } from '../../i18n/useLocale';
import { useKanapDialogs } from '../../components/design';
import { drawerMenuItemSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import ItemScopeTabs, { useDefaultBudgetScope } from './ItemScopeTabs';
import { formatOperationAmount } from './operationAmount';
import { operationSummary } from './operationSummary';

type ProcessedRow = {
  id: string;
  product_name: string;
  sourceValue: number;
  destinationValue: number;
  previewValue?: number;
  willBeSkipped?: boolean;
  /** Present once the dry run has answered for this item. */
  inPreview?: boolean;
};





const budgetToFreezeColumn: Record<BudgetColumn, FreezeColumn> = {
  budget: 'budget',
  revision: 'revision',
  follow_up: 'actual',
  landing: 'landing',
};

export default function CopyBudgetColumnsPage() {
  const { t } = useTranslation(['ops']);
  const dialogs = useKanapDialogs();

  const BUDGET_COLUMNS: { value: BudgetColumn; label: string }[] = [
    { value: 'budget', label: t('operations.budgetColumns.budget') },
    { value: 'revision', label: t('operations.budgetColumns.revision') },
    { value: 'follow_up', label: t('operations.budgetColumns.followUp') },
    { value: 'landing', label: t('operations.budgetColumns.landing') },
  ];
  const columnName = (value: BudgetColumn) => BUDGET_COLUMNS.find((c) => c.value === value)?.label ?? value;
  const locale = useLocale();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const now = new Date();
  const Y = now.getFullYear();

  // Generate years from Y-1 to Y+5
  const years = Array.from({ length: 7 }, (_, i) => Y - 1 + i);

  const [scope, setScope] = useState<BudgetScope>(useDefaultBudgetScope());
  const [sourceYear, setSourceYear] = useState<number>(Y);
  const [sourceColumn, setSourceColumn] = useState<BudgetColumn>('budget');
  const [destinationYear, setDestinationYear] = useState<number>(Y + 1);
  const [destinationColumn, setDestinationColumn] = useState<BudgetColumn>('budget');
  const [percentageIncrease, setPercentageIncrease] = useState<number>(0);
  const [overwrite, setOverwrite] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<ProcessedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const { data: freezeData, isLoading: freezeLoading } = useFreezeState(destinationYear);

  // Fetch data for both source and destination years
  const requiredYears = useMemo(() => {
    const yearsSet = new Set([sourceYear, destinationYear]);
    return Array.from(yearsSet).sort((a, b) => a - b);
  }, [sourceYear, destinationYear]);

  const opexSummary = useOpexSummaryAll(requiredYears, { enabled: scope === 'opex' });
  const capexSummary = useCapexSummaryAll(requiredYears, { enabled: scope === 'capex' });
  const { data: rows, isLoading } = scope === 'opex' ? opexSummary : capexSummary;

  const freezeKey = budgetToFreezeColumn[destinationColumn];
  const destinationFrozen = freezeData?.summary?.scopes[scope][freezeKey]?.frozen ?? false;

  const processedData = useMemo(() => {
    if (!rows) return [];

    return rows.map((r: any) => {
      const sourceSlot = pickYearSlot(r, sourceYear);
      const destinationSlot = pickYearSlot(r, destinationYear);

      const sourceValue = Number(sourceSlot?.totals?.[sourceColumn] || 0);
      const destinationValue = Number(destinationSlot?.totals?.[destinationColumn] || 0);

      return {
        id: r.id,
        product_name: r.product_name ?? r.description,
        sourceValue,
        destinationValue,
      };
    }); // Show ALL items in preview, not just ones with non-zero source values
  }, [rows, sourceYear, sourceColumn, destinationYear, destinationColumn]);

  // A dry run belongs to the parameters it ran with: any change drops it, and
  // an answer that arrives after a change is ignored.
  const paramsKey = JSON.stringify([scope, sourceYear, sourceColumn, destinationYear, destinationColumn, percentageIncrease, overwrite]);
  const paramsKeyRef = useRef(paramsKey);
  paramsKeyRef.current = paramsKey;
  useEffect(() => {
    setPreviewData([]);
    setShowPreview(false);
  }, [paramsKey]);

  const handleDryRun = async () => {
    const runKey = paramsKey;
    setIsProcessing(true);
    try {
      const result = await copyBudgetColumn(scope, {
        sourceYear,
        sourceColumn,
        destinationYear,
        destinationColumn,
        percentageIncrease,
        overwrite,
        dryRun: true,
      });

      // Convert API result to our display format, preserving original frontend data
      const preview = result.results.map((apiRow: BudgetOperationResult) => {
        const matchingRow = processedData.find((row: ProcessedRow) => row.id === apiRow.itemId);
        // The server decides month by month; totals cannot tell (a +500 / -500 source is copied).
        const willBeSkipped = apiRow.skipped;
        return {
          id: apiRow.itemId,
          product_name: apiRow.itemName,
          sourceValue: matchingRow?.sourceValue || apiRow.sourceValue, // Use frontend value
          destinationValue: matchingRow?.destinationValue || apiRow.currentDestinationValue, // Use frontend value
          previewValue: apiRow.newValue,
          willBeSkipped,
        };
      });

      if (paramsKeyRef.current !== runKey) return;
      setPreviewData(preview);
      setShowPreview(true);
    } catch (error) {
      console.error('Dry run failed:', error);
      await dialogs.alert(getApiErrorMessage(error, t, t('operations.copyBudgetColumns.dryRunFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyData = async () => {
    setIsProcessing(true);
    try {
      const result = await copyBudgetColumn(scope, {
        sourceYear,
        sourceColumn,
        destinationYear,
        destinationColumn,
        percentageIncrease,
        overwrite,
        dryRun: false,
      });

      await dialogs.alert(operationSummary(t, 'operations.copyBudgetColumns.copyDone', result.summary.processed, result.summary.skipped, result.summary.errors));

      // Invalidate and refetch the summary data to show updated values
      await queryClient.invalidateQueries({ queryKey: [scope === 'opex' ? 'spend-items-summary' : 'capex-items-summary'] });

      // Clear the preview state so user can see the updated source data
      setPreviewData([]);
      setShowPreview(false);
    } catch (error) {
      console.error('Copy data failed:', error);
      await dialogs.alert(getApiErrorMessage(error, t, t('operations.copyBudgetColumns.copyFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  const columns = useMemo<ColDef[]>(() => {
    const baseColumns: ColDef[] = [
      {
        field: 'product_name',
        headerName: t('operations.copyBudgetColumns.product'),
        flex: 1,
        minWidth: 220,
        cellRenderer: (params: any) => (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span>{params.value}</span>
            {showPreview && params.data?.willBeSkipped && (
              <span style={{ fontSize: 12, color: theme.palette.kanap.text.tertiary }}>
                {t('operations.copyBudgetColumns.skipped')}
              </span>
            )}
          </div>
        ),
      },
      {
        field: 'sourceValue',
        headerName: t('operations.copyBudgetColumns.sourceHeader', { column: columnName(sourceColumn), year: sourceYear }),
        width: 160,
        type: 'rightAligned',
        valueFormatter: (p) => formatOperationAmount(p.value),
      },
      {
        field: 'destinationValue',
        headerName: t('operations.copyBudgetColumns.currentHeader', { column: columnName(destinationColumn), year: destinationYear }),
        width: 180,
        type: 'rightAligned',
        valueFormatter: (p) => formatOperationAmount(p.value),
      },
    ];

    if (showPreview) {
      baseColumns.push({
        field: 'previewValue',
        headerName: t('operations.copyBudgetColumns.previewHeader', { column: columnName(destinationColumn), year: destinationYear }),
        width: 180,
        type: 'rightAligned',
        valueFormatter: (p) => formatOperationAmount(p.value),
        // A skipped item keeps its current value: shown muted.
        cellStyle: (params) => (params.data?.willBeSkipped
          ? { color: theme.palette.kanap.text.tertiary, fontWeight: 400 }
          : { color: 'inherit', fontWeight: 500 }),
      });
    }

    return baseColumns;
  }, [destinationColumn, destinationYear, locale, showPreview, sourceColumn, sourceYear, theme]);

  const gridApiRef = useRef<any>(null);

  // Always show original data, but merge in preview values when available
  const displayData = useMemo(() => {
    if (!showPreview) {
      return processedData;
    }

    // Create a map of preview data by id for quick lookup
    const previewMap = new Map(previewData.map(p => [p.id, p]));

    // The dry run answers only for enabled items with a source version; any
    // other item is left alone by the copy, so it shows as skipped and keeps
    // its current destination value.
    return processedData.map((row: ProcessedRow) => {
      const preview = previewMap.get(row.id);
      return {
        ...row,
        previewValue: preview ? preview.previewValue : row.destinationValue,
        willBeSkipped: preview ? preview.willBeSkipped : true,
        inPreview: !!preview,
      };
    });
  }, [processedData, previewData, showPreview]);

  const stats = useMemo(() => {
    const totalItems = displayData.length;
    const totalSource = displayData.reduce((sum: number, row: ProcessedRow) => sum + row.sourceValue, 0);
    const totalDestinationCurrent = displayData.reduce((sum: number, row: ProcessedRow) => sum + row.destinationValue, 0);
    const totalPreview = showPreview
      ? displayData.reduce((sum: number, row: ProcessedRow) => sum + (row.previewValue || 0), 0)
      : 0;
    const itemsWithExistingData = displayData.filter((row: ProcessedRow) => row.destinationValue !== 0).length;
    const itemsToBeProcessed = showPreview
      ? displayData.filter((row: ProcessedRow) => row.inPreview && !row.willBeSkipped).length
      : displayData.filter((row: ProcessedRow) => row.sourceValue !== 0 && (overwrite || row.destinationValue === 0)).length;

    return {
      totalItems,
      totalSource,
      totalDestinationCurrent,
      totalPreview,
      itemsWithExistingData,
      itemsToBeProcessed,
    };
  }, [displayData, showPreview, overwrite]);

  const statSx = { display: 'flex', flexDirection: 'column', gap: '2px' } as const;
  const statLabelSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;
  const statValueSx = { fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' } as const;

  const yearSelect = (label: string, value: number, onChange: (next: number) => void) => (
    <ReportFilter label={label} width={120}>
      <TextField
        select
        size="small"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        SelectProps={{ MenuProps: reportFilterMenuProps }}
        sx={reportFilterSelectSx}
      >
        {years.map((year) => (
          <MenuItem key={year} value={year} sx={drawerMenuItemSx}>{year}</MenuItem>
        ))}
      </TextField>
    </ReportFilter>
  );
  const columnSelect = (label: string, value: BudgetColumn, onChange: (next: BudgetColumn) => void) => (
    <ReportFilter label={label} width={170}>
      <TextField
        select
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value as BudgetColumn)}
        SelectProps={{ MenuProps: reportFilterMenuProps }}
        sx={reportFilterSelectSx}
      >
        {BUDGET_COLUMNS.map((col) => (
          <MenuItem key={col.value} value={col.value} sx={drawerMenuItemSx}>{col.label}</MenuItem>
        ))}
      </TextField>
    </ReportFilter>
  );

  return (
    <ReportLayout
      rootTo="/ops/operations"
      rootLabel={t('operations.title')}
      title={t('operations.copyBudgetColumns.title')}
      subtitle={t('operations.copyBudgetColumns.subtitle')}
      filters={
        <>
          <ItemScopeTabs value={scope} onChange={setScope} />
          {yearSelect(t('operations.copyBudgetColumns.sourceYear'), sourceYear, setSourceYear)}
          {columnSelect(t('operations.copyBudgetColumns.sourceColumn'), sourceColumn, setSourceColumn)}
          {yearSelect(t('operations.copyBudgetColumns.destinationYear'), destinationYear, setDestinationYear)}
          {columnSelect(t('operations.copyBudgetColumns.destinationColumn'), destinationColumn, setDestinationColumn)}
          <ReportFilter label={t('operations.copyBudgetColumns.percentageIncrease')} width={200}>
            <TextField
              size="small"
              type="number"
              value={percentageIncrease}
              onChange={(e) => setPercentageIncrease(parseFloat(e.target.value) || 0)}
              inputProps={{ step: 0.1, 'aria-label': t('operations.copyBudgetColumns.percentageIncrease') }}
              helperText={t('operations.copyBudgetColumns.roundingNote')}
              sx={reportFilterSelectSx}
            />
          </ReportFilter>
          <FormControlLabel
            control={
              <Switch
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                size="small"
              />
            }
            label={<Typography sx={{ fontSize: 13 }}>{t('operations.copyBudgetColumns.overwriteExisting')}</Typography>}
            sx={{ ml: 1 }}
          />
        </>
      }
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={handleDryRun}
            disabled={isProcessing || processedData.length === 0 || freezeLoading || destinationFrozen}
          >
            {isProcessing ? t('operations.copyBudgetColumns.processing') : t('operations.copyBudgetColumns.dryRun')}
          </Button>
          <Button
            variant="contained"
            onClick={handleCopyData}
            disabled={isProcessing || processedData.length === 0 || !showPreview || freezeLoading || destinationFrozen}
            color="primary"
          >
            {isProcessing ? t('operations.copyBudgetColumns.processing') : t('operations.copyBudgetColumns.copyData')}
          </Button>
        </Stack>
      }
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        {destinationFrozen && (
          <Alert severity="error">
            {t('operations.copyBudgetColumns.frozenError', { year: destinationYear, column: columnName(destinationColumn) })}
          </Alert>
        )}

        {stats.itemsWithExistingData > 0 && !overwrite && (
          <Alert severity="warning">
            {t('operations.copyBudgetColumns.existingDataWarning', { count: stats.itemsWithExistingData })}
          </Alert>
        )}

        {showPreview && (
          <Alert severity="info">
            {t('operations.copyBudgetColumns.previewInfo', { count: stats.totalItems, toProcess: stats.itemsToBeProcessed, skipped: stats.totalItems - stats.itemsToBeProcessed })}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ mb: 1, fontSize: 16, fontWeight: 500 }}>
            {t('operations.copyBudgetColumns.dataPreview')}
          </Typography>
          <Box component={AgGridBox}>
            <AgGridReact
              rowData={displayData}
              columnDefs={columns}
              defaultColDef={{ sortable: true, resizable: true }}
              initialState={{
                sort: {
                  sortModel: [{ colId: 'sourceValue', sort: 'desc' }],
                },
              }}
              onGridReady={(e) => { gridApiRef.current = e.api; }}
              domLayout="autoHeight"
            />
          </Box>

          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' } }}>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.totalItems')}</Typography>
              <Typography sx={statValueSx}>{stats.totalItems.toLocaleString(locale)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.itemsToProcess')}</Typography>
              <Typography sx={statValueSx}>{stats.itemsToBeProcessed.toLocaleString(locale)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.sourceTotal')}</Typography>
              <Typography sx={statValueSx}>{formatOperationAmount(stats.totalSource)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.currentDestTotal')}</Typography>
              <Typography sx={statValueSx}>{formatOperationAmount(stats.totalDestinationCurrent)}</Typography>
            </Box>
            {showPreview && (
              <Box sx={statSx}>
                <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.previewTotal')}</Typography>
                <Typography sx={statValueSx}>{formatOperationAmount(stats.totalPreview)}</Typography>
              </Box>
            )}
          </Box>
        </Paper>
      </Stack>
      {isLoading && (
        <Typography sx={{ mt: 1, fontSize: 13, color: 'kanap.text.secondary' }}>{t('operations.copyBudgetColumns.loadingData')}</Typography>
      )}
    </ReportLayout>
  );
}
