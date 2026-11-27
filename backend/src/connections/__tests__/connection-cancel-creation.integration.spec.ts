// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { Asset } from '../../assets/asset.entity';
import { Connection } from '../connection.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { ConnectionsController } from '../connections.controller';
import { ConnectionsCrudService } from '../services/connections-crud.service';
import { ConnectionsLegsService } from '../services/connections-legs.service';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { InterfaceBindingsService } from '../../interface-bindings/interface-bindings.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';

// A connection is born complete (lot L3c): the screen fills a draft and writes it with one
// `POST /connections`, which keeps its full rules (a protocol, both ends or two servers) and hands
// the creator a creation token. `GET :id/creation` counts what was written since the creation (the
// protocols given at the creation are not), `DELETE :id/creation` deletes it for its creator. The
// creation at the title (`POST /connections/creation`) and its check (`POST :id/creation/complete`)
// are gone. A connection created at its title before (no protocol, no end) still opens and may stay
// lacking on update; once complete, it stays complete.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'connection-cancel-creation-spec-secret';

const SETTINGS = {
  lifecycleStates: [{ code: 'active' }],
  connectionTypes: [{ code: 'https' }, { code: 'ssh' }],
  entities: [{ code: 'internet' }],
  pathHopFunctions: [{ code: 'firewall' }],
};

type Req = { tenant: { id: string }; user: { sub: string }; queryRunner: { manager: any } };

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

async function seed(runner: QueryRunner) {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  await runner.query(`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2, $3, 'active', now(), now())`, [
    tenantId,
    `connection-creation-${tag}`,
    `connection-creation-${tag}`,
  ]);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Infrastructure member', 'Infrastructure member', false, false, now(), now())`,
    [roleId, tenantId],
  );
  const user = async (name: string) => {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
      [id, tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, roleId],
    );
    return id;
  };
  const creatorId = await user('Creator');
  const otherId = await user('Other');
  const asset = async (name: string) => {
    const [row] = await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
       VALUES ($1, $2, 'virtual_machine', 'on_prem', 'prod', 'active', now(), now()) RETURNING id`,
      [tenantId, name],
    );
    return row.id as string;
  };
  const web = await asset('web-1');
  const db = await asset('db-1');
  const req = (userId: string): Req => ({ tenant: { id: tenantId }, user: { sub: userId }, queryRunner: { manager: runner.manager } });
  return { tenantId, creatorId, otherId, web, db, req };
}

function setup(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const settings = {
    getSettingsForWrite: async () => SETTINGS,
    getSettings: async () => SETTINGS,
    getClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
  };
  const crud = new ConnectionsCrudService(
    manager.getRepository(Connection),
    manager.getRepository(ConnectionServer),
    manager.getRepository(ConnectionProtocol),
    manager.getRepository(ConnectionLeg),
    manager.getRepository(Asset),
    settings as any,
    audit,
  );
  const controller = Object.create(ConnectionsController.prototype) as ConnectionsController;
  Object.assign(controller, {
    svc: {
      create: (body: any, tenantId: string, userId: string | null, opts: any) => crud.create(body, tenantId, userId, opts),
      delete: (id: string, userId: string | null, opts: any) => crud.delete(id, userId, opts),
    },
  });
  const legs = new ConnectionsLegsService(
    manager.getRepository(Connection),
    manager.getRepository(ConnectionServer),
    manager.getRepository(ConnectionProtocol),
    manager.getRepository(ConnectionLeg),
    manager.getRepository(Asset),
    settings as any,
    audit,
  );
  // The writers of a connection's links, as their screens call them: an interface binding's
  // connection (`POST /interface-bindings/:id/connection-links`) and a document's relation.
  const bindings = Object.assign(Object.create(InterfaceBindingsService.prototype), { audit, repo: manager.getRepository(InterfaceBinding) }) as InterfaceBindingsService;
  const knowledge = Object.create(KnowledgeService.prototype) as KnowledgeService;
  return { controller, crud, legs, bindings, knowledge };
}

/** Interface bindings to link connections to: one interface between two applications, one binding per leg. */
async function seedBindings(runner: QueryRunner, tenantId: string, count: number): Promise<string[]> {
  const id = async (text: string, params: unknown[]) => (await runner.query(`${text} RETURNING id`, params))[0].id as string;
  const tag = randomUUID().slice(0, 8);
  const app = (name: string) => id(`INSERT INTO applications (tenant_id, name, status) VALUES ($1, $2, 'enabled')`, [tenantId, `${name}-${tag}`]);
  const [source, target] = [await app('Orders'), await app('Billing')];
  const instance = (applicationId: string) => id(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [tenantId, applicationId]);
  const [sourceInstance, targetInstance] = [await instance(source), await instance(target)];
  const interfaceId = await id(
    `INSERT INTO interfaces (tenant_id, interface_reference, name, source_application_id, target_application_id, business_purpose, data_category, integration_route_type)
     VALUES ($1, $2, 'Orders flow', $3, $4, 'Orders', 'orders', 'direct')`,
    [tenantId, `INT-${tag}`, source, target],
  );
  const out: string[] = [];
  for (let order = 1; order <= count; order++) {
    const leg = await id(
      `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index)
       VALUES ($1, $2, 'source', 'source', 'target', 'schedule', 'batch', 'json', $3)`,
      [tenantId, interfaceId, order],
    );
    out.push(await id(
      `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id)
       VALUES ($1, $2, $3, 'prod', $4, $5)`,
      [tenantId, interfaceId, leg, sourceInstance, targetInstance],
    ));
  }
  return out;
}

/** A published document to link connections to. */
async function seedDocument(runner: QueryRunner, tenantId: string): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const [library] = await runner.query(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [tenantId, `Library ${tag}`, `library-${tag}`]);
  const [document] = await runner.query(
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Firewall rules', 1, 'published') RETURNING id`,
    [tenantId, library.id],
  );
  return document.id as string;
}

