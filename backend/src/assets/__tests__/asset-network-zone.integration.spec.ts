import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsListService } from '../services/assets-list.service';

// The network zone column and its filter read the subnet's zone (IT settings), matched to the
// asset's site. The IP row has no zone of its own. The same CIDR on another site does not leak.
// CIDRs compare without case (an IPv6 subnet typed in capitals still matches).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-network-zone');
      const list = new AssetsListService(runner.manager.getRepository(Asset));
      const opts = { manager: runner.manager, tenantId };
      const paris = randomUUID();
      const lyon = randomUUID();
      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES
         ($1, $3, 'LOC-P', 'Paris', 'on_prem'),
         ($2, $3, 'LOC-L', 'Lyon', 'on_prem')`,
        [paris, lyon, tenantId],
      );
      await runner.query(
        `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('it_ops', jsonb_build_object('subnets', $2::jsonb)) WHERE id = $1`,
        [tenantId, JSON.stringify([
          { location_id: lyon, cidr: '10.1.0.0/24', network_zone: 'Lyon only' },
          { location_id: paris, cidr: '10.1.0.0/24', network_zone: 'Paris lan' },
          { location_id: '', cidr: '10.9.0.0/24', network_zone: 'Legacy' },
          { location_id: paris, cidr: 'FD00:1::/64', network_zone: 'V6 lan' },
        ])],
      );
      const insert = (name: string, locationId: string, cidr: string | null) => runner.query(
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, location_id, ip_addresses)
         VALUES ($1, $2, 'vm', 'other', 'prod', 'active', $3, $4::jsonb)`,
        [tenantId, name, locationId, JSON.stringify([{ type: 'host', ip: '10.0.0.1', subnet_cidr: cidr }])],
      );
      await insert('Paris', paris, '10.1.0.0/24');
      await insert('Lyon', lyon, '10.1.0.0/24');
      await insert('Legacy', paris, '10.9.0.0/24');
      await insert('Bare', paris, null);
      await insert('Six', paris, 'fd00:1::/64');

      const page = await list.list({ sort: 'name:ASC', limit: 20 }, opts);
      const zone = Object.fromEntries(page.items.map((row: { name: string; network_segment: string | null }) => [row.name, row.network_segment]));
      assert.deepEqual(zone, { Bare: null, Legacy: 'Legacy', Lyon: 'Lyon only', Paris: 'Paris lan', Six: 'V6 lan' });

      const filtered = await list.list({
        filters: JSON.stringify({ network_segment: { filterType: 'set', values: ['Paris lan'] } }),
        sort: 'name:ASC',
        limit: 20,
      }, opts);
      assert.deepEqual(filtered.items.map((row: { name: string }) => row.name), ['Paris']);

      const values = await list.listFilterValues({ fields: 'network_segment' }, opts);
      assert.deepEqual(values.network_segment, ['Legacy', 'Lyon only', 'Paris lan', 'V6 lan', null]);

      const sorted = await list.listIds({ sort: 'network_segment:DESC' }, opts);
      assert.deepEqual(sorted.ids.length, 5);
      const pastEnd = await list.list({
        filters: JSON.stringify({ network_segment: { filterType: 'set', values: ['Paris lan', 'V6 lan'] } }),
        sort: 'kind:ASC',
        page: 9,
        limit: 20,
      }, opts);
      assert.deepEqual({ items: pastEnd.items.length, total: pastEnd.total }, { items: 0, total: 2 });
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset network zone integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
