import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Link, MenuItem, Select, Typography } from '@mui/material';
import api from '../../api';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { STATUS_DISABLED, deriveStatusFromDisabledAt } from '../../constants/status';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import type { CoaListItem } from '../coa/useCoaList';

export type ConsolidationStatus = 'mapped' | 'outside' | 'unmapped';

export type ConsolidationOption = {
  id: string;
  account_number: number;
  account_name: string;
  description: string | null;
  disabled_at: string | null;
};

const PAGE_SIZE = 1000;
const NONE = '';

/**
 * Every account of the consolidation chart, disabled ones included, sorted by number. The list
 * endpoint pages at 1000 rows, so a larger chart is read page after page. The key sits under
 * `accounts`, so any account write refreshes it.
 */
export function useConsolidationOptions(chartId: string | null | undefined) {
  return useQuery({
    queryKey: ['accounts', 'consolidation-options', chartId ?? ''],
    enabled: !!chartId,
    staleTime: 30_000,
    queryFn: async () => {
      const rows: ConsolidationOption[] = [];
      for (let page = 1; ; page += 1) {
        const res = await api.get<{ items?: ConsolidationOption[]; total?: number }>('/accounts', {
          params: { coaId: chartId, includeDisabled: 1, sort: 'account_number:ASC', page, limit: PAGE_SIZE },
        });
        const batch = res.data?.items ?? [];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE || rows.length >= (res.data?.total ?? 0)) break;
      }
      return rows
        .map((row) => ({ ...row, account_number: Number(row.account_number) }))
        .sort((a, b) => a.account_number - b.account_number);
    },
  });
}

function isDisabled(option: ConsolidationOption) {
  return deriveStatusFromDisabledAt(option.disabled_at) === STATUS_DISABLED;
}

const attentionDotSx = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  bgcolor: 'kanap.orange',
  flexShrink: 0,
} as const;

const noteSx = { fontSize: 12, lineHeight: 1.45, mt: '6px' } as const;

function AccountLabel({
  number,
  name,
  marker,
  suffix,
}: {
  number: number;
  name: string | null;
  marker?: string;
  suffix?: string;
}) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0, maxWidth: '100%' }}>
      {marker && <Box component="span" role="img" aria-label={marker} sx={attentionDotSx} />}
      <Box
        component="span"
        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        <Box
          component="span"
          sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'kanap.text.secondary' }}
        >
          {number}
        </Box>
        {name ? ` · ${name}` : ''}
      </Box>
      {suffix && (
        <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>
          {suffix}
        </Box>
      )}
    </Box>
  );
}

type Props = {
  /** The stored consolidation number. */
  value: number | null;
  /** The stored consolidation name and description (derived by the server). */
  storedName: string | null;
  storedDescription: string | null;
  /** What the server said of the stored number, used until the chart's accounts are loaded. */
  serverStatus?: ConsolidationStatus;
  /** The tenant's consolidation chart; undefined when it has none. */
  chart: CoaListItem | undefined;
  /** False while the charts are loading: the "no consolidation chart" line waits for them. */
  chartsLoaded: boolean;
  disabled: boolean;
  error?: string;
  label: string;
  onChange: (next: number | null) => void;
};

/**
 * The consolidation account of an account: one choice among the accounts of the consolidation
 * chart. Only the number is sent; the server derives the name and description from it. A number
 * missing from the consolidation chart stays visible as its own option, flagged, with a line
 * that says what to do.
 */
export default function ConsolidationAccountField({
  value,
  storedName,
  storedDescription,
  serverStatus,
  chart,
  chartsLoaded,
  disabled,
  error,
  label,
  onChange,
}: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const { data: options } = useConsolidationOptions(chart?.id);
  const noChart = chartsLoaded && !chart;

  const current = value != null ? options?.find((option) => option.account_number === value) : undefined;
  let status: ConsolidationStatus | undefined = serverStatus;
  if (value == null) status = 'unmapped';
  else if (chart && options) status = current ? 'mapped' : 'outside';
  const outside = !!chart && value != null && status === 'outside';

  // Disabled accounts of the consolidation chart are offered only when already chosen.
  const visible = React.useMemo(
    () => (options ?? []).filter((option) => !isDisabled(option) || option.account_number === value),
    [options, value],
  );
  const marker = outside && chart ? t('coa.outsideMarker', { code: chart.code }) : undefined;
  const disabledSuffix = t('accounts.consolidation.disabled');

  const renderLabel = (number: number) => {
    const option = options?.find((item) => item.account_number === number);
    if (option) {
      return (
        <AccountLabel
          number={option.account_number}
          name={option.account_name}
          suffix={isDisabled(option) ? disabledSuffix : undefined}
        />
      );
    }
    return <AccountLabel number={number} name={storedName} marker={marker} />;
  };

  const description = current ? current.description : storedDescription;

  return (
    <Box>
      <Select
        variant="standard"
        value={value == null ? NONE : String(value)}
        onChange={(event) => {
          const raw = String(event.target.value);
          const next = raw === NONE ? null : Number(raw);
          if (next !== value) onChange(next);
        }}
        displayEmpty
        disabled={disabled || noChart}
        error={!!error}
        sx={drawerSelectSx}
        MenuProps={{ slotProps: { paper: { style: { maxHeight: 360 } } } }}
        SelectDisplayProps={{ 'aria-label': label } as React.HTMLAttributes<HTMLDivElement>}
        renderValue={(selected) => (
          selected === NONE
            ? <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('accounts.consolidation.none')}</Box>
            : renderLabel(Number(selected))
        )}
      >
        <MenuItem value={NONE} sx={drawerMenuItemSx}>
          <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('accounts.consolidation.none')}</Box>
        </MenuItem>
        {/* The stored number, when the chart's accounts do not hold it (or are not loaded yet). */}
        {value != null && !current && (
          <MenuItem value={String(value)} sx={drawerMenuItemSx}>
            <AccountLabel number={value} name={storedName} marker={marker} />
          </MenuItem>
        )}
        {visible.map((option) => (
          <MenuItem key={option.id} value={String(option.account_number)} sx={drawerMenuItemSx}>
            <AccountLabel
              number={option.account_number}
              name={option.account_name}
              suffix={isDisabled(option) ? disabledSuffix : undefined}
            />
          </MenuItem>
        ))}
      </Select>
      {error && (
        <Typography role="alert" sx={{ ...noteSx, color: 'error.main' }}>{error}</Typography>
      )}
      {value != null && description && (
        <Typography data-testid="consolidation-description" sx={{ ...noteSx, color: 'kanap.text.tertiary' }}>
          {description}
        </Typography>
      )}
      {outside && chart && (
        <Box sx={{ ...noteSx, display: 'flex', alignItems: 'baseline', gap: '8px', color: 'kanap.text.secondary' }}>
          <Box component="span" sx={{ ...attentionDotSx, position: 'relative', top: '-1px' }} />
          <span>{t('accounts.consolidation.outside', { code: chart.code })}</span>
        </Box>
      )}
      {noChart && (
        <Typography sx={{ ...noteSx, color: 'kanap.text.secondary' }}>
          {t('accounts.consolidation.noChart')}{' '}
          <Link component={RouterLink} to="/master-data/coa" sx={{ fontSize: 12 }}>
            {t('accounts.consolidation.noChartLink')}
          </Link>
        </Typography>
      )}
    </Box>
  );
}
