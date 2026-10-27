import React, { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';
import { Box, Stack, TextField, Typography } from '@mui/material';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import useZodForm from '../../hooks/useZodForm';
import FormErrorAlert from '../../components/forms/FormErrorAlert';
import CompanySelect from '../../components/fields/CompanySelect';
import DepartmentSelect from '../../components/fields/DepartmentSelect';
import MultiRoleSelect from '../../components/fields/MultiRoleSelect';
import StatusSwitch from '../../components/fields/StatusSwitch';
import { PropertyRow } from '../../components/design';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';

const optStr = (schema = z.string()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return null;
    const result = schema.safeParse(v);
    return result.success ? result.data : null;
  }, z.string().nullable());

export function createUserFormSchema(t: TFunction) {
  const emailSchema = z
    .string()
    .trim()
    .regex(/^[^@\s]+@[^@\s]+$/, t('validation:invalidEmail'))
    .or(z.string().email(t('validation:invalidEmail')));

  return z.object({
    email: emailSchema,
    first_name: optStr(),
    last_name: optStr(),
    job_title: optStr(z.string().max(200)),
    business_phone: optStr(z.string().max(50)),
    mobile_phone: optStr(z.string().max(50)),
    role_ids: z.array(z.string().uuid()).default([]),
    company_id: optStr(z.string().uuid()),
    department_id: optStr(z.string().uuid()),
    status: z.boolean().default(true),
  });
}

export type UserFormValues = z.infer<ReturnType<typeof createUserFormSchema>>;
export type UserInput = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  business_phone?: string | null;
  mobile_phone?: string | null;
  role_ids: string[];
  company_id?: string | null;
  department_id?: string | null;
  status: string;
  external_auth_provider?: string | null;
};

export type UserFormIntent = 'save' | 'save-invite';
export type UserFormHandle = {
  /** Validates and submits the identity; false when it is invalid or the save was refused. */
  submit: (intent: UserFormIntent) => Promise<boolean>;
};

function normalizeEmptyToNull<T extends Record<string, any>>(obj: T): T {
  const out: any = Array.isArray(obj) ? [] : {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === '') out[k] = null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = normalizeEmptyToNull(v as any);
    else out[k] = v;
  });
  return out;
}

/** The dialog's fields fill their column: the two-column rows and the full-width rows stay aligned. */
const fieldValueSx = { maxWidth: 'none' } as const;

/** First and last name, business and mobile phone: side by side on a desktop, stacked on a phone. */
const twoColumnsSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
  columnGap: 1.5,
  rowGap: 0.5,
} as const;

/**
 * The identity of a user (spec §7.4): every directory field with its own validation, the roles,
 * the company and department, and the enabled switch. Rendered inside the user dialog's form, so it
 * takes no `<form>` of its own and submits through `UserFormHandle.submit`.
 */
