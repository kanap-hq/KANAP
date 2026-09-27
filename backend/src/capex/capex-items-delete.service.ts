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

@Injectable()
export class CapexItemsDeleteService extends BaseDeleteService<CapexItem> {
  protected override readonly logger = new Logger(CapexItemsDeleteService.name);

  constructor(
    @InjectRepository(CapexItem) repository: Repository<CapexItem>,
    @InjectRepository(CapexVersion) private readonly versions: Repository<CapexVersion>,
    @InjectRepository(CapexAmount) private readonly amounts: Repository<CapexAmount>,
    @InjectRepository(CapexAllocation) private readonly allocations: Repository<CapexAllocation>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'CapexItem',
      auditTable: 'capex_items',
      cascadeRelations: [],
    });
  }

  /**
   * Delete a single item with CASCADE to all children
   * Automatically deletes versions, amounts, and allocations
   */
  override async delete(itemId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const itemRepo = this.getRepo(manager);
    const versionRepo = manager.getRepository(CapexVersion);
    const amountRepo = manager.getRepository(CapexAmount);
    const allocationRepo = manager.getRepository(CapexAllocation);

    const item = await itemRepo.findOne({ where: { id: itemId } as any });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    // Get versions for cascade deletion
    const versions = await versionRepo.find({ where: { capex_item_id: itemId } });
    const versionIds = versions.map(v => v.id);

    // CASCADE DELETE: Delete in reverse dependency order
    // 1. Delete allocations (depends on versions)
    if (versionIds.length > 0) {
      await allocationRepo.delete({ version_id: In(versionIds) });
    }

    // 2. Delete amounts (depends on versions)
    if (versionIds.length > 0) {
      await amountRepo.delete({ version_id: In(versionIds) });
    }

    // 3. Delete versions (depends on item)
    if (versionIds.length > 0) {
      await versionRepo.delete({ capex_item_id: itemId });
    }

    // 4. Delete tasks (depends on item) from unified table
    await manager.query(
      `DELETE FROM tasks WHERE tenant_id = $1 AND related_object_type = 'capex_item' AND related_object_id = $2`,
      [item.tenant_id, itemId],
    );

    // 5. Finally delete the item itself
    await itemRepo.delete({ id: itemId } as any);

    // Audit log
    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'capex_items',
          recordId: itemId,
          action: 'delete',
          before: item,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager }
      );
    }
  }

  /**
   * Bulk delete multiple items
   * Returns both successful deletions and failures
   */
  async bulkDelete(itemIds: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const itemRepo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const itemId of itemIds) {
      try {
        await this.delete(itemId, { manager, userId });
        result.deleted.push(itemId);
      } catch (error: any) {
        // Get description for error reporting
        let name = 'Unknown';
        try {
          const item = await itemRepo.findOne({ where: { id: itemId } as any });
          if (item) name = item.description;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch capex item name for error reporting: ${err?.message || 'Unknown error'}`);
        }

        result.failed.push({
          id: itemId,
          name,
          reason: error.message || 'Unknown error',
        });
      }
    }

    return result;
  }
}
