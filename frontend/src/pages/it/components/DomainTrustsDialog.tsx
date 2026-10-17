import React from 'react';
import { Box, IconButton, MenuItem, Select, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../../../components/design/KanapDialog';
import { compactSelectMenuProps } from '../../../theme/formSx';
import type { DomainOption, DomainTrust, DomainTrustDirection } from '../../../services/itOpsSettings';

export const TRUST_DIRECTIONS: DomainTrustDirection[] = ['two_way', 'outgoing', 'incoming'];

type Props = {
  /** The domain whose trusts are edited; null when closed. */
  domain: DomainOption | null;
  /** Every domain of the list, to choose the trusted one from (saved domains only: they have a code). */
  domains: DomainOption[];
  onClose: () => void;
  onSave: (trusts: DomainTrust[] | undefined) => void;
};

/** The trusts of one domain: one row per other domain, with its direction. */
export default function DomainTrustsDialog({ domain, domains, onClose, onSave }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const [draft, setDraft] = React.useState<DomainTrust[]>([]);
  React.useEffect(() => { if (domain) setDraft(domain.trusts ?? []); }, [domain]);

  const candidates = domains.filter((item) => item.code && !item.system && item.code !== domain?.code);
  const labelOf = (code: string) => candidates.find((item) => item.code === code)?.label ?? code;
  const free = candidates.filter((item) => !draft.some((trust) => trust.domain === item.code));
  const update = (index: number, patch: Partial<DomainTrust>) => setDraft((prev) => prev.map((trust, i) => (i === index ? { ...trust, ...patch } : trust)));

  return (
    <KanapDialog
      open={!!domain}
      title={t('pages.settings.trusts.title', { name: domain?.label ?? '' })}
      subtitle={t('pages.settings.trusts.hint')}
      onClose={onClose}
      onSave={() => { onSave(draft.length ? draft : undefined); onClose(); }}
      saveLabel={t('common:buttons.save')}
    >
      <Stack spacing={1}>
        {draft.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>{t('pages.settings.trusts.empty')}</Typography>
        )}
        {draft.map((trust, index) => (
          <Box key={trust.domain} sx={{ display: 'grid', gridTemplateColumns: '1fr 180px 32px', gap: 1, alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13 }}>{labelOf(trust.domain)}</Typography>
            <Select
              variant="standard"
              value={trust.direction}
              onChange={(event) => update(index, { direction: event.target.value as DomainTrustDirection })}
              MenuProps={compactSelectMenuProps}
              SelectDisplayProps={{ 'aria-label': `${t('pages.settings.trusts.direction')} ${labelOf(trust.domain)}` } as React.HTMLAttributes<HTMLDivElement>}
            >
              {TRUST_DIRECTIONS.map((direction) => (
                <MenuItem key={direction} value={direction}>{t(`pages.settings.trusts.directions.${direction}`)}</MenuItem>
              ))}
            </Select>
            <IconButton size="small" aria-label={`${t('common:enumEditor.remove')} ${labelOf(trust.domain)}`} onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        ))}
        {free.length > 0 && (
          <Select
            variant="standard"
            value=""
            displayEmpty
            onChange={(event) => setDraft((prev) => [...prev, { domain: String(event.target.value), direction: 'two_way' }])}
            MenuProps={compactSelectMenuProps}
            SelectDisplayProps={{ 'aria-label': t('pages.settings.trusts.add') } as React.HTMLAttributes<HTMLDivElement>}
            renderValue={() => <Typography component="span" sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>{t('pages.settings.trusts.add')}</Typography>}
          >
            {free.map((item) => <MenuItem key={item.code} value={item.code}>{item.label}</MenuItem>)}
          </Select>
        )}
        {free.length === 0 && draft.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>{t('pages.settings.trusts.noOtherDomain')}</Typography>
        )}
      </Stack>
    </KanapDialog>
  );
}
