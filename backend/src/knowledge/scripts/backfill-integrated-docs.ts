/**
 * Integrated-document repair, for every active tenant (or the one INTEGRATED_DOCS_TENANT_SLUG or
 * INTEGRATED_DOCS_TENANT_ID names). Compiled with the API (`dist/knowledge/scripts/`): the image
 * entrypoint (scripts/migrate-and-start.js) runs it with `node` when INTEGRATED_DOCS_AUTO_ROLLOUT
 * asks for it, and `npm run integrated-docs:backfill` runs it by hand.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';
import { AppModule } from '../../app.module';
import { seedManagedDocsKnowledgeAssets } from '../integrated-document-seed';
import {
  IntegratedDocumentsService,
  RepairSourceEntityResult,
} from '../integrated-documents.service';
import { withTenant } from '../../common/tenant-runner';

type TenantRow = {
  id: string;
  slug: string;
};

type EntityIdRow = {
  id: string;
};

type BatchOutcome = {
  rowsScanned: number;
  slotsCreated: number;
  slotsExisting: number;
  relationsRepaired: number;
  auditRecovered: number;
  unresolvedInlineImages: number;
  errors: number;
  lastCursor: string | null;
};

/** Entity families this script repairs, in processing order. */
const SUPPORTED_SOURCE_ENTITY_TYPES = ['requests', 'projects', 'incidents'] as const;
type SupportedSourceEntityType = (typeof SUPPORTED_SOURCE_ENTITY_TYPES)[number];
type SourceTableName = 'portfolio_requests' | 'portfolio_projects' | 'incidents';

