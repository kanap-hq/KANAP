import { useTranslation } from 'react-i18next';
import { classificationText } from '../../../utils/applicationClassification';
import React from 'react';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import TranslateIcon from '@mui/icons-material/Translate';
import { Alert, Box, Button, Checkbox, IconButton, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KanapDialog, RequiredMark } from '../../../components/design';
import type { ApplicationClassificationCatalog, BusinessCriticalityLevel, ClassificationLevel, ItOpsSettings, RecoveryWave } from '../../../services/itOpsSettings';
import { updateItOpsSettings } from '../../../services/itOpsSettings';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useCatalogRemoval } from '../../../components/settings/useCatalogRemoval';
import { useCatalogTranslations } from '../../../components/settings/CatalogTranslationsDialog';
import { catalogListIssues } from '../../../components/settings/catalogValidation';
import { classificationDefaults } from '../../../utils/applicationClassification';
import { localizeCatalogItem, toCatalogLocale } from '../../../utils/catalogLocalization';

type Props = { settings: ItOpsSettings; readOnly?: boolean };
type Kind = 'business' | 'level' | 'wave';

function stripCatalog(settings: ItOpsSettings): ApplicationClassificationCatalog {
  return {
    businessCriticalityLevels: settings.businessCriticalityLevels || [],
    cyberCriticalityLevels: settings.cyberCriticalityLevels || [],
    dataClasses: (settings.dataClasses as ClassificationLevel[]) || [],
    recoveryWaves: settings.recoveryWaves || [],
  };
}

const fieldSx = { '& input': { fontSize: 12, py: 0.5 } } as const;
const headerSx = { fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' } as const;
const columns = (kind: Kind) => kind === 'business' ? '52px 150px minmax(180px,1fr) 105px 84px 116px' : '52px 150px minmax(180px,1fr) 84px 116px';

/** Rows are the order: first = most severe (or first restored). The server assigns ranks from that order and generates codes from names. */
function LevelRows<T extends ClassificationLevel | BusinessCriticalityLevel | RecoveryWave>({ rows, kind, help, nameExample, usageList, onChange }: { rows: T[]; kind: Kind; help: string; nameExample: string; usageList: string; onChange: (rows: T[]) => void }) {
  const { t, i18n } = useTranslation('common');
  const patch = (index: number, next: Partial<T>) => onChange(rows.map((row, i) => i === index ? { ...row, ...next } : row));
  const removal = useCatalogRemoval(usageList);
  const translations = useCatalogTranslations();
  const issues = catalogListIssues(rows);
  // Editable fields are always the base text; the row shows what the user's language displays when it differs.
  const defaults = classificationDefaults(usageList);
  const locale = toCatalogLocale(i18n.resolvedLanguage || i18n.language);
  const shownAs = (row: T) => { const localized = localizeCatalogItem(row as any, locale, defaults); return localized.label !== row.label ? localized.label : null; };
  const move = (index: number, delta: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row);
    onChange(next);
  };
  return <Stack spacing={0.75}>
    <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{help}</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: columns(kind), gap: 1, alignItems: 'center' }}>
      <span />
      <Typography sx={headerSx}>{classificationText('Name')}<RequiredMark /></Typography>
      <Typography sx={headerSx}>{classificationText('Description')}</Typography>
      {kind === 'business' && <Typography sx={headerSx}>{classificationText('Maximum tolerable downtime (minutes)')}</Typography>}
      <Typography sx={headerSx}>{classificationText('No longer offered')}</Typography>
      <span />
    </Box>
    {rows.map((row, index) => <Box key={index} sx={{ display: 'grid', gridTemplateColumns: columns(kind), gap: 1, alignItems: 'center' }}>
      <Box sx={{ display: 'flex' }}>
        <IconButton size="small" aria-label={classificationText('Move up')} disabled={index === 0} onClick={() => move(index, -1)} sx={{ p: 0.25, color: 'kanap.text.secondary' }}><KeyboardArrowUpIcon sx={{ fontSize: 18 }} /></IconButton>
        <IconButton size="small" aria-label={classificationText('Move down')} disabled={index === rows.length - 1} onClick={() => move(index, 1)} sx={{ p: 0.25, color: 'kanap.text.secondary' }}><KeyboardArrowDownIcon sx={{ fontSize: 18 }} /></IconButton>
      </Box>
      <Box>
        <TextField value={row.label} onChange={(e) => patch(index, { label: e.target.value } as Partial<T>)} placeholder={classificationText(nameExample)} size="small" sx={fieldSx} required inputProps={{ 'aria-label': classificationText('Name') }} fullWidth />
        {issues.get(index) && issues.get(index) !== 'nameRequired' && <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25 }}>{t(`enumEditor.${issues.get(index)}`)}</Typography>}
        {shownAs(row) && <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25 }}>{t('enumEditor.shownAs', { value: shownAs(row) })}</Typography>}
      </Box>
      <TextField value={row.description || ''} onChange={(e) => patch(index, { description: e.target.value } as Partial<T>)} placeholder={classificationText('Shown under the name when choosing a level')} size="small" sx={fieldSx} inputProps={{ 'aria-label': classificationText('Description') }} />
      {kind === 'business' && <TextField value={(row as BusinessCriticalityLevel).maxMtdMinutes ?? ''} onChange={(e) => patch(index, { maxMtdMinutes: e.target.value === '' ? null : Number(e.target.value) } as unknown as Partial<T>)} placeholder={classificationText('No limit')} type="number" size="small" sx={fieldSx} inputProps={{ 'aria-label': classificationText('Maximum tolerable downtime (minutes)'), min: 1 }} />}
      <Checkbox checked={!!row.deprecated} onChange={(e) => patch(index, { deprecated: e.target.checked } as Partial<T>)} size="small" inputProps={{ 'aria-label': `${classificationText('No longer offered')} ${row.label}` }} />
      <Box sx={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        {row.code && <IconButton size="small" aria-label={`${t('enumEditor.translate')} ${row.label}`} sx={{ color: 'kanap.text.secondary', mr: 0.5 }} onClick={() => translations.openTranslations({ item: row as any, withDescription: true, defaults, onSave: (next) => patch(index, { translations: next } as Partial<T>) })}><TranslateIcon sx={{ fontSize: 17 }} /></IconButton>}
        <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: row.label || row.code, key: row.code ? { code: row.code } : null, onRemove: () => onChange(rows.filter((_, i) => i !== index)), onRetire: () => patch(index, { deprecated: true } as Partial<T>) })}>{t('enumEditor.remove')}</Button>
      </Box>
    </Box>)}
    <Button variant="action" sx={{ alignSelf: 'flex-start' }} onClick={() => onChange([...rows, ({ code: '', label: '', description: '', deprecated: false, ...(kind === 'wave' ? { order: rows.length } : { rank: 0 }), ...(kind === 'business' ? { maxMtdMinutes: null } : {}) } as T)])}>{classificationText('Add level')}</Button>
    {removal.dialog}
    {translations.dialog}
  </Stack>;
}

