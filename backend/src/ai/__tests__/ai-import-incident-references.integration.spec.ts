import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';

// Kad reads the reference column of an incident file (lot I6c of 26.12.1), as the screen's import
// does: a filled `INC-n` names the incident the row updates, so an export of the register imported
// again creates nothing. A value is a reference for Kad only with its prefix: a column numbering the
// rows 1 to N is not read. An incident the person does not read (a confidential one, outside their
// participation) is refused as an unknown reference is, at the check and at the load, with the same
// answer. A file whose times name no zone is read in the zone of the person who imports it, and the
// card says so.
// The AI surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-incident-references-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; mapping: any; incidentsCsv: any; files: Map<string, { name: string; buffer: Buffer }> };
type UserKey = 'admin' | 'reporter' | 'outsider' | 'otherOwner';
type Seed = { tenantId: string; users: Record<UserKey, string>; conversations: Record<UserKey, string>; incidents: Record<number, string> };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-incident-references.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiAttachmentService } = require('../ai-attachment.service');
  const { AiImportMappingService } = require('../import/ai-import-mapping.service');
  const { IncidentsCsvService } = require('../../incidents/incidents-csv.service');
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
  return {
    app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService), mapping: app.get(AiImportMappingService),
    incidentsCsv: app.get(IncidentsCsvService), files,
  };
}

function attach(h: Harness, name: string, text: string): string {
  const id = randomUUID();
  h.files.set(id, { name, buffer: Buffer.from(text, 'utf8') });
  return id;
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

/**
 * A workspace: an administrator; three incident contributors (the reporter of INC-1 to INC-3, an
 * outsider, the owner of INC-4 only). INC-1 and INC-2 are open to all, INC-3 and INC-4 confidential.
 */
async function seed(runner: QueryRunner, label: string): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-i6c-${label}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const role = async (name: string, permissions: Record<string, string>) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const admin = await role('Administrator', {});
  const contributor = await role('Incident Contributor', { ai_chat: 'member', incidents: 'contributor' });
  const users = {} as Record<UserKey, string>;
  const conversations = {} as Record<UserKey, string>;
  for (const key of ['admin', 'reporter', 'outsider', 'otherOwner'] as UserKey[]) {
    users[key] = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, $3, 'Tester', $4, 'enabled', 'fr')`,
      [tenantId, `${key.toLowerCase()}-${slug}@example.test`, key, key === 'admin' ? admin : contributor]);
    conversations[key] = randomUUID();
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'AI import incident references', 'custom', 'import-model', 'custom', now(), now())`,
      [conversations[key], tenantId, users[key]],
    );
  }
  const incidents: Record<number, string> = {};
  const incident = async (number: number, title: string, confidential: boolean, owner: string | null) => {
    incidents[number] = await insertId(runner,
      `INSERT INTO incidents (tenant_id, item_number, title, severity, status, detected_at, reporter_user_id, owner_user_id, confidential, created_at, updated_at)
       VALUES ($1, $2, $3, 'major', 'open', '2026-10-16T08:38:00Z', $4, $5, $6, now(), now())`,
      [tenantId, number, title, number <= 3 ? users.reporter : null, owner, confidential]);
  };
  await incident(1, 'Fuite cave', false, null);
  await incident(2, 'Panne frigo', false, null);
  await incident(3, 'Accès suspect', true, null);
  await incident(4, 'Vol de badge', true, users.otherOwner);
  // The numbers the import allocates come after the seeded ones.
  await runner.query(`INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'incident', 10)`, [tenantId]);
  return { tenantId, users, conversations, incidents };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey, timeZone?: string) {
  return {
    tenantId: s.tenantId, userId: s.users[user], isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversations[user], ...(timeZone ? { timeZone } : {}),
  };
}

async function enter(runner: QueryRunner, s: Seed) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
}

async function titles(runner: QueryRunner, s: Seed): Promise<string[]> {
  return (await runner.query(`SELECT 'INC-' || item_number || ' ' || title AS r FROM incidents WHERE tenant_id = $1 ORDER BY item_number`, [s.tenantId]))
    .map((row: any) => row.r);
}

