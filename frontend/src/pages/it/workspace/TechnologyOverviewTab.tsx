import React from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '../../../api';
import DeleteConfirmDialog from '../../../components/DeleteConfirmDialog';
import { PropertyGroup, PropertyRow, StatusDot, useKanapDialogs } from '../../../components/design';
import DateEUField from '../../../components/fields/DateEUField';
import TeamMemberMultiSelect from '../../../components/fields/TeamMemberMultiSelect';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { useLookupPicker } from '../../../hooks/useLookupPicker';
import { useFeatures } from '../../../config/FeaturesContext';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { useLocale } from '../../../i18n/useLocale';
import { drawerAutocompleteListboxSx, drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx, tealLinkSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { formatSupportDate, supportStateColor, supportStateOf, type SupportState } from '../../../utils/supportState';
import { EditorField } from '../components/TechnologyCreateDialog';
import TechnologyCveNames, { type TechnologyCveName } from './TechnologyCveNames';

export type TechnologyVersion = {
  id: string;
  label: string;
  cpe_version: string | null;
  build_prefixes: string[];
  standard_support_end: string | null;
  extended_support_end: string | null;
  notes: string | null;
  /** Set when the version comes from the catalog (adoption or the living catalog's sync). */
  catalog_key?: string | null;
  /** Own setting: `true`, `false`, or `null` when the version follows the technology. */
  vulnerability_alerts?: boolean | null;
  /** The version's exception, or the technology's setting. */
  vulnerability_alerts_effective?: boolean;
  servers?: number;
  applications?: number;
};

export type TechnologyOwner = { id?: string; user_id: string; owner_type: 'business' | 'it'; full_name?: string | null };

export type TechnologyDetail = {
  id: string;
  reference: string;
  name: string;
  editor: string | null;
  family: string | null;
  /** Code of the "Administration zones" catalog. The screen offers it for a directory service; the API keeps it on every family. */
  admin_zone?: string | null;
  /** Code of the "Hosting types" catalog (on premises, colocation, cloud, SaaS). */
  hosting_type: string;
  lifecycle: string;
  description: string | null;
  notes: string | null;
  cpe_products: string[];
  /** Publisher and product as CVE.org writes them. A version limits the name to technology versions whose label starts with it. */
  cve_names?: TechnologyCveName[];
  /** The catalog entry the technology was adopted from; its versions and dates are then kept up to date. */
  catalog_key?: string | null;
  replaced_by_id: string | null;
  replaced_by: { id: string; name: string; reference: string } | null;
  versions: TechnologyVersion[];
  /** Whether the technology raises vulnerability alerts. Versions without their own setting follow it. */
  vulnerability_alerts?: boolean;
  owners: TechnologyOwner[];
  cyber_criticality?: string | null;
  recovery_wave?: string | null;
  rto_minutes?: number | null;
  rpo_minutes?: number | null;
  support_notes?: string | null;
};

export type TechnologyPatch = Partial<Pick<TechnologyDetail,
  'name' | 'editor' | 'family' | 'admin_zone' | 'hosting_type' | 'lifecycle' | 'description' | 'notes' | 'cpe_products' | 'cve_names' | 'replaced_by_id'
  | 'cyber_criticality' | 'recovery_wave' | 'rto_minutes' | 'rpo_minutes' | 'support_notes'>>;

/** `part:vendor:product`, the product part of a CPE name (`a:microsoft:sql_server`). */
// The server's rule (`CPE_PRODUCT_RE` in backend/src/technologies/technology-rows.ts), on the lower-cased value.
export const CPE_PRODUCT_PATTERN = /^[aoh]:(?:[a-z0-9._\-~%!]|\\[^a-z0-9\s]){1,100}:(?:[a-z0-9._\-~%!]|\\[^a-z0-9\s]){1,100}$/;
export const CPE_DICTIONARY_URL = 'https://nvd.nist.gov/products/cpe/search';

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Typography component="h2" sx={(theme) => ({ m: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: theme.palette.kanap.text.primary })}>
        {children}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {action}
    </Box>
  );
}

/** A text saved after a pause in typing and when the field loses focus. */
export function AutosaveText({ value, onSave, disabled, multiline, placeholder, ariaLabel, composer }: {
  value: string | null;
  onSave: (value: string | null) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel: string;
  composer?: boolean;
}) {
  const [draft, setDraft] = React.useState(value ?? '');
  const saved = React.useRef(value ?? '');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (timer.current) return;
    setDraft(value ?? '');
    saved.current = value ?? '';
  }, [value]);
  const flush = React.useCallback((next: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (next === saved.current) return;
    saved.current = next;
    onSave(next.trim() === '' ? null : next);
  }, [onSave]);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <TextField
      variant="standard"
      value={draft}
      disabled={disabled}
      multiline={multiline}
      minRows={multiline ? 4 : undefined}
      placeholder={placeholder}
      fullWidth
      inputProps={{ 'aria-label': ariaLabel }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; flush(next); }, multiline ? 1500 : 800);
      }}
      onBlur={() => flush(draft)}
      sx={composer ? (theme) => ({
        '& .MuiInputBase-root': { bgcolor: theme.palette.kanap.bg.composer, borderRadius: '8px' },
      }) : undefined}
    />
  );
}

