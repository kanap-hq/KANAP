import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../../../data-source';
import { activityTargetKey, resolveActivityTargetDisplays } from '../ai-agent-activity-targets';

/**
 * What the Activity screen shows for the object an entry acts on: its business reference (T-15,
 * PRJ-3...), its type alone when the family has no reference, never its uuid. Real PostgreSQL, migrations
 * applied; the lookup reads the search index with the tenant predicate, in one query for the page.
 */

async function seedTenant(runner: any, tenantId: string, tag: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `activity-targets-${tag}-${tenantId.slice(0, 8)}`, `Activity targets ${tag}`],
  );
}

async function setCurrentTenant(runner: any, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTask(runner: any, tenantId: string, itemNumber: number, title: string): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO tasks (id, tenant_id, item_number, title, status, labels, owner_ids, viewer_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'open', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
    [id, tenantId, itemNumber, title],
  );
  return id;
}

async function seedProject(runner: any, tenantId: string, itemNumber: number, name: string): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, origin, status, execution_progress, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'standard', 'planned', 0, now(), now())`,
    [id, tenantId, itemNumber, name],
  );
  return id;
}

async function seedCompany(runner: any, tenantId: string, name: string): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO companies (id, tenant_id, name, country_iso, city, status) VALUES ($1, $2, $3, 'FR', 'Lyon', 'enabled')`,
    [id, tenantId, name],
  );
  return id;
}

async function seedBudgetLine(runner: any, tenantId: string, nature: 'opex' | 'capex', itemNumber: number): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO spend_items (id, tenant_id, nature, item_number, product_name, currency, effective_start, status)
     VALUES ($1, $2, $3, $4, $5, 'EUR', '2020-01-01', 'enabled')`,
    [id, tenantId, nature, itemNumber, `Line ${itemNumber}`],
  );
  return id;
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(runner, tenantId, 'a');
    await seedTenant(runner, otherTenantId, 'b');

    await setCurrentTenant(runner, otherTenantId);
    const foreignTaskId = await seedTask(runner, otherTenantId, 15, 'Foreign task');

    await setCurrentTenant(runner, tenantId);
    const taskId = await seedTask(runner, tenantId, 15, 'Renew the VPN certificate');
    const projectId = await seedProject(runner, tenantId, 3, 'Move to the new ERP');
    const companyId = await seedCompany(runner, tenantId, 'Formaggio Supremo SRL');
    const opexId = await seedBudgetLine(runner, tenantId, 'opex', 7);
    // Numbered by the database at insertion (lot R1 of 26.11.9): the first of each family is n° 1.
    const insertOne = async (sql: string, params: unknown[]) => (await runner.query(`${sql} RETURNING id::text AS id`, params))[0].id as string;
    const supplierId = await insertOne(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Caseificio')`, [tenantId]);
    const contactId = await insertOne(`INSERT INTO contacts (tenant_id, email) VALUES ($1, 'anna@caseificio.test')`, [tenantId]);
    const departmentId = await insertOne(`INSERT INTO departments (tenant_id, name, company_id) VALUES ($1, 'Finance', $2)`, [tenantId, companyId]);
    const contractId = await insertOne(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Maintenance', $2, $3, '2026-01-01')`,
      [tenantId, companyId, supplierId],
    );
    const goneTaskId = randomUUID();

    const queries: string[] = [];
    const manager = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        return runner.query(sql, params);
      },
    };

    const targets = [
      { targetType: 'tasks', targetRef: taskId },
      { targetType: 'tasks', targetRef: taskId },
      { targetType: 'projects', targetRef: projectId },
      { targetType: 'companies', targetRef: companyId },
      { targetType: 'suppliers', targetRef: supplierId },
      { targetType: 'contacts', targetRef: contactId },
      { targetType: 'departments', targetRef: departmentId },
      { targetType: 'contracts', targetRef: contractId },
      { targetType: 'budget_lines', targetRef: opexId },
      // An approved change records a budget line under its table.
      { targetType: 'spend_items', targetRef: opexId },
      // Deleted object, another tenant's object, a ticket number, no target at all: nothing to show.
      { targetType: 'tasks', targetRef: goneTaskId },
      { targetType: 'tasks', targetRef: foreignTaskId },
      { targetType: 'ticket', targetRef: '4711' },
      { targetType: null, targetRef: null },
    ];
    const displays = await resolveActivityTargetDisplays(manager as any, tenantId, targets);

    assert.equal(displays.get(activityTargetKey('tasks', taskId)), 'T-15', 'a task shows its reference');
    assert.equal(displays.get(activityTargetKey('projects', projectId)), 'PRJ-3', 'a project shows its reference');
    assert.equal(displays.get(activityTargetKey('companies', companyId)), 'COMP-1', 'a company shows its reference');
    assert.equal(displays.get(activityTargetKey('suppliers', supplierId)), 'SUP-1', 'a supplier shows its reference');
    assert.equal(displays.get(activityTargetKey('contacts', contactId)), 'CTCT-1', 'a contact shows its reference');
    assert.equal(displays.get(activityTargetKey('departments', departmentId)), 'DEPT-1', 'a department shows its reference');
    assert.equal(displays.get(activityTargetKey('contracts', contractId)), 'CTR-1', 'a contract shows its reference');
    const line = displays.get(activityTargetKey('budget_lines', opexId));
    assert.ok(line && /\b7$/.test(line), `a budget line shows its reference (${line})`);
    assert.equal(displays.get(activityTargetKey('spend_items', opexId)), line, 'a budget line recorded under its table shows the same reference');
    assert.equal(displays.has(activityTargetKey('tasks', goneTaskId)), false, 'a deleted object shows no uuid');
    assert.equal(displays.has(activityTargetKey('tasks', foreignTaskId)), false, 'another tenant is never read');
    assert.equal(displays.has(activityTargetKey('ticket', '4711')), false, 'a ticket number stays as it is');
    assert.equal(displays.size, 9);

    // One query for the whole page, scoped by tenant, by batch of ids.
    assert.equal(queries.length, 1);
    assert.match(queries[0], /tenant_id = \$1/);
    assert.match(queries[0], /= ANY\(\$3/);

    // Nothing to resolve, nothing asked.
    queries.length = 0;
    const none = await resolveActivityTargetDisplays(manager as any, tenantId, [{ targetType: 'ticket', targetRef: '4711' }]);
    assert.equal(none.size, 0);
    assert.equal(queries.length, 0);

    console.log('ai-agent-activity-targets.integration.spec: ok');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
