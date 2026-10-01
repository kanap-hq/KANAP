import React from 'react';
import { Box, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Incident } from '../../../api/endpoints/incidents';
import IntegratedDocumentEditor, {
  type IntegratedDocumentEditorHandle,
  type IntegratedDocumentSaveStatus,
} from '../../../components/IntegratedDocumentEditor';
import { incidentComposerSx, incidentSectionLabelSx } from './incidentWorkspace';

type Props = {
  incident: Incident;
  readOnly: boolean;
  lockedBanner: string | null;
  /** Saving/Saved hint of the short description autosave. */
  savingHint: string | null;
  /** Saving/Saved hint of the incident review document. */
  reviewHint: string | null;
  reviewEditorRef: React.RefObject<IntegratedDocumentEditorHandle>;
  onReviewSaveStateChange: (status: IntegratedDocumentSaveStatus, error: string | null) => void;
  onPatchDebounced: (patch: Partial<Incident>) => void;
  /**
   * Bumped by the page when it reloaded the incident after a refused save or a
   * discard: the description shows the incident's value again (the stored one,
   * or the text still waiting to be saved).
   */
  descriptionResync?: number;
};

function SectionLabel({ label, hint }: { label: string; hint: string | null }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Typography component="label" sx={incidentSectionLabelSx}>{label}</Typography>
      {hint && <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{hint}</Typography>}
    </Box>
  );
}

export default function IncidentOverviewTab({
  incident,
  readOnly,
  lockedBanner,
  savingHint,
  reviewHint,
  reviewEditorRef,
  onReviewSaveStateChange,
  onPatchDebounced,
  descriptionResync = 0,
}: Props) {
  const { t } = useTranslation('it');
  const [description, setDescription] = React.useState(incident.description || '');
  const incidentDescription = incident.description || '';
  React.useEffect(() => {
    if (descriptionResync) setDescription(incidentDescription);
    // Only on a resync request: the field keeps what the user types otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptionResync]);

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    onPatchDebounced({ description: value.trim().length > 0 ? value : null });
  };

  return (
    <Stack spacing={3} sx={{ pt: 1, maxWidth: 900 }}>
      {lockedBanner && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{lockedBanner}</Typography>
      )}

      <Box>
        <SectionLabel label={t('workspace.incident.overview.description')} hint={savingHint} />
        <TextField
          value={description}
          onChange={(event) => handleDescriptionChange(event.target.value)}
          multiline
          minRows={2}
          maxRows={4}
          fullWidth
          variant="standard"
          placeholder={readOnly
            ? t('workspace.incident.drawer.notSet')
            : t('workspace.incident.overview.descriptionPlaceholder')}
          InputProps={{ readOnly }}
          sx={incidentComposerSx}
        />
      </Box>

      <Box>
        <SectionLabel label={t('workspace.incident.overview.review')} hint={reviewHint} />
        <IntegratedDocumentEditor
          ref={reviewEditorRef}
          entityType="incidents"
          entityId={incident.id}
          slotKey="review"
          label={t('workspace.incident.overview.review')}
          hideHeaderLabel
          showManagedDocChip={false}
          showDocumentControls={false}
          editModeBehavior="auto"
          autosaveEnabled
          surface
          hideToolbarUntilFocus
          disabled={readOnly}
          minRows={10}
          placeholder={t('workspace.incident.overview.reviewPlaceholder')}
          onSaveStateChange={onReviewSaveStateChange}
        />
      </Box>
    </Stack>
  );
}
