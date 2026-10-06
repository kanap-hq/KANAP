import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DataSource, QueryRunner } from 'typeorm';
import { IncidentReviewDocument1853490000000 } from '../../migrations/1853490000000-incident-review-document';
import { provisionIncidentReviewDocuments } from '../../knowledge/incident-review-provisioning';

/**
 * PostgreSQL harness for `1853490000000-incident-review-document` (plan:
 * planning/incident-review-document.md §3.1).
 *
 * MANUAL script: it creates and drops two scratch databases, which needs a superuser
 * connection, so it is not wired into CI. Never point it at a database you care
 * about — it drops `appdb_migtest_full` and `appdb_migtest_upgrade` on both ends.
 *
 *   MIGRATION_TEST_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *   DATABASE_URL=postgres://app:app@localhost:5432/appdb \
 *   npm run test:incident-review-migration
 *
 * `DATABASE_URL` is only read for the application role, host and port; the scratch
 * databases are created next to it and dropped afterwards.
 */

const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const APP_URL = process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/appdb';
const FULL_CHAIN_DB = 'appdb_migtest_full';
const UPGRADE_DB = 'appdb_migtest_upgrade';
const PREVIOUS_MIGRATION_TIMESTAMP = 1853470000000;
const TARGET_MIGRATION_TIMESTAMP = 1853490000000;

type MigrationClass = { new (): any; name: string };

// `pg` ships no type declarations (and `@types/pg` is not a dependency); the
// harness only uses this tiny surface, so it is typed here instead of imported.
type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
};

const { Client: PgClientConstructor } = require('pg') as {
  Client: new (config: { connectionString: string }) => PgClient;
};

