// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import { PermissionGuard } from '../../auth/permission.guard';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologiesController } from '../technologies.controller';
import { services, technology } from './technologies.fixtures';

// The screen writes a technology's address with its reference (`/it/technologies/TEC-3`). Opened by
// its reference, a technology answers as by its uuid: the same record for a reader of the
// infrastructure, the same 404 for a technology that is not the tenant's, and the same refusal of
// the route's right for a person without it, whatever the address names.

function controllerOf(technologies: ReturnType<typeof services>['technologies'], catalog: ReturnType<typeof services>['catalog']) {
  return new TechnologiesController(technologies, {} as never, {} as never, {} as never, catalog, {} as never, {} as never, {} as never);
}

function ctxOf(manager: EntityManager, tenantId: string) {
  return { manager, tenantId, userId: null } as unknown as Parameters<TechnologiesController['get']>[1];
}

/** The answer of a call, or the status of its refusal, to compare two addresses of one record. */
async function outcome(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await call() };
  } catch (error: any) {
    return { refused: error?.getStatus?.() ?? error?.status ?? String(error), message: error?.message };
  }
}

async function testSameAnswerByReferenceAndUuid() {
  await inRolledBackTransaction(async (runner) => {
    const { technologies, catalog } = services();
    const controller = controllerOf(technologies, catalog);
    const tenantA = await seedTenant(runner, 'tec-ref-a');
    const ownId = await technology(runner, tenantA, 3, 'PostgreSQL', 'database');
    const tenantB = await seedTenant(runner, 'tec-ref-b');
    const otherId = await technology(runner, tenantB, 7, 'Oracle Database', 'database');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantA]);
    const read = (address: string) => outcome(() => controller.get(address, ctxOf(runner.manager, tenantA)));

    const byUuid = await read(ownId);
    assert.equal((byUuid as { ok?: { reference?: string } }).ok?.reference, 'TEC-3', 'the technology by its uuid');
    assert.deepEqual(await read('TEC-3'), byUuid, 'TEC-3: the same record as by its uuid');
    assert.deepEqual(await read('tec-3'), byUuid, 'tec-3: the same record as by its uuid');

    const missingByRef = await read('TEC-99');
    assert.equal((missingByRef as { refused?: number }).refused, 404, 'an unknown reference: not found');
    assert.deepEqual(missingByRef, await read(randomUUID()), 'an unknown reference answers as an unknown uuid');
    // Another tenant's technology: not found by its reference (the tenant has no TEC-7) as by its uuid.
    assert.deepEqual(await read('TEC-7'), missingByRef, "another tenant's TEC-7: not found");
    assert.deepEqual(await read(otherId), missingByRef, "another tenant's uuid: not found");
  });
}

function guardFor(rights: Array<[string, string]>): PermissionGuard {
  const user = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'Applications team' } };
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    { listForRoles: async () => new Map(rights) } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function getContext(address: string): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method: 'GET', params: { id: address } };
  return {
    getHandler: () => TechnologiesController.prototype.get,
    getClass: () => TechnologiesController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function testSameRefusalWithoutTheRight() {
  assert.deepEqual(
    Reflect.getMetadata(REQUIRE_LEVEL_KEY, TechnologiesController.prototype.get),
    { resource: 'infrastructure', level: 'reader' },
    'a technology is read with the infrastructure right',
  );
  const refusal = async (address: string) => {
    try {
      await guardFor([['applications', 'admin']]).canActivate(getContext(address));
    } catch (error) {
      assert.ok(error instanceof ForbiddenException, `${address}: refused`);
      return { status: error.getStatus(), body: error.getResponse() };
    }
    return assert.fail(`${address}: let through without the infrastructure right`);
  };
  const byUuid = await refusal(randomUUID());
  assert.equal(byUuid.status, 403);
  assert.deepEqual((byUuid.body as { params?: unknown }).params, { resource: 'infrastructure', level: 'reader' });
  assert.deepEqual(await refusal('TEC-3'), byUuid, 'without the right: the same refusal by the reference as by the uuid');
  for (const address of ['TEC-3', randomUUID()]) {
    assert.equal(await guardFor([['infrastructure', 'reader']]).canActivate(getContext(address)), true, `${address}: a reader goes through`);
  }
}

runSpecs('technology-reference-address-rights.integration.spec', [
  ['the same answer by the reference and by the uuid', testSameAnswerByReferenceAndUuid],
  ['the same refusal without the infrastructure right', testSameRefusalWithoutTheRight],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
