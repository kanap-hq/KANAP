// @database-spec
import 'dotenv/config';
import { RecordInUseException } from '../../common/record-in-use';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  underSavepoint,
} from '../../spend/__tests__/round-inputs.fixtures';
import { Location } from '../location.entity';
import { LocationsService } from '../locations.service';

// Every asset has a location: a location that still holds assets refuses its delete
// (`LOCATION_IN_USE`, the assets counted) and leaves them where they are; one without assets
// deletes. The page reads the count from the detail (`usage_count`) before asking.

async function one(runner: any, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id;
}

runSpecs('location-delete-in-use', [
  ['a location with assets refuses its delete, with the assets counted, and keeps them', async () => {
    await inRolledBackTransaction(async (runner) => {
      const audit = captureAudit();
      const svc = new LocationsService(runner.manager.getRepository(Location), audit as any, undefined as any, undefined as any);
      const tenantId = await seedTenant(runner, 'location-in-use');
      const location = await one(runner, `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Paris DC', 'on_prem', 'LOC-1') RETURNING id`, [tenantId]);
      for (const name of ['srv-01', 'srv-02']) {
        await one(runner, `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, $2, 'server', 'prod', $3) RETURNING id`, [tenantId, name, location]);
      }

      const detail = await svc.get(location, { manager: runner.manager, tenantId });
      assert.equal(detail.usage_count, 2);

      const error = await underSavepoint(runner, () => svc.delete(location, null, { manager: runner.manager }).then(() => null, (err) => err));
      assert.ok(error instanceof RecordInUseException, `refused with a RecordInUseException, got ${error}`);
      const response = (error as RecordInUseException).getResponse() as Record<string, unknown>;
      assert.equal(response.statusCode, 409);
      assert.equal(response.code, 'LOCATION_IN_USE');
      assert.deepEqual(response.usages, [{ type: 'assets', total: 2 }]);
      assert.equal(response.message, 'Cannot delete location "Paris DC": it still holds 2 assets. Move them to another location first.');

      const [kept] = await runner.query(`SELECT count(*)::int AS n FROM locations WHERE tenant_id = $1 AND id = $2`, [tenantId, location]);
      assert.equal(kept.n, 1);
      const [held] = await runner.query(`SELECT count(*)::int AS n FROM assets WHERE tenant_id = $1 AND location_id = $2`, [tenantId, location]);
      assert.equal(held.n, 2);
      assert.equal(audit.entries.filter((entry: any) => entry.action === 'delete').length, 0);
    });
  }],
  ['the refusal words one asset in the singular', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = new LocationsService(runner.manager.getRepository(Location), captureAudit() as any, undefined as any, undefined as any);
      const tenantId = await seedTenant(runner, 'location-in-use-one');
      const location = await one(runner, `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Lyon DC', 'on_prem', 'LOC-1') RETURNING id`, [tenantId]);
      await one(runner, `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, 'srv-01', 'server', 'prod', $2) RETURNING id`, [tenantId, location]);
      const error = await underSavepoint(runner, () => svc.delete(location, null, { manager: runner.manager }).then(() => null, (err) => err));
      assert.ok(error instanceof RecordInUseException);
      assert.equal((error as RecordInUseException).message, 'Cannot delete location "Lyon DC": it still holds 1 asset. Move it to another location first.');
    });
  }],
  ['a location without assets deletes, with its sub-locations, and counts none on its detail', async () => {
    await inRolledBackTransaction(async (runner) => {
      const audit = captureAudit();
      const svc = new LocationsService(runner.manager.getRepository(Location), audit as any, undefined as any, undefined as any);
      const tenantId = await seedTenant(runner, 'location-empty');
      const location = await one(runner, `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Empty DC', 'on_prem', 'LOC-1') RETURNING id`, [tenantId]);
      const other = await one(runner, `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Other DC', 'on_prem', 'LOC-2') RETURNING id`, [tenantId]);
      await one(runner, `INSERT INTO location_sub_items (tenant_id, location_id, name) VALUES ($1, $2, 'Room A') RETURNING id`, [tenantId, location]);
      // An asset elsewhere does not hold this location.
      await one(runner, `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, 'srv-other', 'server', 'prod', $2) RETURNING id`, [tenantId, other]);

      const detail = await svc.get(location, { manager: runner.manager, tenantId });
      assert.equal(detail.usage_count, 0);

      assert.deepEqual(await svc.delete(location, null, { manager: runner.manager }), { ok: true });
      const [gone] = await runner.query(`SELECT count(*)::int AS n FROM locations WHERE tenant_id = $1 AND id = $2`, [tenantId, location]);
      assert.equal(gone.n, 0);
      const [subs] = await runner.query(`SELECT count(*)::int AS n FROM location_sub_items WHERE tenant_id = $1 AND location_id = $2`, [tenantId, location]);
      assert.equal(subs.n, 0);
      const [elsewhere] = await runner.query(`SELECT count(*)::int AS n FROM assets WHERE tenant_id = $1 AND location_id = $2`, [tenantId, other]);
      assert.equal(elsewhere.n, 1);
      assert.equal(audit.entries.filter((entry: any) => entry.action === 'delete' && entry.table === 'locations').length, 1);
    });
  }],
]);
