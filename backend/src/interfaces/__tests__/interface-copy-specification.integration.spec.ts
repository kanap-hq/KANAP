import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Application } from '../../applications/application.entity';
import { ApplicationsLifecycleService } from '../../applications/services/applications-lifecycle.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { InterfacesCrudService } from '../services/interfaces-crud.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { Document } from '../../knowledge/document.entity';
import { DocumentActivity } from '../../knowledge/document-activity.entity';
import { DocumentApplication } from '../../knowledge/document-application.entity';
import { DocumentAsset } from '../../knowledge/document-asset.entity';
import { DocumentAttachment } from '../../knowledge/document-attachment.entity';
import { DocumentClassification } from '../../knowledge/document-classification.entity';
import { DocumentContributor } from '../../knowledge/document-contributor.entity';
import { DocumentEditLock } from '../../knowledge/document-edit-lock.entity';
import { DocumentFolder } from '../../knowledge/document-folder.entity';
import { DocumentLibrary } from '../../knowledge/document-library.entity';
import { DocumentProject } from '../../knowledge/document-project.entity';
import { DocumentReference } from '../../knowledge/document-reference.entity';
import { DocumentRequest } from '../../knowledge/document-request.entity';
import { DocumentTask } from '../../knowledge/document-task.entity';
import { DocumentType } from '../../knowledge/document-type.entity';
import { DocumentVersion } from '../../knowledge/document-version.entity';
import { IntegratedDocumentBinding } from '../../knowledge/integrated-document-binding.entity';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';

// Duplicating an interface, and migrating it onto a new application version, gives the copy its
// own `INT-n` reference and its own specification document with the source's text. A missing
// interface id stays empty. Rolled-back transaction, throwaway tenant.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type SpecDoc = { id: string; title: string; content_markdown: string };

function createIntegrated(manager: QueryRunner['manager']): IntegratedDocumentsService {
  const permissions = new PermissionsService(
    manager.getRepository(UserPageRole),
    manager.getRepository(RolePermission),
  );
  const users: any = {
    findById: async (id: string, opts?: any) => (opts?.manager ?? manager)
      .getRepository(User)
      .findOne({ where: { id }, relations: ['role'] }),
  };
  const storage: any = {
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    getObjectStream: async () => ({ stream: null, contentType: null, contentLength: null }),
  };
  const knowledge = new KnowledgeService(
    manager.getRepository(Document),
    manager.getRepository(DocumentFolder),
    manager.getRepository(IntegratedDocumentBinding),
    manager.getRepository(DocumentLibrary),
    manager.getRepository(DocumentType),
    manager.getRepository(DocumentVersion),
    manager.getRepository(DocumentEditLock),
    manager.getRepository(DocumentAttachment),
    manager.getRepository(DocumentActivity),
    manager.getRepository(DocumentContributor),
    manager.getRepository(DocumentClassification),
    manager.getRepository(DocumentReference),
    manager.getRepository(DocumentApplication),
    manager.getRepository(DocumentAsset),
    manager.getRepository(DocumentProject),
    manager.getRepository(DocumentRequest),
    manager.getRepository(DocumentTask),
    new ItemNumberService() as any,
    { log: async () => undefined } as any,
    {} as any,
    {} as any,
    storage,
    {} as any,
    dataSource,
    permissions,
    users,
    {} as any,
    { notifyShare: async () => undefined } as any,
  );
  return new IntegratedDocumentsService(
    manager.getRepository(IntegratedDocumentBinding),
    knowledge,
    permissions,
    { convertToMarkdown: async () => ({ markdown: '', images: [], warnings: [], omittedTargets: [] }) } as any,
  );
}

async function withRollback(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Interface copy', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `iface-copy-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function specificationOf(runner: QueryRunner, tenantId: string, interfaceId: string): Promise<SpecDoc | undefined> {
  const [row] = await runner.query(
    `SELECT d.id::text AS id, d.title, d.content_markdown
     FROM integrated_document_bindings b
     JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1
       AND b.source_entity_type = 'interfaces'
       AND b.source_entity_id = $2
       AND b.slot_key = 'specification'`,
    [tenantId, interfaceId],
  );
  return row as SpecDoc | undefined;
}

