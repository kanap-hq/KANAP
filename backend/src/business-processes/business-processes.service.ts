import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { BusinessProcess } from './business-process.entity';
import { parseExportPagination, parsePagination, MAX_EXPORT_LIMIT } from '../common/pagination';
import { orderListQuery, textSortKey } from '../common/list-sort';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { compileAgFilterCondition, createParamNameGenerator, type FilterTargetConfig } from '../common/ag-grid-filtering';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { BusinessProcessUpsertDto } from './dto/business-process.dto';
import { StatusState, deriveStatusFromDisabledAt, resolveLifecycleState } from '../common/status';
import { User } from '../users/user.entity';
import { duplicateNameException } from '../common/duplicate-name';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  ImportReportError,
  nameMatchedWarning,
  readMasterDataFile,
  rowError,
  rowProblemErrors,
} from '../common/csv-sheet';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { uploadedBytes } from '../common/upload';
import { ListExportCell, ListExportFile, writeListExport } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';
import {
  assertBusinessProcessParent,
  buildBusinessProcessTree,
  BUSINESS_PROCESS_TYPES,
  businessProcessDepthSql,
  businessProcessParentNameSql,
  businessProcessPathSql,
  businessProcessRefusal,
  businessProcessTreeSortSql,
  isBusinessProcessType,
  lockBusinessProcessTree,
  type BusinessProcessTreeNode,
} from './business-process-tree';

/** A type code, or null when blank; an unknown code is refused. */
function normalizeProcessType(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (isBusinessProcessType(value)) return value;
  throw new BadRequestException({
    code: 'BUSINESS_PROCESS_TYPE_INVALID',
    message: `Unknown business process type '${String(value)}'. Use ${BUSINESS_PROCESS_TYPES.join(', ')}.`,
    field: 'process_type',
    params: { value: String(value) },
  });
}

/** A parent id, or null when blank. */
function normalizeParentId(value: unknown): string | null {
  if (value == null) return null;
  const id = String(value).trim();
  if (!id) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw businessProcessRefusal('BUSINESS_PROCESS_PARENT_NOT_FOUND', 'Parent business process not found.');
  }
  return id;
}

/**
 * True when re-importing a CSV row over the stored process writes nothing (`importCsv`): the
 * description, notes, type, parent and lifecycle it sets are stored.
 */
function importRowUnchanged(stored: BusinessProcess, body: BusinessProcessUpsertDto, now: Date): boolean {
  const lifecycle = resolveLifecycleState({ currentDisabledAt: stored.disabled_at ?? null, nextStatus: body.status, nowFactory: () => now });
  const values = {
    description: body.description,
    notes: body.notes,
    process_type: body.process_type ?? null,
    parent_id: body.parent_id ?? null,
    status: lifecycle.status,
    disabled_at: lifecycle.disabled_at,
  };
  return sameStoredValues(stored as unknown as Record<string, unknown>, values);
}

/**
 * The list's column filters compiled by the shared compiler: the type (its code), the parent by
 * name (null at the top), the owner's name, else the e-mail.
 */
