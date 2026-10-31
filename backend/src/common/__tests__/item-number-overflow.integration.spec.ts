// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { EntityManager, EntityTarget, ObjectLiteral, type QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AiEntityService } from '../../ai/ai-entity.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { Document } from '../../knowledge/document.entity';
import { DocumentActivity } from '../../knowledge/document-activity.entity';
import { DocumentApplication } from '../../knowledge/document-application.entity';
import { DocumentAsset } from '../../knowledge/document-asset.entity';
import { DocumentAttachment } from '../../knowledge/document-attachment.entity';
import { DocumentClassification } from '../../knowledge/document-classification.entity';
import { DocumentContributor } from '../../knowledge/document-contributor.entity';
import { DocumentEditLock } from '../../knowledge/document-edit-lock.entity';
import { DocumentFolder } from '../../knowledge/document-folder.entity';
import { DocumentLibrary } from '../../knowledge/document-library.entity';
import { DocumentProject } from '../../knowledge/document-project.entity';
import { DocumentReference } from '../../knowledge/document-reference.entity';
import { DocumentRequest } from '../../knowledge/document-request.entity';
import { DocumentTask } from '../../knowledge/document-task.entity';
import { DocumentType } from '../../knowledge/document-type.entity';
import { DocumentVersion } from '../../knowledge/document-version.entity';
import { IntegratedDocumentBinding } from '../../knowledge/integrated-document-binding.entity';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioRequest } from '../../portfolio/portfolio-request.entity';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { PortfolioProjectsListService } from '../../portfolio/services/portfolio-projects-list.service';
import { resolveToUuid } from '../resolve-item-id';
import { TasksService } from '../../spend/tasks.service';
import { readTechnology } from '../../technologies/technology-rows';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

const OVERFLOW = '8149356107';

function knowledgeService(manager: EntityManager): KnowledgeService {
  const repo = <T extends ObjectLiteral>(target: EntityTarget<T>) => manager.getRepository(target);
  return new KnowledgeService(
    repo(Document), repo(DocumentFolder), repo(IntegratedDocumentBinding), repo(DocumentLibrary), repo(DocumentType),
    repo(DocumentVersion), repo(DocumentEditLock), repo(DocumentAttachment), repo(DocumentActivity),
    repo(DocumentContributor), repo(DocumentClassification), repo(DocumentReference), repo(DocumentApplication),
    repo(DocumentAsset), repo(DocumentProject), repo(DocumentRequest), repo(DocumentTask),
    { nextItemNumber: async () => 999999 } as any,
    { log: async () => undefined } as any,
    {} as any,
    {} as any,
    { deleteObject: async () => undefined } as any,
    {} as any,
    dataSource,
    {} as any,
    { findById: async () => null } as any,
    {} as any,
    {} as any,
  );
}

function entityService(manager: EntityManager): AiEntityService {
  return new AiEntityService(knowledgeService(manager) as any, {
    listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
    adminFamiliesGap: async () => 'right',
    canReadEntityType: async () => false,
  } as any);
}

