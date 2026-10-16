import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { checkIds, type UsageCount } from '../common/record-in-use';
import { withSavepoint } from '../common/savepoint.util';
import { StorageService } from '../common/storage/storage.service';
import { readTechnology } from './technology-rows';

type DeleteOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

/**
 * The delete of technologies (on the model of `applications-delete.service.ts`). Nothing refuses
 * it: the check lists what goes with them (the links to servers, applications, contracts, budget
 * lines, projects, incidents, and the documents), so the confirmation shows the usages. The rows go
 * by the foreign keys (ON DELETE CASCADE); a technology that named one as its replacement keeps
 * none (SET NULL). Attachment files go once the rows are gone.
 */
@Injectable()
export class TechnologiesDeleteService {
  private readonly logger = new Logger(TechnologiesDeleteService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** What a delete of `ids` takes with it, counted over the technologies of the tenant. Nothing is written. */
  async deleteCheck(ids: string[], opts: DeleteOpts): Promise<{ refused: []; removes: UsageCount[] }> {
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [], removes: [] };
    const [row]: Array<Record<string, number>> = await opts.manager.query(
      `WITH t AS (SELECT id FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[]))
       SELECT
         (SELECT count(DISTINCT asset_id)::int FROM asset_technologies WHERE tenant_id = $1 AND technology_id IN (SELECT id FROM t)) AS assets,
         (SELECT count(DISTINCT application_id)::int FROM application_technologies WHERE tenant_id = $1 AND technology_id IN (SELECT id FROM t)) AS applications,
         (SELECT count(*)::int FROM technology_contracts WHERE tenant_id = $1 AND technology_id IN (SELECT id FROM t)) AS contracts,
         (SELECT count(*)::int FROM technology_spend_items WHERE tenant_id = $1 AND technology_id IN (SELECT id FROM t)) AS budget_lines,
         (SELECT count(*)::int FROM technology_projects WHERE tenant_id = $1 AND technology_id IN (SELECT id FROM t)) AS projects,
         (SELECT count(*)::int FROM incident_technologies WHERE tenant_id = $1 AND technology_id IN (SELECT id FROM t)) AS incidents,
         (SELECT count(*)::int FROM technology_attachments WHERE tenant_id = $1 AND technology_id IN (SELECT id FROM t)) AS documents`,
      [opts.tenantId, wanted],
    );
    const removes: UsageCount[] = [];
    for (const type of ['assets', 'applications', 'contracts', 'budget_lines', 'projects', 'incidents', 'documents'] as const) {
      const total = Number(row?.[type] ?? 0);
      if (total > 0) removes.push({ type, total });
    }
    return { refused: [], removes };
  }

  async delete(idOrRef: string, opts: DeleteOpts): Promise<void> {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const attachments: Array<{ storage_path: string }> = await mg.query(
      `SELECT storage_path FROM technology_attachments WHERE tenant_id = $1 AND technology_id = $2`,
      [tenantId, tech.id],
    );
    await mg.query(`DELETE FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, tech.id]);
    await this.audit.log({ table: 'technologies', recordId: tech.id, action: 'delete', before: tech, after: null, userId: opts.userId ?? null }, { manager: mg });
    for (const attachment of attachments) {
      try {
        await this.storage.deleteObject(attachment.storage_path);
      } catch (err: any) {
        this.logger.warn(`Failed to delete attachment storage object: ${err?.message || 'Unknown error'}`);
      }
    }
  }

  async bulkDelete(ids: string[], opts: DeleteOpts) {
    const result: { deleted: string[]; failed: Array<{ id: string; name: string; reason: string }> } = { deleted: [], failed: [] };
    for (const id of checkIds(ids)) {
      try {
        await withSavepoint(opts.manager, () => this.delete(id, opts));
        result.deleted.push(id);
      } catch (e: any) {
        result.failed.push({ id, name: 'Unknown', reason: e?.message || 'Unknown error' });
      }
    }
    return result;
  }
}