type ReplacementOption = { id: string; name: string; reference?: string | null };

function ReplacementSelect({ technologyId, value, onChange, disabled }: {
  technologyId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['it', 'common']);
  const picker = useLookupPicker<ReplacementOption>({ endpoint: '/technologies/lookup', value: value ? [value] : [] });
  const selected = value ? picker.selected[0] ?? null : null;
  return (
    <Autocomplete
      {...picker.autocomplete}
      options={picker.options.filter((option) => option.id !== technologyId)}
      value={selected}
      disabled={disabled}
      onChange={(_, next) => {
        picker.remember([next]);
        onChange(next?.id || null);
      }}
      getOptionLabel={(option) => picker.label(option, (o) => o.name ?? '')}
      renderOption={(props, option) => <li {...props} key={option.id}>{option.name}</li>}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          placeholder={t('common:selects.notSet')}
          inputProps={{ ...params.inputProps, 'aria-label': t('workspace.technology.fields.replacedBy') }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {picker.loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

/**
 * Properties drawer of the technology: editor, family, hosting type, replacement and IT owners. The screen
 * shows and writes the IT owners only; business owners the API may hold are kept on each save.
 */
export function TechnologyProperties({ technology, canManage, onPatch, onOwnersChange, onError }: {
  technology: TechnologyDetail;
  canManage: boolean;
  onPatch: (patch: TechnologyPatch) => void;
  onOwnersChange: (owners: TechnologyOwner[]) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const { byField } = useItOpsEnumOptions();
  const [editor, setEditor] = React.useState(technology.editor ?? '');
  const [savingOwners, setSavingOwners] = React.useState(false);
  React.useEffect(() => { setEditor(technology.editor ?? ''); }, [technology.editor]);
  const families = byField.technologyFamily || [];
  const familyOptions = technology.family && !families.some((option) => option.code === technology.family)
    ? [{ code: technology.family, label: t('common.legacyOption', { label: technology.family }) }, ...families]
    : families;
  // A retired zone stays offered while the technology is in it; an unknown code shows as is.
  const zones = (byField.adminZone || []).filter((option) => !option.deprecated || option.code === technology.admin_zone);
  const zoneOptions = technology.admin_zone && !zones.some((option) => option.code === technology.admin_zone)
    ? [{ code: technology.admin_zone, label: t('common.legacyOption', { label: technology.admin_zone }) }, ...zones]
    : zones;
  // Same rule for the hosting type: a retired type stays offered while the technology has it.
  const hostingTypes = (byField.hostingType || []).filter((option) => !option.deprecated || option.code === technology.hosting_type);
  const hostingTypeOptions = technology.hosting_type && !hostingTypes.some((option) => option.code === technology.hosting_type)
    ? [{ code: technology.hosting_type, label: t('common.legacyOption', { label: technology.hosting_type }) }, ...hostingTypes]
    : hostingTypes;

  const saveEditor = () => {
    const next = editor.trim() || null;
    if (next !== (technology.editor ?? null)) onPatch({ editor: next });
  };

  const replaceItOwners = async (userIds: string[]) => {
    const keep = technology.owners.filter((owner) => owner.owner_type !== 'it');
    const owners = [...keep, ...Array.from(new Set(userIds)).map((user_id) => ({ user_id, owner_type: 'it' as const }))];
    setSavingOwners(true);
    try {
      const res = await api.post<TechnologyOwner[]>(`/technologies/${technology.id}/owners/bulk-replace`, {
        owners: owners.map((owner) => ({ user_id: owner.user_id, owner_type: owner.owner_type })),
      });
      onOwnersChange(res.data || []);
    } catch (err) {
      onError(getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
    } finally {
      setSavingOwners(false);
    }
  };

  const itOwners = technology.owners
    .filter((owner) => owner.owner_type === 'it')
    .map((owner) => ({ user_id: owner.user_id, user_display_name: owner.full_name || owner.user_id }));

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('workspace.technology.fields.editor')}>
          <EditorField value={editor} onChange={setEditor} onBlur={saveEditor} disabled={!canManage} placeholder={t('workspace.technology.placeholders.editor')} />
        </PropertyRow>
        <PropertyRow label={t('workspace.technology.fields.family')}>
          <Select
            value={technology.family || ''}
            onChange={(event) => onPatch({ family: String(event.target.value) })}
            variant="standard"
            disabled={!canManage}
            displayEmpty
            SelectDisplayProps={{ 'aria-label': t('workspace.technology.fields.family') } as React.HTMLAttributes<HTMLDivElement>}
            sx={drawerSelectSx}
          >
            {familyOptions.map((option) => (
              <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.label}</MenuItem>
            ))}
          </Select>
        </PropertyRow>
        {technology.family === 'directory' ? (
          <PropertyRow label={t('workspace.technology.fields.adminZone')}>
            <Select
              value={technology.admin_zone || ''}
              onChange={(event) => onPatch({ admin_zone: String(event.target.value) || null })}
              variant="standard"
              disabled={!canManage}
              displayEmpty
              SelectDisplayProps={{ 'aria-label': t('workspace.technology.fields.adminZone') } as React.HTMLAttributes<HTMLDivElement>}
              sx={drawerSelectSx}
              renderValue={(value) => (value
                ? zoneOptions.find((option) => option.code === value)?.label ?? String(value)
                : <Box component="span" sx={(theme) => ({ color: theme.palette.kanap.text.tertiary })}>{t('workspace.technology.placeholders.noAdminZone')}</Box>)}
            >
              <MenuItem value="" sx={drawerMenuItemSx}>{t('workspace.technology.placeholders.noAdminZone')}</MenuItem>
              {zoneOptions.map((option) => (
                <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.label}</MenuItem>
              ))}
            </Select>
          </PropertyRow>
        ) : technology.admin_zone ? (
          <PropertyRow
            label={t('workspace.technology.fields.adminZone')}
            helperText={t('workspace.technology.fields.adminZoneUnused')}
          >
            <Box component="span">{zoneOptions.find((option) => option.code === technology.admin_zone)?.label ?? technology.admin_zone}</Box>
          </PropertyRow>
        ) : null}
        <PropertyRow label={t('workspace.technology.fields.hostingType')}>
          <Select
            value={technology.hosting_type || ''}
            onChange={(event) => onPatch({ hosting_type: String(event.target.value) })}
            variant="standard"
            disabled={!canManage}
            displayEmpty
            SelectDisplayProps={{ 'aria-label': t('workspace.technology.fields.hostingType') } as React.HTMLAttributes<HTMLDivElement>}
            sx={drawerSelectSx}
          >
            {hostingTypeOptions.map((option) => (
              <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>{option.label}</MenuItem>
            ))}
          </Select>
        </PropertyRow>
        <PropertyRow label={t('workspace.technology.fields.replacedBy')}>
          <ReplacementSelect
            technologyId={technology.id}
            value={technology.replaced_by_id}
            onChange={(id) => onPatch({ replaced_by_id: id })}
            disabled={!canManage}
          />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup>
        <PropertyRow label={t('workspace.technology.fields.itOwners')}>
          <TeamMemberMultiSelect
            label={t('workspace.technology.fields.itOwners')}
            value={itOwners}
            onChange={(userIds) => replaceItOwners(userIds)}
            disabled={!canManage || savingOwners}
            hideLabel
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
      </PropertyGroup>
    </>
  );
}

function CpeProducts({ values, canManage, onChange }: { values: string[]; canManage: boolean; onChange: (values: string[]) => void }) {
  const { t } = useTranslation(['it', 'common']);
  const [draft, setDraft] = React.useState('');
  const [invalid, setInvalid] = React.useState(false);
  const add = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!CPE_PRODUCT_PATTERN.test(value)) { setInvalid(true); return; }
    setInvalid(false);
    setDraft('');
    if (!values.includes(value)) onChange([...values, value]);
  };
  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {values.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>{t('workspace.technology.cpe.empty')}</Typography>
        )}
        {values.map((value) => (
          <Chip
            key={value}
            size="small"
            variant="outlined"
            label={value}
            sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12 }}
            onDelete={canManage ? () => onChange(values.filter((item) => item !== value)) : undefined}
            deleteIcon={canManage ? <DeleteIcon aria-label={t('workspace.technology.cpe.remove', { value })} /> : undefined}
          />
        ))}
      </Box>
      {canManage && (
        <Box sx={{ maxWidth: 360 }}>
          <TextField
            variant="standard"
            value={draft}
            fullWidth
            placeholder={t('workspace.technology.placeholders.cpe')}
            error={invalid}
            helperText={invalid ? t('workspace.technology.cpe.invalid') : undefined}
            inputProps={{ 'aria-label': t('workspace.technology.cpe.add') }}
            onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
            onBlur={() => { if (draft.trim()) add(); }}
          />
        </Box>
      )}
      <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary })}>
        {t('workspace.technology.cpe.hint')}{' '}
        <Link href={CPE_DICTIONARY_URL} target="_blank" rel="noreferrer">{t('workspace.technology.cpe.dictionary')}</Link>
      </Typography>
    </Stack>
  );
}

