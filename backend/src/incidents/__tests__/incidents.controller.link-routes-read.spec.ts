import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { IncidentsController } from '../incidents.controller';

// The older link writes of an incident (assets, applications) follow the technologies' rule: the
// caller must read the module they replace (assets: infrastructure, applications: applications).
// Without it the answer is 403 before anything is read or written, since an empty replacement
// would remove every link. With both rights the routes keep working.

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';

function build() {
  const calls: string[] = [];
  const svc = { ensureIncident: async () => undefined };
  const relations = {
    bulkReplaceAssets: async (_id: string, ids: string[]) => { calls.push('bulkReplaceAssets'); return ids; },
    bulkReplaceApplications: async (_id: string, ids: string[]) => { calls.push('bulkReplaceApplications'); return ids; },
  };
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[0] = svc;
  args[2] = relations;
  const controller = new (IncidentsController as any)(...args) as IncidentsController;
  return { controller, calls };
}

const ctx = (permissions: Record<string, string>): any => ({ manager: {}, tenantId: 't-1', userId: 'u-1', isAdmin: false, permissions });

async function refused(call: () => Promise<unknown>, message: string, resource: string, label: string) {
  const err = await call().then(() => null, (e) => e);
  assert.ok(err instanceof ForbiddenException, `${label}: 403`);
  assert.equal((err as ForbiddenException).message, message, label);
  const body = (err as ForbiddenException).getResponse() as any;
  assert.equal(body.code, 'MODULE_RIGHT_REQUIRED', label);
  assert.deepEqual(body.params, { resource, level: 'reader' }, label);
}

async function run() {
  const { controller, calls } = build();
  const noInfrastructure = ctx({ incidents: 'contributor', applications: 'reader' });
  const noApplications = ctx({ incidents: 'contributor', infrastructure: 'reader' });

  await refused(() => controller.bulkReplaceAssets(INCIDENT_ID, { asset_ids: [] }, noInfrastructure), 'You cannot read assets.', 'infrastructure', 'replace assets');
  await refused(() => controller.bulkReplaceApplications(INCIDENT_ID, { application_ids: [] }, noApplications), 'You cannot read applications.', 'applications', 'replace applications');
  assert.deepEqual(calls, [], 'nothing read, nothing written');

  const both = ctx({ incidents: 'contributor', infrastructure: 'reader', applications: 'reader' });
  assert.deepEqual(await controller.bulkReplaceAssets(INCIDENT_ID, { asset_ids: ['as-2'] }, both), ['as-2']);
  assert.deepEqual(await controller.bulkReplaceApplications(INCIDENT_ID, { application_ids: ['app-2'] }, both), ['app-2']);
  assert.deepEqual(calls, ['bulkReplaceAssets', 'bulkReplaceApplications']);

  const admin = { ...both, isAdmin: true, permissions: {} };
  assert.deepEqual(await controller.bulkReplaceAssets(INCIDENT_ID, { asset_ids: ['as-3'] }, admin), ['as-3'], 'administrator');
  console.log('incidents.controller.link-routes-read: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
