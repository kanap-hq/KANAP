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