const BUSINESS_PROCESS_FILTER_TARGETS: Record<string, FilterTargetConfig> = {
  process_type: { expression: 'bp.process_type' },
  parent_name: { expression: businessProcessParentNameSql('bp') },
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
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(BusinessProcess) : this.repo;
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

    const treeById = await this.loadTreeFields(ids, opts);
    const ownerNamesById = await this.loadOwnerNames(items, opts);

    const shaped = items.map((bp) => ({
      ...bp,
      ...(treeById.get(bp.id) ?? { parent_name: null, path: bp.name, depth: 0 }),
      owner_name: bp.owner_user_id ? ownerNamesById.get(bp.owner_user_id) ?? null : null,
    }));

    return { items: shaped, total, page, limit };
  }

  /**
   * The list order: name, status, type, parent, dates, or the path in the tree (each process
   * right after its parent); text alphabetically; then the id.
   */
  private async orderList(qb: SelectQueryBuilder<BusinessProcess>, sort: { field: string; direction: string }) {
    const field = ['name', 'status', 'updated_at', 'created_at', 'process_type', 'parent_name', 'path'].includes(sort.field) ? sort.field : 'name';
    if (field === 'path') {
      const textKey = await textSortKey((qb as any).queryRunner?.manager ?? qb.connection.manager);
      await orderListQuery(qb, businessProcessTreeSortSql('bp', textKey), sort.direction, { text: false, idExpr: 'bp.id' });
    } else if (field === 'parent_name') {
      await orderListQuery(qb, `COALESCE(${businessProcessParentNameSql('bp')}, '')`, sort.direction, { text: true, idExpr: 'bp.id', thenByText: 'bp.name' });
    } else if (field === 'process_type') {
      // The ISO order (management, core, support), then the processes without a type.
      const rank = `CASE bp.process_type ${BUSINESS_PROCESS_TYPES.map((type, index) => `WHEN '${type}' THEN ${index}`).join(' ')} ELSE ${BUSINESS_PROCESS_TYPES.length} END`;
      await orderListQuery(qb, rank, sort.direction, { text: false, idExpr: 'bp.id', thenByText: 'bp.name' });
    } else {
      await orderListQuery(qb, `bp.${field}`, sort.direction, { text: field === 'name', idExpr: 'bp.id' });
    }
  }

  /**
   * The column filters of the list: the name (contains), and the shared compiler for the type,
   * the parent, the owner and the last change. `under` (the assistant) keeps every process below
   * the named ones, at every level, the named ones left out.
   */
  private applyListFilters(qb: SelectQueryBuilder<BusinessProcess>, filters: any) {
    if (!filters || typeof filters !== 'object') return;
    const nameFilter = filters.name;
    if (nameFilter && typeof nameFilter === 'object') {
      const value = nameFilter.filter ?? nameFilter.value ?? nameFilter;
      if (typeof value === 'string' && value.trim()) {
        qb.andWhere('bp.name ILIKE :filterName', { filterName: `%${value.trim()}%` });
      }
    }
    const under = filters.under;
    if (under && typeof under === 'object') {
      const raw = Array.isArray(under.values) ? under.values : [under.filter ?? under.value];
      const names = raw.filter((value: unknown): value is string => typeof value === 'string' && value.trim() !== '').map((value: string) => value.trim().toLowerCase());
      qb.andWhere(names.length === 0 ? '1=0' : `bp.id IN (
        WITH RECURSIVE down AS (
          SELECT c.id, 0 AS hop FROM business_processes c
            JOIN business_processes top ON top.id = c.parent_id AND top.tenant_id = c.tenant_id
           WHERE c.tenant_id = app_current_tenant() AND lower(top.name) IN (:...underNames)
          UNION ALL
          SELECT c.id, down.hop + 1 FROM business_processes c JOIN down ON c.parent_id = down.id
           WHERE c.tenant_id = app_current_tenant() AND down.hop < 100)
        SELECT id FROM down)`, { underNames: names });
    }
    const nextParam = createParamNameGenerator('bp_filter_');
    for (const [field, target] of Object.entries(BUSINESS_PROCESS_FILTER_TARGETS)) {
      const model = filters[field];
      if (!model || typeof model !== 'object') continue;
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
    const tree = (await this.loadTreeFields([id], opts)).get(id);
    const mg = opts?.manager ?? this.repo.manager;
    const children: Array<{ id: string; name: string; status: string; disabled_at: Date | null }> = await mg.query(
      `SELECT id::text AS id, name, status::text AS status, disabled_at FROM business_processes
        WHERE tenant_id = app_current_tenant() AND parent_id = $1 ORDER BY lower(name), id`,
      [id],
    );
    return {
      ...found,
      parent: found.parent_id && tree?.parent_name != null ? { id: found.parent_id, name: tree.parent_name } : null,
      path: tree?.path ?? found.name,
      depth: tree?.depth ?? 0,
      children: children.map((child) => ({ id: child.id, name: child.name, status: deriveStatusFromDisabledAt(child.disabled_at ?? null) })),
    };
  }

  /** Every process of the tenant as a tree, siblings by name, with depth and path. */
  async tree(opts?: { manager?: EntityManager }): Promise<{ items: BusinessProcessTreeNode[] }> {
    const mg = opts?.manager ?? this.repo.manager;
    const rows = await mg.query(
      `SELECT id::text AS id, name, parent_id::text AS parent_id, process_type, status::text AS status, disabled_at
         FROM business_processes WHERE tenant_id = app_current_tenant()`,
    );
    return {
      items: buildBusinessProcessTree(rows).map((node) => ({ ...node, status: deriveStatusFromDisabledAt(node.disabled_at) })),
    };
  }

  /** The parent's name, the path and the depth of each of `ids`, one query. */
  private async loadTreeFields(
    ids: string[],
    opts?: { manager?: EntityManager },
  ): Promise<Map<string, { parent_name: string | null; path: string; depth: number }>> {
    const map = new Map<string, { parent_name: string | null; path: string; depth: number }>();
    if (ids.length === 0) return map;
    const mg = opts?.manager ?? this.repo.manager;
    const rows: Array<{ id: string; parent_name: string | null; path: string; depth: number }> = await mg.query(
      `SELECT bp.id::text AS id, ${businessProcessParentNameSql('bp')} AS parent_name, ${businessProcessPathSql('bp')} AS path,
              ${businessProcessDepthSql('bp')}::int AS depth
         FROM business_processes bp WHERE bp.tenant_id = app_current_tenant() AND bp.id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of rows) {
      map.set(row.id, { parent_name: row.parent_name, path: row.path, depth: Number(row.depth) || 0 });
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
    if (duplicate) throw duplicateNameException('Another business process already has this name.');

    const lifecycle = resolveLifecycleState({ nextStatus: body.status, nextDisabledAt: body.disabled_at });
    const parentId = normalizeParentId(body.parent_id);
    if (parentId) {
      await lockBusinessProcessTree(repo.manager);
      await assertBusinessProcessParent(repo.manager, { id: null, name: rawName }, parentId);
    }
    const entity = repo.create({
      name: rawName,
      description: (body.description ?? '').toString().trim() || null,
      owner_user_id: body.owner_user_id ?? null,
      it_owner_user_id: body.it_owner_user_id ?? null,
      notes: (body.notes ?? '').toString().trim() || null,
      process_type: normalizeProcessType(body.process_type),
      parent_id: parentId,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    const saved = await repo.save(entity);

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
    const mgr = opts?.manager ?? repo.manager;
    // Every update takes the tree lock before it reads the row: the save writes back every column it
    // read, the parent included, so a parent read before a concurrent move would undo that move unchecked.
    await lockBusinessProcessTree(mgr);
    // The stored row alone: the tree fields of `get` are not columns.
    const { parent: _parent, path: _path, depth: _depth, children: _children, ...existing } = await this.get(id, opts);
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
        if (duplicate) throw duplicateNameException('Another business process already has this name.');
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

    if (body.process_type !== undefined) {
      (existing as any).process_type = normalizeProcessType(body.process_type);
    }

    if (body.parent_id !== undefined) {
      const parentId = normalizeParentId(body.parent_id);
      if (parentId !== (before.parent_id ?? null)) {
        await assertBusinessProcessParent(mgr, { id, name: (existing as any).name }, parentId);
      }
      (existing as any).parent_id = parentId;
    }
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

  private csvHeaders(): string[] {
    return ['name', 'process_type', 'parent_name', 'description', 'notes', 'status'];
  }

  /**
   * The business processes file in the screen's language (`common/csv-sheet`). The status is read
   * from the end of validity, as on screen: the file has no date column.
   */
  async exportCsv<F extends ExportFileFormat = 'csv'>(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; language?: CsvLanguage; listQuery?: Record<string, unknown>; format?: F },
  ): Promise<ListExportFile<F>> {
    const headers = this.csvHeaders();
    const rows: ListExportCell[][] = [];
    if (scope === 'data') {
      // What the list shows (its search, filters, scope and sort), or the whole register by name.
      const query = opts?.listQuery ?? { page: 1, limit: MAX_EXPORT_LIMIT, sort: 'name:ASC', includeDisabled: '1' };
      const { items } = await this.list(query, { manager: opts?.manager, exportAll: true });
      for (const p of items as any[]) {
        rows.push([
          p.name ?? '',
          p.process_type ?? '',
          p.parent_name ?? '',
          p.description ?? '',
          p.notes ?? '',
          deriveStatusFromDisabledAt(p.disabled_at ?? null),
        ]);
      }
    }
    const filename = scope === 'template' ? 'business_processes_template.csv' : 'business_processes.csv';
    const sheetNames = { en: 'Business processes', fr: 'Processus métier', de: 'Geschäftsprozesse', es: 'Procesos de negocio' };
    return writeListExport({ format: opts?.format ?? ('csv' as F), language: opts?.language ?? 'en', filename, sheetNames, headers, rows });
  }

  /**
   * Reads the business processes file through the shared layer: either separator, UTF-8 or
   * Windows-1252, physical line numbers. A row matches the process of the same name whatever its
   * case (the stored spelling stays). The file has no end of validity: a blank status, or the
   * status the process already has, keeps the stored date; a new process is enabled unless the
   * row says disabled.
   */
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
    const rows = read.rows;

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const normalized: Array<{
      line: number;
      body: BusinessProcessUpsertDto;
      status: StatusState | null;
      parentName: string;
    }> = [];
    const lineByName = new Map<string, number>();

    for (const row of rows) {
      const line = row.line;
      const problems = rowProblemErrors(row);
      if (problems.length > 0) {
        errors.push(...problems);
        continue;
      }
      const name = cellOf(row, 'name');
      const rawStatus = cellOf(row, 'status').toLowerCase();
      const rawType = cellOf(row, 'process_type').toLowerCase();
      if (!name) errors.push(rowError(line, 'name', 'CSV_VALUE_REQUIRED', 'Name is required'));
      if (rawStatus && rawStatus !== 'enabled' && rawStatus !== 'disabled') {
        errors.push(rowError(line, 'status', 'CSV_ENUM_INVALID', `Invalid status '${rawStatus}'. Use 'enabled' or 'disabled'.`, { value: rawStatus, allowed: 'enabled, disabled' }));
      }
      if (rawType && !isBusinessProcessType(rawType)) {
        const allowed = BUSINESS_PROCESS_TYPES.join(', ');
        errors.push(rowError(line, 'process_type', 'CSV_ENUM_INVALID', `Invalid type '${rawType}'. Use ${allowed}.`, { value: rawType, allowed }));
      }
      if (name) {
        const firstLine = lineByName.get(name.toLowerCase());
        if (firstLine) {
          errors.push(rowError(line, 'name', 'CSV_DUPLICATE_KEY', `Name ${name} is already used on row ${firstLine}.`, { columns: 'name', firstRow: firstLine }));
        } else lineByName.set(name.toLowerCase(), line);
      }
      const body: BusinessProcessUpsertDto = {
        name,
        description: cellOf(row, 'description') || null,
        notes: cellOf(row, 'notes') || null,
        process_type: rawType || null,
      };
      const status = rawStatus === 'disabled' ? StatusState.DISABLED : rawStatus === 'enabled' ? StatusState.ENABLED : null;
      normalized.push({ line, body, status, parentName: cellOf(row, 'parent_name') });
    }

    const manager = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(manager);

    // Parents: a name of the file first, then a stored process. The tree lock is held from here to
    // the last write, so the stored tree checked below is the one the rows are written into.
    await lockBusinessProcessTree(manager);
    const stored = await repo.createQueryBuilder('bp').where('bp.tenant_id = app_current_tenant()').getMany();
    const storedByName = new Map(stored.map((row) => [row.name.toLowerCase(), row]));
    const storedById = new Map(stored.map((row) => [row.id, row]));
    for (const item of normalized) {
      const key = item.parentName.toLowerCase();
      if (item.parentName && !lineByName.has(key) && !storedByName.has(key)) {
        errors.push(rowError(item.line, 'parent_name', 'CSV_REFERENCE_NOT_FOUND', `Unknown parent process '${item.parentName}'.`, { value: item.parentName }));
      }
    }
    // The tree after the import, by lower-case name: a row's parent replaces the stored one.
    const parentOf = new Map<string, string | null>();
    for (const row of stored) {
      const parent = row.parent_id ? storedById.get(row.parent_id) : undefined;
      parentOf.set(row.name.toLowerCase(), parent ? parent.name.toLowerCase() : null);
    }
    for (const item of normalized) parentOf.set((item.body.name as string).toLowerCase(), item.parentName ? item.parentName.toLowerCase() : null);
    {
      for (const item of normalized) {
        const self = (item.body.name as string).toLowerCase();
        let current = parentOf.get(self) ?? null;
        for (let hop = 0; current && hop <= parentOf.size; hop += 1) {
          if (current === self) {
            errors.push(hop === 0
              ? rowError(item.line, 'parent_name', 'CSV_BUSINESS_PROCESS_OWN_PARENT', 'A business process cannot be its own parent.')
              : rowError(item.line, 'parent_name', 'CSV_BUSINESS_PROCESS_PARENT_INSIDE', `${item.body.name} cannot move under ${item.parentName}, which is inside it.`, { name: item.body.name as string, parent: item.parentName }));
            break;
          }
          current = parentOf.get(current) ?? null;
        }
      }
    }

    if (errors.length > 0) {
      return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors, ...report };
    }

    // A row identical to the stored process counts as unchanged and is not written: no audit
    // line, no new `updated_at`. A row matches the process of the same name whatever its case
    // ("order to cash" updates "Order to cash"): the stored spelling stays, and the report says
    // which process it matched.
    const warnings: ImportReportError[] = [];
    const found: Array<{ item: (typeof normalized)[number]; existing: BusinessProcess | null }> = [];
    for (const fileItem of normalized) {
      const name = fileItem.body.name as string;
      const existing = storedByName.get(name.toLowerCase()) ?? null;
      const warning = existing ? nameMatchedWarning(fileItem.line, 'name', name, existing.name) : null;
      if (warning) warnings.push(warning);
      // The status the row writes: on an update, only one that differs from the current one
      // (read from the end of validity), so a re-imported export keeps a future end of validity.
      const status = existing
        ? (fileItem.status && fileItem.status !== deriveStatusFromDisabledAt(existing.disabled_at ?? null) ? fileItem.status : undefined)
        : (fileItem.status ?? StatusState.ENABLED);
      const parentId = fileItem.parentName ? storedByName.get(fileItem.parentName.toLowerCase())?.id ?? null : null;
      const body = { ...fileItem.body, name: existing ? existing.name : name, parent_id: parentId, ...(status ? { status } : {}) };
      found.push({ item: { ...fileItem, body }, existing });
    }
    const now = new Date();
    const toWrite: Array<{ item: (typeof normalized)[number]; existing: BusinessProcess | null }> = [];
    for (const { item, existing } of found) {
      // A parent that is a new row of the file has no id yet: the row is written.
      const parentPending = !!item.parentName && !storedByName.has(item.parentName.toLowerCase());
      if (!existing) inserted += 1;
      else if (!parentPending && importRowUnchanged(existing, item.body, now)) {
        unchanged += 1;
        continue;
      } else updated += 1;
      toWrite.push({ item, existing });
    }

    if (dryRun) {
      return { ok: true, dryRun: true, total: rows.length, inserted, updated, unchanged, errors: [], warnings, ...report };
    }

    // Rows by their depth in the tree after the import, top first: when a row is written, every
    // process above it already has its final parent, so the check of create and update sees the
    // final chain above the row (the stored tree alone could still hold the row above its parent).
    const depthOf = (name: string): number => {
      let depth = 0;
      for (let current = parentOf.get(name) ?? null; current && depth <= parentOf.size; current = parentOf.get(current) ?? null) depth += 1;
      return depth;
    };
    const writeOrder = toWrite
      .map((entry, index) => ({ entry, index, depth: depthOf((entry.item.body.name as string).toLowerCase()) }))
      .sort((a, b) => a.depth - b.depth || a.index - b.index)
      .map(({ entry }) => entry);

    let processed = 0;
    const idByName = new Map(stored.map((row) => [row.name.toLowerCase(), row.id]));
    for (const { item, existing } of writeOrder) {
      const parentId = item.parentName ? idByName.get(item.parentName.toLowerCase()) ?? null : null;
      const body = { ...item.body, parent_id: parentId };
      if (existing) {
        await this.update(existing.id, body, userId ?? null, { manager });
      } else {
        const created = await this.create(body, userId ?? null, { manager });
        idByName.set(created.name.toLowerCase(), created.id);
      }
      processed += 1;
    }

    return { ok: true, dryRun: false, total: rows.length, inserted, updated, unchanged, processed, errors: [], warnings, ...report };
  }
}
