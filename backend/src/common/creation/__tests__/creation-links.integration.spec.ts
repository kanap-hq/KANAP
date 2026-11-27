// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { cancelCreation, readCreationChanges, withCreationToken, type CreationContext } from '../creation-routes';
import { CREATION_CANCEL_LINKS } from '../creation-links';

// Lot N1b (decision P17): "Cancel" of a record being created is refused (403
// `CREATION_CANCEL_EXPIRED`) once a child stands that no row of its history records
// (`creation-links.ts`), before and under the lock, and nothing is deleted:
// - a document linked to an application, an asset, an interface, a location, a project, a request,
//   a task or an incident (the relation carries no author: whoever set it), except the record's
//   own managed document;
// - a journal entry of another person on an incident (the creator's, or a system entry, do not).
// Each family runs through the creation routes its controller calls (`readCreationChanges`,
// `cancelCreation`, with its table); its own delete is unchanged and covered by its cancel spec.
// Another tenant's rows never count.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'creation-links-spec-secret';

type Family = { table: string; relation: string; insert: (runner: QueryRunner, tenantId: string, n: number) => Promise<string> };

const id = async (runner: QueryRunner, text: string, params: unknown[]) => (await runner.query(`${text} RETURNING id`, params))[0].id as string;

const FAMILIES: Family[] = [
  { table: 'applications', relation: 'applications', insert: (r, t, n) => id(r, `INSERT INTO applications (tenant_id, name, status) VALUES ($1, $2, 'enabled')`, [t, `App ${n}`]) },
  {
    table: 'assets',
    relation: 'assets',
    insert: (r, t, n) => id(r, `INSERT INTO assets (tenant_id, name, kind, provider, environment, status) VALUES ($1, $2, 'virtual_machine', 'on_prem', 'prod', 'active')`, [t, `srv-${n}`]),
  },
  {
    table: 'interfaces',
    relation: 'interfaces',
    insert: async (r, t, n) => {
      const app = (name: string) => id(r, `INSERT INTO applications (tenant_id, name, status) VALUES ($1, $2, 'enabled')`, [t, name]);
      return id(
        r,
        `INSERT INTO interfaces (tenant_id, interface_reference, name, source_application_id, target_application_id, business_purpose, data_category, integration_route_type)
         VALUES ($1, $2, $3, $4, $5, 'Orders', 'orders', 'direct')`,
        [t, `INT-${n}`, `Flow ${n}`, await app(`Source ${n}`), await app(`Target ${n}`)],
      );
    },
  },
  { table: 'locations', relation: 'locations', insert: (r, t, n) => id(r, `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, $3, 'cloud')`, [t, `LOC-${n}`, `Site ${n}`]) },
  {
    table: 'portfolio_projects',
    relation: 'projects',
    insert: (r, t, n) => id(
      r,
      `INSERT INTO portfolio_projects (tenant_id, item_number, name, origin, status, scheduling_mode, execution_progress, criteria_values)
       VALUES ($1, $2, $3, 'fast_track', 'planned', 'independent', 0, '{}'::jsonb)`,
      [t, n, `Project ${n}`],
    ),
  },
  {
    table: 'portfolio_requests',
    relation: 'requests',
    insert: (r, t, n) => id(r, `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, criteria_values) VALUES ($1, $2, $3, 'pending_review', '{}'::jsonb)`, [t, n, `Request ${n}`]),
  },
  {
    table: 'tasks',
    relation: 'tasks',
    insert: (r, t, n) => id(r, `INSERT INTO tasks (tenant_id, item_number, title, status, labels, owner_ids, viewer_ids) VALUES ($1, $2, $3, 'open', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [t, n, `Task ${n}`]),
  },
  { table: 'incidents', relation: 'incidents', insert: (r, t, n) => id(r, `INSERT INTO incidents (tenant_id, item_number, title, severity, status) VALUES ($1, $2, $3, 'minor', 'open')`, [t, n, `Incident ${n}`]) },
];

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const asTenant = (runner: QueryRunner, tenantId: string) => runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

async function seedTenant(runner: QueryRunner) {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  await runner.query(`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2, $3, 'active', now(), now())`, [tenantId, `creation-links-${tag}`, `creation-links-${tag}`]);
  await asTenant(runner, tenantId);
  const role = await id(runner, `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Member', 'Member', false, false)`, [tenantId]);
  const user = (name: string) => id(
    runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status) VALUES ($1, $2, 'Tester', $3, null, $4, false, 'enabled')`,
    [tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, role],
  );
  const creatorId = await user('Creator');
  const otherId = await user('Other');
  const library = await id(runner, `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, $2, $3)`, [tenantId, `Library ${tag}`, `library-${tag}`]);
  let documents = 0;
  const document = () => id(runner, `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, $3, $4, 'published')`, [tenantId, library, `Doc ${++documents}`, documents]);
  const ctx = (userId: string): CreationContext => ({ tenantId, userId, manager: runner.manager });
  return { tenantId, creatorId, otherId, document, ctx };
}

type Seeded = Awaited<ReturnType<typeof seedTenant>>;

const knowledge = Object.create(KnowledgeService.prototype) as KnowledgeService;

let numbers = 100;

/** A record of the family just created by the creator, with its token. */
async function created(runner: QueryRunner, seeded: Seeded, family: Family) {
  const recordId = await family.insert(runner, seeded.tenantId, ++numbers);
  return withCreationToken(family.table, { id: recordId }, seeded.ctx(seeded.creatorId));
}

const remove = (family: Family, seeded: Seeded, recordId: string) => (manager: any) =>
  manager.query(`DELETE FROM ${family.table} WHERE tenant_id = $1 AND id = $2`, [seeded.tenantId, recordId]);

async function present(runner: QueryRunner, seeded: Seeded, family: Family, recordId: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${family.table} WHERE tenant_id = $1 AND id = $2`, [seeded.tenantId, recordId]);
  return n;
}

