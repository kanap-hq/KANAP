import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { User } from '../users/user.entity';
import { parsePagination, buildWhereFromAgFilters } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { SUMMARY_SCOPES, SummaryDeps } from './spend-summary.builder';
import * as budgetList from './budget-list/budget-list.service';
import type { BudgetListAccess } from './budget-list/budget-list.runtime';
import type { AggregateSpec } from '../common/list-engine/list-aggregate';
import { SpendItemsCsvService } from './spend-items-csv.service';
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
import { SpendItemContactsService } from './spend-item-contacts.service';
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
import { itemAnalyticsAuditFields, itemAnalyticsFields, loadItemAnalyticsValues, writeItemAnalyticsValues } from './item-analytics.util';
import { syncSupplierContactsWithinUpdate } from '../contacts/contact-link-attach.util';
import { insertProjectBudgetLinks, lockBudgetLine } from '../portfolio/project-budget-links.util';
import { assertSetFilterModes } from '../common/ag-grid-filtering';
import { countItemRelations, loadItemReferences } from './item-workspace.util';
import { readBudgetLineMeta } from './item-meta';

@Injectable()
export class SpendItemsService {
  constructor(
    @InjectRepository(SpendItem) private readonly repo: Repository<SpendItem>,
    @InjectRepository(Application) private readonly applications: Repository<Application>,
    @InjectRepository(ApplicationSpendItemLink) private readonly appSpendLinks: Repository<ApplicationSpendItemLink>,
    private readonly audit: AuditService,
    private readonly allocationCalculator: AllocationCalculatorService,
    private readonly csv: SpendItemsCsvService,
    private readonly budgetOps: SpendBudgetOperationsService,
    private readonly fxRates: FxRateService,
    private readonly storage: StorageService,
    private readonly itemContacts: SpendItemContactsService,
    private readonly notifications: NotificationsService,
    private readonly itemNumbers: ItemNumberService,
  ) {}

  /** Resolve the active tenant id from the RLS session bound to this manager. */
  private async resolveTenantId(mg: EntityManager): Promise<string> {
    const rows = await mg.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const tenantId = Array.isArray(rows) && rows.length > 0 ? (rows[0]?.tenant_id as string | null) : null;
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    return tenantId;
  }

