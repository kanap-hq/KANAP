import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
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
import { PortfolioProjectsCrudService } from '../../portfolio/services/portfolio-projects-crud.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';

// "Library not found" on a record that has an integrated document: the record's own service
// (a project rename, a changed request purpose, an interface rename, the CSV imports) writes
// the document's text or title with the edit right of the record, as the integrated-document
// routes do. The right is checked in IntegratedDocumentsService, covers that one document only,
// and a person without edit right on the record stays refused.

function createServices(manager: any) {
  const permissions = new PermissionsService(manager.getRepository(UserPageRole), manager.getRepository(RolePermission));
  const users: any = {
    findById: async (id: string, opts?: any) =>
      (opts?.manager ?? manager).getRepository(User).findOne({ where: { id }, relations: ['role'] }),
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
  const integrated = new IntegratedDocumentsService(manager.getRepository(IntegratedDocumentBinding), knowledge, permissions, importService);
  const projects = new PortfolioProjectsCrudService(
    undefined as any,
    undefined as any,
    { log: async () => undefined } as any,
    undefined as any,
    { getProjectRecipients: async () => [], notifyStatusChange: () => undefined } as any,
    new ItemNumberService() as any,
    integrated,
  );
  return { integrated, knowledge, projects };
}

type Fixture = {
  runner: QueryRunner;
  tenantId: string;
  seedUser: (name: string, levels: Record<string, string>) => Promise<string>;
};

async function inFixture(fn: (fixture: Fixture) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tag = randomUUID().slice(0, 8);
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2::text, $2::text, 'active', now(), now())`,
      [tenantId, `caller-grant-${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
    // No role below has any `knowledge` permission: the Managed Docs library is closed to them.
    const seedUser = async (name: string, levels: Record<string, string>) => {
      const roleId = randomUUID();
      await runner.query(
        `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
         VALUES ($1, $2, $3, $3, false, false, now(), now())`,
        [roleId, tenantId, name],
      );
      for (const [resource, level] of Object.entries(levels)) {
        await runner.query(
          `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now())`,
          [randomUUID(), tenantId, roleId, resource, level],
        );
      }
      const userId = randomUUID();
      await runner.query(
        `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
        [userId, tenantId, name.split(' ')[0], `${name.toLowerCase().replace(/\s+/g, '-')}-${tag}@example.com`, roleId],
      );
      return userId;
    };
    await fn({ runner, tenantId, seedUser });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function rejects(promise: Promise<unknown>, label: string) {
  await assert.rejects(promise, (error: any) => [403, 404].includes(error?.getStatus?.()), label);
}

async function boundDocument(runner: QueryRunner, sourceEntityType: string, sourceId: string, slotKey: string) {
  const rows = await runner.query(
    `SELECT d.id::text AS id, d.title, d.content_markdown
     FROM integrated_document_bindings b
     JOIN documents d ON d.id = b.document_id
     WHERE b.tenant_id = app_current_tenant()
       AND b.source_entity_type = $1
       AND b.source_entity_id = $2
       AND b.slot_key = $3`,
    [sourceEntityType, sourceId, slotKey],
  );
  return rows[0] as { id: string; title: string; content_markdown: string } | undefined;
}

async function seedProject(runner: QueryRunner, tenantId: string, itemNumber: number, name: string) {
  const [{ id }] = await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [tenantId, name, itemNumber],
  );
  return { id: id as string, tenant_id: tenantId, item_number: itemNumber, name };
}

// A portfolio member with no Knowledge right renames a project that has its purpose document.
async function testMemberRenamesProjectWithPurpose() {
  await inFixture(async ({ runner, tenantId, seedUser }) => {
    const { integrated, knowledge, projects } = createServices(runner.manager);
    const manager = runner.manager;
    const member = await seedUser('Portfolio member', { portfolio_projects: 'member' });
    const project = await seedProject(runner, tenantId, 1, 'Warehouse');
    await integrated.provisionForProject(project, { purpose: 'Why we do it.' }, member, { manager });
    const before = await boundDocument(runner, 'projects', project.id, 'purpose');
    assert.ok(before, 'the project has its purpose document');

    await projects.update(project.id, { name: 'Warehouse v2' }, tenantId, member, { manager });

    const after = await boundDocument(runner, 'projects', project.id, 'purpose');
    assert.match(String(after?.title), /^PRJ-1 - Warehouse v2 - /, 'the purpose title follows the rename');
    assert.equal(after?.content_markdown, 'Why we do it.');
    await rejects(knowledge.get(before!.id, { manager, userId: member }), 'the document stays closed in Knowledge');
  });
}

// A Business Contributor changes a project's purpose twice: the first change creates the
// document, the second updates it.
async function testBusinessContributorChangesPurposeTwice() {
  await inFixture(async ({ runner, tenantId, seedUser }) => {
    const { projects } = createServices(runner.manager);
    const manager = runner.manager;
    const contributor = await seedUser('Business Contributor', { portfolio_projects: 'contributor' });
    const project = await seedProject(runner, tenantId, 2, 'Plant');

    await projects.update(project.id, { purpose: 'First purpose.' } as any, tenantId, contributor, { manager });
    assert.equal((await boundDocument(runner, 'projects', project.id, 'purpose'))?.content_markdown, 'First purpose.');
    await projects.update(project.id, { purpose: 'Second purpose.' } as any, tenantId, contributor, { manager });
    assert.equal((await boundDocument(runner, 'projects', project.id, 'purpose'))?.content_markdown, 'Second purpose.');
  });
}

// A portfolio reader writes neither the text nor the title of the purpose document.
async function testPortfolioReaderStaysRefused() {
  await inFixture(async ({ runner, tenantId, seedUser }) => {
    const { integrated } = createServices(runner.manager);
    const manager = runner.manager;
    const member = await seedUser('Portfolio member', { portfolio_projects: 'member' });
    const reader = await seedUser('Portfolio reader', { portfolio_projects: 'reader' });
    const project = await seedProject(runner, tenantId, 3, 'Depot');
    await integrated.provisionForProject(project, { purpose: 'Kept.' }, member, { manager });
    const before = await boundDocument(runner, 'projects', project.id, 'purpose');

    await rejects(
      integrated.writeSourceSlotContent('projects', project, 'purpose', 'Overwritten.', reader, { manager }),
      'a reader cannot change the purpose',
    );
    await rejects(
      integrated.syncTitles('projects', { ...project, name: 'Depot renamed' }, reader, { manager }),
      'a reader cannot rename the purpose document',
    );
    assert.deepEqual(await boundDocument(runner, 'projects', project.id, 'purpose'), before, 'the document is unchanged');
  });
}

// The record's right covers its own document only: not another record's, not another
// document of the same library.
async function testGrantStopsAtTheRecordDocument() {
  await inFixture(async ({ runner, tenantId, seedUser }) => {
    const { integrated, knowledge, projects } = createServices(runner.manager);
    const manager = runner.manager;
    const member = await seedUser('Portfolio member', { portfolio_projects: 'member' });
    const mine = await seedProject(runner, tenantId, 4, 'Mine');
    const other = await seedProject(runner, tenantId, 5, 'Other');
    await integrated.provisionForProject(mine, { purpose: 'Mine.' }, member, { manager });
    await integrated.provisionForProject(other, { purpose: 'Other.' }, member, { manager });
    // A plain Knowledge page in the library and folder of the purpose documents.
    const [setting] = await runner.query(
      `SELECT library_id::text AS library_id, folder_id::text AS folder_id, document_type_id::text AS document_type_id
       FROM documents
       WHERE id = $1`,
      [(await boundDocument(runner, 'projects', mine.id, 'purpose'))!.id],
    );
    const plain = await knowledge.createManagedDocument(
      { tenantId, title: 'Library page', content_markdown: 'Plain.', ...setting },
      null,
      { manager },
    );

    await projects.update(mine.id, { name: 'Mine renamed' }, tenantId, member, { manager });
    const mineDoc = await boundDocument(runner, 'projects', mine.id, 'purpose');
    const otherDoc = await boundDocument(runner, 'projects', other.id, 'purpose');
    assert.match(String(mineDoc?.title), /^PRJ-4 - Mine renamed - /);

    const grant = { documentId: mineDoc!.id, sourceEntityType: 'projects', sourceEntityId: mine.id, slotKey: 'purpose', level: 'writer' as const };
    await rejects(
      knowledge.updateManagedDocument(otherDoc!.id, { title: 'Taken' }, member, { manager, sourceGrant: { ...grant, documentId: otherDoc!.id } }),
      'the grant of one project does not open the document of another',
    );
    await rejects(
      knowledge.updateManagedDocument(plain.id, { title: 'Taken' }, member, { manager, sourceGrant: { ...grant, documentId: plain.id } }),
      'the grant does not open another document of the same library',
    );
    await rejects(
      knowledge.updateManagedDocument(mineDoc!.id, { title: 'Taken' }, member, { manager }),
      'without the grant, the Knowledge route still applies the library rules',
    );
    const [{ title: plainTitle }] = await runner.query(`SELECT title FROM documents WHERE id = $1`, [plain.id]);
    assert.equal(plainTitle, 'Library page');
    assert.match(String((await boundDocument(runner, 'projects', other.id, 'purpose'))?.title), /^PRJ-5 - Other - /);
  });
}

// A request member changes both texts and renames the request; a request contributor (below
// the request's edit level) stays refused.
async function testRequestMemberWritesItsDocuments() {
  await inFixture(async ({ runner, tenantId, seedUser }) => {
    const { integrated } = createServices(runner.manager);
    const manager = runner.manager;
    const member = await seedUser('Request member', { portfolio_requests: 'member' });
    const contributor = await seedUser('Request contributor', { portfolio_requests: 'contributor' });
    const [{ id }] = await runner.query(
      `INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Scanner', 7) RETURNING id::text AS id`,
      [tenantId],
    );
    const request = { id: id as string, tenant_id: tenantId, item_number: 7, name: 'Scanner' };
    await integrated.provisionForRequest(request, { purpose: 'Scan.', risks_mitigations: 'None.' }, member, { manager });

    await integrated.writeSourceSlotContent('requests', request, 'purpose', 'Scan faster.', member, { manager });
    await integrated.writeSourceSlotContent('requests', request, 'risks_mitigations', 'Paper jams.', member, { manager });
    assert.equal(await integrated.syncTitles('requests', { ...request, name: 'Scanner v2' }, member, { manager }), 2);
    const purpose = await boundDocument(runner, 'requests', request.id, 'purpose');
    const risks = await boundDocument(runner, 'requests', request.id, 'risks_mitigations');
    assert.equal(purpose?.content_markdown, 'Scan faster.');
    assert.equal(risks?.content_markdown, 'Paper jams.');
    assert.match(String(purpose?.title), /^REQ-7 - Scanner v2 - /);
    assert.match(String(risks?.title), /^REQ-7 - Scanner v2 - /);

    await rejects(
      integrated.writeSourceSlotContent('requests', request, 'purpose', 'Overwritten.', contributor, { manager }),
      'a request contributor cannot change the purpose',
    );
    await rejects(
      integrated.syncTitles('requests', { ...request, name: 'Scanner v3' }, contributor, { manager }),
      'a request contributor cannot rename the documents',
    );
    assert.equal((await boundDocument(runner, 'requests', request.id, 'purpose'))?.content_markdown, 'Scan faster.');
  });
}

