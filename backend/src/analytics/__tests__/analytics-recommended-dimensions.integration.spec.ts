import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { PermissionGuard } from '../../auth/permission.guard';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { ensureCapexDimensions } from '../capex-dimensions.seed';
import { ensureDefaultAnalyticsAxis } from '../analytics-axes.util';
import { AnalyticsAxesController } from '../analytics-axes.controller';
import { context, expectRefused, runSpecs, seedTenant, services, withRollback } from './analytics-test-helpers';

// POST /analytics-axes/recommended (lot D): an administrator adds the recommended dimensions an
// existing tenant lacks. The cost pool goes on the default dimension only while it has neither a
// name nor a value, otherwise it is a new dimension of code `cost_pool`; a dimension already there
// is left as it is; a second call creates nothing; the answer says what was created and what
// already existed, and GET says which ones the tenant has. Only `analytics:admin` may do it.
// Every case runs in a transaction rolled back at the end.

const summary = (items: Array<{ code: string; axis_code: string; name: string | null; values_created: number }>) =>
  items.map(({ code, axis_code, name, values_created }) => [code, axis_code, name, values_created]);

async function presentCodes(runner: QueryRunner, tenantId: string) {
  const { items } = await services(runner.manager).axes.recommended(context(runner.manager, tenantId));
  return items.map((item) => [item.code, item.present, item.starting]);
}

async function testOlderTenantWithEmptyDefault() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'rec-older');
    const { axes } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    // A tenant of before lot D: the default dimension, never named, and the three CAPEX dimensions.
    await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    await ensureCapexDimensions(runner.manager, tenantId);
    assert.deepEqual(await presentCodes(runner, tenantId), [
      ['cost_pool', false, true], ['it_tower', false, true], ['purpose', true, true], ['priority', true, true], ['recurrence', false, false],
    ], 'its priority is there by code, its investment type stands for the purpose; the recurrence is the optional pack');
    const { items } = await axes.recommended(ctx);
    assert.equal(items.find((item) => item.code === 'purpose')?.name, 'Investment type', 'the dimension that stands for it');

    const first = await axes.addRecommended({ codes: ['cost_pool', 'it_tower', 'purpose', 'priority'], language: 'fr' }, ctx);
    assert.deepEqual(summary(first.created), [
      ['cost_pool', 'default', 'Nature de coût', 8],
      ['it_tower', 'it_tower', 'Domaine IT', 11],
    ], 'the default dimension is named and filled; the IT tower is created');
    assert.deepEqual(summary(first.existing), [
      ['purpose', 'investment_type', 'Investment type', 0],
      ['priority', 'priority', 'Priority', 0],
    ], 'the CAPEX investment type and priority are kept as they are; no purpose next to the investment type');
    const [purposeCount] = await runner.query(`SELECT count(*)::int AS n FROM analytics_axes WHERE tenant_id = $1 AND code = 'purpose'`, [tenantId]);
    assert.equal(purposeCount.n, 0);

    const [defaultAxis] = await runner.query(
      `SELECT name, description, applies_to, required, (SELECT count(*)::int FROM analytics_categories c WHERE c.axis_id = a.id) AS n
         FROM analytics_axes a WHERE tenant_id = $1 AND is_default`,
      [tenantId],
    );
    assert.deepEqual([defaultAxis.name, defaultAxis.applies_to, defaultAxis.required, defaultAxis.n], ['Nature de coût', null, false, 8]);
    assert.match(defaultAxis.description, /cost pools de la taxonomie TBM/);
    const [capexPriority] = await runner.query(
      `SELECT applies_to, required, (SELECT count(*)::int FROM analytics_categories c WHERE c.axis_id = a.id) AS n
         FROM analytics_axes a WHERE tenant_id = $1 AND code = 'priority'`,
      [tenantId],
    );
    assert.deepEqual([capexPriority.applies_to, capexPriority.required, capexPriority.n], ['capex', true, 4], 'untouched');

    // One audit entry per dimension created or named, and per value created.
    const audit = await runner.query(
      `SELECT table_name, action, count(*)::int AS n FROM audit_log
        WHERE tenant_id = $1 AND table_name IN ('analytics_axes', 'analytics_categories')
        GROUP BY 1, 2 ORDER BY 1, 2`,
      [tenantId],
    );
    assert.deepEqual(audit.map((row: any) => [row.table_name, row.action, row.n]), [
      ['analytics_axes', 'create', 1], ['analytics_axes', 'update', 1], ['analytics_categories', 'create', 19],
    ]);

    const second = await axes.addRecommended({ codes: ['cost_pool', 'it_tower', 'purpose', 'priority'], language: 'fr' }, ctx);
    assert.deepEqual(second.created, [], 'a second call creates nothing');
    assert.deepEqual(second.existing.map((item) => item.code), ['cost_pool', 'it_tower', 'purpose', 'priority']);
    assert.deepEqual((await presentCodes(runner, tenantId)).map(([code, present]) => [code, present]), [
      ['cost_pool', true], ['it_tower', true], ['purpose', true], ['priority', true], ['recurrence', false],
    ]);

    const pack = await axes.addRecommended({ codes: ['recurrence'], language: 'en' }, ctx);
    assert.deepEqual(summary(pack.created), [['recurrence', 'recurrence', 'Recurrence', 2]], 'the optional pack, in the language asked');
    assert.deepEqual(pack.existing, []);
  });
}

