import { Box, MenuItem, Select, Switch, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ConfigFieldSchema } from '../tiles/TileRegistry';
import { drawerMenuItemSx, inlineControlSx } from '../../../theme/formSx';

const optionValueSx = { width: 72, '& input': { fontSize: 13, py: 0.5, textAlign: 'right' } } as const;

/** One option of a tile (max items, days, scope…) rendered inline: label on the left, compact control on the right. */
export default function TileOption({ name, schema, value, onChange }: {
  name: string;
  schema: ConfigFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation('common');
  const label = t(schema.labelKey);
  let control: React.ReactNode;
  if (schema.type === 'boolean') {
    control = <Switch size="small" checked={value !== false} onChange={(event) => onChange(event.target.checked)} inputProps={{ 'aria-label': label }} />;
  } else if (schema.type === 'select') {
    control = (
      <Select
        variant="standard"
        value={String(value ?? schema.options?.[0] ?? '')}
        onChange={(event) => onChange(event.target.value)}
        sx={{ ...inlineControlSx, fontSize: 13 }}
        inputProps={{ 'aria-label': label }}
      >
        {(schema.options || []).map((option) => (
          <MenuItem key={option} value={option} sx={drawerMenuItemSx}>
            {schema.optionLabelKey ? t(`${schema.optionLabelKey}.${option}`) : option}
          </MenuItem>
        ))}
      </Select>
    );
  } else {
    control = (
      <TextField
        variant="standard"
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          const min = schema.min ?? 1;
          const max = schema.max ?? 100;
          onChange(Math.max(min, Math.min(max, Math.round(next))));
        }}
        inputProps={{ min: schema.min, max: schema.max, 'aria-label': label }}
        sx={optionValueSx}
      />
    );
  }
  return (
    <Box key={name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 0.25 }}>
      <Typography variant="caption" sx={{ color: 'kanap.text.tertiary', fontSize: 12 }}>{label}</Typography>
      {control}
    </Box>
  );
}
