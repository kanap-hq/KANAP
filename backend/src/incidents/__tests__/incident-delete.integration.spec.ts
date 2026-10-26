import 'dotenv/config';
// @database-spec: the database comes through round-inputs.fixtures (data-source).
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { IncidentsDeleteService } from '../services/incidents-delete.service';
import { RecordInUseException } from '../../common/record-in-use';
import { existingRecentItems } from '../../dashboard/recent-items';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Deleting an incident (`incidents-delete.service.ts`), against a real database:
// - what belongs to it goes: its review document (through `deleteForEntity`), its tasks, timeline
//   entries, attachments (rows, then files no other row uses), its search entry; the links to
//   applications, assets and Knowledge documents go and those objects stay; an audit entry is written;
// - each regulatory reporting field alone refuses the delete (409, INCIDENT_HAS_REGULATORY_RECORDS);
// - a closed or cancelled incident refuses the delete too (409, INCIDENT_CLOSED_OR_CANCELLED), in
//   the single delete, the bulk delete and the delete check: it keeps its number;
// - the counts the confirmation shows, refused incidents apart; a bulk delete refuses those and
//   deletes the others; another tenant's incident is not found;
// - the deleted incident leaves "Recently viewed".

type Seed = { tenantId: string; incidentId: string; otherId: string; appId: string; assetId: string; docId: string; reviewDocId: string; taskId: string; path: string };

async function seed(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  await setTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const incident = (n: number, title: string) => one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, $2, $3, 'minor') RETURNING id`,
    [tenantId, n, title],
  );
  const incidentId = await incident(1, `Outage ${tag}`);
  const otherId = await incident(2, `Kept ${tag}`);
  const appId = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `App ${tag}`]);
  const assetId = await one(
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', 'active', now(), now()) RETURNING id`,
    [tenantId, `srv-${tag}`],
  );
  const libraryId = await one(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Lib', $2) RETURNING id`, [tenantId, `lib-${tag}`]);
  const doc = (n: number, title: string) => one(
    `INSERT INTO documents (tenant_id, item_number, title, library_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, n, title, libraryId],
  );
  const docId = await doc(1, 'Runbook');
  const reviewDocId = await doc(2, 'Incident review');
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id)
     VALUES ($1, 'incidents', $2, 'review', $3)`,
    [tenantId, incidentId, reviewDocId],
  );
  const taskId = await one(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, 1, 'Fix it', 'incident', $2) RETURNING id`,
    [tenantId, incidentId],
  );
  const path = `files/${tenantId}/incidents/${incidentId}/${tag}.png`;
  for (const id of [incidentId, otherId]) {
    await runner.query(`INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`, [tenantId, id, appId]);
    await runner.query(`INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, id, assetId]);
    await runner.query(`INSERT INTO document_incidents (tenant_id, document_id, incident_id) VALUES ($1, $2, $3)`, [tenantId, docId, id]);
    await runner.query(`INSERT INTO incident_entries (tenant_id, incident_id, kind, content) VALUES ($1, $2, 'note', 'Noted')`, [tenantId, id]);
  }
  await runner.query(`INSERT INTO document_incidents (tenant_id, document_id, incident_id) VALUES ($1, $2, $3)`, [tenantId, reviewDocId, incidentId]);
  await runner.query(
    `INSERT INTO incident_attachments (tenant_id, incident_id, original_filename, stored_filename, storage_path) VALUES ($1, $2, 'shot.png', 'shot.png', $3)`,
    [tenantId, incidentId, path],
  );
  return { tenantId, incidentId, otherId, appId, assetId, docId, reviewDocId, taskId, path };
}

function fakes() {
  const deleted: string[] = [];
  const documentDeletes: unknown[][] = [];
  const audit = captureAudit();
  const storage = { deleteObject: async (path: string) => { deleted.push(path); } };
  const integrated = { deleteForEntity: async (...args: unknown[]) => { documentDeletes.push(args.slice(0, 3).concat([{ checkAccess: (args[3] as any)?.checkAccess }])); return 1; } };
  const timeAggregates = { recalculateUserMonth: async () => undefined };
  const svc = new IncidentsDeleteService({ manager: null } as any, storage as any, audit as any, integrated as any, timeAggregates as any);
  return { svc, deleted, documentDeletes, audit };
}

const count = async (runner: QueryRunner, sql: string, params: unknown[]) => (await runner.query(sql, params))[0].n as number;
const exists = async (runner: QueryRunner, table: string, id: string) => (await runner.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).length === 1;

