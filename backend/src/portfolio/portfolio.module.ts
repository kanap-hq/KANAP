import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities
import { PortfolioRequest } from './portfolio-request.entity';
import { PortfolioProject } from './portfolio-project.entity';
import { PortfolioActivity } from './portfolio-activity.entity';
import { PortfolioCriterion } from './portfolio-criterion.entity';
import { PortfolioCriterionValue } from './portfolio-criterion-value.entity';
import { PortfolioSettings } from './portfolio-settings.entity';
import { TeamMemberConfig } from './team-member-config.entity';
import { PortfolioSkill } from './portfolio-skill.entity';

// Request junction tables
import { PortfolioRequestTeam } from './portfolio-request-team.entity';
import { PortfolioRequestContact } from './portfolio-request-contact.entity';
import { PortfolioRequestDependency } from './portfolio-request-dependency.entity';
import { PortfolioRequestUrl } from './portfolio-request-url.entity';
import { PortfolioRequestAttachment } from './portfolio-request-attachment.entity';
import { PortfolioRequestProject } from './portfolio-request-project.entity';
import { PortfolioRequestOpex } from './portfolio-request-opex.entity';
import { PortfolioRequestBusinessProcess } from './portfolio-request-business-process.entity';

// Project junction tables
import { PortfolioProjectTeam } from './portfolio-project-team.entity';
import { PortfolioProjectContact } from './portfolio-project-contact.entity';
import { PortfolioProjectDependency } from './portfolio-project-dependency.entity';
import { PortfolioProjectUrl } from './portfolio-project-url.entity';
import { PortfolioProjectAttachment } from './portfolio-project-attachment.entity';
import { PortfolioProjectOpex } from './portfolio-project-opex.entity';

// Phase templates and project phases/milestones
import { PortfolioPhaseTemplate } from './portfolio-phase-template.entity';
import { PortfolioPhaseTemplateItem } from './portfolio-phase-template-item.entity';
import { PortfolioProjectPhase } from './portfolio-project-phase.entity';
import { PortfolioProjectMilestone } from './portfolio-project-milestone.entity';
import { PortfolioProjectTimeEntry } from './portfolio-project-time-entry.entity';
import { PortfolioProjectEffortAllocation } from './portfolio-project-effort-allocation.entity';
import { UserTimeMonthlyAggregate } from './user-time-monthly-aggregate.entity';

// Classification
import { PortfolioSource } from './portfolio-source.entity';
import { PortfolioCategory } from './portfolio-category.entity';
import { PortfolioStream } from './portfolio-stream.entity';
import { PortfolioTaskType } from './portfolio-task-type.entity';

// Teams
import { PortfolioTeam } from './portfolio-team.entity';

// Employment types
import { PortfolioEmploymentType } from './portfolio-employment-type.entity';

// Services (non-decomposed)
import { PortfolioRequestsService } from './portfolio-requests.service';
import { PortfolioCriteriaService } from './portfolio-criteria.service';
import { PortfolioSettingsService } from './portfolio-settings.service';
import { PortfolioSkillsService } from './portfolio-skills.service';
import { TeamMemberConfigService } from './team-member-config.service';
import { PortfolioPhaseTemplatesService } from './portfolio-phase-templates.service';
import { PortfolioClassificationService } from './portfolio-classification.service';
import { PortfolioTeamsService } from './portfolio-teams.service';
import { PortfolioEmploymentTypesService } from './portfolio-employment-types.service';
import { PortfolioCapacityReportService } from './services/portfolio-capacity-report.service';
import { PortfolioClassificationGapsService } from './services/portfolio-classification-gaps.service';
import { PortfolioSteeringSummaryService } from './services/portfolio-steering-summary.service';
import { PortfolioFlowReportService } from './services/portfolio-flow-report.service';
import { PortfolioAssigneeAttentionService } from './services/portfolio-assignee-attention.service';
import { PortfolioUpcomingReportService } from './services/portfolio-upcoming-report.service';
import { PortfolioWeeklyReportService } from './services/portfolio-weekly-report.service';
import { PortfolioReportFilterValuesService } from './services/portfolio-report-filter-values.service';
import { PortfolioTimeLoggedReportService } from './services/portfolio-time-logged-report.service';

// Decomposed portfolio projects services
import {
  PortfolioProjectsService,
  PortfolioProjectsListService,
  PortfolioProjectsCrudService,
  PortfolioDependenciesService,
  PortfolioPhasesService,
  PortfolioMilestonesService,
  PortfolioTimesheetService,
  PortfolioAttachmentsService,
  PortfolioStatusService,
  PortfolioRoadmapService,
} from './services';
import { UserTimeAggregateService } from './services/user-time-aggregate.service';

