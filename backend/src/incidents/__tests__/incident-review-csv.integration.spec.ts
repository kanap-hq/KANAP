/**
 * §3.8 (CSV) and §3.3 (closure snapshot) integration coverage for the incident
 * review document — phase A3.
 *
 * Sibling of `knowledge/__tests__/incident-review-access.integration.spec.ts`
 * and wired into the same npm script (`test:incident-review-access`). Runs the
 * real SQL against `DATABASE_URL`; every test seeds inside a transaction that is
 * rolled back afterwards.
 */
import 'dotenv/config';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Tenant } from '../../tenants/tenant.entity';
import { Location } from '../../locations/location.entity';
import * as assert from 'node:assert/strict';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { timeZoneOf } from '../../common/csv-sheet';
import { handmadeXlsx } from '../../common/xlsx/__tests__/fixtures/handmade';
import { ItemNumberService } from '../../common/item-number.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
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
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';
import { Incident } from '../incident.entity';
import { IncidentsCsvService } from '../incidents-csv.service';
import { IncidentsService } from '../services/incidents.service';

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

const REVIEW_HEADERS = 'ref;title;severity;status;detected_at;confidential;description;review';

function createKnowledgeService(manager: any): KnowledgeService {
  const permissions = new PermissionsService(
    manager.getRepository(UserPageRole),
    manager.getRepository(RolePermission),
  );
  const users: any = {
    findById: async (id: string, opts?: any) => (opts?.manager ?? manager)
      .getRepository(User)
      .findOne({ where: { id }, relations: ['role'] }),
  };
  const audit: any = { log: async () => undefined };
  const storage: any = {
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    getObjectStream: async () => ({ stream: null, contentType: null, contentLength: null }),
  };
  const notifications: any = { notifyShare: async () => undefined };
  const itemNumbers = new ItemNumberService();

  return new KnowledgeService(
    manager.getRepository(Document),
    manager.getRepository(DocumentFolder),
    manager.getRepository(IntegratedDocumentBinding),
    manager.getRepository(DocumentLibrary),
    manager.getRepository(DocumentType),
    manager.getRepository(DocumentVersion),
    manager.getRepository(DocumentEditLock),
    manager.getRepository(DocumentAttachment),
    manager.getRepository(DocumentActivity),
    manager.getRepository(DocumentContributor),
    manager.getRepository(DocumentClassification),
    manager.getRepository(DocumentReference),
    manager.getRepository(DocumentApplication),
    manager.getRepository(DocumentAsset),
    manager.getRepository(DocumentProject),
    manager.getRepository(DocumentRequest),
    manager.getRepository(DocumentTask),
    itemNumbers as any,
    audit,
    {} as any,
    {} as any,
    storage,
    {} as any,
    dataSource,
    permissions,
    users,
    {} as any,
    notifications,
  );
}

function createServices(manager: any) {
  const knowledge = createKnowledgeService(manager);
  const permissions = new PermissionsService(
    manager.getRepository(UserPageRole),
    manager.getRepository(RolePermission),
  );
  const importService: any = {
    convertToMarkdown: async () => ({ markdown: '', images: [], warnings: [], omittedTargets: [] }),
  };
  const integrated = new IntegratedDocumentsService(
    manager.getRepository(IntegratedDocumentBinding),
    knowledge,
    permissions,
    importService,
  );
  const resolver = new CsvResolverService();
  const incidents = new IncidentsService(
    manager.getRepository(Incident),
    { log: async () => undefined } as any,
    new ItemNumberService(),
    integrated,
  );
  const csv = new IncidentsCsvService(
    new CsvExportService(resolver),
    new CsvImportService(resolver, new CsvJsonValidators()),
    integrated,
    new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), { log: async () => undefined } as any),
    incidents,
  );
  return { knowledge, integrated, csv, incidents };
}

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
}

async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  roleName: string,
  permissions: Record<string, 'reader' | 'contributor' | 'member' | 'admin'>,
) {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $3, false, false, now(), now())`,
    [roleId, tenantId, roleName],
  );
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(
      `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [randomUUID(), tenantId, roleId, resource, level],
    );
  }
  return roleId;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, email: string) {
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (
       id, tenant_id, first_name, last_name, email, password_hash, role_id,
       mfa_enabled, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
    [userId, tenantId, email.split('@')[0], email, roleId],
  );
  return userId;
}

async function seedFixture(runner: QueryRunner) {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', now(), now())`,
    [tenantId, `a3-${tag}`, `a3-${tag}`],
  );
  await setCurrentTenant(runner, tenantId);
  // Same seed the tenant bootstrap runs: it creates the Managed Docs library,
  // the Incidents folder, the review document type, the template and the slot
  // settings row `provisionForIncident` reads.
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);

  const roles = {
    admin: await seedRole(runner, tenantId, `IncAdmin ${tag}`, { incidents: 'admin', knowledge: 'member' }),
    contributor: await seedRole(runner, tenantId, `IncContrib ${tag}`, { incidents: 'contributor' }),
  };
  const users = {
    admin: await seedUser(runner, tenantId, roles.admin, `a3admin-${tag}@example.com`),
    contributor: await seedUser(runner, tenantId, roles.contributor, `a3contrib-${tag}@example.com`),
    other: await seedUser(runner, tenantId, roles.contributor, `a3other-${tag}@example.com`),
  };

  return { tag, tenantId, roles, users };
}

