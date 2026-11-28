import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { PortfolioStream } from './types';

// Stream Edit Dialog
export function StreamEditDialog({
  open,
  stream,
  categoryId,
  onClose,
  onSave,
}: {
  open: boolean;
  stream: PortfolioStream | null;
  categoryId: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stream) {
      setName(stream.name);
      setDescription(stream.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [stream, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (stream) {
        await api.patch(`/portfolio/classification/streams/${stream.id}`, { name, description });
      } else if (categoryId) {
        await api.post('/portfolio/classification/streams', { category_id: categoryId, name, description });
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
        {stream ? t('settings.classification.streamDialog.editTitle') : t('settings.classification.streamDialog.createTitle')}
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
