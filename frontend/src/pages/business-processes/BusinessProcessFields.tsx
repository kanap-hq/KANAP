import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, TextField, Typography } from '@mui/material';
import { PropertyGroup, PropertyRow } from '../../components/design';
import BusinessProcessCategoryMultiSelect from '../../components/fields/BusinessProcessCategoryMultiSelect';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import UserSelect from '../../components/fields/UserSelect';
import { STATUS_DISABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';

export type BusinessProcess = {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  status: string;
  disabled_at: string | null;
  owner_user_id: string | null;
  it_owner_user_id: string | null;
  categories: Array<{ id: string; name: string; is_active: boolean }>;
};

/** What the page writes: the stored keys, categories as their ids. */
export type BusinessProcessPatch = Partial<Pick<BusinessProcess,
  'name' | 'description' | 'notes' | 'status' | 'disabled_at' | 'owner_user_id' | 'it_owner_user_id'>> & {
  category_ids?: string[];
};

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
  categories: [],
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

/** The properties panel: categories, the two owners and the end of validity, each saved on change. */
export function BusinessProcessProperties({ process, disabled, onPatch, onManageCategories }: {
  process: BusinessProcess;
  disabled: boolean;
  onPatch: (patch: BusinessProcessPatch) => void;
  onManageCategories: () => void;
}) {
  const { t } = useTranslation(['master-data']);
  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('businessProcesses.fields.categories')}>
          <BusinessProcessCategoryMultiSelect
            hideLabel
            label={t('businessProcesses.fields.categories')}
            value={process.categories.map((category) => category.id)}
            onChange={(category_ids) => onPatch({ category_ids })}
            disabled={disabled}
            onManageCategoriesClick={onManageCategories}
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
