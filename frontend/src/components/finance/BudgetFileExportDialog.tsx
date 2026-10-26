import React, { useEffect, useState } from 'react';
import { Box, Checkbox, MenuItem, Radio, Select, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../design/KanapDialog';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import {
  BudgetFileExportScope,
  BudgetListState,
  FileColumnKey,
  MAX_EXPORT_YEARS,
  budgetFileFailure,
  defaultYearRange,
  exportBudgetFile,
  BUDGET_FILE_NAME,
  BUDGET_XLSX_FILE_NAME,
  filenameFromDisposition,
  offerableYears,
  saveBlob,
  screenLanguage,
  yearsOfRange,
} from './budgetFile';
import { failureText } from './budgetFileText';
import { ExportFormat, readExportFormat, writeExportFormat } from '../csv/exportFormat';

export type BudgetFileColumnChoice = {
  key: FileColumnKey;
  label: string;
  shown: boolean;
};

const monoSx = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  color: 'kanap.text.tertiary',
} as const;

/**
 * Export of a list's budget file: the lines on screen or all of them, the
 * years, the columns, yearly totals or months, and CSV or Excel (the format
 * last chosen in this browser). The file is written for the language the
 * screen is shown in.
 */
export default function BudgetFileExportDialog({
  open,
  onClose,
  scope,
  columns,
  columnsReady,
  list,
  filteredCount,
}: {
  open: boolean;
  onClose: () => void;
  scope: BudgetFileExportScope;
  columns: BudgetFileColumnChoice[];
  columnsReady: boolean;
  /** The list's current sort, search, filters and status. */
  list: BudgetListState | null;
  /** Lines the list shows with its filters, null until the list has loaded. */
  filteredCount: number | null;
}) {
  const { t, i18n } = useTranslation('ops');
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  // A limited person exports the lines of their access (the file has no header to say so).
  const currentYear = new Date().getFullYear();
  const years = offerableYears(currentYear);
  const [range, setRange] = useState(() => defaultYearRange(currentYear));
  // The usual export: the current year alone, in one click. The chosen range comes back when unticked.
  const [currentOnly, setCurrentOnly] = useState(false);
  const shownRange = currentOnly ? { from: currentYear, to: currentYear } : range;
  const [selectedColumns, setSelectedColumns] = useState<FileColumnKey[]>([]);
  const [columnsTouched, setColumnsTouched] = useState(false);
  const [detail, setDetail] = useState<'yearly' | 'months'>('yearly');
  const [format, setFormat] = useState<ExportFormat>(readExportFormat);
  const [allLines, setAllLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shownKey = columns.filter((column) => column.shown).map((column) => column.key).join(',');

  useEffect(() => {
    if (open) return;
    setColumnsTouched(false);
    setError(null);
    setSaving(false);
    setAllLines(false);
    setDetail('yearly');
    setRange(defaultYearRange(currentYear));
    setCurrentOnly(false);
  }, [open, currentYear]);

  // Another export dialog may have changed the shared choice since.
  useEffect(() => {
    if (open) setFormat(readExportFormat());
  }, [open]);

  const chooseFormat = (next: ExportFormat) => {
    setFormat(next);
    writeExportFormat(next);
  };

  useEffect(() => {
    if (!open || columnsTouched || !columnsReady) return;
    const shown = (shownKey ? shownKey.split(',') : columns.map((column) => column.key)) as FileColumnKey[];
    setSelectedColumns(shown);
  }, [open, shownKey, columns, columnsReady, columnsTouched]);

  const filtered = !!list && (!!list.q || !!list.filters);
  const saveLabel = allLines
    ? t('operations.budgetFile.exportAll')
    : filteredCount == null
      ? t('operations.budgetFile.exportLines')
      : filtered
        ? t('operations.budgetFile.exportFiltered', { count: filteredCount })
        : t('operations.budgetFile.exportCount', { count: filteredCount });

  const setFrom = (from: number) => setRange((current) => ({
    from,
    to: Math.min(Math.max(current.to, from), from + MAX_EXPORT_YEARS - 1),
  }));
  const setTo = (to: number) => setRange((current) => ({
    from: Math.max(Math.min(current.from, to), to - MAX_EXPORT_YEARS + 1),
    to,
  }));

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await exportBudgetFile(scope, list, {
        language,
        amountYears: yearsOfRange(shownRange.from, shownRange.to),
        columns: columns.map((column) => column.key).filter((key) => selectedColumns.includes(key)),
        detail,
        all: allLines,
        format,
      });
      const header = (response.headers?.['content-disposition'] ?? response.headers?.['Content-Disposition']) as string | undefined;
      saveBlob(filenameFromDisposition(header, format === 'xlsx' ? BUDGET_XLSX_FILE_NAME : BUDGET_FILE_NAME), response.data);
      onClose();
    } catch (err) {
      setError(failureText(await budgetFileFailure(err), t, 'export'));
    } finally {
      setSaving(false);
    }
  };

  const yearSelect = (value: number, onChange: (year: number) => void, label: string) => (
    <Select
      variant="standard"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      disabled={currentOnly}
      inputProps={{ 'aria-label': label }}
      sx={{ ...drawerSelectSx, width: 96 }}
      MenuProps={{ slotProps: { paper: { style: { maxHeight: 320 } } } }}
    >
      {years.map((year) => <MenuItem key={year} value={year} sx={drawerMenuItemSx}>{year}</MenuItem>)}
    </Select>
  );

  return (
    <KanapDialog
      open={open}
      onClose={onClose}
      title={t(scope === 'all' ? 'budget.exportTitle' : scope === 'opex' ? 'opex.exportTitle' : 'capex.exportTitle')}
      onSave={onSave}
      saveLabel={saveLabel}
      saveDisabled={selectedColumns.length === 0}
      saveLoading={saving}
      sx={{ maxWidth: 520 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        <Group label={t('operations.budgetFile.lines')}>
          <ChoiceLine
            control={<Checkbox size="small" checked={allLines} onChange={(event) => setAllLines(event.target.checked)} sx={{ p: 0.25 }} />}
            label={t('operations.budgetFile.allLines')}
            hint={t('operations.budgetFile.allLinesHint')}
          />
        </Group>

        <Group label={t('operations.budgetFile.years')}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.75 }}>
            {yearSelect(shownRange.from, setFrom, t('operations.budgetFile.fromYear'))}
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('operations.budgetFile.toYear')}</Typography>
            {yearSelect(shownRange.to, setTo, t('operations.budgetFile.toYearLabel'))}
            <Box sx={{ ml: 1.5 }}>
              <ChoiceLine
                control={<Checkbox size="small" checked={currentOnly} onChange={(event) => setCurrentOnly(event.target.checked)} sx={{ p: 0.25 }} />}
                label={t('operations.budgetFile.currentYearOnly', { year: currentYear })}
              />
            </Box>
          </Box>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mt: 0.5 }}>
            {t('operations.budgetFile.yearsHint', { count: MAX_EXPORT_YEARS })}
          </Typography>
        </Group>

        <Group label={t('operations.budgetFile.columns')}>
          {columns.map((column) => (
            <ChoiceLine
              key={column.key}
              control={(
                <Checkbox
                  size="small"
                  checked={selectedColumns.includes(column.key)}
                  onChange={(event) => {
                    setColumnsTouched(true);
                    const on = event.target.checked;
                    setSelectedColumns((current) => (on ? [...current.filter((key) => key !== column.key), column.key] : current.filter((key) => key !== column.key)));
                  }}
                  sx={{ p: 0.25 }}
                />
              )}
              label={column.label}
              after={(
                <>
                  <Box component="span" sx={monoSx}>{`${column.key}_${currentYear}`}</Box>
                  {!column.shown && (
                    <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('operations.budgetFile.hiddenColumn')}</Box>
                  )}
                </>
              )}
            />
          ))}
        </Group>

        <Group label={t('operations.budgetFile.detail')}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5 }}>
            <ChoiceLine
              control={<Radio size="small" checked={detail === 'yearly'} onChange={() => setDetail('yearly')} value="yearly" name="budget-file-detail" sx={{ p: 0.25 }} />}
              label={t('operations.budgetFile.yearly')}
            />
            <ChoiceLine
              control={<Radio size="small" checked={detail === 'months'} onChange={() => setDetail('months')} value="months" name="budget-file-detail" sx={{ p: 0.25 }} />}
              label={t('operations.budgetFile.months')}
            />
          </Box>
        </Group>

        <Group label={t('operations.budgetFile.format')}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5 }}>
            <ChoiceLine
              control={<Radio size="small" checked={format === 'csv'} onChange={() => chooseFormat('csv')} value="csv" name="budget-file-format" sx={{ p: 0.25 }} />}
              label={t('operations.budgetFile.formatCsv')}
            />
            <ChoiceLine
              control={<Radio size="small" checked={format === 'xlsx'} onChange={() => chooseFormat('xlsx')} value="xlsx" name="budget-file-format" sx={{ p: 0.25 }} />}
              label={t('operations.budgetFile.formatXlsx')}
            />
          </Box>
        </Group>

        {format === 'csv' && (
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('operations.budgetFile.formatHint')}</Typography>
        )}
        {error && <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.danger' }}>{error}</Typography>}
      </Box>
    </KanapDialog>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{label}</Typography>
      {children}
    </Box>
  );
}

function ChoiceLine({
  control,
  label,
  hint,
  after,
}: {
  control: React.ReactElement;
  label: string;
  hint?: string;
  after?: React.ReactNode;
}) {
  return (
    <Box component="label" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, cursor: 'pointer' }}>
      {control}
      <Box sx={{ minWidth: 0, pt: '3px' }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          <Typography component="span" sx={{ fontSize: 13, color: 'kanap.text.primary', lineHeight: 1.4 }}>{label}</Typography>
          {after}
        </Box>
        {hint && <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 }}>{hint}</Typography>}
      </Box>
    </Box>
  );
}
