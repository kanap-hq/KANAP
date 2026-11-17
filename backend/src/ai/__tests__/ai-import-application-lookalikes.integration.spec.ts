import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot I3 of 26.11.9, pass 3a: Kad imports applications that look like stored ones (T-I3d). The card's
// report carries the lookalikes on the lines of the person's file, named (APP-n); a row left out leaves
// nothing to import: "Approve" is refused and the card stays pending (T-I2e). The choice route takes
// `lookalike` and `lookalikes` for the applications; the new card replaces the old one and keeps the
// choices; "Create anyway" and "Update APP-n" are imported on approval, the update refused when APP-n
// changed since the card. A publisher that names a supplier links it, a match listed (origin editor)
// the card can undo. The model is not called: the tools of the registry are, as the conversation calls
// them. The AI surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-application-lookalikes-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string; compta: { id: string; ref: string }; cegid: { id: string; ref: string } };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-application-lookalikes.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiAttachmentService } = require('../ai-attachment.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const files = new Map<string, { name: string; buffer: Buffer }>();
  const attachments = app.get(AiAttachmentService);
  attachments.assertAndLoadAttachments = async (ids: string[]) => ids.map((id) => {
    const file = files.get(id);
    if (!file) throw new Error('One or more attachments are invalid for this conversation');
    return { id, kind: 'table', original_filename: file.name };
  });
  attachments.loadAttachmentBuffer = async (id: string) => ({ attachment: { id }, buffer: files.get(id)!.buffer });
  return { app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService), files };
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-i3a-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Administrator', 'Administrator') RETURNING id`, [tenantId]);
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, 'Yann', 'Le Goff', $3, 'enabled', 'fr') RETURNING id`,
    [tenantId, `admin-${slug}@example.test`, role.id],
  );
  const conversationId = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'Applications import', 'custom', 'import-model', 'custom', now(), now())`,
    [conversationId, tenantId, user.id],
  );
  const [compta] = await runner.query(
    `INSERT INTO applications (tenant_id, name, description) VALUES ($1, 'Comptabilité', 'Ledger') RETURNING id::text AS id, sequential_id AS ref`,
    [tenantId],
  );
  const [cegid] = await runner.query(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Cegid') RETURNING id::text AS id, 'SUP-' || item_number AS ref`,
    [tenantId],
  );
  return { tenantId, userId: user.id, conversationId, compta, cegid };
}

function ctx(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversationId,
  };
}

/** A title, a blank row, the header on line 3: the person's lines are not the built file's. */
function workbook(): Buffer {
  const { writeXlsx } = require('../../common/xlsx');
  return writeXlsx({
    language: 'fr',
    sheets: [{
      name: 'Applications',
      header: 'plain',
      headers: ['Inventaire des applications', '', ''],
      rows: [
        [null, null, null],
        ['Nom', 'Éditeur', 'Description'],
        ['Comptabilite', 'Cegid', null],
        ['Atlas', 'cegid', 'Cartes'],
      ],
    }],
  });
}

const COLUMNS = [
  { column: 'name', source: 1, confidence: 'high' },
  { column: 'editor', source: 2, confidence: 'high' },
  { column: 'description', source: 3, confidence: 'high' },
];

async function names(runner: QueryRunner, s: Seed): Promise<string[]> {
  return (await runner.query(`SELECT name FROM applications WHERE tenant_id = $1 ORDER BY name`, [s.tenantId])).map((row: any) => row.name);
}

