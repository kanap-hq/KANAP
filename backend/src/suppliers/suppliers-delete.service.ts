import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { AuditService } from '../audit/audit.service';
import { ReferenceCheckService } from '../common/reference-check.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

@Injectable()
export class SuppliersDeleteService extends BaseDeleteService<Supplier> {
  protected override readonly logger = new Logger(SuppliersDeleteService.name);

  constructor(
    @InjectRepository(Supplier) repository: Repository<Supplier>,
    audit: AuditService,
    private readonly referenceCheck: ReferenceCheckService,
  ) {
    super(repository, null, audit, {
      entityName: 'Supplier',
      auditTable: 'suppliers',
      cascadeRelations: [],
    });
  }

  /**
   * Check for references before deletion
   */
  protected override async beforeDelete(entity: Supplier, manager: EntityManager): Promise<void> {
    await this.referenceCheck.assertNoReferences('supplier', entity.id, entity.name, { manager });
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
      // Catch database-level foreign key errors (e.g., from allocations)
      if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
        throw new ConflictException(
          `Cannot delete supplier "${supplier.name}": it is being used in allocations for OPEX or CAPEX items. You can disable it if it shouldn't be used actively anymore.`
        );
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
        });
      }
    }

    return result;
  }
}
