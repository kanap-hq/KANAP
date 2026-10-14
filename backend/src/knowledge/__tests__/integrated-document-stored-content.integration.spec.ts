/**
 * Contents stored before the Markdown size limit (200 KB of text) stay readable,
 * convertible and usable as templates: copies, recoveries and templates are
 * stored contents, exempt from the limit down to the managed document they
 * create. A stored text the parser cannot handle within its budget is recovered
 * as plain text, without holding the main thread.
 *
 * Runs the real SQL against `DATABASE_URL`; every test seeds inside a
 * transaction that is rolled back afterwards.
 */
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownParseWorkers } from '../../common/markdown-parse-budget';
import { MARKDOWN_MAX_BYTES } from '../../common/markdown-rich-text';
import { KnowledgeService } from '../knowledge.service';
import { IntegratedDocumentsService } from '../integrated-documents.service';
import { seedManagedDocsKnowledgeAssets } from '../integrated-document-seed';
import { Document } from '../document.entity';
import { DocumentActivity } from '../document-activity.entity';
import { DocumentApplication } from '../document-application.entity';
import { DocumentAsset } from '../document-asset.entity';
import { DocumentAttachment } from '../document-attachment.entity';
import { DocumentClassification } from '../document-classification.entity';
import { DocumentContributor } from '../document-contributor.entity';
import { DocumentEditLock } from '../document-edit-lock.entity';
import { DocumentFolder } from '../document-folder.entity';
import { DocumentLibrary } from '../document-library.entity';
import { DocumentProject } from '../document-project.entity';
import { DocumentReference } from '../document-reference.entity';
import { DocumentRequest } from '../document-request.entity';
import { DocumentTask } from '../document-task.entity';
import { DocumentType } from '../document-type.entity';
import { DocumentVersion } from '../document-version.entity';
import { IntegratedDocumentBinding } from '../integrated-document-binding.entity';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

const STORED_BYTES = 250 * 1024;

/** A normal Markdown text of `bytes` bytes, longer than the size limit for writes. */
function storedMarkdown(bytes: number, label: string): string {
  const paragraph = [
    `## ${label}`,
    '',
    'Le service **paie** envoie les bulletins chaque mois, voir [la procédure](https://example.com/paie_mensuelle).',
    '',
    '- Clôture le 25',
    '- Contrôle _croisé_ avec la comptabilité',
    '',
    '',
  ].join('\n');
  return paragraph.repeat(Math.ceil(bytes / Buffer.byteLength(paragraph))).slice(0, bytes).trim();
}

function createServices(manager: any) {
  const permissions = new PermissionsService(
    manager.getRepository(UserPageRole),
    manager.getRepository(RolePermission),
  );
  const users: any = {
    findById: async (id: string, opts?: any) => (opts?.manager ?? manager)
      .getRepository(User)
      .findOne({ where: { id }, relations: ['role'] }),
  };
  const storage: any = {
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    getObjectStream: async () => ({ stream: null, contentType: null, contentLength: null }),
  };
  const knowledge = new KnowledgeService(
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
    new ItemNumberService() as any,
    { log: async () => undefined } as any,
    {} as any,
    {} as any,
    storage,
    {} as any,
    dataSource,
    permissions,
    users,
    {} as any,
    { notifyShare: async () => undefined } as any,
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
  return { knowledge, integrated };
}

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
}

async function seedFixture(runner: QueryRunner) {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', now(), now())`,
    [tenantId, `md-${tag}`, `md-${tag}`],
  );
  await setCurrentTenant(runner, tenantId);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);

  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $3, false, false, now(), now())`,
    [roleId, tenantId, `Stored content ${tag}`],
  );
  for (const resource of ['applications', 'portfolio_requests', 'portfolio_projects', 'knowledge']) {
    await runner.query(
      `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'admin', now(), now())`,
      [randomUUID(), tenantId, roleId, resource],
    );
  }
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
     VALUES ($1, $2, 'Stored', 'Tester', $3, null, $4, false, 'enabled', now(), now())`,
    [userId, tenantId, `stored-${tag}@example.com`, roleId],
  );
  return { tag, tenantId, userId };
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

async function seedRequest(runner: QueryRunner, f: Fixture, itemNumber: number) {
  const id = randomUUID();
  const name = `Demande ${itemNumber}`;
  await runner.query(
    `INSERT INTO portfolio_requests (
       id, tenant_id, item_number, name, status, criteria_values, feasibility_review, priority_override, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'pending_review', '{}'::jsonb, '{}'::jsonb, false, now(), now())`,
    [id, f.tenantId, itemNumber, name],
  );
  return { id, tenant_id: f.tenantId, item_number: itemNumber, name };
}

async function seedProject(runner: QueryRunner, f: Fixture, itemNumber: number) {
  const id = randomUUID();
  const name = `Projet ${itemNumber}`;
  await runner.query(
    `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, origin, status, execution_progress, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'fast_track', 'planned', 0, now(), now())`,
    [id, f.tenantId, itemNumber, name],
  );
  return { id, tenant_id: f.tenantId, item_number: itemNumber, name };
}

