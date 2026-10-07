import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import ChipToggleBar from '../../components/ChipToggleBar';
import { coaCoverage, coaRoleLabels, useCountryName } from './coaRoles';
import { CoaListItem } from './useCoaList';

export default function CoaChipBar({
  coas,
  selectedCoaId,
  onSelect,
  onCreate,
  onManage,
  canManage,
}: {
  coas: CoaListItem[];
  selectedCoaId?: string;
  onSelect: (coaId: string) => void;
  onCreate: () => void;
  onManage: () => void;
  canManage: boolean;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const countryName = useCountryName();
  if (coas.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1} alignItems="flex-start">
          <Typography variant="subtitle1">{t('coa.chipBar.createFirst')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('coa.chipBar.accountsInChart')}
          </Typography>
          {canManage && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
              {t('coa.chipBar.newCoA')}
            </Button>
          )}
        </Stack>
      </Paper>
    );
  }

  return (
    <ChipToggleBar
      ariaLabel={t('coa.title')}
      selectedId={selectedCoaId}
      onSelect={onSelect}
      items={coas.map((coa) => ({
        id: coa.id,
        label: coa.code,
        tooltip: (
          <>
            <div>{coa.name}</div>
            <div>
              {[
                coaCoverage(coa, t, countryName),
                t('coa.accountCount', { count: coa.accounts_count ?? 0 }),
                ...coaRoleLabels(coa, t, countryName),
              ].join(' · ')}
            </div>
          </>
        ),
      }))}
      actions={canManage && (
        <>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={onCreate}
          >
            {t('coa.chipBar.newChip')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={onManage}
          >
            {t('coa.chipBar.manage')}
          </Button>
        </>
      )}
    />
  );
}
