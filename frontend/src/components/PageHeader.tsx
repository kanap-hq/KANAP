import React from 'react';
import { Typography, Stack, Box } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Title row of a list, report or administration page. No breadcrumb: the left
 * navigation already leads back to the section.
 */
export default function PageHeader({
  title,
  titleContent,
  actions,
}: {
  title: string;
  /** Replaces the title typography when the page needs an inline editor. */
  titleContent?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation('nav');
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, flex: 1 }}>
          {titleContent ?? <Typography variant="h5" data-page-title>{title}</Typography>}
          {isAdmin && <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{t('breadcrumbs.admin')}</Box>}
        </Stack>
        {actions}
      </Stack>
    </Stack>
  );
}
