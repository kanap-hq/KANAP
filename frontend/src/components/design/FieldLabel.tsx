import React from 'react';
import { Box, Tooltip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useTranslation } from 'react-i18next';

type FieldLabelProps = {
  children: React.ReactNode;
  required?: boolean;
  /**
   * The field lacks a value a check asked for: the label turns red and an alert icon follows it
   * (named "Missing", with a tooltip), so the signal does not rest on the colour.
   */
  missing?: boolean;
  sx?: SxProps<Theme>;
};

export function mergeSx(...items: Array<SxProps<Theme> | undefined>): SxProps<Theme> {
  return items.flatMap((sx) => {
    if (!sx) return [];
    return Array.isArray(sx) ? sx : [sx];
  }) as SxProps<Theme>;
}

/** Orange asterisk for a required field, next to its label. */
export function RequiredMark() {
  return (
    <Box component="span" data-required-mark="" sx={{ color: 'warning.main', ml: 0.25 }}>
      *
    </Box>
  );
}

/** Hides a text from the eye and keeps it for a screen reader. */
export const visuallyHiddenSx = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/** The small alert icon after the label of a missing field: the color of the label, a name and a tooltip. */
export function MissingIcon() {
  const { t } = useTranslation('common');
  const text = t('common:creation.missingMark');
  return (
    <Tooltip title={text}>
      <ErrorOutlineIcon
        data-missing-mark=""
        role="img"
        aria-hidden={false}
        aria-label={text}
        sx={{ fontSize: 13, color: 'inherit', ml: 0.5, verticalAlign: '-2px' }}
      />
    </Tooltip>
  );
}

export function FieldLabel({ children, required = false, missing = false, sx }: FieldLabelProps) {
  return (
    <Box
      className="kanap-field-label"
      data-missing={missing ? '' : undefined}
      sx={mergeSx(
        (theme) => ({
          fontSize: 12,
          lineHeight: 1.3,
          // `kanap.danger` follows the mode (a lighter red on the dark panel); `error.main` stays #DC2626 and fails 4.5:1 there.
          color: missing ? theme.palette.kanap.danger : theme.palette.kanap.text.tertiary,
        }),
        sx,
      )}
    >
      {children}
      {required && <RequiredMark />}
      {missing && <MissingIcon />}
    </Box>
  );
}
