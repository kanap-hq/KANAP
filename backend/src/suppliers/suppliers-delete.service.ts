import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { assertNotInUse, RecordInUseException, refusalDetails, refusalsOf, type DeleteRefusal } from '../common/record-in-use';
import { SUPPLIER_USAGE_QUERIES } from './supplier-usages';

@Injectable()
export class SuppliersDeleteService extends BaseDeleteService<Supplier> {
  protected override readonly logger = new Logger(SuppliersDeleteService.name);

  constructor(
    @InjectRepository(Supplier) repository: Repository<Supplier>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'Supplier',
      auditTable: 'suppliers',
      cascadeRelations: [],
    });
  }

  /** The check before a delete (`POST /suppliers/delete-check`): which of `ids` would be refused, and why. */
  async deleteCheck(ids: string[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    return refusalsOf(opts?.manager ?? this.repository.manager, 'suppliers', ids, SUPPLIER_USAGE_QUERIES, 'SUPPLIER_IN_USE');
  }

  /**
   * A supplier that anything in its "Used by" panel still names cannot go (`SUPPLIER_IN_USE`, with
   * the counts per kind): deleting it would clear it on those objects, or leave a contract without
   * its supplier. Disabling it is the way out.
   */
  protected override async beforeDelete(entity: Supplier, manager: EntityManager): Promise<void> {
    await assertNotInUse(manager, entity.tenant_id, entity.id, SUPPLIER_USAGE_QUERIES, {
      code: 'SUPPLIER_IN_USE',
      entity: 'supplier',
      name: entity.name,
    });
  }

  /**
   * Override delete to handle foreign key constraint errors
   */
  override async delete(supplierId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);

    const supplier = await repo.findOne({ where: { id: supplierId } as any });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    // Check references first
    await this.beforeDelete(supplier, manager);

    try {
      // Delete the entity
      await repo.delete({ id: supplierId } as any);
    } catch (error: any) {
      // A key the check did not see (a row added since): the contracts key refuses it.
      if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
        throw new RecordInUseException('RECORD_IN_USE', 'supplier', supplier.name, [], `Cannot delete supplier "${supplier.name}": other records still use it. Disable it instead.`);
      }
      throw error;
    }

    // Audit log
    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'suppliers',
          recordId: supplierId,
          action: 'delete',
          before: supplier,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager }
      );
    }
  }

  /**
   * Bulk delete multiple suppliers
   */
  async bulkDelete(supplierIds: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const supplierId of supplierIds) {
      try {
        await withSavepoint(manager, () => this.delete(supplierId, { manager, userId }));
        result.deleted.push(supplierId);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const supplier = await withSavepoint(manager, () => repo.findOne({ where: { id: supplierId } as any }));
          if (supplier) name = supplier.name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch supplier name for error reporting: ${err?.message || 'Unknown error'}`);
        }

        result.failed.push({
          id: supplierId,
          name,
          reason: error.message || 'Unknown error',
          ...refusalDetails(error),
        });
      }
    }

    return result;
  }
}