const REGULATORY: Array<[string, string]> = [
  ['personal data affected', `personal_data_affected = true`],
  ['authority notification required', `authority_notification_required = true`],
  ['authority notified at', `authority_notified_at = now()`],
  ['notified parties', `notified_parties = 'CNIL'`],
];

async function testDeleteRemovesWhatBelongs() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'incdel-all');
    const { svc, deleted, documentDeletes, audit } = fakes();
    const opts = { manager: runner.manager };
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM search_index WHERE tenant_id = $1 AND entity_id = $2`, [a.tenantId, a.incidentId]), 1, 'indexed first');

    await svc.delete(a.incidentId, { ...opts, userId: null });

    assert.equal(await exists(runner, 'incidents', a.incidentId), false);
    assert.deepEqual(documentDeletes, [['incidents', a.incidentId, null, { checkAccess: false }]], 'the review document goes');
    assert.equal(await exists(runner, 'tasks', a.taskId), false, 'its task goes');
    for (const table of ['incident_entries', 'incident_attachments', 'incident_applications', 'incident_assets', 'document_incidents']) {
      assert.equal(await count(runner, `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND incident_id = $2`, [a.tenantId, a.incidentId]), 0, table);
      if (table === 'incident_attachments') continue;
      assert.equal(await count(runner, `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND incident_id = $2`, [a.tenantId, a.otherId]) > 0, true, `${table} of the other incident`);
    }
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM search_index WHERE tenant_id = $1 AND entity_id = $2`, [a.tenantId, a.incidentId]), 0, 'search entry');
    for (const [table, id] of [['applications', a.appId], ['assets', a.assetId], ['documents', a.docId], ['incidents', a.otherId]]) {
      assert.equal(await exists(runner, table, id), true, `${table} stays`);
    }
    assert.deepEqual(deleted, [a.path], 'the attachment file goes');
    assert.deepEqual(audit.entries.filter((e) => e.table === 'incidents').map((e) => [e.recordId, e.action]), [[a.incidentId, 'delete']]);

    const { existing } = await existingRecentItems(runner.manager, a.tenantId, [{ type: 'incident', id: a.incidentId }, { type: 'incident', id: a.otherId }]);
    assert.deepEqual(existing, [{ type: 'incident', id: a.otherId }], 'the deleted incident leaves Recently viewed');
  });
}

async function testImpactCounts() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'incdel-impact');
    const { svc } = fakes();
    const opts = { manager: runner.manager };
    assert.deepEqual(await svc.deleteCheck([a.incidentId], opts), {
      incidents: 1, blocked: 0, review_documents: 1, tasks: 1, entries: 1, attachments: 1, applications: 1, assets: 1, documents: 1, refused: [],
    });
    assert.deepEqual(await svc.deleteCheck([a.incidentId, a.otherId, 'nope'], opts), {
      incidents: 2, blocked: 0, review_documents: 1, tasks: 1, entries: 2, attachments: 1, applications: 1, assets: 1, documents: 1, refused: [],
    });
    await runner.query(`UPDATE incidents SET personal_data_affected = true, notified_parties = 'DPO' WHERE id = $1`, [a.incidentId]);
    assert.deepEqual(await svc.deleteCheck([a.incidentId, a.otherId], opts), {
      incidents: 1, blocked: 1, review_documents: 0, tasks: 0, entries: 1, attachments: 0, applications: 1, assets: 1, documents: 1,
      refused: [{ id: a.incidentId, name: 'INC-1 Outage incdel-impact', code: 'INCIDENT_HAS_REGULATORY_RECORDS', usages: [{ type: 'regulatory_records', total: 2 }] }],
    });
  });
}

async function testEachRegulatoryFieldRefuses() {
  for (const [label, set] of REGULATORY) {
    await inRolledBackTransaction(async (runner) => {
      const a = await seed(runner, 'incdel-reg');
      await runner.query(`UPDATE incidents SET ${set} WHERE id = $1`, [a.incidentId]);
      const { svc, deleted, documentDeletes } = fakes();
      let refusal: unknown = null;
      try {
        await svc.delete(a.incidentId, { manager: runner.manager, userId: null });
      } catch (err) {
        refusal = err;
      }
      assert.ok(refusal instanceof RecordInUseException && refusal instanceof ConflictException, `${label}: a 409, got ${String(refusal)}`);
      const body = (refusal as ConflictException).getResponse() as Record<string, unknown>;
      assert.equal(body.code, 'INCIDENT_HAS_REGULATORY_RECORDS', label);
      assert.deepEqual(body.usages, [{ type: 'regulatory_records', total: 1 }], label);
      assert.equal(await exists(runner, 'incidents', a.incidentId), true, `${label}: kept`);
      assert.equal(await exists(runner, 'tasks', a.taskId), true, `${label}: task kept`);
      assert.deepEqual(documentDeletes, [], `${label}: review kept`);
      assert.deepEqual(deleted, [], `${label}: files kept`);
    });
  }
}

