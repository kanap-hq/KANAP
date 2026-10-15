import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BusinessProcessCategory } from './business-process-category.entity';
import { BusinessProcessCategoryLink } from './business-process-category-link.entity';
import { parsePagination } from '../common/pagination';
import { BusinessProcessCategoryUpsertDto } from './dto/business-process-category.dto';
import { RecordInUseException } from '../common/record-in-use';
import { AuditService } from '../audit/audit.service';
import { textSortKey } from '../common/list-sort';

@Injectable()
export class BusinessProcessCategoriesService {
  constructor(
    @InjectRepository(BusinessProcessCategory) private readonly categoriesRepo: Repository<BusinessProcessCategory>,
    @InjectRepository(BusinessProcessCategoryLink) private readonly linksRepo: Repository<BusinessProcessCategoryLink>,
    private readonly audit: AuditService,
  ) {}

  private getCategoriesRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(BusinessProcessCategory) : this.categoriesRepo;
  }

  private getLinksRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(BusinessProcessCategoryLink) : this.linksRepo;
  }

  async list(query: any, opts?: { manager?: EntityManager }) {
    const repo = this.getCategoriesRepo(opts?.manager);
    const { page, limit, skip } = parsePagination(query, { field: 'sort_order', direction: 'ASC' });
    const includeInactive = String(query?.includeInactive ?? 'false').toLowerCase() === 'true';

    const qb = repo.createQueryBuilder('cat');
    if (!includeInactive) {
      qb.where('cat.is_active = true');
    }

    const total = await qb.getCount();
    // By position, then by name alphabetically (case and accents ignored), then the id.
    const items = await qb
      .addSelect((await textSortKey(qb.connection.manager))('cat.name'), 'list_sort_key')
      .orderBy('cat.sort_order', 'ASC')
      .addOrderBy('list_sort_key', 'ASC')
      .addOrderBy('cat.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getMany();

    return { items, total, page, limit };
  }

  async create(body: { name: string } | BusinessProcessCategoryUpsertDto, userId?: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getCategoriesRepo(opts?.manager);
    const rawName = (body.name ?? '').toString().trim();
    if (!rawName) throw new BadRequestException('Name is required');

    const duplicate = await repo
      .createQueryBuilder('cat')
      .where('LOWER(cat.name) = LOWER(:name)', { name: rawName })
      .getOne();
    if (duplicate) {
      throw new BadRequestException('A category with this name already exists');
    }

    const payload = body as BusinessProcessCategoryUpsertDto;
    const next = repo.create({
      name: rawName,
      is_active: payload.is_active ?? true,
      is_default: payload.is_default ?? false,
      sort_order: payload.sort_order ?? 100,
    });
    const saved = await repo.save(next);
    await this.audit.log(
      {
        table: 'business_process_categories',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
  }

  async update(id: string, body: BusinessProcessCategoryUpsertDto, userId?: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getCategoriesRepo(opts?.manager);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new BadRequestException('Category not found');
    const before = { ...existing };

    if (body.name !== undefined) {
      const trimmed = (body.name ?? '').toString().trim();
      if (!trimmed) throw new BadRequestException('Name cannot be empty');
      if (trimmed !== existing.name) {
        const duplicate = await repo
          .createQueryBuilder('cat')
          .where('LOWER(cat.name) = LOWER(:name)', { name: trimmed })
          .andWhere('cat.id <> :id', { id })
          .getOne();
        if (duplicate) throw new BadRequestException('Another category already uses this name');
        existing.name = trimmed;
      }
    }
    if (body.is_active !== undefined) {
      existing.is_active = !!body.is_active;
    }
    if (body.is_default !== undefined) {
      existing.is_default = !!body.is_default;
    }
    if (body.sort_order !== undefined && Number.isFinite(body.sort_order)) {
      existing.sort_order = body.sort_order!;
    }
    const saved = await repo.save(existing);
    await this.audit.log(
      {
        table: 'business_process_categories',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
  }

  async delete(id: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const linksRepo = this.getLinksRepo(opts?.manager);
    const repo = this.getCategoriesRepo(opts?.manager);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new BadRequestException('Category not found');

    const linkCount = await linksRepo.count({ where: { category_id: id } as any });
    if (linkCount > 0) {
      throw new RecordInUseException('RECORD_USED_BY', 'category', existing.name, [{ type: 'business_processes', total: linkCount }],
        `Cannot delete category "${existing.name}" because it is used by one or more business processes. Disable it instead.`);
    }
    await repo.delete({ id });
    await this.audit.log(
      {
        table: 'business_process_categories',
        recordId: id,
        action: 'delete',
        before: existing,
        after: null,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
  }
}
