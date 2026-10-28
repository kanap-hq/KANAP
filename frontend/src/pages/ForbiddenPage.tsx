import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FORBIDDEN_REASON_AI_CHAT_RIGHT, type ForbiddenState } from '../components/ProtectedRoute';
import { moduleRightLabel, rightLevelLabel } from '../utils/permissionLabels';

/**
 * React Router stores the position of the current entry in `window.history.state.idx`. A first
 * page load has no index, so there is no page inside the app to return to.
 */
export function canGoBack(historyState: unknown = window.history.state): boolean {
  return (((historyState as { idx?: number } | null)?.idx) ?? 0) > 0;
}

type ForbiddenPageProps = {
  /** The missing module right, when the caller knows it. */
  resource?: string;
  level?: string;
};

export default function ForbiddenPage({ resource, level }: ForbiddenPageProps) {
  const { t } = useTranslation('common');
  const { state } = useLocation();
  const navigate = useNavigate();
  const refusal = (state ?? {}) as ForbiddenState;
  const missingResource = resource ?? refusal.resource;
  const missingLevel = level ?? refusal.level;
  // The same sentence as the API refusal; the AI chat reason keeps its own wording.
  const sentence = missingResource && missingLevel
    ? t('errors:MODULE_RIGHT_REQUIRED', {
        resource: moduleRightLabel(t, missingResource),
        level: rightLevelLabel(t, missingLevel),
      })
    : refusal.reason === FORBIDDEN_REASON_AI_CHAT_RIGHT
      ? t('forbidden.aiChatRight')
      : t('forbidden.message');

  return (
    <Box sx={{ maxWidth: 560 }}>
      <Stack spacing={1.5}>
        <Typography variant="h5">{t('forbidden.title')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{sentence}</Typography>
        <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
          {canGoBack() && (
            <Button variant="outlined" onClick={() => navigate(-1)}>{t('buttons.back')}</Button>
          )}
          <Button component={RouterLink} to="/" variant="contained">{t('forbidden.cta')}</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
