// @database-spec
import 'dotenv/config';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';
import { Location } from '../location.entity';
import { LocationsService } from '../locations.service';

// The reference of a location (`LOC-n`) is given by a database trigger. The create answers with
// the stored location, reference included: the page opens the new site at its reference, and the
// audit entry of the creation names it.

const settings = {
  getSettingsForWrite: async () => ({
    hostingTypes: [{ code: 'on_prem', category: 'on_prem' }, { code: 'public_cloud', category: 'cloud' }],
    serverProviders: [],
  }),
};

runSpecs('location-create-reference', [
  ['the create answers with the reference the database gave, and the audit entry has it', async () => {
    await inRolledBackTransaction(async (runner) => {
      const audit = captureAudit();
      const svc = new LocationsService(runner.manager.getRepository(Location), audit as any, settings as any, undefined as any);
      const tenantId = await seedTenant(runner, 'location-create-reference');

      const first = await svc.create({ name: 'Lorient DC', hosting_type: 'on_prem', city: 'Lorient' }, tenantId, null, { manager: runner.manager });
      assert.equal(first.location_reference, 'LOC-1');
      assert.equal(first.name, 'Lorient DC');
      assert.equal(first.city, 'Lorient');
      const second = await svc.create({ name: 'Brest DC', hosting_type: 'public_cloud' }, tenantId, null, { manager: runner.manager });
      assert.equal(second.location_reference, 'LOC-2');

      const [stored] = await runner.query(`SELECT location_reference FROM locations WHERE tenant_id = $1 AND id = $2`, [tenantId, first.id]);
      assert.equal(stored.location_reference, first.location_reference);

      const created = audit.entries.filter((entry: any) => entry.table === 'locations' && entry.action === 'create');
      assert.equal(created.length, 2);
      assert.equal(created[0].recordId, first.id);
      assert.equal(created[0].after.location_reference, 'LOC-1');
    });
  }],
]);
