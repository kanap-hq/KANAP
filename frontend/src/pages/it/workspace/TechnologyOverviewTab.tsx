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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '../../../api';
import { PropertyGroup, PropertyRow, StatusDot, useKanapDialogs } from '../../../components/design';
import DateEUField from '../../../components/fields/DateEUField';
import TeamMemberMultiSelect from '../../../components/fields/TeamMemberMultiSelect';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { useLookupPicker } from '../../../hooks/useLookupPicker';
import { formatShortDate } from '../../../lib/dateFormat';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { useLocale } from '../../../i18n/useLocale';
import { drawerAutocompleteListboxSx, drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { EditorField } from '../components/TechnologyCreateDialog';

export type TechnologyVersion = {
  id: string;
  label: string;
  cpe_version: string | null;
  build_prefixes: string[];
  standard_support_end: string | null;
  extended_support_end: string | null;
  notes: string | null;
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
  mode: 'installed' | 'subscribed';
  lifecycle: string;
  description: string | null;
  notes: string | null;
  cpe_products: string[];
  replaced_by_id: string | null;
  replaced_by: { id: string; name: string; reference: string } | null;
  versions: TechnologyVersion[];
  owners: TechnologyOwner[];
};

export type TechnologyPatch = Partial<Pick<TechnologyDetail,
  'name' | 'editor' | 'family' | 'mode' | 'lifecycle' | 'description' | 'notes' | 'cpe_products' | 'replaced_by_id'>>;

/** `part:vendor:product`, the product part of a CPE name (`a:microsoft:sql_server`). */
// The server's rule (`CPE_PRODUCT_RE` in backend/src/technologies/technology-rows.ts), on the lower-cased value.
export const CPE_PRODUCT_PATTERN = /^[aoh]:[a-z0-9._\-~%!]{1,100}:[a-z0-9._\-~%!]{1,100}$/;
export const CPE_DICTIONARY_URL = 'https://nvd.nist.gov/products/cpe/search';

export type VersionStatus = 'supported' | 'extended' | 'ended' | 'unknown';

/** Where a version stands today from its end dates (YYYY-MM-DD, inclusive). */
export function versionStatus(version: Pick<TechnologyVersion, 'standard_support_end' | 'extended_support_end'>, today = new Date()): VersionStatus {
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const standard = version.standard_support_end?.slice(0, 10) || null;
  const extended = version.extended_support_end?.slice(0, 10) || null;
  if (standard && day <= standard) return 'supported';
  if (extended && day <= extended) return 'extended';
  if (standard || extended) return 'ended';
  return 'unknown';
}

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
function AutosaveText({ value, onSave, disabled, multiline, placeholder, ariaLabel, composer }: {
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

/** Properties drawer of the technology: editor, family, mode, replacement and owners. */
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

  const saveEditor = () => {
    const next = editor.trim() || null;
    if (next !== (technology.editor ?? null)) onPatch({ editor: next });
  };

  const replaceOwnersByType = async (ownerType: 'business' | 'it', userIds: string[]) => {
    const keep = technology.owners.filter((owner) => owner.owner_type !== ownerType);
    const owners = [...keep, ...Array.from(new Set(userIds)).map((user_id) => ({ user_id, owner_type: ownerType }))];
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

  const ownerValue = (type: 'business' | 'it') => technology.owners
    .filter((owner) => owner.owner_type === type)
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
        <PropertyRow label={t('workspace.technology.fields.mode')}>
          <Select
            value={technology.mode || 'installed'}
            onChange={(event) => onPatch({ mode: event.target.value as TechnologyDetail['mode'] })}
            variant="standard"
            disabled={!canManage}
            SelectDisplayProps={{ 'aria-label': t('workspace.technology.fields.mode') } as React.HTMLAttributes<HTMLDivElement>}
            sx={drawerSelectSx}
          >
            <MenuItem value="installed" sx={drawerMenuItemSx}>{t('workspace.technology.modes.installed')}</MenuItem>
            <MenuItem value="subscribed" sx={drawerMenuItemSx}>{t('workspace.technology.modes.subscribed')}</MenuItem>
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
        <PropertyRow label={t('workspace.technology.fields.businessOwners')}>
          <TeamMemberMultiSelect
            label={t('workspace.technology.fields.businessOwners')}
            value={ownerValue('business')}
            onChange={(userIds) => replaceOwnersByType('business', userIds)}
            disabled={!canManage || savingOwners}
            hideLabel
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('workspace.technology.fields.itOwners')}>
          <TeamMemberMultiSelect
            label={t('workspace.technology.fields.itOwners')}
            value={ownerValue('it')}
            onChange={(userIds) => replaceOwnersByType('it', userIds)}
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

function statusLabel(status: VersionStatus, t: TFunction) {
  return t(`workspace.technology.versions.status.${status}`);
}

function VersionsTable({ technology, canManage, onChanged, onError }: {
  technology: TechnologyDetail;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<VersionDraft>({ label: '', standard_support_end: '', extended_support_end: '' });
  const [saving, setSaving] = React.useState(false);
  const statusColor: Record<VersionStatus, string> = {
    supported: theme.palette.kanap.text.tertiary,
    extended: theme.palette.kanap.orange,
    ended: theme.palette.kanap.orange,
    unknown: theme.palette.kanap.text.tertiary,
  };

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

  const remove = async (version: TechnologyVersion) => {
    const used = (version.servers ?? 0) + (version.applications ?? 0);
    if (used > 0) {
      const confirmed = await dialogs.confirm({
        title: t('workspace.technology.versions.deleteTitle', { label: version.label }),
        message: t('workspace.technology.versions.deleteMessage', { count: used }),
        confirmLabel: t('common:buttons.delete'),
        intent: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      await api.delete(`/technologies/${technology.id}/versions/${version.id}`);
      await onChanged();
    } catch (err) {
      onError(getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
    }
  };

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
      <TableCell colSpan={2} align="right">
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Button variant="action" size="small" onClick={() => setEditing(null)}>{t('common:buttons.cancel')}</Button>
          <Button variant="action-primary" size="small" disabled={!draft.label.trim() || saving} onClick={() => { void save(); }}>
            {t('common:buttons.save')}
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  );

  return (
    <Box>
      <SectionLabel
        action={canManage && editing !== 'new' ? (
          <Button variant="action" size="small" onClick={() => startEdit(null)}>{t('workspace.technology.versions.add')}</Button>
        ) : undefined}
      >
        {t('workspace.technology.versions.title')}
      </SectionLabel>
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
            {canManage && <TableCell sx={{ width: 64 }} />}
          </TableRow>
        </TableHead>
        <TableBody>
          {technology.versions.length === 0 && editing !== 'new' && (
            <TableRow>
              <TableCell colSpan={canManage ? 5 : 4} sx={(th) => ({ color: `${th.palette.kanap.text.tertiary} !important` })}>
                {t('workspace.technology.versions.empty')}
              </TableCell>
            </TableRow>
          )}
          {technology.versions.map((version) => {
            if (editing === version.id) return editRow(version.id);
            const status = versionStatus(version);
            return (
              <TableRow key={version.id}>
                <TableCell sx={{ fontFamily: MONO_FONT_FAMILY }}>{version.label}</TableCell>
                <TableCell>{formatShortDate(version.standard_support_end, locale, { empty: '—' })}</TableCell>
                <TableCell>{formatShortDate(version.extended_support_end, locale, { empty: '—' })}</TableCell>
                <TableCell>
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} data-status={status}>
                    <StatusDot color={statusColor[status]} />
                    {statusLabel(status, t)}
                  </Box>
                </TableCell>
                {canManage && (
                  <TableCell align="right">
                    <Box className="hover-actions" sx={{ display: 'inline-flex' }}>
                      <IconButton size="small" aria-label={t('workspace.technology.versions.edit', { label: version.label })} onClick={() => startEdit(version)}>
                        <EditIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" aria-label={t('workspace.technology.versions.remove', { label: version.label })} onClick={() => { void remove(version); }}>
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
    </Box>
  );
}

/** The Overview tab: description, notes, CPE product identifiers and versions. */
export default function TechnologyOverviewTab({ technology, canManage, onPatch, onVersionsChanged, onError }: {
  technology: TechnologyDetail;
  canManage: boolean;
  onPatch: (patch: TechnologyPatch) => void;
  onVersionsChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
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
      <VersionsTable technology={technology} canManage={canManage} onChanged={onVersionsChanged} onError={onError} />
      <Box>
        <SectionLabel>{t('workspace.technology.cpe.title')}</SectionLabel>
        <CpeProducts values={technology.cpe_products || []} canManage={canManage} onChange={(cpe_products) => onPatch({ cpe_products })} />
      </Box>
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
