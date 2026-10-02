import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { SpendVersion } from './spend-version.entity';
import { SpendAmount } from './spend-amount.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { Account } from '../accounts/account.entity';
import { Company } from '../companies/company.entity';
import {
  csvAnalyticsBodyValues,
  CsvAnalyticsCell,
  csvAnalyticsDisabledErrors,
  csvAnalyticsNamesDisabled,
  isCsvAnalyticsHeader,
  itemAnalyticsAuditFields,
  loadCsvAnalyticsExport,
  loadItemAnalyticsValues,
  readCsvAnalyticsCells,
  readCsvAnalyticsColumns,
  writeItemAnalyticsValues,
} from './item-analytics.util';
import { User } from '../users/user.entity';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { addCents, formatCents, toCents } from '../common/amount';
import { AmountMeasure } from './amounts-write.util';
import { writeItemCsvTotals } from './round-inputs.util';
import { deriveStatusFromDisabledAt, parseEndOfValidityInput, resolveLifecycleState, StatusState } from '../common/status';
import { SpendItemUpsertDto } from './dto/spend-item.dto';
import { ItemNumberService } from '../common/item-number.service';
import { csvDateError, parseCsvDate } from './csv-date';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import { csvDataRowLines, rowLine } from '../common/csv/csv-row-lines';
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
} from './item-write.util';
import { ensureBudgetVersion } from './budget-version-ensure';
import { lockBudgetVersions, lockTenantBudgetOperations } from './budget-locks';
import { updateItemUnderLock } from './item-locked-update';

// Accepted on import for one release, never exported: the end of validity used to be split in two dates.
const LEGACY_CSV_HEADERS = ['effective_end'];

/**
 * Locks, in id order, every line a row of the file names (same product name,
 * same supplier or none): the lines it may update, held before the import
 * looks them up and decides.
 */
async function lockCsvLines(mg: EntityManager, tenantId: string, rows: Array<{ product_name: string; supplier_id: string | null }>) {
  if (rows.length === 0) return;
  await mg.query(
    `SELECT i.id FROM spend_items i
       JOIN unnest($2::text[], $3::uuid[]) AS k(product_name, supplier_id)
         ON i.product_name = k.product_name AND i.supplier_id IS NOT DISTINCT FROM k.supplier_id
      WHERE i.tenant_id = $1
      ORDER BY i.id
        FOR NO KEY UPDATE OF i`,
    [tenantId, rows.map((row) => row.product_name), rows.map((row) => row.supplier_id)],
  );
}

@Injectable()
export class SpendItemsCsvService {
  constructor(
    @InjectRepository(SpendItem) private readonly spendItems: Repository<SpendItem>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    @InjectRepository(SpendAmount) private readonly amounts: Repository<SpendAmount>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly currencySettings: CurrencySettingsService,
    private readonly itemNumbers: ItemNumberService,
  ) {}

