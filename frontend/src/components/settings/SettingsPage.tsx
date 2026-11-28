import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AutosaveStatus } from '../../hooks/useAutosave';

const ReadOnlyContext = React.createContext(false);

/** Whether the settings page around is read-only for the person (a reader): fields shown, none changeable. */
export function useSettingsReadOnly(): boolean {
  return React.useContext(ReadOnlyContext);
}

/** The page's save state, in one place: "Saving…" then "Saved", grey 12 px. */
export function SettingsSaveStatus({ status }: { status?: AutosaveStatus }) {
  const { t } = useTranslation(['common']);
  const text = status === 'pending' || status === 'saving'
    ? t('common:status.saving')
    : status === 'saved' ? t('common:status.saved') : '';
  return (
    <Typography role="status" aria-live="polite" sx={{ fontSize: 12, color: 'kanap.text.tertiary', whiteSpace: 'nowrap' }}>
      {text}
    </Typography>
  );
}

export interface SettingsPageProps {
  /** The page title, alone: no suffix, no subtitle. */
  title: string;
  /** The save state of the page's autosave (`useSettingsAutosave().status`); none on an operation page. */
  status?: AutosaveStatus;
  /** The page's pills (`variant="action"`, `"action-danger"`), after the save state. Not drawn for a reader. */
  actions?: React.ReactNode;
  /** The place of the History button, always last (lot HP). */
  history?: React.ReactNode;
  /** The setting is not loaded yet: nothing below the title. */
  loading?: boolean;
  /** The setting could not be loaded: one line in place of the page, no field offered. */
  error?: React.ReactNode;
  /** The person reads the page without changing it: the fields know it (`useSettingsReadOnly`), no pill. */
  readOnly?: boolean;
  children?: React.ReactNode;
}

/**
 * A settings page (design-ecrans.md §2): 880 px at most, aligned left, the title alone; on its
 * right the save state, the page's pills, then History. No Save or Cancel button: the fields save
 * themselves (`useSettingsAutosave`).
 */
export function SettingsPage({
  title,
  status,
  actions,
  history,
  loading = false,
  error,
  readOnly = false,
  children,
}: SettingsPageProps) {
  const { t } = useTranslation(['common']);
  let body: React.ReactNode = children;
  if (error) {
    body = <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.danger' }}>{error}</Typography>;
  } else if (loading) {
    body = <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('common:status.loading')}</Typography>;
  }
  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <Box sx={{ maxWidth: 880, width: '100%', display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ minHeight: 32, mb: 1 }}>
          <Typography component="h1" sx={{ fontSize: 22, fontWeight: 500, lineHeight: 1.3, color: 'kanap.text.primary' }}>
            {title}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1}>
            {!readOnly && status !== undefined && <SettingsSaveStatus status={status} />}
            {!readOnly && actions}
            {history}
          </Stack>
        </Stack>
        {body}
      </Box>
    </ReadOnlyContext.Provider>
  );
}

export default SettingsPage;
