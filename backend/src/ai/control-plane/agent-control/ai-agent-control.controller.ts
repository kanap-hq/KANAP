import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../../../common/skip-tenant-transaction.decorator';
import { AiExecutionContext, AiExecutionContextWithManager } from '../../ai.types';
import { AiPolicyService } from '../../ai-policy.service';
import { AiTenantExecutionService } from '../../execution/ai-tenant-execution.service';
import { AiAgentHelpdeskTicketingIngestionService } from '../agent/ai-agent-helpdesk-ticketing-ingestion.service';
import { AiAgentMonitoringAlertIngestionService } from '../agent/ai-agent-monitoring-alert-ingestion.service';
import {
  AiAgentWorkQueueService,
} from '../agent/ai-agent-work-queue.service';
import { AiEmergencyPauseService } from '../pause/ai-emergency-pause.service';
import {
  AgentControlTicketingReadInput,
  AgentControlTicketingTriageInput,
  AgentControlMonitoringDiagnosisInput,
  AgentControlMockTriageInput,
  AgentControlActivityType,
  AgentControlAgentDefinitionInput,
  AgentControlAgentStatusInput,
  AgentControlAutonomyInput,
  AgentControlBulkApproveInput,
  AgentControlTargetingPreviewInput,
  AiAgentControlService,
} from './ai-agent-control.service';
import { AGENT_ACTIVITY_TYPES } from './ai-agent-activity-timeline';
import { SharedContextProfileInput } from './ai-shared-context-profile.service';
import { ReservedToUnscopedDataAccess } from '../../../data-access/reserved-operations';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOptionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new BadRequestException(`${field} must be a UUID.`);
  }
  return value.trim();
}

function parseLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

// `types` accepts a repeated query param (?types=a&types=b) or a comma-separated
// list (?types=a,b). The legacy single `type` param is still honoured so old
// deep links into the timeline keep working; both are merged when present.
function parseActivityTypes(...values: unknown[]): AgentControlActivityType[] | null {
  const allowed = new Set<string>(AGENT_ACTIVITY_TYPES);
  const parsed: AgentControlActivityType[] = [];
  for (const value of values) {
    if (typeof value !== 'string' && !Array.isArray(value)) continue;
    const rawValues = Array.isArray(value) ? value : value.split(',');
    for (const entry of rawValues) {
      const trimmed = String(entry).trim();
      if (allowed.has(trimmed)) parsed.push(trimmed as AgentControlActivityType);
    }
  }
  return parsed.length > 0 ? Array.from(new Set(parsed)) : null;
}

type AgentControlAccess = 'read' | 'operate' | 'admin';
const MAX_APPROVAL_REASON_CHARS = 500;

type EmergencyPauseBody = {
  scope?: 'tenant' | 'agent' | null;
  agent_definition_id?: string | null;
  reason?: string;
  expires_in_minutes?: number | null;
};
type AgentControlDecisionInput = {
  execute?: boolean | null;
  reason?: string | null;
};

function normalizeApprovalReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_APPROVAL_REASON_CHARS
    ? trimmed.slice(0, MAX_APPROVAL_REASON_CHARS)
    : trimmed;
}

