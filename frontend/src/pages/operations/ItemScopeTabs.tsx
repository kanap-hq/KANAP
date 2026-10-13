import React from 'react';
import { Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetOperationScope, BudgetScope } from '../../services/budgetOperations';

type ScopeLevel = 'reader' | 'admin';

/** The natures a scope covers, in display order. */
export const SCOPE_NATURES: Record<BudgetScope, BudgetOperationScope[]> = { all: ['opex', 'capex'], opex: ['opex'], capex: ['capex'] };

/**
 * Budget scope switch: All (opt-in, `allowAll`), OPEX, CAPEX. Every tab needs `level` on budget lines.
 * Reports read (`reader`); the budget operations pass `admin` and open on All.
 */
export default function ItemScopeTabs<T extends BudgetScope>({ value, onChange, level = 'reader', allowAll = false, disabled = false }: {
  value: T;
  onChange: (next: T) => void;
  level?: ScopeLevel;
  allowAll?: boolean;
  /** Every tab off, e.g. while an operation runs on the chosen lines. */
  disabled?: boolean;
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
      {allowAll && <Tab value="all" label={t('operations.scope.all')} sx={textTabSx(value === 'all')} disabled={disabled || !hasLevel('budget', level)} />}
      <Tab value="opex" label={t('operations.scope.opex')} sx={textTabSx(value === 'opex')} disabled={disabled || !hasLevel('budget', level)} />
      <Tab value="capex" label={t('operations.scope.capex')} sx={textTabSx(value === 'capex')} disabled={disabled || !hasLevel('budget', level)} />
    </Tabs>
  );
}
