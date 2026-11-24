import type { EntityManager } from 'typeorm';
import { accountDisplayText } from '../../spend/spend-summary.builder';

/**
 * The "account not in the company's chart" check of one budget line as Kad reads it (`account_chart`
 * of the line's detail, `coa_mismatch` in its `to_check`), in plain words: the line's account and the
 * chart of accounts it belongs to, the paying company and the chart it uses. The line's account and
 * company are the line's own fields, named for whoever reads the line; a chart is named with the right
 * on accounts (charts of accounts), the company's chart also with the right on companies, else the
 * detail says the fact without naming them, so that a missing read never reads as "none".
 */

type ChartRow = {
  account_number: string | number | null;
  account_name: string | null;
  account_coa_id: string | null;
  account_chart_code: string | null;
  account_chart_name: string | null;
  company_name: string | null;
  company_coa_id: string | null;
  company_chart_code: string | null;
  company_chart_name: string | null;
};

const chartText = (code: string | null, name: string | null): string | null => {
  const c = code?.trim() ?? '';
  const n = name?.trim() ?? '';
  if (c && n && c !== n) return `${c} - ${n}`;
  return c || n || null;
};

const CLEAR = 'To clear the mark, choose on the line\'s Overview tab an account of the paying company\'s chart, '
  + 'or a paying company that uses the account\'s chart. Nothing is refused meanwhile: the line keeps its account.';

export async function describeAccountChartForAi(
  manager: Pick<EntityManager, 'query'>,
  ctx: { tenantId: string; lineId: string; charts: boolean; companyCharts: boolean },
): Promise<Record<string, unknown>> {
  const [row]: ChartRow[] = await manager.query(
    `SELECT a.account_number, a.account_name, a.coa_id AS account_coa_id,
            ac.code AS account_chart_code, ac.name AS account_chart_name,
            c.name AS company_name, c.coa_id AS company_coa_id,
            cc.code AS company_chart_code, cc.name AS company_chart_name
       FROM spend_items i
       LEFT JOIN accounts a ON a.tenant_id = i.tenant_id AND a.id = i.account_id
       LEFT JOIN chart_of_accounts ac ON ac.tenant_id = i.tenant_id AND ac.id = a.coa_id
       LEFT JOIN companies c ON c.tenant_id = i.tenant_id AND c.id = i.paying_company_id
       LEFT JOIN chart_of_accounts cc ON cc.tenant_id = i.tenant_id AND cc.id = c.coa_id
      WHERE i.tenant_id = $1 AND i.id = $2`,
    [ctx.tenantId, ctx.lineId],
  );
  const account = row?.account_number != null ? accountDisplayText(row.account_number, row.account_name) : null;
  const company = row?.company_name?.trim() || null;
  if (!account) {
    return { status: 'no_account', explanation: 'The line has no account: there is no chart of accounts to compare, and `to_check` holds no `coa_mismatch`.' };
  }
  if (!row.account_coa_id || !row.company_coa_id) {
    return {
      status: 'not_compared',
      account,
      paying_company: company,
      explanation: `${!row.account_coa_id ? `The line's account ${account} belongs to no chart of accounts` : `The paying company${company ? ` ${company}` : ''} uses no chart of accounts`}: `
        + 'nothing to compare, and `to_check` holds no `coa_mismatch`.',
    };
  }
  const accountChart = ctx.charts ? chartText(row.account_chart_code, row.account_chart_name) : null;
  const companyChart = ctx.charts && ctx.companyCharts ? chartText(row.company_chart_code, row.company_chart_name) : null;
  const withheld = !ctx.charts || !ctx.companyCharts
    ? {
      charts_withheld: ctx.charts
        ? 'The paying company\'s chart is named with the right on companies (Companies, reader level), which this person does not have: '
          + 'name the account\'s chart only, never the company\'s.'
        : 'The charts of accounts are named with the right on accounts (Accounts, reader level), which this person does not have: '
          + 'tell them whether the account is in the company\'s chart without naming either chart.',
    }
    : {};
  const ofAccount = accountChart ? `the chart of accounts ${accountChart}` : 'its chart of accounts';
  const ofCompany = companyChart ? `the chart ${companyChart}` : 'its own chart';
  const paying = `its paying company${company ? ` ${company}` : ''}`;
  if (row.account_coa_id === row.company_coa_id) {
    return {
      status: 'conforms',
      account,
      ...(accountChart ? { account_chart: accountChart } : {}),
      paying_company: company,
      ...(companyChart ? { paying_company_chart: companyChart } : {}),
      ...withheld,
      explanation: `The line's account ${account} belongs to ${ofAccount}, the chart ${paying} uses: the account is in the company's chart, `
        + 'and `to_check` holds no `coa_mismatch`.',
    };
  }
  return {
    status: 'to_check',
    account,
    ...(accountChart ? { account_chart: accountChart } : {}),
    paying_company: company,
    ...(companyChart ? { paying_company_chart: companyChart } : {}),
    ...withheld,
    explanation: `The line's account ${account} belongs to ${ofAccount}, while ${paying} uses ${ofCompany}: the account is not in the company's chart. `
      + 'This is the only cause of `coa_mismatch` in the line\'s `to_check`. ' + CLEAR,
  };
}
