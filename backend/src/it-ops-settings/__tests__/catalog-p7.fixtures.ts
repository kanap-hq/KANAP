import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Shared fixtures of the rule P7 specs of the services (not a spec itself): the app context, a
// tenant whose catalog lists each carry one retired entry (`old_<list>`), and the refusal checks.
// Every seed runs in a transaction the spec rolls back.

process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

export { assert };

/** The lists that get a retired entry, with its code. */
export const RETIRED_LISTS = [
  'serverKinds', 'serverProviders', 'domains', 'adminZones', 'lifecycleStates', 'ipAddressTypes', 'connectionTypes', 'entities',
  'pathHopFunctions', 'interfaceDataCategories', 'interfaceTriggerTypes', 'interfacePatterns', 'interfaceFormats', 'interfaceAuthModes',
] as const;
export const retiredCode = (list: (typeof RETIRED_LISTS)[number]) => `old_${list.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;

export type P7Harness = { app: any; dataSource: DataSource; get: <T = any>(type: any) => T };

export async function createP7Harness(): Promise<P7Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the rule P7 specs.');
  const { AppModule } = require('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), get: (type: any) => app.get(type, { strict: false }) };
}

export type P7Seed = { tenantId: string; locationId: string; runner: QueryRunner };

/** A tenant, a site, and one retired entry in each list of `RETIRED_LISTS`; then `test`, rolled back. */
export async function inP7Tenant(harness: P7Harness, test: (seed: P7Seed) => Promise<void>) {
  const { ItOpsSettingsService } = require('../it-ops-settings.service');
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'P7 test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `p7-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [{ id: locationId }] = await runner.query(
      `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-1', 'Paris DC', 'cloud') RETURNING id`, [tenantId]);
    const settings = harness.get(ItOpsSettingsService);
    const current = await settings.getSettings(tenantId, { manager: runner.manager });
    const patch: Record<string, unknown[]> = {};
    for (const list of RETIRED_LISTS) {
      const [first] = current[list] as any[];
      const { translations: _translations, ...shape } = first;
      const code = retiredCode(list);
      const extra = list === 'domains' ? { dns_suffix: `${code.replace(/_/g, '-')}.example.test` } : {};
      patch[list] = [...current[list], { ...shape, ...extra, code, label: `Old ${list}`, deprecated: true }];
    }
    await settings.updateSettings(tenantId, patch, { manager: runner.manager });
    const stored = await settings.getSettings(tenantId, { manager: runner.manager });
    for (const list of RETIRED_LISTS) {
      assert.ok((stored[list] as any[]).some((item) => item.code === retiredCode(list) && item.deprecated), `${list} has its retired entry`);
    }
    await test({ tenantId, locationId: String(locationId), runner });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** The write is refused as rule P7 says: a retired value on a record that does not hold it. */
export async function refusedAsRetired(fn: () => Promise<unknown>, label: string) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `${label}: a retired value is refused on a record that does not hold it`);
  assert.match(String(thrown?.message ?? ''), /is retired/, `${label}: ${thrown?.message}`);
}

/** Runs the named checks with one app context; fails with every failure. */
export async function runP7Specs(name: string, checks: Array<[string, (harness: P7Harness) => Promise<void>]>) {
  const harness = await createP7Harness();
  try {
    const failures: string[] = [];
    for (const [label, check] of checks) {
      try {
        await check(harness);
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message}`);
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
    console.log(`${name} passed`);
  } finally {
    await harness.app.close();
  }
}
