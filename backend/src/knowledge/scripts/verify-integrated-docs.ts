/**
 * Integrated-document verification, run after the repair. Compiled with the API
 * (`dist/knowledge/scripts/`): the image entrypoint (scripts/migrate-and-start.js) runs it with
 * `node`, and `npm run integrated-docs:verify` runs it by hand.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';
import { AppModule } from '../../app.module';
import { IntegratedDocumentsService } from '../integrated-documents.service';
import { withTenant } from '../../common/tenant-runner';

type TenantRow = {
  id: string;
  slug: string;
};

type EntityIdRow = {
  id: string;
};

/** Entity families this script verifies, in processing order. */
const SUPPORTED_SOURCE_ENTITY_TYPES = ['requests', 'projects', 'incidents'] as const;
type SupportedSourceEntityType = (typeof SUPPORTED_SOURCE_ENTITY_TYPES)[number];
type SourceTableName = 'portfolio_requests' | 'portfolio_projects' | 'incidents';

const SOURCE_TABLES: Record<SupportedSourceEntityType, SourceTableName> = {
  requests: 'portfolio_requests',
  projects: 'portfolio_projects',
  incidents: 'incidents',
};

const DEFAULT_BATCH_SIZE = 200;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function resolveTenants(dataSource: DataSource): Promise<TenantRow[]> {
  const tenantSlugFilter = String(process.env.INTEGRATED_DOCS_TENANT_SLUG || '').trim();
  const tenantIdFilter = String(process.env.INTEGRATED_DOCS_TENANT_ID || '').trim();

  if (tenantIdFilter) {
    return dataSource.query(
      `SELECT id::text AS id, COALESCE(slug, '')::text AS slug
       FROM tenants
       WHERE id = $1
         AND deleted_at IS NULL
         AND status = 'active'
       ORDER BY slug`,
      [tenantIdFilter],
    ) as Promise<TenantRow[]>;
  }

  if (tenantSlugFilter) {
    return dataSource.query(
      `SELECT id::text AS id, COALESCE(slug, '')::text AS slug
       FROM tenants
       WHERE slug = $1
         AND deleted_at IS NULL
         AND status = 'active'
       ORDER BY slug`,
      [tenantSlugFilter],
    ) as Promise<TenantRow[]>;
  }

  return dataSource.query(
    `SELECT id::text AS id, COALESCE(slug, '')::text AS slug
     FROM tenants
     WHERE deleted_at IS NULL
       AND status = 'active'
     ORDER BY slug`,
  ) as Promise<TenantRow[]>;
}

async function loadEntityIdBatch(
  manager: EntityManager,
  tableName: SourceTableName,
  batchSize: number,
  cursorId: string | null,
): Promise<EntityIdRow[]> {
  const paginationClause = cursorId ? 'AND id::text > $2' : '';
  const params = cursorId ? [batchSize, cursorId] : [batchSize];
  return manager.query(
    `SELECT id::text AS id
     FROM ${tableName}
     WHERE tenant_id = app_current_tenant()
       ${paginationClause}
     ORDER BY id::text ASC
     LIMIT $1`,
    params,
  ) as Promise<EntityIdRow[]>;
}

