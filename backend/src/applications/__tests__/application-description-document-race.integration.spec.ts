import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { assert, assertSucceeded, describe, pgCode, progress, runRaceSpecs, settle, withRace } from '../../spend/__tests__/race-harness';

// Lot I7b of 26.12.1, review of the lot: the writers of an application's description (the API, the
// import, Kad) lock the application, then write its document. With the real services:
// - D: the delete of the application locks it first too (`lockApplications`), before it deletes its
//   documents and its row: whichever starts first, the other waits, never a deadlock (40P01). A write
//   that comes after the delete finds the application gone.
// - C: two first writers of a missing overview document (the page opening the application, a write of
//   its description): the second one's binding meets the first one's; it is made under a savepoint
//   (`ensureBoundDocument`), so both succeed, with one document.
// - A: an autosave of the overview document against an import of the description, both orders.
// - P: the page making the overview document while the application is deleted.

process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

let h!: { app: any; apps: any; deletes: any; docs: any; csv: any };

async function boot() {
  const { AppModule } = require('../../app.module');
  const { ApplicationsService } = require('../services/applications.service');
  const { ApplicationsDeleteService } = require('../applications-delete.service');
  const { IntegratedDocumentsService } = require('../../knowledge/integrated-documents.service');
  const { ApplicationsCsvService } = require('../applications-csv.service');
  const { NotificationsService } = require('../../notifications/notifications.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // Nothing is sent from this spec.
  const notifications = app.get(NotificationsService, { strict: false });
  for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(notifications))) {
    if (method.startsWith('notify')) notifications[method] = async () => undefined;
  }
  const get = (type: any) => app.get(type, { strict: false });
  h = { app, apps: get(ApplicationsService), deletes: get(ApplicationsDeleteService), docs: get(IntegratedDocumentsService), csv: get(ApplicationsCsvService) };
}

