import { BadRequestException, ConflictException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Raw, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { sameStoredLifecycle, sameStoredValues } from '../common/csv-sheet/unchanged';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink, SupplierContactRole } from '../contacts/supplier-contact.entity';
import { buildWhereFromAgFilters, parseExportPagination, parsePagination } from '../common/pagination';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import * as fs from 'fs';
import { deriveStatusFromDisabledAt, resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { SupplierUpsertDto } from './dto/supplier.dto';
import { assertSetFilterModes } from '../common/ag-grid-filtering';
import { sortedFindQuery } from '../common/list-sort';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  endOfValidityCell,
  endOfValidityOf,
  ImportReportError,
  nameMatchedWarning,
  readMasterDataFile,
  rowProblems,
  writeCsv,
} from '../common/csv-sheet';
import { csvLifecycleConflict } from '../spend/item-write.util';

/** The contact columns of the file: one e-mail per contact type. */
const CONTACT_COLUMNS = ['commercial_contact', 'technical_contact', 'support_contact'] as const;

/** Columns a file may leave out: `disabled_at` came after the first exports. */
const OPTIONAL_CSV_HEADERS = ['disabled_at'];

const SORT_ALIAS = 'supplier';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier) private readonly repo: Repository<Supplier>,
    private readonly audit: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Supplier) : this.repo;
  }

  async list(query: any, opts?: { manager?: EntityManager; exportAll?: boolean }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, status, q, filters } = opts?.exportAll
      ? parseExportPagination(query)
      : parsePagination(query);
    assertSetFilterModes(filters, ['status']);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply));
    }
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = status ?? statusFromAg ?? StatusState.ENABLED;
    // "All" lifts only the default scope: an explicit status (query or status column filter) still applies.
    if (matchNone) {
      where.disabled_at = Raw(() => '1 = 0');
    } else if (!includeDisabled || (status ?? statusFromAg)) {
      if (lifecycleStatus === StatusState.DISABLED) {
        where.disabled_at = Raw((alias) => `${alias} IS NOT NULL AND ${alias} <= NOW()`);
      } else {
        where.disabled_at = Raw((alias) => `${alias} IS NULL OR ${alias} > NOW()`);
      }
    }

    // Build OR conditions for quick search across several text fields, combined with any base filters
    let whereArr: any[] | undefined;
    if (q) {
      const like = ILike(`%${q}%`);
      whereArr = [
        { ...where, name: like },
        { ...where, erp_supplier_id: like },
        { ...where, notes: like },
      ];
    }

    const qb = await sortedFindQuery(repo, SORT_ALIAS, whereArr ?? where, sort);
    const [items, total] = await qb.offset(skip).limit(limit).getManyAndCount();
    return { items, total, page, limit };
  }

  /**
   * Supplier names are unique in the tenant whatever their case ("sap" when "SAP" exists): refused
   * with the same answer as the database's unique key (409 `duplicate`).
   */
  private async assertNameFree(manager: EntityManager, name: string | null | undefined, exceptId?: string) {
    if (!name) return;
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM suppliers
        WHERE tenant_id = app_current_tenant() AND lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)
        LIMIT 1`,
      [name, exceptId ?? null],
    );
    if (rows.length > 0) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'duplicate',
        message: 'Another supplier already has this name.',
      });
    }
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Supplier not found');
    return found;
  }

  async listIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const parsed = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 });
    const { sort, status, q, filters } = parsed;
    assertSetFilterModes(filters, ['status']);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const where: any = {};
    if (filtersToApply && Object.keys(filtersToApply).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filtersToApply));
    }
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const lifecycleStatus = status ?? statusFromAg ?? StatusState.ENABLED;
    // "All" lifts only the default scope: an explicit status (query or status column filter) still applies.
    if (matchNone) {
      where.disabled_at = Raw(() => '1 = 0');
    } else if (!includeDisabled || (status ?? statusFromAg)) {
      if (lifecycleStatus === StatusState.DISABLED) {
        where.disabled_at = Raw((alias) => `${alias} IS NOT NULL AND ${alias} <= NOW()`);
      } else {
        where.disabled_at = Raw((alias) => `${alias} IS NULL OR ${alias} > NOW()`);
      }
    }

    let whereArr: any[] | undefined;
    if (q) {
      const like = ILike(`%${q}%`);
      whereArr = [
        { ...where, name: like },
        { ...where, erp_supplier_id: like },
        { ...where, notes: like },
      ];
    }

    const limit = Math.min(Number(query?.limit) || 10000, 10000);
    const total = await repo.count({ where: whereArr ?? where });
    const qb = await sortedFindQuery(repo, SORT_ALIAS, whereArr ?? where, sort);
    const items = await qb.select(`${SORT_ALIAS}.id`).limit(limit).getMany();
    const ids = items.map((i) => i.id);
    return { ids, total };
  }

  async listFilterValues(query?: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    const rawFields = String(query?.fields || query?.field || '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const allowed = new Set(['erp_supplier_id']);
    const fields = rawFields.filter((field) => allowed.has(field));
    if (fields.length === 0) return {};

    const parseFilters = (value: any): Record<string, any> => {
      if (!value) return {};
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }
      return typeof value === 'object' ? { ...value } : {};
    };

    const baseFilters = parseFilters(query?.filters);
    const results: Record<string, Array<string | null>> = {};

    for (const field of fields) {
      const filtersForField = { ...baseFilters };
      delete filtersForField[field];
      const result = await this.list(
        { ...query, page: 1, limit: 10000, filters: filtersForField, sort: 'name:ASC' },
        { ...opts, exportAll: true },
      );
      const values = new Set<string | null>();
      for (const item of result.items || []) {
        const rawValue = (item as any)?.[field];
        values.add(rawValue == null || rawValue === '' ? null : String(rawValue));
      }
      results[field] = Array.from(values).sort((a, b) => {
        if (a == null) return 1;
        if (b == null) return -1;
        return a.localeCompare(b);
      });
    }

    return results;
  }

  async create(body: SupplierUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    const lifecycle = resolveLifecycleState({ nextStatus: statusInput, nextDisabledAt: disabled_at });
    await this.assertNameFree(repo.manager, rest.name);
    const entity = repo.create({
      ...rest,
      // NOT NULL on the entity while the DTO allows null
      name: rest.name ?? undefined,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);
    await this.audit.log(
      {
        table: 'suppliers',
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

  async update(id: string, body: SupplierUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const existing = await this.get(id, { manager: opts?.manager });
    const before = { ...existing };
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    if (rest.name !== undefined && rest.name !== before.name) await this.assertNameFree(repo.manager, rest.name, id);
    Object.assign(existing, rest);
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: before.disabled_at,
      nextStatus: statusInput,
      nextDisabledAt: disabled_at,
    });
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;
    const saved = await repo.save(existing);
    await this.audit.log(
      {
        table: 'suppliers',
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

  private csvHeaders(): string[] {
    return ['name', 'erp_supplier_id', 'commercial_contact', 'technical_contact', 'support_contact', 'notes', 'status', 'disabled_at'];
  }

  async exportCsv(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; language?: CsvLanguage; listQuery?: Record<string, unknown> },
  ): Promise<{ filename: string; content: string }> {
    const language = opts?.language ?? 'en';
    const headers = this.csvHeaders();
    const rows: string[][] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const mg = opts?.manager ?? repo.manager;
      const linkRepo = mg.getRepository(SupplierContactLink);
      // What the list shows (its search, filters, scope and sort), or the whole register by name.
      const items = opts?.listQuery
        ? (await this.list(opts.listQuery, { manager: opts.manager, exportAll: true })).items
        : await (await sortedFindQuery(repo, SORT_ALIAS, {}, { field: 'name', direction: 'ASC' })).getMany();
      // One contact per supplier and contact type: the primary one first, then the oldest link.
      const firstEmail = new Map<string, string>();
      const links = items.length === 0 ? [] : await linkRepo.find({
        where: { supplier_id: In(items.map((item) => item.id)) },
        relations: ['contact'],
        order: { is_primary: 'DESC' as any, created_at: 'ASC' as any } as any,
      });
      for (const link of links) {
        const key = `${link.supplier_id}:${link.role}`;
        if (!firstEmail.has(key) && link.contact?.email) firstEmail.set(key, link.contact.email);
      }
      const roleEmail = (supplierId: string, role: SupplierContactRole) => firstEmail.get(`${supplierId}:${role}`) ?? '';
      for (const s of items) {
        rows.push([
          s.name ?? '',
          s.erp_supplier_id ?? '',
          roleEmail(s.id, SupplierContactRole.COMMERCIAL),
          roleEmail(s.id, SupplierContactRole.TECHNICAL),
          roleEmail(s.id, SupplierContactRole.SUPPORT),
          s.notes ?? '',
          // Read from the end of validity, so a fresh export never contradicts its own row.
          deriveStatusFromDisabledAt(s.disabled_at),
          endOfValidityCell(s.disabled_at, language),
        ]);
      }
    }
    const filename = scope === 'template' ? 'suppliers_template.csv' : 'suppliers.csv';
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
    opts?: { manager?: EntityManager },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const readLanguage = language ?? 'en';
    const expectedHeaders = this.csvHeaders();
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: expectedHeaders,
      dateFields: ['disabled_at'],
      optional: OPTIONAL_CSV_HEADERS,
      language: readLanguage,
      dateOrder,
      decimalMark,
    });
    const errors: ImportReportError[] = [];
    if (read.headerError) {
      return {
        ok: false, dryRun, total: 0, inserted: 0, updated: 0,
        errors: [read.headerError],
        ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }
    // Validate rows
    let inserted = 0;
    let updated = 0;
    const normalized: Array<{
      line: number;
      body: SupplierUpsertDto;
      commercial_email: string | null;
      technical_email: string | null;
      support_email: string | null;
    }> = [];
    // An absent `disabled_at` column is not a blank cell: the file then sets the lifecycle through `status` alone.
    const hasDisabledAt = read.present.includes('disabled_at');
    // The first line of each name, whatever its case: a supplier takes one row.
    const firstLineByName = new Map<string, number>();
    // The e-mails to find among the contacts, with the cells that name them.
    const contactCells: Array<{ row: number; column: string; email: string }> = [];
    read.rows.forEach((row) => {
      const line = row.line;
      const problems = rowProblems(row, ['disabled_at']);
      if (problems.length > 0) {
        errors.push(...problems.map((message) => ({ row: line, message })));
        return;
      }
      const name = cellOf(row, 'name');
      const statusRaw = cellOf(row, 'status').toLowerCase();
      if (!name) errors.push({ row: line, column: 'name', message: 'Name is required', code: 'CSV_VALUE_REQUIRED' });
      else {
        const firstRow = firstLineByName.get(name.toLowerCase());
        if (firstRow === undefined) firstLineByName.set(name.toLowerCase(), line);
        else {
          errors.push({
            row: line,
            column: 'name',
            message: `'${name}' is already on row ${firstRow}. Keep one row per supplier.`,
            code: 'CSV_SUPPLIER_NAME_DUPLICATE',
            params: { name, firstRow },
          });
        }
      }
      const status = statusRaw === StatusState.ENABLED || statusRaw === StatusState.DISABLED ? (statusRaw as StatusState) : null;
      if (statusRaw && !status) {
        errors.push({
          row: line,
          column: 'status',
          message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.`,
          code: 'CSV_ENUM_INVALID',
          params: { value: statusRaw, allowed: 'enabled, disabled' },
        });
      }
      const disabledAtRaw = hasDisabledAt ? cellOf(row, 'disabled_at') : '';
      let disabledAt: Date | null = null;
      if (disabledAtRaw) {
        const end = endOfValidityOf(row, 'disabled_at');
        if (end.error) {
          errors.push({ row: line, column: 'disabled_at', message: end.error, code: 'CSV_DATE_INVALID', params: { value: disabledAtRaw } });
        } else disabledAt = end.value;
      }
      const conflict = csvLifecycleConflict(status, disabledAt);
      if (conflict) {
        errors.push({
          row: line,
          column: 'status',
          message: conflict,
          code: status === StatusState.ENABLED ? 'CSV_STATUS_DATE_PASSED' : 'CSV_STATUS_DATE_FUTURE',
        });
      }
      const body: SupplierUpsertDto = {
        name,
        erp_supplier_id: cellOf(row, 'erp_supplier_id') || null,
        notes: cellOf(row, 'notes') || null,
        // A date given decides the status (`resolveLifecycleState`); a blank status otherwise enables, as it always has.
        ...(disabledAt ? { status: status ?? undefined, disabled_at: disabledAt.toISOString() } : { status: status ?? StatusState.ENABLED }),
      };
      const emails: Record<string, string | null> = {};
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const column of CONTACT_COLUMNS) {
        const email = cellOf(row, column).toLowerCase() || null;
        emails[column] = email;
        if (!email) continue;
        if (!emailRegex.test(email)) {
          errors.push({ row: line, column, message: `Invalid ${column} email`, code: 'CSV_EMAIL_INVALID', params: { value: email } });
        } else contactCells.push({ row: line, column, email });
      }
      normalized.push({
        line,
        body,
        commercial_email: emails.commercial_contact,
        technical_email: emails.technical_contact,
        support_email: emails.support_contact,
      });
    });
    // A contact must exist already: the import links contacts, it does not create them.
    const contactIdByEmail = await this.contactIdsByEmail(contactCells.map((cell) => cell.email), opts?.manager);
    for (const cell of contactCells) {
      if (contactIdByEmail.has(cell.email)) continue;
      errors.push({
        row: cell.row,
        column: cell.column,
        message: `Contact not found: ${cell.email}. Create it in Contacts first.`,
        code: 'CSV_CONTACT_NOT_FOUND',
        params: { email: cell.email },
      });
    }
    errors.sort((a, b) => a.row - b.row);
    if (errors.length > 0) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // One row per supplier name (a second one is refused above).
    const unique = normalized;

    const repo = this.getRepo(opts?.manager);
    const mg = opts?.manager ?? repo.manager;
    const contactRepo = mg.getRepository(ExternalContact);
    const linkRepo = mg.getRepository(SupplierContactLink);
    // A row matches the supplier of the same name whatever its case ("sap" updates "SAP"). The
    // stored spelling stays, and the report says which supplier the row matched.
    const existingByName = new Map<string, Supplier>();
    const warnings: ImportReportError[] = [];
    for (const item of unique) {
      const name = item.body.name as string;
      const existing = await repo.createQueryBuilder(SORT_ALIAS)
        .where(`${SORT_ALIAS}.tenant_id = app_current_tenant() AND lower(${SORT_ALIAS}.name) = lower(:name)`, { name })
        .getOne();
      if (!existing) continue;
      const warning = nameMatchedWarning(item.line, 'name', name, existing.name);
      if (warning) warnings.push(warning);
      item.body = { ...item.body, name: existing.name };
      existingByName.set(existing.name, existing);
    }
    // The contact links of the matched suppliers, as `${supplierId}:${role}:${email}`: the import only adds links.
    const storedLinks = new Set<string>();
    const existingIds = Array.from(existingByName.values()).map((supplier) => supplier.id);
    if (existingIds.length > 0) {
      const links = await linkRepo.find({ where: { supplier_id: In(existingIds) } });
      const contactIds = Array.from(new Set(links.map((link) => link.contact_id)));
      const emails = new Map(
        (contactIds.length > 0 ? await contactRepo.find({ where: { id: In(contactIds) } }) : [])
          .map((contact) => [contact.id, contact.email]),
      );
      for (const link of links) storedLinks.add(`${link.supplier_id}:${link.role}:${emails.get(link.contact_id)}`);
    }
    const linked = (supplierId: string, email: string | null, role: SupplierContactRole) =>
      !email || storedLinks.has(`${supplierId}:${role}:${email}`);
    let unchanged = 0;
    const toWrite: typeof unique = [];
    for (const item of unique) {
      const existing = existingByName.get(item.body.name as string);
      const { status, ...values } = item.body;
      if (!existing) inserted += 1;
      else if (
        sameStoredValues(existing as any, values as Record<string, unknown>)
        && sameStoredLifecycle(existing, { status, disabled_at: values.disabled_at })
        && linked(existing.id, item.commercial_email, SupplierContactRole.COMMERCIAL)
        && linked(existing.id, item.technical_email, SupplierContactRole.TECHNICAL)
        && linked(existing.id, item.support_email, SupplierContactRole.SUPPORT)
      ) {
        unchanged += 1;
        continue;
      } else updated += 1;
      toWrite.push(item);
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total: read.rows.length, inserted, updated, unchanged, errors: [], warnings, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // Commit changes
    let processed = 0;
    const attachByEmail = async (supplierId: string, email: string | null, role: any) => {
      // Every e-mail of the file was found above: the row is refused otherwise.
      const contactId = email ? contactIdByEmail.get(email) : undefined;
      if (!contactId) return;
      const dup = await linkRepo.findOne({ where: { supplier_id: supplierId, contact_id: contactId, role } });
      if (!dup) await linkRepo.save(linkRepo.create({ supplier_id: supplierId, contact_id: contactId, role, is_primary: false }));
    };
    for (const item of toWrite) {
      const existing = existingByName.get(item.body.name as string);
      if (existing) {
        const saved = await this.update(existing.id, item.body, userId ?? undefined, { manager: opts?.manager });
        await attachByEmail(saved.id, item.commercial_email, SupplierContactRole.COMMERCIAL);
        await attachByEmail(saved.id, item.technical_email, SupplierContactRole.TECHNICAL);
        await attachByEmail(saved.id, item.support_email, SupplierContactRole.SUPPORT);
        if (saved) processed += 1;
      } else {
        const saved = await this.create(item.body, userId ?? undefined, { manager: opts?.manager });
        await attachByEmail(saved.id, item.commercial_email, SupplierContactRole.COMMERCIAL);
        await attachByEmail(saved.id, item.technical_email, SupplierContactRole.TECHNICAL);
        await attachByEmail(saved.id, item.support_email, SupplierContactRole.SUPPORT);
        if (saved) processed += 1;
      }
    }
    return { ok: true, dryRun: false, total: read.rows.length, inserted, updated, unchanged, processed, errors: [], warnings, ignoredColumns: read.ignoredColumns, notices: read.notices };
  }

  /** The tenant's contacts among these e-mails (lowercase), by e-mail. */
  private async contactIdsByEmail(emails: string[], manager?: EntityManager): Promise<Map<string, string>> {
    const wanted = Array.from(new Set(emails));
    if (wanted.length === 0) return new Map();
    const contacts = await (manager ?? this.repo.manager).getRepository(ExternalContact).find({
      where: { email: Raw((alias) => `LOWER(${alias}) = ANY(:emails)`, { emails: wanted }) },
      select: ['id', 'email'],
    });
    return new Map(contacts.map((contact) => [contact.email.toLowerCase(), contact.id]));
  }
}
