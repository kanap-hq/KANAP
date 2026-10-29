// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { Company } from '../../companies/company.entity';
import { CompaniesDeleteService } from '../../companies/companies-delete.service';
import { Document } from '../../knowledge/document.entity';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { PortfolioRequest } from '../../portfolio/portfolio-request.entity';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { AuditLogsService } from '../../audit/audit-logs.service';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { AiEntityService } from '../../ai/ai-entity.service';
import { AiAggregateExecutor } from '../../ai/query/ai-aggregate.executor';
import { AiTaskMutationSupportService } from '../../ai/mutation/ai-task-mutation-support.service';
import { UpdateTaskFieldsAiMutationOperation } from '../../ai/mutation/operations/update-task-fields.ai-mutation-operation';
import { AiQueryExecutor } from '../../ai/query/ai-query.executor';
import { TasksController } from '../../spend/tasks.controller';
import { TasksService } from '../../spend/tasks.service';
import { TasksDeleteService } from '../../tasks/tasks-delete.service';
import { taskCsvConfig } from '../../tasks/task-csv.config';
import { Task } from '../../tasks/task.entity';
import { TasksCsvService } from '../../tasks/tasks-csv.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import {
  assert,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  setTenant,
} from '../../spend/__tests__/round-inputs.fixtures';
import { taskIncidentVisibilitySql, type IncidentViewer } from '../incident-visibility';
import { linkedReadsFromContext } from '../../common/relations/linked-reads';

// A restricted incident, its review and its tasks do not exist for a reader who
// is neither incidents:admin, its reporter nor its owner: the task is absent from
// the list, the detail, the filter values, the related-task tabs, the CSV export,
// the search index, Plaid (query, aggregate, filter values, detail) and the task
// resolution used by comments and attachments; its audit rows (incident, journal,
// links, attachments, review, task) are absent from the audit log's list, detail
// and export. The reporter and an incidents:admin still see everything.

type Seed = {
  tenantId: string;
  adminId: string;
  readerId: string;
  reporterId: string;
  ownerId: string;
  restrictedIncidentId: string;
  publicIncidentId: string;
  restrictedTaskId: string;
  publicTaskId: string;
  restrictedEntryId: string;
  restrictedAttachmentId: string;
  restrictedTaskAttachmentId: string;
  restrictedTimeEntryId: string;
  reviewDocumentId: string;
  reviewDocumentAttachmentId: string;
  documentIncidentId: string;
  sharedDocumentId: string;
  assetId: string;
  applicationId: string;
  companyId: string;
  requestId: string;
  auditIds: Record<string, string>;
};

const RESTRICTED_TITLE = 'Remplacer le routeur après compromission du compte';
const PUBLIC_TITLE = 'Public follow-up';
const AUDIT_MARK = 'RESTRICTED-AUDIT-MARK';

async function seedPerson(
  runner: QueryRunner,
  tenantId: string,
  roleName: string,
  permissions: Record<string, string>,
  names: { first: string; last: string },
): Promise<string> {
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const roleId = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
    [tenantId, roleName],
  )).id as string;
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(
      `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`,
      [tenantId, roleId, resource, level],
    );
  }
  const row = await one(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status)
     VALUES ($1, $2, $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, roleId, names.first, names.last, `${names.first.toLowerCase()}-${tenantId.slice(0, 8)}@example.invalid`],
  );
  return row.id as string;
}

