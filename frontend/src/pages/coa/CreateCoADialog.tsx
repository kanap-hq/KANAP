import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import api from '../../api';
import { KanapDialog, PropertyRow } from '../../components/design';
import { COUNTRY_OPTIONS } from '../../constants/isoOptions';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useCountryName } from './coaRoles';

type TemplateOption = {
  id: string;
  country_iso: string | null;
  template_code: string;
  template_name: string;
  version: string;
  is_global?: boolean;
  loaded_by_default?: boolean;
};

const choiceLabelSx = { mr: 3, '& .MuiFormControlLabel-label': { fontSize: 13 } } as const;
const placeholderSx = { color: 'kanap.text.tertiary' } as const;
const selectMenuProps = { PaperProps: { sx: { maxHeight: 320 } } } as const;

export default function CreateCoADialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (newId: string) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const countryName = useCountryName();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'scratch' | 'template'>('scratch');
  const [scope, setScope] = useState<'GLOBAL' | 'COUNTRY'>('COUNTRY');
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [preflight, setPreflight] = useState<any | null>(null);
  const [preflighting, setPreflighting] = useState(false);

  const countryOptions = useMemo(
    () => COUNTRY_OPTIONS
      .map((option) => ({ code: option.code, name: countryName(option.code) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [countryName],
  );

  useEffect(() => {
    if (!open || mode !== 'template') return;
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/chart-of-accounts/templates');
        if (!alive) return;
        setTemplates(res.data?.items || []);
      } catch {
        if (!alive) return;
        setTemplates([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, mode]);

  const chosenTemplate = templates.find((item) => item.id === selectedTemplate);
  // A global template makes a chart for every country: its coverage is fixed.
  const coverageFixed = mode === 'template' && !!chosenTemplate?.is_global;

  /**
   * Picking a template proposes its code, name and coverage once. A value the user typed stays;
   * a value the previous template proposed follows the new one.
   */
  const pickTemplate = (templateId: string) => {
    const previous = chosenTemplate;
    const next = templates.find((item) => item.id === templateId);
    setSelectedTemplate(templateId);
    setPreflight(null);
    if (!next) return;
    if (!code || code === previous?.template_code) setCode(next.template_code);
    if (!name || name === previous?.template_name) setName(next.template_name);
    if (next.is_global) {
      setScope('GLOBAL');
      setCountry('');
      setIsDefault(false);
    } else {
      setScope('COUNTRY');
      if (!country || country === (previous?.country_iso || '')) setCountry(next.country_iso || '');
    }
  };

  const resetForm = () => {
    setCode('');
    setName('');
    setCountry('');
    setScope('COUNTRY');
    setIsDefault(false);
    setSelectedTemplate('');
    setPreflight(null);
    setMode('scratch');
    setError(null);
  };

  const runPreflight = async () => {
    if (mode !== 'template' || !selectedTemplate) return;
    setPreflighting(true);
    setError(null);
    try {
      const res = await api.post('/chart-of-accounts/import-template/preflight', { template_id: selectedTemplate });
      setPreflight(res.data);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('coa.createDialog.preflightFailed')));
      setPreflight(null);
    } finally {
      setPreflighting(false);
    }
  };

  const handleSubmit = async () => {
    const selected = templates.find((item) => item.id === selectedTemplate);
    const isGlobal = scope === 'GLOBAL' || !!selected?.is_global;
    if (!code || !name) {
      setError(t('coa.createDialog.codeAndNameRequired'));
      return;
    }
    if (scope === 'COUNTRY' && !(mode === 'template' && isGlobal) && !country) {
      setError(t('coa.createDialog.countryRequired'));
      return;
    }
    if (mode === 'template' && !selectedTemplate) {
      setError(t('coa.createDialog.selectTemplate'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: any = { code, name, scope };
      if (scope === 'COUNTRY') payload.country_iso = country;
      payload.is_default = scope === 'COUNTRY' ? isDefault : false;

      const createRes = await api.post('/chart-of-accounts', payload);
      const created = createRes.data;
      if (mode === 'template' && selectedTemplate) {
        await api.post(`/chart-of-accounts/${created.id}/load-template`, {
          template_id: selectedTemplate,
          dryRun: false,
          overwrite: true,
        });
      }

      if (created?.id) onCreated(String(created.id));
      onClose();
      resetForm();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('coa.createDialog.failedToCreate')));
    } finally {
      setSubmitting(false);
    }
  };

  const templateLabel = (template: TemplateOption) => {
    const coverage = template.country_iso ? countryName(template.country_iso) : t('coa.coverage.allCountries');
    return `${template.template_name} · ${coverage} · ${template.template_code} ${template.version}`.trim();
  };

  return (
    <KanapDialog
      open={open}
      title={t('coa.createDialog.title')}
      onClose={onClose}
      onSave={handleSubmit}
      saveLabel={t('common:buttons.create')}
      saveLoading={submitting}
      saveDisabled={preflighting || (mode === 'template' && !selectedTemplate)}
      footerLeft={mode === 'template' ? (
        <Button
          variant="action"
          onClick={runPreflight}
          disabled={!selectedTemplate || preflighting || submitting}
        >
          {t('coa.createDialog.preflight')}
        </Button>
      ) : undefined}
      sx={{ maxWidth: 520 }}
    >
      <Stack spacing={1.5}>
        <PropertyRow label={t('coa.createDialog.startFrom')}>
          <RadioGroup
            row
            aria-label={t('coa.createDialog.startFrom')}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as 'scratch' | 'template');
              setPreflight(null);
            }}
          >
            <FormControlLabel value="scratch" control={<Radio size="small" />} label={t('coa.createDialog.scratch')} sx={choiceLabelSx} />
            <FormControlLabel value="template" control={<Radio size="small" />} label={t('coa.createDialog.template')} sx={choiceLabelSx} />
          </RadioGroup>
        </PropertyRow>

        {mode === 'template' && (
          <PropertyRow label={t('coa.createDialog.templateLabel')} required>
            <Select
              variant="standard"
              value={selectedTemplate}
              onChange={(e) => pickTemplate(String(e.target.value))}
              displayEmpty
              sx={drawerSelectSx}
              MenuProps={selectMenuProps}
              SelectDisplayProps={{ 'aria-label': t('coa.createDialog.templateLabel') } as React.HTMLAttributes<HTMLDivElement>}
              renderValue={(value) => {
                const template = templates.find((item) => item.id === value);
                return template
                  ? templateLabel(template)
                  : <Box component="span" sx={placeholderSx}>{t('coa.createDialog.templatePlaceholder')}</Box>;
              }}
            >
              {templates.map((template) => (
                <MenuItem key={template.id} value={template.id} sx={drawerMenuItemSx}>
                  {templateLabel(template)}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
        )}

        <PropertyRow label={t('coa.createDialog.codeLabel')} required helperText={t('coa.createDialog.codeHelp')}>
          <TextField
            variant="standard"
            fullWidth
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('coa.createDialog.codePlaceholder')}
            autoFocus
            inputProps={{ 'aria-label': t('coa.createDialog.codeLabel') }}
          />
        </PropertyRow>

        <PropertyRow label={t('coa.createDialog.nameLabel')} required>
          <TextField
            variant="standard"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('coa.createDialog.namePlaceholder')}
            inputProps={{ 'aria-label': t('coa.createDialog.nameLabel') }}
          />
        </PropertyRow>

        <PropertyRow label={t('coa.createDialog.coverageLabel')}>
          <RadioGroup
            row
            aria-label={t('coa.createDialog.coverageLabel')}
            value={scope}
            onChange={(e) => setScope(e.target.value as 'GLOBAL' | 'COUNTRY')}
          >
            <FormControlLabel value="COUNTRY" control={<Radio size="small" />} label={t('coa.createDialog.scopeCountry')} sx={choiceLabelSx} disabled={coverageFixed} />
            <FormControlLabel value="GLOBAL" control={<Radio size="small" />} label={t('coa.createDialog.scopeGlobal')} sx={choiceLabelSx} disabled={coverageFixed} />
          </RadioGroup>
        </PropertyRow>

        {scope === 'COUNTRY' && (
          <PropertyRow label={t('coa.createDialog.countryLabel')} required>
            <Select
              variant="standard"
              value={country}
              onChange={(e) => setCountry(String(e.target.value))}
              displayEmpty
              sx={drawerSelectSx}
              MenuProps={selectMenuProps}
              SelectDisplayProps={{ 'aria-label': t('coa.createDialog.countryLabel') } as React.HTMLAttributes<HTMLDivElement>}
              renderValue={(value) => (value
                ? countryName(String(value))
                : <Box component="span" sx={placeholderSx}>{t('coa.createDialog.countryPlaceholder')}</Box>)}
            >
              {countryOptions.map((option) => (
                <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>
                  {option.name}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
        )}

        {scope === 'COUNTRY' && (
          <FormControlLabel
            control={<Checkbox size="small" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />}
            label={t('coa.createDialog.setDefaultForCountry')}
            sx={{ ...choiceLabelSx, mr: 0 }}
          />
        )}

        {mode === 'template' && preflight && (
          <Alert severity="success">
            {t('coa.createDialog.preflightOk', {
              total: preflight.total ?? 0,
              inserted: preflight.inserted ?? 0,
              updated: preflight.updated ?? 0,
            })}
          </Alert>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </KanapDialog>
  );
}