/** What a connection holds: itself and each of its children (`?` once gone). */
async function holdings(runner: QueryRunner, tenantId: string, connectionId: string) {
  const [row] = await runner.query(
    `SELECT (SELECT count(*)::int FROM connections WHERE tenant_id = $1 AND id = $2) AS connection,
            (SELECT count(*)::int FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2) AS protocols,
            (SELECT count(*)::int FROM connection_servers WHERE tenant_id = $1 AND connection_id = $2) AS servers,
            (SELECT count(*)::int FROM connection_legs WHERE tenant_id = $1 AND connection_id = $2) AS legs,
            (SELECT count(*)::int FROM interface_connection_links WHERE tenant_id = $1 AND connection_id = $2) AS interface_links,
            (SELECT count(*)::int FROM document_connections WHERE tenant_id = $1 AND connection_id = $2) AS document_links`,
    [tenantId, connectionId],
  );
  return row as Record<'connection' | 'protocols' | 'servers' | 'legs' | 'interface_links' | 'document_links', number>;
}

async function refusedWith(promise: Promise<unknown>, check: (response: any) => void) {
  let response: any = null;
  await assert.rejects(promise, (error: unknown) => {
    response = (error as { getResponse?: () => unknown }).getResponse?.();
    check(response);
    return true;
  });
  return response;
}

async function refusedAsExpired(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ForbiddenException, message);
    assert.equal((error.getResponse() as any).code, 'CREATION_CANCEL_EXPIRED', message);
    return true;
  });
}

/** The routes of the controller: method name, HTTP method and path. */
function routes(): Array<{ name: string; method: RequestMethod; path: string }> {
  const proto = ConnectionsController.prototype as any;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, proto[name]))
    .map((name) => ({ name, method: Reflect.getMetadata(METHOD_METADATA, proto[name]), path: String(Reflect.getMetadata(PATH_METADATA, proto[name])) }));
}

function testRoutes() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (ConnectionsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'infrastructure', level: 'member' }, `${method} needs infrastructure:member`);
  }
  const all = routes();
  // `POST /connections/creation` and `POST /connections/:id/creation/complete` answer 404: no route serves them.
  assert.equal(all.some((route) => route.method === RequestMethod.POST && route.path === 'creation'), false, 'no creation at the title');
  assert.equal(all.some((route) => route.path === ':id/creation/complete'), false, 'no creation check');
  assert.ok(all.some((route) => route.method === RequestMethod.GET && route.path === ':id/creation'), 'GET :id/creation stays');
  assert.ok(all.some((route) => route.method === RequestMethod.DELETE && route.path === ':id/creation'), 'DELETE :id/creation stays');
}

