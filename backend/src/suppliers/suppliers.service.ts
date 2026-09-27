import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, Raw, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink, SupplierContactRole } from '../contacts/supplier-contact.entity';
import { buildWhereFromAgFilters, parseExportPagination, parsePagination } from '../common/pagination';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { resolveLifecycleState, StatusState } from '../common/status';
import { extractStatusFilterFromAgModel } from '../common/status-filter';
import { SupplierUpsertDto } from './dto/supplier.dto';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';

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
    const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
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
    if (!includeDisabled || (status ?? statusFromAg)) {
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

    const [items, total] = await repo.findAndCount({
      where: whereArr ?? where,
      order: { [sort.field]: sort.direction as any },
      skip,
      take: limit,
    });
    return { items, total, page, limit };
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
    const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
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
    if (!includeDisabled || (status ?? statusFromAg)) {
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
    const items = await repo.find({
      where: whereArr ?? where,
      order: { [sort.field]: sort.direction as any },
      take: limit,
      skip: 0,
      select: ['id'],
    });
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
    return ['name', 'erp_supplier_id', 'commercial_contact', 'technical_contact', 'support_contact', 'notes', 'status'];
  }

  async exportCsv(scope: 'template' | 'data' = 'data', opts?: { manager?: EntityManager }): Promise<{ filename: string; content: string }> {
    const headers = this.csvHeaders();
    const delimiter = ';';
    const rows: any[] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const mg = opts?.manager ?? repo.manager;
      const linkRepo = mg.getRepository(SupplierContactLink);
      const items = await repo.find({ order: { created_at: 'DESC' as any } });
      for (const s of items) {
        const roleEmail = async (role: SupplierContactRole) => {
          const link = await linkRepo.findOne({ where: { supplier_id: s.id, role }, relations: ['contact'], order: { is_primary: 'DESC' as any, created_at: 'ASC' as any } as any });
          return link?.contact?.email ?? '';
        };
        rows.push({
          name: s.name ?? '',
          erp_supplier_id: s.erp_supplier_id ?? '',
          commercial_contact: await roleEmail(SupplierContactRole.COMMERCIAL),
          technical_contact: await roleEmail(SupplierContactRole.TECHNICAL),
          support_contact: await roleEmail(SupplierContactRole.SUPPORT),
          notes: s.notes ?? '',
          status: s.status ?? 'enabled',
        });
      }
    }
    // Build CSV text using fast-csv
    const filename = scope === 'template' ? 'suppliers_template.csv' : 'suppliers.csv';
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      // write headers only if template
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
    opts?: { manager?: EntityManager },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const delimiter = ';';
    const expectedHeaders = this.csvHeaders();
    type Row = Record<string, string>;
    const rows: Row[] = [];
    const errors: { row: number; message: string }[] = [];
    let headerOk = false;
    let headerSet: string[] = [];
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
          headerSet = headers;
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
    // Validate rows
    let inserted = 0;
    let updated = 0;
    const normalized: Array<{
      body: SupplierUpsertDto;
      commercial_email: string | null;
      technical_email: string | null;
      support_email: string | null;
    }> = [];
    rows.forEach((r, idx) => {
      const line = idx + 2; // account for header
      const name = (r['name'] ?? '').toString().trim();
      const statusRaw = (r['status'] ?? 'enabled').toString().trim().toLowerCase();
      if (!name) errors.push({ row: line, message: 'Name is required' });
      if (statusRaw && statusRaw !== 'enabled' && statusRaw !== 'disabled') {
        errors.push({ row: line, message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.` });
      }
      const body: SupplierUpsertDto = {
        name,
        erp_supplier_id: (r['erp_supplier_id'] ?? '').toString().trim() || null,
        notes: (r['notes'] ?? '').toString().trim() || null,
        status: statusRaw === 'disabled' ? StatusState.DISABLED : StatusState.ENABLED,
      };
      const commercial_email = ((r['commercial_contact'] ?? '').toString().trim() || '').toLowerCase() || null;
      const technical_email = ((r['technical_contact'] ?? '').toString().trim() || '').toLowerCase() || null;
      const support_email = ((r['support_contact'] ?? '').toString().trim() || '').toLowerCase() || null;
      // Basic email sanity check when provided
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (commercial_email && !emailRegex.test(commercial_email)) errors.push({ row: line, message: 'Invalid commercial_contact email' });
      if (technical_email && !emailRegex.test(technical_email)) errors.push({ row: line, message: 'Invalid technical_contact email' });
      if (support_email && !emailRegex.test(support_email)) errors.push({ row: line, message: 'Invalid support_contact email' });
      normalized.push({ body, commercial_email, technical_email, support_email });
    });
    if (errors.length > 0) {
      return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };
    }
    // Deduplicate identical suppliers (same content) and then determine inserts/updates by name match
    const uniqueMap = new Map<string, { body: SupplierUpsertDto; commercial_email: string | null; technical_email: string | null; support_email: string | null }>();
    for (const item of normalized) {
      const key = JSON.stringify(item.body);
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    }
    const unique = Array.from(uniqueMap.values());

    const repo = this.getRepo(opts?.manager);
    for (const item of unique) {
      const existing = await repo.findOne({ where: { name: item.body.name as string } });
      if (existing) updated += 1; else inserted += 1;
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };
    }
    // Commit changes
    let processed = 0;
    const mg = opts?.manager ?? repo.manager;
    const contactRepo = mg.getRepository(ExternalContact);
    const linkRepo = mg.getRepository(SupplierContactLink);
    const attachByEmail = async (supplierId: string, email: string | null, role: any) => {
      if (!email) return;
      let contact = await contactRepo.findOne({ where: { email } });
      if (!contact) {
        contact = await contactRepo.save(contactRepo.create({ email, active: true }));
      }
      const dup = await linkRepo.findOne({ where: { supplier_id: supplierId, contact_id: contact.id, role } });
      if (!dup) await linkRepo.save(linkRepo.create({ supplier_id: supplierId, contact_id: contact.id, role, is_primary: false }));
    };
    for (const item of unique) {
      const existing = await repo.findOne({ where: { name: item.body.name as string } });
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
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [] };
  }
}
