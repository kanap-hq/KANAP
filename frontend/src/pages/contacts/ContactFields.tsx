import React from 'react';
import { useTranslation } from 'react-i18next';
import { Autocomplete, Box, FormHelperText, Menu, MenuItem, Select, TextField } from '@mui/material';
import { DIAL_CODES } from '../../constants/dialCodes';
import { combineDialCode, normalizeDialCode, splitPhone } from '../../lib/phoneUtils';
import { drawerAutocompleteListboxSx, drawerMenuItemSx, drawerSelectSx, selectKeepsFocus } from '../../theme/formSx';
import { metaItemSx } from '../tasks/theme/taskDetailTokens';
import { EditableTitleDisplay } from '../../components/workspace/EditableTitle';
import { CONTACT_ROLES, type ContactRole } from './contactModel';

// A dial code shared by several countries is listed once.
const DIAL_OPTIONS = Array.from(new Set(DIAL_CODES));

/** Translated labels of the contact types, in their usual order. */
export function useContactRoleOptions(): Array<{ value: ContactRole; label: string }> {
  const { t } = useTranslation(['master-data']);
  return CONTACT_ROLES.map((value) => ({ value, label: t(`contacts.roles.${value}`) }));
}

/**
 * A phone number as a dial code and a number. On a contact page the pair saves once focus leaves
 * it (`onCommit`), or at once when a dial code is picked from the list; a create form follows each
 * change (`onChange`).
 */
export function ContactPhoneField({
  value,
  label,
  placeholder,
  onChange,
  onCommit,
  disabled,
  error,
}: {
  value: string | null;
  label: string;
  placeholder: string;
  onChange?: (next: string | null) => void;
  onCommit?: (next: string | null) => void;
  disabled?: boolean;
  error?: string;
}) {
  const { t } = useTranslation(['master-data']);
  const parts = React.useMemo(() => splitPhone(value), [value]);
  const [code, setCode] = React.useState(parts.code ?? '');
  const [local, setLocal] = React.useState(parts.rest);
  const editingRef = React.useRef(false);

  // The stored value shows again, except while the user is editing the pair.
  React.useEffect(() => {
    if (editingRef.current) return;
    setCode(parts.code ?? '');
    setLocal(parts.rest);
  }, [parts]);

  const combined = (nextCode: string, nextLocal: string) => combineDialCode(nextCode, nextLocal) || null;
  const update = (nextCode: string, nextLocal: string) => {
    setCode(nextCode);
    setLocal(nextLocal);
    onChange?.(combined(nextCode, nextLocal));
  };

  return (
    <Box
      onFocus={() => { editingRef.current = true; }}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        editingRef.current = false;
        onCommit?.(combined(code, local));
      }}
    >
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Autocomplete<string, false, true, true>
          options={DIAL_OPTIONS}
          freeSolo
          disableClearable
          disabled={disabled}
          value={code}
          inputValue={code}
          onInputChange={(_event, next, reason) => {
            if (reason === 'input') update(next.trim(), local);
          }}
          onChange={(_event, next) => {
            const nextCode = normalizeDialCode(next) ?? '';
            update(nextCode, local);
            // A dial code picked from the list saves at once.
            onCommit?.(combined(nextCode, local));
          }}
          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
          sx={{ width: 96, flexShrink: 0 }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="standard"
              placeholder={t('contacts.placeholders.dialCode')}
              error={!!error}
              inputProps={{ ...params.inputProps, 'aria-label': t('contacts.fields.dialCodeOf', { field: label }) }}
            />
          )}
        />
        <TextField
          value={local}
          onChange={(event) => update(code, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          variant="standard"
          placeholder={placeholder}
          disabled={disabled}
          error={!!error}
          sx={{ flex: 1, minWidth: 0 }}
          inputProps={{ inputMode: 'tel', 'aria-label': label }}
        />
      </Box>
      {error && <FormHelperText error>{error}</FormHelperText>}
    </Box>
  );
}

