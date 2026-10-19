// @database-spec
import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { TechnologiesService } from '../../technologies/technologies.service';
import { TechnologyReachService } from '../../technologies/technology-reach.service';
import { technology } from '../../technologies/__tests__/technologies.fixtures';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { ItOpsSettingsService } from '../it-ops-settings.service';

// The "Administration zones" catalog and the enriched domains (lot A1a), against a real database in
// transactions rolled back at the end:
// - no zone is shipped; zones are written with names only (codes generated) and their attributes
//   (administrator group, description); a too long attribute is refused; a stored privilege
//   level or secrets location is ignored;
// - domains stored before the lot are served unchanged; forest, trusts and counts are saved; a
//   trust to the domain itself, to a system entry, to an unknown domain or twice is dropped; an
//   invalid count or direction is refused;
// - a zone used by a technology cannot be removed (it can be retired); the technology PATCH
//   accepts a catalog code or null and refuses an unknown code.

const audit = { log: async () => undefined };
const settingsService = (runner: QueryRunner) => new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), audit as any);

async function testZonesCatalog() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'adz-cat');
    const settings = settingsService(runner);
    const opts = { manager: runner.manager };
    assert.deepEqual((await settings.getSettings(tenantId, opts)).adminZones, [], 'no zone is shipped');

    const saved = await settings.updateSettings(tenantId, { adminZones: [
      { label: 'Tier 0', admin_group: ' Domain admins ', privilege_level: 'Tier 0', secrets_location: 'Vault A', description: 'Identity core' },
      { label: 'Tier 1' },
    ] as any }, opts);
    assert.deepEqual(saved.adminZones, [
      { code: 'tier_0', label: 'Tier 0', deprecated: false, admin_group: 'Domain admins', description: 'Identity core' },
      { code: 'tier_1', label: 'Tier 1', deprecated: false },
    ]);
    assert.deepEqual((await settingsService(runner).getSettings(tenantId, opts)).adminZones, saved.adminZones, 'served as saved');
    assert.equal((saved.adminZones[0] as { privilege_level?: string }).privilege_level, undefined, 'a stored privilege level is ignored');
    await assert.rejects(() => settings.updateSettings(tenantId, { adminZones: [{ label: 'Tier 2', description: 'x'.repeat(2001) }] as any }, opts), BadRequestException);
    await assert.rejects(() => settings.updateSettings(tenantId, { adminZones: [{ label: 'Tier 0' }, { label: 'tier 0' }] as any }, opts), /clashes with/);
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{it_ops,admin_zones}', $2::jsonb) WHERE id = $1`,
      [tenantId, JSON.stringify([{ code: 'legacy', label: 'Legacy', admin_group: 'Ops', privilege_level: 'Tier 0', secrets_location: 'Vault A' }])],
    );
    assert.deepEqual((await settings.getSettings(tenantId, opts)).adminZones, [
      { code: 'legacy', label: 'Legacy', deprecated: false, admin_group: 'Ops' },
    ], 'a stored privilege level and secrets location are ignored on read');
  });
}