async function testCreatedWholeWithAToken() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, web, db, req } = await seed(runner);
    const { controller, crud } = setup(runner);
    const opts = { manager: runner.manager };
    const create = (body: Record<string, unknown>, userId = creatorId) => (controller as any).create(body, req(userId));

    // `POST /connections` keeps its rules: a protocol and both ends.
    await assert.rejects(create({ name: 'Bare' }), /At least one protocol is required/);
    await assert.rejects(create({ name: 'No ends', protocol_codes: ['https'] }), /source: select an asset or an entity/);
    await refusedWith(
      create({ name: 'Loop', source_asset_id: web, destination_asset_id: web, protocol_codes: ['https'] }),
      (response) => assert.equal(response?.code, 'connection_same_endpoint'),
    );
    await refusedWith(
      create({ name: 'One server', topology: 'multi_server', servers: [web], protocol_codes: ['https'] }),
      (response) => assert.equal(response?.code, 'connection_min_servers'),
    );

    const created: any = await create({ name: 'Web to db', source_asset_id: web, destination_entity_code: 'internet', protocols: [{ code: 'https', port_override: '8443' }] });
    assert.equal(typeof created.creation_token, 'string', 'the route hands a creation token');
    assert.deepEqual(created.absorbed, [], 'nothing absorbed');
    const [stored] = await runner.query(
      `SELECT connection_reference, source_asset_id, destination_entity_code, topology FROM connections WHERE tenant_id = $1 AND id = $2`,
      [tenantId, created.id],
    );
    assert.ok(stored.connection_reference, 'the database gives the reference');
    assert.equal(created.connection_reference, stored.connection_reference, 'the route returns the reference');
    assert.deepEqual([stored.source_asset_id, stored.destination_entity_code, stored.topology], [web, 'internet', 'server_to_server'], 'one write carries everything');
    const protocols = await runner.query(`SELECT connection_type_code, port_override FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2`, [tenantId, created.id]);
    assert.deepEqual(protocols, [{ connection_type_code: 'https', port_override: '8443' }], 'its protocol with its port');

    const changes = () => controller.creationChanges(created.id, created.creation_token, req(creatorId));
    assert.deepEqual(await changes(), { changes: { fields: 0, children: {} } }, 'what the creation gave is no change');
    await crud.update(created.id, { protocol_codes: ['https', 'ssh'] }, tenantId, creatorId, opts);
    assert.deepEqual(await changes(), { changes: { fields: 0, children: { protocol: 2 } } }, 'protocols written since the creation');
    await crud.update(created.id, { description: 'Orders' }, tenantId, creatorId, opts);
    assert.deepEqual(await changes(), { changes: { fields: 1, children: { protocol: 2 } } }, 'a field and the protocols');

    // A multi-server connection is created whole as well.
    const multi: any = await create({ name: 'Cluster sync', topology: 'multi_server', servers: [web, db], protocol_codes: ['https'] });
    assert.equal(typeof multi.creation_token, 'string');
    const [{ servers }] = await runner.query(`SELECT count(*)::int AS servers FROM connection_servers WHERE tenant_id = $1 AND connection_id = $2`, [tenantId, multi.id]);
    assert.equal(servers, 2, 'both servers');

    // Another person's token, or none: refused; another author ends the creator's cancel.
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, req(otherId)), 'other user, cancel');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, req(creatorId)), 'no token');
    await crud.update(multi.id, { description: 'Edited by another' }, tenantId, otherId, opts);
    await refusedAsExpired(controller.cancelCreation(multi.id, { token: multi.creation_token }, req(creatorId)), 'another author');

    await controller.cancelCreation(created.id, { token: created.creation_token }, req(creatorId));
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM connections WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'the connection is gone');
    const [{ left }] = await runner.query(`SELECT count(*)::int AS left FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2`, [tenantId, created.id]);
    assert.equal(left, 0, 'its protocols go with it');
  });
}