// An applications member renames an interface and rewrites its specification; an applications
// reader stays refused. The application overview follows the same rule.
async function testApplicationsMemberWritesInterfaceAndApplication() {
  await inFixture(async ({ runner, tenantId, seedUser }) => {
    const { integrated } = createServices(runner.manager);
    const manager = runner.manager;
    const member = await seedUser('Applications member', { applications: 'member' });
    const reader = await seedUser('Applications reader', { applications: 'reader' });
    const [{ id: sourceApp }] = await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), 'Source app') RETURNING id::text AS id`,
    );
    const [{ id: targetApp }] = await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), 'Target app') RETURNING id::text AS id`,
    );
    const [row] = await runner.query(
      `INSERT INTO interfaces (
         tenant_id, name, business_purpose, source_application_id, target_application_id,
         data_category, integration_route_type, lifecycle
       ) VALUES (app_current_tenant(), 'Orders', 'Sync', $1, $2, 'master_data', 'direct', 'active')
       RETURNING id::text AS id, interface_reference`,
      [sourceApp, targetApp],
    );
    const iface = { id: row.id as string, tenant_id: tenantId, item_number: null, name: 'Orders', reference_label: row.interface_reference as string };
    await integrated.provisionForInterface(iface, { specification: 'Orders flow.' }, member, { manager });

    assert.equal(await integrated.syncTitles('interfaces', { ...iface, name: 'Orders v2' }, member, { manager }), 1);
    await integrated.writeSourceSlotContent('interfaces', iface, 'specification', 'Orders flow, daily.', member, { manager });
    const spec = await boundDocument(runner, 'interfaces', iface.id, 'specification');
    assert.ok(String(spec?.title).startsWith(`${iface.reference_label} - Orders v2 - `), 'the specification title follows the rename');
    assert.equal(spec?.content_markdown, 'Orders flow, daily.');
    await rejects(
      integrated.syncTitles('interfaces', { ...iface, name: 'Orders v3' }, reader, { manager }),
      'an applications reader cannot rename the specification',
    );
    await rejects(
      integrated.writeSourceSlotContent('interfaces', iface, 'specification', 'Overwritten.', reader, { manager }),
      'an applications reader cannot change the specification',
    );

    const app = { id: sourceApp as string, tenant_id: tenantId, item_number: null, name: 'Source app', reference_label: 'APP-1' };
    await integrated.writeSourceSlotContent('applications', app, 'overview', 'What it does.', member, { manager });
    await integrated.writeSourceSlotContent('applications', app, 'overview', 'What it does now.', member, { manager });
    assert.equal(await integrated.syncTitles('applications', { ...app, name: 'Source app v2' }, member, { manager }), 1);
    const overview = await boundDocument(runner, 'applications', app.id, 'overview');
    assert.equal(overview?.content_markdown, 'What it does now.');
    assert.match(String(overview?.title), /^APP-1 - Source app v2 - /);
  });
}

