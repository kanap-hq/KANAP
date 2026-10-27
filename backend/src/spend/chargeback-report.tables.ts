/**
 * The tables of the chargeback reports, built from the service's numbers: what the two screens show
 * and what their exports write, from one code. Pure functions, no Nest, no database.
 *
 * Labels stay out: a row carries ids, names or nulls (a company with no name, common costs, a missing
 * department, a company's total row), and the screen or the export words them in the user's language.
 * Shares are fractions of the report total (`0.125` is 12.5 %). Amounts are in the reporting currency,
 * rounded to the cent like the service's.
 */

function toCurrency(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

const byName = (a: string | null | undefined, b: string | null | undefined): number => (a ?? '').localeCompare(b ?? '');

/** A row of the global report's company x department table (`detailed`). */
export type GlobalChargebackDetailedInput = {
  companyId: string;
  companyName: string;
  departmentId: string | null;
  departmentName: string | null;
  amount: number;
  amountRaw: number;
  headcount: number | null;
  costPerUser: number | null;
};

export type GlobalChargebackCompanyInput = { companyId: string; companyName: string; amount: number };

export type GlobalChargebackKpiInput = {
  companyId: string;
  amount: number;
  headcount: number | null;
  itUsers: number | null;
  /** In the reporting currency (`turnoverRaw` stays in the company's base currency). */
  turnover: number | null;
  costPerUser: number | null;
};

/**
 * A row of the detailed allocations table: a company's total row (`rowType` `company`, its department
 * cell reads "Total"), then its departments by amount, largest first.
 */
export type GlobalChargebackDetailedRow = {
  rowType: 'company' | 'department';
  companyId: string;
  companyName: string;
  /** Null on a company row, and on the common-costs row (no department). */
  departmentId: string | null;
  /** Null on a company row, on common costs and on a department that no longer exists. */
  departmentName: string | null;
  amount: number;
  amountRaw: number;
  /** Fraction of the report total; null when the total is not positive. */
  share: number | null;
  headcount: number | null;
  costPerUser: number | null;
};

/** The share of an amount in the report total, as a fraction; null when the total is not positive. */
export function chargebackShare(amount: number, total: number): number | null {
  return total > 0 ? amount / total : null;
}

/**
 * The detailed allocations table: the companies in the order of `companies` (amount, largest first; a
 * company only `detailed` names comes after them), each as its total row then its department rows.
 * The total row takes the company's amount, its headcount and cost per user from the indicators.
 */
export function globalChargebackDetailedRows(
  detailed: readonly GlobalChargebackDetailedInput[],
  companies: readonly GlobalChargebackCompanyInput[],
  kpis: readonly GlobalChargebackKpiInput[],
  total: number,
): GlobalChargebackDetailedRow[] {
  const byCompany = new Map<string, GlobalChargebackDetailedInput[]>();
  for (const row of detailed) {
    const list = byCompany.get(row.companyId) ?? [];
    list.push(row);
    byCompany.set(row.companyId, list);
  }
  const companyById = new Map(companies.map((row) => [row.companyId, row] as const));
  const kpiById = new Map(kpis.map((row) => [row.companyId, row] as const));
  const ordered = companies.map((row) => row.companyId);
  for (const row of detailed) if (!ordered.includes(row.companyId)) ordered.push(row.companyId);

  const result: GlobalChargebackDetailedRow[] = [];
  for (const companyId of ordered) {
    const departments = [...(byCompany.get(companyId) ?? [])];
    if (departments.length === 0) continue;
    departments.sort((a, b) => b.amount - a.amount);
    const company = companyById.get(companyId);
    const kpi = kpiById.get(companyId);
    const amount = company?.amount ?? toCurrency(departments.reduce((sum, row) => sum + row.amount, 0));
    result.push({
      rowType: 'company',
      companyId,
      companyName: departments[0].companyName,
      departmentId: null,
      departmentName: null,
      amount,
      amountRaw: departments.reduce((sum, row) => sum + row.amountRaw, 0),
      share: chargebackShare(amount, total),
      headcount: kpi?.headcount ?? null,
      costPerUser: kpi?.costPerUser ?? null,
    });
    for (const row of departments) {
      result.push({
        rowType: 'department',
        companyId,
        companyName: row.companyName,
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        amount: row.amount,
        amountRaw: row.amountRaw,
        share: chargebackShare(row.amount, total),
        headcount: row.headcount,
        costPerUser: row.costPerUser,
      });
    }
  }
  return result;
}

export type ChargebackFlowInput = { payerId: string; payerName: string; consumerId: string; consumerName: string; amount: number };

/** A netted intercompany flow: one row per pair of companies, from the one that pays net to the other. */
export type ChargebackNettedFlow = {
  payerId: string;
  /** Null when no row names the company (the screen and the export say "Unknown company"). */
  payerName: string | null;
  consumerId: string;
  consumerName: string | null;
  amount: number;
};

/**
 * The gross flows netted per pair of companies: what A pays for B minus what B pays for A, in the
 * direction of the positive balance. A pair that balances out is left out. Largest amount first, then
 * by payer name.
 */
export function nettedChargebackFlows(
  flows: readonly ChargebackFlowInput[],
  companies: readonly { companyId: string; companyName: string }[],
): ChargebackNettedFlow[] {
  const names = new Map<string, string>();
  for (const row of companies) names.set(row.companyId, row.companyName);
  for (const flow of flows) {
    if (flow.payerId && flow.payerName) names.set(flow.payerId, flow.payerName);
    if (flow.consumerId && flow.consumerName) names.set(flow.consumerId, flow.consumerName);
  }
  const pairs = new Map<string, { aId: string; bId: string; net: number }>();
  for (const flow of flows) {
    const aId = flow.payerId < flow.consumerId ? flow.payerId : flow.consumerId;
    const bId = flow.payerId < flow.consumerId ? flow.consumerId : flow.payerId;
    const key = `${aId}|${bId}`;
    const pair = pairs.get(key) ?? { aId, bId, net: 0 };
    // Positive: a pays b.
    pair.net += Number((flow.payerId === aId ? flow.amount : -flow.amount) || 0);
    pairs.set(key, pair);
  }
  const result: ChargebackNettedFlow[] = [];
  for (const { aId, bId, net } of pairs.values()) {
    const amount = toCurrency(Math.abs(net));
    if (!Number.isFinite(net) || amount < 0.0001) continue;
    const [payerId, consumerId] = net > 0 ? [aId, bId] : [bId, aId];
    result.push({ payerId, payerName: names.get(payerId) || null, consumerId, consumerName: names.get(consumerId) || null, amount });
  }
  result.sort((x, y) => (y.amount !== x.amount ? y.amount - x.amount : byName(x.payerName, y.payerName)));
  return result;
}

/** The totals row of the companies' indicators; the ratios are of the totals, never an average of ratios. */
export type ChargebackKpiTotals = {
  amount: number;
  headcount: number;
  itUsers: number;
  /** In the reporting currency; 0 when no company has a converted turnover. */
  turnover: number;
  /** Percentage points, as the rows' `costVsTurnoverPct`; null without turnover. */
  costVsTurnoverPct: number | null;
  costPerUser: number | null;
  costPerItUser: number | null;
};

/**
 * The totals row of the global report's indicators, null without a company. Every ratio divides
 * amounts in the reporting currency: the raw amounts and turnovers are in each line's or company's
 * own currency and cannot be added together.
 */
export function chargebackKpiTotals(rows: readonly Omit<GlobalChargebackKpiInput, 'companyId' | 'costPerUser'>[]): ChargebackKpiTotals | null {
  if (rows.length === 0) return null;
  let amount = 0;
  let headcount = 0;
  let itUsers = 0;
  let turnover = 0;
  for (const row of rows) {
    amount += Number(row.amount ?? 0);
    headcount += Number(row.headcount ?? 0);
    itUsers += Number(row.itUsers ?? 0);
    turnover += Number(row.turnover ?? 0);
  }
  return {
    amount: toCurrency(amount),
    headcount,
    itUsers,
    turnover: toCurrency(turnover),
    costVsTurnoverPct: turnover > 0 ? (amount / turnover) * 100 : null,
    costPerUser: headcount > 0 ? amount / headcount : null,
    costPerItUser: itUsers > 0 ? amount / itUsers : null,
  };
}

/** A row of the company report's intercompany table: what a partner owes the company, and the reverse. */
export type ChargebackIntercompanyRow = {
  partnerId: string;
  /** Null when no row names the company. */
  partnerName: string | null;
  /** The partner's consumption the company pays. */
  receivables: number;
  /** The company's consumption the partner pays. */
  payables: number;
  /** Receivables minus payables. */
  net: number;
};

export type ChargebackIntercompanyTotal = { receivables: number; payables: number; net: number };

/**
 * The company's receivables and payables merged per partner, net = receivables - payables, largest net
 * first then by name; and their total row (null without a partner).
 */
export function chargebackIntercompanyRows(
  receivables: readonly { consumerId: string; consumerName: string; amount: number }[],
  payables: readonly { payerId: string; payerName: string; amount: number }[],
): { rows: ChargebackIntercompanyRow[]; total: ChargebackIntercompanyTotal | null } {
  const byPartner = new Map<string, ChargebackIntercompanyRow>();
  const partner = (id: string, name: string): ChargebackIntercompanyRow => {
    const row = byPartner.get(id) ?? { partnerId: id, partnerName: null, receivables: 0, payables: 0, net: 0 };
    row.partnerName = name || null;
    byPartner.set(id, row);
    return row;
  };
  for (const row of receivables) partner(row.consumerId, row.consumerName).receivables += Number(row.amount || 0);
  for (const row of payables) partner(row.payerId, row.payerName).payables += Number(row.amount || 0);
  const rows = [...byPartner.values()].map((row) => ({
    ...row,
    receivables: toCurrency(row.receivables),
    payables: toCurrency(row.payables),
    net: toCurrency(row.receivables - row.payables),
  }));
  rows.sort((a, b) => (b.net !== a.net ? b.net - a.net : byName(a.partnerName, b.partnerName)));
  if (rows.length === 0) return { rows, total: null };
  const sum = (pick: (row: ChargebackIntercompanyRow) => number) => toCurrency(rows.reduce((total, row) => total + pick(row), 0));
  const totalReceivables = sum((row) => row.receivables);
  const totalPayables = sum((row) => row.payables);
  return { rows, total: { receivables: totalReceivables, payables: totalPayables, net: toCurrency(totalReceivables - totalPayables) } };
}

/**
 * The label of a chargeback line: its name, or for a line the person cannot read (data-scoped access)
 * its BL reference and its name, shown without a link.
 */
export function chargebackItemLabel(row: { itemName: string; itemNumber: number | null; readable?: boolean }): string {
  if (row.readable !== false) return row.itemName;
  return [row.itemNumber != null ? `BL-${row.itemNumber}` : null, row.itemName].filter(Boolean).join(' · ');
}
