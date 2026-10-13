import React from 'react';
import { Box, Tooltip } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslation } from 'react-i18next';
import { useFreezeState } from '../../hooks/useFreezeState';
import { amountColumnYear, parseAmountField, parseFteField } from '../../components/finance/amountColumns';

/** Mounted footer cells share the year's query with the workspace. */
export default function BudgetTotalCell({ colId, nature, children }: {
  colId: string; nature?: 'opex' | 'capex'; children: React.ReactNode;
}) {
  const { t } = useTranslation('ops');
  const year = amountColumnYear(colId, new Date().getFullYear())!;
  const { data } = useFreezeState(year);
  const column = (parseAmountField(colId) ?? parseFteField(colId))!.column.freezeKey;
  const scopes = data?.summary.scopes;
  const frozen = nature ? scopes?.[nature]?.[column]?.frozen
    : scopes?.opex?.[column]?.frozen && scopes?.capex?.[column]?.frozen;
  return <Box component="span" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, minWidth: 0 }}>
    {frozen && <Tooltip title={t('operations.freeze.frozen')}>
      <LockOutlinedIcon aria-label={t('operations.freeze.frozen')} sx={{ fontSize: 14, flexShrink: 0, color: 'kanap.text.secondary' }} />
    </Tooltip>}
    {children}
  </Box>;
}
