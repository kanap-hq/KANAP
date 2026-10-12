import React from 'react';
import { Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetScope } from '../../services/budgetOperations';
import type { ReportScope } from '../reports/reportAggregates';

type ScopeLevel = 'reader' | 'admin';

/** The item type a page opens on: OPEX (one right covers both types, lot R). */
export function useDefaultBudgetScope(): BudgetScope {
  return 'opex';
}

/**
 * OPEX / CAPEX switch, optionally including All; every scope is disabled without `level` on the budget lines. Reports
 * read (`reader`), the column operations act and pass `admin`.
 */
type Props = { level?: ScopeLevel } & (
  { allowAll: true; value: ReportScope; onChange: (next: ReportScope) => void }
  | { allowAll?: false; value: BudgetScope; onChange: (next: BudgetScope) => void }
);

export default function ItemScopeTabs(props: Props) {
  const { value, level = 'reader', allowAll = false } = props;
  const { t } = useTranslation(['ops']);
  const { hasLevel } = useAuth();
  return (
    <Tabs
      value={value}
      onChange={(_, next: ReportScope) => {
        if (props.allowAll) props.onChange(next);
        else if (next !== 'all') props.onChange(next);
      }}
      aria-label={t('operations.scope.label')}
      sx={[textTabsSx, { alignSelf: 'center' }]}
    >
      {allowAll && <Tab value="all" label={t('operations.scope.all')} sx={textTabSx(value === 'all')} disabled={!hasLevel('budget', level)} />}
      <Tab value="opex" label={t('operations.scope.opex')} sx={textTabSx(value === 'opex')} disabled={!hasLevel('budget', level)} />
      <Tab value="capex" label={t('operations.scope.capex')} sx={textTabSx(value === 'capex')} disabled={!hasLevel('budget', level)} />
    </Tabs>
  );
}
