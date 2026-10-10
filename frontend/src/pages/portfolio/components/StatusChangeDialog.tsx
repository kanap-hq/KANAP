import { useCallback, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem,
  Select, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getDecisionOutcomeOptions } from '../../../utils/portfolioI18n';

interface StatusChangeDialogProps {
  open: boolean;
  currentStatus: string;
  newStatus: string;
  onConfirm: (options: {
    isDecision: boolean;
    outcome?: string;
    context?: string;
    rationale?: string;
  }) => void;
  onCancel: () => void;
}

const formatStatus = (status: string) =>
  status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function StatusChangeDialog({
  open,
  currentStatus,
  newStatus,
  onConfirm,
  onCancel,
}: StatusChangeDialogProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [isDecision, setIsDecision] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [context, setContext] = useState('');
  const [rationale, setRationale] = useState('');
  const decisionOutcomes = getDecisionOutcomeOptions(t);

  const formatStatusLabel = (status: string) => t(`portfolio:statuses.project.${status}`, {
    defaultValue: t(`portfolio:statuses.request.${status}`, {
      defaultValue: formatStatus(status),
    }),
  });

  const handleConfirm = useCallback(() => {
    onConfirm({
      isDecision,
      outcome: isDecision && outcome ? outcome : undefined,
      context: isDecision ? context : undefined,
      rationale: isDecision ? rationale : undefined,
    });
    // Reset state after confirm
    setIsDecision(false);
    setOutcome('');
    setContext('');
    setRationale('');
  }, [isDecision, outcome, context, rationale, onConfirm]);

  const handleCancel = useCallback(() => {
    // Reset state on cancel
    setIsDecision(false);
    setOutcome('');
    setContext('');
    setRationale('');
    onCancel();
  }, [onCancel]);

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{t('portfolio:dialogs.statusChange.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="info">
            {t('portfolio:dialogs.statusChange.summary', {
              currentStatus: formatStatusLabel(currentStatus),
              newStatus: formatStatusLabel(newStatus),
            })}
          </Alert>

          <FormControlLabel
            control={
              <Checkbox
                checked={isDecision}
                onChange={(e) => setIsDecision(e.target.checked)}
              />
            }
            label={t('portfolio:dialogs.statusChange.formalDecision')}
          />

          {isDecision && (
            <>
              <FormControl fullWidth required>
                <InputLabel id="decision-outcome-label">
                  {t('portfolio:dialogs.statusChange.fields.decisionOutcome')}
                </InputLabel>
                <Select
                  labelId="decision-outcome-label"
                  value={outcome}
                  label={t('portfolio:dialogs.statusChange.fields.decisionOutcome')}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  <MenuItem value="" disabled>
                    {t('portfolio:dialogs.statusChange.fields.selectOutcome')}
                  </MenuItem>
                  {decisionOutcomes.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label={t('portfolio:dialogs.statusChange.fields.meetingContext')}
                placeholder={t('portfolio:dialogs.statusChange.fields.meetingContextPlaceholder')}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                fullWidth
              />
              <TextField
                label={t('portfolio:dialogs.statusChange.fields.rationaleNotes')}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                multiline
                rows={3}
                fullWidth
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={handleCancel}>{t('common:buttons.cancel')}</Button>
        <Button variant="action-primary" onClick={handleConfirm}>
          {t('portfolio:dialogs.statusChange.actions.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
