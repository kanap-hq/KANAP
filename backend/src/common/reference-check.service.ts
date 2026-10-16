import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SpendItem } from '../spend/spend-item.entity';
import { lineUsages, RecordInUseException } from './record-in-use';

export interface ReferenceCheckResult {
  hasReferences: boolean;
  referenceDetails: string[];
  totalCount: number;
  /** The referencing budget lines of each nature. */
  opex: number;
  capex: number;
}

@Injectable()
export class ReferenceCheckService {
  /**
   * Check if an account is referenced by budget lines of either nature. A CAPEX line counts too
   * (lot Z1): `spend_items.account_id` has no delete action, and the old `capex_items` key was
   * `ON DELETE SET NULL`, which detached the lines in silence. The delete is refused instead,
   * naming the lines of each nature.
   */
  async checkAccountReferences(
    accountId: string,
    opts?: { manager?: EntityManager }
  ): Promise<ReferenceCheckResult> {
    const mg = opts?.manager;
    if (!mg) {
      throw new Error('EntityManager required for reference checks');
    }

    const spendRepo = mg.getRepository(SpendItem);

    const referenceDetails: string[] = [];

    // Each nature counted and named apart (`spend/budget-nature.ts`).
    const spendCount = await spendRepo.count({ where: { account_id: accountId, nature: 'opex' } });
    if (spendCount > 0) {
      referenceDetails.push(`${spendCount} OPEX item(s) reference this account`);
    }
    const capexCount = await spendRepo.count({ where: { account_id: accountId, nature: 'capex' } });
    if (capexCount > 0) {
      referenceDetails.push(`${capexCount} CAPEX item(s) reference this account`);
    }

    return {
      hasReferences: spendCount + capexCount > 0,
      referenceDetails,
      totalCount: spendCount + capexCount,
      opex: spendCount,
      capex: capexCount,
    };
  }

  /**
   * The refusal of an account's delete (`ACCOUNT_IN_USE`, the budget lines of each nature
   * counted: disable it instead), or null. Suppliers and companies are checked by their delete
   * services against their usages (`common/record-in-use.ts`).
   */
  async accountRefusal(
    accountId: string,
    accountName: string,
    opts?: { manager?: EntityManager }
  ): Promise<RecordInUseException | null> {
    const result = await this.checkAccountReferences(accountId, opts);
    if (!result.hasReferences) return null;
    return new RecordInUseException(
      'ACCOUNT_IN_USE',
      'account',
      accountName,
      lineUsages(result),
      `Cannot delete account "${accountName}": ${result.referenceDetails.join('; ')}. Please disable instead or remove references first.`,
    );
  }

  /** Throws the refusal of an entity's delete, if any (`accountRefusal`). */
  async assertNoReferences(
    entityType: 'account',
    entityId: string,
    entityName: string,
    opts?: { manager?: EntityManager }
  ): Promise<void> {
    if (entityType !== 'account') throw new Error(`Unknown entity type: ${entityType}`);
    const refusal = await this.accountRefusal(entityId, entityName, opts);
    if (refusal) throw refusal;
  }
}
