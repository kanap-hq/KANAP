import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { keepsShippedName } from '../../../utils/taskTypeLocalization';
import type { PortfolioTaskType } from './types';

// Task Type Edit Dialog
export function TaskTypeEditDialog({
  open,
  taskType,
  onClose,
  onSave,
}: {
  open: boolean;
  taskType: PortfolioTaskType | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (taskType) {
      setName(taskType.name);
      setDescription(taskType.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [taskType, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (taskType) {
        await api.patch(`/portfolio/classification/task-types/${taskType.id}`, { name, description });
      } else {
        await api.post('/portfolio/classification/task-types', { name, description });
      }
      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {taskType ? t('settings.classification.taskTypeDialog.editTitle') : t('settings.classification.taskTypeDialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            helperText={taskType && keepsShippedName(name, taskType.code) ? t('settings.classification.taskTypeDialog.shippedNameHint') : undefined}
          />
          <TextField
            label={t('settings.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button variant="action-primary" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
