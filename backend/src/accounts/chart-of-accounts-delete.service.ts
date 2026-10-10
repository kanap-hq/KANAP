import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ChartOfAccounts } from './chart-of-accounts.entity';
import { AuditService } from '../audit/audit.service';
import { Company } from '../companies/company.entity';
import { Account } from './account.entity';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { CURRENT_TENANT, lockTenantCharts } from './consolidation';

@Injectable()
export class ChartOfAccountsDeleteService extends BaseDeleteService<ChartOfAccounts> {
  protected override readonly logger = new Logger(ChartOfAccountsDeleteService.name);

  constructor(
    @InjectRepository(ChartOfAccounts) repository: Repository<ChartOfAccounts>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'ChartOfAccounts',
      auditTable: 'chart_of_accounts',
      cascadeRelations: [
        {
          repository: Account,
          foreignKey: 'coa_id',
          deleteStrategy: 'cascade',
        },
      ],
    });
  }

  /**
   * Get display name for a chart of accounts
   */
  private getCoaDisplayName(coa: ChartOfAccounts): string {
    return `${coa.code} - ${coa.name}`;
  }

  /**
   * Override delete to check for company references and OPEX/CAPEX usage
   */
  override async delete(id: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);

    // In the order every chart writer locks the charts (an account write holds them FOR SHARE).
    await lockTenantCharts(manager);
    const existing = await repo.findOne({ where: { id } as any });
    if (!existing) {
      throw new NotFoundException('Chart of Accounts not found');
    }

    // Check for company references
    const companyCount = await manager.getRepository(Company).count({ where: { coa_id: id } as any });
    if (companyCount > 0) {
      throw new ConflictException(`Cannot delete: ${companyCount} companies reference this Chart of Accounts`);
    }

    // Count OPEX usage of accounts under this CoA
    const opexUsageRows = await manager.query(
      `SELECT COUNT(*)::int AS count
       FROM spend_items si
       JOIN accounts a ON a.id = si.account_id AND a.tenant_id = si.tenant_id
       WHERE a.coa_id = $1 AND si.tenant_id = ${CURRENT_TENANT} AND si.nature = 'opex'`,
      [id],
    );
    const opexCount = Number(opexUsageRows?.[0]?.count ?? 0);

    // CAPEX usage: items referencing accounts under this CoA
    const capexUsageRows = await manager.query(
      `SELECT COUNT(*)::int AS count
       FROM spend_items ci
       JOIN accounts a ON a.id = ci.account_id AND a.tenant_id = ci.tenant_id
       WHERE a.coa_id = $1 AND ci.tenant_id = ${CURRENT_TENANT} AND ci.nature = 'capex'`,
      [id],
    );
    const capexCount = Number(capexUsageRows?.[0]?.count ?? 0);

    if (opexCount + capexCount > 0) {
      throw new ConflictException(`Cannot delete: ${opexCount} OPEX and ${capexCount} CAPEX item(s) reference accounts in this Chart of Accounts`);
    }

    // No usage: remove accounts within this CoA, then delete the CoA
    await manager.getRepository(Account).delete({ coa_id: id } as any);
    await repo.delete({ id } as any);

    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'chart_of_accounts',
          recordId: id,
          action: 'delete',
          before: existing,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager },
      );
    }
  }

  /**
   * Bulk delete multiple charts of accounts
   */
  async bulkDelete(ids: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of ids) {
      try {
        await withSavepoint(manager, () => this.delete(id, { manager, userId }));
        result.deleted.push(id);
      } catch (err: any) {
        let name = 'Unknown';
        try {
          const found = await withSavepoint(manager, () => repo.findOne({ where: { id } as any }));
          if (found) name = this.getCoaDisplayName(found);
        } catch (e: any) {
          this.logger.warn(`Failed to fetch chart of accounts name for error reporting: ${e?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: err?.message || 'Unknown error' });
      }
    }
    return result;
  }
}
