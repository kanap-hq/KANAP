import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Stack, TextField, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Controller } from 'react-hook-form';
import api from '../../../api';
import useZodForm from '../../../hooks/useZodForm';
import StatusLifecycleField from '../../../components/fields/StatusLifecycleField';
import { accountFormSchema, AccountFormValues } from '../../forms/AccountForm';
import { z } from 'zod';
import { ACCOUNT_NATURES, accountNatureLabel, parseAccountNature } from '../../../constants/accountNature';
import { STATUS_ENABLED, deriveStatusFromDisabledAt } from '../../../constants/status';

export type AccountCreateEditorHandle = {
  isDirty: () => boolean;
  save: () => Promise<string | null>;
  reset: () => void;
};

type Props = {
  onDirtyChange?: (dirty: boolean) => void;
  basePath?: string; // API base path, defaults to '/accounts'
  extractCreatedId?: (data: any) => string | null; // custom id extraction from response
};

type AccountCreateFormValues = AccountFormValues & { coa_id: string };

const DEFAULT_VALUES: AccountCreateFormValues = {
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

const accountCreateFormSchema = accountFormSchema.extend({
  coa_id: z.string().min(1, 'Chart of Accounts is required'),
});

function normalizeEmptyToNull<T extends Record<string, any>>(obj: T): T {
  const out: any = Array.isArray(obj) ? [] : {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === '') out[k] = null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = normalizeEmptyToNull(v as any);
    else out[k] = v;
  });
  return out;
}

const toPayload = (values: AccountCreateFormValues) => {
  const disabled_at = values.disabled_at ?? null;
  const base = {
    ...values,
    status: deriveStatusFromDisabledAt(disabled_at),
    disabled_at,
  };
  return normalizeEmptyToNull(base);
};

export default forwardRef<AccountCreateEditorHandle, Props>(function AccountCreateEditor(
  { onDirtyChange, basePath = '/accounts', extractCreatedId },
  ref,
) {
  const [saving, setSaving] = React.useState(false);
  const { t } = useTranslation(['master-data', 'common']);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useZodForm<AccountCreateFormValues>({
    schema: accountCreateFormSchema,
    defaultValues: DEFAULT_VALUES,
  });
  const { register, control, formState, handleSubmit, setValue, watch, reset } = form;

  // Load CoAs for selection and preselect from ?selected or ?coaId when present
  const [coas, setCoas] = React.useState<Array<{ id: string; label: string }>>([]);
  const [loadingCoas, setLoadingCoas] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoadingCoas(true);
      setLoadError(null);
      try {
        const url = new URL(window.location.href);
        const coaIdParam = url.searchParams.get('selected') || url.searchParams.get('coaId') || '';
        const res = await api.get('/chart-of-accounts', { params: { page: 1, limit: 1000 } });
        if (!active) return;
        const items: any[] = res.data?.items || [];
        const mapped = items.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }));
        setCoas(mapped);
        if (coaIdParam && mapped.some((c) => c.id === coaIdParam)) {
          setValue('coa_id', coaIdParam, { shouldDirty: true, shouldValidate: true });
        }
      } catch (e: any) {
        if (!active) return;
        setLoadError(e?.response?.data?.message || e?.message || t('accounts.fields.loadCoAsError'));
      } finally {
        if (active) setLoadingCoas(false);
      }
    };
    void init();
    return () => { active = false; };
  }, [setValue]);

  useEffect(() => {
    onDirtyChange?.(formState.isDirty);
  }, [formState.isDirty, onDirtyChange]);

  const statusValue = watch('status');
  const disabledAtValue = watch('disabled_at');
  const err = formState.errors as any;

  const onSubmit = handleSubmit(async (values) => {
    setSaving(true);
    setServerError(null);
    try {
      const res = await api.post(basePath, toPayload(values));
      onDirtyChange?.(false);
      if (extractCreatedId) return extractCreatedId(res.data);
      return String(res.data?.id ?? res.data?.uuid ?? null);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || t('shared.messages.failedToCreate', { entity: t('accounts.entity') });
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
      save: async () => (await onSubmit()) as any,
      reset: () => { reset(DEFAULT_VALUES, { keepDirty: false, keepTouched: false }); onDirtyChange?.(false); setServerError(null); },
    }),
    [formState.isDirty, onSubmit, reset, onDirtyChange],
  );

  return (
    <Stack spacing={2}>
      {!!serverError && <Alert severity="error">{serverError}</Alert>}
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
      </FormControl>
      {loadError && <Alert severity="error">{loadError}</Alert>}

      <TextField
        label="Account Number"
        required
        type="number"
        {...register('account_number', { valueAsNumber: true })}
        error={!!err.account_number}
        helperText={err.account_number?.message as string}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Account Name"
        required
        {...register('account_name')}
        error={!!err.account_name}
        helperText={err.account_name?.message as string}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Native Name (local language)"
        {...register('native_name')}
        error={!!err.native_name}
        helperText={err.native_name?.message as string}
        InputLabelProps={{ shrink: true }}
      />
      <TextField label="Description" {...register('description')} InputLabelProps={{ shrink: true }} />
      <TextField
        label="Consolidation Account Number"
        type="number"
        {...register('consolidation_account_number', { valueAsNumber: true })}
        InputLabelProps={{ shrink: true }}
      />
      <TextField label="Consolidation Account Name" {...register('consolidation_account_name')} InputLabelProps={{ shrink: true }} />
      <TextField label="Consolidation Account Description" {...register('consolidation_account_description')} InputLabelProps={{ shrink: true }} />
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
          />
        )}
      />
    </Stack>
  );
});
