import { useEffect, useState } from 'react';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import AuthFrame from '../components/AuthFrame';
import { getApiErrorMessage } from '../utils/apiErrorMessage';

/** Codes of a refused confirmation that the sign-in page explains. */
const REFUSALS = new Set(['ENTRA_LINK_INVALID', 'ENTRA_ACCOUNT_LINKED']);

/**
 * Landing of the link e-mailed to an existing account after a Microsoft sign-in with its address.
 * The link is confirmed by a click, never on opening: mail filters that open links do not confirm it.
 */
export default function LinkMicrosoftPage() {
  const { t } = useTranslation(['auth', 'errors']);
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.replace(/^#/, '')).get('token'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The token stays out of the address bar and the history.
    if (location.hash) window.history.replaceState(null, '', location.pathname);
    if (!token) navigate('/login?ssoError=ENTRA_LINK_INVALID', { replace: true });
    // Once, on landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConfirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/entra/link', { token });
      navigate('/login', { replace: true, state: { microsoftLinked: true } });
    } catch (err: any) {
      const code = err?.response?.data?.message;
      if (err?.response?.status === 400) {
        navigate(`/login?ssoError=${REFUSALS.has(code) ? code : 'ENTRA_LINK_INVALID'}`, { replace: true });
        return;
      }
      setError(getApiErrorMessage(err, t, t('auth:login.ssoFailed')));
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame>
      <Paper elevation={4} sx={{ width: '100%', maxWidth: 420, p: { xs: 3, md: 4 }, borderRadius: 3 }}>
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography variant="h5" sx={{ fontWeight: 500 }}>
              {t('auth:linkMicrosoft.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('auth:linkMicrosoft.subtitle')}
            </Typography>
          </Stack>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          <Button variant="contained" fullWidth disabled={!token || submitting} onClick={onConfirm}>
            {t('auth:linkMicrosoft.confirm')}
          </Button>
        </Stack>
      </Paper>
    </AuthFrame>
  );
}
