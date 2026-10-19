import type { EntityManager } from 'typeorm';
import { ParticipationAccessScope, projectParticipantCondition } from '../../auth/business-contributor-scope';
import { BUDGET_NATURES, naturesAnd, type BudgetNature } from '../../spend/budget-nature';
import { loadVersionTotals, SUMMARY_COLUMNS, SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { contractTermsSql, SQL_TODAY_UTC } from '../../contracts/contract-terms';
import { renewalDecisionSql } from '../../contracts/contract-renewal';
import { readDecisionWindowDays } from '../../contracts/contract-settings.service';
import type { FxRateService } from '../../currency/fx-rate.service';

/**
 * The linked objects a Relations tab lists (lot R1, `applications-relations.service.ts`), shared by
 * every object that has one (applications, technologies). Each listing reads one link table of the
 * owner (`links`, owner column `owner`) over the owner's id: one query per section, `tenant_id` on
 * each table and join besides RLS. Table and column names come from the callers' constants only.
 */
export type RelationLinkTable = { links: string; owner: string };

export type RelatedBudgetLine = {
  id: string;
  item_number: number | null;
  nature: BudgetNature;
  product_name: string;
  supplier_name: string | null;
  /** In `currency`, the reporting currency; null without a version that year, or without an exchange rate (`fx_missing`). */
  amount: number | null;
  currency: string;
  status: string;
  /**
   * Only when the line's version has amounts in a currency without a rate to the reporting
   * currency that year: the amount in the line's own currency, never counted as the reporting one.
   */
  fx_missing?: { currency: string; amount: number };
};
export type RelatedContract = {
  id: string;
  name: string;
  supplier_name: string | null;
  end_date: string | null;
  yearly_amount: number | null;
  currency: string | null;
  auto_renewal: boolean;
  in_renewal_window: boolean;
  status: string;
};
export type RelatedProject = { id: string; item_number: number | null; name: string; status: string | null; planned_end: string | null };

/** `$n` placeholders over a growing parameter list. */
export function binder(params: unknown[]) {
  return (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
}

export const dateText = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD')`;

/**
 * The budget lines linked through `t.links` (column `spend_item_id`), with their amount on the
 * tenant's `measure` column for `year`, converted to the reporting currency as the budget list
 * reads it.
 */
export async function listRelatedBudgetLines(
  mg: EntityManager,
  fxRates: Pick<FxRateService, 'resolveRates' | 'convertValue'>,
  t: RelationLinkTable,
  tenantId: string,
  ownerId: string,
  year: number,
  measure: string,
): Promise<RelatedBudgetLine[]> {
  const rows: Array<Omit<RelatedBudgetLine, 'amount'> & { currency: string | null }> = await mg.query(
    `SELECT i.id, i.item_number, i.nature, i.product_name, s.name AS supplier_name, i.currency, i.status::text AS status
     FROM ${t.links} l
     JOIN spend_items i ON i.id = l.spend_item_id AND i.tenant_id = l.tenant_id${naturesAnd('i', BUDGET_NATURES)}
     LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.tenant_id = i.tenant_id
     WHERE l.tenant_id = $1 AND l.${t.owner} = $2
     ORDER BY lower(i.product_name), i.id`,
    [tenantId, ownerId],
  );
  if (rows.length === 0) return [];
  // The newest version of each line for the year and its totals, converted to the reporting
  // currency, as the budget list reads them.
  const totals = await loadVersionTotals(SUMMARY_SCOPES.all, { fxRates: fxRates as FxRateService }, mg, tenantId, rows, [year], { reporting: true });
  const key = SUMMARY_COLUMNS.find((column) => column.measure === measure)!.key;
  return rows.map((row) => {
    const version = totals.versionsByItemYear.get(row.id)?.get(year);
    const reporting = version ? totals.reporting.get(version.id) : undefined;
    const local = version ? totals.cents.get(version.id) : undefined;
    const amount = !version ? null : reporting ? (reporting.cents ? Number(reporting.cents[key]) / 100 : null) : 0;
    const fxMissing = reporting && !reporting.cents && local ? { currency: reporting.currency, amount: Number(local[key]) / 100 } : null;
    return {
      id: row.id,
      item_number: row.item_number ?? null,
      nature: row.nature,
      product_name: row.product_name,
      supplier_name: row.supplier_name ?? null,
      amount,
      currency: reporting?.reporting_currency ?? totals.reportingCurrency,
      status: row.status,
      ...(fxMissing ? { fx_missing: fxMissing } : {}),
    };
  });
}

/** The contracts linked through `t.links` (column `contract_id`), with their current end and renewal window. */
export async function listRelatedContracts(mg: EntityManager, t: RelationLinkTable, tenantId: string, ownerId: string): Promise<RelatedContract[]> {
  const windowDays = await readDecisionWindowDays(mg, tenantId);
  const terms = contractTermsSql('c', SQL_TODAY_UTC, { decisionWindowDays: windowDays, renewalDecision: renewalDecisionSql('c') });
  const rows: Array<Record<string, any>> = await mg.query(
    `SELECT c.id, c.name, s.name AS supplier_name, c.status::text AS status, COALESCE(c.auto_renewal, false) AS auto_renewal,
            c.yearly_amount_at_signature AS yearly_amount, NULLIF(trim(c.currency), '') AS currency,
            ${dateText('ct.current_term_end')} AS end_date, (ct.term_state = 'to_decide') AS in_renewal_window
     FROM ${t.links} l
     JOIN contracts c ON c.id = l.contract_id AND c.tenant_id = l.tenant_id
     LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.tenant_id = c.tenant_id
     LEFT JOIN LATERAL (${terms.row}) ct ON c.start_date IS NOT NULL
     WHERE l.tenant_id = $1 AND l.${t.owner} = $2
     ORDER BY lower(c.name), c.id`,
    [tenantId, ownerId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    supplier_name: row.supplier_name ?? null,
    end_date: row.end_date ?? null,
    yearly_amount: row.yearly_amount == null ? null : Number(row.yearly_amount),
    currency: row.currency ?? null,
    auto_renewal: !!row.auto_renewal,
    in_renewal_window: !!row.in_renewal_window,
    status: row.status,
  }));
}

/** The projects linked through `t.links` (column `project_id`), under the caller's participation scope. */
export async function listRelatedProjects(
  mg: EntityManager,
  t: RelationLinkTable,
  tenantId: string,
  ownerId: string,
  scope?: ParticipationAccessScope,
): Promise<RelatedProject[]> {
  const params: unknown[] = [tenantId, ownerId];
  const bind = binder(params);
  const scopeSql = scope ? `AND ${projectParticipantCondition('p', bind(scope.userId))}` : '';
  return mg.query(
    `SELECT p.id, p.item_number, p.name, p.status, ${dateText('p.planned_end')} AS planned_end
     FROM ${t.links} l
     JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
     WHERE l.tenant_id = $1 AND l.${t.owner} = $2 ${scopeSql}
     ORDER BY p.planned_end ASC NULLS LAST, lower(p.name), p.id`,
    params,
  );
}
