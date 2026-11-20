import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type FieldLabelProps = {
  children: React.ReactNode;
  required?: boolean;
  /** The field lacks a value a check asked for: the label turns red, the one signal of a missing field. */
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
    <Box component="span" sx={{ color: 'warning.main', ml: 0.25 }}>
      *
    </Box>
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
          color: missing ? theme.palette.error.main : theme.palette.kanap.text.tertiary,
        }),
        sx,
      )}
    >
      {children}
      {required && <RequiredMark />}
    </Box>
  );
}
