import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { costCenterLabel, loadCostCenterTree } from './cost-center-tree.util';
import { CostCenterContext, CostCentersService, validateCostCenterGraph } from './cost-centers.service';

@Injectable()
export class CostCentersDeleteService {
  constructor(
    private readonly costCenters: CostCentersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Deletes one node. A node used by budget lines or holding other nodes is
   * refused with a readable 409; disabling stays possible.
   */
  async delete(id: string, ctx: CostCenterContext): Promise<void> {
    await this.costCenters.lockTree(ctx);
    // The row lock comes before the count: a line attached concurrently either
    // committed first (and is counted) or waits for this delete and then fails its key check.
    const [existing] = await this.costCenters.lockNodes(ctx, [id]);
    if (!existing) throw new NotFoundException('Cost center not found.');

    const before = await this.costCenters.loadGraph(ctx);
    const after = new Map(before);
    after.delete(id);
    const usage = await this.costCenters.countUsage(ctx, [id]);
    const issues = validateCostCenterGraph({ before, after, usage });
    if (issues.length > 0) throw new ConflictException(issues.map((issue) => issue.message).join(' '));

    try {
      await ctx.manager.query(`DELETE FROM cost_centers WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
    } catch (err: any) {
      if (err?.code === '23503') {
        throw new ConflictException(`${existing.code} is still referenced. Disable it instead.`);
      }
      throw err;
    }

    await this.audit.log(
      {
        table: 'cost_centers',
        recordId: id,
        action: 'delete',
        before: existing,
        after: null,
        userId: ctx.userId ?? null,
        source: ctx.audit?.source,
        sourceRef: ctx.audit?.sourceRef ?? null,
      },
      { manager: ctx.manager },
    );
  }

  /**
   * Deletes each node under its own savepoint, so a refusal leaves the others
   * deleted and the transaction usable. Deeper nodes go first: a group and
   * its content selected together are deleted together.
   */
  async bulkDelete(ids: string[], ctx: CostCenterContext): Promise<BulkDeleteResult> {
    const result: BulkDeleteResult = { deleted: [], failed: [] };
    const unique = Array.from(new Set((ids ?? []).map((id) => String(id))));
    if (unique.length === 0) return result;

    const nodes = await loadCostCenterTree(ctx.manager, ctx.tenantId);
    const depth = new Map(nodes.map((node) => [node.id, node.depth]));
    const ordered = unique
      .map((id, index) => ({ id, index }))
      .sort((a, b) => (depth.get(b.id) ?? -1) - (depth.get(a.id) ?? -1) || a.index - b.index)
      .map((entry) => entry.id);

    for (const id of ordered) {
      if (!isUUID(id)) {
        result.failed.push({ id, name: 'Unknown', reason: 'Cost center not found.' });
        continue;
      }
      try {
        await withSavepoint(ctx.manager, () => this.delete(id, ctx));
        result.deleted.push(id);
      } catch (err: any) {
        const [row] = await ctx.manager.query(
          `SELECT code, name FROM cost_centers WHERE tenant_id = $1 AND id = $2`,
          [ctx.tenantId, id],
        );
        result.failed.push({
          id,
          name: row ? costCenterLabel(row) : 'Unknown',
          reason: err?.message || 'Unknown error',
        });
      }
    }
    return result;
  }
}