async function testLeftOutThenCreatedAnyway(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = randomUUID();
  h.files.set(attachment, { name: 'Applications.xlsx', buffer: workbook() });
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  const look = check.report.lookalikes;
  assert.deepEqual(look.lines.map((entry: any) => [entry.line, entry.name, entry.target.ref, entry.target.name, entry.reason, entry.outcome]), [
    [4, 'Comptabilite', s.compta.ref, 'Comptabilité', 'name_accents', 'ignored'],
  ], 'on the line of the person\'s file, the application named');
  assert.deepEqual(Object.keys(look.targets), ['4']);
  assert.deepEqual(look.choices, [{ kind: 'lookalikes', action: 'ignore', targets: look.targets }]);
  assert.deepEqual([check.inserted, check.skipped], [1, 1]);
  assert.deepEqual(check.similar_lines.first, [{ file_line: 4, looks_like: s.compta.ref, reason: 'name_accents', outcome: 'ignored' }]);
  assert.deepEqual(check.similar_lines.card_choices, { ignored: 'Écarter', created: 'Créer quand même', updated: 'Mettre à jour APP-n' });
  // The match of the publisher in the card's words, with the link it makes (correctifs L).
  assert.equal(card.import_mapping.on_approval, 'On approval: 1 records created, 0 updated, 0 unchanged; 1 values of the file matched to existing records: '
    + `Fournisseur (éditeur): cegid → ${s.cegid.ref} Cegid; each application whose publisher names an existing supplier is linked to that supplier; `
    + '1 rows of the file look like existing applications: 1 left out, 0 created anyway, 0 updating the application they look like.');
  // The publisher names a supplier: Atlas is linked to it, a match listed and undoable.
  assert.deepEqual(check.report.matches.map((match: any) => [match.column, match.value, match.target, match.ref, match.origin, match.lines, match.undoable]), [
    ['supplier_name', 'cegid', 'Cegid', s.cegid.ref, 'editor', [5], true],
  ]);
  // The card keeps the targets the check left out: the approval leaves the row out too.
  const stored = (await runner.query(`SELECT mutation_input->'choices' AS choices FROM ai_mutation_previews WHERE id = $1`, [card.preview_id]))[0].choices;
  assert.deepEqual(stored, look.choices);

  // "Create anyway" through the choice route: a new card keeps the choice, the approval creates the row.
  const chosen = await h.previews.replaceImportChoices(admin, card.preview_id, [{ kind: 'lookalike', line: 4, action: 'create' }]);
  const second = chosen.import_mapping.validation;
  assert.deepEqual(second.report.lookalikes.lines.map((entry: any) => [entry.line, entry.outcome]), [[4, 'created']]);
  assert.deepEqual([second.inserted, second.skipped], [2, 0]);
  const done = await h.previews.executePreview(admin, chosen.preview_id);
  assert.equal(done.status, 'executed', done.error_message);
  assert.deepEqual(await names(runner, s), ['Atlas', 'Comptabilite', 'Comptabilité']);
  const [atlas] = await runner.query(`SELECT supplier_id::text AS supplier_id FROM applications WHERE tenant_id = $1 AND name = 'Atlas'`, [s.tenantId]);
  assert.equal(atlas.supplier_id, s.cegid.id);
}

