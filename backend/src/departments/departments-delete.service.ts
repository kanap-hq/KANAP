import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Department } from './department.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

@Injectable()
export class DepartmentsDeleteService extends BaseDeleteService<Department> {
  protected override readonly logger = new Logger(DepartmentsDeleteService.name);

  constructor(
    @InjectRepository(Department) repository: Repository<Department>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'Department',
      auditTable: 'departments',
      cascadeRelations: [],
    });
  }

  /**
   * Override delete to handle foreign key constraint errors
   */
  override async delete(departmentId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);

    const department = await repo.findOne({ where: { id: departmentId } as any });
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    try {
      // Simple deletion for departments (no reference checking needed)
      await repo.delete({ id: departmentId } as any);
    } catch (error: any) {
      // Catch database-level foreign key errors (e.g., from allocations)
      if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
        throw new ConflictException(
          `Cannot delete department "${department.name}": it is being used in allocations for OPEX or CAPEX items. You can disable it if it shouldn't be used actively anymore.`
        );
      }
      throw error;
    }

    // Audit log
    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'departments',
          recordId: departmentId,
          action: 'delete',
          before: department,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager }
      );
    }
  }

  /**
   * Bulk delete multiple departments
   */
  async bulkDelete(departmentIds: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const departmentId of departmentIds) {
      try {
        await withSavepoint(manager, () => this.delete(departmentId, { manager, userId }));
        result.deleted.push(departmentId);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const department = await withSavepoint(manager, () => repo.findOne({ where: { id: departmentId } as any }));
          if (department) name = department.name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch department name for error reporting: ${err?.message || 'Unknown error'}`);
        }

        result.failed.push({
          id: departmentId,
          name,
          reason: error.message || 'Unknown error',
        });
      }
    }

    return result;
  }
}
