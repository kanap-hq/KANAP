import React from 'react';
import { Tooltip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

/** An information icon beside a title: one sentence in a tooltip, in place of a help line. */
export default function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <InfoOutlinedIcon tabIndex={0} role="img" aria-hidden={false} aria-label={text} sx={{ fontSize: 13, color: 'kanap.text.tertiary', alignSelf: 'center' }} />
    </Tooltip>
  );
}
