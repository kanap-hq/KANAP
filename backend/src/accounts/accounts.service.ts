import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Equal, ILike, IsNull, Raw, Repository } from 'typeorm';
import { Account, ACCOUNT_EXPECTED_UNITS, ACCOUNT_NATURES, AccountNature, expectedSetting, expectedUnitsSetting } from './account.entity';
import { formatExpectedUnitsCell, parseExpectedUnitsCell } from './account-expected-units';
import { Company } from '../companies/company.entity';
import { assertEntityFilterFields, buildWhereFromAgFilters, parseExportPagination, parsePagination } from '../common/pagination';
import { sortedFindQuery } from '../common/list-sort';
import { compileAgFilterCondition, createParamNameGenerator, assertSetFilterModes } from '../common/ag-grid-filtering';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { AccountUpsertDto } from './dto/account.dto';
import {
  cellOf,
  cellText,
  clearedValueCount,
  clearRefusals,
  CsvDataRow,
  formatCsvBoolean,
  parseCsvBoolean,
  rowError,
  CsvDateOrder,
  CsvImportMode,
  CsvLanguage,
  DecimalMark,
  ImportReportError,
  keepsStoredValue,
  MasterDataImportResult,
  readMasterDataFile,
  rowProblemErrors,
  storedRecordValues,
  listedUpdates,
  type ImportUpdate,
} from '../common/csv-sheet';
import {
  AccountAuditRow,
  andCondition,
  ConsolidationAccount,
  consolidationAccounts,
  consolidationLookup,
  ConsolidationStatus,
  consolidationStatusCondition,
  consolidationStatusOf,
  CURRENT_TENANT,
  insertAccountAudits,
  lockConsolidationChartId,
  parseConsolidationStatus,
  remapToConsolidationAccount,
  resyncFromChart,
} from './consolidation';
import { ACCOUNT_NUMBER_MAX, ACCOUNT_NUMBER_MAX_DIGITS, ACCOUNT_NUMBER_RULE, readAccountNumber } from './account-number';
import { uploadedBytes } from '../common/upload';
import { ListExportCell, ListExportFile, writeListExport } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';

const ACCOUNTS_SHEET = { en: 'Accounts', fr: 'Comptes', de: 'Konten', es: 'Cuentas' };

const ACCOUNT_NUMBER_TOKEN = '__account_number__';

/**
 * `where.account_number` for a grid filter on it: the column is an integer, so
 * a text filter ("contains 60") compares its text, as the grid shows it (an
 * ILIKE on the integer would fail in SQL). A combined model applies each condition.
 */
function accountNumberWhere(rawModel: any, paramPrefix = 'account_number_') {
  const combined = rawModel && Array.isArray(rawModel.conditions) && rawModel.conditions.length > 0
    && (rawModel.operator === 'AND' || rawModel.operator === 'OR');
  const nextParam = createParamNameGenerator(paramPrefix);
  const parts = ((combined ? rawModel.conditions : [rawModel]) as any[])
    .map((model) => compileAgFilterCondition(model, { expression: `CAST(${ACCOUNT_NUMBER_TOKEN} AS text)` }, nextParam))
    .filter((part): part is NonNullable<typeof part> => !!part);
  if (parts.length === 0) return undefined;
  const sql = parts.map((part) => `(${part.sql})`).join(combined && rawModel.operator === 'OR' ? ' OR ' : ' AND ');
  const params = Object.assign({}, ...parts.map((part) => part.params));
  return Raw((alias) => sql.split(ACCOUNT_NUMBER_TOKEN).join(alias), params);
}

/** A quick search that can be an account number: an integer within the accounts' 15-digit bound. */
function accountNumberQuery(q: string): number | null {
  const value = Number(q);
  return Number.isInteger(value) && Math.abs(value) <= ACCOUNT_NUMBER_MAX ? value : null;
}

/**
 * A CSV cell read as an account number (`readAccountNumber`): `tooLong` is the row error of a
 * number above 15 digits, `leadingZeros` the row warning of zeros the stored number drops.
 */
function csvAccountNumber(raw: string, column: string, row: number): { value: number | null; tooLong?: ImportReportError; leadingZeros?: ImportReportError } {
  const reading = readAccountNumber(raw);
  if (reading.value == null) {
    return reading.problem !== 'too_long' ? { value: null } : {
      value: null,
      tooLong: {
        row, column, code: 'CSV_ACCOUNT_NUMBER_TOO_LONG', params: { value: raw, max: ACCOUNT_NUMBER_MAX_DIGITS },
        message: `${column} '${raw}' has more than ${ACCOUNT_NUMBER_MAX_DIGITS} digits. Use at most ${ACCOUNT_NUMBER_MAX_DIGITS} digits.`,
      },
    };
  }
  return {
    value: reading.value,
    leadingZeros: reading.leadingZeros ? {
      row, column, code: 'CSV_ACCOUNT_NUMBER_LEADING_ZEROS', params: { value: raw, stored: reading.value },
      message: `${raw} will be stored as ${reading.value}.`,
    } : undefined,
  };
}

/** The text and choice columns an import row may set, compared as they are stored. */
const IMPORT_COMPARED_FIELDS = [
  'account_name',
  'native_name',
  'description',
  'consolidation_account_name',
  'consolidation_account_description',
  'status',
  'nature',
  'quantity_price_expected',
] as const;

/** True when every column the row carries already holds its value: re-importing it writes nothing. */
function importRowUnchanged(existing: Account, row: AccountUpsertDto): boolean {
  for (const field of IMPORT_COMPARED_FIELDS) {
    const value = (row as any)[field];
    if (value !== undefined && (value ?? null) !== ((existing as any)[field] ?? null)) return false;
  }
  // The units, as stored (`expectedUnitsSetting`), and those the setting cleared with it.
  const units = row.quantity_price_expected === null ? null : row.expected_units;
  if (units !== undefined && String(expectedUnitsSetting(units)) !== String(expectedUnitsSetting(existing.expected_units))) return false;
  return row.consolidation_account_number === undefined
    || numberOrNull(row.consolidation_account_number) === numberOrNull(existing.consolidation_account_number);
}

/** A write the database refused for a number out of range: a 400, never a 500. */
function numberOutOfRange(e: any): boolean {
  return e?.code === '22003' || e?.driverError?.code === '22003';
}

/** The `consolidationStatus` filter, added to any condition already on the consolidation number. */
function applyConsolidationStatus(where: any, status: ConsolidationStatus | undefined) {
  if (!status) return;
  where.consolidation_account_number = andCondition(where.consolidation_account_number, consolidationStatusCondition(status));
}

