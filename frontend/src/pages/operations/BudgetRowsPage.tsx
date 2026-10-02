import React from 'react';
import { Box, Button, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { forgetAllAllocations } from '../../components/finance/allocationsCache';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { PropertyRow } from '../../components/design';
import CsvExportDialog from '../../components/csv/CsvExportDialog';
import CsvImportDialog from '../../components/csv/CsvImportDialog';
import { compactSelectMenuProps, drawerMenuItemSx, pageSelectSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import { budgetRowsEndpoint } from '../../services/budgetOperations';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';

const ALL_YEARS = 'all';

export default function BudgetRowsPage() {
  const { t } = useTranslation(['ops', 'common']);
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const canImport = hasLevel('opex', 'admin') || hasLevel('capex', 'admin');
  const budgetColumns = useBudgetColumns();
  // Where to find each column in the file: its technical name in the measure column.
  const fileNames = budgetColumns.all
    .map((c) => t('operations.budgetRows.fileName', { key: c.measure, column: c.label }))
    .join(', ');

  const Y = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => Y - 3 + i);
  const [year, setYear] = React.useState<string>(ALL_YEARS);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const onImported = () => {
    void queryClient.invalidateQueries({ queryKey: ['spend-items-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['capex-items-summary'] });
    // The lines' Allocations tabs show their totals: their cached years are read again.
    forgetAllAllocations(queryClient);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('operations.budgetRows.title')} breadcrumbTitle={t('operations.budgetRows.title')} />
      <Stack spacing={0.5} sx={{ maxWidth: 720 }}>
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{t('operations.budgetRows.intro')}</Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{t('operations.budgetRows.importRules')}</Typography>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('operations.budgetRows.fileNames', { names: fileNames })}</Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 640 }}>
        <PropertyRow label={t('operations.budgetRows.year')}>
          <Select
            variant="standard"
            value={year}
            onChange={(e) => setYear(String(e.target.value))}
            sx={pageSelectSx}
            MenuProps={compactSelectMenuProps}
          >
            <MenuItem value={ALL_YEARS} sx={drawerMenuItemSx}>{t('operations.budgetRows.allYears')}</MenuItem>
            {years.map((y) => (
              <MenuItem key={y} value={String(y)} sx={drawerMenuItemSx}>{y}</MenuItem>
            ))}
          </Select>
        </PropertyRow>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="action" onClick={() => setExportOpen(true)}>{t('operations.budgetRows.export')}</Button>
          {canImport && (
            <Button variant="action" onClick={() => setImportOpen(true)}>{t('operations.budgetRows.import')}</Button>
          )}
        </Stack>
      </Paper>

      <CsvExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint={budgetRowsEndpoint}
        title={t('operations.budgetRows.exportTitle')}
        params={year === ALL_YEARS ? undefined : { year }}
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={budgetRowsEndpoint}
        title={t('operations.budgetRows.importTitle')}
        onImported={onImported}
      />
    </Box>
  );
}
