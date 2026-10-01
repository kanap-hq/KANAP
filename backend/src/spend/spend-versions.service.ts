import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SpendVersion } from './spend-version.entity';
import { AuditService } from '../audit/audit.service';
import { SpendItem } from './spend-item.entity';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { ensureBudgetVersion } from './budget-version-ensure';

@Injectable()
export class SpendVersionsService {
  constructor(
    @InjectRepository(SpendVersion) private readonly repo: Repository<SpendVersion>,
    @InjectRepository(SpendItem) private readonly items: Repository<SpendItem>,
    private readonly audit: AuditService,
    private readonly currencySettings: CurrencySettingsService,
  ) {}

  async listForItem(itemId: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(SpendVersion);
    return repo.find({ where: { spend_item_id: itemId }, order: { created_at: 'DESC' as any } });
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(SpendVersion);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Version not found');
    return found;
  }

  /**
   * Get-or-create of the item's version of a year (`budget_year`, else the
   * year of `as_of_date`): an existing version of that year is returned as it
   * is, also when a concurrent request created it a moment ago (see
   * `budget-version-ensure.ts`). A name already used by another year of the
   * item is refused (400).
   */
  async createForItem(itemId: string, body: Partial<SpendVersion>, userId?: string, opts?: { manager?: EntityManager }) {
    if (!body.version_name) throw new BadRequestException('version_name required');
    const asOf = body.as_of_date ?? new Date().toISOString().slice(0, 10);
    const yr = typeof (body as any).budget_year === 'number' ? (body as any).budget_year : new Date(asOf).getFullYear();

    const allocationMethod = ((body as any).allocation_method as any) ?? 'default';
    const allocationDriver = ((body as any).allocation_driver as any) ?? (allocationMethod === 'it_users' ? 'it_users' : allocationMethod === 'turnover' ? 'turnover' : 'headcount');
    const mg = opts?.manager ?? this.repo.manager;
    const itemRepo = mg.getRepository(SpendItem);
    const item = await itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Spend item not found');
    const tenantId = item.tenant_id;
    const settings = await this.currencySettings.getSettings(tenantId, { manager: mg });

    const ensured = await ensureBudgetVersion(mg, 'opex', {
      tenantId,
      itemId,
      year: yr,
      versionName: String(body.version_name),
      inputGrain: (body.input_grain as any) ?? 'annual',
      asOfDate: asOf,
      allocationMethod,
      allocationDriver,
      notes: body.notes ?? null,
      reportingCurrency: settings.reportingCurrency,
    });
    if (!ensured) throw new BadRequestException('version_name must be unique per item');
    if (ensured.created) {
      await this.audit.log({ table: 'spend_versions', recordId: ensured.version.id, action: 'create', before: null, after: ensured.version, userId }, { manager: mg });
    }
    return ensured.version;
  }

  async updateForItem(itemId: string, body: Partial<SpendVersion> & { id: string }, userId?: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(SpendVersion);
    if (!body?.id) throw new BadRequestException('id is required');
    const existing = await this.get(body.id, { manager: opts?.manager });
    if (existing.spend_item_id !== itemId) throw new BadRequestException('Version does not belong to item');

    // Prevent changing budget_year
    if ((body as any).budget_year != null && (body as any).budget_year !== (existing as any).budget_year) {
      throw new BadRequestException('budget_year is immutable');
    }

    // Enforce version_name uniqueness if changed
    if (body.version_name && body.version_name !== existing.version_name) {
    const dup = await repo.findOne({ where: { spend_item_id: itemId, version_name: String(body.version_name) } });
      if (dup) throw new BadRequestException('version_name must be unique per item');
    }

    const { budget_year, allocation_method, allocation_driver, is_approved, reporting_currency, fx_rate_set_id, ...rest } = body as any;
    const next = { ...existing, ...rest, budget_year: existing.budget_year } as SpendVersion;
    if (allocation_method) {
      (next as any).allocation_method = allocation_method;
      if (!allocation_driver) {
        (next as any).allocation_driver = allocation_method === 'it_users' ? 'it_users' : allocation_method === 'turnover' ? 'turnover' : 'headcount';
      }
    }
    if (allocation_driver) (next as any).allocation_driver = allocation_driver;

    if (reporting_currency) {
      (next as any).reporting_currency = String(reporting_currency).trim().toUpperCase().slice(0, 3);
    }

    if (is_approved === false) {
      (next as any).fx_rate_set_id = null;
    }

    const saved = await repo.save(next);
    await this.audit.log({ table: 'spend_versions', recordId: saved.id, action: 'update', before: existing, after: saved, userId }, { manager: opts?.manager ?? this.repo.manager });
    return saved;
  }
}