const SOURCE_TABLES: Record<SupportedSourceEntityType, SourceTableName> = {
  requests: 'portfolio_requests',
  projects: 'portfolio_projects',
  incidents: 'incidents',
};

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_PAUSE_MS = 0;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function seedTenantAssets(dataSource: DataSource, tenantId: string): Promise<void> {
  await withTenant(dataSource, tenantId, async (manager) => {
    await seedManagedDocsKnowledgeAssets(
      { query: manager.query.bind(manager) },
      tenantId,
    );
  });
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

function summarizeRepair(result: RepairSourceEntityResult) {
  return result.slots.reduce(
    (acc, slot) => {
      acc.slotsCreated += Number(slot.created);
      acc.slotsExisting += Number(!slot.created);
      acc.relationsRepaired += Number(slot.repairedRelation);
      acc.auditRecovered += Number(slot.recoveredFrom === 'audit');
      acc.unresolvedInlineImages += slot.unresolvedLegacyInlineAttachmentIds.length;
      return acc;
    },
    {
      slotsCreated: 0,
      slotsExisting: 0,
      relationsRepaired: 0,
      auditRecovered: 0,
      unresolvedInlineImages: 0,
    },
  );
}

async function processBatch(
  dataSource: DataSource,
  tenant: TenantRow,
  batchSize: number,
  cursorId: string | null,
  sourceEntityType: SupportedSourceEntityType,
  integratedDocs: IntegratedDocumentsService,
): Promise<BatchOutcome> {
  const tableName = SOURCE_TABLES[sourceEntityType];
  const ids = await withTenant(dataSource, tenant.id, async (manager) => (
    loadEntityIdBatch(manager, tableName, batchSize, cursorId)
  ));

  let slotsCreated = 0;
  let slotsExisting = 0;
  let relationsRepaired = 0;
  let auditRecovered = 0;
  let unresolvedInlineImages = 0;
  let errors = 0;

  for (const row of ids) {
    try {
      const result = await withTenant(dataSource, tenant.id, async (manager) => (
        // The backfill is the only caller allowed to mint a missing review for a
        // closed or cancelled incident; every lazy read path still refuses.
        integratedDocs.repairSourceEntity(sourceEntityType, row.id, { manager, allowFrozenIncident: true })
      ));
      const summary = summarizeRepair(result);
      slotsCreated += summary.slotsCreated;
      slotsExisting += summary.slotsExisting;
      relationsRepaired += summary.relationsRepaired;
      auditRecovered += summary.auditRecovered;
      unresolvedInlineImages += summary.unresolvedInlineImages;
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${sourceEntityType} ${row.id}: ${message}`);
    }
  }

  return {
    rowsScanned: ids.length,
    slotsCreated,
    slotsExisting,
    relationsRepaired,
    auditRecovered,
    unresolvedInlineImages,
    errors,
    lastCursor: ids.length > 0 ? ids[ids.length - 1].id : null,
  };
}

async function main() {
  const batchSize = readPositiveInt(process.env.INTEGRATED_DOCS_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const batchPauseMs = readPositiveInt(process.env.INTEGRATED_DOCS_BATCH_PAUSE_MS, DEFAULT_BATCH_PAUSE_MS);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);
    const integratedDocs = app.get(IntegratedDocumentsService);
    const tenants = await resolveTenants(dataSource);

    if (tenants.length === 0) {
      throw new Error('No tenants found for integrated-doc backfill scope');
    }

    console.log(`Repairing integrated docs for tenants: ${tenants.map((tenant) => tenant.slug || tenant.id).join(', ')}`);
    console.log(`Batch size: ${batchSize}${batchPauseMs > 0 ? `, pause: ${batchPauseMs}ms` : ''}`);

    const totalRowsByType: Record<SupportedSourceEntityType, number> = {
      requests: 0,
      projects: 0,
      incidents: 0,
    };
    let totalSlotsCreated = 0;
    let totalSlotsExisting = 0;
    let totalRelationsRepaired = 0;
    let totalAuditRecovered = 0;
    let totalUnresolvedInlineImages = 0;
    let totalErrors = 0;

    for (const tenant of tenants) {
      const tenantLabel = tenant.slug || tenant.id;
      console.log(`\nTenant: ${tenantLabel}`);

      await seedTenantAssets(dataSource, tenant.id);

      for (const sourceEntityType of SUPPORTED_SOURCE_ENTITY_TYPES) {
        let cursor: string | null = null;
        while (true) {
          const batchResult = await processBatch(
            dataSource,
            tenant,
            batchSize,
            cursor,
            sourceEntityType,
            integratedDocs,
          );

          if (batchResult.rowsScanned === 0) {
            break;
          }

          totalRowsByType[sourceEntityType] += batchResult.rowsScanned;
          totalSlotsCreated += batchResult.slotsCreated;
          totalSlotsExisting += batchResult.slotsExisting;
          totalRelationsRepaired += batchResult.relationsRepaired;
          totalAuditRecovered += batchResult.auditRecovered;
          totalUnresolvedInlineImages += batchResult.unresolvedInlineImages;
          totalErrors += batchResult.errors;
          cursor = batchResult.lastCursor;

          console.log(
            `  ${sourceEntityType} batch: rows=${batchResult.rowsScanned}, created_slots=${batchResult.slotsCreated}, existing_slots=${batchResult.slotsExisting}, repaired_relations=${batchResult.relationsRepaired}, audit_recovered=${batchResult.auditRecovered}, unresolved_inline_images=${batchResult.unresolvedInlineImages}, errors=${batchResult.errors}`,
          );

          if (batchPauseMs > 0) {
            await sleep(batchPauseMs);
          }
        }
      }
    }

    await dataSource.query('ANALYZE documents');
    await dataSource.query('ANALYZE integrated_document_bindings');

    console.log('\nIntegrated-doc repair complete.');
    for (const sourceEntityType of SUPPORTED_SOURCE_ENTITY_TYPES) {
      console.log(`  ${sourceEntityType} rows scanned: ${totalRowsByType[sourceEntityType]}`);
    }
    console.log(`  slots created: ${totalSlotsCreated}`);
    console.log(`  slots already present: ${totalSlotsExisting}`);
    console.log(`  relation rows repaired: ${totalRelationsRepaired}`);
    console.log(`  slots recovered from audit: ${totalAuditRecovered}`);
    console.log(`  unresolved legacy inline images: ${totalUnresolvedInlineImages}`);
    console.log(`  row-level errors: ${totalErrors}`);

    if (totalErrors > 0) {
      throw new Error(`Integrated-doc repair completed with ${totalErrors} row-level error(s)`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`Integrated-doc backfill failed: ${message}`);
  process.exitCode = 1;
});
