import React from 'react';
import { Tooltip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

/**
 * An information icon beside a title. `text` is both the tooltip and the accessible name.
 * A newline starts a new line in the tooltip.
 */
export default function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip title={text} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
      <InfoOutlinedIcon tabIndex={0} role="img" aria-hidden={false} aria-label={text} sx={{ fontSize: 13, color: 'kanap.text.tertiary', alignSelf: 'center' }} />
    </Tooltip>
  );
}
