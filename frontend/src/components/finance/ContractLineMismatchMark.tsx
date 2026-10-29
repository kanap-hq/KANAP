import { Box, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { attentionDotSx } from '../../theme/formSx';

/** One field where a budget line and a contract differ. Labels are already resolved by the API. */
export type ContractLineMismatch = {
  field: 'paying_company' | 'cost_center' | 'supplier' | 'currency';
  line_value: string | null;
  contract_value: string | null;
};

/**
 * The orange mark on a linked row, or on a picker candidate, when the line and the contract
 * disagree. The tooltip names each difference with both values. Nothing is stored: the API
 * computes the list when it reads the link.
 */
export default function ContractLineMismatchMark({ mismatches }: { mismatches: ContractLineMismatch[] }) {
  const { t } = useTranslation('ops');
  if (mismatches.length === 0) return null;
  const text = mismatches.map((row) => t('contracts.budget.mismatch.line', {
    field: t(`contracts.budget.mismatch.fields.${row.field}`),
    line: row.line_value ?? t('contracts.budget.mismatch.notSet'),
    contract: row.contract_value ?? t('contracts.budget.mismatch.notSet'),
  })).join('\n');
  return (
    <Tooltip title={text} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
      <Box
        component="span"
        role="img"
        aria-label={text}
        data-testid="contract-line-mismatch"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        sx={{ ...attentionDotSx, ml: '6px', position: 'relative', top: '-1px' }}
      />
    </Tooltip>
  );
}
