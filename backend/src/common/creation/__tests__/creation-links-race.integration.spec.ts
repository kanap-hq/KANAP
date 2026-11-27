import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import dataSource from '../../../data-source';
import { mapDatabaseError } from '../../filters/database-error.mapping';
import { Incident } from '../../../incidents/incident.entity';
import { IncidentEntriesService } from '../../../incidents/services/incident-entries.service';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { cancelCreation, withCreationToken } from '../creation-routes';
import { assert, describe, progress, runRaceSpecs, settle, sql, withRace, type Outcome, type Race } from '../../../spend/__tests__/race-harness';

// Lot N1b (decision P17): "Cancel" of a record being created and another person's child written at
// the same time, in both orders, for each form of `creation-links.ts`: a document linked to an
// application (a row with no author) and a journal note on an incident (a row with its author).
// The cancel locks the record FOR UPDATE; the child's insert takes its key share through the
// foreign key, so one waits for the other:
// - cancel first: the child waits, then fails on the record gone (409 `parent_gone`);
// - child first: the cancel waits, then reads the child under its lock and is refused (403
//   `CREATION_CANCEL_EXPIRED`); the record and the child stay.
// Neither child leaves a row of the record's history: only the read under the lock sees it.
// A managed document's version (another person writes the application's description) takes the
// key of the document, not the record's: the cancel locks the record's managed documents too, so
// the edit's write of the document waits for the cancel, and the cancel for a pending edit. An
// autosave writes no version, only the document (`updated_by`): it waits and refuses the same way.
// Another person saving a request's purpose takes the document, then the request's key (its
// activity): against the cancel, which holds the request and waits for the document, PostgreSQL
// ends one of the two on a deadlock (409 `retry`), whichever its detector picks, and nothing is
// lost without an error: the save goes through and everything stays, or the save is refused and
// the request is gone.
// (The connections' links race in `connections/__tests__/connection-cancel-linked-race`.)

process.env.JWT_SECRET = process.env.JWT_SECRET || 'creation-links-race-spec-secret';

type Kind = 'document' | 'note' | 'managed' | 'autosave';

const FORM: Record<Kind, { table: string; child: string; column: string }> = {
  document: { table: 'applications', child: 'document_applications', column: 'application_id' },
  note: { table: 'incidents', child: 'incident_entries', column: 'incident_id' },
  managed: { table: 'applications', child: 'document_versions', column: 'document_id' },
  autosave: { table: 'applications', child: 'documents', column: 'id' },
};

const managedKind = (kind: Kind) => kind === 'managed' || kind === 'autosave';

async function seedRace(race: Race, kind: Kind) {
  const tag = randomUUID().slice(0, 8);
  const seeded = await race.seedWith(async (runner) => {
    const id = async (text: string, params: unknown[]) => (await runner.query(`${text} RETURNING id`, params))[0].id as string;
    const role = await id(`INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Member', 'Member', false, false)`, [race.tenantId]);
    const user = (name: string) => id(
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status) VALUES ($1, $2, 'Tester', $3, null, $4, false, 'enabled')`,
      [race.tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, role],
    );
    const creatorId = await user('Creator');
    const otherId = await user('Other');
    const recordId = kind !== 'note'
      ? await id(`INSERT INTO applications (tenant_id, name, status) VALUES ($1, $2, 'enabled')`, [race.tenantId, `App ${tag}`])
      : await id(`INSERT INTO incidents (tenant_id, item_number, title, severity, status) VALUES ($1, 1, $2, 'minor', 'open')`, [race.tenantId, `Incident ${tag}`]);
    const library = await id(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, $2, $3)`, [race.tenantId, `Library ${tag}`, `library-${tag}`]);
    const document = await id(`INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Runbook', 1, 'published')`, [race.tenantId, library]);
    if (managedKind(kind)) {
      await runner.query(
        `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id) VALUES ($1, 'applications', $2, 'description', $3)`,
        [race.tenantId, recordId, document],
      );
    }
    return { creatorId, otherId, recordId, document };
  });
  const { creation_token: token } = withCreationToken(FORM[kind].table, { id: seeded.recordId }, { tenantId: race.tenantId, userId: seeded.creatorId });
  return { ...seeded, token };
}

