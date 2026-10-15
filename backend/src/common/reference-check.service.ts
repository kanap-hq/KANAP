import { Injectable, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SpendItem } from '../spend/spend-item.entity';

export interface ReferenceCheckResult {
  hasReferences: boolean;
  referenceDetails: string[];
  totalCount: number;
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
    };
  }

  /**
   * Assert that an entity has no references, throw ConflictException if it does. Suppliers and
   * companies are checked by their delete services against their usages (`common/record-in-use.ts`).
   */
  async assertNoReferences(
    entityType: 'account',
    entityId: string,
    entityName: string,
    opts?: { manager?: EntityManager }
  ): Promise<void> {
    let result: ReferenceCheckResult;

    switch (entityType) {
      case 'account':
        result = await this.checkAccountReferences(entityId, opts);
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    if (result.hasReferences) {
      const details = result.referenceDetails.join('; ');
      throw new ConflictException(
        `Cannot delete ${entityType} "${entityName}": ${details}. Please disable instead or remove references first.`
      );
    }
  }
}
