import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PortfolioSkill, DEFAULT_SKILLS } from './portfolio-skill.entity';
import { AuditService, writeAuditLogs } from '../audit/audit.service';

@Injectable()
export class PortfolioSkillsService {
  constructor(
    @InjectRepository(PortfolioSkill)
    private readonly repo: Repository<PortfolioSkill>,
    private readonly audit: AuditService,
  ) {}

  // ==================== LIST ====================
  async list(tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioSkill);

    const skills = await repo.find({
      where: { tenant_id: tenantId },
      order: { category: 'ASC', display_order: 'ASC', name: 'ASC' },
    });

    // Group by category
    const grouped: Record<string, PortfolioSkill[]> = {};
    for (const skill of skills) {
      if (!grouped[skill.category]) {
        grouped[skill.category] = [];
      }
      grouped[skill.category].push(skill);
    }

    return { items: skills, grouped };
  }

  // ==================== CREATE ====================
  async create(
    body: { category: string; name: string },
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioSkill);

    const category = String(body.category || '').trim();
    const name = String(body.name || '').trim();

    if (!category) throw new BadRequestException('category is required');
    if (!name) throw new BadRequestException('name is required');

    // Check for duplicate
    const existing = await repo.findOne({
      where: { tenant_id: tenantId, category, name },
    });
    if (existing) throw new BadRequestException('Skill already exists in this category');

    // Get max display_order for category
    const maxResult = await repo
      .createQueryBuilder('s')
      .select('MAX(s.display_order)', 'max')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.category = :category', { category })
      .getRawOne();
    const displayOrder = (maxResult?.max ?? -1) + 1;

    const entity = repo.create({
      tenant_id: tenantId,
      category,
      name,
      enabled: true,
      display_order: displayOrder,
    });

    const saved = await repo.save(entity);

    await this.audit.log({
      table: 'portfolio_skills',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  // ==================== UPDATE ====================
  async update(
    id: string,
    body: { category?: string; name?: string; enabled?: boolean },
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioSkill);

    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Skill not found');

    const before = { ...existing };

    if (body.category !== undefined) {
      const category = String(body.category).trim();
      if (!category) throw new BadRequestException('category cannot be empty');
      existing.category = category;
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      existing.name = name;
    }

    if (body.enabled !== undefined) {
      existing.enabled = body.enabled;
    }

    existing.updated_at = new Date();

    const saved = await repo.save(existing);

    await this.audit.log({
      table: 'portfolio_skills',
      recordId: id,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  // ==================== DELETE ====================
  async delete(
    id: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioSkill);

    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Skill not found');

    await repo.delete({ id });

    await this.audit.log({
      table: 'portfolio_skills',
      recordId: id,
      action: 'delete',
      before: existing,
      after: null,
      userId,
    }, { manager: mg });

    return { ok: true };
  }

  // ==================== SEED DEFAULTS ====================
  async seedDefaults(
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioSkill);

    // Check if already seeded
    const count = await repo.count({ where: { tenant_id: tenantId } });
    if (count > 0) {
      return { ok: true, message: 'Skills already exist', created: 0 };
    }

    // Seed defaults
    let displayOrder = 0;
    let currentCategory = '';
    const entities: PortfolioSkill[] = [];

    for (const skill of DEFAULT_SKILLS) {
      if (skill.category !== currentCategory) {
        currentCategory = skill.category;
        displayOrder = 0;
      }

      entities.push(repo.create({
        tenant_id: tenantId,
        category: skill.category,
        name: skill.name,
        enabled: true,
        display_order: displayOrder++,
      }));
    }

    const saved = await repo.save(entities);
    await writeAuditLogs(mg, saved.map((skill) => ({ table: 'portfolio_skills', recordId: skill.id, action: 'create', before: null, after: skill, userId })));

    return { ok: true, created: entities.length };
  }

  // ==================== GET CATEGORIES ====================
  async getCategories(tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;

    const result = await mg.query(
      `SELECT DISTINCT category FROM portfolio_skills WHERE tenant_id = $1 ORDER BY category`,
      [tenantId]
    );

    return result.map((r: any) => r.category);
  }
}
