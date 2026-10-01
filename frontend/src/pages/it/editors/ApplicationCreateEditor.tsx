import { classificationText } from '../../../utils/applicationClassification';
import React, { forwardRef, useImperativeHandle } from 'react';
import { Alert, Box, Stack, TextField, Divider, Typography } from '@mui/material';
import SupplierSelect from '../../../components/fields/SupplierSelect';
import EnumAutocomplete from '../../../components/fields/EnumAutocomplete';
import DateEUField from '../../../components/fields/DateEUField';
import api from '../../../api';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { PropertyRow } from '../../../components/design';
import { drawerFieldValueSx } from '../../../theme/formSx';

import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
export type ApplicationCreateEditorHandle = {
  isDirty: () => boolean;
  save: () => Promise<string | null>;
  reset: () => void;
};

type Props = { onDirtyChange?: (dirty: boolean) => void };

export default forwardRef<ApplicationCreateEditorHandle, Props>(function ApplicationCreateEditor({ onDirtyChange }, ref) {
  const { t } = useTranslation(['it', 'common']);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  const [name, setName] = React.useState('');
  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<string>('');
  const [editor, setEditor] = React.useState('');
  const [retiredDate, setRetiredDate] = React.useState('');
  const [lifecycle, setLifecycle] = React.useState<string>('active');
  const [criticality, setCriticality] = React.useState<string | null>(null);
  const [cyberCriticality, setCyberCriticality] = React.useState<string | null>(null);
  const [recoveryWave, setRecoveryWave] = React.useState<string | null>(null);
  const [dataClass, setDataClass] = React.useState<string | null>(null);
  const [isSuite, setIsSuite] = React.useState(false);
  const [version, setVersion] = React.useState('');
  const [goLiveDate, setGoLiveDate] = React.useState('');
  const [endOfSupportDate, setEndOfSupportDate] = React.useState('');
  const { byField } = useItOpsEnumOptions();
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const categoryOptions = React.useMemo(
    () => byField.applicationCategory
      .filter((option) => !option.deprecated)
      .map((option) => ({ label: option.label, value: option.code })),
    [byField.applicationCategory],
  );
  const defaultCategory = categoryOptions[0]?.value || '';
  const lifecycleOptions = React.useMemo(() => {
    const list = byField.lifecycleStatus || [];
    const options = list.map((item) => ({
      value: item.code,
      label: item.deprecated ? t('common.deprecatedOption', { label: item.label }) : item.label,
      deprecated: !!item.deprecated,
    }));
    if (lifecycle && !options.some((opt) => opt.value === lifecycle)) {
      options.push({ value: lifecycle, label: lifecycle, deprecated: false });
    }
    return options.filter((opt) => !opt.deprecated || opt.value === lifecycle);
  }, [byField.lifecycleStatus, lifecycle, t]);

  React.useEffect(() => {
    if (!category && defaultCategory) {
      setCategory(defaultCategory);
    }
  }, [category, defaultCategory]);

  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const markDirty = React.useCallback(() => setDirty(true), []);

  const reset = React.useCallback(() => {
    setName('');
    setSupplierId(null);
    setDescription('');
    setCategory(defaultCategory);
    setEditor('');
    setRetiredDate('');
    setLifecycle('active');
    setCriticality(null);
    setCyberCriticality(null);
    setRecoveryWave(null);
    setDataClass(null);
    setIsSuite(false);
    setVersion('');
    setGoLiveDate('');
    setEndOfSupportDate('');
    setServerError(null);
    setDirty(false);
  }, [defaultCategory]);

  const save = React.useCallback(async () => {
    if (saving) return null;
    setSaving(true); setServerError(null);
    try {
      if (!String(name || '').trim()) {
        setServerError(t('validation.nameRequired'));
        return null;
      }
      const payload = {
        name: name.trim(),
        supplier_id: supplierId,
        category: category || undefined,
        description: description || null,
        editor: editor || null,
        retired_date: retiredDate || null,
        lifecycle,
        criticality,
        cyber_criticality: cyberCriticality,
        recovery_wave: recoveryWave,
        external_facing: false,
        is_suite: isSuite,
        last_dr_test: null,
        etl_enabled: false,
        contains_pii: false,
        data_class: dataClass,
        version: version || null,
        go_live_date: goLiveDate || null,
        end_of_support_date: endOfSupportDate || null,
        users_mode: 'it_users' as const,
        users_year: new Date().getFullYear(),
        users_override: null,
      };
      const res = await api.post('/applications', payload);
      setDirty(false);
      return (res.data?.id as string) || null;
    } catch (e: any) {
      setServerError(getApiErrorMessage(e, t, t('messages.createApplicationFailed')));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [saving, name, supplierId, description, category, editor, retiredDate, lifecycle, criticality, cyberCriticality, recoveryWave, dataClass, version, goLiveDate, endOfSupportDate, isSuite, t]);

  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save, reset }), [dirty, save, reset]);

  return (
    <Stack spacing={2}>
      {!!serverError && <Alert severity="error">{serverError}</Alert>}
      <PropertyRow label={t('common.name')} required>
        <TextField value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} required fullWidth variant="standard" sx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.overview.description')}>
        <TextField value={description} onChange={(e) => { setDescription(e.target.value); markDirty(); }} fullWidth variant="standard" sx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.overview.supplier')}>
        <SupplierSelect value={supplierId} onChange={(v) => { setSupplierId(v); markDirty(); }} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.overview.category')} required>
        <EnumAutocomplete
          label={t('workspace.application.overview.category')}
          value={category}
          onChange={(v) => { setCategory(v); markDirty(); }}
          options={categoryOptions}
          required
          hideLabel
          textFieldSx={drawerFieldValueSx}
        />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.overview.publisher')}>
        <TextField value={editor} onChange={(e) => { setEditor(e.target.value); markDirty(); }} fullWidth variant="standard" sx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={classificationText("Business criticality")}>
        <EnumAutocomplete label={classificationText("Business criticality")} value={criticality || ''} onChange={(v) => { setCriticality(v || null); markDirty(); }} options={(classificationCatalog?.businessCriticalityLevels || []).filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }))} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={classificationText("Cyber criticality")}>
        <EnumAutocomplete label={classificationText("Cyber criticality")} value={cyberCriticality || ''} onChange={(v) => { setCyberCriticality(v || null); markDirty(); }} options={(classificationCatalog?.cyberCriticalityLevels || []).filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }))} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={classificationText("Data confidentiality")}>
        <EnumAutocomplete label={classificationText("Data confidentiality")} value={dataClass || ''} onChange={(v) => { setDataClass(v || null); markDirty(); }} options={(classificationCatalog?.dataClasses || []).filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }))} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={classificationText("Recovery wave")}>
        <EnumAutocomplete label={classificationText("Recovery wave")} value={recoveryWave || ''} onChange={(v) => { setRecoveryWave(v || null); markDirty(); }} options={(classificationCatalog?.recoveryWaves || []).filter((item) => !item.deprecated).sort((a, b) => a.order - b.order).map((item) => ({ label: item.label, value: item.code }))} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.overview.lifecycle')} required>
        <EnumAutocomplete label={t('workspace.application.overview.lifecycle')} value={lifecycle} onChange={(v) => { setLifecycle(v as any); markDirty(); }} options={lifecycleOptions} required hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <Box component="label" sx={(theme) => ({ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 13, color: theme.palette.kanap.text.primary })}>
        <input type="checkbox" checked={isSuite} onChange={(e) => { setIsSuite(e.target.checked); markDirty(); }} style={{ accentColor: 'var(--kanap-teal)' }} />
        {t('workspace.application.overview.canHaveChildApps')}
      </Box>
      <Divider sx={{ my: 1 }} />
      <Typography
        component="h2"
        sx={(theme) => ({
          m: 0,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.4,
          color: theme.palette.kanap.text.primary,
        })}
      >
        {t('workspace.application.overview.versionInfo')}
      </Typography>
      <PropertyRow label={t('workspace.application.overview.version')}>
        <TextField
          value={version}
          onChange={(e) => { setVersion(e.target.value); markDirty(); }}
          fullWidth
          placeholder={t('workspace.application.overview.versionPlaceholder')}
          size="small"
          variant="standard"
          sx={drawerFieldValueSx}
        />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.meta.goLive')}>
        <DateEUField label="" valueYmd={goLiveDate} onChangeYmd={(v) => { setGoLiveDate(v); markDirty(); }} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.overview.endOfSupport')}>
        <DateEUField label="" valueYmd={endOfSupportDate} onChangeYmd={(v) => { setEndOfSupportDate(v); markDirty(); }} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
      <PropertyRow label={t('workspace.application.overview.retiredDate')}>
        <DateEUField label="" valueYmd={retiredDate} onChangeYmd={(v) => { setRetiredDate(v); markDirty(); }} hideLabel textFieldSx={drawerFieldValueSx} />
      </PropertyRow>
    </Stack>
  );
});