async function linkCount(runner: QueryRunner, seeded: Seeded, family: Family, recordId: string): Promise<number> {
  const link = CREATION_CANCEL_LINKS[family.table].find((row) => row.managedDocuments)!;
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${link.table} WHERE tenant_id = $1 AND ${link.column} = $2`, [seeded.tenantId, recordId]);
  return n;
}

async function refusedAsExpired(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ForbiddenException, `${message}: a 403`);
    assert.equal((error.getResponse() as any).code, 'CREATION_CANCEL_EXPIRED', message);
    return true;
  });
}

async function cancels(runner: QueryRunner, seeded: Seeded, family: Family, record: { id: string; creation_token: string }, message: string) {
  const ctx = seeded.ctx(seeded.creatorId);
  await readCreationChanges(family.table, record.id, record.creation_token, ctx);
  await cancelCreation(family.table, record.id, record.creation_token, ctx, remove(family, seeded, record.id));
  assert.equal(await present(runner, seeded, family, record.id), 0, `${message}: deleted`);
}

async function refuses(runner: QueryRunner, seeded: Seeded, family: Family, record: { id: string; creation_token: string }, message: string) {
  const ctx = seeded.ctx(seeded.creatorId);
  await refusedAsExpired(readCreationChanges(family.table, record.id, record.creation_token, ctx), `${message}: preflight`);
  await refusedAsExpired(cancelCreation(family.table, record.id, record.creation_token, ctx, remove(family, seeded, record.id)), `${message}: cancel`);
  assert.equal(await present(runner, seeded, family, record.id), 1, `${message}: the record stays`);
}

async function testDocumentLinks() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedTenant(runner);
    for (const family of FAMILIES) {
      // Unlinked: cancelled as before.
      await cancels(runner, seeded, family, await created(runner, seeded, family), `${family.table} unlinked`);

      // A document linked to it (from the document, by anyone): refused, nothing goes.
      const linked = await created(runner, seeded, family);
      await knowledge.addDocumentRelationByEntity(await seeded.document(), family.relation as any, linked.id, runner.manager);
      await refuses(runner, seeded, family, linked, `${family.table} with a linked document`);
      assert.equal(await linkCount(runner, seeded, family, linked.id), 1, `${family.table}: the link stays`);

      // Its own managed document (provisioned with it) does not refuse. Tasks have none.
      if (family.table === 'tasks') {
        console.log(`    ok ${family.table}`);
        continue;
      }
      const managed = await created(runner, seeded, family);
      const document = await seeded.document();
      await runner.query(
        `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id) VALUES ($1, $2, $3, 'purpose', $4)`,
        [seeded.tenantId, family.relation, managed.id, document],
      );
      await knowledge.addDocumentRelationByEntity(document, family.relation as any, managed.id, runner.manager);
      await cancels(runner, seeded, family, managed, `${family.table} with its managed document`);
      console.log(`    ok ${family.table}`);
    }
  });
}

// The other cascade children no history row records (lot N1b, option (a)): each one set by another
// record refuses its family's Cancel and nothing goes; an activity, a comment or a review request
// refuses only when another person wrote it. Without the child, Cancel passes.
type ChildCase = {
  family: Family;
  child: string;
  /** Writes the child on the record, as `authorId` when the row has an author. */
  write: (runner: QueryRunner, recordId: string, authorId: string) => Promise<unknown>;
  authored?: true;
};

const EXTRA_FAMILIES: Record<string, Family> = {
  business_processes: { table: 'business_processes', relation: '', insert: (r, t, n) => id(r, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, $2)`, [t, `Process ${n}`]) },
  contacts: { table: 'contacts', relation: '', insert: (r, t, n) => id(r, `INSERT INTO contacts (tenant_id, email, item_number) VALUES ($1, $2, $3)`, [t, `contact-${n}@example.com`, n]) },
  departments: {
    table: 'departments',
    relation: '',
    insert: async (r, t, n) => {
      const company = await id(r, `INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, $2, 'FR', 'Lyon', $3)`, [t, `Company ${n}`, n]);
      return id(r, `INSERT INTO departments (tenant_id, company_id, name, item_number) VALUES ($1, $2, $3, $4)`, [t, company, `Department ${n}`, n]);
    },
  },
  documents: {
    table: 'documents',
    relation: '',
    insert: async (r, t, n) => {
      const library = await id(r, `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, $2, $3)`, [t, `Library ${n}`, `library-${n}-${randomUUID().slice(0, 6)}`]);
      return id(r, `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, $3, $4, 'draft')`, [t, library, `Doc ${n}`, 1000 + n]);
    },
  },
};

