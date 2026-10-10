import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOperator, ILike, In, Raw, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { User } from '../users/user.entity';
import { Company } from '../companies/company.entity';
import { Account } from '../accounts/account.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { parsePagination, buildWhereFromAgFilters } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { SUMMARY_SCOPES, SummaryDeps } from './spend-summary.builder';
import * as budgetList from './budget-list/budget-list.service';
import type { BudgetListAccess } from './budget-list/budget-list.runtime';
import type { AggregateSpec } from '../common/list-engine/list-aggregate';
import { SpendBudgetOperationsService } from './spend-budget-operations.service';
import { FxRateService } from '../currency/fx-rate.service';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { applyDisabledAtWhere, LifecycleScope, resolveEndOfValidityAlias, resolveLifecycleState, StatusState } from '../common/status';
import { SpendItemUpsertDto } from './dto/spend-item.dto';
import { SpendLink } from './spend-link.entity';
import { SpendAttachment } from './spend-attachment.entity';
import * as path from 'path';
import * as fs from 'fs';
import { StorageService } from '../common/storage/storage.service';
import { randomUUID } from 'crypto';
import { Application } from '../applications/application.entity';
import { ApplicationSpendItemLink } from '../applications/application-spend-item.entity';
import { CapexItemContactsService, SpendItemContactsService } from './spend-item-contacts.service';
import { listItemApplications, replaceItemApplications } from './item-applications';
import { PortfolioProjectOpex } from '../portfolio/portfolio-project-opex.entity';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import { ItemNumberService } from '../common/item-number.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import type { BudgetColumn } from './amounts-write.util';
import { resolveItemWrite } from './item-write.util';
import { updateItemUnderLock } from './item-locked-update';
import {
  itemAnalyticsAuditFields,
  itemAnalyticsFields,
  ItemAnalyticsValue,
  loadItemAnalyticsValues,
  writeItemAnalyticsValues,
} from './item-analytics.util';
import { syncSupplierContactsWithinUpdate } from '../contacts/contact-link-attach.util';
import { insertProjectBudgetLinks, lockBudgetLine } from '../portfolio/project-budget-links.util';
import { assertSetFilterModes } from '../common/ag-grid-filtering';
import { countItemRelations, loadItemReferences } from './item-workspace.util';
import { readBudgetLineMeta } from './item-meta';
import { budgetLineOfChild } from './budget-locks';
import { auditTableOf, LEGACY_PREFIX, lineNumberSql, type BudgetNature } from './budget-nature';
import { auditLine, findBudgetLine, presentChild, presentChildren, presentLine, selectLineColumns } from './budget-line-presentation';
import type { CopyColumnOperation } from './budget-column-operations';
import type { CopyAllocationsOperation } from './budget-allocation-operations';

/**
 * What differs between the lines of the two natures, the one service apart (plan
 * planning/budget-unifie.md, lot Z1): the OPEX routes (`/spend-items*`) and the CAPEX aliases
 * (`/capex-items*`) keep their own messages, references, notification type, storage folder and
 * small contract differences of before.
 */
const NATURE_CONTRACT: Record<BudgetNature, {
  notFound: string;
  reference: 'spend' | 'capex';
  label: string;
  /** The folder of the line's attachments in the storage (`files/<tenant>/<folder>/<line>/…`). */
  storage: string;
  /** The order of the web links listed. */
  linksOrder: 'ASC' | 'DESC';
  /** The summary rows carry next year's allocation method. */
  nextYearAllocation: boolean;
}> = {
  opex: { notFound: 'Spend item not found', reference: 'spend', label: 'OPEX line', storage: 'opex', linksOrder: 'DESC', nextYearAllocation: false },
  capex: { notFound: 'CAPEX item not found', reference: 'capex', label: 'CAPEX line', storage: 'capex', linksOrder: 'ASC', nextYearAllocation: true },
};

/** The fields the plain CAPEX list filters and sorts on (its contract of before, `SUMMARY_SCOPES.capex.columns`). */
const CAPEX_LIST_FIELDS = [...SUMMARY_SCOPES.capex.columns];
const OPEX_LIST_FIELDS = [
  'id', 'item_number', 'product_name', 'description', 'supplier_id', 'account_id', 'currency', 'effective_start', 'disabled_at',
  'status', 'owner_it_id', 'owner_business_id', 'project_id', 'contract_id', 'created_at', 'updated_at',
];

function displayName(user?: User | null): string {
  if (!user) return '';
  const fn = (user as any).first_name ? String((user as any).first_name).trim() : '';
  const ln = (user as any).last_name ? String((user as any).last_name).trim() : '';
  const name = [fn, ln].filter(Boolean).join(' ');
  return name || (user as any).email || '';
}

/**
 * A grid filter on the CAPEX list's `item_number` (its CPX number): the same condition on the
 * line's CPX number (`lineNumberSql`) instead of its own number. `alias` is the column TypeORM gives.
 */
