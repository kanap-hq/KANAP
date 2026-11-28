import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { Tenant } from '../../tenants/tenant.entity';
import { Location } from '../../locations/location.entity';
import { ItOpsSettings, ItOpsSettingsService } from '../it-ops-settings.service';

/**
 * The alias rule of a save (a name, a code or a translated name designates one value) holds on the
 * list as it will be stored: the protected values the server adds back and the locked rows it puts
 * first count. A save that would store two values answering to the same name is refused, nothing
 * stored. A list already stored with such a pair is refused as it is read, and saves once one of
 * the two is renamed; the restore of the default lists does not run the rule. One connection, rows
 * of the spec's own workspace only, removed at the end.
 */
async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  const settings = new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), { log: async () => undefined } as any);
  const read = () => settings.getSettings(tenantId, { manager: runner.manager });
  const save = (patch: Partial<ItOpsSettings>) => settings.updateSettings(tenantId, patch, { manager: runner.manager });
  const refused = async (patch: Partial<ItOpsSettings>, name: RegExp, what: string) => {
    const before = JSON.stringify(await read());
    await assert.rejects(save(patch), (error: unknown) => error instanceof BadRequestException && name.test(error.message), what);
    assert.equal(JSON.stringify(await read()), before, `${what}: nothing is stored`);
  };
  const without = (rows: any[], code: string) => rows.filter((row) => row.code !== code);
  try {
    await runner.query(`INSERT INTO tenants(id, slug, name, metadata) VALUES ($1, $2, 'Stored aliases test', '{}'::jsonb)`, [tenantId, `stored-aliases-${tenantId}`]);
    await runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
    const start = await read();

    // A protected value left out of the save comes back: a new value with its name clashes with it.
    await refused({ serverKinds: [...without(start.serverKinds, 'virtual_machine'), { code: 'vm', label: 'Virtual Machine' }] as any }, /"Virtual Machine" clashes with "Virtual Machine", a value Kadratis always keeps/, 'asset type named as the protected virtual machine');
    await refused({ networkSegments: [...without(start.networkSegments, 'lan'), { code: 'office', label: 'LAN' }] }, /"LAN" clashes with "LAN", a value Kadratis always keeps/, 'network zone named as the protected LAN');
    await refused({ serverProviders: [...without(start.serverProviders, 'other'), { code: 'misc', label: 'Other' }] }, /"Other" clashes with "Other", a value Kadratis always keeps/, 'cloud provider named as the protected Other');
    // The locked statuses and system domains are put back by the server, whatever the save sends for them.
    await refused({ lifecycleStates: [...start.lifecycleStates, { code: 'live', label: 'Active' }] }, /"Active" clashes with "Active", a value Kadratis always keeps/, 'status named as the locked Active');
    await refused({ lifecycleStates: [...start.lifecycleStates, { code: 'running', label: 'Running', translations: { fr: { label: 'active' } } }] }, /"Running" clashes with "Active", a value Kadratis always keeps/, 'status translated as the locked Active');
    await refused({ domains: [...start.domains, { code: 'wg', label: 'Workgroup', dns_suffix: 'wg.example' }] as any }, /"Workgroup" clashes with "Workgroup", a value Kadratis always keeps/, 'domain named as the system Workgroup');

    // Every list read saves as it is.
    for (const key of Object.keys(ItOpsSettingsService.LIST_META)) await save({ [key]: (start as any)[key] } as Partial<ItOpsSettings>);

    // A list stored with a pair (written before the rule): refused as read, saved once one is renamed.
    const meta = { it_ops: { server_kinds: [...start.serverKinds, { code: 'vm', label: 'Virtual Machine', is_physical: false }] } };
    await runner.query(`UPDATE tenants SET metadata = $2::jsonb WHERE id = $1`, [tenantId, JSON.stringify(meta)]);
    const stored = await read();
    assert.equal(stored.serverKinds.filter((row) => row.label === 'Virtual Machine').length, 2, 'the pair is read as stored');
    await refused({ serverKinds: stored.serverKinds }, /"Virtual Machine" clashes with "Virtual Machine" \(/, 'the stored pair saved as read');
    // Two values of the person's own: the message names them only.
    await refused({ accessMethods: [...start.accessMethods, { code: 'kiosk_a', label: 'Booth' }, { code: 'kiosk_b', label: 'Booth' }] }, /"Booth" clashes with "Booth" \(/, 'two added values with one name');
    const renamed = await save({ serverKinds: stored.serverKinds.map((row) => (row.code === 'vm' ? { ...row, label: 'Virtual machine (legacy)' } : row)) });
    assert.deepEqual(renamed.serverKinds.filter((row) => /^Virtual/.test(row.label)).map((row) => row.label), ['Virtual Machine', 'Virtual machine (legacy)'], 'renaming one of the pair saves');

    // The restore copies stored data as it is: it is not refused by the rule.
    await runner.query(`UPDATE tenants SET metadata = $2::jsonb WHERE id = $1`, [tenantId, JSON.stringify(meta)]);
    const restored = await settings.resetToDefaults(tenantId, { manager: runner.manager });
    assert.ok(restored.serverKinds.some((row) => row.code === 'virtual_machine'), 'the restore succeeds on a stored pair');
    console.log('PASS: a save is refused when the list as stored would hold two values with one name; the restore is not');
  } finally {
    await runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]).catch(() => undefined);
    for (const sql of ['DELETE FROM audit_log WHERE tenant_id = $1', 'DELETE FROM tenants WHERE id = $1']) {
      await runner.query(sql, [tenantId]).catch(() => undefined);
    }
    await runner.release().catch(() => undefined);
    await dataSource.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
