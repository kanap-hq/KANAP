import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, EntityManager } from 'typeorm';
import { PortfolioPhaseTemplate, DEFAULT_PHASE_TEMPLATES } from './portfolio-phase-template.entity';
import { PortfolioPhaseTemplateItem } from './portfolio-phase-template-item.entity';
import { tenantSeedLanguage } from '../analytics/recommended-dimensions.seed';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PortfolioPhaseTemplatesService {
  constructor(
    @InjectRepository(PortfolioPhaseTemplate)
    private readonly repo: Repository<PortfolioPhaseTemplate>,
    @InjectRepository(PortfolioPhaseTemplateItem)
    private readonly itemRepo: Repository<PortfolioPhaseTemplateItem>,
    private readonly audit: AuditService,
  ) {}

  // ==================== LIST ====================
  async list(tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const templateRepo = mg.getRepository(PortfolioPhaseTemplate);
    const itemRepo = mg.getRepository(PortfolioPhaseTemplateItem);

    let templates = await templateRepo.find({
      where: { tenant_id: tenantId },
      order: { sequence: 'ASC', name: 'ASC' },
    });

    // Seed defaults if none exist
    if (templates.length === 0) {
      await this.seedDefaults(tenantId, null, { manager: mg });
      templates = await templateRepo.find({
        where: { tenant_id: tenantId },
        order: { sequence: 'ASC', name: 'ASC' },
      });
    }

    if (templates.length === 0) return [];

    // Load items for all templates
    const templateIds = templates.map((t) => t.id);
    const items = await itemRepo.find({
      where: { template_id: In(templateIds) },
      order: { sequence: 'ASC' },
    });

    // Group items by template
    const itemsByTemplate: Record<string, PortfolioPhaseTemplateItem[]> = {};
    items.forEach((i) => {
      if (!itemsByTemplate[i.template_id]) itemsByTemplate[i.template_id] = [];
      itemsByTemplate[i.template_id].push(i);
    });

    return templates.map((t) => ({
      ...t,
      items: itemsByTemplate[t.id] || [],
    }));
  }

  // ==================== GET ====================
  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const templateRepo = mg.getRepository(PortfolioPhaseTemplate);
    const itemRepo = mg.getRepository(PortfolioPhaseTemplateItem);

    const template = await templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');

    const items = await itemRepo.find({
      where: { template_id: id },
      order: { sequence: 'ASC' },
    });

    return { ...template, items };
  }

  // ==================== CREATE ====================
  async create(
    body: {
      name: string;
      items: Array<{ name: string; has_milestone?: boolean; milestone_name?: string }>;
    },
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const templateRepo = mg.getRepository(PortfolioPhaseTemplate);
    const itemRepo = mg.getRepository(PortfolioPhaseTemplateItem);

    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    // Check uniqueness
    const existing = await templateRepo.findOne({ where: { tenant_id: tenantId, name } });
    if (existing) throw new BadRequestException('Template name must be unique');

    // Validate items (minimum 1)
    const items = body.items || [];
    if (items.length < 1) throw new BadRequestException('Template must have at least 1 phase');

    // Get max sequence
    const maxSeq = await templateRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .select('MAX(t.sequence)', 'max')
      .getRawOne();
    const sequence = (maxSeq?.max ?? -1) + 1;

    // Create template
    const template = templateRepo.create({
      tenant_id: tenantId,
      name,
      is_system: false,
      sequence,
    });
    const savedTemplate = await templateRepo.save(template);

    // Create items
    const savedItems: PortfolioPhaseTemplateItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const savedItem = await itemRepo.save(
        itemRepo.create({
          tenant_id: tenantId,
          template_id: savedTemplate.id,
          name: String(item.name || '').trim(),
          sequence: i,
          has_milestone: item.has_milestone !== false,
          milestone_name: item.milestone_name ? String(item.milestone_name).trim() : null,
        }),
      );
      savedItems.push(savedItem);
    }

    await this.audit.log(
      {
        table: 'portfolio_phase_templates',
        recordId: savedTemplate.id,
        action: 'create',
        before: null,
        after: { ...savedTemplate, items: savedItems },
        userId,
      },
      { manager: mg },
    );

    return { ...savedTemplate, items: savedItems };
  }

  // ==================== UPDATE ====================
  async update(
    id: string,
    body: {
      name?: string;
      items?: Array<{ id?: string; name: string; has_milestone?: boolean; milestone_name?: string }>;
    },
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const templateRepo = mg.getRepository(PortfolioPhaseTemplate);
    const itemRepo = mg.getRepository(PortfolioPhaseTemplateItem);

    const template = await templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');

    const before = await this.get(id, { manager: mg });
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    // Update name
    if (has('name')) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');

      const existing = await templateRepo.findOne({ where: { tenant_id: tenantId, name } });
      if (existing && existing.id !== id) {
        throw new BadRequestException('Template name must be unique');
      }
      template.name = name;
    }

    template.updated_at = new Date();
    await templateRepo.save(template);

    // Update items if provided
    if (has('items')) {
      const newItems = body.items || [];
      if (newItems.length < 1) {
        throw new BadRequestException('Template must have at least 1 phase');
      }

      const existingItems = await itemRepo.find({ where: { template_id: id } });
      const existingMap = new Map(existingItems.map((i) => [i.id, i]));
      const toKeep = new Set<string>();

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i];
        if (item.id && existingMap.has(item.id)) {
          // Update existing
          const existing = existingMap.get(item.id)!;
          existing.name = String(item.name || '').trim();
          existing.sequence = i;
          existing.has_milestone = item.has_milestone !== false;
          existing.milestone_name = item.milestone_name ? String(item.milestone_name).trim() : null;
          await itemRepo.save(existing);
          toKeep.add(item.id);
        } else {
          // Create new
          await itemRepo.save(
            itemRepo.create({
              tenant_id: tenantId,
              template_id: id,
              name: String(item.name || '').trim(),
              sequence: i,
              has_milestone: item.has_milestone !== false,
              milestone_name: item.milestone_name ? String(item.milestone_name).trim() : null,
            }),
          );
        }
      }

      // Delete removed items
      const toDelete = existingItems.filter((i) => !toKeep.has(i.id));
      for (const item of toDelete) {
        await itemRepo.delete({ id: item.id });
      }
    }

    const after = await this.get(id, { manager: mg });

    await this.audit.log(
      {
        table: 'portfolio_phase_templates',
        recordId: id,
        action: 'update',
        before,
        after,
        userId,
      },
      { manager: mg },
    );

    return after;
  }

  // ==================== DELETE ====================
  async delete(id: string, userId: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const templateRepo = mg.getRepository(PortfolioPhaseTemplate);

    const template = await templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');

    const before = await this.get(id, { manager: mg });

    // Cascade deletes items
    await templateRepo.delete({ id });

    await this.audit.log(
      {
        table: 'portfolio_phase_templates',
        recordId: id,
        action: 'delete',
        before,
        after: null,
        userId,
      },
      { manager: mg },
    );

    return { ok: true };
  }

  // ==================== SEED DEFAULTS ====================
  async seedDefaults(tenantId: string, userId: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const templateRepo = mg.getRepository(PortfolioPhaseTemplate);
    const itemRepo = mg.getRepository(PortfolioPhaseTemplateItem);

    // Check if already seeded
    const count = await templateRepo.count({ where: { tenant_id: tenantId } });
    if (count > 0) {
      return { ok: true, message: 'Templates already exist', created: 0 };
    }

    // Named in the workspace seed language (`metadata.language`), English when absent.
    const [tenant] = await mg.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
    const language = tenantSeedLanguage(tenant?.metadata);
    let created = 0;
    for (let seq = 0; seq < DEFAULT_PHASE_TEMPLATES.length; seq++) {
      const def = DEFAULT_PHASE_TEMPLATES[seq];

      const template = await templateRepo.save(
        templateRepo.create({
          tenant_id: tenantId,
          name: def.name[language],
          is_system: true,
          sequence: seq,
        }),
      );

      for (let i = 0; i < def.items.length; i++) {
        const item = def.items[i];
        await itemRepo.save(
          itemRepo.create({
            tenant_id: tenantId,
            template_id: template.id,
            name: item.name[language],
            sequence: i,
            has_milestone: item.has_milestone,
            milestone_name: item.milestone_name[language],
          }),
        );
      }

      created++;
    }

    return { ok: true, created };
  }
}