async function testNothingToImportStaysPendingThenUpdate(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = randomUUID();
  const { writeXlsx } = require('../../common/xlsx');
  h.files.set(attachment, {
    name: 'Applications.xlsx',
    buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Applications', header: 'plain', headers: ['Nom', 'Éditeur', 'Description'], rows: [['Comptabilite', 'Cegid', null]] }] }),
  });
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const check = card.import_mapping.validation;
  assert.equal(check.nothing_to_import, true);
  assert.match(card.import_mapping.on_approval, /Say in one sentence that nothing is imported until a row left out is created anyway or updates the application it looks like/);
  const refused = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(refused.status, 'pending', 'nothing to import: refused, the card stays pending');

  // "Update APP-n": the new card lists the fields; the application changes before the approval: refused, nothing written.
  const target = check.report.lookalikes.lines[0].target;
  const update = await h.previews.replaceImportChoices(admin, card.preview_id, [{ kind: 'lookalike', line: 2, action: 'update', id: target.id, state: target.state }]);
  const entry = update.import_mapping.validation.report.lookalikes.lines[0];
  assert.deepEqual([entry.outcome, entry.fields], ['updated', ['supplier_name', 'editor']]);
  await runner.query(`UPDATE applications SET description = 'Edited', updated_at = now() + interval '1 second' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.compta.id]);
  const failed = await h.previews.executePreview(admin, update.preview_id);
  assert.equal(failed.status, 'failed');
  const [before] = await runner.query(`SELECT name, editor FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.compta.id]);
  assert.deepEqual(before, { name: 'Comptabilité', editor: null });

  // A fresh card, "Update all": APP-n keeps its name and takes the publisher and its supplier.
  const again = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const all = await h.previews.replaceImportChoices(admin, again.preview_id, [
    { kind: 'lookalikes', action: 'update', targets: again.import_mapping.validation.report.lookalikes.targets },
  ]);
  const done = await h.previews.executePreview(admin, all.preview_id);
  assert.equal(done.status, 'executed', done.error_message);
  const [after] = await runner.query(`SELECT name, editor, supplier_id::text AS supplier_id, description FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.compta.id]);
  assert.deepEqual(after, { name: 'Comptabilité', editor: 'Cegid', supplier_id: s.cegid.id, description: 'Edited' });
}

/**
 * Review 3, C2: "Update APP-n" chosen on the card, APP-n deleted before the approval: the approval fails
 * with the refusal of the row, the card is not executed, and nothing is imported.
 */
async function testTargetGoneBeforeTheApproval(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = randomUUID();
  const { writeXlsx } = require('../../common/xlsx');
  h.files.set(attachment, {
    name: 'Applications.xlsx',
    buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Applications', header: 'plain', headers: ['Nom', 'Éditeur', 'Description'], rows: [['Comptabilite', 'Cegid', null], ['Atlas', null, null]] }] }),
  });
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const target = card.import_mapping.validation.report.lookalikes.lines[0].target;
  const update = await h.previews.replaceImportChoices(admin, card.preview_id, [{ kind: 'lookalike', line: 2, action: 'update', id: target.id, state: target.state }]);
  assert.equal(update.import_mapping.validation.report.lookalikes.lines[0].outcome, 'updated');
  await runner.query(`DELETE FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.compta.id]);
  const failed = await h.previews.executePreview(admin, update.preview_id);
  assert.equal(failed.status, 'failed', 'the approval fails, the card is not executed');
  // The card keeps what the load refused: the row, and why.
  const [kept] = await runner.query(`SELECT current_values->'import_mapping'->'result' AS result FROM ai_mutation_previews WHERE id = $1`, [update.preview_id]);
  assert.deepEqual((kept.result?.issues ?? []).map((issue: any) => [issue.level, issue.code, issue.file_lines]), [['error', 'CSV_LOOKALIKE_GONE', [2]]], JSON.stringify(kept.result));
  assert.deepEqual(await names(runner, s), [], 'nothing imported, Atlas neither');
}

/**
 * The card as the screen sends it (fusion of passes 3a and 3b): every row left out, "Approve" refused
 * and the card pending; "Create anyway" sends the card's own `choices` with that row's replaced, read
 * by the choice route; the new card replaces the old one and its approval creates the row.
 */
async function testAllLeftOutThenCreateAnywayFromTheCardChoices(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = randomUUID();
  const { writeXlsx } = require('../../common/xlsx');
  const { parseImportChoices } = require('../import/ai-import-targets');
  h.files.set(attachment, {
    name: 'Applications.xlsx',
    buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Applications', header: 'plain', headers: ['Nom', 'Éditeur', 'Description'], rows: [['Comptabilite', null, null]] }] }),
  });
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const look = card.import_mapping.validation.report.lookalikes;
  assert.equal(card.import_mapping.validation.nothing_to_import, true);
  const refused = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(refused.status, 'pending', 'every row left out: refused, the card stays pending');

  const line = look.lines[0].line;
  const sent = [...look.choices.filter((choice: any) => !(choice.kind === 'lookalike' && choice.line === line)), { kind: 'lookalike', line, action: 'create' }];
  const next = await h.previews.replaceImportChoices(admin, card.preview_id, parseImportChoices('applications', JSON.parse(JSON.stringify(sent))));
  assert.equal(next.replaces_preview_id, card.preview_id, 'the new card stands in for the one the conversation shows');
  assert.deepEqual(next.import_mapping.validation.report.lookalikes.lines.map((entry: any) => [entry.line, entry.outcome]), [[line, 'created']]);
  const done = await h.previews.executePreview(admin, next.preview_id);
  assert.equal(done.status, 'executed', done.error_message);
  assert.deepEqual(await names(runner, s), ['Comptabilite', 'Comptabilité']);
}

