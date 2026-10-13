import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import AuthFrame from '../components/AuthFrame';
import { getApiErrorMessage } from '../utils/apiErrorMessage';

export default function ResetPasswordPage() {
  const { t } = useTranslation(['auth', 'validation', 'errors']);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const location = useLocation();
  const navigate = useNavigate();

  const token = useMemo(() => {
    const hashParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const hashToken = hashParams.get('token');
    if (hashToken && hashToken.trim() !== '') return hashToken;
    return null;
  }, [location.hash]);
  const isSubmitting = status === 'submitting';
  const isSuccess = status === 'success';

  useEffect(() => {
    if (token && (location.hash || location.search)) {
      window.history.replaceState(null, '', location.pathname);
    }
  }, [token, location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (!token || token.trim() === '') {
      setError(t('auth:reset.invalidLink'));
    }
  }, [token]);

  useEffect(() => {
    if (isSuccess) {
      const timeout = window.setTimeout(() => {
        navigate('/login', { replace: true, state: { passwordResetSuccess: true } });
      }, 1800);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [isSuccess, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError(t('auth:reset.invalidLink'));
      return;
    }
    if (password.length < 8) {
      setError(t('validation:minLengthPassword'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('validation:passwordMismatch'));
      return;
    }

    setError(null);
    setStatus('submitting');
    try {
      await api.post('/auth/password-reset/complete', { token, password });
      setStatus('success');
    } catch (err: any) {
      // A rate limit and the answers with a code get their translated sentence.
      setError(getApiErrorMessage(err, t, t('auth:reset.serverError')));
      setStatus('idle');
    }
  };

  return (
    <AuthFrame>
      <Paper
        component="form"
        onSubmit={onSubmit}
        elevation={4}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: { xs: 3, md: 4 },
          borderRadius: 3,
        }}
      >
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {t('auth:reset.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('auth:reset.subtitle')}
            </Typography>
          </Stack>

          <Stack spacing={2}>
            <TextField
              label={t('auth:reset.newPassword')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              autoComplete="new-password"
              required
              disabled={isSubmitting || isSuccess || !token}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label={t('auth:reset.confirmPassword')}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              autoComplete="new-password"
              required
              disabled={isSubmitting || isSuccess || !token}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>

          {isSuccess && (
            <Alert severity="success" role="status">
              {t('auth:reset.successMessage')}
            </Alert>
          )}

          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}

          <Stack spacing={1.5}>
            <Button type="submit" variant="contained" fullWidth disabled={isSubmitting || isSuccess || !token}>
              {isSubmitting ? t('auth:reset.submitting') : t('auth:reset.submit')}
            </Button>
            <Button
              type="button"
              variant="text"
              color="primary"
              fullWidth
              onClick={() => navigate('/forgot-password')}
            >
              {t('auth:reset.requestNewLink')}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </AuthFrame>
  );
}
