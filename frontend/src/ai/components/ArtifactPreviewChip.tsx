import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { AiMutationPreview } from '../aiTypes';
import { getDotColor, getPillBg } from '../../utils/statusColors';
import { getPreviewLabel } from '../utils/previewClassification';
import { getPreviewStatusColorKey, getPreviewStatusDisplay } from '../utils/previewStatus';

type ArtifactPreviewChipProps = {
  preview: AiMutationPreview;
  active?: boolean;
  onOpen: (previewId: string) => void;
};

export default function ArtifactPreviewChip({ preview, active, onOpen }: ArtifactPreviewChipProps) {
  const { t } = useTranslation(['ai']);
  const mode = useTheme().palette.mode;
  // The status as the preview card words it.
  const statusDisplay = getPreviewStatusDisplay(preview);
  const status = getPreviewStatusColorKey(statusDisplay);
  const label = getPreviewLabel(preview);

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => onOpen(preview.preview_id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(preview.preview_id);
        }
      }}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 0.75,
        borderRadius: '8px',
        border: `1px solid ${active ? theme.palette.primary.main : theme.palette.kanap.border.default}`,
        bgcolor: active ? theme.palette.primary.light : theme.palette.kanap.bg.composer,
        color: theme.palette.kanap.text.primary,
        cursor: 'pointer',
        maxWidth: '100%',
        transition: 'border-color 120ms ease, background-color 120ms ease',
        '&:hover': {
          borderColor: theme.palette.primary.main,
          bgcolor: theme.palette.primary.light,
        },
        '&:focus-visible': {
          outline: 'none',
          boxShadow: `0 0 0 2px ${theme.palette.primary.main}`,
        },
      })}
    >
      <DescriptionOutlinedIcon sx={{ fontSize: 16, color: 'kanap.text.secondary', flexShrink: 0 }} />
      <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          component="span"
          sx={{
            fontSize: 11,
            fontWeight: 500,
            color: 'kanap.text.secondary',
            letterSpacing: 0.2,
          }}
        >
          {t('artifactPanel.chipLabel')}
        </Typography>
        <Typography
          component="span"
          sx={{
            fontSize: 13,
            fontWeight: 500,
            color: 'kanap.text.primary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Typography>
      </Stack>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          px: 0.875,
          py: 0.125,
          borderRadius: '9999px',
          bgcolor: getPillBg(status, mode),
          color: getDotColor(status, mode),
          fontSize: 11,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {t(`ai:previewStatuses.${statusDisplay}`)}
      </Box>
    </Box>
  );
}
