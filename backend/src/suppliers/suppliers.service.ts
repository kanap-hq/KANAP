import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOperator, ILike, In, Raw, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { sameStoredLifecycle, sameStoredValues } from '../common/csv-sheet/unchanged';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink, SupplierContactRole } from '../contacts/supplier-contact.entity';
import { assertEntityFilterFields, buildWhereFromAgFilters, parseExportPagination, parsePagination } from '../common/pagination';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { deriveStatusFromDisabledAt, resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { SupplierUpsertDto } from './dto/supplier.dto';
import { assertSetFilterModes, compileReferenceFilter, createParamNameGenerator } from '../common/ag-grid-filtering';
import { parseReferenceNumber } from '../common/parse-item-number';
import { sortedFindQuery } from '../common/list-sort';
import {
  cellOf,
  cellText,
  clearedValueCount,
  clearRefusals,
  clearsCell,
  CsvDataRow,
  CsvDateOrder,
  CsvImportMode,
  CsvLanguage,
  DecimalMark,
  endOfValidityOf,
  keepStoredEndOfValidity,
  ImportReportError,
  keepsStoredValue,
  MasterDataImportResult,
  nameMatchedWarning,
  readMasterDataFile,
  referenceRenameWarning,
  rowError,
  rowProblemErrors,
  storedRecordValues,
} from '../common/csv-sheet';
import { csvLifecycleConflict } from '../spend/item-write.util';
import { duplicateNameException } from '../common/duplicate-name';
import { uploadedBytes } from '../common/upload';
import { endOfValidityDay, ListExportCell, ListExportFile, writeListExport } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';
import { SUPPLIER_FILE_COLUMNS, SUPPLIER_CSV_HEADERS } from './supplier-csv-headers';
import { SupplierContactsService } from './supplier-contacts.service';

/** The contact columns of the file: one e-mail per contact type. */
const CONTACT_COLUMNS = ['commercial_contact', 'technical_contact', 'support_contact'] as const;
const CONTACT_ROLE_OF: Record<(typeof CONTACT_COLUMNS)[number], SupplierContactRole> = {
  commercial_contact: SupplierContactRole.COMMERCIAL,
  technical_contact: SupplierContactRole.TECHNICAL,
  support_contact: SupplierContactRole.SUPPORT,
};

/** The values `-` cannot clear (D21 of 26.11.9): the keys, the status and its end of validity. */
const UNCLEARABLE_CSV_HEADERS = ['reference', 'name', 'status', 'disabled_at'] as const;
/** The values `-` clears on a stored supplier. */
const CLEARABLE_FIELDS = ['erp_supplier_id', 'notes'] as const;

/** The columns a row finds its supplier by: its reference, else its name. A file may leave out any other. */
const KEY_CSV_HEADERS = [['reference'], ['name']] as const;

const SORT_ALIAS = 'supplier';

/** The prefix of a supplier's reference (`SUP-12`), whose number is `item_number`. */
const SUPPLIER_PREFIX = 'SUP';

const supplierReference = (itemNumber: number) => `${SUPPLIER_PREFIX}-${itemNumber}`;

/**
 * The condition on `item_number` of the reference column's filter (`SUP-12`, `12`:
 * `compileReferenceFilter`) and of the quick search's exact reference (`exact`), or undefined when
 * neither filters anything.
 */
function referenceWhere(model: unknown, exact: number | null): FindOperator<number> | undefined {
  const compile = (alias: string) => (model === undefined
    ? null
    : compileReferenceFilter(model, alias, SUPPLIER_PREFIX, createParamNameGenerator('supplier_ref_')));
  const filter = compile('item_number');
  if (!filter && exact == null) return undefined;
  return Raw(
    (alias) => [...(exact != null ? [`${alias} = :supplier_ref_exact`] : []), ...(filter ? [`(${compile(alias)!.sql})`] : [])].join(' AND '),
    { ...(filter?.params ?? {}), ...(exact != null ? { supplier_ref_exact: exact } : {}) },
  );
}

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
    const where = this.listWhere(repo, query, { status, q, filters });
    const qb = await sortedFindQuery(repo, SORT_ALIAS, where, sort);
    const [items, total] = await qb.offset(skip).limit(limit).getManyAndCount();
    return { items, total, page, limit };
  }

  /**
   * The list's conditions: its column filters, the reference column's on the number, its status
   * scope, and the quick search (several text columns, or the supplier a `SUP-12` names), one
   * TypeORM `where` (an array for the search's alternatives). Shared by the list and its id list.
   */
  private listWhere(repo: Repository<Supplier>, query: any, parsed: { status?: any; q?: string; filters?: any }) {
    const { status, q, filters } = parsed;
    assertSetFilterModes(filters, ['status']);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    // The reference column holds a number the grid shows as `SUP-12`: compiled on its own, since a
    // text model on a number column is refused (`assertEntityFilterFields`).
    const { item_number: referenceModel, ...filtersToApply } = (sanitizedFilters ?? filters ?? {}) as Record<string, any>;
    const where: any = {};
    if (Object.keys(filtersToApply).length > 0) {
      assertEntityFilterFields(filtersToApply, repo.metadata);
      Object.assign(where, buildWhereFromAgFilters(filtersToApply));
    }
    const referenceFilter = referenceWhere(referenceModel, null);
    if (referenceFilter) where.item_number = referenceFilter;
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
    if (!q) return where;

    // OR conditions for the quick search across several text fields, combined with any base filters
    const like = ILike(`%${q}%`);
    const whereArr: any[] = [
      { ...where, name: like },
      { ...where, erp_supplier_id: like },
      { ...where, notes: like },
    ];
    // `SUP-12` also finds that supplier. Digits alone, or `SUP-013`, stay text (an ERP ID may read so).
    const exact = parseReferenceNumber(q, SUPPLIER_PREFIX, { prefixRequired: true });
    if (exact != null) whereArr.push({ ...where, item_number: referenceWhere(referenceModel, exact) });
    return whereArr;
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
    if (rows.length > 0) throw duplicateNameException('Another supplier already has this name.');
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Supplier not found');
    return found;
  }

  /** The ids and references of the whole list (up to 10 000), in the grid's order: the record's previous / next band. */
  async listIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const parsed = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 });
    const { sort, status, q, filters } = parsed;
    const where = this.listWhere(repo, query, { status, q, filters });
    const limit = Math.min(Number(query?.limit) || 10000, 10000);
    const total = await repo.count({ where });
    const qb = await sortedFindQuery(repo, SORT_ALIAS, where, sort);
    const items = await qb.select([`${SORT_ALIAS}.id`, `${SORT_ALIAS}.item_number`]).limit(limit).getMany();
    return { ids: items.map((i) => i.id), refs: items.map((i) => supplierReference(i.item_number)), total };
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
    return [...SUPPLIER_FILE_COLUMNS];
  }

  async exportCsv<F extends ExportFileFormat = 'csv'>(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; language?: CsvLanguage; listQuery?: Record<string, unknown>; format?: F },
  ): Promise<ListExportFile<F>> {
    const language = opts?.language ?? 'en';
    const headers = SUPPLIER_FILE_COLUMNS.map((column) => SUPPLIER_CSV_HEADERS[column][language]);
    const rows: ListExportCell[][] = [];
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
          supplierReference(s.item_number),
          s.name ?? '',
          s.erp_supplier_id ?? '',
          roleEmail(s.id, SupplierContactRole.COMMERCIAL),
          roleEmail(s.id, SupplierContactRole.TECHNICAL),
          roleEmail(s.id, SupplierContactRole.SUPPORT),
          s.notes ?? '',
          // Read from the end of validity, so a fresh export never contradicts its own row.
          deriveStatusFromDisabledAt(s.disabled_at),
          endOfValidityDay(s.disabled_at),
        ]);
      }
    }
    const filename = scope === 'template' ? 'suppliers_template.csv' : 'suppliers.csv';
    const sheetNames = { en: 'Suppliers', fr: 'Fournisseurs', de: 'Lieferanten', es: 'Proveedores' };
    return writeListExport({ format: opts?.format ?? ('csv' as F), language, filename, sheetNames, headers, rows });
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
      /** What a row does to a supplier it updates (`CsvImportMode`); without it, `replace`. */
      mode?: CsvImportMode;
    },
    opts?: { manager?: EntityManager },
  ): Promise<MasterDataImportResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    const readLanguage = language ?? 'en';
    const expectedHeaders = this.csvHeaders();
    const buf = uploadedBytes(file);
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: expectedHeaders,
      fieldLabels: SUPPLIER_CSV_HEADERS,
      dateFields: ['disabled_at'],
      keys: KEY_CSV_HEADERS,
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
      row: CsvDataRow;
      /** The row's values for a new supplier; a stored one takes those `storedRecordValues` keeps. */
      body: SupplierUpsertDto;
      /** The reference cell, when filled: the supplier the row updates. */
      reference: string | null;
      /** The stored supplier the row updates (by its reference, else by its name), once matched. */
      target?: Supplier;
      commercial_email: string | null;
      technical_email: string | null;
      support_email: string | null;
      /** The contact roles whose cell holds `-`: their links are removed (T-I4e of 26.11.9). */
      clearedRoles: SupplierContactRole[];
    }> = [];
    // An absent `disabled_at` column is not a blank cell: the file then sets the lifecycle through `status` alone.
    const hasDisabledAt = read.present.includes('disabled_at');
    // The first line of each name, whatever its case: a supplier takes one row.
    const firstLineByName = new Map<string, number>();
    // The e-mails to find among the contacts, with the cells that name them.
    const contactCells: Array<{ row: number; column: string; email: string }> = [];
    read.rows.forEach((row) => {
      const line = row.line;
      const problems = rowProblemErrors(row, ['disabled_at']);
      if (problems.length > 0) {
        errors.push(...problems);
        return;
      }
      const refusals = clearRefusals(row, UNCLEARABLE_CSV_HEADERS, mode);
      if (refusals.length > 0) {
        errors.push(...refusals);
        return;
      }
      const name = cellOf(row, 'name');
      const statusRaw = cellOf(row, 'status').toLowerCase();
      // A row with a reference may leave the name to the stored one (`enrich`): decided once matched.
      if (!name) {
        if (!cellOf(row, 'reference') || !keepsStoredValue(row, read.present, 'name', mode)) {
          errors.push({ row: line, column: 'name', message: 'Name is required', code: 'CSV_VALUE_REQUIRED' });
        }
      } else {
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
        erp_supplier_id: cellText(row, 'erp_supplier_id', mode) || null,
        notes: cellText(row, 'notes', mode) || null,
        // A date given decides the status (`resolveLifecycleState`); a blank status otherwise enables, as it always has.
        ...(disabledAt ? { status: status ?? undefined, disabled_at: disabledAt.toISOString() } : { status: status ?? StatusState.ENABLED }),
      };
      const emails: Record<string, string | null> = {};
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const column of CONTACT_COLUMNS) {
        const email = cellText(row, column, mode).toLowerCase() || null;
        emails[column] = email;
        if (!email) continue;
        if (!emailRegex.test(email)) {
          errors.push({ row: line, column, message: `Invalid ${column} email`, code: 'CSV_EMAIL_INVALID', params: { value: email } });
        } else contactCells.push({ row: line, column, email });
      }
      normalized.push({
        line,
        row,
        body,
        reference: cellOf(row, 'reference') || null,
        commercial_email: emails.commercial_contact,
        technical_email: emails.technical_contact,
        support_email: emails.support_contact,
        clearedRoles: CONTACT_COLUMNS.filter((column) => clearsCell(row, column, mode)).map((column) => CONTACT_ROLE_OF[column]),
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
    const repo = this.getRepo(opts?.manager);
    const mg = opts?.manager ?? repo.manager;
    const contactRepo = mg.getRepository(ExternalContact);
    const linkRepo = mg.getRepository(SupplierContactLink);
    // A filled reference (`SUP-12` or `12`) names the supplier the row updates, its name included;
    // one that names no supplier refuses the row. `SUP-013` is no reference (an ERP ID may read so).
    const referenceNumbers = new Map<string, number | null>();
    for (const item of normalized) {
      if (item.reference) referenceNumbers.set(item.reference, parseReferenceNumber(item.reference, SUPPLIER_PREFIX));
    }
    const wantedNumbers = [...new Set([...referenceNumbers.values()].filter((n): n is number => n != null))];
    const byNumber = new Map<number, Supplier>();
    if (wantedNumbers.length > 0) {
      const found = await repo.createQueryBuilder(SORT_ALIAS)
        .where(`${SORT_ALIAS}.tenant_id = app_current_tenant() AND ${SORT_ALIAS}.item_number = ANY(:numbers)`, { numbers: wantedNumbers })
        .getMany();
      for (const supplier of found) byNumber.set(supplier.item_number, supplier);
    }
    for (const item of normalized) {
      if (!item.reference) continue;
      const number = referenceNumbers.get(item.reference);
      const supplier = number == null ? undefined : byNumber.get(number);
      if (supplier) item.target = supplier;
      else {
        errors.push(rowError(item.line, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', `"${item.reference}" is no reference in this workspace.`, { value: item.reference }));
      }
    }
    errors.sort((a, b) => a.row - b.row);
    if (errors.length > 0) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // One row per supplier name (a second one is refused above).
    const unique = normalized;

    // A row without a reference matches the supplier of the same name whatever its case ("sap"
    // updates "SAP"): the stored spelling stays, and the report says which supplier the row
    // matched. A row with one renames its supplier, to a name no other supplier has. Each supplier
    // takes one row.
    const warnings: ImportReportError[] = [];
    const firstLineById = new Map<string, number>();
    for (const item of unique) {
      const name = item.body.name as string;
      const sameName = name
        ? await repo.createQueryBuilder(SORT_ALIAS)
          .where(`${SORT_ALIAS}.tenant_id = app_current_tenant() AND lower(${SORT_ALIAS}.name) = lower(:name)`, { name })
          .getOne()
        : null;
      if (item.target && sameName && sameName.id !== item.target.id) {
        errors.push(rowError(item.line, 'name', 'CSV_VALUE_TAKEN', `'${name}' is already the name of ${supplierReference(sameName.item_number)}.`,
          { value: name, reference: supplierReference(sameName.item_number) }));
        continue;
      }
      if (!item.target && sameName) {
        const warning = nameMatchedWarning(item.line, 'name', name, sameName.name);
        if (warning) warnings.push(warning);
        item.target = sameName;
      }
      const existing = item.target;
      if (!existing) continue;
      const firstRow = firstLineById.get(existing.id);
      if (firstRow !== undefined) {
        const reference = supplierReference(existing.item_number);
        errors.push(rowError(item.line, item.reference ? 'reference' : 'name', 'CSV_SAME_RECORD',
          `This row updates ${reference}, as row ${firstRow} does. Keep one row per supplier.`, { reference, firstRow }));
        continue;
      }
      firstLineById.set(existing.id, item.line);
      // The name cannot be emptied: a blank name keeps the stored one only when the row completes.
      if (!name && !keepsStoredValue(item.row, read.present, 'name', mode)) {
        errors.push({ row: item.line, column: 'name', message: 'Name is required', code: 'CSV_VALUE_REQUIRED' });
        continue;
      }
      // A file from another workspace names unrelated suppliers by the same references: the check
      // says each name a reference changes (D12).
      if (item.reference && name) {
        const renamed = referenceRenameWarning(item.line, { family: 'supplier', reference: supplierReference(existing.item_number), stored: existing.name, next: name });
        if (renamed) warnings.push(renamed);
      }
      // A stored supplier takes only the values the row writes: an absent column, or a blank cell
      // when completing, keeps the stored value, the status included. The stored end of
      // validity's day keeps its time of day: the export writes the day only.
      const written = storedRecordValues(item.body, item.row, read.present, mode);
      item.body = {
        ...written,
        ...(written.name !== undefined ? { name: item.reference ? name : existing.name } : {}),
        ...(written.disabled_at !== undefined ? { disabled_at: keepStoredEndOfValidity(existing.disabled_at, written.disabled_at) } : {}),
      };
    }
    if (errors.length > 0) {
      errors.sort((a, b) => a.row - b.row);
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // The contact links of the matched suppliers, as `${supplierId}:${role}:${email}`: a filled
    // cell adds one, `-` removes those of its role (`linksOfRole`), a blank cell keeps them.
    const storedLinks = new Set<string>();
    const linksOfRole = new Map<string, SupplierContactLink[]>();
    const existingIds = unique.flatMap((item) => (item.target ? [item.target.id] : []));
    if (existingIds.length > 0) {
      const links = await linkRepo.find({ where: { supplier_id: In(existingIds) } });
      const contactIds = Array.from(new Set(links.map((link) => link.contact_id)));
      const emails = new Map(
        (contactIds.length > 0 ? await contactRepo.find({ where: { id: In(contactIds) } }) : [])
          .map((contact) => [contact.id, contact.email]),
      );
      for (const link of links) {
        storedLinks.add(`${link.supplier_id}:${link.role}:${emails.get(link.contact_id)}`);
        const key = `${link.supplier_id}:${link.role}`;
        linksOfRole.set(key, [...(linksOfRole.get(key) ?? []), link]);
      }
    }
    const linked = (supplierId: string, email: string | null, role: SupplierContactRole) =>
      !email || storedLinks.has(`${supplierId}:${role}:${email}`);
    let unchanged = 0;
    let cleared = 0;
    const removedLinks = (supplierId: string, roles: SupplierContactRole[]) =>
      roles.flatMap((role) => linksOfRole.get(`${supplierId}:${role}`) ?? []);
    const toWrite: typeof unique = [];
    for (const item of unique) {
      const existing = item.target;
      const { status, ...values } = item.body;
      const removed = existing ? removedLinks(existing.id, item.clearedRoles).length : 0;
      cleared += clearedValueCount(existing, item.row, mode, CLEARABLE_FIELDS) + removed;
      if (!existing) inserted += 1;
      else if (
        removed === 0
        && sameStoredValues(existing as any, values as Record<string, unknown>)
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
      return { ok: true, dryRun: true, total: read.rows.length, inserted, updated, unchanged, cleared, errors: [], warnings, ignoredColumns: read.ignoredColumns, notices: read.notices };
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
    // A link `-` removes goes as on the supplier's page: audited, with the contact taken off the
    // supplier's budget lines and contracts where the supplier put it.
    const contactLinks = new SupplierContactsService(linkRepo, this.audit);
    for (const item of toWrite) {
      const existing = item.target;
      if (existing) {
        for (const link of removedLinks(existing.id, item.clearedRoles)) {
          await contactLinks.detach(existing.id, link.id, { manager: mg, tenantId: existing.tenant_id, userId: userId ?? null });
        }
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
    return { ok: true, dryRun: false, total: read.rows.length, inserted, updated, unchanged, cleared, processed, errors: [], warnings, ignoredColumns: read.ignoredColumns, notices: read.notices };
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