async function seedAudit(
  runner: QueryRunner,
  tenantId: string,
  table: string,
  recordId: string | null,
): Promise<string> {
  const marker = `${AUDIT_MARK}-${table}`;
  const [row] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id, source)
     VALUES ($1, $2, $3, 'update', $4::jsonb, $5::jsonb, NULL, 'system')
     RETURNING id`,
    [tenantId, table, recordId, JSON.stringify({ marker }), JSON.stringify({ marker })],
  );
  return row.id as string;
}

async function seed(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  await setTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];

  const adminId = await seedPerson(runner, tenantId, 'Incident Admin', { incidents: 'admin' }, { first: 'Ada', last: 'Admin' });
  const readerId = await seedPerson(
    runner,
    tenantId,
    'Reader',
    { incidents: 'reader', tasks: 'reader', users: 'admin', knowledge: 'reader' },
    { first: 'Rita', last: 'Reader' },
  );
  const reporterId = await seedPerson(
    runner,
    tenantId,
    'Reporter',
    { incidents: 'reader', tasks: 'reader', users: 'admin', knowledge: 'reader' },
    { first: 'Remy', last: 'Reporter' },
  );
  const ownerId = await seedPerson(
    runner,
    tenantId,
    'Owner',
    { incidents: 'reader', tasks: 'reader', users: 'admin', knowledge: 'reader' },
    { first: 'Olga', last: 'Owner' },
  );

  const restrictedIncident = await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, reporter_user_id, owner_user_id)
     VALUES ($1, 1, 'Compromised account', 'major', true, $2, $3) RETURNING id`,
    [tenantId, reporterId, ownerId],
  );
  const publicIncident = await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, reporter_user_id)
     VALUES ($1, 2, 'Public outage', 'minor', false, $2) RETURNING id`,
    [tenantId, reporterId],
  );

  const restrictedTask = await one(
    `INSERT INTO tasks (tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels)
     VALUES ($1, 1, $2, 'Corrective action of the restricted incident', 'open', 'incident', $3, '["restricted-label"]'::jsonb)
     RETURNING id`,
    [tenantId, RESTRICTED_TITLE, restrictedIncident.id],
  );
  const publicTask = await one(
    `INSERT INTO tasks (tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels)
     VALUES ($1, 2, $2, 'Corrective action of the public incident', 'open', 'incident', $3, '["public-label"]'::jsonb)
     RETURNING id`,
    [tenantId, PUBLIC_TITLE, publicIncident.id],
  );

  const entry = await one(
    `INSERT INTO incident_entries (tenant_id, incident_id, kind, content, occurred_at)
     VALUES ($1, $2, 'note', 'Restricted journal note', now()) RETURNING id`,
    [tenantId, restrictedIncident.id],
  );
  const attachment = await one(
    `INSERT INTO incident_attachments (tenant_id, incident_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'evidence.pdf', 'evidence.pdf', 'files/evidence.pdf') RETURNING id`,
    [tenantId, restrictedIncident.id],
  );
  const taskAttachment = await one(
    `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'task-evidence.pdf', 'task-evidence.pdf', 'files/task-evidence.pdf') RETURNING id`,
    [tenantId, restrictedTask.id],
  );
  const timeEntry = await one(
    `INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at)
     VALUES ($1, $2, 1.5, now()) RETURNING id`,
    [tenantId, restrictedTask.id],
  );

  const asset = await one(
    `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
     VALUES ($1, 'Restricted router', 'physical_server', 'prod', 'active', now(), now()) RETURNING id`,
    [tenantId],
  );
  const application = await one(
    `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Restricted portal') RETURNING id`,
    [tenantId],
  );
  const technology = await one(
    `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 1, 'Restricted firewall', 'database') RETURNING id`,
    [tenantId],
  );
  await runner.query(
    `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`,
    [tenantId, restrictedIncident.id, asset.id],
  );
  await runner.query(
    `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`,
    [tenantId, restrictedIncident.id, application.id],
  );
  await runner.query(
    `INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3)`,
    [tenantId, restrictedIncident.id, technology.id],
  );
  await runner.query(
    `INSERT INTO task_assets (tenant_id, task_id, asset_id) VALUES ($1, $2, $3)`,
    [tenantId, restrictedTask.id, asset.id],
  );
  await runner.query(
    `INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`,
    [tenantId, restrictedTask.id, application.id],
  );

  const company = await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Restricted company', 'FR', 'Paris') RETURNING id`,
    [tenantId],
  );
  await runner.query(
    `UPDATE tasks SET company_id = $3 WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, [restrictedTask.id, publicTask.id], company.id],
  );
  const request = await one(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, origin_task_id)
     VALUES ($1, 1, 'Origin request', $2) RETURNING id`,
    [tenantId, restrictedTask.id],
  );

  const library = await one(
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Managed', $2) RETURNING id`,
    [tenantId, `managed-${tenantId.slice(0, 8)}`],
  );
  const reviewDocument = await one(
    `INSERT INTO documents (tenant_id, item_number, title, library_id)
     VALUES ($1, 1, 'INC-1 - Compromised account - Incident review', $2) RETURNING id`,
    [tenantId, library.id],
  );
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id, hidden_from_entity_knowledge)
     VALUES ($1, 'incidents', $2, 'review', $3, true)`,
    [tenantId, restrictedIncident.id, reviewDocument.id],
  );
  const documentIncident = await one(
    `INSERT INTO document_incidents (tenant_id, document_id, incident_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, reviewDocument.id, restrictedIncident.id],
  );
  const documentAttachment = await one(
    `INSERT INTO document_attachments (tenant_id, document_id, original_filename, stored_filename, storage_path, size)
     VALUES ($1, $2, 'review-evidence.pdf', 'review-evidence.pdf', 'files/review-evidence.pdf', 10) RETURNING id`,
    [tenantId, reviewDocument.id],
  );
  const sharedDocument = await one(
    `INSERT INTO documents (tenant_id, item_number, title, library_id)
     VALUES ($1, 2, 'Shared runbook', $2) RETURNING id`,
    [tenantId, library.id],
  );
  await runner.query(
    `INSERT INTO document_tasks (tenant_id, document_id, task_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, sharedDocument.id, restrictedTask.id, publicTask.id],
  );

  const auditIds: Record<string, string> = {
    incident: await seedAudit(runner, tenantId, 'incidents', restrictedIncident.id),
    entry: await seedAudit(runner, tenantId, 'incident_entries', entry.id),
    asset: await seedAudit(runner, tenantId, 'incident_assets', restrictedIncident.id),
    application: await seedAudit(runner, tenantId, 'incident_applications', restrictedIncident.id),
    technology: await seedAudit(runner, tenantId, 'incident_technologies', restrictedIncident.id),
    attachment: await seedAudit(runner, tenantId, 'incident_attachments', attachment.id),
    document: await seedAudit(runner, tenantId, 'documents', reviewDocument.id),
    task: await seedAudit(runner, tenantId, 'tasks', restrictedTask.id),
    taskAttachment: await seedAudit(runner, tenantId, 'task_attachments', taskAttachment.id),
    taskTimeEntry: await seedAudit(runner, tenantId, 'task_time_entries', timeEntry.id),
    documentAttachment: await seedAudit(runner, tenantId, 'document_attachments', documentAttachment.id),
    documentIncident: await seedAudit(runner, tenantId, 'document_incidents', documentIncident.id),
    control: await seedAudit(runner, tenantId, 'suppliers', null),
  };

  return {
    tenantId,
    adminId,
    readerId,
    reporterId,
    ownerId,
    restrictedIncidentId: restrictedIncident.id,
    publicIncidentId: publicIncident.id,
    restrictedTaskId: restrictedTask.id,
    publicTaskId: publicTask.id,
    restrictedEntryId: entry.id,
    restrictedAttachmentId: attachment.id,
    restrictedTaskAttachmentId: taskAttachment.id,
    restrictedTimeEntryId: timeEntry.id,
    reviewDocumentId: reviewDocument.id,
    reviewDocumentAttachmentId: documentAttachment.id,
    documentIncidentId: documentIncident.id,
    sharedDocumentId: sharedDocument.id,
    assetId: asset.id,
    applicationId: application.id,
    companyId: company.id,
    requestId: request.id,
    auditIds,
  };
}

function viewer(userId: string, isAdmin: boolean): IncidentViewer {
  return { userId, isAdmin };
}

function context(runner: QueryRunner, seed: Seed, userId: string) {
  return { manager: runner.manager, tenantId: seed.tenantId, userId };
}

function tasksService(): TasksService {
  return new TasksService(undefined as any);
}

async function assertNotFound(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof NotFoundException);
}

async function notFoundMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof NotFoundException);
    return (err as Error).message;
  }
  throw new Error('expected a not found');
}

async function testTaskReads(): Promise<void> {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'restricted-tasks');
    const svc = tasksService();
    const opts = (v: IncidentViewer) => ({ manager: runner.manager, tenantId: s.tenantId, viewer: v });

    const adminPage = await svc.listAllTasks({}, opts(viewer(s.adminId, true)));
    const reporterPage = await svc.listAllTasks({}, opts(viewer(s.reporterId, false)));
    const ownerPage = await svc.listAllTasks({}, opts(viewer(s.ownerId, false)));
    const readerPage = await svc.listAllTasks({}, opts(viewer(s.readerId, false)));
    assert.equal(adminPage.total, 2, 'incidents:admin sees every task');
    assert.equal(reporterPage.total, 2, 'the reporter sees their incident task');
    assert.equal(ownerPage.total, 2, 'the owner sees their incident task');
    assert.equal(readerPage.total, 1, 'the reader sees the public task only');
    assert.deepEqual(readerPage.items.map((row) => row.id), [s.publicTaskId]);

    assert.equal(await svc.getOne(s.restrictedTaskId, opts(viewer(s.readerId, false))), null);
    assert.ok(await svc.getOne(s.restrictedTaskId, opts(viewer(s.reporterId, false))));
    assert.ok(await svc.getOne(s.restrictedTaskId, opts(viewer(s.ownerId, false))));
    assert.ok(await svc.getOne(s.restrictedTaskId, opts(viewer(s.adminId, true))));

    // Over HTTP the id lives in `req.user.sub`: the controller path must find the
    // reporter and the owner, and answer a third person like a missing task.
    const controller = new (TasksController as any)(svc);
    const reqFor = (userId: string) => ({
      user: { sub: userId },
      isAdmin: false,
      permissions: { tasks: 'reader', incidents: 'reader' },
      queryRunner: { manager: runner.manager },
      tenant: { id: s.tenantId },
    });
    for (const [label, userId] of [['reporter', s.reporterId], ['owner', s.ownerId]] as const) {
      const page = await controller.list({}, reqFor(userId));
      assert.equal(page.total, 2, `the ${label} sees their task in the list over HTTP`);
      assert.ok(page.items.some((row: any) => row.id === s.restrictedTaskId));
      const detail = await controller.getOne(s.restrictedTaskId, reqFor(userId));
      assert.equal(detail.id, s.restrictedTaskId, `the ${label} opens their task over HTTP`);
    }
    await assertNotFound(controller.getOne(s.restrictedTaskId, reqFor(s.readerId)));
    const hiddenMessage = await notFoundMessage(controller.getOne('T-1', reqFor(s.readerId)));
    const missingMessage = await notFoundMessage(controller.getOne('T-999', reqFor(s.readerId)));
    assert.equal(hiddenMessage, missingMessage, 'a hidden T-N answers like a missing one');
    assert.equal(hiddenMessage, 'Item not found');
    const hiddenSubRoute = await notFoundMessage(svc.assertVisible(s.restrictedTaskId, undefined, {
      manager: runner.manager,
      tenantId: s.tenantId,
      viewer: viewer(s.readerId, false),
    }));
    assert.equal(hiddenSubRoute, 'Item not found', 'a sub-route answers like a missing task');
    const thirdPage = await controller.list({}, reqFor(s.readerId));
    assert.equal(thirdPage.total, 1, 'a third person does not see the task in the list over HTTP');

    const readerLabels = await svc.listFilterValues({ fields: 'labels' }, opts(viewer(s.readerId, false)));
    assert.deepEqual(readerLabels.labels, ['public-label']);
    const reporterLabels = await svc.listFilterValues({ fields: 'labels' }, opts(viewer(s.reporterId, false)));
    assert.deepEqual(reporterLabels.labels, ['public-label', 'restricted-label']);

    // Comments and attachments resolve through the same `assertVisible`.
    await assert.rejects(
      svc.assertVisible(s.restrictedTaskId, undefined, { manager: runner.manager, tenantId: s.tenantId, viewer: viewer(s.readerId, false) }),
      (err: unknown) => err instanceof NotFoundException,
    );
    await svc.assertVisible(s.restrictedTaskId, undefined, {
      manager: runner.manager,
      tenantId: s.tenantId,
      viewer: viewer(s.reporterId, false),
    });

    // Related tasks of another record (the task is linked to the asset and the application
    // while its `related_object_type` stays `incident`).
    const unified = new TasksUnifiedService(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    const readerAssetTasks = await unified.listRelatedTasksForAsset(s.assetId, {}, {
      manager: runner.manager,
      tenantId: s.tenantId,
      viewer: viewer(s.readerId, false),
    });
    assert.equal(readerAssetTasks.total, 0);
    const reporterAssetTasks = await unified.listRelatedTasksForAsset(s.assetId, {}, {
      manager: runner.manager,
      tenantId: s.tenantId,
      viewer: viewer(s.reporterId, false),
    });
    assert.equal(reporterAssetTasks.total, 1);
    const readerAppTasks = await unified.listRelatedTasksForApplication(s.applicationId, {}, {
      manager: runner.manager,
      tenantId: s.tenantId,
      viewer: viewer(s.readerId, false),
    });
    assert.equal(readerAppTasks.total, 0);

    // The inline image route reads the same join and predicate.
    const [inlineAttachment] = await runner.query(
      `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path, source_field)
       VALUES ($1, $2, 'inline.png', 'inline.png', 'files/inline.png', 'description') RETURNING id`,
      [s.tenantId, s.restrictedTaskId],
    );
    const inlineParams: unknown[] = [s.tenantId, inlineAttachment.id];
    const inlineVisibility = taskIncidentVisibilitySql('t', viewer(s.readerId, false), inlineParams);
    const readerInline = await runner.query(
      `SELECT ta.id
       FROM task_attachments ta
       JOIN tasks t ON t.id = ta.task_id AND t.tenant_id = ta.tenant_id
       WHERE ta.tenant_id = $1 AND ta.id = $2 AND ta.source_field IS NOT NULL
         ${inlineVisibility}`,
      inlineParams,
    );
    assert.equal(readerInline.length, 0, 'the inline route finds no image of the hidden task');
    const reporterInlineParams: unknown[] = [s.tenantId, inlineAttachment.id];
    const reporterInlineVisibility = taskIncidentVisibilitySql('t', viewer(s.reporterId, false), reporterInlineParams);
    const reporterInline = await runner.query(
      `SELECT ta.id
       FROM task_attachments ta
       JOIN tasks t ON t.id = ta.task_id AND t.tenant_id = ta.tenant_id
       WHERE ta.tenant_id = $1 AND ta.id = $2 AND ta.source_field IS NOT NULL
         ${reporterInlineVisibility}`,
      reporterInlineParams,
    );
    assert.equal(reporterInline.length, 1, 'the reporter keeps the inline image');

    // The incident's own task list keeps the same rule.
    const readerIncidentTasks = await unified.listForTarget(
      { type: 'incident', id: s.restrictedIncidentId },
      { manager: runner.manager, tenantId: s.tenantId, viewer: viewer(s.readerId, false) },
    );
    assert.equal(readerIncidentTasks.length, 0);
    const reporterIncidentTasks = await unified.listForTarget(
      { type: 'incident', id: s.restrictedIncidentId },
      { manager: runner.manager, tenantId: s.tenantId, viewer: viewer(s.reporterId, false) },
    );
    assert.equal(reporterIncidentTasks.length, 1);

    // CSV export follows the list.
    const csv = new TasksCsvService(
      runner.manager.getRepository(Task),
      new CsvExportService(new CsvResolverService()),
      undefined as any,
    );
    const readerCsv = await csv.export({
      manager: runner.manager,
      tenantId: s.tenantId,
      language: 'en',
      viewer: viewer(s.readerId, false),
    });
    assert.ok(!readerCsv.content.includes(RESTRICTED_TITLE), 'the reader CSV omits the restricted task');
    assert.ok(readerCsv.content.includes(PUBLIC_TITLE), 'the reader CSV keeps the public task');
    const reporterCsv = await csv.export({
      manager: runner.manager,
      tenantId: s.tenantId,
      language: 'en',
      viewer: viewer(s.reporterId, false),
    });
    assert.ok(reporterCsv.content.includes(RESTRICTED_TITLE), 'the reporter CSV keeps their task');
  });
}

async function testPlaidAndSearch(): Promise<void> {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'restricted-ai');
    const svc = tasksService();
    const queryExecutor = new (AiQueryExecutor as any)(svc);
    const aggregateExecutor = new (AiAggregateExecutor as any)(svc);
    const knowledge = { listReadableLibraryIdsForUser: async () => null };
    const policy = {
      listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
      assertEntityTypeReadAccess: async () => undefined,
      adminFamiliesGap: async () => 'right',
      canReadKnowledge: async () => false,
      canReadEntityType: async () => true,
    };
    const entityService = new (AiEntityService as any)(knowledge, policy);

    for (const [label, userId, isAdmin, expected] of [
      ['admin', s.adminId, true, 1],
      ['reporter', s.reporterId, false, 1],
      ['reader', s.readerId, false, 0],
    ] as const) {
      const ctx = context(runner, s, userId);
      const query = await queryExecutor.execute(ctx, { entity_type: 'tasks', q: 'routeur' });
      assert.equal(query.total, expected, `query_entities tasks for the ${label}`);

      const aggregate = await aggregateExecutor.execute(ctx, { entity_type: 'tasks', group_by: 'status' });
      assert.equal(aggregate.total, expected === 0 ? 1 : 2, `aggregate_entities tasks for the ${label}`);

      const filterValues = await queryExecutor.executeFilterValues(ctx, { entity_type: 'tasks', fields: ['labels'] });
      assert.deepEqual(
        filterValues.values.labels,
        expected === 0 ? ['public-label'] : ['public-label', 'restricted-label'],
        `get_filter_values tasks for the ${label}`,
      );

      const search = await entityService.searchAll(ctx, { query: 'routeur', entity_types: ['tasks'] });
      assert.equal(search.items.length, expected, `search_index tasks for the ${label}`);
      if (expected > 0) assert.equal(search.items[0].id, s.restrictedTaskId);

      const listed = await entityService.listEntities(ctx, { entity_type: 'tasks' });
      assert.equal(listed.total, expected === 0 ? 1 : 2, `list_entities tasks for the ${label}`);
    }

    // get_entity_detail: the restricted task reads as missing for the reader.
    await queryExecutor.executeDetail(context(runner, s, s.reporterId), { entity_type: 'tasks', entity_id: s.restrictedTaskId });
    await assertNotFound(queryExecutor.executeDetail(context(runner, s, s.readerId), {
      entity_type: 'tasks',
      entity_id: s.restrictedTaskId,
    }));
    // The public task stays readable for everyone.
    const publicDetail = await queryExecutor.executeDetail(context(runner, s, s.readerId), {
      entity_type: 'tasks',
      entity_id: s.publicTaskId,
    });
    assert.equal(publicDetail.entity.id, s.publicTaskId);

    // AI mutations resolve a task the same way (update status, assignee, comment, fields).
    const support = new AiTaskMutationSupportService();
    await assertNotFound(support.resolveTaskSnapshot(context(runner, s, s.readerId) as any, 'T-1'));
    const reporterSnapshot = await support.resolveTaskSnapshot(context(runner, s, s.reporterId) as any, 'T-1');
    assert.equal(reporterSnapshot.task_id, s.restrictedTaskId);
    const updateFields = new (UpdateTaskFieldsAiMutationOperation as any)(undefined, undefined, undefined);
    await assertNotFound((updateFields as any).resolveTask(context(runner, s, s.readerId) as any, 'T-1'));
    const reporterTask = await (updateFields as any).resolveTask(context(runner, s, s.reporterId) as any, 'T-1');
    assert.equal(reporterTask.id, s.restrictedTaskId);
  });
}

async function testWritesById(): Promise<void> {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'restricted-writes');
    const reader = viewer(s.readerId, false);
    const reporter = viewer(s.reporterId, false);

    const deletes = new (TasksDeleteService as any)(
      runner.manager.getRepository(Task),
      undefined,
      undefined,
    );
    assert.deepEqual(
      await deletes.deleteCheck([s.restrictedTaskId], { manager: runner.manager, viewer: reader }),
      { refused: [] },
      'the delete check does not name the hidden task',
    );
    const readerBulk = await deletes.bulkDelete([s.restrictedTaskId], s.readerId, {
      manager: runner.manager,
      viewer: reader,
    });
    assert.equal(readerBulk.deleted.length, 0);
    assert.equal(readerBulk.failed[0]?.code, 'not_found');
    const [{ count: stillThere }] = await runner.query(
      `SELECT count(*)::int AS count FROM tasks WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.restrictedTaskId],
    );
    assert.equal(stillThere, 1, 'the hidden task was not deleted');

    // Converting a task copies its title, description and attachments: refuse it first.
    const requests = new (PortfolioRequestsService as any)(runner.manager.getRepository(PortfolioRequest));
    await assertNotFound(requests.convertFromTask(s.restrictedTaskId, {}, s.tenantId, s.readerId, {
      manager: runner.manager,
      viewer: reader,
    }));
    const [{ count: requestsFromTask }] = await runner.query(
      `SELECT count(*)::int AS count FROM portfolio_requests WHERE tenant_id = $1 AND origin_task_id = $2`,
      [s.tenantId, s.restrictedTaskId],
    );
    assert.equal(requestsFromTask, 1, 'no request was copied from the hidden task');

    // A CSV row that names the hidden task by id reads as not found.
    const csvRows: any[] = [{
      rowNumber: 2,
      raw: { id: s.restrictedTaskId, title: 'Overwritten title' },
      parsed: {},
      isInsert: true,
      errors: [],
      warnings: [],
    }];
    const csvContext: any = {
      manager: runner.manager,
      tenantId: s.tenantId,
      params: { dryRun: true, mode: 'enrich', operation: 'upsert' },
      resolverCache: new Map(),
      viewer: reader,
    };
    await (taskCsvConfig as any).beforeValidate(csvRows, csvContext);
    assert.equal(csvRows[0].errors.length, 1);
    assert.equal(csvRows[0].errors[0].column, 'id');
    assert.equal(csvRows[0].errors[0].message, 'Task not found');

    const reporterRows: any[] = [{ ...csvRows[0], errors: [], warnings: [] }];
    await (taskCsvConfig as any).beforeValidate(reporterRows, { ...csvContext, viewer: reporter });
    assert.equal(reporterRows[0].errors.length, 0, 'the reporter may import their task');
  });
}

