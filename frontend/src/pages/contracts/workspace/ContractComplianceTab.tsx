import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, MenuItem, Select, Stack, TextField, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { StatusDot } from '../../../components/design';
import { denseTableFrameSx, denseTableSx } from '../../../components/EntityTasksSection';
import RelationsSectionTitle from '../../portfolio/components/RelationsSectionTitle';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { CONTRACT_COMPLIANCE_STATE_COLORS, getDotColor } from '../../../utils/statusColors';
import { toCatalogLocale } from '../../../utils/catalogLocalization';
import { formatShortDate } from '../../../lib/dateFormat';
import { useLocale } from '../../../i18n/useLocale';
import { compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, inlineControlSx, tableCellTextFieldSx } from '../../../theme/formSx';
import {
  COMPLIANCE_REFERENCE_MAX,
  COMPLIANCE_STATES,
  complianceReasonText,
  contractComplianceKey,
  type ComplianceRequirementView,
  type ComplianceState,
  type ContractCompliance,
} from '../contractCompliance';

/** The compliance register of a contract: read by the page for its tab badge, shared with the tab. */
export function useContractCompliance(contractId: string) {
  return useQuery({
    queryKey: contractComplianceKey(contractId),
    queryFn: async () => (await api.get<ContractCompliance>(`/contracts/${contractId}/compliance`)).data,
  });
}

const tertiarySx = { color: 'kanap.text.tertiary' } as const;
const stateLabelSx = { display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } as const;
const linkButtonSx = { p: 0, minWidth: 0, fontSize: 12, alignSelf: 'flex-start' } as const;

type Props = { contractId: string; readOnly: boolean };

/**
 * The Compliance tab: the requirements the contract is expected to hold, why, and what was recorded
 * (state saved on change, reference on blur). The other requirements stay one click away and can
 * be recorded too. The screen helps keep a register; it makes no claim about compliance.
 */
export default function ContractComplianceTab({ contractId, readOnly }: Props) {
  const { t, i18n } = useTranslation(['ops', 'common']);
  const queryClient = useQueryClient();
  const query = useContractCompliance(contractId);
  const [showOthers, setShowOthers] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const catalogLocale = toCatalogLocale(i18n.resolvedLanguage || i18n.language);

  const save = React.useCallback(async (requirement: string, patch: { state?: ComplianceState | null; reference?: string | null }) => {
    setError(null);
    try {
      const res = await api.patch<ContractCompliance>(`/contracts/${contractId}/compliance/${requirement}`, patch);
      queryClient.setQueryData(contractComplianceKey(contractId), res.data);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('contracts.compliance.saveFailed')));
      void queryClient.invalidateQueries({ queryKey: contractComplianceKey(contractId) });
    }
  }, [contractId, queryClient, t]);

  if (query.isError) return <Alert severity="error" sx={{ mt: 1 }}>{t('contracts.compliance.loadFailed')}</Alert>;
  const data = query.data;
  if (!data) return null;

  const expected = data.requirements.filter((item) => item.expected);
  const others = data.requirements.filter((item) => !item.expected);
  const rows = showOthers ? [...expected, ...others] : expected;
  const missing = data.summary.missing;

  return (
    <Stack spacing={1.25} sx={{ pt: 1, maxWidth: 1040 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
        <RelationsSectionTitle>{t('contracts.compliance.title')}</RelationsSectionTitle>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
          {missing > 0 && (
            <>
              <Box component="span" sx={{ color: 'kanap.orange' }}>{t('contracts.compliance.summary.missing', { count: missing })}</Box>
              {' · '}
            </>
          )}
          {t('contracts.compliance.subtitle')}
        </Typography>
      </Box>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {expected.length === 0 && !showOthers ? (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('contracts.compliance.noneExpected')}</Typography>
      ) : (
        <Box sx={denseTableFrameSx}>
          <Box component="table" sx={[denseTableSx, { '& td': { verticalAlign: 'middle' } }]}>
            <thead>
              <tr>
                <th>{t('contracts.compliance.columns.requirement')}</th>
                <th>{t('contracts.compliance.columns.reason')}</th>
                <th>{t('contracts.compliance.columns.state')}</th>
                <th>{t('contracts.compliance.columns.reference')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <RequirementRow
                  key={item.requirement}
                  item={item}
                  readOnly={readOnly}
                  reasons={item.reasons.map((reason) => complianceReasonText(t, reason, catalogLocale))}
                  onSave={(patch) => save(item.requirement, patch)}
                />
              ))}
            </tbody>
          </Box>
        </Box>
      )}
      <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('contracts.compliance.hint')}</Typography>
      {others.length > 0 && (
        <Button sx={linkButtonSx} onClick={() => setShowOthers((value) => !value)}>
          {showOthers ? t('contracts.compliance.hideOthers') : t('contracts.compliance.showOthers', { count: others.length })}
        </Button>
      )}
    </Stack>
  );
}

