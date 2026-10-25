import * as assert from 'node:assert/strict';
import {
  auditLogIncidentVisibilityQueryBuilderClause,
  auditLogIncidentVisibilitySql,
  incidentRelatedLabelSql,
  incidentRelatedTitleSql,
  incidentVisibilitySql,
  incidentVisibleToViewer,
  incidentViewerFromContext,
  resolveIncidentViewer,
  taskIncidentVisibilityQueryBuilderClause,
  taskIncidentVisibilitySql,
  type IncidentViewer,
} from '../incident-visibility';

const ROW = {
  confidential: true,
  reporter_user_id: 'reporter-1',
  owner_user_id: 'owner-1',
};

const reader: IncidentViewer = { userId: 'reader-1', isAdmin: false };
const reporter: IncidentViewer = { userId: 'reporter-1', isAdmin: false };
const owner: IncidentViewer = { userId: 'owner-1', isAdmin: false };
const admin: IncidentViewer = { userId: 'admin-1', isAdmin: true };

function testVisibleToViewer(): void {
  assert.equal(incidentVisibleToViewer({ confidential: false }, reader), true);
  assert.equal(incidentVisibleToViewer(ROW, reader), false, 'a reader does not see a confidential row');
  assert.equal(incidentVisibleToViewer(ROW, reporter), true, 'the reporter still sees it');
  assert.equal(incidentVisibleToViewer(ROW, owner), true, 'the owner still sees it');
  assert.equal(incidentVisibleToViewer(ROW, admin), true, 'incidents:admin sees it');
  assert.equal(incidentVisibleToViewer(ROW, { userId: null, isAdmin: false }), false);
  assert.equal(incidentVisibleToViewer(ROW, undefined), false, 'missing viewer fails closed');
}

function testVisibilitySql(): void {
  const adminParams: unknown[] = ['tenant'];
  assert.equal(incidentVisibilitySql('i', admin, adminParams), '');
  assert.deepEqual(adminParams, ['tenant']);

  const noUser: unknown[] = ['tenant'];
  assert.equal(incidentVisibilitySql('i', { userId: null, isAdmin: false }, noUser), ' AND i.confidential = false');
  assert.deepEqual(noUser, ['tenant']);

  const readerParams: unknown[] = ['tenant'];
  assert.equal(
    incidentVisibilitySql('i', reader, readerParams),
    ' AND (i.confidential = false OR i.reporter_user_id = $2 OR i.owner_user_id = $2)',
  );
  assert.deepEqual(readerParams, ['tenant', 'reader-1']);
}

function testViewerFromContext(): void {
  assert.deepEqual(
    incidentViewerFromContext({ userId: 'u1', isAdmin: true, permissions: {} }),
    { userId: 'u1', isAdmin: true },
  );
  assert.deepEqual(
    incidentViewerFromContext({ userId: 'u1', isAdmin: false, permissions: { incidents: 'admin' } }),
    { userId: 'u1', isAdmin: true },
    'incidents:admin is treated as admin, not only the Administrator role',
  );
  assert.deepEqual(
    incidentViewerFromContext({ userId: 'u1', isAdmin: false, permissions: { incidents: 'contributor' } }),
    { userId: 'u1', isAdmin: false },
  );
}

async function testResolveViewerRequiresTenant(): Promise<void> {
  let queried = false;
  const manager = { query: async () => { queried = true; return [{ is_admin: true }]; } };
  const noTenant = await resolveIncidentViewer(manager as any, 'user-1', '');
  assert.equal(noTenant.userId, 'user-1');
  assert.equal(noTenant.isAdmin, false);
  assert.equal(queried, false, 'must not query without tenant_id');

  const noUser = await resolveIncidentViewer(manager as any, '', 'tenant-1');
  assert.equal(noUser.userId, null);
  assert.equal(noUser.isAdmin, false);
  assert.equal(queried, false);
}

