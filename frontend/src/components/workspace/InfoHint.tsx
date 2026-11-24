import React from 'react';
import { Tooltip, type TooltipProps } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

/**
 * An information icon beside a title. `text` is both the tooltip and the accessible name.
 * A newline starts a new line in the tooltip. `placement`: where the tooltip opens (below by
 * default); beside the icon, it opens above when the side lacks room.
 */
export default function InfoHint({ text, placement }: { text: string; placement?: TooltipProps['placement'] }) {
  const beside = placement === 'right' || placement === 'left';
  return (
    <Tooltip
      title={text}
      placement={placement}
      slotProps={{
        tooltip: { sx: { whiteSpace: 'pre-line' } },
        ...(beside ? { popper: { modifiers: [{ name: 'flip', options: { fallbackPlacements: ['top'] } }] } } : {}),
      }}
    >
      <InfoOutlinedIcon tabIndex={0} role="img" aria-hidden={false} aria-label={text} sx={{ fontSize: 13, color: 'kanap.text.tertiary', alignSelf: 'center' }} />
    </Tooltip>
  );
}
