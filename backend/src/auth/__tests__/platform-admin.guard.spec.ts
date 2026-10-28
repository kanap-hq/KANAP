import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from '../platform-admin.guard';

// The platform administrator routes answer a 403 the screen can translate by its code: the
// platform admin host, then the platform admin account.

function requestOf(req: Record<string, unknown>): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

async function refusal(guard: PlatformAdminGuard, req: Record<string, unknown>): Promise<ForbiddenException> {
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
    const guard = new PlatformAdminGuard();

    const noHost = await refusal(guard, { user: { email: 'admin@example.com' }, isPlatformHost: false });
    assert.equal(noHost.getStatus(), 403);
    assert.deepEqual(bodyOf(noHost), {
      statusCode: 403,
      error: 'Forbidden',
      code: 'platform_admin_required',
      message: 'Platform admin host required',
    });

    const notPlatform = await refusal(guard, { user: { email: 'someone@example.com' }, isPlatformHost: true });
    assert.equal(notPlatform.getStatus(), 403);
    assert.deepEqual(bodyOf(notPlatform), {
      statusCode: 403,
      error: 'Forbidden',
      code: 'platform_admin_required',
      message: 'Platform admin access required',
    });

    assert.equal(
      await guard.canActivate(requestOf({ user: { email: 'admin@example.com' }, isPlatformHost: true })),
      true,
    );
  } finally {
    if (previousAllowlist === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previousAllowlist;
  }
  console.log('platform-admin.guard: coded refusals for the platform administrator: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
