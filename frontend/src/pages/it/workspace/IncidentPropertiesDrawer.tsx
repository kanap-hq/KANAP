import React from 'react';
import { Box, MenuItem, Switch, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { INCIDENT_SEVERITIES, type IncidentSeverity, type IncidentStatus } from '../../../api/endpoints/incidents';
import { PropertyGroup, PropertyRow, StatusDot } from '../../../components/design';
import UserSelect from '../../../components/fields/UserSelect';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDateTime } from '../../../lib/dateFormat';
import {
  drawerFieldValueSx,
  drawerMenuItemSx,
  drawerSelectSx,
  selectPlaceholderSx,
} from '../../../theme/formSx';
import { getDotColor, INCIDENT_SEVERITY_COLORS, INCIDENT_STATUS_COLORS } from '../../../utils/statusColors';
import IncidentDateTimeField from './IncidentDateTimeField';
import {
  INCIDENT_STATUS_FLOW,
  incidentSeverityLabel,
  incidentStatusLabel,
  isForwardStatusMove,
} from './incidentWorkspace';

export type IncidentDrawerValues = {
  category: string | null;
  severity: IncidentSeverity | '';
  status: IncidentStatus;
  started_at: string | null;
  detected_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  reporter_user_id: string | null;
  owner_user_id: string | null;
  source_ref: string | null;
  personal_data_affected: boolean;
  authority_notification_required: boolean;
  confidential: boolean;
  authority_notified_at: string | null;
  notified_parties: string | null;
  created_at?: string;
  updated_at?: string;
};

export type IncidentDrawerPatch = Partial<Omit<IncidentDrawerValues, 'created_at' | 'updated_at'>>;

type Props = {
  values: IncidentDrawerValues;
  isCreate: boolean;
  disabled?: boolean;
  /** When true, the access switch stays off-limits (contributor cannot lift it). */
  restrictDisabled?: boolean;
  onChange: (patch: IncidentDrawerPatch) => void;
};

const readOnlyValueSx = { fontSize: 13, color: 'kanap.text.tertiary' } as const;

function DrawerTextField({
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  value: string | null;
  placeholder: string;
  disabled: boolean;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = React.useState(value || '');
  React.useEffect(() => {
    setDraft(value || '');
  }, [value]);
  return (
    <TextField
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const cleaned = draft.trim() || null;
        if (cleaned !== (value || null)) onCommit(cleaned);
      }}
      placeholder={placeholder}
      disabled={disabled}
      variant="standard"
      fullWidth
      sx={drawerFieldValueSx}
    />
  );
}

