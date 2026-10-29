import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Autocomplete, Box, Button, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { STATUS_ENABLED } from '../../constants/status';
import { LOOKUP_CREATE_ID, lookupCreateText, useLookupPicker } from '../../hooks/useLookupPicker';
import { foldText } from '../../utils/foldText';
import { getApiErrorMessage, isDuplicateError } from '../../utils/apiErrorMessage';
import { FieldLabel, KanapDialog, PropertyRow } from '../design';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import OptionWithHint from './OptionWithHint';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

const SUPPLIER_LOOKUP = '/suppliers/lookup';

export type SupplierOption = {
  id: string;
  name: string;
  erp_supplier_id: string | null;
  status: string;
};
type Supplier = SupplierOption;

type SupplierSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  /** The chosen supplier's label when the caller holds it (the detail's references): no request to show it. */
  selectedOption?: SupplierOption | null;
};

function toSupplierOption(row: Partial<SupplierOption> & { id: string }): SupplierOption {
  return {
    id: row.id,
    name: row.name ?? '',
    erp_supplier_id: row.erp_supplier_id ?? null,
    status: row.status ?? STATUS_ENABLED,
  };
}

/** The supplier whose name matches exactly (accents and case ignored), the one a 409 names. */
async function findSupplierByName(name: string): Promise<SupplierOption | null> {
  const res = await api.get<{ items?: SupplierOption[] }>(SUPPLIER_LOOKUP, { params: { q: name, limit: 50 } });
  const needle = foldText(name.trim());
  const found = (res.data?.items ?? []).find((item) => foldText((item.name ?? '').trim()) === needle);
  return found?.id ? toSupplierOption(found) : null;
}

/**
 * The name and the ERP id of a supplier created from the picker. Nothing here saves the record
 * the person was filling in: resolving hands the new supplier back to the field.
 */
function CreateSupplierDialog({
  request,
  onResolve,
}: {
  request: { key: number; typed: string } | null;
  onResolve: (supplier: SupplierOption | null) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const nameRef = React.useRef<HTMLInputElement>(null);
  const lookupGeneration = React.useRef(0);
  const [name, setName] = React.useState('');
  const [erp, setErp] = React.useState('');
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [existing, setExisting] = React.useState<SupplierOption | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!request) return;
    setName(request.typed);
    setErp('');
    setNameError(null);
    setServerError(null);
    setExisting(null);
    setSubmitting(false);
    lookupGeneration.current += 1;
  }, [request]);

  const close = () => {
    if (submitting) return;
    onResolve(null);
  };

  const changeName = (value: string) => {
    setName(value);
    setNameError(null);
    setExisting(null);
    lookupGeneration.current += 1;
  };

  const handleCreate = async () => {
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('master-data:suppliers.messages.nameRequired'));
      nameRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setNameError(null);
    setServerError(null);
    setExisting(null);
    lookupGeneration.current += 1;
    const token = lookupGeneration.current;
    try {
      const res = await api.post<SupplierOption>('/suppliers', {
        name: trimmed,
        erp_supplier_id: erp.trim() || null,
        notes: null,
        status: STATUS_ENABLED,
        disabled_at: null,
      });
      void queryClient.invalidateQueries({ queryKey: ['lookup', SUPPLIER_LOOKUP] });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onResolve(toSupplierOption(res.data));
    } catch (error) {
      if (isDuplicateError(error)) {
        setNameError(t('master-data:suppliers.messages.nameTaken'));
        nameRef.current?.focus();
        try {
          const found = await findSupplierByName(trimmed);
          if (token === lookupGeneration.current) setExisting(found);
        } catch {
          if (token === lookupGeneration.current) setExisting(null);
        }
      } else {
        setServerError(getApiErrorMessage(error, t, t('master-data:suppliers.messages.createFailed')));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KanapDialog
      open={request !== null}
      title={t('master-data:suppliers.newSupplier')}
      onClose={close}
      onSave={() => { void handleCreate(); }}
      saveLabel={t('common:buttons.create')}
      saveLoading={submitting}
      initialFocusRef={nameRef}
      secondaryActions={existing ? (
        <Button type="button" variant="action" disabled={submitting} onClick={() => onResolve(existing)}>
          {t('master-data:suppliers.selectExisting')}
        </Button>
      ) : null}
    >
      <PropertyRow label={t('master-data:suppliers.fields.name')} required>
        <TextField
          value={name}
          onChange={(event) => changeName(event.target.value)}
          variant="standard"
          fullWidth
          placeholder={t('master-data:suppliers.placeholders.name')}
          error={!!nameError}
          helperText={nameError}
          inputRef={nameRef}
          inputProps={{ 'aria-label': t('master-data:suppliers.fields.name'), autoComplete: 'off' }}
        />
      </PropertyRow>
      <PropertyRow label={t('master-data:suppliers.fields.erpSupplierId')}>
        <TextField
          value={erp}
          onChange={(event) => setErp(event.target.value)}
          variant="standard"
          fullWidth
          placeholder={t('master-data:suppliers.placeholders.erpSupplierId')}
          inputProps={{ 'aria-label': t('master-data:suppliers.fields.erpSupplierId'), autoComplete: 'off' }}
        />
      </PropertyRow>
      {serverError ? <Alert severity="error" sx={{ mt: 1 }}>{serverError}</Alert> : null}
    </KanapDialog>
  );
}

