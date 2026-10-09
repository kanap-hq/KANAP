import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Equal, ILike, IsNull, Raw, Repository } from 'typeorm';
import { Account, ACCOUNT_NATURES, AccountNature } from './account.entity';
import { Company } from '../companies/company.entity';
import { buildWhereFromAgFilters, parsePagination } from '../common/pagination';
import { compileAgFilterCondition, createParamNameGenerator, assertSetFilterModes } from '../common/ag-grid-filtering';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import * as fs from 'fs';
import { resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { AccountUpsertDto } from './dto/account.dto';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  readMasterDataFile,
  rowProblems,
  writeCsv,
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

const ACCOUNT_NUMBER_TOKEN = '__account_number__';
const INT4_MAX = 2147483647;

/**
 * `where.account_number` for a grid filter on it: the column is an integer, so
 * a text filter ("contains 60") compares its text, as the grid shows it (an
 * ILIKE on the integer would fail in SQL). A combined model applies each condition.
 */
function accountNumberWhere(rawModel: any) {
  const combined = rawModel && Array.isArray(rawModel.conditions) && rawModel.conditions.length > 0
    && (rawModel.operator === 'AND' || rawModel.operator === 'OR');
  const nextParam = createParamNameGenerator('account_number_');
  const parts = ((combined ? rawModel.conditions : [rawModel]) as any[])
    .map((model) => compileAgFilterCondition(model, { expression: `CAST(${ACCOUNT_NUMBER_TOKEN} AS text)` }, nextParam))
    .filter((part): part is NonNullable<typeof part> => !!part);
  if (parts.length === 0) return undefined;
  const sql = parts.map((part) => `(${part.sql})`).join(combined && rawModel.operator === 'OR' ? ' OR ' : ' AND ');
  const params = Object.assign({}, ...parts.map((part) => part.params));
  return Raw((alias) => sql.split(ACCOUNT_NUMBER_TOKEN).join(alias), params);
}

/** A quick search that can be an account number: an integer within the column's range. */
function accountNumberQuery(q: string): number | null {
  const value = Number(q);
  return Number.isInteger(value) && Math.abs(value) <= INT4_MAX ? value : null;
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

/**
 * The grid's set filter on `nature`: a blank value ('') means "OPEX and CAPEX", stored as NULL,
 * which the set filter matches through a null value.
 */
function withNatureBlanks(filters: any) {
  const model = filters?.nature;
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return filters;
  return { ...filters, nature: { ...model, values: model.values.map((value: unknown) => (value === '' ? null : value)) } };
}

/** A CSV `nature` cell: '' is null (OPEX and CAPEX), undefined an invalid value. */
function csvNature(raw: string): AccountNature | null | undefined {
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  return (ACCOUNT_NATURES as readonly string[]).includes(text) ? (text as AccountNature) : undefined;
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
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

  async list(query: any, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, status, q, filters } = parsePagination(query);
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

      Object.assign(where, buildWhereFromAgFilters(mappedFilters));
      const accountNumberCondition = accountNumberFilter ? accountNumberWhere(accountNumberFilter) : undefined;
      if (accountNumberCondition) where.account_number = accountNumberCondition;
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

    const [items, total] = await repo.findAndCount({
      where: whereArr ?? where,
      order: { [sortField]: sort.direction as any },
      skip,
      take: limit,
    });
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

      Object.assign(where, buildWhereFromAgFilters(mappedFilters));
      const accountNumberCondition = accountNumberFilter ? accountNumberWhere(accountNumberFilter) : undefined;
      if (accountNumberCondition) where.account_number = accountNumberCondition;
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
    const items = await repo.find({
      where: whereArr ?? where,
      order: { [sortField]: sort.direction as any },
      take: limit,
      skip: 0,
      select: ['id'],
    });
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
    };
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
    // The lock first: the account is then read as any role change in progress left it.
    const consolidation = { chartId: await lockConsolidationChartId(mg), propagate: true };
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
      `SELECT (SELECT COUNT(*)::int FROM spend_items s WHERE s.tenant_id = $1 AND s.account_id = $2) AS opex,
              (SELECT COUNT(*)::int FROM capex_items c WHERE c.tenant_id = $1 AND c.account_id = $2) AS capex`,
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
    ];
    return includeCoaCode ? ['coa_code', ...base] : base;
  }

  async exportCsv(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; coaId?: string; includeCoaCode?: boolean; language?: CsvLanguage },
  ): Promise<{ filename: string; content: string }> {
    const language = opts?.language ?? 'en';
    const includeCoa = !!opts?.includeCoaCode;
    const headers = this.csvHeaders(includeCoa);
    const rows: string[][] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const where: any = {};
      if (opts?.coaId) where.coa_id = opts.coaId;
      const items = await repo.find({ where, order: { created_at: 'DESC' as any } });
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
        ];
        rows.push(includeCoa ? [codeById.get(a.coa_id || '') || '', ...baseRow] : baseRow);
      }
    }
    const filename = scope === 'template' ? 'accounts_template.csv' : (opts?.coaId ? 'accounts_coa.csv' : 'accounts.csv');
    return { filename, content: writeCsv({ language, headers, rows }) };
  }

  async importCsv(
    {
      file,
      dryRun,
      userId,
      language,
      dateOrder,
      decimalMark,
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      userId?: string | null;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
    },
    opts?: { manager?: EntityManager; targetCoaId?: string | undefined; allowCoaCodeColumn?: boolean; updateExisting?: boolean },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const readLanguage = language ?? 'en';
    const expectedHeaders = this.csvHeaders(!!opts?.allowCoaCodeColumn);
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: expectedHeaders,
      // Older files have no `nature` column: it then leaves the natures as they are.
      optional: ['nature'],
      language: readLanguage,
      dateOrder,
      decimalMark,
    });
    const hasNature = read.present.includes('nature');
    const errors: { row: number; message: string }[] = [];
    if (read.headerError) {
      return {
        ok: false, dryRun, total: 0, inserted: 0, updated: 0,
        errors: [{ row: 0, message: read.headerError }],
        ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }
    // Validate and normalize
    const repo = this.getRepo(opts?.manager);
    const normalized: (AccountUpsertDto & { account_number: string })[] = [];
    const coaCodes: Set<string> = new Set();
    read.rows.forEach((row) => {
      const line = row.line;
      const problems = rowProblems(row);
      if (problems.length > 0) {
        errors.push(...problems.map((message) => ({ row: line, message })));
        return;
      }
      if (opts?.allowCoaCodeColumn) {
        const code = cellOf(row, 'coa_code');
        if (!opts?.targetCoaId && !code) errors.push({ row: line, message: 'coa_code is required when not importing into a specific CoA' });
        if (code) coaCodes.add(code);
      }
      const numRaw = cellOf(row, 'account_number');
      const name = cellOf(row, 'account_name');
      const nativeName = cellOf(row, 'native_name') || null;
      const statusRaw = cellOf(row, 'status').toLowerCase();
      const consolNumRaw = cellOf(row, 'consolidation_account_number');
      const parseIntStrict = (v: string): number | null => {
        if (v === '') return null;
        const n = Number(v);
        return Number.isInteger(n) ? n : null;
      };
      const account_number = parseIntStrict(numRaw);
      if (account_number == null) errors.push({ row: line, message: 'account_number is required and must be an integer' });
      if (!name) errors.push({ row: line, message: 'account_name is required' });
      if (statusRaw && statusRaw !== 'enabled' && statusRaw !== 'disabled') errors.push({ row: line, message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.` });
      const consolidation_account_number = parseIntStrict(consolNumRaw);
      if (consolNumRaw !== '' && consolidation_account_number == null) errors.push({ row: line, message: 'consolidation_account_number must be an integer when provided' });
      const natureRaw = cellOf(row, 'nature');
      const nature = hasNature ? csvNature(natureRaw) : undefined;
      if (hasNature && nature === undefined) errors.push({ row: line, message: `Invalid nature '${natureRaw}'. Use 'opex', 'capex' or leave it empty.` });
      normalized.push({
        account_number: String(account_number ?? ''),
        account_name: name,
        native_name: nativeName,
        description: cellOf(row, 'description') || null,
        consolidation_account_number,
        consolidation_account_name: cellOf(row, 'consolidation_account_name') || null,
        consolidation_account_description: cellOf(row, 'consolidation_account_description') || null,
        status: statusRaw === 'disabled' ? StatusState.DISABLED : StatusState.ENABLED,
        // Absent column: undefined, so an update keeps the stored nature.
        ...(hasNature ? { nature: nature ?? null } : {}),
      });
    });
    if (errors.length > 0) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    let targetCoaId: string | undefined = opts?.targetCoaId;
    if (!targetCoaId && opts?.allowCoaCodeColumn) {
      // Resolve unique coa_code to id
      const codes = Array.from(coaCodes.values()).filter(Boolean);
      const uniqCodes = Array.from(new Set(codes));
      if (uniqCodes.length !== 1) {
        return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: 'All rows must specify the same coa_code or provide ?coaId parameter' }], ignoredColumns: read.ignoredColumns, notices: read.notices };
      }
      const code = uniqCodes[0];
      const found = await repo.manager.query(`SELECT id FROM chart_of_accounts WHERE code = $1 AND tenant_id = current_setting('app.current_tenant', true)::uuid LIMIT 1`, [code]);
      if (!found?.[0]?.id) {
        return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: `Unknown coa_code '${code}' for this tenant` }], ignoredColumns: read.ignoredColumns, notices: read.notices };
      }
      targetCoaId = found[0].id;
    }
    if (!targetCoaId) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: 'Target CoA is required (use ?coaId or include coa_code column)' }], ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // Deduplicate by account_number: keep first occurrence
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
    const existingByNumber = new Map(
      (await repo.find({ where: { coa_id: targetCoaId } as any })).map((account) => [String(account.account_number), account]),
    );
    // Count inserts/updates
    let inserted = 0;
    let updated = 0;
    for (const item of unique) {
      if (existingByNumber.has(item.account_number as string)) updated += 1; else inserted += 1;
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total: read.rows.length, inserted, updated, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // Commit. The consolidation accounts the file refers to are read once, the audit lines of
    // the rows written in one statement at the end.
    const consolidation: ConsolidationContext = {
      chartId,
      accounts: chartId ? await consolidationAccounts(mg, chartId, unique.map((item) => item.consolidation_account_number)) : new Map(),
      propagate: false,
      audits: [],
    };
    let processed = 0;
    for (const item of unique) {
      const existing = existingByNumber.get(item.account_number as string);
      if (existing) {
        if (opts?.updateExisting === false) {
          // skip updating existing rows
          continue;
        }
        const saved = await this.updateAccount(existing, { ...item, coa_id: targetCoaId }, userId, mg, undefined, consolidation);
        if (saved) processed += 1;
      } else {
        const saved = await this.createAccount({ ...item, coa_id: targetCoaId }, userId, mg, undefined, consolidation);
        if (saved) processed += 1;
      }
    }
    await insertAccountAudits(mg, consolidation.audits ?? [], { userId });
    // An import into the consolidation chart: the accounts mapped to its numbers take their
    // names and descriptions, in one statement.
    if (chartId && targetCoaId === chartId) {
      await resyncFromChart(mg, chartId, { userId });
    }
    return { ok: true, dryRun: false, total: read.rows.length, inserted, updated, processed, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
  }
}