async function seedBase(runner: QueryRunner, tenantId: string) {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Race', 'Race', false, false, now(), now()) RETURNING id`, [tenantId]);
  for (const [resource, level] of [['applications', 'admin'], ['knowledge', 'admin']]) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, role.id, resource, level]);
  }
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, 'Ana', 'Race', $2, $3, false, 'enabled', 'en', now(), now()) RETURNING id`,
    [tenantId, `race-${tenantId.slice(0, 8)}@example.test`, role.id]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const [app] = await runner.query(
    `INSERT INTO applications (tenant_id, name, description, status, lifecycle) VALUES ($1, 'Race app', 'Old text', 'enabled', 'active') RETURNING id::text AS id, name`,
    [tenantId]);
  return { userId: String(user.id), appId: String(app.id), appName: String(app.name) };
}

async function prepare(race: any, withDocument: boolean) {
  const s = await race.seedWith((runner: QueryRunner) => seedBase(runner, race.tenantId));
  if (withDocument) {
    await race.seedWith((runner: QueryRunner) => h.docs.repairSourceSlot('applications', s.appId, 'overview', { manager: runner.manager, actorUserId: s.userId }));
  }
  return s;
}

const deadlocked = (o: any) => (!o.ok && pgCode(o.error) === '40P01')
  || JSON.stringify(o.ok ? o.value?.errors ?? [] : (o.error as any)?.response ?? (o.error as any)?.message ?? '').includes('deadlock');

const APPLICATION_LOCK = /FROM applications WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/;
const IMPORT_LOCK = /FROM applications .*ORDER BY id FOR NO KEY UPDATE/s;
const DELETE_LOCK = /FROM applications WHERE tenant_id = app_current_tenant\(\) AND id = ANY\(\$1::uuid\[\]\) ORDER BY id FOR UPDATE/;

/** D: a write of X's description (the API, or an import "update only") against the delete of X. */
async function writeAgainstDelete(writer: 'api' | 'import', writeFirst: boolean) {
  await withRace(`app-desc-${writer}-delete-${writeFirst ? 'write' : 'delete'}-first`, async (race) => {
    const s = await prepare(race, true);
    const w = await race.open(writer === 'api' ? 'PATCH of the description' : 'import of the description');
    const d = await race.open('delete of the application');
    const runWrite = () => race.start(w, (m) => writer === 'api'
      ? h.apps.update(s.appId, { description: 'New text' }, s.userId, { manager: m, tenantId: race.tenantId })
      : h.csv.import(
        { buffer: Buffer.from(`name;description\n${s.appName};New imported text\n`), originalname: 'apps.csv' } as Express.Multer.File,
        { dryRun: false, operation: 'update_only' },
        { manager: m, tenantId: race.tenantId, userId: s.userId, access: { isAdmin: true, permissions: {} } },
      ));
    const runDelete = () => race.start(d, (m) => h.deletes.delete(s.appId, { manager: m, userId: s.userId }));
    const [first, second] = writeFirst ? [w, d] : [d, w];
    const gate = race.gate(first, {
      label: 'the application locked', when: 'after',
      match: (text) => (writeFirst ? (writer === 'api' ? APPLICATION_LOCK : IMPORT_LOCK) : DELETE_LOCK).test(text),
    });
    const firstWork = writeFirst ? runWrite() : runDelete();
    assert.equal(await progress(firstWork, { party: first, gate }), 'gated', 'harness: the first one must pause holding the application');
    const secondWork = writeFirst ? runDelete() : runWrite();
    assert.equal(await progress(secondWork, { party: second }), 'blocked', 'the second one waits for the first');
    gate.release();
    const [writeWork, deleteWork] = writeFirst ? [firstWork, secondWork] : [secondWork, firstWork];
    const written = await settle(writeWork);
    const deleted = await settle(deleteWork);
    assert.ok(!deadlocked(written) && !deadlocked(deleted), `no deadlock: write ${describe(written)}, delete ${describe(deleted)}`);
    assertSucceeded(deleted, 'the delete');
    if (writeFirst) {
      assertSucceeded(written, 'the write');
      if (writer === 'import') assert.equal((written as any).value?.ok, true, JSON.stringify((written as any).value?.errors));
    } else if (writer === 'api') {
      assert.equal(written.ok, false, 'a PATCH after the delete finds the application gone');
      assert.match(String((written as any).error?.message), /not found/i);
    } else {
      assertSucceeded(written, 'the import');
      assert.equal((written as any).value?.ok, false, 'an import after the delete refuses its row');
      assert.deepEqual(((written as any).value?.errors ?? []).map((error: any) => error.code), ['CSV_RECORD_DELETED']);
    }
    const left = await race.read(
      `SELECT (SELECT count(*)::int FROM applications WHERE id = $1) AS apps,
              (SELECT count(*)::int FROM integrated_document_bindings WHERE source_entity_type = 'applications' AND source_entity_id = $1) AS bindings`,
      [s.appId]);
    assert.deepEqual(left[0], { apps: 0, bindings: 0 }, 'the application and its document are gone');
  });
}

/** C: the page opens an application with no document (it makes it) while a PATCH writes its description. */
async function firstWriters(pageFirst: boolean) {
  await withRace(`app-desc-first-writers-${pageFirst ? 'page' : 'patch'}-first`, async (race) => {
    const s = await prepare(race, false);
    const page = await race.open('the page opens the application');
    const patch = await race.open('PATCH of the description');
    const first = pageFirst ? page : patch;
    const gate = race.gate(first, { label: 'binding inserted', when: 'after', match: (t) => /INSERT INTO "integrated_document_bindings"/.test(t) });
    const runPage = () => race.start(page, (m) => h.docs.getBySource('applications', s.appId, 'overview', s.userId, { manager: m }));
    const runPatch = () => race.start(patch, (m) => h.apps.update(s.appId, { description: 'New text' }, s.userId, { manager: m, tenantId: race.tenantId }));
    const w1 = pageFirst ? runPage() : runPatch();
    assert.equal(await progress(w1, { party: first, gate }), 'gated', 'harness: the first one must pause after its binding');
    const w2 = pageFirst ? runPatch() : runPage();
    assert.equal(await progress(w2, { party: pageFirst ? patch : page }), 'blocked', 'the second one waits on the binding');
    gate.release();
    const o1 = await settle(w1);
    const o2 = await settle(w2);
    assertSucceeded(o1, 'the first writer');
    assertSucceeded(o2, 'the second writer');
    const docs = await race.read(
      `SELECT count(*)::int AS n, max(d.content_markdown) AS text FROM integrated_document_bindings b JOIN documents d ON d.id = b.document_id
        WHERE b.source_entity_type = 'applications' AND b.source_entity_id = $1 AND b.slot_key = 'overview'`, [s.appId]);
    assert.deepEqual(docs[0], { n: 1, text: 'New text' }, 'one document, holding the description written');
  });
}

/**
 * A: the page autosaves the overview document (with the revision it read) while an import writes the
 * description. The document is locked before its revision is read: whichever comes second compares
 * against the revision the first one saved.
 */
async function autosaveAgainstImport(importFirst: boolean) {
  await withRace(`app-desc-autosave-import-${importFirst ? 'import' : 'autosave'}-first`, async (race) => {
    const s = await prepare(race, true);
    const opened = await race.seedWith(async (runner: QueryRunner) => ({
      doc: await h.docs.getBySource('applications', s.appId, 'overview', s.userId, { manager: runner.manager }),
      lock: await h.docs.acquireLockBySource('applications', s.appId, 'overview', s.userId, { manager: runner.manager }),
    }));
    const lockToken = String(opened.lock.lock_token);
    const readRevision = Number(opened.doc.revision);
    const page = await race.open('autosave of the page');
    const imp = await race.open('import of the description');
    const autosave = (m: any, revision: number, text: string) => h.docs.updateBySource(
      'applications', s.appId, 'overview', { content_markdown: text, revision, save_mode: 'autosave' }, s.userId, lockToken, { manager: m });
    const runImport = () => race.start(imp, (m) => h.csv.import(
      { buffer: Buffer.from(`name;description\n${s.appName};Imported text\n`), originalname: 'apps.csv' } as Express.Multer.File,
      { dryRun: false, operation: 'update_only' },
      { manager: m, tenantId: race.tenantId, userId: s.userId, access: { isAdmin: true, permissions: {} } },
    ));
    const runAutosave = () => race.start(page, (m) => autosave(m, readRevision, 'Typed on the page'));
    const first = importFirst ? imp : page;
    const gate = race.gate(first, { label: 'document written', when: 'after', match: (t) => /UPDATE "documents"/.test(t) });
    const w1 = importFirst ? runImport() : runAutosave();
    assert.equal(await progress(w1, { party: first, gate }), 'gated', 'harness: the first one must pause after writing the document');
    const w2 = importFirst ? runAutosave() : runImport();
    assert.equal(await progress(w2, { party: importFirst ? page : imp }), 'blocked', 'the second one waits on the document');
    gate.release();
    const o1 = await settle(w1);
    const o2 = await settle(w2);
    const [imported, saved] = importFirst ? [o1, o2] : [o2, o1];
    assertSucceeded(imported, 'the import');
    assert.equal((imported as any).value?.ok, true, JSON.stringify((imported as any).value?.errors));
    if (importFirst) {
      assert.equal(saved.ok, false, `the autosave that read revision ${readRevision} is refused, got ${describe(saved)}`);
      assert.equal((saved as any).error?.status, 409, describe(saved));
    } else {
      assertSucceeded(saved, 'the autosave');
      // The page's next autosave carries the revision its save returned: the import wrote after it.
      const next = await settle(race.start(page, (m) => autosave(m, Number((saved as any).value?.revision), 'Typed again')));
      assert.equal(next.ok, false, `the next autosave is refused, got ${describe(next)}`);
      assert.equal((next as any).error?.status, 409, describe(next));
    }
    const doc = await race.read(
      `SELECT d.content_markdown AS text, d.revision FROM integrated_document_bindings b JOIN documents d ON d.id = b.document_id
        WHERE b.source_entity_type = 'applications' AND b.source_entity_id = $1 AND b.slot_key = 'overview'`, [s.appId]);
    assert.equal(doc[0].text, 'Imported text', 'the document keeps the imported text');
    assert.equal(Number(doc[0].revision), readRevision + (importFirst ? 1 : 2), 'each write took its own revision');
  });
}

/** P: the page opens an application with no document (it makes it) while the application is deleted. */
async function pageAgainstDelete() {
  await withRace('app-desc-page-during-delete', async (race) => {
    const s = await prepare(race, false);
    const [{ n: documentsBefore }] = await race.read('SELECT count(*)::int AS n FROM documents');
    const d = await race.open('delete of the application');
    const page = await race.open('the page opens the application');
    const gate = race.gate(d, { label: 'the application locked', when: 'after', match: (t) => DELETE_LOCK.test(t) });
    const deleting = race.start(d, (m) => h.deletes.delete(s.appId, { manager: m, userId: s.userId }));
    assert.equal(await progress(deleting, { party: d, gate }), 'gated', 'harness: the delete must pause holding the application');
    const opening = race.start(page, (m) => h.docs.getBySource('applications', s.appId, 'overview', s.userId, { manager: m }));
    assert.equal(await progress(opening, { party: page }), 'blocked', 'the page waits for the delete before making the document');
    gate.release();
    const deleted = await settle(deleting);
    const opened = await settle(opening);
    assert.ok(!deadlocked(deleted) && !deadlocked(opened), `no deadlock: delete ${describe(deleted)}, page ${describe(opened)}`);
    assertSucceeded(deleted, 'the delete');
    assert.equal(opened.ok, false, `the page finds the application gone, got ${describe(opened)}`);
    assert.match(String((opened as any).error?.message), /not found/i);
    const left = await race.read(
      `SELECT (SELECT count(*)::int FROM integrated_document_bindings WHERE source_entity_type = 'applications' AND source_entity_id = $1) AS bindings,
              (SELECT count(*)::int FROM documents) AS documents`,
      [s.appId]);
    assert.deepEqual(left[0], { bindings: 0, documents: documentsBefore }, 'no document outlives the application');
  });
}

void (async () => {
  await boot();
  try {
    await runRaceSpecs('Application description document races', [
      ['D1: a PATCH of the description started first, then the delete: no deadlock', () => writeAgainstDelete('api', true)],
      ['D1: the delete started first, then a PATCH of the description: no deadlock', () => writeAgainstDelete('api', false)],
      ['D2: an import "update only" of the description started first, then the delete: no deadlock', () => writeAgainstDelete('import', true)],
      ['D2: the delete started first, then an import "update only" of the description: no deadlock', () => writeAgainstDelete('import', false)],
      ['C1: the page opens first, then a PATCH, no document yet: both succeed', () => firstWriters(true)],
      ['C2: a PATCH first, then the page opens, no document yet: both succeed', () => firstWriters(false)],
      ['A1: an import writes the description first, then an autosave that read the old revision: 409, the imported text stays', () => autosaveAgainstImport(true)],
      ['A2: an autosave first, then an import: the import writes over it, the next autosave gets a 409', () => autosaveAgainstImport(false)],
      ['P1: the delete first, then the page opens the application with no document: no document left', () => pageAgainstDelete()],
    ]);
  } finally {
    await h.app.close();
  }
  process.exit(0);
})();
