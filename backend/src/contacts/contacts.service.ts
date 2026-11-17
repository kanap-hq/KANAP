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
  CANNOT_BE_CLEARED,
  cellText,
  clearedValueCount,
  clearRefusals,
  clearsCell,
  CsvDataRow,
  CsvDateOrder,
  CsvImportMode,
  CsvLanguage,
  DecimalMark,
  ImportReportError,
  keepsStoredValue,
  MasterDataImportResult,
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
import {
  accentFreeKey,
  findRecordByName,
  ImportMatchState,
  ImportProposals,
  listedMatches,
  listedRefusedProposals,
  noteNameMatch,
  proposedRecord,
  undoneMatch,
} from '../common/name-matching';
import type { CsvCallerAccess } from '../common/csv/csv-field.types';
import { hasLevel } from '../common/relations/relations-access';
import { SUPPLIER_CONTACT_ROLE_LABELS } from '../ai/import/ai-import-code-labels';
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

/** The prefix of a supplier's reference (`SUP-3`), which the file's supplier column may give. */
const SUPPLIER_PREFIX = 'SUP';

/** The type a supplier gives a contact that has none, as the contact's page does (`DEFAULT_CONTACT_ROLE`). */
const DEFAULT_SUPPLIER_ROLE = SupplierContactRole.COMMERCIAL;

const SUPPLIER_ROLE_CODES = Object.values(SupplierContactRole) as SupplierContactRole[];

/**
 * A contact's type as a file writes it: its code, or the word the contact's page shows in any of the
 * four languages (`Technique`), case and accents aside. Null for anything else.
 */
function supplierRoleOf(cell: string): SupplierContactRole | null {
  const key = accentFreeKey(cell);
  return SUPPLIER_ROLE_CODES.find((code) => [code, ...Object.values(SUPPLIER_CONTACT_ROLE_LABELS).map((labels) => labels[code])]
    .some((word) => !!word && accentFreeKey(word) === key)) ?? null;
}

