import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Box,
  LinearProgress,
  Alert,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useCsvExport } from './useCsvExport';
import { csvRequestErrorMessage } from './csvRequestError';
import { screenLanguage } from './readings';
import { CsvFieldSelector } from './CsvFieldSelector';
import { CsvFieldInfo, CsvExportPreset } from './csv.types';

interface CsvExportDialogV2Props {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  title?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  presets?: CsvExportPreset[];
}

export default function CsvExportDialogV2({
  open,
  onClose,
  endpoint,
  title: titleProp,
  params,
  presets: propPresets = [],
}: CsvExportDialogV2Props) {
  const { t, i18n } = useTranslation('common');
  // The file follows the screen: separator, days, decimal mark and yes or no.
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const [fieldsInfo, setFieldsInfo] = useState<CsvFieldInfo[]>([]);
  const [backendPresets, setBackendPresets] = useState<CsvExportPreset[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [showFieldSelector, setShowFieldSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    preset,
    selectedFields,
    loading,
    fieldCount,
    totalFields,
    setLoading,
    toggleField,
    selectAll,
    deselectAll,
    applyPreset,
    getFieldsParam,
  } = useCsvExport(fieldsInfo);

  // Merge backend presets with prop presets (backend takes precedence for fields)
  const presets = backendPresets.length > 0 ? backendPresets : propPresets;

  // Load field metadata when dialog opens
  useEffect(() => {
    if (open && fieldsInfo.length === 0) {
      setLoadingFields(true);
      setError(null);
      api
        .get(`${endpoint}/csv-fields`)
        .then((res) => {
          // Handle both old format (array) and new format ({ fields, presets })
          if (Array.isArray(res.data)) {
            setFieldsInfo(res.data);
          } else {
            setFieldsInfo(res.data.fields ?? []);
            setBackendPresets(res.data.presets ?? []);
          }
        })
        .catch(async (err) => {
          console.error('Failed to load CSV fields', err);
          setError(await csvRequestErrorMessage(err, t, t('messages.loadFailedRefresh')));
        })
        .finally(() => {
          setLoadingFields(false);
        });
    }
  }, [open, endpoint, fieldsInfo.length, t]);

  const download = async (scope: 'template' | 'data') => {
    setLoading(true);
    setError(null);
    try {
      const queryParams: Record<string, any> = { ...(params ?? {}), scope, language };

      // Add field selection based on preset
      if (preset === 'custom' && scope === 'data') {
        queryParams.fields = getFieldsParam();
      } else if (preset && preset !== 'full' && preset !== 'custom') {
        queryParams.preset = preset;
      }
      // 'full' preset: no params needed - backend returns all exportable fields

      const res = await api.get(`${endpoint}/export`, { params: queryParams, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const disposition = (res.headers?.['content-disposition'] ?? res.headers?.['Content-Disposition']) as string | undefined;
      let filename = scope === 'template' ? 'template.csv' : 'data.csv';
      if (disposition) {
        const match = /filename="?([^"]+)"?/i.exec(disposition);
        if (match?.[1]) filename = match[1];
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
      setError(await csvRequestErrorMessage(e, t, t('messages.exportFailed')));
    } finally {
      setLoading(false);
    }
  };

  const availablePresets: CsvExportPreset[] = [
    { name: 'full', label: t('csv.fullExport') },
    ...presets,
    { name: 'custom', label: t('csv.customSelection') },
  ];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{titleProp || t('csv.exportTitle')}</DialogTitle>
      <DialogContent>
        {loadingFields ? (
          <LinearProgress sx={{ my: 2 }} />
        ) : (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {t('csv.exportDescriptionFlexible')}
            </Typography>

            {/* Preset selector */}
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>{t('csv.exportPreset')}</InputLabel>
              <Select
                value={preset}
                label={t('csv.exportPreset')}
                onChange={(e) => {
                  const selectedPreset = e.target.value;
                  const presetDef = availablePresets.find((p) => p.name === selectedPreset);
                  applyPreset(selectedPreset, presetDef?.fields);
                  setShowFieldSelector(selectedPreset === 'custom');
                }}
              >
                {availablePresets.map((p) => (
                  <MenuItem key={p.name} value={p.name}>
                    {p.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Field count indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                {t('csv.fieldsSelected', { selected: fieldCount, total: totalFields })}
              </Typography>
              {preset === 'custom' && (
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={selectAll}>{t('buttons.selectAll')}</Button>
                  <Button size="small" onClick={deselectAll}>{t('buttons.clear')}</Button>
                </Stack>
              )}
            </Box>

            {/* Field selector (for custom preset) */}
            {(preset === 'custom' || showFieldSelector) && (
              <Box sx={{ maxHeight: 300, overflow: 'auto', mb: 2 }}>
                <CsvFieldSelector
                  fields={fieldsInfo.filter((f) => f.exportable)}
                  selectedFields={selectedFields}
                  onToggle={toggleField}
                />
              </Box>
            )}

            {/* Action button */}
            <Button
              variant="contained"
              onClick={() => download('data')}
              disabled={loading || fieldCount === 0}
            >
              {t('csv.exportData')}
            </Button>

            {loading && <LinearProgress sx={{ mt: 2 }} />}
          </>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('buttons.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
