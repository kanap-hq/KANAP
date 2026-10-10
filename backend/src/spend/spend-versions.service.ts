import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SpendVersion } from './spend-version.entity';
import { AuditService } from '../audit/audit.service';
import { SpendItem } from './spend-item.entity';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { ensureBudgetVersion, updateBudgetVersionUnderLock } from './budget-version-ensure';
import { lockBudgetLine } from './budget-locks';

@Injectable()
export class SpendVersionsService {
  constructor(
    @InjectRepository(SpendVersion) private readonly repo: Repository<SpendVersion>,
    @InjectRepository(SpendItem) private readonly items: Repository<SpendItem>,
    private readonly audit: AuditService,
    private readonly currencySettings: CurrencySettingsService,
  ) {}

  /** The versions of an OPEX line; none for a line of another nature (`budget-nature.ts`). */
  async listForItem(itemId: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(SpendVersion);
    return repo.createQueryBuilder('v')
      .innerJoin(SpendItem, 'i', `i.id = v.spend_item_id AND i.tenant_id = v.tenant_id AND i.nature = 'opex'`)
      .where('v.spend_item_id = :itemId', { itemId })
      .orderBy('v.created_at', 'DESC')
      .getMany();
  }

  /** A version of an OPEX line; a version of another nature's line is not found. */
  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(SpendVersion);
    const found = await repo.createQueryBuilder('v')
      .innerJoin(SpendItem, 'i', `i.id = v.spend_item_id AND i.tenant_id = v.tenant_id AND i.nature = 'opex'`)
      .where('v.id = :id', { id })
      .getOne();
    if (!found) throw new NotFoundException('Version not found');
    return found;
  }

  /**
   * Get-or-create of the item's version of a year (`budget_year`, else the
   * year of `as_of_date`): an existing version of that year is returned as it
   * is, also when a concurrent request created it a moment ago (see
   * `budget-version-ensure.ts`). A name already used by another year of the
   * item is refused (400).
   * With `refuseExisting`, an existing version of the year is refused (409)
   * instead of returned: for a caller that asked to create one and would
   * otherwise report a creation that did not happen (the AI action).
   */
  async createForItem(itemId: string, body: Partial<SpendVersion>, userId?: string, opts?: { manager?: EntityManager; refuseExisting?: boolean }) {
    if (!body.version_name) throw new BadRequestException('version_name required');
    const asOf = body.as_of_date ?? new Date().toISOString().slice(0, 10);
    const yr = typeof (body as any).budget_year === 'number' ? (body as any).budget_year : new Date(asOf).getFullYear();

    const allocationMethod = ((body as any).allocation_method as any) ?? 'default';
    const allocationDriver = ((body as any).allocation_driver as any) ?? (allocationMethod === 'it_users' ? 'it_users' : allocationMethod === 'turnover' ? 'turnover' : 'headcount');
    const mg = opts?.manager ?? this.repo.manager;
    const itemRepo = mg.getRepository(SpendItem);
    const item = await itemRepo.findOne({ where: { id: itemId, nature: 'opex' } });
    if (!item) throw new NotFoundException('Spend item not found');
    // Lock order (`budget-locks.ts`): the line first, so a create waits for any writer of the line's budget.
    if (!(await lockBudgetLine(mg, 'opex', item.tenant_id, itemId))) throw new NotFoundException('Spend item not found');
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
    if (!ensured.created && opts?.refuseExisting) {
      throw new ConflictException(`This line already has a budget version for ${yr}.`);
    }
    if (ensured.created) {
      await this.audit.log({ table: 'spend_versions', recordId: ensured.version.id, action: 'create', before: null, after: ensured.version, userId }, { manager: mg });
    }
    return ensured.version;
  }

  /** Only the fields the body supplies, under the line's and the version's locks; see `updateBudgetVersionUnderLock`. */
  async updateForItem(itemId: string, body: Partial<SpendVersion> & { id: string }, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const { before, after } = await updateBudgetVersionUnderLock(mg, 'opex', itemId, body as any, 'version_name must be unique per item');
    await this.audit.log({ table: 'spend_versions', recordId: after.id, action: 'update', before, after, userId }, { manager: mg });
    return after as SpendVersion;
  }
}