async function testBulkDelete() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'incdel-bulk');
    await runner.query(`UPDATE incidents SET authority_notification_required = true WHERE id = $1`, [a.incidentId]);
    const { svc } = fakes();
    const result = await svc.bulkDelete([a.incidentId, a.otherId], null, { manager: runner.manager });
    assert.deepEqual(result.deleted, [a.otherId]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, a.incidentId);
    assert.equal((result.failed[0] as any).code, 'INCIDENT_HAS_REGULATORY_RECORDS');
    assert.equal(await exists(runner, 'incidents', a.incidentId), true);
    assert.equal(await exists(runner, 'incidents', a.otherId), false);
  });
}

async function testClosedAndCancelledRefuseTheDelete() {
  for (const status of ['closed', 'cancelled'] as const) {
    await inRolledBackTransaction(async (runner) => {
      const tag = `incdel-${status}`;
      const a = await seed(runner, tag);
      await runner.query(`UPDATE incidents SET status = $1 WHERE id = $2`, [status, a.incidentId]);
      const { svc, deleted, documentDeletes } = fakes();
      const name = `INC-1 Outage ${tag}`;

      // The check used by the screen: refused, and left out of what the delete would remove.
      assert.deepEqual(await svc.deleteCheck([a.incidentId, a.otherId], { manager: runner.manager }), {
        incidents: 1, blocked: 1, review_documents: 0, tasks: 0, entries: 1, attachments: 0,
        applications: 1, assets: 1, documents: 1,
        refused: [{ id: a.incidentId, name, code: 'INCIDENT_CLOSED_OR_CANCELLED', usages: [] }],
      });

      // The single delete: 409, the dedicated code, and nothing removed.
      let refusal: unknown = null;
      try {
        await svc.delete(a.incidentId, { manager: runner.manager, userId: null });
      } catch (err) {
        refusal = err;
      }
      assert.ok(refusal instanceof RecordInUseException && refusal instanceof ConflictException, `${status}: a 409`);
      const body = (refusal as ConflictException).getResponse() as Record<string, any>;
      assert.equal(body.code, 'INCIDENT_CLOSED_OR_CANCELLED');
      assert.deepEqual(body.usages, []);
      assert.equal(body.message, `Cannot delete incident "${name}": it is ${status}: it stays in the register.`);
      assert.equal(await exists(runner, 'incidents', a.incidentId), true, `${status}: kept`);
      assert.equal(await exists(runner, 'tasks', a.taskId), true, `${status}: task kept`);
      assert.deepEqual(documentDeletes, [], `${status}: review kept`);
      assert.deepEqual(deleted, [], `${status}: files kept`);

      // The bulk delete reports it per line, like regulatory incidents, and deletes the open one.
      const result = await svc.bulkDelete([a.incidentId, a.otherId], null, { manager: runner.manager });
      assert.deepEqual(result.deleted, [a.otherId]);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].id, a.incidentId);
      assert.equal((result.failed[0] as any).code, 'INCIDENT_CLOSED_OR_CANCELLED');
      assert.deepEqual((result.failed[0] as any).usages, []);
      assert.equal(result.failed[0].reason, `Cannot delete incident "${name}": it is ${status}: it stays in the register.`);
      assert.equal(await exists(runner, 'incidents', a.incidentId), true);
      assert.equal(await exists(runner, 'incidents', a.otherId), false);
    });
  }
}

async function testOtherTenantNotFound() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'incdel-a');
    const b = await seed(runner, 'incdel-b');
    await setTenant(runner, b.tenantId);
    const { svc } = fakes();
    await assert.rejects(() => svc.delete(a.incidentId, { manager: runner.manager, userId: null }), NotFoundException);
    assert.equal((await svc.deleteCheck([a.incidentId], { manager: runner.manager })).incidents, 0);
    await setTenant(runner, a.tenantId);
    assert.equal(await exists(runner, 'incidents', a.incidentId), true);
  });
}

void runSpecs('incident-delete', [
  ['delete removes what belongs to the incident and keeps the linked objects', testDeleteRemovesWhatBelongs],
  ['impact counts', testImpactCounts],
  ['each regulatory field refuses the delete', testEachRegulatoryFieldRefuses],
  ['a closed or cancelled incident refuses the delete', testClosedAndCancelledRefuseTheDelete],
  ['bulk delete refuses regulatory incidents and deletes the others', testBulkDelete],
  ['another tenant is not found', testOtherTenantNotFound],
]);
