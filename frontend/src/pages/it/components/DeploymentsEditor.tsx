import React from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
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
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import api from '../../../api';
import { KanapDialog, PropertyRow, useKanapDialogs } from '../../../components/design';
import ServerSelect from '../../../components/fields/ServerSelect';
import DateEUField from '../../../components/fields/DateEUField';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import { getDotColor, LIFECYCLE_COLORS } from '../../../utils/statusColors';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';

const ENV_OPTIONS = [
  { value: 'prod', label: 'PROD' },
  { value: 'pre_prod', label: 'PRE-PROD' },
  { value: 'qa', label: 'QA' },
  { value: 'test', label: 'TEST' },
  { value: 'dev', label: 'DEV' },
  { value: 'sandbox', label: 'SANDBOX' },
] as const;

export type DeploymentRecord = {
  id: string;
  application_id: string;
  environment: string;
  lifecycle: string;
  base_url: string | null;
  sso_enabled: boolean;
  mfa_supported: boolean;
  status: 'enabled' | 'disabled';
  notes: string | null;
};

type Assignment = {
  id: string;
  app_instance_id: string;
  server_id: string;
  role: string;
  since_date: string | null;
  notes: string | null;
  hosting?: { code: string | null; label: string | null };
  server: {
    id: string;
    name: string;
    provider: string;
    environment: string;
  };
};

type DeploymentDraft = {
  id?: string;
  environment: string;
  lifecycle: string;
  base_url: string;
  sso_enabled: boolean;
  mfa_supported: boolean;
  notes: string;
};

type AssignmentDraft = {
  deploymentId: string;
  assignmentId?: string | null;
  server_id: string | null;
  role: string;
  since_date: string;
  notes: string;
};

type DeploymentsEditorProps = {
  applicationId: string;
  deployments: DeploymentRecord[];
  onRefresh: () => Promise<void>;
  readOnly?: boolean;
};

