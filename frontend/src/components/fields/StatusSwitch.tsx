import React from 'react';
import { useTranslation } from 'react-i18next';
import { FormControlLabel, Switch, FormHelperText, Stack } from '@mui/material';

type StatusSwitchProps = {
  label?: string;
  /** Label shown while the switch is on, when it says more than `label` (the control keeps `label` as its name). */
  onDisplayLabel?: string;
  /** Label shown while the switch is off. Defaults to `label`. */
  offLabel?: string;
  value?: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  name?: string;
};

const StatusSwitch = React.forwardRef<HTMLButtonElement, StatusSwitchProps>(function StatusSwitch(
  {
    label: labelProp,
    onDisplayLabel,
    offLabel,
    value = true,
    onChange,
    disabled,
    error,
    helperText,
    name,
  },
  ref,
) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('labels.enabled');
  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        control={
          <Switch
            name={name}
            checked={!!value}
            onChange={(_, checked) => onChange(checked)}
            disabled={disabled}
            inputProps={{ 'aria-label': label }}
            inputRef={ref}
          />
        }
        label={value ? (onDisplayLabel ?? label) : (offLabel ?? label)}
      />
      {helperText ? (
        <FormHelperText error={!!error} sx={{ ml: 1.75 }}>
          {helperText}
        </FormHelperText>
      ) : null}
    </Stack>
  );
});

export default StatusSwitch;
