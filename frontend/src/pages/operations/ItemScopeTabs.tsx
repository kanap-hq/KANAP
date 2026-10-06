import React from 'react';
import { Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetScope } from '../../services/budgetOperations';

type ScopeLevel = 'reader' | 'admin';

/** The item type a page opens on: OPEX when the user has `level` on it, else CAPEX. */
export function useDefaultBudgetScope(level: ScopeLevel = 'reader'): BudgetScope {
  const { hasLevel } = useAuth();
  return hasLevel('opex', level) || !hasLevel('capex', level) ? 'opex' : 'capex';
}

/**
 * OPEX / CAPEX switch; a type the user lacks `level` on is disabled. Reports read
 * (`reader`), the column operations act and pass `admin`.
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
      <Tab value="opex" label={t('operations.scope.opex')} sx={textTabSx(value === 'opex')} disabled={!hasLevel('opex', level)} />
      <Tab value="capex" label={t('operations.scope.capex')} sx={textTabSx(value === 'capex')} disabled={!hasLevel('capex', level)} />
    </Tabs>
  );
}