function assignRef<T>(target: React.Ref<T | null> | undefined, value: T | null) {
  if (!target) return;
  if (typeof target === 'function') {
    target(value);
  } else {
    (target as React.MutableRefObject<T | null>).current = value;
  }
}

const SupplierSelect = React.forwardRef<HTMLInputElement, SupplierSelectProps>(function SupplierSelect(
  {
    label: labelProp,
    value,
    onChange,
    disabled,
    error,
    helperText,
    placeholder,
    required = false,
    hideLabel = false,
    textFieldSx,
    selectedOption,
  },
  ref,
) {
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel } = useAuth();
  // The same check as the New button of the Suppliers list: member and manager are one rank.
  const canCreate = hasLevel('suppliers', 'member');
  const label = labelProp ?? t('common:selects.supplier');
  const naked = hideLabel || label === '';
  // A hidden label still names the field for assistive technology; the placeholder must not.
  const ariaLabel = naked && label ? label : undefined;
  const resolveRef = React.useRef<((supplier: SupplierOption | null) => void) | null>(null);
  const pendingRef = React.useRef<Promise<SupplierOption | null> | null>(null);
  const requestKey = React.useRef(0);
  const [request, setRequest] = React.useState<{ key: number; typed: string } | null>(null);
  const finishCreate = React.useCallback((supplier: SupplierOption | null) => {
    setRequest(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    pendingRef.current = null;
    resolve?.(supplier);
  }, []);
  React.useEffect(() => () => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    pendingRef.current = null;
    resolve?.(null);
  }, []);
  const createSupplier = React.useCallback((typed: string) => {
    if (pendingRef.current) return pendingRef.current;
    const promise = new Promise<SupplierOption | null>((resolve) => {
      resolveRef.current = resolve;
      requestKey.current += 1;
      setRequest({ key: requestKey.current, typed });
    });
    pendingRef.current = promise;
    return promise;
  }, []);
  const picker = useLookupPicker<Supplier>({
    endpoint: SUPPLIER_LOOKUP,
    value: value ? [value] : [],
    given: [selectedOption],
    create: {
      allowed: canCreate && !disabled,
      label: (typed) => t('master-data:suppliers.createOption', { name: typed }),
      create: createSupplier,
    },
  });
  const selectedSupplier = value ? picker.selected[0] ?? null : null;
  const askAdministrator = !canCreate && picker.searchSettled && !picker.loading;

  const control = (
    <Autocomplete
      {...picker.autocomplete}
      options={picker.options}
      value={selectedSupplier}
      onChange={(_, newValue) => {
        // Choosing "create" must not become the field's value, and the list closing must not
        // clear the record while the dialog is open. A second click shares the same dialog.
        if (lookupCreateText(newValue) !== null) {
          if (pendingRef.current) return;
          void picker.choose(newValue, (picked) => onChange(picked?.id || null));
          return;
        }
        if (!newValue && pendingRef.current) return;
        void picker.choose(newValue, (picked) => onChange(picked?.id || null));
      }}
      getOptionLabel={(option) => picker.label(option, (o) => o.name ?? '')}
      renderOption={(props, option) => {
        if (lookupCreateText(option) !== null) {
          return (
            <OptionWithHint
              key={LOOKUP_CREATE_ID}
              optionProps={props}
              label={picker.label(option, () => '')}
            />
          );
        }
        const disabledSupplier = option.status?.toLowerCase() === 'disabled';
        return (
          <OptionWithHint
            key={option.id}
            optionProps={props}
            label={option.name}
            trailing={option.erp_supplier_id || disabledSupplier ? (
              <>
                {option.erp_supplier_id ? (
                  <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, fontVariantNumeric: 'tabular-nums' }}>
                    {option.erp_supplier_id}
                  </Box>
                ) : null}
                {option.erp_supplier_id && disabledSupplier ? ' · ' : null}
                {disabledSupplier ? t('common:statuses.disabled') : null}
              </>
            ) : null}
          />
        );
      }}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          placeholder={placeholder ?? (naked ? t('common:selects.notSet') : undefined)}
          variant="standard"
          sx={textFieldSx}
          inputProps={ariaLabel ? { ...params.inputProps, 'aria-label': ariaLabel } : params.inputProps}
          inputRef={(node) => {
            assignRef((params.inputProps as any)?.ref, node);
            assignRef(ref, node ?? null);
          }}
          error={error}
          helperText={helperText}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {picker.loading ? <CircularProgress color="inherit" size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      disabled={disabled}
      noOptionsText={picker.loading
        ? t('common:status.loading')
        : askAdministrator
          ? t('master-data:suppliers.noSupplierAskAdmin')
          : t('master-data:suppliers.noSuppliersFound')}
      fullWidth
    />
  );
  const withDialog = (
    <>
      {control}
      <CreateSupplierDialog request={request} onResolve={finishCreate} />
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

export default SupplierSelect;
