import React from 'react';
import { Box } from '@mui/material';

/**
 * The metadata bar of a record while what it shows is still on its way (the record, or the
 * vulnerabilities behind its severe badge): the bar keeps its line, hidden, and appears in one go
 * once everything has arrived.
 */
export default function PendingMetadata({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  if (!pending) return <>{children}</>;
  return (
    <Box component="span" aria-hidden data-testid="metadata-pending" sx={{ display: 'contents', visibility: 'hidden' }}>
      {children}
    </Box>
  );
}