const UserForm = forwardRef<UserFormHandle, {
  defaultValues?: Partial<UserInput> | Partial<UserFormValues>;
  onSubmit: (data: UserInput, intent: UserFormIntent) => boolean | Promise<boolean>;
  serverError?: unknown;
  onStateChange?: (s: { isDirty: boolean; isValid: boolean; isSubmitting: boolean }) => void;
  managedByEntra?: boolean;
}>(function UserForm({
  defaultValues,
  onSubmit,
  serverError,
  onStateChange,
  managedByEntra = false,
}, ref) {
  const { t } = useTranslation(['admin', 'validation']);
  const locale = useLocale();
  const syncedAt = (defaultValues as any)?.external_synced_at as string | null | undefined;
  const resolvedDefaults = useMemo(() => {
    const d: any = { ...(defaultValues ?? {}) };
    if (typeof d.status === 'string') d.status = d.status === 'enabled';
    if (typeof d.status !== 'boolean') d.status = true;
    // Handle multi-role: convert from roles array or legacy role_id
    if (!d.role_ids || !Array.isArray(d.role_ids) || d.role_ids.length === 0) {
      // Try to get from roles array (from API)
      if (Array.isArray(d.roles) && d.roles.length > 0) {
        d.role_ids = d.roles.map((r: any) => r.id);
      } else if (d.role_id || d.role?.id) {
        // Legacy single role
        const roleId = d.role_id || d.role?.id;
        d.role_ids = roleId ? [roleId] : [];
      } else {
        d.role_ids = [];
      }
    }
    return d;
  }, [defaultValues]);
  const schema = useMemo(() => createUserFormSchema(t), [t]);
  const methods = useZodForm<UserFormValues>({ schema, defaultValues: resolvedDefaults as any });
  const { register, handleSubmit, formState, watch, control, reset } = methods;

  // Reset when the person changes. Validating here would show "required" under the email of a
  // new user before anything is typed. isValid is still computed on mount, without those messages,
  // so Save stays disabled until the email is valid and enables after an edit.
  useEffect(() => {
    reset(resolvedDefaults as any);
  }, [reset, resolvedDefaults]);

  useEffect(() => {
    onStateChange?.({ isDirty: formState.isDirty, isValid: formState.isValid, isSubmitting: formState.isSubmitting });
  }, [formState.isDirty, formState.isValid, formState.isSubmitting, onStateChange]);

  const submit = useMemo(
    () => (intent: UserFormIntent) => new Promise<boolean>((resolve) => {
      void handleSubmit(async (values) => {
        const payload = normalizeEmptyToNull({
          ...values,
          status: values.status ? 'enabled' : 'disabled',
        });
        let ok = false;
        try {
          ok = (await onSubmit(payload as UserInput, intent)) !== false;
          if (ok) reset(values);
        } finally {
          resolve(ok);
        }
      }, () => resolve(false))();
    }),
    [handleSubmit, onSubmit, reset],
  );
  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const err = formState.errors as any;
  const selectedCompanyId = watch('company_id') as string | null | undefined;

  return (
    <Box>
      <FormErrorAlert error={serverError} />
      <Stack spacing={1.5}>
        {managedByEntra && (
          <Typography variant="caption" color="text.secondary">
            {t('userForm.entraManagedHint')}
            {syncedAt ? ` ${t('userForm.entraSyncedAt', { date: formatShortDateTime(syncedAt, locale) })}` : ''}
          </Typography>
        )}
        <PropertyRow label={t('userForm.fields.email')} required valueSx={fieldValueSx}>
          <TextField
            variant="standard"
            fullWidth
            {...register('email')}
            error={!!err.email}
            helperText={err.email?.message as string}
            autoComplete="email"
            inputProps={{ 'aria-label': t('userForm.fields.email'), 'aria-required': true }}
            disabled={managedByEntra}
          />
        </PropertyRow>
        <Box sx={twoColumnsSx}>
          <PropertyRow label={t('userForm.fields.firstName')} valueSx={fieldValueSx}>
            <TextField
              variant="standard"
              fullWidth
              {...register('first_name')}
              autoComplete="off"
              inputProps={{ 'aria-label': t('userForm.fields.firstName') }}
              disabled={managedByEntra}
            />
          </PropertyRow>
          <PropertyRow label={t('userForm.fields.lastName')} valueSx={fieldValueSx}>
            <TextField
              variant="standard"
              fullWidth
              {...register('last_name')}
              autoComplete="off"
              inputProps={{ 'aria-label': t('userForm.fields.lastName') }}
              disabled={managedByEntra}
            />
          </PropertyRow>
        </Box>
        <PropertyRow label={t('userForm.fields.jobTitle')} valueSx={fieldValueSx}>
          <TextField
            variant="standard"
            fullWidth
            {...register('job_title')}
            autoComplete="organization-title"
            inputProps={{ 'aria-label': t('userForm.fields.jobTitle') }}
            disabled={managedByEntra}
          />
        </PropertyRow>
        <Box sx={twoColumnsSx}>
          <PropertyRow label={t('userForm.fields.businessPhone')} valueSx={fieldValueSx}>
            <TextField
              variant="standard"
              fullWidth
              {...register('business_phone')}
              autoComplete="tel"
              inputProps={{ 'aria-label': t('userForm.fields.businessPhone') }}
              disabled={managedByEntra}
            />
          </PropertyRow>
          <PropertyRow label={t('userForm.fields.mobilePhone')} valueSx={fieldValueSx}>
            <TextField
              variant="standard"
              fullWidth
              {...register('mobile_phone')}
              autoComplete="tel-national"
              inputProps={{ 'aria-label': t('userForm.fields.mobilePhone') }}
              disabled={managedByEntra}
            />
          </PropertyRow>
        </Box>
        <PropertyRow label={t('userForm.fields.roles')} valueSx={fieldValueSx}>
          <Controller
            control={control}
            name="role_ids"
            render={({ field }) => (
              <MultiRoleSelect
                hideLabel
                label={t('userForm.fields.roles')}
                value={field.value ?? []}
                onChange={(v) => field.onChange(v)}
                error={!!err.role_ids}
                helperText={(err.role_ids?.message as string)
                  || (((field.value ?? []) as string[]).length === 0 ? t('userForm.fields.rolesEmptyHint') : '')}
              />
            )}
          />
        </PropertyRow>
        <PropertyRow label={t('userForm.fields.companyOptional')} valueSx={fieldValueSx}>
          <Controller
            control={control}
            name="company_id"
            render={({ field }) => (
              <CompanySelect
                hideLabel
                label={t('userForm.fields.companyOptional')}
                value={field.value as any}
                onChange={(v) => field.onChange(v)}
                helperText=""
              />
            )}
          />
        </PropertyRow>
        <PropertyRow label={t('userForm.fields.departmentOptional')} valueSx={fieldValueSx}>
          <Controller
            control={control}
            name="department_id"
            render={({ field }) => (
              <DepartmentSelect
                hideLabel
                label={t('userForm.fields.departmentOptional')}
                companyId={selectedCompanyId || undefined}
                value={field.value as any}
                onChange={(v) => field.onChange(v)}
                helperText=""
              />
            )}
          />
        </PropertyRow>
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <StatusSwitch
              label={t('userForm.fields.enabled')}
              offLabel={t('common:statuses.disabled')}
              value={!!field.value}
              onChange={(v) => field.onChange(v)}
              error={!!err.status}
              helperText={err.status?.message as string}
              name={field.name}
            />
          )}
        />
      </Stack>
    </Box>
  );
});

export default UserForm;
