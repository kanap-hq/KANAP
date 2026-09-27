import { Injectable, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SpendItem } from '../spend/spend-item.entity';
import { CapexItem } from '../capex/capex-item.entity';

export interface ReferenceCheckResult {
  hasReferences: boolean;
  referenceDetails: string[];
  totalCount: number;
}

@Injectable()
export class ReferenceCheckService {
  /**
   * Check if a company is referenced by any spend or capex items
   */
  async checkCompanyReferences(
    companyId: string,
    opts?: { manager?: EntityManager }
  ): Promise<ReferenceCheckResult> {
    const mg = opts?.manager;
    if (!mg) {
      throw new Error('EntityManager required for reference checks');
    }

    const spendRepo = mg.getRepository(SpendItem);
    const capexRepo = mg.getRepository(CapexItem);

    const referenceDetails: string[] = [];
    let totalCount = 0;

    // Check spend_items (paying_company references)
    const spendCount = await spendRepo.count({ where: { paying_company_id: companyId } as any });
    if (spendCount > 0) {
      referenceDetails.push(`${spendCount} OPEX item(s) reference this as paying company`);
      totalCount += spendCount;
    }

    // Check capex_items (paying company references)
    const capexCount = await capexRepo.count({ where: { paying_company_id: companyId } as any });
    if (capexCount > 0) {
      referenceDetails.push(`${capexCount} CAPEX item(s) reference this as paying company`);
      totalCount += capexCount;
    }

    return {
      hasReferences: totalCount > 0,
      referenceDetails,
      totalCount,
    };
  }

  /**
   * Check if a supplier is referenced by any spend items
   */
  async checkSupplierReferences(
    supplierId: string,
    opts?: { manager?: EntityManager }
  ): Promise<ReferenceCheckResult> {
    const mg = opts?.manager;
    if (!mg) {
      throw new Error('EntityManager required for reference checks');
    }

    const spendRepo = mg.getRepository(SpendItem);

    const referenceDetails: string[] = [];

    const spendCount = await spendRepo.count({ where: { supplier_id: supplierId } });
    if (spendCount > 0) {
      referenceDetails.push(`${spendCount} OPEX item(s) reference this supplier`);
    }

    return {
      hasReferences: spendCount > 0,
      referenceDetails,
      totalCount: spendCount,
    };
  }

  /**
   * Check if an account is referenced by any spend items
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

    const spendCount = await spendRepo.count({ where: { account_id: accountId } });
    if (spendCount > 0) {
      referenceDetails.push(`${spendCount} OPEX item(s) reference this account`);
    }

    return {
      hasReferences: spendCount > 0,
      referenceDetails,
      totalCount: spendCount,
    };
  }

  /**
   * A company that cost centers belong to cannot go (their key is ON DELETE
   * RESTRICT): refused first, with the count, before the database would.
   */
  private async assertNoCostCenters(companyId: string, companyName: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager;
    if (!mg) {
      throw new Error('EntityManager required for reference checks');
    }
    const [row] = await mg.query(
      `SELECT count(*)::int AS n FROM cost_centers WHERE tenant_id = app_current_tenant() AND company_id = $1`,
      [companyId],
    );
    const count = Number(row?.n ?? 0);
    if (count > 0) {
      throw new ConflictException(
        `${companyName} is used by ${count} ${count === 1 ? 'cost center' : 'cost centers'}. Change their company or disable it instead.`,
      );
    }
  }

  /**
   * Assert that an entity has no references, throw ConflictException if it does
   */
  async assertNoReferences(
    entityType: 'company' | 'supplier' | 'account',
    entityId: string,
    entityName: string,
    opts?: { manager?: EntityManager }
  ): Promise<void> {
    let result: ReferenceCheckResult;

    switch (entityType) {
      case 'company':
        await this.assertNoCostCenters(entityId, entityName, opts);
        result = await this.checkCompanyReferences(entityId, opts);
        break;
      case 'supplier':
        result = await this.checkSupplierReferences(entityId, opts);
        break;
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
