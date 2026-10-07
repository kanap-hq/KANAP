import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { createSingleTenantOnFirstStart } from '../single-tenant-provisioning';
import {
  buildServices,
  cleanupTenants,
  countDifferences,
  countTenantRows,
  inTenant,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';

// First start of a single-tenant installation (main.ts): the tenant it creates gets the default
// global chart of accounts, as a cloud tenant does at activation; a second start creates
// nothing more, and an installation whose tenant already exists is never changed.

async function chartsOf(tenantId: string) {
  return inTenant(tenantId, (manager) => manager.query(
    `SELECT c.code, c.scope, c.is_global_default, c.is_consolidation,
            (SELECT count(*)::int FROM accounts a WHERE a.tenant_id = $1 AND a.coa_id = c.id) AS accounts
       FROM chart_of_accounts c WHERE c.tenant_id = $1`,
    [tenantId],
  ));
}

async function testFirstStartProvisionsTheChart() {
  const svc = buildServices();
  const slug = `rs-onprem-${randomUUID().slice(0, 8)}`;
  let tenantId: string | undefined;
  try {
    const [template] = await dataSource.query(
      `SELECT template_code FROM coa_templates WHERE is_global = true AND loaded_by_default = true LIMIT 1`,
    );
    const logged: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    try {
      assert.equal(await createSingleTenantOnFirstStart(dataSource, svc.tenants, svc.baseline, { slug, name: 'On-prem Org' }), true);
    } finally {
      console.log = log;
    }
    assert.ok(logged.includes('[on-prem] Default chart of accounts created'), 'the outcome is logged');
    [{ id: tenantId }] = await dataSource.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);

    const charts = await chartsOf(tenantId!);
    assert.equal(charts.length, 1);
    assert.equal(charts[0].code, template.template_code);
    assert.equal(charts[0].scope, 'GLOBAL');
    assert.equal(charts[0].is_global_default, true, 'default chart');
    assert.equal(charts[0].is_consolidation, true, 'consolidation chart');
    assert.ok(charts[0].accounts > 0, 'the accounts are loaded');

    // A second start: nothing more.
    const counts = await countTenantRows(tenantId!);
    assert.equal(await createSingleTenantOnFirstStart(dataSource, svc.tenants, svc.baseline, { slug, name: 'On-prem Org' }), false);
    assert.deepEqual(countDifferences(counts, await countTenantRows(tenantId!)), []);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testExistingInstallationUnchanged() {
  const svc = buildServices();
  const slug = `rs-onprem-old-${randomUUID().slice(0, 8)}`;
  let tenantId: string | undefined;
  try {
    // An installation started before this change: its tenant exists, without a chart of accounts.
    tenantId = (await svc.tenants.createTenant({ slug, name: 'Existing Org' })).id;
    const counts = await countTenantRows(tenantId);
    assert.equal(await createSingleTenantOnFirstStart(dataSource, svc.tenants, svc.baseline, { slug, name: 'Existing Org' }), false);
    assert.deepEqual(await chartsOf(tenantId), []);
    assert.deepEqual(countDifferences(counts, await countTenantRows(tenantId)), []);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

runSpecs('single-tenant-first-start.integration.spec', [
  testFirstStartProvisionsTheChart,
  testExistingInstallationUnchanged,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
