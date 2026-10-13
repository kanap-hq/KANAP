import React from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { getDecisionOutcomeOptions } from '../../../utils/portfolioI18n';

const MarkdownEditor = React.lazy(() => import('../../../components/MarkdownEditor'));

interface RecommendationDialogProps {
  open: boolean;
  currentStatus: string;
  allowedTransitions: string[];
  statusOptions: Array<{ value: string; label: string }>;
  priorityScore?: number | null;
  onClose: () => void;
  onSubmit: (data: {
    content: string;
    context: string | null;
    is_decision: boolean;
    decision_outcome?: string;
    new_status?: string;
  }) => Promise<void>;
  onImageUpload?: (file: File, sourceField: string) => Promise<string>;
  onImageUrlImport?: (sourceUrl: string, sourceField: string) => Promise<string>;
}

export default function RecommendationDialog({
  open,
  currentStatus,
  allowedTransitions,
  statusOptions,
  priorityScore = null,
  onClose,
  onSubmit,
  onImageUpload,
  onImageUrlImport,
}: RecommendationDialogProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const [decisionOutcome, setDecisionOutcome] = React.useState('');
  const [newStatus, setNewStatus] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editorKey, setEditorKey] = React.useState(0);
  const analysisRecommendationContext = t('portfolio:dialogs.recommendation.contextValue');
  const decisionOutcomes = React.useMemo(() => getDecisionOutcomeOptions(t), [t]);

  React.useEffect(() => {
    if (!open) return;
    setDecisionOutcome('');
    setNewStatus('');
    setRationale('');
    setError(null);
    setEditorKey((k) => k + 1);
  }, [open]);

  const handleImageUpload = async (file: File): Promise<string> => {
    if (!onImageUpload) {
      throw new Error(t('portfolio:activity.messages.imageUploadNotConfigured'));
    }
    return onImageUpload(file, 'content');
  };

  const handleImageUrlImport = async (sourceUrl: string): Promise<string> => {
    if (!onImageUrlImport) {
      throw new Error(t('portfolio:activity.messages.imageImportNotConfigured'));
    }
    return onImageUrlImport(sourceUrl, 'content');
  };

  const handleSubmit = async () => {
    if (!decisionOutcome) {
      setError(t('portfolio:dialogs.recommendation.validation.outcomeRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        content: rationale.trim(),
        context: analysisRecommendationContext,
        is_decision: true,
        decision_outcome: decisionOutcome,
        new_status: newStatus || undefined,
      });
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:dialogs.recommendation.messages.submitFailed'),
      ));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
      disableEnforceFocus
      PaperProps={{ sx: { overflow: 'visible' } }}
    >
      <DialogTitle>{t('portfolio:dialogs.recommendation.title')}</DialogTitle>
      <DialogContent sx={{ overflow: 'visible' }}>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {priorityScore != null && (
            <Alert severity="info">
              {t('portfolio:dialogs.recommendation.prioritySnapshot', {
                score: Math.round(priorityScore),
              })}
            </Alert>
          )}

          {!!error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('portfolio:dialogs.recommendation.fields.context')}
            value={analysisRecommendationContext}
            fullWidth
            size="small"
            disabled
          />

          <Stack direction="row" spacing={2}>
            <FormControl size="small" fullWidth required>
              <InputLabel>{t('portfolio:dialogs.recommendation.fields.decisionOutcome')}</InputLabel>
              <Select
                value={decisionOutcome}
                label={t('portfolio:dialogs.recommendation.fields.decisionOutcome')}
                onChange={(e) => setDecisionOutcome(e.target.value)}
                disabled={submitting}
              >
                {decisionOutcomes.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('portfolio:dialogs.recommendation.fields.changeStatus')}</InputLabel>
              <Select
                value={newStatus}
                label={t('portfolio:dialogs.recommendation.fields.changeStatus')}
                onChange={(e) => setNewStatus(e.target.value)}
                disabled={submitting}
              >
                <MenuItem value="">
                  {t('portfolio:activity.form.noChange')}
                </MenuItem>
                {allowedTransitions.map((status) => (
                  <MenuItem key={status} value={status}>
                    {statusOptions.find((s) => s.value === status)?.label || status}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t('portfolio:dialogs.recommendation.fields.rationale')}
            </Typography>
            <React.Suspense fallback={<Box sx={{ minHeight: 10 * 24, border: 1, borderColor: 'divider', borderRadius: 1 }} />}>
              <MarkdownEditor
                key={editorKey}
                value={rationale}
                onChange={setRationale}
                placeholder={t('portfolio:dialogs.recommendation.placeholders.rationale')}
                minRows={10}
                maxRows={18}
                disabled={submitting}
                onModSave={() => { void handleSubmit(); }}
                onImageUpload={onImageUpload ? handleImageUpload : undefined}
                onImageUrlImport={onImageUrlImport ? handleImageUrlImport : undefined}
              />
            </React.Suspense>
          </Box>

          <Typography variant="caption" color="text.secondary">
            {t('portfolio:dialogs.recommendation.currentStatus', {
              status: statusOptions.find((s) => s.value === currentStatus)?.label || currentStatus,
            })}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose} disabled={submitting}>{t('common:buttons.cancel')}</Button>
        <Button variant="action-primary" onClick={handleSubmit} disabled={submitting || !decisionOutcome}>
          {t('portfolio:dialogs.recommendation.actions.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