async function testOtherReadSurfaces(): Promise<void> {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'restricted-other-reads');
    const reader = viewer(s.readerId, false);
    const reporter = viewer(s.reporterId, false);

    // The Knowledge link selector and the tasks a document lists.
    const knowledge = new (KnowledgeService as any)();
    (knowledge as any).users = {
      findById: async (id: string) => ({ id, status: 'enabled', role_id: null, role: null }),
    };
    (knowledge as any).permissions = {
      listForRoles: async () => new Map([['knowledge', 'reader']]),
    };
    const readerOptions = await knowledge.listRelationOptions('tasks', { limit: 50 }, {
      manager: runner.manager,
      userId: s.readerId,
      tenantId: s.tenantId,
    });
    const readerOptionIds = readerOptions.items.map((item: any) => item.id);
    assert.ok(!readerOptionIds.includes(s.restrictedTaskId), 'the link selector omits the restricted task');
    assert.ok(readerOptionIds.includes(s.publicTaskId));
    const reporterOptions = await knowledge.listRelationOptions('tasks', { limit: 50 }, {
      manager: runner.manager,
      userId: s.reporterId,
      tenantId: s.tenantId,
    });
    assert.ok(reporterOptions.items.some((item: any) => item.id === s.restrictedTaskId));

    const readerDocument = await knowledge.get(s.sharedDocumentId, {
      manager: runner.manager,
      userId: s.readerId,
      tenantId: s.tenantId,
    });
    assert.deepEqual(readerDocument.relations.tasks.map((task: any) => task.id), [s.publicTaskId]);
    const reporterDocument = await knowledge.get(s.sharedDocumentId, {
      manager: runner.manager,
      userId: s.reporterId,
      tenantId: s.tenantId,
    });
    assert.deepEqual(
      reporterDocument.relations.tasks.map((task: any) => task.id).sort(),
      [s.publicTaskId, s.restrictedTaskId].sort(),
    );

    // The origin task of a request.
    const requests = new (PortfolioRequestsService as any)(runner.manager.getRepository(PortfolioRequest));
    // Both read tasks: the origin task follows the incident visibility alone.
    const linked = { reads: linkedReadsFromContext({ permissions: { tasks: 'reader' } }) };
    const readerRequest = await requests.get(s.requestId, { include: 'origin_task' }, {
      manager: runner.manager,
      viewer: reader,
      linked,
    });
    assert.equal(readerRequest.origin_task, null);
    const reporterRequest = await requests.get(s.requestId, { include: 'origin_task' }, {
      manager: runner.manager,
      viewer: reporter,
      linked,
    });
    assert.equal(reporterRequest.origin_task.id, s.restrictedTaskId);

    // The tasks of a company, counted by the delete check.
    const companies = new (CompaniesDeleteService as any)(runner.manager.getRepository(Company), undefined);
    const readerCheck = await companies.deleteCheck([s.companyId], { manager: runner.manager, viewer: reader });
    const readerTasks = readerCheck.refused[0]?.usages.find((usage: any) => usage.type === 'tasks')?.total ?? 0;
    assert.equal(readerTasks, 1, 'the company check counts the public task only');
    const reporterCheck = await companies.deleteCheck([s.companyId], { manager: runner.manager, viewer: reporter });
    const reporterTasks = reporterCheck.refused[0]?.usages.find((usage: any) => usage.type === 'tasks')?.total ?? 0;
    assert.equal(reporterTasks, 2);

    // The origin task reference in the AI request context.
    const knowledgeStub = {
      getKnowledgeContextForEntity: async () => ({ access: null, total: 0, groups: [] }),
      listReadableLibraryIdsForUser: async () => null,
    };
    const policy = {
      listReadableEntityTypes: async () => [],
      assertEntityTypeReadAccess: async () => undefined,
      adminFamiliesGap: async () => 'right',
      canReadKnowledge: async () => false,
      canReadEntityType: async () => true,
    };
    const entityService = new (AiEntityService as any)(knowledgeStub, policy);
    const readerContext = await (entityService as any).buildRequestContext(
      context(runner, s, s.readerId),
      s.requestId,
      runner.manager,
    );
    assert.equal(readerContext.entity.metadata.origin_task, null);
    const reporterContext = await (entityService as any).buildRequestContext(
      context(runner, s, s.reporterId),
      s.requestId,
      runner.manager,
    );
    assert.match(String(reporterContext.entity.metadata.origin_task), /^T-1 /);
  });
}

