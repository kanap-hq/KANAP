import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { SystemAdminGuard } from '../system-admin.guard';
import { Features } from '../../../config/features';

// The scheduled task routes answer a 403 the screen can translate by its code: the platform admin
// host, the platform admin account, and the workspace administrator (single-tenant mode).

function requestOf(req: Record<string, unknown>): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

async function refusal(guard: SystemAdminGuard, req: Record<string, unknown>): Promise<ForbiddenException> {
  try {
    await guard.canActivate(requestOf(req));
  } catch (error) {
    assert.ok(error instanceof ForbiddenException, 'a 403');
    return error;
  }
  assert.fail('expected a refusal');
}

function bodyOf(error: ForbiddenException): Record<string, unknown> {
  return error.getResponse() as Record<string, unknown>;
}

async function run() {
  const previousAllowlist = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = 'admin@example.com';
  try {
    const dataSource = { getRepository: () => ({ find: async () => [] }) } as any;
    const guard = new SystemAdminGuard(dataSource);

    const noHost = await refusal(guard, { user: { sub: 'u', email: 'admin@example.com' }, isPlatformHost: false });
    assert.equal(noHost.getStatus(), 403);
    assert.equal(bodyOf(noHost).code, 'platform_admin_required');
    assert.equal(bodyOf(noHost).message, 'Platform admin host required');

    const notPlatform = await refusal(guard, { user: { sub: 'u', email: 'someone@example.com' }, isPlatformHost: true });
    assert.equal(bodyOf(notPlatform).code, 'platform_admin_required');
    assert.equal(bodyOf(notPlatform).message, 'Platform admin access required');

    assert.equal(await guard.canActivate(requestOf({ user: { sub: 'u', email: 'admin@example.com' }, isPlatformHost: true })), true);

    const previousSingleTenant = Features.SINGLE_TENANT;
    Features.SINGLE_TENANT = true;
    try {
      const singleTenant = (roles: string[]) => new SystemAdminGuard({
        getRepository: () => ({ find: async () => roles.map((role_name) => ({ role: { role_name } })) }),
      } as any);
      const administrator = await refusal(singleTenant(['Reader']), { user: { sub: 'u' } });
      assert.equal(bodyOf(administrator).code, 'administrator_required');
      assert.equal(bodyOf(administrator).message, 'Administrator access required');
      assert.equal(await singleTenant(['Administrator']).canActivate(requestOf({ user: { sub: 'u' } })), true);
    } finally {
      Features.SINGLE_TENANT = previousSingleTenant;
    }
  } finally {
    if (previousAllowlist === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previousAllowlist;
  }
  console.log('system-admin.guard: coded refusals for the platform and workspace administrator: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
