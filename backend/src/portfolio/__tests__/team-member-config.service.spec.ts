import * as assert from 'node:assert/strict';
import { TeamMemberConfigService } from '../team-member-config.service';
import { TeamMemberConfigController } from '../team-member-config.controller';

// Partial PATCH contract of the contributor workspace autosave: omitted fields
// stay untouched, explicit clears (empty notes, team_id null) reach the DB as
// NULL (TypeORM skips `undefined` on save), and a zero availability persists.
// Plus the write rules for the manager and employment-type references.

type FakeRows = {
  /** user ids that belong to the tenant */
  users?: string[];
  /** id returned as the tenant's default (first built-in) type */
  defaultType?: string;
  /** existing reporting line, as user_id -> manager_user_id */
  chain?: Array<{ user_id: string; manager_user_id: string }>;
  /** active employment type ids of the tenant */
  employmentTypes?: string[];
};

function fakeQuery(rows: FakeRows) {
  return async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM users')) {
      return (rows.users ?? []).includes(params[0]) ? [{ ok: 1 }] : [];
    }
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('FROM portfolio_team_member_configs')) return rows.chain ?? [];
    if (sql.includes('FROM portfolio_employment_types')) {
      if (sql.includes('ORDER BY display_order')) return rows.defaultType ? [{ id: rows.defaultType }] : [];
      return (rows.employmentTypes ?? []).includes(params[0]) ? [{ ok: 1 }] : [];
    }
    return [];
  };
}

function createService(existing: Record<string, unknown>, rows: FakeRows = {}) {
  const saved: any[] = [];
  const repoImpl = {
    async findOne() {
      return existing;
    },
    async save(record: any) {
      saved.push({ ...record });
      return record;
    },
    create(payload: any) {
      return payload;
    },
  };
  const service = new TeamMemberConfigService(
    { manager: { getRepository: () => repoImpl, query: fakeQuery(rows) } } as any,
    { log: async () => undefined } as any,
    { nextItemNumber: async () => 1 } as any,
    { updateUser: async () => ({}) } as any,
  );
  return { service, saved };
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    areas_of_expertise: [],
    skills: [{ skill_id: 'skill-1', proficiency: 3 }],
    project_availability: 12,
    notes: 'Some notes',
    team_id: 'team-1',
    manager_user_id: 'user-2',
    manager_source: 'manual',
    employment_type_id: 'type-1',
    default_source_id: 'src-1',
    default_category_id: null,
    default_stream_id: null,
    default_company_id: null,
    ...overrides,
  };
}

async function testPartialPatchKeepsOtherFields() {
  const { service, saved } = createService(baseRecord());
  await service.update('cfg-1', { project_availability: 8 }, 'user-1');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].project_availability, 8);
  assert.equal(saved[0].notes, 'Some notes');
  assert.equal(saved[0].team_id, 'team-1');
  assert.deepEqual(saved[0].skills, [{ skill_id: 'skill-1', proficiency: 3 }]);
  assert.equal(saved[0].default_source_id, 'src-1');
  // A type that was deactivated after being assigned survives unrelated patches.
  assert.equal(saved[0].manager_user_id, 'user-2');
  assert.equal(saved[0].manager_source, 'manual');
  assert.equal(saved[0].employment_type_id, 'type-1');
}

async function testClearsPersistAsNull() {
  const { service, saved } = createService(baseRecord());
  await service.update('cfg-1', { notes: '', team_id: null }, 'user-1');
  assert.equal(saved[0].notes, null);
  assert.equal(saved[0].team_id, null);
  // An explicit null for notes clears as well.
  await service.update('cfg-1', { notes: null }, 'user-1');
  assert.equal(saved[1].notes, null);
}

async function testZeroAvailabilityPersists() {
  const { service, saved } = createService(baseRecord());
  await service.update('cfg-1', { project_availability: 0 }, 'user-1');
  assert.equal(saved[0].project_availability, 0);
}

async function testUndefinedFieldsAreNotTouched() {
  const { service, saved } = createService(baseRecord());
  await service.update('cfg-1', { notes: undefined, team_id: undefined, skills: [] }, 'user-1');
  assert.equal(saved[0].notes, 'Some notes');
  assert.equal(saved[0].team_id, 'team-1');
  assert.deepEqual(saved[0].skills, []);
}

