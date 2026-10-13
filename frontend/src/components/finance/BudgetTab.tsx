import React, { forwardRef } from 'react';
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';
import EditConflictBanner, { formatTime } from '../workspace/EditConflictBanner';
import YearTabs from '../navigation/YearTabs';
import BudgetTrendChart from './BudgetTrendChart';
import ColumnCards from './budgetTab/ColumnCards';
import { namesInSentence } from './heldChoices';
import ColumnEditor from './budgetTab/ColumnEditor';
import MonthlyResult from './budgetTab/MonthlyResult';
import { useBudgetTab, type AmountCol, type BudgetTabHandle, type BudgetTabProps, type BudgetTabState } from './budgetTab/useBudgetTab';

export type { BudgetTabHandle } from './budgetTab/useBudgetTab';
export { budgetYearKey } from './budgetTab/useBudgetTab';

/** What « Back to the opening values » did: the columns restored, then each column left as it is and why. */
function RestoreNoticeBox({ tab }: { tab: BudgetTabState }) {
  const { t, locale, labelFor, restoreNotice: notice, closeRestoreNotice } = tab;
  if (!notice) return null;
  const columns = (cols: AmountCol[]) => namesInSentence(locale, cols.map(labelFor));
  const reason = (item: NonNullable<BudgetTabState['restoreNotice']>['skipped'][number]) => {
    const column = labelFor(item.col);
    if (item.reason === 'refused') return t('budgetTab.restore.refused', { column, message: item.message });
    if (item.reason === 'others') {
      const when = item.at ? new Date(item.at) : null;
      return when && !Number.isNaN(when.getTime())
        ? t('budgetTab.restore.othersAt', { column, time: formatTime(when, locale) })
        : t('budgetTab.restore.others', { column });
    }
    if (item.reason !== 'changed') return t(`budgetTab.restore.${item.reason}`, { column });
    // Someone else changed it since the screen read it: the banner above asks what to keep.
    const name = item.conflict?.changed_by ? item.conflict.changed_by.name || t('common:editConflict.aUser') : null;
    const at = item.conflict?.changed_at ? new Date(item.conflict.changed_at) : null;
    const time = at && !Number.isNaN(at.getTime()) ? formatTime(at, locale) : '';
    if (name && time) return t('budgetTab.restore.changedByAt', { column, name, time });
    if (name) return t('budgetTab.restore.changedBy', { column, name });
    return t('budgetTab.restore.changed', { column });
  };
  return (
    <Box
      role="status"
      data-testid="restore-notice"
      sx={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5,
        border: '1px solid', borderColor: 'kanap.border.default', borderRadius: '6px', bgcolor: 'kanap.bg.primary', px: 1.5, py: 1,
      }}
    >
      <Box sx={{ minWidth: 0, fontSize: 12, color: 'kanap.text.secondary' }}>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.primary' }}>
          {notice.notRun ? t('budgetTab.restore.notRun')
            : notice.restored.length > 0 ? t('budgetTab.restore.done', { columns: columns(notice.restored) }) : t('budgetTab.restore.none')}
        </Typography>
        {notice.skipped.length > 0 && (
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.25 }}>
            {notice.skipped.map((item) => (
              <Typography component="li" key={item.col} sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{reason(item)}</Typography>
            ))}
          </Box>
        )}
      </Box>
      <Link component="button" type="button" onClick={closeRestoreNotice} sx={{ fontSize: 12, flex: 'none' }}>{t('common:buttons.close')}</Link>
    </Box>
  );
}

/**
 * The Budget tab of a budget line (plan planning/budget-tab-redesign, lot F1): for the year
 * chosen, pick a column (its card), say how it is built (an amount, quantity and price, or by
 * month), then read the result month by month. Lot F2 adds « At a date », « Start from », the
 * way back to the opening values, the difference with a column and the folded table. State and
 * writes live in `useBudgetTab`.
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

      {/* The years in the middle; on their right the saving hint and, once a column changed, the way back. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto minmax(0, 1fr)' }, alignItems: 'center', columnGap: 1, rowGap: 0.5 }}>
        <Box sx={{ gridColumn: { md: 2 }, minWidth: 0 }}>
          <YearTabs currentYear={year} availableYears={availableYears} onYearChange={(y) => void tab.handleYearChange(y)} disabled={loading} />
        </Box>
        <Box sx={{ gridColumn: { md: 3 }, justifySelf: { xs: 'center', md: 'end' }, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }}>
          {savingHint && (
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{savingHint}</Typography>
          )}
          {tab.changedColumns.length > 0 && tab.openingAt !== null && (
            <>
              <Typography data-testid="opening-changes" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                {t('budgetTab.restore.changes', { count: tab.changedColumns.length, time: formatTime(new Date(tab.openingAt), tab.locale) })}
              </Typography>
              <Button variant="action" onClick={() => { void tab.restoreOpening(); }} disabled={tab.restoring || loading}>
                {t('budgetTab.restore.action')}
              </Button>
            </>
          )}
        </Box>
      </Box>

      <RestoreNoticeBox tab={tab} />

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
