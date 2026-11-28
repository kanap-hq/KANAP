import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { InstallationAdminGuard } from '../installation-admin.guard';
import { Features } from '../../config/features';
import { User } from '../../users/user.entity';

// The installation routes (settings, scheduled tasks) answer a 403 the screen can translate by its code: the platform admin
// host, the platform admin account, and the workspace administrator (single-tenant mode).

function requestOf(req: Record<string, unknown>): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

async function refusal(guard: InstallationAdminGuard, req: Record<string, unknown>): Promise<ForbiddenException> {
  try {
    await guard.canActivate(requestOf(req));
  } catch (error) {
    assert.ok(error instanceof ForbiddenException, 'a 403');
    return error;
  }
  assert.fail('expected a refusal');
}

function bodyOf(error: ForbiddenException | UnauthorizedException): Record<string, unknown> {
  return error.getResponse() as Record<string, unknown>;
}

/** The request's transaction, holding the person as stored and their extra roles. */
function inTransaction(person: { email?: string; status: string; role?: { role_name: string } | null }, extraRoles: string[] = []) {
  return {
    manager: {
      getRepository: (entity: unknown) => entity === User
        ? { findOne: async () => ({ id: 'u', role_id: null, role: null, ...person }) }
        : { find: async () => extraRoles.map((role_name) => ({ role: { role_name } })) },
    },
  };
}

async function unauthorized(guard: InstallationAdminGuard, req: Record<string, unknown>): Promise<UnauthorizedException | string> {
  try {
    return `allowed: ${await guard.canActivate(requestOf(req))}`;
  } catch (error) {
    if (error instanceof UnauthorizedException) return error;
    return `refused otherwise: ${String(error)}`;
  }
}

async function run() {
  const previousAllowlist = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = 'admin@example.com';
  try {
    const guard = new InstallationAdminGuard({} as any);
    const platformAdmin = inTransaction({ email: 'admin@example.com', status: 'enabled' });

    const noHost = await refusal(guard, { user: { sub: 'u', email: 'admin@example.com' }, isPlatformHost: false, queryRunner: platformAdmin });
    assert.equal(noHost.getStatus(), 403);
    assert.equal(bodyOf(noHost).code, 'platform_admin_required');
    assert.equal(bodyOf(noHost).message, 'Platform admin host required');

    const notPlatform = await refusal(guard, {
      user: { sub: 'u', email: 'someone@example.com' }, isPlatformHost: true, queryRunner: inTransaction({ email: 'someone@example.com', status: 'enabled' }),
    });
    assert.equal(bodyOf(notPlatform).code, 'platform_admin_required');
    assert.equal(bodyOf(notPlatform).message, 'Platform admin access required');

    assert.equal(await guard.canActivate(requestOf({ user: { sub: 'u', email: 'admin@example.com' }, isPlatformHost: true, queryRunner: platformAdmin })), true);

    // A platform administrator disabled since the token was signed: what PermissionGuard answers.
    const disabledPlatform = await unauthorized(guard, {
      user: { sub: 'u', email: 'admin@example.com' }, isPlatformHost: true, queryRunner: inTransaction({ email: 'admin@example.com', status: 'disabled' }),
    });
    assert.ok(disabledPlatform instanceof UnauthorizedException, `a 401 (${String(disabledPlatform)})`);
    assert.equal(bodyOf(disabledPlatform).code, 'USER_DISABLED');

    const previousSingleTenant = Features.SINGLE_TENANT;
    Features.SINGLE_TENANT = true;
    try {
      // The roles are read in the request's transaction (installation-admin.guard.integration.spec.ts
      // reads them from the database).
      const singleTenant = new InstallationAdminGuard({} as any);
      const reader = { status: 'enabled', role: { role_name: 'Reader' } };
      const administrator = await refusal(singleTenant, { user: { sub: 'u' }, queryRunner: inTransaction(reader, ['Reader']) });
      assert.equal(bodyOf(administrator).code, 'administrator_required');
      assert.equal(bodyOf(administrator).message, 'Administrator access required');
      assert.equal(
        await singleTenant.canActivate(requestOf({ user: { sub: 'u' }, queryRunner: inTransaction(reader, ['Administrator']) })),
        true,
      );
      assert.equal(
        await singleTenant.canActivate(requestOf({ user: { sub: 'u' }, queryRunner: inTransaction({ status: 'enabled', role: { role_name: 'Administrator' } }) })),
        true,
        'the primary role as stored',
      );
    } finally {
      Features.SINGLE_TENANT = previousSingleTenant;
    }
  } finally {
    if (previousAllowlist === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previousAllowlist;
  }
  console.log('installation-admin.guard: coded refusals for the platform and workspace administrator: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
