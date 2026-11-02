import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Stack, TextField, Typography } from '@mui/material';
import { Controller, useForm } from 'react-hook-form';
import api from '../../../api';
import { isDuplicateError } from '../../../utils/apiErrorMessage';
import StatusSwitch from '../../../components/fields/StatusSwitch';
import { STATUS_ENABLED, STATUS_DISABLED, StatusValue, deriveStatusFromDisabledAt, normalizeStatus } from '../../../constants/status';
import BusinessProcessCategoryMultiSelect from '../../../components/fields/BusinessProcessCategoryMultiSelect';
import UserSelect from '../../../components/fields/UserSelect';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

export type BusinessProcessCreateEditorHandle = {
  isDirty: () => boolean;
  save: () => Promise<string | null>;
  reset: () => void;
};

type Props = {
  onDirtyChange?: (dirty: boolean) => void;
  onManageCategoriesClick?: () => void;
};

type FormValues = {
  name: string;
  description: string;
  notes: string;
  status: StatusValue;
  category_ids: string[];
  owner_user_id: string | null;
  it_owner_user_id: string | null;
};

export default forwardRef<BusinessProcessCreateEditorHandle, Props>(function BusinessProcessCreateEditor(
  { onDirtyChange, onManageCategoriesClick },
  ref,
) {
  const [saving, setSaving] = React.useState(false);
  const { t } = useTranslation(['master-data', 'common']);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      name: '',
      description: '',
      notes: '',
      status: STATUS_ENABLED,
      category_ids: [],
      owner_user_id: null,
      it_owner_user_id: null,
    },
  });
  const { control, watch, formState, handleSubmit, reset } = form;

  useEffect(() => {
    onDirtyChange?.(formState.isDirty);
  }, [formState.isDirty, onDirtyChange]);

  const statusValue = watch('status');

  const onSubmit = handleSubmit(async (values) => {
    setSaving(true);
    setServerError(null);
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description.trim() ? values.description.trim() : null,
        notes: values.notes.trim() ? values.notes.trim() : null,
        // The status alone: disabled, the server sets the end of validity from its own clock.
        status: normalizeStatus(values.status),
        category_ids: values.category_ids || [],
        owner_user_id: values.owner_user_id || null,
        it_owner_user_id: values.it_owner_user_id || null,
      };
      const res = await api.post('/business-processes', payload);
      onDirtyChange?.(false);
      return String(res.data?.id ?? res.data?.uuid ?? null);
    } catch (e: any) {
      if (isDuplicateError(e)) {
        // A name another business process has: the reason shows under the name.
        form.setError('name', { type: 'server', message: t('businessProcesses.fields.nameTaken') });
      } else {
        const msg = getApiErrorMessage(e, t, t('shared.messages.failedToCreate', { entity: t('businessProcesses.entity') }));
        setServerError(msg);
      }
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
      reset: () => {
        reset(
          {
            name: '',
            description: '',
            notes: '',
            status: STATUS_ENABLED,
            category_ids: [],
            owner_user_id: null,
            it_owner_user_id: null,
          },
          { keepDirty: false, keepTouched: false },
        );
        onDirtyChange?.(false);
        setServerError(null);
      },
    }),
    [formState.isDirty, onSubmit, reset, onDirtyChange],
  );

  const disabled = saving;

  return (
    <Stack spacing={2}>
      {!!serverError && <Alert severity="error">{serverError}</Alert>}

      <Typography variant="subtitle2">{t('businessProcesses.sections.basicInfo')}</Typography>
      <Controller
        name="name"
        control={control}
        rules={{ required: t('businessProcesses.fields.nameRequired') }}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            label={t('shared.fields.name')}
            required
            error={!!fieldState.error}
            helperText={fieldState.error?.message || t('businessProcesses.fields.nameHelper')}
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
          />
        )}
      />
      <Controller
        name="description"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label={t('shared.fields.description')}
            multiline
            minRows={2}
            placeholder={t('businessProcesses.fields.descriptionPlaceholder')}
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
          />
        )}
      />
      <Controller
        name="status"
        control={control}
        render={({ field }) => (
          <StatusSwitch
            label={t('common:statuses.enabled')}
            offLabel={t('common:statuses.disabled')}
            value={normalizeStatus(statusValue ?? STATUS_ENABLED) === STATUS_ENABLED}
            onChange={(checked) => field.onChange(checked ? STATUS_ENABLED : STATUS_DISABLED)}
            disabled={disabled}
            helperText={t('businessProcesses.fields.statusHelper')}
          />
        )}
      />

      <Typography variant="subtitle2">{t('businessProcesses.sections.classification')}</Typography>
      <Controller
        name="category_ids"
        control={control}
        render={({ field }) => (
          <BusinessProcessCategoryMultiSelect
            value={field.value || []}
            onChange={(ids) => field.onChange(ids)}
            label={t('businessProcesses.fields.categories')}
            helperText={t('businessProcesses.fields.categoriesHelper')}
            disabled={disabled}
            onManageCategoriesClick={onManageCategoriesClick}
          />
        )}
      />
      <Controller
        name="owner_user_id"
        control={control}
        render={({ field }) => (
          <UserSelect
            label={t('businessProcesses.fields.processOwner')}
            value={field.value}
            onChange={(v) => field.onChange(v)}
            disabled={disabled}
            helperText={t('businessProcesses.fields.processOwnerHelper')}
          />
        )}
      />
      <Controller
        name="it_owner_user_id"
        control={control}
        render={({ field }) => (
          <UserSelect
            label={t('businessProcesses.fields.itOwner')}
            value={field.value}
            onChange={(v) => field.onChange(v)}
            disabled={disabled}
            helperText={t('businessProcesses.fields.itOwnerHelper')}
          />
        )}
      />

      <Typography variant="subtitle2">{t('businessProcesses.sections.details')}</Typography>
      <Controller
        name="notes"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label={t('shared.fields.notes')}
            multiline
            minRows={3}
            placeholder={t('businessProcesses.fields.notesPlaceholder')}
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
          />
        )}
      />
    </Stack>
  );
});
