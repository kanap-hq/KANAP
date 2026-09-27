import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { Account } from '../accounts/account.entity';
import { Company } from '../companies/company.entity';
import { AnalyticsCategory } from '../analytics/analytics-category.entity';
import { User } from '../users/user.entity';
import { parsePagination, buildWhereFromAgFilters } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { spreadAnnualToMonths } from './spread.util';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { SUMMARY_SCOPES, SummaryDeps } from './spend-summary.builder';
import * as budgetSummary from './budget-summary';
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
      // as the list engine sums them (loadVersionTotals), so the chart agrees with the Budget tab / list.
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

  /** Dependencies of the shared list engine (`budget-summary.ts`). */
  private summaryDeps(): SummaryDeps {
    return { allocationCalculator: this.allocationCalculator, fxRates: this.fxRates };
  }

  /** One page of the OPEX list; see `budget-summary.ts`. The AI query asks for the next year's allocation too. */
  async summary(query: any, opts?: { manager?: EntityManager; includeNextYearAllocation?: boolean }) {
    return budgetSummary.summary(SUMMARY_SCOPES.opex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager, {
      includeRecipientDetails: true,
      includeNextYearAllocation: opts?.includeNextYearAllocation ?? false,
    });
  }

  async summaryFilterValues(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    return budgetSummary.summaryFilterValues(SUMMARY_SCOPES.opex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager);
  }

  // Return ordered list of matching item IDs for navigation, reflecting sort/filter/q
  async summaryIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; item_numbers: number[]; total: number }> {
    return budgetSummary.summaryIds(SUMMARY_SCOPES.opex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager);
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
    return budgetSummary.summaryRowsByIds(SUMMARY_SCOPES.opex, this.summaryDeps(), { ...query, ids: itemIds }, opts?.manager ?? this.repo.manager);
  }

  async summaryTotals(query: any, opts?: { manager?: EntityManager }): Promise<any> {
    return budgetSummary.summaryTotals(SUMMARY_SCOPES.opex, this.summaryDeps(), query, opts?.manager ?? this.repo.manager);
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
