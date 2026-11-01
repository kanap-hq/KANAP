import React from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link as MLink,
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
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import api from '../../../api';
import { KanapDialog, PropertyRow, useKanapDialogs } from '../../../components/design';
import ServerSelect from '../../../components/fields/ServerSelect';
import ClusterMark from '../../../components/workspace/ClusterMark';
import DateEUField from '../../../components/fields/DateEUField';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import { getDotColor, LIFECYCLE_COLORS } from '../../../utils/statusColors';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { APPLICATION_ENVIRONMENTS, compareEnvironments, environmentLabelKey } from '../../../utils/applicationEnvironments';
import { invalidateTechnologyLinks } from './technologyLinkQueries';
import ClusterGroupLine from './ClusterGroupLine';
import useClusterAssignmentQuestion from './useClusterAssignmentQuestion';

const ENV_OPTIONS = APPLICATION_ENVIRONMENTS;

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

/** A member in service that inherits the row of its cluster. */
type InheritingMember = {
  asset_id: string;
  name: string;
  asset_reference?: string | null;
};

/** A deployment and role assigned directly to every member of a cluster (A7). */
type GroupableSet = {
  cluster_id: string;
  cluster_name: string;
  app_instance_id: string;
  role: string;
  member_ids: string[];
};

type Assignment = {
  id: string;
  app_instance_id: string;
  server_id: string;
  /** On a cluster's row: the members that inherit it. */
  members?: InheritingMember[];
  role: string;
  since_date: string | null;
  notes: string | null;
  hosting?: { code: string | null; label: string | null };
  server: {
    id: string;
    name: string;
    /** The business reference (`AST-7`) the server's page is addressed by. */
    asset_reference?: string | null;
    provider: string;
    environment: string;
    is_cluster?: boolean;
  };
  asset?: { is_cluster?: boolean };
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
  /** The application's name, for the questions about its servers. */
  applicationName?: string;
};

function assetHref(reference: string | null | undefined, id: string) {
  return reference ? `/it/assets/${reference}/overview` : `/it/assets/${id}`;
}

