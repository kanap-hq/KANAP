import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { checkIds, lineUsages, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal } from '../common/record-in-use';
import { costCenterLabel, loadCostCenterTree } from './cost-center-tree.util';
import {
  CostCenterContext,
  CostCenterGraphNode,
  CostCentersService,
  CostCenterUsage,
  validateCostCenterGraph,
} from './cost-centers.service';

/**
 * The refusal of a node's delete from `graph`, or null: a group that holds nodes
 * (`COST_CENTER_HAS_NODES`: move or delete them first), a cost center used by budget lines
 * (`COST_CENTER_IN_USE`: disable it instead). The English sentence is the tree rules' own.
 */
export function costCenterDeleteRefusal(
  node: CostCenterGraphNode,
  graph: Map<string, CostCenterGraphNode>,
  usage: CostCenterUsage | undefined,
): RecordInUseException | null {
  const after = new Map(graph);
  after.delete(node.id);
  const issues = validateCostCenterGraph({ before: graph, after, usage: new Map(usage ? [[node.id, usage]] : []) });
  if (issues.length === 0) return null;
  const message = issues.map((issue) => issue.message).join(' ');
  const children = Array.from(graph.values()).filter((other) => other.parent_id === node.id).length;
  return children > 0
    ? new RecordInUseException('COST_CENTER_HAS_NODES', 'cost center', node.name, [{ type: 'nodes', total: children }], message)
    : new RecordInUseException('COST_CENTER_IN_USE', 'cost center', node.name, lineUsages(usage), message);
}

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

    const graph = await this.costCenters.loadGraph(ctx);
    const usage = await this.costCenters.countUsage(ctx, [id]);
    const node = graph.get(id);
    const refusal = node ? costCenterDeleteRefusal(node, graph, usage.get(id)) : null;
    if (refusal) throw refusal;

    try {
      await ctx.manager.query(`DELETE FROM cost_centers WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
    } catch (err: any) {
      if (err?.code === '23503') {
        throw new RecordInUseException('RECORD_IN_USE', 'cost center', existing.name, [], `${existing.code} is still referenced. Disable it instead.`);
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
   * The check before a delete (`POST /cost-centers/delete-check`): which of `ids` the bulk delete
   * would refuse, and why. Played in the bulk delete's order on the stored tree, so a group asked
   * with all its content is not refused. Nothing is written or locked.
   */
  async deleteCheck(ids: string[], ctx: CostCenterContext): Promise<{ refused: DeleteRefusal[] }> {
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const stored = await this.costCenters.loadGraph(ctx);
    const graph = new Map(stored);
    const usage = await this.costCenters.countUsage(ctx, wanted);
    const refusals = new Map<string, RecordInUseException>();
    for (const id of await this.deleteOrder(wanted, ctx)) {
      const node = graph.get(id);
      if (!node) continue;
      const refusal = costCenterDeleteRefusal(node, graph, usage.get(id));
      if (refusal) refusals.set(id, refusal);
      else graph.delete(id);
    }
    return refusalsFrom(
      wanted,
      Array.from(refusals.keys(), (id) => stored.get(id)!),
      costCenterLabel,
      async (node) => refusals.get(node.id) ?? null,
    );
  }

  /** Deeper nodes first, then in the order asked: a group and its content selected together go together. */
  private async deleteOrder(ids: string[], ctx: CostCenterContext): Promise<string[]> {
    const nodes = await loadCostCenterTree(ctx.manager, ctx.tenantId);
    const depth = new Map(nodes.map((node) => [node.id, node.depth]));
    return ids
      .map((id, index) => ({ id, index }))
      .sort((a, b) => (depth.get(b.id) ?? -1) - (depth.get(a.id) ?? -1) || a.index - b.index)
      .map((entry) => entry.id);
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

    const ordered = await this.deleteOrder(unique, ctx);

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
          ...refusalDetails(err),
        });
      }
    }
    return result;
  }
}
