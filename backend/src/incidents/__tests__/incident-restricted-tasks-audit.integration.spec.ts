// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
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
import type { IncidentViewer } from '../incident-visibility';

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
  reviewDocumentId: string;
  assetId: string;
  applicationId: string;
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
    { incidents: 'reader', tasks: 'reader', users: 'admin' },
    { first: 'Rita', last: 'Reader' },
  );
  const reporterId = await seedPerson(
    runner,
    tenantId,
    'Reporter',
    { incidents: 'reader', tasks: 'reader', users: 'admin' },
    { first: 'Remy', last: 'Reporter' },
  );
  const ownerId = await seedPerson(
    runner,
    tenantId,
    'Owner',
    { incidents: 'reader', tasks: 'reader', users: 'admin' },
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
  await runner.query(
    `INSERT INTO document_incidents (tenant_id, document_id, incident_id) VALUES ($1, $2, $3)`,
    [tenantId, reviewDocument.id, restrictedIncident.id],
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
    reviewDocumentId: reviewDocument.id,
    assetId: asset.id,
    applicationId: application.id,
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

async function testAuditLog(): Promise<void> {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'restricted-audit');
    const audit = new AuditLogsService(runner.manager.getRepository(AuditLog));
    const opts = (v: IncidentViewer) => ({ manager: runner.manager, viewer: v });

    const adminList = await audit.list({ limit: 100 }, opts(viewer(s.adminId, true)));
    assert.equal(adminList.total, 9, 'incidents:admin sees every audit row');
    const reporterList = await audit.list({ limit: 100 }, opts(viewer(s.reporterId, false)));
    assert.equal(reporterList.total, 9, 'the reporter sees the rows of their incident');
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
    for (const table of ['incidents', 'incident_entries', 'incident_assets', 'incident_applications', 'incident_technologies', 'incident_attachments', 'documents', 'tasks']) {
      assert.ok(!readerExport.includes(`${AUDIT_MARK}-${table}`), `the reader export omits the ${table} row`);
    }
    assert.ok(readerExport.includes(`${AUDIT_MARK}-suppliers`), 'the reader export keeps the unrelated row');
    const reporterExport = await exportText(viewer(s.reporterId, false));
    for (const table of ['incidents', 'incident_entries', 'incident_assets', 'incident_applications', 'incident_technologies', 'incident_attachments', 'documents', 'tasks']) {
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
  ['audit log follows the incident visibility', testAuditLog],
  ['a deleted incident leaves its task and audit row visible', testDeletedIncidentStaysVisible],
]);
