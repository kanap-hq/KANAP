import React from 'react';
import { Autocomplete, Box, TextField, CircularProgress } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string;
  active: boolean;
  supplier_id: string | null;
  supplier_name: string | null;
};

type ContactSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  onContactChange?: (contact: Contact | null) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  required?: boolean;
  query?: string; // initial query
  groupByCompany?: boolean;
  hideLabel?: boolean;
  placeholder?: string;
  textFieldSx?: SxProps<Theme>;
};

/** A contact is named, never shown by email: the email only stands in for a contact with no name. */
function contactName(c: Contact): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email;
}

/** "Name (supplier)", the one line a contact takes in the field and in the list. */
function formatLabel(c: Contact): string {
  return c.supplier_name ? `${contactName(c)} (${c.supplier_name})` : contactName(c);
}

const optionLineSx = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } as const;

const ContactSelect = React.forwardRef<HTMLInputElement, ContactSelectProps>(function ContactSelect(
  {
    label: labelProp,
    value,
    onChange,
    onContactChange,
    disabled,
    error,
    helperText,
    required = false,
    query = '',
    groupByCompany = true,
    hideLabel = false,
    placeholder,
    textFieldSx,
  },
  ref,
) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.contact');
  const naked = hideLabel || label === '';
  const [input, setInput] = React.useState(query);
  const { data: items, isFetching } = useQuery({
    queryKey: ['contacts', 'typeahead', input],
    queryFn: async () => {
      const res = await api.get<{ items: Contact[] }>('/contacts', { params: { limit: 20, q: input } });
      return res.data.items;
    },
    placeholderData: (prev) => prev, // keep previous results while fetching new ones
  });

  // Ensure selected contact is visible even if not in the current typeahead results
  const needSelectedFetch = !!value && !(items || []).some((c) => c.id === value);
  const { data: selectedById, isLoading: isLoadingSelected } = useQuery({
    queryKey: ['contacts', 'by-id', value],
    enabled: needSelectedFetch,
    queryFn: async () => {
      const res = await api.get<Contact>(`/contacts/${value}`);
      return res.data as unknown as Contact;
    },
  });

  const mergedOptions = React.useMemo(() => {
    const base = items ? [...items] : [];
    if (selectedById && !base.some((c) => c.id === selectedById.id)) base.unshift(selectedById);
    // Sort by supplier name for grouping
    base.sort((a, b) => {
      const sa = a.supplier_name || '';
      const sb = b.supplier_name || '';
      return sa.localeCompare(sb);
    });
    return base;
  }, [items, selectedById]);

  const selected = mergedOptions.find((c) => c.id === value) || null;

  const control = (
    <Autocomplete
      options={mergedOptions}
      value={selected}
      onChange={(_, newValue) => {
        const nextContact = (newValue as Contact | null) || null;
        onChange(nextContact?.id || null);
        onContactChange?.(nextContact);
      }}
      onInputChange={(_, newValue, reason) => {
        if (reason === 'input') setInput(newValue);
        else if (reason === 'clear') setInput('');
      }}
      getOptionLabel={(option) => formatLabel(option as Contact)}
      groupBy={groupByCompany ? (option) => (option as Contact).supplier_name || t('selects.noSupplier') : undefined}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderOption={(props, option) => {
        // Grouped by supplier, the group header already names it.
        const text = groupByCompany ? contactName(option as Contact) : formatLabel(option as Contact);
        // React wants the key passed on its own, not spread with the other props.
        const { key, ...optionProps } = props as typeof props & { key: React.Key };
        return (
          <li key={key} {...optionProps}>
            <Box component="span" className="kanap-autocomplete-option-primary" sx={optionLineSx} title={text}>
              {text}
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder ?? (naked ? t('selects.notSet') : undefined)}
          required={required}
          inputRef={ref}
          error={error}
          helperText={helperText}
          variant="standard"
          sx={textFieldSx}
          // A hidden label still names the field for assistive technologies.
          inputProps={naked && label ? { ...params.inputProps, 'aria-label': label } : params.inputProps}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {(isFetching || isLoadingSelected) ? <CircularProgress color="inherit" size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      disabled={disabled}
      loading={isFetching || isLoadingSelected}
      filterOptions={(x) => x}
      noOptionsText={isFetching ? t('selects.loadingEllipsis') : t('selects.noContactsFound')}
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
});

export default ContactSelect;
