import React from 'react';
import { Box, Paper, Stack, Tooltip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export type ChipToggleItem = {
  id: string;
  label: React.ReactNode;
  tooltip?: React.ReactNode;
  /** Accessible name when the visible label alone would read badly. */
  ariaLabel?: string;
};

type Props = {
  items: ChipToggleItem[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Accessible name of the toggle group. */
  ariaLabel: string;
  /** Small buttons on the right of the band. */
  actions?: React.ReactNode;
  sx?: SxProps<Theme>;
};

/** A grey band of square toggles (the selected one filled), scrolling sideways, with actions on the right. */
export default function ChipToggleBar({ items, selectedId, onSelect, ariaLabel, actions, sx }: Props) {
  return (
    <Paper
      variant="outlined"
      sx={[
        {
          p: 1.25,
          borderColor: 'divider',
          bgcolor: (theme) => (theme.palette.mode === 'light' ? theme.palette.grey[100] : 'rgba(255, 255, 255, 0.06)'),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
        <Box
          role="group"
          aria-label={ariaLabel}
          sx={{
            display: 'flex',
            gap: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            py: 0.5,
            flex: 1,
            minWidth: 0,
          }}
        >
          {items.map((item) => {
            const isSelected = selectedId === item.id;
            const toggle = (
              <Box
                key={item.id}
                component="button"
                type="button"
                aria-pressed={isSelected}
                aria-label={item.ariaLabel}
                onClick={() => onSelect(item.id)}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: isSelected ? 'primary.main' : 'divider',
                  bgcolor: isSelected ? 'primary.main' : 'transparent',
                  color: isSelected ? 'primary.contrastText' : 'text.primary',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  maxWidth: 260,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                {item.label}
              </Box>
            );
            return item.tooltip ? <Tooltip key={item.id} title={item.tooltip}>{toggle}</Tooltip> : toggle;
          })}
        </Box>

        {actions && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