export default function ClassificationCatalogSettings({ settings, readOnly = false }: Props) {
  const { t } = useTranslation('it');
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(() => stripCatalog(settings));
  React.useEffect(() => { if (!open) setDraft(stripCatalog(settings)); }, [open, settings]);
  const saveMutation = useMutation({
    mutationFn: () => updateItOpsSettings(draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['it-ops-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['application-classification-catalog'] });
      await queryClient.invalidateQueries({ predicate: (query) => ['application', 'app-filter', 'interface', 'connection'].some((prefix) => String(query.queryKey[0]).startsWith(prefix)) });
      setOpen(false);
    },
  });
  const invalid = ([draft.businessCriticalityLevels, draft.cyberCriticalityLevels, draft.dataClasses, draft.recoveryWaves] as Array<Array<{ code: string; label: string }>>).some((rows) => catalogListIssues(rows).size > 0);
  const severityHelp = classificationText('From the most critical level at the top to the least critical at the bottom.');
  const sections: Array<{ key: keyof ApplicationClassificationCatalog; title: string; kind: Kind; help: string; nameExample: string }> = [
    { key: 'businessCriticalityLevels', title: classificationText('Business criticality'), kind: 'business', nameExample: 'e.g., Critical', help: `${severityHelp} ${classificationText('The maximum tolerable downtime documents each level and warns when an RTO exceeds it.')}` },
    { key: 'cyberCriticalityLevels', title: classificationText('Cyber criticality'), kind: 'level', nameExample: 'e.g., High', help: severityHelp },
    { key: 'dataClasses', title: classificationText('Data confidentiality'), kind: 'level', nameExample: 'e.g., Confidential', help: severityHelp },
    { key: 'recoveryWaves', title: classificationText('Recovery waves'), kind: 'wave', nameExample: 'e.g., Foundation', help: classificationText('In restoration order: the first wave is restored first.') },
  ];
  return <Box sx={(theme) => ({ p: 2, border: `1px solid ${theme.palette.kanap.border.default}`, borderRadius: '8px' })}>
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Box>
        <Typography sx={(theme) => ({ fontSize: 16, fontWeight: 500, color: theme.palette.kanap.text.primary })}>{classificationText('Classifications and continuity')}</Typography>
        <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>{classificationText('Levels used to classify applications. Business levels also rate the operational criticality of interfaces and connections.')}</Typography>
      </Box>
      {!readOnly && <Button variant="action" onClick={() => setOpen(true)}>{classificationText('Edit catalog')}</Button>}
    </Stack>
    {readOnly && (
      <Stack spacing={1.25} sx={{ mt: 2 }}>
        {sections.map((section) => {
          const labels = (draft[section.key] as Array<{ label?: string }>).map((row) => row.label).filter((label): label is string => !!label);
          return (
            <Box key={section.key}>
              <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>{section.title}</Typography>
              {labels.length > 0 && <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{labels.join(', ')}</Typography>}
            </Box>
          );
        })}
      </Stack>
    )}
    {!readOnly && <KanapDialog open={open} title={classificationText('Edit classifications and continuity')} onClose={() => setOpen(false)} onSave={() => saveMutation.mutate()} saveLabel={classificationText('Save')} saveDisabled={invalid} saveLoading={saveMutation.isPending} sx={{ maxWidth: 1050 }}>
      <Stack spacing={2.5} sx={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {saveMutation.error && <Alert severity="error">{getApiErrorMessage(saveMutation.error, t, classificationText('The catalog could not be saved. Reload settings and try again.'))}</Alert>}
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{classificationText('Renaming, reordering or retiring a level never changes the applications that use it.')}</Typography>
        {sections.map((section) => <Box key={section.key}>
          <Typography sx={{ fontSize: 14, fontWeight: 500, mb: 0.5 }}>{section.title}</Typography>
          <LevelRows rows={draft[section.key] as any[]} kind={section.kind} help={section.help} nameExample={section.nameExample} usageList={section.key} onChange={(rows) => setDraft({ ...draft, [section.key]: rows })} />
        </Box>)}
      </Stack>
    </KanapDialog>}
  </Box>;
}
