import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AppAssetAssignmentsService } from '../app-asset-assignments.service';
import { AppInstancesService } from '../../app-instances/app-instances.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';

// The Deployments tab of an application (recette C1b): the refusals of the deployments and of their
// servers carry a code and params the interface translates, a "Since" date that is not a date is
// refused instead of being dropped, the servers of every deployment come in one read, a read takes
// no lock on the tenant row, and a second tenant reads none of it. Each test runs under a throwaway tenant in a rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const noAudit = { log: async () => undefined } as any;

async function withRollback(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Deployment servers', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `dep-servers-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

async function expectCoded(run: () => Promise<unknown>, status: number, code: string, params?: Record<string, unknown>) {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof HttpException, `an HTTP refusal, got ${(err as Error)?.message}`);
    assert.equal(err.getStatus(), status, `${code}: status`);
    const body = err.getResponse() as Record<string, unknown>;
    assert.equal(body.code, code);
    if (params) assert.deepEqual(body.params, params);
    return true;
  });
}

function services(tenantRepoManager: any) {
  const real = new ItOpsSettingsService(tenantRepoManager.getRepository(Tenant), tenantRepoManager.getRepository(Location), noAudit);
  const calls = { forWrite: 0 };
  const settings = {
    getSettings: real.getSettings.bind(real),
    getSettingsForWrite: async (...args: Parameters<ItOpsSettingsService['getSettingsForWrite']>) => {
      calls.forWrite += 1;
      return real.getSettingsForWrite(...args);
    },
  } as unknown as ItOpsSettingsService;
  return {
    calls,
    assignments: new AppAssetAssignmentsService(null as any, null as any, null as any, noAudit, settings),
    instances: new AppInstancesService(null as any, null as any, null as any, null as any, noAudit, settings),
  };
}

async function seedAsset(runner: QueryRunner, tenantId: string, name: string, isCluster = false) {
  return one(runner,
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, is_cluster, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', 'active', $3, now(), now()) RETURNING id`,
    [tenantId, name, isCluster]);
}

async function testCodedRefusals() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const { assignments, instances } = services(m);
    const app = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [t]);
    const prod = (await instances.create(app, { environment: 'prod' }, null, { manager: m, tenantId: t })).id;

    await expectCoded(() => instances.create(app, { environment: 'prod' }, null, { manager: m, tenantId: t }),
      409, 'deployment_environment_taken', { environment: 'prod' });
    await expectCoded(() => instances.create(app, { environment: 'qa', lifecycle: 'nope' }, null, { manager: m, tenantId: t }),
      400, 'deployment_lifecycle_invalid', { value: 'nope' });
    await expectCoded(() => instances.create(app, { environment: 'moon' }, null, { manager: m, tenantId: t }),
      400, 'deployment_environment_invalid', { value: 'moon' });
    await expectCoded(() => instances.create(app, null, null, { manager: m, tenantId: t }), 400, 'body_required');
    await expectCoded(() => instances.update(prod, null, null, { manager: m, tenantId: t }), 400, 'body_required');
    const qa = (await instances.create(app, { environment: 'qa' }, null, { manager: m, tenantId: t })).id;
    await expectCoded(() => instances.update(qa, { environment: 'prod' }, null, { manager: m, tenantId: t }),
      409, 'deployment_environment_taken', { environment: 'prod' });

    const server = await seedAsset(runner, t, 'srv-1');
    await expectCoded(() => assignments.create(prod, null, null, { manager: m, tenantId: t }), 400, 'body_required');
    await expectCoded(() => assignments.create(prod, { role: 'app' }, null, { manager: m, tenantId: t }), 400, 'asset_required');
    await expectCoded(() => assignments.create(prod, { server_id: server, role: 'nope' }, null, { manager: m, tenantId: t }),
      400, 'assignment_role_invalid', { value: 'nope' });
    await expectCoded(() => assignments.create(prod, { server_id: server, role: '' }, null, { manager: m, tenantId: t }),
      400, 'assignment_role_invalid');
    await expectCoded(() => assignments.create(prod, { server_id: server, role: 'app', since_date: '2026-13-45' }, null, { manager: m, tenantId: t }),
      400, 'date_invalid', { field: 'since_date', value: '2026-13-45' });
    assert.equal((await runner.query(`SELECT count(*)::int AS n FROM app_asset_assignments WHERE tenant_id = $1`, [t]))[0].n, 0,
      'a date that is not a date saves nothing');

    const created = await assignments.create(prod, { server_id: server, role: 'app', since_date: '2026-01-15' }, null, { manager: m, tenantId: t });
    assert.equal(new Date(created.since_date as any).toISOString().slice(0, 10), '2026-01-15');
    assert.equal(created.tenant_id, t, 'the assignment carries the request tenant');
    assert.equal((await instances.list(app, { manager: m, tenantId: t }))[0].tenant_id, t, 'the deployment carries the request tenant');
    await expectCoded(() => assignments.update(prod, created.id, { asset_id: '' }, null, { manager: m, tenantId: t }), 400, 'asset_required');
    await expectCoded(() => assignments.create(prod, { server_id: server, role: 'app' }, null, { manager: m, tenantId: t }),
      409, 'assignment_duplicate');
    await expectCoded(() => assignments.update(prod, created.id, { since_date: 'tomorrow' }, null, { manager: m, tenantId: t }),
      400, 'date_invalid', { field: 'since_date', value: 'tomorrow' });
    const cleared = await assignments.update(prod, created.id, { since_date: null }, null, { manager: m, tenantId: t });
    assert.equal(cleared.since_date, null, 'an empty date still clears it');

    await expectCoded(() => instances.delete(prod, null, { manager: m, tenantId: t }), 409, 'DEPLOYMENT_IN_USE');
  });
}

