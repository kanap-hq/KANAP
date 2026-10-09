import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Stack, TextField, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Controller } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../../api';
import useZodForm from '../../../hooks/useZodForm';
import StatusLifecycleField from '../../../components/fields/StatusLifecycleField';
import { accountFormSchema, AccountFormValues } from '../../forms/AccountForm';
import { z } from 'zod';
import { ACCOUNT_NATURES, accountNatureLabel, parseAccountNature } from '../../../constants/accountNature';
import { STATUS_ENABLED, deriveStatusFromDisabledAt, normalizeDisabledAtInput } from '../../../constants/status';

export type AccountOverviewEditorHandle = {
  isDirty: () => boolean;
  save: () => Promise<void>;
  reset: () => void;
};

type Props = {
  id: string;
  onDirtyChange?: (dirty: boolean) => void;
  readOnly?: boolean;
  basePath?: string; // API base path, defaults to '/accounts'
};

type AccountUpdateFormValues = AccountFormValues & { coa_id: string };

const DEFAULT_VALUES: AccountUpdateFormValues = {
  account_number: 0,
  account_name: '',
  native_name: null,
  description: null,
  consolidation_account_number: null,
  consolidation_account_name: null,
  consolidation_account_description: null,
  nature: null,
  status: STATUS_ENABLED,
  disabled_at: null,
  coa_id: '',
};

function toFormValues(data: any): AccountUpdateFormValues {
  const disabledAt = normalizeDisabledAtInput(data?.disabled_at);
  const status = deriveStatusFromDisabledAt(disabledAt);
  const toIntOrNull = (v: any): number | null => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  return {
    account_number: Number.isInteger(Number(data?.account_number)) ? Number(data?.account_number) : 0,
    account_name: data?.account_name ?? '',
    native_name: data?.native_name ?? null,
    description: data?.description ?? null,
    consolidation_account_number: toIntOrNull(data?.consolidation_account_number),
    consolidation_account_name: data?.consolidation_account_name ?? null,
    consolidation_account_description: data?.consolidation_account_description ?? null,
    nature: parseAccountNature(data?.nature),
    status,
    disabled_at: disabledAt,
    coa_id: data?.coa_id ?? '',
  };
}

function normalizeEmptyToNull<T extends Record<string, any>>(obj: T): T {
  const out: any = Array.isArray(obj) ? [] : {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === '') out[k] = null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = normalizeEmptyToNull(v as any);
    else out[k] = v;
  });
  return out;
}

const toPayload = (values: AccountUpdateFormValues) => {
  const disabled_at = values.disabled_at ?? null;
  const base = {
    ...values,
    status: deriveStatusFromDisabledAt(disabled_at),
    disabled_at,
  };
  return normalizeEmptyToNull(base);
};

const accountUpdateFormSchema = accountFormSchema.extend({
  coa_id: z.string().min(1, 'Chart of Accounts is required'),
});

