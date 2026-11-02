import React from 'react';
import { Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

export default function FormErrorAlert({ error }: { error?: unknown }) {
  const { t } = useTranslation('common');
  if (!error) return null;
  const anyErr = error as any;
  // Axios error shape; a coded refusal is shown in the language of the screen.
  const msg = getApiErrorMessage(error, t, anyErr?.message || anyErr?.toString?.() || '');
  if (!msg) return null;
  return <Alert severity="error" sx={{ mb: 2 }}>{msg}</Alert>;
}