function testTaskIncidentVisibilitySql(): void {
  // The admin predicate is empty: the query text does not change, no parameter is added.
  const adminParams: unknown[] = ['tenant'];
  assert.equal(taskIncidentVisibilitySql('t', admin, adminParams), '');
  assert.deepEqual(adminParams, ['tenant']);

  const readerParams: unknown[] = ['tenant'];
  const sql = taskIncidentVisibilitySql('t', reader, readerParams);
  assert.match(sql, /t\.related_object_type IS DISTINCT FROM 'incident'/);
  assert.match(sql, /FROM incidents i_task_visibility/);
  assert.match(sql, /i_task_visibility\.tenant_id = t\.tenant_id/);
  assert.match(sql, /i_task_visibility\.confidential = true/);
  assert.deepEqual(readerParams, ['tenant', 'reader-1']);

  const reporterParams: unknown[] = ['tenant'];
  const reporterSql = taskIncidentVisibilitySql('t', reporter, reporterParams);
  assert.match(reporterSql, /i_task_visibility\.reporter_user_id = \$2/);
  assert.match(reporterSql, /i_task_visibility\.owner_user_id = \$2/);

  const noUserParams: unknown[] = ['tenant'];
  assert.match(
    taskIncidentVisibilitySql('t', { userId: null, isAdmin: false }, noUserParams),
    /i_task_visibility\.confidential = true/,
  );
  assert.deepEqual(noUserParams, ['tenant'], 'no identity: no parameter');

  // A QueryBuilder gets the same predicate, with its parameter named.
  assert.deepEqual(taskIncidentVisibilityQueryBuilderClause('task', admin), { clause: '', params: {} });
  const named = taskIncidentVisibilityQueryBuilderClause('task', reader);
  assert.match(named.clause, /:taskIncidentViewerId/);
  assert.doesNotMatch(named.clause, /\$1/);
  assert.deepEqual(named.params, { taskIncidentViewerId: 'reader-1' });
}

function testAuditLogIncidentVisibilitySql(): void {
  const adminParams: unknown[] = ['tenant'];
  assert.equal(auditLogIncidentVisibilitySql('a', admin, adminParams), '');
  assert.deepEqual(adminParams, ['tenant']);

  const readerParams: unknown[] = ['tenant'];
  const sql = auditLogIncidentVisibilitySql('a', reader, readerParams);
  assert.match(sql, /NOT \(/);
  assert.match(sql, /a\.table_name IN \('incidents', 'incident_assets', 'incident_applications', 'incident_technologies'\)/);
  assert.match(sql, /a\.table_name = 'incident_entries'/);
  assert.match(sql, /a\.table_name = 'incident_attachments'/);
  assert.match(sql, /a\.table_name = 'documents'/);
  assert.match(sql, /integrated_document_bindings b_audit/);
  assert.match(sql, /a\.table_name = 'tasks'/);
  assert.match(sql, /tasks t_audit/);
  assert.match(sql, /i_audit\.tenant_id = a\.tenant_id/);
  assert.deepEqual(readerParams, ['tenant', 'reader-1']);

  const named = auditLogIncidentVisibilityQueryBuilderClause('a', reader);
  assert.match(named.clause, /:auditIncidentViewerId/);
  assert.doesNotMatch(named.clause, /\$1/);
  assert.deepEqual(named.params, { auditIncidentViewerId: 'reader-1' });
}

function testRelatedLabelSql(): void {
  assert.match(incidentRelatedLabelSql('inc'), /inc\.confidential/);
  assert.match(incidentRelatedLabelSql('inc'), /INC-.*item_number/);
  assert.equal(
    incidentRelatedTitleSql('rel_inc'),
    'CASE WHEN rel_inc.confidential THEN NULL ELSE rel_inc.title END',
  );
}

async function run(): Promise<void> {
  testVisibleToViewer();
  testVisibilitySql();
  testViewerFromContext();
  testTaskIncidentVisibilitySql();
  testAuditLogIncidentVisibilitySql();
  testRelatedLabelSql();
  await testResolveViewerRequiresTenant();
  console.log('incident-visibility.spec.ts: ok');
}

void run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
