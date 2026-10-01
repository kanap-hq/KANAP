import React from 'react';
import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyGroup, PropertyRow } from '../../components/design';
import CostCenterSelect from '../../components/fields/CostCenterSelect';
import CompanySelect from '../../components/fields/CompanySelect';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import MetadataUserPicker from '../../components/workspace/MetadataUserPicker';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import type { CostCenterDetail, CostCenterKind } from '../../services/costCenters';
import { COST_CENTER_KINDS, type CostCenterField } from './costCenterFields';

type Props = {
  node: CostCenterDetail;
  /** The type shown, which differs from the stored one while a group waits for its company. */
  kind: CostCenterKind;
  disabled: boolean;
  errors: Partial<Record<CostCenterField, string>>;
  /** The node and its subtree, which cannot become its parent. */
  excludeParentIds: ReadonlySet<string>;
  /** Types the node cannot take (a group that contains nodes cannot become a cost center). */
  unavailableKinds?: CostCenterKind[];
  onCodeCommit: (code: string) => void;
  onKindChange: (kind: CostCenterKind) => void;
  onParentChange: (parentId: string | null) => void;
  onCompanyChange: (companyId: string | null) => void;
  onOwnerChange: (userId: string | null) => void;
  onDisabledAtChange: (disabledAt: string | null) => void;
};

export function ErrorLine({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Typography role="alert" sx={{ mt: '2px', fontSize: 12, lineHeight: 1.35, color: 'error.main' }}>
      {message}
    </Typography>
  );
}

export default function CostCenterPropertiesDrawer({
  node,
  kind,
  disabled,
  errors,
  excludeParentIds,
  unavailableKinds = [],
  onCodeCommit,
  onKindChange,
  onParentChange,
  onCompanyChange,
  onOwnerChange,
  onDisabledAtChange,
}: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  // A refused code stays in the field so it can be corrected; a stored change replaces it,
  // except while the user is typing in the field.
  const { draft: code, setDraft: setCode, onFocus: onCodeFocus, onBlur: onCodeBlur } = useFieldDraft(node.code);

  const commitCode = () => {
    onCodeBlur();
    const trimmed = code.trim();
    if (!trimmed) {
      setCode(node.code);
      return;
    }
    if (trimmed !== node.code) onCodeCommit(trimmed);
  };

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('costCenters.fields.code')} required helperText={t('costCenters.hints.code')}>
          <TextField
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onFocus={onCodeFocus}
            onBlur={commitCode}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
            variant="standard"
            sx={drawerFieldValueSx}
            placeholder={t('costCenters.placeholders.code')}
            disabled={disabled}
            error={!!errors.code}
            helperText={errors.code}
            inputProps={{ 'aria-label': t('costCenters.fields.code'), autoComplete: 'off', spellCheck: false }}
          />
        </PropertyRow>
        <PropertyRow label={t('costCenters.fields.type')} required>
          <TextField
            select
            value={kind}
            onChange={(event) => onKindChange(event.target.value as CostCenterKind)}
            variant="standard"
            sx={drawerSelectSx}
            disabled={disabled}
            error={!!errors.kind}
            helperText={errors.kind}
            inputProps={{ 'aria-label': t('costCenters.fields.type') }}
          >
            {COST_CENTER_KINDS.map((value) => (
              <MenuItem key={value} value={value} disabled={unavailableKinds.includes(value)} sx={drawerMenuItemSx}>
                {t(`costCenters.kinds.${value}`)}
              </MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label={t('costCenters.fields.parent')}>
          <CostCenterSelect
            hideLabel
            selectable="groups"
            value={node.parent_id}
            excludeIds={excludeParentIds}
            onChange={(id) => onParentChange(id)}
            placeholder={t('costCenters.placeholders.topLevel')}
            disabled={disabled}
            error={!!errors.parent_id}
            helperText={errors.parent_id}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        {kind === 'cost_center' && (
          <PropertyRow label={t('costCenters.fields.company')} required helperText={t('costCenters.hints.company')}>
            <CompanySelect
              hideLabel
              value={node.company_id}
              onChange={onCompanyChange}
              disabled={disabled}
              disableClearable
              error={!!errors.company_id}
              helperText={errors.company_id}
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>
        )}
        <PropertyRow label={t('costCenters.fields.owner')} helperText={t('costCenters.hints.owner')}>
          <Box>
            <MetadataUserPicker
              value={node.owner_user_id}
              displayName={node.owner_name}
              placeholder={t('costCenters.placeholders.ownerMissing')}
              searchPlaceholder={t('costCenters.fields.owner')}
              disabled={disabled}
              showAvatar={false}
              onChange={onOwnerChange}
              sx={{ maxWidth: '100%' }}
            />
            <ErrorLine message={errors.owner_user_id} />
          </Box>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
          <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
            {t('costCenters.fields.lifecycle')}
          </Typography>
          <StatusLifecycleField
            status={node.status}
            // The date carries the change (the switch sets it too); the server derives the status from it.
            onStatusChange={() => undefined}
            disabledAt={node.disabled_at}
            onDisabledAtChange={onDisabledAtChange}
            disabled={disabled}
            disabledAtError={!!errors.disabled_at}
            disabledAtHelperText={errors.disabled_at}
          />
        </Box>
      </PropertyGroup>
    </>
  );
}
