import { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoHint from '../../../components/workspace/InfoHint';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { PhaseTemplate, PhaseTemplateItem } from './types';

// Phase Template Edit Dialog Component
export function PhaseTemplateEditDialog({
  open,
  template,
  onClose,
  onSave,
}: {
  open: boolean;
  template: PhaseTemplate | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [name, setName] = useState('');
  const [items, setItems] = useState<PhaseTemplateItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setItems(template.items.map((i) => ({ ...i })));
    } else {
      setName('');
      setItems([
        {
          name: t('settings.phaseTemplates.dialog.defaults.phaseName', { number: 1 }),
          has_milestone: true,
          milestone_name: t('settings.phaseTemplates.dialog.defaults.milestoneName', { number: 1 }),
        },
      ]);
    }
    setError(null);
  }, [template, open, t]);

  const handleAddItem = () => {
    setItems([...items, { name: '', has_milestone: true, milestone_name: '' }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (
    index: number,
    field: keyof PhaseTemplateItem,
    value: any
  ) => {
    setItems(
      items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      const payload = {
        name,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          has_milestone: item.has_milestone,
          milestone_name: item.has_milestone ? item.milestone_name : null,
        })),
      };

      if (template) {
        await api.patch(`/portfolio/phase-templates/${template.id}`, payload);
      } else {
        await api.post('/portfolio/phase-templates', payload);
      }

      onSave();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const isValid =
    name.trim() &&
    items.length > 0 &&
    items.every((item) => item.name.trim());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {template ? t('settings.phaseTemplates.dialog.editTitle') : t('settings.phaseTemplates.dialog.createTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('settings.phaseTemplates.dialog.templateName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />

          <Divider />

          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="subtitle2">{t('settings.phaseTemplates.dialog.phases')}</Typography>
            <InfoHint text={t('settings.phaseTemplates.dialog.phasesDescription')} />
          </Stack>

          {items.map((item, idx) => (
            <Stack
              key={idx}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}
            >
              <Typography variant="caption" sx={{ width: 24 }}>
                {idx + 1}.
              </Typography>
              <TextField
                value={item.name}
                onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                size="small"
                placeholder={t('settings.phaseTemplates.dialog.phaseNamePlaceholder')}
                sx={{ flex: 1 }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={item.has_milestone}
                    onChange={(e) =>
                      handleItemChange(idx, 'has_milestone', e.target.checked)
                    }
                    size="small"
                  />
                }
                label={t('settings.phaseTemplates.dialog.milestone')}
                sx={{ minWidth: 100 }}
              />
              {item.has_milestone && (
                <TextField
                  value={item.milestone_name || ''}
                  onChange={(e) =>
                    handleItemChange(idx, 'milestone_name', e.target.value)
                  }
                  size="small"
                  placeholder={t('settings.phaseTemplates.dialog.milestoneNamePlaceholder')}
                  sx={{ width: 200 }}
                />
              )}
              <IconButton
                size="small"
                onClick={() => handleRemoveItem(idx)}
                disabled={items.length <= 1}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}

          <Button startIcon={<AddIcon />} onClick={handleAddItem} size="small">
            {t('settings.actions.addPhase')}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button
          variant="action-primary"
          onClick={handleSave}
          disabled={saving || !isValid}
        >
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
