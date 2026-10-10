import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Alert } from '@mui/material';
// no special tenant checks here; backend enforces platform admin
import { COUNTRY_OPTIONS } from '../../constants/isoOptions';
import api from '../../api';
import CsvExportDialog from '../../components/csv/CsvExportDialog';
import CsvImportDialog from '../../components/csv/CsvImportDialog';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';

type Template = {
  id: string;
  country_iso: string | null;
  template_code: string;
  template_name: string;
  version: string;
  is_global?: boolean;
  loaded_by_default?: boolean;
  created_at?: string;
  updated_at?: string;
};

function TemplateDialog({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved: () => void; initial?: Partial<Template> }) {
  const { t } = useTranslation(['admin', 'common']);
  const [country, setCountry] = useState(initial?.country_iso ?? '');
  const [code, setCode] = useState(initial?.template_code ?? '');
  const [name, setName] = useState(initial?.template_name ?? '');
  const [version, setVersion] = useState(initial?.version ?? '');
  const [isGlobal, setIsGlobal] = useState<boolean>(!!initial?.is_global || initial?.country_iso == null);
  const [loadedByDefault, setLoadedByDefault] = useState<boolean>(!!initial?.loaded_by_default);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCountry(initial?.country_iso ?? '');
    setCode(initial?.template_code ?? '');
    setName(initial?.template_name ?? '');
    setVersion(initial?.version ?? '');
    setIsGlobal(!!initial?.is_global || initial?.country_iso == null);
    setLoadedByDefault(!!initial?.loaded_by_default);
    setError(null);
  }, [initial, open]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: any = { template_code: code, template_name: name, version, is_global: isGlobal, loaded_by_default: loadedByDefault };
      if (!isGlobal) payload.country_iso = country;
      if (initial?.id) await api.patch(`/admin/coa-templates/${initial.id}`, payload);
      else await api.post(`/admin/coa-templates`, payload);
      onSaved();
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('coaTemplates.dialog.messages.saveFailed')));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial?.id ? t('coaTemplates.dialog.editTitle') : t('coaTemplates.dialog.createTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControlLabel control={<Checkbox checked={isGlobal} onChange={(e) => setIsGlobal(e.target.checked)} />} label={t('coaTemplates.dialog.fields.allCountries')} />
          {!isGlobal && (
            <TextField select label={t('coaTemplates.dialog.fields.country')} value={country} onChange={(e) => setCountry(e.target.value)} required size="small">
              {COUNTRY_OPTIONS.map((c) => (
                <MenuItem key={c.code} value={c.code}>{c.code} — {c.name}</MenuItem>
              ))}
            </TextField>
          )}
          <TextField label={t('coaTemplates.dialog.fields.code')} value={code} onChange={(e) => setCode(e.target.value)} required size="small" />
          <TextField label={t('coaTemplates.dialog.fields.name')} value={name} onChange={(e) => setName(e.target.value)} required size="small" />
          <TextField label={t('coaTemplates.dialog.fields.version')} value={version} onChange={(e) => setVersion(e.target.value)} required size="small" />
          {isGlobal && (
            <FormControlLabel control={<Checkbox checked={loadedByDefault} onChange={(e) => setLoadedByDefault(e.target.checked)} />} label={t('coaTemplates.dialog.fields.loadedByDefault')} />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose} disabled={saving}>{t('common:buttons.cancel')}</Button>
        <Button onClick={save} variant="action-primary" disabled={saving}>{t('common:buttons.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function AdminCoaTemplatesPage() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedRows, setSelectedRows] = useState<Template[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editInitial, setEditInitial] = useState<Partial<Template> | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const columns: EnhancedColDef<Template>[] = useMemo(() => [
    { field: 'template_code', headerName: t('coaTemplates.columns.code'), width: 160, required: true, cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' } },
    { field: 'template_name', headerName: t('coaTemplates.columns.name'), flex: 1, required: true },
    { field: 'version', headerName: t('coaTemplates.columns.version'), width: 120 },
    { field: 'country_iso', headerName: t('coaTemplates.columns.scope'), width: 150, valueFormatter: (p: any) => (!p.value ? t('coaTemplates.shared.allCountries') : p.value) },
    { field: 'loaded_by_default', headerName: t('coaTemplates.columns.loadedByDefault'), width: 170, valueFormatter: (p: any) => (p.value ? t('coaTemplates.shared.yes') : t('coaTemplates.shared.no')) },
    { field: 'updated_at', headerName: t('coaTemplates.columns.updated'), width: 200, valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale) },
  ], [locale, t]);

  const actions = (
    <Stack direction="row" spacing={1}>
      <Button variant="action-primary" onClick={() => { setEditInitial(undefined); setEditOpen(true); }}>{t('coaTemplates.actions.new')}</Button>
      <Button variant="action" disabled={selectedRows.length !== 1} onClick={() => { setEditInitial(selectedRows[0]); setEditOpen(true); }}>{t('coaTemplates.actions.edit')}</Button>
      <Button variant="action" disabled={selectedRows.length !== 1} onClick={() => setImportOpen(true)}>{t('coaTemplates.actions.importCsv')}</Button>
      <Button variant="action" disabled={selectedRows.length !== 1} onClick={() => setExportOpen(true)}>{t('coaTemplates.actions.exportCsv')}</Button>
      <Button
        variant="action-danger"
        disabled={selectedRows.length !== 1}
        onClick={async () => { await api.delete(`/admin/coa-templates/${selectedRows[0].id}`); setRefreshKey((k) => k + 1); }}
      >{t('common:buttons.delete')}</Button>
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('coaTemplates.title')} actions={actions} />
      <ServerDataGrid<Template>
        columns={columns}
        endpoint="/admin/coa-templates"
        queryKey="admin-coa-templates"
        defaultSort={{ field: 'updated_at', direction: 'DESC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="admin-coa-templates"
        enableRowSelection
        onSelectionChanged={(rows) => setSelectedRows(rows as Template[])}
      />

      <TemplateDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
        initial={editInitial}
      />

      {selectedRows.length === 1 && (
        <CsvExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          endpoint={`/admin/coa-templates/${selectedRows[0].id}`}
          title={t('coaTemplates.exportTitle', { code: selectedRows[0].template_code, version: selectedRows[0].version })}
        />
      )}
      {selectedRows.length === 1 && (
        <CsvImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          endpoint={`/admin/coa-templates/${selectedRows[0].id}`}
          title={t('coaTemplates.importTitle', { code: selectedRows[0].template_code, version: selectedRows[0].version })}
          onImported={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </>
  );
}