function RequirementRow({ item, reasons, readOnly, onSave }: {
  item: ComplianceRequirementView;
  reasons: string[];
  readOnly: boolean;
  onSave: (patch: { state?: ComplianceState | null; reference?: string | null }) => Promise<void>;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const theme = useTheme();
  const locale = useLocale();
  const [reference, setReference] = React.useState(item.reference ?? '');
  // The stored reference replaces the draft once saved or reloaded.
  React.useEffect(() => { setReference(item.reference ?? ''); }, [item.reference]);

  const label = t(`contracts.compliance.requirements.${item.requirement}`);
  const stateKey = item.state ?? (item.expected ? 'to_check' : null);
  const stateText = (value: ComplianceState | '') => (value
    ? t(`contracts.compliance.states.${value}`)
    : item.expected ? t('contracts.compliance.states.to_check') : t('contracts.compliance.states.unset'));
  const dot = stateKey ? getDotColor(CONTRACT_COMPLIANCE_STATE_COLORS[stateKey], theme.palette.mode) : null;
  const updated = item.updated_at
    ? (item.updated_by?.name
      ? t('contracts.compliance.updatedBy', { date: formatShortDate(item.updated_at, locale, { year: 'always' }), name: item.updated_by.name })
      : t('contracts.compliance.updatedOn', { date: formatShortDate(item.updated_at, locale, { year: 'always' }) }))
    : undefined;

  const commitReference = () => {
    const next = reference.trim();
    if (next === (item.reference ?? '')) return;
    void onSave({ reference: next || null });
  };

  return (
    <tr title={updated}>
      <Box component="td" sx={{ whiteSpace: 'normal !important', minWidth: 200 }}>{label}</Box>
      <Box component="td" sx={{ whiteSpace: 'normal !important', minWidth: 220, color: 'kanap.text.secondary !important' }}>
        {reasons.length === 0
          ? <Box component="span" sx={tertiarySx}>{t('contracts.compliance.notExpected')}</Box>
          : (
            <Box component="span" title={reasons.length > 1 ? reasons.join('\n') : undefined}>
              {reasons[0]}
              {reasons.length > 1 && (
                <Box component="span" sx={tertiarySx}>{` · ${t('contracts.compliance.moreReasons', { count: reasons.length - 1 })}`}</Box>
              )}
            </Box>
          )}
      </Box>
      <Box component="td" sx={{ minWidth: 150 }}>
        <Box sx={stateLabelSx}>
          {dot ? <StatusDot color={dot} /> : <Box component="span" sx={{ width: 6, flexShrink: 0 }} />}
          {readOnly ? (
            <Box component="span" sx={item.state ? undefined : tertiarySx}>{stateText(item.state ?? '')}</Box>
          ) : (
            <Select
              variant="standard"
              value={item.state ?? ''}
              displayEmpty
              onChange={(event) => { void onSave({ state: (event.target.value as ComplianceState | '') || null }); }}
              renderValue={(value) => (
                <Box component="span" sx={value ? undefined : tertiarySx}>{stateText(value as ComplianceState | '')}</Box>
              )}
              sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 110 }]}
              MenuProps={compactSelectMenuProps}
              inputProps={{ 'aria-label': t('contracts.compliance.stateOf', { requirement: label }) }}
            >
              <MenuItem value="" sx={drawerMenuItemSx}>{stateText('')}</MenuItem>
              {COMPLIANCE_STATES.map((state) => (
                <MenuItem key={state} value={state} sx={drawerMenuItemSx}>{t(`contracts.compliance.states.${state}`)}</MenuItem>
              ))}
            </Select>
          )}
        </Box>
      </Box>
      <Box component="td" sx={{ whiteSpace: 'normal !important', minWidth: 200 }}>
        {readOnly ? (
          item.reference ? item.reference : null
        ) : (
          <TextField
            variant="standard"
            fullWidth
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            onBlur={commitReference}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
            placeholder={t('contracts.compliance.referencePlaceholder')}
            sx={tableCellTextFieldSx}
            inputProps={{ maxLength: COMPLIANCE_REFERENCE_MAX, 'aria-label': t('contracts.compliance.referenceOf', { requirement: label }) }}
          />
        )}
      </Box>
    </tr>
  );
}