type VersionDraft = { label: string; standard_support_end: string; extended_support_end: string };

function statusLabel(status: SupportState, t: TFunction) {
  return t(`workspace.technology.versions.status.${status}`);
}

/** The versions table, so a link from Compliance can bring it into view. */
export const TECHNOLOGY_VERSIONS_ANCHOR = 'technology-versions';

/**
 * "Warnungen" is the longest title, about 62px at 11px, plus the 13px hint icon.
 * 88px holds that line. The switch (about 40px) and the own-setting slot (6px) sit inside it.
 * With the other columns (170 + 170 + 150 + 64) the table stays inside 1000px.
 */
const ALERTS_COLUMN_SX = { width: 88, maxWidth: 88, whiteSpace: 'nowrap', px: 0, boxSizing: 'border-box' } as const;
const ALERTS_ROW_SX = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' } as const;
const ALERTS_SWITCHES_SX = { display: 'inline-flex', alignItems: 'center', gap: '4px', flex: '0 0 auto' } as const;

/** The version switches, packed to the trailing edge so every row lines up. */
function AlertsCell({ children }: { children: React.ReactNode }) {
  return (
    <TableCell sx={ALERTS_COLUMN_SX}>
      <Box sx={ALERTS_ROW_SX}>
        <Box sx={ALERTS_SWITCHES_SX}>{children}</Box>
      </Box>
    </TableCell>
  );
}