export default function IncidentPropertiesDrawer({
  values,
  isCreate,
  disabled = false,
  restrictDisabled = false,
  onChange,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const locale = useLocale();
  const { byField } = useItOpsEnumOptions();
  const categoryOptions = (byField.incidentCategories || []).filter(
    (option) => !option.deprecated || option.code === values.category,
  );
  const statusOptions: IncidentStatus[] = values.status === 'cancelled'
    ? [...INCIDENT_STATUS_FLOW, 'cancelled']
    : INCIDENT_STATUS_FLOW;

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('workspace.incident.drawer.category')}>
          <TextField
            select
            value={values.category || ''}
            onChange={(event) => onChange({ category: event.target.value || null })}
            variant="standard"
            sx={drawerSelectSx}
            disabled={disabled}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{t('workspace.incident.drawer.noCategory')}</MenuItem>
            {categoryOptions.map((option) => (
              <MenuItem key={option.code} value={option.code} sx={drawerMenuItemSx}>
                {option.deprecated ? `${option.label} (${t('common:enumEditor.retiredSuffix')})` : option.label}
              </MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label={t('workspace.incident.drawer.severity')} required>
          <TextField
            select
            value={values.severity}
            onChange={(event) => onChange({ severity: event.target.value as IncidentSeverity })}
            variant="standard"
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected) => (selected
                ? (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <StatusDot color={getDotColor(INCIDENT_SEVERITY_COLORS[String(selected)], theme.palette.mode)} />
                    {incidentSeverityLabel(t, String(selected))}
                  </Box>
                )
                : <Box component="span" sx={selectPlaceholderSx}>{t('workspace.incident.drawer.selectSeverity')}</Box>),
            }}
            sx={drawerSelectSx}
            disabled={disabled}
          >
            {INCIDENT_SEVERITIES.map((severity) => (
              <MenuItem key={severity} value={severity} sx={{ ...drawerMenuItemSx, gap: '8px' }}>
                <StatusDot color={getDotColor(INCIDENT_SEVERITY_COLORS[severity], theme.palette.mode)} />
                {incidentSeverityLabel(t, severity)}
              </MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        {!isCreate && (
          <PropertyRow label={t('workspace.incident.drawer.status')}>
            <TextField
              select
              value={values.status}
              onChange={(event) => onChange({ status: event.target.value as IncidentStatus })}
              variant="standard"
              SelectProps={{
                renderValue: (selected) => (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <StatusDot color={getDotColor(INCIDENT_STATUS_COLORS[String(selected)], theme.palette.mode)} />
                    {incidentStatusLabel(t, String(selected))}
                  </Box>
                ),
              }}
              sx={drawerSelectSx}
              disabled={disabled}
            >
              {statusOptions.map((status) => {
                const forward = isForwardStatusMove(values.status, status);
                return (
                  <MenuItem key={status} value={status} disabled={!forward} sx={{ ...drawerMenuItemSx, gap: '8px' }}>
                    <StatusDot color={getDotColor(INCIDENT_STATUS_COLORS[status], theme.palette.mode)} />
                    {incidentStatusLabel(t, status)}
                    {!forward && (
                      <Box component="span" sx={{ ml: 'auto', pl: 1.5, fontSize: 11, color: 'kanap.text.tertiary' }}>
                        {t('workspace.incident.actions.useReopen')}
                      </Box>
                    )}
                  </MenuItem>
                );
              })}
            </TextField>
          </PropertyRow>
        )}
        <PropertyRow
          label={t('workspace.incident.drawer.restrictAccess')}
          helperText={t('workspace.incident.drawer.restrictAccessHint')}
        >
          <Switch
            size="small"
            checked={!!values.confidential}
            onChange={(event) => onChange({ confidential: event.target.checked })}
            disabled={restrictDisabled}
          />
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('workspace.incident.drawer.started')}>
          <IncidentDateTimeField
            value={values.started_at}
            onChange={(next) => onChange({ started_at: next })}
            disabled={disabled}
          />
        </PropertyRow>
        <PropertyRow label={t('workspace.incident.drawer.detected')} required>
          <IncidentDateTimeField
            value={values.detected_at}
            onChange={(next) => {
              if (next || isCreate) onChange({ detected_at: next });
            }}
            disabled={disabled}
          />
        </PropertyRow>
        {!isCreate && (
          <>
            <PropertyRow label={t('workspace.incident.drawer.resolved')}>
              <IncidentDateTimeField
                value={values.resolved_at}
                onChange={(next) => onChange({ resolved_at: next })}
                disabled={disabled}
              />
            </PropertyRow>
            <PropertyRow label={t('workspace.incident.drawer.closed')}>
              <Typography sx={readOnlyValueSx}>
                {formatShortDateTime(values.closed_at, locale, { empty: t('workspace.incident.drawer.notSet') })}
              </Typography>
            </PropertyRow>
          </>
        )}
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('workspace.incident.drawer.reporter')}>
          <UserSelect
            value={values.reporter_user_id}
            onChange={(next) => onChange({ reporter_user_id: next })}
            disabled={disabled}
            hideLabel
            label={t('workspace.incident.drawer.reporter')}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('workspace.incident.drawer.owner')}>
          <UserSelect
            value={values.owner_user_id}
            onChange={(next) => onChange({ owner_user_id: next })}
            disabled={disabled}
            hideLabel
            label={t('workspace.incident.drawer.owner')}
            textFieldSx={drawerFieldValueSx}
          />
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow
          label={t('workspace.incident.drawer.sourceRef')}
          helperText={t('workspace.incident.drawer.sourceRefHint')}
        >
          <DrawerTextField
            value={values.source_ref}
            placeholder={t('workspace.incident.drawer.sourceRefPlaceholder')}
            disabled={disabled}
            onCommit={(next) => onChange({ source_ref: next })}
          />
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('workspace.incident.drawer.personalData')}>
          <Switch
            size="small"
            checked={values.personal_data_affected}
            onChange={(event) => onChange({ personal_data_affected: event.target.checked })}
            disabled={disabled}
          />
        </PropertyRow>
        <PropertyRow label={t('workspace.incident.drawer.authorityRequired')}>
          <Switch
            size="small"
            checked={values.authority_notification_required}
            onChange={(event) => onChange({ authority_notification_required: event.target.checked })}
            disabled={disabled}
          />
        </PropertyRow>
        {values.authority_notification_required && (
          <PropertyRow label={t('workspace.incident.drawer.notifiedOn')}>
            <IncidentDateTimeField
              value={values.authority_notified_at}
              onChange={(next) => onChange({ authority_notified_at: next })}
              disabled={disabled}
            />
          </PropertyRow>
        )}
        <PropertyRow label={t('workspace.incident.drawer.notifiedParties')}>
          <DrawerTextField
            value={values.notified_parties}
            placeholder={t('workspace.incident.drawer.notifiedPartiesPlaceholder')}
            disabled={disabled}
            onCommit={(next) => onChange({ notified_parties: next })}
          />
        </PropertyRow>
      </PropertyGroup>

      {!isCreate && (
        <PropertyGroup>
          <PropertyRow label={t('workspace.incident.drawer.created')}>
            <Typography sx={readOnlyValueSx}>{formatShortDateTime(values.created_at, locale)}</Typography>
          </PropertyRow>
          <PropertyRow label={t('workspace.incident.drawer.updated')}>
            <Typography sx={readOnlyValueSx}>{formatShortDateTime(values.updated_at, locale)}</Typography>
          </PropertyRow>
        </PropertyGroup>
      )}
    </>
  );
}