/** The file's columns mapped onto the template columns of the same French title, the zone of a header aside. */
async function mapByTitle(h: Harness, context: any, header: string[]) {
  const template = await h.mapping.describeTemplate(context, 'incidents', 'fr');
  const byTitle = new Map(template.columns.map((column: any) => [String(column.title).toLowerCase(), column.column]));
  return header.flatMap((title, index) => {
    const column = byTitle.get(title.replace(/\s*\([^()]*\)\s*$/, '').trim().toLowerCase());
    return column ? [{ column, source: index + 1, confidence: 'high' }] : [];
  });
}

function card(h: Harness, context: any, attachmentId: string, columns: unknown[]) {
  return h.previews.createPreview(context, 'prepare_import_mapping', { attachment_id: attachmentId, entity_type: 'incidents', columns });
}

const errorsOf = (check: any) => check.report.errors.map((error: any) => [error.row, error.column, error.code, error.params]);

// The register exported in French (times of Europe/Paris, as the header names them), one title
// changed, imported again by Kad: INC-1 updated, INC-2 unchanged, nothing created; the times kept.
async function testExportImportedAgain(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin', 'America/New_York');
  const exported = await h.incidentsCsv.export({
    manager: runner.manager, tenantId: s.tenantId, language: 'fr', timeZone: 'Europe/Paris', viewer: { userId: s.users.admin, isAdmin: true },
    query: { q: 'Fuite' },
  });
  const text = String(exported.content).replace(/^﻿/, '');
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  assert.match(headerLine, /Détecté \(Europe\/Paris\)/, headerLine);
  const header = headerLine.split(';');
  const second = (await h.incidentsCsv.export({
    manager: runner.manager, tenantId: s.tenantId, language: 'fr', timeZone: 'Europe/Paris', viewer: { userId: s.users.admin, isAdmin: true },
    query: { q: 'Panne' },
  })).content.toString().replace(/^﻿/, '').trim().split(/\r?\n/)[1];
  const file = attach(h, 'registre.csv', [headerLine, lines[0].replace('Fuite cave', 'Fuite cave R12'), second].join('\n'));
  const columns = await mapByTitle(h, admin, header);
  assert.ok(columns.some((column: any) => column.column === 'ref'), `the reference column is a template column: ${JSON.stringify(columns)}`);
  const preview = await card(h, admin, file, columns);
  const check = preview.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check.report.errors));
  assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 1, 1], JSON.stringify(check));
  assert.deepEqual(preview.import_mapping.read_errors, {});
  // The header names its zone: no supposition of the server about the times.
  assert.deepEqual(preview.import_mapping.assumptions, [], JSON.stringify(preview.import_mapping.assumptions));
  const done = await h.previews.executePreview(admin, preview.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  await enter(runner, s);
  assert.deepEqual(await titles(runner, s), ['INC-1 Fuite cave R12', 'INC-2 Panne frigo', 'INC-3 Accès suspect', 'INC-4 Vol de badge']);
  const [detected] = await runner.query(`SELECT detected_at FROM incidents WHERE tenant_id = $1 AND item_number = 1`, [s.tenantId]);
  assert.equal(new Date(detected.detected_at).toISOString(), '2026-10-16T08:38:00.000Z', 'the time of the export, read in its zone');
  console.log('  an export of the register imported again: INC-1 updated, nothing created, the times kept: OK');
}

// A column "N°" numbering the rows, mapped onto the reference: not read; both rows are new incidents.
async function testRowNumbersAreNoReferences(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const before = await titles(runner, s);
  for (const ids of [['1', '2'], ['INC-1', '2']]) {
    const file = attach(h, 'incidents.csv', `N°;Titre;Gravité\n${ids[0]};Coupure réseau;Majeure\n${ids[1]};Serveur lent;Faible\n`);
    const preview = await card(h, admin, file, [
      { column: 'ref', source: 1, confidence: 'medium' }, { column: 'title', source: 2, confidence: 'high' }, { column: 'severity', source: 3, confidence: 'high' },
    ]);
    const check = preview.import_mapping.validation;
    assert.deepEqual(preview.import_mapping.read_errors, { ref: 'reference-without-prefix' }, ids.join(','));
    assert.equal(check.ok, true, JSON.stringify(check.report.errors));
    assert.deepEqual([check.inserted, check.updated], [2, 0], JSON.stringify(check));
    assert.equal(preview.import_mapping.columns.find((column: any) => column.column === 'ref').filled, 0);
  }
  assert.deepEqual(await titles(runner, s), before, 'nothing written by the checks');
  console.log('  a column of row numbers mapped onto the reference updates nothing: OK');
}

