import 'dotenv/config';
import { randomUUID } from 'crypto';
import { existingRecentItems } from '../recent-items';
import { assert, CAPEX_NUMBER_OFFSET, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The "Recently viewed" check (`recent-items.ts`): of the entries a browser holds, which records
// still exist in the tenant. One statement for every type asked; a record deleted (a task gone
// with its contract), of another tenant, of an unknown type or with a malformed id is not listed.

async function testExisting() {
  await inRolledBackTransaction(async (runner) => {
    const other = await seedTenant(runner, 'recent-other');
    const otherApp = (await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Elsewhere') RETURNING id`, [other]))[0].id as string;
    const tenantId = await seedTenant(runner, 'recent');
    await setTenant(runner, tenantId);
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const companyId = await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Co', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Sup') RETURNING id`, [tenantId]);
    const contractId = await one(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'C', $2, $3, DATE '2026-01-01') RETURNING id`,
      [tenantId, companyId, supplierId],
    );
    const taskId = await one(`INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, 1, 'T', 'contract', $2) RETURNING id`, [tenantId, contractId]);
    const goneTaskId = await one(`INSERT INTO tasks (tenant_id, item_number, title) VALUES ($1, 2, 'Gone') RETURNING id`, [tenantId]);
    await runner.query(`DELETE FROM tasks WHERE id = $1`, [goneTaskId]);
    const appId = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'App') RETURNING id`, [tenantId]);
    const capexId = await one(
      `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number)
       VALUES ($1, 'capex', 'Line', 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $2, 'CPX-1') RETURNING id`,
      [tenantId, CAPEX_NUMBER_OFFSET + 1],
    );

    const asked = [
      { type: 'contract', id: contractId },
      { type: 'task', id: taskId },
      { type: 'task', id: goneTaskId },
      { type: 'application', id: appId },
      { type: 'application', id: otherApp },
      // A budget line stays one entry whatever its nature.
      { type: 'spend_item', id: capexId },
      { type: 'project', id: randomUUID() },
      { type: 'unknown', id: randomUUID() },
      { type: 'contract', id: 'not-a-uuid' },
    ];
    const { existing } = await existingRecentItems(runner.manager, tenantId, asked);
    assert.deepEqual(
      existing.map((item) => `${item.type}:${item.id}`).sort(),
      [`application:${appId}`, `contract:${contractId}`, `spend_item:${capexId}`, `task:${taskId}`].sort(),
    );

    // The task goes with its contract: the next check no longer lists it.
    await runner.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
    const after = await existingRecentItems(runner.manager, tenantId, [{ type: 'task', id: taskId }]);
    assert.deepEqual(after.existing, []);
    assert.deepEqual((await existingRecentItems(runner.manager, tenantId, [])).existing, []);
  });
}

void runSpecs('recent-items', [['lists the records that still exist', testExisting]]);
