import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ANALYTICS_LINK_TABLES, loadAnalyticsAxes } from '../analytics/analytics-axes.util';
import { dimensionPhrase, missingRequiredDimensions } from './item-analytics.util';
import { isLimitedTransaction } from '../data-access/line-write-checks';
import type { BudgetNature } from './budget-nature';

/**
 * A budget line created at its title on the screen (lot 1c of the creation frame):
 * - `POST /budget-lines/creation` creates it from the title alone, with the tenant's currency, a
 *   start date and the type, plus its place when the person's data access needs one
 *   (`CREATION_FIELDS`), through the write gate with its `creation` option: no paying company and
 *   no required dimension yet. Every other route keeps the full rules (the API create, the budget
 *   file, the type change, the assistant).
 * - `POST /budget-lines/:id/creation/complete` (the screen's "Create") checks what a line needs
 *   (`missingCreationFields`); a line lacking any of it is refused with `BUDGET_LINE_INCOMPLETE` and
 *   the fields by stable key, which the screen names, marks and focuses.
 * - The creation token of `common/creation` opens the preflight and "Cancel" (`GET` and
 *   `DELETE :id/creation`) for the creator, on that line only.
 */

/** The family of the creation token of a budget line. */
export const BUDGET_LINE_CREATION_FAMILY = 'budget-lines';

/** The fields `POST /budget-lines/creation` writes; anything else in the body is dropped. */
const CREATION_FIELDS = ['product_name', 'currency', 'effective_start', 'paying_company_id', 'cost_center_id'] as const;

export function creationBody(body: unknown): Record<string, unknown> {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const field of CREATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field) && input[field] !== undefined) out[field] = input[field];
  }
  if (typeof out.product_name !== 'string' || !out.product_name.trim()) {
    throw new BadRequestException('A budget line needs a title.');
  }
  out.product_name = out.product_name.trim();
  return out;
}

/** The stable keys of the fields a line needs: `paying_company`, `account`, `dimension:<axis id>`, `cost_center`. */
export type CreationField = string;

type LineRow = {
  id: string;
  nature: BudgetNature;
  paying_company_id: string | null;
  account_id: string | null;
  cost_center_id: string | null;
  account_coa_id: string | null;
  account_nature: string | null;
  company_coa_id: string | null;
};

/**
 * What the line still needs before its creation ends, by stable key, in the order of the screen:
 * a paying company; an account, on the company's chart and for the line's type; a value on every
 * dimension required for its type; a cost center when the person's data access allows the company
 * only through cost centers. Read under the request's access; null when the line is not found.
 */
export async function missingCreationFields(
  manager: EntityManager,
  tenantId: string,
  lineId: string,
): Promise<{ nature: BudgetNature; fields: CreationField[]; names: string[] } | null> {
  const [line]: LineRow[] = await manager.query(
    `SELECT i.id, i.nature, i.paying_company_id, i.account_id, i.cost_center_id,
            a.coa_id::text AS account_coa_id, a.nature AS account_nature, c.coa_id::text AS company_coa_id
       FROM spend_items i
       LEFT JOIN accounts a ON a.tenant_id = i.tenant_id AND a.id = i.account_id
       LEFT JOIN companies c ON c.tenant_id = i.tenant_id AND c.id = i.paying_company_id
      WHERE i.tenant_id = $1 AND i.id = $2 AND i.nature IN ('opex', 'capex')`,
    [tenantId, lineId],
  );
  if (!line) return null;
  const fields: CreationField[] = [];
  const names: string[] = [];
  if (!line.paying_company_id) {
    fields.push('paying_company');
    names.push('paying company');
  }
  const accountOnChart = !line.account_coa_id || !line.company_coa_id || line.account_coa_id === line.company_coa_id;
  const accountForType = !line.account_nature || line.account_nature === line.nature;
  if (!line.account_id || !accountOnChart || !accountForType) {
    fields.push('account');
    names.push('account');
  }
  const axes = await loadAnalyticsAxes(manager, tenantId);
  const values: Array<{ axis_id: string; category_id: string }> = await manager.query(
    `SELECT axis_id::text AS axis_id, category_id::text AS category_id
       FROM ${ANALYTICS_LINK_TABLES[line.nature]}
      WHERE tenant_id = $1 AND item_id = $2`,
    [tenantId, lineId],
  );
  const held = new Map(values.map((row) => [row.axis_id, row.category_id]));
  for (const axis of missingRequiredDimensions(axes, held, line.nature)) {
    fields.push(`dimension:${axis.id}`);
    names.push(dimensionPhrase(axis).replace(/^the /, ''));
  }
  if (line.paying_company_id && !line.cost_center_id && (await isLimitedTransaction(manager))) {
    const [row] = await manager.query(`SELECT data_access_placable_line($1::uuid, NULL::uuid) AS placable`, [line.paying_company_id]);
    if (row?.placable !== true) {
      fields.push('cost_center');
      names.push('cost center');
    }
  }
  return { nature: line.nature, fields, names };
}

/** 400 `BUDGET_LINE_INCOMPLETE`: the line lacks these fields; `params.fields` holds their stable keys. */
export function budgetLineIncomplete(fields: CreationField[], names: string[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'BUDGET_LINE_INCOMPLETE',
    message: `Missing: ${names.join(', ')}.`,
    params: { fields },
  });
}
