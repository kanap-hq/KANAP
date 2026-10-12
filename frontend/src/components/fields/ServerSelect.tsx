import React from 'react';
import { Autocomplete, Box, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import OptionWithHint from './OptionWithHint';
import api from '../../api';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

export type ServerOption = {
  id: string;
  name: string;
  environment: string;
  kind: string;
  provider: string;
  is_cluster?: boolean;
};

type ServerSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  helperText?: React.ReactNode;
  required?: boolean;
  placeholder?: string;
  allowClusters?: boolean;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
};

function useServerOptions(search: string, opts?: { allowClusters?: boolean }) {
  const [options, setOptions] = React.useState<ServerOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    let isMounted = true;
    const fetchOptions = async () => {
      setLoading(true);
      try {
        const res = await api.get<{ items: ServerOption[] }>('/assets', {
          params: {
            q: search || undefined,
            limit: 50,
            sort: 'name:ASC',
            is_cluster: opts?.allowClusters === false ? false : undefined,
          },
        });
        if (isMounted) setOptions(res.data.items || []);
      } catch {
        if (isMounted) setOptions([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void fetchOptions();
    return () => { isMounted = false; };
  }, [search, opts?.allowClusters]);
  return { options, loading };
}

const ServerSelect: React.FC<ServerSelectProps> = ({
  label: labelProp,
  value,
  onChange,
  disabled,
  helperText,
  required,
  placeholder,
  allowClusters = true,
  hideLabel = false,
  textFieldSx,
}) => {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.server');
  const naked = hideLabel || label === '';
  const [inputValue, setInputValue] = React.useState('');
  const { options, loading } = useServerOptions(inputValue, { allowClusters });
  const [selectedOption, setSelectedOption] = React.useState<ServerOption | null>(null);

  React.useEffect(() => {
    const match = options.find((opt) => opt.id === value) || null;
    if (match) setSelectedOption(match);
  }, [options, value]);

  React.useEffect(() => {
    if (!value) {
      setSelectedOption(null);
      return;
    }
    if (selectedOption && selectedOption.id === value) return;
    let isMounted = true;
    const load = async () => {
      try {
        const res = await api.get<ServerOption>(`/assets/${value}`);
        if (isMounted) setSelectedOption(res.data as unknown as ServerOption);
      } catch {
        if (isMounted) setSelectedOption(null);
      }
    };
    void load();
    return () => { isMounted = false; };
  }, [value, selectedOption]);

  const control = (
    <Autocomplete
      options={options}
      value={selectedOption}
      disabled={disabled}
      onChange={(_, newValue) => onChange(newValue?.id || null)}
      onInputChange={(_, v) => setInputValue(v)}
      getOptionLabel={(option) => (option.is_cluster ? `${t('selects.cluster')} ${option.name}` : option.name)}
      renderOption={(props, option) => (
        <OptionWithHint
          key={option.id}
          optionProps={props}
          label={`${option.is_cluster ? `${t('selects.cluster')} ` : ''}${option.name}`}
          hint={[option.environment?.toUpperCase(), option.kind, option.provider].filter(Boolean).join(' · ')}
        />
      )}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          placeholder={placeholder ?? (naked ? t('selects.notSet') : undefined)}
          helperText={helperText}
          variant="standard"
          sx={textFieldSx}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      loading={loading}
      noOptionsText={loading ? t('selects.loadingEllipsis') : t('selects.noServersFound')}
      fullWidth
    />
  );

  if (naked || !label) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {control}
    </Box>
  );
};

export default ServerSelect;
