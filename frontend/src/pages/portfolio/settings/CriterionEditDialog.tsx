import { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoHint from '../../../components/workspace/InfoHint';
import { useTranslation } from 'react-i18next';
import FormattedNumberField from '../../../components/inputs/FormattedNumberField';
import { decimalMark } from '../../../i18n/formatters';
import { useLocale } from '../../../i18n/useLocale';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { Criterion, CriterionValue } from './types';

// Criterion Edit Dialog Component
export function CriterionEditDialog({
  open,
  criterion,
  onClose,
  onSave,
}: {
  open: boolean;
  criterion: Criterion | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const locale = useLocale();
  const [name, setName] = useState('');
  const [inverted, setInverted] = useState(false);
  const [weight, setWeight] = useState(1);
  const [values, setValues] = useState<CriterionValue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (criterion) {
      setName(criterion.name);
      setInverted(criterion.inverted);
      setWeight(criterion.weight);
      setValues(criterion.values.map((v) => ({ ...v })));
    } else {
      setName('');
      setInverted(false);
      setWeight(1);
      setValues([
        { label: t('settings.scoring.dialog.defaults.low'), triggers_mandatory_bypass: false },
        { label: t('settings.scoring.dialog.defaults.high'), triggers_mandatory_bypass: false },
      ]);
    }
    setError(null);
  }, [criterion, open, t]);

  const handleAddValue = () => {
    setValues([...values, { label: '', triggers_mandatory_bypass: false }]);
  };

  const handleRemoveValue = (index: number) => {
    if (values.length <= 2) return;
    setValues(values.filter((_, i) => i !== index));
  };

  const handleValueChange = (index: number, field: keyof CriterionValue, value: any) => {
    setValues(
      values.map((v, i) =>
        i === index ? { ...v, [field]: value } : v
      )
    );
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      const payload = {
        name,
        inverted,
        weight,
        values: values.map((v) => ({
          id: v.id,
          label: v.label,
          triggers_mandatory_bypass: v.triggers_mandatory_bypass,
        })),
      };

      if (criterion) {
        await api.patch(`/portfolio/criteria/${criterion.id}`, payload);
      } else {
        await api.post('/portfolio/criteria', payload);
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
        {criterion ? t('settings.scoring.dialog.editTitle') : t('settings.scoring.dialog.createTitle')}
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

          <Stack direction="row" spacing={2}>
            <FormattedNumberField
              label={t('settings.scoring.dialog.weight')}
              value={weight}
              // portfolio_criteria.weight is numeric(5,2).
              decimals={2}
              decimalSeparator={decimalMark(locale)}
              onChange={(event) => setWeight(Number(event.target.value))}
              sx={{ width: 120 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={inverted}
                  onChange={(e) => setInverted(e.target.checked)}
                />
              }
              label={t('settings.scoring.dialog.inverted')}
            />
          </Stack>

          <Divider />

          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="subtitle2">{t('settings.scoring.dialog.scaleValues')}</Typography>
            <InfoHint text={t('settings.scoring.dialog.scaleValuesDescription')} />
          </Stack>

          {values.map((v, idx) => (
            <Stack key={idx} direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" sx={{ width: 20 }}>
                {idx + 1}.
              </Typography>
              <TextField
                value={v.label}
                onChange={(e) => handleValueChange(idx, 'label', e.target.value)}
                size="small"
                fullWidth
                placeholder={t('settings.scoring.dialog.valueLabelPlaceholder')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={v.triggers_mandatory_bypass}
                    onChange={(e) =>
                      handleValueChange(idx, 'triggers_mandatory_bypass', e.target.checked)
                    }
                    size="small"
                  />
                }
                label={t('settings.scoring.dialog.mandatory')}
                sx={{ minWidth: 110 }}
              />
              <IconButton
                size="small"
                onClick={() => handleRemoveValue(idx)}
                disabled={values.length <= 2}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}

          <Button startIcon={<AddIcon />} onClick={handleAddValue} size="small">
            {t('settings.actions.addValue')}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('common:buttons.cancel')}</Button>
        <Button
          variant="action-primary"
          onClick={handleSave}
          disabled={saving || !name.trim() || values.some((v) => !v.label.trim())}
        >
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
