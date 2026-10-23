import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { InterfacesCrudService } from '../services/interfaces-crud.service';

// A new interface gets its `INT-n` reference from a database trigger. The specification document
// is provisioned right after the save, so the service must read that reference back: the document
// title then starts with `INT-n`, not with the interface id. Rolled-back transaction, throwaway tenant.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function withRollback(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Interface reference', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `iface-ref-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testCreateReadsTheReferenceBack() {
  await withRollback(async (runner, tenantId) => {
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const source = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'CRM') RETURNING id`, [tenantId]);
    const target = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [tenantId]);
    const provisioned: Array<{ reference_label?: string | null; name: string }> = [];
    const svc = Object.create(InterfacesCrudService.prototype) as InterfacesCrudService;
    // Only the save and the provisioning matter here: the settings-driven steps are stubbed.
    Object.assign(svc, {
      audit: { log: async () => undefined },
      interfaceMappings: { ensureDefaultSetForInterface: async () => undefined },
      integratedDocuments: { provisionForInterface: async (descriptor: any) => { provisioned.push(descriptor); } },
      ensureApplication: async (id: string) => ({ id }),
      computeDefaultLifecycle: () => 'active',
      computeDefaultCriticality: async () => ({ code: 'medium', incomplete: false }),
      normalizeLifecycle: async () => 'active',
      normalizeDataCategory: async () => 'master_data',
      normalizeDataClass: async () => null,
      syncMiddlewareApplications: async () => undefined,
      createDefaultLegs: async () => undefined,
    });

    const saved = await svc.create(
      { name: 'Orders', business_purpose: 'Sync', source_application_id: source, target_application_id: target },
      tenantId, null, { manager: runner.manager },
    );
    const [stored] = await runner.query(`SELECT interface_reference FROM interfaces WHERE id = $1 AND tenant_id = $2`, [saved.id, tenantId]);
    assert.match(stored.interface_reference, /^INT-\d+$/, 'the trigger gives the reference');
    assert.equal(saved.interface_reference, stored.interface_reference, 'the created interface carries it');
    assert.equal(provisioned.length, 1);
    assert.equal(provisioned[0].reference_label, stored.interface_reference, 'the specification is titled with INT-n, not the id');
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testCreateReadsTheReferenceBack();
    console.log('  ok testCreateReadsTheReferenceBack');
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('interface-create-reference.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
