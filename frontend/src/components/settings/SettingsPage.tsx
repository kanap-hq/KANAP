import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AutosaveStatus } from '../../hooks/useAutosave';

const ReadOnlyContext = React.createContext(false);

/** Whether the settings page around is read-only for the person (a reader): fields shown, none changeable. */
export function useSettingsReadOnly(): boolean {
  return React.useContext(ReadOnlyContext);
}

/**
 * The page's save state, in one place: "Saving…" then "Saved", grey 12 px. "Not saved" in the danger
 * colour after a failed save: the refusal shows under its field, a save the busy server put off is
 * sent again with the next change.
 */
export function SettingsSaveStatus({ status }: { status?: AutosaveStatus }) {
  const { t } = useTranslation(['common']);
  const text = status === 'pending' || status === 'saving'
    ? t('common:status.saving')
    : status === 'saved' ? t('common:status.saved')
      : status === 'error' ? t('common:status.notSaved') : '';
  return (
    <Typography role="status" aria-live="polite" sx={{ fontSize: 12, color: status === 'error' ? 'kanap.danger' : 'kanap.text.tertiary', whiteSpace: 'nowrap' }}>
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
  /** The place of the History button, always last. */
  history?: React.ReactNode;
  /**
   * The module's tabs, drawn under the title (13 px, the current one in the interaction colour).
   * The tab is in the address; a tab the person cannot open is not given.
   */
  tabs?: React.ReactNode;
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
 * right the save state, the page's pills, then History; the module's tabs under it. No Save or
 * Cancel button: the fields save themselves (`useSettingsAutosave`).
 */
export function SettingsPage({
  title,
  status,
  actions,
  history,
  tabs,
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
        {tabs && (
          <Box sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'kanap.border.default', '& .MuiTab-root': { fontSize: 13 } }}>
            {tabs}
          </Box>
        )}
        {body}
      </Box>
    </ReadOnlyContext.Provider>
  );
}

export default SettingsPage;
