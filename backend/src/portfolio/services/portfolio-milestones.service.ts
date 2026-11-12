import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioProjectMilestone, MilestoneStatus } from '../portfolio-project-milestone.entity';
import { AuditService } from '../../audit/audit.service';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';

/**
 * Service for managing project milestones.
 */
@Injectable()
export class PortfolioMilestonesService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
    private readonly audit: AuditService,
  ) {
    super(projectRepo);
  }

  /**
   * List all milestones for a project.
   */
  async listMilestones(projectId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    return mg.query(
      `SELECT m.*, p.name as phase_name, p.sequence as phase_sequence
       FROM portfolio_project_milestones m
       LEFT JOIN portfolio_project_phases p ON p.id = m.phase_id
       WHERE m.project_id = $1
       ORDER BY COALESCE(p.sequence, 999999), m.target_date NULLS LAST, m.name`,
      [projectId]
    );
  }

  /**
   * Create a new milestone.
   */
  async createMilestone(
    projectId: string,
    body: { name: string; phase_id?: string; target_date?: string },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const milestoneRepo = mg.getRepository(PortfolioProjectMilestone);

    const project = await this.ensureProject(projectId, mg);

    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    // Validate phase_id if provided
    if (body.phase_id) {
      const phase = await mg.query(
        `SELECT id FROM portfolio_project_phases WHERE id = $1 AND project_id = $2`,
        [body.phase_id, projectId]
      );
      if (phase.length === 0) throw new BadRequestException('Phase not found');
    }

    const milestone = milestoneRepo.create({
      tenant_id: tenantId,
      project_id: projectId,
      phase_id: body.phase_id || null,
      name,
      target_date: body.target_date || null,
      status: 'pending' as MilestoneStatus,
    });

    const saved = await milestoneRepo.save(milestone);

    await this.audit.log(
      {
        table: 'portfolio_project_milestones',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    return saved;
  }

  /**
   * Update a milestone of `projectId`; a milestone of another project reads as missing.
   */
  async updateMilestone(
    projectId: string,
    milestoneId: string,
    body: { name?: string; target_date?: string; status?: MilestoneStatus },
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const milestoneRepo = mg.getRepository(PortfolioProjectMilestone);

    const milestone = await milestoneRepo.findOne({ where: { id: milestoneId, project_id: projectId } });
    if (!milestone) throw new NotFoundException('Milestone not found');

    const before = { ...milestone };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    if (has('name')) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      milestone.name = name;
    }

    if (has('target_date')) milestone.target_date = (body.target_date || null) as any;

    if (has('status')) {
      const valid: MilestoneStatus[] = ['pending', 'achieved', 'missed'];
      if (!valid.includes(body.status!)) {
        throw new BadRequestException('Invalid status');
      }
      milestone.status = body.status!;
    }

    milestone.updated_at = new Date();
    const saved = await milestoneRepo.save(milestone);

    await this.audit.log(
      {
        table: 'portfolio_project_milestones',
        recordId: milestoneId,
        action: 'update',
        before,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    return saved;
  }

  /**
   * Delete a milestone of `projectId`; a milestone of another project reads as missing.
   */
  async deleteMilestone(
    projectId: string,
    milestoneId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const milestoneRepo = mg.getRepository(PortfolioProjectMilestone);

    const milestone = await milestoneRepo.findOne({ where: { id: milestoneId, project_id: projectId } });
    if (!milestone) throw new NotFoundException('Milestone not found');

    await milestoneRepo.delete({ id: milestoneId });

    await this.audit.log(
      {
        table: 'portfolio_project_milestones',
        recordId: milestoneId,
        action: 'delete',
        before: milestone,
        after: null,
        userId,
      },
      { manager: mg },
    );

    return { ok: true };
  }
}
