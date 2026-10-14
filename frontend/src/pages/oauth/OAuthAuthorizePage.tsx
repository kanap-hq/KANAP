import { useEffect, useRef, useState } from 'react';
import { Box, Button, Checkbox, CircularProgress, FormControlLabel, Link, Paper, Stack, Typography } from '@mui/material';
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import AuthFrame from '../../components/AuthFrame';
import { useTenant } from '../../tenant/TenantContext';
import { clientDisplayName } from './clientName';

/** What `GET /oauth/authorize/request` answers for a valid request. */
type AuthorizationRequest = {
  client: { client_id: string; client_name?: string | null; client_uri?: string | null; logo_uri?: string | null };
  redirect_uri: string;
  redirect_host: string;
  loopback_redirect: boolean;
  scope: string;
  resource: string;
  /** Remembered and returning to this computer (Claude Code): approved without a screen. */
  auto_approve: boolean;
  /** Remembered for this user, whatever the redirect: a web client sees the short screen. */
  remembered?: boolean;
};

type PageError = {
  /** The account may not connect applications (no MCP access, MCP off, workspace frozen). */
  denied: boolean;
  /** Set only when the server verified the client's return address. */
  redirectTo: string | null;
};

const cardSx = {
  width: '100%',
  maxWidth: 440,
  p: { xs: 3, md: 4 },
  borderRadius: '12px',
  border: 1,
  borderColor: 'kanap.border.default',
  bgcolor: 'kanap.bg.primary',
} as const;

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function errorOf(err: any): PageError {
  const redirectTo = err?.response?.data?.redirect_to;
  return {
    denied: err?.response?.status === 403,
    redirectTo: typeof redirectTo === 'string' && /^https?:\/\//i.test(redirectTo) ? redirectTo : null,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function ClientLogo({ logoUri }: { logoUri?: string | null }) {
  const [failed, setFailed] = useState(false);
  const usable = !!logoUri && /^https:\/\//i.test(logoUri) && !failed;
  return (
    <Box
      sx={{
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: '8px',
        border: 1,
        borderColor: 'kanap.border.default',
        bgcolor: 'kanap.bg.drawer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {usable ? (
        <Box
          component="img"
          src={logoUri!}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          sx={{ width: 28, height: 28, objectFit: 'contain' }}
        />
      ) : (
        <AppsOutlinedIcon sx={{ fontSize: 22, color: 'kanap.text.secondary' }} />
      )}
    </Box>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{label}</Typography>
      <Box sx={{ fontSize: 13, color: 'kanap.text.primary', overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}

/**
 * The consent page of an MCP connection (spec planning/mcp-oauth.md §5). The API's authorization
 * endpoint sends the browser here with the client's request as is; this page signs the user in
 * (back here afterwards), reads the request, and posts the answer. Errors never send the browser
 * anywhere by themselves.
 */
export default function OAuthAuthorizePage() {
  const { t } = useTranslation(['auth', 'common']);
  const location = useLocation();
  const { token, isAuthenticating, profile, logout } = useAuth();
  const { tenantName } = useTenant();
  const [request, setRequest] = useState<AuthorizationRequest | null>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const autoApproveSent = useRef(false);
  const framed = isFramed();
  const search = location.search;

  useEffect(() => {
    if (!token || framed) return;
    let cancelled = false;
    setRequest(null);
    setError(null);
    api
      .get(`/oauth/authorize/request${search}`)
      .then((res) => {
        if (!cancelled) setRequest(res.data as AuthorizationRequest);
      })
      .catch((err) => {
        if (!cancelled) setError(errorOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, search, framed]);

  const decide = async (approve: boolean, rememberChoice: boolean) => {
    setSubmitting(true);
    try {
      const params = Object.fromEntries(new URLSearchParams(search));
      const res = await api.post('/oauth/authorize/decision', { ...params, approve, remember: rememberChoice });
      const redirectTo = res.data?.redirect_to;
      if (typeof redirectTo !== 'string' || !redirectTo) throw new Error('No redirect');
      // An external address (Claude) or a loopback one (Claude Code): a full navigation.
      window.location.assign(redirectTo);
    } catch (err) {
      setSubmitting(false);
      setError(errorOf(err));
    }
  };

  useEffect(() => {
    if (!request?.auto_approve || autoApproveSent.current) return;
    autoApproveSent.current = true;
    void decide(true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (framed) {
    return (
      <AuthFrame>
        <Paper elevation={0} sx={cardSx}>
          <Typography role="alert" sx={{ fontSize: 14 }}>{t('auth:oauthConsent.framed')}</Typography>
        </Paper>
      </AuthFrame>
    );
  }

  if (isAuthenticating) {
    return (
      <AuthFrame>
        <CircularProgress size={28} />
      </AuthFrame>
    );
  }

  if (!token) {
    const returnTo = `${location.pathname}${search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (error) {
    const backHost = error.redirectTo ? hostOf(error.redirectTo) : '';
    return (
      <AuthFrame>
        <Paper elevation={0} sx={cardSx}>
          <Stack spacing={2}>
            <Typography variant="h6" sx={{ fontWeight: 500 }}>
              {error.denied ? t('auth:oauthConsent.error.deniedTitle') : t('auth:oauthConsent.error.title')}
            </Typography>
            <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
              {error.denied ? t('auth:oauthConsent.error.deniedBody') : t('auth:oauthConsent.error.body')}
            </Typography>
            {error.redirectTo && (
              <Box>
                <Button variant="outlined" color="inherit" onClick={() => window.location.assign(error.redirectTo!)}>
                  {backHost ? t('auth:oauthConsent.error.backTo', { host: backHost }) : t('auth:oauthConsent.error.back')}
                </Button>
              </Box>
            )}
          </Stack>
        </Paper>
      </AuthFrame>
    );
  }

  if (!request || request.auto_approve) {
    const name = request ? clientDisplayName(request.client.client_name) ?? t('auth:oauthConsent.unknownClient') : null;
    return (
      <AuthFrame>
        <Stack direction="row" spacing={1.5} alignItems="center" role="status">
          <CircularProgress size={20} />
          {name && (
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
              {t('auth:oauthConsent.connecting', { client: name })}
            </Typography>
          )}
        </Stack>
      </AuthFrame>
    );
  }

  const clientName = clientDisplayName(request.client.client_name) ?? t('auth:oauthConsent.unknownClient');
  const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || profile?.email || '';
  const destination = request.loopback_redirect
    ? t('auth:oauthConsent.thisComputer', { host: request.redirect_host })
    : request.redirect_host;
  const short = request.remembered === true;

  const identity = (
    <>
      <DetailRow label={t('auth:oauthConsent.returnsTo')}>{destination}</DetailRow>
      <DetailRow label={t('auth:oauthConsent.signedInAs')}>
        <Box component="span">
          {tenantName ? t('auth:oauthConsent.userInTenant', { user: userName, tenant: tenantName }) : userName}
        </Box>
        {' · '}
        <Link component="button" type="button" variant="body2" onClick={() => void logout()} sx={{ fontSize: 13, verticalAlign: 'baseline' }}>
          {t('auth:oauthConsent.notYou')}
        </Link>
      </DetailRow>
    </>
  );

  return (
    <AuthFrame>
      <Paper elevation={0} sx={cardSx}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <ClientLogo logoUri={request.client.logo_uri} />
            <Typography variant="h6" component="h1" sx={{ fontWeight: 500, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {short
                ? t('auth:oauthConsent.continueTitle', { client: clientName })
                : t('auth:oauthConsent.title', { client: clientName })}
            </Typography>
          </Stack>

          {!short && (
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
              {t('auth:oauthConsent.readOnly')}
            </Typography>
          )}

          <Stack spacing={1.5}>{identity}</Stack>

          {!short && (
            <FormControlLabel
              control={<Checkbox size="small" checked={remember} onChange={(event) => setRemember(event.target.checked)} />}
              label={<Typography sx={{ fontSize: 13 }}>{t('auth:oauthConsent.remember')}</Typography>}
            />
          )}

          {short ? (
            <Stack spacing={1.5}>
              <Button variant="contained" fullWidth disabled={submitting} onClick={() => void decide(true, true)}>
                {t('auth:oauthConsent.continue')}
              </Button>
              <Box sx={{ textAlign: 'center' }}>
                <Link component="button" type="button" variant="body2" disabled={submitting} onClick={() => void decide(false, false)}>
                  {t('auth:oauthConsent.deny')}
                </Link>
              </Box>
            </Stack>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="outlined" color="inherit" fullWidth disabled={submitting} onClick={() => void decide(false, false)}>
                {t('auth:oauthConsent.deny')}
              </Button>
              <Button variant="contained" fullWidth disabled={submitting} onClick={() => void decide(true, remember)}>
                {t('auth:oauthConsent.allow')}
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>
    </AuthFrame>
  );
}
