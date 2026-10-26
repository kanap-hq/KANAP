import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { AppAssetAssignmentsController } from '../app-asset-assignments.controller';

// A server assignment changes the application and the server. The routes require
// applications:member (PermissionGuard); the controller also requires infrastructure:member,
// as the screen does. A reader of the infrastructure who is a member of the applications gets 403.

async function main() {
  const calls: string[] = [];
  const svc = {
    create: async () => { calls.push('create'); return { ok: true }; },
    update: async () => { calls.push('update'); return { ok: true }; },
    delete: async () => { calls.push('delete'); return { ok: true }; },
  };
  const controller = new AppAssetAssignmentsController(svc as any);
  const request = (permissions: Record<string, string>, isAdmin = false) => ({
    user: { sub: 'u1' },
    tenant: { id: 't1' },
    isAdmin,
    permissions,
  });
  const writes = (req: any) => [
    () => controller.createDeploymentAsset('i1', {}, req),
    () => controller.createInstanceAssetCompatibility('i1', {}, req),
    () => controller.updateDeploymentAsset('i1', 'a1', {}, req),
    () => controller.updateInstanceAssetCompatibility('i1', 'a1', {}, req),
    () => controller.deleteDeploymentAsset('i1', 'a1', req),
    () => controller.deleteInstanceAssetCompatibility('i1', 'a1', req),
  ];

  const reader = request({ applications: 'member', infrastructure: 'reader' });
  for (const write of writes(reader)) {
    assert.throws(write, (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403);
  }
  const none = request({ applications: 'admin' });
  for (const write of writes(none)) assert.throws(write, ForbiddenException);
  assert.deepEqual(calls, [], 'a refused write never reaches the service');

  for (const req of [request({ applications: 'member', infrastructure: 'member' }), request({}, true)]) {
    for (const write of writes(req)) await write();
  }
  assert.deepEqual(calls.length, 12);
  console.log('assignment write access: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
