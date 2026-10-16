import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { StorageService } from '../common/storage/storage.service';
import { extractInlineImageUrls } from '../common/content-image-urls';
import { isStoragePathReferencedInAnyTable, ATTACHMENT_TABLES } from '../common/storage-path-refs';
import { releaseOrphanedManagedDocuments } from '../knowledge/integrated-document-orphans';

const DRY_RUN = (process.env.ATTACHMENT_CLEANUP_DRY_RUN || '').toLowerCase() === 'true';

/** Content tables with columns that may contain inline images */
export const CONTENT_SOURCES = [
  { table: 'portfolio_requests', columns: ['current_situation', 'expected_benefits'] },
  { table: 'portfolio_activities', columns: ['content'] },
  { table: 'tasks', columns: ['description'] },
  { table: 'documents', columns: ['content_markdown'] },
  // Stored versions render their own images: an attachment dropped from the
  // current body but still present in a kept version is alive, not an orphan.
  // Without this the cron would delete the illustrations of a frozen incident
  // review the moment the body moved on.
  { table: 'document_versions', columns: ['content_markdown'] },
  { table: 'document_activities', columns: ['content'] },
] as const;

/** Inline-capable attachment tables with their timestamp column */
const INLINE_ATTACHMENT_TABLES = [
  { table: 'portfolio_project_attachments', timestampCol: 'created_at' },
  { table: 'portfolio_request_attachments', timestampCol: 'created_at' },
  { table: 'task_attachments', timestampCol: 'uploaded_at' },
  { table: 'document_attachments', timestampCol: 'uploaded_at' },
] as const;

// Patterns to extract attachment IDs from inline URLs
const INLINE_ID_PATTERNS = [
  /\/inline\/[^/]+\/([a-f0-9-]{36})/i,                    // projects, requests, knowledge
  /\/tasks\/attachments\/[^/]+\/([a-f0-9-]{36})\/inline/i, // tasks
];

