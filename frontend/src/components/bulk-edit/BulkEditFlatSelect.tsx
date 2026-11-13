import React from 'react';
import { MenuItem, TextField } from '@mui/material';
import { reportFilterMenuProps } from '../reports/ReportLayout';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';

/** A plain select of the "Change the selection" dialog (run or build, a dimension, a lifecycle): flat items, the drawer's look. */
export default function BulkEditFlatSelect({ value, onChange, label, disabled, options }: {
  value: string | null;
  onChange: (next: string | null) => void;
  label: string;
  disabled: boolean;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <TextField
      select
      variant="standard"
      fullWidth
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': label } }}
      sx={drawerSelectSx}
      disabled={disabled}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>{option.label}</MenuItem>
      ))}
    </TextField>
  );
}
