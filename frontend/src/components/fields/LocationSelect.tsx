import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Autocomplete, Box, CircularProgress, MenuItem, TextField, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { FieldLabel, KanapDialog, PropertyRow } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';
import { LOCATION_OPTIONS_QUERY_KEY, useLocationOptions, type LocationOption } from '../../hooks/useLocationOptions';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { foldText } from '../../utils/foldText';
import { getApiErrorMessage, isDuplicateError } from '../../utils/apiErrorMessage';

/** The option that opens the creation of a site, with what the person typed as its name. */
const CREATE_ID = '__location_create__';

type Props = {
  label?: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  hideLabel?: boolean;
  required?: boolean;
  placeholder?: string;
  size?: 'small' | 'medium';
  textFieldSx?: SxProps<Theme>;
};

/**
 * The name and the hosting type of a site created from the picker, the two fields a site needs.
 * Nothing here saves the record the person was filling in: the new site goes back to the field.
 */
function CreateLocationDialog({
  typed,
  onClose,
  onCreated,
}: {
  typed: string | null;
  onClose: () => void;
  onCreated: (location: LocationOption) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const nameRef = React.useRef<HTMLInputElement>(null);
  const { byField } = useItOpsEnumOptions({ enabled: typed !== null });
  const hostingOptions = React.useMemo(
    () => (byField.hostingType || []).filter((option) => !option.deprecated),
    [byField.hostingType],
  );
  const [name, setName] = React.useState('');
  const [hostingType, setHostingType] = React.useState('');
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (typed === null) return;
    setName(typed);
    setNameError(null);
    setServerError(null);
    setSubmitting(false);
  }, [typed]);

  React.useEffect(() => {
    if (!hostingType && hostingOptions.length > 0) setHostingType(hostingOptions[0].code);
  }, [hostingOptions, hostingType]);

  const create = async () => {
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('it:messages.nameRequired'));
      nameRef.current?.focus();
      return;
    }
    if (!hostingType) {
      setServerError(t('it:messages.hostingTypeRequired'));
      return;
    }
    setSubmitting(true);
    setNameError(null);
    setServerError(null);
    try {
      const res = await api.post<{ id: string }>('/locations', { name: trimmed, hosting_type: hostingType });
      // The creation answers the record without its reference (LOC-n): read the site as the picker shows it.
      const saved = (await api.get<LocationOption>(`/locations/${res.data.id}`)).data;
      const option: LocationOption = { id: saved.id, location_reference: saved.location_reference, name: saved.name };
      queryClient.setQueryData<LocationOption[]>(LOCATION_OPTIONS_QUERY_KEY, (old) => [...(old ?? []), option]);
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      onCreated(option);
    } catch (error) {
      if (isDuplicateError(error)) {
        setNameError(t('it:messages.locationNameTaken'));
        nameRef.current?.focus();
      } else {
        setServerError(getApiErrorMessage(error, t, t('it:messages.saveLocationFailed')));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KanapDialog
      open={typed !== null}
      title={t('it:workspace.location.newTitle')}
      onClose={() => { if (!submitting) onClose(); }}
      onSave={() => { void create(); }}
      saveLabel={t('common:buttons.create')}
      saveLoading={submitting}
      initialFocusRef={nameRef}
    >
      <PropertyRow label={t('it:pages.locations.columns.name')} required>
        <TextField
          value={name}
          onChange={(event) => { setName(event.target.value); setNameError(null); }}
          variant="standard"
          fullWidth
          placeholder={t('it:workspace.location.namePlaceholder')}
          error={!!nameError}
          helperText={nameError}
          inputRef={nameRef}
          inputProps={{ 'aria-label': t('it:pages.locations.columns.name'), autoComplete: 'off' }}
        />
      </PropertyRow>
      <PropertyRow label={t('it:pages.locations.columns.hostingType')} required>
        <TextField
          select
          value={hostingType}
          onChange={(event) => setHostingType(event.target.value)}
          variant="standard"
          fullWidth
          inputProps={{ 'aria-label': t('it:pages.locations.columns.hostingType') }}
        >
          {hostingOptions.map((option) => (
            <MenuItem key={option.code} value={option.code}>{option.label}</MenuItem>
          ))}
        </TextField>
      </PropertyRow>
      {serverError ? <Alert severity="error" sx={{ mt: 1 }}>{serverError}</Alert> : null}
    </KanapDialog>
  );
}