function cpxNumberFilter(operator: unknown): FindOperator<any> {
  const expr = (alias: string) => lineNumberSql(alias.replace(/\.?"?item_number"?$/, '') || 'i', 'capex');
  if (operator instanceof FindOperator) {
    const op = operator as FindOperator<any>;
    if (op.type === 'raw' && op.getSql) return Raw((alias) => op.getSql!(expr(alias)), op.objectLiteralParameters ?? {});
    if (op.type === 'in') return Raw((alias) => `${expr(alias)} IN (:...cpx_in)`, { cpx_in: op.value });
    if (op.type === 'not') return Raw((alias) => `${expr(alias)} <> :cpx_not`, { cpx_not: (op.value as any)?.value ?? op.value });
    return Raw((alias) => `${expr(alias)}::text ILIKE :cpx_like`, { cpx_like: op.value });
  }
  return Raw((alias) => `${expr(alias)} = :cpx_eq`, { cpx_eq: operator });
}

/**
 * The budget lines of one nature: the OPEX routes and the CAPEX aliases on one implementation
 * (`SpendItemsService`, `CapexItemsService`). Every read and write names the nature; a line of
 * the other nature is "not found".
 */
@Injectable()
export class SpendItemsService {
  /** The nature of the lines this service reads and writes. */
  protected readonly nature: BudgetNature = 'opex';

  constructor(
    @InjectRepository(SpendItem) private readonly repo: Repository<SpendItem>,
    @InjectRepository(Application) private readonly applications: Repository<Application>,
    @InjectRepository(ApplicationSpendItemLink) private readonly appSpendLinks: Repository<ApplicationSpendItemLink>,
    private readonly audit: AuditService,
    private readonly allocationCalculator: AllocationCalculatorService,
    private readonly budgetOps: SpendBudgetOperationsService,
    private readonly fxRates: FxRateService,
    private readonly storage: StorageService,
    private readonly itemContacts: SpendItemContactsService,
    private readonly notifications: NotificationsService,
    private readonly itemNumbers: ItemNumberService,
  ) {}

  private get contract() {
    return NATURE_CONTRACT[this.nature];
  }

  /** Resolve the active tenant id from the RLS session bound to this manager. */
  private async resolveTenantId(mg: EntityManager): Promise<string> {
    const rows = await mg.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const tenantId = Array.isArray(rows) && rows.length > 0 ? (rows[0]?.tenant_id as string | null) : null;
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    return tenantId;
  }