/** "Alerts" and the explanation of the column. The technology's own switch sits in the section title. */
function AlertsColumnHeader() {
  const { t } = useTranslation('it');
  const hint = t('workspace.technology.versions.alertsColumnHint');
  return (
    <TableCell sx={ALERTS_COLUMN_SX}>
      {/* Packed to the trailing edge, as the switches below it. */}
      <Box sx={{ ...ALERTS_ROW_SX, gap: 0.5 }}>
        <Box component="span" sx={{ fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit', color: 'inherit' }}>
          {t('workspace.technology.versions.alertsColumn')}
        </Box>
        <Tooltip title={hint}>
          <InfoOutlinedIcon tabIndex={0} role="img" aria-hidden={false} aria-label={hint} sx={{ fontSize: 13, color: 'kanap.text.tertiary' }} />
        </Tooltip>
      </Box>
    </TableCell>
  );
}

function AlertSwitch({ checked, disabled, label, tooltip, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  tooltip?: string;
  onChange?: (next: boolean) => void;
}) {
  const control = (
    <Switch
      size="small"
      checked={checked}
      disabled={disabled}
      onChange={(_, next) => onChange?.(next)}
      inputProps={{ 'aria-label': label, role: 'switch' }}
      sx={{ m: 0 }}
    />
  );
  if (!tooltip) return control;
  // A disabled switch does not receive hover: the span keeps the tooltip.
  return <Tooltip title={tooltip}><span>{control}</span></Tooltip>;
}

/** A version whose setting is its own (`vulnerability_alerts` is true or false). */
/**
 * The "own setting" dot. Its 6 px slot is kept on every row (hidden when the version follows the
 * technology), so every switch of the column sits at the same place.
 */
function OwnSettingMark({ visible }: { visible: boolean }) {
  const { t } = useTranslation('it');
  const label = t('workspace.technology.versions.alertsOwn');
  if (!visible) {
    return <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 6, height: 6, flex: '0 0 auto', visibility: 'hidden' }} />;
  }
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role="img"
        tabIndex={0}
        aria-label={label}
        data-own-setting=""
        sx={(theme) => ({
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: theme.palette.kanap.text.tertiary,
          flex: '0 0 auto',
        })}
      />
    </Tooltip>
  );
}

/** The confirmation for one version. Counts are named only when the detail already brought them. */
function versionDeleteCopy(version: TechnologyVersion, t: TFunction): { warning: string; dependants: boolean } {
  const { servers, applications, label } = version;
  if (typeof servers !== 'number' || typeof applications !== 'number') {
    return { warning: t('workspace.technology.versions.deletePlain', { label }), dependants: false };
  }
  if (servers + applications === 0) {
    return { warning: t('workspace.technology.versions.deleteUnused', { label }), dependants: false };
  }
  return {
    dependants: true,
    warning: t('workspace.technology.versions.deleteUsed', {
      label,
      servers: t('workspace.technology.versions.servers', { count: servers }),
      applications: t('workspace.technology.versions.applications', { count: applications }),
    }),
  };
}

