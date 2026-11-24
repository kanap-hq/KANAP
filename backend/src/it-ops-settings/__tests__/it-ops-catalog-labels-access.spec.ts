import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionGuard } from '../../auth/permission.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ItOpsSettingsController } from '../it-ops-settings.controller';
import { CATALOG_LABEL_LISTS, ItOpsSettingsService } from '../it-ops-settings.service';
import { CLASSIFICATION_CATALOG_KEYS } from '../classification-catalog';

// The catalog labels (issue #1779) are readable by every signed-in member: a person without the
// settings right names catalog values by their label. The labels read carries only what a label
// needs; the full settings, the usage route and every write keep the settings right.

const LOCATION_ID = '11111111-1111-4111-8111-111111111111';
const SECRETS = ['corp.example.test', 'forest-secret', 'trusted.example.test', 'GG-Tier0-Admins', 'zone-description-secret', '4443/tcp', '10.42.0.0/16', 'subnet-description-secret'];

const tenant = {
  id: 'tenant-1',
  metadata: {
    it_ops: {
      domains: [
        { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.test', forest: 'forest-secret', trusts: [{ domain: 'trusted.example.test', direction: 'two_way' }], account_count: 9876, machine_count: 5432 },
      ],
      admin_zones: [{ code: 'tier_0', label: 'Tier 0', admin_group: 'GG-Tier0-Admins', description: 'zone-description-secret' }],
      connection_types: [{ code: 'custom_tcp', label: 'Custom TCP', typicalPorts: '4443/tcp', category: 'other' }],
      network_segments: [{ code: 'lan', label: 'LAN' }],
      subnets: [{ location_id: LOCATION_ID, cidr: '10.42.0.0/16', network_zone: 'lan', description: 'subnet-description-secret' }],
      application_categories: [
        { code: 'line_of_business', label: 'Line of business', translations: { fr: { label: 'Métier' } } },
        { code: 'old_one', label: 'Old one', deprecated: true },
      ],
    },
  },
};

function service(): ItOpsSettingsService {
  const tenants = { findOne: async () => structuredClone(tenant) };
  const locations = { find: async () => [{ id: LOCATION_ID }] };
  return new ItOpsSettingsService(tenants as any, locations as any, { log: async () => undefined } as any);
}

function guardFor(settingsLevel: string | null): PermissionGuard {
  const user = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'Business Contributor' } };
  const manager = { getRepository: () => ({ find: async () => [] }) };
  const levels = new Map<string, string>([['applications', 'contributor']]);
  if (settingsLevel) levels.set('settings', settingsLevel);
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    { listForRoles: async () => levels } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function context(route: string, method: string): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method };
  return {
    getHandler: () => (ItOpsSettingsController.prototype as any)[route],
    getClass: () => ItOpsSettingsController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

/** What Nest runs for a route: the class guards, then the route guards (PermissionGuard when declared). */
async function allowed(route: string, method: string, settingsLevel: string | null): Promise<boolean> {
  const proto = ItOpsSettingsController.prototype as any;
  const routeGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, proto[route]) ?? [];
  if (!routeGuards.includes(PermissionGuard)) return true;
  try {
    return await guardFor(settingsLevel).canActivate(context(route, method));
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

async function run() {
  const proto = ItOpsSettingsController.prototype as any;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, ItOpsSettingsController), [JwtAuthGuard], 'every route needs a signed-in member');
  assert.equal(typeof proto.getCatalogLabels, 'function', 'the catalog labels route exists');
  assert.equal(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.getCatalogLabels), undefined, 'the labels need no module right');

  // A member without the settings right: labels yes, settings, usage and writes no.
  assert.equal(await allowed('getCatalogLabels', 'GET', null), true, 'labels readable without the settings right');
  assert.equal(await allowed('getSettings', 'GET', null), false, 'GET settings refused without the settings right');
  assert.equal(await allowed('getUsage', 'GET', null), false, 'usage refused without the settings right');
  assert.equal(await allowed('updateSettings', 'PATCH', null), false, 'PATCH refused without the settings right');
  assert.equal(await allowed('resetSettings', 'POST', null), false, 'reset refused without the settings right');
  // A settings reader keeps the full read.
  assert.equal(await allowed('getSettings', 'GET', 'reader'), true, 'GET settings allowed to a settings reader');
  assert.equal(await allowed('getUsage', 'GET', 'reader'), true, 'usage allowed to a settings reader');

  const controller = new ItOpsSettingsController(service());
  const req = { tenant: { id: tenant.id } };
  const labels: any = await controller.getCatalogLabels(req);
  const full: any = await controller.getSettings(req);

  assert.deepEqual(Object.keys(labels).sort(), [...CATALOG_LABEL_LISTS].sort(), 'only the catalog lists');
  for (const key of ['subnets', 'lockedCodes', 'protectedCodes']) assert.equal(labels[key], undefined, `no ${key}`);
  const allowedFields = new Set(['code', 'label', 'deprecated', 'translations']);
  for (const key of CATALOG_LABEL_LISTS) {
    const fields = new Set(allowedFields);
    if ((CLASSIFICATION_CATALOG_KEYS as readonly string[]).includes(key)) fields.add('description');
    for (const row of labels[key]) for (const field of Object.keys(row)) assert.ok(fields.has(field), `${key}: unexpected field ${field}`);
    // Every value of the full settings is named by the labels read, in the same order.
    assert.deepEqual(labels[key].map((row: any) => row.code), (full[key] ?? []).map((row: any) => row.code), `${key}: same codes`);
  }
  const text = JSON.stringify(labels);
  for (const secret of [...SECRETS, '9876', '5432']) assert.ok(!text.includes(secret), `the labels never carry ${secret}`);

  const category = labels.applicationCategories.find((row: any) => row.code === 'line_of_business');
  assert.deepEqual(category, { code: 'line_of_business', label: 'Line of business', translations: { fr: { label: 'Métier' } } });
  assert.deepEqual(labels.applicationCategories.find((row: any) => row.code === 'old_one'), { code: 'old_one', label: 'Old one', deprecated: true });
  assert.deepEqual(labels.domains.find((row: any) => row.code === 'corp'), { code: 'corp', label: 'Corp' });
  assert.ok(labels.businessCriticalityLevels.every((row: any) => typeof row.description === 'string'), 'classification levels keep their description');

  // The full settings are unchanged for a settings reader: every excluded datum is still there.
  const fullText = JSON.stringify(full);
  // (a trust to a domain outside the list is dropped by the settings themselves)
  for (const secret of SECRETS.filter((value) => value !== 'trusted.example.test')) assert.ok(fullText.includes(secret), `the full settings still carry ${secret}`);
  assert.ok(full.lockedCodes && full.protectedCodes, 'locked and protected codes still in the full settings');

  console.log('it-ops-catalog-labels-access.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