  /** `disabled_at`, or the deprecated `effective_end` when no end of validity is given (bare date at 12:00 UTC). */
  private endOfValidityInput(disabledAt: string | Date | null | undefined, effectiveEnd: unknown) {
    try {
      return resolveEndOfValidityAlias(disabledAt, effectiveEnd);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /** A line read for its nature's API (`budget-line-presentation.ts`), with `reference` (BL-n). */
  private present<T extends Record<string, any>>(line: T) {
    return presentLine(this.nature, line);
  }

  async list(query: any, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const { page, limit, skip, sort, status, q, filters } = parsePagination(query);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    assertSetFilterModes(filters, ['status']);
    const filtersToApply = sanitizedFilters ?? filters;
    const capex = this.nature === 'capex';
    // Only real columns of the nature's line contract filter and sort.
    const allowedFields = capex ? CAPEX_LIST_FIELDS : OPEX_LIST_FIELDS;
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply, allowedFields));
    }
    if (capex) {
      // The CAPEX title is the line's `product_name`; its number, the CPX number.
      if ('description' in where) {
        where.product_name = where.description;
        delete where.description;
      }
      if ('item_number' in where) where.item_number = cpxNumberFilter(where.item_number);
    }
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = status ?? statusFromAg ?? StatusState.ENABLED;
    const scope: LifecycleScope = matchNone ? 'none' : includeDisabled ? null : lifecycleStatus === StatusState.DISABLED ? 'inactive' : 'active';
    applyDisabledAtWhere(where, scope, filtersToApply);
    if (q) where.product_name = ILike(`%${q}%`);
    // Not a filterable field, so no grid filter can replace it.
    const tenantId = await this.resolveTenantId(mg);
    where.tenant_id = tenantId;
    // The lines of the nature only (`budget-nature.ts`); not a filterable field either.
    where.nature = this.nature;
    const safeSortField = allowedFields.includes(sort.field) ? sort.field : 'created_at';
    const direction = String(sort.direction).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (!capex) {
      // The id breaks ties (lines imported together share their created_at), as the summary does:
      // a page never repeats or skips a line of the previous one.
      const order: Record<string, any> = safeSortField === 'id'
        ? { id: sort.direction }
        : { [safeSortField]: sort.direction, id: 'DESC' };
      const [itemsRaw, total] = await mg.getRepository(SpendItem).findAndCount({ where, order, skip, take: limit });
      // The default dimension's value, read from the analytics links.
      const analyticsByItem = itemsRaw.length > 0
        ? await loadItemAnalyticsValues(mg, this.nature, tenantId, itemsRaw.map((item) => item.id))
        : new Map();
      const items = itemsRaw.map((item) => {
        const { analytics_category_id, analytics_category_name } = itemAnalyticsFields(analyticsByItem.get(item.id) ?? []);
        return this.present({ ...item, analytics_category_id, analytics_category_name });
      });
      return { items, total, page, limit };
    }
    // CAPEX: the line's columns of its contract, sorted on what the CAPEX list showed (title, CPX
    // number), the id breaking ties; then the names the pickers show.
    const sortSql = safeSortField === 'item_number' ? lineNumberSql('i', 'capex')
      : safeSortField === 'description' ? 'i.product_name'
        : `i.${safeSortField}`;
    const qb = selectLineColumns(mg.getRepository(SpendItem).createQueryBuilder('i').where(where), 'i', 'capex')
      .orderBy(sortSql, direction)
      .addOrderBy('i.id', 'DESC')
      .skip(skip)
      .take(limit);
    const [itemsRaw, total] = await qb.getManyAndCount();
    const items = await this.enrichCapexListItems(itemsRaw, mg, tenantId);
    return { items, total, page, limit };
  }

  /** The plain CAPEX list's row (its contract of before): the line and the names of what it references. */
  private async enrichCapexListItems(baseItems: SpendItem[], mg: EntityManager, tenantId: string): Promise<any[]> {
    if (!baseItems.length) return [];
    const ids = (pick: (item: SpendItem) => Array<string | null | undefined>) => Array.from(new Set(baseItems.flatMap(pick).filter((v): v is string => !!v)));
    const companyIds = ids((i) => [i.paying_company_id]);
    const supplierIds = ids((i) => [i.supplier_id]);
    const accountIds = ids((i) => [i.account_id]);
    const ownerIds = ids((i) => [i.owner_it_id, i.owner_business_id]);
    const [companies, suppliers, accounts, owners, analyticsByItem] = await Promise.all([
      companyIds.length ? mg.getRepository(Company).find({ where: { tenant_id: tenantId, id: In(companyIds) as any } as any }) : Promise.resolve([]),
      supplierIds.length ? mg.getRepository(Supplier).find({ where: { tenant_id: tenantId, id: In(supplierIds) as any } as any }) : Promise.resolve([]),
      accountIds.length ? mg.getRepository(Account).find({ where: { tenant_id: tenantId, id: In(accountIds) as any } as any }) : Promise.resolve([]),
      ownerIds.length ? mg.getRepository(User).find({ where: { tenant_id: tenantId, id: In(ownerIds) as any } as any }) : Promise.resolve([]),
      // The default dimension's value, read from the analytics links.
      loadItemAnalyticsValues(mg, 'capex', tenantId, baseItems.map((i) => i.id)),
    ]);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const ownerById = new Map(owners.map((u) => [u.id, u]));
    return baseItems.map((item: any) => {
      const company = item.paying_company_id ? companyById.get(item.paying_company_id) : undefined;
      const supplier = item.supplier_id ? supplierById.get(item.supplier_id) : undefined;
      const account = item.account_id ? accountById.get(item.account_id) : undefined;
      const { analytics_category_id, analytics_category_name } = itemAnalyticsFields(analyticsByItem.get(item.id) ?? []);
      return {
        ...this.present(item),
        company_name: company ? (company as any).name ?? null : null,
        paying_company_name: company ? (company as any).name ?? null : null,
        supplier: supplier ? { id: supplier.id, name: (supplier as any).name } : undefined,
        supplier_name: supplier ? (supplier as any).name : undefined,
        account: account ? { id: account.id, account_number: (account as any).account_number, account_name: (account as any).account_name } : undefined,
        account_number: account ? (account as any).account_number : undefined,
        account_name: account ? (account as any).account_name : undefined,
        account_display: account ? `${(account as any).account_number} - ${(account as any).account_name}` : undefined,
        owner_it_name: displayName(ownerById.get(item.owner_it_id) || null),
        owner_business_name: displayName(ownerById.get(item.owner_business_id) || null),
        analytics_category_id,
        analytics_category_name,
      };
    });
  }

  /** The stored line of the nature of the session tenant (by id or reference), without its analytics values; a line of the other nature is not found. */
  private async findItem(id: string, mg: EntityManager): Promise<SpendItem> {
    const itemId = await resolveToUuid(id, this.contract.reference, mg);
    const tenantId = await this.resolveTenantId(mg);
    const found = await findBudgetLine(mg, this.nature, tenantId, itemId);
    if (!found) throw new NotFoundException(this.contract.notFound);
    return found;
  }

  /** Whether `id` is a line of the nature of the tenant: the children read by a line id are read for such a line only. */
  private async isLineOfNature(mg: EntityManager, tenantId: string, id: string): Promise<boolean> {
    return mg.getRepository(SpendItem).exists({ where: { id, tenant_id: tenantId, nature: this.nature } });
  }

  private async loadAnalytics(mg: EntityManager, item: { id: string; tenant_id: string }): Promise<ItemAnalyticsValue[]> {
    return (await loadItemAnalyticsValues(mg, this.nature, item.tenant_id, [item.id])).get(item.id) ?? [];
  }

  /** The line with its analytics values (see `item-analytics.util.ts`), as its nature's API shows it. */
  private async withAnalytics(mg: EntityManager, item: SpendItem) {
    return this.present({ ...item, ...itemAnalyticsFields(await this.loadAnalytics(mg, item)) });
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return this.withAnalytics(mg, await this.findItem(id, mg));
  }

  /** The workspace's read: the line, plus the labels its pickers show (see item-workspace.util.ts). */
  async getDetail(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const item = await this.findItem(id, mg);
    const line = await this.withAnalytics(mg, item);
    return { ...line, references: await loadItemReferences(mg, item) };
  }

  /** The line's meta (lot 3G, `item-meta.ts`): its freshness counters, who changed it and when. */
  async meta(id: string, tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const meta = await readBudgetLineMeta(mg, this.nature, tenantId, id);
    if (!meta) throw new NotFoundException(this.contract.notFound);
    return meta;
  }

  /** The Relations tab badge: one statement instead of one request per relation. */
  async relationCounts(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return countItemRelations(mg, this.nature, await this.findItem(id, mg));
  }

  /** Per-year totals of the five columns for one item (multi-year trend chart). */
  async yearlyTotals(itemId: string, from: number, to: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const lo = Math.min(from, to);
    // Clamp the span (defensive against an unbounded ?from&to driving a huge fill loop).
    const hi = Math.min(Math.max(from, to), lo + 20);
    const rows: Array<{ year: number; budget: string; revision: string; forecast: string; actual: string; landing: string }> = await mg.query(
      // The version's stored totals count only the months within its budget_year, as the
      // list engine reads them (loadVersionTotals), so the chart agrees with the Budget tab / list.
      `SELECT v.budget_year AS year,
              COALESCE(SUM(t.planned), 0) AS budget,
              COALESCE(SUM(t.committed), 0) AS revision,
              COALESCE(SUM(t.forecast), 0) AS forecast,
              COALESCE(SUM(t.actual), 0) AS actual,
              COALESCE(SUM(t.expected_landing), 0) AS landing
       FROM spend_versions v
       JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id AND i.nature = $4
       LEFT JOIN spend_version_totals t ON t.tenant_id = v.tenant_id AND t.version_id = v.id
       WHERE v.tenant_id = app_current_tenant() AND v.spend_item_id = $1 AND v.budget_year BETWEEN $2 AND $3
       GROUP BY v.budget_year
       ORDER BY v.budget_year`,
      [itemId, lo, hi, this.nature],
    );
    const byYear = new Map(rows.map((r) => [Number(r.year), r]));
    const years: Array<{ year: number; budget: number; revision: number; forecast: number; actual: number; landing: number }> = [];
    for (let y = lo; y <= hi; y += 1) {
      const r = byYear.get(y);
      years.push({
        year: y,
        budget: Number(r?.budget) || 0,
        revision: Number(r?.revision) || 0,
        forecast: Number(r?.forecast) || 0,
        actual: Number(r?.actual) || 0,
        landing: Number(r?.landing) || 0,
      });
    }
    return { items: years };
  }

  /** Email a link to the line to the given recipients (fire-and-forget). */
  async share(id: string, dto: ShareItemDto, tenantId: string, userId: string, opts?: { manager?: EntityManager }) {
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    const mg = opts?.manager ?? this.repo.manager;
    const item = await mg.getRepository(SpendItem).findOne({ where: { id, tenant_id: tenantId, nature: this.nature }, select: ['id', 'product_name'] });
    if (!item) throw new NotFoundException(this.contract.notFound);

    const senderRows = await mg.query('SELECT first_name, last_name FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, userId]);
    const senderName = senderRows.length > 0
      ? `${senderRows[0].first_name} ${senderRows[0].last_name}`.trim() || 'Someone'
      : 'Someone';

    const recipientRows = userIds.length > 0
      ? await mg.query(
          `SELECT u.id AS "userId", u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.locale
           FROM users u
           JOIN roles ro ON ro.id = u.role_id AND ro.tenant_id = u.tenant_id
           WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[]) AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [tenantId, userIds],
        )
      : [];

    if (recipientRows.length > 0 || rawEmails.length > 0) {
      this.notifications.notifyShare({
        itemType: this.nature,
        itemId: item.id,
        itemName: item.product_name,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
        // The CAPEX share always handed its manager over (the link it builds); the OPEX one never did.
        ...(this.nature === 'capex' ? { manager: mg } : {}),
      });
    }
    return { success: true };
  }

  /** Applications linked to the line; see `item-applications.ts`. */
  async listApplications(itemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const line = await this.findItem(itemId, mg);
    return listItemApplications(mg, this.nature, line);
  }

  /** Replace the line's applications (audited when the set changes); see `item-applications.ts`. */
  async bulkReplaceApplications(itemId: string, applicationIds: string[], userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const line = await this.findItem(itemId, mg);
    return replaceItemApplications({ manager: mg, audit: this.audit }, this.nature, line, applicationIds, userId ?? null);
  }

  /**
   * A new line of the nature. `itemNumber`: its BL number when the caller allocated it (the budget
   * file, a block); a CAPEX line also gets a CPX number from the `capex` sequence (`legacyNumber`
   * when allocated by the caller): what the CAPEX API and screens show as its number.
   */
  async create(
    body: SpendItemUpsertDto | Record<string, unknown>,
    userId?: string,
    opts?: { manager?: EntityManager; itemNumber?: number; legacyNumber?: number; source?: string },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendItem);
    // Writable fields only (a CAPEX title in `product_name`, `company_id` the CAPEX alias of the paying
    // company), every id resolved in this tenant; see `item-write.util.ts`.
    const { values, lifecycle: input, analytics } = await resolveItemWrite(mg, this.nature, body, null);
    const disabled_at = this.endOfValidityInput(input.disabled_at, input.effective_end);
    const lifecycle = resolveLifecycleState({ nextStatus: input.status, nextDisabledAt: disabled_at });
    const tenantId = await this.resolveTenantId(mg);
    const item_number = opts?.itemNumber ?? await this.itemNumbers.nextItemNumber('spend', tenantId, mg);
    const legacy = this.nature === 'capex'
      ? `${LEGACY_PREFIX.capex}-${opts?.legacyNumber ?? await this.itemNumbers.nextItemNumber('capex', tenantId, mg)}`
      : undefined;
    const entity = repo.create({
      ...(values as Partial<SpendItem>),
      // These columns are NOT NULL on the entity while the DTO allows null
      product_name: (values.product_name as string | null | undefined) ?? undefined,
      currency: (values.currency as string | null | undefined) ?? undefined,
      effective_start: (values.effective_start as string | null | undefined) ?? undefined,
      item_number,
      // The service of the nature writes it; a request body never does (`budget-nature.ts`).
      nature: this.nature,
      ...(legacy ? { legacy_number: legacy } : {}),
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);
    await writeItemAnalyticsValues(mg, this.nature, tenantId, saved.id, analytics);
    if (this.nature === 'opex') {
      const created = analytics.length > 0 ? await this.withAnalytics(mg, { ...saved, tenant_id: tenantId }) : this.present({ ...saved, ...itemAnalyticsFields([]) });
      await this.audit.log({
        table: auditTableOf(this.nature, 'spend_items'), recordId: saved.id, action: 'create', before: null,
        after: { ...auditLine(this.nature, saved), ...itemAnalyticsAuditFields(created.analytics_values), ...(opts?.source ? { source: opts.source } : {}) },
        userId, source: opts?.source,
      }, { manager: mg });
      return created;
    }
    // CAPEX: the line as stored (database defaults, its hidden columns), as the CAPEX create returned it.
    const persisted = (await findBudgetLine(mg, this.nature, tenantId, saved.id)) ?? saved;
    const analyticsValues = analytics.length > 0 ? await this.loadAnalytics(mg, { id: saved.id, tenant_id: tenantId }) : [];
    await this.audit.log({
      table: auditTableOf(this.nature, 'spend_items'), recordId: saved.id, action: 'create', before: null,
      after: { ...auditLine(this.nature, persisted), ...itemAnalyticsAuditFields(analyticsValues), ...(opts?.source ? { source: opts.source } : {}) },
      userId, source: opts?.source,
    }, { manager: mg });
    return this.present({ ...persisted, ...itemAnalyticsFields(analyticsValues) });
  }

  /** `statusEmail: false` skips the owners' status-change email (the budget file load sends none). */
  async update(id: string, body: SpendItemUpsertDto | Record<string, unknown>, userId?: string, opts?: { manager?: EntityManager; statusEmail?: boolean; source?: string }) {
    const mg = opts?.manager ?? this.repo.manager;
    const itemId = await resolveToUuid(id, this.contract.reference, mg);
    const tenantId = await this.resolveTenantId(mg);
    // Only the columns the body supplied, written under the line's row lock; see `item-locked-update.ts`.
    const result = await updateItemUnderLock(mg, this.nature, tenantId, itemId, body);
    if (!result) throw new NotFoundException(this.contract.notFound);
    const { before, after: saved, analyticsBefore, analyticsAfter, statusBefore } = result;
    await this.audit.log({
      table: auditTableOf(this.nature, 'spend_items'), recordId: saved.id, action: 'update',
      before: { ...auditLine(this.nature, before), ...itemAnalyticsAuditFields(analyticsBefore) },
      after: { ...auditLine(this.nature, saved), ...itemAnalyticsAuditFields(analyticsAfter), ...(opts?.source ? { source: opts.source } : {}) },
      userId, source: opts?.source,
    }, { manager: mg });

    // Sync contacts from supplier if supplier changed
    const oldSupplierId = before.supplier_id ?? null;
    const newSupplierId = saved.supplier_id ?? null;
    if (oldSupplierId !== newSupplierId) {
      await syncSupplierContactsWithinUpdate(mg, `${this.contract.label} ${saved.id}`, () =>
        this.itemContacts.syncFromSupplier(saved.id, newSupplierId, userId ?? null, { manager: mg, tenantId }));
    }

    // Notify owners on status change
    if (statusBefore !== saved.status && opts?.statusEmail !== false) {
      // IT owner first, then the business owner, read in one query.
      const ownerIds = Array.from(new Set([saved.owner_it_id, saved.owner_business_id].filter((v): v is string => !!v)));
      const users: Array<{ id: string; email: string; locale: string | null }> = ownerIds.length > 0
        ? await mg.query(
            `SELECT id, email, locale FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'enabled'`,
            [saved.tenant_id, ownerIds],
          )
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));
      const recipients = ownerIds.flatMap((ownerId) => {
        const user = byId.get(ownerId);
        return user ? [{ userId: user.id, email: user.email, locale: user.locale }] : [];
      });
      if (recipients.length > 0) {
        this.notifications.notifyStatusChange({
          itemType: this.nature,
          itemId: saved.id,
          itemName: saved.product_name,
          oldStatus: statusBefore,
          newStatus: saved.status,
          recipients,
          tenantId: saved.tenant_id,
          excludeUserId: userId,
          manager: mg,
        });
      }
    }

    return this.present({ ...saved, ...itemAnalyticsFields(analyticsAfter) });
  }

  /** The list engine's dependencies; `access` is the caller's (the consolidation fields), from the controller. */
  private summaryDeps(access?: BudgetListAccess): SummaryDeps {
    return { allocationCalculator: this.allocationCalculator, fxRates: this.fxRates, ...(access ? { access } : {}) };
  }

  private get summaryScope() {
    return SUMMARY_SCOPES[this.nature];
  }

  /**
   * One page of the list of the nature, on the SQL list engine (`budget-list/`). The CAPEX rows
   * carry next year's allocation, as before; the AI asks for it on OPEX rows too. `shape=grid`
   * returns the lean rows of the grid.
   */
  async summary(query: any, opts?: { manager?: EntityManager; includeNextYearAllocation?: boolean; access?: BudgetListAccess }) {
    return budgetList.budgetListSummary(this.summaryScope, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager, {
      includeRecipientDetails: true,
      includeNextYearAllocation: this.contract.nextYearAllocation || (opts?.includeNextYearAllocation ?? false),
    });
  }

  async summaryFilterValues(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<Record<string, Array<string | null>>> {
    return budgetList.budgetListFilterValues(this.summaryScope, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  /** Every id of the list in its order (workspace navigation). */
  async summaryIds(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
    return budgetList.budgetListIds(this.summaryScope, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  /** Where one line stands in the list, with its previous and next lines. */
  async summaryNeighbors(query: any, id: string, opts?: { manager?: EntityManager; access?: BudgetListAccess }) {
    return budgetList.budgetListNeighbors(this.summaryScope, this.summaryDeps(opts?.access), query, id, opts?.manager ?? this.repo.manager);
  }

  /**
   * The lines of a list state grouped and measured in one statement
   * (`budget-list.service.ts`, `budgetListAggregate`): the AI aggregates, the reports and the dashboard.
   */
  async summaryAggregate(query: any, spec: AggregateSpec, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<budgetList.BudgetListAggregate> {
    return budgetList.budgetListAggregate(this.summaryScope, this.summaryDeps(opts?.access), query, spec, opts?.manager ?? this.repo.manager);
  }

  /** `POST …/summary/aggregate`: `{ query, spec }` (reports and the dashboard). */
  async summaryAggregateRequest(body: unknown, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<budgetList.BudgetListAggregate> {
    return budgetList.budgetListAggregateRequest(this.summaryScope, this.summaryDeps(opts?.access), body, opts?.manager ?? this.repo.manager);
  }

  async summaryRowsByIds(
    itemIds: string[],
    query?: {
      years?: number[];
      includeRecipientDetails?: boolean;
      includeLatestTask?: boolean;
      includeNextYearAllocation?: boolean;
    },
    opts?: { manager?: EntityManager },
  ) {
    return budgetList.budgetListRowsByIds(this.summaryScope, this.summaryDeps(), { ...query, ids: itemIds }, opts?.manager ?? this.repo.manager);
  }

  async summaryTotals(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<any> {
    return budgetList.budgetListTotals(this.summaryScope, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  /** Copy one budget column to another year or column (all or nothing); see `budget-column-operations.ts`. */
  async copyBudgetColumn(operation: CopyColumnOperation, userId: string | null, opts?: { manager?: EntityManager }) {
    return this.budgetOps.copyBudgetColumn(operation, userId, { manager: opts?.manager ?? this.repo.manager, nature: this.nature });
  }

  /**
   * Copy allocations to another year (all or nothing); see `budget-allocation-operations.ts`. The
   * OPEX route answers any error as a 400 (as before); the CAPEX one lets it through (as before).
   */
  async copyAllocations(operation: CopyAllocationsOperation, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = opts?.manager ?? this.repo.manager;
    if (this.nature === 'capex') return this.budgetOps.copyAllocations(operation, userId, { manager, nature: this.nature });
    try {
      return await this.budgetOps.copyAllocations(operation, userId, { manager });
    } catch (err) {
      if (err instanceof Error) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** Clear one budget column of a year (all or nothing); see `budget-column-operations.ts`. */
  async clearBudgetColumn(operation: { year: number; column: BudgetColumn }, userId: string | null, opts?: { manager?: EntityManager }) {
    return this.budgetOps.clearBudgetColumn(operation, userId, { manager: opts?.manager ?? this.repo.manager, nature: this.nature });
  }

  // Links
  async listLinks(itemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.resolveTenantId(mg);
    if (!(await this.isLineOfNature(mg, tenantId, itemId))) return [];
    const rows = await mg.getRepository(SpendLink).find({ where: { tenant_id: tenantId, spend_item_id: itemId } as any, order: { created_at: this.contract.linksOrder as any } });
    return presentChildren(this.nature, rows);
  }

  async createLink(itemId: string, body: Partial<SpendLink>, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    // The OPEX route requires the url; the CAPEX one stored it trimmed, empty when missing (as before).
    if (this.nature === 'opex' && !body?.url) throw new BadRequestException('url is required');
    const line = await this.findItem(itemId, mg);
    const url = this.nature === 'opex' ? body.url : String(body?.url || '').trim();
    const entity = repo.create({ tenant_id: line.tenant_id, spend_item_id: line.id, url, description: (body?.description ?? null) as any } as any);
    const saved = await repo.save(entity as any);
    const shown = presentChild(this.nature, saved as any);
    await this.audit.log({ table: auditTableOf(this.nature, 'spend_links'), recordId: (saved as any).id, action: 'create', before: null, after: shown, userId }, { manager: mg });
    return shown as any;
  }

  async updateLink(itemId: string, linkId: string, body: Partial<SpendLink>, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    const tenantId = await this.resolveTenantId(mg);
    // Lock order (`budget-locks.ts`): the line, then its link, read again under the lock. A line of
    // the other nature is not locked, so its link is not found.
    if (!(await lockBudgetLine(mg, this.nature, tenantId, itemId))) throw new NotFoundException('Link not found');
    const where = { id: linkId, spend_item_id: itemId, tenant_id: tenantId } as any;
    const locked = await mg.query(
      `SELECT id FROM spend_links WHERE tenant_id = $1 AND id = $2 AND spend_item_id = $3 FOR NO KEY UPDATE`,
      [tenantId, linkId, itemId],
    );
    const before = locked.length > 0 ? await repo.findOne({ where }) : null;
    if (!before) throw new NotFoundException('Link not found');
    // Only the link's own fields the body supplies: the line and the tenant it belongs to stay as stored.
    const set: Partial<SpendLink> = {};
    if (this.nature === 'opex') {
      if (body.url !== undefined) set.url = body.url;
      if (body.description !== undefined) set.description = body.description;
    } else {
      // A description sent empty clears it; the url is stored trimmed (the CAPEX route of before).
      if (body?.description !== undefined) set.description = body.description ?? null;
      if (body?.url !== undefined) set.url = String(body.url || '').trim();
    }
    if (Object.keys(set).length > 0) await repo.update(where, set);
    const saved = (await repo.findOne({ where })) ?? before;
    await this.audit.log({
      table: auditTableOf(this.nature, 'spend_links'), recordId: saved.id, action: 'update',
      before: presentChild(this.nature, before as any), after: presentChild(this.nature, saved as any), userId,
    }, { manager: mg });
    return presentChild(this.nature, saved as any) as any;
  }

  async deleteLink(itemId: string, linkId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    const tenantId = await this.resolveTenantId(mg);
    // A link of a line of the other nature is not found (`budget-nature.ts`); a missing one is no error, as before.
    await budgetLineOfChild(mg, this.nature, 'link', tenantId, linkId, 'Link not found');
    const existing = await repo.findOne({ where: { id: linkId, spend_item_id: itemId, tenant_id: tenantId } as any });
    if (!existing) return { ok: true };
    await repo.delete({ id: linkId, spend_item_id: itemId, tenant_id: tenantId } as any);
    await this.audit.log({
      table: auditTableOf(this.nature, 'spend_links'), recordId: linkId, action: 'delete',
      before: presentChild(this.nature, existing as any), after: null, userId,
    }, { manager: mg });
    return { ok: true };
  }

  // Attachments
  async listAttachments(itemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.resolveTenantId(mg);
    if (!(await this.isLineOfNature(mg, tenantId, itemId))) return [];
    const rows = await mg.getRepository(SpendAttachment).find({ where: { tenant_id: tenantId, spend_item_id: itemId } as any, order: { uploaded_at: 'DESC' as any } });
    return presentChildren(this.nature, rows);
  }

  async uploadAttachment(itemId: string, file: Express.Multer.File, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    if (!file) throw new BadRequestException('No file uploaded');
    const line = await this.findItem(itemId, mg);
    const tenant_id = line.tenant_id;
    const id = randomUUID();
    const now = new Date();
    const decodedName = fixMulterFilename(file.originalname);
    const ext = path.extname(decodedName || '') || '';
    const rand = Math.random().toString(36).slice(2, 8);
    const key = [
      'files', tenant_id, this.contract.storage, line.id,
      now.getUTCFullYear().toString(), String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}_${rand}${ext}`,
    ].join('/');
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : null);
    if (!buf) throw new BadRequestException('Empty upload');
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: (file as any).mimetype,
      buffer: buf as Buffer,
      size: (file as any).size,
    });
    await this.storage.putObject({ key, body: buf as Buffer, contentType: validated.mimeType, contentLength: validated.size, sse: 'AES256' });
    const entity = repo.create({
      id,
      tenant_id,
      spend_item_id: line.id,
      original_filename: decodedName || `${id}${ext}`,
      stored_filename: path.basename(key),
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: key,
    } as any);
    const saved = await repo.save(entity as any) as SpendAttachment as any;
    const shown = presentChild(this.nature, saved);
    await this.audit.log({ table: auditTableOf(this.nature, 'spend_attachments'), recordId: (saved as any).id, action: 'create', before: null, after: shown, userId }, { manager: mg });
    return shown as any;
  }

  async downloadAttachment(attachmentId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    const tenantId = await this.resolveTenantId(mg);
    // An attachment of a line of the other nature is not found (`budget-nature.ts`).
    await budgetLineOfChild(mg, this.nature, 'attachment', tenantId, attachmentId, 'Attachment not found');
    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) throw new NotFoundException('Attachment not found');
    return found;
  }

  async deleteAttachment(attachmentId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    const tenantId = await this.resolveTenantId(mg);
    // An attachment of a line of the other nature is not found; a missing one is no error, as before.
    await budgetLineOfChild(mg, this.nature, 'attachment', tenantId, attachmentId, 'Attachment not found');
    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) return { ok: true };
    await repo.delete({ id: attachmentId, tenant_id: tenantId } as any);
    try { await this.storage.deleteObject((found as any).storage_path); } catch {}
    await this.audit.log({
      table: auditTableOf(this.nature, 'spend_attachments'), recordId: found.id, action: 'update',
      before: presentChild(this.nature, found as any), after: null, userId,
    }, { manager: mg });
    return { ok: true };
  }

  // Projects
  async listProjects(itemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const line = await this.findItem(itemId, mg); // ensure item exists
    const rows = await mg.query(
      `SELECT l.project_id as id, p.name
       FROM portfolio_project_opex l
       JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.opex_id = $2
       ORDER BY p.name ASC`,
      [line.tenant_id, line.id],
    );
    return { items: rows };
  }

  async bulkReplaceProjects(itemId: string, projectIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const line = await this.findItem(itemId, mg);
    const lineId = line.id;
    const tenantId = line.tenant_id;
    const cleanIds = Array.from(new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (cleanIds.length) {
      // Read in the line's tenant: a project of another tenant is not found.
      const projects = await mg.getRepository(PortfolioProject).find({ where: { tenant_id: tenantId, id: In(cleanIds) } as any });
      if (projects.length !== cleanIds.length) throw new BadRequestException('One or more projects not found');
    }
    // Two saves of the line's projects take turns (the last one wins); a link the project
    // side stored meanwhile is kept, never a unique violation. See project-budget-links.util.ts.
    if (!(await lockBudgetLine(mg, this.nature, tenantId, lineId))) throw new NotFoundException(this.contract.notFound);
    await mg.getRepository(PortfolioProjectOpex).delete({ tenant_id: tenantId, opex_id: lineId } as any);
    await insertProjectBudgetLinks(mg, this.nature, tenantId, cleanIds.map((projectId) => ({ projectId, itemId: lineId })));
    return this.listProjects(lineId, { manager: mg });
  }
}

