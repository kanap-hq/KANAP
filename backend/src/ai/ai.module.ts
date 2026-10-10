import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { AssetsModule } from '../assets/assets.module';
import { Subscription } from '../billing/subscription.entity';
import { BillingModule } from '../billing/billing.module';
import { BusinessProcessesModule } from '../business-processes/business-processes.module';
import { CompaniesModule } from '../companies/companies.module';
import { ConnectionsModule } from '../connections/connections.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ContractsModule } from '../contracts/contracts.module';
import { DepartmentsModule } from '../departments/departments.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { InterfacesModule } from '../interfaces/interfaces.module';
import { ItOpsSettingsModule } from '../it-ops-settings/it-ops-settings.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LocationsModule } from '../locations/locations.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { SpendModule } from '../spend/spend.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { Tenant } from '../tenants/tenant.entity';
import { TenantsModule } from '../tenants/tenants.module';
import { TasksModule } from '../tasks/tasks.module';
import { UserRole } from '../users/user-role.entity';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../common/storage/storage.module';
import { AiProviderSupportModule } from './ai-provider-support.module';
import { AiApiKey } from './ai-api-key.entity';
import { AiApiKeysController } from './ai-api-keys.controller';
import { AiApiKeysService } from './ai-api-keys.service';
import { AiAttachmentService } from './ai-attachment.service';
import { AiCapabilitiesController } from './ai-capabilities.controller';
import { AiChatController } from './ai-chat.controller';
import { AiChatOrchestratorService } from './ai-chat-orchestrator.service';
import { AiConversation } from './ai-conversation.entity';
import { AiConversationService } from './ai-conversation.service';
import { AiConversationsController } from './ai-conversations.controller';
import { AiEntityService } from './ai-entity.service';
import { AiIntegrationsController } from './ai-integrations.controller';
import { AiMcpController } from './ai-mcp.controller';
import { AiSearchController } from './ai-search.controller';
import { AiMessage } from './ai-message.entity';
import { AiMessageAttachment } from './ai-message-attachment.entity';
import { AiMutationPlan } from './ai-mutation-plan.entity';
import { AiMutationPlanStep } from './ai-mutation-plan-step.entity';
import { AiMutationPreview } from './ai-mutation-preview.entity';
import { AiMutationPreviewService } from './ai-mutation-preview.service';
import { AiPolicyService } from './ai-policy.service';
import { AiProviderTestService } from './ai-provider-test.service';
import { AiSecretCipherService } from './ai-secret-cipher.service';
import { AiAdminOverviewController } from './ai-admin-overview.controller';
import { AiAdminOverviewService } from './ai-admin-overview.service';
import { AiAdminSearchIndexController } from './search-index/ai-admin-search-index.controller';
import { AiSearchIndexService } from './search-index/ai-search-index.service';
import { AiModelConfig } from './ai-model-config.entity';
import { AiModelConfigService } from './ai-model-config.service';
import { AiModelConfigsController } from './ai-model-configs.controller';
import { AiModelResolverService } from './ai-model-resolver.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettings } from './ai-settings.entity';
import { AiSettingsService } from './ai-settings.service';
import { AiSystemPromptService } from './ai-system-prompt.service';
import { AiToolRegistry } from './ai-tool.registry';
import { McpApiKeyAuthGuard } from './auth/mcp-api-key-auth.guard';
import { McpApiKeyHashService } from './auth/mcp-api-key-hash.service';
import { AiActionRequestService } from './control-plane/action-request/ai-action-request.service';
import { AiAgentActionPlannerService } from './control-plane/agent-control/ai-agent-action-planner.service';
import { AiAgentControlController } from './control-plane/agent-control/ai-agent-control.controller';
import { AiAgentPromptCompilerService } from './control-plane/agent-control/ai-agent-prompt-compiler.service';
import { AiAgentControlService } from './control-plane/agent-control/ai-agent-control.service';
import { AiAgentLlmClient } from './control-plane/agent-control/ai-agent-llm-client';
import { AiTicketEvidenceExtractionService } from './control-plane/agent-control/ai-ticket-evidence-extraction.service';
import { AiKnowledgeSearchPlannerService } from './control-plane/agent-control/ai-knowledge-search-planner.service';
import { AiReplySynthesisService } from './control-plane/agent-control/ai-reply-synthesis.service';
import { AiDiagnosticBriefSynthesisService } from './control-plane/agent-control/ai-diagnostic-brief-synthesis.service';
import { AiSharedContextProfileService } from './control-plane/agent-control/ai-shared-context-profile.service';
import { AiTicketNeedRepresentationService } from './control-plane/agent-control/ai-ticket-need-representation.service';
import { AiAgentApprovalLifecycleSweeperService } from './control-plane/agent/ai-agent-approval-lifecycle-sweeper.service';
import { AiAgentBuiltinQuotaService } from './control-plane/agent/ai-agent-builtin-quota.service';
import { AiAgentActivityRetentionService } from './control-plane/agent/ai-agent-activity-retention.service';
import { AiAgentHelpdeskTicketingIngestionService } from './control-plane/agent/ai-agent-helpdesk-ticketing-ingestion.service';
import { AiAgentMonitoringAlertIngestionService } from './control-plane/agent/ai-agent-monitoring-alert-ingestion.service';
import { AiAgentWorkQueueService } from './control-plane/agent/ai-agent-work-queue.service';
import { AiApprovalService } from './control-plane/approval/ai-approval.service';
import { AiAutomationJobCatalogService } from './control-plane/automation/ai-automation-job-catalog.service';
import { AiCapabilityRegistry } from './control-plane/capability/ai-capability.registry';
import { AiReadonlyDiagnosticWorkflowService } from './control-plane/diagnostics/ai-readonly-diagnostic-workflow.service';
import { AiCapabilityDispatcherService } from './control-plane/dispatcher/ai-capability-dispatcher.service';
import { AiActionRequest } from './control-plane/entities/ai-action-request.entity';
import { AiAgentAuditEvent } from './control-plane/entities/ai-agent-audit-event.entity';
import { AiAgentDefinition } from './control-plane/entities/ai-agent-definition.entity';
import { AiAgentTargetState } from './control-plane/entities/ai-agent-target-state.entity';
import { AiAgentTrigger } from './control-plane/entities/ai-agent-trigger.entity';
import { AiAgentWorkItem } from './control-plane/entities/ai-agent-work-item.entity';
import { AiApproval } from './control-plane/entities/ai-approval.entity';
import { AiApprovalPolicy } from './control-plane/entities/ai-approval-policy.entity';
import { AiAutomationJobCatalog } from './control-plane/entities/ai-automation-job-catalog.entity';
import { AiAutonomyCeiling } from './control-plane/entities/ai-autonomy-ceiling.entity';
import { AiAutonomyRoutine } from './control-plane/entities/ai-autonomy-routine.entity';
import { AiDecision } from './control-plane/entities/ai-decision.entity';
import { AiEmergencyPause } from './control-plane/entities/ai-emergency-pause.entity';
import { AiEvaluation } from './control-plane/entities/ai-evaluation.entity';
import { AiEvidence } from './control-plane/entities/ai-evidence.entity';
import { AiExternalMcpServer } from './control-plane/entities/ai-external-mcp-server.entity';
import { AiExternalMcpToolSnapshot } from './control-plane/entities/ai-external-mcp-tool-snapshot.entity';
import { AiLiveTestTarget } from './control-plane/entities/ai-live-test-target.entity';
import { AiObservation } from './control-plane/entities/ai-observation.entity';
import { AiRecommendation } from './control-plane/entities/ai-recommendation.entity';
import { AiRun } from './control-plane/entities/ai-run.entity';
import { AiRunStep } from './control-plane/entities/ai-run-step.entity';
import { AiSharedContextProfile } from './control-plane/entities/ai-shared-context-profile.entity';
import { AiToolExecution } from './control-plane/entities/ai-tool-execution.entity';
import { AiEvidenceService } from './control-plane/evidence/ai-evidence.service';
import { AiLiveContractHarnessService } from './control-plane/live-readiness/ai-live-contract-harness.service';
import { AiLiveTestTargetService } from './control-plane/live-readiness/ai-live-test-target.service';
import { AiExternalMcpBridgeService } from './control-plane/mcp/ai-external-mcp-bridge.service';
import { AiExternalMcpMockTransport } from './control-plane/mcp/ai-external-mcp-mock-transport.service';
import { AiMcpAuditService } from './control-plane/mcp/ai-mcp-audit.service';
import { AiMcpExposureService } from './control-plane/mcp/ai-mcp-exposure.service';
import { AiMcpRateLimiter } from './control-plane/mcp/ai-mcp-rate-limiter.service';
import { AiEmergencyPauseService } from './control-plane/pause/ai-emergency-pause.service';
import { AiApprovalPolicyResolverService } from './control-plane/policy/ai-approval-policy-resolver.service';
import { AiAutonomyCeilingService } from './control-plane/policy/ai-autonomy-ceiling.service';
import { AiAutonomyDemotionService } from './control-plane/policy/ai-autonomy-demotion.service';
import { AiAutonomyRoutineService } from './control-plane/policy/ai-autonomy-routine.service';
import { AiAdapterConfig } from './control-plane/providers/adapter-config.entity';
import { AiAdapterConfigService } from './control-plane/providers/adapter-config.service';
import { AiMonitoringIntegrationsService } from './control-plane/providers/ai-monitoring-integrations.service';
import { GlpiTicketingProvider } from './control-plane/providers/glpi-ticketing.provider';
import { PrtgMonitoringProvider } from './control-plane/providers/prtg-monitoring.provider';
import { GLPI_TICKETING_IMPLEMENTATION, PRTG_MONITORING_IMPLEMENTATION } from './control-plane/providers/provider-constants';
import { AI_PROVIDER_IMPLEMENTATIONS, AiProviderRegistryService } from './control-plane/providers/provider-registry.service';
import { AiTenantSecretResolverService } from './control-plane/providers/tenant-secret-resolver.service';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { GlpiService } from './glpi/glpi.service';
import { PrtgService } from './prtg/prtg.service';
import { AiDocumentMutationSupportService } from './mutation/ai-document-mutation-support.service';
import { AiBusinessRecordMutationSupportService } from './mutation/ai-business-record-mutation-support.service';
import { AiFinancialPlanMutationSupportService } from './mutation/ai-financial-plan-mutation-support.service';
import { AiMasterDataMutationSupportService } from './mutation/ai-master-data-mutation-support.service';
import { AiMutationOperationRegistry } from './mutation/ai-mutation-operation.registry';
import { AiRelationMutationSupportService } from './mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from './mutation/ai-task-mutation-support.service';
import { AddTaskCommentAiMutationOperation } from './mutation/operations/add-task-comment.ai-mutation-operation';
import { CreateBusinessRecordAiMutationOperation } from './mutation/operations/create-business-record.ai-mutation-operation';
import { CreateDocumentAiMutationOperation } from './mutation/operations/create-document.ai-mutation-operation';
import { CreateMasterDataRecordAiMutationOperation } from './mutation/operations/create-master-data-record.ai-mutation-operation';
import { CreateTaskAiMutationOperation } from './mutation/operations/create-task.ai-mutation-operation';
import { ImportGlpiTicketAiMutationOperation, ImportTicketAiMutationOperation } from './mutation/operations/import-glpi-ticket.ai-mutation-operation';
import { UpdateDocumentContentAiMutationOperation } from './mutation/operations/update-document-content.ai-mutation-operation';
import { UpdateDocumentMetadataAiMutationOperation } from './mutation/operations/update-document-metadata.ai-mutation-operation';
import { UpdateDocumentRelationsAiMutationOperation } from './mutation/operations/update-document-relations.ai-mutation-operation';
import { UpdateBusinessRecordAiMutationOperation } from './mutation/operations/update-business-record.ai-mutation-operation';
import { UpdateEntityRelationsAiMutationOperation } from './mutation/operations/update-entity-relations.ai-mutation-operation';
import { UpdateMasterDataRecordAiMutationOperation } from './mutation/operations/update-master-data-record.ai-mutation-operation';
import { UpdateTaskAssigneeAiMutationOperation } from './mutation/operations/update-task-assignee.ai-mutation-operation';
import { UpdateTaskFieldsAiMutationOperation } from './mutation/operations/update-task-fields.ai-mutation-operation';
import { UpdateTaskStatusAiMutationOperation } from './mutation/operations/update-task-status.ai-mutation-operation';
import { WriteFinancialPlanAiMutationOperation } from './mutation/operations/write-financial-plan.ai-mutation-operation';
import { AiAggregateExecutor } from './query/ai-aggregate.executor';
import { AiQueryExecutor } from './query/ai-query.executor';
import { PlatformAiModule } from './platform/platform-ai.module';
import { BraveSearchService } from './web-search/brave-search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiSettings,
      AiModelConfig,
      AiApiKey,
      AiConversation,
      AiMessage,
      AiMessageAttachment,
      AiMutationPlan,
      AiMutationPlanStep,
      AiMutationPreview,
      AiRun,
      AiRunStep,
      AiToolExecution,
      AiEvidence,
      AiAgentDefinition,
      AiSharedContextProfile,
      AiAgentTrigger,
      AiAgentWorkItem,
      AiAgentTargetState,
      AiActionRequest,
      AiApproval,
      AiApprovalPolicy,
      AiAutomationJobCatalog,
      AiAutonomyCeiling,
      AiAutonomyRoutine,
      AiEmergencyPause,
      AiExternalMcpServer,
      AiExternalMcpToolSnapshot,
      AiLiveTestTarget,
      AiAdapterConfig,
      AiObservation,
      AiRecommendation,
      AiDecision,
      AiEvaluation,
      AiAgentAuditEvent,
      UserRole,
      Subscription,
      Tenant,
    ]),
    StorageModule,
    AccountsModule,
    AnalyticsModule,
    ApplicationsModule,
    AuditModule,
    AssetsModule,
    BillingModule,
    BusinessProcessesModule,
    CompaniesModule,
    ConnectionsModule,
    ContactsModule,
    ContractsModule,
    DepartmentsModule,
    IncidentsModule,
    InterfacesModule,
    ItOpsSettingsModule,
    KnowledgeModule,
    LocationsModule,
    AiProviderSupportModule,
    PlatformAiModule,
    PermissionsModule,
    PortfolioModule,
    SpendModule,
    SuppliersModule,
    TenantsModule,
    TasksModule,
    UsersModule,
  ],
  controllers: [
    AiCapabilitiesController,
    AiSettingsController,
    AiModelConfigsController,
    AiAdminOverviewController,
    AiAdminSearchIndexController,
    AiChatController,
    AiConversationsController,
    AiApiKeysController,
    AiIntegrationsController,
    AiMcpController,
    AiSearchController,
    AiAgentControlController,
  ],
  providers: [
    AiTenantExecutionService,
    McpApiKeyHashService,
    AiSettingsService,
    AiModelConfigService,
    AiModelResolverService,
    AiAdminOverviewService,
    AiSearchIndexService,
    AiApiKeysService,
    AiAttachmentService,
    AiConversationService,
    GlpiService,
    PrtgService,
    AiDocumentMutationSupportService,
    AiBusinessRecordMutationSupportService,
    AiFinancialPlanMutationSupportService,
    AiMasterDataMutationSupportService,
    AiRelationMutationSupportService,
    AiTaskMutationSupportService,
    ImportTicketAiMutationOperation,
    ImportGlpiTicketAiMutationOperation,
    CreateBusinessRecordAiMutationOperation,
    CreateDocumentAiMutationOperation,
    CreateTaskAiMutationOperation,
    CreateMasterDataRecordAiMutationOperation,
    WriteFinancialPlanAiMutationOperation,
    UpdateDocumentContentAiMutationOperation,
    UpdateDocumentMetadataAiMutationOperation,
    UpdateDocumentRelationsAiMutationOperation,
    UpdateBusinessRecordAiMutationOperation,
    UpdateEntityRelationsAiMutationOperation,
    UpdateMasterDataRecordAiMutationOperation,
    UpdateTaskFieldsAiMutationOperation,
    UpdateTaskStatusAiMutationOperation,
    UpdateTaskAssigneeAiMutationOperation,
    AddTaskCommentAiMutationOperation,
    AiMutationOperationRegistry,
    AiMutationPreviewService,
    AiPolicyService,
    AiProviderTestService,
    AiEntityService,
    AiQueryExecutor,
    AiAggregateExecutor,
    AiToolRegistry,
    AiCapabilityRegistry,
    AiCapabilityDispatcherService,
    AiEvidenceService,
    AiAgentApprovalLifecycleSweeperService,
    AiAgentActivityRetentionService,
    AiAgentBuiltinQuotaService,
    AiAgentHelpdeskTicketingIngestionService,
    AiAgentMonitoringAlertIngestionService,
    AiAgentWorkQueueService,
    AiExternalMcpBridgeService,
    AiExternalMcpMockTransport,
    AiLiveContractHarnessService,
    AiLiveTestTargetService,
    AiActionRequestService,
    AiApprovalService,
    AiApprovalPolicyResolverService,
    AiAutonomyCeilingService,
    AiAutonomyDemotionService,
    AiAutonomyRoutineService,
    AiMcpExposureService,
    AiMcpAuditService,
    AiMcpRateLimiter,
    AiAutomationJobCatalogService,
    AiEmergencyPauseService,
    AiAdapterConfigService,
    AiMonitoringIntegrationsService,
    GlpiTicketingProvider,
    PrtgMonitoringProvider,
    {
      provide: AI_PROVIDER_IMPLEMENTATIONS,
      useFactory: (glpiTicketing: GlpiTicketingProvider, prtgMonitoring: PrtgMonitoringProvider) => [
        { providerKind: 'ticketing', implementation: GLPI_TICKETING_IMPLEMENTATION, provider: glpiTicketing },
        { providerKind: 'monitoring', implementation: PRTG_MONITORING_IMPLEMENTATION, provider: prtgMonitoring },
      ],
      inject: [GlpiTicketingProvider, PrtgMonitoringProvider],
    },
    AiTenantSecretResolverService,
    AiProviderRegistryService,
    AiReadonlyDiagnosticWorkflowService,
    AiAgentLlmClient,
    AiAgentActionPlannerService,
    AiAgentPromptCompilerService,
    AiSharedContextProfileService,
    AiTicketEvidenceExtractionService,
    AiKnowledgeSearchPlannerService,
    AiTicketNeedRepresentationService,
    AiReplySynthesisService,
    AiDiagnosticBriefSynthesisService,
    AiAgentControlService,
    BraveSearchService,
    McpApiKeyAuthGuard,
    AiChatOrchestratorService,
    AiSystemPromptService,
  ],
  exports: [
    AiTenantExecutionService,
    AiSettingsService,
    AiModelConfigService,
    AiModelResolverService,
    AiAdminOverviewService,
    AiSearchIndexService,
    AiApiKeysService,
    AiAttachmentService,
    AiConversationService,
    AiMutationPreviewService,
    AiPolicyService,
    AiProviderTestService,
    AiEntityService,
    AiQueryExecutor,
    AiAggregateExecutor,
    AiToolRegistry,
    AiCapabilityRegistry,
    AiCapabilityDispatcherService,
    AiEvidenceService,
    AiAgentApprovalLifecycleSweeperService,
    AiAgentActivityRetentionService,
    AiAgentBuiltinQuotaService,
    AiAgentHelpdeskTicketingIngestionService,
    AiAgentMonitoringAlertIngestionService,
    AiAgentWorkQueueService,
    AiExternalMcpBridgeService,
    AiExternalMcpMockTransport,
    AiLiveContractHarnessService,
    AiLiveTestTargetService,
    AiActionRequestService,
    AiApprovalService,
    AiApprovalPolicyResolverService,
    AiAutonomyCeilingService,
    AiAutonomyDemotionService,
    AiAutonomyRoutineService,
    AiMcpExposureService,
    AiMcpAuditService,
    AiMcpRateLimiter,
    AiAutomationJobCatalogService,
    AiEmergencyPauseService,
    AiAdapterConfigService,
    GlpiTicketingProvider,
    AiTenantSecretResolverService,
    AiProviderRegistryService,
    AiReadonlyDiagnosticWorkflowService,
    AiAgentLlmClient,
    AiAgentActionPlannerService,
    AiAgentPromptCompilerService,
    AiSharedContextProfileService,
    AiTicketEvidenceExtractionService,
    AiKnowledgeSearchPlannerService,
    AiTicketNeedRepresentationService,
    AiReplySynthesisService,
    AiDiagnosticBriefSynthesisService,
    AiAgentControlService,
    McpApiKeyAuthGuard,
    AiChatOrchestratorService,
    AiSystemPromptService,
    AiProviderSupportModule,
  ],
})
export class AiModule {}
