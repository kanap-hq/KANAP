import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { checkIds, lineUsages, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal, type UsageCount } from '../common/record-in-use';

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
   * The refusal of a chart's delete (`CHART_OF_ACCOUNTS_IN_USE`: the companies that use it and
   * the budget lines on its accounts, counted), or null. Moving the companies to another chart
   * and the lines to other accounts frees it.
   */
  private async refusalOf(coa: ChartOfAccounts, manager: EntityManager): Promise<RecordInUseException | null> {
    const [counts]: Array<{ companies: number; opex: number; capex: number }> = await manager.query(
      `SELECT
         (SELECT count(*)::int FROM companies c WHERE c.tenant_id = ${CURRENT_TENANT} AND c.coa_id = $1) AS companies,
         (SELECT count(*)::int FROM spend_items si JOIN accounts a ON a.id = si.account_id AND a.tenant_id = si.tenant_id
           WHERE a.coa_id = $1 AND si.tenant_id = ${CURRENT_TENANT} AND si.nature = 'opex') AS opex,
         (SELECT count(*)::int FROM spend_items ci JOIN accounts a ON a.id = ci.account_id AND a.tenant_id = ci.tenant_id
           WHERE a.coa_id = $1 AND ci.tenant_id = ${CURRENT_TENANT} AND ci.nature = 'capex') AS capex`,
      [coa.id],
    );
    const companies = Number(counts?.companies ?? 0);
    const opex = Number(counts?.opex ?? 0);
    const capex = Number(counts?.capex ?? 0);
    if (companies + opex + capex === 0) return null;
    const usages: UsageCount[] = [
      ...(companies > 0 ? [{ type: 'companies' as const, total: companies }] : []),
      ...lineUsages({ opex, capex }),
    ];
    const message = companies > 0
      ? `Cannot delete: ${companies} companies reference this Chart of Accounts`
      : `Cannot delete: ${opex} OPEX and ${capex} CAPEX item(s) reference accounts in this Chart of Accounts`;
    return new RecordInUseException('CHART_OF_ACCOUNTS_IN_USE', 'chart of accounts', this.getCoaDisplayName(coa), usages, message);
  }

  /** The check before a delete (`POST /chart-of-accounts/delete-check`): which of `ids` would be refused, and why. Nothing is written. */
  async deleteCheck(ids: string[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: ChartOfAccounts[] = await manager.query(
      `SELECT id, code, name FROM chart_of_accounts WHERE tenant_id = ${CURRENT_TENANT} AND id = ANY($1::uuid[])`,
      [wanted],
    );
    return refusalsFrom(wanted, rows, (row) => this.getCoaDisplayName(row), (row) => this.refusalOf(row, manager));
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

    const refusal = await this.refusalOf(existing, manager);
    if (refusal) throw refusal;

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
        result.failed.push({ id, name, reason: err?.message || 'Unknown error', ...refusalDetails(err) });
      }
    }
    return result;
  }
}