export default function LocationSelect({
  label: labelProp,
  value,
  onChange,
  disabled,
  error,
  helperText,
  hideLabel,
  required,
  placeholder,
  size = 'medium',
  textFieldSx,
}: Props) {
  const { t } = useTranslation(['common', 'it']);
  const { hasLevel } = useAuth();
  // The same check as the New button of the Locations list.
  const canCreate = hasLevel('locations', 'member') && !disabled;
  const label = labelProp ?? t('selects.location');
  const naked = hideLabel || label === '';
  const { data: locations, isLoading } = useLocationOptions();
  const [creating, setCreating] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => {
    const list = locations ? [...locations] : [];
    return list.sort((a, b) => a.location_reference.localeCompare(
      b.location_reference,
      undefined,
      { sensitivity: 'base', numeric: true },
    ));
  }, [locations]);

  const needSelectedFetch = !!value && !sorted.some((loc) => loc.id === value);
  const { data: selectedById, isLoading: loadingSelected } = useQuery({
    queryKey: ['locations', 'by-id', value],
    enabled: needSelectedFetch,
    queryFn: async () => {
      if (!value) return null;
      const res = await api.get(`/locations/${value}`);
      const loc = res.data as any;
      return { id: loc.id, location_reference: loc.location_reference, name: loc.name } as LocationOption;
    },
  });

  const options = React.useMemo(() => {
    const list = [...sorted];
    if (selectedById && !list.some((loc) => loc.id === selectedById.id)) {
      list.unshift(selectedById);
    }
    return list;
  }, [sorted, selectedById]);

  const selectedOption = options.find((opt) => opt.id === value) || null;

  const control = (
    <Box sx={{ position: 'relative' }}>
      <Autocomplete
        options={options}
        value={selectedOption}
        onChange={(_, option) => {
          if (option?.id === CREATE_ID) {
            setCreating(option.name);
            return;
          }
          onChange(option?.id ?? null);
        }}
        getOptionLabel={(opt) =>
          opt ? `${opt.location_reference}${opt.name ? ` · ${opt.name}` : ''}` : ''
        }
        renderOption={(props, option) => option.id === CREATE_ID ? (
          <li {...props} key={CREATE_ID}>
            <Typography variant="body2">
              {option.name
                ? t('it:workspace.location.createOption', { name: option.name })
                : t('it:workspace.location.createNew')}
            </Typography>
          </li>
        ) : (
          <li {...props} key={option.id}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                <Typography
                  variant="caption"
                  sx={{ fontFamily: MONO_FONT_FAMILY, color: 'kanap.text.secondary' }}
                >
                  {option.location_reference}
                </Typography>
                {option.name && (
                  <Typography variant="body2">{option.name}</Typography>
                )}
              </Box>
            </Box>
          </li>
        )}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        disabled={disabled}
        loading={isLoading || loadingSelected}
        filterOptions={(opts, { inputValue }) => {
          const s = inputValue.toLowerCase();
          const matches = opts.filter(
            (opt) =>
              opt.location_reference.toLowerCase().includes(s) ||
              opt.name.toLowerCase().includes(s),
          );
          if (!canCreate) return matches;
          // A site of that exact name exists: choose it rather than create a second one.
          const typed = inputValue.trim();
          if (typed && opts.some((opt) => foldText(opt.name.trim()) === foldText(typed))) return matches;
          return [...matches, { id: CREATE_ID, location_reference: '', name: typed }];
        }}
        ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
        renderInput={(params) => (
          <TextField
            {...params}
            size={size}
            error={error}
            helperText={helperText}
            required={required}
            variant="standard"
            placeholder={placeholder ?? (naked ? t('selects.notSet') : undefined)}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {(isLoading || loadingSelected) && <CircularProgress size={18} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            sx={textFieldSx}
          />
        )}
        fullWidth
      />
      <CreateLocationDialog
        typed={creating}
        onClose={() => setCreating(null)}
        onCreated={(location) => {
          setCreating(null);
          onChange(location.id);
        }}
      />
    </Box>
  );

  if (naked || !label) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {control}
    </Box>
  );
}
