import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { IncidentsController } from '../incidents.controller';

// The older link routes of an incident (assets, applications) follow the technologies' rule: the
// caller must read the module they list or replace (assets: infrastructure, applications:
// applications). Without it the answer is 403 before anything is read or written, since an empty
// replacement would remove every link. With both rights the routes keep working.

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';

function build() {
  const calls: string[] = [];
  const svc = { ensureIncident: async () => undefined };
  const relations = {
    listAssets: async () => { calls.push('listAssets'); return [{ id: 'as-1' }]; },
    listApplications: async () => { calls.push('listApplications'); return [{ id: 'app-1' }]; },
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

async function refused(call: () => Promise<unknown>, message: string, label: string) {
  const err = await call().then(() => null, (e) => e);
  assert.ok(err instanceof ForbiddenException, `${label}: 403`);
  assert.equal((err as ForbiddenException).message, message, label);
}

async function run() {
  const { controller, calls } = build();
  const noInfrastructure = ctx({ incidents: 'contributor', applications: 'reader' });
  const noApplications = ctx({ incidents: 'contributor', infrastructure: 'reader' });

  await refused(() => controller.listAssets(INCIDENT_ID, noInfrastructure), 'You cannot read assets.', 'list assets');
  await refused(() => controller.bulkReplaceAssets(INCIDENT_ID, { asset_ids: [] }, noInfrastructure), 'You cannot read assets.', 'replace assets');
  await refused(() => controller.listApplications(INCIDENT_ID, noApplications), 'You cannot read applications.', 'list applications');
  await refused(() => controller.bulkReplaceApplications(INCIDENT_ID, { application_ids: [] }, noApplications), 'You cannot read applications.', 'replace applications');
  assert.deepEqual(calls, [], 'nothing read, nothing written');

  const both = ctx({ incidents: 'contributor', infrastructure: 'reader', applications: 'reader' });
  assert.deepEqual(await controller.listAssets(INCIDENT_ID, both), [{ id: 'as-1' }]);
  assert.deepEqual(await controller.bulkReplaceAssets(INCIDENT_ID, { asset_ids: ['as-2'] }, both), ['as-2']);
  assert.deepEqual(await controller.listApplications(INCIDENT_ID, both), [{ id: 'app-1' }]);
  assert.deepEqual(await controller.bulkReplaceApplications(INCIDENT_ID, { application_ids: ['app-2'] }, both), ['app-2']);
  assert.deepEqual(calls, ['listAssets', 'bulkReplaceAssets', 'listApplications', 'bulkReplaceApplications']);

  const admin = { ...both, isAdmin: true, permissions: {} };
  assert.deepEqual(await controller.listAssets(INCIDENT_ID, admin), [{ id: 'as-1' }], 'administrator');
  console.log('incidents.controller.link-routes-read: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
