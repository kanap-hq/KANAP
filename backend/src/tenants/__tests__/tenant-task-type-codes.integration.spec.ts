import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { PortfolioClassificationService } from '../../portfolio/portfolio-classification.service';
import { PortfolioCategory } from '../../portfolio/portfolio-category.entity';
import { PortfolioSource } from '../../portfolio/portfolio-source.entity';
import { PortfolioStream } from '../../portfolio/portfolio-stream.entity';
import { PortfolioTaskType } from '../../portfolio/portfolio-task-type.entity';
import { buildServices, cleanupTenants, inTenant, runSpecs } from '../../admin/tenants/__tests__/tenant-reset-test-helpers';

// The shipped task types carry their code (`task`, `bug`, `problem`, `incident`) from the tenant's
// creation. A rename keeps the code, an update cannot change it, and seeding again (tenant seed
// or the portfolio "load defaults") adds no second copy of a renamed default. The tenants are
// committed (the services open their own transactions) and removed at the end.

async function typesOf(tenantId: string): Promise<Array<{ name: string; code: string | null }>> {
  return inTenant(tenantId, (manager) => manager.query(
    `SELECT name, code FROM portfolio_task_types WHERE tenant_id = $1 ORDER BY display_order, name`,
    [tenantId],
  ));
}

function classification() {
  const repo = dataSource.getRepository.bind(dataSource);
  return new PortfolioClassificationService(repo(PortfolioSource), repo(PortfolioCategory), repo(PortfolioStream), repo(PortfolioTaskType));
}

async function testNewTenantRenameAndReseed() {
  const svc = buildServices();
  let tenantId: string | undefined;
  try {
    tenantId = (await svc.tenants.createTenant({ slug: `tt-codes-${randomUUID().slice(0, 8)}`, name: 'Task type codes', language: 'fr' })).id;
    assert.deepEqual(await typesOf(tenantId), [
      { name: 'Task', code: 'task' },
      { name: 'Bug', code: 'bug' },
      { name: 'Problem', code: 'problem' },
      { name: 'Incident', code: 'incident' },
    ], 'a new tenant gets the shipped types with their code');

    const classes = classification();
    await inTenant(tenantId, async (manager) => {
      const [task] = await manager.query(`SELECT id FROM portfolio_task_types WHERE tenant_id = $1 AND code = 'task'`, [tenantId]);
      await classes.updateTaskType(task.id, tenantId!, { name: 'Ticket', code: 'bug' } as any, { manager });
      await classes.createTaskType(tenantId!, { name: 'Change' }, { manager });
    });

    await inTenant(tenantId, (manager) => svc.tenants.seedTenantDefaults(manager, tenantId!));
    await inTenant(tenantId, (manager) => classes.seedDefaultTaskTypes(tenantId!, manager));
    assert.deepEqual(await typesOf(tenantId), [
      { name: 'Ticket', code: 'task' },
      { name: 'Bug', code: 'bug' },
      { name: 'Problem', code: 'problem' },
      { name: 'Incident', code: 'incident' },
      { name: 'Change', code: null },
    ], 'the renamed default keeps its code, no second "Task" is seeded, an added type has none');
  } finally {
    await cleanupTenants([tenantId]);
  }
}

runSpecs('tenant-task-type-codes.integration.spec', [testNewTenantRenameAndReseed]);