async function testDomains() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'adz-dom');
    const opts = { manager: runner.manager };
    // Domains stored before the lot: code, name and DNS suffix only.
    const legacy = [{ code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com' }, { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com', deprecated: true }];
    await runner.query(`UPDATE tenants SET metadata = jsonb_build_object('it_ops', jsonb_build_object('domains', $2::jsonb)) WHERE id = $1`, [tenantId, JSON.stringify(legacy)]);
    const settings = settingsService(runner);
    const read = await settings.getSettings(tenantId, opts);
    assert.deepEqual(read.domains.filter((d) => !d.system), [
      { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', deprecated: false, system: false },
      { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com', deprecated: true, system: false },
    ], 'existing domains stay valid and unchanged');

    const saved = await settings.updateSettings(tenantId, { domains: [
      ...read.domains,
      { label: 'Partner', dns_suffix: 'partner.example.com' },
    ].map((d: any) => d.code === 'corp' ? {
      ...d, forest: 'corp.example.com', account_count: '1200', machine_count: 0,
      trusts: [{ domain: 'lab', direction: 'outgoing' }, { domain: 'corp', direction: 'two_way' }, { domain: 'workgroup', direction: 'two_way' }, { domain: 'nowhere', direction: 'two_way' }, { domain: 'lab', direction: 'incoming' }, { domain: 'partner', direction: 'two_way' }],
    } : d) as any }, opts);
    const corp = saved.domains.find((d) => d.code === 'corp')!;
    assert.deepEqual(
      { forest: corp.forest, accounts: corp.account_count, machines: corp.machine_count, trusts: corp.trusts },
      { forest: 'corp.example.com', accounts: 1200, machines: 0, trusts: [{ domain: 'lab', direction: 'outgoing' }, { domain: 'partner', direction: 'two_way' }] },
      'self, system, unknown and repeated trusts dropped; a domain created in the same save can be trusted',
    );
    assert.equal(saved.domains.find((d) => d.code === 'lab')!.trusts, undefined);
    assert.deepEqual((await settingsService(runner).getSettings(tenantId, opts)).domains, saved.domains, 'served as saved');

    const withCorp = (patch: Record<string, unknown>) => saved.domains.map((d) => d.code === 'corp' ? { ...d, ...patch } : d) as any;
    await assert.rejects(() => settings.updateSettings(tenantId, { domains: withCorp({ account_count: -1 }) }, opts), /whole number/);
    await assert.rejects(() => settings.updateSettings(tenantId, { domains: withCorp({ machine_count: 2.5 }) }, opts), /whole number/);
    for (const invalid of [true, false, '12.5', '1e3', [5], 100_000_001]) {
      await assert.rejects(() => settings.updateSettings(tenantId, { domains: withCorp({ account_count: invalid }) }, opts), /whole number from 0 to 100,000,000/, JSON.stringify(invalid));
    }
    await assert.rejects(() => settings.updateSettings(tenantId, { domains: withCorp({ trusts: [{ domain: 'lab', direction: 'sideways' }] }) }, opts), /trust direction/);
    // Removing the trusted domain drops the trust.
    const dropped = await settings.updateSettings(tenantId, { domains: saved.domains.filter((d) => d.code !== 'partner') }, opts);
    assert.deepEqual(dropped.domains.find((d) => d.code === 'corp')!.trusts, [{ domain: 'lab', direction: 'outgoing' }]);
    // Clearing the fields removes them.
    const cleared = await settings.updateSettings(tenantId, { domains: dropped.domains.map((d) => d.code === 'corp' ? { ...d, forest: '', account_count: null, trusts: [] } : d) as any }, opts);
    const after = cleared.domains.find((d) => d.code === 'corp')!;
    assert.deepEqual([after.forest, after.account_count, after.trusts, after.machine_count], [undefined, undefined, undefined, 0]);
  });
}

async function testUsageAndTechnologyField() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'adz-use');
    const opts = { manager: runner.manager };
    const settings = settingsService(runner);
    const saved = await settings.updateSettings(tenantId, { adminZones: [{ label: 'Tier 0' }, { label: 'Tier 1' }] as any }, opts);
    const tech = await technology(runner, tenantId, 1, 'Active Directory', 'directory');
    const technologies = new TechnologiesService(audit as any, settings, new TechnologyReachService(), {} as any);
    const topts = { manager: runner.manager, tenantId };

    await assert.rejects(() => technologies.update(tech, { admin_zone: 'tier_9' }, topts), /Unknown administration zone/);
    assert.equal((await technologies.update(tech, { admin_zone: 'Tier_0' }, topts) as any).admin_zone, 'tier_0');

    assert.deepEqual(await settings.getCatalogUsage(tenantId, 'adminZones', { code: 'tier_0' }, opts), { total: 1, usage: [{ record: 'technologies', count: 1, listPath: undefined }] });
    await assert.rejects(() => settings.updateSettings(tenantId, { adminZones: saved.adminZones.filter((z) => z.code !== 'tier_0') }, opts), (error: any) => {
      assert.equal(error.getResponse().code, 'CATALOG_VALUE_IN_USE');
      assert.deepEqual(error.getResponse().usages, [{ type: 'technologies', total: 1 }]);
      return true;
    });
    const retired = await settings.updateSettings(tenantId, { adminZones: saved.adminZones.map((z) => z.code === 'tier_0' ? { ...z, deprecated: true } : z) }, opts);
    assert.equal(retired.adminZones.find((z) => z.code === 'tier_0')?.deprecated, true);
    assert.equal((await settings.updateSettings(tenantId, { adminZones: retired.adminZones.filter((z) => z.code !== 'tier_1') }, opts)).adminZones.length, 1, 'an unused zone is removed');

    assert.equal((await technologies.update(tech, { admin_zone: null }, topts) as any).admin_zone, null);
    assert.equal((await settings.getCatalogUsage(tenantId, 'adminZones', { code: 'tier_0' }, opts)).total, 0);
  });
}

void runSpecs('Administration zones and enriched domains settings', [
  ['zones catalog', testZonesCatalog],
  ['domains: compatibility, forest, trusts and counts', testDomains],
  ['zone usage and the technology field', testUsageAndTechnologyField],
]);
