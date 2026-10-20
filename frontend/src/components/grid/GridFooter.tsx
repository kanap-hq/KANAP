import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

/** One line of the footer, and the gap the grid leaves above it. */
export const GRID_FOOTER_LINE_HEIGHT = 20;
export const GRID_FOOTER_GAP = 8;

/**
 * The line under a grid. It grows with its text, so a long totals note wraps instead of being
 * clipped, and it never grows a horizontal scrollbar. `onHeight` reports the height the grid
 * subtracts from its own.
 */
export default function GridFooter({ children, onHeight }: { children: React.ReactNode; onHeight: (height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const publish = () => {
      const next = Math.max(GRID_FOOTER_LINE_HEIGHT, Math.ceil(node.getBoundingClientRect().height));
      onHeight(next);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children, onHeight]);
  return (
    <Box
      ref={ref}
      data-grid-footer
      sx={{
        mt: `${GRID_FOOTER_GAP}px`,
        minHeight: GRID_FOOTER_LINE_HEIGHT,
        minWidth: 0,
        maxWidth: '100%',
        overflowX: 'hidden',
      }}
    >
      {children}
    </Box>
  );
}
