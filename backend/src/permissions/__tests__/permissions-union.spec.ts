import * as assert from 'node:assert/strict';
import { PermissionsService } from '../permissions.service';

// `manager` is a historical level: the database still accepts it, but it grants no access.
// It must never hide a ranked level held through another role, whatever the order of the roles.

type Row = { role_id: string; resource: string; level: string };

function createManager(rows: Row[]) {
  return {
    getRepository: () => ({
      find: async ({ where }: { where: { role_id: string } }) => rows.filter((row) => row.role_id === where.role_id),
    }),
  } as any;
}

const service = new PermissionsService({} as any, {} as any);

async function testManagerNeverHidesMemberAcrossRoles() {
  const rows: Row[] = [
    { role_id: 'role-manager', resource: 'projects', level: 'manager' },
    { role_id: 'role-member', resource: 'projects', level: 'member' },
  ];
  const manager = createManager(rows);
  for (const order of [['role-manager', 'role-member'], ['role-member', 'role-manager']]) {
    const map = await service.listForRoles(order, { manager });
    assert.equal(map.get('projects'), 'member', `roles ${order.join(', ')}`);
  }
}

async function testManagerNeverHidesMemberWithinRole() {
  for (const levels of [['manager', 'member'], ['member', 'manager']]) {
    // `reports` is another name of `reporting`: two rows of one role for one resource.
    const rows: Row[] = [
      { role_id: 'role-1', resource: 'reports', level: levels[0] },
      { role_id: 'role-1', resource: 'reporting', level: levels[1] },
    ];
    const map = await service.listForRole('role-1', { manager: createManager(rows) });
    assert.equal(map.get('reporting'), 'member', `rows ${levels.join(', ')}`);
  }
}

// `settings` and `organization` have two levels, reader and admin: a contributor or member
// row reads as reader, so a role seeded with `settings: member` keeps exactly what it could do and
// shows "Reader". `admin` stays; `manager`, which opens nothing, is not raised to reader.
async function testReaderOrAdminRights() {
  const cases: Array<[string, string, string]> = [
    ['settings', 'member', 'reader'],
    ['settings', 'contributor', 'reader'],
    ['settings', 'admin', 'admin'],
    ['settings', 'manager', 'manager'],
    ['organization', 'member', 'reader'],
    ['organization', 'reader', 'reader'],
    ['organization', 'admin', 'admin'],
    ['infrastructure', 'member', 'member'],
  ];
  for (const [resource, stored, read] of cases) {
    const rows: Row[] = [{ role_id: 'role-1', resource, level: stored }];
    const map = await service.listForRole('role-1', { manager: createManager(rows) });
    assert.equal(map.get(resource), read, `${resource}:${stored}`);
  }
}

async function run() {
  await testManagerNeverHidesMemberAcrossRoles();
  await testManagerNeverHidesMemberWithinRole();
  await testReaderOrAdminRights();
}

void run();
