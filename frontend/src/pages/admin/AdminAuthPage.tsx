import React from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import PageHeader from '../../components/PageHeader';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useTenant } from '../../tenant/TenantContext';
import ForbiddenPage from '../ForbiddenPage';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

type DirectorySyncInfo = {
  status: 'never' | 'ok' | 'consent_required' | 'error' | string;
  message: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  synced: number | null;
  disabled: number | null;
  removed: number | null;
  /** The last enabled Administrator the sync kept although the directory removed them. */
  kept_administrator: string | null;
  consent_url: string | null;
};

type AuthSettings = {
  sso_provider: 'none' | 'entra' | string;
  entra_tenant_id: string | null;
  sso_enabled: boolean;
  entra_metadata: Record<string, any> | null;
  directory_sync: DirectorySyncInfo | null;
};

type SyncRunResult = { status: string; message?: string | null; synced: number; disabled: number; removed: number };

export default function AdminAuthPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { hasLevel } = useAuth();
  const { isPlatformHost } = useTenant();

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState<SyncRunResult | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const locale = useLocale();
  // Landing back from the Microsoft admin-consent screen (?consent=success|error)
  const [consentOutcome] = React.useState<string | null>(() => searchParams.get('consent'));
  // Landing back from the Microsoft connect handshake (?setup=success|error&reason=…)
  const [setupOutcome] = React.useState<string | null>(() => searchParams.get('setup'));
  const [setupReason] = React.useState<string | null>(() => searchParams.get('reason'));
  React.useEffect(() => {
    if (searchParams.has('consent') || searchParams.has('setup') || searchParams.has('reason')) {
      const next = new URLSearchParams(searchParams);
      next.delete('consent');
      next.delete('setup');
      next.delete('reason');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (isPlatformHost || !hasLevel('users', 'admin')) {
    return <ForbiddenPage />;
  }

  const { data, isLoading, isError, error, refetch } = useQuery<AuthSettings, any>({
    queryKey: ['admin-auth-settings'],
    queryFn: async () => {
      const res = await api.get('/admin/auth/settings');
      return res.data;
    },
  });

  const handleConnect = async () => {
    setActionError(null);
    setConnecting(true);
    try {
      const res = await api.post('/auth/entra/setup/start');
      const url = res.data?.url;
      if (url) {
        window.location.href = url;
      } else {
        setActionError(t('auth.messages.connectStartFailed'));
      }
    } catch (e: any) {
      setActionError(getApiErrorMessage(e, t, t('auth.messages.connectStartFailed')));
    } finally {
      setConnecting(false);
    }
  };

  const handleTestSignIn = () => {
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
    const base = apiBase.replace(/\/$/, '');
    const url = `${base}/auth/entra/login?redirectTo=${encodeURIComponent('/admin/auth')}`;
    window.location.href = url;
  };

  const connected = data?.sso_provider === 'entra' && !!data.entra_tenant_id;
  const sync = data?.directory_sync ?? null;

  const handleSyncNow = async () => {
    setActionError(null);
    setSyncResult(null);
    setSyncing(true);
    try {
      const res = await api.post('/admin/auth/directory-sync', {});
      setSyncResult(res.data as SyncRunResult);
      await refetch();
    } catch (e: any) {
      setActionError(getApiErrorMessage(e, t, t('auth.sync.error', { message: '' })));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connected || !data) return;
    setActionError(null);
    setDisconnecting(true);
    try {
      await api.post('/admin/auth/disconnect', {});
      // Refetch settings to reflect disconnected state
      await (async () => {
        const res = await api.get('/admin/auth/settings');
        // This relies on react-query's automatic refetch when key is invalidated;
        // simplest dev UX is to reload the page.
        window.location.reload();
        return res.data;
      })();
    } catch (e: any) {
      setActionError(getApiErrorMessage(e, t, t('auth.messages.disconnectFailed')));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      <PageHeader title={t('auth.title')} />
      <Box maxWidth={600}>
        {isLoading && (
          <Box display="flex" justifyContent="center" alignItems="center" py={4}>
            <CircularProgress />
          </Box>
        )}
        {isError && (
          <Alert severity="error">
            {getApiErrorMessage(error, t, t('auth.messages.loadFailed'))}
          </Alert>
        )}
        {!!actionError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {actionError}
          </Alert>
        )}
        {setupOutcome === 'success' && (
          <Alert severity="success" sx={{ mb: 2 }}>{t('auth.messages.setupSuccess')}</Alert>
        )}
        {setupOutcome === 'error' && (
          <Alert severity="error" sx={{ mb: 2 }}>{t('auth.messages.setupFailed', { reason: setupReason ?? '' })}</Alert>
        )}
        {consentOutcome === 'success' && (
          <Alert severity="success" sx={{ mb: 2 }}>{t('auth.sync.consentSuccess')}</Alert>
        )}
        {consentOutcome === 'error' && (
          <Alert severity="warning" sx={{ mb: 2 }}>{t('auth.sync.consentError')}</Alert>
        )}
        {data && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">{t('auth.entra.title')}</Typography>
                {!connected && (
                  <Typography variant="body2" color="text.secondary">
                    {t('auth.entra.disconnectedDescription')}
                  </Typography>
                )}
                {connected && (
                  <Stack spacing={1}>
                    <Typography variant="body2" color="text.secondary">
                      {t('auth.entra.connected')}
                    </Typography>
                    <Typography variant="body2">
                      <strong>{t('auth.entra.tenantId')}:</strong> {data.entra_tenant_id}
                    </Typography>
                  </Stack>
                )}
                <Stack direction="row" spacing={2} mt={1}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleConnect}
                    disabled={connecting || disconnecting}
                  >
                    {connecting
                      ? t('auth.actions.connecting')
                      : connected
                      ? t('auth.actions.reconnect')
                      : t('auth.actions.connect')}
                  </Button>
                  {connected && (
                    <>
                      <Button variant="outlined" onClick={handleTestSignIn} disabled={disconnecting}>
                        {t('auth.actions.testSignIn')}
                      </Button>
                      <Button
                        variant="text"
                        color="error"
                        onClick={handleDisconnect}
                        disabled={disconnecting || connecting}
                      >
                        {disconnecting ? t('auth.actions.disconnecting') : t('auth.actions.disconnect')}
                      </Button>
                    </>
                  )}
                </Stack>
                {connected && sync && (
                  <Stack spacing={1} mt={2}>
                    <Typography variant="subtitle2" fontWeight={500}>{t('auth.sync.title')}</Typography>
                    <Typography variant="body2" color="text.secondary">{t('auth.sync.description')}</Typography>
                    {sync.status === 'ok' && sync.last_success_at && (
                      <Typography variant="body2">
                        {t('auth.sync.lastSynced', {
                          date: formatShortDateTime(sync.last_success_at, locale),
                          synced: sync.synced ?? 0,
                          disabled: (sync.disabled ?? 0) + (sync.removed ?? 0),
                        })}
                      </Typography>
                    )}
                    {sync.status === 'ok' && sync.kept_administrator && (
                      <Typography variant="body2">
                        {t('auth.sync.keptAdministrator', { name: sync.kept_administrator })}
                      </Typography>
                    )}
                    {(sync.status === 'never' || sync.status === 'consent_required') && (
                      <Typography variant="body2" color="text.secondary">{t('auth.sync.consentNeeded')}</Typography>
                    )}
                    {sync.status === 'error' && (
                      <Alert severity="warning">{t('auth.sync.error', { message: sync.message ?? '' })}</Alert>
                    )}
                    {syncResult && (
                      <Alert severity={syncResult.status === 'ok' ? 'success' : syncResult.status === 'already_running' ? 'info' : 'warning'}>
                        {syncResult.status === 'ok'
                          ? t('auth.sync.resultOk', { synced: syncResult.synced, disabled: syncResult.disabled + syncResult.removed })
                          : syncResult.status === 'already_running'
                          ? t('auth.sync.alreadyRunning')
                          : syncResult.status === 'consent_required'
                          ? t('auth.sync.consentNeeded')
                          : t('auth.sync.error', { message: syncResult.message ?? '' })}
                      </Alert>
                    )}
                    <Stack direction="row" spacing={2}>
                      {sync.status !== 'ok' && sync.consent_url && (
                        <Button variant="contained" href={sync.consent_url} disabled={syncing}>
                          {t('auth.sync.grantAccess')}
                        </Button>
                      )}
                      <Button variant="outlined" onClick={handleSyncNow} disabled={syncing || disconnecting}>
                        {syncing ? t('auth.sync.syncing') : t('auth.sync.syncNow')}
                      </Button>
                    </Stack>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>
    </>
  );
}
