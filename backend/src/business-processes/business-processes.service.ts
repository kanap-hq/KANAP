import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { BusinessProcess } from './business-process.entity';
import { BusinessProcessCategory } from './business-process-category.entity';
import { BusinessProcessCategoryLink } from './business-process-category-link.entity';
import { parseExportPagination, parsePagination, MAX_EXPORT_LIMIT } from '../common/pagination';
import { orderListQuery } from '../common/list-sort';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { compileAgFilterCondition, createParamNameGenerator, type FilterTargetConfig } from '../common/ag-grid-filtering';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { BusinessProcessUpsertDto } from './dto/business-process.dto';
import { StatusState, resolveLifecycleState } from '../common/status';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { CsvDecodeError, decodeCsv } from '../common/csv-sheet/decode';
import { User } from '../users/user.entity';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import { headerMismatchError } from '../common/csv-sheet';
import { sameStoredValues } from '../common/csv-sheet/unchanged';

/**
 * True when re-importing a CSV row over the stored process writes nothing (`importCsv`): the
 * description, notes and lifecycle it sets are stored, and its categories are exactly the linked
 * ones. A category the file names that does not exist yet (the import would create it), or whose
 * name matches several categories, makes the row an update.
 */
function importRowUnchanged(
  stored: BusinessProcess,
  body: BusinessProcessUpsertDto,
  categoryNames: string[],
  categoryIdsByName: Map<string, string[]>,
  linkedCategoryIds: Set<string>,
  now: Date,
): boolean {
  const lifecycle = resolveLifecycleState({ currentDisabledAt: stored.disabled_at ?? null, nextStatus: body.status, nowFactory: () => now });
  const values = { description: body.description, notes: body.notes, status: lifecycle.status, disabled_at: lifecycle.disabled_at };
  if (!sameStoredValues(stored as unknown as Record<string, unknown>, values)) return false;
  const wanted = new Set<string>();
  for (const name of categoryNames) {
    const ids = categoryIdsByName.get(name.toLowerCase());
    if (!ids || ids.length !== 1) return false;
    wanted.add(ids[0]);
  }
  return wanted.size === linkedCategoryIds.size && [...wanted].every((id) => linkedCategoryIds.has(id));
}

/**
 * The list's column filters compiled by the shared compiler. The categories column shows every
 * category of the process, by name; the owner column the owner's name, else the e-mail.
 */