function VersionsTable({ technology, canManage, onChanged, onError, unmatched, onAddIdentifier }: {
  technology: TechnologyDetail;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  /** No identifier: no version is matched to a vulnerability. */
  unmatched?: boolean;
  onAddIdentifier?: () => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  // No vulnerability feed (on-premise without it): nothing about vulnerabilities is shown, the alerts column neither.
  const { config } = useFeatures();
  const showAlerts = config.features.vulnerabilityFeed === true;
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<VersionDraft>({ label: '', standard_support_end: '', extended_support_end: '' });
  const [saving, setSaving] = React.useState(false);
  const [pending, setPending] = React.useState<TechnologyVersion | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [alertsBusy, setAlertsBusy] = React.useState(false);
  const alertsBusyRef = React.useRef(false);
  const technologyAlerts = technology.vulnerability_alerts === true;

  const startEdit = (version: TechnologyVersion | null) => {
    setEditing(version?.id ?? 'new');
    setDraft({
      label: version?.label ?? '',
      standard_support_end: version?.standard_support_end ?? '',
      extended_support_end: version?.extended_support_end ?? '',
    });
  };

  const save = async () => {
    if (!draft.label.trim()) return;
    setSaving(true);
    const body = {
      label: draft.label.trim(),
      standard_support_end: draft.standard_support_end || null,
      extended_support_end: draft.extended_support_end || null,
    };
    try {
      if (editing === 'new') await api.post(`/technologies/${technology.id}/versions`, body);
      else await api.patch(`/technologies/${technology.id}/versions/${editing}`, body);
      setEditing(null);
      await onChanged();
    } catch (err) {
      onError(getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!pending || removing) return;
    setRemoving(true);
    try {
      await api.delete(`/technologies/${technology.id}/versions/${pending.id}`);
      setPending(null);
      await onChanged();
    } catch (err) {
      onError(getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
    } finally {
      setRemoving(false);
    }
  };

  const pendingCopy = pending ? versionDeleteCopy(pending, t) : null;

  /**
   * After an alert setting is written: the technology is read again, and every vulnerability query
   * (this technology's section, the page's detail and counts) is marked stale, so each shows the
   * new state the next time it is on screen.
   */
  const alertsWritten = async () => {
    void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
    await onChanged();
  };

  /** Towards the technology's value the exception disappears (`null`); the other value is stored. */
  const setVersionAlerts = async (version: TechnologyVersion, next: boolean) => {
    if (alertsBusyRef.current) return;
    alertsBusyRef.current = true;
    setAlertsBusy(true);
    const value = next === technologyAlerts ? null : next;
    try {
      await api.patch(`/technologies/${technology.id}/versions/${version.id}`, { vulnerability_alerts: value });
      await alertsWritten();
    } catch (err) {
      onError(getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
    } finally {
      alertsBusyRef.current = false;
      setAlertsBusy(false);
    }
  };

  /**
   * The technology's setting replaces every version exception. A dry run counts them first:
   * with any, the change waits for a confirmation.
   */
  const setTechnologyAlerts = async (enabled: boolean) => {
    if (alertsBusyRef.current) return;
    alertsBusyRef.current = true;
    setAlertsBusy(true);
    const url = `/technologies/${technology.id}/vulnerability-alerts`;
    try {
      const preview = await api.put<{ versions_reset: number }>(url, { enabled }, { params: { dry_run: true } });
      const versionsReset = Number(preview.data?.versions_reset ?? 0);
      if (versionsReset > 0) {
        const accepted = await dialogs.confirm({
          title: t('workspace.technology.versions.alertsConfirmTitle'),
          message: t('workspace.technology.versions.alertsReset', { count: versionsReset }),
          confirmLabel: t('workspace.technology.versions.alertsReplace'),
        });
        if (!accepted) return;
      }
      await api.put(url, { enabled });
      await alertsWritten();
    } catch (err) {
      onError(getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
    } finally {
      alertsBusyRef.current = false;
      setAlertsBusy(false);
    }
  };

  React.useEffect(() => {
    if (window.location.hash !== `#${TECHNOLOGY_VERSIONS_ANCHOR}`) return;
    document.getElementById(TECHNOLOGY_VERSIONS_ANCHOR)?.scrollIntoView({ block: 'start' });
  }, []);

  const editRow = (key: string) => (
    <TableRow key={key}>
      <TableCell>
        <TextField
          variant="standard"
          value={draft.label}
          autoFocus
          fullWidth
          placeholder="2022"
          inputProps={{ 'aria-label': t('workspace.technology.versions.label') }}
          onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } if (event.key === 'Escape') setEditing(null); }}
        />
      </TableCell>
      <TableCell>
        <DateEUField label="" hideLabel size="small" valueYmd={draft.standard_support_end} onChangeYmd={(value) => setDraft((prev) => ({ ...prev, standard_support_end: value }))} />
      </TableCell>
      <TableCell>
        <DateEUField label="" hideLabel size="small" valueYmd={draft.extended_support_end} onChangeYmd={(value) => setDraft((prev) => ({ ...prev, extended_support_end: value }))} />
      </TableCell>
      <TableCell colSpan={showAlerts ? 3 : 2} align="right">
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Button variant="action" size="small" onClick={() => setEditing(null)}>{t('common:buttons.cancel')}</Button>
          <Button variant="action-primary" size="small" disabled={!draft.label.trim() || saving} onClick={() => { void save(); }}>
            {t('common:buttons.save')}
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  );

  const includeLabel = t('workspace.technology.versions.includeInAlerts');
  const technologySwitch = showAlerts ? (
    <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 13, color: 'kanap.text.secondary' }}>
      <AlertSwitch
        checked={technologyAlerts}
        disabled={!canManage || alertsBusy}
        label={includeLabel}
        tooltip={t('workspace.technology.versions.alertsHint')}
        onChange={(next) => { void setTechnologyAlerts(next); }}
      />
      {includeLabel}
    </Box>
  ) : null;

  return (
    <Box id={TECHNOLOGY_VERSIONS_ANCHOR}>
      <SectionLabel
        action={(technologySwitch || (canManage && editing !== 'new')) ? (
          <Stack direction="row" spacing={1} alignItems="center">
            {technologySwitch}
            {canManage && editing !== 'new' ? (
              <Button variant="action" size="small" onClick={() => startEdit(null)}>{t('workspace.technology.versions.add')}</Button>
            ) : null}
          </Stack>
        ) : undefined}
      >
        {t('workspace.technology.versions.title')}
      </SectionLabel>
      {unmatched && (
        <Typography sx={{ mt: -0.5, mb: 1, fontSize: 12, lineHeight: 1.4, color: 'kanap.text.tertiary' }}>
          {t('workspace.technology.identifiers.versionsUnmatched')}
          {canManage && onAddIdentifier ? (
            <>
              {' '}
              <Box component="button" type="button" onClick={onAddIdentifier} sx={tealLinkSx}>
                {t('workspace.technology.identifiers.add')}
              </Box>
            </>
          ) : null}
        </Typography>
      )}
      <Table
        size="small"
        aria-label={t('workspace.technology.versions.title')}
        sx={(th) => ({
          '& th': { fontSize: 11, fontWeight: 500, color: th.palette.kanap.text.tertiary, borderBottom: `1px solid ${th.palette.kanap.border.default}`, py: '5px' },
          '& td': { fontSize: 13, color: th.palette.kanap.text.primary, borderBottom: `1px solid ${th.palette.kanap.border.soft}`, py: '6px' },
          '& tbody tr:hover': { bgcolor: th.palette.kanap.bg.hover },
          '& .hover-actions': { opacity: 0, transition: 'opacity 120ms' },
          '& tbody tr:hover .hover-actions, & .hover-actions:focus-within': { opacity: 1 },
        })}
      >
        <TableHead>
          <TableRow>
            <TableCell>{t('workspace.technology.versions.label')}</TableCell>
            <TableCell sx={{ width: 170 }}>{t('workspace.technology.versions.standardEnd')}</TableCell>
            <TableCell sx={{ width: 170 }}>{t('workspace.technology.versions.extendedEnd')}</TableCell>
            <TableCell sx={{ width: 150 }}>{t('workspace.technology.versions.statusHeader')}</TableCell>
            {showAlerts && <AlertsColumnHeader />}
            {canManage && <TableCell sx={{ width: 64 }} />}
          </TableRow>
        </TableHead>
        <TableBody>
          {technology.versions.length === 0 && editing !== 'new' && (
            <TableRow>
              <TableCell colSpan={(canManage ? 6 : 5) - (showAlerts ? 0 : 1)} sx={(th) => ({ color: `${th.palette.kanap.text.tertiary} !important` })}>
                {t('workspace.technology.versions.empty')}
              </TableCell>
            </TableRow>
          )}
          {technology.versions.map((version) => {
            if (editing === version.id) return editRow(version.id);
            const status = supportStateOf(version.standard_support_end, version.extended_support_end);
            return (
              <TableRow key={version.id}>
                <TableCell>
                  <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY }}>{version.label}</Box>
                  {version.catalog_key && (
                    <Tooltip title={t('workspace.technology.versions.fromCatalogHint')}>
                      <Box component="span" tabIndex={0} sx={(th) => ({ ml: 1, fontSize: 11, color: th.palette.kanap.text.tertiary })}>
                        {t('workspace.technology.versions.fromCatalog')}
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>{formatSupportDate(version.standard_support_end, locale, '—')}</TableCell>
                <TableCell>{formatSupportDate(version.extended_support_end, locale, '—')}</TableCell>
                <TableCell>
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} data-status={status}>
                    <StatusDot color={supportStateColor(status, theme)} />
                    {statusLabel(status, t)}
                  </Box>
                </TableCell>
                {showAlerts && (
                  <AlertsCell>
                    <AlertSwitch
                      checked={version.vulnerability_alerts_effective ?? technologyAlerts}
                      disabled={!canManage || alertsBusy}
                      label={t('workspace.technology.versions.alertsFor', { label: version.label })}
                      onChange={(next) => { void setVersionAlerts(version, next); }}
                    />
                    <OwnSettingMark visible={version.vulnerability_alerts != null} />
                  </AlertsCell>
                )}
                {canManage && (
                  <TableCell align="right">
                    <Box className="hover-actions" sx={{ display: 'inline-flex' }}>
                      <IconButton size="small" aria-label={t('workspace.technology.versions.edit', { label: version.label })} onClick={() => startEdit(version)}>
                        <EditIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" aria-label={t('workspace.technology.versions.remove', { label: version.label })} onClick={() => setPending(version)}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {editing === 'new' && editRow('new')}
        </TableBody>
      </Table>
      {technology.catalog_key && (
        <Typography sx={(th) => ({ mt: 0.75, fontSize: 12, color: th.palette.kanap.text.tertiary })}>
          {t('workspace.technology.versions.catalogNote')}
        </Typography>
      )}
      <DeleteConfirmDialog
        open={pending != null}
        onClose={() => { if (!removing) setPending(null); }}
        onConfirm={() => { void confirmRemove(); }}
        title={pending ? t('workspace.technology.versions.deleteTitle', { label: pending.label }) : ''}
        warning={pendingCopy?.warning}
        confirmLabel={pendingCopy?.dependants ? t('workspace.technology.deleteAnyway') : t('common:buttons.delete')}
        itemCount={1}
        items={pending ? [{ id: pending.id, name: pending.label }] : []}
        loading={removing}
      />
    </Box>
  );
}

/** The group of the CPE product identifiers and the CVE.org names, so the Versions section can bring it into view. */
export const TECHNOLOGY_IDENTIFIERS_ANCHOR = 'technology-vulnerability-identifiers';

/**
 * The identifiers vulnerabilities are matched on, in one group. Folded by default when the technology
 * has one; its title then says what it holds. Open with a warning when it has none.
 */
function VulnerabilityIdentifiers({ open, onToggle, toggleRef, cpeCount, cveNameCount, cveNamesShown, warn, children }: {
  open: boolean;
  onToggle: () => void;
  toggleRef: React.Ref<HTMLButtonElement>;
  cpeCount: number;
  cveNameCount: number;
  cveNamesShown: boolean;
  /** The vulnerability feed is on: a missing identifier is worth a warning. */
  warn: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('it');
  const contentId = React.useId();
  const none = cpeCount + cveNameCount === 0;
  const summary = [
    t('workspace.technology.identifiers.cpeCount', { count: cpeCount }),
    ...(cveNamesShown ? [t('workspace.technology.identifiers.cveNameCount', { count: cveNameCount })] : []),
  ].join(' · ');
  return (
    <Box id={TECHNOLOGY_IDENTIFIERS_ANCHOR} sx={{ scrollMarginTop: 16 }}>
      <Typography component="h2" sx={{ m: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>
        <Box
          component="button"
          type="button"
          ref={toggleRef}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            width: '100%',
            p: 0,
            border: 0,
            background: 'none',
            font: 'inherit',
            textAlign: 'left',
            color: 'kanap.text.primary',
            cursor: 'pointer',
            '&:hover .identifiers-chevron': { color: 'kanap.text.primary' },
          }}
        >
          <Box component="span" sx={{ minWidth: 0 }}>
            {t('workspace.technology.identifiers.title')}
            {!none && (
              <Box component="span" sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.tertiary' }}>{` · ${summary}`}</Box>
            )}
          </Box>
          <Box sx={{ flex: 1 }} />
          {open
            ? <ExpandLessIcon className="identifiers-chevron" aria-hidden sx={{ fontSize: 16, color: 'kanap.text.tertiary' }} />
            : <ExpandMoreIcon className="identifiers-chevron" aria-hidden sx={{ fontSize: 16, color: 'kanap.text.tertiary' }} />}
        </Box>
      </Typography>
      {warn && none && (
        <Typography
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mt: 0.5,
            fontSize: 12,
            lineHeight: 1.4,
            color: theme.palette.mode === 'dark' ? theme.palette.warning.main : theme.palette.warning.dark,
          })}
        >
          <WarningAmberOutlined aria-hidden sx={{ fontSize: 14, flex: '0 0 auto' }} />
          {cveNamesShown ? t('workspace.technology.identifiers.missing') : t('workspace.technology.identifiers.missingCpe')}
        </Typography>
      )}
      {open && (
        <Stack id={contentId} spacing={3} sx={{ mt: 1.5 }}>
          {children}
        </Stack>
      )}
    </Box>
  );
}

/** The Overview tab: description, notes, CPE product identifiers, CVE.org names and versions. */
export default function TechnologyOverviewTab({ technology, canManage, onPatch, onVersionsChanged, onError }: {
  technology: TechnologyDetail;
  canManage: boolean;
  onPatch: (patch: TechnologyPatch) => void | Promise<void>;
  onVersionsChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const { config } = useFeatures();
  const cveNamesShown = config.features.cveNames === true;
  const vulnerabilityFeed = config.features.vulnerabilityFeed === true;
  const cpeCount = (technology.cpe_products ?? []).length;
  // Without the CVE.org list, its names match nothing: they do not count as identifiers.
  const cveNameCount = cveNamesShown ? (technology.cve_names ?? []).length : 0;
  const hasIdentifiers = cpeCount + cveNameCount > 0;
  // Folded when the technology has an identifier, open when it has none. The choice is made once per
  // technology: the group stays open while its first identifier is added.
  const [openState, setOpenState] = React.useState(() => ({ id: technology.id, open: !hasIdentifiers }));
  if (openState.id !== technology.id) setOpenState({ id: technology.id, open: !hasIdentifiers });
  const identifiersOpen = openState.id === technology.id ? openState.open : !hasIdentifiers;
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const [scrollRequest, setScrollRequest] = React.useState(0);
  React.useEffect(() => {
    if (scrollRequest === 0) return;
    document.getElementById(TECHNOLOGY_IDENTIFIERS_ANCHOR)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    toggleRef.current?.focus({ preventScroll: true });
  }, [scrollRequest]);
  const showIdentifiers = () => {
    setOpenState({ id: technology.id, open: true });
    setScrollRequest((current) => current + 1);
  };
  return (
    <Stack spacing={3.5}>
      <Box>
        <SectionLabel>{t('workspace.technology.fields.description')}</SectionLabel>
        <AutosaveText
          value={technology.description}
          onSave={(description) => onPatch({ description })}
          disabled={!canManage}
          multiline
          composer
          ariaLabel={t('workspace.technology.fields.description')}
          placeholder={t('workspace.technology.placeholders.description')}
        />
      </Box>
      <VersionsTable
        technology={technology}
        canManage={canManage}
        onChanged={onVersionsChanged}
        onError={onError}
        unmatched={vulnerabilityFeed && !hasIdentifiers}
        onAddIdentifier={showIdentifiers}
      />
      <VulnerabilityIdentifiers
        open={identifiersOpen}
        onToggle={() => setOpenState({ id: technology.id, open: !identifiersOpen })}
        toggleRef={toggleRef}
        cpeCount={cpeCount}
        cveNameCount={cveNameCount}
        cveNamesShown={cveNamesShown}
        warn={vulnerabilityFeed}
      >
        <Box>
          <SectionLabel>{t('workspace.technology.cpe.title')}</SectionLabel>
          <CpeProducts values={technology.cpe_products || []} canManage={canManage} onChange={(cpe_products) => onPatch({ cpe_products })} />
        </Box>
        {cveNamesShown && (
          <TechnologyCveNames
            technologyId={technology.id}
            names={technology.cve_names ?? []}
            cpeProducts={technology.cpe_products ?? []}
            canManage={canManage}
            onChange={(cve_names) => onPatch({ cve_names })}
          />
        )}
      </VulnerabilityIdentifiers>
      <Box>
        <SectionLabel>{t('workspace.technology.fields.notes')}</SectionLabel>
        <AutosaveText
          value={technology.notes}
          onSave={(notes) => onPatch({ notes })}
          disabled={!canManage}
          multiline
          composer
          ariaLabel={t('workspace.technology.fields.notes')}
          placeholder={t('workspace.technology.placeholders.notes')}
        />
      </Box>
    </Stack>
  );
}
