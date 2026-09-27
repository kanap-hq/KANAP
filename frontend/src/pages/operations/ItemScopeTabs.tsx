import React from 'react';
import { Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetScope } from '../../services/budgetOperations';

/** The item type a column operation page opens on: OPEX when the user can read it, else CAPEX. */
export function useDefaultBudgetScope(): BudgetScope {
  const { hasLevel } = useAuth();
  return hasLevel('opex', 'reader') || !hasLevel('capex', 'reader') ? 'opex' : 'capex';
}

/** OPEX / CAPEX switch of the column operations pages; a type the user cannot read is disabled. */
export default function ItemScopeTabs({ value, onChange }: { value: BudgetScope; onChange: (next: BudgetScope) => void }) {
  const { t } = useTranslation(['ops']);
  const { hasLevel } = useAuth();
  return (
    <Tabs
      value={value}
      onChange={(_, next: BudgetScope) => onChange(next)}
      aria-label={t('operations.scope.label')}
      sx={[textTabsSx, { alignSelf: 'center' }]}
    >
      <Tab value="opex" label={t('operations.scope.opex')} sx={textTabSx(value === 'opex')} disabled={!hasLevel('opex', 'reader')} />
      <Tab value="capex" label={t('operations.scope.capex')} sx={textTabSx(value === 'capex')} disabled={!hasLevel('capex', 'reader')} />
    </Tabs>
  );
}
