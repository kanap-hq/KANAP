import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Account } from './account.entity';
import { AuditService } from '../audit/audit.service';
import { ReferenceCheckService } from '../common/reference-check.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

@Injectable()
export class AccountsDeleteService extends BaseDeleteService<Account> {
  protected override readonly logger = new Logger(AccountsDeleteService.name);

  constructor(
    @InjectRepository(Account) repository: Repository<Account>,
    audit: AuditService,
    private readonly referenceCheck: ReferenceCheckService,
  ) {
    super(repository, null, audit, {
      entityName: 'Account',
      auditTable: 'accounts',
      cascadeRelations: [],
    });
  }

  /**
   * Get display name for account
   */
  private getAccountDisplayName(account: Account): string {
    return `${account.account_number} - ${account.account_name}`;
  }

  /**
   * Check for references before deletion
   */
  protected override async beforeDelete(entity: Account, manager: EntityManager): Promise<void> {
    const accountName = this.getAccountDisplayName(entity);
    await this.referenceCheck.assertNoReferences('account', entity.id, accountName, { manager });
  }

  /**
   * Delete a single account
   */
  override async delete(accountId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);

    const account = await repo.findOne({ where: { id: accountId } as any });
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const accountName = this.getAccountDisplayName(account);

    // Check for references - will throw ConflictException if found
    await this.beforeDelete(account, manager);

    try {
      await repo.delete({ id: accountId } as any);
    } catch (error: any) {
      // Catch database-level foreign key errors (e.g., from allocations)
      if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
        throw new ConflictException(
          `Cannot delete account "${accountName}": it is being used in allocations for OPEX or CAPEX items. You can disable it if it shouldn't be used actively anymore.`
        );
      }
      throw error;
    }

    // Audit log
    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'accounts',
          recordId: accountId,
          action: 'delete',
          before: account,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager }
      );
    }
  }

  /**
   * Bulk delete multiple accounts
   */
  async bulkDelete(accountIds: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const accountId of accountIds) {
      try {
        await withSavepoint(manager, () => this.delete(accountId, { manager, userId }));
        result.deleted.push(accountId);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const account = await withSavepoint(manager, () => repo.findOne({ where: { id: accountId } as any }));
          if (account) name = this.getAccountDisplayName(account);
        } catch (err: any) {
          this.logger.warn(`Failed to fetch account name for error reporting: ${err?.message || 'Unknown error'}`);
        }

        result.failed.push({
          id: accountId,
          name,
          reason: error.message || 'Unknown error',
        });
      }
    }

    return result;
  }
}
