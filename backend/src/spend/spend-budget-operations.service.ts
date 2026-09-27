import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, In, Raw, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { SpendVersion } from './spend-version.entity';
import { SpendAmount } from './spend-amount.entity';
import { SpendAllocation } from './spend-allocation.entity';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { BudgetColumn } from './amounts-write.util';
import { formatAllocationMethodLabel } from './allocation-utils';
import { clearBudgetColumn, copyBudgetColumn, CopyColumnOperation } from './budget-column-operations';

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

  /** Copy one budget column to another year or column (all or nothing); see `budget-column-operations.ts`. */
  async copyBudgetColumn(operation: CopyColumnOperation, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = opts?.manager ?? this.spendItems.manager;
    return copyBudgetColumn({ manager, audit: this.audit, freeze: this.freeze }, 'opex', operation, userId);
  }

  async copyAllocations(
    operation: {
      sourceYear: number;
      destinationYear: number;
      overwrite?: boolean;
      dryRun?: boolean;
    },
    userId: string | null,
    opts?: { manager?: EntityManager }
  ) {
    const mg = opts?.manager ?? this.spendItems.manager;
    const sourceYear = Number(operation?.sourceYear);
    const destinationYear = Number(operation?.destinationYear);
    const overwrite = Boolean(operation?.overwrite);
    const dryRun = Boolean(operation?.dryRun);

    if (!Number.isInteger(sourceYear) || !Number.isInteger(destinationYear)) {
      throw new Error('sourceYear and destinationYear are required integer values');
    }
    if (sourceYear === destinationYear) {
      throw new Error('Source year and destination year must be different');
    }

    const spendItems = await mg.getRepository(SpendItem).find({
      where: {
        disabled_at: Raw((alias) => `${alias} IS NULL OR ${alias} > NOW()`),
      },
      order: { created_at: 'DESC' }
    });

    type AllocationAction = 'copy' | 'skip_missing_source_version' | 'skip_no_source_allocations' | 'skip_destination_has_data' | 'error';
    type AllocationPreview = {
      itemId: string;
      itemName: string;
      sourceMethod: string | null;
      sourceMethodLabel: string;
      destinationMethod: string | null;
      destinationMethodLabel: string;
      resultMethod: string | null;
      resultMethodLabel: string;
      sourceAllocationsCount: number;
      destinationAllocationsCount: number;
      action: AllocationAction;
      message?: string;
    };

    const results: AllocationPreview[] = [];
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const spendItem of spendItems) {
      try {
        const sourceVersion = await mg.getRepository(SpendVersion).findOne({
          where: { spend_item_id: spendItem.id, budget_year: sourceYear }
        });

        if (!sourceVersion) {
          if (dryRun) {
            results.push({
              itemId: spendItem.id,
              itemName: spendItem.product_name,
              sourceMethod: null,
              sourceMethodLabel: '',
              destinationMethod: null,
              destinationMethodLabel: '',
              resultMethod: null,
              resultMethodLabel: '',
              sourceAllocationsCount: 0,
              destinationAllocationsCount: 0,
              action: 'skip_missing_source_version',
              message: `No allocation data for ${sourceYear}`,
            });
          }
          skipped++;
          continue;
        }

        const sourceAllocations = await mg.getRepository(SpendAllocation).find({
          where: { version_id: sourceVersion.id }
        });
        const sourceManualAllocations = sourceAllocations.filter((alloc) => !alloc.is_system_generated);

        const sourceMethod = (sourceVersion.allocation_method as string | undefined) ?? 'default';
        const sourceMethodLabel = formatAllocationMethodLabel(sourceMethod);

        let destinationVersion = await mg.getRepository(SpendVersion).findOne({
          where: { spend_item_id: spendItem.id, budget_year: destinationYear }
        });

        let destinationAllocations: SpendAllocation[] = [];
        let destinationMethod: string | null = null;
        if (destinationVersion) {
          destinationAllocations = await mg.getRepository(SpendAllocation).find({
            where: { version_id: destinationVersion.id }
          });
          destinationMethod = (destinationVersion.allocation_method as string | undefined) ?? 'default';
        }
        const destinationManualAllocations = destinationAllocations.filter((alloc) => !alloc.is_system_generated);

        const destinationMethodLabel = formatAllocationMethodLabel(destinationMethod);

        const isSourceManual = sourceMethod === 'manual_company' || sourceMethod === 'manual_department' || sourceMethod === 'manual_pct';
        const hasSourceData = isSourceManual ? sourceManualAllocations.length > 0 : true;
        const hasDestinationData = destinationManualAllocations.length > 0;

        const sourceComputation = await this.allocationCalculator.computeForVersions([sourceVersion], { manager: mg });
        const sourceShareCount = sourceComputation.get(sourceVersion.id)?.shares.length ?? 0;

        let action: AllocationAction = 'copy';
        if (!hasSourceData) {
          action = 'skip_no_source_allocations';
        } else if (!overwrite && hasDestinationData) {
          action = 'skip_destination_has_data';
        }

        const resultMethod = action === 'copy' ? sourceMethod : destinationMethod;
        const resultMethodLabel = formatAllocationMethodLabel(resultMethod);

        if (dryRun) {
          results.push({
            itemId: spendItem.id,
            itemName: spendItem.product_name,
            sourceMethod,
            sourceMethodLabel,
            destinationMethod,
            destinationMethodLabel,
            resultMethod,
            resultMethodLabel,
            sourceAllocationsCount: sourceShareCount,
            destinationAllocationsCount: destinationManualAllocations.length,
            action,
            message: action === 'skip_destination_has_data' && !overwrite
              ? 'Destination already has allocations'
              : action === 'skip_no_source_allocations'
                ? 'No allocations in source year'
                : undefined,
          });
          if (action === 'copy') {
            processed++;
          } else {
            skipped++;
          }
          continue;
        }

        if (action !== 'copy') {
          skipped++;
          continue;
        }

        if (!destinationVersion) {
          const versionPartial: DeepPartial<SpendVersion> = {
            spend_item_id: spendItem.id,
            budget_year: destinationYear,
            version_name: `Budget ${destinationYear}`,
            input_grain: sourceVersion.input_grain ?? 'annual',
            is_approved: false,
            as_of_date: `${destinationYear}-01-01`,
            allocation_method: sourceMethod as any,
            tenant_id: spendItem.tenant_id,
            notes: sourceVersion.notes ?? null,
          };
          destinationVersion = mg.getRepository(SpendVersion).create(versionPartial);
          destinationVersion = await mg.getRepository(SpendVersion).save(destinationVersion);
          await this.audit.log({ table: 'spend_versions', recordId: destinationVersion.id, action: 'create', before: null, after: destinationVersion, userId }, { manager: mg });
        } else if ((destinationVersion.allocation_method as any) !== sourceMethod) {
          const beforeMethod = destinationVersion.allocation_method;
          await mg.getRepository(SpendVersion).update(destinationVersion.id, { allocation_method: sourceMethod as any });
          await this.audit.log({
            table: 'spend_versions',
            recordId: destinationVersion.id,
            action: 'update',
            before: { allocation_method: beforeMethod },
            after: { allocation_method: sourceMethod, operation: 'allocation_copy', sourceYear, destinationYear },
            userId
          }, { manager: mg });
          destinationVersion.allocation_method = sourceMethod as any;
        }

        if (destinationManualAllocations.length > 0) {
          await mg.getRepository(SpendAllocation).delete({ version_id: destinationVersion.id } as any);
        }
        const destIsManual = sourceMethod === 'manual_company' || sourceMethod === 'manual_department' || sourceMethod === 'manual_pct';
        if (destIsManual) {
          if (sourceManualAllocations.length === 0) {
            throw new Error(`Source item ${spendItem.product_name} has no manual allocations to copy.`);
          }
          const repo = mg.getRepository(SpendAllocation);
          const copies = sourceManualAllocations.map((alloc) => repo.create({
            tenant_id: destinationVersion!.tenant_id,
            version_id: destinationVersion!.id,
            company_id: alloc.company_id,
            department_id: alloc.department_id ?? null,
            allocation_pct: Number(alloc.allocation_pct || 0),
            is_system_generated: false,
            rule_id: null,
            materialized_from: null,
          }));
          await repo.save(copies);
        } else {
          await this.allocationCalculator.computeForVersions([destinationVersion], { manager: mg });
        }

        await this.audit.log({
          table: 'spend_allocations',
          recordId: destinationVersion.id,
          action: 'update',
          before: { count: destinationManualAllocations.length },
          after: { count: destIsManual ? sourceManualAllocations.length : 0, operation: 'allocation_copy', sourceYear, destinationYear, overwrite },
          userId
        }, { manager: mg });

        processed++;
      } catch (error) {
        // All or nothing: any error of a real copy, and any SQL error (it aborts
        // the request transaction), fails the request. Only a dry run lists an
        // item the allocation rules refuse (a BadRequestException, never SQL).
        if (!dryRun || !(error instanceof BadRequestException)) throw error;
        errors++;
        results.push({
          itemId: spendItem.id,
          itemName: spendItem.product_name,
          sourceMethod: null,
          sourceMethodLabel: '',
          destinationMethod: null,
          destinationMethodLabel: '',
          resultMethod: null,
          resultMethodLabel: '',
          sourceAllocationsCount: 0,
          destinationAllocationsCount: 0,
          action: 'error',
          message: error.message,
        });
      }
    }

    return {
      success: errors === 0,
      dryRun,
      summary: {
        totalItems: spendItems.length,
        processed,
        skipped,
        errors,
      },
      results: dryRun ? results : [],
    };
  }

  /** Clear one budget column of a year (all or nothing); see `budget-column-operations.ts`. */
  async clearBudgetColumn(operation: { year: number; column: BudgetColumn }, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = opts?.manager ?? this.spendItems.manager;
    return clearBudgetColumn({ manager, audit: this.audit, freeze: this.freeze }, 'opex', operation, userId);
  }
}
