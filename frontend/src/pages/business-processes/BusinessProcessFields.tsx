import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { PropertyGroup, PropertyRow } from '../../components/design';
import BusinessProcessParentSelect from '../../components/fields/BusinessProcessParentSelect';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import UserSelect from '../../components/fields/UserSelect';
import { STATUS_DISABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import { BUSINESS_PROCESS_TYPES, type BusinessProcessType } from '../../hooks/useBusinessProcessTree';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx, longFormSurfaceFieldSx } from '../../theme/formSx';

export type BusinessProcess = {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  status: string;
  disabled_at: string | null;
  owner_user_id: string | null;
  it_owner_user_id: string | null;
  process_type: BusinessProcessType | null;
  parent_id: string | null;
  /** The parent as the detail names it. */
  parent?: { id: string; name: string } | null;
};

/** What the page writes: the stored keys. */
export type BusinessProcessPatch = Partial<Pick<BusinessProcess,
  'name' | 'description' | 'notes' | 'status' | 'disabled_at' | 'owner_user_id' | 'it_owner_user_id' | 'process_type' | 'parent_id'>>;

/** The empty process the new page draws, dimmed, under the title to type. */
export const EMPTY_BUSINESS_PROCESS: BusinessProcess = {
  id: '',
  name: '',
  description: null,
  notes: null,
  status: 'enabled',
  disabled_at: null,
  owner_user_id: null,
  it_owner_user_id: null,
  process_type: null,
  parent_id: null,
  parent: null,
};

const sectionLabelSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 } as const;

/** A long text saved when it leaves the field. */
function LongTextField({ label, placeholder, value, disabled, onCommit }: {
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onCommit: (next: string | null) => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <Box>
      <Typography sx={sectionLabelSx}>{label}</Typography>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          const next = draft.trim() || null;
          if (next !== (value.trim() || null)) onCommit(next);
        }}
        multiline
        minRows={3}
        variant="standard"
        placeholder={placeholder}
        disabled={disabled}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': label }}
      />
    </Box>
  );
}

/** The Overview tab: what the process covers, and the notes. */
export function BusinessProcessOverview({ process, disabled, onPatch }: {
  process: BusinessProcess;
  disabled: boolean;
  onPatch: (patch: BusinessProcessPatch) => void;
}) {
  const { t } = useTranslation(['master-data']);
  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      <LongTextField
        label={t('shared.fields.description')}
        placeholder={t('businessProcesses.fields.descriptionPlaceholder')}
        value={process.description ?? ''}
        disabled={disabled}
        onCommit={(description) => onPatch({ description })}
      />
      <LongTextField
        label={t('shared.fields.notes')}
        placeholder={t('businessProcesses.fields.notesPlaceholder')}
        value={process.notes ?? ''}
        disabled={disabled}
        onCommit={(notes) => onPatch({ notes })}
      />
    </Stack>
  );
}

/** The properties panel: type, parent, the two owners and the end of validity, each saved on change. */
export function BusinessProcessProperties({ process, disabled, onPatch }: {
  process: BusinessProcess;
  disabled: boolean;
  onPatch: (patch: BusinessProcessPatch) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('businessProcesses.fields.type')}>
          <TextField
            select
            value={process.process_type ?? ''}
            onChange={(event) => {
              const process_type = (event.target.value || null) as BusinessProcessType | null;
              if (process_type !== process.process_type) onPatch({ process_type });
            }}
            variant="standard"
            sx={drawerSelectSx}
            disabled={disabled}
            SelectProps={{
              displayEmpty: true,
              SelectDisplayProps: { 'aria-label': t('businessProcesses.fields.type') } as React.HTMLAttributes<HTMLDivElement>,
              renderValue: (value) => (value
                ? t(`businessProcesses.types.${value as string}`)
                : <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('common:selects.notSet')}</Box>),
            }}
            inputProps={{ 'aria-label': t('businessProcesses.fields.type') }}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{t('common:selects.notSet')}</MenuItem>
            {BUSINESS_PROCESS_TYPES.map((value) => (
              <MenuItem key={value} value={value} sx={drawerMenuItemSx}>
                {t(`businessProcesses.types.${value}`)}
              </MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label={t('businessProcesses.fields.parent')}>
          <BusinessProcessParentSelect
            label={t('businessProcesses.fields.parent')}
            value={process.parent_id}
            selectedOption={process.parent ?? null}
            processId={process.id || null}
            onChange={(parent_id) => {
              if (parent_id !== process.parent_id) onPatch({ parent_id });
            }}
            placeholder={t('businessProcesses.placeholders.topLevel')}
            disabled={disabled}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('businessProcesses.fields.processOwner')}>
          <UserSelect
            hideLabel
            label={t('businessProcesses.fields.processOwner')}
            value={process.owner_user_id}
            onChange={(owner_user_id) => {
              if (owner_user_id !== process.owner_user_id) onPatch({ owner_user_id });
            }}
            disabled={disabled}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('businessProcesses.fields.itOwner')}>
          <UserSelect
            hideLabel
            label={t('businessProcesses.fields.itOwner')}
            value={process.it_owner_user_id}
            onChange={(it_owner_user_id) => {
              if (it_owner_user_id !== process.it_owner_user_id) onPatch({ it_owner_user_id });
            }}
            disabled={disabled}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
          <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
            {t('businessProcesses.fields.lifecycle')}
          </Typography>
          <StatusLifecycleField
            status={normalizeStatus(process.status)}
            // The date carries the change (the switch sets it too); the server derives the status from it.
            onStatusChange={() => undefined}
            disabledAt={process.disabled_at}
            onDisabledAtChange={(disabled_at) => {
              if (disabled_at === process.disabled_at) return;
              onPatch({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
            }}
            // Disable now: the status alone, the server sets the end of validity from its own clock.
            onDisableNow={() => onPatch({ status: STATUS_DISABLED })}
            disabled={disabled}
          />
        </Box>
      </PropertyGroup>
    </>
  );
}
