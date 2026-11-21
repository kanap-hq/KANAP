import React from 'react';
import { Autocomplete, Box, ListSubheader, TextField, CircularProgress } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LOOKUP_CREATE_ID, lookupCreateText } from '../../hooks/useLookupPicker';
import { foldText } from '../../utils/foldText';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { formatItemRef } from '../../utils/item-ref';
import OptionWithHint from './OptionWithHint';
import type { Contact as ContactRecord } from '../../pages/contacts/contactModel';
import CreateContactDialog, { type CreateContactRequest, type CreateContactSupplier } from './CreateContactDialog';
import { contactName, isContactReference } from './contactNames';

type Contact = {
  id: string;
  /** CTCT-n, which the search finds too. */
  item_number?: number | null;
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
  /** A supplier's contact field: the contact created from the list belongs to that supplier, with this type. */
  createSupplier?: CreateContactSupplier;
};

/** The option that offers to create a contact (the typed one, or a new one while nothing is typed): not a row, it is never the field's value. */
type CreateRow = { id: typeof LOOKUP_CREATE_ID; lookupCreateText: string; lookupCreateLabel: string };
type Row = Contact | CreateRow;
const isCreateRow = (row: Row): row is CreateRow => lookupCreateText(row) !== null;
/** The group of the create row: it closes the list under no supplier heading. */
const CREATE_GROUP = '\u0000create';

/** "Name (supplier)", the one line a contact takes in the field and in the list. */
function formatLabel(c: Contact): string {
  return c.supplier_name ? `${contactName(c)} (${c.supplier_name})` : contactName(c);
}


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
    createSupplier,
  },
  ref,
) {
  const { t } = useTranslation(['common', 'master-data']);
  const { hasLevel } = useAuth();
  // The same check as the page that creates a contact (`/master-data/contacts/new`).
  const mayCreate = hasLevel('contacts', 'member');
  const canCreate = mayCreate && !disabled;
  const label = labelProp ?? t('selects.contact');
  const naked = hideLabel || label === '';
  const [input, setInput] = React.useState(query);
  const { data: items, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['contacts', 'typeahead', input],
    queryFn: async () => {
      const res = await api.get<{ items: Contact[] }>('/contacts', { params: { limit: 20, q: input } });
      return res.data.items;
    },
    placeholderData: (prev) => prev, // keep previous results while fetching new ones
  });

  // One dialog at a time. Resolving hands the contact to the field, or nothing when the person cancels.
  const [request, setRequest] = React.useState<CreateContactRequest | null>(null);
  const requestKey = React.useRef(0);
  const [created, setCreated] = React.useState<Contact | null>(null);
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
    // A contact just created from the list is shown at once; its read replaces it.
    else if (created && created.id === value && !base.some((c) => c.id === created.id)) base.unshift(created);
    // Sort by supplier name for grouping
    base.sort((a, b) => {
      const sa = a.supplier_name || '';
      const sb = b.supplier_name || '';
      return sa.localeCompare(sb);
    });
    return base;
  }, [items, selectedById, created, value]);

  const selected = mergedOptions.find((c) => c.id === value) || null;

  // The create row closes the list once the search has answered: "new contact" while nothing is
  // typed, the typed name when no contact has exactly that name (never for a typed reference).
  const typed = input.trim();
  const settled = !isFetching && !isPlaceholderData;
  const createRow = React.useMemo<CreateRow | null>(() => {
    if (!canCreate || !settled) return null;
    if (!typed) return { id: LOOKUP_CREATE_ID, lookupCreateText: '', lookupCreateLabel: t('master-data:contacts.newContactOption') };
    if (isContactReference(typed)) return null;
    const needle = foldText(typed);
    if (mergedOptions.some((c) => foldText(contactName(c)) === needle || foldText(formatLabel(c)) === needle)) return null;
    return { id: LOOKUP_CREATE_ID, lookupCreateText: typed, lookupCreateLabel: t('master-data:contacts.createOption', { name: typed }) };
  }, [canCreate, settled, typed, mergedOptions, t]);
  const options = React.useMemo<Row[]>(() => (createRow ? [...mergedOptions, createRow] : mergedOptions), [mergedOptions, createRow]);

  const finishCreate = (contact: ContactRecord | null) => {
    setRequest(null);
    if (!contact?.id) return;
    const picked: Contact = {
      ...contact,
      job_title: contact.job_title ?? null,
      supplier_id: contact.supplier_id ?? null,
      supplier_name: contact.supplier_name ?? null,
    };
    setCreated(picked);
    onChange(picked.id);
    onContactChange?.(picked);
  };

  const control = (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(_, newValue) => {
        // Choosing "create" never becomes the field's value: it opens the dialog, whose contact does.
        const typedName = newValue ? lookupCreateText(newValue as Row) : null;
        if (typedName !== null) {
          if (!request) {
            requestKey.current += 1;
            setRequest({ key: requestKey.current, typed: typedName });
          }
          return;
        }
        // The list closing around the open dialog must not clear the field.
        if (!newValue && request) return;
        const nextContact = (newValue as Contact | null) || null;
        onChange(nextContact?.id || null);
        onContactChange?.(nextContact);
      }}
      onInputChange={(_, newValue, reason) => {
        if (reason === 'input') setInput(newValue);
        else if (reason === 'clear') setInput('');
      }}
      getOptionLabel={(option) => (isCreateRow(option as Row) ? (option as CreateRow).lookupCreateLabel : formatLabel(option as Contact))}
      groupBy={groupByCompany
        ? (option) => (isCreateRow(option as Row) ? CREATE_GROUP : (option as Contact).supplier_name || t('selects.noSupplier'))
        : undefined}
      renderGroup={groupByCompany ? (params) => (
        <li key={params.key}>
          {/* The create row sits under no supplier heading; the others keep MUI's own group look. */}
          {params.group === CREATE_GROUP ? null : (
            <ListSubheader component="div" sx={{ top: -8, bgcolor: 'background.paper' }}>{params.group}</ListSubheader>
          )}
          <Box component="ul" sx={{ p: 0, ...(params.group === CREATE_GROUP ? {} : { '& .MuiAutocomplete-option': { pl: 3 } }) }}>
            {params.children}
          </Box>
        </li>
      ) : undefined}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderOption={(props, option) => {
        if (isCreateRow(option as Row)) {
          return <OptionWithHint key={LOOKUP_CREATE_ID} optionProps={props} label={(option as CreateRow).lookupCreateLabel} />;
        }
        // Grouped by supplier, the group header already names it.
        const text = groupByCompany ? contactName(option as Contact) : formatLabel(option as Contact);
        const reference = (option as Contact).item_number ? formatItemRef('contact', (option as Contact).item_number as number) : null;
        return (
          <OptionWithHint
            key={(option as Contact).id}
            optionProps={props}
            label={<Box component="span" className="kanap-autocomplete-option-primary" title={text}>{text}</Box>}
            trailing={reference ? (
              <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, fontVariantNumeric: 'tabular-nums' }}>{reference}</Box>
            ) : null}
          />
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
      noOptionsText={isFetching
        ? t('selects.loadingEllipsis')
        : !mayCreate && settled
          ? t('master-data:contacts.noContactAskAdmin')
          : t('selects.noContactsFound')}
      fullWidth
    />
  );

  const withDialog = (
    <>
      {control}
      <CreateContactDialog request={request} supplier={createSupplier} onResolve={finishCreate} />
    </>
  );

  if (naked || !label) return withDialog;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {withDialog}
    </Box>
  );
});

export default ContactSelect;