const family = (table: string) => FAMILIES.find((row) => row.table === table) ?? EXTRA_FAMILIES[table];

function childCases(seeded: Seeded): ChildCase[] {
  const other = async (runner: QueryRunner, table: string) => family(table).insert(runner, seeded.tenantId, ++numbers);
  const technology = (runner: QueryRunner) => id(runner, `INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [seeded.tenantId, ++numbers, `Tech ${numbers}`]);
  const pair = (child: string, recordColumn: string, otherColumn: string, otherOf: (runner: QueryRunner) => Promise<string>, extra = '') =>
    async (runner: QueryRunner, recordId: string) =>
      runner.query(
        `INSERT INTO ${child} (tenant_id, ${recordColumn}, ${otherColumn}${extra ? `, ${extra.split('=')[0]}` : ''}) VALUES ($1, $2, $3${extra ? `, '${extra.split('=')[1]}'` : ''})`,
        [seeded.tenantId, recordId, await otherOf(runner)],
      );
  const activity = (column: string) => (runner: QueryRunner, recordId: string, authorId: string) =>
    runner.query(`INSERT INTO portfolio_activities (tenant_id, ${column}, author_id, type, content) VALUES ($1, $2, $3, 'comment', 'Seen.')`, [seeded.tenantId, recordId, authorId]);
  return [
    { family: family('applications'), child: 'incident_applications', write: pair('incident_applications', 'application_id', 'incident_id', (r) => other(r, 'incidents')) },
    { family: family('applications'), child: 'task_applications', write: pair('task_applications', 'application_id', 'task_id', (r) => other(r, 'tasks')) },
    { family: family('applications'), child: 'interface_middleware_applications', write: pair('interface_middleware_applications', 'application_id', 'interface_id', (r) => other(r, 'interfaces')) },
    { family: family('assets'), child: 'incident_assets', write: pair('incident_assets', 'asset_id', 'incident_id', (r) => other(r, 'incidents')) },
    { family: family('assets'), child: 'task_assets', write: pair('task_assets', 'asset_id', 'task_id', (r) => other(r, 'tasks')) },
    {
      family: family('business_processes'),
      child: 'portfolio_request_business_processes',
      write: pair('portfolio_request_business_processes', 'business_process_id', 'request_id', (r) => other(r, 'portfolio_requests')),
    },
    { family: family('contacts'), child: 'application_support_contacts', write: pair('application_support_contacts', 'contact_id', 'application_id', (r) => other(r, 'applications')) },
    { family: family('contacts'), child: 'asset_support_contacts', write: pair('asset_support_contacts', 'contact_id', 'asset_id', (r) => other(r, 'assets')) },
    { family: family('contacts'), child: 'location_contacts', write: pair('location_contacts', 'contact_id', 'location_id', (r) => other(r, 'locations')) },
    { family: family('contacts'), child: 'portfolio_project_contacts', write: pair('portfolio_project_contacts', 'contact_id', 'project_id', (r) => other(r, 'portfolio_projects')) },
    { family: family('contacts'), child: 'portfolio_request_contacts', write: pair('portfolio_request_contacts', 'contact_id', 'request_id', (r) => other(r, 'portfolio_requests')) },
    { family: family('contacts'), child: 'technology_support_contacts', write: pair('technology_support_contacts', 'contact_id', 'technology_id', technology) },
    { family: family('departments'), child: 'application_departments', write: pair('application_departments', 'department_id', 'application_id', (r) => other(r, 'applications')) },
    {
      family: family('portfolio_projects'),
      child: 'portfolio_request_dependencies',
      write: pair('portfolio_request_dependencies', 'depends_on_project_id', 'request_id', (r) => other(r, 'portfolio_requests')),
    },
    { family: family('portfolio_projects'), child: 'portfolio_activities', write: activity('project_id'), authored: true },
    // Review N1b (C3, C4): the other column of a link between two records of the family, audited on
    // the other record only.
    { family: family('applications'), child: 'application_suites', write: pair('application_suites', 'suite_id', 'application_id', (r) => other(r, 'applications')) },
    { family: family('assets'), child: 'asset_cluster_members', write: pair('asset_cluster_members', 'asset_id', 'cluster_id', (r) => other(r, 'assets')) },
    { family: family('assets'), child: 'asset_relations', write: pair('asset_relations', 'related_asset_id', 'asset_id', (r) => other(r, 'assets'), 'relation_type=depends_on') },
    { family: family('interfaces'), child: 'interface_dependencies', write: pair('interface_dependencies', 'related_interface_id', 'interface_id', (r) => other(r, 'interfaces'), 'direction=upstream') },
    {
      family: family('portfolio_projects'),
      child: 'portfolio_project_dependencies',
      write: pair('portfolio_project_dependencies', 'depends_on_project_id', 'project_id', (r) => other(r, 'portfolio_projects')),
    },
    {
      family: family('portfolio_requests'),
      child: 'portfolio_request_dependencies',
      write: pair('portfolio_request_dependencies', 'depends_on_request_id', 'request_id', (r) => other(r, 'portfolio_requests')),
    },
    { family: family('documents'), child: 'document_references', write: pair('document_references', 'target_document_id', 'source_document_id', (r) => other(r, 'documents')) },
    {
      // A relation set after the creation, from the other record's Knowledge panel (review C2).
      family: family('documents'),
      child: 'document_applications',
      write: async (runner, recordId) =>
        runner.query(
          `INSERT INTO document_applications (tenant_id, document_id, application_id, created_at) VALUES ($1, $2, $3, now() + interval '1 second')`,
          [seeded.tenantId, recordId, await other(runner, 'applications')],
        ),
    },
    {
      // Another person's editor open on the new document: their text is not saved yet.
      family: family('documents'),
      child: 'document_edit_locks',
      write: (runner, recordId, authorId) =>
        runner.query(
          `INSERT INTO document_edit_locks (tenant_id, document_id, holder_user_id, lock_token_hash, expires_at) VALUES ($1, $2, $3, 'hash', now() + interval '5 minutes')`,
          [seeded.tenantId, recordId, authorId],
        ),
      authored: true,
    },
    { family: family('portfolio_requests'), child: 'portfolio_activities', write: activity('request_id'), authored: true },
    { family: family('tasks'), child: 'portfolio_activities', write: activity('task_id'), authored: true },
    {
      family: family('documents'),
      child: 'document_activities',
      write: (runner, recordId, authorId) =>
        runner.query(`INSERT INTO document_activities (tenant_id, document_id, author_id, type, content) VALUES ($1, $2, $3, 'comment', 'Seen.')`, [seeded.tenantId, recordId, authorId]),
      authored: true,
    },
    {
      family: family('documents'),
      child: 'document_workflows',
      write: (runner, recordId, authorId) =>
        runner.query(`INSERT INTO document_workflows (tenant_id, document_id, status, requested_revision, requested_by) VALUES ($1, $2, 'pending_review', 1, $3)`, [seeded.tenantId, recordId, authorId]),
      authored: true,
    },
  ];
}

async function childCount(runner: QueryRunner, seeded: Seeded, testCase: ChildCase, recordId: string): Promise<number> {
  const link = CREATION_CANCEL_LINKS[testCase.family.table].find((row) => row.table === testCase.child)!;
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${link.table} WHERE tenant_id = $1 AND ${link.column} = $2`, [seeded.tenantId, recordId]);
  return n;
}

