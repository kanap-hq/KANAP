import React, { forwardRef } from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';
import EditConflictBanner from '../workspace/EditConflictBanner';
import YearTabs from '../navigation/YearTabs';
import BudgetTrendChart from './BudgetTrendChart';
import ColumnCards from './budgetTab/ColumnCards';
import ColumnEditor from './budgetTab/ColumnEditor';
import MonthlyResult from './budgetTab/MonthlyResult';
import { useBudgetTab, type AmountCol, type BudgetTabHandle, type BudgetTabProps } from './budgetTab/useBudgetTab';

export type { BudgetTabHandle } from './budgetTab/useBudgetTab';
export { budgetYearKey } from './budgetTab/useBudgetTab';

/**
 * The Budget tab of a budget line (plan planning/budget-tab-redesign, lot F1): for the year
 * chosen, pick a column (its card), say how it is built (an amount, quantity and price, or by
 * month), then read the result month by month. State and writes live in `useBudgetTab`.
 */
export default forwardRef<BudgetTabHandle, BudgetTabProps>(function BudgetTab(props, ref) {
  const tab = useBudgetTab(props, ref);
  const { t, year, error, setError, shown, labelFor, bannerConflicts, onConflictChoice, resolving, userId, savingHint, loading, loaded, liveTotals, anyFrozen } = tab;
  const { id, currency, availableYears, config } = props;

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Columns someone else changed while the user was editing them: reload or overwrite, per column. */}
      <EditConflictBanner
        wording="column"
        conflicts={bannerConflicts}
        fieldLabel={(field) => labelFor(field as AmountCol)}
        onResolve={onConflictChoice}
        busy={resolving}
        currentUserId={userId}
        sx={{ mx: 0, mt: 0 }}
      />

      {/* Saving hint is absolutely positioned so it never reflows the year selector (F2 adds the reset action on this row). */}
      <Box sx={{ position: 'relative' }}>
        <YearTabs currentYear={year} availableYears={availableYears} onYearChange={(y) => void tab.handleYearChange(y)} disabled={loading} />
        {savingHint && (
          <Typography sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'kanap.text.tertiary', pointerEvents: 'none' }}>
            {savingHint}
          </Typography>
        )}
      </Box>

      {/* One column: no cards, the editor shows it directly. */}
      {shown.length > 1 && <ColumnCards tab={tab} />}

      <ColumnEditor
        tab={tab}
        i18nPrefix={config.i18nPrefix}
        effectiveStart={props.effectiveStart}
        endOfValidity={props.endOfValidity}
        payingCompanyCountry={props.payingCompanyCountry}
        single={shown.length === 1}
      />

      <MonthlyResult tab={tab} i18nPrefix={config.i18nPrefix} currency={currency} />

      <BudgetTrendChart
        id={id}
        year={year}
        liveTotals={loaded && !loading ? liveTotals : undefined}
        currency={currency}
        config={config}
      />

      {anyFrozen && (
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t(`${config.i18nPrefix}.budget.someColumnsFrozen`)}</Typography>
      )}
    </Stack>
  );
});
