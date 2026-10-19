/** A company's indicators of the global chargeback (`GET /reports/chargeback/global`, `kpis`). */
export type ChargebackKpiRow = {
  /** The consumed amount, in the reporting currency. */
  amount: number;
  headcount: number | null;
  itUsers: number | null;
  /** The turnover, in the reporting currency (`turnoverRaw` stays in the company's base currency). */
  turnover: number | null;
};

/**
 * The totals row of the companies' indicators. Every ratio divides amounts in the reporting
 * currency: the raw amounts and turnovers are in each line's or company's own currency and
 * cannot be added together.
 */
export function chargebackKpiTotals(rows: ChargebackKpiRow[]) {
  let amountDisplayTotal = 0;
  let headcountTotal = 0;
  let itUsersTotal = 0;
  let turnoverDisplayTotal = 0;
  for (const row of rows) {
    amountDisplayTotal += Number(row.amount ?? 0);
    headcountTotal += Number(row.headcount ?? 0);
    itUsersTotal += Number(row.itUsers ?? 0);
    turnoverDisplayTotal += Number(row.turnover ?? 0);
  }
  return {
    amountDisplayTotal,
    headcountTotal,
    itUsersTotal,
    turnoverDisplayTotal,
    costVsTurnover: turnoverDisplayTotal > 0 ? (amountDisplayTotal / turnoverDisplayTotal) * 100 : null,
    costPerUser: headcountTotal > 0 ? amountDisplayTotal / headcountTotal : null,
    costPerItUser: itUsersTotal > 0 ? amountDisplayTotal / itUsersTotal : null,
  };
}