type Seeded = Awaited<ReturnType<typeof seedRace>>;

/** The other person's child, as its writer sets it: a document's relation, a journal note. */
function write(kind: Kind, seeded: Seeded, manager: EntityManager, tenantId: string): Promise<unknown> {
  if (kind === 'managed') return editManaged(seeded, manager, tenantId);
  if (kind === 'autosave') return autosave(seeded, manager, tenantId);
  if (kind === 'document') {
    return (Object.create(KnowledgeService.prototype) as KnowledgeService).addDocumentRelationByEntity(seeded.document, 'applications', seeded.recordId, manager);
  }
  return new IncidentEntriesService(dataSource.getRepository(Incident)).createNote(seeded.recordId, { content: 'Seen at 9:00.' }, seeded.otherId, { manager, tenantId });
}

/** Another person's save of the managed document, in the order of `KnowledgeService.update`. */
async function editManaged(seeded: Seeded, manager: EntityManager, tenantId: string) {
  await manager.query(
    `UPDATE documents SET content_markdown = 'Written by the other person.', updated_by = $3, current_version_number = current_version_number + 1
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, seeded.document, seeded.otherId],
  );
  await manager.query(
    `INSERT INTO document_versions (tenant_id, document_id, version_number, title, content_markdown, content_plain, created_by)
     VALUES ($1, $2, 1, 'Runbook', 'Written by the other person.', 'Written by the other person.', $3)`,
    [tenantId, seeded.document, seeded.otherId],
  );
}

/** Another person's autosave of the managed document: the document and its history row, no version. */
async function autosave(seeded: Seeded, manager: EntityManager, tenantId: string) {
  await manager.query(
    `UPDATE documents SET content_markdown = 'Typed by the other person.', updated_by = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, seeded.document, seeded.otherId],
  );
  await manager.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id) VALUES ($1, 'documents', $2, 'update', '{}', '{}', $3)`,
    [tenantId, seeded.document, seeded.otherId],
  );
}

function cancel(kind: Kind, seeded: Seeded, manager: EntityManager, tenantId: string) {
  const { table } = FORM[kind];
  return cancelCreation(table, seeded.recordId, seeded.token, { tenantId, userId: seeded.creatorId, manager }, async (m) => {
    // The managed documents name the record without a foreign key: the delete removes them first.
    if (managedKind(kind)) await m.query(`DELETE FROM documents WHERE tenant_id = $1 AND id = $2`, [tenantId, seeded.document]);
    await m.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, seeded.recordId]);
  });
}

async function stateOf(race: Race, kind: Kind, seeded: Seeded) {
  const { table, child, column } = FORM[kind];
  const row = await race.readOne(
    `SELECT (SELECT count(*)::int FROM ${table} WHERE tenant_id = $1 AND id = $2) AS record,
            (SELECT count(*)::int FROM ${child} WHERE tenant_id = $1 AND ${column} = $3${kind === 'document' ? '' : ' AND ' + ({ note: 'author_id', managed: 'created_by', autosave: 'updated_by' } as Record<string, string>)[kind] + ' = $4::uuid'}) AS children`,
    kind === 'document'
      ? [race.tenantId, seeded.recordId, seeded.recordId]
      : [race.tenantId, seeded.recordId, managedKind(kind) ? seeded.document : seeded.recordId, seeded.otherId],
  );
  return { record: Number(row.record), children: Number(row.children) };
}

function assertParentGone(outcome: Outcome, who: string) {
  assert.ok(!outcome.ok, `${who} must fail on the record gone; it ${describe(outcome)}`);
  const mapped = mapDatabaseError((outcome as { error: unknown }).error);
  assert.equal(mapped?.code, 'parent_gone', `${who} must end as 409 parent_gone; it ended with ${describe(outcome)}`);
}

function assertCancelRefused(outcome: Outcome) {
  assert.ok(!outcome.ok, `the cancel must be refused; it ${describe(outcome)}`);
  const error = (outcome as { error: unknown }).error;
  assert.ok(error instanceof ForbiddenException, `the cancel must be a 403; it ended with ${describe(outcome)}`);
  assert.equal((error.getResponse() as any).code, 'CREATION_CANCEL_EXPIRED');
}

async function cancelFirst(kind: Kind) {
  await withRace(`creation-${kind}-a`, async (race) => {
    const seeded = await seedRace(race, kind);
    const canceller = await race.open('canceller');
    const writer = await race.open('writer');
    // The managed document's lock comes after the record's: the edit waits on that one.
    const locked = race.gate(canceller, { label: 'after its lock', when: 'after', match: sql.lockOn(managedKind(kind) ? 'documents' : FORM[kind].table) });
    const cancelling = race.start(canceller, (manager) => cancel(kind, seeded, manager, race.tenantId));
    assert.equal(await progress(cancelling, { party: canceller, gate: locked }), 'gated', 'the cancel holds the lock');
    const writing = race.start(writer, (manager) => write(kind, seeded, manager, race.tenantId));
    assert.equal(await progress(writing, { party: writer }), 'blocked', 'the child waits for the lock through its foreign key (the edit, on the document)');
    locked.release();
    const cancelled = await settle(cancelling);
    assert.ok(cancelled.ok, `the cancel must succeed; it ${describe(cancelled)}`);
    if (kind === 'autosave') {
      // The autosave's update finds the document gone: it writes nothing.
      const saved = await settle(writing);
      assert.ok(saved.ok, `the autosave ends; it ${describe(saved)}`);
    } else {
      assertParentGone(await settle(writing), 'the child');
    }
    assert.deepEqual(await stateOf(race, kind, seeded), { record: 0, children: 0 });
  });
}

async function childFirst(kind: Kind) {
  await withRace(`creation-${kind}-b`, async (race) => {
    const seeded = await seedRace(race, kind);
    const canceller = await race.open('canceller');
    const writer = await race.open('writer');
    const inserted = race.gate(writer, {
      label: 'after its write',
      when: 'after',
      match: kind === 'autosave' ? sql.update('documents') : sql.insertInto(FORM[kind].child),
    });
    const writing = race.start(writer, (manager) => write(kind, seeded, manager, race.tenantId));
    assert.equal(await progress(writing, { party: writer, gate: inserted }), 'gated', 'the child is inserted, not committed');
    const cancelling = race.start(canceller, (manager) => cancel(kind, seeded, manager, race.tenantId));
    assert.equal(await progress(cancelling, { party: canceller }), 'blocked', 'the cancel waits for the child');
    inserted.release();
    const written = await settle(writing);
    assert.ok(written.ok, `the child must be written; it ${describe(written)}`);
    assertCancelRefused(await settle(cancelling));
    assert.deepEqual(await stateOf(race, kind, seeded), { record: 1, children: 1 }, 'the record and the child stay');
  });
}

/** Review N1b: another person saves the request's purpose while its creator cancels. */
async function purposeSavedDuringCancel() {
  await withRace('creation-purpose-deadlock', async (race) => {
    const tag = randomUUID().slice(0, 8);
    const seeded = await race.seedWith(async (runner) => {
      const id = async (text: string, params: unknown[]) => (await runner.query(`${text} RETURNING id`, params))[0].id as string;
      const role = await id(`INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Member', 'Member', false, false)`, [race.tenantId]);
      const user = (name: string) => id(
        `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status) VALUES ($1, $2, 'Tester', $3, null, $4, false, 'enabled')`,
        [race.tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, role],
      );
      const creatorId = await user('Creator');
      const otherId = await user('Other');
      const requestId = await id(`INSERT INTO portfolio_requests (tenant_id, item_number, name, status, criteria_values) VALUES ($1, 1, $2, 'pending_review', '{}'::jsonb)`, [race.tenantId, `Request ${tag}`]);
      const library = await id(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, $2, $3)`, [race.tenantId, `Library ${tag}`, `library-${tag}`]);
      const document = await id(`INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Purpose', 1, 'published')`, [race.tenantId, library]);
      await runner.query(
        `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id) VALUES ($1, 'requests', $2, 'purpose', $3)`,
        [race.tenantId, requestId, document],
      );
      return { creatorId, otherId, requestId, document };
    });
    const { creation_token: token } = withCreationToken('portfolio_requests', { id: seeded.requestId }, { tenantId: race.tenantId, userId: seeded.creatorId });
    const writer = await race.open('writer');
    const canceller = await race.open('canceller');
    const updated = race.gate(writer, { label: 'after the document update', when: 'after', match: sql.update('documents') });
    // The order of `IntegratedDocumentsService.writeSourceSlotContent`: the document, then the request's activity.
    const writing = race.start(writer, async (m: EntityManager) => {
      await m.query(`UPDATE documents SET content_markdown = 'Purpose by the other person.', updated_by = $3 WHERE tenant_id = $1 AND id = $2`, [race.tenantId, seeded.document, seeded.otherId]);
      await m.query(`INSERT INTO portfolio_activities (tenant_id, request_id, author_id, type, content) VALUES ($1, $2, $3, 'change', null)`, [race.tenantId, seeded.requestId, seeded.otherId]);
    });
    assert.equal(await progress(writing, { party: writer, gate: updated }), 'gated', 'the document is written, not committed');
    const cancelling = race.start(canceller, (m) => cancelCreation('portfolio_requests', seeded.requestId, token, { tenantId: race.tenantId, userId: seeded.creatorId, manager: m }, async (mg) => {
      await mg.query(`DELETE FROM documents WHERE tenant_id = $1 AND id = $2`, [race.tenantId, seeded.document]);
      await mg.query(`DELETE FROM portfolio_requests WHERE tenant_id = $1 AND id = $2`, [race.tenantId, seeded.requestId]);
    }));
    assert.equal(await progress(cancelling, { party: canceller }), 'blocked', 'the cancel holds the request and waits for the document');
    updated.release();
    const written = await settle(writing);
    const cancelled = await settle(cancelling);
    const failed = [written, cancelled].filter((outcome) => !outcome.ok);
    assert.equal(failed.length, 1, `exactly one ends on the deadlock; the save ${describe(written)}, the cancel ${describe(cancelled)}`);
    assert.equal(mapDatabaseError((failed[0] as { error: unknown }).error)?.code, 'retry', `it answers 409 retry; it ended with ${describe(failed[0])}`);
    const state = await race.readOne(
      `SELECT (SELECT count(*)::int FROM portfolio_requests WHERE tenant_id = $1 AND id = $2) AS record,
              (SELECT count(*)::int FROM documents WHERE tenant_id = $1 AND id = $3 AND updated_by = $4::uuid) AS document,
              (SELECT count(*)::int FROM portfolio_activities WHERE tenant_id = $1 AND request_id = $2 AND author_id = $4::uuid) AS activity`,
      [race.tenantId, seeded.requestId, seeded.document, seeded.otherId],
    );
    const found = { record: Number(state.record), document: Number(state.document), activity: Number(state.activity) };
    if (written.ok) assert.deepEqual(found, { record: 1, document: 1, activity: 1 }, 'the cancel lost: nothing is deleted');
    else assert.deepEqual(found, { record: 0, document: 0, activity: 0 }, 'the save lost: it is undone and the request is gone');
  });
}

void runRaceSpecs('Creation cancel and children', [
  ['cancel first, then a document linked to the application: fails on the record gone', () => cancelFirst('document')],
  ['cancel first, then another person\'s note on the incident: fails on the record gone', () => cancelFirst('note')],
  ['cancel first, then another person\'s edit of the managed document: fails on the document gone', () => cancelFirst('managed')],
  ['a document linked first, then the cancel: refused under the lock', () => childFirst('document')],
  ['another person\'s note first, then the cancel: refused under the lock', () => childFirst('note')],
  ['another person\'s edit of the managed document first, then the cancel: refused under the lock', () => childFirst('managed')],
  ['cancel first, then another person\'s autosave of the managed document: finds the document gone', () => cancelFirst('autosave')],
  ['another person\'s autosave of the managed document first, then the cancel: refused under the lock', () => childFirst('autosave')],
  ['another person saves the request\'s purpose during the cancel: the save goes through, the cancel answers 409 retry', purposeSavedDuringCancel],
]);
