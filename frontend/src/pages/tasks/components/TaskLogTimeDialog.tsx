import React from 'react';
import { Alert, Box, Slider, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import UserSelect from '../../../components/fields/UserSelect';
import DateEUField from '../../../components/fields/DateEUField';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { KanapDialog, PropertyRow } from '../../../components/design';
import { drawerFieldValueSx, textTabsSx, textTabSx } from '../../../theme/formSx';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';

type TimeEntryCategory = 'it' | 'business';

const CATEGORIES: TimeEntryCategory[] = ['it', 'business'];
const MAX_HOURS = 7;

export interface TaskTimeEntryData {
  id: string;
  user_id: string | null;
  hours: number;
  notes: string | null;
  logged_at: string;
  category: TimeEntryCategory;
}

interface TaskLogTimeDialogProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  projectId?: string;
  onSuccess: () => void;
  editEntry?: TaskTimeEntryData;
  /** Optional contextual message shown at the top of the dialog (e.g. why time is required). */
  infoMessage?: React.ReactNode;
}

export default function TaskLogTimeDialog({
  open,
  onClose,
  taskId,
  projectId,
  onSuccess,
  editEntry,
  infoMessage,
}: TaskLogTimeDialogProps) {
  const { profile, hasLevel } = useAuth();
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const isEdit = !!editEntry;
  const canAssignUser = projectId
    ? hasLevel('portfolio_projects', 'admin')
    : hasLevel('tasks', 'admin');

  const [category, setCategory] = React.useState<TimeEntryCategory>('it');
  const [userId, setUserId] = React.useState<string | null>(null);
  const [days, setDays] = React.useState<string>('');
  const [hours, setHours] = React.useState<string>('');
  const [notes, setNotes] = React.useState<string>('');
  const [loggedAt, setLoggedAt] = React.useState<string>('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Parse string values to numbers, treating empty as 0
  const daysNum = parseInt(days, 10) || 0;
  const hoursNum = parseInt(hours, 10) || 0;

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      if (editEntry) {
        setCategory(editEntry.category || 'it');
        setUserId(canAssignUser ? editEntry.user_id : (profile?.id || null));
        const total = editEntry.hours;
        const d = Math.floor(total / 8);
        const h = Math.round(total % 8);
        setDays(d > 0 ? String(d) : '');
        setHours(h > 0 ? String(h) : '');
        setNotes(editEntry.notes || '');
        setLoggedAt(editEntry.logged_at ? editEntry.logged_at.split('T')[0] : '');
      } else {
        setCategory('it');
        setUserId(profile?.id || null);
        setDays('');
        setHours('');
        setNotes('');
        setLoggedAt(new Date().toISOString().split('T')[0]);
      }
      setError(null);
    }
  }, [open, editEntry, profile?.id, canAssignUser]);

  const totalHours = daysNum * 8 + hoursNum;
  const canSubmit = totalHours >= 1 && !!(canAssignUser ? userId : profile?.id) && !!loggedAt;

  const handleSubmit = async () => {
    if (totalHours < 1) {
      setError(t('portfolio:dialogs.logTime.validation.minimumOneHour'));
      return;
    }
    const effectiveUserId = canAssignUser ? userId : (profile?.id || null);

    if (!effectiveUserId) {
      setError(t('portfolio:dialogs.logTime.validation.personRequired'));
      return;
    }
    if (!loggedAt) {
      setError(t('portfolio:dialogs.logTime.validation.dateRequired'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const endpoint = projectId
        ? `/portfolio/projects/${projectId}/tasks/${taskId}/time-entries`
        : `/tasks/${taskId}/time-entries`;

      if (isEdit && editEntry) {
        await api.patch(`${endpoint}/${editEntry.id}`, {
          category,
          user_id: effectiveUserId,
          hours: totalHours,
          notes: notes.trim() || null,
          logged_at: loggedAt,
        });
      } else {
        await api.post(endpoint, {
          category,
          user_id: effectiveUserId,
          hours: totalHours,
          notes: notes.trim() || null,
          logged_at: loggedAt,
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

  const fieldSx = drawerFieldValueSx;

  return (
    <KanapDialog
      open={open}
      onClose={handleClose}
      title={isEdit
        ? t('portfolio:dialogs.logTime.title.edit')
        : t('portfolio:dialogs.logTime.title.create')}
      onSave={handleSubmit}
      saveLabel={isEdit
        ? t('common:buttons.saveChanges')
        : t('portfolio:dialogs.logTime.actions.logTime')}
      saveDisabled={saving || !canSubmit}
      saveLoading={saving}
      cancelLabel={t('common:buttons.cancel')}
    >
      <Stack spacing={2.25}>
        {infoMessage && <Alert severity="info">{infoMessage}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}

        <PropertyRow label={t('portfolio:dialogs.logTime.fields.category')}>
          <Tabs
            value={category}
            onChange={(_, v) => setCategory(v as TimeEntryCategory)}
            sx={textTabsSx}
          >
            {CATEGORIES.map((c) => (
              <Tab
                key={c}
                value={c}
                disableRipple
                label={t(`portfolio:dialogs.logTime.categories.${c}`)}
                sx={[textTabSx(category === c), { mr: 2.5 }]}
              />
            ))}
          </Tabs>
        </PropertyRow>

        <PropertyRow label={t('portfolio:dialogs.logTime.fields.person')} required>
          <UserSelect
            hideLabel
            label={t('portfolio:dialogs.logTime.fields.person')}
            value={userId}
            onChange={setUserId}
            placeholder={t('portfolio:dialogs.logTime.placeholders.searchUsers')}
            required
            disabled={!canAssignUser}
            textFieldSx={fieldSx}
          />
        </PropertyRow>

        <PropertyRow label={t('portfolio:dialogs.logTime.fields.date')} required>
          <DateEUField
            label=""
            hideLabel
            valueYmd={loggedAt}
            onChangeYmd={setLoggedAt}
            required
            textFieldSx={fieldSx}
          />
        </PropertyRow>

        <PropertyRow
          label={t('portfolio:dialogs.logTime.fields.duration')}
          helperText={t('portfolio:dialogs.logTime.helper.total', {
            hours: totalHours,
            md: (totalHours / 8).toFixed(2),
          })}
        >
          <Stack spacing={1.25}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Slider
                min={0}
                max={MAX_HOURS}
                step={1}
                value={hoursNum}
                onChange={(_, v) => setHours(String(Array.isArray(v) ? v[0] : v))}
                aria-label={t('portfolio:dialogs.logTime.fields.hours')}
                sx={(theme) => ({
                  flex: 1,
                  height: 4,
                  py: '10px',
                  '& .MuiSlider-rail': { bgcolor: theme.palette.kanap.sliderTrack, opacity: 1 },
                  '& .MuiSlider-track': { bgcolor: theme.palette.kanap.teal, border: 'none' },
                  '& .MuiSlider-thumb': {
                    bgcolor: theme.palette.kanap.teal,
                    width: 14,
                    height: 14,
                    '&:hover, &.Mui-focusVisible': { boxShadow: 'none' },
                  },
                  color: theme.palette.kanap.teal,
                })}
              />
              <Typography
                sx={{
                  fontFamily: MONO_FONT_FAMILY,
                  fontSize: 13,
                  minWidth: 30,
                  textAlign: 'right',
                  color: 'kanap.text.primary',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {hoursNum}h
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                {t('portfolio:dialogs.logTime.fields.days')}
              </Typography>
              <TextField
                variant="standard"
                value={days}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '' || /^\d+$/.test(raw)) setDays(raw);
                }}
                inputProps={{ inputMode: 'numeric', style: { textAlign: 'center' } }}
                sx={[drawerFieldValueSx, { width: 56 }]}
              />
            </Box>
          </Stack>
        </PropertyRow>

        <PropertyRow label={t('portfolio:dialogs.logTime.fields.notes')}>
          <TextField
            variant="standard"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
            placeholder={t('portfolio:dialogs.logTime.placeholders.notes')}
            fullWidth
            sx={fieldSx}
          />
        </PropertyRow>
      </Stack>
    </KanapDialog>
  );
}
