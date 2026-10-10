import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { SpendVersion } from './spend-version.entity';
import { SpendAmount } from './spend-amount.entity';
import { SpendAllocation } from './spend-allocation.entity';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { BudgetColumn } from './amounts-write.util';
import { clearBudgetColumn, copyBudgetColumn, CopyColumnOperation } from './budget-column-operations';
import { copyAllocations, CopyAllocationsOperation } from './budget-allocation-operations';
import type { BudgetNature } from './budget-nature';

@Injectable()
export class SpendBudgetOperationsService {
  constructor(
    @InjectRepository(SpendItem) private readonly spendItems: Repository<SpendItem>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    @InjectRepository(SpendAmount) private readonly amounts: Repository<SpendAmount>,
    @InjectRepository(SpendAllocation) private readonly allocations: Repository<SpendAllocation>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly allocationCalculator: AllocationCalculatorService,
  ) {}

  /** Copy one budget column of the lines of `nature` to another year or column (all or nothing); see `budget-column-operations.ts`. */
  async copyBudgetColumn(operation: CopyColumnOperation, userId: string | null, opts?: { manager?: EntityManager; nature?: BudgetNature }) {
    const manager = opts?.manager ?? this.spendItems.manager;
    return copyBudgetColumn({ manager, audit: this.audit, freeze: this.freeze }, opts?.nature ?? 'opex', operation, userId);
  }

  /** Copy the allocations of the lines of `nature` to another year (all or nothing); see `budget-allocation-operations.ts`. */
  async copyAllocations(operation: CopyAllocationsOperation, userId: string | null, opts?: { manager?: EntityManager; nature?: BudgetNature }) {
    const manager = opts?.manager ?? this.spendItems.manager;
    return copyAllocations({ manager, audit: this.audit, calculator: this.allocationCalculator }, opts?.nature ?? 'opex', operation, userId);
  }

  /** Clear one budget column of a year of the lines of `nature` (all or nothing); see `budget-column-operations.ts`. */
  async clearBudgetColumn(operation: { year: number; column: BudgetColumn }, userId: string | null, opts?: { manager?: EntityManager; nature?: BudgetNature }) {
    const manager = opts?.manager ?? this.spendItems.manager;
    return clearBudgetColumn({ manager, audit: this.audit, freeze: this.freeze }, opts?.nature ?? 'opex', operation, userId);
  }
}
