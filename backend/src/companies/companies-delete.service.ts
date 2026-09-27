import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Company } from './company.entity';
import { AuditService } from '../audit/audit.service';
import { ReferenceCheckService } from '../common/reference-check.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

/** Tables whose foreign key can block a company delete, in plain words. */
const COMPANY_REFERENCING_TABLES: Record<string, string> = {
  spend_allocations: 'OPEX allocations',
  capex_allocations: 'CAPEX allocations',
  cost_centers: 'cost centers',
};

@Injectable()
export class CompaniesDeleteService extends BaseDeleteService<Company> {
  protected override readonly logger = new Logger(CompaniesDeleteService.name);

  constructor(
    @InjectRepository(Company) repository: Repository<Company>,
    audit: AuditService,
    private readonly referenceCheck: ReferenceCheckService,
  ) {
    super(repository, null, audit, {
      entityName: 'Company',
      auditTable: 'companies',
      cascadeRelations: [],
    });
  }

  /**
   * Check for references before deletion
   */
  protected override async beforeDelete(entity: Company, manager: EntityManager): Promise<void> {
    await this.referenceCheck.assertNoReferences('company', entity.id, entity.name, { manager });
  }

  /**
   * Delete a single company
   * Will fail if company is referenced by OPEX or CAPEX items
   */
  override async delete(companyId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);

    const company = await repo.findOne({ where: { id: companyId } as any });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    // Check for references - will throw ConflictException if found
    await this.beforeDelete(company, manager);

    try {
      // Delete the company
      await repo.delete({ id: companyId } as any);
    } catch (error: any) {
      // A foreign key the reference check did not cover (or a row added since): say which records, when known.
      if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
        const users = COMPANY_REFERENCING_TABLES[String(error.table ?? '')] ?? 'other records';
        throw new ConflictException(`Cannot delete company "${company.name}": ${users} still use it. You can disable it instead.`);
      }
      throw error;
    }

    // Audit log
    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'companies',
          recordId: companyId,
          action: 'delete',
          before: company,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager }
      );
    }
  }

  /**
   * Bulk delete multiple companies
   * Returns both successful deletions and failures
   */
  async bulkDelete(companyIds: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const companyId of companyIds) {
      try {
        await withSavepoint(manager, () => this.delete(companyId, { manager, userId }));
        result.deleted.push(companyId);
      } catch (error: any) {
        // Get company name for error reporting
        let name = 'Unknown';
        try {
          const company = await withSavepoint(manager, () => repo.findOne({ where: { id: companyId } as any }));
          if (company) name = company.name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch company name for error reporting: ${err?.message || 'Unknown error'}`);
        }

        result.failed.push({
          id: companyId,
          name,
          reason: error.message || 'Unknown error',
        });
      }
    }

    return result;
  }
}
