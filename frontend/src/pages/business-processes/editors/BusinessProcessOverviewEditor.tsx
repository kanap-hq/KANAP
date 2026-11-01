import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Stack, TextField, Typography } from '@mui/material';
import { Controller, useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../../api';
import { isDuplicateError } from '../../../utils/apiErrorMessage';
import {
  STATUS_ENABLED,
  STATUS_DISABLED,
  StatusValue,
  normalizeStatus,
} from '../../../constants/status';
import BusinessProcessCategoryMultiSelect from '../../../components/fields/BusinessProcessCategoryMultiSelect';
import UserSelect from '../../../components/fields/UserSelect';
import StatusSwitch from '../../../components/fields/StatusSwitch';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

export type BusinessProcessOverviewEditorHandle = {
  isDirty: () => boolean;
  save: () => Promise<void>;
  reset: () => void;
};

type Props = {
  id: string;
  onDirtyChange?: (dirty: boolean) => void;
  readOnly?: boolean;
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

export default forwardRef<BusinessProcessOverviewEditorHandle, Props>(function BusinessProcessOverviewEditor(
  { id, onDirtyChange, readOnly = false, onManageCategoriesClick },
  ref,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['master-data', 'common']);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
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
  const { control, watch, reset, formState, handleSubmit } = form;
  // The status as loaded or last saved: an unchanged status is not sent.
  const loadedStatusRef = React.useRef<StatusValue>(STATUS_ENABLED);

  useEffect(() => {
    onDirtyChange?.(formState.isDirty);
  }, [formState.isDirty, onDirtyChange]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setServerError(null);
      try {
        const res = await api.get(`/business-processes/${id}`);
        if (!active) return;
        const d = res.data;
        loadedStatusRef.current = normalizeStatus(d?.status);
        reset(
          {
            name: d?.name ?? '',
            description: d?.description ?? '',
            notes: d?.notes ?? '',
            status: normalizeStatus(d?.status),
            category_ids: Array.isArray(d?.categories) ? d.categories.map((c: any) => c.id) : [],
            owner_user_id: d?.owner_user_id ?? null,
            it_owner_user_id: d?.it_owner_user_id ?? null,
          },
          { keepDirty: false, keepTouched: false },
        );
        onDirtyChange?.(false);
      } catch (e: any) {
        if (!active) return;
        const msg = getApiErrorMessage(e, t, t('shared.messages.failedToLoad', { entity: t('businessProcesses.entity') }));
        setServerError(msg);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [id, onDirtyChange, reset]);

  const disabled = loading || saving || readOnly;
  const statusValue = watch('status');

  const onSubmit = handleSubmit(async (values) => {
    if (readOnly) return;
    setSaving(true);
    setServerError(null);
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description.trim() ? values.description.trim() : null,
        notes: values.notes.trim() ? values.notes.trim() : null,
        // The status goes only when it changed, alone: the server keeps the end of validity
        // otherwise, and sets it from its own clock when disabling.
        ...(normalizeStatus(values.status) !== loadedStatusRef.current ? { status: normalizeStatus(values.status) } : {}),
        category_ids: values.category_ids || [],
        owner_user_id: values.owner_user_id || null,
        it_owner_user_id: values.it_owner_user_id || null,
      };
      await api.patch(`/business-processes/${id}`, payload);
      loadedStatusRef.current = normalizeStatus(values.status);
      onDirtyChange?.(false);
      queryClient.invalidateQueries({ queryKey: ['business-processes'] });
      queryClient.invalidateQueries({ queryKey: ['business-processes', id] });
    } catch (e: any) {
      if (isDuplicateError(e)) {
        // A name another business process has: the reason shows under the name.
        form.setError('name', { type: 'server', message: t('businessProcesses.fields.nameTaken') });
      } else {
        const msg = getApiErrorMessage(e, t, t('shared.messages.failedToSave', { entity: t('businessProcesses.entity') }));
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
      save: async () => {
        await onSubmit();
      },
      reset: () => {
        form.reset(undefined, { keepDirty: false, keepTouched: false });
        onDirtyChange?.(false);
        setServerError(null);
      },
    }),
    [form, formState.isDirty, onSubmit, onDirtyChange],
  );

  return (
    <Stack spacing={2}>
      {!!serverError && <Alert severity="error">{serverError}</Alert>}
      {readOnly && (
        <Alert severity="info">{t('shared.messages.readOnlyAccess', { entity: t('businessProcesses.title').toLowerCase() })}</Alert>
      )}

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