function extractAttachmentId(url: string): string | null {
  for (const pattern of INLINE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Every inline attachment id still referenced by a content field of the current
 * tenant. Exported so the "an attachment kept only by a stored version is not an
 * orphan" rule can be asserted without running the whole cron.
 */
export async function collectAliveInlineAttachmentIds(
  manager: { query: (sql: string, params?: any[]) => Promise<any> },
): Promise<Set<string>> {
  const aliveIds = new Set<string>();
  for (const src of CONTENT_SOURCES) {
    for (const col of src.columns) {
      const rows: Array<Record<string, string>> = await manager.query(
        `SELECT ${col} FROM ${src.table} WHERE ${col} LIKE '%/inline%'`,
      );
      for (const row of rows) {
        const content = row[col];
        if (!content) continue;
        for (const url of extractInlineImageUrls(content)) {
          const id = extractAttachmentId(url);
          if (id) aliveIds.add(id);
        }
      }
    }
  }
  return aliveIds;
}

@Injectable()
export class OrphanedAttachmentCleanupService implements OnModuleInit {
  private readonly logger = new Logger(OrphanedAttachmentCleanupService.name);

  constructor(
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: 'attachment-orphan-cleanup',
      description:
        'Removes DB attachment rows whose inline images are no longer referenced in any content field, and moves the managed documents of deleted records to the unfiled documents of their library',
      defaultCron: '0 3 * * *',
      handler: () => this.cleanOrphanedAttachments(),
    });

    this.scheduledTasks.register({
      name: 'storage-ghost-cleanup',
      description: 'Removes S3 blobs with no matching DB attachment record (ghost blobs)',
      defaultCron: '0 4 * * 0',
      handler: () => this.cleanGhostBlobs(),
    });
  }

  // ========================================================
  // Task 1: attachment-orphan-cleanup (daily 3 AM)
  // ========================================================

  private async cleanOrphanedAttachments(): Promise<Record<string, any>> {
    const summary = {
      tenantsProcessed: 0,
      candidatesFound: 0,
      deleted: 0,
      skippedReferenced: 0,
      managedDocumentsReleased: 0,
      errors: [] as string[],
    };

    const tenants: Array<{ id: string; slug: string }> = await this.dataSource.query(
      `SELECT id, slug FROM tenants WHERE status = 'active'`,
    );

    for (const tenant of tenants) {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        const mg = runner.manager;

        // Step 1: Build alive set of attachment IDs referenced in content
        const aliveIds = await collectAliveInlineAttachmentIds(mg);

        // Step 2: Find orphaned inline attachments (older than 24h, not in alive set)
        const aliveArray = [...aliveIds];
        for (const { table, timestampCol } of INLINE_ATTACHMENT_TABLES) {
          const candidates: Array<{ id: string; storage_path: string }> = await mg.query(
            `SELECT id, storage_path FROM ${table}
             WHERE source_field IS NOT NULL
               AND ${timestampCol} < now() - interval '24 hours'
               AND id <> ALL($1::uuid[])`,
            [aliveArray],
          );

          summary.candidatesFound += candidates.length;

          // Step 3: Safe delete — check cross-table references
          for (const candidate of candidates) {
            try {
              const referenced = await isStoragePathReferencedInAnyTable(mg, candidate.storage_path, [candidate.id]);
              if (referenced) {
                summary.skippedReferenced++;
                // Delete the orphan DB row but keep S3 blob
                if (!DRY_RUN) {
                  await mg.query(`DELETE FROM ${table} WHERE id = $1`, [candidate.id]);
                }
                continue;
              }

              if (DRY_RUN) {
                this.logger.log(`[DRY RUN] Would delete: ${table}/${candidate.id} -> ${candidate.storage_path}`);
              } else {
                try { await this.storage.deleteObject(candidate.storage_path); } catch {}
                await mg.query(`DELETE FROM ${table} WHERE id = $1`, [candidate.id]);
              }
              summary.deleted++;
            } catch (err: any) {
              summary.errors.push(`${table}/${candidate.id}: ${err.message}`);
            }
          }
        }

        await runner.commitTransaction();
        summary.tenantsProcessed++;
      } catch (err: any) {
        await runner.rollbackTransaction().catch(() => {});
        summary.errors.push(`Tenant ${tenant.slug}: ${err.message}`);
      } finally {
        await runner.release();
      }
    }

    summary.managedDocumentsReleased = await this.releaseOrphanedManagedDocuments(tenants, summary.errors);

    if (summary.errors.length > 0 && summary.tenantsProcessed === 0) {
      throw new Error(`All tenants failed: ${summary.errors[0]}`);
    }

    this.logger.log(
      `[attachment-orphan-cleanup] Done: ${summary.tenantsProcessed} tenants, ${summary.candidatesFound} candidates, ${summary.deleted} deleted, ${summary.skippedReferenced} skipped (referenced), ${summary.managedDocumentsReleased} managed documents released` +
      (DRY_RUN ? ' [DRY RUN]' : ''),
    );

    return summary;
  }

  /**
   * Managed documents of deleted records: unbound and moved to the unfiled documents of their
   * library, kept with their files, one audit entry each (`releaseOrphanedManagedDocuments`). One
   * transaction per tenant, apart from the attachment step. Returns how many were released.
   */
  private async releaseOrphanedManagedDocuments(tenants: Array<{ id: string; slug: string }>, errors: string[]): Promise<number> {
    let released = 0;
    for (const tenant of tenants) {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        const documents = await releaseOrphanedManagedDocuments(runner.manager, tenant.id, {
          dryRun: DRY_RUN,
          sourceRef: 'attachment-orphan-cleanup',
        });
        await runner.commitTransaction();
        for (const doc of documents) {
          this.logger.log(
            `[attachment-orphan-cleanup] ${DRY_RUN ? '[DRY RUN] would release' : 'Released'} managed document DOC-${doc.item_number} ` +
              `(${doc.document_id}) of tenant ${tenant.slug}: its ${doc.source_entity_type} record ${doc.source_entity_id} ` +
              `(slot ${doc.slot_key}) is gone; unbound and moved to the unfiled documents of its library`,
          );
        }
        released += documents.length;
      } catch (err: any) {
        await runner.rollbackTransaction().catch(() => {});
        errors.push(`Tenant ${tenant.slug} (managed documents): ${err.message}`);
      } finally {
        await runner.release();
      }
    }
    return released;
  }

  // ========================================================
  // Task 2: storage-ghost-cleanup (weekly Sunday 4 AM)
  // ========================================================

  private async cleanGhostBlobs(): Promise<Record<string, any>> {
    const summary = {
      tenantsProcessed: 0,
      s3ObjectsScanned: 0,
      ghostsFound: 0,
      ghostsDeleted: 0,
      errors: [] as string[],
    };

    const tenants: Array<{ id: string; slug: string }> = await this.dataSource.query(
      `SELECT id, slug FROM tenants WHERE status = 'active'`,
    );

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const tenant of tenants) {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      try {
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        const mg = runner.manager;

        // Collect all known storage_path values from DB
        const knownPaths = new Set<string>();

        for (const table of ATTACHMENT_TABLES) {
          const rows: Array<{ storage_path: string }> = await mg.query(
            `SELECT storage_path FROM ${table}`,
          );
          for (const row of rows) {
            if (row.storage_path) knownPaths.add(row.storage_path);
          }
        }

        // Also check branding logo path
        const brandingRows: Array<{ logo_path: string | null }> = await mg.query(
          `SELECT branding->>'logo_storage_path' as logo_path FROM tenants WHERE id = $1`,
          [tenant.id],
        );
        if (brandingRows[0]?.logo_path) {
          knownPaths.add(brandingRows[0].logo_path);
        }

        // List all S3 objects under this tenant's prefix
        const prefix = `files/${tenant.id}/`;
        for await (const obj of this.storage.listObjects(prefix)) {
          summary.s3ObjectsScanned++;

          // Skip recent objects (grace period)
          if (obj.lastModified && obj.lastModified > sevenDaysAgo) continue;

          // If the key isn't in any DB attachment table → ghost blob
          if (!knownPaths.has(obj.key)) {
            summary.ghostsFound++;
            if (DRY_RUN) {
              this.logger.log(`[DRY RUN] Ghost blob: ${obj.key}`);
            } else {
              try {
                await this.storage.deleteObject(obj.key);
                summary.ghostsDeleted++;
              } catch (err: any) {
                summary.errors.push(`S3 delete ${obj.key}: ${err.message}`);
              }
            }
          }
        }

        await runner.commitTransaction();
        summary.tenantsProcessed++;
      } catch (err: any) {
        await runner.rollbackTransaction().catch(() => {});
        summary.errors.push(`Tenant ${tenant.slug}: ${err.message}`);
      } finally {
        await runner.release();
      }
    }

    if (summary.errors.length > 0 && summary.tenantsProcessed === 0) {
      throw new Error(`All tenants failed: ${summary.errors[0]}`);
    }

    this.logger.log(
      `[storage-ghost-cleanup] Done: ${summary.tenantsProcessed} tenants, ${summary.s3ObjectsScanned} objects scanned, ${summary.ghostsFound} ghosts found, ${summary.ghostsDeleted} deleted` +
      (DRY_RUN ? ' [DRY RUN]' : ''),
    );

    return summary;
  }
}
