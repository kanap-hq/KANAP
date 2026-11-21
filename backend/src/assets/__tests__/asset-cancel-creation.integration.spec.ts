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
import { Asset } from '../asset.entity';
import { AssetsController } from '../assets.controller';
import { AssetsDeleteService } from '../assets-delete.service';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsValidationService } from '../services/assets-validation.service';

// An asset is born complete (lot L3b of 26.11.9): the screen writes it once with its name and its
// site, through `POST /assets`, which hands the creator a creation token like the families written
// from a draft. A body that names no provider takes the one of its site, as an update that moves the
// asset does. `GET :id/creation` counts what was written since the creation; `DELETE :id/creation`
// deletes it for its creator at the create level (member). The routes of the creation at the title
// (`POST /assets/creation`, `POST :id/creation/complete`) are gone: no route answers them (404).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'asset-cancel-creation-spec-secret';

const SETTINGS = {
  serverKinds: [{ code: 'virtual_machine', label: 'Virtual machine' }],
  serverProviders: [{ code: 'on_prem', label: 'On premises' }, { code: 'aws', label: 'AWS' }, { code: 'other', label: 'Other' }],
  hostingTypes: [
    { code: 'on_prem', label: 'On premises', category: 'on_prem' },
    { code: 'public_cloud', label: 'Public cloud', category: 'cloud' },
  ],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [],
  adminZones: [],
  ipAddressTypes: [],
  subnets: [],
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
    `asset-creation-${tag}`,
    `asset-creation-${tag}`,
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
  const siteId = randomUUID();
  await runner.query(
    `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
    [siteId, tenantId],
  );
  const cloudId = randomUUID();
  await runner.query(
    `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type, provider) VALUES ($1, $2, 'LOC-2', 'AWS Paris', 'public_cloud', 'aws')`,
    [cloudId, tenantId],
  );
  const req = (userId: string): Req => ({ tenant: { id: tenantId }, user: { sub: userId }, queryRunner: { manager: runner.manager } });
  return { tenantId, creatorId, otherId, siteId, cloudId, req };
}

function setup(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const itOps = { getSettingsForWrite: async () => SETTINGS, getSettings: async () => SETTINGS } as any;
  const crud = new AssetsCrudService(
    manager.getRepository(Asset),
    {} as any,
    audit,
    new AssetsValidationService(itOps),
    {} as any,
    { labelOf: async () => null } as any,
  );
  const deleteSvc = new AssetsDeleteService(manager.getRepository(Asset), audit);
  const controller = Object.create(AssetsController.prototype) as AssetsController;
  Object.assign(controller, {
    svc: {
      create: (body: any, tenantId: string, userId: string | null, opts: any) => crud.create(body, tenantId, userId, opts),
    },
    deleteSvc,
  });
  return { controller, crud };
}

async function refusedWith(promise: Promise<unknown>, code: string, message: string) {
  let response: any = null;
  await assert.rejects(promise, (error: unknown) => {
    response = (error as { getResponse?: () => unknown }).getResponse?.();
    assert.equal(response?.code, code, message);
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

function testRoutesNeedTheCreateLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (AssetsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'infrastructure', level: 'member' }, `${method} needs infrastructure:member`);
  }
}

/** The routes of the controller, as Nest registers them: `POST creation`, `GET :id/creation`... */
function controllerRoutes(): string[] {
  const proto = AssetsController.prototype as any;
  return Object.getOwnPropertyNames(proto).flatMap((name) => {
    const handler = proto[name];
    if (typeof handler !== 'function' || name === 'constructor') return [];
    const path = Reflect.getMetadata(PATH_METADATA, handler);
    const method = Reflect.getMetadata(METHOD_METADATA, handler);
    if (path === undefined || method === undefined) return [];
    return [`${RequestMethod[method]} ${path}`];
  });
}

function testTitleRoutesAreGone() {
  const routes = controllerRoutes();
  // No route answers them: Nest's 404.
  assert.ok(!routes.includes('POST creation'), 'POST /assets/creation is gone');
  assert.ok(!routes.includes('POST :id/creation/complete'), 'POST /assets/:id/creation/complete is gone');
  assert.ok(!('createAtTitle' in AssetsController.prototype), 'no creation at the title');
  assert.ok(!('completeCreation' in AssetsController.prototype), 'no check of an asset being created');
  // The token's routes stay.
  for (const route of ['POST /', 'GET :id/creation', 'DELETE :id/creation']) {
    assert.ok(routes.includes(route), `${route} stays`);
  }
}

async function testCreatedWithItsSite() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, siteId, cloudId, req } = await seed(runner);
    const { controller, crud } = setup(runner);
    const opts = { manager: runner.manager, tenantId };
    const fields = { kind: 'virtual_machine', environment: 'prod', status: 'active', is_cluster: false };

    // The site stays required, provider named or not.
    await refusedWith(controller.create({ name: 'Nowhere', ...fields }, req(creatorId)), 'asset_location_required', 'no site, no provider');
    await refusedWith(controller.create({ name: 'Nowhere', ...fields, provider: 'on_prem' }, req(creatorId)), 'asset_location_required', 'no site');

    // One write with the name and the site: the asset, its reference and a creation token.
    const created: any = await controller.create({ name: 'Edge 1', ...fields, hostname: 'edge-1', location_id: siteId }, req(creatorId));
    assert.equal(typeof created.creation_token, 'string', 'the route hands a creation token');
    const [stored] = await runner.query(
      `SELECT asset_reference, location_id, provider, kind, hostname, status, is_cluster FROM assets WHERE tenant_id = $1 AND id = $2`,
      [tenantId, created.id],
    );
    assert.equal(stored.location_id, siteId, 'written with its site');
    assert.equal(stored.provider, 'other', 'a site on premises gives the fallback provider');
    assert.equal(stored.kind, 'virtual_machine');
    assert.equal(stored.hostname, 'edge-1');
    assert.equal(stored.is_cluster, false);
    assert.ok(stored.asset_reference, 'the database gives the reference');
    assert.equal(created.asset_reference, stored.asset_reference, 'the route returns the reference');

    // A cloud site gives its own provider; a provider named in the body is kept.
    const cloud: any = await controller.create({ name: 'Edge 2', ...fields, location_id: cloudId }, req(creatorId));
    assert.equal(cloud.provider, 'aws', 'the cloud site gives its provider');
    const named: any = await controller.create({ name: 'Edge 3', ...fields, provider: 'on_prem', location_id: cloudId }, req(creatorId));
    assert.equal(named.provider, 'on_prem', 'a named provider is kept');
    // A cluster is written as one.
    const cluster: any = await controller.create({ name: 'Edge cluster', ...fields, is_cluster: true, location_id: siteId }, req(creatorId));
    assert.equal(cluster.is_cluster, true, 'a cluster');

    const fresh = await controller.creationChanges(created.id, created.creation_token, req(creatorId));
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');
    await crud.update(created.id, { environment: 'dev' } as any, tenantId, creatorId, opts);
    const edited = await controller.creationChanges(created.id, created.creation_token, req(creatorId));
    assert.deepEqual(edited, { changes: { fields: 1, children: {} } }, 'one field changed');
    await refusedWith(crud.update(created.id, { location_id: null } as any, tenantId, creatorId, opts), 'asset_location_required', 'clearing the site');

    // Another person's token, or none: refused.
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, req(otherId)), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, req(otherId)), 'other user, cancel');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, req(creatorId)), 'no token');

    // Another person wrote on a second asset: its creator's cancel is over.
    await crud.update(cloud.id, { environment: 'qa' } as any, tenantId, otherId, opts);
    await refusedAsExpired(controller.cancelCreation(cloud.id, { token: cloud.creation_token }, req(creatorId)), 'another author');

    // The creator, a member without the admin level, cancels the first one.
    await controller.cancelCreation(created.id, { token: created.creation_token }, req(creatorId));
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'the asset is gone');
    const deletions = await runner.query(
      `SELECT user_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'assets' AND record_id = $2 AND action = 'delete'`,
      [tenantId, created.id],
    );
    assert.deepEqual(deletions.map((row: any) => row.user_id), [creatorId], 'the delete is audited under its creator');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    testTitleRoutesAreGone();
    console.log('  ok testTitleRoutesAreGone');
    await testCreatedWithItsSite();
    console.log('  ok testCreatedWithItsSite');
  } finally {
    await dataSource.destroy();
  }
  console.log('asset-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
