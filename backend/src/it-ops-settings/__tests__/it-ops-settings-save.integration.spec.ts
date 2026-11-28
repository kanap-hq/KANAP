import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { Tenant } from '../../tenants/tenant.entity';
import { Location } from '../../locations/location.entity';
import { CLASSIFICATION_CATALOG_KEYS } from '../classification-catalog';
import { ItOpsSettings, ItOpsSettingsService } from '../it-ops-settings.service';

const LOCKED_FIRST: Record<string, number> = { lifecycleStates: 4, domains: 2 };

/**
 * A save that carries a classification catalog with other lists keeps every list it carries, and a
 * save of one list stores the order it was sent in (no server sort). One connection, rows of the
 * spec's own workspace only, removed at the end.
 */
async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  const locationId = randomUUID();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  const settings = new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), { log: async () => undefined } as any);
  const read = () => settings.getSettings(tenantId, { manager: runner.manager });
  const save = (patch: Partial<ItOpsSettings>) => settings.updateSettings(tenantId, patch, { manager: runner.manager });
  try {
    await runner.query(`INSERT INTO tenants(id, slug, name, metadata) VALUES ($1, $2, 'Settings save test', '{}'::jsonb)`, [tenantId, `settings-save-${tenantId}`]);
    await runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
    await runner.query(`INSERT INTO locations(id, tenant_id, name, hosting_type, location_reference) VALUES ($1, $2, 'Site', 'on_prem', 'LOC-S')`, [locationId, tenantId]);

    // Every list sent with a catalog is saved, not only the administration zones.
    const before = await read();
    const lists = Object.keys(ItOpsSettingsService.LIST_META).filter((key) => key !== 'subnets' && !(CLASSIFICATION_CATALOG_KEYS as readonly string[]).includes(key));
    const combined: Record<string, unknown> = {};
    for (const key of lists) combined[key] = [...((before as any)[key] as any[]), { label: `Added to ${key}` }, { label: `Second for ${key}` }];
    combined.businessCriticalityLevels = [...before.businessCriticalityLevels].reverse();
    const saved = await save(combined as Partial<ItOpsSettings>);
    const stored = await read();
    for (const key of lists) {
      for (const state of [saved, stored]) {
        assert.ok(((state as any)[key] as any[]).some((row) => row.label === `Added to ${key}`), `${key}: the value sent with a catalog is saved`);
      }
    }
    assert.deepEqual(stored.businessCriticalityLevels.map((row) => row.code), before.businessCriticalityLevels.map((row) => row.code).reverse(), 'the catalog of the same save is saved');

    // One save per list stores the order sent: the list reversed comes back reversed
    // (the locked statuses and the system domains stay first).
    await save({ subnets: [{ location_id: locationId, cidr: '10.9.1.0/24', network_zone: 'lan' }, { location_id: locationId, cidr: '10.9.2.0/24', network_zone: 'dmz' }] as any });
    const start = await read();
    for (const key of Object.keys(ItOpsSettingsService.LIST_META)) {
      const rows = ((start as any)[key] as any[]);
      const locked = LOCKED_FIRST[key] ?? 0;
      const sent = [...rows.slice(0, locked), ...rows.slice(locked).reverse()];
      const after = await save({ [key]: sent } as Partial<ItOpsSettings>);
      const identity = (row: any) => key === 'subnets' ? `${row.location_id}:${row.cidr}` : row.code;
      assert.ok(rows.length - locked >= 2, `${key}: at least two values to reorder`);
      assert.deepEqual(((after as any)[key] as any[]).map(identity), sent.map(identity), `${key}: the order sent is the order saved`);
      assert.deepEqual(((await read() as any)[key] as any[]).map(identity), sent.map(identity), `${key}: the order sent is the order read`);
    }
    console.log('PASS: a combined save keeps every list it carries; each list keeps the order it was sent in');
  } finally {
    await runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]).catch(() => undefined);
    for (const sql of ['DELETE FROM locations WHERE tenant_id = $1', 'DELETE FROM audit_log WHERE tenant_id = $1', 'DELETE FROM tenants WHERE id = $1']) {
      await runner.query(sql, [tenantId]).catch(() => undefined);
    }
    await runner.release().catch(() => undefined);
    await dataSource.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