async function expectNotFound(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => err instanceof NotFoundException);
}

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'item-overflow');
  const taskId = (await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, status) VALUES ($1, 12, 'Overflow task', 'open') RETURNING id`,
    [tenantId],
  ))[0].id as string;
  const projectId = (await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, status) VALUES ($1, 12, 'Overflow project', 'planned') RETURNING id`,
    [tenantId],
  ))[0].id as string;
  const requestId = (await runner.query(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status) VALUES ($1, 12, 'Overflow request', 'approved') RETURNING id`,
    [tenantId],
  ))[0].id as string;
  const libraryId = randomUUID();
  await runner.query(
    `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
     VALUES ($1, $2, 'Overflow library', $3, false, 0, now(), now())`,
    [libraryId, tenantId, `overflow-${libraryId.slice(0, 8)}`],
  );
  const documentId = (await runner.query(
    `INSERT INTO documents (
       tenant_id, item_number, title, summary, content_markdown, content_plain,
       library_id, status, revision, current_version_number, created_at, updated_at
     ) VALUES ($1, 12, 'Overflow runbook', 'summary', 'body', 'body', $2, 'published', 1, 0, now(), now())
     RETURNING id`,
    [tenantId, libraryId],
  ))[0].id as string;
  return { tenantId, taskId, projectId, requestId, documentId };
}

function hasId(result: { items: Array<{ id: string }> }, id: string): boolean {
  return result.items.some((item) => item.id === id);
}

async function testTasks() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const tasks = new TasksService(dataSource);
    const opts = { manager: runner.manager, tenantId: seeded.tenantId };
    const overflow = await tasks.listAllTasks({ q: OVERFLOW, limit: '10' }, opts);
    const prefixed = await tasks.listAllTasks({ q: `T-${OVERFLOW}`, limit: '10' }, opts);
    assert.equal(typeof overflow.total, 'number');
    assert.equal(hasId(overflow, seeded.taskId), false);
    assert.equal(hasId(prefixed, seeded.taskId), false);
    const byNumber = await tasks.listAllTasks({ q: '12', limit: '10' }, opts);
    const byRef = await tasks.listAllTasks({ q: 'T-12', limit: '10' }, opts);
    assert.equal(hasId(byNumber, seeded.taskId), true);
    assert.equal(hasId(byRef, seeded.taskId), true);
    assert.equal(await resolveToUuid('T-12', 'task', runner.manager), seeded.taskId);
    await expectNotFound(() => resolveToUuid(`T-${OVERFLOW}`, 'task', runner.manager));
  });
}

async function testProjects() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const projects = new PortfolioProjectsListService(runner.manager.getRepository(PortfolioProject));
    const opts = { manager: runner.manager, tenantId: seeded.tenantId };
    const overflow = await projects.list({ q: OVERFLOW, limit: '10' }, opts);
    const prefixed = await projects.list({ q: `PRJ-${OVERFLOW}`, limit: '10' }, opts);
    assert.equal(typeof overflow.total, 'number');
    assert.equal(hasId(overflow, seeded.projectId), false);
    assert.equal(hasId(prefixed, seeded.projectId), false);
    const byNumber = await projects.list({ q: '12', limit: '10' }, opts);
    const byRef = await projects.list({ q: 'PRJ-12', limit: '10' }, opts);
    assert.equal(hasId(byNumber, seeded.projectId), true);
    assert.equal(hasId(byRef, seeded.projectId), true);
    assert.equal(await resolveToUuid('PRJ-12', 'project', runner.manager), seeded.projectId);
    await expectNotFound(() => resolveToUuid(`PRJ-${OVERFLOW}`, 'project', runner.manager));
  });
}

async function testRequests() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const requests = new PortfolioRequestsService(
      runner.manager.getRepository(PortfolioRequest),
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    const opts = { manager: runner.manager, tenantId: seeded.tenantId };
    const overflow = await requests.list({ q: OVERFLOW, limit: '10' }, opts);
    const prefixed = await requests.list({ q: `REQ-${OVERFLOW}`, limit: '10' }, opts);
    assert.equal(typeof overflow.total, 'number');
    assert.equal(hasId(overflow, seeded.requestId), false);
    assert.equal(hasId(prefixed, seeded.requestId), false);
    const byNumber = await requests.list({ q: '12', limit: '10' }, opts);
    const byRef = await requests.list({ q: 'REQ-12', limit: '10' }, opts);
    assert.equal(hasId(byNumber, seeded.requestId), true);
    assert.equal(hasId(byRef, seeded.requestId), true);
    assert.equal(await resolveToUuid('REQ-12', 'request', runner.manager), seeded.requestId);
    await expectNotFound(() => resolveToUuid(`REQ-${OVERFLOW}`, 'request', runner.manager));
  });
}

async function testDocuments() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const knowledge = knowledgeService(runner.manager);
    const opts = { manager: runner.manager, tenantId: seeded.tenantId, userId: null };
    const overflow = await knowledge.list({ q: OVERFLOW, limit: '10' }, opts);
    const prefixed = await knowledge.list({ q: `DOC-${OVERFLOW}`, limit: '10' }, opts);
    const searched = await knowledge.search({ q: OVERFLOW, limit: 10 }, opts);
    assert.equal(typeof overflow.total, 'number');
    assert.equal(typeof searched.total, 'number');
    assert.equal(hasId(overflow, seeded.documentId), false);
    assert.equal(hasId(prefixed, seeded.documentId), false);
    const byRef = await knowledge.list({ q: 'DOC-12', limit: '10' }, opts);
    assert.equal(hasId(byRef, seeded.documentId), true);
    assert.equal(await knowledge.resolveDocumentId('DOC-12', runner.manager), seeded.documentId);
    await expectNotFound(() => knowledge.resolveDocumentId(`DOC-${OVERFLOW}`, runner.manager));
  });
}

async function testOtherReferences() {
  await inRolledBackTransaction(async (runner) => {
    await seed(runner);
    await expectNotFound(() => resolveToUuid(`INC-${OVERFLOW}`, 'incident', runner.manager));
    await expectNotFound(() => resolveToUuid(`OPX-${OVERFLOW}`, 'spend', runner.manager));
    await expectNotFound(() => readTechnology(runner.manager, randomUUID(), `TEC-${OVERFLOW}`));
  });
}

async function searchPlaid(runner: QueryRunner, tenantId: string, query: string) {
  return entityService(runner.manager).searchAll(
    {
      tenantId,
      userId: randomUUID(),
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
      manager: runner.manager,
    } as any,
    { query, entity_types: ['tasks', 'projects', 'requests', 'documents', 'incidents'], limit: 10 },
  );
}

async function testPlaid(indexEnabled: boolean) {
  const previous = process.env.AI_SEARCH_INDEX_ENABLED;
  process.env.AI_SEARCH_INDEX_ENABLED = indexEnabled ? 'true' : 'false';
  try {
    await inRolledBackTransaction(async (runner) => {
      const seeded = await seed(runner);
      for (const query of [OVERFLOW, `T-${OVERFLOW}`]) {
        const result = await searchPlaid(runner, seeded.tenantId, query);
        assert.deepEqual(result.failed_entity_types, [], JSON.stringify(result.warnings));
      }
    });
  } finally {
    if (previous === undefined) delete process.env.AI_SEARCH_INDEX_ENABLED;
    else process.env.AI_SEARCH_INDEX_ENABLED = previous;
  }
}

runSpecs('item-number-overflow.integration.spec', [
  ['tasks answer 200 for a long number and 404 for T-8149356107', testTasks],
  ['projects answer 200 for a long number and 404 for PRJ-8149356107', testProjects],
  ['requests answer 200 for a long number and 404 for REQ-8149356107', testRequests],
  ['documents answer 200 for a long number and 404 for DOC-8149356107', testDocuments],
  ['incident, budget and technology references beyond int4 answer 404', testOtherReferences],
  ['Plaid indexed search does not fail the families', () => testPlaid(true)],
  ['Plaid legacy search does not fail the families', () => testPlaid(false)],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
