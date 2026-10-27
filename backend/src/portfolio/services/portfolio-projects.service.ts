import type { PortfolioLinkedReads } from '../portfolio-linked-reads';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PortfolioProject, ProjectStatus, ProjectOrigin } from '../portfolio-project.entity';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';
import { PhaseStatus } from '../portfolio-project-phase.entity';
import { MilestoneStatus } from '../portfolio-project-milestone.entity';
import { TimeEntryCategory } from '../portfolio-project-time-entry.entity';
import { TeamRole } from '../portfolio-request-team.entity';
import { PortfolioProjectsListService } from './portfolio-projects-list.service';
import { PortfolioProjectsCrudService } from './portfolio-projects-crud.service';
import { PortfolioDependenciesService } from './portfolio-dependencies.service';
import { PortfolioPhasesService } from './portfolio-phases.service';
import { PortfolioMilestonesService } from './portfolio-milestones.service';
import { PortfolioTimesheetService } from './portfolio-timesheet.service';
import { PortfolioAttachmentsService } from './portfolio-attachments.service';
import { PortfolioStatusService } from './portfolio-status.service';
import { ParticipationAccessScope } from '../../auth/business-contributor-scope';

/**
 * Options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
  userId?: string | null;
  tenantId?: string;
  accessScope?: ParticipationAccessScope;
  /** The reader holds the budget right (see the base service's options). */
  readsBudget?: boolean;
  /** What the project may name of other records (see the base service's options). */
  linked?: PortfolioLinkedReads;
}

/**
 * Main facade service for portfolio projects that delegates to specialized sub-services.
 * This maintains backward compatibility with the existing controller API.
 */
@Injectable()
export class PortfolioProjectsService {
  constructor(
    private readonly listService: PortfolioProjectsListService,
    private readonly crudService: PortfolioProjectsCrudService,
    private readonly dependenciesService: PortfolioDependenciesService,
    private readonly phasesService: PortfolioPhasesService,
    private readonly milestonesService: PortfolioMilestonesService,
    private readonly timesheetService: PortfolioTimesheetService,
    private readonly attachmentsService: PortfolioAttachmentsService,
    private readonly statusService: PortfolioStatusService,
  ) {}

  // =========================================================================
  // List Operations (delegated to PortfolioProjectsListService)
  // =========================================================================

  list(query: any, opts?: ServiceOpts) {
    return this.listService.list(query, opts);
  }

  listIds(query: any, opts?: ServiceOpts) {
    return this.listService.listIds(query, opts);
  }

  listFilterValues(query: any, opts?: ServiceOpts) {
    return this.listService.listFilterValues(query, opts);
  }

  getTimelineData(
    query: { months?: number; category?: string; status?: string[] },
    opts?: ServiceOpts,
  ) {
    return this.listService.getTimelineData(query, opts);
  }

  assertVisible(id: string, accessScope: ParticipationAccessScope | undefined, opts?: ServiceOpts) {
    return this.crudService.assertVisible(id, accessScope, opts);
  }

  // =========================================================================
  // CRUD Operations (delegated to PortfolioProjectsCrudService)
  // =========================================================================

  get(id: string, query: any, opts?: ServiceOpts) {
    return this.crudService.get(id, query, opts);
  }

  create(
    body: Partial<PortfolioProject>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.crudService.create(body, tenantId, userId, opts);
  }

  convertFromRequest(
    requestId: string,
    overrides: Partial<PortfolioProject>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.crudService.convertFromRequest(requestId, overrides, tenantId, userId, opts);
  }

  update(
    id: string,
    body: Partial<PortfolioProject> & {
      is_decision?: boolean;
      decision_outcome?: string;
      decision_context?: string;
      decision_rationale?: string;
    },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.crudService.update(id, body, tenantId, userId, opts);
  }

  shareProject(
    projectId: string,
    dto: ShareItemDto,
    tenantId: string,
    userId: string,
    opts?: ServiceOpts,
  ) {
    return this.crudService.shareProject(projectId, dto, tenantId, userId, opts);
  }

  bulkReplaceTeam(
    projectId: string,
    role: TeamRole,
    userIds: string[],
    opts?: ServiceOpts,
  ) {
    return this.crudService.bulkReplaceTeam(projectId, role, userIds, opts);
  }

  bulkReplaceContacts(
    projectId: string,
    contactIds: string[],
    opts?: ServiceOpts,
  ) {
    return this.crudService.bulkReplaceContacts(projectId, contactIds, opts);
  }