async function testServersOfAllDeployments() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const { assignments, instances, calls } = services(m);
    const app = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'CRM') RETURNING id`, [t]);
    const other = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Other') RETURNING id`, [t]);
    const prod = (await instances.create(app, { environment: 'prod' }, null, { manager: m, tenantId: t })).id;
    const dev = (await instances.create(app, { environment: 'dev' }, null, { manager: m, tenantId: t })).id;
    const otherProd = (await instances.create(other, { environment: 'prod' }, null, { manager: m, tenantId: t })).id;
    const a = await seedAsset(runner, t, 'srv-a');
    const b = await seedAsset(runner, t, 'srv-b');
    await assignments.create(prod, { server_id: a, role: 'app' }, null, { manager: m, tenantId: t });
    await assignments.create(prod, { server_id: b, role: 'db' }, null, { manager: m, tenantId: t });
    await assignments.create(dev, { server_id: a, role: 'app' }, null, { manager: m, tenantId: t });
    await assignments.create(otherProd, { server_id: b, role: 'app' }, null, { manager: m, tenantId: t });

    calls.forWrite = 0;
    const all = await assignments.listByApplication(app, { manager: m, tenantId: t });
    assert.deepEqual(
      all.items.map((row) => [row.app_instance_id === prod ? 'prod' : row.app_instance_id === dev ? 'dev' : 'other', row.server.name, row.role]).sort(),
      [['dev', 'srv-a', 'app'], ['prod', 'srv-a', 'app'], ['prod', 'srv-b', 'db']],
      'the servers of every deployment of the application, and only those',
    );
    const sequential = (await runner.query(`SELECT sequential_id FROM applications WHERE id = $1`, [app]))[0]?.sequential_id;
    if (sequential) {
      assert.equal((await assignments.listByApplication(sequential, { manager: m, tenantId: t })).items.length, 3, 'found by its reference');
    }
    const single = await assignments.list(prod, { manager: m, tenantId: t });
    assert.equal(single.items.length, 2);
    assert.equal(calls.forWrite, 0, 'a read takes no lock on the tenant row');
    const byApps = await assignments.listAssetsByApps([app], ['prod'], { manager: m, tenantId: t });
    assert.deepEqual(byApps.items.map((row) => row.name), ['srv-a', 'srv-b'], 'the servers of the chosen deployments');

    // A real second tenant names nothing here, even with this tenant's ids, under its own context.
    const stranger = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Deployment servers (other)', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [stranger, `dep-servers-other-${stranger.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [stranger]);
    const strangerApp = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Stranger') RETURNING id`, [stranger]);
    assert.equal((await instances.list(strangerApp, { manager: m, tenantId: stranger })).length, 0, 'the second tenant reads its own application');
    await assert.rejects(() => assignments.list(prod, { manager: m, tenantId: stranger }), /App instance not found/);
    await assert.rejects(() => assignments.listByApplication(app, { manager: m, tenantId: stranger }), /Application not found/);
    await assert.rejects(() => instances.delete(prod, null, { manager: m, tenantId: stranger }), /App instance not found/);
    assert.deepEqual((await assignments.listAssetsByApps([app], ['prod'], { manager: m, tenantId: stranger })).items, [],
      'the servers of another tenant\'s deployments are not listed');
    // The tenant comes from the transaction when the caller names none.
    assert.deepEqual((await assignments.listAssetsByApps([app], ['prod'], { manager: m })).items, []);
  });
}

async function testClusterWithoutSiteTakesItsMembersHosting() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const { assignments, instances } = services(m);
    const app = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [t]);
    const prod = (await instances.create(app, { environment: 'prod' }, null, { manager: m, tenantId: t })).id;
    const site = await one(runner,
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Paris', 'on_prem', 'LOC-PAR') RETURNING id`,
      [t]);
    const cluster = await seedAsset(runner, t, 'cluster-1', true);
    const member = await seedAsset(runner, t, 'member-1');
    const retired = await seedAsset(runner, t, 'member-retired');
    await runner.query(`UPDATE assets SET location_id = $3 WHERE tenant_id = $1 AND id = $2`, [t, member, site]);
    await runner.query(`UPDATE assets SET location_id = $3, status = 'retired' WHERE tenant_id = $1 AND id = $2`, [t, retired, site]);
    await runner.query(
      `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
      [t, cluster, member, retired],
    );
    await assignments.create(prod, { server_id: cluster, role: 'app' }, null, { manager: m, tenantId: t });

    const row = (await assignments.list(prod, { manager: m, tenantId: t })).items.find((item: any) => item.asset_id === cluster) as any;
    // The cluster has no site: its member in service gives the hosting type, not the generic cloud default.
    assert.deepEqual(row.hosting, { code: 'on_prem', label: 'On-prem', source: 'member' });
  });
}

async function run() {
  await dataSource.initialize();
  try {
    for (const test of [testCodedRefusals, testServersOfAllDeployments, testClusterWithoutSiteTakesItsMembersHosting]) {
      await test();
      console.log(`  ok ${test.name}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('deployment-servers.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
