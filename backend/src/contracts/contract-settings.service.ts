import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Tenant } from '../tenants/tenant.entity';
import { CONTRACT_DECISION_WINDOW_DAYS } from './contract-terms';

/**
 * The contract settings of a tenant, stored in `tenants.metadata.contracts` like the budget column
 * names (`metadata.budget_columns`): no table, no migration. A tenant reset gives the defaults back
 * (`TenantResetService.resetMetadata` keeps only `it_ops`, `demo` and the seed language).
 *
 * `decision_window_days`: the days before a cancellation deadline during which a renewing contract
 * awaits a decision (`term_state = 'to_decide'`, the "to decide" quick filter and its count, the
 * window drawn on the contract page, the renewal decision task and box). Whole days, 0 to 365.
 */
export const CONTRACT_SETTINGS_METADATA_KEY = 'contracts';
export const DECISION_WINDOW_MIN_DAYS = 0;
export const DECISION_WINDOW_MAX_DAYS = 365;

export type ContractSettings = { decision_window_days: number };

export const DEFAULT_CONTRACT_SETTINGS: ContractSettings = { decision_window_days: CONTRACT_DECISION_WINDOW_DAYS };

function validWindow(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= DECISION_WINDOW_MIN_DAYS && value <= DECISION_WINDOW_MAX_DAYS;
}

/** The stored settings, each value that is missing or invalid replaced by its default. */
export function normalizeContractSettings(raw: unknown): ContractSettings {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    decision_window_days: validWindow(stored.decision_window_days) ? stored.decision_window_days : DEFAULT_CONTRACT_SETTINGS.decision_window_days,
  };
}

/** `current` with the fields of `patch`; refuses a value out of range (400). Unknown fields are ignored. */
export function applyContractSettingsPatch(current: ContractSettings, patch: unknown): ContractSettings {
  const body = patch && typeof patch === 'object' && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const next = { ...current };
  if (body.decision_window_days !== undefined) {
    if (!validWindow(body.decision_window_days)) {
      throw new BadRequestException(
        `decision_window_days must be a whole number of days from ${DECISION_WINDOW_MIN_DAYS} to ${DECISION_WINDOW_MAX_DAYS}.`,
      );
    }
    next.decision_window_days = body.decision_window_days;
  }
  return next;
}

/** The settings of `tenantId`, or of the session tenant when it is not given. */
export async function readContractSettings(manager: EntityManager, tenantId?: string | null): Promise<ContractSettings> {
  const rows: Array<{ value: unknown }> = await manager.query(
    `SELECT metadata->'${CONTRACT_SETTINGS_METADATA_KEY}' AS value FROM tenants WHERE id = COALESCE($1::uuid, app_current_tenant())`,
    [tenantId ?? null],
  );
  return normalizeContractSettings(rows[0]?.value);
}

/** The decision window of `tenantId` (the session tenant when it is not given), in days. */
export async function readDecisionWindowDays(manager: EntityManager, tenantId?: string | null): Promise<number> {
  return (await readContractSettings(manager, tenantId)).decision_window_days;
}

@Injectable()
export class ContractSettingsService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly audit: AuditService,
  ) {}

  get(tenantId: string, manager?: EntityManager): Promise<ContractSettings> {
    return readContractSettings(manager ?? this.tenants.manager, tenantId);
  }

  /**
   * Merges and validates under the tenant row lock, then writes only the `contracts` key: the
   * other metadata keys are never rewritten from a stale copy (as `BudgetColumnsService.update`).
   */
  async update(tenantId: string, patch: unknown, userId: string | null, manager?: EntityManager): Promise<ContractSettings> {
    return (manager ?? this.tenants.manager).transaction(async (tx) => {
      const rows: Array<{ value: unknown }> = await tx.query(
        `SELECT metadata->'${CONTRACT_SETTINGS_METADATA_KEY}' AS value FROM tenants WHERE id = $1 FOR NO KEY UPDATE`,
        [tenantId],
      );
      if (rows.length === 0) throw new NotFoundException('Tenant not found');
      const before = normalizeContractSettings(rows[0].value);
      const after = applyContractSettingsPatch(before, patch);
      await tx.query(
        `UPDATE tenants
            SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{${CONTRACT_SETTINGS_METADATA_KEY}}', $2::jsonb, true)
          WHERE id = $1`,
        [tenantId, JSON.stringify(after)],
      );
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await this.audit.log(
          { table: 'tenants', recordId: tenantId, action: 'update', before: { contracts: before }, after: { contracts: after }, userId },
          { manager: tx },
        );
      }
      return after;
    });
  }
}
