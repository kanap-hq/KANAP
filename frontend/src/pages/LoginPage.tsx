import { useEffect, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import AuthFrame from '../components/AuthFrame';
import { useTenant } from '../tenant/TenantContext';
import { useFeatures } from '../config/FeaturesContext';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import { oauthReturnPath } from '../auth/loginRedirect';

const marketingUrl = import.meta.env.VITE_MARKETING_URL ?? 'https://kanap.net';
// Signing in lands on the home page: no memory of the page the user was on. The one exception is
// the consent page of an MCP connection (`?returnTo=/oauth/authorize?…`), see oauthReturnPath.

/** Whole minutes of a 429's `Retry-After` (in seconds), rounded up; null without a usable value. */
function retryAfterMinutes(err: any): number | null {
  const value = String(err?.response?.headers?.['retry-after'] ?? '').trim();
  if (!/^\d+$/.test(value) || Number(value) <= 0) return null;
  return Math.ceil(Number(value) / 60);
}

/** A 400 from the request check that names the e-mail field: the address typed is not an e-mail. */
function isInvalidEmail(err: any): boolean {
  const data = err?.response?.data;
  if (err?.response?.status !== 400 || data?.code) return false;
  const messages = Array.isArray(data?.message) ? data.message : [data?.message];
  return messages.some((message: unknown) => typeof message === 'string' && /\bemail\b/i.test(message));
}

/**
 * The message of a refused sign-in: a rate limit has its own sentence, with the wait the server
 * gives when it gives one; an address that is not an e-mail has its own sentence; an answer with a
 * code goes through the shared error messages; anything else (no answer, another validation
 * error) is the plain failure sentence.
 */
function signInErrorMessage(err: any, t: TFunction): string {
  const fallback = t('auth:login.failed');
  if (err?.response?.status === 429) {
    const minutes = retryAfterMinutes(err);
    return minutes === null ? t('auth:login.tooManyAttempts') : t('auth:login.tooManyAttemptsWait', { count: minutes });
  }
  if (isInvalidEmail(err)) return t('auth:login.invalidEmail');
  const code = err?.response?.data?.code;
  if (typeof code === 'string' && code.trim()) return getApiErrorMessage(err, t, fallback);
  return fallback;
}

export default function LoginPage() {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get('sessionExpired') === 'true';
  const postLoginPath = oauthReturnPath(searchParams.get('returnTo'));
  const [infoMessage, setInfoMessage] = useState<string | null>(() => {
    const state = location.state as any;
    if (state?.passwordResetSuccess) {
      return 'passwordUpdated';
    }
    if (state?.passwordResetEmailSent) {
      return 'resetEmailSent';
    }
    if (state?.inviteAccepted) {
      return 'accountReady';
    }
    return null;
  });
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(() =>
    sessionExpired ? 'sessionExpired' : null
  );
  const [ssoErrorMessage, setSsoErrorMessage] = useState<string | null>(() => {
    const code = searchParams.get('ssoError');
    if (!code) return null;
    const map: Record<string, string> = {
      ENTRA_EMAIL_UNVERIFIED: 'ssoEmailUnverified',
      ENTRA_TENANT_MISMATCH: 'ssoTenantMismatch',
      SSO_NOT_CONFIGURED: 'ssoNotConfigured',
    };
    return map[code] ?? 'ssoFailed';
  });
  const { login } = useAuth();
  const { isPlatformHost } = useTenant();
  const { config } = useFeatures();

  useEffect(() => {
    const state = location.state as any;
    if (state?.passwordResetSuccess || state?.passwordResetEmailSent || state?.inviteAccepted) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setSessionExpiredMessage(null);
    setSsoErrorMessage(null);
    try {
      const res = await api.post('/auth/login', { email: username, password });
      login(res.data as { access_token: string; expires_in: number; refresh_expires_in?: number });
      navigate(postLoginPath, { replace: true });
    } catch (err: any) {
      setError(signInErrorMessage(err, t));
    }
  };

  const onMicrosoftSignIn = () => {
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
    const base = apiBase.replace(/\/$/, '');
    const url = `${base}/auth/entra/login?redirectTo=${encodeURIComponent(postLoginPath)}`;
    window.location.href = url;
  };

  return (
    <AuthFrame>
      <Paper
        component="form"
        onSubmit={onSubmit}
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: { xs: 3, md: 4 },
          borderRadius: '12px',
          border: 1,
          borderColor: 'kanap.border.default',
          bgcolor: 'kanap.bg.primary',
        }}
      >
        <Stack spacing={3}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 500 }}>
              {t('auth:login.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('auth:login.subtitle')}
            </Typography>
          </Box>

          <Stack spacing={3}>
            {!isPlatformHost && config.features.sso && (
              <Button
                type="button"
                variant="contained"
                color="primary"
                fullWidth
                onClick={onMicrosoftSignIn}
              >
                {t('auth:login.ssoMicrosoft')}
              </Button>
            )}

            <Stack spacing={2}>
              <TextField
                label={t('auth:login.emailLabel')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                type="text"
                fullWidth
                autoComplete="username"
                autoFocus
              />
              <TextField
                label={t('auth:login.passwordLabel')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                fullWidth
                autoComplete="current-password"
              />
            </Stack>

            {sessionExpiredMessage && (
              <Alert severity="warning" role="status">
                {t(`auth:login.${sessionExpiredMessage}`)}
              </Alert>
            )}
            {ssoErrorMessage && (
              <Alert severity="error" role="alert">
                {t(`auth:login.${ssoErrorMessage}`)}
              </Alert>
            )}

            {infoMessage && (
              <Alert severity="success" role="status">
                {t(`auth:login.${infoMessage}`)}
              </Alert>
            )}

            {error && (
              <Alert severity="error" role="alert">
                {String(error)}
              </Alert>
            )}

            <Stack spacing={1.5}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button
                  type="button"
                  variant="outlined"
                  color="inherit"
                  fullWidth
                  onClick={() => {
                    window.location.href = marketingUrl;
                  }}
                >
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit" variant="outlined" fullWidth sx={{ whiteSpace: 'nowrap' }}>
                  {t('auth:login.submit')}
                </Button>
              </Stack>
              {config.features.email && (
                <Button
                  type="button"
                  variant="text"
                  color="primary"
                  fullWidth
                  onClick={() => navigate('/forgot-password')}
                >
                  {t('auth:login.forgotPassword')}
                </Button>
              )}
            </Stack>
          </Stack>
        </Stack>
      </Paper>
    </AuthFrame>
  );
}
