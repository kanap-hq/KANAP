import { IconButton, Tooltip } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

/** A one-sentence help behind a small question mark, next to a label. */
export function HelpTip({ label, help }: { label: string; help: string }) {
  return <Tooltip title={help} enterTouchDelay={0}><IconButton size="small" aria-label={label} sx={{ p: 0.25 }}><HelpOutlineIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>;
}
