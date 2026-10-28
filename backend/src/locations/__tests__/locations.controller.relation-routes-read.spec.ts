import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { LocationsController } from '../locations.controller';

// The older relation routes of a location (`/servers` lists its assets, `/applications` the
// applications running on them) need the read of the module they list, as the Relations tab does
// (`LOCATION_RELATION_READS`: assets are the infrastructure). `locations:reader` alone is refused.

function build() {
  const calls: string[] = [];
  const svc = {
    listAssets: async () => { calls.push('listAssets'); return [{ id: 'as-1' }]; },
    listApplications: async () => { calls.push('listApplications'); return [{ id: 'app-1' }]; },
  };
  const controller = new (LocationsController as any)(svc, undefined) as LocationsController;
  return { controller, calls };
}

const ctx = (permissions: Record<string, string>): any => ({ tenantId: 't-1', userId: 'u-1', isAdmin: false, permissions });
const req: any = { queryRunner: { manager: {} } };

async function refused(call: () => unknown, resource: string, message: string, label: string) {
  const err = await Promise.resolve().then(call).then(() => null, (e) => e);
  assert.ok(err instanceof ForbiddenException, `${label}: 403`);
  assert.deepEqual((err as ForbiddenException).getResponse(), {
    statusCode: 403,
    error: 'Forbidden',
    code: 'MODULE_RIGHT_REQUIRED',
    message,
    params: { resource, level: 'reader' },
  }, label);
}

async function run() {
  const { controller, calls } = build();
  const locationsOnly = ctx({ locations: 'reader' });

  await refused(() => controller.listServers('loc-1', req, ctx({ locations: 'reader', applications: 'reader' })), 'infrastructure', 'You cannot read assets.', 'servers');
  await refused(() => controller.listApplications('loc-1', req, ctx({ locations: 'reader', infrastructure: 'reader' })), 'applications', 'You cannot read applications.', 'applications');
  await refused(() => controller.listServers('loc-1', req, locationsOnly), 'infrastructure', 'You cannot read assets.', 'servers, locations only');
  assert.deepEqual(calls, [], 'nothing read');

  const both = ctx({ locations: 'reader', infrastructure: 'reader', applications: 'reader' });
  assert.deepEqual(await controller.listServers('loc-1', req, both), [{ id: 'as-1' }]);
  assert.deepEqual(await controller.listApplications('loc-1', req, both), [{ id: 'app-1' }]);
  assert.deepEqual(await controller.listServers('loc-1', req, { ...both, isAdmin: true, permissions: {} }), [{ id: 'as-1' }], 'administrator');
  assert.deepEqual(calls, ['listAssets', 'listApplications', 'listAssets']);
  console.log('locations.controller.relation-routes-read: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
