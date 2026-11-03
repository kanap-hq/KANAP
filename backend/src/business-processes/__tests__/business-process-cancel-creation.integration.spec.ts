// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { issueCreationToken } from '../../common/creation/creation-token';
import { RecordInUseException } from '../../common/record-in-use';
import {
  auditedEdit,
  deletionAuthors,
  inRolledBackTransaction,
  refusedAsExpired,
  seedCreationTenant,
  type CreationSeed,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { BusinessProcess } from '../business-process.entity';
import { BusinessProcessesController } from '../business-processes.controller';
import { BusinessProcessesDeleteService } from '../business-processes-delete.service';
import { BusinessProcessesService } from '../business-processes.service';
import { User } from '../../users/user.entity';

// Cancel of a business process being created (lot V7 of the creation frame): `POST
// /business-processes` hands the creator a token; `GET :id/creation` counts what was written since
// the creation (fields and application links);
// `DELETE :id/creation` deletes the process for its creator at the create level (member), the
// application links made meanwhile removed first. Another person's token, another process's, a
// missing or an expired one is refused with `CREATION_CANCEL_EXPIRED`, and so is the cancel of a
// process another person wrote on. An interface that names the process still refuses the delete.

function controllerFor(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const svc = new BusinessProcessesService(
    manager.getRepository(BusinessProcess),
    manager.getRepository(User),
    audit,
  );
  const deleteSvc = new BusinessProcessesDeleteService(manager.getRepository(BusinessProcess), audit);
  return new BusinessProcessesController(svc, deleteSvc);
}

/** The routes read the Express request: tenant, person and the transaction's manager. */
function req(seed: CreationSeed, userId: string, runner: QueryRunner) {
  return { tenant: { id: seed.tenantId }, user: { sub: userId }, queryRunner: { manager: runner.manager } };
}

async function count(runner: QueryRunner, sql: string, params: unknown[]): Promise<number> {
  const [{ n }] = await runner.query(sql, params);
  return n;
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (BusinessProcessesController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'business_processes', level: 'member' }, `${method} needs business_processes:member`);
  }
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { business_processes: 'member', applications: 'reader' });
    const { tenantId, creatorId, otherId } = seed;
    const controller = controllerFor(runner);
    const asCreator = req(seed, creatorId, runner);

    const created: any = await controller.create({ name: 'Order-to-Cash (O2C)' }, asCreator);
    assert.equal(typeof created.creation_token, 'string', 'the create route hands a creation token');
    const other: any = await controller.create({ name: 'Procure-to-Pay (P2P)' }, asCreator);

    const fresh = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    // A description, a type and an application link: what the confirmation lists.
    await controller.update(created.id, { description: 'From order to payment.', process_type: 'core' }, asCreator);
    const [application] = await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenantId, `CRM ${randomUUID().slice(0, 8)}`],
    );
    await runner.query(
      `INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)`,
      [tenantId, application.id, created.id],
    );
    await new AuditService(runner.manager.getRepository(AuditLog)).log({
      table: 'application_business_processes', recordId: created.id, action: 'update',
      before: null, after: { application_id: application.id }, userId: creatorId,
    }, { manager: runner.manager });
    const edited = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(edited, { changes: { fields: 2, children: { application: 1 } } }, 'the description, the type, one application link');

    // Another person's token for this process, another process's token, none, an expired one: refused.
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, req(seed, otherId, runner)), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, req(seed, otherId, runner)), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, asCreator), 'other process');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, asCreator), 'no token');
    const expired = issueCreationToken(
      { tenantId, family: 'business-processes', recordId: created.id, userId: creatorId },
      { now: Date.now() - 25 * 60 * 60 * 1000 },
    );
    await refusedAsExpired(controller.cancelCreation(created.id, { token: expired }, asCreator), 'expired token');

    // Another person wrote on the other process: its creator's cancel is over (preflight and cancel).
    await auditedEdit(runner, 'business_processes', other.id, otherId);
    await refusedAsExpired(controller.creationChanges(other.id, other.creation_token, asCreator), 'another author, preflight');
    await refusedAsExpired(controller.cancelCreation(other.id, { token: other.creation_token }, asCreator), 'another author');

    // The creator, a member without the delete level (admin), cancels it with its token.
    await controller.cancelCreation(created.id, { token: created.creation_token }, asCreator);
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM business_processes WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]), 0, 'the process is gone');
    assert.equal(
      await count(runner, `SELECT count(*)::int AS n FROM application_business_processes WHERE tenant_id = $1 AND business_process_id = $2`, [tenantId, created.id]),
      0,
      'its application link is gone',
    );
    assert.equal(
      await count(runner, `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'application_business_processes' AND record_id = $2 AND after_json IS NULL AND before_json->>'application_id' = $3`, [tenantId, created.id, application.id]),
      1,
      'the link removal is audited as an unlink',
    );
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'business_processes', created.id), [creatorId], 'the delete is audited under its creator');
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM business_processes WHERE tenant_id = $1 AND id = $2`, [tenantId, other.id]), 1, 'the other process stays');
  });
}

async function testAnInterfaceStillRefusesTheCancel() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { business_processes: 'member' });
    const controller = controllerFor(runner);
    const asCreator = req(seed, seed.creatorId, runner);
    const created: any = await controller.create({ name: 'Hire-to-Retire (H2R)' }, asCreator);
    const [source] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'HR source') RETURNING id`, [seed.tenantId]);
    const [target] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'HR target') RETURNING id`, [seed.tenantId]);
    await runner.query(
      `INSERT INTO interfaces (tenant_id, interface_reference, name, business_process_id, source_application_id, target_application_id,
                               integration_route_type, data_category, business_purpose)
       VALUES ($1, 'IF-HR', 'HR feed', $2, $3, $4, 'direct', 'master_data', 'Employees')`,
      [seed.tenantId, created.id, source.id, target.id],
    );
    await assert.rejects(
      controller.cancelCreation(created.id, { token: created.creation_token }, asCreator),
      (error: unknown) => error instanceof RecordInUseException,
      'an interface keeps the process',
    );
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testCreatorCancelsTheCreation();
    console.log('  ok testCreatorCancelsTheCreation');
    await testAnInterfaceStillRefusesTheCancel();
    console.log('  ok testAnInterfaceStillRefusesTheCancel');
  } finally {
    await dataSource.destroy();
  }
  console.log('business-process-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
