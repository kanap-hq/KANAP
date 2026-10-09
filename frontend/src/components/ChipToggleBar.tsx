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
                onDragOver={item.onDragOver}
                onDragLeave={item.onDragLeave}
                onDrop={item.onDrop}
                data-highlighted={item.highlighted ? 'true' : undefined}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1,
                  border: '1px solid',
                  // A drop target under the pointer reads like a hovered toggle, with a light fill.
                  borderColor: isSelected || item.highlighted ? 'primary.main' : 'divider',
                  bgcolor: isSelected ? 'primary.main' : item.highlighted ? 'action.hover' : 'transparent',
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
