import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import DateEUField from '../../../components/fields/DateEUField';
import api from '../../../api';
import { MarkdownContent } from '../../../components/MarkdownContent';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

interface ConvertToProjectDialogProps {
  open: boolean;
  onClose: () => void;
  request: {
    id: string;
    name: string;
    target_delivery_date?: string | null;
  };
  onSuccess: (projectId: string) => void;
}

export default function ConvertToProjectDialog({
  open,
  onClose,
  request,
  onSuccess,
}: ConvertToProjectDialogProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const [name, setName] = useState(request.name);
  const [plannedStart, setPlannedStart] = useState<string>('');
  const [plannedEnd, setPlannedEnd] = useState<string>('');
  const [effortIt, setEffortIt] = useState<number | null>(null);
  const [effortBusiness, setEffortBusiness] = useState<number | null>(null);
  const [loadingEffort, setLoadingEffort] = useState(false);
  const [loadingPurpose, setLoadingPurpose] = useState(false);
  const [purposePreview, setPurposePreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load estimated effort and current managed purpose when dialog opens.
  // Depend on `open` and `request.id` only — not the request object, which is
  // recreated on every parent render and would reset the user-edited name.
  useEffect(() => {
    if (open && request.id) {
      setName(request.name);
      setPlannedStart('');
      setPlannedEnd('');
      setError(null);
      setPurposePreview('');

      const loadEffort = async () => {
        setLoadingEffort(true);
        try {
          const res = await api.get(`/portfolio/requests/${request.id}/estimated-effort`);
          setEffortIt(res.data?.estimated_effort_it ?? null);
          setEffortBusiness(res.data?.estimated_effort_business ?? null);
        } catch (e) {
          console.error('Failed to load estimated effort', e);
          setEffortIt(null);
          setEffortBusiness(null);
        } finally {
          setLoadingEffort(false);
        }
      };

      const loadPurpose = async () => {
        setLoadingPurpose(true);
        try {
          const res = await api.get(`/portfolio/requests/${request.id}/integrated-documents/purpose`);
          setPurposePreview(res.data?.content_markdown || '');
        } catch (e) {
          console.error('Failed to load managed request purpose', e);
          setPurposePreview('');
        } finally {
          setLoadingPurpose(false);
        }
      };

      loadEffort();
      loadPurpose();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request.id]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setSaving(true);

    try {
      const body: any = {
        name: name.trim(),
      };
      if (plannedStart) body.planned_start = plannedStart;
      if (plannedEnd) body.planned_end = plannedEnd;
      if (effortIt != null) body.estimated_effort_it = effortIt;
      if (effortBusiness != null) body.estimated_effort_business = effortBusiness;

      const res = await api.post(`/portfolio/requests/${request.id}/convert`, body);

      onSuccess(res.data.id);
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:dialogs.convertToProject.messages.convertFailed'),
      ));
    } finally {
      setSaving(false);
    }
  }, [request.id, name, plannedStart, plannedEnd, effortIt, effortBusiness, onSuccess, t]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('portfolio:dialogs.convertToProject.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('portfolio:dialogs.convertToProject.fields.projectName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />

          {(loadingPurpose || purposePreview) && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {t('portfolio:dialogs.convertToProject.sections.purpose')}
              </Typography>
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  maxHeight: 150,
                  overflow: 'auto',
                  bgcolor: 'action.hover',
                }}
              >
                {loadingPurpose ? (
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <CircularProgress size={16} />
                    <span>{t('portfolio:dialogs.convertToProject.states.loadingPurpose')}</span>
                  </Stack>
                ) : (
                  <MarkdownContent content={purposePreview} variant="compact" />
                )}
              </Box>
            </Box>
          )}

          {loadingEffort ? (
            <Stack direction="row" alignItems="center" spacing={1}>
              <CircularProgress size={16} />
              <span>{t('portfolio:dialogs.convertToProject.states.loadingEffort')}</span>
            </Stack>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
              }}
            >
              <DateEUField
                label={t('portfolio:dialogs.convertToProject.fields.plannedStart')}
                valueYmd={plannedStart}
                onChangeYmd={setPlannedStart}
              />
              <DateEUField
                label={t('portfolio:dialogs.convertToProject.fields.plannedEnd')}
                valueYmd={plannedEnd}
                onChangeYmd={setPlannedEnd}
              />
              <TextField
                label={t('portfolio:dialogs.convertToProject.fields.effortIt')}
                type="number"
                value={effortIt ?? ''}
                onChange={(e) => setEffortIt(e.target.value === '' ? null : Number(e.target.value))}
                helperText={t('portfolio:dialogs.convertToProject.helper.effortIt')}
              />
              <TextField
                label={t('portfolio:dialogs.convertToProject.fields.effortBusiness')}
                type="number"
                value={effortBusiness ?? ''}
                onChange={(e) => setEffortBusiness(e.target.value === '' ? null : Number(e.target.value))}
                helperText={t('portfolio:dialogs.convertToProject.helper.effortBusiness')}
              />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="action-primary" onClick={handleSubmit} disabled={saving || loadingEffort || !name.trim()}>
          {saving
            ? t('portfolio:dialogs.convertToProject.actions.converting')
            : t('portfolio:dialogs.convertToProject.actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
