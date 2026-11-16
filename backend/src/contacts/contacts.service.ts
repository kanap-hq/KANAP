import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { ExternalContact } from './external-contact.entity';
import { SupplierContactLink, SupplierContactRole } from './supplier-contact.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { SupplierContactsContext, SupplierContactsService } from '../suppliers/supplier-contacts.service';
import { parseExportPagination, parsePagination } from '../common/pagination';
import { orderListQuery } from '../common/list-sort';

const CONTACT_TEXT_SORTS = new Set(['last_name', 'first_name', 'email', 'country', 'supplier_name']);
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import {
  formatCsvBoolean,
  parseCsvBoolean,
  cellOf,
  CsvDataRow,
  CsvDateOrder,
  CsvImportMode,
  CsvLanguage,
  DecimalMark,
  ImportReportError,
  keepsStoredValue,
  readMasterDataFile,
  referenceEmailWarning,
  referenceRenameWarning,
  rowError,
  rowProblemErrors,
  storedRecordValues,
} from '../common/csv-sheet';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { assertSetFilterModes, compileAgFilterCondition, compileReferenceFilter, createParamNameGenerator, type FilterTargetConfig } from '../common/ag-grid-filtering';
import { parseReferenceNumber } from '../common/parse-item-number';
import { uploadedBytes } from '../common/upload';
import { ListExportCell, ListExportFile, writeListExport } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';

/** The contact list's column filters (`c` the contact, `s` its supplier). */
const CONTACT_FILTER_TARGETS: Record<string, FilterTargetConfig> = {
  last_name: { expression: 'c.last_name' },
  first_name: { expression: 'c.first_name' },
  job_title: { expression: 'c.job_title' },
  email: { expression: 'c.email' },
  phone: { expression: 'c.phone' },
  mobile: { expression: 'c.mobile' },
  country: { expression: 'c.country' },
  active: { expression: 'c.active', dataType: 'boolean' },
  supplier_id: { expression: 'c.supplier_id' },
  supplier_name: { expression: 's.name' },
  created_at: { expression: 'c.created_at', dataType: 'date' },
};

/** The prefix of a contact's reference (`CTCT-12`), whose number is `item_number`. */
const CONTACT_PREFIX = 'CTCT';

const contactReference = (itemNumber: number) => `${CONTACT_PREFIX}-${itemNumber}`;

/** A contact's name as its page shows it, first then last name; empty when it has none. */
const contactName = (contact: { first_name?: string | null; last_name?: string | null }) =>
  [contact.first_name, contact.last_name].map((part) => part?.trim()).filter(Boolean).join(' ');

/**
 * The grid's column filters on a contact query (`c`, its supplier joined as `s`). The reference
 * column (`item_number`, shown `CTCT-12`) filters on the number, with or without the prefix.
 */
function applyContactFilters(qb: SelectQueryBuilder<ExternalContact>, filters: any) {
  if (!filters || typeof filters !== 'object') return;
  const nextParam = createParamNameGenerator('contact_filter_');
  for (const [field, model] of Object.entries(filters)) {
    const target = CONTACT_FILTER_TARGETS[field];
    const compiled = field === 'item_number'
      ? compileReferenceFilter(model, 'c.item_number', CONTACT_PREFIX, nextParam)
      : target ? compileAgFilterCondition(model, target, nextParam) : null;
    if (compiled) qb.andWhere(`(${compiled.sql})`, compiled.params);
  }
}

/** The quick search: several text columns, or the contact a `CTCT-12` names (digits alone stay text). */
function applyContactSearch(qb: SelectQueryBuilder<ExternalContact>, q: string | undefined) {
  if (!q) return;
  const like = `%${q}%`;
  const exact = parseReferenceNumber(q, CONTACT_PREFIX, { prefixRequired: true });
  qb.andWhere(new Brackets((qb2) => {
    qb2
      .where('c.email ILIKE :like', { like })
      .orWhere('c.first_name ILIKE :like', { like })
      .orWhere('c.last_name ILIKE :like', { like })
      .orWhere('c.phone ILIKE :like', { like })
      .orWhere('c.mobile ILIKE :like', { like })
      .orWhere('s.name ILIKE :like', { like });
    if (exact != null) qb2.orWhere('c.item_number = :contactRef', { contactRef: exact });
  }));
}

