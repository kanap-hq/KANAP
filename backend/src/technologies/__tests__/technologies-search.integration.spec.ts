// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AiEntityService } from '../../ai/ai-entity.service';
import { AiPolicyService } from '../../ai/ai-policy.service';
import { resolveAiEntityReference } from '../../ai/ai-entity-reference.util';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { services, technology } from './technologies.fixtures';

// The global search (lot T1a) against a real database, in transactions rolled back at the end: a
// technology is found by name and by its reference `TEC-n` for a user who reads the infrastructure,
// and never for a user without that permission. The policy is the real one; only the user, its
// permissions and the surface check are stubbed.

type Levels = Record<string, 'reader' | 'member' | 'admin'>;

function policyFor(levels: Levels) {
  const users = {
    findById: async (id: string) => ({ id, status: 'enabled', role_id: randomUUID(), role: { role_name: 'Custom', is_system: false } }),
  };
  const permissions = { listForRoles: async () => new Map(Object.entries(levels)) };
  const policy = new AiPolicyService(users as any, permissions as any, {} as any, {} as any, {} as any, {} as any);
  (policy as any).assertSurfaceAccess = async () => undefined;
  return policy;
}

function entityService(levels: Levels) {
  const knowledge = {
    search: async () => ({ items: [], total: 0 }),
    searchMentionOptions: async () => ({ items: [], total: 0 }),
    listReadableLibraryIdsForUser: async () => null,
  };
  return new AiEntityService(knowledge as any, policyFor(levels));
}

