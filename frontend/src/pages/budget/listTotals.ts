import { fteTotalsToRow, parseFteField, totalsToVersions, pendingAmountsField } from '../../components/finance/amountColumns';
import type { AggregateResult, AggregateRow } from '../reports/reportAggregates';

/** Adapt an aggregate group to the grid's slots and FTE totals, preserving unknown counts. */
export function listTotalRow(group: AggregateRow | undefined, amounts: string, fte: string) {
  const values = group?.values ?? {};
  const fteTotals = Object.fromEntries(fte.split(',').filter((key) => parseFteField(key)).map((key) => [key, {
    total: values[key] ?? null, unknown: group?.unknown[key] ?? 0,
  }]));
  // An absent nature has zero amounts and no declared FTE. A placeholder answer can still
  // lack a newly shown measure, which must keep its pending marker.
  const totals = group ? values : Object.fromEntries(amounts.split(',').filter(Boolean).map((key) => [key, 0]));
  return { versions: totalsToVersions(totals), ...fteTotalsToRow(fteTotals), ...pendingAmountsField(totals, amounts) };
}

export function natureTotal(result: AggregateResult, nature: 'opex' | 'capex') {
  return result.groups.find((group) => group.keys[0] === nature);
}