/** The values `-` clears on a stored contact (D21 of 26.11.9); the keys and `active` refuse it. */
const CLEARABLE_CONTACT_FIELDS = ['first_name', 'last_name', 'job_title', 'phone', 'mobile', 'country', 'notes'] as const;

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

  /**
   * Each contact's type for its main supplier, as `findSupplierRole` reads it for one contact (its
   * main link to that supplier, else any link to it), for many contacts in one read.
   */
  private async storedSupplierRoles(contactIds: string[], opts: TenantOpts): Promise<Map<string, SupplierContactRole>> {
    if (contactIds.length === 0) return new Map();
    const rows: Array<{ contact_id: string; role: SupplierContactRole }> = await this.getLinkRepo(opts.manager).query(
      `SELECT DISTINCT ON (l.contact_id) l.contact_id, l.role
         FROM supplier_contacts l
         JOIN contacts c ON c.id = l.contact_id AND c.tenant_id = l.tenant_id AND c.supplier_id = l.supplier_id
        WHERE l.tenant_id = $1 AND l.contact_id = ANY($2::uuid[])
        ORDER BY l.contact_id, l.is_primary DESC, l.created_at, l.id`,
      [opts.tenantId, contactIds],
    );
    return new Map(rows.map((row) => [row.contact_id, row.role] as const));
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
    // The contact's row is locked first, in the caller's transaction: a second change of the same
    // contact (another import, the screen) waits and reads the links this one leaves, so the contact
    // keeps one primary supplier link.
    await repo.manager.query(`SELECT 1 FROM contacts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [opts.tenantId, id]);
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
  /**
   * The file's columns: the contact's reference (`CTCT-12`) first, which a file may leave out. The
   * main supplier (`supplier_name`, its name or `SUP-n`) and the contact's type for it
   * (`supplier_role`) may be left out too.
   */
  private csvHeaders(): string[] {
    return [
      'reference', 'first_name', 'last_name', 'job_title', 'email', 'phone', 'mobile', 'country',
      'supplier_name', 'supplier_role', 'notes', 'active',
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
      const items: Array<ExternalContact & { supplier_name?: string | null }> = opts.listQuery
        ? (await this.list(opts.listQuery, { ...opts, exportAll: true })).items as any
        : (await repo.find({ where: { tenant_id: opts.tenantId }, relations: ['supplier'], order: { created_at: 'DESC' as any, id: 'ASC' as any } }))
          .map(({ supplier, ...rest }) => ({ ...rest, supplier_name: supplier?.name ?? null }) as any);
      // The type in the file's language, as the contact's page names it; the import reads it back in any language.
      const roles = await this.storedSupplierRoles(items.filter((c) => c.supplier_id).map((c) => c.id), opts);
      const roleWords = SUPPLIER_CONTACT_ROLE_LABELS[opts.language ?? 'en'];
      for (const c of items) {
        const role = c.supplier_id ? roles.get(c.id) : undefined;
        rows.push([
          contactReference(c.item_number),
          c.first_name ?? '',
          c.last_name ?? '',
          c.job_title ?? '',
          c.email ?? '',
          c.phone ?? '',
          c.mobile ?? '',
          c.country ?? '',
          c.supplier_name ?? '',
          role ? roleWords[role] ?? role : '',
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
   *
   * The main supplier (`supplier_name`) is found by its reference (`SUP-3`), else by its name as the
   * contracts import finds one (lot I3 of 26.11.9): exactly, case aside, then accents aside unless the
   * person undid that match (`unmatched`), each match beyond case listed (`matches`); Kad's proposal for
   * a name (`proposals`) comes first. An unknown or ambiguous name refuses the row; no supplier is ever
   * created. `supplier_role` is the contact's type for it, by its code or the page's word in any
   * language; without one, the stored type, else the page's default. Under the clearing rule a blank
   * cell keeps the supplier and `-` removes it (counted in `cleared`), with its type. The supplier is
   * written by `update`, as on the contact's page: the main supplier link, its propagation to the
   * supplier's lines and contracts, and the audit.
   */
  async importCsv(
    {
      file,
      dryRun,
      language,
      dateOrder,
      decimalMark,
      access,
      unmatched,
      proposals,
      mode = 'replace',
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
      /** The person's rights: a supplier's name is found beyond case when they may pick a supplier. Absent: case aside only. */
      access?: CsvCallerAccess;
      /** The matches the person undid, by file column and value: found case aside only. */
      unmatched?: Array<{ column: string; value: string }>;
      /** Kad's proposals, by file column: a value of the file and the name of the record it stands for. */
      proposals?: ImportProposals;
      /** What a row does to a contact it updates (`CsvImportMode`); without it, `replace`. */
      mode?: CsvImportMode;
    },
    opts: WriteOpts,
  ): Promise<MasterDataImportResult & ReturnType<typeof listedMatches> & ReturnType<typeof listedRefusedProposals>> {
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
    const state: ImportMatchState = { matches: new Map(), refused: new Map() };
    const named = () => ({ ...listedMatches(state.matches), ...listedRefusedProposals(state.refused) });
    const report = { ignoredColumns: read.ignoredColumns, notices: read.notices };
    if (read.headerError) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, unchanged: 0, errors: [read.headerError], ...report };
    }
    const errors: ImportReportError[] = [];
    const repo = this.getRepo(opts.manager);

    // The suppliers the supplier column may name, read once when the file carries it.
    type SupplierRow = { id: string; name: string; item_number: number | string | null };
    const suppliersInFile = read.present.includes('supplier_name') || read.present.includes('supplier_role');
    const suppliers: SupplierRow[] = suppliersInFile
      ? await this.getSupplierRepo(opts.manager).query(`SELECT id, name, item_number FROM suppliers WHERE tenant_id = $1`, [opts.tenantId])
      : [];
    const supplierRef = (row: SupplierRow) => `${SUPPLIER_PREFIX}-${Number(row.item_number)}`;
    // As on the contact's page, whose supplier picker a contacts member searches (`SUPPLIER_LOOKUP_ACCESS`).
    const picksSuppliers = !!access && (hasLevel(access, 'suppliers', 'reader') || hasLevel(access, 'contacts', 'member'));
    /** The supplier a cell names (`SUP-3`, else a name), or null with the row's error. */
    const supplierOf = (value: string, line: number): SupplierRow | null => {
      const number = parseReferenceNumber(value, SUPPLIER_PREFIX, { prefixRequired: true });
      const byReference = number == null ? undefined : suppliers.find((row) => Number(row.item_number) === number);
      if (byReference) return byReference;
      const column = 'supplier_name';
      const proposed = proposedRecord<SupplierRow>(state, {
        proposals, unmatched, column, value, line, rows: suppliers, reads: picksSuppliers, caseBlind: false, ref: supplierRef,
      });
      const beyondCase = picksSuppliers && !undoneMatch(unmatched, column, value);
      const found = proposed ?? findRecordByName<SupplierRow>(suppliers, value, { beyondCase, caseBlind: false, label: supplierRef });
      if (found.kind === 'one') {
        if ('how' in found && found.how === 'accents') {
          noteNameMatch(state.matches, {
            column, name: null, value: value.trim(), target: found.row.name, ref: supplierRef(found.row),
            origin: 'server', reason: 'accents', undoable: true,
          }, line);
        }
        return found.row;
      }
      errors.push(found.kind === 'many'
        ? rowError(line, column, 'CSV_NAME_AMBIGUOUS_AMONG', `supplier '${value}' may designate several records: ${found.names.join(', ')}`, { value, names: found.names.join(', ') })
        : rowError(line, column, 'CSV_REFERENCE_NOT_FOUND', `supplier '${value}' not found`, { value }));
      return null;
    };

    // Validate + normalize
    type Norm = Partial<ExternalContact> & { email: string };
    /**
     * What a row says of the contact's main supplier: `supplierId` when it writes the supplier (null
     * removes it), `role` when it gives a type.
     */
    type SupplierCells = { writes: boolean; supplierId: string | null; clears: boolean; role: SupplierContactRole | null };
    /**
     * A row: its values for a new contact (a stored one takes those `storedRecordValues` keeps),
     * its line, its reference cell when filled, and its supplier.
     */
    const normalized: Array<{ item: Norm; line: number; reference: string | null; row: CsvDataRow; supplier: SupplierCells }> = [];
    for (const row of read.rows) {
      const line = row.line;
      const problems = rowProblemErrors(row);
      if (problems.length > 0) {
        errors.push(...problems);
        continue;
      }
      // `-` cannot clear the keys or the status (D21 of 26.11.9); the type goes with the supplier, as
      // the page never leaves a supplier without a type.
      const refusals = clearRefusals(row, ['reference', 'email', 'active'], mode);
      if (clearsCell(row, 'supplier_role', mode) && !clearsCell(row, 'supplier_name', mode)) {
        refusals.push(rowError(line, 'supplier_role', CANNOT_BE_CLEARED, 'supplier_role cannot be cleared.'));
      }
      if (refusals.length > 0) {
        errors.push(...refusals);
        continue;
      }
      const email = cellOf(row, 'email').toLowerCase();
      // A row with a reference may leave the e-mail to the stored one (`enrich`): decided once matched.
      if (!email && (!cellOf(row, 'reference') || !keepsStoredValue(row, read.present, 'email', mode))) { errors.push(rowError(line, 'email', 'CSV_VALUE_REQUIRED', 'email is required')); continue; }
      // Yes or no in any language, or the true/false of older files; blank keeps the default.
      const activeCell = parseCsvBoolean(cellOf(row, 'active'));
      if (activeCell === undefined) { errors.push(rowError(line, 'active', 'CSV_BOOLEAN_INVALID', 'invalid active value', { value: cellOf(row, 'active') })); continue; }
      const active = activeCell ?? undefined;
      const country = cellText(row, 'country', mode);
      if (country && country.length !== 2) { errors.push(rowError(line, 'country', 'CSV_COUNTRY_INVALID', 'country must be 2-letter ISO code', { value: country })); continue; }
      const supplierText = cellText(row, 'supplier_name', mode);
      const writesSupplier = !keepsStoredValue(row, read.present, 'supplier_name', mode);
      const supplier = supplierText ? supplierOf(supplierText, line) : null;
      const roleText = cellText(row, 'supplier_role', mode);
      const role = roleText ? supplierRoleOf(roleText) : null;
      if (roleText && !role) {
        errors.push(rowError(line, 'supplier_role', 'CSV_ENUM_INVALID', 'supplier_role invalid', { value: roleText, allowed: SUPPLIER_ROLE_CODES.join(', ') }));
      }
      normalized.push({
        line,
        row,
        reference: cellOf(row, 'reference') || null,
        item: {
          email,
          first_name: cellText(row, 'first_name', mode) || null,
          last_name: cellText(row, 'last_name', mode) || null,
          job_title: cellText(row, 'job_title', mode) || null,
          phone: cellText(row, 'phone', mode) || null,
          mobile: cellText(row, 'mobile', mode) || null,
          country: country || null,
          notes: cellText(row, 'notes', mode) || null,
          active: active ?? true,
        },
        supplier: { writes: writesSupplier, supplierId: supplier?.id ?? null, clears: clearsCell(row, 'supplier_name', mode), role },
      });
    }
    const rows = read.rows;
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report, ...named() };

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
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report, ...named() };

    // One row per contact: a second row naming the same contact, by its reference or by its e-mail,
    // is refused on its line below.
    const kept = normalized;

    // Emails are stored lower-cased (create, update and this import), so one read finds every existing contact.
    const emails = [...new Set(kept.map((row) => row.item.email).filter(Boolean))];
    const existingRows = emails.length > 0
      ? await repo.find({ where: { tenant_id: opts.tenantId, email: In(emails) as any } })
      : [];
    const existingByEmail = new Map(existingRows.map((row) => [row.email, row] as const));
    // The stored type of each contact the file names, when it carries a supplier column.
    const storedRoles = suppliersInFile
      ? await this.storedSupplierRoles([...new Set([...existingRows, ...targetOf.values()].filter((c) => c.supplier_id).map((c) => c.id))], opts)
      : new Map<string, SupplierContactRole>();
    // Each contact takes one row, each e-mail one contact: refused at the check, never at the load.
    const firstLineById = new Map<string, number>();
    const firstLineByEmail = new Map<string, number>();
    /** A row to compare: its contact's values, and the supplier and type it gives the contact when they change. */
    type Compared = { item: Norm; existing: ExternalContact | undefined; supplier: { supplier_id?: string | null; supplier_role: SupplierContactRole | null } | null };
    const toCompare: Compared[] = [];
    // The stored values the rows clear with `-` (a `-` on an empty value is not counted).
    let cleared = 0;
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
      // The supplier and type the row leaves the contact with, as a supplier choice on its page: the
      // type the row gives, else the stored one, else the default; no supplier, no type.
      const storedSupplierId = existing?.supplier_id ?? null;
      const storedRole = existing ? storedRoles.get(existing.id) ?? null : null;
      let supplier: Compared['supplier'] = null;
      if (row.supplier.writes || row.supplier.role) {
        const supplierId = row.supplier.writes ? row.supplier.supplierId : storedSupplierId;
        if (!supplierId && row.supplier.role) {
          errors.push(rowError(row.line, 'supplier_name', 'CSV_VALUE_REQUIRED', 'supplier_name is required with supplier_role'));
          continue;
        }
        const role = supplierId ? row.supplier.role ?? storedRole ?? DEFAULT_SUPPLIER_ROLE : null;
        // A row that keeps the supplier sends only the type: `update` reads the supplier once it holds
        // the contact's row, so a change of the supplier made meanwhile is kept.
        // A kept supplier changes only by a type the row writes: a row with no type leaves a contact
        // attached without a link (created by the API) as it is.
        if (supplierId !== storedSupplierId) supplier = { supplier_id: supplierId, supplier_role: role };
        else if (supplierId && row.supplier.role && row.supplier.role !== storedRole) supplier = { supplier_role: row.supplier.role };
        if (row.supplier.clears && storedSupplierId) cleared += 1;
      }
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
      cleared += clearedValueCount(existing, row.row, mode, CLEARABLE_CONTACT_FIELDS);
      toCompare.push({ item, existing, supplier });
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report, ...named() };

    // A row equal to the stored contact, its supplier and type included, is unchanged and is not written.
    let inserted = 0, updated = 0, unchanged = 0;
    const toWrite: Array<Compared & { valuesChange: boolean }> = [];
    for (const compared of toCompare) {
      const { item, existing, supplier } = compared;
      const valuesChange = !existing || !sameStoredValues(existing as unknown as Record<string, unknown>, item);
      if (!existing) inserted += 1;
      else if (!valuesChange && !supplier) { unchanged += 1; continue; }
      else updated += 1;
      toWrite.push({ ...compared, valuesChange });
    }
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, unchanged, cleared, errors: [], warnings, ...report, ...named() };

    for (const { item, existing, supplier, valuesChange } of toWrite) {
      let contactId = existing?.id;
      if (existing) {
        // Only the columns the row writes: `existing` was read before any lock, and its supplier is
        // written by `update` below, which locks the row. Like `save` before it, no audit row here.
        if (valuesChange) await repo.update({ tenant_id: opts.tenantId, id: existing.id }, item);
      } else {
        const created = repo.create({ ...item, tenant_id: opts.tenantId });
        contactId = (await repo.save(created)).id;
      }
      // The supplier as the contact's page writes it: its main link, propagated, audited.
      if (supplier && contactId) await this.update(contactId, supplier as Partial<ExternalContact>, { ...opts, manager: repo.manager });
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, unchanged, cleared, errors: [], warnings, ...report, ...named() };
  }
}
