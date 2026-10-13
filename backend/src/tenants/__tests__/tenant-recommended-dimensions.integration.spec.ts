import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { ensureCapexDimensions } from '../../analytics/capex-dimensions.seed';
import { ensureRecommendedDimensions, recommendedDimensionTable, SeedLanguage } from '../../analytics/recommended-dimensions.seed';
import {
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';

// The recommended dimensions every new tenant starts with (lot D, `seedTenantDefaults`): the
// default dimension named as the cost pool, then the IT tower, the purpose and the priority, in
// the seed language, enabled, optional, for OPEX and CAPEX lines, with their values in order and
// a description; no CAPEX dimension. Seeding again creates nothing; a reset gives them back as on
// a new tenant. A tenant that already has a dimension of a code keeps it as it is; a taken name
// gets " (2)". The frozen CAPEX seed (`ensureCapexDimensions`, still used by specs to build an
// older tenant) keeps its own rules. The tenants are committed (the services open their own
// transactions) and removed at the end.

async function dimensionsOf(tenantId: string) {
  const rows = await inTenant(tenantId, (manager) => manager.query(
    `SELECT a.code, a.name, a.sort_order, a.applies_to, a.required, a.status::text AS status, a.is_default,
            a.description IS NOT NULL AS described,
            coalesce((SELECT array_agg(c.sort_order || ' ' || c.name ORDER BY c.sort_order, c.name)
                        FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = a.id), '{}') AS vals,
            (SELECT bool_and(c.description IS NOT NULL AND c.applies_to IS NULL AND c.status = 'enabled')
               FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = a.id) AS values_ok
       FROM analytics_axes a WHERE a.tenant_id = $1 ORDER BY a.sort_order, a.code`,
    [tenantId],
  ));
  return rows.map((row: any) => ({ ...row, vals: [...row.vals] }));
}

async function idsOf(tenantId: string): Promise<string[]> {
  const rows = await inTenant(tenantId, (manager) => manager.query(
    `SELECT id::text AS id FROM analytics_axes WHERE tenant_id = $1
     UNION ALL SELECT id::text FROM analytics_categories WHERE tenant_id = $1 ORDER BY 1`,
    [tenantId],
  ));
  return rows.map((row: any) => row.id);
}

/** What a new tenant holds, from the seed table of the language. */
function starting(language: SeedLanguage) {
  const table = recommendedDimensionTable(language).filter((seed) => seed.key !== 'recurrence');
  return table.map((seed, index) => ({
    code: seed.key === 'cost_pool' ? 'default' : seed.code,
    name: seed.name,
    sort_order: index,
    applies_to: null,
    required: false,
    status: 'enabled',
    is_default: seed.key === 'cost_pool',
    described: true,
    vals: seed.values.map((value, position) => `${position + 1} ${value.name}`),
    values_ok: true,
  }));
}

async function testNewTenantInFrench() {
  const svc = buildServices();
  let tenantId: string | undefined;
  try {
    tenantId = (await svc.tenants.createTenant({ slug: `rs-recdim-fr-${randomUUID().slice(0, 8)}`, name: 'Dimensions FR', language: 'fr' })).id;
    const dimensions = await dimensionsOf(tenantId);
    assert.deepEqual(dimensions, starting('fr'), 'four dimensions in French, none required, for both natures');
    assert.deepEqual(dimensions.map((row: any) => row.name), ['Nature de coût', 'Domaine IT', 'Motif', 'Priorité']);
    assert.deepEqual(dimensions[0].vals, [
      '1 Matériel', '2 Logiciel', "3 Main-d'œuvre interne", "4 Main-d'œuvre externe", '5 Services externes',
      '6 Locaux et énergie', '7 Télécoms', '8 Autres',
    ]);
    assert.ok(!dimensions.some((row: any) => ['ppe_type', 'investment_type'].includes(row.code)), 'no CAPEX dimension');
    const ids = await idsOf(tenantId);
    assert.equal(ids.length, 4 + 8 + 11 + 7 + 4);
    // Seeding again, in French or in another language, creates nothing.
    await inTenant(tenantId, (manager) => svc.tenants.seedTenantDefaults(manager, tenantId!, { language: 'fr' }));
    await inTenant(tenantId, (manager) => svc.tenants.seedTenantDefaults(manager, tenantId!));
    assert.deepEqual(await idsOf(tenantId), ids, 'seeding again creates nothing');
    assert.deepEqual(await dimensionsOf(tenantId), starting('fr'));
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testNewTenantInEnglish() {
  const svc = buildServices();
  let tenantId: string | undefined;
  try {
    const slug = `rs-recdim-en-${randomUUID().slice(0, 8)}`;
    tenantId = (await svc.tenants.createTenant({ slug, name: 'Dimensions EN' })).id;
    assert.deepEqual(await dimensionsOf(tenantId), starting('en'), 'English when no language is given');
    assert.deepEqual((await dimensionsOf(tenantId)).map((row: any) => row.name), ['Cost pool', 'IT tower', 'Purpose', 'Priority']);
    const ids = await idsOf(tenantId);
    // Creating the same slug again runs the seeds on the existing tenant: nothing more.
    await svc.tenants.createTenant({ slug, name: 'Dimensions EN', language: 'de' });
    assert.deepEqual(await idsOf(tenantId), ids, 'the same slug again creates nothing');
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testResetGivesThemBack() {
  const svc = buildServices();
  let tenant: Awaited<ReturnType<typeof createActivatedTenant>> | undefined;
  try {
    tenant = await createActivatedTenant(svc, { tag: 'recdim-reset', orgName: 'Dimensions Reset' });
    assert.deepEqual(await dimensionsOf(tenant.tenantId), starting('en'), 'an activated tenant');
    // The administrator renamed one, removed a value, disabled another, added the CAPEX trio.
    await inTenant(tenant.tenantId, async (manager) => {
      await manager.query(`UPDATE analytics_axes SET name = 'Tower' WHERE tenant_id = $1 AND code = 'it_tower'`, [tenant!.tenantId]);
      await manager.query(
        `DELETE FROM analytics_categories c USING analytics_axes a
          WHERE c.tenant_id = $1 AND a.id = c.axis_id AND a.code = 'priority' AND c.name = 'Low'`,
        [tenant!.tenantId],
      );
      await manager.query(`UPDATE analytics_axes SET status = 'disabled', disabled_at = now() WHERE tenant_id = $1 AND code = 'purpose'`, [tenant!.tenantId]);
      await ensureCapexDimensions(manager, tenant!.tenantId);
    });
    await svc.reset.reset(tenant.tenantId, tenant.ownerId);
    assert.deepEqual(await dimensionsOf(tenant.tenantId), starting('en'), 'after a reset: as on a new tenant');
  } finally {
    await cleanupTenants([tenant?.tenantId]);
  }
}

async function testResetKeepsTheLanguage() {
  const svc = buildServices();
  let tenant: Awaited<ReturnType<typeof createActivatedTenant>> | undefined;
  try {
    tenant = await createActivatedTenant(svc, { tag: 'recdim-fr', orgName: 'Dimensions Reset FR', language: 'fr' });
    const languageOf = async () => (await dataSource.query(`SELECT metadata->>'language' AS language FROM tenants WHERE id = $1`, [tenant!.tenantId]))[0].language;
    assert.equal(await languageOf(), 'fr', 'the seed language is stored with the tenant');
    assert.deepEqual(await dimensionsOf(tenant.tenantId), starting('fr'));
    await inTenant(tenant.tenantId, (manager) => manager.query(`UPDATE analytics_axes SET name = 'Tour' WHERE tenant_id = $1 AND code = 'it_tower'`, [tenant!.tenantId]));
    await svc.reset.reset(tenant.tenantId, tenant.ownerId);
    assert.equal(await languageOf(), 'fr', 'the reset keeps it');
    assert.deepEqual(await dimensionsOf(tenant.tenantId), starting('fr'), 'after a reset: the French dimensions again');
  } finally {
    await cleanupTenants([tenant?.tenantId]);
  }
}

async function rawTenant(tag: string): Promise<string> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `rs-recdim-${tag}-${tenantId.slice(0, 8)}`, `Dimensions ${tag}`],
  );
  return tenantId;
}

async function testExistingCodeAndTakenName() {
  const tenantId = await rawTenant('taken');
  try {
    const outcomes = await inTenant(tenantId, async (manager) => {
      await manager.query(`INSERT INTO analytics_axes (tenant_id, code, name, is_default, sort_order) VALUES ($1, 'default', NULL, true, 0)`, [tenantId]);
      const [own] = await manager.query(
        `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, required) VALUES ($1, 'priority', 'Urgency', 4, true) RETURNING id`, [tenantId]);
      await manager.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order) VALUES ($1, $2, 'Urgent', 1)`, [tenantId, own.id]);
      await manager.query(`INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'tower', 'IT tower', 9)`, [tenantId]);
      return ensureRecommendedDimensions(manager, tenantId, 'en');
    });
    assert.deepEqual(outcomes.map(({ key, code, created, name, valueIds }) => ({ key, code, created, name, values: valueIds.length })), [
      { key: 'cost_pool', code: 'default', created: true, name: 'Cost pool', values: 8 },
      { key: 'it_tower', code: 'it_tower', created: true, name: 'IT tower (2)', values: 11 },
      { key: 'purpose', code: 'purpose', created: true, name: 'Purpose', values: 7 },
      { key: 'priority', code: 'priority', created: false, name: 'Urgency', values: 0 },
    ]);
    assert.deepEqual((await dimensionsOf(tenantId)).map((row: any) => [row.code, row.name, row.sort_order, row.required, row.vals.length]), [
      ['default', 'Cost pool', 0, false, 8],
      ['priority', 'Urgency', 4, true, 1],
      ['tower', 'IT tower', 9, false, 0],
      ['it_tower', 'IT tower (2)', 10, false, 11],
      ['purpose', 'Purpose', 11, false, 7],
    ], 'a dimension of the code kept exactly as it is (settings and values); a taken name gets (2); new ones last');
    const again = await inTenant(tenantId, (manager) => ensureRecommendedDimensions(manager, tenantId, 'fr'));
    assert.deepEqual(again.map((outcome) => [outcome.key, outcome.created, outcome.valueIds.length]), [
      ['cost_pool', false, 0], ['it_tower', false, 0], ['purpose', false, 0], ['priority', false, 0],
    ], 'idempotent, whatever the language');
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testCapexHelper() {
  const tenantId = await rawTenant('capex');
  try {
    const outcomes = await inTenant(tenantId, async (manager) => {
      const [own] = await manager.query(
        `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'priority', 'Urgency', 4) RETURNING id`, [tenantId]);
      await manager.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order) VALUES ($1, $2, 'Urgent', 1), ($1, $2, 'high', 2)`,
        [tenantId, own.id]);
      await manager.query(`INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'kind', 'PP&E type', 9)`, [tenantId]);
      return ensureCapexDimensions(manager, tenantId);
    });
    assert.deepEqual(outcomes.map(({ code, created, name, valuesCreated }) => ({ code, created, name, valuesCreated })), [
      { code: 'ppe_type', created: true, name: 'PP&E type (CAPEX)', valuesCreated: 2 },
      { code: 'investment_type', created: true, name: 'Investment type', valuesCreated: 7 },
      { code: 'priority', created: false, name: 'Urgency', valuesCreated: 3 },
    ], 'the frozen CAPEX seed: a dimension of the code gets the values it lacks, a taken name gets (CAPEX)');
    const again = await inTenant(tenantId, (manager) => ensureCapexDimensions(manager, tenantId));
    assert.deepEqual(again.map((outcome) => [outcome.created, outcome.valuesCreated]), [[false, 0], [false, 0], [false, 0]], 'idempotent');
  } finally {
    await cleanupTenants([tenantId]);
  }
}

runSpecs('tenant-recommended-dimensions.integration.spec', [
  testNewTenantInFrench,
  testNewTenantInEnglish,
  testResetGivesThemBack,
  testResetKeepsTheLanguage,
  testExistingCodeAndTakenName,
  testCapexHelper,
]);
