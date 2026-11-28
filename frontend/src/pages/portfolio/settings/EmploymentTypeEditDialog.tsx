import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { EmploymentType } from './types';

// Employment Type Edit Dialog
export function EmploymentTypeEditDialog({
  open,
  employmentType,
  onClose,
  onSave,
}: {
  open: boolean;
  employmentType: EmploymentType | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(employmentType ? employmentType.name : '');
    setError(null);
  }, [employmentType, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (employmentType) {
        await api.patch(`/portfolio/employment-types/${employmentType.id}`, { name });
      } else {
        await api.post('/portfolio/employment-types', { name });
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
        {employmentType ? t('settings.employmentTypes.dialog.editTitle') : t('settings.employmentTypes.dialog.createTitle')}
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
