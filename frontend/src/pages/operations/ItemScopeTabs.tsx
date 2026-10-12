import React from 'react';
import { Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetScope, BudgetOperationScope } from '../../services/budgetOperations';

type ScopeLevel = 'reader' | 'admin';

/** The item type a page opens on: OPEX (one right covers both types, lot R). */
export function useDefaultBudgetScope(): BudgetOperationScope {
  return 'opex';
}

/**
 * Budget scope switch; All is opt-in for reports. Every tab needs `level` on budget lines.
 * Reports read (`reader`); column operations pass `admin` and keep the two nature tabs.
 */
export default function ItemScopeTabs<T extends BudgetScope>({ value, onChange, level = 'reader', allowAll = false }: {
  value: T;
  onChange: (next: T) => void;
  level?: ScopeLevel;
  allowAll?: boolean;
}) {
  const { t } = useTranslation(['ops']);
  const { hasLevel } = useAuth();
  return (
    <Tabs
      value={value}
      onChange={(_, next: T) => onChange(next)}
      aria-label={t('operations.scope.label')}
      sx={[textTabsSx, { alignSelf: 'center' }]}
    >
      {allowAll && <Tab value="all" label={t('operations.scope.all')} sx={textTabSx(value === 'all')} disabled={!hasLevel('budget', level)} />}
      <Tab value="opex" label={t('operations.scope.opex')} sx={textTabSx(value === 'opex')} disabled={!hasLevel('budget', level)} />
      <Tab value="capex" label={t('operations.scope.capex')} sx={textTabSx(value === 'capex')} disabled={!hasLevel('budget', level)} />
    </Tabs>
  );
}