async function testOtherChildren() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedTenant(runner);
    for (const table of Object.keys(EXTRA_FAMILIES)) {
      await cancels(runner, seeded, family(table), await created(runner, seeded, family(table)), `${table} without a child`);
    }
    for (const testCase of childCases(seeded)) {
      const label = `${testCase.family.table} with ${testCase.child}`;
      if (testCase.authored) {
        // The creator's own row does not refuse.
        const own = await created(runner, seeded, testCase.family);
        await testCase.write(runner, own.id, seeded.creatorId);
        await cancels(runner, seeded, testCase.family, own, `${label} of the creator`);
      }
      const record = await created(runner, seeded, testCase.family);
      await testCase.write(runner, record.id, seeded.otherId);
      await refuses(runner, seeded, testCase.family, record, label);
      assert.equal(await childCount(runner, seeded, testCase, record.id), 1, `${label}: the child stays`);
      console.log(`    ok ${label}`);
    }
  });
}

// Review N1b: what does not refuse a new document. Its relations written by its creation share the
// creation's transaction, so its time; another person's edit lock that has expired holds no text.
async function testDocumentControls() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedTenant(runner);
    const documents = family('documents');
    const atCreation = await created(runner, seeded, documents);
    await knowledge.addDocumentRelationByEntity(atCreation.id, 'applications', await family('applications').insert(runner, seeded.tenantId, ++numbers), runner.manager);
    await cancels(runner, seeded, documents, atCreation, 'a document with the relation of its creation');
    const expired = await created(runner, seeded, documents);
    await runner.query(
      `INSERT INTO document_edit_locks (tenant_id, document_id, holder_user_id, lock_token_hash, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, $2, $3, 'hash', now() - interval '1 hour', now() - interval '1 hour', now() - interval '30 minutes')`,
      [seeded.tenantId, expired.id, seeded.otherId],
    );
    await cancels(runner, seeded, documents, expired, 'a document with an expired lock of another person');
  });
}

