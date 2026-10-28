import { itemService } from './cost-center.fixtures';
import { SpendItem } from '../spend-item.entity';
import { QueryRunner } from 'typeorm';
import { seedTenant, seedLine, setTenant, captureAudit } from './round-inputs.fixtures';
import { realSummaryDeps } from './oracle/oracle-deps';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import { BudgetLinesService } from '../budget-lines.service';
import { CapexItemsDeleteService, SpendItemsDeleteService } from '../spend-items-delete.service';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';

export const YEAR = new Date().getFullYear();
export const deps = realSummaryDeps(SUMMARY_SCOPES.opex);

/** A mixed list with distinct native/legacy numbers and an OPEX-CAPEX-OPEX neighborhood. */
export async function seedBudgetLines(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'neutral-budget');
  const lines = [];
  for (const [nature, number, legacy] of [['opex', 7101, 'OPX-9101'], ['capex', 7102, 'CPX-21'], ['opex', 7103, 'OPX-9103']] as const) {
    const line = await seedLine(runner, nature, tenantId, YEAR, {
      planned: Array(12).fill(number / 100), committed: Array(12).fill(number / 200), forecast: Array(12).fill(number / 50), actual: Array(12).fill(number / 25), expected_landing: Array(12).fill(number / 10),
    }, number);
    await runner.query(
      `UPDATE spend_items SET item_number = $3, legacy_number = $4, product_name = $5, description = $6
       WHERE tenant_id = $1 AND id = $2 AND nature = $7`,
      [tenantId, line.itemId, number, legacy, `UniqueTitle${number}`, `Native description ${number}`, nature],
    );
    await runner.query(
      `INSERT INTO tasks (tenant_id, title, related_object_type, related_object_id, item_number)
       VALUES ($1, $2, $3, $4, $5)`, [tenantId, `Task${number}`, nature === 'opex' ? 'spend_item' : 'capex_item', line.itemId, number],
    );
    lines.push({ ...line, nature, number, legacy });
  }
  const dimensions = [];
  for (const appliesTo of [null, 'opex', 'capex'] as const) {
    const code = appliesTo ?? 'shared';
    const [axis] = await runner.query(`INSERT INTO analytics_axes (tenant_id, code, name, applies_to) VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, code, code, appliesTo]);
    const [category] = await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, axis.id, `${code} value`]);
    for (const line of lines.filter((line) => appliesTo === null || line.nature === appliesTo)) {
      await runner.query(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [tenantId, line.itemId, axis.id, category.id]);
    }
    dimensions.push({ id: axis.id as string, appliesTo, value: `${code} value` });
  }
  const foreignTenantId = await seedTenant(runner, 'foreign-budget');
  const foreign = await seedLine(runner, 'capex', foreignTenantId, YEAR, { planned: Array(12).fill(12345) }, 8801);
  await runner.query(`UPDATE spend_items SET legacy_number = 'CPX-8801' WHERE tenant_id = $1 AND id = $2 AND nature = 'capex'`, [foreignTenantId, foreign.itemId]);
  await setTenant(runner, tenantId);
  return { tenantId, lines, foreignTenantId, foreign, dimensions };
}

/** The unified read engine on the request's manager: the AI reads both natures through it. */
export function budgetReadService(): BudgetLinesService {
  return new BudgetLinesService(
    deps.allocationCalculator as any,
    deps.fxRates as any,
    undefined as any,
    undefined as any,
    itemService('opex') as any,
    itemService('capex') as any,
    undefined as any,
  );
}

export function budgetService(runner: QueryRunner) {
  const audit = captureAudit();
  const storage = { deleteObject: async () => undefined };
  const time = new UserTimeAggregateService();
  // The repositories used for deletes come from the passed request manager.
  const args: any[] = [runner.manager.getRepository(SpendItem), undefined, undefined, undefined, audit, storage, time];
  return new BudgetLinesService(deps.allocationCalculator as any, deps.fxRates as any,
    new (SpendItemsDeleteService as any)(...args), new (CapexItemsDeleteService as any)(...args),
    itemService('opex', audit) as any, itemService('capex', audit) as any, undefined as any);
}