// Lot N1b (decision P17): an interface binding or a document linked to the connection ends its
// creator's "Cancel" (403 `CREATION_CANCEL_EXPIRED`), before and under the lock, and nothing goes.
// Those links carry no author and no history row of the connection (only the first binding's
// risk-mode switch writes one), so any link refuses, the creator's own included. The protocols,
// servers and path segments the creator gives do not; another person's change of them is in the
// history.

async function testOwnChildrenStillCancel() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, web, db, req } = await seed(runner);
    const { controller, crud, legs } = setup(runner);
    const opts = { manager: runner.manager };
    const multi: any = await (controller as any).create({ name: 'Cluster sync', topology: 'multi_server', servers: [web, db], protocol_codes: ['https'] }, req(creatorId));
    await crud.update(multi.id, { protocol_codes: ['https', 'ssh'] }, tenantId, creatorId, opts);
    await legs.createLeg(multi.id, tenantId, { function_code: 'firewall', protocol_codes: ['https'] }, creatorId, opts);
    assert.deepEqual(await holdings(runner, tenantId, multi.id), { connection: 1, protocols: 2, servers: 2, legs: 1, interface_links: 0, document_links: 0 });

    const changes = await controller.creationChanges(multi.id, multi.creation_token, req(creatorId));
    assert.equal(changes.changes.children.protocol, 2, 'the preflight counts what Cancel would delete');
    await controller.cancelCreation(multi.id, { token: multi.creation_token }, req(creatorId));
    assert.deepEqual(await holdings(runner, tenantId, multi.id), { connection: 0, protocols: 0, servers: 0, legs: 0, interface_links: 0, document_links: 0 }, 'everything goes');
  });
}

async function testLinkedConnectionRefusesCancel() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, web, req } = await seed(runner);
    const { controller, bindings, knowledge } = setup(runner);
    const opts = { manager: runner.manager };
    const [firstBinding, secondBinding] = await seedBindings(runner, tenantId, 2);
    const document = await seedDocument(runner, tenantId);
    const create = (name: string): Promise<any> =>
      (controller as any).create({ name, source_asset_id: web, destination_entity_code: 'internet', protocol_codes: ['https'] }, req(creatorId));
    const refused = async (connection: any, message: string) => {
      const before = await holdings(runner, tenantId, connection.id);
      await refusedAsExpired(controller.creationChanges(connection.id, connection.creation_token, req(creatorId)), `${message}: preflight`);
      await refusedAsExpired(controller.cancelCreation(connection.id, { token: connection.creation_token }, req(creatorId)), `${message}: cancel`);
      assert.deepEqual(await holdings(runner, tenantId, connection.id), before, `${message}: nothing is deleted`);
      assert.equal(before.connection, 1, `${message}: the connection stays`);
    };

    // The creator links a first binding (its risk-mode switch is the creator's history row),
    // another person a second one, which leaves no history row.
    const interfaces = await create('Interface linked');
    await bindings.createConnectionLink(firstBinding, { connection_id: interfaces.id }, tenantId, creatorId, opts);
    await bindings.createConnectionLink(secondBinding, { connection_id: interfaces.id }, tenantId, otherId, opts);
    await refused(interfaces, 'an interface binding linked by another person');

    // Another person links the first binding: refused as well.
    const firstByOther = await create('First binding by another');
    await bindings.createConnectionLink(firstBinding, { connection_id: firstByOther.id }, tenantId, otherId, opts);
    await refused(firstByOther, 'a first interface binding linked by another person');

    // A document linked by another person writes no history row of the connection.
    const documents = await create('Document linked');
    await knowledge.addDocumentRelationByEntity(document, 'connections', documents.id, runner.manager);
    await refused(documents, 'a document linked by another person');

    // A link carries no author: the creator's own link refuses too.
    const own = await create('Own link');
    await bindings.createConnectionLink(secondBinding, { connection_id: own.id }, tenantId, creatorId, opts);
    await refused(own, 'an interface binding linked by the creator');

    // Unlinked again, the creator cancels it as before.
    const unlinked = await create('Unlinked');
    await knowledge.addDocumentRelationByEntity(document, 'connections', unlinked.id, runner.manager);
    await knowledge.removeDocumentRelationByEntity(document, 'connections', unlinked.id, runner.manager);
    await controller.cancelCreation(unlinked.id, { token: unlinked.creation_token }, req(creatorId));
    assert.equal((await holdings(runner, tenantId, unlinked.id)).connection, 0, 'a link removed no longer refuses');
  });
}