function formatDate(value: string | null | undefined, locale: string) {
  return formatShortDate(value ? String(value).slice(0, 10) : null, locale, { year: 'always', empty: '—' });
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
  applicationName,
}: DeploymentsEditorProps) {
  const theme = useTheme();
  const { t } = useTranslation(['it', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const { byField, labelFor } = useItOpsEnumOptions();
  const envLabel = React.useCallback((value: string) => {
    const key = environmentLabelKey(value);
    return key ? t(key) : value;
  }, [t]);
  const [assignments, setAssignments] = React.useState<Record<string, Assignment[]>>({});
  const [groupable, setGroupable] = React.useState<GroupableSet[]>([]);
  const { resolveTargets, questionDialog } = useClusterAssignmentQuestion();
  const [deploymentDialogOpen, setDeploymentDialogOpen] = React.useState(false);
  const [deploymentDraft, setDeploymentDraft] = React.useState<DeploymentDraft>(() => createDeploymentDraft());
  const [assignmentDialogOpen, setAssignmentDialogOpen] = React.useState(false);
  const [assignmentDraft, setAssignmentDraft] = React.useState<AssignmentDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // The refusal of the dialog that is open, shown in it (the page's alert sits behind the dialog's veil).
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const sortedDeployments = React.useMemo(
    () => [...deployments].sort((a, b) => compareEnvironments(a.environment, b.environment)),
    [deployments],
  );
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

  // The servers of every deployment, in one call. Reloaded when a deployment is added or removed,
  // or after a server change; a change of lifecycle or URL leaves them as they are.
  const deploymentIds = deployments.map((deployment) => deployment.id).join(',');
  const loadAssignments = React.useCallback(async () => {
    try {
      const res = await api.get<{ items: Assignment[]; groupable?: GroupableSet[] }>(`/applications/${applicationId}/deployment-servers`);
      const byDeployment: Record<string, Assignment[]> = {};
      for (const row of res.data.items || []) {
        (byDeployment[row.app_instance_id] ||= []).push(row);
      }
      setAssignments(byDeployment);
      setGroupable(res.data.groupable || []);
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.loadAssignmentsFailed')));
    }
  }, [applicationId, t]);

  React.useEffect(() => {
    if (!deploymentIds) {
      setAssignments({});
      setGroupable([]);
      return;
    }
    void loadAssignments();
  }, [deploymentIds, loadAssignments]);

  const patchDeployment = React.useCallback(async (deploymentId: string, patch: Partial<DeploymentDraft>) => {
    setError(null);
    try {
      await api.patch(`/app-deployments/${deploymentId}`, patch);
      await onRefresh();
      void invalidateTechnologyLinks(queryClient);
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.updateFailed')));
    }
  }, [onRefresh, queryClient, t]);

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
    setDialogError(null);
    setDeploymentDialogOpen(true);
  }, [applicationId, usedEnvironments]);

  const openEditDeployment = React.useCallback((deployment: DeploymentRecord) => {
    setDeploymentDraft(createDeploymentDraft(deployment));
    setDialogError(null);
    setDeploymentDialogOpen(true);
  }, []);

  const saveDeployment = React.useCallback(async () => {
    setSaving(true);
    setDialogError(null);
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
      } else {
        await api.post(`/applications/${applicationId}/deployments`, payload);
      }
      setDeploymentDialogOpen(false);
      await onRefresh();
      void invalidateTechnologyLinks(queryClient);
    } catch (err: any) {
      setDialogError(getApiErrorMessage(err, t, t('workspace.application.deployments.saveFailed')));
    } finally {
      setSaving(false);
    }
  }, [applicationId, deploymentDraft, onRefresh, queryClient, t]);

  const deleteDeployment = React.useCallback(async (deployment: DeploymentRecord) => {
    if (!(await dialogs.confirm({
      message: t('workspace.application.deployments.deleteConfirm', { env: envLabel(deployment.environment) }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;
    setError(null);
    try {
      await api.delete(`/app-deployments/${deployment.id}`);
      await onRefresh();
      void invalidateTechnologyLinks(queryClient);
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.removeFailed')));
    }
  }, [dialogs, envLabel, onRefresh, queryClient, t]);

  const openAssignmentDialog = React.useCallback((deploymentId: string, assignment?: Assignment) => {
    setAssignmentDraft({
      deploymentId,
      assignmentId: assignment?.id || null,
      server_id: assignment?.server_id || null,
      role: assignment?.role || serverRoleOptions[0]?.value || '',
      since_date: assignment?.since_date ? String(assignment.since_date).slice(0, 10) : '',
      notes: assignment?.notes || '',
    });
    setDialogError(null);
    setAssignmentDialogOpen(true);
  }, [serverRoleOptions]);

  const saveAssignment = React.useCallback(async () => {
    if (!assignmentDraft) return;
    setSaving(true);
    setDialogError(null);
    try {
      const stored = assignments[assignmentDraft.deploymentId] || [];
      const original = assignmentDraft.assignmentId ? stored.find((row) => row.id === assignmentDraft.assignmentId) : undefined;
      let serverId = assignmentDraft.server_id;
      // A member of a cluster: assign to the cluster, or to this server only (A2, A3). A cluster:
      // say the members' rows it replaces (A4).
      if (serverId && (!original || original.server_id !== serverId || original.role !== assignmentDraft.role)) {
        const deployment = deployments.find((candidate) => candidate.id === assignmentDraft.deploymentId);
        const outcome = await resolveTargets({
          assetIds: [serverId],
          subject: `${applicationName || t('components.clusterAssignment.thisApplication')} (${envLabel(deployment?.environment || '')}, ${labelFor('serverRole', assignmentDraft.role) || assignmentDraft.role})`,
          applicationName: applicationName || t('components.clusterAssignment.thisApplication'),
          role: assignmentDraft.role,
          rows: stored.filter((row) => row.id !== assignmentDraft.assignmentId).map((row) => ({ asset_id: row.server_id, role: row.role })),
          movingFrom: original?.server_id,
        });
        if (outcome.status === 'cancelled') return;
        if (outcome.status === 'inherited') {
          setDialogError(t('errors:assignment_inherited', { cluster: outcome.cluster }));
          return;
        }
        serverId = outcome.targets[0];
      }
      const payload = {
        server_id: serverId,
        role: assignmentDraft.role,
        since_date: assignmentDraft.since_date || null,
        notes: assignmentDraft.notes.trim() ? assignmentDraft.notes.trim() : null,
      };
      if (assignmentDraft.assignmentId) {
        await api.patch(`/app-deployments/${assignmentDraft.deploymentId}/servers/${assignmentDraft.assignmentId}`, payload);
      } else {
        await api.post(`/app-deployments/${assignmentDraft.deploymentId}/servers`, payload);
      }
      setAssignmentDialogOpen(false);
      await loadAssignments();
      await onRefresh();
      void invalidateTechnologyLinks(queryClient);
    } catch (err: any) {
      setDialogError(getApiErrorMessage(err, t, t('workspace.application.deployments.saveAssignmentFailed')));
    } finally {
      setSaving(false);
    }
  }, [applicationName, assignmentDraft, assignments, deployments, envLabel, labelFor, loadAssignments, onRefresh, queryClient, resolveTargets, t]);

  /** A7: the cluster takes the assignment the members carry one by one (the server replaces their rows). */
  const assignGroupToCluster = React.useCallback(async (set: GroupableSet) => {
    if (!(await dialogs.confirm({
      message: t('components.clusterAssignment.groupConfirm', { application: applicationName || t('components.clusterAssignment.thisApplication') }),
      title: t('components.clusterAssignment.title'),
      confirmLabel: t('components.clusterAssignment.assignToCluster'),
    }))) return;
    setError(null);
    try {
      await api.post(`/app-deployments/${set.app_instance_id}/servers`, { server_id: set.cluster_id, role: set.role });
      await loadAssignments();
      await onRefresh();
      void invalidateTechnologyLinks(queryClient);
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.saveAssignmentFailed')));
    }
  }, [applicationName, dialogs, loadAssignments, onRefresh, queryClient, t]);

  const deleteAssignment = React.useCallback(async (deploymentId: string, assignmentId: string) => {
    if (!(await dialogs.confirm({
      message: t('workspace.application.deployments.removeAssignmentConfirm'),
      confirmLabel: t('common:buttons.remove'),
      intent: 'danger',
    }))) return;
    setError(null);
    try {
      await api.delete(`/app-deployments/${deploymentId}/servers/${assignmentId}`);
      await loadAssignments();
      await onRefresh();
      void invalidateTechnologyLinks(queryClient);
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('workspace.application.deployments.removeAssignmentFailed')));
    }
  }, [dialogs, loadAssignments, onRefresh, queryClient, t]);

  return (
    <Stack spacing={2.75}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {!readOnly && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Button variant="action" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={openCreateDeployment}>
            {t('workspace.application.deployments.addDeployment')}
          </Button>
        </Box>
      )}

      {sortedDeployments.map((deployment) => {
        // The clusters' rows come first, each followed by the members that inherit it.
        const rows = [...(assignments[deployment.id] || [])].sort((a, b) => Number(!!b.asset?.is_cluster) - Number(!!a.asset?.is_cluster));
        const sets = readOnly ? [] : groupable.filter((set) => set.app_instance_id === deployment.id);
        const lifecycleColor = getDotColor(LIFECYCLE_COLORS[deployment.lifecycle] || 'default', theme.palette.mode);
        return (
          <Box key={deployment.id}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '18px', rowGap: '8px', mb: 1.25, minWidth: 0 }}>
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
              {/* The base URL keeps room for its domain: the next items wrap before it is cut short; it never grows past its text. */}
              <Box sx={{ display: 'inline-flex', gap: '6px', fontSize: 12, flex: '1 1 240px', minWidth: 0, maxWidth: 'fit-content' }}>
                <Box component="span" sx={(muiTheme) => ({ color: muiTheme.palette.kanap.text.tertiary, flexShrink: 0, whiteSpace: 'nowrap' })}>{t('components.instances.baseUrl')}</Box>
                <Tooltip title={deployment.base_url || ''} disableHoverListener={!deployment.base_url}>
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {deployment.base_url || '—'}
                  </Box>
                </Tooltip>
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
            {deployment.notes && (
              <Typography sx={(muiTheme) => ({ fontSize: 12, color: muiTheme.palette.kanap.text.secondary, whiteSpace: 'pre-wrap', mb: 1.25 })}>
                {deployment.notes}
              </Typography>
            )}

            <Table size="small" sx={(muiTheme) => ({
              '& th': { fontSize: 11, fontWeight: 500, color: muiTheme.palette.kanap.text.tertiary, borderBottom: `1px solid ${muiTheme.palette.kanap.border.default}` },
              '& td': { fontSize: 13, color: muiTheme.palette.kanap.text.primary, borderBottom: `1px solid ${muiTheme.palette.kanap.border.soft}` },
              '& tbody tr:hover': { bgcolor: muiTheme.palette.kanap.bg.hover },
              '& .hover-actions': { opacity: 0, transition: 'opacity 120ms' },
              '& tbody tr:hover .hover-actions, & tbody tr:focus-within .hover-actions': { opacity: 1 },
              '& .hover-actions .MuiIconButton-root:focus-visible': { outline: `2px solid ${muiTheme.palette.primary.main}`, outlineOffset: 1 },
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
                  <React.Fragment key={row.id}>
                  <TableRow>
                    <TableCell sx={(muiTheme) => ({ fontFamily: MONO_FONT_FAMILY, fontSize: '12px !important', color: `${muiTheme.palette.kanap.text.secondary} !important` })}>
                      {row.server?.name ? (
                        <>
                          <MLink
                            component={RouterLink}
                            to={assetHref(row.server.asset_reference, row.server.id || row.server_id)}
                            underline="hover"
                            color="inherit"
                            onClick={(event: React.MouseEvent) => event.stopPropagation()}
                            sx={{ '&:hover': { color: 'primary.main' } }}
                          >
                            {row.server.name}
                          </MLink>
                          {row.asset?.is_cluster && <Box component="span" sx={{ ml: '6px' }}><ClusterMark /></Box>}
                        </>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{labelFor('serverRole', row.role) || row.role || '—'}</TableCell>
                    <TableCell>{(row.hosting?.code ? labelFor('hostingType', row.hosting.code) : '') || row.hosting?.label || '—'}</TableCell>
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
                  {(row.members || []).map((member) => (
                    <TableRow key={`${row.id}-${member.asset_id}`} data-inherited="true">
                      <TableCell sx={(muiTheme) => ({ fontFamily: MONO_FONT_FAMILY, fontSize: '12px !important', color: `${muiTheme.palette.kanap.text.tertiary} !important`, pl: '24px !important' })}>
                        <Tooltip title={t('components.clusterAssignment.inheritedFrom', { cluster: row.server?.name || '' })}>
                          <SubdirectoryArrowRightIcon aria-hidden sx={{ fontSize: 13, mr: '4px', verticalAlign: 'text-bottom' }} />
                        </Tooltip>
                        <MLink
                          component={RouterLink}
                          to={assetHref(member.asset_reference, member.asset_id)}
                          underline="hover"
                          color="inherit"
                          sx={{ '&:hover': { color: 'primary.main' } }}
                        >
                          {member.name}
                        </MLink>
                      </TableCell>
                      <TableCell sx={(muiTheme) => ({ color: `${muiTheme.palette.kanap.text.tertiary} !important` })}>{labelFor('serverRole', row.role) || row.role || '—'}</TableCell>
                      <TableCell />
                      <TableCell />
                      {!readOnly && <TableCell />}
                    </TableRow>
                  ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
            {sets.map((set) => {
              const names = set.member_ids.map((memberId) => rows.find((row) => row.server_id === memberId)?.server?.name).filter(Boolean).join(', ');
              const subject = labelFor('serverRole', set.role) || set.role;
              return (
                <ClusterGroupLine
                  key={`${set.cluster_id}|${set.role}`}
                  text={t('components.clusterAssignment.groupLine', { subject, members: names })}
                  actionLabel={t('components.clusterAssignment.groupAssignTo', { cluster: set.cluster_name })}
                  onAssign={() => void assignGroupToCluster(set)}
                />
              );
            })}
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
        onClose={() => { setDeploymentDialogOpen(false); setDialogError(null); }}
        onSave={saveDeployment}
        saveLabel={t('common:buttons.save')}
        saveDisabled={duplicateEnvironment || !deploymentDraft.environment || !deploymentDraft.lifecycle}
        saveLoading={saving}
      >
        <Stack spacing={1.25}>
          {dialogError && <Alert severity="error">{dialogError}</Alert>}
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
                  {t(option.labelKey)}
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
            <Typography sx={(muiTheme) => ({ mt: 0.5, fontSize: 12, color: muiTheme.palette.kanap.text.tertiary })}>
              {t('workspace.application.deployments.baseUrlHelp')}
            </Typography>
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

      {questionDialog}

      <KanapDialog
        open={assignmentDialogOpen}
        title={assignmentDraft?.assignmentId ? t('workspace.application.deployments.editServerAssignment') : t('workspace.application.deployments.newServerAssignment')}
        onClose={() => { setAssignmentDialogOpen(false); setDialogError(null); }}
        onSave={saveAssignment}
        saveLabel={t('common:buttons.save')}
        saveDisabled={!assignmentDraft?.server_id || !assignmentDraft?.role}
        saveLoading={saving}
      >
        {assignmentDraft && (
          <Stack spacing={1.25}>
            {dialogError && <Alert severity="error">{dialogError}</Alert>}
            <PropertyRow label={t('common:selects.server')} required>
              <ServerSelect
                value={assignmentDraft.server_id}
                onChange={(value) => setAssignmentDraft((prev) => (prev ? { ...prev, server_id: value } : prev))}
                hideLabel
                label={t('common:selects.server')}
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
