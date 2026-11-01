import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { codedForbidden } from '../../auth/module-right-required';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioActivity } from '../portfolio-activity.entity';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';
import { PortfolioAttachmentsService } from './portfolio-attachments.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuditService } from '../../audit/audit.service';
import { displayName } from '../../common/display-name';
import { normalizeMarkdownRichText } from '../../common/markdown-worker';

/**
 * Service for managing comments and status transitions.
 */
@Injectable()
export class PortfolioStatusService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
    private readonly attachmentsService: PortfolioAttachmentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {
    super(projectRepo);
  }

  /**
   * Add a comment to a project.
   */
  async addComment(
    projectId: string,
    content: string,
    context: string | null,
    tenantId: string,
    userId: string | null,
    opts?: {
      manager?: import('typeorm').EntityManager;
      isDecision?: boolean;
      decisionOutcome?: string;
      newStatus?: string;
    },
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProject);

    const project = await repo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const isDecision = opts?.isDecision === true;
    const normalizedContent = await normalizeMarkdownRichText(content, { fieldName: 'content' });
    let changedFields: Record<string, [unknown, unknown]> | null = null;
    let oldStatus: string | null = null;

    // Handle status change if requested (only for decisions)
    if (isDecision && opts?.newStatus) {
      const currentStatus = project.status;
      oldStatus = currentStatus;
      const newStatus = this.normalizeStatus(opts.newStatus);
      const before = { ...project };

      this.validateStatusTransition(currentStatus, newStatus);

      // Handle 'in_progress' transition - capture baseline
      if (newStatus === 'in_progress' && project.status !== 'in_progress') {
        this.validateInProgressRequirements(project, {});

        project.baseline_start_date = project.planned_start;
        project.baseline_end_date = project.planned_end;
        project.baseline_effort_it = project.estimated_effort_it;
        project.baseline_effort_business = project.estimated_effort_business;
        project.actual_start = new Date();
      }

      // Handle 'done' transition - set actual end date
      if (newStatus === 'done' && project.status !== 'done') {
        project.actual_end = new Date();
      }

      project.status = newStatus;
      await repo.save(project);
      await this.audit.log({
        table: 'portfolio_projects',
        recordId: project.id,
        action: 'update',
        before,
        after: project,
        userId,
      }, { manager: mg });

      changedFields = { status: [currentStatus, newStatus] };
    }

    const activity = await this.logActivity(mg, {
      project_id: projectId,
      tenant_id: tenantId,
      author_id: userId,
      type: isDecision ? 'decision' : 'comment',
      content: normalizedContent,
      context: context ? String(context).trim() : null,
      decision_outcome: isDecision ? (opts?.decisionOutcome as any || null) : null,
      changed_fields: changedFields,
    });

    // Notify status change if it occurred (fire-and-forget)
    if (oldStatus && changedFields) {
      const recipients = await this.notifications.getProjectRecipients(projectId, mg);
      this.notifications.notifyStatusChange({
        itemType: 'project',
        itemId: projectId,
        itemName: project.name,
        oldStatus,
        newStatus: project.status,
        recipients,
        tenantId,
        excludeUserId: userId ?? undefined,
        manager: mg,
      });
    }

    // Notify about comment (fire-and-forget)
    if (!isDecision && userId) {
      const authorData = await mg.query(
        `SELECT first_name, last_name FROM users WHERE id = $1`,
        [userId]
      );
      const authorName = displayName(authorData[0], 'Unknown');

      const recipients = await this.notifications.getProjectRecipients(projectId, mg);
      this.notifications.notifyComment({
        itemType: 'project',
        itemId: projectId,
        itemName: project.name,
        authorId: userId,
        authorName,
        commentContent: normalizedContent || '',
        recipients,
        tenantId,
        manager: mg,
      });
    }

    return activity;
  }

  /**
   * Update an existing comment.
   */
  async updateComment(
    projectId: string,
    activityId: string,
    content: string,
    userId: string,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const activityRepo = mg.getRepository(PortfolioActivity);

    // Find the activity
    const activity = await activityRepo.findOne({ where: { id: activityId, project_id: projectId } });
    if (!activity) throw new NotFoundException('Comment not found');

    // Only allow editing comments, not decisions or changes
    if (activity.type !== 'comment') {
      throw new BadRequestException('Only comments can be edited');
    }

    // Only allow the author to edit
    if (activity.author_id !== userId) {
      throw codedForbidden('OWN_COMMENTS_ONLY', 'You can only edit your own comments');
    }

    const oldContent = activity.content;
    activity.content = await normalizeMarkdownRichText(content, { fieldName: 'content' });
    activity.updated_at = new Date();

    const saved = await activityRepo.save(activity);

    // Cleanup orphaned inline images
    await this.attachmentsService.cleanupOrphanedImages(projectId, 'comment', oldContent, saved.content, { manager: mg });

    return saved;
  }
}