/** The check of a one-row file naming `reference`, by `user`: its errors and its counts. */
async function checkOf(h: Harness, runner: QueryRunner, s: Seed, user: UserKey, reference: string) {
  const file = attach(h, 'incident.csv', `Réf.;Titre;Gravité\n${reference};Titre importé;Mineure\n`);
  const preview = await card(h, ctx(runner, s, user), file, [
    { column: 'ref', source: 1, confidence: 'high' }, { column: 'title', source: 2, confidence: 'high' }, { column: 'severity', source: 3, confidence: 'high' },
  ]);
  return preview;
}

/** A check with the reference's own value set aside: what tells one refused reference from another. */
function shape(preview: any, reference: string) {
  const check = preview.import_mapping.validation;
  return JSON.stringify({ ok: check.ok, counts: [check.inserted, check.updated, check.unchanged, check.skipped], report: check.report })
    .split(reference).join('<ref>');
}

// An unknown reference, an incident of another workspace and an incident the person does not read
// (confidential, outside their participation): the same refusal of the check, on the reference's line.
async function testUnknownAndHiddenReferences(h: Harness, runner: QueryRunner, s: Seed) {
  const unknown = await checkOf(h, runner, s, 'outsider', 'INC-99');
  assert.equal(unknown.import_mapping.validation.ok, false);
  assert.deepEqual(errorsOf(unknown.import_mapping.validation), [[2, 'ref', 'CSV_RECORD_REFERENCE_NOT_FOUND', { value: 'INC-99' }]]);
  // INC-5 exists in another workspace only.
  const otherTenant = await checkOf(h, runner, s, 'outsider', 'INC-5');
  assert.equal(shape(otherTenant, 'INC-5'), shape(unknown, 'INC-99'), 'an incident of another workspace is unknown');
  for (const [user, reference] of [['outsider', 'INC-3'], ['outsider', 'INC-4'], ['otherOwner', 'INC-3'], ['reporter', 'INC-4']] as Array<[UserKey, string]>) {
    const hidden = await checkOf(h, runner, s, user, reference);
    assert.equal(shape(hidden, reference), shape(unknown, 'INC-99'), `${user} on ${reference}: the same answer as an unknown reference`);
    assert.doesNotMatch(JSON.stringify(hidden), /Accès suspect|Vol de badge/, 'no title of the hidden incident');
  }
  // The incidents they read: the reporter updates INC-3, the owner INC-4, the administrator both.
  for (const [user, reference] of [['reporter', 'INC-3'], ['otherOwner', 'INC-4'], ['admin', 'INC-3']] as Array<[UserKey, string]>) {
    const seen = await checkOf(h, runner, s, user, reference);
    assert.equal(seen.import_mapping.validation.ok, true, `${user} on ${reference}: ${JSON.stringify(seen.import_mapping.validation.report.errors)}`);
    assert.deepEqual([seen.import_mapping.validation.inserted, seen.import_mapping.validation.updated], [0, 1]);
  }
  console.log('  an unknown reference, another workspace\'s and a hidden incident: the same refusal of the check: OK');
}