// Règle simple, décision du 27/11 (D26): a link with no author stops Cancel even when its creator
// set it; Cancel comes back once no such link is left.
async function testSimpleRule() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedTenant(runner);
    const t = seeded.tenantId;
    // The creator touches the relations of his new document after its creation: the set is written anew.
    const documents = family('documents');
    const document = await created(runner, seeded, documents);
    await runner.query(`UPDATE documents SET created_at = now() - interval '1 minute' WHERE tenant_id = $1 AND id = $2`, [t, document.id]);
    const project = await family('portfolio_projects').insert(runner, t, ++numbers);
    await knowledge.replaceDocumentRelationsByEntity(document.id, 'projects', [project], runner.manager);
    await refuses(runner, seeded, documents, document, 'the creator\'s relation set after the creation');
    await knowledge.replaceDocumentRelationsByEntity(document.id, 'projects', [], runner.manager);
    await cancels(runner, seeded, documents, document, 'the creator\'s relations taken back');

    // The creator sets the host of his new VM from its Relations tab: the row names the host's side.
    const assets = family('assets');
    const vm = await created(runner, seeded, assets);
    const host = await assets.insert(runner, t, ++numbers);
    await runner.query(`INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`, [t, host, vm.id]);
    await refuses(runner, seeded, assets, vm, 'the host set by the creator');
    await runner.query(`DELETE FROM asset_relations WHERE tenant_id = $1 AND related_asset_id = $2`, [t, vm.id]);
    await cancels(runner, seeded, assets, vm, 'the host taken back');
  });
}

