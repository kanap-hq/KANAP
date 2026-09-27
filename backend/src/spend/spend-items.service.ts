import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { Account } from '../accounts/account.entity';
import { Company } from '../companies/company.entity';
import { SpendVersion } from './spend-version.entity';
import { AnalyticsCategory } from '../analytics/analytics-category.entity';
import { User } from '../users/user.entity';
import { parsePagination, buildWhereFromAgFilters } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { spreadAnnualToMonths } from './spread.util';
import { AllocationCalculatorService } from './allocation-calculator.service';
import {
  applyAgFiltersInMemory,
  buildSpendSummaryRows,
  getSpendSummaryFieldValue,
  quickSearchSummaryRows,
  sortSummaryRows,
} from './spend-summary.builder';
import { SpendItemsCsvService } from './spend-items-csv.service';
import { SpendBudgetOperationsService } from './spend-budget-operations.service';
import { formatAllocationMethodLabel } from './allocation-utils';
import { FxRateService } from '../currency/fx-rate.service';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { applyDisabledAtWhere, LifecycleScope, summaryScope, resolveEndOfValidityAlias, resolveLifecycleState, StatusState } from '../common/status';
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
import { PortfolioProjectOpex } from '../portfolio/portfolio-project-opex.entity';
import { PortfolioProject } from '../portfolio/portfolio-project.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import { ItemNumberService } from '../common/item-number.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';

