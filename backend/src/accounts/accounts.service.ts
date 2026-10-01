import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, ILike, IsNull, Raw, Repository } from 'typeorm';
import { Account } from './account.entity';
import { Company } from '../companies/company.entity';
import { buildWhereFromAgFilters, parsePagination } from '../common/pagination';
import { compileAgFilterCondition, createParamNameGenerator } from '../common/ag-grid-filtering';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { AccountUpsertDto } from './dto/account.dto';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';

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
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
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
            `SELECT id FROM chart_of_accounts WHERE code ILIKE $1`,
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
            const rows = await mg.query(`SELECT id FROM chart_of_accounts WHERE is_global_default = true LIMIT 1`);
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
        // Also allow numeric match on consolidation_account_number
        whereArr.push({ ...where, consolidation_account_number: numQ });
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
    // Enrich with CoA code for UI
    const ids = Array.from(new Set(items.map((i) => i.coa_id).filter(Boolean))) as string[];
    let codeById = new Map<string, string>();
    if (ids.length > 0) {
      const rows = await repo.manager.query(`SELECT id, code FROM chart_of_accounts WHERE id = ANY($1)`, [ids]);
      codeById = new Map(rows.map((r: any) => [r.id, r.code]));
    }
    const enriched = (items as any[]).map((i) => ({ ...i, coa_code: i.coa_id ? codeById.get(i.coa_id) || '' : '' }));
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
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
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
            `SELECT id FROM chart_of_accounts WHERE code ILIKE $1`,
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
            const rows = await mg.query(`SELECT id FROM chart_of_accounts WHERE is_global_default = true LIMIT 1`);
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
        whereArr.push({ ...where, consolidation_account_number: numQ });
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
    const repo = this.getRepo(opts?.manager);
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
    await this.audit.log(
      {
        table: 'accounts',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
  }

  async update(id: string, body: AccountUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const existing = await this.get(id, { manager: opts?.manager });
    const before = { ...existing };
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    Object.assign(existing, rest);
    if (body?.account_number !== undefined) {
      existing.account_number = body.account_number != null ? String(body.account_number) : existing.account_number;
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
    await this.audit.log(
      {
        table: 'accounts',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
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
    ];
    return includeCoaCode ? ['coa_code', ...base] : base;
  }

  async exportCsv(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; coaId?: string; includeCoaCode?: boolean },
  ): Promise<{ filename: string; content: string }> {
    const includeCoa = !!opts?.includeCoaCode;
    const headers = this.csvHeaders(includeCoa);
    const delimiter = ';';
    const rows: any[] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const where: any = {};
      if (opts?.coaId) where.coa_id = opts.coaId;
      const items = await repo.find({ where, order: { created_at: 'DESC' as any } });
      let codeById = new Map<string, string>();
      if (includeCoa) {
        const ids = Array.from(new Set(items.map((a) => a.coa_id).filter(Boolean))) as string[];
        if (ids.length > 0) {
          const rows = await repo.manager.query(`SELECT id, code FROM chart_of_accounts WHERE id = ANY($1)`, [ids]);
          codeById = new Map(rows.map((r: any) => [r.id, r.code]));
        }
      }
      for (const a of items) {
        const baseRow: any = {
          account_number: a.account_number ?? '',
          account_name: a.account_name ?? '',
          native_name: (a as any).native_name ?? '',
          description: a.description ?? '',
          consolidation_account_number: a.consolidation_account_number ?? '',
          consolidation_account_name: a.consolidation_account_name ?? '',
          consolidation_account_description: a.consolidation_account_description ?? '',
          status: a.status ?? 'enabled',
        };
        rows.push(includeCoa ? { coa_code: codeById.get(a.coa_id || '') || '', ...baseRow } : baseRow);
      }
    }
    const filename = scope === 'template' ? 'accounts_template.csv' : (opts?.coaId ? 'accounts_coa.csv' : 'accounts.csv');
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      if (scope === 'template') {
        const headerLine = headers.join(delimiter) + '\n';
        chunks.push(headerLine);
        stream.end();
      } else {
        for (const row of rows) stream.write(row);
        stream.end();
      }
    });
    const content = '\ufeff' + chunks.join('');
    return { filename, content };
  }

  async importCsv(
    { file, dryRun, userId }: { file: Express.Multer.File; dryRun: boolean; userId?: string | null },
    opts?: { manager?: EntityManager; targetCoaId?: string | undefined; allowCoaCodeColumn?: boolean; updateExisting?: boolean },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const delimiter = ';';
    const expectedHeaders = this.csvHeaders(!!opts?.allowCoaCodeColumn);
    type Row = Record<string, string>;
    const rows: Row[] = [];
    const errors: { row: number; message: string }[] = [];
    let headerOk = false;
    await new Promise<void>((resolve, reject) => {
      const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
      if (!buf) {
        reject(new BadRequestException('Empty upload'));
        return;
      }
      let content: string;
      try {
        content = decodeCsvBufferUtf8OrThrow(buf as Buffer);
      } catch {
        reject(new BadRequestException('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.'));
        return;
      }
      parseString(content, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('headers', (headers: string[]) => {
          const missing = expectedHeaders.filter((h) => !headers.includes(h));
          const extras = headers.filter((h) => !expectedHeaders.includes(h));
          headerOk = missing.length === 0 && extras.length === 0;
          if (!headerOk) {
            errors.push({ row: 0, message: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` });
          }
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Row) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });
    if (!headerOk) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors };
    }
    // Validate and normalize
    const repo = this.getRepo(opts?.manager);
    const normalized: (AccountUpsertDto & { account_number: string })[] = [];
    const coaCodes: Set<string> = new Set();
    rows.forEach((r, idx) => {
      const line = idx + 2;
      if (opts?.allowCoaCodeColumn) {
        const code = (r['coa_code'] ?? '').toString().trim();
        if (!opts?.targetCoaId && !code) errors.push({ row: line, message: 'coa_code is required when not importing into a specific CoA' });
        if (code) coaCodes.add(code);
      }
      const numRaw = (r['account_number'] ?? '').toString().trim();
      const name = (r['account_name'] ?? '').toString().trim();
      const nativeName = ((r['native_name'] ?? '').toString().trim()) || null;
      const statusRaw = (r['status'] ?? 'enabled').toString().trim().toLowerCase();
      const consolNumRaw = (r['consolidation_account_number'] ?? '').toString().trim();
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
      normalized.push({
        account_number: String(account_number ?? ''),
        account_name: name,
        native_name: nativeName,
        description: ((r['description'] ?? '').toString().trim()) || null,
        consolidation_account_number,
        consolidation_account_name: ((r['consolidation_account_name'] ?? '').toString().trim()) || null,
        consolidation_account_description: ((r['consolidation_account_description'] ?? '').toString().trim()) || null,
        status: statusRaw === 'disabled' ? StatusState.DISABLED : StatusState.ENABLED,
      });
    });
    if (errors.length > 0) {
      return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };
    }
    let targetCoaId: string | undefined = opts?.targetCoaId;
    if (!targetCoaId && opts?.allowCoaCodeColumn) {
      // Resolve unique coa_code to id
      const codes = Array.from(coaCodes.values()).filter(Boolean);
      const uniqCodes = Array.from(new Set(codes));
      if (uniqCodes.length !== 1) {
        return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: 'All rows must specify the same coa_code or provide ?coaId parameter' }] };
      }
      const code = uniqCodes[0];
      const found = await repo.manager.query(`SELECT id FROM chart_of_accounts WHERE code = $1 AND tenant_id = current_setting('app.current_tenant', true)::uuid LIMIT 1`, [code]);
      if (!found?.[0]?.id) {
        return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: `Unknown coa_code '${code}' for this tenant` }] };
      }
      targetCoaId = found[0].id;
    }
    if (!targetCoaId) {
      return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors: [{ row: 0, message: 'Target CoA is required (use ?coaId or include coa_code column)' }] };
    }
    // Deduplicate by account_number: keep first occurrence
    const uniqueByNumber = new Map<string, AccountUpsertDto>();
    for (const item of normalized) {
      const key = item.account_number as string;
      if (!uniqueByNumber.has(key)) uniqueByNumber.set(key, item);
    }
    const unique = Array.from(uniqueByNumber.values());
    // Count inserts/updates
    let inserted = 0;
    let updated = 0;
    for (const item of unique) {
      const existing = await repo.findOne({ where: { account_number: item.account_number as string, coa_id: targetCoaId } as any });
      if (existing) updated += 1; else inserted += 1;
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };
    }
    // Commit
    let processed = 0;
    for (const item of unique) {
      const existing = await repo.findOne({ where: { account_number: item.account_number as string, coa_id: targetCoaId } as any });
      if (existing) {
        if (opts?.updateExisting === false) {
          // skip updating existing rows
          continue;
        }
        const saved = await this.update(existing.id, { ...item, coa_id: targetCoaId }, userId ?? undefined, { manager: opts?.manager });
        if (saved) processed += 1;
      } else {
        const saved = await this.create({ ...item, coa_id: targetCoaId }, userId ?? undefined, { manager: opts?.manager });
        if (saved) processed += 1;
      }
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [] };
  }
}