// Review N1b (B1, C1, lock): a managed document of the record that another person typed in (an
// autosave writes no version, only its history row), commented, or holds open in the editor
// refuses Cancel, even when the creator wrote after them. The creator's own work, a write of nobody
// (a title synced by the system), the provisioning by whoever opened the record first and an
// expired lock do not.
async function testManagedDocumentsOfOthers() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedTenant(runner);
    const applications = family('applications');
    const t = seeded.tenantId;
    const withManaged = async () => {
      const record = await created(runner, seeded, applications);
      const document = await seeded.document();
      await runner.query(`UPDATE documents SET created_by = $3, updated_by = $3 WHERE tenant_id = $1 AND id = $2`, [t, document, seeded.creatorId]);
      await runner.query(
        `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id) VALUES ($1, 'applications', $2, 'description', $3)`,
        [t, record.id, document],
      );
      return { record, document };
    };
    // A save as `KnowledgeService.update` and `updateManagedDocument` write it: the row, then its history row.
    const autosave = async (document: string, userId: string | null) => {
      await runner.query(`UPDATE documents SET content_markdown = 'Typed.', updated_by = $3 WHERE tenant_id = $1 AND id = $2`, [t, document, userId]);
      await runner.query(
        `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id) VALUES ($1, 'documents', $2, 'update', '{}', '{}', $3)`,
        [t, document, userId],
      );
    };
    // The provisioning on the first read of the record (`resolveManagedDocumentId`), by that reader.
    const provisionedBy = async (document: string, userId: string) => {
      await runner.query(`UPDATE documents SET created_by = $3, updated_by = $3 WHERE tenant_id = $1 AND id = $2`, [t, document, userId]);
      await runner.query(
        `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id) VALUES ($1, 'documents', $2, 'create', null, '{}', $3)`,
        [t, document, userId],
      );
      await runner.query(
        `INSERT INTO document_versions (tenant_id, document_id, version_number, title, content_markdown, content_plain, created_by) VALUES ($1, $2, 1, 'Overview', '', '', $3)`,
        [t, document, userId],
      );
      await runner.query(`INSERT INTO document_activities (tenant_id, document_id, author_id, type, content) VALUES ($1, $2, $3, 'change', 'Document created')`, [t, document, userId]);
    };
    // A revert writes a version, in a later request.
    const revert = (document: string, userId: string) =>
      runner.query(
        `INSERT INTO document_versions (tenant_id, document_id, version_number, title, content_markdown, content_plain, created_by, created_at)
         VALUES ($1, $2, 2, 'Overview', '', '', $3, now() + interval '1 second')`,
        [t, document, userId],
      );
    const comment = (document: string, userId: string) =>
      runner.query(`INSERT INTO document_activities (tenant_id, document_id, author_id, type, content) VALUES ($1, $2, $3, 'comment', 'Seen.')`, [t, document, userId]);
    const editLock = (document: string, userId: string, expires: string) =>
      runner.query(
        `INSERT INTO document_edit_locks (tenant_id, document_id, holder_user_id, lock_token_hash, acquired_at, heartbeat_at, expires_at)
         VALUES ($1, $2, $3, 'hash', now() - interval '1 hour', now() - interval '1 hour', now() + $4::interval)`,
        [t, document, userId, expires],
      );
    const passing: Array<[string, (document: string) => Promise<unknown>]> = [
      ['its creator\'s autosave', (d) => autosave(d, seeded.creatorId)],
      ['a write of nobody (a title synced by the system)', (d) => autosave(d, null)],
      ['the provisioning by another person who opened the record first', (d) => provisionedBy(d, seeded.otherId)],
      ['its creator\'s comment', (d) => comment(d, seeded.creatorId)],
      ['its creator\'s edit lock', (d) => editLock(d, seeded.creatorId, '5 minutes')],
      ['an expired lock of another person', (d) => editLock(d, seeded.otherId, '-30 minutes')],
    ];
    for (const [label, write] of passing) {
      const { record, document } = await withManaged();
      await write(document);
      await cancels(runner, seeded, applications, record, `a managed document with ${label}`);
    }
    const refusing: Array<[string, (document: string) => Promise<unknown>]> = [
      ['another person\'s autosave', (d) => autosave(d, seeded.otherId)],
      ['another person\'s autosave, then the creator\'s rename and autosave', async (d) => {
        await autosave(d, seeded.otherId);
        await autosave(d, seeded.creatorId);
      }],
      ['another person\'s revert', (d) => revert(d, seeded.otherId)],
      ['another person\'s comment', (d) => comment(d, seeded.otherId)],
      ['another person\'s live edit lock', (d) => editLock(d, seeded.otherId, '5 minutes')],
    ];
    for (const [label, write] of refusing) {
      const { record, document } = await withManaged();
      await write(document);
      await refuses(runner, seeded, applications, record, `a managed document with ${label}`);
      const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM documents WHERE tenant_id = $1 AND id = $2`, [t, document]);
      assert.equal(n, 1, `a managed document with ${label}: the document stays`);
      console.log(`    ok ${label}`);
    }
  });
}

async function testInterfaceBindingConnections() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedTenant(runner);
    const interfaces = family('interfaces');
    const t = seeded.tenantId;
    const withBinding = async () => {
      const record = await created(runner, seeded, interfaces);
      const [row] = await runner.query(`SELECT source_application_id AS source, target_application_id AS target FROM interfaces WHERE tenant_id = $1 AND id = $2`, [t, record.id]);
      const instance = (applicationId: string) => id(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [t, applicationId]);
      const leg = await id(
        runner,
        `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index)
         VALUES ($1, $2, 'source', 'source', 'target', 'schedule', 'batch', 'json', 1)`,
        [t, record.id],
      );
      const binding = await id(
        runner,
        `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id) VALUES ($1, $2, $3, 'prod', $4, $5)`,
        [t, record.id, leg, await instance(row.source), await instance(row.target)],
      );
      return { record, binding };
    };
    // The creator's own binding, unlinked: Cancel passes.
    const unlinked = await withBinding();
    await cancels(runner, seeded, interfaces, unlinked.record, 'an interface with an unlinked binding');
    // A connection linked to its binding (from the connection): refused, the link stays.
    const linked = await withBinding();
    const connection = await id(runner, `INSERT INTO connections (tenant_id, name, topology, lifecycle, risk_mode) VALUES ($1, 'Web out', 'server_to_server', 'active', 'manual')`, [t]);
    await runner.query(`INSERT INTO interface_connection_links (tenant_id, interface_binding_id, connection_id) VALUES ($1, $2, $3)`, [t, linked.binding, connection]);
    await refuses(runner, seeded, interfaces, linked.record, 'an interface whose binding carries a connection');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM interface_connection_links WHERE tenant_id = $1 AND interface_binding_id = $2`, [t, linked.binding]);
    assert.equal(n, 1, 'the link stays');
  });
}