/** The contact type as a form field: no empty choice once a supplier is chosen. */
export function ContactRoleSelect({
  value,
  hasSupplier,
  onChange,
  disabled,
  error,
}: {
  value: ContactRole | null;
  hasSupplier: boolean;
  onChange: (next: ContactRole) => void;
  disabled?: boolean;
  error?: string;
}) {
  const { t } = useTranslation(['master-data']);
  const options = useContactRoleOptions();
  return (
    <>
      <Select
        variant="standard"
        value={value ?? ''}
        displayEmpty
        disabled={disabled || !hasSupplier}
        error={!!error}
        onChange={(event) => onChange(event.target.value as ContactRole)}
        sx={drawerSelectSx}
        // The theme closes menus without giving the focus back (#181): in a run of fields the
        // select takes it back after a choice, so Tab goes on to the next field.
        MenuProps={selectKeepsFocus.MenuProps}
        SelectDisplayProps={{ 'aria-label': t('contacts.fields.contactType') } as React.HTMLAttributes<HTMLDivElement>}
        inputProps={{ 'aria-label': t('contacts.fields.contactType') }}
        renderValue={(selected) => (
          selected
            ? options.find((option) => option.value === selected)?.label
            : <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{hasSupplier ? t('contacts.placeholders.contactType') : t('contacts.fields.selectSupplierFirst')}</Box>
        )}
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>{option.label}</MenuItem>
        ))}
      </Select>
      {error && <FormHelperText error>{error}</FormHelperText>}
    </>
  );
}

/**
 * The contact's name as the page title: first and last name side by side once clicked, saved
 * together when focus leaves them (Enter too), Escape cancels. A contact without a name shows its
 * email instead.
 */
export function ContactNameTitle({
  firstName,
  lastName,
  fallback,
  canEdit,
  onSave,
}: {
  firstName: string | null;
  lastName: string | null;
  fallback: string;
  canEdit: boolean;
  onSave: (next: { first_name: string | null; last_name: string | null }) => void;
}) {
  const { t } = useTranslation(['master-data']);
  const [editing, setEditing] = React.useState(false);
  const [first, setFirst] = React.useState(firstName ?? '');
  const [last, setLast] = React.useState(lastName ?? '');
  // Enter, Escape and the blur that follows may all end the edit: only the first one counts.
  const openRef = React.useRef(false);
  const name = [firstName, lastName].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');

  const showingPlaceholder = !name && fallback === t('contacts.contactFallback');
  if (!editing) {
    return (
      <EditableTitleDisplay
        canEdit={canEdit}
        placeholder={showingPlaceholder}
        muted={!name && !showingPlaceholder}
        onEdit={() => {
          setFirst(firstName ?? '');
          setLast(lastName ?? '');
          openRef.current = true;
          setEditing(true);
        }}
      >
        {name || fallback}
      </EditableTitleDisplay>
    );
  }

  const commit = () => {
    if (!openRef.current) return;
    openRef.current = false;
    setEditing(false);
    const nextFirst = first.trim() || null;
    const nextLast = last.trim() || null;
    if (nextFirst !== ((firstName ?? '').trim() || null) || nextLast !== ((lastName ?? '').trim() || null)) {
      onSave({ first_name: nextFirst, last_name: nextLast });
    }
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') {
      openRef.current = false;
      setEditing(false);
    }
  };
  const inputSx = (theme: import('@mui/material/styles').Theme) => ({
    font: 'inherit',
    color: 'inherit',
    bgcolor: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
    outline: 'none',
    p: 0,
    m: 0,
    flex: 1,
    minWidth: 0,
    '&::placeholder': { color: theme.palette.kanap.text.tertiary, opacity: 1 },
    '&:focus': { borderBottomColor: theme.palette.kanap.teal },
  });

  return (
    <Box
      sx={{ display: 'flex', gap: 2, width: '100%' }}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
      }}
    >
      <Box
        component="input"
        autoFocus
        value={first}
        placeholder={t('contacts.fields.firstName')}
        aria-label={t('contacts.fields.firstName')}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFirst(event.target.value)}
        onKeyDown={onKeyDown}
        sx={inputSx}
      />
      <Box
        component="input"
        value={last}
        placeholder={t('contacts.fields.lastName')}
        aria-label={t('contacts.fields.lastName')}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLast(event.target.value)}
        onKeyDown={onKeyDown}
        sx={inputSx}
      />
    </Box>
  );
}

/** A metadata value that opens a compact menu of its options, anchored under it. */
export function MetadataMenu<T extends string>({
  value,
  display,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T | null;
  display: React.ReactNode;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={(event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
        sx={(theme) => ({
          ...metaItemSx,
          border: 0,
          p: 0,
          bgcolor: 'transparent',
          color: theme.palette.kanap.text.primary,
          fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
        })}
      >
        {display}
      </Box>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === value}
            onClick={() => {
              setAnchorEl(null);
              if (option.value !== value) onChange(option.value);
            }}
            sx={drawerMenuItemSx}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