function scratchUrl(databaseName: string): string {
  const url = new URL(APP_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function appRoleName(): string {
  return decodeURIComponent(new URL(APP_URL).username || 'app');
}

function loadMigrationClasses(): Array<{ timestamp: number; migration: MigrationClass }> {
  const directory = path.join(__dirname, '..', '..', 'migrations');
  const loaded: Array<{ timestamp: number; migration: MigrationClass }> = [];

  for (const file of fs.readdirSync(directory).sort()) {
    // The migrations of the running tree: .ts under ts-node, .js when compiled (`npm run test:ci`).
    if (!/\.(ts|js)$/.test(file) || file.endsWith('.d.ts')) continue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require(path.join(directory, file));
    for (const exported of Object.values(module)) {
      if (typeof exported !== 'function') continue;
      const match = /(\d{13})$/.exec((exported as MigrationClass).name || '');
      if (!match) continue;
      loaded.push({ timestamp: Number(match[1]), migration: exported as MigrationClass });
    }
  }

  loaded.sort((a, b) => a.timestamp - b.timestamp);
  return loaded;
}

async function withAdminClient<T>(databaseUrl: string, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new PgClientConstructor({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function adminUrlForDatabase(databaseName: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function dropScratchDatabase(databaseName: string): Promise<void> {
  await withAdminClient(ADMIN_URL, async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  });
}

async function createScratchDatabase(databaseName: string): Promise<void> {
  await dropScratchDatabase(databaseName);
  await withAdminClient(ADMIN_URL, async (client) => {
    await client.query(`CREATE DATABASE ${databaseName} OWNER ${appRoleName()}`);
  });
  await withAdminClient(adminUrlForDatabase(databaseName), async (client) => {
    await client.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await client.query(`GRANT ALL ON SCHEMA public TO ${appRoleName()}`);
  });
}

async function runMigrationsUpTo(
  databaseName: string,
  maxTimestamp: number,
): Promise<void> {
  const migrations = loadMigrationClasses()
    .filter((entry) => entry.timestamp <= maxTimestamp)
    .map((entry) => entry.migration);

  const dataSource = new DataSource({
    type: 'postgres',
    url: scratchUrl(databaseName),
    entities: [],
    migrations,
    ssl: false,
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}

async function withRunner<T>(databaseName: string, fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: scratchUrl(databaseName),
    entities: [],
    migrations: [],
    ssl: false,
  });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    return await fn(runner);
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

async function setTenant(runner: QueryRunner, tenantId: string): Promise<void> {
  await runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

// ---------------------------------------------------------------------------
// Schema assertions shared by both scenarios
// ---------------------------------------------------------------------------

async function assertTargetSchema(runner: QueryRunner): Promise<void> {
  const constraints = await runner.query(
    `SELECT conname, pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conname IN (
       'chk_integrated_document_bindings_entity_type',
       'chk_integrated_document_slot_settings_entity_type'
     )`,
  );
  assert.equal(constraints.length, 2, 'both entity-type CHECK constraints must exist');
  for (const constraint of constraints) {
    assert.match(String(constraint.definition), /'incidents'/, `${constraint.conname} must accept incidents`);
  }

  const legacyColumns = await runner.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'incidents'
       AND column_name IN ('impact', 'root_cause', 'corrective_actions', 'lessons_learned')`,
  );
  assert.deepEqual(legacyColumns, [], 'the four narrative columns must be dropped');

  const [refreshFunction] = await runner.query(
    `SELECT prosrc FROM pg_proc WHERE proname = 'search_index_refresh_incidents'`,
  );
  assert.ok(refreshFunction, 'search_index_refresh_incidents must exist');
  assert.match(String(refreshFunction.prosrc), /d\.content_plain/, 'weight C must read the review body');
  assert.doesNotMatch(String(refreshFunction.prosrc), /root_cause|lessons_learned|corrective_actions/);

  const triggers = await runner.query(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
       'trg_search_index_incident_review_document',
       'trg_search_index_incident_review_binding'
     ) ORDER BY tgname`,
  );
  assert.deepEqual(
    triggers.map((row: any) => row.tgname),
    ['trg_search_index_incident_review_binding', 'trg_search_index_incident_review_document'],
  );
}

async function assertDownRefusesWithoutMutation(runner: QueryRunner, tenantId: string): Promise<void> {
  await setTenant(runner, tenantId);
  const before = await runner.query(
    `SELECT
       (SELECT COUNT(*)::int FROM integrated_document_bindings WHERE tenant_id = app_current_tenant()) AS bindings,
       (SELECT COUNT(*)::int FROM documents WHERE tenant_id = app_current_tenant()) AS documents,
       (SELECT COUNT(*)::int FROM document_versions WHERE tenant_id = app_current_tenant()) AS versions,
       (SELECT COUNT(*)::int FROM document_contributors WHERE tenant_id = app_current_tenant()) AS contributors,
       (SELECT COUNT(*)::int FROM integrated_document_slot_settings WHERE tenant_id = app_current_tenant()) AS slots`,
  );

  await assert.rejects(
    () => new IncidentReviewDocument1853490000000().down(),
    /irreversible/i,
    'down() must refuse',
  );

  const after = await runner.query(
    `SELECT
       (SELECT COUNT(*)::int FROM integrated_document_bindings WHERE tenant_id = app_current_tenant()) AS bindings,
       (SELECT COUNT(*)::int FROM documents WHERE tenant_id = app_current_tenant()) AS documents,
       (SELECT COUNT(*)::int FROM document_versions WHERE tenant_id = app_current_tenant()) AS versions,
       (SELECT COUNT(*)::int FROM document_contributors WHERE tenant_id = app_current_tenant()) AS contributors,
       (SELECT COUNT(*)::int FROM integrated_document_slot_settings WHERE tenant_id = app_current_tenant()) AS slots`,
  );
  assert.deepEqual(after, before, 'down() must not touch documents, bindings or slot settings');
  await assertTargetSchema(runner);
}

// ---------------------------------------------------------------------------
// Scenario A: full chain on a blank database
// ---------------------------------------------------------------------------

async function testFullChainOnBlankDatabase(): Promise<void> {
  await createScratchDatabase(FULL_CHAIN_DB);
  await runMigrationsUpTo(FULL_CHAIN_DB, Number.MAX_SAFE_INTEGER);
  await withRunner(FULL_CHAIN_DB, async (runner) => {
    await assertTargetSchema(runner);
    const [applied] = await runner.query(
      `SELECT COUNT(*)::int AS count FROM migrations WHERE name = 'IncidentReviewDocument1853490000000'`,
    );
    assert.equal(applied.count, 1, 'the migration must be recorded exactly once');
  });
  console.log('  full chain on a blank database: OK');
}

// ---------------------------------------------------------------------------
// Scenario B: upgrade from the four incident migrations, with data
// ---------------------------------------------------------------------------

type SeededIncident = {
  id: string;
  itemNumber: number;
  title: string;
};

type SeededTenant = {
  id: string;
  slug: string;
  owner: string | null;
  reporter: string | null;
  creator: string | null;
  incidents: Record<string, SeededIncident>;
};

const MARKUP_IMPACT = [
  '2 sites down < 1h & ~40 users',
  'See <b>runbook</b> and ![screenshot](https://example.test/a.png)',
  '# not a heading',
  '- not a bullet',
  '1. not a list',
  'snake_case_id | pipe',
  'Ticket at http://intra.test/a_b/c_d?x=1&y=2 please',
];

async function seedTenant(
  runner: QueryRunner,
  slug: string,
  options: { withUsers: boolean },
): Promise<SeededTenant> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, `Migration test ${slug}`],
  );
  await setTenant(runner, tenantId);

  let owner: string | null = null;
  let reporter: string | null = null;
  let creator: string | null = null;
  if (options.withUsers) {
    const roleId = await insertRole(runner, tenantId);
    owner = await insertUser(runner, tenantId, roleId, `owner@${slug}.test`);
    reporter = await insertUser(runner, tenantId, roleId, `reporter@${slug}.test`);
    creator = await insertUser(runner, tenantId, roleId, `creator@${slug}.test`);
  }

  return { id: tenantId, slug, owner, reporter, creator, incidents: {} };
}

async function insertRole(runner: QueryRunner, tenantId: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Migration test role', 'Migration test role', false, false, now(), now())
     RETURNING id::text AS id`,
    [tenantId],
  );
  return String(row.id);
}

async function insertUser(
  runner: QueryRunner,
  tenantId: string,
  roleId: string,
  email: string,
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status)
     VALUES ($1, $2, $3, 'Test', 'User', 'enabled')
     RETURNING id::text AS id`,
    [tenantId, roleId, email],
  );
  return String(row.id);
}

async function insertIncident(
  runner: QueryRunner,
  tenant: SeededTenant,
  key: string,
  values: {
    itemNumber: number;
    title: string;
    status: string;
    confidential?: boolean;
    ownerUserId?: string | null;
    reporterUserId?: string | null;
    createdBy?: string | null;
    description?: string | null;
    impact?: string | null;
    rootCause?: string | null;
    correctiveActions?: string | null;
    lessonsLearned?: string | null;
  },
): Promise<void> {
  const [row] = await runner.query(
    `INSERT INTO incidents (
       tenant_id, item_number, title, severity, status, confidential,
       owner_user_id, reporter_user_id, created_by,
       description, impact, root_cause, corrective_actions, lessons_learned
     )
     VALUES ($1, $2, $3, 'major', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id::text AS id`,
    [
      tenant.id,
      values.itemNumber,
      values.title,
      values.status,
      values.confidential ?? false,
      values.ownerUserId ?? null,
      values.reporterUserId ?? null,
      values.createdBy ?? null,
      values.description ?? null,
      values.impact ?? null,
      values.rootCause ?? null,
      values.correctiveActions ?? null,
      values.lessonsLearned ?? null,
    ],
  );
  tenant.incidents[key] = { id: String(row.id), itemNumber: values.itemNumber, title: values.title };
}

async function loadReview(runner: QueryRunner, incidentId: string) {
  const [row] = await runner.query(
    `SELECT b.document_id::text AS document_id,
            b.hidden_from_entity_knowledge,
            d.title,
            d.status,
            d.revision,
            d.current_version_number,
            d.content_markdown,
            d.content_plain,
            d.folder_id::text AS folder_id,
            d.document_type_id::text AS document_type_id,
            d.template_document_id::text AS template_document_id,
            (SELECT COUNT(*)::int FROM document_versions v WHERE v.document_id = d.id AND v.tenant_id = d.tenant_id) AS version_count,
            (SELECT v.change_note FROM document_versions v WHERE v.document_id = d.id AND v.tenant_id = d.tenant_id ORDER BY v.version_number ASC LIMIT 1) AS first_change_note,
            (SELECT COUNT(*)::int FROM document_incidents di WHERE di.document_id = d.id AND di.incident_id = b.source_entity_id AND di.tenant_id = b.tenant_id) AS relation_count,
            (SELECT string_agg(c.user_id::text, ',') FROM document_contributors c WHERE c.document_id = d.id AND c.tenant_id = d.tenant_id AND c.role = 'owner' AND c.is_primary) AS primary_owner_ids
     FROM integrated_document_bindings b
     JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
     WHERE b.tenant_id = app_current_tenant()
       AND b.source_entity_type = 'incidents'
       AND b.slot_key = 'review'
       AND b.source_entity_id = $1`,
    [incidentId],
  );
  return row;
}

async function incidentIndexMatches(runner: QueryRunner, incidentId: string, term: string): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT (search_vector @@ plainto_tsquery('simple', $2)) AS matched
     FROM search_index
     WHERE tenant_id = app_current_tenant()
       AND entity_type = 'incidents'
       AND entity_id = $1`,
    [incidentId, term],
  );
  return row?.matched === true;
}

async function testUpgradeFromIncidentMigrations(): Promise<void> {
  await createScratchDatabase(UPGRADE_DB);
  await runMigrationsUpTo(UPGRADE_DB, PREVIOUS_MIGRATION_TIMESTAMP);

  let tenantA!: SeededTenant;
  let tenantB!: SeededTenant;

  await withRunner(UPGRADE_DB, async (runner) => {
    tenantA = await seedTenant(runner, 'migtest-a', { withUsers: true });
    await insertIncident(runner, tenantA, 'open', {
      itemNumber: 1,
      title: 'Router outage',
      status: 'open',
      ownerUserId: tenantA.owner,
      reporterUserId: tenantA.reporter,
      createdBy: tenantA.creator,
      description: 'Short summary',
      impact: MARKUP_IMPACT.join('\n'),
      rootCause: 'zorglubroot cause value',
      correctiveActions: null,
      lessonsLearned: 'Write runbooks',
    });
    await insertIncident(runner, tenantA, 'closed', {
      itemNumber: 2,
      title: 'Disk full',
      status: 'closed',
      ownerUserId: null,
      reporterUserId: tenantA.reporter,
      createdBy: tenantA.creator,
      lessonsLearned: 'Monitor free space',
    });
    await insertIncident(runner, tenantA, 'cancelledConfidential', {
      itemNumber: 3,
      title: 'False alarm',
      status: 'cancelled',
      confidential: true,
      ownerUserId: null,
      reporterUserId: null,
      createdBy: tenantA.creator,
    });
    await insertIncident(runner, tenantA, 'empty', {
      itemNumber: 4,
      title: 'Nothing written yet',
      status: 'in_progress',
      ownerUserId: tenantA.owner,
    });
    await insertIncident(runner, tenantA, 'spare', {
      itemNumber: 5,
      title: 'Spare for trigger checks',
      status: 'open',
      impact: 'spareimpactword',
    });

    tenantB = await seedTenant(runner, 'migtest-b', { withUsers: false });
    await insertIncident(runner, tenantB, 'open', {
      itemNumber: 1,
      title: 'Other tenant incident',
      status: 'open',
      rootCause: 'otherzorglub',
    });
  });

  await runMigrationsUpTo(UPGRADE_DB, TARGET_MIGRATION_TIMESTAMP);

  await withRunner(UPGRADE_DB, async (runner) => {
    await assertTargetSchema(runner);

    // --- tenant A ---------------------------------------------------------
    await setTenant(runner, tenantA.id);

    const openReview = await loadReview(runner, tenantA.incidents.open.id);
    assert.ok(openReview, 'open incident must have a review binding');
    assert.equal(openReview.hidden_from_entity_knowledge, true);
    assert.equal(openReview.title, 'INC-1 - Router outage - Incident review');
    assert.equal(openReview.status, 'published');
    assert.equal(Number(openReview.revision), 1);
    assert.equal(Number(openReview.current_version_number), 1);
    assert.equal(openReview.version_count, 1);
    assert.equal(openReview.relation_count, 1);
    assert.equal(openReview.first_change_note, 'Imported from legacy incident fields');
    assert.equal(openReview.primary_owner_ids, tenantA.owner);
    assert.ok(openReview.template_document_id, 'the review must reference the seeded template');

    const openBody = String(openReview.content_markdown);
    assert.deepEqual(
      openBody.split('\n').filter((line) => line.startsWith('## ')),
      ['## Detailed description', '## Impact', '## Root cause', '## Corrective actions', '## Lessons learned'],
    );
    // Detailed description stays empty; the short column is untouched.
    assert.match(openBody, /## Detailed description\n\n## Impact/);
    // Literal HTML and Markdown never reach the renderer as markup.
    assert.equal(openBody.includes('<b>'), false);
    assert.match(openBody, /&lt;b&gt;runbook&lt;\/b&gt;/);
    assert.match(openBody, /!\\\[screenshot\\\]/);
    assert.match(openBody, /&amp;/);
    assert.match(openBody, /\\# not a heading/);
    assert.match(openBody, /\\- not a bullet/);
    assert.match(openBody, /1\\\. not a list/);
    assert.match(openBody, /snake\\_case\\_id \\| pipe/);
    // A bare URL keeps its underscores: `a\_b` would end up inside the autolinked
    // destination. Its `&` still becomes an entity, which the renderer decodes.
    assert.match(openBody, /http:\/\/intra\.test\/a_b\/c_d\?x=1&amp;y=2/);
    assert.equal(openBody.includes('a\\_b'), false, 'a bare URL must not be backslash-escaped');
    // Line breaks survive as hard breaks (two trailing spaces).
    assert.match(openBody, /users {2}\n/);
    assert.match(openBody, /a\.png\) {2}\n/, 'a bare URL at end of line keeps its hard break');
    assert.match(openBody, /zorglubroot cause value/);
    assert.match(openBody, /Write runbooks/);
    assert.equal(String(openReview.content_plain).includes('zorglubroot'), true);

    const [openDescription] = await runner.query(
      `SELECT description FROM incidents WHERE id = $1 AND tenant_id = app_current_tenant()`,
      [tenantA.incidents.open.id],
    );
    assert.equal(openDescription.description, 'Short summary', 'description column must be untouched');

    const closedReview = await loadReview(runner, tenantA.incidents.closed.id);
    assert.equal(closedReview.primary_owner_ids, tenantA.reporter, 'owner falls back to the reporter');
    assert.match(String(closedReview.content_markdown), /## Lessons learned\n\nMonitor free space/);

    const cancelledReview = await loadReview(runner, tenantA.incidents.cancelledConfidential.id);
    assert.equal(cancelledReview.primary_owner_ids, tenantA.creator, 'owner falls back to created_by');
    assert.equal(cancelledReview.first_change_note, 'Initial version');

    const emptyReview = await loadReview(runner, tenantA.incidents.empty.id);
    const [templateRow] = await runner.query(
      `SELECT content_markdown FROM documents WHERE id = $1 AND tenant_id = app_current_tenant()`,
      [emptyReview.template_document_id],
    );
    assert.equal(
      String(emptyReview.content_markdown).trim(),
      String(templateRow.content_markdown).trim(),
      'an incident with no legacy text starts from the template',
    );
    assert.equal(emptyReview.first_change_note, 'Initial version');

    // Journal: only already closed/cancelled incidents get the imported-version entry.
    const journal = await runner.query(
      `SELECT i.item_number,
              e.kind,
              e.content,
              e.changed_fields -> 'review_version' AS review_version
       FROM incident_entries e
       JOIN incidents i ON i.id = e.incident_id AND i.tenant_id = e.tenant_id
       WHERE e.tenant_id = app_current_tenant()
         AND e.changed_fields ? 'review_version'
       ORDER BY i.item_number`,
    );
    assert.equal(journal.length, 2, 'only the closed and the cancelled incident get a review_version entry');
    assert.deepEqual(journal.map((row: any) => Number(row.item_number)), [2, 3]);
    for (const entry of journal) {
      assert.equal(entry.kind, 'system');
      assert.equal(entry.review_version.from, null);
      assert.equal(entry.review_version.to.version_number, 1);
      assert.equal(entry.review_version.to.revision, 1);
      assert.ok(entry.review_version.to.document_id);
    }

    // Search index: the review body reaches weight C of the incident entry.
    assert.equal(await incidentIndexMatches(runner, tenantA.incidents.open.id, 'zorglubroot'), true);
    assert.equal(await incidentIndexMatches(runner, tenantA.incidents.open.id, 'otherzorglub'), false);

    // --- tenant B: isolation and a null-everything incident ---------------
    await setTenant(runner, tenantB.id);
    const otherReview = await loadReview(runner, tenantB.incidents.open.id);
    assert.ok(otherReview, 'the other tenant is provisioned too');
    assert.equal(otherReview.primary_owner_ids, null, 'no contributor when owner, reporter and creator are null');
    assert.equal(otherReview.title, 'INC-1 - Other tenant incident - Incident review');
    assert.equal(await incidentIndexMatches(runner, tenantB.incidents.open.id, 'otherzorglub'), true);
    assert.equal(await incidentIndexMatches(runner, tenantB.incidents.open.id, 'zorglubroot'), false);

    // --- the provisioning helper is idempotent -----------------------------
    await setTenant(runner, tenantA.id);
    const beforeRerun = await runner.query(
      `SELECT (SELECT COUNT(*)::int FROM integrated_document_bindings WHERE tenant_id = app_current_tenant()) AS bindings,
              (SELECT COUNT(*)::int FROM documents WHERE tenant_id = app_current_tenant()) AS documents,
              (SELECT COUNT(*)::int FROM document_versions WHERE tenant_id = app_current_tenant()) AS versions`,
    );
    const rerun = await provisionIncidentReviewDocuments(runner, tenantA.id);
    assert.equal(rerun.created, 0, 're-running the provisioning helper must create nothing');
    assert.equal(rerun.skipped, 5);
    const afterRerun = await runner.query(
      `SELECT (SELECT COUNT(*)::int FROM integrated_document_bindings WHERE tenant_id = app_current_tenant()) AS bindings,
              (SELECT COUNT(*)::int FROM documents WHERE tenant_id = app_current_tenant()) AS documents,
              (SELECT COUNT(*)::int FROM document_versions WHERE tenant_id = app_current_tenant()) AS versions`,
    );
    assert.deepEqual(afterRerun, beforeRerun);

    // --- trigger propagation ----------------------------------------------
    const spare = tenantA.incidents.spare;
    const spareReview = await loadReview(runner, spare.id);
    assert.equal(await incidentIndexMatches(runner, spare.id, 'spareimpactword'), true);

    await runner.query(
      `UPDATE documents
       SET content_markdown = $2, content_plain = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = app_current_tenant()`,
      [spareReview.document_id, '## Impact\n\ntriggerword', 'Impact triggerword'],
    );
    assert.equal(await incidentIndexMatches(runner, spare.id, 'triggerword'), true, 'document update propagates');
    assert.equal(await incidentIndexMatches(runner, spare.id, 'spareimpactword'), false);

    await runner.query(
      `DELETE FROM integrated_document_bindings
       WHERE tenant_id = app_current_tenant() AND document_id = $1`,
      [spareReview.document_id],
    );
    assert.equal(await incidentIndexMatches(runner, spare.id, 'triggerword'), false, 'binding delete propagates');

    await runner.query(
      `INSERT INTO integrated_document_bindings (
         tenant_id, source_entity_type, source_entity_id, slot_key, document_id, hidden_from_entity_knowledge
       ) VALUES (app_current_tenant(), 'incidents', $1, 'review', $2, true)`,
      [spare.id, spareReview.document_id],
    );
    assert.equal(await incidentIndexMatches(runner, spare.id, 'triggerword'), true, 'binding insert propagates');

    await runner.query(
      `DELETE FROM documents WHERE id = $1 AND tenant_id = app_current_tenant()`,
      [spareReview.document_id],
    );
    assert.equal(
      await incidentIndexMatches(runner, spare.id, 'triggerword'),
      false,
      'a cascaded document delete removes the review text from the incident entry',
    );
    assert.equal(await loadReview(runner, spare.id), undefined, 'the binding went with the document');

    // The helper repairs exactly the incident that lost its review.
    const repair = await provisionIncidentReviewDocuments(runner, tenantA.id);
    assert.equal(repair.created, 1);
    assert.ok(await loadReview(runner, spare.id));

    // --- down() -----------------------------------------------------------
    await assertDownRefusesWithoutMutation(runner, tenantA.id);
  });

  console.log('  upgrade from the four incident migrations: OK');
}

async function run(): Promise<void> {
  console.log(`Incident review migration harness (admin: ${new URL(ADMIN_URL).host})`);
  try {
    await testFullChainOnBlankDatabase();
    await testUpgradeFromIncidentMigrations();
    console.log('Incident review migration harness: all scenarios passed.');
  } finally {
    await dropScratchDatabase(FULL_CHAIN_DB);
    await dropScratchDatabase(UPGRADE_DB);
  }
}

void run();