/**
 * Review 4, C1 on the card (K2): a row the card leaves out, whose name an application takes before the
 * approval, stays left out: the approval imports the rest of the file and never touches that application.
 */
async function testLeftOutRowNameTakenBeforeTheApproval(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = randomUUID();
  const { writeXlsx } = require('../../common/xlsx');
  h.files.set(attachment, {
    name: 'Applications.xlsx',
    buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Applications', header: 'plain', headers: ['Nom', 'Éditeur', 'Description'], rows: [['Comptabilite', null, 'Grand livre'], ['Atlas', null, 'Cartes']] }] }),
  });
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  assert.deepEqual(card.import_mapping.validation.report.lookalikes.lines.map((entry: any) => [entry.line, entry.outcome]), [[2, 'ignored']]);
  const [other] = await runner.query(`INSERT INTO applications (tenant_id, name, description) VALUES ($1, 'Comptabilite', 'créée entre-temps') RETURNING id::text AS id`, [s.tenantId]);
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message);
  const [after] = await runner.query(`SELECT description FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, other.id]);
  assert.equal(after.description, 'créée entre-temps', 'the application that took the name is untouched');
  assert.deepEqual(await names(runner, s), ['Atlas', 'Comptabilite', 'Comptabilité']);
}

/**
 * Review 4, C2 (K): "Update APP-1" chosen on the card, an application takes the row's name before the
 * approval: the approval is refused. The next card shows the row's new situation (an update of the
 * application its name finds, as the screen checks again with the choices the server gave back): it no
 * longer carries the stale choice, and it is approved.
 */
async function testStaleChoiceAfterARefusedApproval(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = randomUUID();
  const { writeXlsx } = require('../../common/xlsx');
  h.files.set(attachment, {
    name: 'Applications.xlsx',
    buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Applications', header: 'plain', headers: ['Nom', 'Éditeur', 'Description'], rows: [['Comptabilite', null, 'Grand livre'], ['Atlas', null, 'Cartes']] }] }),
  });
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const target = card.import_mapping.validation.report.lookalikes.lines[0].target;
  const update = await h.previews.replaceImportChoices(admin, card.preview_id, [{ kind: 'lookalike', line: 2, action: 'update', id: target.id, state: target.state }]);
  const [other] = await runner.query(`INSERT INTO applications (tenant_id, name, description) VALUES ($1, 'Comptabilite', 'créée entre-temps') RETURNING id::text AS id`, [s.tenantId]);
  const failed = await h.previews.executePreview(admin, update.preview_id);
  assert.equal(failed.status, 'failed');

  const next = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const check = next.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual([check.inserted, check.updated], [1, 1], 'the row updates the application its name finds now');
  const [stored] = await runner.query(`SELECT mutation_input->'choices' AS choices FROM ai_mutation_previews WHERE id = $1`, [next.preview_id]);
  assert.ok(!(stored.choices ?? []).some((choice: any) => choice.kind === 'lookalike' && choice.action === 'update'), JSON.stringify(stored.choices));
  const done = await h.previews.executePreview(admin, next.preview_id);
  assert.equal(done.status, 'executed', done.error_message);
  const [after] = await runner.query(`SELECT description FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.compta.id]);
  assert.equal(after.description, 'Ledger', 'APP-1 untouched');
  const [taken] = await runner.query(`SELECT description FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, other.id]);
  assert.equal(taken.description, 'Grand livre');
}

/**
 * The card's choices a check refused (C2): a check whose own choice is stale gives back the choices it
 * followed, without that one, even when no row is listed any more: the card after it is approved.
 */
async function testStaleChoiceOfACheckIsDropped(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = randomUUID();
  const { writeXlsx } = require('../../common/xlsx');
  h.files.set(attachment, {
    name: 'Applications.xlsx',
    buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Applications', header: 'plain', headers: ['Nom', 'Éditeur', 'Description'], rows: [['Comptabilite', null, 'Grand livre']] }] }),
  });
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  const target = card.import_mapping.validation.report.lookalikes.lines[0].target;
  await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Comptabilite')`, [s.tenantId]);
  const refused = await h.previews.replaceImportChoices(admin, card.preview_id, [{ kind: 'lookalike', line: 2, action: 'update', id: target.id, state: target.state }]);
  assert.deepEqual(refused.import_mapping.validation.issues.map((issue: any) => issue.code), ['CSV_LOOKALIKE_NAME_FOUND']);
  const [stored] = await runner.query(`SELECT mutation_input->'choices' AS choices FROM ai_mutation_previews WHERE id = $1`, [refused.preview_id]);
  assert.ok(!(stored.choices ?? []).some((choice: any) => choice.kind === 'lookalike'), JSON.stringify(stored.choices));
  const next = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns: COLUMNS });
  assert.equal(next.import_mapping.validation.ok, true, JSON.stringify(next.import_mapping.validation.issues));
}