async function testManagerWriteStampsManualSource() {
  const { service, saved } = createService(
    baseRecord({ manager_user_id: null, manager_source: null }),
    { users: ['user-3'] },
  );
  await service.update('cfg-1', { manager_user_id: 'user-3' }, 'user-1');
  assert.equal(saved[0].manager_user_id, 'user-3');
  assert.equal(saved[0].manager_source, 'manual');
}

async function testManagerClearAlsoClearsSource() {
  const { service, saved } = createService(baseRecord());
  await service.update('cfg-1', { manager_user_id: null }, 'user-1');
  assert.equal(saved[0].manager_user_id, null);
  assert.equal(saved[0].manager_source, null);
}

async function testManagerSourceInBodyIsIgnored() {
  const { service, saved } = createService(
    baseRecord({ manager_user_id: null, manager_source: null }),
    { users: ['user-3'] },
  );
  // A crafted body cannot promote a manual manager to an Entra-locked one.
  await service.update(
    'cfg-1',
    { manager_user_id: 'user-3', manager_source: 'entra' } as any,
    'user-1',
  );
  assert.equal(saved[0].manager_source, 'manual');
}

async function testSelfManagementRefused() {
  const { service, saved } = createService(baseRecord(), { users: ['user-1'] });
  await assert.rejects(
    () => service.update('cfg-1', { manager_user_id: 'user-1' }, 'user-1'),
    /own manager/,
  );
  assert.equal(saved.length, 0);
}

async function testUnknownManagerRefused() {
  const { service } = createService(baseRecord(), { users: ['user-3'] });
  await assert.rejects(
    () => service.update('cfg-1', { manager_user_id: 'user-9' }, 'user-1'),
    /Manager not found/,
  );
}

async function testManagerCycleRefused() {
  // user-3 -> user-4 -> user-1: making user-3 the manager of user-1 closes a loop.
  const { service, saved } = createService(baseRecord({ manager_user_id: null, manager_source: null }), {
    users: ['user-3'],
    chain: [
      { user_id: 'user-3', manager_user_id: 'user-4' },
      { user_id: 'user-4', manager_user_id: 'user-1' },
    ],
  });
  await assert.rejects(
    () => service.update('cfg-1', { manager_user_id: 'user-3' }, 'user-1'),
    /already reports to/,
  );
  assert.equal(saved.length, 0);
}

async function testManagerChainWithoutCycleIsAccepted() {
  const { service, saved } = createService(baseRecord({ manager_user_id: null, manager_source: null }), {
    users: ['user-3'],
    chain: [{ user_id: 'user-3', manager_user_id: 'user-4' }],
  });
  await service.update('cfg-1', { manager_user_id: 'user-3' }, 'user-1');
  assert.equal(saved[0].manager_user_id, 'user-3');
}

async function testEntraManagerIsReadOnly() {
  const { service, saved } = createService(
    baseRecord({ manager_user_id: 'user-2', manager_source: 'entra' }),
    { users: ['user-3'] },
  );
  await assert.rejects(
    () => service.update('cfg-1', { manager_user_id: 'user-3' }, 'user-1'),
    /Microsoft Entra/,
  );
  assert.equal(saved.length, 0);
}

async function testOrphanedEntraManagerIsWritable() {
  // The user was deleted, the foreign key nulled the column, the source stayed.
  const { service, saved } = createService(
    baseRecord({ manager_user_id: null, manager_source: 'entra' }),
    { users: ['user-3'] },
  );
  await service.update('cfg-1', { manager_user_id: 'user-3' }, 'user-1');
  assert.equal(saved[0].manager_user_id, 'user-3');
  assert.equal(saved[0].manager_source, 'manual');
}

async function testInactiveOrUnknownEmploymentTypeRefused() {
  const { service, saved } = createService(baseRecord(), { employmentTypes: ['type-2'] });
  await assert.rejects(
    () => service.update('cfg-1', { employment_type_id: 'type-9' }, 'user-1'),
    /Contract type not found/,
  );
  assert.equal(saved.length, 0);
}

