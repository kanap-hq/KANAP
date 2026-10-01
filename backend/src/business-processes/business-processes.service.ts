import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { BusinessProcess } from './business-process.entity';
import { BusinessProcessCategory } from './business-process-category.entity';
import { BusinessProcessCategoryLink } from './business-process-category-link.entity';
import { parseExportPagination, parsePagination } from '../common/pagination';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { BusinessProcessUpsertDto } from './dto/business-process.dto';
import { StatusState, resolveLifecycleState } from '../common/status';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { User } from '../users/user.entity';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';

@Injectable()
export class BusinessProcessesService {
  constructor(
    @InjectRepository(BusinessProcess) private readonly repo: Repository<BusinessProcess>,
    @InjectRepository(BusinessProcessCategory) private readonly categoriesRepo: Repository<BusinessProcessCategory>,
    @InjectRepository(BusinessProcessCategoryLink) private readonly linksRepo: Repository<BusinessProcessCategoryLink>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(BusinessProcess) : this.repo;
  }

  private getCategoriesRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(BusinessProcessCategory) : this.categoriesRepo;
  }

  private getLinksRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(BusinessProcessCategoryLink) : this.linksRepo;
  }

  private getUsersRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(User) : this.usersRepo;
  }

  async list(query: any, opts?: { manager?: EntityManager; exportAll?: boolean }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, status, q, filters } = opts?.exportAll
      ? parseExportPagination(query, { field: 'name', direction: 'ASC' })
      : parsePagination(query, { field: 'name', direction: 'ASC' });
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const effectiveStatus = status ?? statusFromAg ?? null;
    const filtersToApply = sanitizedFilters ?? filters;
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';

    const qb = repo.createQueryBuilder('bp');

    if (effectiveStatus) {
      applyStatusFilter(qb, { alias: 'bp', explicitStatus: effectiveStatus as StatusState, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qb, { alias: 'bp', includeDisabled, matchNone });
    }

    if (q) {
      qb.andWhere(
        '(bp.name ILIKE :term OR bp.description ILIKE :term OR bp.notes ILIKE :term)',
        { term: `%${q}%` },
      );
    }

    if (filtersToApply && typeof filtersToApply === 'object') {
      const nameFilter = (filtersToApply as any).name;
      if (nameFilter && typeof nameFilter === 'object') {
        const value = nameFilter.filter ?? nameFilter.value ?? nameFilter;
        if (typeof value === 'string' && value.trim()) {
          qb.andWhere('bp.name ILIKE :filterName', { filterName: `%${value.trim()}%` });
        }
      }
    }

    const total = await qb.getCount();

    const allowedSort = new Set(['name', 'status', 'updated_at', 'created_at', 'primary_category_name']);
    const safeSortField = allowedSort.has(sort.field) ? sort.field : 'name';

    if (safeSortField === 'primary_category_name') {
      qb.orderBy(
        `COALESCE(
          (
            SELECT MIN(c2.name)
            FROM business_process_category_links l2
            JOIN business_process_categories c2 ON c2.id = l2.category_id
            WHERE l2.process_id = bp.id AND c2.is_active = true
          ),
          ''
        )`,
        sort.direction as 'ASC' | 'DESC',
      ).addOrderBy('bp.name', 'ASC');
    } else {
      qb.orderBy(`bp.${safeSortField}`, sort.direction as 'ASC' | 'DESC');
    }

    const items = await qb.skip(skip).take(limit).getMany();
    const ids = items.map((i) => i.id);

    const categoriesByProcess = await this.loadCategoriesForProcesses(ids, opts);
    const ownerNamesById = await this.loadOwnerNames(items, opts);

    const shaped = items.map((bp) => ({
      ...bp,
      categories: categoriesByProcess.get(bp.id) ?? [],
      primary_category_name: (categoriesByProcess.get(bp.id) ?? [])[0]?.name ?? null,
      owner_name: bp.owner_user_id ? ownerNamesById.get(bp.owner_user_id) ?? null : null,
    }));

    return { items: shaped, total, page, limit };
  }

  async listIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const parsed = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 }, { field: 'name', direction: 'ASC' });
    const { sort, status, q, filters } = parsed;
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const effectiveStatus = status ?? statusFromAg ?? null;
    const filtersToApply = sanitizedFilters ?? filters;
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';

    const qb = repo.createQueryBuilder('bp').select('bp.id', 'id');

    if (effectiveStatus) {
      applyStatusFilter(qb, { alias: 'bp', explicitStatus: effectiveStatus as StatusState, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qb, { alias: 'bp', includeDisabled, matchNone });
    }

    if (q) {
      qb.andWhere(
        '(bp.name ILIKE :term OR bp.description ILIKE :term OR bp.notes ILIKE :term)',
        { term: `%${q}%` },
      );
    }

    if (filtersToApply && typeof filtersToApply === 'object') {
      const nameFilter = (filtersToApply as any).name;
      if (nameFilter && typeof nameFilter === 'object') {
        const value = nameFilter.filter ?? nameFilter.value ?? nameFilter;
        if (typeof value === 'string' && value.trim()) {
          qb.andWhere('bp.name ILIKE :filterName', { filterName: `%${value.trim()}%` });
        }
      }
    }

    const allowedSort = new Set(['name', 'status', 'updated_at', 'created_at', 'primary_category_name']);
    const safeSortField = allowedSort.has(sort.field) ? sort.field : 'name';

    if (safeSortField === 'primary_category_name') {
      qb.orderBy(
        `COALESCE(
          (
            SELECT MIN(c2.name)
            FROM business_process_category_links l2
            JOIN business_process_categories c2 ON c2.id = l2.category_id
            WHERE l2.process_id = bp.id AND c2.is_active = true
          ),
          ''
        )`,
        sort.direction as 'ASC' | 'DESC',
      ).addOrderBy('bp.name', 'ASC');
    } else {
      qb.orderBy(`bp.${safeSortField}`, sort.direction as 'ASC' | 'DESC');
    }

    const total = await qb.clone().getCount();
    const limit = Math.min(Number(query?.limit) || 10000, 10000);
    qb.take(limit);
    const rows = await qb.getRawMany<{ id: string }>();
    const ids = rows.map((r) => r.id).filter((v) => !!v);
    return { ids, total };
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Business process not found');

    const categoriesByProcess = await this.loadCategoriesForProcesses([id], opts);
    const categories = categoriesByProcess.get(id) ?? [];
    return { ...found, categories };
  }

  private async loadCategoriesForProcesses(
    processIds: string[],
    opts?: { manager?: EntityManager },
  ): Promise<Map<string, Array<{ id: string; name: string; is_active: boolean }>>> {
    const map = new Map<string, Array<{ id: string; name: string; is_active: boolean }>>();
    if (!processIds.length) return map;

    const linksRepo = this.getLinksRepo(opts?.manager);
    const qb = linksRepo
      .createQueryBuilder('link')
      .leftJoinAndSelect('link.category', 'cat')
      .where('link.process_id IN (:...ids)', { ids: processIds });

    const links = await qb.getMany();
    for (const link of links) {
      if (!link.category) continue;
      const arr = map.get(link.process_id) ?? [];
      arr.push({ id: link.category.id, name: link.category.name, is_active: link.category.is_active });
      map.set(link.process_id, arr);
    }
    for (const [key, value] of map.entries()) {
      value.sort((a, b) => a.name.localeCompare(b.name));
      map.set(key, value);
    }
    return map;
  }

  private async loadOwnerNames(
    processes: BusinessProcess[],
    opts?: { manager?: EntityManager },
  ): Promise<Map<string, string>> {
    const ownerIds = new Set<string>();
    for (const p of processes) {
      if (p.owner_user_id) ownerIds.add(p.owner_user_id);
    }
    if (ownerIds.size === 0) return new Map<string, string>();

    const repo = this.getUsersRepo(opts?.manager);
    const users = await repo.find({ where: { id: In([...ownerIds]) as any } });
    const map = new Map<string, string>();
    for (const u of users) {
      const first = (u.first_name || '').trim();
      const last = (u.last_name || '').trim();
      const full = [first, last].filter(Boolean).join(' ');
      const label = full || u.email;
      map.set(u.id, label);
    }
    return map;
  }

  async create(body: BusinessProcessUpsertDto, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const rawName = (body.name ?? '').toString().trim();
    if (!rawName) throw new BadRequestException('Name is required');

    const duplicate = await repo
      .createQueryBuilder('bp')
      .where('LOWER(bp.name) = LOWER(:name)', { name: rawName })
      .getOne();
    if (duplicate) {
      throw new BadRequestException('A business process with this name already exists');
    }

    const lifecycle = resolveLifecycleState({ nextStatus: body.status, nextDisabledAt: body.disabled_at });
    const entity = repo.create({
      name: rawName,
      description: (body.description ?? '').toString().trim() || null,
      owner_user_id: body.owner_user_id ?? null,
      it_owner_user_id: body.it_owner_user_id ?? null,
      notes: (body.notes ?? '').toString().trim() || null,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);

    await this.syncCategories(saved.id, body.category_ids ?? [], opts);

    await this.audit.log(
      {
        table: 'business_processes',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId: userId ?? null,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
  }

  async update(id: string, body: BusinessProcessUpsertDto, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const existing = await this.get(id, opts);
    const before = { ...existing };

    if (body.name !== undefined) {
      const trimmed = (body.name ?? '').toString().trim();
      if (!trimmed) throw new BadRequestException('Name cannot be empty');
      if (trimmed !== existing.name) {
        const duplicate = await repo
          .createQueryBuilder('bp')
          .where('LOWER(bp.name) = LOWER(:name)', { name: trimmed })
          .andWhere('bp.id <> :id', { id })
          .getOne();
        if (duplicate) throw new BadRequestException('Another business process already uses this name');
        (existing as any).name = trimmed;
      }
    }

    if (body.description !== undefined) {
      const desc = body.description == null ? null : body.description.toString().trim();
      (existing as any).description = desc || null;
    }
    if (body.owner_user_id !== undefined) {
      (existing as any).owner_user_id = body.owner_user_id || null;
    }
    if (body.it_owner_user_id !== undefined) {
      (existing as any).it_owner_user_id = body.it_owner_user_id || null;
    }
    if (body.notes !== undefined) {
      const notes = body.notes == null ? null : body.notes.toString().trim();
      (existing as any).notes = notes || null;
    }

    const lifecycle = resolveLifecycleState({
      currentDisabledAt: (before as any).disabled_at ?? null,
      nextStatus: body.status,
      nextDisabledAt: body.disabled_at,
    });
    (existing as any).status = lifecycle.status;
    (existing as any).disabled_at = lifecycle.disabled_at;

    if (Array.isArray(body.category_ids)) {
      await this.syncCategories(id, body.category_ids, opts);
    }

    const mgr = opts?.manager ?? repo.manager;
    const saved = await mgr.getRepository(BusinessProcess).save(existing as any);
    await this.audit.log(
      {
        table: 'business_processes',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId: userId ?? null,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: mgr },
    );
    return saved;
  }

  private async syncCategories(id: string, categoryIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const linkRepo = this.getLinksRepo(mg);
    const categoryRepo = this.getCategoriesRepo(mg);

    const uniqueIds = Array.from(new Set((categoryIds ?? []).filter((v) => !!v)));
    if (uniqueIds.length > 0) {
      const existingCategories = await categoryRepo.find({ where: { id: In(uniqueIds) as any } });
      const foundIds = new Set(existingCategories.map((c) => c.id));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException('One or more categories do not exist or are not accessible');
      }
    }

    const existingLinks = await linkRepo.find({ where: { process_id: id } });
    const existingIds = new Set(existingLinks.map((l) => l.category_id));
    const nextIds = new Set(uniqueIds);

    for (const link of existingLinks) {
      if (!nextIds.has(link.category_id)) {
        await linkRepo.delete({ id: link.id });
      }
    }

    for (const categoryId of nextIds) {
      if (!existingIds.has(categoryId)) {
        const link = linkRepo.create({ process_id: id, category_id: categoryId });
        await linkRepo.save(link);
      }
    }
  }

  private csvHeaders(): string[] {
    return ['name', 'categories', 'description', 'notes', 'status'];
  }

  async exportCsv(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager },
  ): Promise<{ filename: string; content: string }> {
    const headers = this.csvHeaders();
    const delimiter = ';';
    const rows: any[] = [];
    if (scope === 'data') {
      const { items } = await this.list({ page: 1, limit: 10000, sort: 'name:ASC' }, { ...opts, exportAll: true });
      for (const p of items as any[]) {
        const categoryNames = Array.isArray(p.categories)
          ? (p.categories as any[]).map((c) => c.name).join(';')
          : '';
        rows.push({
          name: p.name ?? '',
          categories: categoryNames,
          description: p.description ?? '',
          notes: p.notes ?? '',
          status: p.status ?? 'enabled',
        });
      }
    }

    const filename = scope === 'template' ? 'business_processes_template.csv' : 'business_processes.csv';
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
        reject(
          new BadRequestException(
            'Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.',
          ),
        );
        return;
      }
      parseString(content, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('headers', (headers: string[]) => {
          headerSet = headers;
          const missing = expectedHeaders.filter((h) => !headers.includes(h));
          const extras = headers.filter((h) => !expectedHeaders.includes(h));
          headerOk = missing.length === 0 && extras.length === 0;
          if (!headerOk) {
            errors.push({
              row: 0,
              message: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}`,
            });
          }
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Row) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });

    if (!headerOk) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors };
    }

    let inserted = 0;
    let updated = 0;
    const normalized: Array<{
      body: BusinessProcessUpsertDto;
      categoryNames: string[];
    }> = [];

    rows.forEach((r, idx) => {
      const line = idx + 2;
      const name = (r['name'] ?? '').toString().trim();
      const rawStatus = (r['status'] ?? 'enabled').toString().trim().toLowerCase();
      if (!name) errors.push({ row: line, message: 'Name is required' });
      if (rawStatus && rawStatus !== 'enabled' && rawStatus !== 'disabled') {
        errors.push({ row: line, message: `Invalid status '${rawStatus}'. Use 'enabled' or 'disabled'.` });
      }
      const body: BusinessProcessUpsertDto = {
        name,
        description: (r['description'] ?? '').toString().trim() || null,
        notes: (r['notes'] ?? '').toString().trim() || null,
        status: rawStatus === 'disabled' ? StatusState.DISABLED : StatusState.ENABLED,
      };
      const categoryNames = (r['categories'] ?? '')
        .toString()
        .split(';')
        .map((v) => v.trim())
        .filter((v) => !!v);
      normalized.push({ body, categoryNames });
    });

    if (errors.length > 0) {
      return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };
    }

    const uniqueMap = new Map<string, { body: BusinessProcessUpsertDto; categoryNames: string[] }>();
    for (const item of normalized) {
      const key = JSON.stringify(item.body);
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    }
    const unique = Array.from(uniqueMap.values());

    const manager = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(manager);
    const categoriesRepo = this.getCategoriesRepo(manager);

    for (const item of unique) {
      const existing = await repo.findOne({ where: { name: item.body.name as string } });
      if (existing) updated += 1;
      else inserted += 1;
    }

    if (dryRun) {
      return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };
    }

    let processed = 0;

    for (const item of unique) {
      const existing = await repo.findOne({ where: { name: item.body.name as string } });

      const categoryIds: string[] = [];
      for (const catNameRaw of item.categoryNames) {
        const catName = catNameRaw.trim();
        if (!catName) continue;
        let category = await categoriesRepo
          .createQueryBuilder('cat')
          .where('LOWER(cat.name) = LOWER(:name)', { name: catName })
          .getOne();
        if (!category) {
          category = await categoriesRepo.save(
            categoriesRepo.create({ name: catName, is_active: true, is_default: false }),
          );
        }
        if (!categoryIds.includes(category.id)) categoryIds.push(category.id);
      }

      if (existing) {
        await this.update(existing.id, { ...item.body, category_ids: categoryIds }, userId ?? null, { manager });
        processed += 1;
      } else {
        await this.create({ ...item.body, category_ids: categoryIds }, userId ?? null, { manager });
        processed += 1;
      }
    }

    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [] };
  }
}
