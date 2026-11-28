import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, IconButton, Stack, Switch, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { EmploymentTypeEditDialog } from './EmploymentTypeEditDialog';
import { useInvalidateSharedLists } from './sharedLists';
import TabActions from './TabActions';
import type { EmploymentType, SettingsTabProps } from './types';
import { useSettingsDelete } from './useSettingsDelete';

/** The contract types tab: the contract types of the contributors. */
export default function EmploymentTypesTab({ canEdit }: SettingsTabProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const invalidate = useInvalidateSharedLists();
  const [employmentTypes, setEmploymentTypes] = useState<EmploymentType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [employmentTypeDialogOpen, setEmploymentTypeDialogOpen] = useState(false);
  const [editingEmploymentType, setEditingEmploymentType] = useState<EmploymentType | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await api.get('/portfolio/employment-types');
      setEmploymentTypes(res.data || []);
      setLoadError(null);
      setLoaded(true);
    } catch (e: any) {
      setLoadError(getApiErrorMessage(e, t, t('settings.messages.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const employmentTypesChanged = useCallback(() => {
    loadData();
    invalidate('employmentTypes');
  }, [invalidate, loadData]);

  const deleteItem = useSettingsDelete({ canEdit, onDeleted: employmentTypesChanged, onError: setError });

  const handleEditEmploymentType = useCallback((type: EmploymentType) => {
    setEditingEmploymentType(type);
    setEmploymentTypeDialogOpen(true);
  }, []);

  const handleCreateEmploymentType = useCallback(() => {
    setEditingEmploymentType(null);
    setEmploymentTypeDialogOpen(true);
  }, []);

  const handleDeleteEmploymentType = useCallback((id: string) => deleteItem({
    id,
    name: employmentTypes.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/employment-types',
    check: true,
    failed: t('settings.employmentTypes.messages.deleteFailed'),
  }), [deleteItem, employmentTypes, t]);

  const handleToggleEmploymentType = useCallback(async (type: EmploymentType) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/employment-types/${type.id}`, { is_active: !type.is_active });
      employmentTypesChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.employmentTypes.messages.updateFailed')));
    }
  }, [canEdit, employmentTypesChanged, t]);

  const handleSeedEmploymentTypes = useCallback(async () => {
    if (!canEdit) return;
    try {
      const res = await api.post('/portfolio/employment-types/seed-defaults');
      if (res.data?.created > 0) {
        employmentTypesChanged();
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.employmentTypes.messages.seedDefaultsFailed')));
    }
  }, [canEdit, employmentTypesChanged, t]);

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!loaded) return null;

  return (
    <>
      {canEdit && (
        <TabActions>
          <Stack direction="row" spacing={1}>
            {employmentTypes.length === 0 && (
              <Button variant="action" startIcon={<PlaylistAddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleSeedEmploymentTypes}>
                {t('settings.actions.seedDefaults')}
              </Button>
            )}
            <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateEmploymentType}>
              {t('settings.actions.addEmploymentType')}
            </Button>
          </Stack>
        </TabActions>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <EmploymentTypesSection
        employmentTypes={employmentTypes}
        canEdit={canEdit}
        onEdit={handleEditEmploymentType}
        onDelete={handleDeleteEmploymentType}
        onToggle={handleToggleEmploymentType}
      />

      <EmploymentTypeEditDialog
        open={employmentTypeDialogOpen}
        employmentType={editingEmploymentType}
        onClose={() => setEmploymentTypeDialogOpen(false)}
        onSave={() => {
          setEmploymentTypeDialogOpen(false);
          employmentTypesChanged();
        }}
      />
    </>
  );
}

// Employment Types Section Component
function EmploymentTypesSection({
  employmentTypes,
  canEdit,
  onEdit,
  onDelete,
  onToggle,
}: {
  employmentTypes: EmploymentType[];
  canEdit: boolean;
  onEdit: (type: EmploymentType) => void;
  onDelete: (id: string) => void;
  onToggle: (type: EmploymentType) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  if (employmentTypes.length === 0) {
    return (
      <Alert severity="info">
        {t('settings.employmentTypes.empty')}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>

      <Card>
        <CardContent sx={{ p: 2 }}>
          <Stack spacing={1}>
            {employmentTypes.map((type) => (
              <Stack
                key={type.id}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  p: 1,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  opacity: type.is_active ? 1 : 0.6,
                }}
              >
                <Switch
                  checked={type.is_active}
                  onChange={() => onToggle(type)}
                  size="small"
                  disabled={!canEdit}
                />
                <Box sx={{ flex: 1 }}>
                  <Typography>{type.name}</Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  {t('settings.employmentTypes.usageCount', { count: type.usage_count })}
                </Typography>
                {type.is_system && (
                  <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                    {t('settings.labels.system')}
                  </Typography>
                )}
                {canEdit && (
                  <>
                    <IconButton size="small" onClick={() => onEdit(type)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onDelete(type.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
