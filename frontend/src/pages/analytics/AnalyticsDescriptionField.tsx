import React from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { longFormSurfaceFieldSx } from '../../theme/formSx';
import { useFieldDraft } from '../../hooks/useFieldDraft';

/** The workspace description of a dimension or a value, saved when the field loses focus. */
export default function AnalyticsDescriptionField({
  value,
  disabled,
  error,
  placeholder,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  error?: string;
  placeholder: string;
  onCommit: (next: string | null) => void;
}) {
  const { t } = useTranslation(['master-data']);
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 }}>
        {t('analytics.fields.description')}
      </Typography>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          const next = draft.trim();
          if (next !== value.trim()) onCommit(next || null);
        }}
        multiline
        minRows={3}
        variant="standard"
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': t('analytics.fields.description') }}
      />
    </Box>
  );
}