async function withFixture(fn: (runner: QueryRunner, fixture: Fixture) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const fixture = await seedFixture(runner);
    await setCurrentTenant(runner, fixture.tenantId);
    await fn(runner, fixture);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function csvFile(content: string): Express.Multer.File {
  const withBom = content.startsWith('﻿') ? content : `﻿${content}`;
  return {
    buffer: Buffer.from(withBom, 'utf8'),
    fieldname: 'file',
    originalname: 'incidents.csv',
    encoding: 'utf8',
    mimetype: 'text/csv',
    size: Buffer.byteLength(withBom),
  } as Express.Multer.File;
}

/** CSV cell quoting: doubles the quotes, so a multiline Markdown body survives. */
function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** One record per data line, keyed by the file's header (French headers included). */
function exportTable(content: string): Array<Record<string, string>> {
  return parseCsvSync(content.replace(/^\uFEFF/, ''), {
    delimiter: ';',
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>;
}

/** The titles of the data lines of an incident export, in file order (the title is the second column). */
function exportTitles(content: string): string[] {
  const rows = parseCsvSync(content.replace(/^\uFEFF/, ''), {
    delimiter: ';',
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as string[][];
  return rows.slice(1).map((row) => row[1] ?? '');
}

async function createIncident(
  runner: QueryRunner,
  f: Fixture,
  services: ReturnType<typeof createServices>,
  overrides: Record<string, unknown> = {},
) {
  return services.incidents.create(
    {
      title: `Incident ${randomUUID().slice(0, 6)}`,
      severity: 'major',
      detected_at: new Date().toISOString(),
      ...overrides,
    },
    f.users.admin,
    { manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true } },
  );
}

async function readReview(runner: QueryRunner, f: Fixture, incidentId: string) {
  const rows = await runner.manager.query(
    `SELECT d.id::text AS document_id, d.item_number, d.content_markdown, d.current_version_number,
            (SELECT count(*)::int FROM document_versions v WHERE v.document_id = d.id) AS versions
     FROM integrated_document_bindings b
     JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1 AND b.source_entity_type = 'incidents'
       AND b.source_entity_id = $2 AND b.slot_key = 'review'`,
    [f.tenantId, incidentId],
  );
  return rows[0] ?? null;
}

async function readEntries(runner: QueryRunner, f: Fixture, incidentId: string) {
  return runner.manager.query(
    `SELECT kind, content, changed_fields FROM incident_entries
     WHERE tenant_id = $1 AND incident_id = $2 ORDER BY occurred_at ASC, created_at ASC`,
    [f.tenantId, incidentId],
  );
}

function importOpts(runner: QueryRunner, f: Fixture, userId: string, isAdmin = true) {
  return {
    manager: runner.manager,
    tenantId: f.tenantId,
    userId,
    isAdmin,
    viewer: { userId, isAdmin },
  };
}

// ---------------------------------------------------------------------------
// 1. Provisioning at creation + the review column round-trips
// ---------------------------------------------------------------------------

const MULTILINE_REVIEW = [
  '## Detailed description',
  '',
  'Mail stopped; **Lyon** offline.',
  '',
  '## Impact',
  '',
  '- 300 mailboxes',
  '- 2 h downtime',
  '',
  '![shot](https://cdn.example/a.png)',
].join('\n');

async function testExportImportRoundTrip() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    // The category is exported as its name, the import resolves it back to its code.
    const incident = await createIncident(runner, f, services, { category: 'security', personal_data_affected: true });

    // Creation provisions the review from the template.
    const provisioned = await readReview(runner, f, incident.id);
    assert.ok(provisioned, 'creation must provision the review document');
    assert.match(provisioned.content_markdown, /## Lessons learned/);

    await services.integrated.writeIncidentReviewForImport(incident.id, MULTILINE_REVIEW, f.users.admin, {
      manager: runner.manager,
    });

    const exported = await services.csv.export({
      manager: runner.manager,
      tenantId: f.tenantId,
      language: 'fr',
      viewer: { userId: f.users.admin, isAdmin: true },
    });
    assert.ok(exported.content.includes("Revue d'incident"), 'the review column is exported by default, in the file\'s language');
    assert.ok(exported.content.includes('- 300 mailboxes'), 'the multiline body is exported');
    // Date-times in the export language's form (UTC), the way the other exports write days.
    const detected = new Date(incident.detected_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    const frenchDay = `${pad(detected.getUTCDate())}/${pad(detected.getUTCMonth() + 1)}/${detected.getUTCFullYear()}`;
    assert.ok(exported.content.includes(`${frenchDay} ${pad(detected.getUTCHours())}:${pad(detected.getUTCMinutes())}`), exported.content);
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(exported.content), 'no ISO timestamp left in the file');

    // Re-importing the export changes nothing: every row counts as unchanged, in both modes.
    const exportedFile = exported.content.replace(/^﻿/, '');
    for (const mode of ['enrich', 'replace'] as const) {
      const dry = await services.csv.import(
        csvFile(exportedFile),
        { dryRun: true, mode, operation: 'upsert' },
        importOpts(runner, f, f.users.admin),
      );
      assert.deepEqual(dry.errors, []);
      assert.deepEqual([dry.updated, dry.unchanged], [0, 1], `${mode}: the exported row is unchanged`);
      assert.deepEqual(dry.warnings, [], `${mode}: every date-time names its zone`);
    }
    // An edited review is an update.
    const edited = await services.csv.import(
      csvFile(exportedFile.replace('- 300 mailboxes', '- 400 mailboxes')),
      { dryRun: true, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual([edited.updated, edited.unchanged], [1, 0], 'an edited review is an update');

    const before = await readReview(runner, f, incident.id);
    const result = await services.csv.import(
      csvFile(exportedFile),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);

    const after = await readReview(runner, f, incident.id);
    assert.equal(after.content_markdown, MULTILINE_REVIEW, 'the Markdown round-trips unchanged');
    assert.equal(after.versions, before.versions, 'an identical body creates no version');
  });
}

/**
 * The export follows the list: its column filters, quick search and sort, through the list's own
 * WHERE builder. A restricted incident stays out for a viewer who may not see it, even when the
 * filter would match it. The template keeps its meaning and ignores the list query.
 */
/**
 * A French file writes a shipped category as the screen shows it (« Données ») and a name the
 * tenant typed as stored. Importing that file keeps both codes.
 */
async function testFrenchCategoryRoundTrip() {
  await withFixture(async (runner, f) => {
    await runner.query(
      `UPDATE tenants
       SET metadata = jsonb_set(
         jsonb_set(COALESCE(metadata, '{}'::jsonb), '{it_ops}', COALESCE(metadata->'it_ops', '{}'::jsonb), true),
         '{it_ops,incident_categories}',
         $2::jsonb,
         true
       )
       WHERE id = $1`,
      [f.tenantId, JSON.stringify([
        { code: 'data', label: 'Data' },
        { code: 'plant_stop', label: 'Arrêt usine' },
      ])],
    );
    const services = createServices(runner.manager);
    const viewer = { userId: f.users.admin, isAdmin: true };
    const dataIncident = await createIncident(runner, f, services, { title: 'Data loss', category: 'data' });
    const customIncident = await createIncident(runner, f, services, { title: 'Plant stop', category: 'plant_stop' });

    const french = await services.csv.export({
      manager: runner.manager,
      tenantId: f.tenantId,
      language: 'fr',
      viewer,
    });
    const rows = exportTable(french.content);
    const byTitle = new Map(rows.map((row) => [row.Titre, row]));
    assert.equal(byTitle.get('Data loss')?.Catégorie, 'Données');
    assert.equal(byTitle.get('Plant stop')?.Catégorie, 'Arrêt usine');
    assert.equal(rows.some((row) => row.Catégorie === 'Data' || row.Catégorie === 'data'), false);

    const result = await services.csv.import(
      csvFile(french.content),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.errors, []);
    const stored = await runner.manager.query(
      `SELECT title, category FROM incidents WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY title`,
      [f.tenantId, [dataIncident.id, customIncident.id]],
    );
    assert.deepEqual(stored, [
      { title: 'Data loss', category: 'data' },
      { title: 'Plant stop', category: 'plant_stop' },
    ]);
  });
}

async function testExportFollowsTheList() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const adminViewer = { userId: f.users.admin, isAdmin: true };
    const viewer = { userId: f.users.contributor, isAdmin: false };
    const opts = { manager: runner.manager, tenantId: f.tenantId, language: 'fr' as const };
    const lyon = await createIncident(runner, f, services, {
      title: 'Mail outage Lyon', severity: 'major', status: 'open', detected_at: '2026-10-05T08:00:00Z',
      owner_user_id: f.users.admin,
      personal_data_affected: true, authority_notification_required: true,
      authority_notified_at: '2026-10-06T09:00:00Z',
    });
    const paris = await createIncident(runner, f, services, {
      title: 'VPN outage Paris', severity: 'critical', status: 'closed', detected_at: '2026-10-20T08:00:00Z',
      owner_user_id: f.users.contributor,
    });
    const hidden = await createIncident(runner, f, services, {
      title: 'Mail outage secret', severity: 'major', status: 'open', detected_at: '2026-10-10T08:00:00Z',
      confidential: true, reporter_user_id: f.users.other, owner_user_id: f.users.other,
    });

    // A severity filter and the list's sort: the file holds the matching rows in that order.
    const major = await services.csv.export({
      ...opts,
      viewer: adminViewer,
      scope: 'data',
      query: {
        filters: JSON.stringify({ severity: { filterType: 'set', values: ['major'] } }),
        sort: 'detected_at:ASC',
      },
    });
    assert.deepEqual(exportTitles(major.content), [lyon.title, hidden.title], 'severity filter and sort follow the list');

    // The same filter for a viewer who is neither administrator, reporter nor owner: the
    // restricted row is not widened into view by the filter.
    const visible = await services.csv.export({
      ...opts,
      viewer,
      scope: 'data',
      query: {
        filters: JSON.stringify({ severity: { filterType: 'set', values: ['major'] } }),
        sort: 'detected_at:ASC',
      },
    });
    assert.deepEqual(exportTitles(visible.content), [lyon.title], 'a restricted incident stays invisible');

    // Quick search and sort.
    const searched = await services.csv.export({
      ...opts,
      viewer: adminViewer,
      scope: 'data',
      query: { q: 'outage', sort: 'detected_at:DESC' },
    });
    assert.deepEqual(exportTitles(searched.content), [paris.title, hidden.title, lyon.title], 'search and sort follow the list');

    // Owner: a column the list filters and sorts through its users join.
    const owner = await runner.manager.query(
      `SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1`, [f.users.admin],
    );
    const byOwner = await services.csv.export({
      ...opts,
      viewer: adminViewer,
      scope: 'data',
      query: {
        filters: JSON.stringify({ owner_name: { filterType: 'set', values: [owner[0].name] } }),
        sort: 'owner_name:ASC',
      },
    });
    assert.deepEqual(exportTitles(byOwner.content), [lyon.title], 'the owner filter and sort use the list joins');
    const byOwnerSort = await services.csv.export({
      ...opts,
      viewer: adminViewer,
      scope: 'data',
      query: { q: 'outage', sort: 'owner_name:ASC' },
    });
    assert.deepEqual(exportTitles(byOwnerSort.content), [lyon.title, paris.title, hidden.title], 'sorting on owner name follows the list');

    // The compliance columns the list now reads, and their yes or no filter.
    const listed = await services.incidents.list(
      { sort: 'detected_at:ASC' },
      { manager: runner.manager, tenantId: f.tenantId, viewer: adminViewer },
    );
    const listedLyon = listed.items.find((item: any) => String(item.id) === String(lyon.id));
    assert.equal(listedLyon?.personal_data_affected, true);
    assert.equal(listedLyon?.authority_notification_required, true);
    assert.ok(listedLyon?.authority_notified_at);
    const compliance = await services.csv.export({
      ...opts,
      viewer: adminViewer,
      scope: 'data',
      query: {
        filters: JSON.stringify({ personal_data_affected: { filterType: 'set', values: ['true'] } }),
        sort: 'detected_at:ASC',
      },
    });
    assert.deepEqual(exportTitles(compliance.content), [lyon.title], 'a yes or no filter follows the list');

    // A period filter (AG Grid date model), as the list sends it.
    const period = await services.csv.export({
      ...opts,
      viewer: adminViewer,
      scope: 'data',
      query: {
        filters: JSON.stringify({ detected_at: { filterType: 'date', type: 'inRange', dateFrom: '2026-10-01', dateTo: '2026-10-15' } }),
        sort: 'detected_at:ASC',
      },
    });
    assert.deepEqual(exportTitles(period.content), [lyon.title, hidden.title], 'period filter follows the list');

    // The template is headers only, whatever the list query says.
    const template = await services.csv.export({
      ...opts,
      viewer: adminViewer,
      scope: 'template',
      query: { filters: JSON.stringify({ severity: { filterType: 'set', values: ['major'] } }) },
    });
    assert.equal(template.rows, 0);
    assert.equal(template.content.replace(/^\uFEFF/, '').trim().split(/\r?\n/).length, 1, 'the template has no data line');
  });
}

/**
 * Date-times are written in the local time of the user who exports, and the
 * header of each date-time column names that zone (`detected_at (Europe/Paris)`).
 * The import reads each cell in the zone its header names, UTC when it names none.
 */
async function testDateTimesInTheExportersZone() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services, { detected_at: '2026-10-16T08:38:00Z' });
    // Both changes of time in Paris: the March change day, then the October one.
    await runner.query(
      `UPDATE incidents SET started_at = '2026-03-29T10:00:00Z', resolved_at = '2026-10-25T10:00:00Z'
       WHERE tenant_id = $1 AND id = $2`,
      [f.tenantId, incident.id],
    );
    const stored = async () => (await runner.query(
      `SELECT started_at, detected_at, resolved_at FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [f.tenantId, incident.id],
    ))[0];
    const instants = async () => {
      const row = await stored();
      return [row.started_at, row.detected_at, row.resolved_at].map((value: Date) => value.toISOString());
    };
    const original = await instants();

    const exported = await services.csv.export({
      manager: runner.manager,
      tenantId: f.tenantId,
      language: 'fr',
      viewer: { userId: f.users.admin, isAdmin: true },
      timeZone: 'Europe/Paris',
    });
    const file = exported.content.replace(/^\uFEFF/, '');
    const header = file.split('\n')[0].split(';');
    // The headers are the screen's words in the file's language, and a date-time names its zone
    // after its translated header.
    for (const [column, label] of Object.entries({
      started_at: 'Début', detected_at: 'Détecté', resolved_at: 'Résolu', closed_at: 'Clôturé', authority_notified_at: 'Notifié le',
    })) {
      assert.ok(header.includes(`${label} (Europe/Paris)`), `${column} names its zone: ${header.join(';')}`);
    }
    for (const label of ['Réf.', 'Titre', 'Gravité', 'Statut', "Revue d'incident"]) {
      assert.ok(header.includes(label), `${label} keeps its translated header`);
    }
    assert.ok(file.includes(';Majeure;Ouvert;'), 'the severity and the status are the screen words, not their codes');
    assert.ok(file.includes('16/10/2026 10:38'), 'the local time of Paris, not 08:38 UTC');
    assert.ok(file.includes('29/03/2026 12:00'), 'summer time after the March change');
    assert.ok(file.includes('25/10/2026 11:00'), 'winter time after the October change');

    // Round trip: the export re-imports unchanged and restores the same instants.
    for (const mode of ['enrich', 'replace'] as const) {
      const dry = await services.csv.import(
        csvFile(file),
        { dryRun: true, mode, operation: 'upsert' },
        importOpts(runner, f, f.users.admin),
      );
      assert.deepEqual(dry.errors, []);
      assert.deepEqual([dry.updated, dry.unchanged], [0, 1], `${mode}: the exported row is unchanged`);
    }
    const edited = file.replace('16/10/2026 10:38', '16/10/2026 10:45');
    const applied = await services.csv.import(
      csvFile(edited),
      { dryRun: false, mode: 'replace', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(applied.errors, []);
    assert.deepEqual(await instants(), [original[0], '2026-10-16T08:45:00.000Z', original[2]], 'read in Paris time');
    await services.csv.import(
      csvFile(file),
      { dryRun: false, mode: 'replace', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(await instants(), original, 'the export restores the same instants');

    // A header without a zone (an older file, a hand-made one) is read as UTC.
    const plain = file.replace(/ \(Europe\/Paris\)/g, '');
    const utc = await services.csv.import(
      csvFile(plain),
      { dryRun: false, mode: 'replace', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(utc.errors, []);
    const columns = ['started_at', 'detected_at', 'resolved_at', 'closed_at', 'authority_notified_at'];
    assert.deepEqual(
      utc.warnings.map((w) => [w.row, w.code, w.params]),
      [[0, 'CSV_HEADER_ZONELESS_DATE_TIMES', { columns: columns.join(', '), example: columns[0] }]],
      'the report names the date-times read as UTC',
    );
    assert.deepEqual(await instants(), ['2026-03-29T12:00:00.000Z', '2026-10-16T10:38:00.000Z', '2026-10-25T11:00:00.000Z']);

    // A zone nobody knows is refused, with the coded error the screen translates.
    const unknown = await services.csv.import(
      csvFile(file.replace('Détecté (Europe/Paris)', 'Détecté (Mars/Olympus)')),
      { dryRun: true, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.equal(unknown.ok, false);
    assert.deepEqual(
      unknown.errors.map((e) => [e.row, e.column, e.code, e.params]),
      [[0, 'detected_at', 'CSV_HEADER_UNKNOWN_TIME_ZONE', { column: 'detected_at', zone: 'Mars/Olympus' }]],
    );
  });
}

/** The zone of the export: the browser's, then the user's notification zone, then UTC. */
async function testExportTimeZoneSource() {
  await withFixture(async (runner, f) => {
    const manager = runner.manager;
    await runner.query(
      `INSERT INTO user_notification_preferences (tenant_id, user_id, timezone) VALUES ($1, $2, 'America/New_York')`,
      [f.tenantId, f.users.admin],
    );
    assert.equal(await timeZoneOf(manager, f.tenantId, f.users.admin, 'Asia/Tokyo'), 'Asia/Tokyo');
    assert.equal(await timeZoneOf(manager, f.tenantId, f.users.admin, undefined), 'America/New_York');
    assert.equal(await timeZoneOf(manager, f.tenantId, f.users.admin, 'Not/AZone'), 'America/New_York');
    assert.equal(await timeZoneOf(manager, f.tenantId, f.users.other, undefined), 'UTC', 'no stored zone');
    assert.equal(await timeZoneOf(manager, f.tenantId, null, undefined), 'UTC');
  });
}

// ---------------------------------------------------------------------------
// 2. Empty cell, dry run
// ---------------------------------------------------------------------------

async function testEmptyCellAndDryRun() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services);
    await services.integrated.writeIncidentReviewForImport(incident.id, MULTILINE_REVIEW, f.users.admin, {
      manager: runner.manager,
    });
    const before = await readReview(runner, f, incident.id);

    // Empty cell: unchanged, in replace mode too.
    const empty = `${REVIEW_HEADERS}\nINC-${incident.item_number};Renamed;major;open;2026-03-10T08:00:00Z;false;short;`;
    const emptyResult = await services.csv.import(
      csvFile(empty),
      { dryRun: false, mode: 'replace', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(emptyResult.errors, []);
    const afterEmpty = await readReview(runner, f, incident.id);
    assert.equal(afterEmpty.content_markdown, before.content_markdown, 'a blank cell leaves the review alone');
    assert.equal(afterEmpty.versions, before.versions);

    // Dry run: validated, nothing written, nothing provisioned.
    const incidentCount = await runner.manager.query(
      'SELECT count(*)::int AS total FROM incidents WHERE tenant_id = $1', [f.tenantId],
    );
    const dry = `${REVIEW_HEADERS}\nINC-${incident.item_number};Renamed;major;open;2026-03-10T08:00:00Z;false;short;${cell('## Impact\n\nnew body')}\n;Brand new;minor;open;2026-03-10T08:00:00Z;false;short;${cell('## Impact\n\nanother')}`;
    const dryResult = await services.csv.import(
      csvFile(dry),
      { dryRun: true, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.equal(dryResult.dryRun, true);
    assert.deepEqual(dryResult.errors, []);
    const afterDry = await readReview(runner, f, incident.id);
    assert.equal(afterDry.content_markdown, before.content_markdown, 'a dry run writes nothing');
    assert.equal(afterDry.versions, before.versions);
    const countAfter = await runner.manager.query(
      'SELECT count(*)::int AS total FROM incidents WHERE tenant_id = $1', [f.tenantId],
    );
    assert.equal(countAfter[0].total, incidentCount[0].total, 'a dry run inserts nothing');

    // Invalid Markdown is reported at dry run, before anything is provisioned.
    const bad = `${REVIEW_HEADERS}\nINC-${incident.item_number};Renamed;major;open;2026-03-10T08:00:00Z;false;short;${cell('<script>alert(1)</script>')}`;
    const badResult = await services.csv.import(
      csvFile(bad),
      { dryRun: true, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.equal(badResult.ok, false);
    assert.match(badResult.errors[0].message, /must be Markdown/);
  });
}

// ---------------------------------------------------------------------------
// 3. Insert rows: provisioning + review body
// ---------------------------------------------------------------------------

// The shipped template is written in the creating user's language; a template the tenant edited is kept as it is.
async function testReviewTemplateFollowsTheCreatorLanguage() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const english = await createIncident(runner, f, services);
    assert.match((await readReview(runner, f, english.id)).content_markdown, /^## Detailed description\n/);

    await runner.manager.query(`UPDATE users SET locale = 'fr' WHERE id = $1`, [f.users.admin]);
    const french = await createIncident(runner, f, services);
    assert.equal(
      (await readReview(runner, f, french.id)).content_markdown.trim(),
      ['## Description détaillée', '## Impact', '## Cause racine', '## Actions correctives', '## Enseignements'].join('\n\n'),
    );
    await runner.manager.query(`UPDATE users SET locale = 'de' WHERE id = $1`, [f.users.admin]);
    const german = await createIncident(runner, f, services);
    assert.match((await readReview(runner, f, german.id)).content_markdown, /^## Ausführliche Beschreibung\n/);

    // The first review keeps its English headings: existing documents are user content.
    assert.match((await readReview(runner, f, english.id)).content_markdown, /^## Detailed description\n/);

    await runner.manager.query(
      `UPDATE documents d SET content_markdown = '## Our own template'
       FROM integrated_document_slot_settings s
       WHERE s.tenant_id = $1 AND s.source_entity_type = 'incidents' AND s.slot_key = 'review'
         AND d.id = s.template_document_id AND d.tenant_id = s.tenant_id`,
      [f.tenantId],
    );
    const custom = await createIncident(runner, f, services);
    assert.equal((await readReview(runner, f, custom.id)).content_markdown.trim(), '## Our own template');
  });
}

async function testInsertedRowsAreProvisioned() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const csv = [
      REVIEW_HEADERS,
      `;From template;minor;open;2026-03-10T08:00:00Z;false;short;`,
      `;With body;major;open;2026-03-10T08:00:00Z;false;short;${cell(MULTILINE_REVIEW)}`,
      `;Closed on import;major;closed;2026-03-10T08:00:00Z;false;short;${cell('## Impact\n\nimported closed')}`,
    ].join('\n');

    const result = await services.csv.import(
      csvFile(csv),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.inserted, 3);

    const rows = await runner.manager.query(
      `SELECT id::text AS id, title, status FROM incidents WHERE tenant_id = $1 ORDER BY item_number ASC`,
      [f.tenantId],
    );
    assert.equal(rows.length, 3);

    const fromTemplate = await readReview(runner, f, rows[0].id);
    assert.ok(fromTemplate, 'an inserted row is provisioned');
    assert.match(fromTemplate.content_markdown, /## Corrective actions/);

    const withBody = await readReview(runner, f, rows[1].id);
    assert.equal(withBody.content_markdown, MULTILINE_REVIEW);

    // Inserted directly closed: the review exists and the closure snapshot was
    // taken after the review write, so it freezes the imported body (§3.8).
    const closed = await readReview(runner, f, rows[2].id);
    assert.match(closed.content_markdown, /imported closed/);
    const entries = await readEntries(runner, f, rows[2].id);
    const closure = entries.find((e: any) => e.changed_fields?.review_version);
    assert.ok(closure, 'the closure references a review version');
    assert.equal(closure.changed_fields.review_version.to.document_id, closed.document_id);
    assert.ok(closure.changed_fields.review_version.to.version_number >= 1);
    const closureVersion = await runner.manager.query(
      `SELECT content_markdown FROM document_versions
       WHERE document_id = $1 AND version_number = $2`,
      [closed.document_id, closure.changed_fields.review_version.to.version_number],
    );
    assert.match(closureVersion[0].content_markdown, /imported closed/);
  });
}

// ---------------------------------------------------------------------------
// 4. A closed incident can still be corrected by CSV, and it is versioned
// ---------------------------------------------------------------------------

async function testClosedIncidentImportIsAllowedAndVersioned() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services);
    const opts = { manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true } };

    await services.integrated.writeIncidentReviewForImport(incident.id, MULTILINE_REVIEW, f.users.admin, {
      manager: runner.manager,
    });
    await services.incidents.update(incident.id, { status: 'closed' }, f.users.admin, opts);

    const entries = await readEntries(runner, f, incident.id);
    const closure = entries.find((e: any) => e.changed_fields?.review_version);
    assert.ok(closure, 'closing stores the review version on the transition entry');
    const closureVersionNumber = closure.changed_fields.review_version.to.version_number;

    // An ordinary document write is refused now.
    await assert.rejects(
      services.integrated.updateBySource(
        'incidents', incident.id, 'review',
        { content_markdown: 'sneaky', save_mode: 'manual' },
        f.users.admin, null, { manager: runner.manager },
      ),
      /closed/i,
      'the freeze exemption must not be reachable from the ordinary document route',
    );

    // The CSV exemption may correct it, and versions the change.
    const before = await readReview(runner, f, incident.id);
    const csv = `${REVIEW_HEADERS}\nINC-${incident.item_number};${incident.title};major;closed;2026-03-10T08:00:00Z;false;short;${cell('## Impact\n\ncorrected after closure')}`;
    const result = await services.csv.import(
      csvFile(csv),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(result.errors, []);

    const after = await readReview(runner, f, incident.id);
    assert.match(after.content_markdown, /corrected after closure/);
    assert.equal(after.versions, before.versions + 1, 'the CSV change is versioned');

    // The version the closure referenced is untouched.
    const stored = await runner.manager.query(
      `SELECT content_markdown FROM document_versions WHERE document_id = $1 AND version_number = $2`,
      [after.document_id, closureVersionNumber],
    );
    assert.match(stored[0].content_markdown, /300 mailboxes/, 'the closure version must not be rewritten');

    // And the import entry references its own version.
    const afterEntries = await readEntries(runner, f, incident.id);
    const importEntry = afterEntries.find(
      (e: any) => e.content === 'Incident review imported from CSV',
    );
    assert.ok(importEntry, 'an effective CSV change journals a system entry');
    assert.equal(importEntry.changed_fields.review_version.to.document_id, after.document_id);
    assert.notEqual(importEntry.changed_fields.review_version.to.version_number, closureVersionNumber);
  });
}

// ---------------------------------------------------------------------------
// 4b. The forward-only lifecycle also holds on import; an admin move is journalled
// ---------------------------------------------------------------------------

async function readStatus(runner: QueryRunner, incidentId: string): Promise<string> {
  const rows = await runner.manager.query('SELECT status FROM incidents WHERE id = $1', [incidentId]);
  return String(rows[0]?.status ?? '');
}

/** One update row on an existing incident, with the given status and no review change. */
function statusImportRow(incident: { item_number: number; title: string }, status: string): string {
  return `${REVIEW_HEADERS}\nINC-${incident.item_number};${incident.title};major;${status};2026-03-10T08:00:00Z;false;short;`;
}

async function testImportLifecycleGuardAndAdminJournal() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const adminOpts = { manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true } };
    const contributor = importOpts(runner, f, f.users.contributor, false);
    const admin = importOpts(runner, f, f.users.admin, true);

    const closed = await createIncident(runner, f, services, { title: 'Closed before import' });
    await services.incidents.update(closed.id, { status: 'closed' }, f.users.admin, adminOpts);

    // A contributor cannot reopen or cancel it by file, and nothing changes.
    const entriesBefore = await readEntries(runner, f, closed.id);
    const rowBefore = (await runner.manager.query(
      'SELECT title, severity, status, detected_at, description FROM incidents WHERE id = $1',
      [closed.id],
    ))[0];
    for (const target of ['open', 'cancelled']) {
      const result = await services.csv.import(
        csvFile(statusImportRow(closed, target)),
        { dryRun: false, mode: 'enrich', operation: 'upsert' },
        contributor,
      );
      assert.equal(result.ok, false, `${target}: a contributor import is refused`);
      assert.equal(result.errors.length, 1, `${target}: one row error`);
      assert.equal(result.errors[0].row, 2);
      assert.equal(result.errors[0].column, 'status');
      assert.equal(result.errors[0].code, 'CSV_INCIDENT_STATUS_RESERVED');
      assert.deepEqual(result.errors[0].params, {
        reference: `INC-${closed.item_number}`,
        from: 'closed',
        to: target,
      });
      assert.deepEqual(
        (await runner.manager.query(
          'SELECT title, severity, status, detected_at, description FROM incidents WHERE id = $1',
          [closed.id],
        ))[0],
        rowBefore,
        `${target}: the row is unchanged`,
      );
      assert.deepEqual(await readEntries(runner, f, closed.id), entriesBefore, `${target}: no journal entry`);
    }

    // The §3.8 exception is unchanged: a contributor may still correct the review of the closed
    // incident as long as the row keeps its stored status.
    const reviewCsv = `${REVIEW_HEADERS}\nINC-${closed.item_number};${closed.title};major;closed;2026-03-10T08:00:00Z;false;short;${cell('## Impact\n\ncorrected by contributor')}`;
    const reviewResult = await services.csv.import(
      csvFile(reviewCsv),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      contributor,
    );
    assert.deepEqual(reviewResult.errors, []);
    assert.match((await readReview(runner, f, closed.id)).content_markdown, /corrected by contributor/);
    assert.equal(await readStatus(runner, closed.id), 'closed');

    // An administrator reopens it: a Reopen-shaped entry, with the import reason.
    const reopened = await services.csv.import(
      csvFile(statusImportRow(closed, 'open')),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      admin,
    );
    assert.deepEqual(reopened.errors, []);
    assert.equal(await readStatus(runner, closed.id), 'open');
    const reopenEntry = (await readEntries(runner, f, closed.id))
      .find((e: any) => e.kind === 'reopen' && e.content === 'Imported from CSV');
    assert.ok(reopenEntry, 'the import journals a Reopen-shaped entry');
    assert.equal(reopenEntry.content, 'Imported from CSV');
    assert.deepEqual(reopenEntry.changed_fields, { status: { from: 'closed', to: 'open' } });

    // Cancelling a closed incident: a Cancel-shaped entry, with the frozen review version.
    const toCancel = await createIncident(runner, f, services, { title: 'Closed then cancelled' });
    await services.incidents.update(toCancel.id, { status: 'closed' }, f.users.admin, adminOpts);
    const cancelled = await services.csv.import(
      csvFile(statusImportRow(toCancel, 'cancelled')),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      admin,
    );
    assert.deepEqual(cancelled.errors, []);
    assert.equal(await readStatus(runner, toCancel.id), 'cancelled');
    const cancelEntry = (await readEntries(runner, f, toCancel.id))
      .find((e: any) => e.changed_fields?.status?.to === 'cancelled' && e.content === 'Imported from CSV');
    assert.ok(cancelEntry, 'the import journals a Cancel-shaped entry');
    assert.equal(cancelEntry.content, 'Imported from CSV');
    assert.deepEqual(cancelEntry.changed_fields.status, { from: 'closed', to: 'cancelled' });
    assert.ok(cancelEntry.changed_fields.review_version, 'a cancellation freezes the review');

    // A cancellation from an open incident is reserved too, and journalled the same way.
    const open = await createIncident(runner, f, services, { title: 'Open then cancelled' });
    const refused = await services.csv.import(
      csvFile(statusImportRow(open, 'cancelled')),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      contributor,
    );
    assert.equal(refused.ok, false, 'a contributor cannot cancel an open incident by file');
    assert.equal(await readStatus(runner, open.id), 'open');
    const cancelledOpen = await services.csv.import(
      csvFile(statusImportRow(open, 'cancelled')),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      admin,
    );
    assert.deepEqual(cancelledOpen.errors, []);
    const openCancelEntry = (await readEntries(runner, f, open.id))
      .find((e: any) => e.changed_fields?.status?.to === 'cancelled' && e.content === 'Imported from CSV');
    assert.ok(openCancelEntry, 'the cancellation is journalled');
    assert.equal(openCancelEntry.content, 'Imported from CSV');
    assert.deepEqual(openCancelEntry.changed_fields.status, { from: 'open', to: 'cancelled' });

    // A forward move keeps the existing closure snapshot, with no Reopen or Cancel entry.
    const forward = await createIncident(runner, f, services, { title: 'Forward to closed' });
    const closedForward = await services.csv.import(
      csvFile(statusImportRow(forward, 'closed')),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      contributor,
    );
    assert.deepEqual(closedForward.errors, [], 'a contributor may still close an incident by file');
    assert.equal(await readStatus(runner, forward.id), 'closed');
    const forwardEntries = await readEntries(runner, f, forward.id);
    assert.equal(forwardEntries.some((e: any) => e.kind === 'reopen'), false);
    assert.equal(forwardEntries.some((e: any) => e.content === 'Imported from CSV' && e.kind !== 'system'), false);
    const closure = forwardEntries.find((e: any) => e.changed_fields?.review_version);
    assert.ok(closure, 'the closure snapshot is taken as before');
    assert.deepEqual(closure.changed_fields.status, { from: 'open', to: 'closed' });
  });
}

// ---------------------------------------------------------------------------
// 5. An invisible incident is refused, and a lock conflict rolls the row back
// ---------------------------------------------------------------------------

async function testInvisibleIncidentRefused() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services, { confidential: true });
    const before = await readReview(runner, f, incident.id);

    const csv = `${REVIEW_HEADERS}\nINC-${incident.item_number};Hijacked;major;open;2026-03-10T08:00:00Z;true;short;${cell('## Impact\n\nleak')}`;
    const result = await services.csv.import(
      csvFile(csv),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.other, false),
    );
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /Unknown incident reference/);

    const after = await readReview(runner, f, incident.id);
    assert.equal(after.content_markdown, before.content_markdown);
    const row = await runner.manager.query(
      'SELECT title FROM incidents WHERE id = $1', [incident.id],
    );
    assert.notEqual(row[0].title, 'Hijacked', 'nothing of the refused row was applied');
  });
}

async function testLockConflictRollsBackTheUpsert() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services);
    const review = await readReview(runner, f, incident.id);

    // Another user is editing the review through the incident route.
    await services.integrated.acquireLockBySource('incidents', incident.id, 'review', f.users.other, {
      manager: runner.manager,
    });

    const csv = `${REVIEW_HEADERS}\nINC-${incident.item_number};Renamed by import;major;open;2026-03-10T08:00:00Z;false;imported description;${cell('## Impact\n\nfrom csv')}`;
    const result = await services.csv.import(
      csvFile(csv),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.equal(result.ok, false, 'a foreign edit lock refuses the review write');
    assert.match(result.errors[0].message, /Import failed/);

    // The review write of an existing row runs before the upsert, so nothing
    // was applied at all.
    const row = await runner.manager.query(
      'SELECT title, description FROM incidents WHERE id = $1', [incident.id],
    );
    assert.notEqual(row[0].title, 'Renamed by import', 'the incident row must roll back too');
    assert.notEqual(row[0].description, 'imported description');

    // Same conflict, but raised by the closure snapshot — which runs *after*
    // the rows were saved. Only the savepoint can undo the upsert here.
    const closing = `${REVIEW_HEADERS}\nINC-${incident.item_number};Closed by import;major;closed;2026-03-10T08:00:00Z;false;imported description;`;
    const closingResult = await services.csv.import(
      csvFile(closing),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.equal(closingResult.ok, false, 'a foreign edit lock refuses the closure snapshot');
    const afterClosing = await runner.manager.query(
      'SELECT title, status FROM incidents WHERE id = $1', [incident.id],
    );
    assert.notEqual(afterClosing[0].title, 'Closed by import', 'the saved upsert must be rolled back');
    assert.equal(afterClosing[0].status, 'open');
    const entries = await readEntries(runner, f, incident.id);
    assert.equal(
      entries.some((e: any) => e.changed_fields?.review_version),
      false,
      'no journal entry survives a rolled-back import',
    );
    const after = await readReview(runner, f, incident.id);
    assert.equal(after.content_markdown, review.content_markdown);
    assert.equal(after.versions, review.versions);
  });
}

// ---------------------------------------------------------------------------
// 6. §3.3 closure snapshot from the incident services
// ---------------------------------------------------------------------------

async function testClosureSnapshotAndReopen() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const opts = { manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true } };
    const incident = await createIncident(runner, f, services);
    await services.integrated.writeIncidentReviewForImport(incident.id, '## Impact\n\nfirst state', f.users.admin, {
      manager: runner.manager,
    });

    await services.incidents.update(incident.id, { status: 'closed' }, f.users.admin, opts);
    const firstClosure = (await readEntries(runner, f, incident.id))
      .find((e: any) => e.kind === 'status_change' && e.changed_fields?.review_version);
    assert.ok(firstClosure);
    const first = firstClosure.changed_fields.review_version;
    assert.equal(first.from, null);
    assert.ok(first.to.document_id && first.to.version_number > 0 && first.to.revision > 0);

    // Reopen keeps the reference and every stored version.
    await services.incidents.reopen(incident.id, 'more work', f.users.admin, opts);
    const afterReopen = (await readEntries(runner, f, incident.id))
      .find((e: any) => e.kind === 'status_change' && e.changed_fields?.review_version);
    assert.deepEqual(afterReopen.changed_fields.review_version, first, 'reopen keeps the closure reference');

    // A second closure references its own state.
    await services.integrated.writeIncidentReviewForImport(incident.id, '## Impact\n\nsecond state', f.users.admin, {
      manager: runner.manager,
    });
    await services.incidents.update(incident.id, { status: 'closed' }, f.users.admin, opts);
    const closures = (await readEntries(runner, f, incident.id))
      .filter((e: any) => e.kind === 'status_change' && e.changed_fields?.review_version);
    assert.equal(closures.length, 2);
    const versions = new Set(closures.map((e: any) => e.changed_fields.review_version.to.version_number));
    assert.equal(versions.size, 2, 'a second closure references its own state');
    const second = closures.find(
      (e: any) => e.changed_fields.review_version.to.version_number !== first.to.version_number,
    )!.changed_fields.review_version;

    const firstBody = await runner.manager.query(
      `SELECT content_markdown FROM document_versions WHERE document_id = $1 AND version_number = $2`,
      [first.to.document_id, first.to.version_number],
    );
    assert.match(firstBody[0].content_markdown, /first state/, 'the first closure version survives');
    const secondBody = await runner.manager.query(
      `SELECT content_markdown FROM document_versions WHERE document_id = $1 AND version_number = $2`,
      [second.to.document_id, second.to.version_number],
    );
    assert.match(secondBody[0].content_markdown, /second state/);
  });
}

async function testCancelSnapshotsAndForeignLockRefusesClosure() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const opts = { manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true } };

    const cancelled = await createIncident(runner, f, services);
    await services.incidents.cancel(cancelled.id, 'duplicate', f.users.admin, opts);
    const cancelEntry = (await readEntries(runner, f, cancelled.id))
      .find((e: any) => e.kind === 'status_change' && e.changed_fields?.review_version);
    assert.ok(cancelEntry, 'cancelling snapshots the review too');

    // A foreign edit lock blocks the closure (423).
    const locked = await createIncident(runner, f, services);
    const review = await readReview(runner, f, locked.id);
    await services.integrated.acquireLockBySource('incidents', locked.id, 'review', f.users.other, {
      manager: runner.manager,
    });
    await assert.rejects(
      services.incidents.update(locked.id, { status: 'closed' }, f.users.admin, opts),
      (error: any) => Number(error?.status ?? error?.getStatus?.()) === 423,
      'a foreign edit lock must refuse the closure with 423',
    );
    const stillOpen = await runner.manager.query('SELECT status FROM incidents WHERE id = $1', [locked.id]);
    assert.equal(stillOpen[0].status, 'open', 'the refused closure changed nothing');
  });
}

async function testCreatedClosedGetsItsReviewVersion() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services, { status: 'closed' });
    const review = await readReview(runner, f, incident.id);
    assert.ok(review, 'a record created closed still gets its review');

    const entries = await readEntries(runner, f, incident.id);
    const creation = entries.find((e: any) => e.content === 'Incident logged');
    assert.ok(creation?.changed_fields?.review_version, 'the creation entry carries the review version');
    assert.equal(creation.changed_fields.review_version.to.document_id, review.document_id);
  });
}

// ---------------------------------------------------------------------------
// 10. Review titles follow the incident title
// ---------------------------------------------------------------------------

async function readReviewTitle(runner: QueryRunner, f: Fixture, incidentId: string): Promise<string> {
  const review = await readReview(runner, f, incidentId);
  const rows = await runner.manager.query('SELECT title FROM documents WHERE id = $1', [review.document_id]);
  return String(rows[0].title);
}

async function testReviewTitleFollowsIncidentRename() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services, { title: 'Mail outage' });
    const opts = { manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true } };

    assert.equal(
      await readReviewTitle(runner, f, incident.id),
      `INC-${incident.item_number} - Mail outage - Incident review`,
    );

    await services.incidents.update(incident.id, { title: 'Mail outage (Lyon)' }, f.users.admin, opts);
    assert.equal(
      await readReviewTitle(runner, f, incident.id),
      `INC-${incident.item_number} - Mail outage (Lyon) - Incident review`,
      'renaming the incident renames its managed review',
    );

    // Renaming and closing in the same patch: the title lands and the closure
    // snapshot freezes the renamed document.
    await services.incidents.update(
      incident.id, { title: 'Mail outage (Lyon, resolved)', status: 'closed' }, f.users.admin, opts,
    );
    assert.equal(
      await readReviewTitle(runner, f, incident.id),
      `INC-${incident.item_number} - Mail outage (Lyon, resolved) - Incident review`,
      'a rename that also closes the incident still renames the review',
    );
    const entries = await readEntries(runner, f, incident.id);
    const closure = entries.find((e: any) => e.changed_fields?.review_version);
    assert.ok(closure, 'the closure still snapshots the review');
  });
}

async function testReviewTitleFollowsCsvRename() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const open = await createIncident(runner, f, services, { title: 'Csv rename me' });
    const closed = await createIncident(runner, f, services, { title: 'Csv closed rename me' });
    await services.incidents.update(closed.id, { status: 'closed' }, f.users.admin, {
      manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true },
    });

    const csv = [
      REVIEW_HEADERS,
      `INC-${open.item_number};Csv renamed;major;open;2026-03-10T08:00:00Z;false;short;`,
      `INC-${closed.item_number};Csv closed renamed;major;closed;2026-03-10T08:00:00Z;false;short;`,
    ].join('\n');
    const result = await services.csv.import(
      csvFile(csv),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(result.errors, []);

    assert.equal(
      await readReviewTitle(runner, f, open.id),
      `INC-${open.item_number} - Csv renamed - Incident review`,
    );
    // §3.8: the import exemption also covers the title of a frozen record.
    assert.equal(
      await readReviewTitle(runner, f, closed.id),
      `INC-${closed.item_number} - Csv closed renamed - Incident review`,
      'an imported rename reaches a closed incident review too',
    );
  });
}

// ---------------------------------------------------------------------------
// 11. A closed incident with no review can still be repaired by the backfill
// ---------------------------------------------------------------------------

async function testFrozenIncidentRepairIsBackfillOnly() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services);
    await services.incidents.update(incident.id, { status: 'closed' }, f.users.admin, {
      manager: runner.manager, tenantId: f.tenantId, viewer: { userId: f.users.admin, isAdmin: true },
    });

    // Simulate the integrity gap the backfill exists for.
    const review = await readReview(runner, f, incident.id);
    await runner.manager.query(
      `DELETE FROM integrated_document_bindings WHERE source_entity_id = $1 AND slot_key = 'review'`,
      [incident.id],
    );
    await runner.manager.query('DELETE FROM document_incidents WHERE document_id = $1', [review.document_id]);
    await runner.manager.query('DELETE FROM documents WHERE id = $1', [review.document_id]);

    // The lazy read path still refuses to mint a review for a frozen record.
    await assert.rejects(
      services.integrated.repairSourceSlot('incidents', incident.id, 'review', { manager: runner.manager }),
      /closed incident/i,
      'a read must not create a review for a closed incident',
    );
    assert.equal(await readReview(runner, f, incident.id), null);

    // The backfill script's explicit opt-in does.
    const repaired = await services.integrated.repairSourceSlot('incidents', incident.id, 'review', {
      manager: runner.manager,
      allowFrozenIncident: true,
    });
    assert.equal(repaired.created, true);
    const rebuilt = await readReview(runner, f, incident.id);
    assert.ok(rebuilt, 'the backfill repairs the frozen incident');
    assert.match(rebuilt.content_markdown, /## Corrective actions/);
  });
}

// ---------------------------------------------------------------------------
// 12. Visibility is decided before the row lock is taken
// ---------------------------------------------------------------------------

/** Records the SQL a service issues, so the order of the checks can be asserted. */
function recordingManager(manager: any, log: string[]) {
  return new Proxy(manager, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (sql: string, params?: any[]) => {
          log.push(String(sql));
          return target.query(sql, params);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function testVisibilityIsCheckedBeforeTheRowLock() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services, { confidential: true });
    const outsider = { userId: f.users.other, isAdmin: false };

    for (const [label, call] of [
      ['update', (mg: any) => services.incidents.update(incident.id, { title: 'nope' }, f.users.other, {
        manager: mg, tenantId: f.tenantId, viewer: outsider,
      })],
      ['cancel', (mg: any) => services.incidents.cancel(incident.id, 'nope', f.users.other, {
        manager: mg, tenantId: f.tenantId, viewer: outsider,
      })],
      ['reopen', (mg: any) => services.incidents.reopen(incident.id, 'nope', f.users.other, {
        manager: mg, tenantId: f.tenantId, viewer: outsider,
      })],
      ['setConfidentiality', (mg: any) => services.incidents.setConfidentiality(incident.id, false, f.users.other, {
        manager: mg, tenantId: f.tenantId, viewer: outsider,
      })],
    ] as Array<[string, (mg: any) => Promise<unknown>]>) {
      const log: string[] = [];
      await assert.rejects(call(recordingManager(runner.manager, log)), /Incident not found/, label);
      assert.equal(
        log.some((sql) => /FOR UPDATE/i.test(sql)),
        false,
        `${label}: a caller who cannot see the incident must not queue on its row lock`,
      );
    }

    // The admin still locks the row, and still sees the committed state.
    const log: string[] = [];
    await services.incidents.update(incident.id, { title: 'renamed' }, f.users.admin, {
      manager: recordingManager(runner.manager, log),
      tenantId: f.tenantId,
      viewer: { userId: f.users.admin, isAdmin: true },
    });
    assert.equal(
      log.some((sql) => /FROM incidents WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/i.test(sql)),
      true,
      'an authorised write still takes the §3.3 row lock',
    );
  });
}

// ---------------------------------------------------------------------------
// 13. The other integrated slots keep their historical (Knowledge-free) ACL
// ---------------------------------------------------------------------------

async function testProjectPurposeIgnoresKnowledgeAcl() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const provisionerRole = await seedRole(runner, f.tenantId, `PortfolioKnow ${f.tag}`, {
      portfolio_projects: 'member', knowledge: 'member',
    });
    const provisioner = await seedUser(runner, f.tenantId, provisionerRole, `portfolio-know-${f.tag}@example.com`);
    // No `knowledge` permission at all: the Knowledge library ACL would refuse them.
    const readerRole = await seedRole(runner, f.tenantId, `PortfolioOnly ${f.tag}`, {
      portfolio_projects: 'member',
    });
    const reader = await seedUser(runner, f.tenantId, readerRole, `portfolio-only-${f.tag}@example.com`);

    const projectId = randomUUID();
    await runner.manager.query(
      `INSERT INTO portfolio_projects (id, tenant_id, name, item_number) VALUES ($1, $2, $3, $4)`,
      [projectId, f.tenantId, `Project ${f.tag}`, 4321],
    );

    const provisioned: any = await services.integrated.getBySource(
      'projects', projectId, 'purpose', provisioner, { manager: runner.manager },
    );
    assert.ok(provisioned?.id, 'the purpose document is provisioned on first read');

    // The regression this guards: `projects:purpose` has never gone through the
    // Knowledge library ACL, and must not start to. Only `incidents:review`
    // carries a source access context.
    const doc: any = await services.integrated.getBySource('projects', projectId, 'purpose', reader, {
      manager: runner.manager,
    });
    assert.equal(doc.id, provisioned.id, 'a portfolio member without knowledge rights can read the purpose document');

    const versions: any[] = await services.integrated.listVersionsBySource(
      'projects', projectId, 'purpose', reader, { manager: runner.manager },
    );
    assert.ok(Array.isArray(versions), 'and can list its versions');
  });
}

/**
 * A date-time typed in Excel imports at the time Excel shows, read in the zone its header names, as
 * the same text typed in a CSV file: the workbook's `detected_at` cell is a serial in a
 * `dd/mm/yyyy hh:mm` format, the CSV's is `2026-10-16 10:45:00`.
 */
async function testXlsxDateTimeAsItsCsvText() {
  await withFixture(async (runner, f) => {
    const services = createServices(runner.manager);
    const incident = await createIncident(runner, f, services, { detected_at: '2026-10-01T00:00:00Z' });
    const detectedAt = async (): Promise<string> => ((await runner.query(
      `SELECT detected_at FROM incidents WHERE tenant_id = $1 AND id = $2`,
      [f.tenantId, incident.id],
    ))[0].detected_at as Date).toISOString();
    const reset = () => runner.query(
      `UPDATE incidents SET detected_at = '2026-10-01T00:00:00Z' WHERE tenant_id = $1 AND id = $2`,
      [f.tenantId, incident.id],
    );
    const headers = ['ref', 'title', 'severity', 'status', 'detected_at (Europe/Paris)'];
    const values = [`INC-${incident.item_number}`, incident.title, 'major', 'open'];

    const inline = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
    const row = (r: number, cells: string[]) => `<row r="${r}">${cells.map((v, i) => inline(`${String.fromCharCode(65 + i)}${r}`, v)).join('')}`;
    const workbook = handmadeXlsx({
      numFmts: '<numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/>',
      cellXfs: [0, 164],
      // 46311.447916666664 is 2026-10-16 10:45, as Excel writes it.
      sheetData: `${row(1, headers)}</row>${row(2, values)}<c r="E2" s="1"><v>46311.447916666664</v></c></row>`,
    });
    const xlsxFile = {
      buffer: workbook,
      fieldname: 'file',
      originalname: 'incidents.xlsx',
      encoding: '7bit',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: workbook.length,
    } as Express.Multer.File;

    const fromXlsx = await services.csv.import(
      xlsxFile,
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(fromXlsx.errors, []);
    const xlsxInstant = await detectedAt();

    await reset();
    const fromCsv = await services.csv.import(
      csvFile(`${headers.join(';')}\n${[...values, '2026-10-16 10:45:00'].join(';')}`),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      importOpts(runner, f, f.users.admin),
    );
    assert.deepEqual(fromCsv.errors, []);
    const csvInstant = await detectedAt();

    assert.equal(xlsxInstant, '2026-10-16T08:45:00.000Z', 'the time Excel shows, in Paris time');
    assert.equal(xlsxInstant, csvInstant, 'the same instant as the CSV text');
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testExportImportRoundTrip();
    await testFrenchCategoryRoundTrip();
    await testExportFollowsTheList();
    await testDateTimesInTheExportersZone();
    await testXlsxDateTimeAsItsCsvText();
    await testExportTimeZoneSource();
    await testEmptyCellAndDryRun();
    await testReviewTemplateFollowsTheCreatorLanguage();
  await testInsertedRowsAreProvisioned();
    await testClosedIncidentImportIsAllowedAndVersioned();
    await testImportLifecycleGuardAndAdminJournal();
    await testInvisibleIncidentRefused();
    await testLockConflictRollsBackTheUpsert();
    await testClosureSnapshotAndReopen();
    await testCancelSnapshotsAndForeignLockRefusesClosure();
    await testCreatedClosedGetsItsReviewVersion();
    await testReviewTitleFollowsIncidentRename();
    await testReviewTitleFollowsCsvRename();
    await testFrozenIncidentRepairIsBackfillOnly();
    await testVisibilityIsCheckedBeforeTheRowLock();
    await testProjectPurposeIgnoresKnowledgeAcl();
    console.log('incident-review-csv.integration.spec: all assertions passed');
  } finally {
    await dataSource.destroy();
  }
}

void run();
