// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { assert, captureAudit, inRolledBackTransaction, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';
import { InterfacesController } from '../interfaces.controller';
import { InterfaceBindingsManagementService } from '../services/interface-bindings.service';
import { InterfacesService } from '../services/interfaces.service';
import { seedApps, seedInterface, seedTenant, setCurrentTenant } from './interface-seed-helpers';

// GET/POST/DELETE /interfaces/:id/relations (lot R2f), on an empty migrated database: the
// upstream and downstream interfaces, one link at a time and its audit (the bulk replacement's
// shape), the refusals, a Business Contributor, another tenant, and the unit web link routes.

type Iface = { id: string; reference: string; name: string };

type Seed = {
  tenantId: string;
  memberId: string;
  contributorId: string;
  sourceName: string;
  targetName: string;
  owner: Iface;
  alpha: Iface;
  bravo: Iface;
  charlie: Iface;
};

function httpOf(audit = captureAudit()) {
  const bindings = new InterfaceBindingsManagementService(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
    audit as any,
  );
  const svc = new InterfacesService(undefined as any, undefined as any, bindings, undefined as any);
  return { audit, http: new InterfacesController(svc, undefined as any, undefined as any, undefined as any, undefined as any) };
}

function ctx(runner: QueryRunner, seed: Seed, userId: string | null = seed.memberId) {
  return {
    tenantId: seed.tenantId,
    userId,
    userRoles: [],
    isAdmin: false,
    permissions: { applications: 'member' },
    manager: runner.manager,
  } as any;
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function dependencyRows(runner: QueryRunner, interfaceId: string): Promise<string[]> {
  const rows: Array<{ direction: string; id: string }> = await runner.query(
    `SELECT direction, related_interface_id AS id FROM interface_dependencies WHERE interface_id = $1`,
    [interfaceId],
  );
  return rows.map((row) => `${row.direction}:${row.id}`).sort();
}

async function seedTab(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const role = async (name: string) => (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
    [tenantId, name],
  )).id as string;
  const memberRole = await role('Interface member');
  const contributorRole = await role('Business Contributor');
  const user = (roleId: string, name: string) => one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'Martin') RETURNING id`,
    [tenantId, `${name}-${tag}-${tenantId.slice(0, 8)}@example.test`, roleId, name],
  ).then((row) => row.id as string);
  const memberId = await user(memberRole, 'Rita');
  const contributorId = await user(contributorRole, 'Ada');

  const apps = await seedApps(runner, tenantId);
  const names: Array<{ name: string }> = await runner.query(
    `SELECT name FROM applications WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`,
    [[apps.source, apps.target]],
  );
  const iface = async (name: string, lifecycle = 'active'): Promise<Iface> => {
    const { id } = await seedInterface(runner, tenantId, apps, { name, lifecycle });
    const row = await one(`SELECT interface_reference FROM interfaces WHERE id = $1`, [id]);
    return { id, reference: row.interface_reference, name };
  };
  return {
    tenantId,
    memberId,
    contributorId,
    sourceName: names[0].name,
    targetName: names[1].name,
    owner: await iface(`Owner ${tag}`),
    charlie: await iface(`charlie ${tag}`, 'retired'),
    alpha: await iface(`Alpha ${tag}`),
    bravo: await iface(`Bravo ${tag}`, 'proposed'),
  };
}

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ifrel-payload');
    const { http } = httpOf();
    const writer = ctx(runner, seed);
    await http.linkRelation(seed.owner.id, 'upstream', { id: seed.charlie.id }, writer);
    await http.linkRelation(seed.owner.id, 'upstream', { id: seed.alpha.id.toUpperCase() }, writer);
    await http.linkRelation(seed.owner.id, 'downstream', { id: seed.bravo.id }, writer);

    const res = await http.relations(seed.owner.id, writer);
    assert.deepEqual(Object.keys(res).sort(), ['downstream', 'upstream']);
    assert.deepEqual(res.upstream, [
      {
        id: seed.alpha.id,
        reference: seed.alpha.reference,
        name: seed.alpha.name,
        lifecycle: 'active',
        source_application_name: seed.sourceName,
        target_application_name: seed.targetName,
      },
      {
        id: seed.charlie.id,
        reference: seed.charlie.reference,
        name: seed.charlie.name,
        lifecycle: 'retired',
        source_application_name: seed.sourceName,
        target_application_name: seed.targetName,
      },
    ]);
    assert.deepEqual(res.downstream.map((row) => [row.id, row.lifecycle]), [[seed.bravo.id, 'proposed']]);
    assert.match(seed.owner.reference, /^INT-\d+$/);

    // By reference, the same answer.
    assert.deepEqual(await http.relations(seed.owner.reference, writer), res);

    // One row on the interface that holds it: the other side lists nothing.
    assert.deepEqual(await http.relations(seed.alpha.id, writer), { upstream: [], downstream: [] });
    assert.deepEqual(await dependencyRows(runner, seed.alpha.id), []);
    assert.deepEqual(await dependencyRows(runner, seed.bravo.id), []);
  });
}

async function testLinksAndAudit() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ifrel-audit');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed);
    const up = `upstream:${seed.alpha.id}`;
    const down = `downstream:${seed.alpha.id}`;

    assert.deepEqual(await http.linkRelation(seed.owner.reference, 'upstream', { id: seed.alpha.id }, writer), { ok: true, changed: true });
    assert.deepEqual(await http.linkRelation(seed.owner.id, 'upstream', { id: seed.alpha.id }, writer), { ok: true, changed: false });
    assert.equal(audit.entries.length, 1);
    assert.deepEqual(audit.entries[0], {
      table: 'interface_dependencies',
      recordId: seed.owner.id,
      action: 'update',
      before: [],
      after: [up],
      userId: seed.memberId,
    });

    // The same interface downstream too: a separate row, as the bulk replacement allows.
    assert.deepEqual(await http.linkRelation(seed.owner.id, 'downstream', { id: seed.alpha.id }, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[1].before, [up]);
    assert.deepEqual(audit.entries[1].after, [down, up]);
    assert.deepEqual(await dependencyRows(runner, seed.owner.id), [down, up]);

    assert.deepEqual(await http.unlinkRelation(seed.owner.id, 'upstream', seed.alpha.id.toUpperCase(), writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[2].before, [down, up]);
    assert.deepEqual(audit.entries[2].after, [down]);
    assert.deepEqual(await http.unlinkRelation(seed.owner.id, 'upstream', seed.alpha.id, writer), { ok: true, changed: false });
    // Unlinking a missing interface changes nothing.
    assert.deepEqual(await http.unlinkRelation(seed.owner.id, 'downstream', randomUUID(), writer), { ok: true, changed: false });
    assert.equal(audit.entries.length, 3);
    assert.deepEqual(await dependencyRows(runner, seed.owner.id), [down]);

    // The bulk replacement writes the same audit shape.
    const bulk = httpOf();
    await bulk.http.bulkReplaceDependencies(seed.owner.id, { upstream_ids: [seed.bravo.id], downstream_ids: [seed.alpha.id] }, writer);
    assert.deepEqual(bulk.audit.entries[0].before, [down]);
    assert.deepEqual(bulk.audit.entries[0].after, [down, `upstream:${seed.bravo.id}`].sort());
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ifrel-refuse');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed);

    const invalid = await rejection(() => http.linkRelation(seed.owner.id, 'upstream', { id: 'nope' }, writer));
    assert.ok(invalid instanceof BadRequestException);
    assert.equal(invalid.message, 'Invalid id.');
    const invalidFirst = await rejection(() => http.linkRelation(randomUUID(), 'upstream', { id: 'nope' }, writer));
    assert.ok(invalidFirst instanceof BadRequestException);

    const self = await rejection(() => http.linkRelation(seed.owner.id, 'downstream', { id: seed.owner.id }, writer));
    assert.ok(self instanceof BadRequestException);
    assert.equal(self.message, 'An interface cannot depend on itself.');

    const missingTarget = await rejection(() => http.linkRelation(seed.owner.id, 'upstream', { id: randomUUID() }, writer));
    assert.ok(missingTarget instanceof BadRequestException);
    assert.equal(missingTarget.message, 'One or more interfaces were not found.');

    const unknown = await rejection(() => http.linkRelation(seed.owner.id, 'applications', { id: seed.alpha.id }, writer));
    assert.ok(unknown instanceof NotFoundException);
    assert.equal(unknown.message, 'Unknown relation type.');
    const unknownFirst = await rejection(() => http.unlinkRelation(randomUUID(), 'nope', 'nope', ctx(runner, seed, seed.contributorId)));
    assert.ok(unknownFirst instanceof NotFoundException);
    assert.equal(unknownFirst.message, 'Unknown relation type.');

    const missing = await rejection(() => http.linkRelation(randomUUID(), 'upstream', { id: seed.alpha.id }, writer));
    assert.ok(missing instanceof NotFoundException);
    assert.equal(missing.message, 'Interface not found');
    const missingRead = await rejection(() => http.relations('INT-999999', writer));
    assert.ok(missingRead instanceof NotFoundException);

    // A Business Contributor cannot read interfaces, so cannot link them either.
    const contributor = ctx(runner, seed, seed.contributorId);
    for (const call of [
      () => http.relations(seed.owner.id, contributor),
      () => http.linkRelation(seed.owner.id, 'upstream', { id: seed.alpha.id }, contributor),
      () => http.unlinkRelation(seed.owner.id, 'upstream', seed.alpha.id, contributor),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof ForbiddenException, err.message);
    }

    assert.equal(audit.entries.length, 0);
    assert.deepEqual(await dependencyRows(runner, seed.owner.id), []);
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTab(runner, 'ifrel-a');
    const b = await seedTab(runner, 'ifrel-b');
    const { audit, http } = httpOf();
    await setCurrentTenant(runner, a.tenantId);
    await http.linkRelation(a.owner.id, 'upstream', { id: a.alpha.id }, ctx(runner, a));
    audit.entries.length = 0;

    await setCurrentTenant(runner, b.tenantId);
    const writer = ctx(runner, b);
    for (const call of [
      () => http.relations(a.owner.id, writer),
      () => http.linkRelation(a.owner.id, 'upstream', { id: b.alpha.id }, writer),
      () => http.unlinkRelation(a.owner.id, 'upstream', a.alpha.id, writer),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof NotFoundException, err.message);
    }
    const foreign = await rejection(() => http.linkRelation(b.owner.id, 'upstream', { id: a.alpha.id }, writer));
    assert.ok(foreign instanceof BadRequestException);
    assert.equal(foreign.message, 'One or more interfaces were not found.');
    assert.equal(audit.entries.length, 0);
    assert.deepEqual(await http.relations(b.owner.id, writer), { upstream: [], downstream: [] });

    await setCurrentTenant(runner, a.tenantId);
    const back = await http.relations(a.owner.id, ctx(runner, a));
    assert.deepEqual(back.upstream.map((row) => row.id), [a.alpha.id]);
  });
}

async function testWebLinks() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ifrel-links');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed);
    const created = await http.createLink(seed.owner.id, { description: 'Spec', url: 'https://example.test/spec' }, writer);
    assert.equal(created.interface_id, seed.owner.id);
    assert.equal(audit.entries[0].action, 'create');

    const patched = await http.updateLink(seed.owner.id, created.id, { description: 'Runbook', url: 'https://example.test/run' }, writer);
    assert.equal(patched.description, 'Runbook');
    assert.equal(patched.url, 'https://example.test/run');

    // A link of another interface is not reachable through this one.
    const foreignPatch = await rejection(() => http.updateLink(seed.alpha.id, created.id, { description: 'Hijack' }, writer));
    assert.ok(foreignPatch instanceof NotFoundException);
    assert.deepEqual(await http.deleteLink(seed.alpha.id, created.id, writer), { ok: true });
    assert.equal((await http.listLinks(seed.owner.id, writer)).length, 1);

    assert.deepEqual(await http.deleteLink(seed.owner.id, created.id, writer), { ok: true });
    assert.equal((await http.listLinks(seed.owner.id, writer)).length, 0);
    assert.deepEqual(audit.entries.map((entry) => entry.action), ['create', 'update', 'delete']);
  });
}

function testPermissionMetadata() {
  const proto = InterfacesController.prototype;
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.relations), { resource: 'applications', level: 'reader' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.linkRelation), { resource: 'applications', level: 'member' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.unlinkRelation), { resource: 'applications', level: 'member' });
  for (const route of [proto.createLink, proto.updateLink, proto.deleteLink]) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, route), { resource: 'applications', level: 'member' });
  }
  return Promise.resolve();
}

void runSpecs('interface-relations-tab.integration.spec', [
  ['testPermissionMetadata', testPermissionMetadata],
  ['testPayload', testPayload],
  ['testLinksAndAudit', testLinksAndAudit],
  ['testRefusals', testRefusals],
  ['testTenantIsolation', testTenantIsolation],
  ['testWebLinks', testWebLinks],
]);