function envLabel(value: string) {
  return ENV_OPTIONS.find((item) => item.value === value)?.label || value.toUpperCase();
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return '—';
  const date = new Date(String(value).includes('T') ? String(value) : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

function createDeploymentDraft(deployment?: DeploymentRecord): DeploymentDraft {
  return {
    id: deployment?.id,
    environment: deployment?.environment || 'prod',
    lifecycle: deployment?.lifecycle || 'active',
    base_url: deployment?.base_url || '',
    sso_enabled: !!deployment?.sso_enabled,
    mfa_supported: !!deployment?.mfa_supported,
    notes: deployment?.notes || '',
  };
}

export default function DeploymentsEditor({
  applicationId,
  deployments,
  onRefresh,
  readOnly = false,
}: DeploymentsEditorProps) {
  const theme = useTheme();
  const { t } = useTranslation(['it', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const { byField, labelFor } = useItOpsEnumOptions();
  const [assignments, setAssignments] = React.useState<Record<string, Assignment[]>>({});
  const [deploymentDialogOpen, setDeploymentDialogOpen] = React.useState(false);
  const [deploymentDraft, setDeploymentDraft] = React.useState<DeploymentDraft>(() => createDeploymentDraft());
  const [assignmentDialogOpen, setAssignmentDialogOpen] = React.useState(false);
  const [assignmentDraft, setAssignmentDraft] = React.useState<AssignmentDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lifecycleAnchor, setLifecycleAnchor] = React.useState<{ id: string; element: HTMLElement } | null>(null);

  const lifecycleOptions = React.useMemo(() => {
    const list = byField.lifecycleStatus || [];
    return list.map((item) => ({
      value: item.code,
      label: item.deprecated ? t('common.deprecatedOption', { label: item.label }) : item.label,
    }));
  }, [byField.lifecycleStatus, t]);

  const serverRoleOptions = React.useMemo(() => {
    const list = byField.serverRole || [];
    return list.map((item) => ({
      value: item.code,
      label: item.deprecated ? t('common.deprecatedOption', { label: item.label }) : item.label,
    }));
  }, [byField.serverRole, t]);

  const usedEnvironments = React.useMemo(() => new Set(deployments.map((deployment) => deployment.environment)), [deployments]);
  const duplicateEnvironment = !deploymentDraft.id && usedEnvironments.has(deploymentDraft.environment);

  const loadAssignments = React.useCallback(async (deploymentId: string) => {
    try {
      const res = await api.get<{ items: Assignment[] }>(`/app-deployments/${deploymentId}/servers`);
      setAssignments((prev) => ({ ...prev, [deploymentId]: res.data.items || [] }));
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.loadAssignmentsFailed')));
    }
  }, [t]);

  React.useEffect(() => {
    deployments.forEach((deployment) => {
      void loadAssignments(deployment.id);
    });
  }, [deployments, loadAssignments]);

  const patchDeployment = React.useCallback(async (deploymentId: string, patch: Partial<DeploymentDraft>) => {
    setError(null);
    try {
      await api.patch(`/app-deployments/${deploymentId}`, patch);
      await onRefresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.updateFailed')));
    }
  }, [onRefresh, t]);

  const openCreateDeployment = React.useCallback(() => {
    const firstAvailable = ENV_OPTIONS.find((env) => !usedEnvironments.has(env.value));
    setDeploymentDraft(createDeploymentDraft({
      id: '',
      application_id: applicationId,
      environment: firstAvailable?.value || ENV_OPTIONS[0].value,
      lifecycle: 'active',
      base_url: null,
      sso_enabled: false,
      mfa_supported: false,
      status: 'enabled',
      notes: null,
    }));
    setDeploymentDialogOpen(true);
  }, [applicationId, usedEnvironments]);

  const openEditDeployment = React.useCallback((deployment: DeploymentRecord) => {
    setDeploymentDraft(createDeploymentDraft(deployment));
    setDeploymentDialogOpen(true);
  }, []);

  const saveDeployment = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        environment: deploymentDraft.environment,
        lifecycle: deploymentDraft.lifecycle,
        base_url: deploymentDraft.base_url || null,
        sso_enabled: deploymentDraft.sso_enabled,
        mfa_supported: deploymentDraft.mfa_supported,
        notes: deploymentDraft.notes.trim() ? deploymentDraft.notes.trim() : null,
      };
      if (deploymentDraft.id) {
        await api.patch(`/app-deployments/${deploymentDraft.id}`, payload);
        setMessage(t('workspace.application.deployments.updated'));
      } else {
        await api.post(`/applications/${applicationId}/deployments`, payload);
        setMessage(t('workspace.application.deployments.created'));
      }
      setDeploymentDialogOpen(false);
      await onRefresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.saveFailed')));
    } finally {
      setSaving(false);
    }
  }, [applicationId, deploymentDraft, onRefresh, t]);

  const deleteDeployment = React.useCallback(async (deployment: DeploymentRecord) => {
    if (!(await dialogs.confirm({
      message: t('workspace.application.deployments.deleteConfirm', { env: envLabel(deployment.environment) }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;
    setError(null);
    try {
      await api.delete(`/app-deployments/${deployment.id}`);
      setMessage(t('workspace.application.deployments.removed'));
      await onRefresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.removeFailed')));
    }
  }, [dialogs, onRefresh, t]);

  const openAssignmentDialog = React.useCallback((deploymentId: string, assignment?: Assignment) => {
    setAssignmentDraft({
      deploymentId,
      assignmentId: assignment?.id || null,
      server_id: assignment?.server_id || null,
      role: assignment?.role || serverRoleOptions[0]?.value || '',
      since_date: assignment?.since_date ? String(assignment.since_date).slice(0, 10) : '',
      notes: assignment?.notes || '',
    });
    setAssignmentDialogOpen(true);
  }, [serverRoleOptions]);

  const saveAssignment = React.useCallback(async () => {
    if (!assignmentDraft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        server_id: assignmentDraft.server_id,
        role: assignmentDraft.role,
        since_date: assignmentDraft.since_date || null,
        notes: assignmentDraft.notes.trim() ? assignmentDraft.notes.trim() : null,
      };
      if (assignmentDraft.assignmentId) {
        await api.patch(`/app-deployments/${assignmentDraft.deploymentId}/servers/${assignmentDraft.assignmentId}`, payload);
        setMessage(t('workspace.application.deployments.assignmentUpdated'));
      } else {
        await api.post(`/app-deployments/${assignmentDraft.deploymentId}/servers`, payload);
        setMessage(t('components.serverAssignments.serverAssigned'));
      }
      setAssignmentDialogOpen(false);
      await loadAssignments(assignmentDraft.deploymentId);
      await onRefresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.saveAssignmentFailed')));
    } finally {
      setSaving(false);
    }
  }, [assignmentDraft, loadAssignments, onRefresh, t]);

  const deleteAssignment = React.useCallback(async (deploymentId: string, assignmentId: string) => {
    if (!(await dialogs.confirm({
      message: t('workspace.application.deployments.removeAssignmentConfirm'),
      confirmLabel: t('common:buttons.remove'),
      intent: 'danger',
    }))) return;
    setError(null);
    try {
      await api.delete(`/app-deployments/${deploymentId}/servers/${assignmentId}`);
      setMessage(t('workspace.application.deployments.assignmentRemoved'));
      await loadAssignments(deploymentId);
      await onRefresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.removeAssignmentFailed')));
    }
  }, [dialogs, loadAssignments, onRefresh, t]);

  return (
    <Stack spacing={2.75}>
      {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {!readOnly && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Button variant="action" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={openCreateDeployment}>
            {t('workspace.application.deployments.addDeployment')}
          </Button>
        </Box>
      )}

      {deployments.map((deployment) => {
        const rows = assignments[deployment.id] || [];
        const lifecycleColor = getDotColor(LIFECYCLE_COLORS[deployment.lifecycle] || 'default', theme.palette.mode);
        return (
          <Box key={deployment.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '18px', mb: 1.25, minWidth: 0 }}>
              <Box sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 14, fontWeight: 500, minWidth: 76 }}>
                {envLabel(deployment.environment)}
              </Box>
              <Box
                component="button"
                type="button"
                onClick={(event) => !readOnly && setLifecycleAnchor({ id: deployment.id, element: event.currentTarget })}
                sx={(muiTheme) => ({
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  border: 0,
                  p: 0,
                  bgcolor: 'transparent',
                  font: 'inherit',
                  fontSize: 12,
                  color: muiTheme.palette.kanap.text.primary,
                  cursor: readOnly ? 'default' : 'pointer',
                })}
              >
                <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: lifecycleColor }} />
                {labelFor('lifecycleStatus', deployment.lifecycle) || deployment.lifecycle}
              </Box>
              <Box sx={{ display: 'inline-flex', gap: '6px', fontSize: 12, minWidth: 0 }}>
                <Box component="span" sx={(muiTheme) => ({ color: muiTheme.palette.kanap.text.tertiary })}>{t('components.instances.baseUrl')}</Box>
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {deployment.base_url || '—'}
                </Box>
              </Box>
              <Box sx={{ fontSize: 12 }}>
                <Box component="span" sx={(muiTheme) => ({ color: muiTheme.palette.kanap.text.tertiary, mr: '6px' })}>SSO</Box>
                {deployment.sso_enabled ? t('enums.yesNo.yes') : t('enums.yesNo.no')}
              </Box>
              <Box sx={{ fontSize: 12 }}>
                <Box component="span" sx={(muiTheme) => ({ color: muiTheme.palette.kanap.text.tertiary, mr: '6px' })}>MFA</Box>
                {deployment.mfa_supported ? t('enums.yesNo.yes') : t('enums.yesNo.no')}
              </Box>
              <Box sx={{ flex: 1 }} />
              {!readOnly && (
                <>
                  <Button variant="action" size="small" onClick={() => openAssignmentDialog(deployment.id)} disabled={serverRoleOptions.length === 0}>
                    {t('workspace.application.deployments.addServer')}
                  </Button>
                  <IconButton aria-label={t('workspace.application.deployments.editAria', { env: envLabel(deployment.environment) })} size="small" onClick={() => openEditDeployment(deployment)}>
                    <EditOutlinedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton aria-label={t('workspace.application.deployments.deleteAria', { env: envLabel(deployment.environment) })} size="small" onClick={() => void deleteDeployment(deployment)}>
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </>
              )}
            </Box>

            <Table size="small" sx={(muiTheme) => ({
              '& th': { fontSize: 11, fontWeight: 500, color: muiTheme.palette.kanap.text.tertiary, borderBottom: `1px solid ${muiTheme.palette.kanap.border.default}` },
              '& td': { fontSize: 13, color: muiTheme.palette.kanap.text.primary, borderBottom: `1px solid ${muiTheme.palette.kanap.border.soft}` },
              '& tbody tr:hover': { bgcolor: muiTheme.palette.kanap.bg.hover },
              '& .hover-actions': { opacity: 0, transition: 'opacity 120ms' },
              '& tbody tr:hover .hover-actions': { opacity: 1 },
            })}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 170 }}>{t('common:selects.server')}</TableCell>
                  <TableCell sx={{ width: 200 }}>{t('common.role')}</TableCell>
                  <TableCell sx={{ width: 120 }}>{t('components.serverAssignments.hosting')}</TableCell>
                  <TableCell>{t('workspace.application.deployments.since')}</TableCell>
                  {!readOnly && <TableCell align="right" sx={{ width: 72 }} />}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={readOnly ? 4 : 5} sx={(muiTheme) => ({ color: `${muiTheme.palette.kanap.text.tertiary} !important` })}>
                      {t('components.serverAssignments.noServersAssigned')}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell sx={(muiTheme) => ({ fontFamily: MONO_FONT_FAMILY, fontSize: '12px !important', color: `${muiTheme.palette.kanap.text.secondary} !important` })}>
                      {row.server?.name || '—'}
                    </TableCell>
                    <TableCell>{labelFor('serverRole', row.role) || row.role || '—'}</TableCell>
                    <TableCell>{row.hosting?.label || (row.hosting?.code ? labelFor('hostingType', row.hosting.code) : '—')}</TableCell>
                    <TableCell>{formatDate(row.since_date, locale)}</TableCell>
                    {!readOnly && (
                      <TableCell align="right">
                        <Box className="hover-actions" sx={{ display: 'inline-flex', gap: '2px' }}>
                          <IconButton aria-label={row.server?.name ? t('workspace.application.deployments.editAssignmentAria', { name: row.server.name }) : t('workspace.application.deployments.editServerAssignment')} size="small" onClick={() => openAssignmentDialog(deployment.id, row)}>
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                          <IconButton aria-label={row.server?.name ? t('workspace.application.deployments.removeAssignmentAria', { name: row.server.name }) : t('workspace.application.deployments.removeServerAssignment')} size="small" onClick={() => void deleteAssignment(deployment.id, row.id)}>
                            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        );
      })}

      {deployments.length === 0 && (
        <Typography sx={(muiTheme) => ({ fontSize: 13, color: muiTheme.palette.kanap.text.tertiary })}>
          {t('workspace.application.deployments.noDeployments')}
        </Typography>
      )}

      <Menu anchorEl={lifecycleAnchor?.element || null} open={!!lifecycleAnchor} onClose={() => setLifecycleAnchor(null)}>
        {lifecycleOptions.map((option) => (
          <MenuItem
            key={option.value}
            sx={drawerMenuItemSx}
            onClick={() => {
              if (lifecycleAnchor) void patchDeployment(lifecycleAnchor.id, { lifecycle: option.value });
              setLifecycleAnchor(null);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>

      <KanapDialog
        open={deploymentDialogOpen}
        title={deploymentDraft.id ? t('workspace.application.deployments.editDeployment') : t('workspace.application.deployments.newDeployment')}
        onClose={() => setDeploymentDialogOpen(false)}
        onSave={saveDeployment}
        saveLabel={t('common:buttons.save')}
        saveDisabled={duplicateEnvironment || !deploymentDraft.environment || !deploymentDraft.lifecycle}
        saveLoading={saving}
      >
        <Stack spacing={1.25}>
          {error && <Alert severity="error">{error}</Alert>}
          <PropertyRow label={t('common.environment')} required>
            <Select
              value={deploymentDraft.environment}
              onChange={(event) => setDeploymentDraft((prev) => ({ ...prev, environment: event.target.value }))}
              variant="standard"
              disabled={!!deploymentDraft.id}
              sx={drawerSelectSx}
            >
              {ENV_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value} disabled={!deploymentDraft.id && usedEnvironments.has(option.value)} sx={drawerMenuItemSx}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
          <PropertyRow label={t('common.lifecycle')} required>
            <Select
              value={deploymentDraft.lifecycle}
              onChange={(event) => setDeploymentDraft((prev) => ({ ...prev, lifecycle: event.target.value }))}
              variant="standard"
              sx={drawerSelectSx}
            >
              {lifecycleOptions.map((option) => (
                <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>{option.label}</MenuItem>
              ))}
            </Select>
          </PropertyRow>
          <PropertyRow label={t('components.instances.baseUrl')}>
            <TextField
              value={deploymentDraft.base_url}
              onChange={(event) => setDeploymentDraft((prev) => ({ ...prev, base_url: event.target.value }))}
              variant="standard"
              fullWidth
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
          <PropertyRow
            label={t('components.instances.ssoEnabled')}
            sx={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
            valueSx={{ flex: 0, minHeight: 'auto', display: 'flex', alignItems: 'center' }}
          >
            <input type="checkbox" checked={deploymentDraft.sso_enabled} onChange={(event) => setDeploymentDraft((prev) => ({ ...prev, sso_enabled: event.target.checked }))} style={{ accentColor: 'var(--kanap-teal)' }} />
          </PropertyRow>
          <PropertyRow
            label={t('components.instances.mfaSupported')}
            sx={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
            valueSx={{ flex: 0, minHeight: 'auto', display: 'flex', alignItems: 'center' }}
          >
            <input type="checkbox" checked={deploymentDraft.mfa_supported} onChange={(event) => setDeploymentDraft((prev) => ({ ...prev, mfa_supported: event.target.checked }))} style={{ accentColor: 'var(--kanap-teal)' }} />
          </PropertyRow>
          <PropertyRow label={t('common.notes')}>
            <TextField
              value={deploymentDraft.notes}
              onChange={(event) => setDeploymentDraft((prev) => ({ ...prev, notes: event.target.value }))}
              variant="standard"
              fullWidth
              multiline
              minRows={3}
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
        </Stack>
      </KanapDialog>

      <KanapDialog
        open={assignmentDialogOpen}
        title={assignmentDraft?.assignmentId ? t('workspace.application.deployments.editServerAssignment') : t('workspace.application.deployments.newServerAssignment')}
        onClose={() => setAssignmentDialogOpen(false)}
        onSave={saveAssignment}
        saveLabel={t('common:buttons.save')}
        saveDisabled={!assignmentDraft?.server_id || !assignmentDraft?.role}
        saveLoading={saving}
      >
        {assignmentDraft && (
          <Stack spacing={1.25}>
            <PropertyRow label={t('common:selects.server')} required>
              <ServerSelect
                value={assignmentDraft.server_id}
                onChange={(value) => setAssignmentDraft((prev) => (prev ? { ...prev, server_id: value } : prev))}
                allowClusters={false}
                hideLabel
                textFieldSx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('common.role')} required>
              <Select
                value={assignmentDraft.role}
                onChange={(event) => setAssignmentDraft((prev) => (prev ? { ...prev, role: event.target.value } : prev))}
                variant="standard"
                sx={drawerSelectSx}
              >
                {serverRoleOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>{option.label}</MenuItem>
                ))}
              </Select>
            </PropertyRow>
            <PropertyRow label={t('workspace.application.deployments.since')}>
              <DateEUField
                label=""
                valueYmd={assignmentDraft.since_date}
                onChangeYmd={(value) => setAssignmentDraft((prev) => (prev ? { ...prev, since_date: value } : prev))}
                size="small"
                hideLabel
                textFieldSx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('common.notes')}>
              <TextField
                value={assignmentDraft.notes}
                onChange={(event) => setAssignmentDraft((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                variant="standard"
                fullWidth
                multiline
                minRows={3}
                sx={drawerFieldValueSx}
              />
            </PropertyRow>
          </Stack>
        )}
      </KanapDialog>
    </Stack>
  );
}