const BUSINESS_PROCESS_FILTER_TARGETS: Record<string, FilterTargetConfig> = {
  primary_category_name: {
    expression: `(SELECT string_agg(cat.name, ', ' ORDER BY cat.name)
      FROM business_process_category_links link
      JOIN business_process_categories cat ON cat.id = link.category_id AND cat.tenant_id = link.tenant_id
      WHERE link.process_id = bp.id AND link.tenant_id = bp.tenant_id)`,
  },
  owner_name: {
    expression: `(SELECT COALESCE(NULLIF(concat_ws(' ', NULLIF(btrim(u.first_name), ''), NULLIF(btrim(u.last_name), '')), ''), u.email)
      FROM users u WHERE u.id = bp.owner_user_id AND u.tenant_id = bp.tenant_id)`,
  },
  updated_at: { expression: 'bp.updated_at', dataType: 'date' },
};

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

    this.applyListFilters(qb, filtersToApply);

    const total = await qb.getCount();

    await this.orderList(qb, sort);

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

  /** The column filters of the list: the name (contains) and the primary category (set). */
  /** The list order: name, status, dates or the first active category (then the name); text alphabetically; then the id. */
  private async orderList(qb: SelectQueryBuilder<BusinessProcess>, sort: { field: string; direction: string }) {
    const field = ['name', 'status', 'updated_at', 'created_at', 'primary_category_name'].includes(sort.field) ? sort.field : 'name';
    if (field === 'primary_category_name') {
      const firstCategory = `COALESCE(
          (
            SELECT MIN(c2.name)
            FROM business_process_category_links l2
            JOIN business_process_categories c2 ON c2.id = l2.category_id
            WHERE l2.process_id = bp.id AND c2.is_active = true
          ),
          ''
        )`;
      await orderListQuery(qb, firstCategory, sort.direction, { text: true, idExpr: 'bp.id', thenByText: 'bp.name' });
    } else {
      await orderListQuery(qb, `bp.${field}`, sort.direction, { text: field === 'name', idExpr: 'bp.id' });
    }
  }

  private applyListFilters(qb: SelectQueryBuilder<BusinessProcess>, filters: any) {
    if (!filters || typeof filters !== 'object') return;
    const nameFilter = filters.name;
    if (nameFilter && typeof nameFilter === 'object') {
      const value = nameFilter.filter ?? nameFilter.value ?? nameFilter;
      if (typeof value === 'string' && value.trim()) {
        qb.andWhere('bp.name ILIKE :filterName', { filterName: `%${value.trim()}%` });
      }
    }
    // The primary category is the first linked category by name, as the list shows it; null is a
    // process without a category.
    const categoryFilter = filters.primary_category_name;
    if (categoryFilter && categoryFilter.filterType === 'set' && Array.isArray(categoryFilter.values)) {
      const names = categoryFilter.values.filter((value: unknown) => typeof value === 'string');
      const withNull = categoryFilter.values.some((value: unknown) => value === null);
      const primary = `(SELECT MIN(cat.name) FROM business_process_category_links link
          JOIN business_process_categories cat ON cat.id = link.category_id AND cat.tenant_id = link.tenant_id
         WHERE link.process_id = bp.id AND link.tenant_id = bp.tenant_id)`;
      const clauses = [
        ...(names.length ? [`${primary} IN (:...primaryCategoryNames)`] : []),
        ...(withNull ? [`${primary} IS NULL`] : []),
      ];
      qb.andWhere(clauses.length ? `(${clauses.join(' OR ')})` : '1=0', { primaryCategoryNames: names });
    }
    // The text filters of the other columns, on what each column shows: the categories by name,
    // the owner's name, the day of the last change.
    const nextParam = createParamNameGenerator('bp_filter_');
    for (const [field, target] of Object.entries(BUSINESS_PROCESS_FILTER_TARGETS)) {
      const model = filters[field];
      // The primary category's set filter is read above.
      if (!model || typeof model !== 'object' || (field === 'primary_category_name' && model.filterType === 'set')) continue;
      const compiled = compileAgFilterCondition(model, target, nextParam);
      if (compiled) qb.andWhere(`(${compiled.sql})`, compiled.params);
    }
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

    this.applyListFilters(qb, filtersToApply);

    await this.orderList(qb, sort);

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
    opts?: { manager?: EntityManager; listQuery?: Record<string, unknown> },
  ): Promise<{ filename: string; content: string }> {
    const headers = this.csvHeaders();
    const delimiter = ';';
    const rows: any[] = [];
    if (scope === 'data') {
      // What the list shows (its search, filters, scope and sort), or the whole register by name.
      const query = opts?.listQuery ?? { page: 1, limit: MAX_EXPORT_LIMIT, sort: 'name:ASC', includeDisabled: '1' };
      const { items } = await this.list(query, { manager: opts?.manager, exportAll: true });
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
        content = decodeCsv(buf as Buffer).text;
      } catch (err) {
        reject(err instanceof CsvDecodeError ? new BadRequestException({ message: err.message, code: err.code }) : err);
        return;
      }
      parseString(content, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('headers', (headers: string[]) => {
          headerSet = headers;
          const missing = expectedHeaders.filter((h) => !headers.includes(h));
          const extras = headers.filter((h) => !expectedHeaders.includes(h));
          headerOk = missing.length === 0 && extras.length === 0;
          const headerError = headerMismatchError(missing, extras);
          if (headerError) errors.push(headerError);
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Row) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });

    if (!headerOk) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, unchanged: 0, errors };
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
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
      return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors };
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

    // A row identical to the stored process, categories included, counts as unchanged and is not
    // written: no audit line, no new `updated_at`. Categories and links are read once.
    const found: Array<{ item: (typeof unique)[number]; existing: BusinessProcess | null }> = [];
    for (const item of unique) {
      found.push({ item, existing: await repo.findOne({ where: { name: item.body.name as string } }) });
    }
    const existingIds = found.flatMap(({ existing }) => (existing ? [existing.id] : []));
    const categoryIdsByName = new Map<string, string[]>();
    const linkedByProcess = new Map<string, Set<string>>();
    if (existingIds.length > 0) {
      const categories: Array<{ id: string; name: string }> = await manager.query(
        `SELECT id, name FROM business_process_categories WHERE tenant_id = app_current_tenant()`,
      );
      for (const category of categories) {
        const key = category.name.toLowerCase();
        categoryIdsByName.set(key, [...(categoryIdsByName.get(key) ?? []), category.id]);
      }
      const links: Array<{ process_id: string; category_id: string }> = await manager.query(
        `SELECT process_id, category_id FROM business_process_category_links
          WHERE tenant_id = app_current_tenant() AND process_id = ANY($1)`,
        [existingIds],
      );
      for (const link of links) {
        const set = linkedByProcess.get(link.process_id) ?? new Set<string>();
        set.add(link.category_id);
        linkedByProcess.set(link.process_id, set);
      }
    }
    const now = new Date();
    const toWrite: typeof unique = [];
    for (const { item, existing } of found) {
      if (!existing) inserted += 1;
      else if (importRowUnchanged(existing, item.body, item.categoryNames, categoryIdsByName, linkedByProcess.get(existing.id) ?? new Set(), now)) {
        unchanged += 1;
        continue;
      } else updated += 1;
      toWrite.push(item);
    }

    if (dryRun) {
      return { ok: true, dryRun: true, total: rows.length, inserted, updated, unchanged, errors: [] };
    }

    let processed = 0;

    for (const item of toWrite) {
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

    return { ok: true, dryRun: false, total: rows.length, inserted, updated, unchanged, processed, errors: [] };
  }
}