  /** `disabled_at`, or the deprecated `effective_end` when no end of validity is given (bare date at 12:00 UTC). */
  private endOfValidityInput(disabledAt: string | null | undefined, effectiveEnd: unknown) {
    try {
      return resolveEndOfValidityAlias(disabledAt, effectiveEnd);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  private formatAllocationMethodLabel(method?: string | null): string {
    switch (method) {
      case 'headcount':
        return 'Headcount';
      case 'it_users':
        return 'IT users';
      case 'turnover':
        return 'Turnover';
      case 'manual_company':
        return 'Company';
      case 'manual_department':
        return 'Department';
      case 'manual_pct':
        return 'Manual %';
      case 'default':
        return 'Default';
      default:
        return '';
    }
  }

  async list(query: any, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendItem);
    const { page, limit, skip, sort, status, q, filters } = parsePagination(query);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    assertSetFilterModes(filters, ['status']);
    const filtersToApply = sanitizedFilters ?? filters;
    // Only allow filtering/sorting by real columns on SpendItem
    const allowedFields = [
      'id', 'item_number', 'product_name', 'description', 'supplier_id', 'account_id', 'currency', 'effective_start', 'disabled_at',
      'status', 'owner_it_id', 'owner_business_id', 'project_id', 'contract_id', 'created_at', 'updated_at',
    ];
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply, allowedFields));
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
    const safeSortField = allowedFields.includes(sort.field) ? sort.field : 'created_at';
    const [itemsRaw, total] = await repo.findAndCount({ where, order: { [safeSortField]: sort.direction as any }, skip, take: limit });
    // The default dimension's value, read from the analytics links.
    const analyticsByItem = itemsRaw.length > 0
      ? await loadItemAnalyticsValues(mg, 'opex', tenantId, itemsRaw.map((item) => item.id))
      : new Map();
    const items = itemsRaw.map((item) => {
      const { analytics_category_id, analytics_category_name } = itemAnalyticsFields(analyticsByItem.get(item.id) ?? []);
      return { ...item, analytics_category_id, analytics_category_name };
    });
    return { items, total, page, limit };
  }

  /** The stored line of the session tenant (by id or OPX reference), without its analytics values. */
  private async findItem(id: string, mg: EntityManager): Promise<SpendItem> {
    const itemId = await resolveToUuid(id, 'spend', mg);
    const tenantId = await this.resolveTenantId(mg);
    const found = await mg.getRepository(SpendItem).findOne({ where: { id: itemId, tenant_id: tenantId } });
    if (!found) throw new NotFoundException('Spend item not found');
    return found;
  }

  /** The line with its analytics values (see `item-analytics.util.ts`). */
  private async withAnalytics(mg: EntityManager, item: SpendItem) {
    const values = (await loadItemAnalyticsValues(mg, 'opex', item.tenant_id, [item.id])).get(item.id) ?? [];
    return { ...item, ...itemAnalyticsFields(values) };
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
    const meta = await readBudgetLineMeta(mg, 'opex', tenantId, id);
    if (!meta) throw new NotFoundException('Spend item not found');
    return meta;
  }

  /** The Relations tab badge: one statement instead of one request per relation. */
  async relationCounts(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return countItemRelations(mg, 'opex', await this.findItem(id, mg));
  }

  /** Per-year totals of the five columns for one item (multi-year trend chart). */
  async yearlyTotals(spendItemId: string, from: number, to: number, opts?: { manager?: EntityManager }) {
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
       LEFT JOIN spend_version_totals t ON t.tenant_id = v.tenant_id AND t.version_id = v.id
       WHERE v.tenant_id = app_current_tenant() AND v.spend_item_id = $1 AND v.budget_year BETWEEN $2 AND $3
       GROUP BY v.budget_year
       ORDER BY v.budget_year`,
      [spendItemId, lo, hi],
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

  /** Email a link to the spend item to the given recipients (fire-and-forget). */
  async share(id: string, dto: ShareItemDto, tenantId: string, userId: string, opts?: { manager?: EntityManager }) {
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    const mg = opts?.manager ?? this.repo.manager;
    const item = await mg.getRepository(SpendItem).findOne({ where: { id, tenant_id: tenantId }, select: ['id', 'product_name'] });
    if (!item) throw new NotFoundException('Spend item not found');

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
        itemType: 'opex',
        itemId: item.id,
        itemName: item.product_name,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
      });
    }
    return { success: true };
  }

  /** Applications linked to the line; see `item-applications.ts`. */
  async listApplications(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const spend = await this.findItem(spendItemId, mg);
    return listItemApplications(mg, 'opex', spend);
  }

  /** Replace the line's applications (audited when the set changes); see `item-applications.ts`. */
  async bulkReplaceApplications(spendItemId: string, applicationIds: string[], userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const spend = await this.findItem(spendItemId, mg);
    return replaceItemApplications({ manager: mg, audit: this.audit }, 'opex', spend, applicationIds, userId ?? null);
  }

  async create(body: SpendItemUpsertDto, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendItem);
    // Writable columns only, every id resolved in this tenant; see `item-write.util.ts`.
    const { values, lifecycle: input, analytics } = await resolveItemWrite(mg, 'opex', body, null);
    const disabled_at = this.endOfValidityInput(input.disabled_at, input.effective_end);
    const lifecycle = resolveLifecycleState({ nextStatus: input.status, nextDisabledAt: disabled_at });
    const tenantId = await this.resolveTenantId(mg);
    const item_number = await this.itemNumbers.nextItemNumber('spend', tenantId, mg);
    const entity = repo.create({
      ...(values as Partial<SpendItem>),
      // These columns are NOT NULL on the entity while the DTO allows null
      product_name: (values.product_name as string | null | undefined) ?? undefined,
      currency: (values.currency as string | null | undefined) ?? undefined,
      effective_start: (values.effective_start as string | null | undefined) ?? undefined,
      item_number,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);
    await writeItemAnalyticsValues(mg, 'opex', tenantId, saved.id, analytics);
    const created = analytics.length > 0 ? await this.withAnalytics(mg, { ...saved, tenant_id: tenantId }) : { ...saved, ...itemAnalyticsFields([]) };
    await this.audit.log({
      table: 'spend_items', recordId: saved.id, action: 'create', before: null,
      after: { ...saved, ...itemAnalyticsAuditFields(created.analytics_values) }, userId,
    }, { manager: mg });
    return created;
  }

  async update(id: string, body: SpendItemUpsertDto, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const itemId = await resolveToUuid(id, 'spend', mg);
    const tenantId = await this.resolveTenantId(mg);
    // Only the columns the body supplied, written under the line's row lock; see `item-locked-update.ts`.
    const result = await updateItemUnderLock(mg, 'opex', tenantId, itemId, body);
    if (!result) throw new NotFoundException('Spend item not found');
    const { before, after: saved, analyticsBefore, analyticsAfter, statusBefore } = result;
    const updated = { ...saved, ...itemAnalyticsFields(analyticsAfter) };
    await this.audit.log({
      table: 'spend_items', recordId: saved.id, action: 'update',
      before: { ...before, ...itemAnalyticsAuditFields(analyticsBefore) },
      after: { ...saved, ...itemAnalyticsAuditFields(analyticsAfter) }, userId,
    }, { manager: mg });

    // Sync contacts from supplier if supplier changed
    const oldSupplierId = before.supplier_id;
    const newSupplierId = saved.supplier_id;
    if (oldSupplierId !== newSupplierId) {
      await syncSupplierContactsWithinUpdate(mg, `OPEX line ${saved.id}`, () =>
        this.itemContacts.syncFromSupplier(saved.id, newSupplierId, userId ?? null, { manager: mg, tenantId: saved.tenant_id }));
    }

    // Notify owners on status change
    if (statusBefore !== saved.status) {
      const tenantId = saved.tenant_id;
      // IT owner first, then the business owner, read in one query.
      const ownerIds = Array.from(new Set([saved.owner_it_id, saved.owner_business_id].filter((v): v is string => !!v)));
      const users: Array<{ id: string; email: string; locale: string | null }> = ownerIds.length > 0
        ? await mg.query(
            `SELECT id, email, locale FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'enabled'`,
            [tenantId, ownerIds],
          )
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));
      const recipients = ownerIds.flatMap((ownerId) => {
        const user = byId.get(ownerId);
        return user ? [{ userId: user.id, email: user.email, locale: user.locale }] : [];
      });
      if (recipients.length > 0) {
        this.notifications.notifyStatusChange({
          itemType: 'opex',
          itemId: saved.id,
          itemName: saved.product_name,
          oldStatus: statusBefore,
          newStatus: saved.status,
          recipients,
          tenantId,
          excludeUserId: userId,
          manager: mg,
        });
      }
    }

    return updated;
  }

  /** Dependencies of the list engine and the row builder. */
  /** The list engine's dependencies; `access` is the caller's (the consolidation fields), from the controller. */
  private summaryDeps(access?: BudgetListAccess): SummaryDeps {
    return { allocationCalculator: this.allocationCalculator, fxRates: this.fxRates, ...(access ? { access } : {}) };
  }

  /**
   * One page of the OPEX list, on the SQL list engine (`budget-list/`). The
   * AI query asks for the next year's allocation too; `shape=grid` returns
   * the lean rows of the grid.
   */
  async summary(query: any, opts?: { manager?: EntityManager; includeNextYearAllocation?: boolean; access?: BudgetListAccess }) {
    return budgetList.budgetListSummary(SUMMARY_SCOPES.opex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager, {
      includeRecipientDetails: true,
      includeNextYearAllocation: opts?.includeNextYearAllocation ?? false,
    });
  }

  async summaryFilterValues(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<Record<string, Array<string | null>>> {
    return budgetList.budgetListFilterValues(SUMMARY_SCOPES.opex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  /** Every id of the list in its order (workspace navigation). */
  async summaryIds(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
    return budgetList.budgetListIds(SUMMARY_SCOPES.opex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  /** Where one line stands in the list, with its previous and next lines. */
  async summaryNeighbors(query: any, id: string, opts?: { manager?: EntityManager; access?: BudgetListAccess }) {
    return budgetList.budgetListNeighbors(SUMMARY_SCOPES.opex, this.summaryDeps(opts?.access), query, id, opts?.manager ?? this.repo.manager);
  }

  /**
   * The lines of a list state grouped and measured in one statement
   * (`budget-list.service.ts`, `budgetListAggregate`): the AI aggregates, the reports and the dashboard.
   */
  async summaryAggregate(query: any, spec: AggregateSpec, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<budgetList.BudgetListAggregate> {
    return budgetList.budgetListAggregate(SUMMARY_SCOPES.opex, this.summaryDeps(opts?.access), query, spec, opts?.manager ?? this.repo.manager);
  }

  /** `POST …/summary/aggregate`: `{ query, spec }` (reports and the dashboard). */
  async summaryAggregateRequest(body: unknown, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<budgetList.BudgetListAggregate> {
    return budgetList.budgetListAggregateRequest(SUMMARY_SCOPES.opex, this.summaryDeps(opts?.access), body, opts?.manager ?? this.repo.manager);
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
    return budgetList.budgetListRowsByIds(SUMMARY_SCOPES.opex, this.summaryDeps(), { ...query, ids: itemIds }, opts?.manager ?? this.repo.manager);
  }

  async summaryTotals(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<any> {
    return budgetList.budgetListTotals(SUMMARY_SCOPES.opex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  async exportCsv(scope: 'template' | 'data' = 'data', opts?: { manager?: EntityManager }) {
    return this.csv.exportCsv(scope, { manager: opts?.manager ?? this.repo.manager });
  }

  async importCsv(
    params: { file: Express.Multer.File; dryRun: boolean; userId?: string | null },
    opts?: { manager?: EntityManager },
  ) {
    return this.csv.importCsv(params, { manager: opts?.manager ?? this.repo.manager });
  }

  async copyBudgetColumn(
    operation: {
      sourceYear: number;
      sourceColumn: BudgetColumn;
      destinationYear: number;
      destinationColumn: BudgetColumn;
      percentageIncrease: number | string;
      overwrite: boolean;
      dryRun: boolean;
    },
    userId: string | null,
    opts?: { manager?: EntityManager }
  ) {
    return this.budgetOps.copyBudgetColumn(operation, userId, { manager: opts?.manager ?? this.repo.manager });
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
    try {
      return await this.budgetOps.copyAllocations(operation, userId, { manager: opts?.manager ?? this.repo.manager });
    } catch (err) {
      if (err instanceof Error) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async clearBudgetColumn(
    operation: {
      year: number;
      column: BudgetColumn;
    },
    userId: string | null,
    opts?: { manager?: EntityManager }
  ) {
    return this.budgetOps.clearBudgetColumn(operation, userId, { manager: opts?.manager ?? this.repo.manager });
  }

  // Links (OPEX)
  async listLinks(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.resolveTenantId(mg);
    return mg.getRepository(SpendLink).find({ where: { tenant_id: tenantId, spend_item_id: spendItemId } as any, order: { created_at: 'DESC' as any } });
  }
  async createLink(spendItemId: string, body: Partial<SpendLink>, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    if (!body.url) throw new BadRequestException('url is required');
    const spend = await this.findItem(spendItemId, mg);
    const entity = repo.create({ tenant_id: spend.tenant_id, spend_item_id: spend.id, url: body.url, description: body.description ?? null } as any);
    const saved = await repo.save(entity as any);
    await this.audit.log({ table: 'spend_links', recordId: (saved as any).id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved as any;
  }
  async updateLink(spendItemId: string, linkId: string, body: Partial<SpendLink>, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    const tenantId = await this.resolveTenantId(mg);
    // Lock order (`budget-locks.ts`): the line, then its link, read again under the lock.
    await lockBudgetLine(mg, 'opex', tenantId, spendItemId);
    const where = { id: linkId, spend_item_id: spendItemId, tenant_id: tenantId } as any;
    const locked = await mg.query(
      `SELECT id FROM spend_links WHERE tenant_id = $1 AND id = $2 AND spend_item_id = $3 FOR NO KEY UPDATE`,
      [tenantId, linkId, spendItemId],
    );
    const before = locked.length > 0 ? await repo.findOne({ where }) : null;
    if (!before) throw new NotFoundException('Link not found');
    // Only the link's own fields the body supplies: the line and the tenant it belongs to stay as stored.
    const set: Partial<SpendLink> = {};
    if (body.url !== undefined) set.url = body.url;
    if (body.description !== undefined) set.description = body.description;
    if (Object.keys(set).length > 0) await repo.update(where, set);
    const saved = (await repo.findOne({ where })) ?? before;
    await this.audit.log({ table: 'spend_links', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager: mg });
    return saved;
  }
  async deleteLink(spendItemId: string, linkId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    const tenantId = await this.resolveTenantId(mg);
    const existing = await repo.findOne({ where: { id: linkId, spend_item_id: spendItemId, tenant_id: tenantId } as any });
    if (!existing) return { ok: true };
    await repo.delete({ id: linkId, spend_item_id: spendItemId, tenant_id: tenantId } as any);
    await this.audit.log({ table: 'spend_links', recordId: linkId, action: 'delete', before: existing, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // Attachments (OPEX)
  async listAttachments(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.resolveTenantId(mg);
    return mg.getRepository(SpendAttachment).find({ where: { tenant_id: tenantId, spend_item_id: spendItemId } as any, order: { uploaded_at: 'DESC' as any } });
  }
  async uploadAttachment(spendItemId: string, file: Express.Multer.File, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    if (!file) throw new BadRequestException('No file uploaded');
    const spend = await this.findItem(spendItemId, mg);
    const tenant_id = spend.tenant_id;
    const id = randomUUID();
    const now = new Date();
    const decodedName = fixMulterFilename(file.originalname);
    const ext = path.extname(decodedName || '') || '';
    const rand = Math.random().toString(36).slice(2, 8);
    const key = [
      'files', tenant_id, 'opex', spend.id,
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
      spend_item_id: spend.id,
      original_filename: decodedName || `${id}${ext}`,
      stored_filename: path.basename(key),
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: key,
    } as any);
    const saved = await repo.save(entity as any) as SpendAttachment as any;
    await this.audit.log({ table: 'spend_attachments', recordId: (saved as any).id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved as any;
  }
  async downloadAttachment(attachmentId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    const tenantId = await this.resolveTenantId(mg);
    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) throw new NotFoundException('Attachment not found');
    return found;
  }
  async deleteAttachment(attachmentId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    const tenantId = await this.resolveTenantId(mg);
    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) return { ok: true };
    await repo.delete({ id: attachmentId, tenant_id: tenantId } as any);
    try { await this.storage.deleteObject((found as any).storage_path); } catch {}
    await this.audit.log({ table: 'spend_attachments', recordId: found.id, action: 'update', before: found, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // Projects
  async listProjects(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const spend = await this.findItem(spendItemId, mg); // ensure item exists
    const rows = await mg.query(
      `SELECT l.project_id as id, p.name
       FROM portfolio_project_opex l
       JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.opex_id = $2
       ORDER BY p.name ASC`,
      [spend.tenant_id, spend.id],
    );
    return { items: rows };
  }

  async bulkReplaceProjects(spendItemId: string, projectIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const spend = await this.findItem(spendItemId, mg);
    const itemId = spend.id;
    const tenantId = spend.tenant_id;
    const cleanIds = Array.from(new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (cleanIds.length) {
      // Read in the line's tenant: a project of another tenant is not found.
      const projects = await mg.getRepository(PortfolioProject).find({ where: { tenant_id: tenantId, id: In(cleanIds) } as any });
      if (projects.length !== cleanIds.length) throw new BadRequestException('One or more projects not found');
    }
    // Two saves of the line's projects take turns (the last one wins); a link the project
    // side stored meanwhile is kept, never a unique violation. See project-budget-links.util.ts.
    if (!(await lockBudgetLine(mg, 'opex', tenantId, itemId))) throw new NotFoundException('Spend item not found');
    await mg.getRepository(PortfolioProjectOpex).delete({ tenant_id: tenantId, opex_id: itemId } as any);
    await insertProjectBudgetLinks(mg, 'opex', tenantId, cleanIds.map((projectId) => ({ projectId, itemId })));
    return this.listProjects(itemId, { manager: mg });
  }
}
