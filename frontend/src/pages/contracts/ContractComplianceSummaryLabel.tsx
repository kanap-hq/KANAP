import { Box, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { StatusDot } from '../../components/design';
import { CONTRACT_COMPLIANCE_SUMMARY_COLORS, getDotColor } from '../../utils/statusColors';
import type { ComplianceSummary } from './contractCompliance';

const labelSx = { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap' } as const;

/**
 * A contract's compliance summary in the list: the missing requirements in orange (and those to
 * check), "To check", "Complete", or "No expectation" in tertiary.
 */
export default function ContractComplianceSummaryLabel({ summary }: { summary: ComplianceSummary | null | undefined }) {
  const { t } = useTranslation('ops');
  const theme = useTheme();
  if (!summary) return null;
  if (summary.state === 'none') {
    return <Box component="span" sx={{ fontSize: '0.8125rem', color: 'kanap.text.tertiary' }}>{t('contracts.compliance.summary.none')}</Box>;
  }
  const color = getDotColor(CONTRACT_COMPLIANCE_SUMMARY_COLORS[summary.state], theme.palette.mode);
  const text = summary.state === 'missing'
    ? t('contracts.compliance.summary.missing', { count: summary.missing })
    : summary.state === 'to_check'
      ? t('contracts.compliance.summary.toCheck', { count: summary.to_check })
      : t('contracts.compliance.summary.complete');
  return (
    <Box component="span" sx={[labelSx, { color }]}>
      <StatusDot color={color} />
      {text}
      {summary.state === 'missing' && summary.to_check > 0 && (
        <Box component="span" sx={{ color: 'kanap.text.tertiary', fontWeight: 400 }}>
          {` · ${t('contracts.compliance.summary.toCheck', { count: summary.to_check })}`}
        </Box>
      )}
    </Box>
  );
}
