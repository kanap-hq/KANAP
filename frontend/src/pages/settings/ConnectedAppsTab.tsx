import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, Link, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { aiKeysApi } from '../../ai/aiApi';
import type { AiApiKeyRecord } from '../../ai/aiTypes';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { useKanapDialogs } from '../../components/design/KanapDialogProvider';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDocPageUrl } from '../../utils/docUrls';
import { clientDisplayName } from '../oauth/clientName';

export const CONNECTED_APPS_QUERY_KEY = ['ai-keys', 'self'];

function isActive(key: AiApiKeyRecord): boolean {
  return !key.revoked_at && (!key.expires_at || new Date(key.expires_at).getTime() > Date.now());
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  py: 1.25,
  borderBottom: 1,
  borderColor: 'kanap.border.default',
} as const;

const sectionTitleSx = { fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', mb: 0.5 } as const;
const metaSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;

/**
 * The applications this user connected to KANAP's MCP server (claude.ai, Claude Desktop, Claude
 * Code), each with a disconnect button; then the user's own API keys, read only. The one place a
 * user without the administration rights sees and cuts these accesses.
 */
export default function ConnectedAppsTab() {
  const { t } = useTranslation(['settings', 'common']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();

  const keysQuery = useQuery<AiApiKeyRecord[]>({
    queryKey: CONNECTED_APPS_QUERY_KEY,
    queryFn: () => aiKeysApi.list(),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => aiKeysApi.revoke(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CONNECTED_APPS_QUERY_KEY }),
  });

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : t('connectedApps.never');

  const onDisconnect = async (key: AiApiKeyRecord, name: string) => {
    const ok = await dialogs.confirm({
      title: t('connectedApps.confirm.title', { client: name }),
      message: t('connectedApps.confirm.body', { client: name }),
      confirmLabel: t('connectedApps.disconnect'),
      intent: 'danger',
    });
    if (ok) revoke.mutate(key.id);
  };

  if (keysQuery.isLoading) {
    return <CircularProgress size={24} />;
  }
  if (keysQuery.isError) {
    return <Alert severity="error">{getApiErrorMessage(keysQuery.error, t, t('connectedApps.loadFailed'))}</Alert>;
  }

  const active = (keysQuery.data ?? []).filter(isActive);
  const connections = active.filter((key) => key.credential_kind === 'oauth');
  const apiKeys = active.filter((key) => key.credential_kind !== 'oauth');

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 500, mb: 0.5 }}>
          {t('connectedApps.title')}
        </Typography>
        {connections.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('connectedApps.empty')}{' '}
            <Link href={`${getDocPageUrl('ai-settings', locale)}#connecting-an-mcp-client`} target="_blank" rel="noopener">
              {t('connectedApps.howTo')}
            </Link>
          </Typography>
        ) : (
          <Box>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', mb: 1 }}>{t('connectedApps.subtitle')}</Typography>
            {connections.map((key) => {
              const name = clientDisplayName(key.oauth_client_name) ?? key.label;
              return (
                <Box key={key.id} sx={rowSx} data-testid="connected-app-row">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>
                      {name}
                      {key.oauth_redirect_host ? (
                        <Box component="span" sx={{ fontWeight: 400, color: 'kanap.text.tertiary' }}>
                          {' · '}
                          {key.oauth_redirect_host}
                        </Box>
                      ) : null}
                    </Typography>
                    <Typography sx={metaSx}>
                      {t('connectedApps.connectedOn', { date: formatDate(key.created_at) })}
                      {' · '}
                      {t('connectedApps.lastUsed', { date: formatDate(key.last_used_at) })}
                    </Typography>
                  </Box>
                  <Button
                    variant="action"
                    disabled={revoke.isPending}
                    onClick={() => void onDisconnect(key, name)}
                  >
                    {t('connectedApps.disconnect')}
                  </Button>
                </Box>
              );
            })}
          </Box>
        )}
        {revoke.isError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {getApiErrorMessage(revoke.error, t, t('connectedApps.disconnectFailed'))}
          </Alert>
        ) : null}
      </Box>

      {apiKeys.length > 0 ? (
        <Box>
          <Typography sx={sectionTitleSx}>{t('connectedApps.apiKeys')}</Typography>
          {apiKeys.map((key) => (
            <Box key={key.id} sx={rowSx}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13 }}>
                  {key.label}
                  <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, color: 'kanap.text.tertiary', ml: 1 }}>
                    {key.key_prefix}
                  </Box>
                </Typography>
                <Typography sx={metaSx}>
                  {t('connectedApps.createdOn', { date: formatDate(key.created_at) })}
                  {' · '}
                  {t('connectedApps.lastUsed', { date: formatDate(key.last_used_at) })}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
    </Stack>
  );
}
