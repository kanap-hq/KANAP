import { useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { Skill } from './types';

// Skill Edit Dialog Component
export function SkillEditDialog({
  open,
  skill,
  existingCategories,
  onClose,
  onSave,
}: {
  open: boolean;
  skill: Skill | null;
  existingCategories: string[];
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (skill) {
      setCategory(skill.category);
      setName(skill.name);
    } else {
      setCategory('');
      setName('');
    }
    setError(null);
  }, [skill, open]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      if (skill) {
        await api.patch(`/portfolio/skills/${skill.id}`, { category, name });
      } else {
        await api.post('/portfolio/skills', { category, name });
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
        {skill ? t('settings.skills.dialog.editTitle') : t('settings.skills.dialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Autocomplete
            freeSolo
            options={existingCategories}
            value={category}
            onChange={(_, v) => setCategory(v || '')}
            onInputChange={(_, v) => setCategory(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('settings.skills.dialog.category')}
                required
                placeholder={t('settings.skills.dialog.categoryPlaceholder')}
              />
            )}
          />

          <TextField
            label={t('settings.skills.dialog.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button
          variant="action-primary"
          onClick={handleSave}
          disabled={saving || !category.trim() || !name.trim()}
        >
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
