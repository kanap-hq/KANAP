import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SpendVersion } from './spend-version.entity';
import { AuditService } from '../audit/audit.service';
import { SpendItem } from './spend-item.entity';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { ensureBudgetVersion, updateBudgetVersionUnderLock } from './budget-version-ensure';
import { lockBudgetLine } from './budget-locks';
import { auditTableOf, type BudgetNature } from './budget-nature';
import { presentChild, presentChildren } from './budget-line-presentation';

/** The messages and the year rule of each nature's routes, as before lot Z1. */
const NATURE_CONTRACT: Record<BudgetNature, { itemNotFound: string; duplicateName: string }> = {
  opex: { itemNotFound: 'Spend item not found', duplicateName: 'version_name must be unique per item' },
  capex: { itemNotFound: 'CAPEX item not found', duplicateName: 'Version name already exists for this item' },
};

/** The budget versions of the lines of one nature (`SpendVersionsService`, `CapexVersionsService`). */
@Injectable()
export class SpendVersionsService {
  /** The nature of the lines whose versions this service reads and writes. */
  protected readonly nature: BudgetNature = 'opex';

  constructor(
    @InjectRepository(SpendVersion) private readonly repo: Repository<SpendVersion>,
    @InjectRepository(SpendItem) private readonly items: Repository<SpendItem>,
    private readonly audit: AuditService,
    private readonly currencySettings: CurrencySettingsService,
  ) {}

  private get contract() {
    return NATURE_CONTRACT[this.nature];
  }

  /** The versions of a line of the nature; none for a line of the other nature (`budget-nature.ts`). */
  async listForItem(itemId: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(SpendVersion);
    const rows = await repo.createQueryBuilder('v')
      .innerJoin(SpendItem, 'i', `i.id = v.spend_item_id AND i.tenant_id = v.tenant_id AND i.nature = :nature`, { nature: this.nature })
      .where('v.spend_item_id = :itemId', { itemId })
      .orderBy('v.created_at', 'DESC')
      .getMany();
    return presentChildren(this.nature, rows);
  }

  /** A version of a line of the nature; a version of the other nature's line is not found. */
  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(SpendVersion);
    const found = await repo.createQueryBuilder('v')
      .innerJoin(SpendItem, 'i', `i.id = v.spend_item_id AND i.tenant_id = v.tenant_id AND i.nature = :nature`, { nature: this.nature })
      .where('v.id = :id', { id })
      .getOne();
    if (!found) throw new NotFoundException('Version not found');
    return presentChild(this.nature, found);
  }

  /**
   * Get-or-create of the item's version of a year (OPEX: `budget_year` when a number, else the
   * year of `as_of_date`; CAPEX: `budget_year`, else the current year, as before): an existing
   * version of that year is returned as it is, also when a concurrent request created it a moment
   * ago (see `budget-version-ensure.ts`). A name already used by another year of the item is
   * refused (400).
   * With `refuseExisting`, an existing version of the year is refused (409)
   * instead of returned: for a caller that asked to create one and would
   * otherwise report a creation that did not happen (the AI action).
   */
  async createForItem(itemId: string, body: Partial<SpendVersion>, userId?: string | null, opts?: { manager?: EntityManager; refuseExisting?: boolean }) {
    if (!body.version_name) throw new BadRequestException('version_name required');
    const asOf = body.as_of_date ?? new Date().toISOString().slice(0, 10);
    const yr = this.nature === 'capex'
      ? (body.budget_year != null ? Number(body.budget_year) : new Date().getFullYear())
      : (typeof (body as any).budget_year === 'number' ? (body as any).budget_year : new Date(asOf).getFullYear());

    const allocationMethod = ((body as any).allocation_method as any) ?? 'default';
    const allocationDriver = ((body as any).allocation_driver as any) ?? (allocationMethod === 'it_users' ? 'it_users' : allocationMethod === 'turnover' ? 'turnover' : 'headcount');
    const mg = opts?.manager ?? this.repo.manager;
    const itemRepo = mg.getRepository(SpendItem);
    const item = await itemRepo.findOne({ where: { id: itemId, nature: this.nature } });
    if (!item) throw new NotFoundException(this.contract.itemNotFound);
    // Lock order (`budget-locks.ts`): the line first, so a create waits for any writer of the line's budget.
    if (!(await lockBudgetLine(mg, this.nature, item.tenant_id, itemId))) throw new NotFoundException(this.contract.itemNotFound);
    const tenantId = item.tenant_id;
    const settings = await this.currencySettings.getSettings(tenantId, { manager: mg });

    const ensured = await ensureBudgetVersion(mg, this.nature, {
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
    if (!ensured) throw new BadRequestException(this.contract.duplicateName);
    if (!ensured.created && opts?.refuseExisting) {
      throw new ConflictException(`This line already has a budget version for ${yr}.`);
    }
    if (ensured.created) {
      await this.audit.log({
        table: auditTableOf(this.nature, 'spend_versions'), recordId: ensured.version.id, action: 'create', before: null,
        after: presentChild(this.nature, ensured.version), userId,
      }, { manager: mg });
    }
    return presentChild(this.nature, ensured.version) as SpendVersion;
  }

  /** Only the fields the body supplies, under the line's and the version's locks; see `updateBudgetVersionUnderLock`. */
  async updateForItem(itemId: string, body: Partial<SpendVersion> & { id: string }, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const { before, after } = await updateBudgetVersionUnderLock(mg, this.nature, itemId, body as any, this.contract.duplicateName);
    await this.audit.log({
      table: auditTableOf(this.nature, 'spend_versions'), recordId: after.id, action: 'update',
      before: presentChild(this.nature, before), after: presentChild(this.nature, after), userId,
    }, { manager: mg });
    return presentChild(this.nature, after) as SpendVersion;
  }
}

/** The versions of the CAPEX lines (`/capex-items/:id/versions`, aliases until lot U). */
@Injectable()
export class CapexVersionsService extends SpendVersionsService {
  protected override readonly nature: BudgetNature = 'capex';
}
