// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
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
  writeManagedDocument,
  type CreationSeed,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioRequestsController } from '../portfolio-requests.controller';
import { PortfolioRequestsService } from '../portfolio-requests.service';

// "Cancel creation" of a request (lot 1b of the creation frame): `POST /portfolio/requests` hands
// the creator a token; `GET :id/creation` counts what was written since the creation (history,
// edited purpose and risks documents, attachments); `DELETE :id/creation` deletes the request for
// its creator at the create level (member), through the request delete and its audit entry.
// Another person's token, another request's, a missing or an expired one is refused with
// `CREATION_CANCEL_EXPIRED`. (A converted request, the family's own refusal, cannot be a fresh one.)

function controllerFor(runner: QueryRunner) {
  const manager = runner.manager;
  const storage = recordingStorage();
  const svc = new PortfolioRequestsService(
    manager.getRepository(PortfolioRequest),
    new AuditService(manager.getRepository(AuditLog)),
    storage as any,
    {} as any,
    {} as any,
    {} as any,
    new ItemNumberService() as any,
    {} as any,
    managedDocumentServices(manager),
  );
  const controller = Object.create(PortfolioRequestsController.prototype) as PortfolioRequestsController;
  Object.assign(controller, { svc });
  return { controller, storage };
}

/** The request routes read the Express request: tenant, person and the transaction's manager. */
function req(seed: CreationSeed, userId: string, runner: QueryRunner) {
  return { tenant: { id: seed.tenantId }, user: { sub: userId }, queryRunner: { manager: runner.manager } };
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (PortfolioRequestsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'portfolio_requests', level: 'member' }, `${method} needs portfolio_requests:member`);
  }
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { portfolio_requests: 'member' });
    const { tenantId, creatorId, otherId } = seed;
    const { controller, storage } = controllerFor(runner);
    const asCreator = req(seed, creatorId, runner);

    const created: any = await controller.create({ name: 'Cancel creation spec' }, asCreator);
    assert.equal(typeof created.creation_token, 'string', 'the create route hands a creation token');
    assert.ok(created.item_number > 0, 'the request has its reference');
    assert.equal(await boundDocuments(runner, tenantId, 'requests', created.id), 2, 'purpose and risks are provisioned');
    const other: any = await controller.create({ name: 'Another request' }, asCreator);

    const fresh = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    // A written purpose and an attachment: what the confirmation lists.
    await writeManagedDocument(runner, tenantId, 'requests', created.id, 'purpose', 'Why we need it.');
    await runner.query(
      `INSERT INTO portfolio_request_attachments (tenant_id, request_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'brief.pdf', 'brief.pdf', 10, $3)`,
      [tenantId, created.id, `requests/${created.id}/brief.pdf`],
    );
    const edited = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(edited, { changes: { fields: 0, children: { document: 1, attachment: 1 } } }, 'one document, one attachment');

    // Another person's token for this request, another request's token, none, an expired one: refused.
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, req(seed, otherId, runner)), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, req(seed, otherId, runner)), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, asCreator), 'other request');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, asCreator), 'no token');
    const expired = issueCreationToken(
      { tenantId, family: 'requests', recordId: created.id, userId: creatorId },
      { now: Date.now() - 25 * 60 * 60 * 1000 },
    );
    await refusedAsExpired(controller.cancelCreation(created.id, { token: expired }, asCreator), 'expired token');

    // The creator, a member without the delete level (admin), cancels it with its token.
    await controller.cancelCreation(created.id, { token: created.creation_token }, asCreator);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM portfolio_requests WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'the request is gone');
    assert.equal(await boundDocuments(runner, tenantId, 'requests', created.id), 0, 'its documents are gone');
    assert.deepEqual(storage.deleted, [`requests/${created.id}/brief.pdf`], 'its attachment file is removed');
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'portfolio_requests', created.id), [creatorId], 'the delete is audited under its creator');
    const [{ kept }] = await runner.query(`SELECT count(*)::int AS kept FROM portfolio_requests WHERE tenant_id = $1 AND id = $2`, [tenantId, other.id]);
    assert.equal(kept, 1, 'the other request stays');
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
  console.log('request-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
