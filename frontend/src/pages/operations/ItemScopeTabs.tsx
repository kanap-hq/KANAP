import React from 'react';
import { Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetScope } from '../../services/budgetOperations';

type ScopeLevel = 'reader' | 'admin';

/** The item type a page opens on: OPEX (one right covers both types, lot R). */
export function useDefaultBudgetScope(): BudgetScope {
  return 'opex';
}

/**
 * OPEX / CAPEX switch; both types are disabled without `level` on the budget lines. Reports
 * read (`reader`), the column operations act and pass `admin`.
 */
export default function ItemScopeTabs({ value, onChange, level = 'reader' }: {
  value: BudgetScope;
  onChange: (next: BudgetScope) => void;
  level?: ScopeLevel;
}) {
  const { t } = useTranslation(['ops']);
  const { hasLevel } = useAuth();
  return (
    <Tabs
      value={value}
      onChange={(_, next: BudgetScope) => onChange(next)}
      aria-label={t('operations.scope.label')}
      sx={[textTabsSx, { alignSelf: 'center' }]}
    >
      <Tab value="opex" label={t('operations.scope.opex')} sx={textTabSx(value === 'opex')} disabled={!hasLevel('budget', level)} />
      <Tab value="capex" label={t('operations.scope.capex')} sx={textTabSx(value === 'capex')} disabled={!hasLevel('budget', level)} />
    </Tabs>
  );
}