function context(runner: QueryRunner, tenantId: string) {
  return { tenantId, userId: randomUUID(), isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager };
}

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'tech-search');
  const id = await technology(runner, tenantId, 7, 'Zorglub Directory Server', 'directory');
  await runner.query(`UPDATE technologies SET editor = 'Zorglub Inc' WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  await runner.query(`SELECT search_index_refresh_technologies($1, NULL)`, [tenantId]);
  return { tenantId, id };
}

async function testFoundWithInfrastructureReader() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, id } = await seed(runner);
    const search = entityService({ infrastructure: 'reader' });

    const byName = await search.searchAll(context(runner, tenantId) as any, { query: 'Zorglub', limit: 20 });
    assert.ok((byName.entity_types as string[]).includes('technologies'), 'technologies are a searched type');
    const hit = byName.items.find((item: any) => item.id === id) as any;
    assert.ok(hit, 'the technology is found by its name');
    assert.equal(hit.type, 'technologies');
    assert.equal(hit.ref, 'TEC-7');
    assert.equal(hit.label, 'Zorglub Directory Server');
    assert.deepEqual(hit.metadata, { family: 'directory', editor: 'Zorglub Inc', hosting_type: 'on_prem' });

    const byRef = await search.searchAll(context(runner, tenantId) as any, { query: 'TEC-7', limit: 20 });
    assert.equal((byRef.items[0] as any)?.id, id, 'the reference TEC-7 ranks the technology first');

    const mention = await search.searchMentionCandidates(context(runner, tenantId) as any, { query: 'zorglub', entity_types: ['technologies'] });
    assert.deepEqual(mention.items.map((item: any) => item.id), [id], 'the @-mention picker offers it');

    assert.equal(await resolveAiEntityReference(runner.manager, tenantId, 'technologies', 'TEC-7'), id, 'TEC-7 resolves to the row');
  });
}

async function testHiddenWithoutInfrastructureReader() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, id } = await seed(runner);
    const search = entityService({ applications: 'reader' });

    const byName = await search.searchAll(context(runner, tenantId) as any, { query: 'Zorglub', limit: 20 });
    assert.ok(!(byName.entity_types as string[]).includes('technologies'), 'technologies are not searched');
    assert.ok(!byName.items.some((item: any) => item.id === id), 'the technology is not returned');

    const byRef = await search.searchAll(context(runner, tenantId) as any, { query: 'TEC-7', limit: 20 });
    assert.ok(!byRef.items.some((item: any) => item.id === id), 'nor by its reference');

    const mention = await search.searchMentionCandidates(context(runner, tenantId) as any, { query: 'zorglub', entity_types: ['technologies'] });
    assert.deepEqual(mention.items, [], 'the @-mention picker offers nothing');
  });
}

async function testOtherTenantSeesNothing() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner);
    const otherTenant = await seedTenant(runner, 'tech-search-other');
    const search = entityService({ infrastructure: 'reader' });

    const byName = await search.searchAll(context(runner, otherTenant) as any, { query: 'Zorglub', limit: 20 });
    assert.ok(!byName.items.some((item: any) => item.id === a.id), "another tenant does not find the technology by name");
    const byRef = await search.searchAll(context(runner, otherTenant) as any, { query: 'TEC-7', limit: 20 });
    assert.ok(!byRef.items.some((item: any) => item.id === a.id), 'nor by its reference');
    const mention = await search.searchMentionCandidates(context(runner, otherTenant) as any, { query: 'zorglub', entity_types: ['technologies'] });
    assert.deepEqual(mention.items, [], 'nor in the @-mention picker');
    await assert.rejects(resolveAiEntityReference(runner.manager, otherTenant, 'technologies', 'TEC-7'), /No technologies record/);
  });
}

async function testListAcceptsGridParameters() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'tech-grid');
    await technology(runner, tenantId, 1, 'Alpha DB', 'database');
    await technology(runner, tenantId, 2, 'Beta DB', 'database');
    await technology(runner, tenantId, 3, 'Gamma OS', 'operating_system');
    const { technologies } = services();
    const opts = { manager: runner.manager, tenantId };

    const page = await technologies.list({ page: '2', limit: '1', sort: 'name:DESC' }, opts);
    assert.deepEqual(page.items.map((item) => item.name), ['Beta DB'], 'page 2 of one row, sorted by name descending');
    assert.equal(page.total, 3);
    assert.equal(page.page, 2);

    const filtered = await technologies.list({ filters: JSON.stringify({ family: { filterType: 'set', values: ['database'] } }) }, opts);
    assert.deepEqual(filtered.items.map((item) => item.name), ['Alpha DB', 'Beta DB'], 'the grid set filter narrows by family');

    const none = await technologies.list({ filters: JSON.stringify({ family: { filterType: 'set', values: [] } }) }, opts);
    assert.equal(none.total, 0, 'a set filter with nothing ticked shows nothing');

    const blankEditor = await technologies.list({ filters: JSON.stringify({ editor: { filterType: 'set', values: [null] } }) }, opts);
    assert.equal(blankEditor.total, 3, 'blank editor matches technologies without an editor');
    assert.ok(blankEditor.items.every((item) => Array.isArray(item.it_owner_names)), 'each row carries its IT owners');

    const byName = await technologies.list({ filters: JSON.stringify({ name: { filterType: 'text', type: 'contains', filter: 'db' } }) }, opts);
    assert.deepEqual(byName.items.map((item) => item.name), ['Alpha DB', 'Beta DB'], 'the name text filter narrows');
    const byRef = await technologies.list({ filters: JSON.stringify({ reference: { filterType: 'text', type: 'equals', filter: 'tec-3' } }) }, opts);
    assert.deepEqual(byRef.items.map((item) => item.name), ['Gamma OS'], 'the reference text filter narrows');

    const byLifecycle = await technologies.list({ sort: 'lifecycle:ASC' }, opts);
    assert.equal(byLifecycle.total, 3, 'the lifecycle is a known sort');

    await runner.query(`UPDATE technologies SET editor = 'VMware' WHERE tenant_id = $1 AND name = 'Alpha DB'`, [tenantId]);
    await runner.query(`UPDATE technologies SET editor = 'vmware' WHERE tenant_id = $1 AND name = 'Beta DB'`, [tenantId]);
    const values = await technologies.filterValues('editor,family,unknown', opts);
    assert.deepEqual(Object.keys(values).sort(), ['editor', 'family'], 'unknown fields are ignored');
    assert.equal(values.editor.length, 2, "the tenant's editors once each without case, and the blank one");
    assert.equal(values.editor[0]?.toLowerCase(), 'vmware');
    assert.equal(values.editor[1], null);
    assert.deepEqual(values.family, ['database', 'operating_system']);

    await assert.rejects(technologies.create({ name: 'alpha db' }, opts), (err: any) => err.getStatus() === 409 && err.getResponse().code === 'duplicate');
  });
}

runSpecs('technologies-search.integration.spec', [
  ['found with infrastructure reader', testFoundWithInfrastructureReader],
  ['hidden without infrastructure reader', testHiddenWithoutInfrastructureReader],
  ['another tenant sees nothing', testOtherTenantSeesNothing],
  ['list accepts the grid parameters', testListAcceptsGridParameters],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