@ReservedToUnscopedDataAccess()
@Controller('ai/admin/control-plane')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiAgentControlController {
  private readonly logger = new Logger(AiAgentControlController.name);

  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly control: AiAgentControlService,
    private readonly ticketingIngestion: AiAgentHelpdeskTicketingIngestionService,
    private readonly monitoringIngestion: AiAgentMonitoringAlertIngestionService,
    private readonly workQueue: AiAgentWorkQueueService,
    private readonly emergencyPause: AiEmergencyPauseService,
  ) {}

  private buildContext(req: any): AiExecutionContext {
    const tenantId = req?.tenant?.id ? String(req.tenant.id) : '';
    if (!tenantId || !isUuid(tenantId)) {
      throw new ForbiddenException('Valid tenant context is required.');
    }

    return {
      tenantId,
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat',
      authMethod: 'jwt',
      requestId: req?.id ?? null,
      aiApiKeyId: null,
    };
  }

  private async runRead<T>(
    context: AiExecutionContext,
    fn: (context: AiExecutionContextWithManager) => Promise<T>,
    access: AgentControlAccess = 'read',
  ): Promise<T> {
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.assertAccess(context, manager, access);
        return fn({ ...context, manager });
      },
      { transaction: false },
    );
  }

  private async runTransaction<T>(
    context: AiExecutionContext,
    access: AgentControlAccess,
    fn: (context: AiExecutionContextWithManager) => Promise<T>,
  ): Promise<T> {
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.assertAccess(context, manager, access);
        return fn({ ...context, manager });
      },
    );
  }

  private async assertAccess(
    context: AiExecutionContext,
    manager: AiExecutionContextWithManager['manager'],
    access: AgentControlAccess,
  ): Promise<void> {
    if (access === 'admin') {
      await this.policy.assertAgentAdmin(context, manager);
      return;
    }
    if (access === 'operate') {
      await this.policy.assertAgentOperate(context, manager);
      return;
    }
    await this.policy.assertAgentRead(context, manager);
  }

  private async recordBackgroundExecutionError(
    context: AiExecutionContext,
    input: {
      eventType: string;
      message: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.tenantExecutor.runWithContext(context, async (tenantContext) => {
        await this.workQueue.recordAuditEvent(tenantContext, {
          eventType: input.eventType,
          severity: 'error',
          message: input.message,
          metadata: input.metadata,
        });
      });
    } catch (error) {
      this.logger.error(
        `Background approved action audit failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private scheduleApprovedActionExecution(context: AiExecutionContext, actionRequestIds: string[]) {
    const ids = Array.from(new Set(actionRequestIds.filter((id) => typeof id === 'string' && id.length > 0)));
    if (ids.length === 0) {
      return;
    }
    setImmediate(() => {
      void (async () => {
        // Resolve the ordered, batch-stamped plan in one short transaction.
        const orderedIds = await this.tenantExecutor.runWithContext(context, async (tenantContext) => {
          await this.assertAccess(context, tenantContext.manager, 'operate');
          const plan = await this.control.planApprovedBulkExecution(tenantContext, { action_request_ids: ids });
          return plan.orderedIds;
        });
        // Execute each approved action in its OWN transaction so row locks on the
        // ticket work item / target state release between (slow) ticketing writes and
        // never block the queue-overview reconciliation that the UI polls.
        for (let index = 0; index < orderedIds.length; index += 1) {
          const actionRequestId = orderedIds[index];
          await this.tenantExecutor.runWithContext(context, async (tenantContext) => {
            await this.assertAccess(context, tenantContext.manager, 'operate');
            await this.control.executeSingleApprovedAction(tenantContext, actionRequestId, {
              batchIds: orderedIds,
              stepIndex: index,
            });
          }).catch(async (error) => {
            const message = `Background approved action execution failed for ${actionRequestId}: ${error instanceof Error ? error.message : String(error)}`;
            this.logger.error(
              message,
              error instanceof Error ? error.stack : undefined,
            );
            await this.recordBackgroundExecutionError(context, {
              eventType: 'approved_action_background_execution_failed',
              message,
              metadata: {
                action_request_id: actionRequestId,
                batch_action_request_ids: orderedIds,
              },
            });
          });
        }
      })().catch(async (error) => {
        const message = `Background approved action scheduling failed for ${ids.join(', ')}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.error(
          message,
          error instanceof Error ? error.stack : undefined,
        );
        await this.recordBackgroundExecutionError(context, {
          eventType: 'approved_action_background_scheduling_failed',
          message,
          metadata: {
            action_request_ids: ids,
          },
        });
      });
    });
  }

  @Get('agents')
  async listAgents(@Req() req: any) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listAgentDefinitions(tenantContext));
  }

  @Post('agents')
  async createAgent(
    @Req() req: any,
    @Body() body: AgentControlAgentDefinitionInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.createAgentDefinition(tenantContext, body ?? {}));
  }

  @Get('shared-context-profiles')
  async listSharedContextProfiles(@Req() req: any) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listSharedContextProfiles(tenantContext));
  }

  @Post('shared-context-profiles')
  async createSharedContextProfile(
    @Req() req: any,
    @Body() body: SharedContextProfileInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.createSharedContextProfile(tenantContext, body ?? {}));
  }

  @Post('shared-context-profiles/:id')
  async updateSharedContextProfile(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SharedContextProfileInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.updateSharedContextProfile(tenantContext, id, body ?? {}));
  }

  @Post('shared-context-profiles/:id/archive')
  async archiveSharedContextProfile(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.archiveSharedContextProfile(tenantContext, id));
  }

  @Post('shared-context-profiles/:id/restore')
  async restoreSharedContextProfile(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.restoreSharedContextProfile(tenantContext, id));
  }

  @Get('agents/:id/autonomy')
  async getAgentAutonomy(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getAgentAutonomy(tenantContext, id));
  }

  @Post('agents/:id/autonomy')
  async setAgentAutonomy(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AgentControlAutonomyInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.setAgentAutonomy(tenantContext, id, body ?? {}));
  }

  @Get('agents/:id')
  async getAgent(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getAgentDefinition(tenantContext, id));
  }

  @Get('agents/:id/effective-prompt')
  async getAgentEffectivePrompt(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getAgentEffectivePrompt(tenantContext, id));
  }

  @Post('agents/:id/targeting-preview')
  async previewAgentTargeting(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AgentControlTargetingPreviewInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.previewAgentTargeting(tenantContext, id, body ?? {}));
  }

  @Get('agents/:id/targeting-options/:field')
  async getAgentTargetingOptions(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('field') field: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) =>
      this.control.getAgentTargetingOptions(tenantContext, id, field, { query, limit }),
    );
  }

  @Post('agents/:id')
  async updateAgent(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AgentControlAgentDefinitionInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.updateAgentDefinition(tenantContext, id, body ?? {}));
  }

  @Post('agents/:id/status')
  async updateAgentStatus(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AgentControlAgentStatusInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.updateAgentStatus(tenantContext, id, body ?? {}));
  }

  @Delete('agents/:id')
  async deleteAgentDefinition(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'admin', (tenantContext) => this.control.deleteAgentDefinition(tenantContext, id));
  }

  @Get('runs')
  async listRuns(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listRuns(tenantContext, {
      limit: parseLimit(limit, 25),
      status: status ?? null,
    }));
  }

  @Get('runs/:id')
  async getRun(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getRunDetail(tenantContext, id));
  }

  @Get('actions')
  async listActions(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listActionRequests(tenantContext, {
      limit: parseLimit(limit, 50),
      status: status ?? 'pending',
    }));
  }

  @Get('badges')
  async getBadges(@Req() req: any) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getBadges(tenantContext));
  }

  @Get('activity')
  async listActivity(
    @Req() req: any,
    @Query('agentDefinitionId') agentDefinitionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('targetRef') targetRef?: string,
    @Query('types') types?: string | string[],
    @Query('type') type?: string | string[],
    @Query('actorUserId') actorUserId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listActivity(tenantContext, {
      agentDefinitionId: agentDefinitionId ?? null,
      from: from ?? null,
      to: to ?? null,
      targetRef: targetRef ?? null,
      types: parseActivityTypes(types, type),
      actorUserId: actorUserId ?? null,
      status: status ?? null,
      limit: parseLimit(limit, 50),
      cursor: cursor ?? null,
    }));
  }

  @Get('helpdesk/evaluation/daily')
  async getHelpdeskEvaluationDaily(
    @Req() req: any,
    @Query('days') days?: string,
    @Query('agentDefinitionId') agentDefinitionId?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getHelpdeskEvaluationDaily(tenantContext, {
      days: parseLimit(days, 30),
      agentDefinitionId: agentDefinitionId ?? undefined,
    }));
  }

  @Get('queue')
  async getQueueOverview(
    @Req() req: any,
    @Query('limit') limit?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, async (tenantContext) => {
      const overview = await this.control.getQueueOverview(tenantContext, {
        limit: parseLimit(limit, 50),
      });
      const activePause = await this.emergencyPause.findActiveTenantWidePause(tenantContext);
      return { ...overview, emergency_pause: this.pauseView(activePause) };
    });
  }

  @Post('emergency-pause')
  async createEmergencyPause(
    @Req() req: any,
    @Body() body: EmergencyPauseBody = {},
  ) {
    const context = this.buildContext(req);
    return this.createEmergencyPauseForScope(context, body);
  }

  @Post('emergency-pause/:id/revoke')
  async revokeEmergencyPause(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.revokeEmergencyPauseByScope(context, id);
  }

  @Get('queue/work-items/:id/helpdesk-context')
  async getHelpdeskWorkItemContext(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getHelpdeskWorkItemContext(tenantContext, id));
  }

  // Clearing a "Needs attention" row. Operator-gated like the approve/reject
  // decisions — it is a judgement call on the agent's output, not a read.
  @Post('queue/attention/:kind/:id/acknowledge')
  async acknowledgeAttention(
    @Req() req: any,
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    if (kind !== 'action' && kind !== 'work-item') {
      throw new BadRequestException('kind must be "action" or "work-item".');
    }
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.acknowledgeAttention(
      tenantContext,
      { kind: kind === 'action' ? 'action' : 'work_item', id },
    ));
  }

  // The whole backlog count (the page only fetches its first 100 rows).
  @Get('queue/attention/summary')
  async getAttentionSummary(
    @Req() req: any,
    @Query('agent_definition_id') agentDefinitionId?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.getAttentionSummary(
      tenantContext,
      { agentDefinitionId: parseOptionalUuid(agentDefinitionId, 'agent_definition_id') },
    ));
  }

  @Post('queue/attention/acknowledge-all')
  async acknowledgeAllAttention(
    @Req() req: any,
    @Body() body: { agent_definition_id?: string | null } = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.acknowledgeAllAttention(
      tenantContext,
      { agentDefinitionId: parseOptionalUuid(body?.agent_definition_id, 'agent_definition_id') },
    ));
  }

  @Post('uat/mock-triage')
  async runMockTriage(
    @Req() req: any,
    @Body() body: AgentControlMockTriageInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.runMockTriage(tenantContext, body ?? {}));
  }

  @Get('uat/glpi-read/targets')
  async listGlpiReadTargets(
    @Req() req: any,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listGlpiReadTargets(tenantContext));
  }

  @Get('uat/ticketing-read/targets')
  async listTicketingReadTargets(
    @Req() req: any,
    @Query('provider_key') providerKey?: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listTicketingReadTargets(tenantContext, {
      provider_key: providerKey,
    }));
  }

  @Post('uat/glpi-read')
  async runGlpiRead(
    @Req() req: any,
    @Body() body: Pick<AgentControlTicketingReadInput, 'target_key'> = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.runGlpiRead(tenantContext, body ?? {}));
  }

  @Post('uat/ticketing-read')
  async runTicketingRead(
    @Req() req: any,
    @Body() body: AgentControlTicketingReadInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.runTicketingRead(tenantContext, body ?? {}));
  }

  @Post('uat/ticketing-triage')
  async runTicketingTriage(
    @Req() req: any,
    @Body() body: AgentControlTicketingTriageInput = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.runTicketingTriage(tenantContext, body ?? {}));
  }

  @Post('helpdesk/glpi-ingestion/poll')
  async pollHelpdeskGlpiIngestion(
    @Req() req: any,
  ) {
    return this.pollHelpdeskTicketingIngestion(req);
  }

  @Post('helpdesk/ticketing-ingestion/poll')
  async pollHelpdeskTicketingIngestion(
    @Req() req: any,
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.ticketingIngestion.pollTenant(tenantContext));
  }

  @Post('sre/monitoring-ingestion/poll')
  async pollSreMonitoringIngestion(
    @Req() req: any,
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.monitoringIngestion.pollTenant(tenantContext));
  }

  @Post('agents/:id/monitoring-diagnosis/test')
  async testAgentMonitoringDiagnosis(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Pick<AgentControlMonitoringDiagnosisInput, 'alert_id'> = {},
  ) {
    const context = this.buildContext(req);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.runMonitoringDiagnosis(tenantContext, {
      agent_definition_id: id,
      alert_id: body?.alert_id ?? null,
    }));
  }

  @Get('agents/:id/monitoring-alerts/:targetRef/diagnoses')
  async listAgentMonitoringAlertDiagnoses(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('targetRef') targetRef: string,
  ) {
    const context = this.buildContext(req);
    return this.runRead(context, (tenantContext) => this.control.listMonitoringAlertDiagnoses(tenantContext, {
      agent_definition_id: id,
      target_ref: targetRef,
    }));
  }

  @Post('helpdesk/emergency-pause')
  async createHelpdeskEmergencyPause(
    @Req() req: any,
    @Body() body: EmergencyPauseBody = {},
  ) {
    const context = this.buildContext(req);
    return this.createEmergencyPauseForScope(context, { ...body, scope: 'tenant' });
  }

  private async createEmergencyPauseForScope(
    context: AiExecutionContext,
    body: EmergencyPauseBody,
  ) {
    const scope = body?.scope === 'agent' ? 'agent' : 'tenant';
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new ForbiddenException('An emergency pause requires an explicit reason.');
    }
    const expiresInMinutes = typeof body?.expires_in_minutes === 'number'
      && Number.isFinite(body.expires_in_minutes) && body.expires_in_minutes > 0
      ? Math.min(Math.floor(body.expires_in_minutes), 7 * 24 * 60)
      : null;
    const agentDefinitionId = scope === 'agent' ? (body?.agent_definition_id ?? null) : null;
    return this.runTransaction(context, scope === 'agent' ? 'operate' : 'admin', async (tenantContext) => {
      const pause = await this.emergencyPause.createPause(tenantContext, {
        scope,
        agentDefinitionId,
        reason,
        expiresAt: expiresInMinutes ? new Date(Date.now() + expiresInMinutes * 60_000) : null,
      });
      const label = scope === 'agent' ? 'Agent emergency pause' : 'Tenant emergency pause';
      await this.recordPauseAudit(
        tenantContext,
        'emergency_pause_created',
        `${label} activated: ${reason}`,
        pause.id,
        pause.agent_definition_id ?? null,
      );
      return this.pauseView(pause);
    });
  }

  @Post('helpdesk/emergency-pause/:id/revoke')
  async revokeHelpdeskEmergencyPause(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const context = this.buildContext(req);
    return this.revokeEmergencyPauseByScope(context, id);
  }

  private async revokeEmergencyPauseByScope(
    context: AiExecutionContext,
    id: string,
  ) {
    return this.runTransaction(context, 'operate', async (tenantContext) => {
      const existing = await this.emergencyPause.getPause(tenantContext, id);
      if (!existing) {
        throw new ForbiddenException('Emergency pause not found.');
      }
      if (existing.scope !== 'agent') {
        await this.policy.assertAgentAdmin(tenantContext, tenantContext.manager);
      }
      const pause = await this.emergencyPause.revokePause(tenantContext, id);
      const label = pause.scope === 'agent' ? 'Agent emergency pause' : 'Tenant emergency pause';
      await this.recordPauseAudit(
        tenantContext,
        'emergency_pause_revoked',
        `${label} lifted: ${pause.reason}`,
        pause.id,
        pause.agent_definition_id ?? null,
      );
      return this.pauseView(pause);
    });
  }

  private pauseView(pause: {
    id: string;
    active: boolean;
    reason: string;
    scope?: string | null;
    agent_definition_id?: string | null;
    created_at?: Date | null;
    expires_at?: Date | null;
  } | null) {
    if (!pause) {
      return null;
    }
    return {
      id: pause.id,
      active: pause.active,
      scope: pause.scope ?? null,
      agent_definition_id: pause.agent_definition_id ?? null,
      reason: pause.reason,
      created_at: pause.created_at ? new Date(pause.created_at).toISOString() : null,
      expires_at: pause.expires_at ? new Date(pause.expires_at).toISOString() : null,
    };
  }

  private async recordPauseAudit(
    tenantContext: AiExecutionContextWithManager,
    eventType: 'emergency_pause_created' | 'emergency_pause_revoked',
    message: string,
    pauseId: string,
    agentDefinitionId: string | null,
  ): Promise<void> {
    await this.workQueue.recordAuditEvent(tenantContext, {
      agentDefinitionId,
      eventType,
      severity: 'warning',
      message,
      metadata: { pause_id: pauseId },
    });
  }

  @Post('actions/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  async approveActionsBulk(
    @Req() req: any,
    @Body() body: AgentControlBulkApproveInput = {},
  ) {
    const context = this.buildContext(req);
    const shouldExecute = body?.execute !== false;
    const reason = normalizeApprovalReason(body?.reason);
    const result = await this.runTransaction(context, 'operate', (tenantContext) =>
      this.control.approveActionRequestsBulk(tenantContext, {
        ...body,
        execute: false,
        reason,
      }, { queueExecution: shouldExecute }));
    if (shouldExecute) {
      this.scheduleApprovedActionExecution(context, result.results
        .filter((item) => item.status === 'approved' || item.action.status === 'approved')
        .map((item) => item.action_request_id));
    }
    return result;
  }

  @Post('actions/:id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  async approveAction(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AgentControlDecisionInput = {},
  ) {
    const context = this.buildContext(req);
    const shouldExecute = body?.execute !== false;
    const reason = normalizeApprovalReason(body?.reason);
    const result = await this.runTransaction(context, 'operate', (tenantContext) => this.control.approveActionRequest(tenantContext, id, {
      execute: false,
      reason,
    }));
    if (shouldExecute) {
      this.scheduleApprovedActionExecution(context, [result.action.id]);
    }
    return {
      ...result,
      execution_mode: shouldExecute ? 'queued' : 'approve_only',
    };
  }

  @Post('actions/:id/reject')
  async rejectAction(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason?: string | null } = {},
  ) {
    const context = this.buildContext(req);
    const reason = normalizeApprovalReason(body?.reason);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.rejectActionRequest(
      tenantContext,
      id,
      reason,
    ));
  }

  @Post('actions/:id/dismiss')
  async dismissAction(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason?: string | null } = {},
  ) {
    const context = this.buildContext(req);
    const reason = normalizeApprovalReason(body?.reason);
    return this.runTransaction(context, 'operate', (tenantContext) => this.control.dismissActionRequest(
      tenantContext,
      id,
      reason,
    ));
  }
}
