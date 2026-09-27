import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { AuditService } from '../audit/audit.service';
import {
  applyBudgetColumnsPatch,
  BudgetColumnsSettings,
  normalizeBudgetColumns,
  readBudgetColumns,
} from './budget-columns.util';

@Injectable()
export class BudgetColumnsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string, manager?: EntityManager): Promise<BudgetColumnsSettings> {
    return readBudgetColumns(manager ?? this.tenants.manager, tenantId);
  }

  /**
   * Merge and validate under the tenant row lock, then write only the
   * `budget_columns` key: other metadata keys (currency, FX, IT landscape)
   * are never rewritten from a stale copy.
   */
  async update(tenantId: string, patch: unknown, userId: string | null, manager?: EntityManager): Promise<BudgetColumnsSettings> {
    return (manager ?? this.tenants.manager).transaction(async (tx) => {
      const rows: Array<{ value: unknown }> = await tx.query(
        `SELECT metadata->'budget_columns' AS value FROM tenants WHERE id = $1 FOR NO KEY UPDATE`,
        [tenantId],
      );
      if (rows.length === 0) throw new NotFoundException('Tenant not found');
      const before = normalizeBudgetColumns(rows[0].value);
      const after = applyBudgetColumnsPatch(before, patch);
      await tx.query(
        `UPDATE tenants
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{budget_columns}', $2::jsonb, true)
         WHERE id = $1`,
        [tenantId, JSON.stringify(after)],
      );
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await this.audit.log(
          { table: 'tenants', recordId: tenantId, action: 'update', before, after, userId },
          { manager: tx },
        );
      }
      return after;
    });
  }
}
