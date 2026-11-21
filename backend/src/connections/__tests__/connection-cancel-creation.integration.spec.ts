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
  return { controller, crud };
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