  bulkReplaceCapex(
    projectId: string,
    capexIds: string[],
    opts?: ServiceOpts,
  ) {
    return this.crudService.bulkReplaceCapex(projectId, capexIds, opts);
  }

  bulkReplaceOpex(
    projectId: string,
    opexIds: string[],
    opts?: ServiceOpts,
  ) {
    return this.crudService.bulkReplaceOpex(projectId, opexIds, opts);
  }

  // =========================================================================
  // Effort Allocations (delegated to PortfolioProjectsCrudService)
  // =========================================================================

  getEffortAllocations(
    projectId: string,
    effortType: 'it' | 'business',
    opts?: ServiceOpts,
  ) {
    return this.crudService.getEffortAllocations(projectId, effortType, opts);
  }

  setEffortAllocations(
    projectId: string,
    effortType: 'it' | 'business',
    allocations: Array<{ user_id: string; allocation_pct: number }>,
    opts?: ServiceOpts,
  ) {
    return this.crudService.setEffortAllocations(projectId, effortType, allocations, opts);
  }

  resetEffortAllocations(
    projectId: string,
    effortType: 'it' | 'business',
    opts?: ServiceOpts,
  ) {
    return this.crudService.resetEffortAllocations(projectId, effortType, opts);
  }

  // =========================================================================
  // Dependencies & Links (delegated to PortfolioDependenciesService)
  // =========================================================================

  linkSourceRequest(
    projectId: string,
    requestId: string,
    tenantId: string,
    opts?: ServiceOpts,
  ) {
    return this.dependenciesService.linkSourceRequest(projectId, requestId, tenantId, opts);
  }

  unlinkSourceRequest(
    projectId: string,
    requestId: string,
    opts?: ServiceOpts,
  ) {
    return this.dependenciesService.unlinkSourceRequest(projectId, requestId, opts);
  }

  addDependency(
    projectId: string,
    targetType: 'request' | 'project',
    targetId: string,
    tenantId: string,
    opts?: ServiceOpts,
  ) {
    return this.dependenciesService.addDependency(projectId, targetType, targetId, tenantId, opts);
  }

  removeDependency(
    projectId: string,
    targetType: 'request' | 'project',
    targetId: string,
    opts?: ServiceOpts,
  ) {
    return this.dependenciesService.removeDependency(projectId, targetType, targetId, opts);
  }

  replaceUrls(
    projectId: string,
    urls: Array<{ url: string; label?: string }>,
    opts?: ServiceOpts,
  ) {
    return this.dependenciesService.replaceUrls(projectId, urls, opts);
  }

  listLinkedApplications(projectId: string, opts?: ServiceOpts) {
    return this.dependenciesService.listLinkedApplications(projectId, opts);
  }

  bulkReplaceLinkedApplications(
    projectId: string,
    applicationIds: string[],
    opts?: ServiceOpts,
  ) {
    return this.dependenciesService.bulkReplaceLinkedApplications(projectId, applicationIds, opts);
  }

  listLinkedAssets(projectId: string, opts?: ServiceOpts) {
    return this.dependenciesService.listLinkedAssets(projectId, opts);
  }

  bulkReplaceLinkedAssets(
    projectId: string,
    assetIds: string[],
    opts?: ServiceOpts,
  ) {
    return this.dependenciesService.bulkReplaceLinkedAssets(projectId, assetIds, opts);
  }

  // =========================================================================
  // Phases (delegated to PortfolioPhasesService)
  // =========================================================================

  listPhases(projectId: string, opts?: ServiceOpts) {
    return this.phasesService.listPhases(projectId, opts);
  }

  createPhase(
    projectId: string,
    body: { name: string; planned_start?: string; planned_end?: string },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.phasesService.createPhase(projectId, body, tenantId, userId, opts);
  }

  updatePhase(
    phaseId: string,
    body: { name?: string; planned_start?: string; planned_end?: string; status?: PhaseStatus },
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.phasesService.updatePhase(phaseId, body, userId, opts);
  }

  deletePhase(
    phaseId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.phasesService.deletePhase(phaseId, userId, opts);
  }

  reorderPhases(
    projectId: string,
    phaseIds: string[],
    tenantId: string,
    opts?: ServiceOpts,
  ) {
    return this.phasesService.reorderPhases(projectId, phaseIds, tenantId, opts);
  }

  applyPhaseTemplate(
    projectId: string,
    templateId: string,
    options: { replace?: boolean },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.phasesService.applyPhaseTemplate(projectId, templateId, options, tenantId, userId, opts);
  }

