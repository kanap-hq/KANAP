import React from 'react';
import { IconButton, Tooltip, Typography } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { useTranslation } from 'react-i18next';

/** Pieces shared by the list editors of the IT landscape settings. */

export const makeLocalId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

// Returns same reference if no changes needed to avoid triggering re-renders
export const withLocalIds = <T extends { localId?: string }>(list: T[], prefix: string): (T & { localId: string })[] => {
  const allHaveIds = list.every((row) => row.localId);
  if (allHaveIds) return list as (T & { localId: string })[];
  return list.map((row) => (row.localId ? row : { ...(row as any), localId: makeLocalId(prefix) }));
};

export const stripLocalIds = <T extends { localId?: string }>(list: T[]): Omit<T, 'localId'>[] =>
  list.map(({ localId, ...rest }) => rest as Omit<T, 'localId'>);


export function TranslateButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation('common');
  return <IconButton size="small" aria-label={`${t('enumEditor.translate')} ${label}`} sx={{ color: 'kanap.text.secondary', mr: 0.5 }} onClick={onClick}><TranslateIcon sx={{ fontSize: 17 }} /></IconButton>;
}

export function IssueText({ issue }: { issue?: string }) {
  const { t } = useTranslation('common');
  if (!issue || issue === 'nameRequired') return null;
  return <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25 }}>{t(`enumEditor.${issue}`)}</Typography>;
}

/** A number field without the browser's arrows: the count is typed. */
export const countFieldSx = {
  '& input[type=number]': { appearance: 'textfield', MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
} as const;

/** A column header that says, on hover, where to find its value. */
export function HintedHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <span>{label}</span>
    </Tooltip>
  );
}

export const MAX_COUNT = 100_000_000;
