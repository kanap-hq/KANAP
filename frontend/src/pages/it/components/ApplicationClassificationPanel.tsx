import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { Link as RouterLink } from 'react-router-dom';
import { Link } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { classificationText } from '../../../utils/applicationClassification';
import React from 'react';
import { Alert, Box, Button, IconButton, Tooltip, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { PropertyRow } from '../../../components/design';
import DateEUField from '../../../components/fields/DateEUField';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import DurationEditor, { formatDuration } from './DurationEditor';

export type ApplicationClassification = {
  id: string;
  criticality: string | null;
  cyber_criticality: string | null;
  recovery_wave: string | null;
  rto_minutes: number | null;
  rpo_minutes: number | null;
  classification_justification: string | null;
  classification_revision: number;
  classification_review_state?: 'incomplete' | 'stale' | 'reviewed';
  classification_review_reason?: string | null;
  classification_reviewed_at?: string | null;
  classification_reviewer_name?: string | null;
  data_class: string | null;
  contains_pii: boolean;
  last_dr_test: string | null;
};

export type RecoveryDependency = {
  interface_id: string;
  interface_reference: string | null;
  interface_name: string;
  direction: 'source' | 'target';
  application_id: string;
  application_ref: string | null;
  application_name: string;
  recovery_wave: string;
};

type Props = {
  app: ApplicationClassification;
  canManage: boolean;
  onPatch: (patch: Partial<ApplicationClassification> & Record<string, unknown>) => Promise<void>;
  onReview: () => Promise<void>;
  children?: React.ReactNode;
  recoveryLinks?: React.ReactNode;
  /** Interfaces to applications restored in a later wave; shown under the wave, never blocking. */
  recoveryDependencies?: RecoveryDependency[];
  error?: string | null;
  saving?: boolean;
};

const hintSx = (theme: any) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary });
/** Highest / lowest rank among the levels still offered; retired levels do not define the extremes. */
const activeRanks = (levels: Array<{ rank: number; deprecated?: boolean }> | undefined) => (levels || []).filter((level) => !level.deprecated).map((level) => level.rank);
/** True when `date` (YYYY-MM-DD) is on or before the same calendar day one year ago, or absent. Local calendar dates, no time of day. */
export function recoveryTestOverdue(date: string | null | undefined, today = new Date()): boolean {
  if (!date) return true;
  const limit = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return true;
  return new Date(year, month - 1, day).getTime() <= limit.getTime();
}

type Option = { code: string; label: string; description?: string; deprecated?: boolean };