async function boundContent(runner: QueryRunner, f: Fixture, type: string, sourceId: string, slotKey: string) {
  const rows = await runner.query(
    `SELECT d.id::text AS id, d.content_markdown
     FROM integrated_document_bindings b
     JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1 AND b.source_entity_type = $2 AND b.source_entity_id = $3 AND b.slot_key = $4`,
    [f.tenantId, type, sourceId, slotKey],
  );
  return rows[0] as { id: string; content_markdown: string } | undefined;
}

/** Runs `fn` while a 5 ms timer measures how long the main thread stays busy at once. */
async function withMainThreadProbe<T>(fn: () => Promise<T>): Promise<{ result: T; maxLagMs: number }> {
  let maxLagMs = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 5);
    last = now;
  }, 5);
  try {
    return { result: await fn(), maxLagMs };
  } finally {
    clearInterval(timer);
  }
}

async function testStoredPurposeIsReadableAndConvertible() {
  await withFixture(async (runner, f) => {
    const { integrated } = createServices(runner.manager);
    const request = await seedRequest(runner, f, 9101);
    await integrated.provisionForRequest(request, { purpose: 'Objet de la demande.' }, f.userId, { manager: runner.manager });
    const provisioned = await boundContent(runner, f, 'requests', request.id, 'purpose');
    assert.ok(provisioned, 'the request purpose document exists');

    // A content stored before the size limit.
    const stored = storedMarkdown(STORED_BYTES, 'Objet');
    assert.ok(Buffer.byteLength(stored) > MARKDOWN_MAX_BYTES);
    await runner.query('UPDATE documents SET content_markdown = $1 WHERE id = $2 AND tenant_id = $3', [stored, provisioned.id, f.tenantId]);

    const read = await integrated.getBySource('requests', request.id, 'purpose', f.userId, { manager: runner.manager });
    assert.equal((read as any).content_markdown, stored, 'the stored content is readable');

    const project = await seedProject(runner, f, 9201);
    await integrated.createProjectPurposeFromRequest(request, project, f.userId, { manager: runner.manager });
    const converted = await boundContent(runner, f, 'projects', project.id, 'purpose');
    assert.equal(converted?.content_markdown, stored, 'the conversion copies the stored content');
  });
}

async function testTemplateOverTheLimitIsUsable() {
  await withFixture(async (runner, f) => {
    const { integrated } = createServices(runner.manager);
    const template = storedMarkdown(STORED_BYTES, 'Modèle');
    await runner.query(
      `UPDATE documents SET content_markdown = $1
       WHERE tenant_id = $2
         AND id = (SELECT template_document_id FROM integrated_document_slot_settings
                   WHERE tenant_id = $2 AND source_entity_type = 'requests' AND slot_key = 'purpose')`,
      [template, f.tenantId],
    );
    const request = await seedRequest(runner, f, 9102);
    await integrated.provisionForRequest(request, { purpose: null }, f.userId, { manager: runner.manager });
    const created = await boundContent(runner, f, 'requests', request.id, 'purpose');
    assert.equal(created?.content_markdown, template, 'a new document starts from the stored template');
  });
}

async function testApplicationOverviewIsRecoveredFromAStoredDescription() {
  await withFixture(async (runner, f) => {
    const { integrated } = createServices(runner.manager);
    const description = storedMarkdown(STORED_BYTES, 'Description');
    const [app] = await runner.query(
      `INSERT INTO applications (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING id::text AS id`,
      [f.tenantId, `Paie ${f.tag}`, description],
    );
    const read = await integrated.getBySource('applications', app.id, 'overview', f.userId, { manager: runner.manager });
    assert.equal((read as any).content_markdown, description, 'the overview is recovered from the stored description');

    // A stored description the parser cannot handle within its budget: plain text, main thread free.
    const unparsable = '_a '.repeat(Math.ceil(MARKDOWN_MAX_BYTES / 3)).trim();
    const [other] = await runner.query(
      `INSERT INTO applications (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING id::text AS id`,
      [f.tenantId, `Compta ${f.tag}`, unparsable],
    );
    const { result, maxLagMs } = await withMainThreadProbe(
      () => integrated.getBySource('applications', other.id, 'overview', f.userId, { manager: runner.manager }),
    );
    assert.equal((result as any).content_markdown, `\`\`\`text\n${unparsable}\n\`\`\``, 'shown as plain text');
    assert.ok(maxLagMs < 250, `main thread busy ${maxLagMs.toFixed(0)} ms at once`);
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testStoredPurposeIsReadableAndConvertible();
    await testTemplateOverTheLimitIsUsable();
    await testApplicationOverviewIsRecoveredFromAStoredDescription();
  } finally {
    await dataSource.destroy();
    await closeMarkdownParseWorkers();
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
