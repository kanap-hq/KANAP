import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Department } from './department.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { checkIds, lineUsages, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal } from '../common/record-in-use';
import { withSavepoint } from '../common/savepoint.util';

/** The budget lines of each nature whose allocations name each of `ids` (`spend_allocations` keeps its department). */
async function allocatedLines(manager: EntityManager, ids: string[]): Promise<Map<string, { opex: number; capex: number }>> {
  const rows: Array<{ department_id: string; opex: number; capex: number }> = ids.length === 0 ? [] : await manager.query(
    `SELECT a.department_id::text AS department_id,
            count(DISTINCT si.id) FILTER (WHERE si.nature = 'opex')::int AS opex,
            count(DISTINCT si.id) FILTER (WHERE si.nature = 'capex')::int AS capex
       FROM spend_allocations a
       JOIN spend_versions v ON v.tenant_id = a.tenant_id AND v.id = a.version_id
       JOIN spend_items si ON si.tenant_id = v.tenant_id AND si.id = v.spend_item_id AND si.nature IN ('opex', 'capex')
      WHERE a.tenant_id = app_current_tenant() AND a.department_id = ANY($1::uuid[])
      GROUP BY a.department_id`,
    [ids],
  );
  return new Map(rows.map((row) => [row.department_id, { opex: row.opex, capex: row.capex }]));
}

/** The refusal of a department's delete (`DEPARTMENT_IN_USE`: the allocated budget lines counted, disable it instead), or null. */
function departmentRefusal(name: string, lines: { opex: number; capex: number } | undefined): RecordInUseException | null {
  if (!lines || lines.opex + lines.capex === 0) return null;
  return new RecordInUseException('DEPARTMENT_IN_USE', 'department', name, lineUsages(lines),
    `Cannot delete department "${name}": it is being used in allocations for OPEX or CAPEX items. You can disable it if it shouldn't be used actively anymore.`);
}

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

    // The allocations keep their department (the only key that refuses): counted first, for the refusal.
    const refusal = departmentRefusal(department.name, (await allocatedLines(manager, [departmentId])).get(departmentId));
    if (refusal) throw refusal;
    try {
      await repo.delete({ id: departmentId } as any);
    } catch (error: any) {
      // An allocation written meanwhile, or a key the count does not see.
      if (error.code === '23503') {
        throw departmentRefusal(department.name, (await allocatedLines(manager, [departmentId])).get(departmentId))
          ?? new RecordInUseException('RECORD_IN_USE', 'department', department.name, [],
            `Cannot delete department "${department.name}": other records still use it. Disable it instead.`);
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

  /** The check before a delete (`POST /departments/delete-check`): which of `ids` would be refused, and why. Nothing is written. */
  async deleteCheck(ids: unknown[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: Array<{ id: string; name: string }> = await manager.query(
      `SELECT id::text AS id, name FROM departments WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
      [wanted],
    );
    const lines = await allocatedLines(manager, wanted);
    return refusalsFrom(wanted, rows, (row) => row.name, async (row) => departmentRefusal(row.name, lines.get(row.id)));
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
          ...refusalDetails(error),
        });
      }
    }

    return result;
  }
}