/** The quick search on a consolidation number, keeping the conditions already on that column. */
function consolidationNumberEquals(where: any, value: number) {
  return where.consolidation_account_number === undefined ? value : andCondition(where.consolidation_account_number, Equal(value));
}

/** A set filter's values on `field`, each mapped by `map`; the filters unchanged without one. */
function mapSetValues(filters: any, field: string, map: (value: unknown) => unknown) {
  const model = filters?.[field];
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return filters;
  return { ...filters, [field]: { ...model, values: model.values.map(map) } };
}

/**
 * The grid's set filters on the two settings stored as NULL when not set. `nature`: a blank value
 * ('') means "OPEX and CAPEX". `quantity_price_expected`: true is the accounts that expect quantity
 * and price; anything else (null, '', false) the accounts without the setting, never stored false.
 */
function withNatureBlanks(filters: any) {
  const natures = mapSetValues(filters, 'nature', (value) => (value === '' ? null : value));
  return mapSetValues(natures, 'quantity_price_expected', (value) => (value === true || String(value).toLowerCase() === 'true' ? true : null));
}

/**
 * The grid's set filter on `expected_units`, taken out of `filters` into `where`. It returns what the
 * cell shows: an account matches when it expects one of the units ticked or, for the blank value
 * ("Any unit"), when it sets quantity and price entry without naming units; an account without the
 * setting shows nothing and never matches. The column is an array, which the common filters would
 * compare as a whole.
 */