async function testIncidentJournal() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seedTenant(runner);
    const incidents = FAMILIES.find((family) => family.table === 'incidents')!;
    const entry = (incidentId: string, authorId: string | null, kind = 'note') =>
      runner.query(`INSERT INTO incident_entries (tenant_id, incident_id, kind, content, author_id) VALUES ($1, $2, $3, 'Seen at 9:00.', $4)`, [seeded.tenantId, incidentId, kind, authorId]);

    // The creator's own notes and a system entry (no person) do not refuse.
    const own = await created(runner, seeded, incidents);
    await entry(own.id, seeded.creatorId);
    await entry(own.id, null, 'status_change');
    await cancels(runner, seeded, incidents, own, 'the creator\'s notes');

    // Another person's note refuses; the journal stays.
    const noted = await created(runner, seeded, incidents);
    await entry(noted.id, seeded.creatorId);
    await entry(noted.id, seeded.otherId);
    await refuses(runner, seeded, incidents, noted, 'another person\'s note');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM incident_entries WHERE tenant_id = $1 AND incident_id = $2`, [seeded.tenantId, noted.id]);
    assert.equal(n, 2, 'the journal stays');
  });
}

async function testOtherTenant() {
  await inRolledBackTransaction(async (runner) => {
    const applications = FAMILIES[0];
    const first = await seedTenant(runner);
    const mine = await created(runner, first, applications);
    const second = await seedTenant(runner);
    const theirs = await created(runner, second, applications);
    await knowledge.addDocumentRelationByEntity(await second.document(), 'applications', theirs.id, runner.manager);

    // The first tenant's token is worth nothing in the second; the second's link stops only its own record.
    await refusedAsExpired(cancelCreation('applications', mine.id, mine.creation_token, second.ctx(first.creatorId), remove(applications, second, mine.id)), 'another tenant');
    await refuses(runner, second, applications, theirs, 'the second tenant\'s linked record');
    await asTenant(runner, first.tenantId);
    await cancels(runner, first, applications, mine, 'the first tenant\'s unlinked record');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testDocumentLinks();
    console.log('  ok testDocumentLinks');
    await testOtherChildren();
    console.log('  ok testOtherChildren');
    await testInterfaceBindingConnections();
    console.log('  ok testInterfaceBindingConnections');
    await testDocumentControls();
    console.log('  ok testDocumentControls');
    await testManagedDocumentsOfOthers();
    console.log('  ok testManagedDocumentsOfOthers');
    await testSimpleRule();
    console.log('  ok testSimpleRule');
    await testIncidentJournal();
    console.log('  ok testIncidentJournal');
    await testOtherTenant();
    console.log('  ok testOtherTenant');
  } finally {
    await dataSource.destroy();
  }
  console.log('creation-links.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
