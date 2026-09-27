import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';
import { CapexVersion } from './capex-version.entity';
import { AuditService } from '../audit/audit.service';
import { CapexItem } from './capex-item.entity';
import { CurrencySettingsService } from '../currency/currency-settings.service';

const DUPLICATE_YEAR_MESSAGE = 'A version for this budget year already exists';

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

  async createForItem(itemId: string, body: Partial<CapexVersion>, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexVersion);
    if (!body.version_name) throw new BadRequestException('version_name required');
    const dup = await repo.findOne({ where: { capex_item_id: itemId, version_name: String(body.version_name) } as any });
    if (dup) throw new BadRequestException('Version name already exists for this item');

    const budgetYear = body.budget_year != null ? Number(body.budget_year) : new Date().getFullYear();
    const dupYear = await repo.findOne({ where: { capex_item_id: itemId, budget_year: budgetYear } as any });
    if (dupYear) throw new BadRequestException(DUPLICATE_YEAR_MESSAGE);

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

    const toCreate: DeepPartial<CapexVersion> = {
      capex_item_id: itemId,
      version_name: body.version_name,
      input_grain: (body as any).input_grain ?? 'annual',
      is_approved: false,
      as_of_date: body.as_of_date ?? new Date().toISOString().slice(0, 10),
      budget_year: budgetYear,
      allocation_method: allocationMethod,
      allocation_driver: allocationDriver,
      notes: body.notes ?? null,
      reporting_currency: settings.reportingCurrency,
    };
    let saved: CapexVersion;
    try {
      saved = await repo.save(repo.create(toCreate));
    } catch (err) {
      // Two concurrent creates of the same year both pass the check above;
      // the loser hits the unique index.
      const { code, constraint } = (err ?? {}) as { code?: string; constraint?: string };
      if (code === '23505' && constraint === 'uniq_capex_item_budget_year') {
        throw new BadRequestException(DUPLICATE_YEAR_MESSAGE);
      }
      throw err;
    }
    await this.audit.log({ table: 'capex_versions', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
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