// An incident keeps its own source context: a contributor renames it with no Knowledge right.
async function testIncidentContributorRenamesItsReview() {
  await inFixture(async ({ runner, tenantId, seedUser }) => {
    const { integrated } = createServices(runner.manager);
    const manager = runner.manager;
    const contributor = await seedUser('Incident contributor', { incidents: 'contributor' });
    const [{ id }] = await runner.query(
      `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 9, 'Outage', 'major') RETURNING id::text AS id`,
      [tenantId],
    );
    await integrated.provisionForIncident(id, contributor, { manager });
    assert.equal(
      await integrated.syncTitles('incidents', { id, tenant_id: tenantId, item_number: 9, name: 'Outage in Lyon' }, contributor, { manager }),
      1,
    );
    assert.match(String((await boundDocument(runner, 'incidents', id, 'review'))?.title), /^INC-9 - Outage in Lyon - /);
  });
}

async function main() {
  await dataSource.initialize();
  try {
    const specs = [
      testMemberRenamesProjectWithPurpose,
      testBusinessContributorChangesPurposeTwice,
      testPortfolioReaderStaysRefused,
      testGrantStopsAtTheRecordDocument,
      testRequestMemberWritesItsDocuments,
      testApplicationsMemberWritesInterfaceAndApplication,
      testIncidentContributorRenamesItsReview,
    ];
    for (const spec of specs) {
      await spec();
      console.log(`  ok ${spec.name}`);
    }
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('integrated-document-caller-grant.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