  togglePhaseMilestone(
    phaseId: string,
    enabled: boolean,
    milestoneName: string | null,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.phasesService.togglePhaseMilestone(phaseId, enabled, milestoneName, tenantId, userId, opts);
  }

  // =========================================================================
  // Milestones (delegated to PortfolioMilestonesService)
  // =========================================================================

  listMilestones(projectId: string, opts?: ServiceOpts) {
    return this.milestonesService.listMilestones(projectId, opts);
  }

  createMilestone(
    projectId: string,
    body: { name: string; phase_id?: string; target_date?: string },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.milestonesService.createMilestone(projectId, body, tenantId, userId, opts);
  }

  updateMilestone(
    milestoneId: string,
    body: { name?: string; target_date?: string; status?: MilestoneStatus },
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.milestonesService.updateMilestone(milestoneId, body, userId, opts);
  }

  deleteMilestone(
    milestoneId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.milestonesService.deleteMilestone(milestoneId, userId, opts);
  }

  // =========================================================================
  // Time Entries (delegated to PortfolioTimesheetService)
  // =========================================================================

  listTimeEntries(projectId: string, opts?: ServiceOpts) {
    return this.timesheetService.listTimeEntries(projectId, opts);
  }

  createTimeEntry(
    projectId: string,
    body: {
      category: TimeEntryCategory;
      user_id?: string;
      hours: number;
      notes?: string;
      logged_at: string;
    },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.timesheetService.createTimeEntry(projectId, body, tenantId, userId, opts);
  }

  updateTimeEntry(
    entryId: string,
    body: {
      category?: TimeEntryCategory;
      user_id?: string;
      hours?: number;
      notes?: string;
      logged_at?: string;
    },
    userId: string | null,
    isAdmin: boolean,
    opts?: ServiceOpts,
  ) {
    return this.timesheetService.updateTimeEntry(entryId, body, userId, isAdmin, opts);
  }

  deleteTimeEntry(
    entryId: string,
    userId: string | null,
    isAdmin: boolean,
    opts?: ServiceOpts,
  ) {
    return this.timesheetService.deleteTimeEntry(entryId, userId, isAdmin, opts);
  }

  recalculateActualEffort(projectId: string, mg: EntityManager) {
    return this.timesheetService.recalculateActualEffort(projectId, mg);
  }

  // =========================================================================
  // Attachments (delegated to PortfolioAttachmentsService)
  // =========================================================================

  uploadAttachment(
    projectId: string,
    file: Express.Multer.File,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.attachmentsService.uploadAttachment(projectId, file, userId, opts);
  }

  deleteAttachment(
    attachmentId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.attachmentsService.deleteAttachment(attachmentId, userId, opts);
  }

  getAttachment(attachmentId: string, opts?: ServiceOpts) {
    return this.attachmentsService.getAttachment(attachmentId, opts);
  }

  uploadInlineAttachment(
    projectId: string,
    file: Express.Multer.File,
    sourceField: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.attachmentsService.uploadInlineAttachment(projectId, file, sourceField, userId, opts);
  }

  importInlineAttachmentFromUrl(
    projectId: string,
    sourceUrl: string,
    sourceField: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.attachmentsService.importInlineAttachmentFromUrl(projectId, sourceUrl, sourceField, userId, opts);
  }

  cleanupOrphanedImages(
    projectId: string,
    sourceField: string,
    oldContent: string | null,
    newContent: string | null,
    opts?: ServiceOpts,
  ) {
    return this.attachmentsService.cleanupOrphanedImages(projectId, sourceField, oldContent, newContent, opts);
  }

  getInlineAttachmentMeta(tenantSlug: string, attachmentId: string, refreshToken?: string | null) {
    return this.attachmentsService.getInlineAttachmentMeta(tenantSlug, attachmentId, refreshToken);
  }

  // =========================================================================
  // Comments & Status (delegated to PortfolioStatusService)
  // =========================================================================

  addComment(
    projectId: string,
    content: string,
    context: string | null,
    tenantId: string,
    userId: string | null,
    opts?: {
      manager?: EntityManager;
      isDecision?: boolean;
      decisionOutcome?: string;
      newStatus?: string;
    },
  ) {
    return this.statusService.addComment(projectId, content, context, tenantId, userId, opts);
  }

  updateComment(
    projectId: string,
    activityId: string,
    content: string,
    userId: string,
    opts?: ServiceOpts,
  ) {
    return this.statusService.updateComment(projectId, activityId, content, userId, opts);
  }
}
