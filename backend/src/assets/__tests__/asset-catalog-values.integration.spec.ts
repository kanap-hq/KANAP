import { AssetsService } from '../services/assets.service';
import { assert, inP7Tenant, refusedAsRetired, retiredCode, runP7Specs, type P7Harness } from '../../it-ops-settings/__tests__/catalog-p7.fixtures';

// Lot K2c of 26.12.1: rule P7 (maintainer, 2026-11-23) on an asset's catalog values: type, provider,
// domain, administration zone, lifecycle, IP address type. A retired value is refused on an asset
// that does not hold it, at the creation and at the update, and kept on the asset that holds it.
// @database-spec: boots the app context through catalog-p7.fixtures, so run-ci-tests.js runs this file on a database lane.

const FIELDS: Array<[string, Parameters<typeof retiredCode>[0]]> = [
  ['kind', 'serverKinds'], ['provider', 'serverProviders'], ['domain', 'domains'], ['admin_zone', 'adminZones'], ['status', 'lifecycleStates'],
];

async function testRetiredValues(harness: P7Harness) {
  const assets = harness.get<AssetsService>(AssetsService);
  await inP7Tenant(harness, async ({ tenantId, locationId, runner }) => {
    const opts = { manager: runner.manager, tenantId };
    const base = { kind: 'physical_server', provider: 'other', environment: 'prod', location_id: locationId };
    for (const [field, list] of FIELDS) {
      await refusedAsRetired(() => assets.create({ ...base, name: `new-${field}`, [field]: retiredCode(list) } as any, tenantId, null, opts), `create ${field}`);
    }
    const other = await assets.create({ ...base, name: 'other' } as any, tenantId, null, opts);
    for (const [field, list] of FIELDS) {
      await refusedAsRetired(() => assets.update(other.id, { [field]: retiredCode(list) } as any, tenantId, null, opts), `update ${field}`);
    }
    await refusedAsRetired(
      () => assets.update(other.id, { ip_addresses: [{ type: retiredCode('ipAddressTypes'), ip: '10.0.0.9' }] } as any, tenantId, null, opts),
      'update an IP address type',
    );

    // The asset that holds them keeps them: each field saved with its own value, and another change.
    const holder = await assets.create({ ...base, name: 'holder' } as any, tenantId, null, opts);
    await runner.query(
      `UPDATE assets SET kind = $3, provider = $4, domain = $5, admin_zone = $6, status = $7, ip_addresses = $8::jsonb WHERE tenant_id = $1 AND id = $2`,
      [tenantId, holder.id, retiredCode('serverKinds'), retiredCode('serverProviders'), retiredCode('domains'), retiredCode('adminZones'),
        retiredCode('lifecycleStates'), JSON.stringify([{ type: retiredCode('ipAddressTypes'), ip: '10.0.0.10', subnet_cidr: null }])],
    );
    await assets.update(holder.id, {
      name: 'holder 2',
      hostname: 'holder',
      ...Object.fromEntries(FIELDS.map(([field, list]) => [field, retiredCode(list)])),
      ip_addresses: [{ type: retiredCode('ipAddressTypes'), ip: '10.0.0.10' }],
    } as any, tenantId, null, opts);
    const [row] = await runner.query(`SELECT name, kind, provider, domain, admin_zone, status, ip_addresses FROM assets WHERE id = $1`, [holder.id]);
    assert.deepEqual(
      [row.name, row.kind, row.provider, row.domain, row.admin_zone, row.status, row.ip_addresses[0].type],
      ['holder 2', ...FIELDS.map(([, list]) => retiredCode(list)), retiredCode('ipAddressTypes')],
    );
    // An unknown value is refused with the values allowed.
    await assert.rejects(() => assets.update(other.id, { kind: 'mainframe_x' } as any, tenantId, null, opts), /Unknown asset type "mainframe_x"\. Use one of: .*physical_server/);
  });
}

runP7Specs('asset-catalog-values.integration.spec.ts', [['retired values', testRetiredValues]]).catch((error) => {
  console.error(error);
  process.exit(1);
});