async function testOtherTenant() {
  await inRolledBackTransaction(async (runner) => {
    const first = await seed(runner);
    const firstSetup = setup(runner);
    const body = (asset: string) => ({ name: 'Web out', source_asset_id: asset, destination_entity_code: 'internet', protocol_codes: ['https'] });
    const asTenant = (tenantId: string) => runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await asTenant(first.tenantId);
    const mine: any = await (firstSetup.controller as any).create(body(first.web), first.req(first.creatorId));

    // Another tenant: its connection, linked to a document of its own.
    const second = await seed(runner);
    const secondSetup = setup(runner);
    const theirs: any = await (secondSetup.controller as any).create(body(second.web), second.req(second.creatorId));
    const document = await seedDocument(runner, second.tenantId);
    await secondSetup.knowledge.addDocumentRelationByEntity(document, 'connections', theirs.id, runner.manager);

    // The first tenant's token is worth nothing in the second, and the second's link does not reach the first.
    await refusedAsExpired(secondSetup.controller.cancelCreation(mine.id, { token: mine.creation_token }, second.req(first.creatorId)), 'another tenant');
    await refusedAsExpired(secondSetup.controller.cancelCreation(theirs.id, { token: theirs.creation_token }, second.req(second.creatorId)), 'the second tenant is linked');
    await asTenant(first.tenantId);
    await firstSetup.controller.cancelCreation(mine.id, { token: mine.creation_token }, first.req(first.creatorId));
    assert.equal((await holdings(runner, first.tenantId, mine.id)).connection, 0, 'the first tenant cancels');
    await asTenant(second.tenantId);
    assert.deepEqual(await holdings(runner, second.tenantId, theirs.id), { connection: 1, protocols: 1, servers: 0, legs: 0, interface_links: 0, document_links: 1 }, 'the second keeps its own');
  });
}

async function testIncompleteConnectionStillEdits() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, web, db } = await seed(runner);
    const { crud } = setup(runner);
    const opts = { manager: runner.manager };
    // Created at its title before this version: no protocol, no end.
    const [row] = await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, lifecycle, risk_mode) VALUES ($1, 'Old draft', 'server_to_server', 'active', 'manual') RETURNING id`,
      [tenantId],
    );
    const id = row.id as string;
    const opened: any = await crud.get(id, tenantId, opts);
    assert.deepEqual([opened.protocol_codes, opened.source_asset_id, opened.destination_asset_id], [[], null, null], 'it opens');

    // While it lacks something, updates may leave it lacking.
    await crud.update(id, { description: 'Orders' }, tenantId, creatorId, opts);
    await crud.update(id, { protocol_codes: ['https'] }, tenantId, creatorId, opts);
    await crud.update(id, { source_asset_id: web }, tenantId, creatorId, opts);
    await crud.update(id, { destination_asset_id: db }, tenantId, creatorId, opts);

    // Complete, a source cleared to nothing is refused, so the connection stays complete.
    await assert.rejects(
      crud.update(id, { source_asset_id: null, source_server_id: null, source_entity_code: null }, tenantId, creatorId, opts),
      /source: select an asset or an entity/,
    );
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutes();
    console.log('  ok testRoutes');
    await testCreatedWholeWithAToken();
    console.log('  ok testCreatedWholeWithAToken');
    await testOwnChildrenStillCancel();
    console.log('  ok testOwnChildrenStillCancel');
    await testLinkedConnectionRefusesCancel();
    console.log('  ok testLinkedConnectionRefusesCancel');
    await testOtherTenant();
    console.log('  ok testOtherTenant');
    await testIncompleteConnectionStillEdits();
    console.log('  ok testIncompleteConnectionStillEdits');
  } finally {
    await dataSource.destroy();
  }
  console.log('connection-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
