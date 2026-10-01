import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, ILike, In, Repository } from 'typeorm';
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
import { AmountMeasure, BudgetColumn } from '../spend/amounts-write.util';
import { clearBudgetColumn, copyBudgetColumn, CopyColumnOperation } from '../spend/budget-column-operations';
import { copyAllocations, CopyAllocationsOperation } from '../spend/budget-allocation-operations';
import { writeItemCsvTotals } from '../spend/round-inputs.util';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import * as path from 'path';
import { CapexLink } from './capex-link.entity';
import { CapexAttachment } from './capex-attachment.entity';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { formatCents, toCents } from '../common/amount';
import { FreezeService } from '../freeze/freeze.service';
import { FxRateService } from '../currency/fx-rate.service';
import { applyDisabledAtWhere, deriveStatusFromDisabledAt, LifecycleScope, parseEndOfValidityInput, resolveEndOfValidityAlias, resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { loadVersionTotals, SUMMARY_COLUMNS, SUMMARY_SCOPES, SummaryDeps, summaryTenantId } from '../spend/spend-summary.builder';
import * as budgetSummary from '../spend/budget-summary';
import { CapexItemUpsertDto } from './dto/capex-item.dto';
import { StorageService } from '../common/storage/storage.service';
import { randomUUID } from 'crypto';
import { CapexItemContactsService } from './capex-item-contacts.service';
import { listItemApplications, replaceItemApplications } from '../spend/item-applications';
import { csvDateError, parseCsvDate } from '../spend/csv-date';
import { PortfolioProjectCapex } from '../portfolio/portfolio-project-capex.entity';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import { ItemNumberService } from '../common/item-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { resolveToUuid } from '../common/resolve-item-id';
import {
  csvCostCenterDisabledError,
  CSV_COMPANY_REQUIRED_ERROR,
  CSV_RUN_BUILD_ERROR,
  CsvCostCenter,
  csvItemLifecycle,
  csvLifecycleConflict,
  ITEM_CSV_OPTIONAL_HEADERS,
  loadCostCenterCodes,
  loadCostCentersByCode,
  lockCsvCostCenters,
  parseRunBuild,
  resolveCsvCostCenter,
  resolveItemWrite,
} from '../spend/item-write.util';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import {
  csvAnalyticsBodyValues,
  CsvAnalyticsCell,
  csvAnalyticsDisabledErrors,
  csvAnalyticsNamesDisabled,
  isCsvAnalyticsHeader,
  itemAnalyticsAuditFields,
  itemAnalyticsFields,
  ItemAnalyticsValue,
  loadCsvAnalyticsExport,
  loadItemAnalyticsValues,
  readCsvAnalyticsCells,
  readCsvAnalyticsColumns,
  writeItemAnalyticsValues,
} from '../spend/item-analytics.util';

// Accepted on import for one release, never exported: the end of validity used to be split in two dates.
const LEGACY_CSV_HEADERS = ['effective_end'];

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

  /**
   * Spread a year's totals from the file flat over its twelve months. Only the
   * measures with a value in the file replace that year: a blank cell leaves
   * the stored months (and the column's period) as they are, an explicit 0
   * clears them. Each column written gets a whole-year flat spread
   * record.
   */
  async writeImportedTotals(
    mg: EntityManager,
    version: CapexVersion,
    year: number,
    totals: Partial<Record<'planned' | 'actual' | 'expected_landing' | 'committed', number>>,
    checkedFreeze?: Set<string>,
    userId: string | null = null,
  ) {
    const annualTotals: Partial<Record<AmountMeasure, bigint>> = {};
    for (const measure of ['planned', 'actual', 'expected_landing', 'committed'] as const) {
      const value = totals[measure];
      if (value != null && !isNaN(Number(value))) annualTotals[measure] = toCents(value);
    }
    await writeItemCsvTotals(
      { manager: mg, freeze: this.freeze, scope: 'capex', version, checkedFreeze },
      { userId, audit: this.audit },
      year,
      annualTotals,
    );
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

  async yearlyTotals(capexItemId: string, from: number, to: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const lo = Math.min(from, to);
    const hi = Math.min(Math.max(from, to), lo + 20);
    const rows: Array<{ year: number; budget: string; revision: string; forecast: string; actual: string; landing: string }> = await mg.query(
      `SELECT v.budget_year AS year,
              COALESCE(SUM(a.planned), 0) AS budget,
              COALESCE(SUM(a.committed), 0) AS revision,
              COALESCE(SUM(a.forecast), 0) AS forecast,
              COALESCE(SUM(a.actual), 0) AS actual,
              COALESCE(SUM(a.expected_landing), 0) AS landing
       FROM capex_versions v
       LEFT JOIN capex_amounts a ON a.tenant_id = v.tenant_id AND a.version_id = v.id AND EXTRACT(YEAR FROM a.period) = v.budget_year
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

  async create(body: CapexItemUpsertDto, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexItem);
    // Writable columns only (company_id is the legacy alias of the paying company),
    // every id resolved in this tenant; see `spend/item-write.util.ts`.
    const { values, lifecycle: input, analytics } = await resolveItemWrite(mg, 'capex', body, null);
    const disabled_at = this.endOfValidityInput(input.disabled_at, input.effective_end);
    const lifecycle = resolveLifecycleState({ nextStatus: input.status, nextDisabledAt: disabled_at });
    const tenantId = await this.resolveTenantId(mg);
    const item_number = await this.itemNumbers.nextItemNumber('capex', tenantId, mg);
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
      after: { ...persisted, ...itemAnalyticsAuditFields(analyticsValues) }, userId,
    }, { manager: mg });
    return this.withAnalyticsValues(persisted, analyticsValues);
  }

  /** `statusEmail: false` skips the owners' status-change email (the CSV import sends none, like OPEX's). */
  async update(id: string, body: CapexItemUpsertDto, userId?: string, opts?: { manager?: EntityManager; statusEmail?: boolean }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(CapexItem);
    const existing = await this.findItem(id, mg);
    const itemId = existing.id;
    const before = { ...existing };
    const analyticsBefore = await this.loadAnalytics(mg, existing);
    // Writable columns only, every id resolved in this tenant, and the chart of
    // accounts checked on the resulting company and account; see `spend/item-write.util.ts`.
    const { values, lifecycle: input, analytics } = await resolveItemWrite(mg, 'capex', body, existing);
    const disabled_at = this.endOfValidityInput(input.disabled_at, input.effective_end);
    Object.assign(existing, values);
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: before.disabled_at,
      nextStatus: input.status,
      nextDisabledAt: disabled_at,
    });
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;
    // A plain column (no trigger, no @UpdateDateColumn): "recent updates" read it.
    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    // A change of analytics values alone is an edit too (updated_at above, the audit below).
    await writeItemAnalyticsValues(mg, 'capex', existing.tenant_id, itemId, analytics);
    const persisted = await repo.findOne({ where: { id: itemId, tenant_id: existing.tenant_id } });
    const analyticsAfter = analytics.length > 0 ? await this.loadAnalytics(mg, existing) : analyticsBefore;
    await this.audit.log({
      table: 'capex_items', recordId: saved.id, action: 'update',
      before: { ...before, ...itemAnalyticsAuditFields(analyticsBefore) },
      after: { ...(persisted ?? saved), ...itemAnalyticsAuditFields(analyticsAfter) }, userId,
    }, { manager: mg });

    // Detect supplier change for contact sync
    const oldSupplierId = (before as any).supplier_id ?? null;
    const newSupplierId = (persisted as any)?.supplier_id ?? (saved as any).supplier_id ?? null;
    if (oldSupplierId !== newSupplierId) {
      await this.itemContacts.syncFromSupplier(itemId, newSupplierId, userId ?? null, { manager: mg, tenantId: existing.tenant_id });
    }

    const after = persisted ?? saved;
    if (before.status !== after.status && opts?.statusEmail !== false) {
      await this.notifyOwnersOfStatusChange(mg, after, before.status, userId);
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

  /** Dependencies of the shared list engine (`spend/budget-summary.ts`). */
  private summaryDeps(): SummaryDeps {
    return { allocationCalculator: this.allocationCalculator, fxRates: this.fxRates };
  }

  /** One page of the CAPEX list; see `spend/budget-summary.ts`. */
  async summary(query: any, opts?: { manager?: EntityManager }) {
    return budgetSummary.summary(SUMMARY_SCOPES.capex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager, {
      includeRecipientDetails: true,
      includeNextYearAllocation: true,
    });
  }

  async summaryFilterValues(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    return budgetSummary.summaryFilterValues(SUMMARY_SCOPES.capex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager);
  }

  // Return ordered list of matching CAPEX item IDs for navigation (reflects sort/filter/q)
  async summaryIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
    return budgetSummary.summaryIds(SUMMARY_SCOPES.capex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager);
  }

  async summaryRowsByIds(
    itemIds: string[],
    query?: { years?: number[]; includeRecipientDetails?: boolean; includeLatestTask?: boolean; includeNextYearAllocation?: boolean },
    opts?: { manager?: EntityManager },
  ) {
    return budgetSummary.summaryRowsByIds(SUMMARY_SCOPES.capex, this.summaryDeps(), { ...query, ids: itemIds }, opts?.manager ?? this.repo.manager);
  }

  async summaryTotals(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, number | string>> {
    return budgetSummary.summaryTotals(SUMMARY_SCOPES.capex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager);
  }

  csvHeaders() {
    return [
      'item_number','description','ppe_type','investment_type','priority','currency','effective_start','status','disabled_at','notes','company_name',
      'owner_it_email','owner_business_email','analytics_category','cost_center_code','run_build',
      'y_minus1_budget','y_minus1_landing','y_budget','y_follow_up','y_landing','y_revision','y_plus1_budget','y_plus1_revision','y_plus2_budget'
    ];
  }

  async exportCsv(scope: 'template' | 'data' = 'data', opts?: { manager?: EntityManager }): Promise<{ filename: string; content: string }> {
    const delimiter = ';';
    const chunks: string[] = [];
    const mgExport = opts?.manager ?? this.repo.manager;
    const tenantId = await summaryTenantId(mgExport);
    if (scope === 'template') {
      // analytics_category, then one analytics:<code> column per enabled dimension besides the default one.
      const headerRow = (await loadCsvAnalyticsExport(mgExport, 'capex', tenantId, [])).headers(this.csvHeaders()).join(delimiter);
      return { filename: 'capex_template.csv', content: '\ufeff' + headerRow + '\n' };
    }

    // Data export: every item whatever its end of validity, read without the list paging,
    // with what is stored, as the OPEX item export writes it (a masked 0 would clear that year on re-import).
    const Y = new Date().getFullYear();
    const items = await mgExport.getRepository(CapexItem).find({
      where: { tenant_id: tenantId } as any,
      order: { created_at: 'DESC', id: 'DESC' } as any,
    });
    const analyticsColumns = await loadCsvAnalyticsExport(mgExport, 'capex', tenantId, items.map((it) => it.id));
    const headers = analyticsColumns.headers(this.csvHeaders());
    const stored = await loadVersionTotals(SUMMARY_SCOPES.capex, this.summaryDeps(), mgExport, tenantId, items, [Y - 1, Y, Y + 1, Y + 2], { reporting: false });
    const storedTotals = (itemId: string, year: number): Record<string, number> => {
      const version = stored.versionsByItemYear.get(itemId)?.get(year);
      const cents = version ? stored.cents.get(version.id) : undefined;
      return Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, cents ? Number(formatCents(cents[c.key])) : 0]));
    };

    // Get company names for items that have company_id
    const companyIds = Array.from(new Set(items.map((it: any) => it.paying_company_id).filter(Boolean))) as string[];
    const companies = companyIds.length > 0
      ? await mgExport.getRepository(Company).find({ where: { tenant_id: tenantId, id: In(companyIds) } as any })
      : [];
    const companiesById = new Map(companies.map(c => [c.id, c.name]));
    const ownerIds = Array.from(new Set(items.flatMap((it: any) => [it.owner_it_id, it.owner_business_id]).filter(Boolean))) as string[];
    const owners = ownerIds.length > 0 ? await mgExport.getRepository(User).find({ where: { tenant_id: tenantId, id: In(ownerIds) } as any }) : [];
    const ownerEmailById = new Map(owners.map((u) => [u.id, u.email]));
    const costCenterCodeById = await loadCostCenterCodes(mgExport, tenantId, items.map((it) => it.cost_center_id));

    const { format } = await import('@fast-csv/format');
    const toIsoDate = (value: unknown): string => {
      if (value == null || value === '') return '';
      if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
      }
      const str = value.toString().trim();
      if (str === '') return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      const parsed = new Date(str);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
      return '';
    };
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      for (const it of items as any[]) {
        const tMinus1 = storedTotals(it.id, Y - 1);
        const tY = storedTotals(it.id, Y);
        const tPlus1 = storedTotals(it.id, Y + 1);
        const tPlus2 = storedTotals(it.id, Y + 2);
        stream.write({
          item_number: (it as any).item_number ?? '',
          description: (it as any).description ?? '',
          ppe_type: (it as any).ppe_type ?? '',
          investment_type: (it as any).investment_type ?? '',
          priority: (it as any).priority ?? '',
          currency: (it as any).currency ?? '',
          effective_start: toIsoDate((it as any).effective_start),
          // Read from the end of validity: the stored status is not updated when the date passes.
          status: deriveStatusFromDisabledAt((it as any).disabled_at),
          disabled_at: (it as any).disabled_at ? toIsoDate((it as any).disabled_at) : '',
          notes: (it as any).notes ?? '',
          company_name: (it as any).paying_company_id ? (companiesById.get((it as any).paying_company_id) ?? '') : '',
          owner_it_email: (it as any).owner_it_id ? (ownerEmailById.get((it as any).owner_it_id) ?? '') : '',
          owner_business_email: (it as any).owner_business_id ? (ownerEmailById.get((it as any).owner_business_id) ?? '') : '',
          ...analyticsColumns.cells(it.id),
          cost_center_code: it.cost_center_id ? (costCenterCodeById.get(it.cost_center_id) ?? '') : '',
          run_build: it.run_build ?? '',
          y_minus1_budget: tMinus1.budget,
          y_minus1_landing: tMinus1.landing,
          y_budget: tY.budget,
          y_follow_up: tY.follow_up,
          y_landing: tY.landing,
          y_revision: tY.revision,
          y_plus1_budget: tPlus1.budget,
          y_plus1_revision: tPlus1.revision,
          y_plus2_budget: tPlus2.budget,
        });
      }
      stream.end();
    });
    return { filename: 'capex.csv', content: '\ufeff' + chunks.join('') };
  }

  async importCsv({ file, dryRun, userId }: { file: Express.Multer.File; dryRun: boolean; userId?: string | null }, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    if (!file) throw new Error('No file uploaded');
    const delimiter = ';';
    const optionalHeaders: readonly string[] = ITEM_CSV_OPTIONAL_HEADERS;
    const expectedHeaders = this.csvHeaders();
    const requiredHeaders = expectedHeaders.filter((h) => !optionalHeaders.includes(h));
    type Row = Record<string, string>;
    const rows: Row[] = [];
    const errors: { row: number; message: string }[] = [];
    let headerOk = false;
    let fileHeaders: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
      if (!buf) { reject(new Error('Empty upload')); return; }
      let content: string;
      try { content = decodeCsvBufferUtf8OrThrow(buf as Buffer); }
      catch { reject(new Error('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.')); return; }
      parseString(content, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('headers', (headers: string[]) => {
          fileHeaders = headers;
          const missing = requiredHeaders.filter((h) => !headers.includes(h));
          // analytics:<code> columns are checked against the tenant's dimensions below.
          const extras = headers.filter((h) => !expectedHeaders.includes(h) && !LEGACY_CSV_HEADERS.includes(h) && !isCsvAnalyticsHeader(h));
          headerOk = missing.length === 0 && extras.length === 0;
          if (!headerOk) errors.push({ row: 0, message: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` });
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Row) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });
    if (!headerOk) return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors };
    // Absent optional columns leave the stored values as they are.
    const hasCostCenter = fileHeaders.includes('cost_center_code');
    const hasRunBuild = fileHeaders.includes('run_build');

    const tenantId = await this.resolveTenantId(mg);
    // One column per dimension (analytics_category is the default one); an unknown or disabled one refuses the file.
    const analyticsColumns = await readCsvAnalyticsColumns(mg, tenantId, fileHeaders, { create: !dryRun });
    if (analyticsColumns.errors.length > 0) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors: analyticsColumns.errors.map((message) => ({ row: 0, message })) };
    }

    // The tenant's allowed currencies, as the OPEX import checks them (none configured: any code).
    const { settings: currencySettings } = await this.fxRates.resolveRates(tenantId, [], { manager: mg });
    const allowedCurrencies = new Set(
      (currencySettings.allowedCurrencies ?? []).map((c) => String(c || '').trim().toUpperCase()).filter((c) => c.length === 3),
    );

    const now = new Date();
    const Y = now.getFullYear();
    // number parsing tolerant to thousand separators and comma decimals
    const parseAmount = (raw: string): number | undefined => {
      let s = (raw || '').trim(); if (s === '') return undefined; s = s.replace(/\s+/g, '');
      const hasComma = s.includes(','); const hasDot = s.includes('.');
      if (hasComma && hasDot) { s = s.replace(/\./g, ''); s = s.replace(/,/g, '.'); }
      else if (hasComma && !hasDot) { s = s.replace(/,/g, '.'); }
      s = s.replace(/[^0-9.-]/g, '');
      if (s === '' || s === '-' || s === '.' || s === '-.') return undefined;
      const cents = toCents(s);
      return Number(formatCents(cents));
    };

    // Get all companies for name resolution
    const allCompanies = await mg.getRepository(Company).find({ where: { tenant_id: tenantId } as any });
    const costCentersByCode = hasCostCenter ? await loadCostCentersByCode(mg, tenantId) : new Map<string, CsvCostCenter>();
    const companiesByName = new Map(allCompanies.map(c => [c.name.toLowerCase(), c.id]));

    /** A YYYY-MM-DD cell (see `spend/csv-date.ts`): null when blank; any other value is the row's error. */
    const readDate = (raw: unknown, field: string, line: number): string | null => {
      const value = parseCsvDate(raw);
      if (value === undefined) errors.push({ row: line, message: csvDateError(field) });
      return value ?? null;
    };
    const userCache = new Map<string, User | null>();
    const findUserByEmail = async (email: string): Promise<User | null> => {
      const key = email.toLowerCase();
      if (userCache.has(key)) return userCache.get(key) ?? null;
      const user = await mg.getRepository(User).createQueryBuilder('u')
        .where('u.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(u.email) = LOWER(:email)', { email })
        .getOne();
      userCache.set(key, user ?? null);
      return user ?? null;
    };
    // An owner is an active (enabled) user of this tenant, as on the OPEX import.
    const resolveOwner = async (email: string, label: string, line: number): Promise<string | null> => {
      if (!email) return null;
      const user = await findUserByEmail(email);
      if (!user) {
        errors.push({ row: line, message: `${label} email '${email}' not found` });
        return null;
      }
      if (user.status !== 'enabled') {
        errors.push({ row: line, message: `${label} email '${email}' is not an active user` });
        return null;
      }
      return user.id;
    };

    const normalized: Array<{
      line: number;
      item_number: number | null;
      description: string; ppe_type: string; investment_type: string; priority: string; currency: string; effective_start: string | null; status: StatusState | null; disabled_at: Date | null; notes: string | null;
      paying_company_id: string | null;
      owner_it_id: string | null;
      owner_business_id: string | null;
      analytics: CsvAnalyticsCell[];
      cost_center: CsvCostCenter | null;
      run_build: 'run' | 'build' | null;
      totals: { [year: number]: { planned?: number; actual?: number; expected_landing?: number; committed?: number } };
    }> = [];

    const rowByLine = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const line = i + 2;
      const description = (r['description'] ?? '').toString().trim();
      const ppe_type = (r['ppe_type'] ?? '').toString().trim().toLowerCase();
      const investment_type = (r['investment_type'] ?? '').toString().trim().toLowerCase();
      const priority = (r['priority'] ?? '').toString().trim().toLowerCase();
      const currency = (r['currency'] ?? '').toString().trim().toUpperCase();
      // Blank: 1 January of this year for a new line, the stored date on an update.
      const effective_start = readDate(r['effective_start'], 'effective_start', line);
      // Blank: enabled for a new line, the stored status on an update (`csvItemLifecycle`).
      const statusRaw = (r['status'] ?? '').toString().trim().toLowerCase();
      if (statusRaw && statusRaw !== 'enabled' && statusRaw !== 'disabled') {
        errors.push({ row: line, message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.` });
      }
      const status = statusRaw === 'disabled' ? StatusState.DISABLED : statusRaw === 'enabled' ? StatusState.ENABLED : null;
      const disabledAtRaw = (r['disabled_at'] ?? '').toString().trim();
      let disabled_at: Date | null = null;
      try {
        disabled_at = parseEndOfValidityInput(disabledAtRaw);
      } catch {
        errors.push({ row: line, message: `Invalid disabled_at '${disabledAtRaw}'. Use ISO date format.` });
      }
      // The status cell must agree with the date cell (not with a legacy effective_end below).
      const lifecycleConflict = csvLifecycleConflict(status, disabled_at);
      if (lifecycleConflict) errors.push({ row: line, message: lifecycleConflict });
      // Files from before the single end date carry effective_end: it fills an empty end of validity.
      if (!disabledAtRaw) {
        const legacyEnd = readDate(r['effective_end'], 'effective_end', line);
        if (legacyEnd) {
          try {
            disabled_at = parseEndOfValidityInput(legacyEnd);
          } catch {
            errors.push({ row: line, message: 'effective_end must be a valid date in YYYY-MM-DD format' });
          }
        }
      }
      const notes = ((r['notes'] ?? '').toString().trim()) || null;
      const company_name = (r['company_name'] ?? '').toString().trim();
      const itemNumberRaw = (r['item_number'] ?? '').toString().trim();
      let item_number: number | null = null;
      if (itemNumberRaw !== '') {
        const parsedNumber = Number(itemNumberRaw.replace(/^CPX-?/i, ''));
        if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
          errors.push({ row: line, message: `item_number '${itemNumberRaw}' is invalid` });
        } else {
          item_number = parsedNumber;
        }
      }
      // A line is its item number, else its description (the existing-line match): a second row for it is refused, never merged.
      const lineKey = item_number != null ? `#${item_number}` : itemNumberRaw === '' && description ? `d:${description}` : null;
      if (lineKey) {
        const firstRow = rowByLine.get(lineKey);
        if (firstRow !== undefined) errors.push({ row: line, message: `Same line as row ${firstRow}` });
        else rowByLine.set(lineKey, line);
      }
      const ownerItEmail = (r['owner_it_email'] ?? '').toString().trim();
      const ownerBizEmail = (r['owner_business_email'] ?? '').toString().trim();
      const owner_it_id = await resolveOwner(ownerItEmail, 'Owner IT', line);
      const owner_business_id = await resolveOwner(ownerBizEmail, 'Owner business', line);
      const { cells: analytics, errors: analyticsErrors } = readCsvAnalyticsCells(analyticsColumns.columns, r);
      for (const message of analyticsErrors) errors.push({ row: line, message });
      const costCenterCode = hasCostCenter ? (r['cost_center_code'] ?? '').toString().trim() : '';
      let cost_center: CsvCostCenter | null = null;
      if (costCenterCode) {
        const resolved = resolveCsvCostCenter(costCentersByCode, costCenterCode);
        if (resolved.error) errors.push({ row: line, message: resolved.error });
        cost_center = resolved.node;
      }
      const run_build = hasRunBuild ? parseRunBuild(r['run_build']) : null;
      if (run_build === undefined) errors.push({ row: line, message: CSV_RUN_BUILD_ERROR });

      // Resolve company name to ID
      let paying_company_id: string | null = null;
      if (company_name) {
        paying_company_id = companiesByName.get(company_name.toLowerCase()) || null;
        if (!paying_company_id) {
          errors.push({ row: line, message: `Company '${company_name}' not found` });
        }
      }

      if (!description) errors.push({ row: line, message: 'description is required' });
      if (currency && currency.length !== 3) errors.push({ row: line, message: 'currency must be 3 letters' });
      if (allowedCurrencies.size > 0 && currency.length === 3 && !allowedCurrencies.has(currency)) {
        errors.push({ row: line, message: `currency '${currency}' is not allowed. allowedCurrencies=${Array.from(allowedCurrencies).join(',')}` });
      }
      if (!['hardware','software'].includes(ppe_type)) errors.push({ row: line, message: 'ppe_type must be hardware|software' });
      const invOk = ['replacement','capacity','productivity','security','conformity','business_growth','other'].includes(investment_type);
      if (!invOk) errors.push({ row: line, message: 'investment_type invalid' });
      if (!['mandatory','high','medium','low'].includes(priority)) errors.push({ row: line, message: 'priority invalid' });

      // An amount that is not a number is a row error.
      const amount = (column: string) => {
        try {
          return parseAmount((r[column] ?? '').toString());
        } catch {
          errors.push({ row: line, message: `${column} must be a number` });
          return undefined;
        }
      };
      const tMinus1 = { planned: amount('y_minus1_budget'), expected_landing: amount('y_minus1_landing') };
      const tY = {
        planned: amount('y_budget'),
        actual: amount('y_follow_up'),
        expected_landing: amount('y_landing'),
        committed: amount('y_revision'),
      };
      const tPlus1 = {
        planned: amount('y_plus1_budget'),
        committed: amount('y_plus1_revision'),
      };
      const tPlus2 = { planned: amount('y_plus2_budget') };
      const totals: any = {}; totals[Y - 1] = tMinus1; totals[Y] = tY; totals[Y + 1] = tPlus1; totals[Y + 2] = tPlus2;
      normalized.push({
        line,
        item_number,
        description,
        ppe_type,
        investment_type,
        priority,
        currency,
        effective_start,
        status,
        disabled_at,
        notes,
        paying_company_id,
        owner_it_id,
        owner_business_id,
        analytics,
        cost_center,
        run_build: run_build ?? null,
        totals,
      });
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };

    // Pass 1 refused any repeated line, so every row is its own line.
    const unique = normalized;

    // Existing items match by item_number when provided, else by description
    const findExisting = async (item: typeof normalized[number]): Promise<CapexItem | null> => {
      if (item.item_number != null) {
        return mg.getRepository(CapexItem).findOne({ where: { tenant_id: tenantId, item_number: item.item_number as any } });
      }
      return mg.getRepository(CapexItem).findOne({ where: { tenant_id: tenantId, description: item.description } });
    };

    let inserted = 0; let updated = 0;
    const existingByItem = new Map<typeof normalized[number], CapexItem | null>();
    for (const item of unique) existingByItem.set(item, await findExisting(item));
    // A disabled analytics value is accepted only as the line's current one.
    const currentAnalytics = await loadItemAnalyticsValues(mg, 'capex', tenantId, unique
      .filter((item) => csvAnalyticsNamesDisabled(item.analytics))
      .map((item) => existingByItem.get(item)?.id ?? ''));
    for (const item of unique) {
      const exists = existingByItem.get(item) ?? null;
      if (item.item_number != null && !exists) {
        errors.push({ row: item.line, message: `item_number '${item.item_number}' does not match any CAPEX item` });
        continue;
      }
      const disabledCostCenter = item.cost_center ? csvCostCenterDisabledError(item.cost_center, exists?.cost_center_id) : null;
      if (disabledCostCenter) errors.push({ row: item.line, message: disabledCostCenter });
      const disabledValues = csvAnalyticsDisabledErrors(item.analytics, exists ? currentAnalytics.get(exists.id) : undefined);
      for (const message of disabledValues) errors.push({ row: item.line, message });
      // A new line needs its paying company (or a cost center, whose company it takes) and its
      // currency (an update keeps the stored ones).
      const hasCompany = !!item.paying_company_id || !!item.cost_center;
      if (!exists && !hasCompany) {
        errors.push({ row: item.line, message: CSV_COMPANY_REQUIRED_ERROR });
      }
      if (!exists && !item.currency) {
        errors.push({ row: item.line, message: 'currency is required' });
      }
      if (disabledCostCenter || disabledValues.length > 0 || (!exists && (!hasCompany || !item.currency))) continue;
      if (exists) updated += 1; else inserted += 1;
    }
    // The file has no account column: a company change keeps the stored account, which must
    // then be in the new company's chart (the write refuses it otherwise, after a clean dry run).
    const movedLines = unique.flatMap((item) => {
      const exists = existingByItem.get(item);
      return exists?.account_id && item.paying_company_id && item.paying_company_id !== exists.paying_company_id
        ? [{ item, accountId: exists.account_id }]
        : [];
    });
    if (movedLines.length > 0) {
      const accounts: Array<{ id: string; account_number: number; coa_id: string | null }> = await mg.query(
        `SELECT id, account_number, coa_id FROM accounts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, Array.from(new Set(movedLines.map((moved) => moved.accountId)))],
      );
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const companyById = new Map(allCompanies.map((company) => [company.id, company]));
      for (const { item, accountId } of movedLines) {
        const account = accountById.get(accountId);
        const company = companyById.get(item.paying_company_id!);
        if (account?.coa_id && company?.coa_id && account.coa_id !== company.coa_id) {
          errors.push({
            row: item.line,
            message: `Account ${account.account_number} is not in ${company.name}'s chart of accounts. Change the line's account first.`,
          });
        }
      }
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };

    await lockCsvCostCenters(mg, tenantId, unique.map((item) => {
      const exists = existingByItem.get(item) ?? null;
      return item.cost_center && item.cost_center.id !== exists?.cost_center_id ? item.cost_center.id : null;
    }));

    let processed = 0;
    const checkedFreeze = new Set<string>();
    for (const item of unique) {
      const exists = await findExisting(item);
      // A value the dimension does not have yet is created in it (enabled, audited).
      const analyticsValues = await csvAnalyticsBodyValues(mg, tenantId, item.analytics, this.audit, userId);
      const payload = {
        description: item.description,
        ppe_type: item.ppe_type as any,
        investment_type: item.investment_type as any,
        priority: item.priority as any,
        ...(item.currency ? { currency: item.currency } : {}),
        ...(item.effective_start ? { effective_start: item.effective_start } : exists ? {} : { effective_start: `${Y}-01-01` }),
        ...csvItemLifecycle(item.status, item.disabled_at, !!exists),
        notes: item.notes ?? null,
        // A blank company keeps the stored one (a new line takes its cost center's).
        ...(item.paying_company_id ? { paying_company_id: item.paying_company_id } : {}),
        owner_it_id: item.owner_it_id,
        owner_business_id: item.owner_business_id,
        ...(analyticsValues ? { analytics_values: analyticsValues } : {}),
        ...(hasCostCenter ? { cost_center_id: item.cost_center?.id ?? null } : {}),
        ...(hasRunBuild ? { run_build: item.run_build } : {}),
      };
      const target = exists
        ? await this.update(exists.id, payload as any, userId ?? undefined, { manager: mg, statusEmail: false })
        : await this.create(payload as any, userId ?? undefined, { manager: mg });

      const years = [Y - 1, Y, Y + 1, Y + 2];
      for (const yr of years) {
        const totals = (item.totals as any)[yr] || {};
        const hasAny = Object.values(totals).some((v: any) => v != null && !isNaN(Number(v)));
        if (!hasAny) continue;
        let version = await mg.getRepository(CapexVersion).findOne({ where: { tenant_id: tenantId, capex_item_id: target.id, budget_year: yr as any } as any });
        if (!version) {
          const versionPartial: DeepPartial<CapexVersion> = {
            capex_item_id: target.id,
            budget_year: yr as any,
            version_name: `Auto ${yr}`,
            input_grain: 'annual' as any,
            is_approved: false,
            as_of_date: `${yr}-01-01`,
            tenant_id: target.tenant_id,
            allocation_method: 'default' as any,
          };
          version = mg.getRepository(CapexVersion).create(versionPartial);
          version = await mg.getRepository(CapexVersion).save(version);
          await this.audit.log({ table: 'capex_versions', recordId: version.id, action: 'create', before: null, after: version, userId }, { manager: mg });
        }
        await this.writeImportedTotals(mg, version, yr, totals, checkedFreeze, userId ?? null);
      }
      processed += 1;
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [] };
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
    const existing = await repo.findOne({ where: { id: linkId, capex_item_id: capexItemId, tenant_id: tenantId } as any });
    if (!existing) throw new NotFoundException('Link not found');
    const before = { ...existing } as any;
    (existing as any).description = (body?.description ?? null) as any;
    (existing as any).url = String(body?.url || '').trim();
    const saved = await repo.save(existing);
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
    const repo = mg.getRepository(PortfolioProjectCapex);
    const existing = await repo.find({ where: { tenant_id: tenantId, capex_id: itemId } as any });
    if (existing.length) await repo.delete({ tenant_id: tenantId, id: In(existing.map((x) => x.id)) } as any);
    if (cleanIds.length) {
      const rows = cleanIds.map((projId) => repo.create({ tenant_id: tenantId, project_id: projId, capex_id: itemId }));
      await repo.save(rows);
    }
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
