import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
  children: React.ReactNode;
  /** Layout of the wrapper, for a preview inside a flex row (the metadata bar). */
  sx?: SxProps<Theme>;
};

/**
 * What a record created at its title will look like, under the title still to give: its page
 * built from an empty draft, dimmed and out of reach (no pointer, no keyboard, no screen reader)
 * until the title creates the record and the real page takes its place, in the same layout.
 * Nothing in it says so: the blue title is the cue. The children must not read or write
 * anything that needs a record id.
 */
export default function CreationPreview({ children, sx }: Props) {
  // `inert` takes the subtree out of the focus and accessibility order (React 18 passes the
  // attribute through as a string); `aria-hidden` and `pointer-events` cover what lacks it.
  const inertProps = { inert: '' } as React.HTMLAttributes<HTMLDivElement>;
  return (
    <Box
      data-testid="creation-preview"
      aria-hidden="true"
      {...inertProps}
      sx={[{ opacity: 0.45, pointerEvents: 'none', userSelect: 'none' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  );
}