async function testAuditLog(): Promise<void> {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'restricted-audit');
    const audit = new AuditLogsService(runner.manager.getRepository(AuditLog));
    const opts = (v: IncidentViewer) => ({ manager: runner.manager, viewer: v });

    const adminList = await audit.list({ limit: 100 }, opts(viewer(s.adminId, true)));
    assert.equal(adminList.total, 13, 'incidents:admin sees every audit row');
    const reporterList = await audit.list({ limit: 100 }, opts(viewer(s.reporterId, false)));
    assert.equal(reporterList.total, 13, 'the reporter sees the rows of their incident');
    const readerList = await audit.list({ limit: 100 }, opts(viewer(s.readerId, false)));
    assert.equal(readerList.total, 1, 'the reader sees only the unrelated audit row');

    const readerValues = await audit.listFilterValues({ fields: 'table_name' }, opts(viewer(s.readerId, false)));
    assert.deepEqual(readerValues.table_name, ['suppliers']);
    const reporterValues = await audit.listFilterValues({ fields: 'table_name' }, opts(viewer(s.reporterId, false)));
    assert.ok(reporterValues.table_name.includes('incidents'), 'the reporter sees the incident table');

    for (const id of Object.values(s.auditIds)) {
      if (id === s.auditIds.control) continue;
      await assertNotFound(audit.getById(id, opts(viewer(s.readerId, false))));
      assert.ok(await audit.getById(id, opts(viewer(s.reporterId, false))));
      assert.ok(await audit.getById(id, opts(viewer(s.adminId, true))));
    }
    assert.ok(await audit.getById(s.auditIds.control, opts(viewer(s.readerId, false))));

    const exportText = async (v: IncidentViewer): Promise<string> => {
      const result = await audit.exportCsv({}, { manager: runner.manager, tenantId: s.tenantId, viewer: v });
      let content = '';
      for await (const part of result.chunks) content += part;
      return content;
    };
    const readerExport = await exportText(viewer(s.readerId, false));
    for (const table of ['incidents', 'incident_entries', 'incident_assets', 'incident_applications', 'incident_technologies', 'incident_attachments', 'documents', 'tasks', 'task_attachments', 'task_time_entries', 'document_attachments', 'document_incidents']) {
      assert.ok(!readerExport.includes(`${AUDIT_MARK}-${table}`), `the reader export omits the ${table} row`);
    }
    assert.ok(readerExport.includes(`${AUDIT_MARK}-suppliers`), 'the reader export keeps the unrelated row');
    const reporterExport = await exportText(viewer(s.reporterId, false));
    for (const table of ['incidents', 'incident_entries', 'incident_assets', 'incident_applications', 'incident_technologies', 'incident_attachments', 'documents', 'tasks', 'task_attachments', 'task_time_entries', 'document_attachments', 'document_incidents']) {
      assert.ok(reporterExport.includes(`${AUDIT_MARK}-${table}`), `the reporter export keeps the ${table} row`);
    }
  });
}

