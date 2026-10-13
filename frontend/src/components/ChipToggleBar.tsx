import React from 'react';
import { Box, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export type ChipToggleItem = {
  id: string;
  label: React.ReactNode;
  tooltip?: React.ReactNode;
  /** Accessible name when the visible label alone would read badly. */
  ariaLabel?: string;
  /** Drop target handlers, for items that accept something dragged onto them. */
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
  /** Marks the item as the drop target under the pointer. */
  highlighted?: boolean;
};

/** A toggle's height on one line (16px text, 4px padding, 1px border, top and bottom). */
const TOGGLE_HEIGHT = 26;

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

/**
 * A grey band of square toggles (the selected one filled), each showing its full name, wrapping onto
 * as many rows as needed, with the actions on the right of the first row (on their own row when the
 * band is too narrow for both).
 */
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
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 1, rowGap: 0.5, width: '100%' }}>
        <Box
          role="group"
          aria-label={ariaLabel}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            py: 0.5,
            // Takes what the actions leave; below about two toggles wide, the actions move to a row of their own.
            flex: '1 1 0%',
            minWidth: 'min(100%, 240px)',
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
                onDragOver={item.onDragOver}
                onDragLeave={item.onDragLeave}
                onDrop={item.onDrop}
                data-highlighted={item.highlighted ? 'true' : undefined}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  // On a very narrow band, a mark after the name (CAPEX only) goes under it, not into it.
                  flexWrap: 'wrap',
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1,
                  border: '1px solid',
                  // A drop target under the pointer reads like a hovered toggle, with a light fill.
                  borderColor: isSelected || item.highlighted ? 'primary.main' : 'divider',
                  bgcolor: isSelected ? 'primary.main' : item.highlighted ? 'action.hover' : 'transparent',
                  color: isSelected ? 'primary.contrastText' : 'text.primary',
                  minHeight: TOGGLE_HEIGHT,
                  fontSize: '0.8125rem',
                  lineHeight: '16px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  // The full name, always: a name wider than the band wraps inside its toggle.
                  flexShrink: 0,
                  maxWidth: '100%',
                  textAlign: 'left',
                  overflowWrap: 'break-word',
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
          <Box
            data-testid="chip-toggle-bar-actions"
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              // As tall as the first row of toggles (toggle and the group's padding), so the actions centre on it.
              minHeight: TOGGLE_HEIGHT + 8,
              ml: 'auto',
              flexShrink: 0,
              maxWidth: '100%',
            }}
          >
            {actions}
          </Box>
        )}
      </Box>
    </Paper>
  );
}

/**
 * The line under the band about the selected toggle: its title (name and count) with the actions on
 * its items on the right, and optional lines under it.
 */
export function ChipToggleContextLine({
  title,
  actions,
  children,
  testId,
  sx,
}: {
  title?: React.ReactNode;
  /** Actions on the items listed below, aligned with the title. */
  actions?: React.ReactNode;
  /** Secondary lines under the title. */
  children?: React.ReactNode;
  testId?: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box data-testid={testId} sx={sx}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 1, minHeight: 32 }}>
        <Typography
          component="div"
          sx={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'kanap.text.primary' }}
        >
          {title}
        </Typography>
        {actions && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
            {actions}
          </Stack>
        )}
      </Box>
      {children && <Stack spacing={0.5} sx={{ mt: 0.5 }}>{children}</Stack>}
    </Box>
  );
}
