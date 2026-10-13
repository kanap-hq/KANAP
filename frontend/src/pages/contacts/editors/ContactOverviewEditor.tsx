import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Autocomplete, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import { Controller } from 'react-hook-form';
import useZodForm from '../../../hooks/useZodForm';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../../api';
import { createContactFormSchema, ContactFormValues, SUPPLIER_CONTACT_ROLE_OPTIONS } from '../../forms/ContactForm';
import { COUNTRY_OPTIONS, CountryOption } from '../../../constants/isoOptions';
import { DIAL_CODES } from '../../../constants/dialCodes';
import { combineDialCode, normalizeDialCode, splitPhone, guessCountryFromDialCode } from '../../../lib/phoneUtils';
import SupplierSelect from '../../../components/fields/SupplierSelect';

export type ContactOverviewEditorHandle = {
  isDirty: () => boolean;
  /** Resolves true once saved, false when the form is invalid; rejects on a server error. */
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

function toFormValues(data: any): ContactFormValues {
  return {
    first_name: data?.first_name ?? null,
    last_name: data?.last_name ?? null,
    job_title: data?.job_title ?? null,
    email: data?.email ?? '',
    phone: data?.phone ?? null,
    mobile: data?.mobile ?? null,
    country: data?.country ?? null,
    supplier_id: data?.supplier_id ?? null,
    supplier_role: data?.supplier_role ?? null,
    notes: data?.notes ?? null,
    active: !!data?.active,
  };
}

export default forwardRef<ContactOverviewEditorHandle, { id: string; onDirtyChange?: (dirty: boolean) => void; readOnly?: boolean }>(function ContactOverviewEditor(
  { id, onDirtyChange, readOnly = false },
  ref,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['master-data', 'common']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = useMemo(() => createContactFormSchema(t), [t]);
  const form = useZodForm<ContactFormValues>({ schema, defaultValues: DEFAULT_VALUES });
  const { register, formState, reset, handleSubmit, setValue, watch } = form;
  const err = formState.errors as any;
  const supplierId = watch('supplier_id');

  const baselineRef = useRef<ContactFormValues>({ ...DEFAULT_VALUES });
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

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setServerError(null);
      try {
        const res = await api.get(`/contacts/${id}`);
        if (!active) return;
        const values = toFormValues(res.data);
        baselineRef.current = { ...values };
        reset(values, { keepDirty: false, keepTouched: false });
        refreshDialState();
        onDirtyChange?.(false);
      } catch (e: any) {
        if (!active) return;
        const msg = e?.response?.data?.message || e?.message || t('shared.messages.failedToLoad', { entity: t('contacts.entity') });
        setServerError(msg);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [id, onDirtyChange, reset]);

  useEffect(() => { onDirtyChange?.(formState.isDirty); }, [formState.isDirty, onDirtyChange]);

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
    if (readOnly) return false;
    setSaving(true);
    setServerError(null);
    try {
      await api.patch(`/contacts/${id}`, values);
      baselineRef.current = { ...values };
      onDirtyChange?.(false);
      // Invalidate supplier-contact link caches so supplier pages refresh contact info immediately
      try { await queryClient.invalidateQueries({ queryKey: ['supplier-contacts'], exact: false }); } catch {}
      return true;
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || t('shared.messages.failedToSave', { entity: t('contacts.entity') });
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
      reset(baselineRef.current, { keepDirty: false, keepTouched: false });
      refreshDialState();
      onDirtyChange?.(false);
      setServerError(null);
    },
  }), [formState.isDirty, onSubmit, reset, onDirtyChange]);

  const disabled = loading || saving || readOnly;

  return (
    <Stack spacing={2}>
      {!!serverError && <Alert severity="error">{serverError}</Alert>}
      <TextField label="Email" required {...register('email')} error={!!err.email} helperText={err.email?.message as string} disabled={disabled} InputLabelProps={{ shrink: true }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label="First name" {...register('first_name')} error={!!err.first_name} helperText={err.first_name?.message as string} disabled={disabled} InputLabelProps={{ shrink: true }} />
        <TextField label="Last name" {...register('last_name')} error={!!err.last_name} helperText={err.last_name?.message as string} disabled={disabled} InputLabelProps={{ shrink: true }} />
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
            disabled={disabled}
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
            disabled={disabled || !supplierId}
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
      <TextField label="Job title" {...register('job_title')} error={!!err.job_title} helperText={err.job_title?.message as string} disabled={disabled} InputLabelProps={{ shrink: true }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Autocomplete
          options={DIAL_CODES}
          disabled={disabled}
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
          disabled={disabled}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Autocomplete
          options={DIAL_CODES}
          disabled={disabled}
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
          disabled={disabled}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>
      <Controller
        control={form.control}
        name="country"
        render={({ field }) => {
          const v = typeof field.value === 'string' ? field.value.toUpperCase() : '';
          const selected: CountryOption | null = COUNTRY_OPTIONS.find((o) => o.code === v) ?? (v ? { code: v, name: 'Unknown country code' } : null);
          return (
            <Autocomplete<CountryOption, false, false, false>
              options={COUNTRY_OPTIONS}
              value={selected as any}
              disabled={disabled}
              onChange={(_, option) => field.onChange(option?.code ?? null)}
              getOptionLabel={(o) => `${o.code} — ${o.name}`}
              isOptionEqualToValue={(a, b) => a.code === b.code}
              renderInput={(params) => (
                <TextField {...params} label="Country" placeholder="Search by name or code" error={!!err.country} helperText={err.country?.message as string} />
              )}
            />
          );
        }}
      />
      <TextField label="Notes" multiline minRows={2} {...register('notes')} error={!!err.notes} helperText={err.notes?.message as string} disabled={disabled} InputLabelProps={{ shrink: true }} />
      <FormControlLabel control={<Switch checked={!!watch('active')} onChange={(_, v) => setValue('active', v, { shouldDirty: true, shouldValidate: true })} />} label="Active" />
    </Stack>
  );
});
