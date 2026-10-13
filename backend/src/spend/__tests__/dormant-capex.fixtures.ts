import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';

// Seeds in the dormant capex_* tables (not a spec itself). Since lot Z1 the CAPEX lines live in the
// spend_* tables and nothing reads or writes capex_* any more; lot Z2 drops them. Until then, the
// specs of older migrations that still treat both table families seed their CAPEX case here, so
// they keep proving what the migration does on those tables.

export const DORMANT_CAPEX_TABLES = {
  items: 'capex_items',
  versions: 'capex_versions',
  amounts: 'capex_amounts',
  totals: 'capex_version_totals',
  allocations: 'capex_allocations',
} as const;

/** A line in `capex_items`; its id. */
export async function seedDormantCapexItem(runner: QueryRunner, tenantId: string, itemNumber = 1, description = 'Dormant CAPEX line') {
  const itemId = randomUUID();
  await runner.query(
    `INSERT INTO capex_items (id, tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
     VALUES ($1, $2, $3, 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', $4)`,
    [itemId, tenantId, description, itemNumber],
  );
  return itemId;
}

/** A version of a `capex_items` line in `capex_versions`; its id. */
export async function seedDormantCapexVersion(runner: QueryRunner, tenantId: string, itemId: string, year: number, inputGrain = 'monthly') {
  const versionId = randomUUID();
  await runner.query(
    `INSERT INTO capex_versions (id, tenant_id, capex_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'default')`,
    [versionId, tenantId, itemId, `Y${year}`, inputGrain, `${year}-01-01`, year],
  );
  return versionId;
}
