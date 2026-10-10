import React from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import UserSelect from '../../../components/fields/UserSelect';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type TimeEntryCategory = 'it' | 'business';

export interface TimeEntryData {
  id: string;
  category: TimeEntryCategory;
  user_id: string | null;
  hours: number;
  notes: string | null;
}

interface LogTimeDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onSuccess: () => void;
  editEntry?: TimeEntryData;
}

export default function LogTimeDialog({
  open,
  onClose,
  projectId,
  onSuccess,
  editEntry,
}: LogTimeDialogProps) {
  const { profile } = useAuth();
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const isEdit = !!editEntry;

  const [category, setCategory] = React.useState<TimeEntryCategory>('it');
  const [userId, setUserId] = React.useState<string | null>(null);
  const [days, setDays] = React.useState<number>(0);
  const [hours, setHours] = React.useState<number>(0);
  const [notes, setNotes] = React.useState<string>('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      if (editEntry) {
        setCategory(editEntry.category);
        setUserId(editEntry.user_id);
        // Convert total hours back to days and hours
        const totalHours = editEntry.hours;
        setDays(Math.floor(totalHours / 8));
        setHours(totalHours % 8);
        setNotes(editEntry.notes || '');
      } else {
        setCategory('it');
        setUserId(profile?.id || null);
        setDays(0);
        setHours(0);
        setNotes('');
      }
      setError(null);
    }
  }, [open, editEntry, profile?.id]);

  const totalHours = days * 8 + hours;

  const handleSubmit = async () => {
    if (totalHours <= 0) {
      setError(t('portfolio:dialogs.logTime.validation.totalPositive'));
      return;
    }
    if (!userId) {
      setError(t('portfolio:dialogs.logTime.validation.personRequired'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isEdit && editEntry) {
        await api.patch(`/portfolio/projects/${projectId}/time-entries/${editEntry.id}`, {
          category,
          user_id: userId,
          hours: totalHours,
          notes: notes.trim() || null,
        });
      } else {
        await api.post(`/portfolio/projects/${projectId}/time-entries`, {
          category,
          user_id: userId,
          hours: totalHours,
          notes: notes.trim() || null,
        });
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:dialogs.logTime.messages.saveFailed'),
      ));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEdit
          ? t('portfolio:dialogs.logTime.title.edit')
          : t('portfolio:dialogs.logTime.title.create')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <FormControl component="fieldset">
            <FormLabel component="legend">{t('portfolio:dialogs.logTime.fields.category')}</FormLabel>
            <RadioGroup
              row
              value={category}
              onChange={(e) => setCategory(e.target.value as TimeEntryCategory)}
            >
              <FormControlLabel
                value="it"
                control={<Radio />}
                label={t('portfolio:dialogs.logTime.categories.it')}
              />
              <FormControlLabel
                value="business"
                control={<Radio />}
                label={t('portfolio:dialogs.logTime.categories.business')}
              />
            </RadioGroup>
          </FormControl>

          <UserSelect
            label={t('portfolio:dialogs.logTime.fields.person')}
            value={userId}
            onChange={setUserId}
            placeholder={t('portfolio:dialogs.logTime.placeholders.searchUsers')}
            required
          />

          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField
              label={t('portfolio:dialogs.logTime.fields.hours')}
              type="number"
              value={hours}
              onChange={(e) => {
                const val = Math.max(0, Math.min(7, Math.floor(Number(e.target.value) || 0)));
                setHours(val);
              }}
              inputProps={{ min: 0, max: 7, step: 1 }}
              sx={{ flex: 1 }}
              helperText={t('portfolio:dialogs.logTime.helper.hoursRange')}
            />
            <TextField
              label={t('portfolio:dialogs.logTime.fields.days')}
              type="number"
              value={days}
              onChange={(e) => {
                const val = Math.max(0, Math.floor(Number(e.target.value) || 0));
                setDays(val);
              }}
              inputProps={{ min: 0, step: 1 }}
              sx={{ flex: 1 }}
              helperText={t('portfolio:dialogs.logTime.helper.dayLength')}
            />
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {t('portfolio:dialogs.logTime.helper.total', {
              hours: totalHours,
              md: (totalHours / 8).toFixed(1),
            })}
          </Typography>

          <TextField
            label={t('portfolio:dialogs.logTime.fields.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={2}
            placeholder={t('portfolio:dialogs.logTime.placeholders.notes')}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={handleClose} disabled={saving}>
          {t('common:buttons.cancel')}
        </Button>
        <Button
          variant="action-primary"
          onClick={handleSubmit}
          disabled={saving || totalHours <= 0 || !userId}
        >
          {saving
            ? t('common:status.saving')
            : isEdit
            ? t('common:buttons.saveChanges')
            : t('portfolio:dialogs.logTime.actions.logTime')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
