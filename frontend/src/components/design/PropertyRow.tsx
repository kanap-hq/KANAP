import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { drawerFieldValueSx } from '../../theme/formSx';
import { FieldLabel } from './FieldLabel';
import { MissingDescription, useInvalidControls } from './invalidControls';
import InfoHint from '../workspace/InfoHint';

type PropertyRowProps = {
  children: React.ReactNode;
  helperText?: React.ReactNode;
  /** One sentence the person reads once, in a tooltip beside the label, in place of a help line. */
  hint?: string;
  label: React.ReactNode;
  labelSx?: SxProps<Theme>;
  /**
   * A check found the field missing (Create on a record being created): its label turns red with an alert icon after it and its
   * control says `aria-invalid`, described by "Missing". The page drops it once the field holds a value.
   */
  missing?: boolean;
  required?: boolean;
  sx?: SxProps<Theme>;
  valueSx?: SxProps<Theme>;
};

type PropertyGroupProps = {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
};

function mergeSx(...items: Array<SxProps<Theme> | undefined>): SxProps<Theme> {
  return items.flatMap((sx) => {
    if (!sx) return [];
    return Array.isArray(sx) ? sx : [sx];
  }) as SxProps<Theme>;
}

export function PropertyRow({
  children,
  helperText,
  hint,
  label,
  labelSx,
  missing = false,
  required = false,
  sx,
  valueSx,
}: PropertyRowProps) {
  const valueRef = React.useRef<HTMLDivElement | null>(null);
  const descriptionId = React.useId();
  useInvalidControls(valueRef, missing, descriptionId);
  return (
    <Box
      // A new record's Tab goes from its title through the required rows (`PortfolioDetailWorkspaceShell`).
      data-required-field={required ? '' : undefined}
      sx={mergeSx(
        {
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          py: '5px',
        },
        sx,
      )}
    >
      {hint ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FieldLabel required={required} missing={missing} sx={labelSx}>
            {label}
          </FieldLabel>
          <InfoHint text={hint} />
        </Box>
      ) : (
        <FieldLabel required={required} missing={missing} sx={labelSx}>
          {label}
        </FieldLabel>
      )}
      <Box
        ref={valueRef}
        sx={mergeSx(
          drawerFieldValueSx,
          // Bordered fields must not stretch across a wide content tab. 480px
          // matches the KanapDialog paper, so dialogs and drawers are unaffected.
          (theme) => ({ color: theme.palette.kanap.text.primary, maxWidth: 480 }),
          valueSx,
        )}
      >
        {children}
      </Box>
      {missing ? <MissingDescription id={descriptionId} /> : null}
      {helperText ? (
        <Box
          sx={(theme) => ({
            mt: '1px',
            fontSize: 12,
            lineHeight: 1.35,
            color: theme.palette.kanap.text.tertiary,
          })}
        >
          {helperText}
        </Box>
      ) : null}
    </Box>
  );
}

export function PropertyGroup({ children, sx }: PropertyGroupProps) {
  return (
    <Box
      sx={mergeSx(
        (theme) => ({
          padding: '6px 18px 8px',
          '& + &': {
            borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
            marginTop: '6px',
            paddingTop: '10px',
          },
        }),
        sx,
      )}
    >
      {children}
    </Box>
  );
}
