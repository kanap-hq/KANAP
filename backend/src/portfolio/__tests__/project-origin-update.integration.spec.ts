// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import {
  inRolledBackTransaction,
  managedDocumentServices,
  seedCreationTenant,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';

// A project created on screen starts as fast-track, now that the title creates it: its origin
// switches between fast-track and legacy afterwards. A project converted from a request stays
// standard, and no project becomes standard by an update.

function crudFor(runner: QueryRunner) {
  const manager = runner.manager;
  return new PortfolioProjectsCrudService(
    undefined as any,
    undefined as any,
    new AuditService(manager.getRepository(AuditLog)),
    undefined as any,
    { getProjectRecipients: async () => [], notifyStatusChange: () => undefined } as any,
    new ItemNumberService() as any,
    managedDocumentServices(manager),
  );
}

async function testDirectProjectSwitchesOrigin() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const crud = crudFor(runner);
    const opts = { manager: runner.manager };
    const created: any = await crud.create({ name: 'Origin spec', origin: 'fast_track' } as any, tenantId, creatorId, opts);
    await crud.update(created.id, { origin: 'legacy' } as any, tenantId, creatorId, opts);
    const [{ origin }] = await runner.query(`SELECT origin FROM portfolio_projects WHERE id = $1`, [created.id]);
    assert.equal(origin, 'legacy');
    await assert.rejects(
      () => crud.update(created.id, { origin: 'standard' } as any, tenantId, creatorId, opts),
      (err: unknown) => err instanceof BadRequestException,
    );
  });
}

async function testStandardProjectKeepsItsOrigin() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const crud = crudFor(runner);
    const opts = { manager: runner.manager };
    const created: any = await crud.create({ name: 'Standard origin spec', origin: 'fast_track' } as any, tenantId, creatorId, opts);
    await runner.query(`UPDATE portfolio_projects SET origin = 'standard' WHERE id = $1`, [created.id]);
    await assert.rejects(
      () => crud.update(created.id, { origin: 'legacy' } as any, tenantId, creatorId, opts),
      (err: unknown) => err instanceof BadRequestException,
    );
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testDirectProjectSwitchesOrigin();
    console.log('  ok testDirectProjectSwitchesOrigin');
    await testStandardProjectKeepsItsOrigin();
    console.log('  ok testStandardProjectKeepsItsOrigin');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('project-origin-update.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
