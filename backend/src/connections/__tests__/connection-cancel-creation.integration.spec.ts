// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
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

// A connection created at its title (lot 3 of the creation frame): `POST /connections/creation`
// creates it server to server without protocol nor end and hands the creator a token; while it
// lacks one, updates may leave it lacking; "Create" (`POST :id/creation/complete`) names what it
// lacks with `CREATION_INCOMPLETE`; once complete, updates keep it complete. `GET :id/creation`
// counts what was written (protocols included), `DELETE :id/creation` deletes it for its creator.
// `POST /connections` keeps its full rules.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'connection-cancel-creation-spec-secret';

const SETTINGS = {
  lifecycleStates: [{ code: 'active' }],
  connectionTypes: [{ code: 'https' }],
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
      createAtTitle: (name: unknown, tenantId: string, userId: string | null, opts: any) => crud.create({ name }, tenantId, userId, opts, { atTitle: true }),
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

function missing(fields: string[]) {
  return (response: any) => {
    assert.equal(response?.code, 'CREATION_INCOMPLETE');
    assert.deepEqual(response?.params, { fields });
  };
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['createAtTitle', 'creationChanges', 'completeCreation', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (ConnectionsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'infrastructure', level: 'member' }, `${method} needs infrastructure:member`);
  }
}

async function testCreatedAtTitleThenCompleted() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, web, db, req } = await seed(runner);
    const { controller, crud } = setup(runner);
    const opts = { manager: runner.manager };

    // `POST /connections` keeps its rules: a protocol and both ends.
    await assert.rejects(crud.create({ name: 'Bare' }, tenantId, creatorId, opts), /At least one protocol is required/);

    const created: any = await controller.createAtTitle({ name: 'Web to db' }, req(creatorId));
    assert.equal(typeof created.creation_token, 'string', 'the route hands a creation token');
    assert.equal(created.topology, 'server_to_server');
    const [stored] = await runner.query(`SELECT connection_reference FROM connections WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.ok(stored.connection_reference, 'the database gives the reference');
    assert.equal(created.connection_reference, stored.connection_reference, 'the route returns the reference');
    const complete = () => controller.completeCreation(created.id, { token: created.creation_token }, req(creatorId));

    await refusedWith(complete(), missing(['protocols', 'source', 'destination']));
    const fresh = await controller.creationChanges(created.id, created.creation_token, req(creatorId));
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    // While it lacks something, updates may leave it lacking.
    await crud.update(created.id, { description: 'Orders' }, tenantId, creatorId, opts);
    await crud.update(created.id, { protocol_codes: ['https'] }, tenantId, creatorId, opts);
    await refusedWith(complete(), missing(['source', 'destination']));
    await crud.update(created.id, { source_asset_id: web }, tenantId, creatorId, opts);
    await refusedWith(complete(), missing(['destination']));
    const edited = await controller.creationChanges(created.id, created.creation_token, req(creatorId));
    assert.deepEqual(edited, { changes: { fields: 2, children: { protocol: 1 } } }, 'two fields and a protocol');

    await crud.update(created.id, { destination_asset_id: db }, tenantId, creatorId, opts);
    assert.deepEqual(await complete(), { ok: true });

    // Complete, it stays complete (`source_asset_id: null` alone falls back to `source_server_id`).
    await assert.rejects(
      crud.update(created.id, { source_asset_id: null, source_server_id: null, source_entity_code: null }, tenantId, creatorId, opts),
      /source: select an asset or an entity/,
    );

    // A multi-server connection without servers is incomplete too.
    const multi: any = await controller.createAtTitle({ name: 'Cluster sync' }, req(creatorId));
    await crud.update(multi.id, { topology: 'multi_server' }, tenantId, creatorId, opts);
    await refusedWith(
      controller.completeCreation(multi.id, { token: multi.creation_token }, req(creatorId)),
      missing(['protocols', 'servers']),
    );

    // Another person's token, or none: refused; another author ends the creator's cancel.
    await refusedAsExpired(controller.completeCreation(created.id, { token: created.creation_token }, req(otherId)), 'other user, complete');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, req(otherId)), 'other user, cancel');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, req(creatorId)), 'no token');
    await crud.update(multi.id, { description: 'Edited by another' }, tenantId, otherId, opts);
    await refusedAsExpired(controller.cancelCreation(multi.id, { token: multi.creation_token }, req(creatorId)), 'another author');

    await controller.cancelCreation(created.id, { token: created.creation_token }, req(creatorId));
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM connections WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'the connection is gone');
    const [{ protocols }] = await runner.query(`SELECT count(*)::int AS protocols FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2`, [tenantId, created.id]);
    assert.equal(protocols, 0, 'its protocols go with it');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testCreatedAtTitleThenCompleted();
    console.log('  ok testCreatedAtTitleThenCompleted');
  } finally {
    await dataSource.destroy();
  }
  console.log('connection-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