function takeExpectedUnitsFilter(filters: any, where: any) {
  if (!filters || !('expected_units' in filters)) return;
  const model = filters.expected_units;
  delete filters.expected_units;
  if (model?.filterType !== 'set' || !Array.isArray(model.values)) {
    throw new BadRequestException('expected_units filters on a set of units.');
  }
  const units = ACCOUNT_EXPECTED_UNITS.filter((unit) => model.values.includes(unit));
  const anyUnit = model.values.some((value: unknown) => value === null || value === '');
  where.expected_units = Raw((alias) => {
    // The setting's column, on the same row: the alias names `expected_units`, quoted or not.
    const setting = alias.replace(/expected_units("?)$/, 'quantity_price_expected$1');
    if (setting === alias) throw new Error(`expected_units filter: unexpected column alias ${alias}`);
    const parts = [
      units.length > 0 ? `${alias} && ARRAY[:...expectedUnits]::text[]` : '',
      anyUnit ? `(${alias} IS NULL AND ${setting} IS TRUE)` : '',
    ];
    const sql = parts.filter(Boolean).join(' OR ');
    return sql ? `(${sql})` : '1 = 0';
  }, { expectedUnits: units });
}

/** A CSV `nature` cell: '' is null (OPEX and CAPEX), undefined an invalid value. */
/** The values `-` cannot clear (D21 of 26.11.9): the keys, the required name, the status. */
const UNCLEARABLE_ACCOUNT_CELLS = ['coa_code', 'account_number', 'account_name', 'status'] as const;
/** The values `-` clears on a stored account. */
const CLEARABLE_ACCOUNT_FIELDS = [
  'native_name',
  'description',
  'consolidation_account_number',
  'consolidation_account_name',
  'consolidation_account_description',
  'nature',
  'quantity_price_expected',
  'expected_units',
] as const;

function csvNature(raw: string): AccountNature | null | undefined {
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  return (ACCOUNT_NATURES as readonly string[]).includes(text) ? (text as AccountNature) : undefined;
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

/**
 * Units only on an account that expects quantity and price (`accounts_expected_units_check`): a
 * write that sends units for an account left without the setting is refused, naming the field;
 * one that clears the setting without sending units clears them with it, as unticking the box does.
 */
function assertUnitsFollowSetting(account: Pick<Account, 'quantity_price_expected' | 'expected_units'>, sent: readonly string[] | null | undefined) {
  if (account.quantity_price_expected === true) return;
  if (expectedUnitsSetting(sent)) throw unitsWithoutEntry();
  account.expected_units = null;
}

/** The refusal of units on an account without the setting, coded for the screen's words (`errors:<code>`). */
function unitsWithoutEntry() {
  return new BadRequestException({
    code: 'ACCOUNT_EXPECTED_UNITS_WITHOUT_ENTRY',
    message: 'Expected units need quantity and price entry: tick Quantity and price entry to name them.',
    field: 'expected_units',
  });
}

/** The database's own check of the same rule (`accounts_expected_units_check`), should a write still reach it. */
function isUnitsWithoutEntry(e: any): boolean {
  const code = e?.code ?? e?.driverError?.code;
  const constraint = e?.constraint ?? e?.driverError?.constraint;
  return code === '23514' && constraint === 'accounts_expected_units_check';
}

/**
 * Row locks on the tenant's accounts matching `where`, in id order, taken after the charts' lock
 * (`lockConsolidationChartId`), the order of every account writer. `FOR NO KEY UPDATE`: two writes of
 * one account wait for each other, and a budget line that references it is not held off.
 */
async function lockAccountRows(mg: EntityManager, where: string, params: unknown[]) {
  await mg.query(`SELECT id FROM accounts WHERE tenant_id = ${CURRENT_TENANT} AND ${where} ORDER BY id FOR NO KEY UPDATE`, params);
}

/** What an account write needs of the consolidation chart: read once per request, or once per CSV import. */
type ConsolidationContext = {
  /** The tenant's consolidation chart, read under lock (`lockConsolidationChartId`). */
  chartId: string | null;
  /** Its accounts by number, loaded up front by a CSV import; read per account otherwise. */
  accounts?: Map<number, ConsolidationAccount>;
  /** False when the caller resyncs the accounts mapped to the consolidation chart once, at its end. */
  propagate: boolean;
  /** The audit lines of the account writes, for the caller to write in one statement; written one by one otherwise. */
  audits?: AccountAuditRow[];
};

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account) private readonly repo: Repository<Account>,
    private readonly audit: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Account) : this.repo;
  }

  async list(query: any, opts?: { manager?: EntityManager; exportAll?: boolean }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, status, q, filters } = opts?.exportAll ? parseExportPagination(query) : parsePagination(query);
    assertSetFilterModes(filters, ['status', 'account_number']);
    const consolidationStatus = parseConsolidationStatus(query?.consolidationStatus);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = withNatureBlanks(sanitizedFilters ?? filters);
    const effectiveStatus = status ?? statusFromAg;
    const where: any = {};
    let whereArr: any[] | undefined;
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      const mappedFilters = { ...filtersToApply };
      const accountNumberFilter = mappedFilters.account_number;
      delete mappedFilters.account_number;
      // The consolidation number is a number too, filtered on its digits like the account number.
      const consolidationNumberFilter = mappedFilters.consolidation_account_number;
      delete mappedFilters.consolidation_account_number;

      // Special handling for coa_code: look up CoA IDs by code pattern
      if ('coa_code' in mappedFilters) {
        const coaCodeFilter = mappedFilters.coa_code;
        delete mappedFilters.coa_code;

        let model: any = coaCodeFilter;
        if (model && model.operator && Array.isArray(model.conditions) && model.conditions.length > 0) {
          model = model.conditions[0];
        }
        const type = (model?.type ?? model?.filterType ?? 'contains') as string;
        const valRaw = model?.filter ?? model?.value;

        if (valRaw != null && valRaw !== '') {
          const val = String(valRaw);
          let pattern: string;

          switch (type) {
            case 'equals':
              pattern = val;
              break;
            case 'startsWith':
              pattern = `${val}%`;
              break;
            case 'endsWith':
              pattern = `%${val}`;
              break;
            case 'contains':
            default:
              pattern = `%${val}%`;
              break;
          }

          // Look up CoA IDs matching the code pattern
          const coaRows = await (opts?.manager ?? repo.manager).query(
            `SELECT id FROM chart_of_accounts WHERE code ILIKE $1 AND tenant_id = ${CURRENT_TENANT}`,
            [pattern]
          );
          const coaIds = coaRows.map((r: any) => r.id);

          if (coaIds.length > 0) {
            mappedFilters.coa_id = { filterType: 'set', values: coaIds };
          } else {
            // No CoAs match, so no accounts should match
            mappedFilters.coa_id = { filterType: 'equals', filter: '00000000-0000-0000-0000-000000000000' };
          }
        }
      }

      takeExpectedUnitsFilter(mappedFilters, where);
      assertEntityFilterFields(mappedFilters, repo.metadata);
      Object.assign(where, buildWhereFromAgFilters(mappedFilters));
      const accountNumberCondition = accountNumberFilter ? accountNumberWhere(accountNumberFilter) : undefined;
      if (accountNumberCondition) where.account_number = accountNumberCondition;
      const consolidationNumberCondition = consolidationNumberFilter ? accountNumberWhere(consolidationNumberFilter, 'consolidation_number_') : undefined;
      if (consolidationNumberCondition) where.consolidation_account_number = consolidationNumberCondition;
    }
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = effectiveStatus ?? StatusState.ENABLED;
    // "All" lifts only the default scope: an explicit status (query or status column filter) still applies.
    if (matchNone) {
      where.disabled_at = Raw(() => '1 = 0');
    } else if (!includeDisabled || effectiveStatus) {
      if (lifecycleStatus === StatusState.DISABLED) {
        where.disabled_at = Raw((alias) => `${alias} IS NOT NULL AND ${alias} <= NOW()`);
      } else {
        where.disabled_at = Raw((alias) => `${alias} IS NULL OR ${alias} > NOW()`);
      }
    }

    // CoA scoping via companyId or coaId - MUST be applied BEFORE building whereArr
    const companyId = query?.companyId as string | undefined;
    const coaIdParam = query?.coaId as string | undefined;
    if (companyId) {
      const mg = opts?.manager ?? repo.manager;
      const company = await mg.getRepository(Company).findOne({ where: { id: companyId } });
      if (company) {
        if (company.coa_id) {
          // Company HAS CoA → only show accounts from that specific CoA
          (where as any).coa_id = company.coa_id;
        } else {
          // Company has NO CoA → fallback to tenant global default if present
          try {
            const rows = await mg.query(`SELECT id FROM chart_of_accounts WHERE is_global_default = true AND tenant_id = ${CURRENT_TENANT} LIMIT 1`);
            const globalId = rows?.[0]?.id as string | undefined;
            if (globalId) (where as any).coa_id = globalId; else (where as any).coa_id = IsNull();
          } catch {
            (where as any).coa_id = IsNull();
          }
        }
      }
    } else if (coaIdParam) {
      (where as any).coa_id = coaIdParam;
    }

    applyConsolidationStatus(where, consolidationStatus);

    // Quick search across multiple fields; combine with filters via OR array
    if (q) {
      const like = ILike(`%${q}%`);
      const numQ = accountNumberQuery(q);
      whereArr = [
        { ...where, account_name: like },
        { ...where, description: like },
        { ...where, consolidation_account_name: like },
        { ...where, consolidation_account_description: like },
      ];
      if (numQ !== null) {
        whereArr.push({ ...where, account_number: String(numQ) });
        // Also allow numeric match on consolidation_account_number (with its status filter, if any)
        whereArr.push({ ...where, consolidation_account_number: consolidationNumberEquals(where, numQ) });
      }
    }

    // Map virtual fields to actual DB columns for sorting
    const sortField = sort.field === 'coa_code' ? 'coa_id' : sort.field;

    const qb = await sortedFindQuery(repo, 'account', whereArr ?? where, { field: sortField, direction: sort.direction });
    const [items, total] = await qb.offset(skip).limit(limit).getManyAndCount();
    // Enrich with CoA code and consolidation status for UI
    const ids = Array.from(new Set(items.map((i) => i.coa_id).filter(Boolean))) as string[];
    let codeById = new Map<string, string>();
    if (ids.length > 0) {
      const rows = await repo.manager.query(
        `SELECT id, code FROM chart_of_accounts WHERE id = ANY($1) AND tenant_id = ${CURRENT_TENANT}`,
        [ids],
      );
      codeById = new Map(rows.map((r: any) => [r.id, r.code]));
    }
    const lookup = await consolidationLookup(repo.manager, items.map((i) => i.consolidation_account_number));
    const enriched = (items as any[]).map((i) => ({
      ...i,
      coa_code: i.coa_id ? codeById.get(i.coa_id) || '' : '',
      consolidation_status: consolidationStatusOf(i.consolidation_account_number, lookup),
    }));
    return { items: enriched, total, page, limit };
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Account not found');
    return found;
  }

  async listIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const parsed = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 });
    const { sort, status, q, filters } = parsed;
    assertSetFilterModes(filters, ['status', 'account_number']);
    const consolidationStatus = parseConsolidationStatus(query?.consolidationStatus);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = withNatureBlanks(sanitizedFilters ?? filters);
    const effectiveStatus = status ?? statusFromAg;

    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      const mappedFilters = { ...filtersToApply };
      const accountNumberFilter = mappedFilters.account_number;
      delete mappedFilters.account_number;
      // The consolidation number is a number too, filtered on its digits like the account number.
      const consolidationNumberFilter = mappedFilters.consolidation_account_number;
      delete mappedFilters.consolidation_account_number;

      // Special handling for coa_code: look up CoA IDs by code pattern
      if ('coa_code' in mappedFilters) {
        const coaCodeFilter = mappedFilters.coa_code;
        delete mappedFilters.coa_code;

        let model: any = coaCodeFilter;
        if (model && model.operator && Array.isArray(model.conditions) && model.conditions.length > 0) {
          model = model.conditions[0];
        }
        const type = (model?.type ?? model?.filterType ?? 'contains') as string;
        const valRaw = model?.filter ?? model?.value;

        if (valRaw != null && valRaw !== '') {
          const val = String(valRaw);
          let pattern: string;

          switch (type) {
            case 'equals':
              pattern = val;
              break;
            case 'startsWith':
              pattern = `${val}%`;
              break;
            case 'endsWith':
              pattern = `%${val}`;
              break;
            case 'contains':
            default:
              pattern = `%${val}%`;
              break;
          }

          // Look up CoA IDs matching the code pattern
          const coaRows = await (opts?.manager ?? repo.manager).query(
            `SELECT id FROM chart_of_accounts WHERE code ILIKE $1 AND tenant_id = ${CURRENT_TENANT}`,
            [pattern]
          );
          const coaIds = coaRows.map((r: any) => r.id);

          if (coaIds.length > 0) {
            mappedFilters.coa_id = { filterType: 'set', values: coaIds };
          } else {
            // No CoAs match, so no accounts should match
            mappedFilters.coa_id = { filterType: 'equals', filter: '00000000-0000-0000-0000-000000000000' };
          }
        }
      }

      takeExpectedUnitsFilter(mappedFilters, where);
      assertEntityFilterFields(mappedFilters, repo.metadata);
      Object.assign(where, buildWhereFromAgFilters(mappedFilters));
      const accountNumberCondition = accountNumberFilter ? accountNumberWhere(accountNumberFilter) : undefined;
      if (accountNumberCondition) where.account_number = accountNumberCondition;
      const consolidationNumberCondition = consolidationNumberFilter ? accountNumberWhere(consolidationNumberFilter, 'consolidation_number_') : undefined;
      if (consolidationNumberCondition) where.consolidation_account_number = consolidationNumberCondition;
    }
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = effectiveStatus ?? StatusState.ENABLED;
    // "All" lifts only the default scope: an explicit status (query or status column filter) still applies.
    if (matchNone) {
      where.disabled_at = Raw(() => '1 = 0');
    } else if (!includeDisabled || effectiveStatus) {
      if (lifecycleStatus === StatusState.DISABLED) {
        where.disabled_at = Raw((alias) => `${alias} IS NOT NULL AND ${alias} <= NOW()`);
      } else {
        where.disabled_at = Raw((alias) => `${alias} IS NULL OR ${alias} > NOW()`);
      }
    }

    // CoA scoping via companyId or coaId - MUST be applied BEFORE building whereArr
    const companyId = query?.companyId as string | undefined;
    const coaIdParam = query?.coaId as string | undefined;
    if (companyId) {
      const mg = (opts?.manager ?? repo.manager);
      const company = await mg.getRepository(Company).findOne({ where: { id: companyId } });
      if (company) {
        if (company.coa_id) {
          (where as any).coa_id = company.coa_id;
        } else {
          try {
            const rows = await mg.query(`SELECT id FROM chart_of_accounts WHERE is_global_default = true AND tenant_id = ${CURRENT_TENANT} LIMIT 1`);
            const globalId = rows?.[0]?.id as string | undefined;
            if (globalId) (where as any).coa_id = globalId; else (where as any).coa_id = IsNull();
          } catch {
            (where as any).coa_id = IsNull();
          }
        }
      }
    } else if (coaIdParam) {
      (where as any).coa_id = coaIdParam;
    }

    applyConsolidationStatus(where, consolidationStatus);

    let whereArr: any[] | undefined;
    if (q) {
      const like = ILike(`%${q}%`);
      const numQ = accountNumberQuery(q);
      whereArr = [
        { ...where, account_name: like },
        { ...where, description: like },
        { ...where, consolidation_account_name: like },
        { ...where, consolidation_account_description: like },
      ];
      if (numQ !== null) {
        whereArr.push({ ...where, account_number: String(numQ) });
        whereArr.push({ ...where, consolidation_account_number: consolidationNumberEquals(where, numQ) });
      }
    }

    const limit = Math.min(Number(query?.limit) || 10000, 10000);

    // Map virtual fields to actual DB columns for sorting
    const sortField = sort.field === 'coa_code' ? 'coa_id' : sort.field;

    const total = await repo.count({ where: whereArr ?? where });
    const qb = await sortedFindQuery(repo, 'account', whereArr ?? where, { field: sortField, direction: sort.direction });
    const items = await qb.select('account.id').limit(limit).getMany();
    const ids = items.map((i) => i.id);
    return { ids, total };
  }

  async create(body: AccountUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.getRepo().manager;
    const consolidation = { chartId: await lockConsolidationChartId(mg), propagate: true };
    return this.createAccount(body, userId, mg, opts?.audit, consolidation);
  }

  private async createAccount(
    body: AccountUpsertDto,
    userId: string | null | undefined,
    mg: EntityManager,
    audit: AuditSourceOptions | undefined,
    consolidation: ConsolidationContext,
  ) {
    const repo = mg.getRepository(Account);
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    if (!rest.coa_id) {
      throw new BadRequestException('coa_id is required');
    }
    const entityLike: DeepPartial<Account> = {
      ...rest,
      // `account_name` is NOT NULL: a null from the DTO must stay unset, not be written as NULL.
      account_name: rest.account_name ?? undefined,
      account_number: rest.account_number != null ? String(rest.account_number) : undefined,
      consolidation_account_number:
        rest.consolidation_account_number != null ? rest.consolidation_account_number : null,
      quantity_price_expected: expectedSetting(rest.quantity_price_expected),
      expected_units: expectedUnitsSetting(rest.expected_units),
    };
    assertUnitsFollowSetting(entityLike as Account, rest.expected_units);
    const lifecycle = resolveLifecycleState({ nextStatus: statusInput, nextDisabledAt: disabled_at });
    const entity = repo.create({
      ...entityLike,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    await this.deriveConsolidationFields(entity, {
      numberGiven: true,
      numberChanged: true,
      nameGiven: body?.consolidation_account_name !== undefined,
      descriptionGiven: body?.consolidation_account_description !== undefined,
    }, consolidation, mg);
    let saved: Account;
    try {
      saved = await repo.save(entity);
    } catch (e: any) {
      if (e?.code === '23505') {
        // Likely unique on (tenant_id, coa_id, account_number)
        throw new BadRequestException('An account with this number already exists in the selected Chart of Accounts');
      }
      if (numberOutOfRange(e)) throw new BadRequestException(`account_number ${ACCOUNT_NUMBER_RULE}`);
      if (isUnitsWithoutEntry(e)) throw unitsWithoutEntry();
      throw e;
    }
    await this.auditWrite({ recordId: saved.id, action: 'create', before: null, after: saved }, userId, mg, audit, consolidation);
    // A new account of the consolidation chart: accounts already mapped to its number follow it.
    if (consolidation.chartId && saved.coa_id === consolidation.chartId) {
      await this.followConsolidationAccount(saved, [Number(saved.account_number)], userId, mg, audit, consolidation);
    }
    return saved;
  }

  async update(id: string, body: AccountUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.getRepo().manager;
    // The charts' lock first: the account is then read as any role change in progress left it. Then
    // the account's own row, so that two writes of it decide one after the other, each on the row the
    // other committed (`assertUnitsFollowSetting` reads the setting the units depend on).
    const consolidation = { chartId: await lockConsolidationChartId(mg), propagate: true };
    await lockAccountRows(mg, 'id = $1', [id]);
    const existing = await this.get(id, { manager: mg });
    return this.updateAccount(existing, body, userId, mg, opts?.audit, consolidation);
  }

  private async updateAccount(
    existing: Account,
    body: AccountUpsertDto,
    userId: string | null | undefined,
    mg: EntityManager,
    audit: AuditSourceOptions | undefined,
    consolidation: ConsolidationContext,
  ) {
    const repo = mg.getRepository(Account);
    const before = { ...existing };
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    // A field the body leaves undefined keeps its value (the save would skip it anyway).
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) (existing as any)[key] = value;
    }
    if (body?.account_number !== undefined) {
      existing.account_number = body.account_number != null ? String(body.account_number) : before.account_number;
    }
    if (body?.consolidation_account_number !== undefined) {
      existing.consolidation_account_number = body.consolidation_account_number ?? null;
    }
    if (body?.quantity_price_expected !== undefined) {
      existing.quantity_price_expected = expectedSetting(body.quantity_price_expected);
    }
    if (body?.expected_units !== undefined) {
      existing.expected_units = expectedUnitsSetting(body.expected_units);
    }
    assertUnitsFollowSetting(existing, body?.expected_units);
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: before.disabled_at,
      nextStatus: statusInput,
      nextDisabledAt: disabled_at,
    });
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;

    const { chartId } = consolidation;
    const previousNumber = Number(before.account_number);
    const renumbered = Number(existing.account_number) !== previousNumber;
    const wasIn = !!chartId && before.coa_id === chartId;
    const isIn = !!chartId && existing.coa_id === chartId;
    // The accounts that follow this one once it is saved (below): those mapped to its number
    // when it joins the consolidation chart; those mapped to its old or new number when, in
    // the chart, it changes its number, name or description. One that leaves the chart takes
    // nobody along: the accounts mapped to it are then outside, their names kept.
    let followers: number[] = [];
    if (isIn && !wasIn) {
      followers = [Number(existing.account_number)];
    } else if (isIn && (
      renumbered
      || existing.account_name !== before.account_name
      || (existing.description ?? null) !== (before.description ?? null)
    )) {
      followers = [previousNumber, Number(existing.account_number)];
    }
    // Its own self-reference follows a renumbering.
    if (
      wasIn && isIn && renumbered
      && body?.consolidation_account_number === undefined
      && before.consolidation_account_number != null
      && Number(before.consolidation_account_number) === previousNumber
    ) {
      existing.consolidation_account_number = Number(existing.account_number);
    }
    await this.deriveConsolidationFields(existing, {
      numberGiven: body?.consolidation_account_number !== undefined,
      numberChanged: numberOrNull(existing.consolidation_account_number) !== numberOrNull(before.consolidation_account_number),
      nameGiven: body?.consolidation_account_name !== undefined,
      descriptionGiven: body?.consolidation_account_description !== undefined,
    }, consolidation, mg);

    let saved: Account;
    try {
      saved = await repo.save(existing);
    } catch (e: any) {
      if (e?.code === '23505') {
        // Unique violation on (tenant_id, coa_id, account_number)
        throw new BadRequestException('An account with this number already exists in the target Chart of Accounts');
      }
      if (numberOutOfRange(e)) throw new BadRequestException(`account_number ${ACCOUNT_NUMBER_RULE}`);
      if (isUnitsWithoutEntry(e)) throw unitsWithoutEntry();
      throw e;
    }
    await this.auditWrite({ recordId: saved.id, action: 'update', before, after: saved }, userId, mg, audit, consolidation);
    if (followers.length > 0) {
      await this.followConsolidationAccount(saved, followers, userId, mg, audit, consolidation);
    }
    return saved;
  }

  /**
   * The consolidation name and description follow the consolidation number: when the number
   * matches an account of the consolidation chart, they are that account's (the account itself
   * when it is its own consolidation account). Without a match (or without a consolidation
   * chart), what the caller sent is kept, and a new number drops the name and description the
   * caller did not send (they belonged to the previous number). A number set to null clears both.
   */
  private async deriveConsolidationFields(
    account: Account,
    given: { numberGiven: boolean; numberChanged: boolean; nameGiven: boolean; descriptionGiven: boolean },
    consolidation: ConsolidationContext,
    mg: EntityManager,
  ) {
    const number = account.consolidation_account_number;
    if (number == null) {
      if (given.numberGiven) {
        account.consolidation_account_name = null;
        account.consolidation_account_description = null;
      }
      return;
    }
    const { chartId } = consolidation;
    let source: ConsolidationAccount | undefined;
    if (chartId && account.coa_id === chartId && Number(account.account_number) === Number(number)) {
      source = { name: account.account_name, description: account.description ?? null };
    } else if (chartId) {
      source = consolidation.accounts
        ? consolidation.accounts.get(Number(number))
        : (await consolidationAccounts(mg, chartId, [number])).get(Number(number));
    }
    if (source) {
      account.consolidation_account_name = source.name;
      account.consolidation_account_description = source.description;
      return;
    }
    if (given.numberChanged) {
      if (!given.nameGiven) account.consolidation_account_name = null;
      if (!given.descriptionGiven) account.consolidation_account_description = null;
    }
  }

  /**
   * Accounts mapped to `fromNumbers` now point at `source`, an account of the consolidation
   * chart: its number, name and description, with one audit line each. A CSV import into the
   * consolidation chart resyncs once at its end instead (`propagate` false); it keeps the
   * accounts it loaded in line with the rows it writes.
   */
  private async followConsolidationAccount(
    source: Account,
    fromNumbers: number[],
    userId: string | null | undefined,
    mg: EntityManager,
    audit: AuditSourceOptions | undefined,
    consolidation: ConsolidationContext,
  ) {
    const to = { number: Number(source.account_number), name: source.account_name, description: source.description ?? null };
    if (consolidation.accounts) {
      for (const number of fromNumbers) consolidation.accounts.delete(Number(number));
      consolidation.accounts.set(to.number, { name: to.name, description: to.description });
    }
    if (!consolidation.propagate) return;
    await remapToConsolidationAccount(mg, fromNumbers, to, source.id, { userId, audit });
  }

  /** The audit line of an account write: written now, or kept for the caller to write with the others (CSV import). */
  private async auditWrite(
    row: AccountAuditRow,
    userId: string | null | undefined,
    mg: EntityManager,
    audit: AuditSourceOptions | undefined,
    consolidation: ConsolidationContext,
  ) {
    if (consolidation.audits) {
      consolidation.audits.push(row);
      return;
    }
    await this.audit.log(
      {
        table: 'accounts',
        recordId: row.recordId,
        action: row.action,
        before: row.before,
        after: row.after,
        userId,
        source: audit?.source,
        sourceRef: audit?.sourceRef ?? null,
      },
      { manager: mg },
    );
  }

  /**
   * One account with its `consolidation_status` (see `list`) and `line_counts`: the OPEX and
   * CAPEX lines that use it, whatever their status.
   */
  async getWithConsolidationStatus(id: string, opts?: { manager?: EntityManager }) {
    const found = await this.get(id, opts);
    const mg = opts?.manager ?? this.getRepo().manager;
    const lookup = await consolidationLookup(mg, [found.consolidation_account_number]);
    const [counts] = await mg.query(
      `SELECT (SELECT COUNT(*)::int FROM spend_items s WHERE s.tenant_id = $1 AND s.nature = 'opex' AND s.account_id = $2) AS opex,
              (SELECT COUNT(*)::int FROM spend_items c WHERE c.tenant_id = $1 AND c.nature = 'capex' AND c.account_id = $2) AS capex`,
      [found.tenant_id, found.id],
    );
    return {
      ...found,
      consolidation_status: consolidationStatusOf(found.consolidation_account_number, lookup),
      line_counts: { opex: Number(counts?.opex ?? 0), capex: Number(counts?.capex ?? 0) },
    };
  }

  private csvHeaders(includeCoaCode = false): string[] {
    const base = [
      'account_number',
      'account_name',
      'native_name',
      'description',
      'consolidation_account_number',
      'consolidation_account_name',
      'consolidation_account_description',
      'status',
      'nature',
      'quantity_price_expected',
      'expected_units',
    ];
    return includeCoaCode ? ['coa_code', ...base] : base;
  }

  /** Account numbers and codes are text; `format` xlsx writes the same columns in one sheet. */
  async exportCsv<F extends ExportFileFormat = 'csv'>(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; coaId?: string; includeCoaCode?: boolean; language?: CsvLanguage; listQuery?: Record<string, unknown>; format?: F },
  ): Promise<ListExportFile<F>> {
    const language = opts?.language ?? 'en';
    const includeCoa = !!opts?.includeCoaCode;
    const headers = this.csvHeaders(includeCoa);
    const rows: ListExportCell[][] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const where: any = {};
      if (opts?.coaId) where.coa_id = opts.coaId;
      // What the list shows (its search, filters, scope and sort, within the chart when one is
      // given), or the whole register, newest first.
      const listQuery = opts?.listQuery && (opts.coaId ? { ...opts.listQuery, coaId: opts.coaId } : opts.listQuery);
      const items: Account[] = listQuery
        ? (await this.list(listQuery, { manager: opts?.manager, exportAll: true })).items
        : await repo.find({ where, order: { created_at: 'DESC' as any, id: 'ASC' as any } });
      let codeById = new Map<string, string>();
      if (includeCoa) {
        const ids = Array.from(new Set(items.map((a) => a.coa_id).filter(Boolean))) as string[];
        if (ids.length > 0) {
          const coaRows: Array<{ id: string; code: string }> = await repo.manager.query(`SELECT id, code FROM chart_of_accounts WHERE id = ANY($1) AND tenant_id = ${CURRENT_TENANT}`, [ids]);
          codeById = new Map(coaRows.map((r) => [r.id, r.code]));
        }
      }
      for (const a of items) {
        const baseRow: string[] = [
          String(a.account_number ?? ''),
          a.account_name ?? '',
          (a as any).native_name ?? '',
          a.description ?? '',
          a.consolidation_account_number != null ? String(a.consolidation_account_number) : '',
          a.consolidation_account_name ?? '',
          a.consolidation_account_description ?? '',
          String(a.status ?? 'enabled'),
          a.nature ?? '',
          // Yes in the file's language when set, blank otherwise (the setting is never stored false).
          a.quantity_price_expected === true ? formatCsvBoolean(true, language) : '',
          // The units in the file's language, as the budget tab names them ("personnes, jours").
          formatExpectedUnitsCell(a.expected_units, language),
        ];
        rows.push(includeCoa ? [codeById.get(a.coa_id || '') || '', ...baseRow] : baseRow);
      }
    }
    const filename = scope === 'template' ? 'accounts_template.csv' : (opts?.coaId ? 'accounts_coa.csv' : 'accounts.csv');
    return writeListExport({ format: opts?.format ?? ('csv' as F), language, filename, sheetNames: ACCOUNTS_SHEET, headers, rows });
  }

  async importCsv(
    {
      file,
      dryRun,
      userId,
      language,
      dateOrder,
      decimalMark,
      mode = 'replace',
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      userId?: string | null;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
      /**
       * What a row does to an account it updates (`CsvImportMode`); without it, `replace`, as the
       * chart templates load.
       */
      mode?: CsvImportMode;
    },
    /** `audit`: the source of each account's history row (Kad's card); without it, the person's. */
    opts?: { manager?: EntityManager; targetCoaId?: string | undefined; allowCoaCodeColumn?: boolean; updateExisting?: boolean; audit?: AuditSourceOptions },
  ): Promise<MasterDataImportResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    const readLanguage = language ?? 'en';
    const expectedHeaders = this.csvHeaders(!!opts?.allowCoaCodeColumn);
    const buf = uploadedBytes(file);
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: expectedHeaders,
      // A row finds its account by its number (and its chart's code, in a file of several charts):
      // any other column may be absent, and is then never written.
      keys: [opts?.allowCoaCodeColumn ? ['coa_code', 'account_number'] : ['account_number']],
      language: readLanguage,
      dateOrder,
      decimalMark,
    });
    const has = (column: string) => read.present.includes(column);
    const errors: ImportReportError[] = [];
    // Row warnings: the row imports, the dry run says how (leading zeros dropped).
    const warnings: ImportReportError[] = [];
    if (read.headerError) {
      return {
        ok: false, dryRun, total: 0, inserted: 0, updated: 0,
        errors: [read.headerError],
        ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }
    // Validate and normalize
    const repo = this.getRepo(opts?.manager);
    const normalized: (AccountUpsertDto & { account_number: string })[] = [];
    // Each row, with its line, for the values a stored account keeps (`storedRecordValues`).
    const rowOf = new Map<object, CsvDataRow>();
    const coaCodes: Set<string> = new Set();
    // The first line of each account number: a second row of the same account is refused and named,
    // as in the other imports (`CSV_DUPLICATE_KEY`), so that two rows never settle it in silence.
    const firstLineByNumber = new Map<number, number>();
    read.rows.forEach((row) => {
      const line = row.line;
      const problems = rowProblemErrors(row);
      if (problems.length > 0) {
        errors.push(...problems);
        return;
      }
      const refusals = clearRefusals(row, UNCLEARABLE_ACCOUNT_CELLS, mode);
      if (refusals.length > 0) {
        errors.push(...refusals);
        return;
      }
      if (opts?.allowCoaCodeColumn) {
        const code = cellOf(row, 'coa_code');
        if (!opts?.targetCoaId && !code) errors.push({ row: line, message: 'coa_code is required when not importing into a specific CoA', code: 'CSV_ACCOUNT_COA_CODE_REQUIRED' });
        if (code) coaCodes.add(code);
      }
      const numRaw = cellOf(row, 'account_number');
      const name = cellOf(row, 'account_name');
      const statusRaw = cellOf(row, 'status').toLowerCase();
      const consolNumRaw = cellText(row, 'consolidation_account_number', mode);
      const numberCell = csvAccountNumber(numRaw, 'account_number', line);
      const account_number = numberCell.value;
      if (numberCell.tooLong) errors.push(numberCell.tooLong);
      else if (account_number == null) {
        errors.push({ row: line, message: 'account_number is required and must be an integer', code: 'CSV_ACCOUNT_NUMBER_REQUIRED' });
      }
      if (numberCell.leadingZeros) warnings.push(numberCell.leadingZeros);
      // The chart templates (`replace`) keep the first row of a number, as they always loaded.
      if (account_number != null && mode === 'enrich') {
        const firstRow = firstLineByNumber.get(account_number);
        if (firstRow === undefined) firstLineByNumber.set(account_number, line);
        else {
          errors.push(rowError(line, 'account_number', 'CSV_DUPLICATE_KEY', `Same account number as row ${firstRow}.`, {
            columns: 'account_number',
            firstRow,
          }));
        }
      }
      // A blank name the row would write is refused here; one a stored account may keep (`enrich`,
      // or the column absent) once the row is matched.
      if (!name && !keepsStoredValue(row, read.present, 'account_name', mode)) {
        errors.push({ row: line, message: 'account_name is required', code: 'CSV_ACCOUNT_NAME_REQUIRED' });
      }
      if (statusRaw && statusRaw !== 'enabled' && statusRaw !== 'disabled') {
        errors.push({
          row: line,
          message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.`,
          code: 'CSV_ACCOUNT_STATUS_INVALID',
          params: { value: statusRaw },
        });
      }
      const consolidationCell = csvAccountNumber(consolNumRaw, 'consolidation_account_number', line);
      const consolidation_account_number = consolidationCell.value;
      if (consolidationCell.tooLong) errors.push(consolidationCell.tooLong);
      else if (consolNumRaw !== '' && consolidation_account_number == null) {
        errors.push({
          row: line,
          message: 'consolidation_account_number must be an integer when provided',
          code: 'CSV_ACCOUNT_CONSOLIDATION_NUMBER_INVALID',
        });
      }
      if (consolidationCell.leadingZeros) warnings.push(consolidationCell.leadingZeros);
      const natureRaw = cellText(row, 'nature', mode);
      const nature = has('nature') ? csvNature(natureRaw) : undefined;
      if (has('nature') && nature === undefined) {
        errors.push({
          row: line,
          message: `Invalid nature '${natureRaw}'. Use 'opex', 'capex' or leave it empty.`,
          code: 'CSV_ACCOUNT_NATURE_INVALID',
          params: { value: natureRaw },
        });
      }
      // Yes or no in any language: yes sets it, no (or `-`) clears it; never stored false.
      const expectedRaw = cellText(row, 'quantity_price_expected', mode);
      const expected = has('quantity_price_expected') ? parseCsvBoolean(expectedRaw) : undefined;
      if (has('quantity_price_expected') && expected === undefined) {
        // The shared coded error (`errors:CSV_BOOLEAN_INVALID`): the dialog words it in the interface language.
        errors.push(rowError(line, 'quantity_price_expected', 'CSV_BOOLEAN_INVALID', `Invalid value '${expectedRaw}'. Use yes or no.`, { value: expectedRaw }));
      }
      // Units by their code or their word in any language ("personnes, jours"); `-` clears them.
      const unitsRaw = cellText(row, 'expected_units', mode);
      const unitsCell = has('expected_units') ? parseExpectedUnitsCell(unitsRaw) : undefined;
      if (unitsCell && 'unknown' in unitsCell) {
        // Coded (`errors:CSV_ACCOUNT_EXPECTED_UNIT_INVALID`): the dialog names the units in the interface language.
        errors.push(rowError(line, 'expected_units', 'CSV_ACCOUNT_EXPECTED_UNIT_INVALID',
          `Unknown unit '${unitsCell.unknown}'. Use people, days or pieces, separated by commas.`, { value: unitsCell.unknown }));
      }
      // An absent column stays undefined: an update keeps the stored value, a new account takes the default.
      const text = (column: string) => (has(column) ? cellText(row, column, mode) || null : undefined);
      const item = {
        account_number: String(account_number ?? ''),
        account_name: name,
        native_name: text('native_name'),
        description: text('description'),
        ...(has('consolidation_account_number') ? { consolidation_account_number } : {}),
        consolidation_account_name: text('consolidation_account_name'),
        consolidation_account_description: text('consolidation_account_description'),
        ...(has('status') ? { status: statusRaw === 'disabled' ? StatusState.DISABLED : StatusState.ENABLED } : {}),
        ...(has('nature') ? { nature: nature ?? null } : {}),
        ...(has('quantity_price_expected') ? { quantity_price_expected: expectedSetting(expected) } : {}),
        ...(unitsCell && 'units' in unitsCell ? { expected_units: unitsCell.units } : {}),
      };
      normalized.push(item);
      rowOf.set(item, row);
    });
    const coaCodeMixed = () => ({
      ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0,
      errors: [{ row: 0, message: 'All rows must specify the same coa_code or provide ?coaId parameter', code: 'CSV_ACCOUNT_COA_CODE_MIXED' }],
      ignoredColumns: read.ignoredColumns, notices: read.notices,
    });
    // A file of several charts is refused for that first: a number repeated across its charts is
    // not a repeated row of one chart.
    if (!opts?.targetCoaId && opts?.allowCoaCodeColumn && coaCodes.size > 1) return coaCodeMixed();
    if (errors.length > 0) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors, warnings, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    let targetCoaId: string | undefined = opts?.targetCoaId;
    if (!targetCoaId && opts?.allowCoaCodeColumn) {
      // Resolve unique coa_code to id
      const codes = Array.from(coaCodes.values()).filter(Boolean);
      const uniqCodes = Array.from(new Set(codes));
      if (uniqCodes.length !== 1) return coaCodeMixed();
      const code = uniqCodes[0];
      const found = await repo.manager.query(`SELECT id FROM chart_of_accounts WHERE code = $1 AND tenant_id = current_setting('app.current_tenant', true)::uuid LIMIT 1`, [code]);
      if (!found?.[0]?.id) {
        return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: `Unknown coa_code '${code}' for this tenant`, code: 'CSV_ACCOUNT_COA_CODE_UNKNOWN', params: { code } }], ignoredColumns: read.ignoredColumns, notices: read.notices };
      }
      targetCoaId = found[0].id;
    }
    if (!targetCoaId) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: 'Target CoA is required (use ?coaId or include coa_code column)', code: 'CSV_ACCOUNT_COA_REQUIRED' }], ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // One row per account number: the import rule refused a second one above; the chart templates
    // (`replace`) keep the first.
    const uniqueByNumber = new Map<string, AccountUpsertDto>();
    for (const item of normalized) {
      const key = item.account_number as string;
      if (!uniqueByNumber.has(key)) uniqueByNumber.set(key, item);
    }
    const unique = Array.from(uniqueByNumber.values());
    // The consolidation chart, under lock (see `lockConsolidationChartId`), then the target
    // chart's accounts, once: what each row updates (or creates when absent).
    const mg = repo.manager;
    const chartId = await lockConsolidationChartId(mg);
    // A load writes: the target chart's accounts under their row locks, by id, before they are read
    // (as `update` does for one account). A dry run writes nothing and takes none.
    if (!dryRun) await lockAccountRows(mg, 'coa_id = $1', [targetCoaId]);
    const existingByNumber = new Map(
      (await repo.find({ where: { coa_id: targetCoaId } as any })).map((account) => [String(account.account_number), account]),
    );
    // The name cannot be empty: a new account needs one, a stored account keeps its own.
    for (const item of normalized) {
      if (item.account_name || existingByNumber.has(item.account_number)) continue;
      errors.push({ row: rowOf.get(item)!.line, message: 'account_name is required', code: 'CSV_ACCOUNT_NAME_REQUIRED' });
    }
    // Units only on an account that expects quantity and price, as the row leaves it (`assertUnitsFollowSetting`).
    for (const item of normalized) {
      const row = rowOf.get(item)!;
      const existing = existingByNumber.get(item.account_number);
      const written = existing ? storedRecordValues(item, row, read.present, mode) : item;
      if (!written.expected_units) continue;
      const setting = written.quantity_price_expected !== undefined ? written.quantity_price_expected : existing?.quantity_price_expected ?? null;
      if (setting === true) continue;
      errors.push(rowError(row.line, 'expected_units', 'CSV_ACCOUNT_EXPECTED_UNITS_WITHOUT_ENTRY',
        'Expected units need quantity_price_expected set to yes.'));
    }
    if (errors.length > 0) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors, warnings, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // Count inserts, updates and the rows identical to the stored account, which are not written.
    // A stored account takes only the values the row writes: an absent column, or a blank cell when
    // completing, keeps the stored value, the status included.
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const updates: ImportUpdate[] = [];
    // The stored values the rows clear with `-` (a `-` on an empty value is not counted).
    let cleared = 0;
    const toWrite: AccountUpsertDto[] = [];
    for (const fileItem of unique) {
      const existing = existingByNumber.get(fileItem.account_number as string);
      cleared += clearedValueCount(existing, rowOf.get(fileItem)!, mode, CLEARABLE_ACCOUNT_FIELDS);
      const item = existing ? storedRecordValues(fileItem, rowOf.get(fileItem)!, read.present, mode) : fileItem;
      if (!existing) inserted += 1;
      else if (importRowUnchanged(existing, item)) {
        unchanged += 1;
        continue;
      } else {
        updated += 1;
        updates.push({ row: rowOf.get(fileItem)!.line, ref: null, name: `${existing.account_number} ${existing.account_name}` });
      }
      toWrite.push(item);
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total: read.rows.length, inserted, updated, unchanged, cleared, errors: [], warnings, ...listedUpdates(updates), ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // Commit. The consolidation accounts the file refers to are read once, the audit lines of
    // the rows written in one statement at the end.
    const consolidation: ConsolidationContext = {
      chartId,
      accounts: chartId ? await consolidationAccounts(mg, chartId, toWrite.map((item) => item.consolidation_account_number)) : new Map(),
      propagate: false,
      audits: [],
    };
    let processed = 0;
    for (const item of toWrite) {
      const existing = existingByNumber.get(item.account_number as string);
      if (existing) {
        if (opts?.updateExisting === false) {
          // skip updating existing rows
          continue;
        }
        const saved = await this.updateAccount(existing, { ...item, coa_id: targetCoaId }, userId, mg, opts?.audit, consolidation);
        if (saved) processed += 1;
      } else {
        const saved = await this.createAccount({ ...item, coa_id: targetCoaId }, userId, mg, opts?.audit, consolidation);
        if (saved) processed += 1;
      }
    }
    await insertAccountAudits(mg, consolidation.audits ?? [], { userId, audit: opts?.audit });
    // An import into the consolidation chart: the accounts mapped to its numbers take their
    // names and descriptions, in one statement.
    if (chartId && targetCoaId === chartId) {
      await resyncFromChart(mg, chartId, { userId, audit: opts?.audit });
    }
    return { ok: true, dryRun: false, total: read.rows.length, inserted, updated, unchanged, cleared, processed, errors: [], warnings, ...listedUpdates(updates), ignoredColumns: read.ignoredColumns, notices: read.notices };
  }
}
