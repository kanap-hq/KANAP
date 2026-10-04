import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Repository } from 'typeorm';
import { CapexItem } from './capex-item.entity';
import { CapexVersion } from './capex-version.entity';
import { CapexAmount } from './capex-amount.entity';
import { CapexAllocationCalculatorService } from './capex-allocation-calculator.service';
import { Company } from '../companies/company.entity';
import { Account } from '../accounts/account.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { User } from '../users/user.entity';
import { parsePagination, buildWhereFromAgFilters } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { BudgetColumn } from '../spend/amounts-write.util';
import { clearBudgetColumn, copyBudgetColumn, CopyColumnOperation } from '../spend/budget-column-operations';
import { copyAllocations, CopyAllocationsOperation } from '../spend/budget-allocation-operations';
import * as fs from 'fs';
import * as path from 'path';
import { CapexLink } from './capex-link.entity';
import { CapexAttachment } from './capex-attachment.entity';
import { FreezeService } from '../freeze/freeze.service';
import { FxRateService } from '../currency/fx-rate.service';
import { applyDisabledAtWhere, LifecycleScope, resolveEndOfValidityAlias, resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { SUMMARY_SCOPES, SummaryDeps } from '../spend/spend-summary.builder';
import * as budgetList from '../spend/budget-list/budget-list.service';
import type { BudgetListAccess } from '../spend/budget-list/budget-list.runtime';
import type { AggregateSpec } from '../common/list-engine/list-aggregate';
import { CapexItemUpsertDto } from './dto/capex-item.dto';
import { StorageService } from '../common/storage/storage.service';
import { randomUUID } from 'crypto';
import { CapexItemContactsService } from './capex-item-contacts.service';
import { listItemApplications, replaceItemApplications } from '../spend/item-applications';
import { PortfolioProjectCapex } from '../portfolio/portfolio-project-capex.entity';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import { ItemNumberService } from '../common/item-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { resolveToUuid } from '../common/resolve-item-id';
import { resolveItemWrite } from '../spend/item-write.util';
import {
  itemAnalyticsAuditFields,
  itemAnalyticsFields,
  ItemAnalyticsValue,
  loadItemAnalyticsValues,
  writeItemAnalyticsValues,
} from '../spend/item-analytics.util';
import { syncSupplierContactsWithinUpdate } from '../contacts/contact-link-attach.util';
import { insertProjectBudgetLinks, lockBudgetLine } from '../portfolio/project-budget-links.util';
import { updateItemUnderLock } from '../spend/item-locked-update';

import { assertSetFilterModes } from '../common/ag-grid-filtering';
import { countItemRelations, loadItemReferences } from '../spend/item-workspace.util';
import { readBudgetLineMeta } from '../spend/item-meta';

function displayName(user?: User | null): string {
  if (!user) return '';
  const fn = (user as any).first_name ? String((user as any).first_name).trim() : '';
  const ln = (user as any).last_name ? String((user as any).last_name).trim() : '';
  const name = [fn, ln].filter(Boolean).join(' ');
  return name || (user as any).email || '';
}

@Injectable()
export class CapexItemsService {
  constructor(
    @InjectRepository(CapexItem) private readonly repo: Repository<CapexItem>,
    @InjectRepository(CapexVersion) private readonly versions: Repository<CapexVersion>,
    @InjectRepository(CapexAmount) private readonly amounts: Repository<CapexAmount>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    private readonly allocationCalculator: CapexAllocationCalculatorService,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly fxRates: FxRateService,
    private readonly storage: StorageService,
    private readonly itemContacts: CapexItemContactsService,
    private readonly itemNumbers: ItemNumberService,
    private readonly notifications: NotificationsService,
  ) {}

  private async resolveTenantId(mg: EntityManager): Promise<string> {
    const rows = await mg.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const tenantId = Array.isArray(rows) && rows.length > 0 ? (rows[0]?.tenant_id as string | null) : null;
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    return tenantId;
  }

  private async resolveItemId(idOrRef: string, mg: EntityManager): Promise<string> {
    return resolveToUuid(idOrRef, 'capex', mg);
  }

  private async enrichSummaryItems(baseItems: CapexItem[], mg: EntityManager, tenantId: string): Promise<any[]> {
    if (!baseItems.length) return [];
    const companyIds = Array.from(new Set(baseItems.map((i: any) => i.paying_company_id).filter(Boolean)));
    const supplierIds = Array.from(new Set(baseItems.map((i: any) => i.supplier_id).filter(Boolean)));
    const accountIds = Array.from(new Set(baseItems.map((i: any) => i.account_id).filter(Boolean)));
    const ownerIds = Array.from(new Set(baseItems.flatMap((i: any) => [i.owner_it_id, i.owner_business_id]).filter(Boolean))) as string[];

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
        ...item,
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


  /** Copy one CAPEX budget column to another year or column (all or nothing); see `budget-column-operations.ts`. */
  async copyBudgetColumn(operation: CopyColumnOperation, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = opts?.manager ?? this.repo.manager;
    return copyBudgetColumn({ manager, audit: this.audit, freeze: this.freeze }, 'capex', operation, userId);
  }

  /** Copy CAPEX allocations to another year (all or nothing); see `budget-allocation-operations.ts`. */
  async copyAllocations(operation: CopyAllocationsOperation, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = opts?.manager ?? this.repo.manager;
    return copyAllocations({ manager, audit: this.audit, calculator: this.allocationCalculator }, 'capex', operation, userId);
  }

  /** Clear one CAPEX budget column of a year (all or nothing); see `budget-column-operations.ts`. */
  async clearBudgetColumn(operation: { year: number; column: BudgetColumn }, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = opts?.manager ?? this.repo.manager;
    return clearBudgetColumn({ manager, audit: this.audit, freeze: this.freeze }, 'capex', operation, userId);
  }

  async list(query: any, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexItem);
    const { page, limit, skip, sort, status, q, filters } = parsePagination(query);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    assertSetFilterModes(filters, ['status']);
    const filtersToApply = sanitizedFilters ?? filters;
    const allowedFields = [...SUMMARY_SCOPES.capex.columns];
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply, allowedFields));
    }
    // Keep list behavior simple: explicit enabled or disabled; default to enabled gating.
    const lifecycleStatus = status ?? statusFromAg ?? StatusState.ENABLED;
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const scope: LifecycleScope = matchNone ? 'none' : includeDisabled ? null : lifecycleStatus === StatusState.DISABLED ? 'inactive' : 'active';
    applyDisabledAtWhere(where, scope, filtersToApply);
    if (q) where.description = ILike(`%${q}%`);
    // Set after the grid filters, so none of them can replace it.
    const tenantId = await this.resolveTenantId(mg);
    where.tenant_id = tenantId;
    const safeSortField = allowedFields.includes(sort.field) ? sort.field : 'created_at';
    const [itemsRaw, total] = await repo.findAndCount({ where, order: { [safeSortField]: sort.direction as any }, skip, take: limit });
    const items = await this.enrichSummaryItems(itemsRaw as CapexItem[], mg, tenantId);
    return { items, total, page, limit };
  }

  /** The stored line of the session tenant (by id or CPX reference), without its analytics values. */
  private async findItem(id: string, mg: EntityManager): Promise<CapexItem> {
    const itemId = await this.resolveItemId(id, mg);
    const tenantId = await this.resolveTenantId(mg);
    const found = await mg.getRepository(CapexItem).findOne({ where: { id: itemId, tenant_id: tenantId } });
    if (!found) throw new NotFoundException('CAPEX item not found');
    return found;
  }

  /** The line with its analytics values (see `spend/item-analytics.util.ts`). */
  private withAnalyticsValues(item: CapexItem, values: ItemAnalyticsValue[]) {
    return { ...item, ...itemAnalyticsFields(values) };
  }

  private async loadAnalytics(mg: EntityManager, item: CapexItem): Promise<ItemAnalyticsValue[]> {
    return (await loadItemAnalyticsValues(mg, 'capex', item.tenant_id, [item.id])).get(item.id) ?? [];
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const found = await this.findItem(id, mg);
    return this.withAnalyticsValues(found, await this.loadAnalytics(mg, found));
  }

  /** The workspace's read: the line, plus the labels its pickers show (see spend/item-workspace.util.ts). */
  async getDetail(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const found = await this.findItem(id, mg);
    const line = this.withAnalyticsValues(found, await this.loadAnalytics(mg, found));
    return { ...line, references: await loadItemReferences(mg, found) };
  }

  /** The line's meta (lot 3G, `item-meta.ts`): its freshness counters, who changed it and when. */
  async meta(id: string, tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const meta = await readBudgetLineMeta(mg, 'capex', tenantId, id);
    if (!meta) throw new NotFoundException('CAPEX item not found');
    return meta;
  }

  /** The Relations tab badge: one statement instead of one request per relation. */
  async relationCounts(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return countItemRelations(mg, 'capex', await this.findItem(id, mg));
  }

  async yearlyTotals(capexItemId: string, from: number, to: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const lo = Math.min(from, to);
    const hi = Math.min(Math.max(from, to), lo + 20);
    const rows: Array<{ year: number; budget: string; revision: string; forecast: string; actual: string; landing: string }> = await mg.query(
      `SELECT v.budget_year AS year,
              COALESCE(SUM(t.planned), 0) AS budget,
              COALESCE(SUM(t.committed), 0) AS revision,
              COALESCE(SUM(t.forecast), 0) AS forecast,
              COALESCE(SUM(t.actual), 0) AS actual,
              COALESCE(SUM(t.expected_landing), 0) AS landing
       FROM capex_versions v
       LEFT JOIN capex_version_totals t ON t.tenant_id = v.tenant_id AND t.version_id = v.id
       WHERE v.tenant_id = app_current_tenant() AND v.capex_item_id = $1 AND v.budget_year BETWEEN $2 AND $3
       GROUP BY v.budget_year
       ORDER BY v.budget_year`,
      [capexItemId, lo, hi],
    );
    const byYear = new Map(rows.map((r) => [Number(r.year), r]));
    const years: Array<{ year: number; budget: number; revision: number; forecast: number; actual: number; landing: number }> = [];
    for (let y = lo; y <= hi; y += 1) {
      const row = byYear.get(y);
      years.push({
        year: y,
        budget: Number(row?.budget) || 0,
        revision: Number(row?.revision) || 0,
        forecast: Number(row?.forecast) || 0,
        actual: Number(row?.actual) || 0,
        landing: Number(row?.landing) || 0,
      });
    }
    return { items: years };
  }

  async share(id: string, dto: ShareItemDto, tenantId: string, userId: string, opts?: { manager?: EntityManager }) {
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    const mg = opts?.manager ?? this.repo.manager;
    const item = await mg.getRepository(CapexItem).findOne({ where: { id, tenant_id: tenantId }, select: ['id', 'description'] as any });
    if (!item) throw new NotFoundException('CAPEX item not found');

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
        itemType: 'capex',
        itemId: item.id,
        itemName: item.description,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
        manager: mg,
      });
    }
    return { success: true };
  }

  /** `disabled_at`, or the deprecated `effective_end` when no end of validity is given (bare date at 12:00 UTC). */
  private endOfValidityInput(disabledAt: string | Date | null | undefined, effectiveEnd: unknown) {
    try {
      return resolveEndOfValidityAlias(disabledAt, effectiveEnd);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  async create(body: CapexItemUpsertDto, userId?: string, opts?: { manager?: EntityManager; itemNumber?: number; source?: string }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexItem);
    // Writable columns only (company_id is the legacy alias of the paying company),
    // every id resolved in this tenant; see `spend/item-write.util.ts`.
    const { values, lifecycle: input, analytics } = await resolveItemWrite(mg, 'capex', body, null);
    const disabled_at = this.endOfValidityInput(input.disabled_at, input.effective_end);
    const lifecycle = resolveLifecycleState({ nextStatus: input.status, nextDisabledAt: disabled_at });
    const tenantId = await this.resolveTenantId(mg);
    const item_number = opts?.itemNumber ?? await this.itemNumbers.nextItemNumber('capex', tenantId, mg);
    const entity = repo.create({
      ...(values as Partial<CapexItem>),
      // These columns are NOT NULL on the entity while the DTO allows null
      description: (values.description as string | null | undefined) ?? undefined,
      ppe_type: (values.ppe_type as CapexItem['ppe_type'] | null | undefined) ?? undefined,
      investment_type: (values.investment_type as CapexItem['investment_type'] | null | undefined) ?? undefined,
      priority: (values.priority as CapexItem['priority'] | null | undefined) ?? undefined,
      currency: (values.currency as string | null | undefined) ?? undefined,
      effective_start: (values.effective_start as string | null | undefined) ?? undefined,
      item_number,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);
    await writeItemAnalyticsValues(mg, 'capex', tenantId, saved.id, analytics);
    const persisted = (await repo.findOne({ where: { id: saved.id, tenant_id: tenantId } })) ?? saved;
    const analyticsValues = analytics.length > 0 ? await this.loadAnalytics(mg, { ...persisted, tenant_id: tenantId }) : [];
    await this.audit.log({
      table: 'capex_items', recordId: saved.id, action: 'create', before: null,
      after: { ...persisted, ...itemAnalyticsAuditFields(analyticsValues), ...(opts?.source ? { source: opts.source } : {}) },
      userId, source: opts?.source,
    }, { manager: mg });
    return this.withAnalyticsValues(persisted, analyticsValues);
  }

  /** `statusEmail: false` skips the owners' status-change email (the budget file load sends none). */
  async update(id: string, body: CapexItemUpsertDto, userId?: string, opts?: { manager?: EntityManager; statusEmail?: boolean; source?: string }) {
    const mg = opts?.manager ?? this.repo.manager;
    const itemId = await this.resolveItemId(id, mg);
    const tenantId = await this.resolveTenantId(mg);
    // Only the columns the body supplied, written under the line's row lock, the chart of accounts
    // checked on the locked row; see `spend/item-locked-update.ts`.
    const result = await updateItemUnderLock(mg, 'capex', tenantId, itemId, body);
    if (!result) throw new NotFoundException('CAPEX item not found');
    const { before, after, analyticsBefore, analyticsAfter, statusBefore } = result;
    await this.audit.log({
      table: 'capex_items', recordId: itemId, action: 'update',
      before: { ...before, ...itemAnalyticsAuditFields(analyticsBefore) },
      after: { ...after, ...itemAnalyticsAuditFields(analyticsAfter), ...(opts?.source ? { source: opts.source } : {}) },
      userId, source: opts?.source,
    }, { manager: mg });

    // Detect supplier change for contact sync
    const oldSupplierId = before.supplier_id ?? null;
    const newSupplierId = after.supplier_id ?? null;
    if (oldSupplierId !== newSupplierId) {
      await syncSupplierContactsWithinUpdate(mg, `CAPEX line ${itemId}`, () =>
        this.itemContacts.syncFromSupplier(itemId, newSupplierId, userId ?? null, { manager: mg, tenantId }));
    }

    if (statusBefore !== after.status && opts?.statusEmail !== false) {
      await this.notifyOwnersOfStatusChange(mg, after, statusBefore, userId);
    }

    return this.withAnalyticsValues(after, analyticsAfter);
  }

  private async notifyOwnersOfStatusChange(mg: EntityManager, item: CapexItem, oldStatus: string, userId?: string) {
    const ownerIds = Array.from(new Set([item.owner_it_id, item.owner_business_id].filter((v): v is string => !!v)));
    if (ownerIds.length === 0) return;
    const tenantId = item.tenant_id;
    const users: Array<{ id: string; email: string; locale: string | null }> = await mg.query(
      `SELECT id, email, locale FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'enabled'`,
      [tenantId, ownerIds],
    );
    const byId = new Map(users.map((u) => [u.id, u]));
    const recipients = ownerIds.flatMap((ownerId) => {
      const user = byId.get(ownerId);
      return user ? [{ userId: user.id, email: user.email, locale: user.locale }] : [];
    });
    if (recipients.length === 0) return;
    this.notifications.notifyStatusChange({
      itemType: 'capex',
      itemId: item.id,
      itemName: item.description,
      oldStatus,
      newStatus: item.status,
      recipients,
      tenantId,
      excludeUserId: userId,
      manager: mg,
    });
  }

  /** Dependencies of the list engine and the row builder. */
  /** The list engine's dependencies; `access` is the caller's (the consolidation fields), from the controller. */
  private summaryDeps(access?: BudgetListAccess): SummaryDeps {
    return { allocationCalculator: this.allocationCalculator, fxRates: this.fxRates, ...(access ? { access } : {}) };
  }

  /**
   * One page of the CAPEX list, on the SQL list engine (`spend/budget-list/`),
   * with the next year's allocation label; `shape=grid` returns the lean rows
   * of the grid.
   */
  async summary(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }) {
    return budgetList.budgetListSummary(SUMMARY_SCOPES.capex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager, {
      includeRecipientDetails: true,
      includeNextYearAllocation: true,
    });
  }

  async summaryFilterValues(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<Record<string, Array<string | null>>> {
    return budgetList.budgetListFilterValues(SUMMARY_SCOPES.capex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  /** Every id of the list in its order (workspace navigation). */
  async summaryIds(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
    return budgetList.budgetListIds(SUMMARY_SCOPES.capex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  /** Where one line stands in the list, with its previous and next lines. */
  async summaryNeighbors(query: any, id: string, opts?: { manager?: EntityManager; access?: BudgetListAccess }) {
    return budgetList.budgetListNeighbors(SUMMARY_SCOPES.capex, this.summaryDeps(opts?.access), query, id, opts?.manager ?? this.repo.manager);
  }

  /**
   * The lines of a list state grouped and measured in one statement
   * (`budget-list.service.ts`, `budgetListAggregate`): the AI aggregates, the reports and the dashboard.
   */
  async summaryAggregate(query: any, spec: AggregateSpec, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<budgetList.BudgetListAggregate> {
    return budgetList.budgetListAggregate(SUMMARY_SCOPES.capex, this.summaryDeps(opts?.access), query, spec, opts?.manager ?? this.repo.manager);
  }

  /** `POST …/summary/aggregate`: `{ query, spec }` (reports and the dashboard). */
  async summaryAggregateRequest(body: unknown, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<budgetList.BudgetListAggregate> {
    return budgetList.budgetListAggregateRequest(SUMMARY_SCOPES.capex, this.summaryDeps(opts?.access), body, opts?.manager ?? this.repo.manager);
  }

  async summaryRowsByIds(
    itemIds: string[],
    query?: { years?: number[]; includeRecipientDetails?: boolean; includeLatestTask?: boolean; includeNextYearAllocation?: boolean },
    opts?: { manager?: EntityManager },
  ) {
    return budgetList.budgetListRowsByIds(SUMMARY_SCOPES.capex, this.summaryDeps(), { ...query, ids: itemIds }, opts?.manager ?? this.repo.manager);
  }

  async summaryTotals(query: any, opts?: { manager?: EntityManager; access?: BudgetListAccess }): Promise<Record<string, number | string>> {
    return budgetList.budgetListTotals(SUMMARY_SCOPES.capex, this.summaryDeps(opts?.access), query, opts?.manager ?? this.repo.manager);
  }

  // Links
  async listLinks(capexItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.resolveTenantId(mg);
    return mg.getRepository(CapexLink).find({ where: { tenant_id: tenantId, capex_item_id: capexItemId } as any, order: { created_at: 'ASC' as any } });
  }

  async createLink(capexItemId: string, body: any, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexLink);
    const capex = await this.findItem(capexItemId, mg);
    const entity = repo.create({ tenant_id: capex.tenant_id, capex_item_id: capex.id, description: (body?.description ?? null) as any, url: String(body?.url || '').trim() });
    const saved = await repo.save(entity);
    await this.audit.log({ table: 'capex_links', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
  }

  async updateLink(capexItemId: string, linkId: string, body: any, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexLink);
    const tenantId = await this.resolveTenantId(mg);
    // Lock order (`spend/budget-locks.ts`): the line, then its link, read again under the lock.
    await lockBudgetLine(mg, 'capex', tenantId, capexItemId);
    const where = { id: linkId, capex_item_id: capexItemId, tenant_id: tenantId } as any;
    const locked = await mg.query(
      `SELECT id FROM capex_links WHERE tenant_id = $1 AND id = $2 AND capex_item_id = $3 FOR NO KEY UPDATE`,
      [tenantId, linkId, capexItemId],
    );
    const before = locked.length > 0 ? await repo.findOne({ where }) : null;
    if (!before) throw new NotFoundException('Link not found');
    // Only the fields the body supplies (a description sent empty clears it).
    const set: Partial<CapexLink> = {};
    if (body?.description !== undefined) set.description = body.description ?? null;
    if (body?.url !== undefined) set.url = String(body.url || '').trim();
    if (Object.keys(set).length > 0) await repo.update(where, set);
    const saved = (await repo.findOne({ where })) ?? before;
    await this.audit.log({ table: 'capex_links', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager: mg });
    return saved;
  }

  async deleteLink(capexItemId: string, linkId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexLink);
    const tenantId = await this.resolveTenantId(mg);
    const existing = await repo.findOne({ where: { id: linkId, capex_item_id: capexItemId, tenant_id: tenantId } as any });
    if (!existing) return { ok: true };
    await repo.delete({ id: linkId, capex_item_id: capexItemId, tenant_id: tenantId } as any);
    await this.audit.log({ table: 'capex_links', recordId: linkId, action: 'delete', before: existing, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // Attachments
  async listAttachments(capexItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.resolveTenantId(mg);
    return mg.getRepository(CapexAttachment).find({ where: { tenant_id: tenantId, capex_item_id: capexItemId } as any, order: { uploaded_at: 'DESC' as any } });
  }

  async uploadAttachment(capexItemId: string, file: Express.Multer.File, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexAttachment);
    if (!file) throw new BadRequestException('No file uploaded');
    const capex = await this.findItem(capexItemId, mg);
    const tenant_id = capex.tenant_id;
    const id = randomUUID();
    const now = new Date();
    const decodedName = fixMulterFilename(file.originalname);
    const ext = path.extname(decodedName || '') || '';
    const rand = Math.random().toString(36).slice(2, 8);
    const key = [
      'files', tenant_id, 'capex', capex.id,
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
      capex_item_id: capex.id,
      original_filename: decodedName || `${id}${ext}`,
      stored_filename: path.basename(key),
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: key,
    } as any);
    const saved = await repo.save(entity as any) as CapexAttachment as any;
    await this.audit.log({ table: 'capex_attachments', recordId: (saved as any).id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved as any;
  }

  async downloadAttachment(attachmentId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexAttachment);
    const tenantId = await this.resolveTenantId(mg);
    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) throw new NotFoundException('Attachment not found');
    return found;
  }

  async deleteAttachment(attachmentId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexAttachment);
    const tenantId = await this.resolveTenantId(mg);
    const found = await repo.findOne({ where: { id: attachmentId, tenant_id: tenantId } as any });
    if (!found) return { ok: true };
    await repo.delete({ id: attachmentId, tenant_id: tenantId } as any);
    try { await this.storage.deleteObject((found as any).storage_path); } catch {}
    await this.audit.log({ table: 'capex_attachments', recordId: found.id, action: 'update', before: found, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // Projects
  async listProjects(capexItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const capex = await this.findItem(capexItemId, mg); // ensure item exists
    const rows = await mg.query(
      `SELECT l.project_id as id, p.name
       FROM portfolio_project_capex l
       JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.capex_id = $2
       ORDER BY p.name ASC`,
      [capex.tenant_id, capex.id],
    );
    return { items: rows };
  }

  async bulkReplaceProjects(capexItemId: string, projectIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const capex = await this.findItem(capexItemId, mg);
    const itemId = capex.id;
    const tenantId = capex.tenant_id;
    const cleanIds = Array.from(new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (cleanIds.length) {
      // Read in the line's tenant: a project of another tenant is not found.
      const projects = await mg.getRepository(PortfolioProject).find({ where: { tenant_id: tenantId, id: In(cleanIds) } as any });
      if (projects.length !== cleanIds.length) throw new BadRequestException('One or more projects not found');
    }
    // Two saves of the line's projects take turns (the last one wins); a link the project
    // side stored meanwhile is kept, never a unique violation. See project-budget-links.util.ts.
    if (!(await lockBudgetLine(mg, 'capex', tenantId, itemId))) throw new NotFoundException('CAPEX item not found');
    await mg.getRepository(PortfolioProjectCapex).delete({ tenant_id: tenantId, capex_id: itemId } as any);
    await insertProjectBudgetLinks(mg, 'capex', tenantId, cleanIds.map((projectId) => ({ projectId, itemId })));
    return this.listProjects(itemId, { manager: mg });
  }

  // Applications
  /** Applications linked to the line; see `spend/item-applications.ts`. */
  async listApplications(capexItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const capex = await this.findItem(capexItemId, mg);
    return listItemApplications(mg, 'capex', capex);
  }

  /** Replace the line's applications (audited when the set changes); see `spend/item-applications.ts`. */
  async bulkReplaceApplications(capexItemId: string, applicationIds: string[], userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const capex = await this.findItem(capexItemId, mg);
    return replaceItemApplications({ manager: mg, audit: this.audit }, 'capex', capex, applicationIds, userId ?? null);
  }
}