/** The sorts of the contact list (the reference column sorts by number). */
const CONTACT_SORT_FIELDS = [
  'item_number', 'last_name', 'first_name', 'email', 'country', 'active', 'created_at', 'updated_at', 'supplier_name',
];

/** The request's tenant: every statement filters on it. */
type TenantOpts = { manager?: EntityManager; tenantId: string };
/** A write also names the user and the audit source. */
type WriteOpts = TenantOpts & { userId?: string | null; audit?: AuditSourceOptions };

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(ExternalContact)
    private readonly repo: Repository<ExternalContact>,
    @InjectRepository(SupplierContactLink)
    private readonly linkRepo: Repository<SupplierContactLink>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @Inject(forwardRef(() => SupplierContactsService))
    private readonly supplierContactsService: SupplierContactsService,
    private readonly audit: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(ExternalContact) : this.repo;
  }

  private getLinkRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(SupplierContactLink) : this.linkRepo;
  }

  private getSupplierRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Supplier) : this.supplierRepo;
  }

  private linkContext(opts: WriteOpts, manager: EntityManager): SupplierContactsContext {
    return { manager, tenantId: opts.tenantId, userId: opts.userId, audit: opts.audit };
  }

  private normalizeSupplierRole(role: any): SupplierContactRole | null {
    if (role === '' || role == null) return null;
    const val = String(role) as SupplierContactRole;
    return (Object.values(SupplierContactRole) as string[]).includes(val) ? val : null;
  }

  /**
   * Make (supplier, role) the contact's only primary supplier link. A primary link
   * it replaces is removed with the links it propagated to OPEX lines, CAPEX lines
   * and contracts (origin 'supplier'); the caller propagates the new one. Every
   * link added, changed or removed is audited.
   */
  private async syncPrimarySupplierLink(
    contactId: string,
    supplierId: string | null,
    role: SupplierContactRole | null,
    opts: WriteOpts,
  ) {
    const linkRepo = this.getLinkRepo(opts.manager);
    const ctx: SupplierContactsContext = { manager: linkRepo.manager, tenantId: opts.tenantId, userId: opts.userId, audit: opts.audit };
    const log = (action: 'create' | 'update' | 'delete', recordId: string, before: unknown, after: unknown) => this.audit.log(
      {
        table: 'supplier_contacts',
        recordId,
        action,
        before: before ?? null,
        after: after ?? null,
        userId: opts.userId ?? null,
        source: opts.audit?.source,
        sourceRef: opts.audit?.sourceRef ?? null,
      },
      { manager: linkRepo.manager },
    );
    const keeps = (link: SupplierContactLink) => !!supplierId && !!role && link.supplier_id === supplierId && link.role === role;

    const primaries = await linkRepo.find({ where: { tenant_id: opts.tenantId, contact_id: contactId, is_primary: true } });
    for (const link of primaries.filter((l) => !keeps(l))) {
      await linkRepo.delete({ tenant_id: opts.tenantId, id: link.id });
      await log('delete', link.id, link, null);
      await this.supplierContactsService.removeContactFromItems(link.supplier_id, contactId, link.role, ctx);
    }
    if (!supplierId || !role) return null;

    // The same (supplier, contact, role) may already be linked without being primary.
    const existing = await linkRepo.findOne({ where: { tenant_id: opts.tenantId, contact_id: contactId, supplier_id: supplierId, role } });
    if (existing?.is_primary) return existing;
    if (existing) {
      const updated = { ...existing, is_primary: true, updated_at: new Date() };
      await linkRepo.update({ tenant_id: opts.tenantId, id: existing.id }, { is_primary: true, updated_at: updated.updated_at });
      await log('update', existing.id, existing, updated);
      return updated;
    }
    const saved = await linkRepo.save(linkRepo.create({ tenant_id: opts.tenantId, contact_id: contactId, supplier_id: supplierId, role, is_primary: true }));
    await log('create', saved.id, null, saved);
    return saved;
  }

  private async findSupplierRole(
    contactId: string,
    supplierId: string | null,
    opts: TenantOpts,
  ): Promise<SupplierContactRole | null> {
    if (!supplierId) return null;
    const linkRepo = this.getLinkRepo(opts.manager);
    const where = { tenant_id: opts.tenantId, contact_id: contactId, supplier_id: supplierId };
    const primary = await linkRepo.findOne({ where: { ...where, is_primary: true } });
    if (primary) return primary.role;
    const anyLink = await linkRepo.findOne({ where });
    return anyLink?.role ?? null;
  }

  async list(query: any, opts: TenantOpts & { exportAll?: boolean }) {
    const repo = this.getRepo(opts.manager);
    const { page, limit, skip, sort, q, filters } = opts.exportAll ? parseExportPagination(query) : parsePagination(query);
    assertSetFilterModes(filters);
    const qb = repo.createQueryBuilder('c').leftJoinAndSelect('c.supplier', 's', 's.tenant_id = c.tenant_id');

    qb.where('c.tenant_id = :tenantId', { tenantId: opts.tenantId });
    applyContactFilters(qb, filters);

    if (typeof query?.active === 'string') {
      const v = String(query.active).toLowerCase();
      if (v === 'true' || v === 'false') qb.andWhere({ active: v === 'true' });
    }

    applyContactSearch(qb, q);

    await this.orderList(qb, CONTACT_SORT_FIELDS, sort);

    qb.skip(skip).take(limit);
    const [items, total] = await qb.getManyAndCount();
    const withSupplier = items.map(({ supplier, ...rest }) => ({ ...rest, supplier_name: supplier?.name ?? null }));
    return { items: withSupplier, total, page, limit };
  }

  /** The list order: text columns alphabetically, then the id. */
  private async orderList(qb: SelectQueryBuilder<ExternalContact>, allowed: string[], sort: { field: string; direction: string }) {
    const field = allowed.includes(sort.field) ? sort.field : 'created_at';
    const expr = field === 'supplier_name' ? 's.name' : `c.${field}`;
    await orderListQuery(qb, expr, sort.direction, { text: CONTACT_TEXT_SORTS.has(field), idExpr: 'c.id' });
  }

  async listIds(query: any, opts: TenantOpts): Promise<{ ids: string[]; total: number }> {
    const repo = this.getRepo(opts.manager);
    const { sort, q, filters } = parsePagination(query);
    assertSetFilterModes(filters);
    const qb = repo.createQueryBuilder('c').leftJoin('c.supplier', 's', 's.tenant_id = c.tenant_id').select('c.id', 'id');

    qb.where('c.tenant_id = :tenantId', { tenantId: opts.tenantId });
    applyContactFilters(qb, filters);

    if (typeof query?.active === 'string') {
      const v = String(query.active).toLowerCase();
      if (v === 'true' || v === 'false') qb.andWhere({ active: v === 'true' });
    }

    applyContactSearch(qb, q);

    await this.orderList(qb, CONTACT_SORT_FIELDS, sort);

    const total = await qb.clone().getCount();
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const rows = await qb.take(limit).getRawMany<{ id: string }>();
    return { ids: rows.map((row) => row.id).filter(Boolean), total };
  }

  async get(id: string, opts: TenantOpts) {
    const repo = this.getRepo(opts.manager);
    const item = await repo.findOne({ where: { tenant_id: opts.tenantId, id }, relations: ['supplier'] });
    if (!item) throw new NotFoundException('Contact not found');
    const supplierRole = await this.findSupplierRole(id, item.supplier_id, opts);
    const { supplier, ...rest } = item as any;
    return {
      ...rest,
      supplier_role: supplierRole ?? null,
      supplier_name: supplier?.name ?? null,
      // The supplier picker's option, reference included, as the supplier lookup gives it.
      supplier_option: supplier
        ? { id: supplier.id, item_number: supplier.item_number, name: supplier.name, erp_supplier_id: supplier.erp_supplier_id ?? null, status: supplier.status }
        : null,
    };
  }

  async create(body: Partial<ExternalContact>, opts: WriteOpts) {
    const repo = this.getRepo(opts.manager);
    const supplierRepo = this.getSupplierRepo(opts.manager);
    if (!body?.email) throw new BadRequestException('email is required');
    const email = String(body.email).trim().toLowerCase();
    const existing = await repo.findOne({ where: { tenant_id: opts.tenantId, email } });
    if (existing) throw new BadRequestException('A contact with this email already exists');
    const supplierId = body?.supplier_id ? String(body.supplier_id) : null;
    const supplierRole = this.normalizeSupplierRole((body as any)?.supplier_role);
    if ((body as any)?.supplier_role != null && !supplierRole) {
      throw new BadRequestException('Invalid supplier role');
    }
    if (supplierRole && !supplierId) {
      throw new BadRequestException('supplier_role requires supplier_id');
    }
    if (supplierId) {
      const supplier = await supplierRepo.findOne({ where: { tenant_id: opts.tenantId, id: supplierId } as any });
      if (!supplier) throw new BadRequestException('Supplier not found');
    }
    const entity = repo.create({
      tenant_id: opts.tenantId,
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      job_title: body.job_title ?? null,
      email,
      phone: body.phone ?? null,
      mobile: body.mobile ?? null,
      country: body.country ?? null,
      notes: body.notes ?? null,
      active: body.active ?? true,
      supplier_id: supplierId,
    });
    const saved = await repo.save(entity);
    await this.syncPrimarySupplierLink(saved.id, supplierId, supplierRole, { ...opts, manager: repo.manager });

    // Propagate contact to linked items when created with supplier+role
    if (supplierId && supplierRole) {
      await this.supplierContactsService.propagateContactToItems(supplierId, saved.id, supplierRole, this.linkContext(opts, repo.manager));
    }

    const supplier_role = await this.findSupplierRole(saved.id, supplierId, opts);
    await this.audit.log(
      {
        table: 'contacts',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: { ...saved, supplier_role },
        userId: opts.userId ?? null,
        source: opts.audit?.source,
        sourceRef: opts.audit?.sourceRef ?? null,
      },
      { manager: opts.manager ?? repo.manager },
    );
    return { ...saved, supplier_role };
  }

  async update(id: string, body: Partial<ExternalContact>, opts: WriteOpts) {
    const repo = this.getRepo(opts.manager);
    const supplierRepo = this.getSupplierRepo(opts.manager);
    const existing = await repo.findOne({ where: { tenant_id: opts.tenantId, id } });
    if (!existing) throw new NotFoundException('Contact not found');
    const beforeRole = await this.findSupplierRole(id, existing.supplier_id, opts);
    const before = { ...existing, supplier_role: beforeRole };
    const supplierRoleProvided = Object.prototype.hasOwnProperty.call(body, 'supplier_role');
    const supplierRole = supplierRoleProvided ? this.normalizeSupplierRole((body as any).supplier_role) : null;
    if (supplierRoleProvided && (body as any).supplier_role != null && !supplierRole) {
      throw new BadRequestException('Invalid supplier role');
    }
    if (body.email) {
      const email = String(body.email).trim().toLowerCase();
      if (email !== existing.email) {
        const dup = await repo.findOne({ where: { tenant_id: opts.tenantId, email } });
        if (dup) throw new BadRequestException('A contact with this email already exists');
        existing.email = email;
      }
    }
    // Assign only when properties are present in the payload.
    // This allows setting fields to null (clearing values) without being skipped by '??'.
    const has = (k: keyof ExternalContact | string) => Object.prototype.hasOwnProperty.call(body, k);
    if (has('first_name')) existing.first_name = (body as any).first_name ?? null;
    if (has('last_name')) existing.last_name = (body as any).last_name ?? null;
    if (has('job_title')) existing.job_title = (body as any).job_title ?? null;
    if (has('phone')) existing.phone = (body as any).phone ?? null;
    if (has('mobile')) existing.mobile = (body as any).mobile ?? null;
    if (has('country')) existing.country = (body as any).country ?? null;
    if (has('notes')) existing.notes = (body as any).notes ?? null;
    if (has('supplier_id')) {
      const rawSupplierId = (body as any).supplier_id;
      const supplierId = rawSupplierId ? String(rawSupplierId) : null;
      if (supplierId) {
        const supplier = await supplierRepo.findOne({ where: { tenant_id: opts.tenantId, id: supplierId } as any });
        if (!supplier) throw new BadRequestException('Supplier not found');
      }
      existing.supplier_id = supplierId;
    }
    if (supplierRoleProvided && supplierRole && !existing.supplier_id) {
      throw new BadRequestException('supplier_role requires supplier_id');
    }
    if (typeof body.active === 'boolean') existing.active = body.active;
    const saved = await repo.save(existing);
    if (supplierRoleProvided || has('supplier_id')) {
      const roleForSync = supplierRoleProvided ? supplierRole ?? null : await this.findSupplierRole(saved.id, saved.supplier_id, opts);
      await this.syncPrimarySupplierLink(saved.id, saved.supplier_id, roleForSync, { ...opts, manager: repo.manager });

      // Propagate contact to linked items (spend, capex, contracts) when supplier+role is set
      if (saved.supplier_id && roleForSync) {
        await this.supplierContactsService.propagateContactToItems(saved.supplier_id, saved.id, roleForSync, this.linkContext(opts, repo.manager));
      }
    }
    const supplier_role = await this.findSupplierRole(saved.id, saved.supplier_id, opts);
    await this.audit.log(
      {
        table: 'contacts',
        recordId: saved.id,
        action: 'update',
        before,
        after: { ...saved, supplier_role },
        userId: opts.userId ?? null,
        source: opts.audit?.source,
        sourceRef: opts.audit?.sourceRef ?? null,
      },
      { manager: opts.manager ?? repo.manager },
    );
    return { ...saved, supplier_role };
  }

  /**
   * Delete a contact and its supplier links, one audit row each. Its links on
   * OPEX lines, CAPEX lines, contracts, applications, assets and locations go
   * with it (ON DELETE CASCADE).
   */
  async delete(id: string, opts: WriteOpts) {
    const repo = this.getRepo(opts.manager);
    const linkRepo = this.getLinkRepo(opts.manager);
    const existing = await repo.findOne({ where: { tenant_id: opts.tenantId, id } });
    if (!existing) return { ok: true };
    const log = (table: string, recordId: string, before: unknown) => this.audit.log(
      {
        table,
        recordId,
        action: 'delete',
        before,
        after: null,
        userId: opts.userId ?? null,
        source: opts.audit?.source,
        sourceRef: opts.audit?.sourceRef ?? null,
      },
      { manager: repo.manager },
    );
    // Ensure links are removed first
    const links = await linkRepo.find({ where: { tenant_id: opts.tenantId, contact_id: id } });
    if (links.length > 0) {
      await linkRepo.delete({ tenant_id: opts.tenantId, id: In(links.map((l) => l.id)) as any });
      for (const link of links) await log('supplier_contacts', link.id, link);
    }
    await repo.delete({ tenant_id: opts.tenantId, id });
    await log('contacts', id, existing);
    return { ok: true };
  }

  // CSV helpers for contacts
  /** The file's columns: the contact's reference (`CTCT-12`) first, which a file may leave out. */
  private csvHeaders(): string[] {
    return [
      'reference', 'first_name', 'last_name', 'job_title', 'email', 'phone', 'mobile', 'country', 'notes', 'active'
    ];
  }

  /** The contacts file in the screen's language (`common/csv-sheet`): its separator, BOM and formula guard. */
  async exportCsv<F extends ExportFileFormat = 'csv'>(
    scope: 'template' | 'data',
    opts: TenantOpts & { language?: CsvLanguage; listQuery?: Record<string, unknown>; format?: F },
  ): Promise<ListExportFile<F>> {
    const repo = this.getRepo(opts.manager);
    const headers = this.csvHeaders();
    const rows: ListExportCell[][] = [];
    if (scope === 'data') {
      // What the list shows (its search, filters and sort), or the whole register, newest first.
      const items: ExternalContact[] = opts.listQuery
        ? (await this.list(opts.listQuery, { ...opts, exportAll: true })).items as any
        : await repo.find({ where: { tenant_id: opts.tenantId }, order: { created_at: 'DESC' as any, id: 'ASC' as any } });
      for (const c of items) {
        rows.push([
          contactReference(c.item_number),
          c.first_name ?? '',
          c.last_name ?? '',
          c.job_title ?? '',
          c.email ?? '',
          c.phone ?? '',
          c.mobile ?? '',
          c.country ?? '',
          c.notes ?? '',
          formatCsvBoolean(!!c.active, opts.language ?? 'en'),
        ]);
      }
    }
    const filename = scope === 'template' ? 'contacts_template.csv' : 'contacts.csv';
    const sheetNames = { en: 'Contacts', fr: 'Contacts', de: 'Kontakte', es: 'Contactos' };
    return writeListExport({ format: opts.format ?? ('csv' as F), language: opts.language ?? 'en', filename, sheetNames, headers, rows });
  }

  /**
   * Reads the contacts file through the shared layer: either separator, UTF-8 or Windows-1252,
   * physical line numbers. A row with a reference (`CTCT-12` or `12`) updates that contact, its
   * e-mail included, and an unknown one refuses the row; a row without one is matched by email. A
   * row equal to the stored contact is unchanged and is not written.
   */
  async importCsv(
    {
      file,
      dryRun,
      language,
      dateOrder,
      decimalMark,
      mode = 'replace',
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
      /** What a row does to a contact it updates (`CsvImportMode`); without it, `replace`. */
      mode?: CsvImportMode;
    },
    opts: TenantOpts,
  ) {
    const buf = uploadedBytes(file);
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: this.csvHeaders(),
      // A row finds its contact by its reference, else its e-mail: a file may leave out any other column.
      keys: [['reference'], ['email']],
      language: language ?? 'en',
      dateOrder,
      decimalMark,
    });
    const report = { ignoredColumns: read.ignoredColumns, notices: read.notices };
    if (read.headerError) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, unchanged: 0, errors: [read.headerError], ...report };
    }
    const errors: ImportReportError[] = [];
    const repo = this.getRepo(opts.manager);

    // Validate + normalize
    type Norm = Partial<ExternalContact> & { email: string };
    /**
     * A row: its values for a new contact (a stored one takes those `storedRecordValues` keeps),
     * its line, and its reference cell when filled.
     */
    const normalized: Array<{ item: Norm; line: number; reference: string | null; row: CsvDataRow }> = [];
    for (const row of read.rows) {
      const line = row.line;
      const problems = rowProblemErrors(row);
      if (problems.length > 0) {
        errors.push(...problems);
        continue;
      }
      const email = cellOf(row, 'email').toLowerCase();
      // A row with a reference may leave the e-mail to the stored one (`enrich`): decided once matched.
      if (!email && (!cellOf(row, 'reference') || !keepsStoredValue(row, read.present, 'email', mode))) { errors.push(rowError(line, 'email', 'CSV_VALUE_REQUIRED', 'email is required')); continue; }
      // Yes or no in any language, or the true/false of older files; blank keeps the default.
      const activeCell = parseCsvBoolean(cellOf(row, 'active'));
      if (activeCell === undefined) { errors.push(rowError(line, 'active', 'CSV_BOOLEAN_INVALID', 'invalid active value', { value: cellOf(row, 'active') })); continue; }
      const active = activeCell ?? undefined;
      const country = cellOf(row, 'country');
      if (country && country.length !== 2) { errors.push(rowError(line, 'country', 'CSV_COUNTRY_INVALID', 'country must be 2-letter ISO code', { value: country })); continue; }
      normalized.push({
        line,
        row,
        reference: cellOf(row, 'reference') || null,
        item: {
          email,
          first_name: cellOf(row, 'first_name') || null,
          last_name: cellOf(row, 'last_name') || null,
          job_title: cellOf(row, 'job_title') || null,
          phone: cellOf(row, 'phone') || null,
          mobile: cellOf(row, 'mobile') || null,
          country: country || null,
          notes: cellOf(row, 'notes') || null,
          active: active ?? true,
        },
      });
    }
    const rows = read.rows;
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report };

    // The contacts the references name; an unknown reference (or `CTCT-013`, no reference) refuses its row.
    const numberOf = (reference: string) => parseReferenceNumber(reference, CONTACT_PREFIX);
    const wantedNumbers = [...new Set(normalized.flatMap((row) => {
      const number = row.reference ? numberOf(row.reference) : null;
      return number == null ? [] : [number];
    }))];
    const byNumber = new Map(
      (wantedNumbers.length > 0
        ? await repo.find({ where: { tenant_id: opts.tenantId, item_number: In(wantedNumbers) as any } })
        : []).map((contact) => [contact.item_number, contact] as const),
    );
    const targetOf = new Map<number, ExternalContact>();
    for (const row of normalized) {
      if (!row.reference) continue;
      const number = numberOf(row.reference);
      const contact = number == null ? undefined : byNumber.get(number);
      if (contact) targetOf.set(row.line, contact);
      else errors.push(rowError(row.line, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', `"${row.reference}" is no reference in this workspace.`, { value: row.reference }));
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report };

    // One row per contact: a second row naming the same contact, by its reference or by its e-mail,
    // is refused on its line below.
    const kept = normalized;

    // Emails are stored lower-cased (create, update and this import), so one read finds every existing contact.
    const emails = [...new Set(kept.map((row) => row.item.email).filter(Boolean))];
    const existingRows = emails.length > 0
      ? await repo.find({ where: { tenant_id: opts.tenantId, email: In(emails) as any } })
      : [];
    const existingByEmail = new Map(existingRows.map((row) => [row.email, row] as const));
    // Each contact takes one row, each e-mail one contact: refused at the check, never at the load.
    const firstLineById = new Map<string, number>();
    const firstLineByEmail = new Map<string, number>();
    const toCompare: Array<{ item: Norm; existing: ExternalContact | undefined }> = [];
    // A file from another workspace names unrelated contacts by the same references: the check says
    // each name and each e-mail address a reference changes (D12). It blocks nothing.
    const warnings: ImportReportError[] = [];
    for (const row of kept) {
      const target = targetOf.get(row.line);
      // The e-mail cannot be emptied: a blank one keeps the stored address only when the row completes.
      if (target && !row.item.email && !keepsStoredValue(row.row, read.present, 'email', mode)) {
        errors.push(rowError(row.line, 'email', 'CSV_VALUE_REQUIRED', 'email is required'));
        continue;
      }
      const holder = row.item.email ? existingByEmail.get(row.item.email) : undefined;
      if (target && holder && holder.id !== target.id) {
        const reference = contactReference(holder.item_number);
        errors.push(rowError(row.line, 'email', 'CSV_VALUE_TAKEN', `'${row.item.email}' is already the email of ${reference}.`, { value: row.item.email, reference }));
        continue;
      }
      const existing = target ?? holder;
      const firstRow = existing ? firstLineById.get(existing.id) : undefined;
      if (existing && firstRow !== undefined) {
        const reference = contactReference(existing.item_number);
        errors.push(rowError(row.line, row.reference ? 'reference' : 'email', 'CSV_SAME_RECORD',
          `This row updates ${reference}, as row ${firstRow} does. Keep one row per contact.`, { reference, firstRow }));
        continue;
      }
      const firstEmailRow = row.item.email ? firstLineByEmail.get(row.item.email) : undefined;
      if (firstEmailRow !== undefined) {
        errors.push(rowError(row.line, 'email', 'CSV_DUPLICATE_KEY', `Same email as row ${firstEmailRow}.`, { columns: 'email', firstRow: firstEmailRow }));
        continue;
      }
      if (existing) firstLineById.set(existing.id, row.line);
      if (row.item.email) firstLineByEmail.set(row.item.email, row.line);
      // A stored contact takes only the values the row writes: an absent column, or a blank cell
      // when completing, keeps the stored value, `active` included.
      const item = (existing ? storedRecordValues(row.item, row.row, read.present, mode) : row.item) as Norm;
      if (target) {
        const reference = contactReference(target.item_number);
        const stored = contactName(target);
        const next = contactName({ ...target, ...item });
        // A contact without a name, or a row that leaves the names empty, renames nothing a person reads.
        const renamed = stored && next ? referenceRenameWarning(row.line, { family: 'contact', reference, stored, next }) : null;
        if (renamed) warnings.push(renamed);
        const readdressed = item.email ? referenceEmailWarning(row.line, { reference, name: stored || target.email, stored: target.email, next: item.email }) : null;
        if (readdressed) warnings.push(readdressed);
      }
      toCompare.push({ item, existing });
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report };

    // A row equal to the stored contact is unchanged and is not written. The import sets
    // only columns of `contacts` (no supplier link), so those columns are all it compares.
    let inserted = 0, updated = 0, unchanged = 0;
    const toWrite: Array<{ item: Norm; existing: ExternalContact | undefined }> = [];
    for (const { item, existing } of toCompare) {
      if (!existing) inserted += 1;
      else if (sameStoredValues(existing as unknown as Record<string, unknown>, item)) { unchanged += 1; continue; }
      else updated += 1;
      toWrite.push({ item, existing });
    }
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, unchanged, errors: [], warnings, ...report };

    for (const { item, existing } of toWrite) {
      if (existing) {
        Object.assign(existing, item);
        await repo.save(existing);
      } else {
        const created = repo.create({ ...item, tenant_id: opts.tenantId });
        await repo.save(created);
      }
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, unchanged, errors: [], warnings, ...report };
  }
}
