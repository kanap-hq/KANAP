import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CapexVersion } from './capex-version.entity';
import { AuditService } from '../audit/audit.service';
import { CapexItem } from './capex-item.entity';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { ensureBudgetVersion } from '../spend/budget-version-ensure';

@Injectable()
export class CapexVersionsService {
  constructor(
    @InjectRepository(CapexVersion) private readonly repo: Repository<CapexVersion>,
    @InjectRepository(CapexItem) private readonly items: Repository<CapexItem>,
    private readonly audit: AuditService,
    private readonly currencySettings: CurrencySettingsService,
  ) {}

  listForItem(itemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(CapexVersion).find({ where: { capex_item_id: itemId } as any, order: { created_at: 'DESC' as any } });
  }

  /**
   * Get-or-create of the item's version of a year (`budget_year`, else the
   * current year): an existing version of that year is returned as it is,
   * also when a concurrent request created it a moment ago (see
   * `spend/budget-version-ensure.ts`). A name already used by another year of
   * the item is refused (400).
   * With `refuseExisting`, an existing version of the year is refused (409)
   * instead of returned: for a caller that asked to create one and would
   * otherwise report a creation that did not happen (the AI action).
   */
  async createForItem(itemId: string, body: Partial<CapexVersion>, userId?: string | null, opts?: { manager?: EntityManager; refuseExisting?: boolean }) {
    const mg = opts?.manager ?? this.repo.manager;
    if (!body.version_name) throw new BadRequestException('version_name required');
    const budgetYear = body.budget_year != null ? Number(body.budget_year) : new Date().getFullYear();

    const allocationMethod = (body as any).allocation_method ?? 'default';
    const allocationDriver =
      (body as any).allocation_driver ??
      (allocationMethod === 'it_users'
        ? 'it_users'
        : allocationMethod === 'turnover'
        ? 'turnover'
        : 'headcount');

    const item = await mg.getRepository(CapexItem).findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('CAPEX item not found');
    const settings = await this.currencySettings.getSettings(item.tenant_id, { manager: mg });

    const ensured = await ensureBudgetVersion(mg, 'capex', {
      tenantId: item.tenant_id,
      itemId,
      year: budgetYear,
      versionName: String(body.version_name),
      inputGrain: (body as any).input_grain ?? 'annual',
      asOfDate: body.as_of_date ?? new Date().toISOString().slice(0, 10),
      allocationMethod,
      allocationDriver,
      notes: body.notes ?? null,
      reportingCurrency: settings.reportingCurrency,
    });
    if (!ensured) throw new BadRequestException('Version name already exists for this item');
    if (!ensured.created && opts?.refuseExisting) {
      throw new ConflictException(`This line already has a budget version for ${budgetYear}.`);
    }
    if (ensured.created) {
      await this.audit.log({ table: 'capex_versions', recordId: ensured.version.id, action: 'create', before: null, after: ensured.version, userId }, { manager: mg });
    }
    return ensured.version;
  }

  async updateForItem(itemId: string, body: Partial<CapexVersion> & { id: string }, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexVersion);
    const existing = await repo.findOne({ where: { id: body.id } });
    if (!existing) throw new NotFoundException('Version not found');
    if (existing.capex_item_id !== itemId) throw new BadRequestException('Version does not belong to item');

    if (body.version_name && body.version_name !== existing.version_name) {
      const dup = await repo.findOne({ where: { capex_item_id: itemId, version_name: String(body.version_name) } as any });
      if (dup) throw new BadRequestException('Version name already exists for this item');
    }
    if (body.budget_year != null && body.budget_year !== existing.budget_year) {
      throw new BadRequestException('budget_year is immutable');
    }

    const { allocation_method, allocation_driver, is_approved, budget_year, reporting_currency, fx_rate_set_id, ...rest } = body as any;
    const next = { ...existing, ...rest } as CapexVersion;
    if (allocation_method) {
      next.allocation_method = allocation_method;
      if (!allocation_driver) {
        next.allocation_driver = allocation_method === 'it_users' ? 'it_users' : allocation_method === 'turnover' ? 'turnover' : 'headcount';
      }
    }
    if (allocation_driver) next.allocation_driver = allocation_driver;
    if (reporting_currency) {
      next.reporting_currency = String(reporting_currency).trim().toUpperCase().slice(0, 3);
    }
    if (is_approved === false) {
      next.fx_rate_set_id = null;
    }
    const saved = await repo.save(next);
    await this.audit.log({ table: 'capex_versions', recordId: saved.id, action: 'update', before: existing, after: saved, userId }, { manager: mg });
    return saved;
  }
}
