import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioProjectPhase, PhaseStatus } from '../portfolio-project-phase.entity';
import { PortfolioProjectMilestone } from '../portfolio-project-milestone.entity';
import { PortfolioPhaseTemplate } from '../portfolio-phase-template.entity';
import { PortfolioPhaseTemplateItem } from '../portfolio-phase-template-item.entity';
import { AuditService } from '../../audit/audit.service';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';
import { PHASE_REORDER_MAX_IDS } from '../dto/reorder-phases.dto';

/**
 * Service for managing project phases.
 */
@Injectable()
export class PortfolioPhasesService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
    private readonly audit: AuditService,
  ) {
    super(projectRepo);
  }

  /**
   * List all phases for a project.
   */
  async listPhases(projectId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    return mg.query(
      `SELECT * FROM portfolio_project_phases
       WHERE project_id = $1
       ORDER BY sequence ASC`,
      [projectId]
    );
  }

  /**
   * Create a new phase.
   */
  async createPhase(
    projectId: string,
    body: { name: string; planned_start?: string; planned_end?: string },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const phaseRepo = mg.getRepository(PortfolioProjectPhase);
    if (!userId) throw new BadRequestException('userId is required for change activity logging');

    const project = await this.ensureProject(projectId, mg);

    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    // Get max sequence
    const maxSeq = await mg.query(
      `SELECT COALESCE(MAX(sequence), -1) as max FROM portfolio_project_phases WHERE project_id = $1`,
      [projectId]
    );
    const sequence = (maxSeq[0]?.max ?? -1) + 1;

    const phase = phaseRepo.create({
      tenant_id: tenantId,
      project_id: projectId,
      name,
      sequence,
      planned_start: body.planned_start || null,
      planned_end: body.planned_end || null,
      status: 'pending' as PhaseStatus,
    });

    const saved = await phaseRepo.save(phase);

    await this.audit.log(
      {
        table: 'portfolio_project_phases',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    await this.logActivity(mg, {
      project_id: projectId,
      tenant_id: project.tenant_id,
      author_id: userId,
      type: 'change',
      changed_fields: {
        phase: [null, saved.name],
      },
    });

    return saved;
  }

  /**
   * Update a phase.
   */
  async updatePhase(
    phaseId: string,
    body: { name?: string; planned_start?: string; planned_end?: string; status?: PhaseStatus },
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const phaseRepo = mg.getRepository(PortfolioProjectPhase);
    const milestoneRepo = mg.getRepository(PortfolioProjectMilestone);
    if (!userId) throw new BadRequestException('userId is required for change activity logging');

    const phase = await phaseRepo.findOne({ where: { id: phaseId } });
    if (!phase) throw new NotFoundException('Phase not found');

    const before = { ...phase };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    if (has('name')) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      phase.name = name;
    }

    if (has('planned_start')) phase.planned_start = (body.planned_start || null) as any;

    // Normalize dates to YYYY-MM-DD for comparison
    const toYmd = (d: any): string => {
      if (!d) return '';
      if (d instanceof Date) return d.toISOString().split('T')[0];
      const s = String(d);
      if (s.includes('T')) return s.split('T')[0];
      return s;
    };
    const plannedEndChanged = has('planned_end') && toYmd(phase.planned_end) !== toYmd(body.planned_end);
    if (has('planned_end')) phase.planned_end = (body.planned_end || null) as any;

    const previousStatus = before.status;
    if (has('status')) {
      const valid: PhaseStatus[] = ['pending', 'in_progress', 'completed'];
      if (!valid.includes(body.status!)) {
        throw new BadRequestException('Invalid status');
      }
      phase.status = body.status!;
    }

    phase.updated_at = new Date();
    const saved = await phaseRepo.save(phase);

    // Sync phase-linked milestone when planned_end or status changes
    const statusChangedToCompleted = phase.status === 'completed' && previousStatus !== 'completed';
    const statusChangedFromCompleted = previousStatus === 'completed' && phase.status !== 'completed';

    if (plannedEndChanged || statusChangedToCompleted || statusChangedFromCompleted) {
      const milestoneUpdate: Partial<PortfolioProjectMilestone> = { updated_at: new Date() };

      if (plannedEndChanged) {
        milestoneUpdate.target_date = saved.planned_end;
      }

      if (statusChangedToCompleted) {
        milestoneUpdate.status = 'achieved';
        milestoneUpdate.target_date = saved.planned_end;
      } else if (statusChangedFromCompleted) {
        milestoneUpdate.status = 'pending';
      }

      await milestoneRepo.update(
        { phase_id: phaseId },
        milestoneUpdate
      );
    }

    await this.audit.log(
      {
        table: 'portfolio_project_phases',
        recordId: phaseId,
        action: 'update',
        before,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    const changedFields: Record<string, [unknown, unknown]> = {};
    const prefix = `phase.${saved.id}`;
    if (before.name !== saved.name) changedFields[`${prefix}.name`] = [before.name, saved.name];
    if (toYmd(before.planned_start) !== toYmd(saved.planned_start)) {
      changedFields[`${prefix}.planned_start`] = [toYmd(before.planned_start) || null, toYmd(saved.planned_start) || null];
    }
    if (toYmd(before.planned_end) !== toYmd(saved.planned_end)) {
      changedFields[`${prefix}.planned_end`] = [toYmd(before.planned_end) || null, toYmd(saved.planned_end) || null];
    }
    if (before.status !== saved.status) changedFields[`${prefix}.status`] = [before.status, saved.status];
    if (Object.keys(changedFields).length > 0) {
      await this.logActivity(mg, {
        project_id: saved.project_id,
        tenant_id: saved.tenant_id,
        author_id: userId,
        type: 'change',
        changed_fields: changedFields,
      });
    }

    return saved;
  }

  /**
   * Delete a phase.
   */
  async deletePhase(
    phaseId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const phaseRepo = mg.getRepository(PortfolioProjectPhase);
    if (!userId) throw new BadRequestException('userId is required for change activity logging');

    const phase = await phaseRepo.findOne({ where: { id: phaseId } });
    if (!phase) throw new NotFoundException('Phase not found');

    // CASCADE will delete linked milestones
    await phaseRepo.delete({ id: phaseId });

    await this.audit.log(
      {
        table: 'portfolio_project_phases',
        recordId: phaseId,
        action: 'delete',
        before: phase,
        after: null,
        userId,
      },
      { manager: mg },
    );

    await this.logActivity(mg, {
      project_id: phase.project_id,
      tenant_id: phase.tenant_id,
      author_id: userId,
      type: 'change',
      changed_fields: {
        phase: [phase.name, null],
      },
    });

    return { ok: true };
  }

  /**
   * Reorder phases: each listed phase takes its position in the list as its sequence.
   * The list holds distinct phases of this project only, and is written in one statement.
   */
  async reorderPhases(
    projectId: string,
    phaseIds: string[],
    tenantId: string,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);

    if (!Array.isArray(phaseIds) || phaseIds.length > PHASE_REORDER_MAX_IDS) {
      throw new BadRequestException(`phase_ids must be a list of at most ${PHASE_REORDER_MAX_IDS} phase ids`);
    }
    if (phaseIds.length === 0) return { ok: true };

    const ids = phaseIds.map((id) => String(id).toLowerCase());
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('phase_ids must not list a phase twice');
    }

    const found: Array<{ id: string }> = await mg.query(
      `SELECT id FROM portfolio_project_phases
       WHERE tenant_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])`,
      [tenantId, projectId, ids],
    );
    if (found.length !== ids.length) {
      throw new BadRequestException('phase_ids must only list phases of this project');
    }

    await mg.query(
      `UPDATE portfolio_project_phases AS p
       SET sequence = (o.position - 1)::int, updated_at = now()
       FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, position)
       WHERE p.tenant_id = $1 AND p.project_id = $2 AND p.id = o.id`,
      [tenantId, projectId, ids],
    );

    return { ok: true };
  }

  /**
   * Apply a phase template to a project.
   */
  async applyPhaseTemplate(
    projectId: string,
    templateId: string,
    options: { replace?: boolean },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const phaseRepo = mg.getRepository(PortfolioProjectPhase);
    const milestoneRepo = mg.getRepository(PortfolioProjectMilestone);
    const templateRepo = mg.getRepository(PortfolioPhaseTemplate);
    const templateItemRepo = mg.getRepository(PortfolioPhaseTemplateItem);

    const project = await this.ensureProject(projectId, mg);

    // Check for existing phases
    const existingPhases = await phaseRepo.find({ where: { project_id: projectId } });
    if (existingPhases.length > 0 && !options.replace) {
      throw new BadRequestException(
        'Project already has phases. Use replace: true to replace them.'
      );
    }

    // Load template
    const template = await templateRepo.findOne({ where: { id: templateId } });
    if (!template) throw new NotFoundException('Template not found');

    const templateItems = await templateItemRepo.find({
      where: { template_id: templateId },
      order: { sequence: 'ASC' },
    });

    // Delete existing phases and milestones if replacing
    if (options.replace && existingPhases.length > 0) {
      await milestoneRepo.delete({ project_id: projectId });
      await phaseRepo.delete({ project_id: projectId });
    }

    // Create phases and milestones from template
    const createdPhases: PortfolioProjectPhase[] = [];
    const createdMilestones: PortfolioProjectMilestone[] = [];

    for (let i = 0; i < templateItems.length; i++) {
      const item = templateItems[i];

      // Create phase
      const phase = await phaseRepo.save(
        phaseRepo.create({
          tenant_id: tenantId,
          project_id: projectId,
          name: item.name,
          sequence: i,
          status: 'pending',
        })
      );
      createdPhases.push(phase);

      // Create milestone if template item has one
      if (item.has_milestone) {
        const milestone = await milestoneRepo.save(
          milestoneRepo.create({
            tenant_id: tenantId,
            project_id: projectId,
            phase_id: phase.id,
            name: item.milestone_name || `${item.name} Milestone`,
            status: 'pending',
          })
        );
        createdMilestones.push(milestone);
      }
    }

    return {
      ok: true,
      phases: createdPhases,
      milestones: createdMilestones,
      template: { id: template.id, name: template.name },
    };
  }

  /**
   * Toggle milestone for a phase.
   */
  async togglePhaseMilestone(
    phaseId: string,
    enabled: boolean,
    milestoneName: string | null,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const phaseRepo = mg.getRepository(PortfolioProjectPhase);
    const milestoneRepo = mg.getRepository(PortfolioProjectMilestone);

    const phase = await phaseRepo.findOne({ where: { id: phaseId } });
    if (!phase) throw new NotFoundException('Phase not found');

    // Find existing phase-linked milestone
    const existingMilestone = await milestoneRepo.findOne({
      where: { phase_id: phaseId },
    });

    if (enabled && !existingMilestone) {
      // Create milestone
      const milestone = await milestoneRepo.save(
        milestoneRepo.create({
          tenant_id: tenantId,
          project_id: phase.project_id,
          phase_id: phaseId,
          name: milestoneName || `${phase.name} Milestone`,
          target_date: phase.planned_end,
          status: 'pending',
        })
      );
      return { ok: true, milestone };
    } else if (!enabled && existingMilestone) {
      // Delete milestone
      await milestoneRepo.delete({ id: existingMilestone.id });
      return { ok: true, deleted: existingMilestone.id };
    }

    return { ok: true, noChange: true };
  }
}
