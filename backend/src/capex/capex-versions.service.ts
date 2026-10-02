import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CapexVersion } from './capex-version.entity';
import { AuditService } from '../audit/audit.service';
import { CapexItem } from './capex-item.entity';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { ensureBudgetVersion, updateBudgetVersionUnderLock } from '../spend/budget-version-ensure';
import { lockBudgetLine } from '../spend/budget-locks';

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

    // Lock order (`budget-locks.ts`): the line first, so a create waits for any writer of the line's budget.

    if (!(await lockBudgetLine(mg, 'capex', item.tenant_id, itemId))) throw new NotFoundException('CAPEX item not found');
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

  /** Only the fields the body supplies, under the line's and the version's locks; see `updateBudgetVersionUnderLock`. */
  async updateForItem(itemId: string, body: Partial<CapexVersion> & { id: string }, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const { before, after } = await updateBudgetVersionUnderLock(mg, 'capex', itemId, body as any, 'Version name already exists for this item');
    await this.audit.log({ table: 'capex_versions', recordId: after.id, action: 'update', before, after, userId }, { manager: mg });
    return after as CapexVersion;
  }
}
