import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { LINE_TYPES, lineTypeUsageLabel, parseLineTypeUsage, type LineType } from '../../constants/lineTypeUsage';
import { attentionDotSx, drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';

/**
 * "Used for": OPEX and CAPEX lines (stored as null), OPEX lines only or CAPEX lines only. Shared by
 * accounts, analytics dimensions and their values. `label` names the select for assistive
 * technology; the visible label is the surrounding `PropertyRow`'s. `excluded` greys out the
 * choice of one type (a value under a dimension restricted to the other type); the other choices,
 * a stored excluded one included, stay as they are.
 */
export default function LineTypeUsageSelect({
  value,
  label,
  disabled,
  excluded,
  error,
  onChange,
}: {
  value: LineType | null;
  label: string;
  disabled?: boolean;
  excluded?: LineType | null;
  error?: string;
  onChange: (next: LineType | null) => void;
}) {
  const { t } = useTranslation(['master-data']);
  return (
    <Box>
      <Select
        variant="standard"
        value={value ?? ''}
        onChange={(event) => onChange(parseLineTypeUsage(event.target.value))}
        // The empty value is a real choice (OPEX and CAPEX): shown, never a placeholder.
        displayEmpty
        disabled={disabled}
        error={!!error}
        sx={drawerSelectSx}
        SelectDisplayProps={{ 'aria-label': label } as React.HTMLAttributes<HTMLDivElement>}
        renderValue={(selected) => lineTypeUsageLabel(t, selected)}
      >
        {[null, ...LINE_TYPES].map((usage) => (
          <MenuItem key={usage ?? 'both'} value={usage ?? ''} disabled={!!excluded && usage === excluded} sx={drawerMenuItemSx}>
            {lineTypeUsageLabel(t, usage)}
          </MenuItem>
        ))}
      </Select>
      {error && (
        <Typography role="alert" sx={{ mt: '3px', fontSize: 12, lineHeight: 1.35, color: 'error.main' }}>{error}</Typography>
      )}
    </Box>
  );
}

/**
 * One line under a "Used for" select, in the attention tone: lines of the other type still hold the
 * record. The caller writes the sentence (and any link) as children.
 */
export function LineTypeUsageConflictNote({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <Box
      data-testid={testId}
      sx={{ fontSize: 12, lineHeight: 1.45, mt: '6px', display: 'flex', alignItems: 'baseline', gap: '8px', color: 'kanap.text.secondary' }}
    >
      <Box component="span" sx={{ ...attentionDotSx, position: 'relative', top: '-1px' }} />
      <span>{children}</span>
    </Box>
  );
}