export default forwardRef<AccountOverviewEditorHandle, Props>(function AccountOverviewEditor(
  { id, onDirtyChange, readOnly = false, basePath = '/accounts' },
  ref,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['master-data', 'common']);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useZodForm<AccountUpdateFormValues>({
    schema: accountUpdateFormSchema,
    defaultValues: DEFAULT_VALUES,
  });
  const { register, control, formState, reset, handleSubmit, setValue, watch } = form;

  const [coas, setCoas] = React.useState<Array<{ id: string; label: string }>>([]);
  const [loadingCoas, setLoadingCoas] = React.useState(false);
  const [loadCoasError, setLoadCoasError] = React.useState<string | null>(null);

  const baselineRef = React.useRef<AccountUpdateFormValues>({ ...DEFAULT_VALUES });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setServerError(null);
      try {
        const res = await api.get(`${basePath}/${id}`);
        if (!active) return;
        const values = toFormValues(res.data);
        baselineRef.current = { ...values };
        reset(values, { keepDirty: false, keepTouched: false });
        onDirtyChange?.(false);
        // Load CoAs (after account so we can show selection correctly)
        try {
          setLoadingCoas(true);
          const coasRes = await api.get('/chart-of-accounts', { params: { page: 1, limit: 1000 } });
          if (!active) return;
          const items: any[] = coasRes.data?.items || [];
          setCoas(items.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` })));
        } catch (e: any) {
          if (!active) return;
          setLoadCoasError(e?.response?.data?.message || e?.message || t('accounts.fields.loadCoAsError'));
        } finally {
          if (active) setLoadingCoas(false);
        }
      } catch (e: any) {
        if (!active) return;
        const msg = e?.response?.data?.message || e?.message || t('shared.messages.failedToLoad', { entity: t('accounts.entity') });
        setServerError(msg);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [id, onDirtyChange, reset]);

  useEffect(() => {
    onDirtyChange?.(formState.isDirty);
  }, [formState.isDirty, onDirtyChange]);

  const disabled = loading || saving || readOnly;
  const statusValue = watch('status');
  const disabledAtValue = watch('disabled_at');
  const err = formState.errors as any;

  const onSubmit = handleSubmit(async (values) => {
    if (readOnly) return;
    setSaving(true);
    setServerError(null);
    try {
      await api.patch(`${basePath}/${id}`, toPayload(values));
      baselineRef.current = { ...values };
      onDirtyChange?.(false);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['accounts', id] });
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || t('shared.messages.failedToSave', { entity: t('accounts.entity') });
      setServerError(msg);
      throw e;
    } finally {
      setSaving(false);
    }
  });

  useImperativeHandle(
    ref,
    () => ({
      isDirty: () => formState.isDirty,
      save: async () => { await onSubmit(); },
      reset: () => { reset(baselineRef.current, { keepDirty: false, keepTouched: false }); onDirtyChange?.(false); setServerError(null); },
    }),
    [formState.isDirty, onSubmit, reset, onDirtyChange],
  );

  return (
    <Stack spacing={2}>
      {!!serverError && <Alert severity="error">{serverError}</Alert>}
      {readOnly && (
        <Alert severity="info">{t('shared.messages.readOnlyAccess', { entity: t('accounts.entity') + 's' })}</Alert>
      )}
      <FormControl fullWidth>
        <InputLabel id="coa-select-label" required>Chart of Accounts</InputLabel>
        <Controller
          control={control}
          name="coa_id"
          rules={{ required: 'Chart of Accounts is required' }}
          render={({ field }) => (
            <Select
              labelId="coa-select-label"
              label="Chart of Accounts"
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              error={!!(err as any).coa_id}
              disabled={disabled}
            >
              <MenuItem value="" disabled>
                {loadingCoas ? 'Loading…' : 'Select a CoA'}
              </MenuItem>
              {coas.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
              ))}
            </Select>
          )}
        />
        {loadCoasError && <Alert severity="error" sx={{ mt: 1 }}>{loadCoasError}</Alert>}
      </FormControl>
      <TextField
        label="Account Number"
        required
        type="number"
        {...register('account_number', { valueAsNumber: true })}
        error={!!err.account_number}
        helperText={err.account_number?.message as string}
        disabled={disabled}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Account Name"
        required
        {...register('account_name')}
        error={!!err.account_name}
        helperText={err.account_name?.message as string}
        disabled={disabled}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Native Name (local language)"
        {...register('native_name')}
        error={!!err.native_name}
        helperText={err.native_name?.message as string}
        disabled={disabled}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Description"
        {...register('description')}
        error={!!err.description}
        helperText={err.description?.message as string}
        disabled={disabled}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Consolidation Account Number"
        type="number"
        {...register('consolidation_account_number', { valueAsNumber: true })}
        error={!!err.consolidation_account_number}
        helperText={err.consolidation_account_number?.message as string}
        disabled={disabled}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Consolidation Account Name"
        {...register('consolidation_account_name')}
        error={!!err.consolidation_account_name}
        helperText={err.consolidation_account_name?.message as string}
        disabled={disabled}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Consolidation Account Description"
        {...register('consolidation_account_description')}
        error={!!err.consolidation_account_description}
        helperText={err.consolidation_account_description?.message as string}
        disabled={disabled}
        InputLabelProps={{ shrink: true }}
      />
      <Controller
        control={control}
        name="nature"
        render={({ field }) => (
          <TextField
            select
            label={t('accounts.fields.nature')}
            value={field.value ?? ''}
            onChange={(e) => field.onChange(parseAccountNature(e.target.value))}
            error={!!err.nature}
            helperText={err.nature?.message as string}
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
            disabled={disabled}
          >
            {[null, ...ACCOUNT_NATURES].map((nature) => (
              <MenuItem key={nature ?? 'both'} value={nature ?? ''}>{accountNatureLabel(t, nature)}</MenuItem>
            ))}
          </TextField>
        )}
      />
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <StatusLifecycleField
            status={field.value ?? STATUS_ENABLED}
            onStatusChange={(next) => field.onChange(next)}
            disabledAt={disabledAtValue ?? null}
            onDisabledAtChange={(next) => setValue('disabled_at', next, {
              shouldDirty: true,
              shouldValidate: true,
            })}
            statusName={field.name}
            statusError={!!err.status}
            statusHelperText={err.status?.message as string}
            disabledAtName="disabled_at"
            disabledAtError={!!err.disabled_at}
            disabledAtHelperText={err.disabled_at?.message as string}
            disabled={disabled}
          />
        )}
      />
    </Stack>
  );
});
