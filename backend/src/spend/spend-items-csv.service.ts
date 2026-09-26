import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { EntityManager, In, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { SpendVersion } from './spend-version.entity';
import { SpendAmount } from './spend-amount.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { Account } from '../accounts/account.entity';
import { Company } from '../companies/company.entity';
import { AnalyticsCategory } from '../analytics/analytics-category.entity';
import { User } from '../users/user.entity';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { addCents, formatCents, toCents } from '../common/amount';
import { AmountMeasure } from './amounts-write.util';
import { writeItemCsvTotals } from './round-inputs.util';
import { parseEndOfValidityInput, resolveLifecycleState, StatusState } from '../common/status';
import { SpendItemUpsertDto } from './dto/spend-item.dto';
import { ItemNumberService } from '../common/item-number.service';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';

// Accepted on import for one release, never exported: the end of validity used to be split in two dates.
const LEGACY_CSV_HEADERS = ['effective_end'];

@Injectable()
export class SpendItemsCsvService {
  constructor(
    @InjectRepository(SpendItem) private readonly spendItems: Repository<SpendItem>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    @InjectRepository(SpendAmount) private readonly amounts: Repository<SpendAmount>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(AnalyticsCategory) private readonly analyticsCategories: Repository<AnalyticsCategory>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly currencySettings: CurrencySettingsService,
    private readonly itemNumbers: ItemNumberService,
  ) {}

  private csvHeaders(): string[] {
    return [
      'product_name',
      'description',
      'supplier_name',
      'company_name',
      'account_number',
      'currency',
      'effective_start',
      'status',
      'disabled_at',
      'owner_it_email',
      'owner_business_email',
      'analytics_category',
      'notes',
      'y_minus1_budget',
      'y_minus1_landing',
      'y_budget',
      'y_follow_up',
      'y_landing',
      'y_revision',
      'y_plus1_budget',
      'y_plus1_revision',
    ];
  }

  async exportCsv(scope: 'template' | 'data' = 'data', opts?: { manager?: EntityManager }): Promise<{ filename: string; content: string }> {
    const mg = opts?.manager ?? this.spendItems.manager;
    const headers = this.csvHeaders();
    const delimiter = ';';
    const chunks: string[] = [];
    if (scope === 'template') {
      return { filename: 'opex_template.csv', content: '\ufeff' + headers.join(delimiter) + '\n' };
    }
    const now = new Date();
    const Y = now.getFullYear();
    const items = await mg.getRepository(SpendItem).find({ order: { created_at: 'DESC' as any } });
    const itemIds = items.map((i) => i.id);
    const years = [Y - 1, Y, Y + 1];
    const versions = await mg.getRepository(SpendVersion).find({ where: { spend_item_id: In(itemIds) as any, budget_year: In(years) as any } as any });
    const versionsByItemYear = new Map<string, Map<number, SpendVersion>>();
    const versionsById = new Map<string, SpendVersion>();
    for (const v of versions) {
      versionsById.set(v.id, v);
      let m = versionsByItemYear.get(v.spend_item_id);
      if (!m) { m = new Map<number, SpendVersion>(); versionsByItemYear.set(v.spend_item_id, m); }
      m.set((v as any).budget_year as number, v);
    }
    const versionIds = versions.map((v) => v.id);
    const allAmounts = versionIds.length ? await mg.getRepository(SpendAmount).find({ where: { version_id: In(versionIds) as any } as any }) : [];
    const zeroTotals = () => ({ planned: 0n, actual: 0n, expected_landing: 0n, committed: 0n });
    const sums: Record<string, ReturnType<typeof zeroTotals>> = {};
    for (const a of allAmounts) {
      const vid = (a as any).version_id as string;
      const acc = sums[vid] ?? (sums[vid] = zeroTotals());
      acc.planned = addCents(acc.planned, (a as any).planned);
      acc.actual = addCents(acc.actual, (a as any).actual);
      acc.expected_landing = addCents(acc.expected_landing, (a as any).expected_landing);
      acc.committed = addCents(acc.committed, (a as any).committed);
    }
    const supplierIds = Array.from(new Set(items.map((i) => (i as any).supplier_id).filter(Boolean)));
    const accountIds = Array.from(new Set(items.map((i) => (i as any).account_id).filter(Boolean)));
    const companyIds = Array.from(new Set(items.map((i) => (i as any).paying_company_id).filter(Boolean)));
    const suppliers = supplierIds.length ? await mg.getRepository(Supplier).find({ where: { id: In(supplierIds) as any } as any }) : [];
    const accounts = accountIds.length ? await mg.getRepository(Account).find({ where: { id: In(accountIds) as any } as any }) : [];
    const companies = companyIds.length ? await mg.getRepository(Company).find({ where: { id: In(companyIds) as any } as any }) : [];
    const categoryIds = Array.from(new Set(items.map((i) => (i as any).analytics_category_id).filter(Boolean)));
    const categories = categoryIds.length ? await mg.getRepository(AnalyticsCategory).find({ where: { id: In(categoryIds) as any } as any }) : [];
    const ownerIds = Array.from(new Set(items.flatMap((it: any) => [it.owner_it_id, it.owner_business_id]).filter(Boolean))) as string[];
    const owners = ownerIds.length ? await mg.getRepository(User).find({ where: { id: In(ownerIds) as any } as any }) : [];
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const ownerById = new Map(owners.map((u) => [u.id, u]));

    function getTotals(v?: SpendVersion) {
      if (!v) return { budget: '0', follow_up: '0', landing: '0', revision: '0' };
      const s = sums[v.id] ?? zeroTotals();
      return {
        budget: formatCents(s.planned),
        follow_up: formatCents(s.actual),
        landing: formatCents(s.expected_landing),
        revision: formatCents(s.committed),
      };
    }

    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      for (const it of items) {
        const perYear = versionsByItemYear.get(it.id) || new Map<number, SpendVersion>();
        const tMinus1 = getTotals(perYear.get(Y - 1));
        const tY = getTotals(perYear.get(Y));
        const tPlus1 = getTotals(perYear.get(Y + 1));
        const supplier = (it as any).supplier_id ? supplierById.get((it as any).supplier_id) : undefined;
        const company = (it as any).paying_company_id ? companyById.get((it as any).paying_company_id) : undefined;
        const account = (it as any).account_id ? accountById.get((it as any).account_id) : undefined;
        const analyticsCategoryId = (it as any).analytics_category_id as string | null;
        const analyticsCategory = analyticsCategoryId ? categoryById.get(analyticsCategoryId) : undefined;
        const ownerIt = (it as any).owner_it_id ? ownerById.get((it as any).owner_it_id) : undefined;
        const ownerBiz = (it as any).owner_business_id ? ownerById.get((it as any).owner_business_id) : undefined;

        stream.write({
          product_name: (it as any).product_name ?? '',
          description: (it as any).description ?? '',
          supplier_name: supplier ? (supplier as any).name : '',
          company_name: company ? (company as any).name : '',
          account_number: account ? (account as any).account_number : '',
          currency: (it as any).currency ?? '',
          effective_start: (it as any).effective_start ?? '',
          status: (it as any).status ?? 'enabled',
          disabled_at: (it as any).disabled_at ? new Date((it as any).disabled_at).toISOString() : '',
          owner_it_email: ownerIt ? (ownerIt as any).email ?? '' : '',
          owner_business_email: ownerBiz ? (ownerBiz as any).email ?? '' : '',
          analytics_category: analyticsCategory ? analyticsCategory.name : '',
          notes: (it as any).notes ?? '',
          y_minus1_budget: tMinus1.budget,
          y_minus1_landing: tMinus1.landing,
          y_budget: tY.budget,
          y_follow_up: tY.follow_up,
          y_landing: tY.landing,
          y_revision: tY.revision,
          y_plus1_budget: tPlus1.budget,
          y_plus1_revision: tPlus1.revision,
        });
      }
      stream.end();
    });
    return { filename: 'opex.csv', content: '\ufeff' + chunks.join('') };
  }

  async importCsv(
    { file, dryRun, userId }: { file: Express.Multer.File; dryRun: boolean; userId?: string | null },
    opts?: { manager?: EntityManager }
  ) {
    const mg = opts?.manager ?? this.spendItems.manager;
    // Determine current tenant and allowed currencies for validation
    const tRows = await mg.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const tenantId = Array.isArray(tRows) && tRows.length > 0 ? (tRows[0]?.tenant_id as string | null) : null;
    const settings = tenantId ? await this.currencySettings.getSettings(tenantId, { manager: mg }) : { allowedCurrencies: null } as any;
    const allowedSet = new Set((settings.allowedCurrencies ?? []).map((c: string) => String(c || '').trim().toUpperCase()).filter((c: string) => c.length === 3));
    if (!file) throw new Error('No file uploaded');
    const delimiter = ';';
    const expectedHeaders = this.csvHeaders();
    type Row = Record<string, string>;
    const rows: Row[] = [];
    const errors: { row: number; message: string }[] = [];
    let headerOk = false;
    await new Promise<void>((resolve, reject) => {
      const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
      if (!buf) { reject(new Error('Empty upload')); return; }
      let content: string;
      try {
        content = decodeCsvBufferUtf8OrThrow(buf as Buffer);
      } catch {
        reject(new Error('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.'));
        return;
      }
      parseString(content, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('headers', (headers: string[]) => {
          const missing = expectedHeaders.filter((h) => !headers.includes(h));
          const extras = headers.filter((h) => !expectedHeaders.includes(h) && !LEGACY_CSV_HEADERS.includes(h));
          headerOk = missing.length === 0 && extras.length === 0;
          if (!headerOk) errors.push({ row: 0, message: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` });
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Row) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });
    if (!headerOk) return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors, allowedCurrencies: Array.from(allowedSet) };

    const supplierCache = new Map<string, Supplier | null>();
    const findSupplier = async (name: string): Promise<Supplier | null> => {
      const key = name.toLowerCase();
      if (supplierCache.has(key)) return supplierCache.get(key) ?? null;
      const s = await mg.getRepository(Supplier).findOne({ where: { name } });
      supplierCache.set(key, s ?? null);
      return s ?? null;
    };
    const accountCache = new Map<string, Account | null>();
    const findAccount = async (accountNumber: string): Promise<Account | null> => {
      if (accountCache.has(accountNumber)) return accountCache.get(accountNumber) ?? null;
      const a = await mg.getRepository(Account).findOne({ where: { account_number: accountNumber } });
      accountCache.set(accountNumber, a ?? null);
      return a ?? null;
    };
    const categoryRepo = mg.getRepository(AnalyticsCategory);
    const categoryCache = new Map<string, AnalyticsCategory | null>();
    const ensureCategory = async (name: string | null, allowCreate: boolean): Promise<AnalyticsCategory | null> => {
      if (!name) return null;
      const key = name.toLowerCase();
      if (categoryCache.has(key)) return categoryCache.get(key) ?? null;
      let category = await categoryRepo.createQueryBuilder('cat').where('LOWER(cat.name) = LOWER(:name)', { name }).getOne();
      if (!category && allowCreate) {
        category = categoryRepo.create({ name, status: StatusState.ENABLED });
        category = await categoryRepo.save(category);
        await this.audit.log({ table: 'analytics_categories', recordId: category.id, action: 'create', before: null, after: category, userId }, { manager: mg });
      }
      categoryCache.set(key, category ?? null);
      return category ?? null;
    };
    const userRepo = mg.getRepository(User);
    const userCache = new Map<string, User | null>();
    const findUserByEmail = async (email: string | null): Promise<User | null> => {
      if (!email) return null;
      const key = email.toLowerCase();
      if (userCache.has(key)) return userCache.get(key) ?? null;
      const user = await userRepo.createQueryBuilder('u').where('LOWER(u.email) = LOWER(:email)', { email }).getOne();
      userCache.set(key, user ?? null);
      return user ?? null;
    };

    const allCompanies = await mg.getRepository(Company).find();
    const companiesByName = new Map(allCompanies.map(c => [c.name.toLowerCase(), c]));

    const now = new Date();
    const Y = now.getFullYear();
    const defaultStart = `${Y}-01-01`;
    const normalized: Array<{
      product_name: string;
      description: string | null;
      supplier_name: string | null;
      company_name: string | null;
      account_number: string | null;
      currency: string;
      effective_start: string;
      status: StatusState;
      disabled_at: string | null;
      notes: string | null;
      totals: { [year: number]: { planned?: number; actual?: number; expected_landing?: number; committed?: number } };
      analytics_category_name: string | null;
      owner_it_email: string | null;
      owner_business_email: string | null;
      rowNumber: number;
    }> = [];
    const parseAmount = (raw: string): number | undefined => {
      let s = (raw || '').trim();
      if (s === '') return undefined;
      s = s.replace(/\s+/g, '');
      const hasComma = s.includes(',');
      const hasDot = s.includes('.');
      if (hasComma && hasDot) {
        s = s.replace(/\./g, '');
        s = s.replace(/,/g, '.');
      } else if (hasComma && !hasDot) {
        s = s.replace(/,/g, '.');
      }
      s = s.replace(/[^0-9.-]/g, '');
      if (s === '' || s === '-' || s === '.' || s === '-.') return undefined;
      const cents = toCents(s);
      return Number(formatCents(cents));
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2;
      const product_name = (r['product_name'] ?? '').toString().trim();
      const supplier_name = ((r['supplier_name'] ?? '').toString().trim()) || null;
      const company_name = ((r['company_name'] ?? '').toString().trim()) || null;
      if (!company_name) errors.push({ row: line, message: 'company_name is required' });
      if (company_name && !companiesByName.has(company_name.toLowerCase())) {
        errors.push({ row: line, message: `Company '${company_name}' not found` });
      }
      const accountNumStr = (r['account_number'] ?? '').toString().trim();
      const accountNumberSanitized = accountNumStr.replace(/\s+/g, '');
      if (accountNumberSanitized === '') {
        errors.push({ row: line, message: 'account_number is required' });
      }
      const accountIsNumeric = accountNumberSanitized === '' || /^\d+$/.test(accountNumberSanitized);
      if (accountNumberSanitized !== '' && !accountIsNumeric) errors.push({ row: line, message: 'account_number must contain digits only' });
      const normalizedAccountNumber = accountNumberSanitized !== '' && accountIsNumeric
        ? String(Number(accountNumberSanitized))
        : null;
      const currency = (r['currency'] ?? '').toString().trim().toUpperCase();
      const effective_start = ((r['effective_start'] ?? '').toString().trim()) || defaultStart;
      const statusRaw = (r['status'] ?? 'enabled').toString().trim().toLowerCase();
      if (statusRaw && statusRaw !== 'enabled' && statusRaw !== 'disabled') {
        errors.push({ row: line, message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.` });
      }
      const status = statusRaw === 'disabled' ? StatusState.DISABLED : StatusState.ENABLED;
      const disabledAtRaw = (r['disabled_at'] ?? '').toString().trim();
      let disabled_at: string | null = null;
      try {
        disabled_at = parseEndOfValidityInput(disabledAtRaw)?.toISOString() ?? null;
      } catch {
        errors.push({ row: line, message: `Invalid disabled_at '${disabledAtRaw}'. Use ISO date format.` });
      }
      // Files from before the single end date carry effective_end: it fills an empty end of validity.
      const legacyEndRaw = (r['effective_end'] ?? '').toString().trim();
      if (!disabledAtRaw && legacyEndRaw) {
        try {
          disabled_at = parseEndOfValidityInput(legacyEndRaw)?.toISOString() ?? null;
        } catch {
          errors.push({ row: line, message: `Invalid effective_end '${legacyEndRaw}'. Use YYYY-MM-DD.` });
        }
      }
      const ownerItEmailRaw = (r['owner_it_email'] ?? '').toString().trim();
      const ownerBizEmailRaw = (r['owner_business_email'] ?? '').toString().trim();
      const analyticsCategoryName = ((r['analytics_category'] ?? '').toString().trim()) || null;
      const notes = ((r['notes'] ?? '').toString().trim()) || null;
      if (!product_name) errors.push({ row: line, message: 'product_name is required' });
      if (currency && currency.length !== 3) errors.push({ row: line, message: 'currency must be 3 letters' });
      if (allowedSet.size > 0 && currency && currency.length === 3 && !allowedSet.has(currency)) {
        errors.push({ row: line, message: `currency '${currency}' is not allowed. allowedCurrencies=${Array.from(allowedSet).join(',')}` });
      }
      const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if (ownerItEmailRaw && !emailRegex.test(ownerItEmailRaw)) errors.push({ row: line, message: 'owner_it_email is invalid' });
      if (ownerBizEmailRaw && !emailRegex.test(ownerBizEmailRaw)) errors.push({ row: line, message: 'owner_business_email is invalid' });
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
      const totals: any = {};
      totals[Y - 1] = tMinus1;
      totals[Y] = tY;
      totals[Y + 1] = tPlus1;
      normalized.push({
        product_name,
        description: ((r['description'] ?? '').toString().trim()) || null,
        supplier_name,
        company_name,
        account_number: normalizedAccountNumber,
        currency,
        effective_start,
        status,
        disabled_at,
        analytics_category_name: analyticsCategoryName,
        owner_it_email: ownerItEmailRaw ? ownerItEmailRaw.toLowerCase() : null,
        owner_business_email: ownerBizEmailRaw ? ownerBizEmailRaw.toLowerCase() : null,
        notes,
        totals,
        rowNumber: line,
      });
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };

    const uniqueMap = new Map<string, typeof normalized[number]>();
    for (const item of normalized) {
      const key = `${item.product_name.toLowerCase()}|${(item.supplier_name || '').toLowerCase()}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    }
    const unique = Array.from(uniqueMap.values());

    let inserted = 0; let updated = 0;
    for (const item of unique) {
      let supplierId: string | null = null;
      if (item.supplier_name) {
        const s = await findSupplier(item.supplier_name);
        supplierId = s ? s.id : null;
      }
      const exists = await mg.getRepository(SpendItem).findOne({ where: { product_name: item.product_name, supplier_id: supplierId as any } as any });
      if (exists) updated += 1; else inserted += 1;
    }
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };

    if (!tenantId) {
      return { ok: false, dryRun: false, total: rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: 'Tenant context is required for import' }], allowedCurrencies: Array.from(allowedSet) };
    }

    let processed = 0;
    const checkedFreeze = new Set<string>();
    for (const item of unique) {
      let supplierId: string | null = null;
      if (item.supplier_name) {
        const s = await findSupplier(item.supplier_name);
        supplierId = s ? s.id : null;
      }
      const exists = await mg.getRepository(SpendItem).findOne({ where: { product_name: item.product_name, supplier_id: supplierId as any } as any });
      const company = item.company_name ? companiesByName.get(item.company_name.toLowerCase()) : null;
      let accountId: string | null = null;
      if (item.account_number != null) {
        const a = await findAccount(item.account_number);
        accountId = a ? a.id : null;
      }
      const analyticsCategory = await ensureCategory(item.analytics_category_name ?? null, true);
      const ownerIt = item.owner_it_email ? await findUserByEmail(item.owner_it_email) : null;
      if (item.owner_it_email && !ownerIt) {
        errors.push({ row: item.rowNumber, message: `Owner IT email '${item.owner_it_email}' not found` });
        continue;
      }
      const ownerBiz = item.owner_business_email ? await findUserByEmail(item.owner_business_email) : null;
      if (item.owner_business_email && !ownerBiz) {
        errors.push({ row: item.rowNumber, message: `Owner business email '${item.owner_business_email}' not found` });
        continue;
      }
      const body = {
        product_name: item.product_name,
        description: item.description ?? null,
        supplier_id: supplierId,
        paying_company_id: company ? company.id : null,
        account_id: accountId,
        currency: item.currency,
        effective_start: item.effective_start,
        status: item.status,
        disabled_at: item.disabled_at,
        analytics_category_id: analyticsCategory ? analyticsCategory.id : null,
        owner_it_id: ownerIt ? ownerIt.id : null,
        owner_business_id: ownerBiz ? ownerBiz.id : null,
        notes: item.notes ?? null,
      };
      const target = exists
        ? await this.updateSpendItem({ manager: mg, existing: exists, body, userId })
        : await this.createSpendItem({ manager: mg, body, userId, tenantId });
      const years = [Y - 1, Y, Y + 1];
      for (const yr of years) {
        const totals = (item.totals as any)[yr] || {};
        const hasAny = Object.values(totals).some((v: any) => v != null && !isNaN(Number(v)));
        if (!hasAny) continue;
        let version = await mg.getRepository(SpendVersion).findOne({ where: { spend_item_id: target.id, budget_year: yr as any } as any });
        if (!version) {
          const versionPartial = {
            spend_item_id: target.id,
            budget_year: yr as any,
            version_name: `Auto ${yr}`,
            input_grain: 'annual' as any,
            is_approved: false,
            as_of_date: `${yr}-01-01`,
            tenant_id: target.tenant_id,
          };
          version = mg.getRepository(SpendVersion).create(versionPartial);
          version = await mg.getRepository(SpendVersion).save(version);
          await this.audit.log({ table: 'spend_versions', recordId: version.id, action: 'create', before: null, after: version, userId }, { manager: mg });
        }
        await this.writeImportedTotals(mg, version, yr, totals, checkedFreeze, userId ?? null);
      }
      processed += 1;
    }
    if (errors.length > 0) {
      return { ok: false, dryRun: false, total: rows.length, inserted, updated, errors, allowedCurrencies: Array.from(allowedSet) };
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [], allowedCurrencies: Array.from(allowedSet) };
  }

  /**
   * Spread a year's totals from the file flat over its twelve months. Only the
   * measures with a value in the file replace that year: a blank cell leaves
   * the stored months (and the column's period) as they are, an explicit 0
   * clears them. Each planning column written gets a whole-year flat spread
   * record.
   */
  async writeImportedTotals(
    mg: EntityManager,
    version: SpendVersion,
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
      { manager: mg, freeze: this.freeze, scope: 'opex', version, checkedFreeze },
      { userId, audit: this.audit },
      year,
      annualTotals,
    );
  }

  private async createSpendItem({ manager, body, userId, tenantId }: { manager: EntityManager; body: SpendItemUpsertDto; userId?: string | null; tenantId: string }) {
    const repo = manager.getRepository(SpendItem);
    const { status: statusInput, disabled_at, ...rest } = body;
    const lifecycle = resolveLifecycleState({ nextStatus: statusInput, nextDisabledAt: disabled_at });
    // One OPX number per actual insert. Dry-run and skipped/invalid rows never reach here.
    const item_number = await this.itemNumbers.nextItemNumber('spend', tenantId, manager);
    const entity = repo.create({
      ...rest,
      // Set here, not left to the column default: save() does not read it
      // back, and the versions created for this line inherit it.
      tenant_id: tenantId,
      // These columns are NOT NULL on the entity while the DTO allows null
      product_name: rest.product_name ?? undefined,
      currency: rest.currency ?? undefined,
      effective_start: rest.effective_start ?? undefined,
      item_number,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);
    await this.audit.log({ table: 'spend_items', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager });
    return saved;
  }

  private async updateSpendItem({ manager, existing, body, userId }: { manager: EntityManager; existing: SpendItem; body: SpendItemUpsertDto; userId?: string | null }) {
    const repo = manager.getRepository(SpendItem);
    const before = { ...existing };
    const { status: statusInput, disabled_at, ...rest } = body;
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: existing.disabled_at,
      nextStatus: statusInput,
      nextDisabledAt: disabled_at,
    });
    Object.assign(existing, rest);
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;
    const saved = await repo.save(existing);
    await this.audit.log({ table: 'spend_items', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager });
    return saved;
  }
}
