import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Autocomplete, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import { Controller } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import useZodForm from '../../../hooks/useZodForm';
import api from '../../../api';
import { createContactFormSchema, ContactFormValues, SUPPLIER_CONTACT_ROLE_OPTIONS } from '../../forms/ContactForm';
import { COUNTRY_OPTIONS, CountryOption } from '../../../constants/isoOptions';
import { DIAL_CODES } from '../../../constants/dialCodes';
import { combineDialCode, guessCountryFromDialCode, normalizeDialCode, splitPhone } from '../../../lib/phoneUtils';
import SupplierSelect from '../../../components/fields/SupplierSelect';

export type ContactCreateEditorHandle = {
  isDirty: () => boolean;
  /** Resolves true once created, false when the form is invalid; rejects on a server error. */
  save: () => Promise<boolean>;
  reset: () => void;
};

const DEFAULT_VALUES: ContactFormValues = {
  first_name: null,
  last_name: null,
  job_title: null,
  email: '',
  phone: null,
  mobile: null,
  country: null,
  supplier_id: null,
  supplier_role: null,
  notes: null,
  active: true,
};

export default forwardRef<ContactCreateEditorHandle, { onDirtyChange?: (dirty: boolean) => void }>(function ContactCreateEditor(
  { onDirtyChange },
  ref,
) {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation(['master-data', 'common']);
  const prefillSupplierId = searchParams.get('supplier_id') || null;
  const rawRole = searchParams.get('supplier_role') || null;
  const validRoles = ['commercial', 'technical', 'support', 'other'] as const;
  const prefillSupplierRole = rawRole && (validRoles as readonly string[]).includes(rawRole)
    ? (rawRole as typeof validRoles[number])
    : null;

  const initialValues = useMemo<ContactFormValues>(() => ({
    ...DEFAULT_VALUES,
    ...(prefillSupplierId ? { supplier_id: prefillSupplierId } : {}),
    ...(prefillSupplierRole ? { supplier_role: prefillSupplierRole } : {}),
  }), [prefillSupplierId, prefillSupplierRole]);

  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const schema = useMemo(() => createContactFormSchema(t), [t]);
  const form = useZodForm<ContactFormValues>({ schema, defaultValues: initialValues });
  const { register, formState, reset, handleSubmit, watch, setValue } = form;
  const err = formState.errors as any;
  const supplierId = watch('supplier_id');

  useEffect(() => { onDirtyChange?.(formState.isDirty); }, [formState.isDirty, onDirtyChange]);

  const [phoneCode, setPhoneCode] = useState<string>('');
  const [phoneCodeInput, setPhoneCodeInput] = useState('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [mobileCode, setMobileCode] = useState<string>('');
  const [mobileCodeInput, setMobileCodeInput] = useState('');
  const [mobileLocal, setMobileLocal] = useState('');

  const refreshDialState = () => {
    const phoneParts = splitPhone(form.getValues('phone'));
    setPhoneCode(phoneParts.code ?? '');
    setPhoneCodeInput(phoneParts.code ?? '');
    setPhoneLocal(phoneParts.rest);

    const mobileParts = splitPhone(form.getValues('mobile'));
    setMobileCode(mobileParts.code ?? '');
    setMobileCodeInput(mobileParts.code ?? '');
    setMobileLocal(mobileParts.rest);
  };

  useEffect(() => { refreshDialState(); }, []);

  const applyDialCode = (field: 'phone' | 'mobile', rawCode: string | null) => {
    const normalized = normalizeDialCode(rawCode);
    const local = field === 'phone' ? phoneLocal : mobileLocal;
    const next = combineDialCode(normalized, local);
    form.setValue(field, next, { shouldDirty: true, shouldValidate: true });
    if (!form.getValues('country')) {
      const guess = guessCountryFromDialCode(normalized);
      if (guess) form.setValue('country', guess, { shouldDirty: true, shouldValidate: true });
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setSaving(true);
    setServerError(null);
    try {
      await api.post('/contacts', values);
      return true;
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || t('shared.messages.failedToCreate', { entity: t('contacts.entity') });
      setServerError(msg);
      throw e;
    } finally {
      setSaving(false);
    }
  });

  useImperativeHandle(ref, () => ({
    isDirty: () => formState.isDirty,
    save: async () => (await onSubmit()) === true,
    reset: () => {
      reset(DEFAULT_VALUES, { keepDirty: false, keepTouched: false });
      refreshDialState();
      onDirtyChange?.(false);
      setServerError(null);
    },
  }), [formState.isDirty, onSubmit, reset, onDirtyChange]);

  return (
    <Stack spacing={2}>
      {!!serverError && <Alert severity="error">{serverError}</Alert>}
      <TextField label="Email" required {...register('email')} error={!!err.email} helperText={err.email?.message as string} InputLabelProps={{ shrink: true }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label="First name" {...register('first_name')} error={!!err.first_name} helperText={err.first_name?.message as string} InputLabelProps={{ shrink: true }} />
        <TextField label="Last name" {...register('last_name')} error={!!err.last_name} helperText={err.last_name?.message as string} InputLabelProps={{ shrink: true }} />
      </Stack>
      <Controller
        control={form.control}
        name="supplier_id"
        render={({ field }) => (
          <SupplierSelect
            label="Supplier"
            value={field.value}
            onChange={(v) => {
              field.onChange(v);
              if (!v) {
                form.setValue('supplier_role', null, { shouldDirty: true, shouldValidate: true });
              }
            }}
            disabled={!!prefillSupplierId}
            error={!!err.supplier_id}
            helperText={err.supplier_id?.message as string}
          />
        )}
      />
      <Controller
        control={form.control}
        name="supplier_role"
        render={({ field }) => (
          <TextField
            select
            label="Contact type"
            value={field.value ?? ''}
            onChange={(e) => field.onChange(e.target.value || null)}
            disabled={!supplierId || !!prefillSupplierRole}
            error={!!err.supplier_role}
            helperText={err.supplier_role?.message as string || (!supplierId ? 'Select a supplier first' : undefined)}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">Select type</MenuItem>
            {SUPPLIER_CONTACT_ROLE_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </TextField>
        )}
      />
      <TextField label="Job title" {...register('job_title')} error={!!err.job_title} helperText={err.job_title?.message as string} InputLabelProps={{ shrink: true }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Autocomplete
          options={DIAL_CODES}
          disableClearable
          freeSolo
          sx={{ minWidth: 120 }}
          value={phoneCode || undefined}
          inputValue={phoneCodeInput}
          onChange={(_, code) => {
            const nextCode = normalizeDialCode(code);
            setPhoneCode(nextCode ?? '');
            setPhoneCodeInput(nextCode ?? '');
            applyDialCode('phone', nextCode);
          }}
          onInputChange={(_, val, reason) => {
            setPhoneCodeInput(val);
            if (reason === 'input') {
              const nextCode = normalizeDialCode(val);
              setPhoneCode(nextCode ?? '');
              applyDialCode('phone', nextCode);
            }
          }}
          renderInput={(params) => (
            <TextField {...params} label="Country code" placeholder="+33" InputLabelProps={{ shrink: true }} />
          )}
          isOptionEqualToValue={(option, value) => option === value}
        />
        <TextField
          label="Phone"
          value={phoneLocal}
          onChange={(e) => {
            const nextLocal = e.target.value;
            setPhoneLocal(nextLocal);
            const nextCombined = combineDialCode(phoneCode, nextLocal);
            form.setValue('phone', nextCombined, { shouldDirty: true, shouldValidate: true });
          }}
          inputProps={{ inputMode: 'tel' }}
          error={!!err.phone}
          helperText={err.phone?.message as string || 'Format: +<countrycode><number>'}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Autocomplete
          options={DIAL_CODES}
          disableClearable
          freeSolo
          sx={{ minWidth: 120 }}
          value={mobileCode || undefined}
          inputValue={mobileCodeInput}
          onChange={(_, code) => {
            const nextCode = normalizeDialCode(code);
            setMobileCode(nextCode ?? '');
            setMobileCodeInput(nextCode ?? '');
            applyDialCode('mobile', nextCode);
          }}
          onInputChange={(_, val, reason) => {
            setMobileCodeInput(val);
            if (reason === 'input') {
              const nextCode = normalizeDialCode(val);
              setMobileCode(nextCode ?? '');
              applyDialCode('mobile', nextCode);
            }
          }}
          renderInput={(params) => (
            <TextField {...params} label="Country code" placeholder="+44" InputLabelProps={{ shrink: true }} />
          )}
          isOptionEqualToValue={(option, value) => option === value}
        />
        <TextField
          label="Mobile"
          value={mobileLocal}
          onChange={(e) => {
            const nextLocal = e.target.value;
            setMobileLocal(nextLocal);
            const nextCombined = combineDialCode(mobileCode, nextLocal);
            form.setValue('mobile', nextCombined, { shouldDirty: true, shouldValidate: true });
          }}
          inputProps={{ inputMode: 'tel' }}
          error={!!err.mobile}
          helperText={err.mobile?.message as string || 'Format: +<countrycode><number>'}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>
      <Autocomplete<CountryOption, false, false, false>
        options={COUNTRY_OPTIONS}
        value={(() => {
          const v = (form.getValues('country') || '').toString().toUpperCase();
          return COUNTRY_OPTIONS.find((o) => o.code === v) ?? (v ? { code: v, name: 'Unknown country code' } : null);
        })() as any}
        onChange={(_, option) => form.setValue('country', option?.code ?? null, { shouldDirty: true, shouldValidate: true })}
        getOptionLabel={(o) => `${o.code} — ${o.name}`}
        isOptionEqualToValue={(a, b) => a.code === b.code}
        renderInput={(params) => (
          <TextField {...params} label="Country" placeholder="Search by name or code" error={!!err.country} helperText={err.country?.message as string} />
        )}
      />
      <TextField label="Notes" multiline minRows={2} {...register('notes')} error={!!err.notes} helperText={err.notes?.message as string} InputLabelProps={{ shrink: true }} />
      <FormControlLabel control={<Switch checked={!!watch('active')} onChange={(_, v) => setValue('active', v, { shouldDirty: true, shouldValidate: true })} />} label="Active" />
    </Stack>
  );
});
