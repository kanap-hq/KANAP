import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../auth/permission.guard';
import { AdminBrandingController } from '../../admin/branding/admin-branding.controller';
import { AuditLogsController } from '../../audit/audit-logs.controller';
import { AdminAuthController } from '../../auth/admin-auth.controller';
import { EntraController } from '../../auth/entra.controller';
import { Features } from '../../config/features';

// The `organization` right (lot A1): the 14 routes of Admin › Branding, Admin › Audit log, Admin ›
// Authentication and the Microsoft connection, through the real PermissionGuard and the real route
// metadata. The reads need organization:reader, the writes organization:admin, the directory sync
// and the disconnect organization:admin AND users:admin (they write persons); users:admin alone
// opens none of them. The consent address of Authentication goes to organization:admin only.

type Kind = 'read' | 'write' | 'both';

const ROUTES: Array<[string, any, string, Kind]> = [
  ['GET admin/branding/settings', AdminBrandingController, 'getSettings', 'read'],
  ['POST admin/branding/logo', AdminBrandingController, 'uploadLogo', 'write'],
  ['DELETE admin/branding/logo', AdminBrandingController, 'deleteLogo', 'write'],
  ['PATCH admin/branding/settings', AdminBrandingController, 'updateSettings', 'write'],
  ['POST admin/branding/reset', AdminBrandingController, 'reset', 'write'],
  ['GET audit-logs', AuditLogsController, 'list', 'read'],
  ['GET audit-logs/filter-values', AuditLogsController, 'listFilterValues', 'read'],
  ['GET audit-logs/export', AuditLogsController, 'export', 'read'],
  ['GET audit-logs/:id', AuditLogsController, 'getById', 'read'],
  ['GET admin/auth/settings', AdminAuthController, 'getSettings', 'read'],
  ['POST admin/auth/directory-sync', AdminAuthController, 'runDirectorySync', 'both'],
  ['POST admin/auth/disconnect', AdminAuthController, 'disconnect', 'both'],
  ['POST auth/entra/setup/start', EntraController, 'startSetup', 'write'],
  ['GET auth/entra/setup/start', EntraController, 'startSetupGet', 'write'],
];

type Rights = Array<[string, string]>;

/** The rights of one person, and the routes they open (`refused`: the right the refusal names). */
const PERSONS: Array<{ name: string; rights: Rights; administrator?: boolean; opens: Record<Kind, true | [string, string]> }> = [
  {
    name: 'organization:reader',
    rights: [['organization', 'reader']],
    opens: { read: true, write: ['organization', 'admin'], both: ['organization', 'admin'] },
  },
  {
    name: 'organization:admin',
    rights: [['organization', 'admin']],
    opens: { read: true, write: true, both: ['users', 'admin'] },
  },
  {
    name: 'users:admin',
    rights: [['users', 'admin']],
    opens: { read: ['organization', 'reader'], write: ['organization', 'admin'], both: ['organization', 'admin'] },
  },
  {
    name: 'organization:reader and users:admin',
    rights: [['organization', 'reader'], ['users', 'admin']],
    opens: { read: true, write: ['organization', 'admin'], both: ['organization', 'admin'] },
  },
  {
    name: 'organization:admin and users:admin',
    rights: [['organization', 'admin'], ['users', 'admin']],
    opens: { read: true, write: true, both: true },
  },
  {
    name: 'organization:admin and users:member',
    rights: [['organization', 'admin'], ['users', 'member']],
    opens: { read: true, write: true, both: ['users', 'admin'] },
  },
  {
    name: 'Administrator',
    rights: [],
    administrator: true,
    opens: { read: true, write: true, both: true },
  },
];

function guardFor(rights: Rights, administrator = false): PermissionGuard {
  const user = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: administrator ? 'Administrator' : 'Custom' } };
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    // Something else the role gives, so that no person reads as "no access at all".
    { listForRoles: async () => new Map([['tasks', 'reader'], ...rights]) } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function contextFor(controller: any, method: string, req: any): ExecutionContext {
  const handler = controller.prototype[method];
  assert.equal(typeof handler, 'function', `${controller.name}.${method} exists`);
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function testTheRoutes() {
  for (const person of PERSONS) {
    for (const [route, controller, method, kind] of ROUTES) {
      const expected = person.opens[kind];
      const req = { user: { sub: 'u-1' }, method: route.split(' ')[0] };
      const attempt = guardFor(person.rights, person.administrator).canActivate(contextFor(controller, method, req));
      if (expected === true) {
        assert.equal(await attempt, true, `${person.name}: ${route} opens`);
      } else {
        await assert.rejects(attempt, (error: unknown) => {
          assert.ok(error instanceof ForbiddenException, `${person.name}: ${route}: a 403`);
          const body = error.getResponse() as any;
          assert.equal(body.code, 'MODULE_RIGHT_REQUIRED', `${person.name}: ${route}: the module right refusal`);
          assert.deepEqual(body.params, { resource: expected[0], level: expected[1] }, `${person.name}: ${route}: names the right missing`);
          return true;
        }, `${person.name}: ${route} refused`);
      }
    }
  }
  console.log(`  ${ROUTES.length} routes x ${PERSONS.length} persons: OK`);
}

/** No route of the four controllers is left on users alone. */
function testNoRouteOnUsersAlone() {
  for (const [route, controller, method] of ROUTES) {
    const meta = Reflect.getMetadata('require_level', controller.prototype[method]);
    assert.equal(meta?.resource, 'organization', `${route}: @RequireLevel names organization`);
  }
}

async function testConsentAddressForTheAdministratorOfTheOrganization() {
  const flags = Features as { ENTRA_SSO: boolean };
  const previous = flags.ENTRA_SSO;
  flags.ENTRA_SSO = true;
  try {
    const tenant = { id: 't-1', sso_provider: 'entra', entra_tenant_id: 'directory-1', sso_enabled: true, entra_metadata: null };
    const controller = new AdminAuthController(
      { findById: async () => tenant } as any,
      { buildAdminConsentUrl: () => 'https://login.example.test/adminconsent' } as any,
      {} as any,
      {} as any,
    );
    // What PermissionGuard leaves on the request for `@RequireLevel('organization', 'reader')`.
    const cases: Array<[string, Record<string, unknown>, string | null]> = [
      ['organization:reader', { isAdmin: false, permissionLevel: 'reader' }, null],
      ['organization:admin', { isAdmin: false, permissionLevel: 'admin' }, 'https://login.example.test/adminconsent'],
      ['Administrator', { isAdmin: true, permissionLevel: 'admin' }, 'https://login.example.test/adminconsent'],
    ];
    for (const [who, guardState, expected] of cases) {
      const settings = await controller.getSettings({ tenant: { id: tenant.id }, user: { sub: 'u-1' }, ...guardState });
      assert.equal(settings.directory_sync?.consent_url, expected, `${who}: consent address`);
      assert.equal(settings.directory_sync?.status, 'never', `${who}: the sync state is read`);
    }
  } finally {
    flags.ENTRA_SSO = previous;
  }
}

async function run() {
  testNoRouteOnUsersAlone();
  await testTheRoutes();
  await testConsentAddressForTheAdministratorOfTheOrganization();
  console.log('organization-right-routes.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
