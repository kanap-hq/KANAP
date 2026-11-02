import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { KanapDialog, PropertyRow } from '../../../components/design';
import DeleteIconButton from '../../../components/workspace/DeleteIconButton';

type DocumentTypeItem = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  is_default: boolean;
  display_order: number;
};

export default function KnowledgeTypesManager() {
  const { t } = useTranslation(['knowledge', 'common']);
  const qc = useQueryClient();
  const [newName, setNewName] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [draftById, setDraftById] = React.useState<Record<string, DocumentTypeItem>>({});
  const [deleteTypeCandidate, setDeleteTypeCandidate] = React.useState<DocumentTypeItem | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['knowledge-types'],
    queryFn: async () => (await api.get('/knowledge-types')).data as DocumentTypeItem[],
  });

  React.useEffect(() => {
    if (!data) return;
    setDraftById(Object.fromEntries(data.map((item) => [item.id, { ...item }])));
  }, [data]);

  const invalidateAll = React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['knowledge-types'] }),
      qc.invalidateQueries({ queryKey: ['knowledge'] }),
    ]);
  }, [qc]);

  const createMutation = useMutation({
    mutationFn: async () => {
      await api.post('/knowledge-types', {
        name: newName.trim(),
        description: newDescription.trim() || null,
      });
    },
    onSuccess: async () => {
      setNewName('');
      setNewDescription('');
      await invalidateAll();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) => {
      const draft = draftById[id];
      if (!draft) return;
      await api.patch(`/knowledge-types/${id}`, {
        name: draft.name,
        description: draft.description,
        is_active: draft.is_active,
        display_order: Number.isFinite(Number(draft.display_order)) ? Number(draft.display_order) : 0,
      });
    },
    onSuccess: async () => {
      await invalidateAll();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-types/${id}`);
    },
    onSuccess: async () => {
      await invalidateAll();
    },
  });

  const setDraftField = React.useCallback(
    function setDraftField<K extends keyof DocumentTypeItem>(id: string, field: K, value: DocumentTypeItem[K]) {
      setDraftById((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || ({} as DocumentTypeItem)),
          [field]: value,
        },
      }));
    },
    [],
  );

  const isRowChanged = React.useCallback((row: DocumentTypeItem) => {
    const original = (data || []).find((item) => item.id === row.id);
    if (!original) return false;
    return (
      original.name !== row.name ||
      (original.description || '') !== (row.description || '') ||
      !!original.is_active !== !!row.is_active ||
      Number(original.display_order || 0) !== Number(row.display_order || 0)
    );
  }, [data]);

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {t('typesManager.messages.introPrefix')} <Box component="span" sx={{ fontWeight: 500 }}>{t('typesManager.messages.documentType')}</Box> {t('typesManager.messages.introSuffix')}
      </Alert>

      <Box sx={{ border: (theme) => `1px solid ${theme.palette.kanap.border.default}`, borderRadius: '8px', p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle2">{t('typesManager.create.title')}</Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <PropertyRow label={t('typesManager.fields.name')} required sx={{ minWidth: 220 }}>
              <TextField
                variant="standard"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('typesManager.fields.name')}
                fullWidth
              />
            </PropertyRow>
            <PropertyRow label={t('typesManager.fields.description')} sx={{ flex: 1 }}>
              <TextField
                variant="standard"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('typesManager.fields.description')}
                fullWidth
              />
            </PropertyRow>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {t('common:buttons.create')}
            </Button>
          </Stack>
          {createMutation.isError && (
            <Alert severity="error">
              {getApiErrorMessage(createMutation.error, t, t('typesManager.messages.createFailed'))}
            </Alert>
          )}
        </Stack>
      </Box>

      <Box sx={{ border: (theme) => `1px solid ${theme.palette.kanap.border.default}`, borderRadius: '8px', overflow: 'auto' }}>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {!!error && !isLoading && <Alert severity="error" sx={{ m: 2 }}>{getApiErrorMessage(error, t, t('typesManager.messages.loadFailed'))}</Alert>}

        {!isLoading && !error && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('typesManager.columns.name')}</TableCell>
                <TableCell>{t('typesManager.columns.description')}</TableCell>
                <TableCell width={110}>{t('typesManager.columns.order')}</TableCell>
                <TableCell width={90}>{t('typesManager.columns.active')}</TableCell>
                <TableCell width={180}>{t('typesManager.columns.flags')}</TableCell>
                <TableCell align="right" width={180}>{t('typesManager.columns.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data || []).map((item) => {
                const draft = draftById[item.id] || item;
                const changed = isRowChanged(draft);
                const locked = !!item.is_system;
                return (
                  <TableRow key={item.id}>
                    <TableCell sx={{ minWidth: 220 }}>
                      <TextField
                        size="small"
                        value={draft.name}
                        onChange={(e) => setDraftField(item.id, 'name', e.target.value)}
                        fullWidth
                        disabled={locked}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 260 }}>
                      <TextField
                        size="small"
                        value={draft.description || ''}
                        onChange={(e) => setDraftField(item.id, 'description', e.target.value)}
                        fullWidth
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={draft.display_order ?? 0}
                        onChange={(e) => setDraftField(item.id, 'display_order', Number(e.target.value || 0))}
                        inputProps={{ min: 0 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={!!draft.is_active}
                        onChange={(e) => setDraftField(item.id, 'is_active', e.target.checked)}
                        disabled={!!item.is_default}
                      />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {item.is_default && <Typography variant="body2" color="text.secondary">{t('typesManager.flags.default')}</Typography>}
                        {item.is_system && <Typography variant="body2" color="text.secondary">{t('typesManager.flags.builtIn')}</Typography>}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<SaveIcon />}
                          onClick={() => updateMutation.mutate(item.id)}
                          disabled={!changed || updateMutation.isPending}
                        >
                          {t('common:buttons.save')}
                        </Button>
                        {!item.is_system && (
                          <DeleteIconButton
                            onClick={() => setDeleteTypeCandidate(item)}
                            disabled={deleteMutation.isPending}
                          />
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!data?.length && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      {t('typesManager.empty')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Box>

      {(updateMutation.isError || deleteMutation.isError) && (
        <Alert severity="error">
          {getApiErrorMessage(
            updateMutation.error || deleteMutation.error,
            t,
            t('typesManager.messages.updateFailed'),
          )}
        </Alert>
      )}

      <KanapDialog
        open={!!deleteTypeCandidate}
        title={deleteTypeCandidate?.name ? t('common:delete.recordTitle', { name: deleteTypeCandidate.name }) : t('typesManager.dialogs.delete.title')}
        onClose={() => setDeleteTypeCandidate(null)}
        onSave={() => {
          if (!deleteTypeCandidate) return;
          deleteMutation.mutate(deleteTypeCandidate.id);
          setDeleteTypeCandidate(null);
        }}
        saveLabel={t('common:buttons.delete')}
        saveDisabled={!deleteTypeCandidate || deleteMutation.isPending}
        saveLoading={deleteMutation.isPending}
      >
        <Typography variant="body2" color="text.secondary">
          {t('typesManager.confirmations.delete', { name: deleteTypeCandidate?.name || '' })}
        </Typography>
      </KanapDialog>
    </Stack>
  );
}
