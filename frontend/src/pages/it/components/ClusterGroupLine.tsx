import React from 'react';
import { Box, Button } from '@mui/material';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';

type Props = {
  /** The text of the line: "CheeseTrack (prod, db) on PAR-SQL-01, PAR-SQL-02". */
  text: string;
  /** The action's label. */
  actionLabel: string;
  onAssign: () => void;
  disabled?: boolean;
};

/** A7: one set of direct assignments that could move to their cluster. A compact line, no alert. */
export default function ClusterGroupLine({ text, actionLabel, onAssign, disabled }: Props) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, py: '2px' }}>
      <HubOutlinedIcon aria-hidden sx={{ fontSize: 14, color: 'kanap.text.tertiary', flexShrink: 0 }} />
      <Box sx={(theme) => ({ flex: 1, minWidth: 0, fontSize: 12, color: theme.palette.kanap.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })} title={text}>
        {text}
      </Box>
      <Button variant="action" size="small" onClick={onAssign} disabled={disabled}>
        {actionLabel}
      </Button>
    </Box>
  );
}
