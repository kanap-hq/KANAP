import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { PortfolioProject, ProjectStatus, ProjectOrigin } from '../portfolio-project.entity';
import { PortfolioActivity } from '../portfolio-activity.entity';
import { normalizeMarkdownRichText } from '../../common/markdown-worker';
import { ParticipationAccessScope } from '../../auth/business-contributor-scope';

/**
 * Common options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
  userId?: string | null;
  tenantId?: string;
  accessScope?: ParticipationAccessScope;
}

/**
 * Valid project statuses.
 */
export const PROJECT_STATUSES: ProjectStatus[] = [
  'waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold', 'done', 'cancelled',
];

/**
 * Status transition rules.
 */
export const STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  waiting_list: ['planned', 'in_progress', 'on_hold', 'cancelled'],
  planned: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['in_testing', 'done', 'on_hold', 'cancelled'],
  in_testing: ['in_progress', 'done', 'on_hold', 'cancelled'],
  on_hold: ['waiting_list', 'planned', 'in_progress', 'cancelled'],
  done: [], // Terminal
  cancelled: [], // Terminal
};

/**
 * Base class with shared utilities for portfolio project services.
 */
export abstract class PortfolioProjectsBaseService {
  constructor(protected readonly projectRepo: Repository<PortfolioProject>) {}

  protected getRepo(manager?: EntityManager): Repository<PortfolioProject> {
    return manager ? manager.getRepository(PortfolioProject) : this.projectRepo;
  }

  protected getManager(opts?: ServiceOpts): EntityManager {
    return opts?.manager ?? this.projectRepo.manager;
  }

  protected async normalizeNullable(value: unknown): Promise<string | null> {
    return await normalizeMarkdownRichText(value);
  }

  protected normalizeOrigin(value: unknown): ProjectOrigin {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'fast_track' || v === 'fast-track') return 'fast_track';
    if (v === 'legacy') return 'legacy';
    return 'standard';
  }

  protected normalizeStatus(value: unknown): ProjectStatus {
    const v = String(value || '').trim().toLowerCase();
    if (!PROJECT_STATUSES.includes(v as ProjectStatus)) {
      throw new BadRequestException(`Invalid status: ${value}`);
    }
    return v as ProjectStatus;
  }

  protected validateStatusTransition(current: ProjectStatus, next: ProjectStatus): void {
    if (!STATUS_TRANSITIONS[current].includes(next)) {
      throw new BadRequestException(
        `Cannot transition from '${current}' to '${next}'`
      );
    }
  }

  /**
   * Validate requirements before transitioning to 'in_progress'
   */
  protected validateInProgressRequirements(
    existing: PortfolioProject,
    body: Partial<PortfolioProject>,
  ): void {
    const plannedStart = body.planned_start ?? existing.planned_start;
    const plannedEnd = body.planned_end ?? existing.planned_end;
    const effortIt = body.estimated_effort_it ?? existing.estimated_effort_it;

    const missing: string[] = [];
    if (!plannedStart) missing.push('planned_start');
    if (!plannedEnd) missing.push('planned_end');
    if (effortIt == null) missing.push('estimated_effort_it');
    // Business effort is optional - treat null as 0

    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot move to 'in_progress'. Missing required fields: ${missing.join(', ')}`
      );
    }
  }

  async ensureProject(id: string, manager?: EntityManager): Promise<PortfolioProject> {
    const repo = this.getRepo(manager);
    const project = await repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  protected async logActivity(
    mg: EntityManager,
    data: Partial<PortfolioActivity>,
  ): Promise<PortfolioActivity> {
    const repo = mg.getRepository(PortfolioActivity);
    const activity = repo.create(data);
    return repo.save(activity);
  }
}
