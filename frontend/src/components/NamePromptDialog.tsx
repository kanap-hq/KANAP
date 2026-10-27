import React from 'react';
import { Alert, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import { KanapDialog } from './design';

const storageKey = (userId: string) => `kanap.namePrompt.later.${userId}`;

function readLater(userId: string): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeLater(userId: string) {
  try {
    localStorage.setItem(storageKey(userId), '1');
  } catch {
    // Storage unavailable: the dialog may come back on the next load.
  }
}

const isBlank = (value: string | null | undefined) => !String(value ?? '').trim();

/** Asks for a first and last name once, when the signed-in user has neither. */
export default function NamePromptDialog() {
  const { t } = useTranslation(['auth', 'settings']);
  const { profile, claims, refreshMe } = useAuth();
  const { isPlatformHost } = useTenant();
  const userId = profile?.id ?? null;
  const [laterFor, setLaterFor] = React.useState<string | null>(null);
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const eligible = !!userId
    && !isPlatformHost
    && !claims?.isPlatformAdmin
    && isBlank(profile?.first_name)
    && isBlank(profile?.last_name);
  const open = eligible && laterFor !== userId && !readLater(userId as string);

  const handleLater = React.useCallback(() => {
    if (!userId) return;
    writeLater(userId);
    setLaterFor(userId);
  }, [userId]);

  const handleSave = React.useCallback(async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first && !last) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch('/users/me', { first_name: first || null, last_name: last || null });
      await refreshMe();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings:profile.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  }, [firstName, lastName, refreshMe, t]);

  if (!open) return null;

  return (
    <KanapDialog
      open
      title={t('auth:namePrompt.title')}
      onClose={handleLater}
      cancelLabel={t('auth:namePrompt.later')}
      onSave={handleSave}
      saveDisabled={!firstName.trim() && !lastName.trim()}
      saveLoading={saving}
    >
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          autoFocus
          size="small"
          label={t('settings:profile.fields.firstName')}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          fullWidth
        />
        <TextField
          size="small"
          label={t('settings:profile.fields.lastName')}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          fullWidth
        />
      </Stack>
    </KanapDialog>
  );
}
