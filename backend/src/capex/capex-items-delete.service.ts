import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CapexItem } from './capex-item.entity';
import { CapexVersion } from './capex-version.entity';
import { CapexAmount } from './capex-amount.entity';
import { CapexAllocation } from './capex-allocation.entity';
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
} from '../spend/item-delete-cleanup';

@Injectable()
export class CapexItemsDeleteService extends BaseDeleteService<CapexItem> {
  protected override readonly logger = new Logger(CapexItemsDeleteService.name);

  constructor(
    @InjectRepository(CapexItem) repository: Repository<CapexItem>,
    @InjectRepository(CapexVersion) private readonly versions: Repository<CapexVersion>,
    @InjectRepository(CapexAmount) private readonly amounts: Repository<CapexAmount>,
    @InjectRepository(CapexAllocation) private readonly allocations: Repository<CapexAllocation>,
    audit: AuditService,
    storage: StorageService,
    private readonly timeAggregates: UserTimeAggregateService,
  ) {
    super(repository, storage, audit, {
      entityName: 'CapexItem',
      auditTable: 'capex_items',
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
    const versionRepo = manager.getRepository(CapexVersion);
    const amountRepo = manager.getRepository(CapexAmount);
    const allocationRepo = manager.getRepository(CapexAllocation);

    const item = await itemRepo.findOne({ where: { id: itemId, tenant_id: tenantId } as any });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    // Refused before anything is removed (a bulk delete reports it for this item).
    await assertNoFrozenAmounts(manager, 'capex', tenantId, itemId);

    const paths = await deleteItemDependents(manager, 'capex', tenantId, itemId, {
      audit: this.audit,
      timeAggregates: this.timeAggregates,
      userId,
    });

    const versions = await versionRepo.find({ where: { tenant_id: tenantId, capex_item_id: itemId } });
    const versionIds = versions.map(v => v.id);
    if (versionIds.length > 0) {
      // Lock order (plan planning/perf-scale, lot 3B): this removes the
      // allocation rows before the version, while an allocation save locks the
      // version first (lockAllocationVersion), then replaces its rows. A save
      // of one of these versions running at the same moment can deadlock with
      // this delete; PostgreSQL then aborts one of them (40P01, answered 409
      // `retry`). Lot 3B makes every writer, deletes included, lock the line
      // and its versions first.
      await allocationRepo.delete({ tenant_id: tenantId, version_id: In(versionIds) });
      await amountRepo.delete({ tenant_id: tenantId, version_id: In(versionIds) });
      await versionRepo.delete({ tenant_id: tenantId, capex_item_id: itemId });
    }

    await itemRepo.delete({ tenant_id: tenantId, id: itemId } as any);

    if (!skipAudit) {
      await this.audit.log(
        {
          table: 'capex_items',
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

    for (const [index, itemId] of itemIds.entries()) {
      let paths: string[];
      try {
        paths = await underItemSavepoint(manager, index, () => this.deleteRows(itemId, tenantId, manager, userId, false));
      } catch (error: unknown) {
        let name = 'Unknown';
        try {
          const item = await itemRepo.findOne({ where: { id: itemId, tenant_id: tenantId } as any });
          if (item) name = item.description;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch capex item name for error reporting: ${err?.message || 'Unknown error'}`);
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

    return result;
  }
}
