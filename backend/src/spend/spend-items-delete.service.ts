import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { SpendVersion } from './spend-version.entity';
import { SpendAmount } from './spend-amount.entity';
import { SpendAllocation } from './spend-allocation.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { StorageService } from '../common/storage/storage.service';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';
import {
  assertNoFrozenAmounts,
  bulkDeleteFailureReason,
  currentTenantId,
  deleteBlobs,
  deleteItemDependents,
  underItemSavepoint,
  unreferencedPaths,
} from './item-delete-cleanup';
import { lockBudgetLine } from './budget-locks';

@Injectable()
export class SpendItemsDeleteService extends BaseDeleteService<SpendItem> {
  protected override readonly logger = new Logger(SpendItemsDeleteService.name);

  constructor(
    @InjectRepository(SpendItem) repository: Repository<SpendItem>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    @InjectRepository(SpendAmount) private readonly amounts: Repository<SpendAmount>,
    @InjectRepository(SpendAllocation) private readonly allocations: Repository<SpendAllocation>,
    audit: AuditService,
    storage: StorageService,
    private readonly timeAggregates: UserTimeAggregateService,
  ) {
    super(repository, storage, audit, {
      entityName: 'SpendItem',
      auditTable: 'spend_items',
      cascadeRelations: [],
    });
  }

  /** Deletes the item and everything that belongs to it, then its attachment files. */
  override async delete(itemId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const tenantId = await currentTenantId(manager);
    const paths = await this.deleteRows(itemId, tenantId, manager, opts?.userId ?? null, !!opts?.skipAudit);
    await deleteBlobs(this.storage, paths, this.logger);
  }

  /** Deletes the item's rows; returns the attachment paths nothing references any more. */
  private async deleteRows(itemId: string, tenantId: string, manager: EntityManager, userId: string | null, skipAudit: boolean) {
    const itemRepo = this.getRepo(manager);
    const versionRepo = manager.getRepository(SpendVersion);
    const amountRepo = manager.getRepository(SpendAmount);
    const allocationRepo = manager.getRepository(SpendAllocation);

    // Lock order (`budget-locks.ts`): the line first, FOR UPDATE since it goes. Every writer of
    // its budget locks it first too, so a save in flight is waited for, and a save that comes
    // after this delete finds no line (404) instead of a version deleted under it.
    const item = (await lockBudgetLine(manager, 'opex', tenantId, itemId, 'update'))
      ? await itemRepo.findOne({ where: { id: itemId, tenant_id: tenantId } as any })
      : null;
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    // Refused before anything is removed (a bulk delete reports it for this item).
    await assertNoFrozenAmounts(manager, 'opex', tenantId, itemId);

    const paths = await deleteItemDependents(manager, 'opex', tenantId, itemId, {
      audit: this.audit,
      timeAggregates: this.timeAggregates,
      userId,
    });

    const versions = await versionRepo.find({ where: { tenant_id: tenantId, spend_item_id: itemId } });
    const versionIds = versions.map(v => v.id);
    if (versionIds.length > 0) {
      // The line is locked above: no writer of these versions (allocation save, amounts,
      // round inputs) can run meanwhile, so the order of these deletes cannot deadlock.
      await allocationRepo.delete({ tenant_id: tenantId, version_id: In(versionIds) });
      await amountRepo.delete({ tenant_id: tenantId, version_id: In(versionIds) });
      await versionRepo.delete({ tenant_id: tenantId, spend_item_id: itemId });
    }

    await itemRepo.delete({ tenant_id: tenantId, id: itemId } as any);

    if (!skipAudit) {
      await this.audit.log(
        {
          table: 'spend_items',
          recordId: itemId,
          action: 'delete',
          before: item,
          after: null,
          userId,
        },
        { manager }
      );
    }
    return unreferencedPaths(manager, tenantId, paths);
  }

  /**
   * Bulk delete multiple items
   * Each item runs under its own savepoint: a failing item is undone and
   * reported, the others are deleted. Files go once an item's savepoint is
   * released; only the storage calls run after it.
   */
  async bulkDelete(itemIds: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const itemRepo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };
    const tenantId = await currentTenantId(manager);

    // Lines in id order (lock order, `budget-locks.ts`): each one's lock is held until the end.
    const ordered = [...itemIds].sort((a, b) => {
      const [x, y] = [String(a).toLowerCase(), String(b).toLowerCase()];
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (const [index, itemId] of ordered.entries()) {
      let paths: string[];
      try {
        paths = await underItemSavepoint(manager, index, () => this.deleteRows(itemId, tenantId, manager, userId, false));
      } catch (error: unknown) {
        let name = 'Unknown';
        try {
          const item = await itemRepo.findOne({ where: { id: itemId, tenant_id: tenantId } as any });
          if (item) name = item.product_name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch spend item name for error reporting: ${err?.message || 'Unknown error'}`);
        }

        result.failed.push({
          id: itemId,
          name,
          reason: bulkDeleteFailureReason(error, this.logger, itemId),
        });
        continue;
      }
      result.deleted.push(itemId);
      await deleteBlobs(this.storage, paths, this.logger);
    }

    // Reported in the order the ids were given.
    const position = new Map(itemIds.map((id, index) => [id, index]));
    result.deleted.sort((a, b) => position.get(a)! - position.get(b)!);
    result.failed.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
    return result;
  }
}
