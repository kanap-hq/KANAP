import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Application } from '../../applications/application.entity';
import { ApplicationsDeleteService } from '../../applications/applications-delete.service';
import { BusinessProcess } from '../../business-processes/business-process.entity';
import { BusinessProcessesDeleteService } from '../../business-processes/business-processes-delete.service';
import { Connection } from '../../connections/connection.entity';
import { ConnectionsCrudService } from '../../connections/services/connections-crud.service';
import { ExternalContact } from '../../contacts/external-contact.entity';
import { ContactsDeleteService } from '../../contacts/contacts-delete.service';
import { SupplierContactLink } from '../../contacts/supplier-contact.entity';
import { Role } from '../../roles/role.entity';
import { RolesController } from '../../roles/roles.controller';
import { UserRole } from '../../users/user-role.entity';

// Every delete answers in the shape the list's delete button reads, with codes the interface
// translates: a bulk delete names the deleted ids (`deleted: string[]`) and gives each failed item
// a code (`not_found` for a record gone meanwhile), and a single delete of an unknown record is a
// 404. Each test runs under a throwaway tenant in a rolled-back transaction.
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
       VALUES ($1, $2, 'Delete failures', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `del-failures-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testConnectionsBulkNamesTheDeletedIds() {
  await withRollback(async (runner, t) => {
    const [row] = await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, connection_reference, source_entity_code, destination_entity_code)
       VALUES ($1, 'Flow', 'point_to_point', 'CONN-1', 'internet', 'internet') RETURNING id`,
      [t],
    );
    const svc = new ConnectionsCrudService(runner.manager.getRepository(Connection), null as any, null as any, null as any, null as any, null as any, noAudit);
    const result = await svc.bulkDelete([row.id], null, { manager: runner.manager });
    assert.deepEqual(result, { deleted: [row.id], failed: [] });
  });
}

async function testBulkFailuresCarryNotFound() {
  await withRollback(async (runner) => {
    const m = runner.manager;
    const gone = randomUUID();
    const services: Array<[string, () => Promise<{ failed: Array<{ id: string; code?: string }> }>]> = [
      ['applications', () => new ApplicationsDeleteService(m.getRepository(Application), noAudit, null as any).bulkDelete([gone], null, { manager: m })],
      ['contacts', () => new ContactsDeleteService(m.getRepository(ExternalContact), m.getRepository(SupplierContactLink), noAudit).bulkDelete([gone], { manager: m })],
      ['business processes', () => new BusinessProcessesDeleteService(m.getRepository(BusinessProcess), noAudit).bulkDelete([gone], null, { manager: m })],
    ];
    for (const [name, run] of services) {
      const { failed } = await run();
      assert.equal(failed.length, 1, name);
      assert.equal(failed[0].code, 'not_found', `${name}: a code the interface translates`);
    }
  });
}

async function testContactFailureNamedByName() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const [named] = await runner.query(
      `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Ada', 'Lovelace', 'ada@example.com') RETURNING id`,
      [t],
    );
    const [bare] = await runner.query(
      `INSERT INTO contacts (tenant_id, email) VALUES ($1, 'nobody@example.com') RETURNING id`,
      [t],
    );
    const svc = new ContactsDeleteService(m.getRepository(ExternalContact), m.getRepository(SupplierContactLink), noAudit);
    (svc as any).delete = async () => {
      throw new Error('refused');
    };
    const { failed } = await svc.bulkDelete([named.id, bare.id], { manager: m });
    assert.deepEqual(
      failed.map((f: any) => f.name),
      ['Ada Lovelace', 'nobody@example.com'],
      'a failed contact is named by its name, its email only when it has none',
    );
  });
}

async function testUnknownRoleIsNotFound() {
  await withRollback(async (runner) => {
    const m = runner.manager;
    const roles = new RolesController(null as any, null as any, m.getRepository(Role), null as any, m.getRepository(UserRole), noAudit);
    await assert.rejects(() => roles.deleteRole(randomUUID(), { queryRunner: runner, user: { sub: randomUUID() } }), NotFoundException);
  });
}

async function main() {
  await dataSource.initialize();
  try {
    for (const test of [testConnectionsBulkNamesTheDeletedIds, testBulkFailuresCarryNotFound, testContactFailureNamedByName, testUnknownRoleIsNotFound]) {
      await test();
    }
    console.log('delete-failures.integration.spec: ok');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