async function verifyStructuralCounts(manager: EntityManager, tenantLabel: string): Promise<void> {
  const [requestCountRow] = await manager.query<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM portfolio_requests
     WHERE tenant_id = app_current_tenant()`,
  );
  const [projectCountRow] = await manager.query<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM portfolio_projects
     WHERE tenant_id = app_current_tenant()`,
  );
  const [requestPurposeBindingCountRow] = await manager.query<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM integrated_document_bindings
     WHERE tenant_id = app_current_tenant()
       AND source_entity_type = 'requests'
       AND slot_key = 'purpose'`,
  );
  const [requestRisksBindingCountRow] = await manager.query<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM integrated_document_bindings
     WHERE tenant_id = app_current_tenant()
       AND source_entity_type = 'requests'
       AND slot_key = 'risks_mitigations'`,
  );
  const [projectPurposeBindingCountRow] = await manager.query<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM integrated_document_bindings
     WHERE tenant_id = app_current_tenant()
       AND source_entity_type = 'projects'
       AND slot_key = 'purpose'`,
  );
  const [incidentCountRow] = await manager.query<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM incidents
     WHERE tenant_id = app_current_tenant()`,
  );
  const [incidentReviewBindingCountRow] = await manager.query<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count
     FROM integrated_document_bindings
     WHERE tenant_id = app_current_tenant()
       AND source_entity_type = 'incidents'
       AND slot_key = 'review'`,
  );

  const requestCount = Number(requestCountRow?.count || 0);
  const projectCount = Number(projectCountRow?.count || 0);
  const requestPurposeBindings = Number(requestPurposeBindingCountRow?.count || 0);
  const requestRisksBindings = Number(requestRisksBindingCountRow?.count || 0);
  const projectPurposeBindings = Number(projectPurposeBindingCountRow?.count || 0);
  const incidentCount = Number(incidentCountRow?.count || 0);
  const incidentReviewBindings = Number(incidentReviewBindingCountRow?.count || 0);

  if (requestCount !== requestPurposeBindings) {
    throw new Error(`Tenant ${tenantLabel}: request-purpose bindings ${requestPurposeBindings} != requests ${requestCount}`);
  }
  if (requestCount !== requestRisksBindings) {
    throw new Error(`Tenant ${tenantLabel}: request-risks bindings ${requestRisksBindings} != requests ${requestCount}`);
  }
  if (projectCount !== projectPurposeBindings) {
    throw new Error(`Tenant ${tenantLabel}: project-purpose bindings ${projectPurposeBindings} != projects ${projectCount}`);
  }
  if (incidentCount !== incidentReviewBindings) {
    throw new Error(`Tenant ${tenantLabel}: incident-review bindings ${incidentReviewBindings} != incidents ${incidentCount}`);
  }

  const duplicateBindingRows = await manager.query<Array<{
    source_entity_type: string;
    source_entity_id: string;
    slot_key: string;
    count: string;
  }>>(
    `SELECT source_entity_type,
            source_entity_id::text AS source_entity_id,
            slot_key,
            COUNT(*)::text AS count
     FROM integrated_document_bindings
     WHERE tenant_id = app_current_tenant()
     GROUP BY source_entity_type, source_entity_id, slot_key
     HAVING COUNT(*) > 1
     LIMIT 1`,
  );
  if (duplicateBindingRows.length > 0) {
    const duplicate = duplicateBindingRows[0];
    throw new Error(
      `Tenant ${tenantLabel}: duplicate binding for ${duplicate.source_entity_type}:${duplicate.slot_key}:${duplicate.source_entity_id} (${duplicate.count})`,
    );
  }

  const duplicateDocumentRows = await manager.query<Array<{ document_id: string; count: string }>>(
    `SELECT document_id::text AS document_id,
            COUNT(*)::text AS count
     FROM integrated_document_bindings
     WHERE tenant_id = app_current_tenant()
     GROUP BY document_id
     HAVING COUNT(*) > 1
     LIMIT 1`,
  );
  if (duplicateDocumentRows.length > 0) {
    const duplicate = duplicateDocumentRows[0];
    throw new Error(`Tenant ${tenantLabel}: document ${duplicate.document_id} is bound ${duplicate.count} times`);
  }
}

async function verifyEntityBatch(
  dataSource: DataSource,
  tenantId: string,
  batchSize: number,
  cursorId: string | null,
  sourceEntityType: SupportedSourceEntityType,
  integratedDocs: IntegratedDocumentsService,
): Promise<{ rowsVerified: number; lastCursor: string | null }> {
  const tableName = SOURCE_TABLES[sourceEntityType];
  const ids = await withTenant(dataSource, tenantId, async (manager) => (
    loadEntityIdBatch(manager, tableName, batchSize, cursorId)
  ));

  for (const row of ids) {
    await withTenant(dataSource, tenantId, async (manager) => (
      integratedDocs.verifySourceEntity(sourceEntityType, row.id, { manager })
    ));
  }

  return {
    rowsVerified: ids.length,
    lastCursor: ids.length > 0 ? ids[ids.length - 1].id : null,
  };
}

async function main() {
  const batchSize = readPositiveInt(process.env.INTEGRATED_DOCS_VERIFY_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);
    const integratedDocs = app.get(IntegratedDocumentsService);
    const tenants = await resolveTenants(dataSource);

    if (tenants.length === 0) {
      throw new Error('No tenants found for integrated-doc verification scope');
    }

    console.log(`Verifying integrated docs for tenants: ${tenants.map((tenant) => tenant.slug || tenant.id).join(', ')}`);
    console.log(`Batch size: ${batchSize}`);

    const totalVerifiedByType: Record<SupportedSourceEntityType, number> = {
      requests: 0,
      projects: 0,
      incidents: 0,
    };

    for (const tenant of tenants) {
      const tenantLabel = tenant.slug || tenant.id;
      console.log(`\nTenant: ${tenantLabel}`);

      await withTenant(dataSource, tenant.id, async (manager) => {
        await verifyStructuralCounts(manager, tenantLabel);
      });
      console.log('  structural counts: OK');

      for (const sourceEntityType of SUPPORTED_SOURCE_ENTITY_TYPES) {
        let cursor: string | null = null;
        while (true) {
          const batchResult = await verifyEntityBatch(
            dataSource,
            tenant.id,
            batchSize,
            cursor,
            sourceEntityType,
            integratedDocs,
          );
          if (batchResult.rowsVerified === 0) {
            break;
          }

          totalVerifiedByType[sourceEntityType] += batchResult.rowsVerified;
          cursor = batchResult.lastCursor;
          console.log(`  verified ${sourceEntityType} batch: rows=${batchResult.rowsVerified}`);
        }
      }
    }

    console.log('\nVerification complete.');
    for (const sourceEntityType of SUPPORTED_SOURCE_ENTITY_TYPES) {
      console.log(`  ${sourceEntityType} rows verified: ${totalVerifiedByType[sourceEntityType]}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`Integrated-doc verification failed: ${message}`);
  process.exit(1);
});
