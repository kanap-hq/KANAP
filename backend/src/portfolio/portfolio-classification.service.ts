import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PortfolioSource } from './portfolio-source.entity';
import { PortfolioCategory } from './portfolio-category.entity';
import { PortfolioStream } from './portfolio-stream.entity';
import { ensureStartingPortfolioClassification } from './starting-classification.seed';
import { tenantSeedLanguage } from '../analytics/recommended-dimensions.seed';
import { PortfolioTaskType, DEFAULT_TASK_TYPES } from './portfolio-task-type.entity';
import { checkIds, RecordInUseException, refusalsFrom, type DeleteRefusal, type UsageCount } from '../common/record-in-use';

/** A built-in classification item cannot be deleted (`BUILT_IN_RECORD`): disable it instead. */
function builtInRefusal(entity: string, name: string): RecordInUseException {
  return new RecordInUseException('BUILT_IN_RECORD', entity, name, [], `Cannot delete system ${entity} "${name}". Disable it instead.`);
}

/** The classification lists whose items a check before the delete answers (`POST .../<kind>/delete-check`). */
export type ClassificationKind = 'sources' | 'categories' | 'streams' | 'task-types';

const CLASSIFICATION_TABLES: Record<ClassificationKind, string> = {
  sources: 'portfolio_sources',
  categories: 'portfolio_categories',
  streams: 'portfolio_streams',
  'task-types': 'portfolio_task_types',
};

type ClassificationRow = { id: string; name: string; is_system?: boolean };

/** A classification item that requests, projects or tasks still name (`RECORD_USED_BY`, counted): disable it instead. */
function usedByRefusal(entity: string, name: string, usages: UsageCount[]): RecordInUseException | null {
  if (usages.length === 0) return null;
  return new RecordInUseException('RECORD_USED_BY', entity, name, usages);
}

interface CreateSourceDto {
  name: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
}

interface UpdateSourceDto {
  name?: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
}

interface CreateCategoryDto {
  name: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
}

interface UpdateCategoryDto {
  name?: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
}

interface CreateStreamDto {
  category_id: string;
  name: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
}

interface UpdateStreamDto {
  name?: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
  category_id?: string;
}

interface CreateTaskTypeDto {
  name: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
}

interface UpdateTaskTypeDto {
  name?: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
}

export interface CategoryWithStreams extends PortfolioCategory {
  streams: PortfolioStream[];
}

type ServiceOpts = { manager?: EntityManager };

@Injectable()
export class PortfolioClassificationService {
  constructor(
    @InjectRepository(PortfolioSource)
    private sourceRepo: Repository<PortfolioSource>,
    @InjectRepository(PortfolioCategory)
    private categoryRepo: Repository<PortfolioCategory>,
    @InjectRepository(PortfolioStream)
    private streamRepo: Repository<PortfolioStream>,
    @InjectRepository(PortfolioTaskType)
    private taskTypeRepo: Repository<PortfolioTaskType>,
  ) {}

  // ============================================
  // Sources
  // ============================================

  async listSources(tenantId: string, opts?: ServiceOpts): Promise<PortfolioSource[]> {
    const repo = opts?.manager?.getRepository(PortfolioSource) ?? this.sourceRepo;
    return repo.find({
      where: { tenant_id: tenantId },
      order: { name: 'ASC' },
    });
  }

  async getSource(id: string, tenantId: string, opts?: ServiceOpts): Promise<PortfolioSource | null> {
    const repo = opts?.manager?.getRepository(PortfolioSource) ?? this.sourceRepo;
    return repo.findOne({
      where: { id, tenant_id: tenantId },
    });
  }

  async createSource(tenantId: string, data: CreateSourceDto, opts?: ServiceOpts): Promise<PortfolioSource> {
    const repo = opts?.manager?.getRepository(PortfolioSource) ?? this.sourceRepo;

    // Check for duplicate name
    const existing = await repo.findOne({
      where: { tenant_id: tenantId, name: data.name },
    });
    if (existing) {
      throw new BadRequestException(`Source with name "${data.name}" already exists`);
    }

    // Get max display_order if not provided
    let displayOrder = data.display_order;
    if (displayOrder === undefined) {
      const maxResult = await repo
        .createQueryBuilder('s')
        .select('MAX(s.display_order)', 'max')
        .where('s.tenant_id = :tenantId', { tenantId })
        .getRawOne();
      displayOrder = (maxResult?.max ?? -1) + 1;
    }

    const source = repo.create({
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? null,
      is_active: data.is_active ?? true,
      display_order: displayOrder,
      is_system: false,
    });

    return repo.save(source);
  }