async function testEmploymentTypeWriteAndClear() {
  const { service, saved } = createService(baseRecord(), { employmentTypes: ['type-2'] });
  await service.update('cfg-1', { employment_type_id: 'type-2' }, 'user-1');
  assert.equal(saved[0].employment_type_id, 'type-2');
  await service.update('cfg-1', { employment_type_id: null }, 'user-1');
  assert.equal(saved[1].employment_type_id, null);
}

async function testCreateDefaultsToTheTenantsFirstType() {
  const { service, saved } = createService({}, { defaultType: 'type-internal', employmentTypes: ['type-2'] });
  await service.create({ user_id: 'user-7' }, 'tenant-1', 'user-1');
  assert.equal(saved[0].employment_type_id, 'type-internal');
  // An explicit choice wins over the default.
  await service.create({ user_id: 'user-8', employment_type_id: 'type-2' }, 'tenant-1', 'user-1');
  assert.equal(saved[1].employment_type_id, 'type-2');
}

// The self-service route may not assign a manager, an employment type or a
// manager source: those are decided by whoever manages the team.
async function testSelfServiceRouteDropsManagedFields() {
  let forwarded: any = null;
  const controller = new TeamMemberConfigController(
    {
      upsertMe: async (_userId: string, body: any) => {
        forwarded = body;
        return {};
      },
    } as any,
    { listForRoles: async () => new Map() } as any,
    {} as any,
    {} as any,
  );

  await controller.updateMe(
    {
      notes: 'mine',
      manager_user_id: 'user-3',
      employment_type_id: 'type-2',
      manager_source: 'entra',
      team_id: 'team-9',
    },
    { tenant: { id: 'tenant-1' }, user: { id: 'user-1' } },
  );

  assert.equal(forwarded.notes, 'mine');
  assert.equal('manager_user_id' in forwarded, false);
  assert.equal('employment_type_id' in forwarded, false);
  assert.equal('manager_source' in forwarded, false);
  assert.equal('team_id' in forwarded, false);
}

// The job title is a `users` column a person may always change on themselves,
// so unlike the managed fields above it must reach the service. It travels
// through an explicit allow-list, where an omission is silent.
async function testSelfServiceRouteCarriesTheJobTitle() {
  let forwarded: any = null;
  let forwardedOpts: any = null;
  const controller = new TeamMemberConfigController(
    {
      upsertMe: async (_userId: string, body: any, _tenantId: string, _actor: any, opts: any) => {
        forwarded = body;
        forwardedOpts = opts;
        return {};
      },
    } as any,
    { listForRoles: async () => new Map() } as any,
    {} as any,
    {} as any,
  );

  await controller.updateMe(
    { job_title: 'Cheese buyer' },
    { tenant: { id: 'tenant-1' }, user: { sub: 'user-1' } },
  );

  assert.equal(forwarded.job_title, 'Cheese buyer');
  // Never a null actor: that is read as an internal update and opens every
  // admin field of `users` with no access check at all.
  assert.deepEqual(forwardedOpts.profileActor, { actorUserId: 'user-1', canManageUsers: false });
}

async function run() {
  await testPartialPatchKeepsOtherFields();
  await testClearsPersistAsNull();
  await testZeroAvailabilityPersists();
  await testUndefinedFieldsAreNotTouched();
  await testManagerWriteStampsManualSource();
  await testManagerClearAlsoClearsSource();
  await testManagerSourceInBodyIsIgnored();
  await testSelfManagementRefused();
  await testUnknownManagerRefused();
  await testManagerCycleRefused();
  await testManagerChainWithoutCycleIsAccepted();
  await testEntraManagerIsReadOnly();
  await testOrphanedEntraManagerIsWritable();
  await testInactiveOrUnknownEmploymentTypeRefused();
  await testEmploymentTypeWriteAndClear();
  await testCreateDefaultsToTheTenantsFirstType();
  await testSelfServiceRouteDropsManagedFields();
  await testSelfServiceRouteCarriesTheJobTitle();
}

void run();