  private async currentTenantId(mg: EntityManager): Promise<string> {
    const [row] = await mg.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const tenantId = row?.tenant_id as string | null | undefined;
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    return tenantId;
  }

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
      'cost_center_code',
      'run_build',
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
    const tenantId = await this.currentTenantId(mg);
    const delimiter = ';';
    const chunks: string[] = [];
    if (scope === 'template') {
      // analytics_category, then one analytics:<code> column per enabled dimension besides the default one.
      const headers = (await loadCsvAnalyticsExport(mg, 'opex', tenantId, [])).headers(this.csvHeaders());
      return { filename: 'opex_template.csv', content: '\ufeff' + headers.join(delimiter) + '\n' };
    }
    const now = new Date();
    const Y = now.getFullYear();
    // Every read of the export carries the tenant predicate besides row level security.
    const items = await mg.getRepository(SpendItem).find({ where: { tenant_id: tenantId } as any, order: { created_at: 'DESC' as any } });
    const itemIds = items.map((i) => i.id);
    const analyticsColumns = await loadCsvAnalyticsExport(mg, 'opex', tenantId, itemIds);
    const headers = analyticsColumns.headers(this.csvHeaders());
    const years = [Y - 1, Y, Y + 1];
    const versions = await mg.getRepository(SpendVersion).find({ where: { tenant_id: tenantId, spend_item_id: In(itemIds) as any, budget_year: In(years) as any } as any });
    const versionsByItemYear = new Map<string, Map<number, SpendVersion>>();
    const versionsById = new Map<string, SpendVersion>();
    for (const v of versions) {
      versionsById.set(v.id, v);
      let m = versionsByItemYear.get(v.spend_item_id);
      if (!m) { m = new Map<number, SpendVersion>(); versionsByItemYear.set(v.spend_item_id, m); }
      m.set((v as any).budget_year as number, v);
    }
    const versionIds = versions.map((v) => v.id);
    const allAmounts = versionIds.length ? await mg.getRepository(SpendAmount).find({ where: { tenant_id: tenantId, version_id: In(versionIds) as any } as any }) : [];
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
    const suppliers = supplierIds.length ? await mg.getRepository(Supplier).find({ where: { tenant_id: tenantId, id: In(supplierIds) as any } as any }) : [];
    const accounts = accountIds.length ? await mg.getRepository(Account).find({ where: { tenant_id: tenantId, id: In(accountIds) as any } as any }) : [];
    const companies = companyIds.length ? await mg.getRepository(Company).find({ where: { tenant_id: tenantId, id: In(companyIds) as any } as any }) : [];
    const ownerIds = Array.from(new Set(items.flatMap((it: any) => [it.owner_it_id, it.owner_business_id]).filter(Boolean))) as string[];
    const owners = ownerIds.length ? await mg.getRepository(User).find({ where: { tenant_id: tenantId, id: In(ownerIds) as any } as any }) : [];
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const ownerById = new Map(owners.map((u) => [u.id, u]));
    const costCenterCodeById = items.some((it) => it.cost_center_id)
      ? await loadCostCenterCodes(mg, tenantId, items.map((it) => it.cost_center_id))
      : new Map<string, string>();

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
          // Read from the end of validity: the stored status is not updated when the date passes.
          status: deriveStatusFromDisabledAt((it as any).disabled_at),
          disabled_at: (it as any).disabled_at ? new Date((it as any).disabled_at).toISOString() : '',
          owner_it_email: ownerIt ? (ownerIt as any).email ?? '' : '',
          owner_business_email: ownerBiz ? (ownerBiz as any).email ?? '' : '',
          ...analyticsColumns.cells(it.id),
          cost_center_code: it.cost_center_id ? (costCenterCodeById.get(it.cost_center_id) ?? '') : '',
          run_build: it.run_build ?? '',
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
    const optionalHeaders: readonly string[] = ITEM_CSV_OPTIONAL_HEADERS;
    const expectedHeaders = this.csvHeaders();
    const requiredHeaders = expectedHeaders.filter((h) => !optionalHeaders.includes(h));
    type Row = Record<string, string>;
    const rows: Row[] = [];
    const errors: { row: number; message: string }[] = [];
    let headerOk = false;
    let fileHeaders: string[] = [];
    let content = '';
    await new Promise<void>((resolve, reject) => {
      const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
      if (!buf) { reject(new Error('Empty upload')); return; }
      try {
        content = decodeCsvBufferUtf8OrThrow(buf as Buffer);
      } catch {
        reject(new Error('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.'));
        return;
      }
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
    if (!headerOk) return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors, allowedCurrencies: Array.from(allowedSet) };
    // Errors name the file's own line, blank lines included.
    const rowLines = await csvDataRowLines(content, delimiter);
    // Absent optional columns leave the stored values as they are.
    const hasCostCenter = fileHeaders.includes('cost_center_code');
    const hasRunBuild = fileHeaders.includes('run_build');
    // One column per dimension (analytics_category is the default one); an unknown or disabled one refuses the file.
    const analyticsColumns = tenantId
      ? await readCsvAnalyticsColumns(mg, tenantId, fileHeaders, { create: !dryRun })
      : { columns: [], errors: [] };
    if (analyticsColumns.errors.length > 0) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors: analyticsColumns.errors.map((message) => ({ row: 0, message })), allowedCurrencies: Array.from(allowedSet) };
    }

    // A supplier name matches on the trimmed name; names are unique only case-sensitively,
    // so the exact name wins and a case-insensitive match is used only when there is none
    // (several of those is ambiguous).
    const supplierCache = new Map<string, string[]>();
    const findSupplierIds = async (name: string): Promise<string[]> => {
      const cell = name.trim();
      const cached = supplierCache.get(cell);
      if (cached) return cached;
      const found: Array<{ id: string; name: string }> = await mg.query(
        `SELECT id, TRIM(name) AS name FROM suppliers WHERE tenant_id = $1 AND LOWER(TRIM(name)) = LOWER($2) ORDER BY id`,
        [tenantId, cell],
      );
      const exact = found.filter((s) => s.name === cell);
      const ids = (exact.length > 0 ? exact : found).map((s) => s.id);
      supplierCache.set(cell, ids);
      return ids;
    };
    // An account number resolves within the paying company's chart of accounts;
    // a company without a chart uses the tenant's default chart, as the account picker does.
    let defaultChartId: string | null | undefined;
    const companyChartId = async (company: Company): Promise<string | null> => {
      if (company.coa_id) return company.coa_id;
      if (defaultChartId === undefined) {
        const [chart] = await mg.query(
          `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND is_global_default = true LIMIT 1`,
          [tenantId],
        );
        defaultChartId = (chart?.id as string | undefined) ?? null;
      }
      return defaultChartId;
    };
    const accountCache = new Map<string, string | null>();
    const findAccountId = async (company: Company, accountNumber: string): Promise<string | null> => {
      // The column is an integer: a number beyond its range names no account.
      if (Number(accountNumber) > 2147483647) return null;
      const chartId = await companyChartId(company);
      const key = `${chartId ?? ''}|${accountNumber}`;
      if (accountCache.has(key)) return accountCache.get(key) ?? null;
      const [account] = await mg.query(
        `SELECT id FROM accounts
         WHERE tenant_id = $1 AND account_number = $2::integer AND coa_id IS NOT DISTINCT FROM $3::uuid`,
        [tenantId, accountNumber, chartId],
      );
      const id = (account?.id as string | undefined) ?? null;
      accountCache.set(key, id);
      return id;
    };
    /** A YYYY-MM-DD cell (see `csv-date.ts`): null when blank; any other value is the row's error. */
    const readDate = (raw: unknown, field: string, line: number): string | null => {
      const value = parseCsvDate(raw);
      if (value === undefined) errors.push({ row: line, message: csvDateError(field) });
      return value ?? null;
    };
    const userRepo = mg.getRepository(User);
    const userCache = new Map<string, User | null>();
    const findUserByEmail = async (email: string): Promise<User | null> => {
      if (!tenantId) return null;
      const key = email.toLowerCase();
      if (userCache.has(key)) return userCache.get(key) ?? null;
      const user = await userRepo.createQueryBuilder('u')
        .where('u.tenant_id = :tenantId', { tenantId })
        .andWhere('LOWER(u.email) = LOWER(:email)', { email })
        .getOne();
      userCache.set(key, user ?? null);
      return user ?? null;
    };
    // An owner is an active (enabled) user of this tenant: checked with the rest of the row, before anything is written.
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

    const allCompanies = await mg.getRepository(Company).find({ where: { tenant_id: tenantId ?? undefined } as any });
    const companiesByName = new Map(allCompanies.map(c => [c.name.toLowerCase(), c]));
    const companiesById = new Map<string, Company | null>(allCompanies.map((c) => [c.id, c]));
    /** A company by id: from the list read at the start, else read now (one a line got meanwhile). */
    const findCompany = async (id: string | null | undefined): Promise<Company | null> => {
      if (!id) return null;
      if (!companiesById.has(id)) {
        companiesById.set(id, await mg.getRepository(Company).findOne({ where: { id, tenant_id: tenantId ?? undefined } as any }));
      }
      return companiesById.get(id) ?? null;
    };
    const costCentersByCode = hasCostCenter && tenantId ? await loadCostCentersByCode(mg, tenantId) : new Map<string, CsvCostCenter>();

    const now = new Date();
    const Y = now.getFullYear();
    const defaultStart = `${Y}-01-01`;
    const normalized: Array<{
      product_name: string;
      description: string | null;
      supplier_id: string | null;
      /** Undefined: the column is not written (an existing line keeps its company). */
      paying_company_id: string | null | undefined;
      account_id: string | null;
      /** A blank company cell: the company is decided with the existing line, read under its lock. */
      company_from_line: boolean;
      /** The account number of the file, resolved in that company's chart once it is known. */
      account_number: string | null;
      currency: string;
      effective_start: string | null;
      status: StatusState | null;
      disabled_at: string | null;
      notes: string | null;
      totals: { [year: number]: { planned?: number; actual?: number; expected_landing?: number; committed?: number } };
      analytics: CsvAnalyticsCell[];
      owner_it_id: string | null;
      owner_business_id: string | null;
      cost_center: CsvCostCenter | null;
      run_build: 'run' | 'build' | null;
      line: number;
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

    const rowByLine = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = rowLine(rowLines, i);
      const product_name = (r['product_name'] ?? '').toString().trim();
      const supplier_name = ((r['supplier_name'] ?? '').toString().trim()) || null;
      const company_name = ((r['company_name'] ?? '').toString().trim()) || null;
      const costCenterCode = hasCostCenter ? (r['cost_center_code'] ?? '').toString().trim() : '';
      let cost_center: CsvCostCenter | null = null;
      if (costCenterCode) {
        const resolved = resolveCsvCostCenter(costCentersByCode, costCenterCode);
        if (resolved.error) errors.push({ row: line, message: resolved.error });
        cost_center = resolved.node;
      }
      const run_build = hasRunBuild ? parseRunBuild(r['run_build']) : null;
      if (run_build === undefined) errors.push({ row: line, message: CSV_RUN_BUILD_ERROR });
      let supplier_id: string | null = null;
      if (supplier_name) {
        const supplierIds = await findSupplierIds(supplier_name);
        if (supplierIds.length === 0) errors.push({ row: line, message: `Supplier '${supplier_name}' not found` });
        else if (supplierIds.length > 1) errors.push({ row: line, message: `Supplier '${supplier_name}' matches more than one supplier` });
        else supplier_id = supplierIds[0];
      }
      // A named company resolves here, with the account in its chart. A blank cell is
      // decided below with the existing line, as read under its lock: it keeps an existing
      // line's company, and a new line takes its cost center's (as on CAPEX).
      let company: Company | null = null;
      if (company_name) {
        company = companiesByName.get(company_name.toLowerCase()) ?? null;
        if (!company) errors.push({ row: line, message: `Company '${company_name}' not found` });
      }
      // A line is its product name and supplier (the existing-line match): a second row for it is refused, never dropped.
      if (product_name && (!supplier_name || supplier_id)) {
        const lineKey = `${product_name}|${supplier_id ?? ''}`;
        const firstRow = rowByLine.get(lineKey);
        if (firstRow !== undefined) errors.push({ row: line, message: `Same line as row ${firstRow}` });
        else rowByLine.set(lineKey, line);
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
      let account_id: string | null = null;
      if (company && normalizedAccountNumber != null) {
        account_id = await findAccountId(company, normalizedAccountNumber);
        if (!account_id) {
          errors.push({ row: line, message: `Account ${normalizedAccountNumber} not found in ${company.name}'s chart of accounts` });
        }
      }
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
      let disabled_at: string | null = null;
      try {
        disabled_at = parseEndOfValidityInput(disabledAtRaw)?.toISOString() ?? null;
      } catch {
        errors.push({ row: line, message: `Invalid disabled_at '${disabledAtRaw}'. Use ISO date format.` });
      }
      // The status cell must agree with the date cell (not with a legacy effective_end below).
      const lifecycleConflict = csvLifecycleConflict(status, disabled_at);
      if (lifecycleConflict) errors.push({ row: line, message: lifecycleConflict });
      // Files from before the single end date carry effective_end: it fills an empty end of validity.
      if (!disabledAtRaw) {
        const legacyEnd = readDate(r['effective_end'], 'effective_end', line);
        if (legacyEnd) disabled_at = parseEndOfValidityInput(legacyEnd)?.toISOString() ?? null;
      }
      const ownerItEmailRaw = (r['owner_it_email'] ?? '').toString().trim();
      const ownerBizEmailRaw = (r['owner_business_email'] ?? '').toString().trim();
      const { cells: analytics, errors: analyticsErrors } = readCsvAnalyticsCells(analyticsColumns.columns, r);
      for (const message of analyticsErrors) errors.push({ row: line, message });
      const notes = ((r['notes'] ?? '').toString().trim()) || null;
      if (!product_name) errors.push({ row: line, message: 'product_name is required' });
      if (currency && currency.length !== 3) errors.push({ row: line, message: 'currency must be 3 letters' });
      if (allowedSet.size > 0 && currency && currency.length === 3 && !allowedSet.has(currency)) {
        errors.push({ row: line, message: `currency '${currency}' is not allowed. allowedCurrencies=${Array.from(allowedSet).join(',')}` });
      }
      const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      let owner_it_id: string | null = null;
      if (ownerItEmailRaw && !emailRegex.test(ownerItEmailRaw)) errors.push({ row: line, message: 'owner_it_email is invalid' });
      else owner_it_id = await resolveOwner(ownerItEmailRaw.toLowerCase(), 'Owner IT', line);
      let owner_business_id: string | null = null;
      if (ownerBizEmailRaw && !emailRegex.test(ownerBizEmailRaw)) errors.push({ row: line, message: 'owner_business_email is invalid' });
      else owner_business_id = await resolveOwner(ownerBizEmailRaw.toLowerCase(), 'Owner business', line);
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
        supplier_id,
        paying_company_id: company ? company.id : null,
        account_id,
        company_from_line: !company_name,
        account_number: normalizedAccountNumber,
        currency,
        effective_start,
        status,
        disabled_at,
        analytics,
        owner_it_id,
        owner_business_id,
        cost_center,
        run_build: run_build ?? null,
        notes,
        totals,
        line,
      });
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };
    // Pass 1 refused any repeated line, so every row is its own line.
    const unique = normalized;

    // The existing line of each row, resolved once for the dry run and the load: same
    // product name and same supplier, a blank supplier matching only a line without one
    // (a null in a TypeORM `where` is dropped, so it would match any supplier).
    const existingByItem = new Map<typeof normalized[number], SpendItem | null>();
    let inserted = 0; let updated = 0;
    if (!dryRun && tenantId) {
      // One bulk budget operation at a time per tenant (a second one gets a 409), then the
      // lines the file names, locked in id order before anything is decided: the lookups
      // below and every check after them read the locked lines (lock order: `budget-locks.ts`).
      await lockTenantBudgetOperations(mg, tenantId);
      await lockCsvLines(mg, tenantId, unique);
    }
    for (const item of unique) {
      existingByItem.set(item, await mg.getRepository(SpendItem).findOne({
        where: { tenant_id: tenantId ?? undefined, product_name: item.product_name, supplier_id: item.supplier_id ?? IsNull() },
      }));
    }
    // A disabled analytics value is accepted only as the line's current one.
    const currentAnalytics = tenantId
      ? await loadItemAnalyticsValues(mg, 'opex', tenantId, unique
        .filter((item) => csvAnalyticsNamesDisabled(item.analytics))
        .map((item) => existingByItem.get(item)?.id ?? ''))
      : new Map();
    for (const item of unique) {
      const exists = existingByItem.get(item) ?? null;
      // A blank company cell, decided on the line read here (under its lock in a real run, never
      // on a read made before it): an existing line keeps its company, the column is not written;
      // a line without one, or a new line, takes its cost center's. The account number then
      // resolves in that company's chart.
      if (item.company_from_line) {
        const company = await findCompany(exists?.paying_company_id ?? item.cost_center?.company_id);
        if (!exists?.paying_company_id && !item.cost_center) {
          errors.push({ row: item.line, message: CSV_COMPANY_REQUIRED_ERROR });
          continue;
        }
        item.paying_company_id = exists?.paying_company_id ? undefined : company?.id ?? null;
        if (company && item.account_number != null) {
          item.account_id = await findAccountId(company, item.account_number);
          if (!item.account_id) {
            errors.push({ row: item.line, message: `Account ${item.account_number} not found in ${company.name}'s chart of accounts` });
            continue;
          }
        }
      }
      const disabledCostCenter = item.cost_center ? csvCostCenterDisabledError(item.cost_center, exists?.cost_center_id) : null;
      if (disabledCostCenter) {
        errors.push({ row: item.line, message: disabledCostCenter });
        continue;
      }
      const disabledValues = csvAnalyticsDisabledErrors(item.analytics, exists ? currentAnalytics.get(exists.id) : undefined);
      if (disabledValues.length > 0) {
        for (const message of disabledValues) errors.push({ row: item.line, message });
        continue;
      }
      // A new line needs its currency; on an update a blank cell keeps the stored one.
      if (!exists && !item.currency) {
        errors.push({ row: item.line, message: 'currency is required' });
        continue;
      }
      if (exists) updated += 1; else inserted += 1;
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };

    if (!tenantId) {
      return { ok: false, dryRun: false, total: rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: 'Tenant context is required for import' }], allowedCurrencies: Array.from(allowedSet) };
    }

    await lockCsvCostCenters(mg, tenantId, unique.map((item) => {
      const exists = existingByItem.get(item) ?? null;
      return item.cost_center && item.cost_center.id !== exists?.cost_center_id ? item.cost_center.id : null;
    }));

    let processed = 0;
    const checkedFreeze = new Set<string>();
    for (const item of unique) {
      const exists = existingByItem.get(item) ?? null;
      // A value the dimension does not have yet is created in it (enabled, audited).
      const analyticsValues = await csvAnalyticsBodyValues(mg, tenantId, item.analytics, this.audit, userId);
      const body = {
        product_name: item.product_name,
        description: item.description ?? null,
        supplier_id: item.supplier_id,
        ...(item.paying_company_id !== undefined ? { paying_company_id: item.paying_company_id } : {}),
        account_id: item.account_id,
        ...(item.currency ? { currency: item.currency } : {}),
        ...(item.effective_start ? { effective_start: item.effective_start } : exists ? {} : { effective_start: defaultStart }),
        ...csvItemLifecycle(item.status, item.disabled_at, !!exists),
        ...(analyticsValues ? { analytics_values: analyticsValues } : {}),
        owner_it_id: item.owner_it_id,
        owner_business_id: item.owner_business_id,
        ...(hasCostCenter ? { cost_center_id: item.cost_center?.id ?? null } : {}),
        ...(hasRunBuild ? { run_build: item.run_build } : {}),
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
          // Get-or-create: the budget tab may create the year at the same moment.
          const ensured = await ensureBudgetVersion(mg, 'opex', {
            tenantId: target.tenant_id,
            itemId: target.id,
            year: yr,
            versionName: `Auto ${yr}`,
            inputGrain: 'annual',
            asOfDate: `${yr}-01-01`,
            allocationMethod: 'default',
          });
          if (!ensured) {
            throw new BadRequestException(`Another year of "${target.product_name}" already has a version named "Auto ${yr}": rename it, then import again.`);
          }
          version = ensured.version;
          if (ensured.created) {
            await this.audit.log({ table: 'spend_versions', recordId: version.id, action: 'create', before: null, after: version, userId }, { manager: mg });
          }
        }
        // Lock order: the line (locked above, or created here), then its version, then the months.
        await lockBudgetVersions(mg, 'opex', tenantId, [version.id]);
        await this.writeImportedTotals(mg, version, yr, totals, checkedFreeze, userId ?? null);
      }
      processed += 1;
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [], allowedCurrencies: Array.from(allowedSet) };
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

  /** The CSV's own writes go through the same gate as the API (`item-write.util.ts`). */
  private async createSpendItem({ manager, body, userId, tenantId }: { manager: EntityManager; body: SpendItemUpsertDto; userId?: string | null; tenantId: string }) {
    const repo = manager.getRepository(SpendItem);
    const { values, lifecycle: input, analytics } = await resolveItemWrite(manager, 'opex', body, null);
    const lifecycle = resolveLifecycleState({ nextStatus: input.status, nextDisabledAt: input.disabled_at });
    // One OPX number per actual insert. Dry-run and skipped/invalid rows never reach here.
    const item_number = await this.itemNumbers.nextItemNumber('spend', tenantId, manager);
    const entity = repo.create({
      ...(values as Partial<SpendItem>),
      // Set here, not left to the column default: save() does not read it
      // back, and the versions created for this line inherit it.
      tenant_id: tenantId,
      // These columns are NOT NULL on the entity while the DTO allows null
      product_name: (values.product_name as string | null | undefined) ?? undefined,
      currency: (values.currency as string | null | undefined) ?? undefined,
      effective_start: (values.effective_start as string | null | undefined) ?? undefined,
      item_number,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);
    await writeItemAnalyticsValues(manager, 'opex', tenantId, saved.id, analytics);
    const analyticsAfter = analytics.length > 0 ? (await loadItemAnalyticsValues(manager, 'opex', tenantId, [saved.id])).get(saved.id) ?? [] : [];
    await this.audit.log({
      table: 'spend_items', recordId: saved.id, action: 'create', before: null,
      after: { ...saved, ...itemAnalyticsAuditFields(analyticsAfter) }, userId,
    }, { manager });
    return saved;
  }

  /**
   * The line as the file has it: only the columns of the body, which carries
   * only the columns present in the file (an optional column left out is never
   * written), under the line's row lock; see `item-locked-update.ts`.
   */
  private async updateSpendItem({ manager, existing, body, userId }: { manager: EntityManager; existing: SpendItem; body: SpendItemUpsertDto; userId?: string | null }) {
    const result = await updateItemUnderLock(manager, 'opex', existing.tenant_id, existing.id, body);
    if (!result) throw new BadRequestException(`The line "${existing.product_name}" was deleted during the import. Import the file again.`);
    const { before, after, analyticsBefore, analyticsAfter } = result;
    await this.audit.log({
      table: 'spend_items', recordId: after.id, action: 'update',
      before: { ...before, ...itemAnalyticsAuditFields(analyticsBefore) },
      after: { ...after, ...itemAnalyticsAuditFields(analyticsAfter) }, userId,
    }, { manager });
    return after;
  }
}
