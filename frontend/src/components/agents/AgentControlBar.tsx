import React from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Select, Stack, Tooltip, Typography } from '@mui/material';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import KanapDialog from '../design/KanapDialog';
import { compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../../theme/formSx';
import { LifecycleText, ReasonDialog } from './agentControlPrimitives';
import { RUN_MODES, useAgentRunState, type RunModeKey } from './agentRunState';

/**
 * Transverse control bar for an agent workspace: it sits between the page header
 * and the tab strip and stays visible on every tab, so the agent's controls are
 * never a tab away.
 *
 * Actions only, one row. Its first control merges the two representations of the
 * same thing that used to sit side by side — the lifecycle text and the run-mode
 * select: closed it reads the live lifecycle ("● Watching — asks first"), open it
 * offers the three run modes. All the read-only facts moved to the Monitor tab's
 * "Status" section.
 *
 * The emergency pause stays a separate red brake: it overrides the run mode and,
 * while active, replaces the controls with "Lift pause".
 */
export default function AgentControlBar({ agentKey, onTest }: { agentKey: string; onTest: () => void }) {
  const { t } = useTranslation(['agents']);
  const navigate = useNavigate();
  const { hasLevel } = useAuth();
  const state = useAgentRunState(agentKey);
  const data = state.data;
  const canAdmin = hasLevel('ai_agents', 'admin') || hasLevel('ai_settings', 'admin');
  const {
    definition,
    isSre,
    runMode,
    isArchived,
    lifecycleKey,
    agentPause,
    tenantPause,
    activePause,
  } = state;

  const setRunMode = (mode: RunModeKey) => {
    if (!definition || mode === runMode) return;
    data.updateAgentStatusMutation.mutate({
      id: definition.id,
      status: mode === 'off' ? 'disabled' : 'enabled',
      watching: mode === 'watching',
    });
  };

  const pollMutation = isSre ? data.pollMonitoringMutation : data.pollMutation;
  const [pauseDialogOpen, setPauseDialogOpen] = React.useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
  const submitPause = (reason: string) => {
    if (!definition) return;
    data.createPauseMutation.mutate(
      { scope: 'agent', agent_definition_id: definition.id, reason, expires_in_minutes: null },
      { onSuccess: () => setPauseDialogOpen(false) },
    );
  };

  const checkLabel = isSre ? t('monitor.checkForAlerts') : t('monitor.checkNow');
  const testLabel = isSre ? t('monitor.testAlert') : t('monitor.testTicket');
  const checkBlockedReason = runMode === 'off'
    ? t('monitor.checkNowOffHint')
    : activePause
      ? t('monitor.checkNowPausedHint')
      : null;
  // The merged control is only a control for an admin on a live agent. In every
  // other case the same lifecycle is shown as plain text, so the state stays
  // readable without pretending it can be changed here.
  const runModeSelectable = canAdmin && !activePause && !isArchived;

  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {data.error && <Alert severity="error" onClose={() => data.setError(null)}>{data.error}</Alert>}
      {data.message && <Alert severity="success" onClose={() => data.setMessage(null)}>{data.message}</Alert>}
      {activePause && <Alert severity="warning">{t('pause.active', { reason: activePause.reason })}</Alert>}

      <Box
        sx={(theme) => ({
          border: `1px solid ${theme.palette.kanap.border.soft}`,
          borderRadius: 1,
          bgcolor: theme.palette.kanap.bg.drawer,
          px: 1.5,
          py: 1,
        })}
      >
        {/* Right-aligned per the charter: the bar carries actions only, and
            actions sit at the trailing edge of their row. */}
        <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="flex-end" flexWrap="wrap" useFlexGap>
          {runModeSelectable ? (
            <Select
              variant="standard"
              displayEmpty
              value={runMode ?? ''}
              disabled={data.updateAgentStatusMutation.isPending}
              sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 168, mr: 0.5 }]}
              MenuProps={compactSelectMenuProps}
              onChange={(event) => setRunMode(event.target.value as RunModeKey)}
              inputProps={{ 'aria-label': t('monitor.runMode') }}
              // Closed state = the live lifecycle, not the raw run mode: a
              // watching agent that is failing must not read "Watching".
              renderValue={() => (lifecycleKey ? <LifecycleText lifecycleKey={lifecycleKey} /> : <span>{t('lifecycle.notStarted')}</span>)}
            >
              {/* A draft agent has no run mode yet; the empty option keeps the
                  Select's value in range while staying unselectable. */}
              {runMode == null && (
                <MenuItem value="" sx={drawerMenuItemSx} disabled>{t('lifecycle.notStarted')}</MenuItem>
              )}
              {RUN_MODES.map((mode) => (
                <MenuItem key={mode} value={mode} sx={[drawerMenuItemSx, { display: 'block' }]}>
                  <Typography sx={{ fontSize: 13, fontWeight: 400, lineHeight: 1.35 }}>
                    {t(`monitor.modes.${mode}`)}
                  </Typography>
                  <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary, lineHeight: 1.35, whiteSpace: 'normal' })}>
                    {t(`monitor.modeDescriptions.${mode}`)}
                  </Typography>
                </MenuItem>
              ))}
            </Select>
          ) : (
            lifecycleKey && <Box sx={{ mr: 0.5 }}><LifecycleText lifecycleKey={lifecycleKey} /></Box>
          )}

          {agentPause ? (
            <Button
              size="small"
              variant="action"
              startIcon={<PlayArrowIcon />}
              disabled={!canAdmin || data.revokePauseMutation.isPending}
              onClick={() => data.revokePauseMutation.mutate(agentPause.id)}
            >
              {t('pause.lift')}
            </Button>
          ) : tenantPause ? (
            <Button size="small" variant="action" onClick={() => navigate('/agents')}>{t('pause.managedForAll')}</Button>
          ) : null}

          {!isArchived && (
            <Tooltip title={checkBlockedReason ?? checkLabel}>
              <span>
                <Button
                  size="small"
                  variant="action"
                  startIcon={pollMutation.isPending ? <CircularProgress size={13} /> : <RefreshIcon />}
                  disabled={pollMutation.isPending || !!checkBlockedReason || !definition}
                  onClick={() => pollMutation.mutate()}
                >
                  {checkLabel}
                </Button>
              </span>
            </Tooltip>
          )}

          <Button size="small" variant="action" startIcon={<ScienceOutlinedIcon />} onClick={onTest}>
            {testLabel}
          </Button>

          {canAdmin && !agentPause && !tenantPause && !isArchived && (
            <Button
              size="small"
              variant="action-danger"
              startIcon={<PauseCircleOutlineIcon />}
              onClick={() => setPauseDialogOpen(true)}
            >
              {t('pause.agent')}
            </Button>
          )}

          {canAdmin && isArchived && definition && (
            <Button
              size="small"
              variant="action"
              disabled={data.updateAgentStatusMutation.isPending}
              onClick={() => data.updateAgentStatusMutation.mutate({ id: definition.id, status: 'disabled' })}
            >
              {t('settings.restoreAgent')}
            </Button>
          )}

          {/* Non-admins have no Restore button, so the bare lifecycle label
              needs a sentence explaining why every control is gone. */}
          {!canAdmin && isArchived && (
            <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.secondary })}>
              {t('monitor.archivedNoteViewer')}
            </Typography>
          )}

          {canAdmin && !isArchived && definition && (
            <Button
              size="small"
              variant="action-danger"
              onClick={() => setArchiveDialogOpen(true)}
            >
              {t('settings.archiveAgent')}
            </Button>
          )}
        </Stack>
      </Box>

      <ReasonDialog
        open={pauseDialogOpen}
        title={t('pause.dialogTitle')}
        description={t('pause.dialogDescription')}
        label={t('pause.reasonLabel')}
        placeholder={t('pause.reasonPlaceholder')}
        busy={data.createPauseMutation.isPending}
        saveLabel={t('pause.agent')}
        onClose={() => setPauseDialogOpen(false)}
        onSubmit={submitPause}
      />

      {definition && (
        <KanapDialog
          open={archiveDialogOpen}
          title={t('settings.archiveDialog.title')}
          onClose={() => setArchiveDialogOpen(false)}
          onSave={() => data.updateAgentStatusMutation.mutate(
            { id: definition.id, status: 'archived' },
            { onSuccess: () => setArchiveDialogOpen(false) },
          )}
          saveLabel={t('settings.archiveDialog.confirm')}
          saveVariant="action-danger"
          saveLoading={data.updateAgentStatusMutation.isPending}
        >
          <Typography variant="body2" color="text.secondary">
            {t('settings.archiveDialog.body', { name: definition.name })}
          </Typography>
        </KanapDialog>
      )}
    </Stack>
  );
}
