import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsListService } from '../services/assets-list.service';

// The reference sorts by its number. Dates and the network zone sort on their own value.
// Type, hosting and administration zone sort by the label the screen shows: the shipped
// translation in the requested language while the tenant keeps the shipped source, otherwise
// the tenant's own label. With no language they sort by the stored label, not by the code.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const settings = {
  serverKinds: [
    { code: 'z_kind', label: 'Alpha kind' },
    { code: 'a_kind', label: 'Zulu kind' },
  ],
  hostingTypes: [
    { code: 'z_host', label: 'Alpha host' },
    { code: 'a_host', label: 'Zulu host' },
  ],
  adminZones: [
    { code: 'z_zone', label: 'Alpha zone' },
    { code: 'a_zone', label: 'Zulu zone' },
  ],
};

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-list-sort');
      const itOps = { getSettings: async () => settings } as any;
      const list = new AssetsListService(runner.manager.getRepository(Asset), itOps);
      const opts = { manager: runner.manager, tenantId };
      const lateLocation = randomUUID();
      const earlyLocation = randomUUID();
      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES
         ($1, $3, 'LOC-L', 'Late site', 'a_host'),
         ($2, $3, 'LOC-E', 'Early site', 'z_host')`,
        [lateLocation, earlyLocation, tenantId],
      );
      const updated = await runner.query(
        `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('it_ops', jsonb_build_object('subnets', $2::jsonb)) WHERE id = $1 RETURNING metadata->'it_ops'->'subnets' AS subnets`,
        [tenantId, JSON.stringify([
          { location_id: lateLocation, cidr: '10.1.0.0/24', network_zone: 'Zulu net' },
          { location_id: earlyLocation, cidr: '10.1.0.0/24', network_zone: 'Alpha net' },
          { location_id: lateLocation, cidr: '10.2.0.0/24', network_zone: 'Zulu net' },
        ])],
      );
      const insert = async (name: string, locationId: string, kind: string, zone: string, cidr: string, goLive: string, endOfLife: string) => {
        const [row] = await runner.query(
          `INSERT INTO assets (
             tenant_id, name, kind, provider, environment, status, admin_zone, location_id,
             go_live_date, end_of_life_date, ip_addresses
           ) VALUES ($1, $2, $3, 'other', 'prod', 'active', $4, $5, $6, $7, $8::jsonb)
           RETURNING id`,
          [tenantId, name, kind, zone, locationId, goLive, endOfLife, JSON.stringify([{ type: 'host', ip: '10.0.0.1', subnet_cidr: cidr }])],
        );
        return row.id as string;
      };
      // Inserted first, so a sort that ignores the column keeps this row ahead.
      const lateId = await insert('Late', lateLocation, 'a_kind', 'a_zone', '10.2.0.0/24', '2024-06-01', '2025-01-01');
      const earlyId = await insert('Early', earlyLocation, 'z_kind', 'z_zone', '10.1.0.0/24', '2020-01-01', '2021-01-01');
      // now() is the transaction's start for every row: distinct creation dates make the order of
      // a sort that ignores the column certain, rather than left to the random ids.
      await runner.query(`UPDATE assets SET asset_reference = 'AST-10', created_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [lateId]);
      await runner.query(`UPDATE assets SET asset_reference = 'AST-2', created_at = '2026-01-02T00:00:00Z' WHERE id = $1`, [earlyId]);

      assert.equal(updated[1], 1, 'the subnet catalog is stored on the tenant');
      const names = async (sort: string) => {
        const page = await list.list({ sort, limit: 10 }, opts);
        return page.items.map((row: { name: string }) => row.name);
      };
      for (const field of ['asset_reference', 'kind', 'hosting_type', 'admin_zone', 'go_live_date', 'end_of_life_date', 'network_segment']) {
        assert.deepEqual(await names(`${field}:ASC`), ['Early', 'Late'], field);
      }
      assert.deepEqual(await names('asset_reference:DESC'), ['Late', 'Early']);
      const ids = await list.listIds({ sort: 'asset_reference:ASC', limit: 10 }, opts);
      assert.deepEqual(ids.ids, [earlyId, lateId]);

      // The quick search matches the site name and the operating system, and stays inside the tenant.
      const techRows = await runner.query(
        `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 1, 'Debian', 'operating_system') RETURNING id`,
        [tenantId],
      );
      const versionRows = await runner.query(
        `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '12') RETURNING id`,
        [tenantId, techRows[0].id],
      );
      await runner.query(
        `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, source, is_operating_system)
         VALUES ($1, $2, $3, $4, 'manual', true)`,
        [tenantId, earlyId, techRows[0].id, versionRows[0].id],
      );
      const tenantB = await seedTenant(runner, 'asset-list-sort-b');
      const [otherSite] = await runner.query(
        `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-B', 'Early site', 'on_prem') RETURNING id`,
        [tenantB],
      );
      await runner.query(
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, location_id)
         VALUES ($1, 'Other', 'vm', 'other', 'prod', 'active', $2)`,
        [tenantB, otherSite.id],
      );
      // seedTenant of the other tenant switched the session tenant. The list reads the first one.
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const found = async (q: string) => {
        const page = await list.list({ q, sort: 'name:ASC', limit: 10 }, opts);
        return page.items.map((row: { name: string }) => row.name);
      };
      assert.deepEqual(await found('Early site'), ['Early']);
      assert.deepEqual(await found('Debian 12'), ['Early']);
      assert.deepEqual(await found('NopeOS'), []);
    });

    // French reverses the shipped pairs (Pare-feu before Point d'accès, Cloud public before
    // Sur site, Tier 2 postes before a tenant label that sits between that text and the
    // stored English). A renamed shipped value keeps the tenant label.
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-list-sort-lang');
      const shipped = {
        serverKinds: [
          { code: 'access_point', label: 'Access Point' },
          { code: 'firewall', label: 'Firewall' },
        ],
        hostingTypes: [
          { code: 'on_prem', label: 'On-prem' },
          { code: 'public_cloud', label: 'Public Cloud' },
        ],
        adminZones: [
          { code: 'tier_2', label: 'Tier 2 (workstations)' },
          { code: 'z_zone', label: 'Tier 2 (serveurs)' },
        ],
      };
      const list = new AssetsListService(runner.manager.getRepository(Asset), { getSettings: async () => shipped } as any);
      const opts = { manager: runner.manager, tenantId };
      const fr = { ...opts, language: 'fr' as const };
      const cloud = randomUUID();
      const site = randomUUID();
      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES
         ($1, $3, 'LOC-C', 'Cloud site', 'public_cloud'),
         ($2, $3, 'LOC-S', 'On prem site', 'on_prem')`,
        [cloud, site, tenantId],
      );
      const insert = async (name: string, locationId: string, kind: string, zone: string) => {
        const [row] = await runner.query(
          `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, admin_zone, location_id)
           VALUES ($1, $2, $3, 'other', 'prod', 'active', $4, $5) RETURNING id`,
          [tenantId, name, kind, zone, locationId],
        );
        return row.id as string;
      };
      const frenchFirst = await insert('FirstFr', cloud, 'firewall', 'tier_2');
      const englishFirst = await insert('FirstEn', site, 'access_point', 'z_zone');
      const names = async (sort: string, callOpts: typeof opts | typeof fr) => {
        const page = await list.list({ sort, limit: 10 }, callOpts);
        return page.items.map((row: { name: string }) => row.name);
      };
      for (const field of ['kind', 'hosting_type', 'admin_zone']) {
        assert.deepEqual(await names(`${field}:ASC`, opts), ['FirstEn', 'FirstFr'], `${field} stored`);
        assert.deepEqual(await names(`${field}:ASC`, fr), ['FirstFr', 'FirstEn'], `${field} fr`);
      }
      const ids = await list.listIds({ sort: 'kind:ASC', limit: 10 }, fr);
      assert.deepEqual(ids.ids, [frenchFirst, englishFirst]);

      const renamed = {
        serverKinds: [
          { code: 'access_point', label: 'Access Point' },
          { code: 'firewall', label: 'Zzz mur' },
        ],
        hostingTypes: shipped.hostingTypes,
        adminZones: shipped.adminZones,
      };
      const renamedList = new AssetsListService(runner.manager.getRepository(Asset), { getSettings: async () => renamed } as any);
      const renamedNames = async (sort: string) => {
        const page = await renamedList.list({ sort, limit: 10 }, fr);
        return page.items.map((row: { name: string }) => row.name);
      };
      // "Zzz mur" is not the shipped source, so French keeps it after "Point d'accès".
      assert.deepEqual(await renamedNames('kind:ASC'), ['FirstEn', 'FirstFr']);
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset list sort integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