async function testDuplicateAndMigrateKeepTheSpecification() {
  await withRollback(async (runner, tenantId) => {
    const manager = runner.manager;
    const integrated = createIntegrated(manager);
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const sourceApp = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'CRM') RETURNING id`, [tenantId]);
    const targetApp = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [tenantId]);

    const insertInterface = async (name: string, interfaceId: string | null) => {
      const [row] = await runner.query(
        `INSERT INTO interfaces (
           tenant_id, name, business_purpose, source_application_id, target_application_id,
           data_category, integration_route_type, lifecycle, interface_id
         ) VALUES ($1, $2, 'Sync', $3, $4, 'master_data', 'direct', 'active', $5)
         RETURNING id::text AS id, tenant_id::text AS tenant_id, name, interface_reference`,
        [tenantId, name, sourceApp, targetApp, interfaceId],
      );
      return {
        id: row.id as string,
        tenant_id: row.tenant_id as string,
        item_number: null as number | null,
        name: row.name as string,
        reference_label: row.interface_reference as string,
        interface_reference: row.interface_reference as string,
      };
    };

    const orders = await insertInterface('Orders', null);
    const billing = await insertInterface('Billing', 'BILL-1');
    const ordersText = 'Orders specification, edited by hand.';
    const billingText = 'Billing specification, edited by hand.';
    await integrated.writeSourceSlotContent('interfaces', orders, 'specification', ordersText, null, { manager });
    await integrated.writeSourceSlotContent('interfaces', billing, 'specification', billingText, null, { manager });

    const audit = new AuditService(manager.getRepository(AuditLog));
    const crud = Object.create(InterfacesCrudService.prototype) as InterfacesCrudService;
    Object.assign(crud, {
      audit,
      interfaceMappings: { cloneInterfaceMappings: async () => undefined },
      integratedDocuments: integrated,
    });

    const ordersCopy = await crud.duplicate(orders.id, tenantId, null, { manager });
    const billingCopy = await crud.duplicate(billing.id, tenantId, null, { manager });

    assert.match(ordersCopy.interface_reference, /^INT-\d+$/);
    assert.notEqual(ordersCopy.interface_reference, orders.interface_reference, 'the duplicate gets its own reference');
    assert.equal(ordersCopy.interface_id, null, 'a missing interface id stays empty');
    assert.equal(billingCopy.interface_id, 'BILL-1-copy');
    const [ordersAudit] = await runner.query(
      `SELECT after_json->>'interface_reference' AS ref
       FROM audit_log
       WHERE tenant_id = $1 AND table_name = 'interfaces' AND record_id = $2 AND action = 'create'`,
      [tenantId, ordersCopy.id],
    );
    assert.equal(ordersAudit.ref, ordersCopy.interface_reference, 'the audit entry carries INT-n');

    const ordersDoc = await specificationOf(runner, tenantId, ordersCopy.id);
    const billingDoc = await specificationOf(runner, tenantId, billingCopy.id);
    assert.equal(ordersDoc?.content_markdown, ordersText);
    assert.equal(billingDoc?.content_markdown, billingText);
    assert.equal(ordersDoc?.title, `${ordersCopy.interface_reference} - Orders - copy - Specification`);
    const ordersSource = await specificationOf(runner, tenantId, orders.id);
    assert.notEqual(ordersDoc?.id, ordersSource?.id, 'the duplicate has its own document');
    assert.equal(ordersSource?.content_markdown, ordersText, 'the source specification is left as it is');

    const settings = new ItOpsSettingsService(
      manager.getRepository(Tenant),
      manager.getRepository(Location),
      audit,
    );
    const lifecycle = new ApplicationsLifecycleService(
      manager.getRepository(Application),
      audit,
      { cloneInterfaceMappings: async () => undefined } as any,
      settings,
      integrated,
    );
    const version = await lifecycle.createVersion(
      sourceApp,
      { name: 'CRM 2', interfaceIds: [orders.id, billing.id] } as any,
      null,
      { manager },
    );
    const migrated = await runner.query(
      `SELECT id::text AS id, name, interface_reference, interface_id
       FROM interfaces
       WHERE tenant_id = $1 AND source_application_id = $2
       ORDER BY name`,
      [tenantId, version.id],
    );
    assert.equal(migrated.length, 2);
    const migratedBilling = migrated.find((row: any) => row.name === 'Billing (new version)');
    const migratedOrders = migrated.find((row: any) => row.name === 'Orders (new version)');
    assert.ok(migratedOrders && migratedBilling);
    assert.equal(migratedOrders.interface_id, null, 'a missing interface id stays empty on the new version');
    assert.equal(migratedBilling.interface_id, 'BILL-1 (new version)');
    assert.match(migratedOrders.interface_reference, /^INT-\d+$/);
    assert.notEqual(migratedOrders.interface_reference, orders.interface_reference);
    assert.notEqual(migratedOrders.interface_reference, ordersCopy.interface_reference);

    const migratedOrdersDoc = await specificationOf(runner, tenantId, migratedOrders.id);
    const migratedBillingDoc = await specificationOf(runner, tenantId, migratedBilling.id);
    assert.equal(migratedOrdersDoc?.content_markdown, ordersText);
    assert.equal(migratedBillingDoc?.content_markdown, billingText);
    assert.equal(migratedOrdersDoc?.title, `${migratedOrders.interface_reference} - Orders (new version) - Specification`);
    assert.notEqual(migratedOrdersDoc?.id, ordersSource?.id);
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testDuplicateAndMigrateKeepTheSpecification();
    console.log('  ok testDuplicateAndMigrateKeepTheSpecification');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
}

run()
  .then(() => console.log('interface-copy-specification.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
