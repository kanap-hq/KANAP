import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Company } from './company.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { assertNotInUse, RecordInUseException, refusalDetails, refusalsOf, type DeleteRefusal } from '../common/record-in-use';
import { COMPANY_USAGE_QUERIES } from './company-usages';

/** Tables whose foreign key can block a company delete, in plain words. */
const COMPANY_REFERENCING_TABLES: Record<string, string> = {
  // The allocations of the OPEX and CAPEX lines alike (one family since lot Z1).
  spend_allocations: 'budget allocations',
  cost_centers: 'cost centers',
  contracts: 'contracts',
  spend_items: 'budget lines',
  departments: 'departments',
  users: 'users',
  locations: 'locations',
  tasks: 'tasks',
  application_companies: 'applications',
  interface_companies: 'interfaces',
  portfolio_projects: 'projects',
  portfolio_requests: 'requests',
  portfolio_team_member_configs: 'team members',
};

@Injectable()
export class CompaniesDeleteService extends BaseDeleteService<Company> {
  protected override readonly logger = new Logger(CompaniesDeleteService.name);

  constructor(
    @InjectRepository(Company) repository: Repository<Company>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'Company',
      auditTable: 'companies',
      cascadeRelations: [],
    });
  }

  /** The check before a delete (`POST /companies/delete-check`): which of `ids` would be refused, and why. */
  async deleteCheck(ids: string[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    return refusalsOf(opts?.manager ?? this.repository.manager, 'companies', ids, COMPANY_USAGE_QUERIES, 'COMPANY_IN_USE');
  }

  /**
   * A company that anything still uses cannot go (`COMPANY_IN_USE`, with the counts per kind,
   * `company-usages.ts`). Disabling it is the way out.
   */
  protected override async beforeDelete(entity: Company, manager: EntityManager): Promise<void> {
    await assertNotInUse(manager, entity.tenant_id, entity.id, COMPANY_USAGE_QUERIES, {
      code: 'COMPANY_IN_USE',
      entity: 'company',
      name: entity.name,
    });
  }

  /**
   * Delete a single company, refused while it is in use (`beforeDelete`).
   */
  override async delete(companyId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);

    const company = await repo.findOne({ where: { id: companyId } as any });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    // Check for references - throws a RecordInUseException (409) if found
    await this.beforeDelete(company, manager);

    try {
      // Delete the company
      await repo.delete({ id: companyId } as any);
    } catch (error: any) {
      // A foreign key the reference check did not cover (or a row added since): say which records, when known.
      if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
        const users = COMPANY_REFERENCING_TABLES[String(error.table ?? '')] ?? 'other records';
        throw new RecordInUseException('RECORD_IN_USE', 'company', company.name, [], `Cannot delete company "${company.name}": ${users} still use it. You can disable it instead.`);
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
          ...refusalDetails(error),
        });
      }
    }

    return result;
  }
}
