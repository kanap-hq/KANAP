import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { InterfacesListService } from '../services/interfaces-list.service';
import { InterfacesController } from '../interfaces.controller';

// The Interfaces tab of an application (recette C1b, decision D8): one row per interface and
// environment it is bound in, plus one row without environment for an interface the application is
// the source or target of that has no binding yet. The middleware of an unbound interface does not
// list it; the middleware and the integration tool of a bound interface do, for the environments
// they take part in. A Business Contributor gets nothing. Runs under a throwaway tenant in a
// rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const t = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Interfaces by application', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [t, `if-by-app-${t.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [t]);
    const app = (name: string) => one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [t, name]);
    const crm = await app('CRM');
    const erp = await app('ERP');
    const esb = await app('ESB');
    const broker = await app('Broker');
    const ipaas = await app('iPaaS');
    const instance = (application: string, environment: string) => one(runner,
      `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, $3) RETURNING id`, [t, application, environment]);
    const crmProd = await instance(crm, 'prod');
    const erpProd = await instance(erp, 'prod');
    const crmTest = await instance(crm, 'test');
    const erpTest = await instance(erp, 'test');
    const iface = (name: string, ref: string, source: string, target: string) => one(runner,
      `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category,
         integration_route_type, interface_reference)
       VALUES ($1, $2, 'Sync', $3, $4, 'master_data', 'direct', $5) RETURNING id`, [t, name, source, target, ref]);
    const bound = await iface('Orders', 'INT-9101', crm, erp);
    const unbound = await iface('Invoices', 'INT-9102', erp, crm);
    await runner.query(
      `INSERT INTO interface_middleware_applications (tenant_id, interface_id, application_id) VALUES ($1, $2, $3)`, [t, unbound, esb]);
    const leg = await one(runner,
      `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index)
       VALUES ($1, $2, 'direct', 'source', 'target', 'event', 'api', 'json', 0) RETURNING id`, [t, bound]);
    await runner.query(
      `INSERT INTO interface_middleware_applications (tenant_id, interface_id, application_id) VALUES ($1, $2, $3)`, [t, bound, broker]);
    for (const [environment, from, to, tool] of [['prod', crmProd, erpProd, ipaas], ['test', crmTest, erpTest, null]]) {
      await runner.query(
        `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id,
           integration_tool_application_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [t, bound, leg, environment, from, to, tool]);
    }

    const svc = new InterfacesListService(null as any, null as any, null as any, null as any, null as any, null as any);
    const rows = (await svc.listByApplication(crm, t, { manager: runner.manager })).items;
    assert.deepEqual(
      rows.map((row) => `${row.name}:${row.environment}`).sort(),
      ['Invoices:null', 'Orders:prod', 'Orders:test'],
      'the bound interface once per environment, the unbound one once without environment',
    );
    assert.equal(new Set(rows.map((row) => row.id)).size, 2, 'two distinct interfaces');
    const unboundRow = rows.find((row) => row.id === unbound)!;
    assert.equal(unboundRow.source_application_name, 'ERP');
    assert.equal(unboundRow.target_application_name, 'CRM');
    // The counterpart links use the business reference of each application.
    assert.match(String(unboundRow.source_application_reference), /^APP-\d+$/);
    assert.match(String(unboundRow.target_application_reference), /^APP-\d+$/);

    const forTarget = (await svc.listByApplication(erp, t, { manager: runner.manager })).items;
    assert.deepEqual(forTarget.map((row) => `${row.name}:${row.environment}`).sort(), ['Invoices:null', 'Orders:prod', 'Orders:test']);
    const forMiddleware = (await svc.listByApplication(esb, t, { manager: runner.manager })).items;
    assert.deepEqual(forMiddleware, [], 'the middleware of an unbound interface does not list it');
    const forBoundMiddleware = (await svc.listByApplication(broker, t, { manager: runner.manager })).items;
    assert.deepEqual(forBoundMiddleware.map((row) => `${row.name}:${row.environment}`).sort(), ['Orders:prod', 'Orders:test'],
      'the middleware of a bound interface lists it in every environment');
    assert.ok(forBoundMiddleware.every((row) => row.via_middleware && row.middleware_application_names.includes('Broker')));
    const forTool = (await svc.listByApplication(ipaas, t, { manager: runner.manager })).items;
    assert.deepEqual(forTool.map((row) => `${row.name}:${row.environment}`), ['Orders:prod'],
      'the integration tool lists the interface in the environment it carries');
    assert.ok(forTool[0].via_middleware);
    console.log('  ok listByApplication');

    // A Business Contributor (here no participant of CRM) gets nothing from the route.
    const role = await one(runner, `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
      VALUES ($1, 'Business Contributor', '', false, false, now(), now()) RETURNING id`, [t]);
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'applications', 'reader')`, [t, role]);
    const contributor = await one(runner, `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, created_at, updated_at)
      VALUES ($1, 'Bea', 'Contributor', $2, $3, false, 'enabled', now(), now()) RETURNING id`, [t, `bea-${t.slice(0, 8)}@example.com`, role]);
    const controller = Object.create(InterfacesController.prototype) as InterfacesController;
    let served = false;
    Object.assign(controller, { svc: { listByApplication: async () => { served = true; return { items: rows }; } } });
    await assert.rejects(
      () => controller.listByApplication(crm, { tenantId: t, userId: contributor, manager: runner.manager } as any),
      (err: any) => err?.getStatus?.() === 403,
    );
    assert.equal(served, false, 'the list is never read for a Business Contributor');
    console.log('  ok Business Contributor');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('interfaces-by-application.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
