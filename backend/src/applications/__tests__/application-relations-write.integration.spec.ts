// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  context, inRolledBackTransaction, NO_ACCESS, relationsService, runSpecs, seedRelations,
  type AuditEntry, type TaskReplaceCall,
} from './application-relations.fixtures';

// The writes of the Relations tab (lot R1): POST /applications/:id/requests/bulk-replace, and the
// single link and unlink routes (POST / DELETE /applications/:id/relations/:kind), which read the
// stored set under the application's lock and replace it through the owning service.

async function requestIds(runner: { query: (sql: string, params: unknown[]) => Promise<any> }, appId: string) {
  const rows: Array<{ request_id: string }> = await runner.query(
    `SELECT request_id FROM portfolio_request_applications WHERE application_id = $1 ORDER BY request_id`,
    [appId],
  );
  return rows.map((row) => row.request_id);
}

async function testRequestsBulkReplace() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'reqbulk');
    const svc = relationsService();
    const res = await svc.bulkReplaceRequests(seed.appId, [seed.requests.linked, seed.requests.free], context(runner.manager, seed));
    assert.deepEqual(res, { ok: true, added: 1, removed: 1 });
    assert.deepEqual(await requestIds(runner, seed.appId), [seed.requests.linked, seed.requests.free].sort());

    // Each changed request records the change in its own activity, by the caller.
    const activity: Array<{ request_id: string; author_id: string; changed_fields: any }> = await runner.query(
      `SELECT request_id, author_id, changed_fields FROM portfolio_activities WHERE request_id = ANY($1::uuid[]) ORDER BY request_id`,
      [[seed.requests.free, seed.requests.hidden]],
    );
    assert.equal(activity.length, 2);
    assert.ok(activity.every((row) => row.author_id === seed.userId && Array.isArray(row.changed_fields?.applications)));

    // Unknown ids and malformed ids are refused, nothing changes.
    await assert.rejects(svc.bulkReplaceRequests(seed.appId, ['not-an-id'], context(runner.manager, seed)), BadRequestException);
    await assert.rejects(
      svc.bulkReplaceRequests(seed.appId, ['00000000-0000-4000-8000-000000000000'], context(runner.manager, seed)),
      BadRequestException,
    );
    assert.deepEqual(await requestIds(runner, seed.appId), [seed.requests.linked, seed.requests.free].sort());

    // A caller who cannot read requests is refused.
    await assert.rejects(svc.bulkReplaceRequests(seed.appId, [], context(runner.manager, seed, { access: NO_ACCESS })), ForbiddenException);
  });
}

async function testRequestsBulkReplaceKeepsWhatTheScopeHides() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'reqscope');
    const scope = { userId: seed.userId };
    // The user only sees `linked`: an empty list unlinks it and keeps `hidden`.
    const res = await relationsService().bulkReplaceRequests(seed.appId, [], context(runner.manager, seed, { scopes: { request: scope } }));
    assert.deepEqual(res, { ok: true, added: 0, removed: 1 });
    assert.deepEqual(await requestIds(runner, seed.appId), [seed.requests.hidden]);
    // A request out of the user's reach cannot be linked.
    await assert.rejects(
      relationsService().bulkReplaceRequests(seed.appId, [seed.requests.free], context(runner.manager, seed, { scopes: { request: scope } })),
      BadRequestException,
    );
  });
}

async function testSingleLinks() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'single');
    const audit: AuditEntry[] = [];
    const taskCalls: TaskReplaceCall[] = [];
    const svc = relationsService({ audit, taskCalls });
    const ctx = context(runner.manager, seed);

    // A line: its nature is read on the server, the other links stay.
    assert.deepEqual(await svc.setLink('budget_lines', seed.appId, seed.lines.sameSupplier, true, ctx), { ok: true, changed: true });
    const lines: Array<{ spend_item_id: string }> = await runner.query(
      `SELECT spend_item_id FROM application_spend_items WHERE application_id = $1 ORDER BY spend_item_id`,
      [seed.appId],
    );
    assert.deepEqual(lines.map((r) => r.spend_item_id), [seed.lines.linked, seed.lines.noVersion, seed.lines.sameSupplier].sort());
    assert.equal(audit.at(-1)?.table, 'application_spend_items');
    assert.deepEqual(audit.at(-1)?.after, [seed.lines.linked, seed.lines.sameSupplier].sort());

    // Linking again changes nothing and writes no audit row.
    const auditCount = audit.length;
    assert.deepEqual(await svc.setLink('budget_lines', seed.appId, seed.lines.sameSupplier, true, ctx), { ok: true, changed: false });
    assert.equal(audit.length, auditCount);

    // A contract unlinked, then a project linked.
    await svc.setLink('contracts', seed.appId, seed.contracts.linked, false, ctx);
    assert.equal((await runner.query(`SELECT 1 FROM application_contracts WHERE application_id = $1`, [seed.appId])).length, 0);
    await svc.setLink('projects', seed.appId, seed.projects.carrier, true, ctx);
    const projects: Array<{ project_id: string }> = await runner.query(
      `SELECT project_id FROM application_projects WHERE application_id = $1 ORDER BY project_id`,
      [seed.appId],
    );
    assert.deepEqual(projects.map((r) => r.project_id), [seed.projects.linked, seed.projects.carrier].sort());

    // A request linked and unlinked through the request's own service.
    await svc.setLink('requests', seed.appId, seed.requests.free, true, ctx);
    await svc.setLink('requests', seed.appId, seed.requests.hidden, false, ctx);
    assert.deepEqual(await requestIds(runner, seed.appId), [seed.requests.linked, seed.requests.free].sort());

    // A task: the replacement gets the stored set less the one unlinked.
    await svc.setLink('tasks', seed.appId, seed.tasks.done, false, ctx);
    assert.deepEqual(taskCalls, [{ applicationId: seed.appId, taskIds: [seed.tasks.linked, seed.tasks.carried].sort(), scoped: false }]);

    // Refusals: a module the caller cannot read, an unknown line, a malformed id.
    await assert.rejects(svc.setLink('contracts', seed.appId, seed.contracts.linked, true, context(runner.manager, seed, { access: NO_ACCESS })), ForbiddenException);
    await assert.rejects(svc.setLink('budget_lines', seed.appId, '00000000-0000-4000-8000-000000000000', true, ctx), BadRequestException);
    await assert.rejects(svc.setLink('projects', seed.appId, 'nope', true, ctx), BadRequestException);
  });
}

async function testSingleTaskLinkUnderScope() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'taskscope');
    const taskCalls: TaskReplaceCall[] = [];
    const svc = relationsService({ taskCalls });
    const scope = { userId: seed.userId };
    // The scoped user sees only `linked`: linking another task sends the visible set plus it.
    await svc.setLink('tasks', seed.appId, seed.tasks.ofLinkedProject, true, context(runner.manager, seed, { scopes: { task: scope } }));
    assert.deepEqual(taskCalls, [{ applicationId: seed.appId, taskIds: [seed.tasks.linked, seed.tasks.ofLinkedProject].sort(), scoped: true }]);
    // A project out of the user's reach cannot be linked.
    await assert.rejects(
      svc.setLink('projects', seed.appId, seed.projects.other, true, context(runner.manager, seed, { scopes: { project: scope } })),
      BadRequestException,
    );
  });
}

runSpecs('application-relations-write.integration.spec', [
  testRequestsBulkReplace,
  testRequestsBulkReplaceKeepsWhatTheScopeHides,
  testSingleLinks,
  testSingleTaskLinkUnderScope,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