// Controllers
import { PortfolioRequestsController } from './portfolio-requests.controller';
import { PortfolioProjectsController } from './portfolio-projects.controller';
import { PortfolioCriteriaController } from './portfolio-criteria.controller';
import { PortfolioSettingsController } from './portfolio-settings.controller';
import { PortfolioSkillsController } from './portfolio-skills.controller';
import { TeamMemberConfigController } from './team-member-config.controller';
import { PortfolioPhaseTemplatesController } from './portfolio-phase-templates.controller';
import { PortfolioClassificationController } from './portfolio-classification.controller';
import { PortfolioProjectTasksController } from './portfolio-project-tasks.controller';
import { PortfolioTeamsController } from './portfolio-teams.controller';
import { PortfolioEmploymentTypesController } from './portfolio-employment-types.controller';
import { PortfolioCapacityReportController } from './portfolio-capacity-report.controller';
import { PortfolioClassificationGapsController } from './portfolio-classification-gaps.controller';
import { PortfolioSteeringSummaryController } from './portfolio-steering-summary.controller';
import { PortfolioFlowReportController } from './portfolio-flow-report.controller';
import { PortfolioAssigneeAttentionController } from './portfolio-assignee-attention.controller';
import { PortfolioUpcomingReportController } from './portfolio-upcoming-report.controller';
import { PortfolioRoadmapController } from './portfolio-roadmap.controller';
import { PortfolioWeeklyReportController } from './portfolio-weekly-report.controller';
import { PortfolioReportFilterValuesController } from './portfolio-report-filter-values.controller';
import { PortfolioTimeLoggedReportController } from './portfolio-time-logged-report.controller';

// CSV Services
import { PortfolioRequestsCsvService } from './portfolio-requests-csv.service';
import { PortfolioProjectsCsvService } from './portfolio-projects-csv.service';

// Dependencies
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../common/storage/storage.module';
import { TasksModule } from '../tasks/tasks.module';
import { CsvModule } from '../common/csv';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

const entities = [
  PortfolioRequest,
  PortfolioProject,
  PortfolioActivity,
  PortfolioCriterion,
  PortfolioCriterionValue,
  PortfolioSettings,
  TeamMemberConfig,
  PortfolioSkill,
  PortfolioRequestTeam,
  PortfolioRequestContact,
  PortfolioRequestDependency,
  PortfolioRequestUrl,
  PortfolioRequestAttachment,
  PortfolioRequestProject,
  PortfolioRequestOpex,
  PortfolioRequestBusinessProcess,
  PortfolioProjectTeam,
  PortfolioProjectContact,
  PortfolioProjectDependency,
  PortfolioProjectUrl,
  PortfolioProjectAttachment,
  PortfolioProjectOpex,
  PortfolioPhaseTemplate,
  PortfolioPhaseTemplateItem,
  PortfolioProjectPhase,
  PortfolioProjectMilestone,
  PortfolioProjectTimeEntry,
  PortfolioProjectEffortAllocation,
  UserTimeMonthlyAggregate,
  PortfolioSource,
  PortfolioCategory,
  PortfolioStream,
  PortfolioTaskType,
  PortfolioTeam,
  PortfolioEmploymentType,
];

@Module({
  imports: [
    TypeOrmModule.forFeature(entities),
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
    StorageModule,
    forwardRef(() => TasksModule),
    CsvModule,
    CommonModule,
    NotificationsModule,
    KnowledgeModule,
  ],
  providers: [
    // Non-decomposed services
    PortfolioRequestsService,
    PortfolioCriteriaService,
    PortfolioSettingsService,
    PortfolioSkillsService,
    TeamMemberConfigService,
    PortfolioPhaseTemplatesService,
    PortfolioClassificationService,
    PortfolioTeamsService,
    PortfolioEmploymentTypesService,
    PortfolioCapacityReportService,
    PortfolioClassificationGapsService,
    PortfolioSteeringSummaryService,
    PortfolioFlowReportService,
    PortfolioAssigneeAttentionService,
    PortfolioUpcomingReportService,
    PortfolioWeeklyReportService,
    PortfolioReportFilterValuesService,
    PortfolioTimeLoggedReportService,
    // CSV services
    PortfolioRequestsCsvService,
    PortfolioProjectsCsvService,
    // Decomposed portfolio projects services (order matters for DI)
    PortfolioProjectsListService,
    PortfolioProjectsCrudService,
    PortfolioDependenciesService,
    PortfolioPhasesService,
    PortfolioMilestonesService,
    PortfolioTimesheetService,
    PortfolioAttachmentsService,
    PortfolioStatusService,
    PortfolioRoadmapService,
    UserTimeAggregateService,
    // Main facade service
    PortfolioProjectsService,
  ],
  controllers: [
    PortfolioRequestsController,
    PortfolioProjectsController,
    PortfolioCriteriaController,
    PortfolioSettingsController,
    PortfolioSkillsController,
    TeamMemberConfigController,
    PortfolioPhaseTemplatesController,
    PortfolioClassificationController,
    PortfolioProjectTasksController,
    PortfolioTeamsController,
    PortfolioEmploymentTypesController,
    PortfolioCapacityReportController,
    PortfolioClassificationGapsController,
    PortfolioSteeringSummaryController,
    PortfolioFlowReportController,
    PortfolioAssigneeAttentionController,
    PortfolioUpcomingReportController,
    PortfolioWeeklyReportController,
    PortfolioReportFilterValuesController,
    PortfolioTimeLoggedReportController,
    PortfolioRoadmapController,
  ],
  exports: [
    PortfolioRequestsService,
    PortfolioProjectsService,
    PortfolioCriteriaService,
    PortfolioRequestsCsvService,
    PortfolioProjectsCsvService,
    // The Entra directory sync writes the reporting line through it.
    TeamMemberConfigService,
    TypeOrmModule,
    UserTimeAggregateService,
  ],
})
export class PortfolioModule {}