// At the load: a card checked while the person read the incident, approved once they no longer do,
// is refused as a card whose incident was deleted in between is: same refusal, nothing written.
async function testHiddenAtTheLoad(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await titles(runner, s);
  const loadOf = async (reference: string, between: () => Promise<void>) => {
    const preview = await checkOf(h, runner, s, 'otherOwner', reference);
    assert.equal(preview.import_mapping.validation.ok, true, JSON.stringify(preview.import_mapping.validation.report.errors));
    await between();
    const done = await h.previews.executePreview(ctx(runner, s, 'otherOwner'), preview.preview_id);
    assert.equal(done.status, 'failed', JSON.stringify(done));
    await enter(runner, s);
    return { message: String(done.error_message ?? ''), result: done.import_mapping?.result ?? null };
  };
  await runner.query(`SAVEPOINT hidden_at_load`);
  const hidden = await loadOf('INC-4', async () => {
    await runner.query(`UPDATE incidents SET owner_user_id = NULL WHERE tenant_id = $1 AND item_number = 4`, [s.tenantId]);
  });
  await runner.query(`ROLLBACK TO SAVEPOINT hidden_at_load`);
  // An incident of the person, deleted between the check and the load.
  await runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity, status, detected_at, owner_user_id, confidential, created_at, updated_at)
    VALUES ($1, 7, 'Éphémère', 'minor', 'open', now(), $2, false, now(), now())`, [s.tenantId, s.users.otherOwner]);
  const gone = await loadOf('INC-7', async () => {
    await runner.query(`DELETE FROM incidents WHERE tenant_id = $1 AND item_number = 7`, [s.tenantId]);
  });
  assert.equal(JSON.stringify(hidden.result).split('INC-4').join('<ref>'), JSON.stringify(gone.result).split('INC-7').join('<ref>'), 'the same refusal of the load');
  assert.equal(hidden.message, gone.message);
  assert.deepEqual(hidden.result?.report?.errors?.map((error: any) => [error.row, error.column, error.code]), [[2, 'ref', 'CSV_RECORD_REFERENCE_NOT_FOUND']]);
  assert.doesNotMatch(JSON.stringify(hidden), /Vol de badge/);
  assert.deepEqual(await titles(runner, s), before, 'nothing written by the refused loads');
  console.log('  an incident hidden between the check and the load: refused as a deleted one, nothing written: OK');
}

// A file whose times name no zone: read in the zone of the person who imports it (the browser's zone
// of the conversation, else the profile's), and the card says it in its suppositions.
async function testTimesWithoutZone(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(
    `INSERT INTO user_notification_preferences (tenant_id, user_id, timezone) VALUES ($1, $2, 'Europe/Paris')`,
    [s.tenantId, s.users.reporter],
  );
  const cases: Array<{ user: UserKey; zone?: string; instant: string; said: RegExp }> = [
    { user: 'reporter', instant: '2026-11-02T13:30:00.000Z', said: /Europe\/Paris/ },
    { user: 'admin', zone: 'America/New_York', instant: '2026-11-02T19:30:00.000Z', said: /America\/New_York/ },
  ];
  for (const { user, zone, instant, said } of cases) {
    const context = ctx(runner, s, user, zone);
    const file = attach(h, 'nouveaux.csv', 'Titre;Gravité;Détecté\nPorte de cave ouverte;Majeure;02/11/2026 14:30\n');
    const preview = await card(h, context, file, [
      { column: 'title', source: 1, confidence: 'high' }, { column: 'severity', source: 2, confidence: 'high' },
      { column: 'detected_at', source: 3, confidence: 'high', date_order: 'day-first' },
    ]);
    const check = preview.import_mapping.validation;
    assert.equal(check.ok, true, JSON.stringify(check.report.errors));
    assert.equal(preview.import_mapping.assumptions.length, 1, JSON.stringify(preview.import_mapping.assumptions));
    assert.match(preview.import_mapping.assumptions[0], said);
    assert.match(preview.import_mapping.assumptions[0], /^Les heures sans fuseau horaire/);
    // No warning that the times were read as UTC.
    assert.deepEqual((check.report.warnings ?? []).filter((warning: any) => warning.code === 'CSV_HEADER_ZONELESS_DATE_TIMES'), []);
    await runner.query(`SAVEPOINT zone_case`);
    // The approval, from another request of the person (no browser zone): the card's zone.
    const done = await h.previews.executePreview(ctx(runner, s, user), preview.preview_id);
    assert.equal(done.status, 'executed', done.error_message ?? '');
    await enter(runner, s);
    const [row] = await runner.query(`SELECT detected_at FROM incidents WHERE tenant_id = $1 AND title = 'Porte de cave ouverte'`, [s.tenantId]);
    assert.equal(new Date(row.detected_at).toISOString(), instant, `${user}: 14:30 in the person's zone`);
    await runner.query(`ROLLBACK TO SAVEPOINT zone_case`);
  }
  console.log('  times without a zone: read in the zone of the person who imports, said on the card: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const other = await seed(runner, 'b');
      await runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity, status, detected_at, confidential, created_at, updated_at)
        VALUES ($1, 5, 'Autre espace', 'minor', 'open', now(), false, now(), now())`, [other.tenantId]);
      const s = await seed(runner, 'a');
      await testRowNumbersAreNoReferences(harness, runner, s);
      await testUnknownAndHiddenReferences(harness, runner, s);
      await testHiddenAtTheLoad(harness, runner, s);
      await testTimesWithoutZone(harness, runner, s);
      await testExportImportedAgain(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-incident-references.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
