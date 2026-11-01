// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { issueCreationToken } from '../../common/creation/creation-token';
import {
  boundDocuments,
  deletionAuthors,
  inRolledBackTransaction,
  managedDocumentServices,
  recordingStorage,
  refusedAsExpired,
  seedCreationTenant,
  tenantContext,
  writeManagedDocument,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { Incident } from '../incident.entity';
import { IncidentsController } from '../incidents.controller';
import { IncidentsDeleteService, IncidentsService } from '../services';

// "Cancel creation" of an incident (lot 1b of the creation frame): `POST /incidents` hands the
// creator a token beside the presented incident; `GET :id/creation` counts what was written since
// the creation (history, journal notes, the edited review, attachments), never the "Incident
// logged" entry nor the review as provisioned; `DELETE :id/creation` deletes the incident for its
// creator at the create level (contributor), through the incident delete and its refusals: an
// incident holding regulatory data stays (`INCIDENT_HAS_REGULATORY_RECORDS`). Another person's
// token, another incident's, a missing or an expired one is refused with `CREATION_CANCEL_EXPIRED`.

function controllerFor(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const integrated = managedDocumentServices(manager);
  const svc = new IncidentsService(manager.getRepository(Incident), audit, new ItemNumberService(), integrated);
  const storage = recordingStorage();
  const deleteSvc = new IncidentsDeleteService(manager.getRepository(Incident), storage as any, audit, integrated, new UserTimeAggregateService());
  const controller = Object.create(IncidentsController.prototype) as IncidentsController;
  Object.assign(controller, { svc, deleteSvc });
  return { controller, storage };
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (IncidentsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'incidents', level: 'contributor' }, `${method} needs incidents:contributor`);
  }
}

async function count(runner: QueryRunner, sql: string, params: unknown[]): Promise<number> {
  const [{ n }] = await runner.query(sql, params);
  return n;
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { incidents: 'contributor' });
    const { tenantId, creatorId, otherId } = seed;
    const { controller, storage } = controllerFor(runner);
    const asCreator = tenantContext(seed, creatorId, runner.manager);

    const created: any = await controller.create({ title: 'Cancel creation spec', severity: 'minor' } as any, asCreator);
    assert.equal(typeof created.creation_token, 'string', 'the create route hands a creation token');
    assert.equal(created.severity, 'minor', 'the presented incident comes back with it');
    assert.equal(await boundDocuments(runner, tenantId, 'incidents', created.id), 1, 'the review is provisioned');
    const other: any = await controller.create({ title: 'Another incident', severity: 'minor' } as any, asCreator);

    const fresh = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'the logged entry and the review template are no change');

    // A journal note, a filled review and an attachment.
    await runner.query(`INSERT INTO incident_entries (tenant_id, incident_id, kind, content, author_id) VALUES ($1, $2, 'note', 'Seen at 9:00.', $3)`, [
      tenantId,
      created.id,
      creatorId,
    ]);
    await writeManagedDocument(runner, tenantId, 'incidents', created.id, 'review', 'Root cause: a full disk.');
    const path = `incidents/${created.id}/log.txt`;
    await runner.query(
      `INSERT INTO incident_attachments (tenant_id, incident_id, original_filename, stored_filename, size, storage_path, uploaded_by)
       VALUES ($1, $2, 'log.txt', 'log.txt', 10, $3, $4)`,
      [tenantId, created.id, path, creatorId],
    );
    const edited = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(edited, { changes: { fields: 0, children: { document: 1, attachment: 1, journal_entry: 1 } } }, 'a note, a review, a file');

    // Another person's token, another incident's, none, an expired one: refused.
    const asOther = tenantContext(seed, otherId, runner.manager);
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, asOther), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, asOther), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, asCreator), 'other incident');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, asCreator), 'no token');
    const expired = issueCreationToken(
      { tenantId, family: 'incidents', recordId: created.id, userId: creatorId },
      { now: Date.now() - 25 * 60 * 60 * 1000 },
    );
    await refusedAsExpired(controller.cancelCreation(created.id, { token: expired }, asCreator), 'expired token');

    // Regulatory reporting data keeps the incident in the register, cancel or not.
    await runner.query(`UPDATE incidents SET personal_data_affected = true WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    await assert.rejects(controller.cancelCreation(created.id, { token: created.creation_token }, asCreator), (error: unknown) => {
      assert.ok(error instanceof ConflictException, 'a 409');
      assert.equal((error.getResponse() as any).code, 'INCIDENT_HAS_REGULATORY_RECORDS');
      return true;
    });
    await runner.query(`UPDATE incidents SET personal_data_affected = false WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);

    // The creator, a contributor without the delete level (admin), cancels it with its token.
    await controller.cancelCreation(created.id, { token: created.creation_token }, asCreator);
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM incidents WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]), 0, 'the incident is gone');
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM incident_entries WHERE tenant_id = $1 AND incident_id = $2`, [tenantId, created.id]), 0, 'its journal is gone');
    assert.equal(await boundDocuments(runner, tenantId, 'incidents', created.id), 0, 'its review is gone');
    assert.deepEqual(storage.deleted, [path], 'its attachment file is removed');
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'incidents', created.id), [creatorId], 'the delete is audited under its creator');
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM incidents WHERE tenant_id = $1 AND id = $2`, [tenantId, other.id]), 1, 'the other incident stays');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testCreatorCancelsTheCreation();
    console.log('  ok testCreatorCancelsTheCreation');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('incident-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
