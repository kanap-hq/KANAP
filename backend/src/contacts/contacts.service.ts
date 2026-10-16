import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { ExternalContact } from './external-contact.entity';
import { SupplierContactLink, SupplierContactRole } from './supplier-contact.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { SupplierContactsContext, SupplierContactsService } from '../suppliers/supplier-contacts.service';
import { buildWhereFromAgFilters, parseExportPagination, parsePagination } from '../common/pagination';
import { orderListQuery } from '../common/list-sort';

const CONTACT_TEXT_SORTS = new Set(['last_name', 'first_name', 'email', 'country', 'supplier_name']);
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import {
  formatCsvBoolean,
  parseCsvBoolean,
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  ImportReportError,
  readMasterDataFile,
  rowProblems,
  writeCsv,
} from '../common/csv-sheet';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { assertSetFilterModes } from '../common/ag-grid-filtering';
import { uploadedBytes } from '../common/upload';

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
    const allowedSortFields = [
      'last_name', 'first_name', 'email', 'country', 'active', 'created_at', 'updated_at', 'supplier_name'
    ];
    const qb = repo.createQueryBuilder('c').leftJoinAndSelect('c.supplier', 's', 's.tenant_id = c.tenant_id');

    const filterWhere = buildWhereFromAgFilters(filters, ['last_name', 'first_name', 'email', 'phone', 'mobile', 'country', 'active', 'supplier_id']);
    if (Object.keys(filterWhere).length > 0) qb.where(filterWhere);
    qb.andWhere('c.tenant_id = :tenantId', { tenantId: opts.tenantId });

    const supplierNameFilter = filters?.supplier_name;
    if (supplierNameFilter) {
      let model: any = supplierNameFilter;
      if (model && model.operator && Array.isArray(model.conditions) && model.conditions.length > 0) {
        model = model.conditions[0];
      }
      const type = (model?.type ?? model?.filterType ?? 'contains') as string;
      const valRaw = model?.filter ?? model?.value ?? (Array.isArray(model?.values) ? model.values[0] : undefined);
      const requiresValue = !(type === 'blank' || type === 'notBlank');
      if (!requiresValue || (valRaw != null && valRaw !== '')) {
        const val = valRaw != null ? String(valRaw) : '';
        switch (type) {
          case 'equals':
            qb.andWhere('s.name ILIKE :supplierFilterEq', { supplierFilterEq: val });
            break;
          case 'notEqual':
            qb.andWhere('s.name NOT ILIKE :supplierFilterNe', { supplierFilterNe: val });
            break;
          case 'startsWith':
            qb.andWhere('s.name ILIKE :supplierFilterSw', { supplierFilterSw: `${val}%` });
            break;
          case 'endsWith':
            qb.andWhere('s.name ILIKE :supplierFilterEw', { supplierFilterEw: `%${val}` });
            break;
          case 'notContains':
            qb.andWhere('s.name NOT ILIKE :supplierFilterNc', { supplierFilterNc: `%${val}%` });
            break;
          case 'blank':
            qb.andWhere("(s.name IS NULL OR NULLIF(s.name, '') IS NULL)");
            break;
          case 'notBlank':
            qb.andWhere("s.name IS NOT NULL AND NULLIF(s.name, '') IS NOT NULL");
            break;
          case 'contains':
          default:
            qb.andWhere('s.name ILIKE :supplierFilter', { supplierFilter: `%${val}%` });
            break;
        }
      }
    }

    if (typeof query?.active === 'string') {
      const v = String(query.active).toLowerCase();
      if (v === 'true' || v === 'false') qb.andWhere({ active: v === 'true' });
    }

    if (q) {
      const like = `%${q}%`;
      qb.andWhere(new Brackets((qb2) => qb2
        .where('c.email ILIKE :like', { like })
        .orWhere('c.first_name ILIKE :like', { like })
        .orWhere('c.last_name ILIKE :like', { like })
        .orWhere('c.phone ILIKE :like', { like })
        .orWhere('c.mobile ILIKE :like', { like })
        .orWhere('s.name ILIKE :like', { like })
      ));
    }

    await this.orderList(qb, allowedSortFields, sort);

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
    const allowedSortFields = [
      'last_name', 'first_name', 'email', 'country', 'active', 'created_at', 'updated_at', 'supplier_name'
    ];
    const qb = repo.createQueryBuilder('c').leftJoin('c.supplier', 's', 's.tenant_id = c.tenant_id').select('c.id', 'id');

    const filterWhere = buildWhereFromAgFilters(filters, ['last_name', 'first_name', 'email', 'phone', 'mobile', 'country', 'active', 'supplier_id']);
    if (Object.keys(filterWhere).length > 0) qb.where(filterWhere);
    qb.andWhere('c.tenant_id = :tenantId', { tenantId: opts.tenantId });

    const supplierNameFilter = filters?.supplier_name;
    if (supplierNameFilter) {
      let model: any = supplierNameFilter;
      if (model && model.operator && Array.isArray(model.conditions) && model.conditions.length > 0) {
        model = model.conditions[0];
      }
      const type = (model?.type ?? model?.filterType ?? 'contains') as string;
      const valRaw = model?.filter ?? model?.value ?? (Array.isArray(model?.values) ? model.values[0] : undefined);
      const requiresValue = !(type === 'blank' || type === 'notBlank');
      if (!requiresValue || (valRaw != null && valRaw !== '')) {
        const val = valRaw != null ? String(valRaw) : '';
        switch (type) {
          case 'equals':
            qb.andWhere('s.name ILIKE :supplierFilterEq', { supplierFilterEq: val });
            break;
          case 'notEqual':
            qb.andWhere('s.name NOT ILIKE :supplierFilterNe', { supplierFilterNe: val });
            break;
          case 'startsWith':
            qb.andWhere('s.name ILIKE :supplierFilterSw', { supplierFilterSw: `${val}%` });
            break;
          case 'endsWith':
            qb.andWhere('s.name ILIKE :supplierFilterEw', { supplierFilterEw: `%${val}` });
            break;
          case 'notContains':
            qb.andWhere('s.name NOT ILIKE :supplierFilterNc', { supplierFilterNc: `%${val}%` });
            break;
          case 'blank':
            qb.andWhere("(s.name IS NULL OR NULLIF(s.name, '') IS NULL)");
            break;
          case 'notBlank':
            qb.andWhere("s.name IS NOT NULL AND NULLIF(s.name, '') IS NOT NULL");
            break;
          case 'contains':
          default:
            qb.andWhere('s.name ILIKE :supplierFilter', { supplierFilter: `%${val}%` });
            break;
        }
      }
    }

    if (typeof query?.active === 'string') {
      const v = String(query.active).toLowerCase();
      if (v === 'true' || v === 'false') qb.andWhere({ active: v === 'true' });
    }

    if (q) {
      const like = `%${q}%`;
      qb.andWhere(new Brackets((qb2) => qb2
        .where('c.email ILIKE :like', { like })
        .orWhere('c.first_name ILIKE :like', { like })
        .orWhere('c.last_name ILIKE :like', { like })
        .orWhere('c.phone ILIKE :like', { like })
        .orWhere('c.mobile ILIKE :like', { like })
        .orWhere('s.name ILIKE :like', { like })
      ));
    }

    await this.orderList(qb, allowedSortFields, sort);

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
    return { ...rest, supplier_role: supplierRole ?? null, supplier_name: supplier?.name ?? null };
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
  private csvHeaders(): string[] {
    return [
      'first_name', 'last_name', 'job_title', 'email', 'phone', 'mobile', 'country', 'notes', 'active'
    ];
  }

  /** The contacts file in the screen's language (`common/csv-sheet`): its separator, BOM and formula guard. */
  async exportCsv(
    scope: 'template' | 'data',
    opts: TenantOpts & { language?: CsvLanguage; listQuery?: Record<string, unknown> },
  ): Promise<{ filename: string; content: string }> {
    const repo = this.getRepo(opts.manager);
    const headers = this.csvHeaders();
    const rows: string[][] = [];
    if (scope === 'data') {
      // What the list shows (its search, filters and sort), or the whole register, newest first.
      const items: ExternalContact[] = opts.listQuery
        ? (await this.list(opts.listQuery, { ...opts, exportAll: true })).items as any
        : await repo.find({ where: { tenant_id: opts.tenantId }, order: { created_at: 'DESC' as any, id: 'ASC' as any } });
      for (const c of items) {
        rows.push([
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
    return { filename, content: writeCsv({ language: opts.language ?? 'en', headers, rows }) };
  }

  /**
   * Reads the contacts file through the shared layer: either separator, UTF-8 or Windows-1252,
   * physical line numbers. Rows are matched by email; a row equal to the stored contact is
   * unchanged and is not written.
   */
  async importCsv(
    {
      file,
      dryRun,
      language,
      dateOrder,
      decimalMark,
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
    },
    opts: TenantOpts,
  ) {
    const buf = uploadedBytes(file);
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: this.csvHeaders(),
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
    const normalized: Norm[] = [];
    for (const row of read.rows) {
      const line = row.line;
      const problems = rowProblems(row);
      if (problems.length > 0) {
        errors.push(...problems.map((message) => ({ row: line, message })));
        continue;
      }
      const email = cellOf(row, 'email').toLowerCase();
      if (!email) { errors.push({ row: line, message: 'email is required' }); continue; }
      // Yes or no in any language, or the true/false of older files; blank keeps the default.
      const activeCell = parseCsvBoolean(cellOf(row, 'active'));
      if (activeCell === undefined) { errors.push({ row: line, message: 'invalid active value' }); continue; }
      const active = activeCell ?? undefined;
      const country = cellOf(row, 'country');
      if (country && country.length !== 2) { errors.push({ row: line, message: 'country must be 2-letter ISO code' }); continue; }
      normalized.push({
        email,
        first_name: cellOf(row, 'first_name') || null,
        last_name: cellOf(row, 'last_name') || null,
        job_title: cellOf(row, 'job_title') || null,
        phone: cellOf(row, 'phone') || null,
        mobile: cellOf(row, 'mobile') || null,
        country: country || null,
        notes: cellOf(row, 'notes') || null,
        active: active ?? true,
      });
    }
    const rows = read.rows;
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report };

    // Deduplicate by email
    const uniqueMap = new Map<string, Norm>();
    for (const n of normalized) uniqueMap.set(n.email, n);
    const unique = [...uniqueMap.values()];

    // Emails are stored lower-cased (create, update and this import), so one read finds every existing contact.
    const existingRows = unique.length > 0
      ? await repo.find({ where: { tenant_id: opts.tenantId, email: In(unique.map((item) => item.email)) as any } })
      : [];
    const existingByEmail = new Map(existingRows.map((row) => [row.email, row] as const));
    // A row equal to the stored contact is unchanged and is not written. The import sets
    // only columns of `contacts` (no supplier link), so those columns are all it compares.
    let inserted = 0, updated = 0, unchanged = 0;
    const toWrite: Array<{ item: Norm; existing: ExternalContact | undefined }> = [];
    for (const item of unique) {
      const existing = existingByEmail.get(item.email);
      if (!existing) inserted += 1;
      else if (sameStoredValues(existing as unknown as Record<string, unknown>, item)) { unchanged += 1; continue; }
      else updated += 1;
      toWrite.push({ item, existing });
    }
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, unchanged, errors: [], ...report };

    for (const { item, existing } of toWrite) {
      if (existing) {
        Object.assign(existing, item);
        await repo.save(existing);
      } else {
        const created = repo.create({ ...item, tenant_id: opts.tenantId });
        await repo.save(created);
      }
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, unchanged, errors: [], ...report };
  }
}
