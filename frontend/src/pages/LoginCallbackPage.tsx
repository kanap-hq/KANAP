import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import api from '../api';
import { sanitizeLoginRedirect } from '../auth/loginRedirect';

export default function LoginCallbackPage() {
  const { t } = useTranslation('auth');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    const completeLogin = async () => {
      const hashParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
      const handoff = hashParams.get('handoff');
      const token = hashParams.get('token');
      const expiresInStr = hashParams.get('expiresIn');
      const refreshExpiresInStr = hashParams.get('refreshExpiresIn');
      let redirectTo = sanitizeLoginRedirect(hashParams.get('redirectTo'));

      if (handoff) {
        try {
          const res = await api.post('/auth/entra/session', { handoff });
          const data = res.data || {};
          if (!data.access_token || !Number.isFinite(Number(data.expires_in))) {
            throw new Error('Invalid Entra session response');
          }
          redirectTo = sanitizeLoginRedirect(data.redirectTo);
          if (location.hash || location.search) {
            window.history.replaceState(null, '', location.pathname);
          }
          if (cancelled) return;
          login({
            access_token: data.access_token,
            expires_in: Number(data.expires_in),
            refresh_expires_in: Number.isFinite(Number(data.refresh_expires_in)) ? Number(data.refresh_expires_in) : undefined,
          });
          navigate(redirectTo, { replace: true });
          return;
        } catch {
          if (!cancelled) {
            navigate('/login', { replace: true, state: { ssoError: 'Sign-in failed. Please try again.' } });
          }
          return;
        }
      }

      if (!token || !expiresInStr || !Number.isFinite(parseInt(expiresInStr, 10))) {
        if (!cancelled) {
          navigate('/login', { replace: true, state: { ssoError: 'Sign-in failed. Please try again.' } });
        }
        return;
      }

      if (location.hash || location.search) {
        window.history.replaceState(null, '', location.pathname);
      }

      let accessToken = token;
      let expiresIn = parseInt(expiresInStr, 10);
      let refreshExpiresIn = refreshExpiresInStr ? parseInt(refreshExpiresInStr, 10) : undefined;

      if (cancelled) return;
      login({
        access_token: accessToken,
        expires_in: expiresIn,
        refresh_expires_in: refreshExpiresIn,
      });
      navigate(redirectTo, { replace: true });
    };

    void completeLogin();
    return () => {
      cancelled = true;
    };
  }, [location.hash, location.pathname, location.search, login, navigate]);

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
      <Box textAlign="center">
        <CircularProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>
          {t('callback.signingIn')}
        </Typography>
      </Box>
    </Box>
  );
}
