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
import { Asset } from '../asset.entity';
import { AssetsController } from '../assets.controller';
import { AssetsDeleteService } from '../assets-delete.service';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsValidationService } from '../services/assets-validation.service';

// An asset created at its title (lot 3 of the creation frame): `POST /assets/creation` creates it
// without a site and hands the creator a token; "Create" (`POST :id/creation/complete`) refuses it
// with `CREATION_INCOMPLETE` until it has a site; `GET :id/creation` counts what was written since
// the creation; `DELETE :id/creation` deletes it for its creator at the create level (member).
// `POST /assets` keeps the site required.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'asset-cancel-creation-spec-secret';

const SETTINGS = {
  serverKinds: [{ code: 'virtual_machine', label: 'Virtual machine' }],
  serverProviders: [{ code: 'on_prem', label: 'On premises' }, { code: 'other', label: 'Other' }],
  hostingTypes: [{ code: 'on_prem', label: 'On premises', category: 'on_prem' }],
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
  const req = (userId: string): Req => ({ tenant: { id: tenantId }, user: { sub: userId }, queryRunner: { manager: runner.manager } });
  return { tenantId, creatorId, otherId, siteId, req };
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
      createAtTitle: (body: any, tenantId: string, userId: string | null, opts: any) => crud.create(body, tenantId, userId, opts, { atTitle: true }),
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
  for (const method of ['createAtTitle', 'creationChanges', 'completeCreation', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (AssetsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'infrastructure', level: 'member' }, `${method} needs infrastructure:member`);
  }
}

async function testCreatedAtTitleWithoutSite() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, siteId, req } = await seed(runner);
    const { controller, crud } = setup(runner);
    const opts = { manager: runner.manager, tenantId };
    const fields = { kind: 'virtual_machine', environment: 'prod', provider: 'on_prem' };

    // `POST /assets` keeps the site required.
    await refusedWith(crud.create({ name: 'Nowhere', ...fields } as any, tenantId, creatorId, opts), 'asset_location_required', 'POST /assets without a site');

    // The screen's route takes only the fields of a creation at the title: a site in the body is ignored.
    const created: any = await controller.createAtTitle({ name: 'Edge 1', ...fields, location_id: siteId, notes: 'ignored' }, req(creatorId));
    assert.equal(typeof created.creation_token, 'string', 'the route hands a creation token');
    const [stored] = await runner.query(`SELECT asset_reference, location_id, notes, kind FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(stored.location_id, null, 'no site yet');
    assert.equal(stored.notes, null, 'only the creation fields are taken');
    assert.equal(stored.kind, 'virtual_machine');
    assert.ok(stored.asset_reference, 'the database gives the reference');
    assert.equal(created.asset_reference, stored.asset_reference, 'the route returns the reference');

    const fresh = await controller.creationChanges(created.id, created.creation_token, req(creatorId));
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    // "Create" without a site: the field is named.
    const incomplete = await refusedWith(
      controller.completeCreation(created.id, { token: created.creation_token }, req(creatorId)),
      'CREATION_INCOMPLETE',
      'Create without a site',
    );
    assert.deepEqual(incomplete.params, { fields: ['location'] });

    // An asset without a site takes other updates; clearing a site is refused.
    await crud.update(created.id, { environment: 'dev' } as any, tenantId, creatorId, opts);
    const edited = await controller.creationChanges(created.id, created.creation_token, req(creatorId));
    assert.deepEqual(edited, { changes: { fields: 1, children: {} } }, 'one field changed');
    await crud.update(created.id, { location_id: siteId } as any, tenantId, creatorId, opts);
    await refusedWith(crud.update(created.id, { location_id: null } as any, tenantId, creatorId, opts), 'asset_location_required', 'clearing the site');
    assert.deepEqual(await controller.completeCreation(created.id, { token: created.creation_token }, req(creatorId)), { ok: true });

    // Another person's token, or none: refused.
    await refusedAsExpired(controller.completeCreation(created.id, { token: created.creation_token }, req(otherId)), 'other user, complete');
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, req(otherId)), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, req(otherId)), 'other user, cancel');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, req(creatorId)), 'no token');

    // Another person wrote on a second asset: its creator's cancel is over.
    const second: any = await controller.createAtTitle({ name: 'Edge 2', ...fields }, req(creatorId));
    await crud.update(second.id, { environment: 'qa' } as any, tenantId, otherId, opts);
    await refusedAsExpired(controller.cancelCreation(second.id, { token: second.creation_token }, req(creatorId)), 'another author');

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
    await testCreatedAtTitleWithoutSite();
    console.log('  ok testCreatedAtTitleWithoutSite');
  } finally {
    await dataSource.destroy();
  }
  console.log('asset-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