// GET also gives the tenant's seed language and, for each recommended dimension it has, the
// tenant's value of each seed value, matched by name in any language: a caller that names the
// values in English (the sample data loader) finds "Matériel" for "Hardware".
async function testValuesAndLanguage() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'rec-values-fr');
    const { axes } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    assert.equal((await axes.recommended(ctx)).language, 'en', 'no language stored: English');
    await runner.query(`UPDATE tenants SET metadata = metadata || '{"language":"fr"}'::jsonb WHERE id = $1`, [tenantId]);
    await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    await axes.addRecommended({ codes: ['cost_pool', 'it_tower'], language: 'fr' }, ctx);
    // The administrator renamed one value; an English duplicate came later, after the French one.
    await runner.query(
      `UPDATE analytics_categories c SET name = 'Réseaux et télécoms' FROM analytics_axes a
        WHERE a.id = c.axis_id AND a.tenant_id = $1 AND a.is_default AND c.name = 'Télécoms'`,
      [tenantId],
    );
    await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order)
       SELECT $1, id, 'Hardware', 99 FROM analytics_axes WHERE tenant_id = $1 AND is_default`,
      [tenantId],
    );

    const state = await axes.recommended(ctx);
    assert.equal(state.language, 'fr', 'the seed language stored on the tenant');
    const byCode = new Map(state.items.map((item) => [item.code, item]));
    const costPool = byCode.get('cost_pool')!;
    assert.equal(costPool.axis_code, 'default', 'the cost pool is on the default dimension');
    assert.deepEqual(costPool.values.map((value) => [value.key, value.english_name, value.name]), [
      ['hardware', 'Hardware', 'Matériel'],
      ['software', 'Software', 'Logiciel'],
      ['internal_labor', 'Internal labor', "Main-d'œuvre interne"],
      ['external_labor', 'External labor', "Main-d'œuvre externe"],
      ['outside_services', 'Outside services', 'Services externes'],
      ['facilities_power', 'Facilities and power', 'Locaux et énergie'],
      ['telecom', 'Telecom', null],
      ['other', 'Other', 'Autres'],
    ], 'the French values by key; the first by position when two match; none for the renamed one');
    assert.equal(byCode.get('it_tower')!.axis_code, 'it_tower');
    assert.deepEqual(byCode.get('it_tower')!.values.slice(0, 2).map((value) => value.name), ['Data center', 'Calcul']);
    assert.deepEqual(byCode.get('recurrence')!.values, [], 'a dimension the tenant lacks has no value');
    assert.equal(byCode.get('recurrence')!.axis_code, null);
  });

  await withRollback(async (runner) => {
    // An older tenant: its investment type stands for the purpose; "Conformity" is no purpose value.
    const tenantId = await seedTenant(runner, 'rec-values-older');
    await ensureCapexDimensions(runner.manager, tenantId);
    const { items } = await services(runner.manager).axes.recommended(context(runner.manager, tenantId));
    const purpose = items.find((item) => item.code === 'purpose')!;
    assert.equal(purpose.axis_code, 'investment_type');
    assert.deepEqual(purpose.values.map((value) => [value.key, value.name]), [
      ['replacement', 'Replacement'], ['capacity', 'Capacity'], ['productivity', 'Productivity'], ['security', 'Security'],
      ['compliance', null], ['business_growth', 'Business growth'], ['other', 'Other'],
    ]);
  });
}

async function testNamedDefault() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'rec-named');
    const { axes } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    await runner.query(`UPDATE analytics_axes SET name = 'Domain' WHERE id = $1`, [defaultId]);
    await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order) VALUES ($1, $2, 'ERP', 1)`, [tenantId, defaultId]);
    // A dimension of the administrator's own holds the English name.
    await runner.query(`INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'pool', 'Cost pool', 5)`, [tenantId]);

    const result = await axes.addRecommended({ codes: ['cost_pool'], language: 'en' }, ctx);
    assert.deepEqual(summary(result.created), [['cost_pool', 'cost_pool', 'Cost pool (2)', 8]], 'a dimension of its own, its name made free');
    const [stored] = await runner.query(`SELECT name, description FROM analytics_axes WHERE id = $1`, [defaultId]);
    assert.deepEqual([stored.name, stored.description], ['Domain', null], 'the default dimension is not touched');
    assert.deepEqual((await presentCodes(runner, tenantId))[0], ['cost_pool', true, true]);
    assert.deepEqual((await axes.addRecommended({ codes: ['cost_pool'], language: 'en' }, ctx)).created, []);
  });

  await withRollback(async (runner) => {
    // No name but a value: the default dimension is not empty either.
    const tenantId = await seedTenant(runner, 'rec-values');
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order) VALUES ($1, $2, 'Run', 1)`, [tenantId, defaultId]);
    const result = await services(runner.manager).axes.addRecommended({ codes: ['cost_pool'], language: 'de' }, context(runner.manager, tenantId));
    assert.deepEqual(summary(result.created), [['cost_pool', 'cost_pool', 'Kostenart', 8]]);
    const [stored] = await runner.query(`SELECT name FROM analytics_axes WHERE id = $1`, [defaultId]);
    assert.equal(stored.name, null);
  });

  await withRollback(async (runner) => {
    // The default dimension named by the seed, in another language: it is the cost pool.
    const tenantId = await seedTenant(runner, 'rec-seeded');
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    await runner.query(`UPDATE analytics_axes SET name = 'Tipo de coste' WHERE id = $1`, [defaultId]);
    const result = await services(runner.manager).axes.addRecommended({ codes: ['cost_pool'], language: 'en' }, context(runner.manager, tenantId));
    assert.deepEqual(result.created, []);
    assert.deepEqual(summary(result.existing), [['cost_pool', 'default', 'Tipo de coste', 0]]);
  });
}

async function testRefusals() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'rec-refusals');
    const { axes } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    await expectRefused(runner, /at least one/, () => axes.addRecommended({ codes: [], language: 'en' }, ctx));
    await expectRefused(runner, /at least one/, () => axes.addRecommended({ codes: ['ppe_type'], language: 'en' }, ctx));
    // A tenant inserted without the bootstrap gets its default dimension first, then the cost pool on it.
    const result = await axes.addRecommended({ codes: ['cost_pool'], language: 'es' }, ctx);
    assert.deepEqual(summary(result.created), [['cost_pool', 'default', 'Tipo de coste', 8]]);
  });
}

/* ---- Permissions: the route metadata, then the real guard ---- */

async function seedPerson(runner: QueryRunner, tenantId: string, permissions: Record<string, string> | 'Administrator'): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Recommended dimensions role', false, false, now(), now()) RETURNING id`,
    [tenantId, permissions === 'Administrator' ? 'Administrator' : `Recommended ${randomUUID().slice(0, 8)}`],
  );
  if (permissions !== 'Administrator') {
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, role.id, resource, level]);
    }
  }
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, 'Test', 'Person', 'enabled') RETURNING id`,
    [tenantId, role.id, `person.${randomUUID().slice(0, 8)}@recommended.example`],
  );
  return user.id;
}

async function testPermissions() {
  const proto = AnalyticsAxesController.prototype;
  for (const handler of [proto.recommended, proto.addRecommended]) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler), { resource: 'analytics', level: 'admin' });
  }
  const guard = new PermissionGuard(
    new Reflector(),
    new (UsersService as any)(dataSource.getRepository(User)),
    new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    dataSource,
    { isConfigured: () => false } as any,
  );
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'rec-perms');
    const cases: Array<[string, Record<string, string> | 'Administrator', boolean]> = [
      ['analytics member', { analytics: 'member' }, false],
      ['budget administrator', { budget: 'admin' }, false],
      ['analytics administrator', { analytics: 'admin' }, true],
      ['administrator', 'Administrator', true],
    ];
    for (const [who, permissions, allowed] of cases) {
      const userId = await seedPerson(runner, tenantId, permissions);
      for (const handler of [proto.recommended, proto.addRecommended]) {
        const req: any = { method: handler === proto.recommended ? 'GET' : 'POST', user: { sub: userId }, tenant: { id: tenantId }, queryRunner: runner };
        const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
        const ctx = { getHandler: () => handler, getClass: () => AnalyticsAxesController, switchToHttp: () => http, getType: () => 'http' } as unknown as ExecutionContext;
        if (allowed) {
          assert.equal(await guard.canActivate(ctx), true, `${who} on ${req.method} /analytics-axes/recommended`);
        } else {
          // A missing module right answers 403 MODULE_RIGHT_REQUIRED.
          await assert.rejects(
            () => guard.canActivate(ctx),
            (error: unknown) => error instanceof HttpException && error.getStatus() === 403,
            `${who} on ${req.method} /analytics-axes/recommended`,
          );
        }
      }
    }
  });
}

void dataSource;

runSpecs('analytics-recommended-dimensions.integration.spec', [
  testOlderTenantWithEmptyDefault,
  testValuesAndLanguage,
  testNamedDefault,
  testRefusals,
  testPermissions,
]);
