import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TokenUsage } from '../aiTypes';
import { formatNumber } from '../../i18n/formatters';

type TokenUsageBarProps = {
  usage: TokenUsage;
  lastRequestUsage?: TokenUsage | null;
};

function formatTokenCount(value: number, locale: string): string {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized)) {
    return '0';
  }
  if (Math.abs(normalized) < 1000) {
    return formatNumber(Math.round(normalized), locale);
  }
  try {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(normalized);
  } catch {
    const abs = Math.abs(normalized);
    if (abs >= 1_000_000) return `${Math.round(normalized / 100_000) / 10}M`;
    if (abs >= 1_000) return `${Math.round(normalized / 100) / 10}k`;
    return String(Math.round(normalized));
  }
}

export default function TokenUsageBar({ usage, lastRequestUsage }: TokenUsageBarProps) {
  const { t, i18n } = useTranslation(['ai']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const totalTokens = usage.input_tokens + usage.output_tokens;

  return (
    <Box
      data-testid="token-usage-bar"
      sx={{
        px: 2,
        py: 0.75,
        bgcolor: 'action.hover',
      }}
    >
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
        <Typography variant="caption" color="text.secondary">
          {t('tokenUsage.total')}{' '}<Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{formatTokenCount(totalTokens, locale)}</Box>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('tokenUsage.input')}{' '}<Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{formatTokenCount(usage.input_tokens, locale)}</Box>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('tokenUsage.output')}{' '}<Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{formatTokenCount(usage.output_tokens, locale)}</Box>
        </Typography>
        {lastRequestUsage && (
          <Typography variant="caption" color="text.secondary">
            {t('tokenUsage.lastInput')}{' '}<Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{formatTokenCount(lastRequestUsage.input_tokens, locale)}</Box>
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
