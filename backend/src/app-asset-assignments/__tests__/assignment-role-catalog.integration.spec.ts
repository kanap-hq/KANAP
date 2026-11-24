import { AppAssetAssignmentsService } from '../app-asset-assignments.service';
import { assert, inP7Tenant, refusedAsRetired, retiredCode, runP7Specs, type P7Harness } from '../../it-ops-settings/__tests__/catalog-p7.fixtures';

// Lot K2c of 26.12.1, second pass: rule P7 (maintainer, 2026-11-23) on the role of a server
// assignment. A retired role is refused on a new assignment and on one that does not hold it, and
// kept on the assignment that holds it; an unknown role is refused with the roles allowed.
// @database-spec: boots the app context through catalog-p7.fixtures, so run-ci-tests.js runs this file on a database lane.

async function testRetiredRole(harness: P7Harness) {
  const assignments = harness.get<AppAssetAssignmentsService>(AppAssetAssignmentsService);
  await inP7Tenant(harness, async ({ tenantId, locationId, runner }) => {
    const opts = { manager: runner.manager, tenantId };
    const one = async (sql: string, params: unknown[]) => String((await runner.query(sql, params))[0].id);
    const appId = await one(`INSERT INTO applications (tenant_id, name, status, lifecycle) VALUES ($1, 'Roles app', 'enabled', 'active') RETURNING id`, [tenantId]);
    const instanceId = await one(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, appId]);
    const asset = (name: string) => one(`INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, $2, 'virtual_machine', 'prod', $3) RETURNING id`, [tenantId, name, locationId]);
    const first = await asset('srv-one');
    const second = await asset('srv-two');
    const retired = retiredCode('serverRoles');

    await refusedAsRetired(() => assignments.create(instanceId, { asset_id: first, role: retired }, null, opts), 'a new assignment');
    const other = await assignments.create(instanceId, { asset_id: first, role: 'app' }, null, opts);
    await refusedAsRetired(() => assignments.update(instanceId, other.id, { role: retired }, null, opts), 'an assignment that does not hold it');
    // By its name, case aside, as the list shows it.
    const byName = await assignments.create(instanceId, { asset_id: second, role: 'backup server' }, null, opts);
    assert.equal(byName.role, 'backup');

    // The assignment that holds it keeps it: saved with its role and new notes.
    const [{ id: holder }] = await runner.query(
      `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, instanceId, second, retired]);
    const kept = await assignments.update(instanceId, holder, { role: retired, notes: 'kept' }, null, opts);
    assert.deepEqual([kept.role, kept.notes], [retired, 'kept']);

    let unknown: any = null;
    try {
      await assignments.create(instanceId, { asset_id: first, role: 'mainframe' }, null, opts);
    } catch (error) {
      unknown = error;
    }
    assert.equal(unknown?.getResponse?.().code, 'assignment_role_invalid');
    assert.match(String(unknown?.getResponse?.().params?.allowed), /app \(Application server\)/);
    assert.doesNotMatch(String(unknown?.getResponse?.().params?.allowed), new RegExp(retired), 'the roles allowed leave the retired one out');
  });
}

runP7Specs('assignment-role-catalog.integration.spec.ts', [['retired role', testRetiredRole]]).catch((error) => {
  console.error(error);
  process.exit(1);
});