/**
 * The CAPEX lines (`/capex-items*`, kept as aliases until the unified screens, lot U): the same
 * service, on the lines of nature `capex`, under the CAPEX contract of before.
 *
 * Its own constructor, so that Nest injects the dependencies of the CAPEX nature: without one, a
 * subclass inherits the parameter types of its parent, and the line's supplier contacts were
 * synchronized by the OPEX contacts service, which finds no CAPEX line. Every dependency bound to
 * a nature is the CAPEX one here (`capex-alias-injection.integration.spec.ts` checks it through
 * Nest).
 */
@Injectable()
export class CapexItemsService extends SpendItemsService {
  protected override readonly nature: BudgetNature = 'capex';

  constructor(
    @InjectRepository(SpendItem) repo: Repository<SpendItem>,
    @InjectRepository(Application) applications: Repository<Application>,
    @InjectRepository(ApplicationSpendItemLink) appSpendLinks: Repository<ApplicationSpendItemLink>,
    audit: AuditService,
    allocationCalculator: AllocationCalculatorService,
    budgetOps: SpendBudgetOperationsService,
    fxRates: FxRateService,
    storage: StorageService,
    itemContacts: CapexItemContactsService,
    notifications: NotificationsService,
    itemNumbers: ItemNumberService,
  ) {
    super(repo, applications, appSpendLinks, audit, allocationCalculator, budgetOps, fxRates, storage, itemContacts, notifications, itemNumbers);
  }
}