async function testDeletedIncidentStaysVisible(): Promise<void> {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'restricted-deleted');
    await setTenant(runner, tenantId);
    const readerId = await seedPerson(
      runner,
      tenantId,
      'Reader',
      { incidents: 'reader', tasks: 'reader', users: 'admin' },
      { first: 'Dora', last: 'Deleted' },
    );
    const missingIncidentId = '11111111-1111-4111-8111-111111111111';
    const [task] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id)
       VALUES ($1, 1, 'Task of a deleted incident', 'open', 'incident', $2) RETURNING id`,
      [tenantId, missingIncidentId],
    );
    const [auditRow] = await runner.query(
      `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source)
       VALUES ($1, 'incidents', $2, 'delete', '{}'::jsonb, '{}'::jsonb, 'system') RETURNING id`,
      [tenantId, missingIncidentId],
    );

    const viewer = { userId: readerId, isAdmin: false };
    const tasks = await tasksService().listAllTasks({}, { manager: runner.manager, tenantId, viewer });
    assert.equal(tasks.total, 1, 'a task whose incident no longer exists stays visible');
    assert.equal(tasks.items[0].id, task.id);

    const audit = new AuditLogsService(runner.manager.getRepository(AuditLog));
    const list = await audit.list({ limit: 100 }, { manager: runner.manager, viewer });
    assert.equal(list.total, 1, 'a row of a deleted incident stays visible');
    assert.equal(list.items[0].id, auditRow.id);
  });
}

void runSpecs('incident-restricted-tasks-audit', [
  ['task reads follow the incident visibility', testTaskReads],
  ['Plaid and search follow the incident visibility', testPlaidAndSearch],
  ['writes by id treat a hidden task as missing', testWritesById],
  ['the other read surfaces follow the incident visibility', testOtherReadSurfaces],
  ['audit log follows the incident visibility', testAuditLog],
  ['a deleted incident leaves its task and audit row visible', testDeletedIncidentStaysVisible],
]);