  async updateSource(id: string, tenantId: string, data: UpdateSourceDto, opts?: ServiceOpts): Promise<PortfolioSource> {
    const repo = opts?.manager?.getRepository(PortfolioSource) ?? this.sourceRepo;

    const source = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!source) {
      throw new NotFoundException('Source not found');
    }

    // Check for duplicate name if changing
    if (data.name && data.name !== source.name) {
      const existing = await repo.findOne({
        where: { tenant_id: tenantId, name: data.name },
      });
      if (existing) {
        throw new BadRequestException(`Source with name "${data.name}" already exists`);
      }
    }

    Object.assign(source, {
      ...data,
      updated_at: new Date(),
    });

    return repo.save(source);
  }

  async deleteSource(id: string, tenantId: string, opts?: ServiceOpts): Promise<void> {
    const mg = opts?.manager ?? this.sourceRepo.manager;
    const repo = mg.getRepository(PortfolioSource);

    const source = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!source) {
      throw new NotFoundException('Source not found');
    }

    const refusal = await this.refusalOf('sources', source, tenantId, mg);
    if (refusal) throw refusal;

    await repo.delete(id);
  }

  /**
   * The refusal the delete of a classification item would throw, or null: a built-in item
   * (`BUILT_IN_RECORD`), or one that requests, projects or tasks still name (`RECORD_USED_BY`).
   * The delete and its check both ask it, so they agree.
   */
  private async refusalOf(kind: ClassificationKind, row: ClassificationRow, tenantId: string, mg: EntityManager): Promise<RecordInUseException | null> {
    switch (kind) {
      case 'sources':
        if (row.is_system) return builtInRefusal('source', row.name);
        return usedByRefusal('source', row.name, await this.portfolioUsages('source_id', row.id, tenantId, mg));
      case 'categories':
        if (row.is_system) return builtInRefusal('category', row.name);
        return usedByRefusal('category', row.name, await this.portfolioUsages('category_id', row.id, tenantId, mg));
      case 'streams':
        return usedByRefusal('stream', row.name, await this.portfolioUsages('stream_id', row.id, tenantId, mg));
      case 'task-types': {
        if (row.is_system) return builtInRefusal('task type', row.name);
        const [used] = await mg.query(
          `SELECT count(*)::int AS n FROM tasks WHERE tenant_id = $1 AND task_type_id = $2`,
          [tenantId, row.id],
        );
        return usedByRefusal('task type', row.name, used?.n > 0 ? [{ type: 'tasks', total: used.n }] : []);
      }
    }
  }

  /** The check before a delete (`POST .../<kind>/delete-check`): the items of `ids` the delete would refuse, and why. Nothing is written. */
  async deleteCheck(kind: ClassificationKind, ids: unknown[], tenantId: string, opts?: ServiceOpts): Promise<{ refused: DeleteRefusal[] }> {
    const mg = opts?.manager ?? this.sourceRepo.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const table = CLASSIFICATION_TABLES[kind];
    const systemColumn = kind === 'streams' ? 'false' : 'is_system';
    const rows: ClassificationRow[] = await mg.query(
      `SELECT id::text AS id, name, ${systemColumn} AS is_system FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    return refusalsFrom(wanted, rows, (row) => row.name, (row) => this.refusalOf(kind, row, tenantId, mg));
  }

  /** The requests and projects whose `column` names `id`, each kind only when not zero. */
  private async portfolioUsages(
    column: 'source_id' | 'category_id' | 'stream_id',
    id: string,
    tenantId: string,
    mg: EntityManager,
  ): Promise<UsageCount[]> {
    const [row] = await mg.query(
      `SELECT (SELECT count(*)::int FROM portfolio_requests WHERE tenant_id = $1 AND ${column} = $2) AS requests,
              (SELECT count(*)::int FROM portfolio_projects WHERE tenant_id = $1 AND ${column} = $2) AS projects`,
      [tenantId, id],
    );
    const usages: UsageCount[] = [];
    if (row?.requests > 0) usages.push({ type: 'requests', total: row.requests });
    if (row?.projects > 0) usages.push({ type: 'projects', total: row.projects });
    return usages;
  }

  // ============================================
  // Categories
  // ============================================

  async listCategories(tenantId: string, opts?: ServiceOpts): Promise<PortfolioCategory[]> {
    const repo = opts?.manager?.getRepository(PortfolioCategory) ?? this.categoryRepo;
    return repo.find({
      where: { tenant_id: tenantId },
      order: { name: 'ASC' },
    });
  }

  async getCategory(id: string, tenantId: string, opts?: ServiceOpts): Promise<PortfolioCategory | null> {
    const repo = opts?.manager?.getRepository(PortfolioCategory) ?? this.categoryRepo;
    return repo.findOne({
      where: { id, tenant_id: tenantId },
    });
  }

  async createCategory(tenantId: string, data: CreateCategoryDto, opts?: ServiceOpts): Promise<PortfolioCategory> {
    const repo = opts?.manager?.getRepository(PortfolioCategory) ?? this.categoryRepo;

    // Check for duplicate name
    const existing = await repo.findOne({
      where: { tenant_id: tenantId, name: data.name },
    });
    if (existing) {
      throw new BadRequestException(`Category with name "${data.name}" already exists`);
    }

    // Get max display_order if not provided
    let displayOrder = data.display_order;
    if (displayOrder === undefined) {
      const maxResult = await repo
        .createQueryBuilder('c')
        .select('MAX(c.display_order)', 'max')
        .where('c.tenant_id = :tenantId', { tenantId })
        .getRawOne();
      displayOrder = (maxResult?.max ?? -1) + 1;
    }

    const category = repo.create({
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? null,
      is_active: data.is_active ?? true,
      display_order: displayOrder,
      is_system: false,
    });

    return repo.save(category);
  }

  async updateCategory(id: string, tenantId: string, data: UpdateCategoryDto, opts?: ServiceOpts): Promise<PortfolioCategory> {
    const repo = opts?.manager?.getRepository(PortfolioCategory) ?? this.categoryRepo;

    const category = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // Check for duplicate name if changing
    if (data.name && data.name !== category.name) {
      const existing = await repo.findOne({
        where: { tenant_id: tenantId, name: data.name },
      });
      if (existing) {
        throw new BadRequestException(`Category with name "${data.name}" already exists`);
      }
    }

    Object.assign(category, {
      ...data,
      updated_at: new Date(),
    });

    return repo.save(category);
  }

  async deleteCategory(id: string, tenantId: string, opts?: ServiceOpts): Promise<void> {
    const mg = opts?.manager ?? this.categoryRepo.manager;
    const repo = mg.getRepository(PortfolioCategory);

    const category = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const refusal = await this.refusalOf('categories', category, tenantId, mg);
    if (refusal) throw refusal;

    // Streams will be cascade deleted
    await repo.delete(id);
  }

  // ============================================
  // Streams
  // ============================================

  async listStreams(tenantId: string, categoryId?: string, opts?: ServiceOpts): Promise<PortfolioStream[]> {
    const repo = opts?.manager?.getRepository(PortfolioStream) ?? this.streamRepo;
    const where: Record<string, unknown> = { tenant_id: tenantId };
    if (categoryId) {
      where.category_id = categoryId;
    }

    return repo.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async getStream(id: string, tenantId: string, opts?: ServiceOpts): Promise<PortfolioStream | null> {
    const repo = opts?.manager?.getRepository(PortfolioStream) ?? this.streamRepo;
    return repo.findOne({
      where: { id, tenant_id: tenantId },
    });
  }

  async createStream(tenantId: string, data: CreateStreamDto, opts?: ServiceOpts): Promise<PortfolioStream> {
    const mg = opts?.manager ?? this.streamRepo.manager;
    const streamRepoLocal = mg.getRepository(PortfolioStream);
    const categoryRepoLocal = mg.getRepository(PortfolioCategory);

    // Verify category exists and belongs to tenant
    const category = await categoryRepoLocal.findOne({
      where: { id: data.category_id, tenant_id: tenantId },
    });
    if (!category) {
      throw new BadRequestException('Category not found');
    }

    // Check for duplicate name within category
    const existing = await streamRepoLocal.findOne({
      where: { tenant_id: tenantId, category_id: data.category_id, name: data.name },
    });
    if (existing) {
      throw new BadRequestException(`Stream with name "${data.name}" already exists in this category`);
    }

    // Get max display_order if not provided
    let displayOrder = data.display_order;
    if (displayOrder === undefined) {
      const maxResult = await streamRepoLocal
        .createQueryBuilder('s')
        .select('MAX(s.display_order)', 'max')
        .where('s.tenant_id = :tenantId AND s.category_id = :categoryId', {
          tenantId,
          categoryId: data.category_id,
        })
        .getRawOne();
      displayOrder = (maxResult?.max ?? -1) + 1;
    }

    const stream = streamRepoLocal.create({
      tenant_id: tenantId,
      category_id: data.category_id,
      name: data.name,
      description: data.description ?? null,
      is_active: data.is_active ?? true,
      display_order: displayOrder,
    });

    return streamRepoLocal.save(stream);
  }

  async updateStream(id: string, tenantId: string, data: UpdateStreamDto, opts?: ServiceOpts): Promise<PortfolioStream> {
    const mg = opts?.manager ?? this.streamRepo.manager;
    const streamRepoLocal = mg.getRepository(PortfolioStream);
    const categoryRepoLocal = mg.getRepository(PortfolioCategory);

    const stream = await streamRepoLocal.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    // If changing category, verify new category
    const categoryId = data.category_id ?? stream.category_id;
    if (data.category_id && data.category_id !== stream.category_id) {
      const category = await categoryRepoLocal.findOne({
        where: { id: data.category_id, tenant_id: tenantId },
      });
      if (!category) {
        throw new BadRequestException('Category not found');
      }
    }

    // Check for duplicate name if changing name or category
    if ((data.name && data.name !== stream.name) || (data.category_id && data.category_id !== stream.category_id)) {
      const existing = await streamRepoLocal.findOne({
        where: {
          tenant_id: tenantId,
          category_id: categoryId,
          name: data.name ?? stream.name,
        },
      });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Stream with name "${data.name ?? stream.name}" already exists in this category`);
      }
    }

    Object.assign(stream, {
      ...data,
      updated_at: new Date(),
    });

    return streamRepoLocal.save(stream);
  }

  async deleteStream(id: string, tenantId: string, opts?: ServiceOpts): Promise<void> {
    const mg = opts?.manager ?? this.streamRepo.manager;
    const repo = mg.getRepository(PortfolioStream);

    const stream = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    const refusal = await this.refusalOf('streams', stream, tenantId, mg);
    if (refusal) throw refusal;

    await repo.delete(id);
  }

  // ============================================
  // Task Types
  // ============================================

  async listTaskTypes(tenantId: string, opts?: ServiceOpts): Promise<PortfolioTaskType[]> {
    const repo = opts?.manager?.getRepository(PortfolioTaskType) ?? this.taskTypeRepo;
    return repo.find({
      where: { tenant_id: tenantId },
      order: { display_order: 'ASC', name: 'ASC' },
    });
  }

  async getTaskType(id: string, tenantId: string, opts?: ServiceOpts): Promise<PortfolioTaskType | null> {
    const repo = opts?.manager?.getRepository(PortfolioTaskType) ?? this.taskTypeRepo;
    return repo.findOne({
      where: { id, tenant_id: tenantId },
    });
  }

  async createTaskType(tenantId: string, data: CreateTaskTypeDto, opts?: ServiceOpts): Promise<PortfolioTaskType> {
    const repo = opts?.manager?.getRepository(PortfolioTaskType) ?? this.taskTypeRepo;

    // Check for duplicate name
    const existing = await repo.findOne({
      where: { tenant_id: tenantId, name: data.name },
    });
    if (existing) {
      throw new BadRequestException(`Task type with name "${data.name}" already exists`);
    }

    // Get max display_order if not provided
    let displayOrder = data.display_order;
    if (displayOrder === undefined) {
      const maxResult = await repo
        .createQueryBuilder('t')
        .select('MAX(t.display_order)', 'max')
        .where('t.tenant_id = :tenantId', { tenantId })
        .getRawOne();
      displayOrder = (maxResult?.max ?? -1) + 1;
    }

    const taskType = repo.create({
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? null,
      is_active: data.is_active ?? true,
      display_order: displayOrder,
      is_system: false,
    });

    return repo.save(taskType);
  }

  async updateTaskType(id: string, tenantId: string, data: UpdateTaskTypeDto, opts?: ServiceOpts): Promise<PortfolioTaskType> {
    const repo = opts?.manager?.getRepository(PortfolioTaskType) ?? this.taskTypeRepo;

    const taskType = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!taskType) {
      throw new NotFoundException('Task type not found');
    }

    // Check for duplicate name if changing
    if (data.name && data.name !== taskType.name) {
      const existing = await repo.findOne({
        where: { tenant_id: tenantId, name: data.name },
      });
      if (existing) {
        throw new BadRequestException(`Task type with name "${data.name}" already exists`);
      }
    }

    // Only the editable fields: the code stays with the type through a rename.
    if (data.name !== undefined) taskType.name = data.name;
    if (data.description !== undefined) taskType.description = data.description;
    if (data.is_active !== undefined) taskType.is_active = data.is_active;
    if (data.display_order !== undefined) taskType.display_order = data.display_order;
    taskType.updated_at = new Date();

    return repo.save(taskType);
  }

  async deleteTaskType(id: string, tenantId: string, opts?: ServiceOpts): Promise<void> {
    const mg = opts?.manager ?? this.taskTypeRepo.manager;
    const repo = mg.getRepository(PortfolioTaskType);

    const taskType = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!taskType) {
      throw new NotFoundException('Task type not found');
    }

    const refusal = await this.refusalOf('task-types', taskType, tenantId, mg);
    if (refusal) throw refusal;

    await repo.delete(id);
  }

  async seedDefaultTaskTypes(tenantId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(PortfolioTaskType) : this.taskTypeRepo;

    for (const def of DEFAULT_TASK_TYPES) {
      // A renamed default keeps its code: it is still there.
      const existing = await repo.findOne({
        where: [
          { tenant_id: tenantId, name: def.name },
          { tenant_id: tenantId, code: def.code },
        ],
      });
      if (!existing) {
        const taskType = repo.create({
          tenant_id: tenantId,
          ...def,
        });
        await repo.save(taskType);
      }
    }
  }

  // ============================================
  // Combined Operations
  // ============================================

  /**
   * The starting sources and categories of a new workspace (`starting-classification.seed.ts`), in
   * the workspace seed language, as ordinary values, then the task types. No stream: the user
   * creates their own.
   */
  async seedAllDefaults(tenantId: string, manager?: EntityManager): Promise<void> {
    const mg = manager ?? this.sourceRepo.manager;
    const [tenant] = await mg.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
    await ensureStartingPortfolioClassification(mg, tenantId, tenantSeedLanguage(tenant?.metadata));
    await this.seedDefaultTaskTypes(tenantId, manager);
  }

  async getCategoriesWithStreams(tenantId: string, opts?: ServiceOpts): Promise<CategoryWithStreams[]> {
    const categories = await this.listCategories(tenantId, opts);
    const streams = await this.listStreams(tenantId, undefined, opts);

    // Group streams by category
    const streamsByCategory: Record<string, PortfolioStream[]> = {};
    for (const stream of streams) {
      if (!streamsByCategory[stream.category_id]) {
        streamsByCategory[stream.category_id] = [];
      }
      streamsByCategory[stream.category_id].push(stream);
    }

    return categories.map((cat) => ({
      ...cat,
      streams: streamsByCategory[cat.id] || [],
    }));
  }

  async getAll(tenantId: string, opts?: ServiceOpts): Promise<{
    sources: PortfolioSource[];
    categories: CategoryWithStreams[];
    streams: PortfolioStream[];
    taskTypes: PortfolioTaskType[];
  }> {
    const sources = await this.listSources(tenantId, opts);
    const categories = await this.getCategoriesWithStreams(tenantId, opts);
    const streams = await this.listStreams(tenantId, undefined, opts);
    const taskTypes = await this.listTaskTypes(tenantId, opts);

    return { sources, categories, streams, taskTypes };
  }

  // ============================================
  // Validation helpers for Request/Project services
  // ============================================

  async validateTaskType(tenantId: string, taskTypeId?: string | null, opts?: ServiceOpts): Promise<void> {
    if (taskTypeId) {
      const taskType = await this.getTaskType(taskTypeId, tenantId, opts);
      if (!taskType) {
        throw new BadRequestException('Invalid task type');
      }
      if (!taskType.is_active) {
        throw new BadRequestException('Task type is not active');
      }
    }
  }

  async validateClassification(
    tenantId: string,
    sourceId?: string | null,
    categoryId?: string | null,
    streamId?: string | null,
    opts?: ServiceOpts,
  ): Promise<void> {
    // Validate source if provided
    if (sourceId) {
      const source = await this.getSource(sourceId, tenantId, opts);
      if (!source) {
        throw new BadRequestException('Invalid source');
      }
      if (!source.is_active) {
        throw new BadRequestException('Source is not active');
      }
    }

    // Validate category if provided
    if (categoryId) {
      const category = await this.getCategory(categoryId, tenantId, opts);
      if (!category) {
        throw new BadRequestException('Invalid category');
      }
      if (!category.is_active) {
        throw new BadRequestException('Category is not active');
      }
    }

    // Validate stream if provided
    if (streamId) {
      const stream = await this.getStream(streamId, tenantId, opts);
      if (!stream) {
        throw new BadRequestException('Invalid stream');
      }
      if (!stream.is_active) {
        throw new BadRequestException('Stream is not active');
      }

      // Stream must belong to the selected category
      if (categoryId && stream.category_id !== categoryId) {
        throw new BadRequestException('Stream does not belong to selected category');
      }

      // If no category provided but stream is, use stream's category
      // This is allowed - stream implies category
    }
  }
}