@Injectable()
export class SpendItemsService {
  constructor(
    @InjectRepository(SpendItem) private readonly repo: Repository<SpendItem>,
    @InjectRepository(AnalyticsCategory) private readonly analyticsCategories: Repository<AnalyticsCategory>,
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
    const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    // Only allow filtering/sorting by real columns on SpendItem
    const allowedFields = [
      'id', 'item_number', 'product_name', 'description', 'supplier_id', 'account_id', 'currency', 'effective_start', 'disabled_at',
      'status', 'owner_it_id', 'owner_business_id', 'analytics_category_id', 'project_id', 'contract_id', 'created_at', 'updated_at',
    ];
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply, allowedFields));
    }
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = status ?? statusFromAg ?? StatusState.ENABLED;
    const scope: LifecycleScope = includeDisabled ? null : lifecycleStatus === StatusState.DISABLED ? 'inactive' : 'active';
    applyDisabledAtWhere(where, scope, filtersToApply);
    if (q) where.product_name = ILike(`%${q}%`);
    const safeSortField = allowedFields.includes(sort.field) ? sort.field : 'created_at';
    const [itemsRaw, total] = await repo.findAndCount({ where, order: { [safeSortField]: sort.direction as any }, skip, take: limit });
    const categoryRepo = opts?.manager ? opts.manager.getRepository(AnalyticsCategory) : this.analyticsCategories;
    const categoryIds = Array.from(new Set(itemsRaw.map((i) => (i as any).analytics_category_id).filter(Boolean)));
    const categories = categoryIds.length ? await categoryRepo.find({ where: { id: In(categoryIds) as any } as any }) : [];
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const items = itemsRaw.map((item) => ({
      ...item,
      analytics_category_name: ((item as any).analytics_category_id && categoryById.get((item as any).analytics_category_id))
        ? categoryById.get((item as any).analytics_category_id)!.name
        : null,
    }));
    return { items, total, page, limit };
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendItem);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Spend item not found');
    return found;
  }

  /** Per-year budget/revision/actual/landing totals for one item (multi-year trend chart). */
  async yearlyTotals(spendItemId: string, from: number, to: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const lo = Math.min(from, to);
    // Clamp the span (defensive against an unbounded ?from&to driving a huge fill loop).
    const hi = Math.min(Math.max(from, to), lo + 20);
    const rows: Array<{ year: number; budget: string; revision: string; actual: string; landing: string }> = await mg.query(
      // Only count amount rows whose period falls within the version's budget_year,
      // matching aggregateAmountsByVersionIds so the chart agrees with the Budget tab / list.
      `SELECT v.budget_year AS year,
              COALESCE(SUM(a.planned), 0) AS budget,
              COALESCE(SUM(a.committed), 0) AS revision,
              COALESCE(SUM(a.actual), 0) AS actual,
              COALESCE(SUM(a.expected_landing), 0) AS landing
       FROM spend_versions v
       LEFT JOIN spend_amounts a ON a.version_id = v.id AND EXTRACT(YEAR FROM a.period) = v.budget_year
       WHERE v.spend_item_id = $1 AND v.budget_year BETWEEN $2 AND $3
       GROUP BY v.budget_year
       ORDER BY v.budget_year`,
      [spendItemId, lo, hi],
    );
    const byYear = new Map(rows.map((r) => [Number(r.year), r]));
    const years: Array<{ year: number; budget: number; revision: number; actual: number; landing: number }> = [];
    for (let y = lo; y <= hi; y += 1) {
      const r = byYear.get(y);
      years.push({
        year: y,
        budget: Number(r?.budget) || 0,
        revision: Number(r?.revision) || 0,
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
    const item = await mg.getRepository(SpendItem).findOne({ where: { id }, select: ['id', 'product_name'] });
    if (!item) throw new NotFoundException('Spend item not found');

    const senderRows = await mg.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    const senderName = senderRows.length > 0
      ? `${senderRows[0].first_name} ${senderRows[0].last_name}`.trim() || 'Someone'
      : 'Someone';

    const recipientRows = userIds.length > 0
      ? await mg.query(
          `SELECT u.id AS "userId", u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.locale
           FROM users u
           JOIN roles ro ON ro.id = u.role_id
           WHERE u.id = ANY($1) AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [userIds],
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

  async listApplications(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const spend = await this.get(spendItemId, { manager: mg });
    const rows = await mg.query(
      `SELECT l.application_id as id, a.name
       FROM application_spend_items l
       JOIN applications a ON a.id = l.application_id
       WHERE l.spend_item_id = $1
       ORDER BY a.name ASC`,
      [spendItemId],
    );
    return { items: rows };
  }

  async bulkReplaceApplications(spendItemId: string, applicationIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const spend = await this.get(spendItemId, { manager: mg });
    const cleanIds = Array.from(new Set((applicationIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (cleanIds.length) {
      const apps = await mg.getRepository(Application).find({ where: { id: In(cleanIds) } as any });
      if (apps.length !== cleanIds.length) throw new BadRequestException('One or more applications not found');
      const invalid = apps.find((a) => (a as any).tenant_id !== (spend as any).tenant_id);
      if (invalid) throw new BadRequestException('Application does not belong to tenant');
    }
    const repo = mg.getRepository(ApplicationSpendItemLink);
    const existing = await repo.find({ where: { spend_item_id: spendItemId } as any });
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    if (cleanIds.length) {
      const rows = cleanIds.map((appId) => repo.create({ tenant_id: (spend as any).tenant_id, application_id: appId, spend_item_id: spendItemId }));
      await repo.save(rows);
    }
    return this.listApplications(spendItemId, { manager: mg });
  }

  async create(body: SpendItemUpsertDto, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendItem);
    const { status: statusInput, disabled_at: disabledAtInput, effective_end: effectiveEnd, ...rest } = body ?? {};
    const disabled_at = this.endOfValidityInput(disabledAtInput, effectiveEnd);
    // Require paying company (soft requirement -> throw clear error)
    if (!rest.paying_company_id) {
      throw new BadRequestException('paying_company_id is required');
    }
    // Validate account against paying company CoA when both provided
    if (rest.account_id) {
      const [account, company] = await Promise.all([
        mg.getRepository(Account).findOne({ where: { id: rest.account_id } }),
        mg.getRepository(Company).findOne({ where: { id: rest.paying_company_id as string } }),
      ]);
      if (!account) throw new BadRequestException('Account not found');
      if (!company) throw new BadRequestException('Paying company not found');
      if (account.coa_id && company.coa_id && account.coa_id !== company.coa_id) {
        throw new BadRequestException('Selected account does not belong to the paying company\'s Chart of Accounts');
      }
    }
    const lifecycle = resolveLifecycleState({ nextStatus: statusInput, nextDisabledAt: disabled_at });
    const tenantId = await this.resolveTenantId(mg);
    const item_number = await this.itemNumbers.nextItemNumber('spend', tenantId, mg);
    const entity = repo.create({
      ...rest,
      // These columns are NOT NULL on the entity while the DTO allows null
      product_name: rest.product_name ?? undefined,
      currency: rest.currency ?? undefined,
      effective_start: rest.effective_start ?? undefined,
      item_number,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);
    await this.audit.log({ table: 'spend_items', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
  }

  async update(id: string, body: SpendItemUpsertDto, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendItem);
    const existing = await this.get(id, { manager: mg });
    const before = { ...existing };
    const { status: statusInput, disabled_at: disabledAtInput, effective_end: effectiveEnd, ...rest } = body ?? {};
    const disabled_at = this.endOfValidityInput(disabledAtInput, effectiveEnd);
    Object.assign(existing, rest);
    // Require paying company on update if missing on record and not provided in body
    const payingCompanyId = (rest.paying_company_id ?? (existing as any).paying_company_id) as string | null;
    if (!payingCompanyId) {
      throw new BadRequestException('paying_company_id is required');
    }
    // Validate account against paying company CoA when both present
    const accountId = (rest.account_id ?? (existing as any).account_id) as string | null;
    if (accountId) {
      const [account, company] = await Promise.all([
        mg.getRepository(Account).findOne({ where: { id: accountId } }),
        mg.getRepository(Company).findOne({ where: { id: payingCompanyId } }),
      ]);
      if (!account) throw new BadRequestException('Account not found');
      if (!company) throw new BadRequestException('Paying company not found');
      if (account.coa_id && company.coa_id && account.coa_id !== company.coa_id) {
        throw new BadRequestException('Selected account does not belong to the paying company\'s Chart of Accounts');
      }
    }
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: before.disabled_at,
      nextStatus: statusInput,
      nextDisabledAt: disabled_at,
    });
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;

    // Detect supplier change for contact sync
    const oldSupplierId = before.supplier_id;
    const newSupplierId = existing.supplier_id;

    const saved = await repo.save(existing);
    await this.audit.log({ table: 'spend_items', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager: mg });

    // Sync contacts from supplier if supplier changed
    if (oldSupplierId !== newSupplierId) {
      await this.itemContacts.syncFromSupplier(id, newSupplierId, { manager: mg });
    }

    // Notify owners on status change
    if (before.status !== saved.status) {
      const tenantId = (saved as any).tenant_id;
      const recipients: Array<{ userId: string; email: string; locale?: string | null }> = [];
      if (saved.owner_it_id) {
        const user = await mg.query('SELECT id, email, locale FROM users WHERE id = $1 AND status = \'enabled\'', [saved.owner_it_id]);
        if (user.length > 0) recipients.push({ userId: user[0].id, email: user[0].email, locale: user[0].locale });
      }
      if (saved.owner_business_id) {
        const user = await mg.query('SELECT id, email, locale FROM users WHERE id = $1 AND status = \'enabled\'', [saved.owner_business_id]);
        if (user.length > 0) recipients.push({ userId: user[0].id, email: user[0].email, locale: user[0].locale });
      }
      if (recipients.length > 0) {
        this.notifications.notifyStatusChange({
          itemType: 'opex',
          itemId: saved.id,
          itemName: saved.product_name,
          oldStatus: before.status,
          newStatus: saved.status,
          recipients,
          tenantId,
          excludeUserId: userId,
          manager: mg,
        });
      }
    }

    return saved;
  }

  // OPEX summary endpoint: derived fields and version totals for Y-1, Y, Y+1
  async summary(query: any, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const now = new Date();
    const Y = now.getFullYear();
    const yearsParam = query.years as string | undefined;
    const years = yearsParam
      ? yearsParam.split(',').map((y: string) => parseInt(y.trim(), 10)).filter((y) => !isNaN(y))
      : [Y - 1, Y, Y + 1];

    const { page, limit, skip, sort, status, q, filters } = parsePagination(query);
    const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const allowedDbFields = [
      'id', 'item_number', 'product_name', 'description', 'supplier_id', 'account_id', 'currency', 'effective_start', 'disabled_at',
      'status', 'owner_it_id', 'owner_business_id', 'analytics_category_id', 'project_id', 'contract_id', 'created_at', 'updated_at',
    ];
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply, allowedDbFields));
    }
    const lifecycleStatus = status ?? statusFromAg ?? null;
    const minYear = Math.min(...years);
    const periodStart = new Date(`${String(minYear).padStart(4, '0')}-01-01T00:00:00.000Z`);
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    applyDisabledAtWhere(where, summaryScope(includeDisabled, lifecycleStatus, periodStart), filtersToApply);

    const filterKeys = Object.keys((filtersToApply as any) || {});
    const hasDerivedFilters = filterKeys.some((k) => !allowedDbFields.includes(k));
    const dbSortable = allowedDbFields.includes(sort.field) && !q && !hasDerivedFilters;

    let items: SpendItem[] = [];
    let total = 0;
    if (dbSortable) {
      const [baseItems, count] = await mg.getRepository(SpendItem).findAndCount({
        where,
        order: { [sort.field]: sort.direction as any },
        skip,
        take: limit,
      });
      items = baseItems as SpendItem[];
      total = count;
    } else {
      const baseItems = await mg.getRepository(SpendItem).find({ where, order: { created_at: 'DESC' as any }, take: 10000 });
      items = baseItems as SpendItem[];
      total = items.length;
      if (items.length === 0) return { items: [], total, page, limit };
    }

    if (items.length === 0) return { items: [], total, page, limit };

    const tenantId = items[0] ? (items[0] as any).tenant_id ?? null : null;
    const { rows } = await buildSpendSummaryRows({
      manager: mg,
      items,
      years,
      currentYear: Y,
      allocationCalculator: this.allocationCalculator,
      formatAllocationMethodLabel,
      includeRecipientDetails: true,
      includeLatestTask: true,
      fxRates: this.fxRates,
      tenantId,
    });

    let data = rows;

    if (hasDerivedFilters) {
      data = applyAgFiltersInMemory(data, filtersToApply);
    }

    if (q) {
      data = quickSearchSummaryRows(data, q);
    }

    if (!dbSortable) {
      sortSummaryRows(data, sort.field, sort.direction as 'ASC' | 'DESC');
      const paged = data.slice(skip, skip + limit);
      const effectiveTotal = (q || hasDerivedFilters) ? data.length : total;
      return { items: paged, total: effectiveTotal, page, limit };
    }

    return { items: data, total: q ? data.length : total, page, limit };
  }

  async summaryFilterValues(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    const mg = opts?.manager ?? this.repo.manager;
    const rawFields: string[] = typeof query.fields === 'string'
      ? query.fields.split(',').map((f: string) => f.trim()).filter(Boolean)
      : [];
    const allowedFields = new Set([
      'supplier_name',
      'paying_company_name',
      'account_display',
      'allocation_label',
      'allocation_method_label',
      'contract_name',
      'currency',
      'owner_it_name',
      'owner_business_name',
      'analytics_category_name',
      'project_stream_name',
      'project_category_name',
    ]);
    const fields = rawFields.filter((field) => allowedFields.has(field));
    if (fields.length === 0) return {};

    const now = new Date();
    const Y = now.getFullYear();
    const yearsParam = query.years as string | undefined;
    const years = yearsParam
      ? yearsParam.split(',').map((y: string) => parseInt(y.trim(), 10)).filter((y) => !isNaN(y))
      : [Y - 1, Y, Y + 1];
    const { status, q, filters } = parsePagination(query);
    const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters ?? {};
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = status ?? statusFromAg ?? null;
    const minYear = Math.min(...years);
    const periodStart = new Date(`${String(minYear).padStart(4, '0')}-01-01T00:00:00.000Z`);
    const allowedDbFields = [
      'id', 'item_number', 'product_name', 'description', 'supplier_id', 'account_id', 'currency', 'effective_start', 'disabled_at',
      'status', 'owner_it_id', 'owner_business_id', 'analytics_category_id', 'project_id', 'contract_id', 'created_at', 'updated_at',
    ];

    const loadRows = async (fieldFilters: any) => {
      const where: any = {};
      if (fieldFilters && Object.keys(fieldFilters).length > 0) {
        Object.assign(where, buildWhereFromAgFilters(fieldFilters, allowedDbFields));
      }
      applyDisabledAtWhere(where, summaryScope(includeDisabled, lifecycleStatus, periodStart), fieldFilters);
      const items = await mg.getRepository(SpendItem).find({
        where,
        order: { created_at: 'DESC' as any },
        take: 10000,
      });
      if (items.length === 0) return [];
      const tenantId = (items[0] as any)?.tenant_id ?? null;
      const { rows } = await buildSpendSummaryRows({
        manager: mg,
        items,
        years,
        currentYear: Y,
        allocationCalculator: this.allocationCalculator,
        formatAllocationMethodLabel,
        includeRecipientDetails: false,
        includeLatestTask: false,
        fxRates: this.fxRates,
        tenantId,
      });
      let data = rows;
      const derivedFilters = Object.fromEntries(
        Object.entries(fieldFilters || {}).filter(([key]) => !allowedDbFields.includes(key)),
      );
      if (Object.keys(derivedFilters).length > 0) {
        data = applyAgFiltersInMemory(data, derivedFilters);
      }
      if (q) {
        data = quickSearchSummaryRows(data, q);
      }
      return data;
    };

    const results: Record<string, Array<string | null>> = {};
    for (const field of fields) {
      const fieldFilters = { ...(filtersToApply || {}) };
      delete fieldFilters[field];
      const rows = await loadRows(fieldFilters);
      const values = new Set<string | null>();
      rows.forEach((row) => {
        let value: any = getSpendSummaryFieldValue(row, field);
        if (value == null || value === '') {
          value = null;
        } else if (typeof value !== 'string') {
          value = String(value);
        }
        values.add(value);
      });
      const ordered = Array.from(values);
      ordered.sort((a, b) => {
        if (a == null) return 1;
        if (b == null) return -1;
        return String(a).localeCompare(String(b));
      });
      results[field] = ordered;
    }

    return results;
  }

  // Return ordered list of matching item IDs for navigation, reflecting sort/filter/q
  async summaryIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
    const mg = opts?.manager ?? this.repo.manager;
    const now = new Date();
    const Y = now.getFullYear();
    const years = [Y - 2, Y - 1, Y, Y + 1, Y + 2];

    const { sort, status, q, filters } = parsePagination(query);
    const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const allowedDbFields = [
      'id', 'item_number', 'product_name', 'description', 'supplier_id', 'account_id', 'currency', 'effective_start', 'disabled_at',
      'status', 'owner_it_id', 'owner_business_id', 'analytics_category_id', 'project_id', 'contract_id', 'created_at', 'updated_at',
    ];
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply, allowedDbFields));
    }
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = status ?? statusFromAg ?? StatusState.ENABLED;
    const scope: LifecycleScope = includeDisabled ? null : lifecycleStatus === StatusState.DISABLED ? 'inactive' : 'active';
    applyDisabledAtWhere(where, scope, filtersToApply);

    const filterKeys = Object.keys((filtersToApply as any) || {});
    const hasDerivedFilters = filterKeys.some((k) => !allowedDbFields.includes(k));
    const dbSortable = allowedDbFields.includes(sort.field) && !q && !hasDerivedFilters;

    if (dbSortable) {
      const items = await mg.getRepository(SpendItem).find({ where, order: { [sort.field]: sort.direction as any } });
      const ids = items.map((i) => i.id);
      const item_numbers = items.map((i) => (i as any).item_number);
      return { ids, item_numbers, total: ids.length };
    }

    const baseItems = await mg.getRepository(SpendItem).find({ where, order: { created_at: 'DESC' as any } });
    if (baseItems.length === 0) return { ids: [], item_numbers: [], total: 0 };

    const tenantId = baseItems[0] ? (baseItems[0] as any).tenant_id ?? null : null;
    const { rows } = await buildSpendSummaryRows({
      manager: mg,
      items: baseItems,
      years,
      currentYear: Y,
      allocationCalculator: this.allocationCalculator,
      formatAllocationMethodLabel,
      includeRecipientDetails: false,
      includeLatestTask: false,
      fxRates: this.fxRates,
      tenantId,
    });

    let data = rows;
    if (q) {
      data = quickSearchSummaryRows(data, q);
    }
    if (hasDerivedFilters) {
      data = applyAgFiltersInMemory(data, filtersToApply);
    }

    sortSummaryRows(data, sort.field, sort.direction as 'ASC' | 'DESC');

    const ids = data.map((r) => r.id);
    const item_numbers = data.map((r) => (r as any).item_number);
    return { ids, item_numbers, total: ids.length };
  }

  async summaryRowsByIds(
    itemIds: string[],
    query?: {
      years?: number[];
      includeRecipientDetails?: boolean;
      includeLatestTask?: boolean;
    },
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    if (!itemIds.length) return [];

    const now = new Date();
    const Y = now.getFullYear();
    const years = query?.years?.length
      ? Array.from(new Set(query.years))
      : [Y - 2, Y - 1, Y, Y + 1, Y + 2];

    const items = await mg.getRepository(SpendItem).find({
      where: { id: In(itemIds) as any } as any,
      order: { created_at: 'DESC' as any },
    });
    if (items.length === 0) return [];

    const tenantId = (items[0] as any)?.tenant_id ?? null;
    const { rows } = await buildSpendSummaryRows({
      manager: mg,
      items,
      years,
      currentYear: Y,
      allocationCalculator: this.allocationCalculator,
      formatAllocationMethodLabel,
      includeRecipientDetails: query?.includeRecipientDetails ?? false,
      includeLatestTask: query?.includeLatestTask ?? false,
      fxRates: this.fxRates,
      tenantId,
    });

    const rowById = new Map(rows.map((row) => [row.id, row]));
    return itemIds.map((id) => rowById.get(id)).filter((row): row is NonNullable<typeof row> => !!row);
  }


  /**
   * Optimized aggregation of spend amounts by version using SQL GROUP BY.
   * This is 90%+ faster than loading all individual amounts and aggregating in JavaScript.
   */
  private async aggregateAmountsByVersionIds(
    versionIds: string[],
    mg: EntityManager,
  ): Promise<Map<string, { planned: number; actual: number; expected_landing: number; committed: number }>> {
    if (!versionIds || versionIds.length === 0) {
      return new Map();
    }

    // Aggregate amounts by version_id in a single SQL query
    // Filter by year to only sum amounts within the version's budget year
    const results: Array<{
      version_id: string;
      planned: string;
      actual: string;
      expected_landing: string;
      committed: string;
    }> = await mg.query(
      `
      SELECT
        sa.version_id,
        COALESCE(SUM(sa.planned), 0) as planned,
        COALESCE(SUM(sa.actual), 0) as actual,
        COALESCE(SUM(sa.expected_landing), 0) as expected_landing,
        COALESCE(SUM(sa.committed), 0) as committed
      FROM spend_amounts sa
      JOIN spend_versions sv ON sa.version_id = sv.id
      WHERE sa.version_id = ANY($1::uuid[])
        AND EXTRACT(YEAR FROM sa.period) = sv.budget_year
      GROUP BY sa.version_id
      `,
      [versionIds],
    );

    // Convert to Map for O(1) lookup
    const totalsMap = new Map<string, { planned: number; actual: number; expected_landing: number; committed: number }>();
    for (const row of results) {
      totalsMap.set(row.version_id, {
        planned: parseFloat(row.planned),
        actual: parseFloat(row.actual),
        expected_landing: parseFloat(row.expected_landing),
        committed: parseFloat(row.committed),
      });
    }

    return totalsMap;
  }

  async summaryTotals(query: any, opts?: { manager?: EntityManager }): Promise<any> {
    const mg = opts?.manager ?? this.repo.manager;
    const now = new Date();
    const Y = now.getFullYear();
    const years = [Y - 1, Y, Y + 1, Y + 2];

    const { ids: itemIds } = await this.summaryIds(query, { manager: mg });
    const defaultSummary = {
      yMinus1Budget: 0, yMinus1Landing: 0,
      yBudget: 0, yRevision: 0, yFollowUp: 0, yLanding: 0,
      yPlus1Budget: 0, yPlus1Revision: 0,
      yPlus2Budget: 0,
      reportingCurrency: 'EUR',
    };

    if (!itemIds || itemIds.length === 0) {
      return {
        ...defaultSummary,
      };
    }

    // Load items (needed for currency info and disabled_at logic)
    const items = await mg.getRepository(SpendItem).find({ where: { id: In(itemIds) as any } as any });
    if (!items.length) {
      return { ...defaultSummary };
    }

    const tenantId = (items[0] as any).tenant_id ?? null;
    const { settings } = tenantId
      ? await this.fxRates.resolveRates(tenantId, [], { manager: mg })
      : { settings: { reportingCurrency: 'EUR' } as any };

    // Load versions for the filtered items
    const versions = await mg.getRepository(SpendVersion).find({
      where: { spend_item_id: In(itemIds) as any, budget_year: In(years) as any } as any,
    });

    if (!versions.length) {
      return { ...defaultSummary, reportingCurrency: settings.reportingCurrency ?? 'EUR' };
    }

    // OPTIMIZATION: Aggregate amounts by version_id using SQL (90%+ faster)
    const versionIds = versions.map((v) => v.id);
    const versionTotalsById = await this.aggregateAmountsByVersionIds(versionIds, mg);

    // Build lookup maps
    const itemById = new Map(items.map((it) => [it.id, it]));
    const versionsById = new Map(versions.map((v) => [v.id, v]));

    // Prepare FX lookup keys for each version
    const lookupKeys: any[] = [];
    for (const version of versions) {
      const item = itemById.get((version as any).spend_item_id);
      if (!item) continue;
      const sourceCurrency = (item as any).currency || 'EUR';
      lookupKeys.push({
        key: '',
        rateSetId: (version as any).fx_rate_set_id ?? null,
        fiscalYear: (version as any).budget_year as number,
        sourceCurrency,
      });
    }

    // Resolve FX rates for all versions
    const fxResult = tenantId
      ? await this.fxRates.resolveRates(tenantId, lookupKeys, { manager: mg })
      : { map: new Map<string, any>(), settings: { reportingCurrency: 'EUR' } as any };
    const fxMap = fxResult.map;

    // Convert each version's totals to reporting currency
    const versionReportingTotalsById = new Map<
      string,
      { planned: number; actual: number; expected_landing: number; committed: number }
    >();

    for (const version of versions) {
      const totals = versionTotalsById.get(version.id);
      if (!totals) {
        // Version has no amounts - set to zero
        versionReportingTotalsById.set(version.id, { planned: 0, actual: 0, expected_landing: 0, committed: 0 });
        continue;
      }

      const item = itemById.get((version as any).spend_item_id);
      const currency = ((item as any)?.currency || 'EUR').toString().toUpperCase();
      const fxRateSetId = (version as any).fx_rate_set_id ?? null;
      const budgetYear = (version as any).budget_year as number;
      const key = `${fxRateSetId || 'live'}:${budgetYear}:${currency}`;
      const fx = fxMap.get(key) || {
        rate: currency === settings.reportingCurrency ? 1 : 1,
        reportingCurrency: settings.reportingCurrency,
        source: 'identity',
        capturedAt: null,
      };

      // Apply FX conversion to the aggregated totals
      versionReportingTotalsById.set(version.id, {
        planned: this.fxRates.convertValue(totals.planned, fx.rate),
        actual: this.fxRates.convertValue(totals.actual, fx.rate),
        expected_landing: this.fxRates.convertValue(totals.expected_landing, fx.rate),
        committed: this.fxRates.convertValue(totals.committed, fx.rate),
      });
    }

    // Build versionsByItemYear map for efficient lookup
    const versionsByItemYear = new Map<string, Map<number, SpendVersion>>();
    for (const version of versions) {
      const itemId = (version as any).spend_item_id as string;
      const budgetYear = (version as any).budget_year as number;
      let perItem = versionsByItemYear.get(itemId);
      if (!perItem) {
        perItem = new Map<number, SpendVersion>();
        versionsByItemYear.set(itemId, perItem);
      }
      perItem.set(budgetYear, version);
    }

    // Sum up totals across all items, respecting disabled_at logic
    const zeroTotals = { planned: 0, actual: 0, expected_landing: 0, committed: 0 };
    const totals = {
      yMinus1Budget: 0,
      yMinus1Landing: 0,
      yBudget: 0,
      yRevision: 0,
      yFollowUp: 0,
      yLanding: 0,
      yPlus1Budget: 0,
      yPlus1Revision: 0,
      yPlus2Budget: 0,
    };

    const getTotals = (versionId?: string | null) => {
      if (!versionId) return zeroTotals;
      const totals = versionReportingTotalsById.get(versionId);
      if (!totals) return zeroTotals;
      return {
        planned: totals.planned,
        actual: totals.actual,
        expected_landing: totals.expected_landing,
        committed: totals.committed,
      };
    };

    for (const itemId of itemIds) {
      const perYear = versionsByItemYear.get(itemId) || new Map<number, SpendVersion>();
      const item = items.find((it) => it.id === itemId);
      const disabledYear = item && (item as any).disabled_at ? new Date((item as any).disabled_at).getFullYear() : null;
      const vMinus1Raw = perYear.get(Y - 1);
      const vCurrRaw = perYear.get(Y);
      const vPlus1Raw = perYear.get(Y + 1);
      const vPlus2Raw = perYear.get(Y + 2);
      const vMinus1 = disabledYear != null && (Y - 1) > disabledYear ? undefined : vMinus1Raw;
      const vCurr = disabledYear != null && Y > disabledYear ? undefined : vCurrRaw;
      const vPlus1 = disabledYear != null && (Y + 1) > disabledYear ? undefined : vPlus1Raw;
      const vPlus2 = disabledYear != null && (Y + 2) > disabledYear ? undefined : vPlus2Raw;

      const minus1 = getTotals(vMinus1?.id);
      const current = getTotals(vCurr?.id);
      const plus1 = getTotals(vPlus1?.id);
      const plus2 = getTotals(vPlus2?.id);

      totals.yMinus1Budget += minus1.planned;
      totals.yMinus1Landing += minus1.expected_landing;
      totals.yBudget += current.planned;
      totals.yRevision += current.committed;
      totals.yFollowUp += current.actual;
      totals.yLanding += current.expected_landing;
      totals.yPlus1Budget += plus1.planned;
      totals.yPlus1Revision += plus1.committed;
      totals.yPlus2Budget += plus2.planned;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      yMinus1Budget: round2(totals.yMinus1Budget),
      yMinus1Landing: round2(totals.yMinus1Landing),
      yBudget: round2(totals.yBudget),
      yRevision: round2(totals.yRevision),
      yFollowUp: round2(totals.yFollowUp),
      yLanding: round2(totals.yLanding),
      yPlus1Budget: round2(totals.yPlus1Budget),
      yPlus1Revision: round2(totals.yPlus1Revision),
      yPlus2Budget: round2(totals.yPlus2Budget),
      reportingCurrency: settings.reportingCurrency ?? 'EUR',
    };
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
      sourceColumn: 'budget' | 'revision' | 'follow_up' | 'landing';
      destinationYear: number;
      destinationColumn: 'budget' | 'revision' | 'follow_up' | 'landing';
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
      column: 'budget' | 'revision' | 'follow_up' | 'landing';
    },
    userId: string | null,
    opts?: { manager?: EntityManager }
  ) {
    return this.budgetOps.clearBudgetColumn(operation, userId, { manager: opts?.manager ?? this.repo.manager });
  }

  private pickYearSlot(row: any, year: number) {
    const now = new Date();
    const Y = now.getFullYear();
    if (year === Y - 1) return row.versions?.yMinus1;
    if (year === Y) return row.versions?.y;
    if (year === Y + 1) return row.versions?.yPlus1;
    // For years beyond the standard range, we'll need to query directly
    // This is handled in the main logic
    return null;
  }

  // Links (OPEX)
  async listLinks(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(SpendLink).find({ where: { spend_item_id: spendItemId } as any, order: { created_at: 'DESC' as any } });
  }
  async createLink(spendItemId: string, body: Partial<SpendLink>, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    if (!body.url) throw new BadRequestException('url is required');
    const entity = repo.create({ spend_item_id: spendItemId, url: body.url, description: body.description ?? null } as any);
    const saved = await repo.save(entity as any);
    await this.audit.log({ table: 'spend_links', recordId: (saved as any).id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved as any;
  }
  async updateLink(spendItemId: string, linkId: string, body: Partial<SpendLink>, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || (existing as any).spend_item_id !== spendItemId) throw new NotFoundException('Link not found');
    const before = { ...existing };
    const next = { ...existing, ...body } as any;
    const saved = await repo.save(next);
    await this.audit.log({ table: 'spend_links', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager: mg });
    return saved;
  }
  async deleteLink(spendItemId: string, linkId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || (existing as any).spend_item_id !== spendItemId) return { ok: true };
    await repo.delete({ id: linkId } as any);
    await this.audit.log({ table: 'spend_links', recordId: linkId, action: 'delete', before: existing, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // Attachments (OPEX)
  async listAttachments(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(SpendAttachment).find({ where: { spend_item_id: spendItemId } as any, order: { uploaded_at: 'DESC' as any } });
  }
  async uploadAttachment(spendItemId: string, file: Express.Multer.File, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    if (!file) throw new BadRequestException('No file uploaded');
    const [{ tenant_id }] = await mg.query(`SELECT app_current_tenant() AS tenant_id`);
    const id = randomUUID();
    const now = new Date();
    const decodedName = fixMulterFilename(file.originalname);
    const ext = path.extname(decodedName || '') || '';
    const rand = Math.random().toString(36).slice(2, 8);
    const key = [
      'files', tenant_id, 'opex', spendItemId,
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
      spend_item_id: spendItemId,
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
    const found = await repo.findOne({ where: { id: attachmentId } });
    if (!found) throw new NotFoundException('Attachment not found');
    return found;
  }
  async deleteAttachment(attachmentId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(SpendAttachment);
    const found = await repo.findOne({ where: { id: attachmentId } });
    if (!found) return { ok: true };
    await repo.delete({ id: attachmentId } as any);
    try { await this.storage.deleteObject((found as any).storage_path); } catch {}
    await this.audit.log({ table: 'spend_attachments', recordId: found.id, action: 'update', before: found, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // Projects
  async listProjects(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    await this.get(spendItemId, { manager: mg }); // ensure item exists
    const rows = await mg.query(
      `SELECT l.project_id as id, p.name
       FROM portfolio_project_opex l
       JOIN portfolio_projects p ON p.id = l.project_id
       WHERE l.opex_id = $1
       ORDER BY p.name ASC`,
      [spendItemId],
    );
    return { items: rows };
  }

  async bulkReplaceProjects(spendItemId: string, projectIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const spend = await this.get(spendItemId, { manager: mg });
    const cleanIds = Array.from(new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (cleanIds.length) {
      const projects = await mg.getRepository(PortfolioProject).find({ where: { id: In(cleanIds) } as any });
      if (projects.length !== cleanIds.length) throw new BadRequestException('One or more projects not found');
      const invalid = projects.find((p) => (p as any).tenant_id !== (spend as any).tenant_id);
      if (invalid) throw new BadRequestException('Project does not belong to tenant');
    }
    const repo = mg.getRepository(PortfolioProjectOpex);
    const existing = await repo.find({ where: { opex_id: spendItemId } as any });
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    if (cleanIds.length) {
      const rows = cleanIds.map((projId) => repo.create({ tenant_id: (spend as any).tenant_id, project_id: projId, opex_id: spendItemId }));
      await repo.save(rows);
    }
    return this.listProjects(spendItemId, { manager: mg });
  }
}