const rowSx = { display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', columnGap: '18px', alignItems: 'start' } as const;
const valueSx = { maxWidth: 520 } as const;
const sectionTitleSx = (theme: any) => ({ fontSize: 16, fontWeight: 500, color: theme.palette.kanap.text.primary, mb: 1.25 });

export function HelpLabel({ text, help }: { text: string; help: string }) {
  return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>{classificationText(text)}<Tooltip title={classificationText(help)} enterTouchDelay={0}><IconButton size="small" aria-label={classificationText(text)} sx={{ p: 0.25 }}><HelpOutlineIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip></Box>;
}

/** Naked select over a tenant catalog: label at 13px, definition at 11px under each option. */
export function LevelSelect({ value, options, placeholder, ariaLabel, disabled, onChange }: { value: string | null; options: Option[]; placeholder: string; ariaLabel: string; disabled: boolean; onChange: (value: string | null) => void }) {
  const visible = options.filter((item) => !item.deprecated || item.code === value);
  return <Select value={value || ''} renderValue={(selected) => options.find((item) => item.code === selected)?.label || selected || placeholder} onChange={(event) => onChange(event.target.value || null)} disabled={disabled} displayEmpty variant="standard" sx={drawerSelectSx} inputProps={{ 'aria-label': ariaLabel }}>
    <MenuItem value="" sx={drawerMenuItemSx}>{placeholder}</MenuItem>
    {visible.map((item) => <MenuItem key={item.code} value={item.code} sx={drawerMenuItemSx}><Box><Typography sx={{ fontSize: 13 }}>{item.label}{item.deprecated ? ` (${classificationText('No longer offered')})` : ''}</Typography>{item.description && <Typography sx={{ fontSize: 11, whiteSpace: 'normal', maxWidth: 440, color: 'text.secondary' }}>{item.description}</Typography>}</Box></MenuItem>)}
  </Select>;
}

export default function ApplicationClassificationPanel({ app, canManage, onPatch, onReview, children, recoveryLinks, recoveryDependencies, error, saving }: Props) {
  const { t, i18n } = useTranslation('it');
  const { data: catalog } = useApplicationClassificationCatalog();
  const [durationDraftsBlocking, setDurationDraftsBlocking] = React.useState({ rto: false, rpo: false });
  const setDurationDraftBlocking = React.useCallback((field: keyof typeof durationDraftsBlocking, blocking: boolean) => {
    setDurationDraftsBlocking((current) => current[field] === blocking ? current : { ...current, [field]: blocking });
  }, []);
  const patch = (value: Partial<ApplicationClassification>) => void onPatch(value).catch(() => {});
  const level = catalog?.businessCriticalityLevels.find((item) => item.code === app.criticality);
  const missingFields = [
    !app.criticality && classificationText('Business criticality'),
    !app.cyber_criticality && classificationText('Cyber criticality'),
    !app.data_class && classificationText('Data confidentiality'),
    !app.recovery_wave && classificationText('Recovery wave'),
    !app.classification_justification?.trim() && classificationText('Justification'),
  ].filter(Boolean);
  const complete = missingFields.length === 0;
  const hasBlockingDurationDraft = Object.values(durationDraftsBlocking).some(Boolean);
  const hasReview = !!app.classification_reviewed_at;
  const changedSinceReview = hasReview && (app.classification_review_reason === 'data_changed' || !complete);
  const rtoExceedsDowntime = app.rto_minutes != null && typeof level?.maxMtdMinutes === 'number' && app.rto_minutes >= level.maxMtdMinutes;
  // Light coherence hints: computed from the application and the active catalog ranks, never blocking.
  const rankOf = (levels: Array<{ code: string; rank: number }> | undefined, code: string | null) => levels?.find((item) => item.code === code)?.rank;
  const dataRanks = activeRanks(catalog?.dataClasses);
  const cyberRanks = activeRanks(catalog?.cyberCriticalityLevels);
  const businessRanks = activeRanks(catalog?.businessCriticalityLevels);
  const restrictedDataLowCyber = dataRanks.length > 0 && cyberRanks.length > 0
    && rankOf(catalog?.dataClasses, app.data_class) === Math.max(...dataRanks)
    && rankOf(catalog?.cyberCriticalityLevels, app.cyber_criticality) === Math.min(...cyberRanks);
  const criticalWithoutRecentTest = businessRanks.length > 0
    && rankOf(catalog?.businessCriticalityLevels, app.criticality) === Math.max(...businessRanks)
    && recoveryTestOverdue(app.last_dr_test);
  const waveLabel = (code: string) => catalog?.recoveryWaves.find((item) => item.code === code)?.label || code;
  const dependencies = app.recovery_wave ? recoveryDependencies || [] : [];

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Typography component="h2" sx={sectionTitleSx}>{classificationText('Criticality')}</Typography>
        <Stack spacing={1.25}>
          <PropertyRow label={<HelpLabel text="Business criticality" help="Business help" />} sx={rowSx} valueSx={valueSx}>
            <LevelSelect value={app.criticality} ariaLabel={classificationText('Business criticality')} options={catalog?.businessCriticalityLevels || []} placeholder={classificationText('Choose business criticality')} disabled={!canManage} onChange={(value) => patch({ criticality: value })} />
          </PropertyRow>
          <PropertyRow label={<HelpLabel text="Cyber criticality" help="Cyber help" />} sx={rowSx} valueSx={valueSx}>
            <LevelSelect value={app.cyber_criticality} ariaLabel={classificationText('Cyber criticality')} options={catalog?.cyberCriticalityLevels || []} placeholder={classificationText('Choose cyber criticality')} disabled={!canManage} onChange={(value) => patch({ cyber_criticality: value })} />
            {restrictedDataLowCyber && <Typography sx={hintSx}>{classificationText('Data at the highest confidentiality level with the lowest cyber criticality: check the cyber assessment.')}</Typography>}
          </PropertyRow>
        </Stack>
      </Box>
      <Box>
        <Typography component="h2" sx={sectionTitleSx}>{classificationText('Data')}</Typography>
        <Stack spacing={1.25}>
          <PropertyRow label={<HelpLabel text="Data confidentiality" help="Confidentiality help" />} sx={rowSx} valueSx={valueSx}>
            <LevelSelect value={app.data_class} ariaLabel={classificationText('Data confidentiality')} options={catalog?.dataClasses || []} placeholder={classificationText('Choose data confidentiality')} disabled={!canManage} onChange={(value) => patch({ data_class: value })} />
          </PropertyRow>
          <PropertyRow label={classificationText('Contains personal data')} sx={rowSx} valueSx={valueSx}><input type="checkbox" checked={!!app.contains_pii} disabled={!canManage} onChange={(event) => patch({ contains_pii: event.target.checked })} /></PropertyRow>
          {children}
        </Stack>
      </Box>
      <Box>
        <Typography component="h2" sx={sectionTitleSx}>{classificationText('Continuity and recovery')}</Typography>
        <Stack spacing={1.25}>
          <PropertyRow label={<HelpLabel text="Recovery wave" help="Recovery help" />} sx={rowSx} valueSx={valueSx}>
            <LevelSelect value={app.recovery_wave} ariaLabel={classificationText('Recovery wave')} options={catalog?.recoveryWaves || []} placeholder={classificationText('Choose a recovery wave')} disabled={!canManage} onChange={(value) => patch({ recovery_wave: value })} />
            {dependencies.map((dependency) => (
              <Typography key={dependency.interface_id} sx={hintSx}>
                {t('classification.recovery_dependency', { app: dependency.application_name, wave: waveLabel(dependency.recovery_wave) })}
                {' '}<Link component={RouterLink} to={`/it/interfaces/${dependency.interface_reference || dependency.interface_id}/overview`} sx={{ fontSize: 12 }}>{dependency.interface_reference || dependency.interface_name}</Link>
              </Typography>
            ))}
          </PropertyRow>
          <PropertyRow label={<HelpLabel text="Recovery time objective (RTO)" help="RTO help" />} sx={rowSx} valueSx={valueSx}><DurationEditor value={app.rto_minutes} onCommit={(value) => onPatch({ rto_minutes: value })} onDraftStateChange={(blocking) => setDurationDraftBlocking('rto', blocking)} disabled={!canManage} placeholder={classificationText('Choose a duration')} ariaLabel={classificationText('Recovery time objective')} /></PropertyRow>
          {rtoExceedsDowntime && <Alert severity="warning" sx={{ maxWidth: 700 }}>{t('classification.rto_exceeds_level_downtime', { level: level?.label, duration: formatDuration(level!.maxMtdMinutes as number) })}</Alert>}
          <PropertyRow label={<HelpLabel text="Recovery point objective (RPO)" help="RPO help" />} sx={rowSx} valueSx={valueSx}><DurationEditor value={app.rpo_minutes} onCommit={(value) => onPatch({ rpo_minutes: value })} onDraftStateChange={(blocking) => setDurationDraftBlocking('rpo', blocking)} allowZero disabled={!canManage} placeholder={classificationText('Choose a duration')} ariaLabel={classificationText('Recovery point objective')} /></PropertyRow>
          <PropertyRow label={classificationText('Last recovery test')} sx={rowSx} valueSx={valueSx}>
            <DateEUField label="" valueYmd={app.last_dr_test || ''} onChangeYmd={(value) => patch({ last_dr_test: value || null })} disabled={!canManage} hideLabel textFieldSx={drawerFieldValueSx} />
            {criticalWithoutRecentTest && <Typography sx={hintSx}>{classificationText('No recovery test in the last twelve months for an application at the most critical level.')}</Typography>}
          </PropertyRow>
          {recoveryLinks}
        </Stack>
      </Box>
      <Box>
        <Typography component="h2" sx={sectionTitleSx}>{classificationText('Review')}</Typography>
        <Stack spacing={1.25}>
          <PropertyRow label={classificationText('Justification')} sx={rowSx} valueSx={valueSx}>
            <TextField defaultValue={app.classification_justification || ''} key={`${app.id}:justification`} onBlur={(event) => patch({ classification_justification: event.target.value.trim() || null })} disabled={!canManage} multiline minRows={3} placeholder={classificationText('Why these levels were chosen and what the recovery plan relies on')} variant="standard" fullWidth sx={(theme) => ({ ...drawerFieldValueSx, p: 1, border: `1px solid ${theme.palette.kanap.border.default}`, borderRadius: '8px', bgcolor: theme.palette.kanap.bg.composer })} />
          </PropertyRow>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box>
              {hasReview
                ? <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.primary })}>{t('classification.reviewed_on', { date: new Date(app.classification_reviewed_at!).toLocaleString(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }) })}{app.classification_reviewer_name ? ` · ${app.classification_reviewer_name}` : ''}</Typography>
                : <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.primary })}>{classificationText('Never reviewed')}</Typography>}
              {changedSinceReview && <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary })}>{classificationText('Changed since review')}</Typography>}
              {missingFields.length > 0 && <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.secondary })}>{t('classification.complete_before_review', { fields: missingFields.join(', ') })}</Typography>}
            </Box>
            {canManage && <Button variant="contained" size="small" disabled={!complete || hasBlockingDurationDraft || saving || !!error || app.classification_review_state === 'reviewed'} onClick={() => void onReview().catch(() => {})}>{classificationText('Mark as reviewed')}</Button>}
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
