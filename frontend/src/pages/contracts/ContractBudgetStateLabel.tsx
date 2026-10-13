import { Box, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { StatusDot } from '../../components/design';
import { CONTRACT_BUDGET_STATE_COLORS, getDotColor } from '../../utils/statusColors';
import type { ContractBudgetState } from './contractBudget';

/** A contract's budget coverage state: dot and text, colors from `utils/statusColors.ts`. */
export default function ContractBudgetStateLabel({ state }: { state: ContractBudgetState | null | undefined }) {
  const { t } = useTranslation('ops');
  const theme = useTheme();
  if (!state) return null;
  const color = getDotColor(CONTRACT_BUDGET_STATE_COLORS[state], theme.palette.mode);
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 500, color, lineHeight: 1 }}>
      <StatusDot color={color} />
      {t(`contracts.budget.states.${state}`)}
    </Box>
  );
}