async function testChoiceRouteParsing() {
  const { parseImportChoices } = require('../import/ai-import-targets');
  const id = randomUUID();
  assert.deepEqual(parseImportChoices('applications', [
    { kind: 'unmatch', column: 'supplier_name', value: 'Cegid' },
    { kind: 'lookalike', line: 4, action: 'update', id, state: '0123456789abcdef' },
    { kind: 'lookalikes', action: 'create' },
  ]), [
    { kind: 'unmatch', column: 'supplier_name', value: 'Cegid' },
    { kind: 'lookalike', line: 4, action: 'update', id, state: '0123456789abcdef' },
    { kind: 'lookalikes', action: 'create' },
  ]);
  assert.throws(() => parseImportChoices('applications', [{ kind: 'lookalike', line: 4, action: 'update', item: 3 }]));
  // "Update" without the state of the check (review 4, C5): for one row, or for all rows without their targets.
  assert.throws(() => parseImportChoices('applications', [{ kind: 'lookalike', line: 4, action: 'update', id }]));
  assert.throws(() => parseImportChoices('applications', [{ kind: 'lookalikes', action: 'update' }]));
  assert.throws(() => parseImportChoices('applications', Array.from({ length: 201 }, (_, i) => ({ kind: 'lookalike', line: i + 2, action: 'create' }))));
  assert.equal(parseImportChoices('applications', Array.from({ length: 200 }, (_, i) => ({ kind: 'lookalike', line: i + 2, action: 'create' }))).length, 200);
  // Another import takes no lookalike choice.
  assert.throws(() => parseImportChoices('assets', [{ kind: 'lookalike', line: 4, action: 'create' }]));
}

async function inTenant(harness: Harness, test: (h: Harness, runner: QueryRunner, s: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(harness, runner, await seed(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  await testChoiceRouteParsing();
  const harness = await createHarness();
  try {
    await inTenant(harness, testLeftOutThenCreatedAnyway);
    await inTenant(harness, testNothingToImportStaysPendingThenUpdate);
    await inTenant(harness, testAllLeftOutThenCreateAnywayFromTheCardChoices);
    await inTenant(harness, testTargetGoneBeforeTheApproval);
    await inTenant(harness, testLeftOutRowNameTakenBeforeTheApproval);
    await inTenant(harness, testStaleChoiceAfterARefusedApproval);
    await inTenant(harness, testStaleChoiceOfACheckIsDropped);
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-application-lookalikes.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
