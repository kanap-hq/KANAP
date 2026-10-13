import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, IconButton } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { taskDetailTokens } from '../theme/taskDetailTokens';

interface TaskNavChipProps {
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export default function TaskNavChip({ currentIndex, totalCount, onPrev, onNext, hasPrev, hasNext }: TaskNavChipProps) {
  const { t } = useTranslation('common');
  if (totalCount <= 0) return null;

  const navButtonSx = (theme: Theme) => ({
    p: 0,
    width: 24,
    height: 24,
    minWidth: 24,
    borderRadius: '4px',
    color: theme.palette.kanap.navChip.fg,
    fontSize: '14px',
    lineHeight: 1,
    '&:hover': {
      bgcolor: theme.palette.kanap.tab.bgHover,
    },
    '&.Mui-disabled': {
      opacity: 0.35,
    },
  });

  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        py: '2px',
        px: '4px',
        borderRadius: taskDetailTokens.borderRadius.pill,
        bgcolor: theme.palette.kanap.navChip.bg,
        border: `1px solid ${theme.palette.kanap.navChip.border}`,
      })}
    >
      <IconButton
        onClick={onPrev}
        disabled={!hasPrev}
        aria-label="Previous task"
        sx={navButtonSx}
        size="small"
      >
        ‹
      </IconButton>
      <Box
        component="span"
        sx={(theme) => ({
          fontFamily: MONO_FONT_FAMILY,
          fontSize: '11px',
          fontWeight: 500,
          color: theme.palette.kanap.navChip.fg,
          userSelect: 'none',
        })}
      >
        {t('labels.positionOf', { index: currentIndex, total: totalCount })}
      </Box>
      <IconButton
        onClick={onNext}
        disabled={!hasNext}
        aria-label="Next task"
        sx={navButtonSx}
        size="small"
      >
        ›
      </IconButton>
    </Box>
  );
}
