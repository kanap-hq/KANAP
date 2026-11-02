import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { CapabilityExecutionContext, CapabilityExecutionResult, CapabilitySurface } from '../capability/capability-contract';
import { AiCapabilityDispatcherService } from '../dispatcher/ai-capability-dispatcher.service';
import { AiDecision } from '../entities/ai-decision.entity';
import { AiEvaluation } from '../entities/ai-evaluation.entity';
import { AiEvidence } from '../entities/ai-evidence.entity';
import { AiObservation } from '../entities/ai-observation.entity';
import { AiRecommendation } from '../entities/ai-recommendation.entity';
import { requestContextMissing } from '../../../auth/module-right-required';

type AdapterResultLike<T> =
  | { ok: true; data: T; evidence?: unknown[]; warnings?: string[] }
  | { ok: false; errorCode: string; message: string; retryable: boolean; evidence?: unknown[] };

type DiagnosticInput = {
  alert_id?: string | null;
  provider_key?: string | null;
  include_directory?: boolean | null;
  user_id_or_email?: string | null;
  continue_on_provider_error?: boolean | null;
};

type DiagnosticExecutionOptions = {
  surface?: Extract<CapabilitySurface, 'internal' | 'scheduler' | 'alert'>;
  trigger_kind?: Extract<CapabilityExecutionContext['trigger_kind'], 'internal' | 'scheduled_trigger' | 'alert_trigger'>;
  metadata?: Record<string, unknown> | null;
};

type InternalNoteTriageInput = {
  recommendation_id: string;
  ticket_id?: string | null;
  provider_key?: string | null;
  note_body?: string | null;
};

type DiagnosticCapabilityOutput = CapabilityExecutionResult<AdapterResultLike<any>>;

export type DiagnosticWorkflowResult = {
  run_id: string;
  evidence_ids: string[];
  observation_ids: string[];
  recommendation_id: string;
  decision_id: string;
  evaluation_id: string;
};

export type InternalNoteTriageProposalResult = {
  run_id: string;
  action_request_id: string;
  decision_id: string;
  evaluation_id: string;
};

function isOk<T>(value: AdapterResultLike<T>): value is { ok: true; data: T; evidence?: unknown[]; warnings?: string[] } {
  return value.ok === true;
}

function adapterDataOrThrow<T>(
  value: AdapterResultLike<T>,
  capabilityName: string,
  continueOnProviderError: boolean,
): T | null {
  if (isOk(value)) {
    return value.data;
  }
  if (continueOnProviderError) {
    return null;
  }
  throw new BadRequestException({
    message: `Provider capability ${capabilityName} failed.`,
    provider_error: {
      error_code: value.errorCode,
      message: value.message,
      retryable: value.retryable,
    },
  });
}

function safeSummary(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return 'No provider data was available.';
  }
  const record = value as Record<string, unknown>;
  const summary = record.summary ?? record.message ?? record.title ?? record.status;
  return typeof summary === 'string' && summary.trim().length > 0
    ? summary.trim()
    : `Provider data keys: ${Object.keys(record).slice(0, 8).join(', ')}`;
}

function actionRequestIdFromPrepareOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  if (record.ok !== true || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  return typeof data.action_request_id === 'string' && data.action_request_id.trim().length > 0
    ? data.action_request_id.trim()
    : null;
}

function deterministicInternalNote(recommendation: AiRecommendation, evidenceCount: number): string {
  return [
    '[KANAP TRIAGE PROPOSAL]',
    `Recommendation: ${recommendation.summary}`,
    recommendation.rationale ? `Rationale: ${recommendation.rationale}` : null,
    `Evidence references: ${evidenceCount}`,
    'No external action has been executed. This internal note was prepared by KANAP and requires human approval before posting.',
  ].filter((line): line is string => !!line).join('\n');
}

@Injectable()
export class AiReadonlyDiagnosticWorkflowService {
  constructor(
    private readonly dispatcher: AiCapabilityDispatcherService,
    @InjectRepository(AiEvidence)
    private readonly evidenceRepo: Repository<AiEvidence>,
    @InjectRepository(AiObservation)
    private readonly observationRepo: Repository<AiObservation>,
    @InjectRepository(AiRecommendation)
    private readonly recommendationRepo: Repository<AiRecommendation>,
    @InjectRepository(AiDecision)
    private readonly decisionRepo: Repository<AiDecision>,
    @InjectRepository(AiEvaluation)
    private readonly evaluationRepo: Repository<AiEvaluation>,
  ) {}

  private evidenceRepository(context: AiExecutionContextWithManager): Repository<AiEvidence> {
    return context.manager.getRepository(AiEvidence);
  }

  private observationRepository(context: AiExecutionContextWithManager): Repository<AiObservation> {
    return context.manager.getRepository(AiObservation);
  }

  private recommendationRepository(context: AiExecutionContextWithManager): Repository<AiRecommendation> {
    return context.manager.getRepository(AiRecommendation);
  }

  private decisionRepository(context: AiExecutionContextWithManager): Repository<AiDecision> {
    return context.manager.getRepository(AiDecision);
  }

  private evaluationRepository(context: AiExecutionContextWithManager): Repository<AiEvaluation> {
    return context.manager.getRepository(AiEvaluation);
  }

  private async executeRead(
    context: AiExecutionContextWithManager,
    capabilityName: string,
    input: Record<string, unknown>,
    runId: string | null,
    stepIndex: number,
    executionOptions: DiagnosticExecutionOptions,
  ): Promise<DiagnosticCapabilityOutput> {
    const surface = executionOptions.surface ?? 'internal';
    return this.dispatcher.execute(context, {
      capabilityName,
      input,
      execution: {
        surface,
        trigger_kind: executionOptions.trigger_kind ?? (surface === 'scheduler' ? 'scheduled_trigger' : surface === 'alert' ? 'alert_trigger' : 'internal'),
        runId,
        stepIndex,
        metadata: {
          diagnostic_workflow: 'mock_readonly_phase2',
          ...(executionOptions.metadata ?? {}),
        },
      },
    });
  }

  private async evidenceIdsForTool(context: AiExecutionContextWithManager, toolExecutionId: string): Promise<string[]> {
    const rows = await this.evidenceRepository(context).find({
      where: {
        tenant_id: context.tenantId,
        tool_execution_id: toolExecutionId,
      },
    });
    return rows.map((row) => row.id);
  }

  async runMockDiagnostic(
    context: AiExecutionContextWithManager,
    input: DiagnosticInput = {},
    executionOptions: DiagnosticExecutionOptions = {},
  ): Promise<DiagnosticWorkflowResult> {
    if (!context.tenantId) {
      throw requestContextMissing('Tenant context is required for diagnostic workflow execution.');
    }

    const providerKey = input.provider_key ?? 'mock';
    const continueOnProviderError = input.continue_on_provider_error === true;
    const allEvidenceIds: string[] = [];
    const observations: AiObservation[] = [];
    let runId: string | null = null;
    let stepIndex = 1;

    const alertResult = await this.executeRead(context, 'monitoring.alert.get', {
      alert_id: input.alert_id ?? 'mock-alert-001',
      provider_key: providerKey,
    }, runId, stepIndex++, executionOptions);
    runId = alertResult.run_id;
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, alertResult.tool_execution_id));
    const alert = adapterDataOrThrow<any>(alertResult.output, 'monitoring.alert.get', continueOnProviderError);

    const sensorId = alert?.sensorId ?? 'mock-sensor-cpu-001';
    const vmId = alert?.vmId ?? 'mock-vm-sap-app-03';
    const relatedTicketId = alert?.relatedTicketId ?? 'mock-ticket-1001';

    const historyResult = await this.executeRead(context, 'monitoring.sensor.history', {
      sensor_id: sensorId,
      window_minutes: 60,
      provider_key: providerKey,
    }, runId, stepIndex++, executionOptions);
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, historyResult.tool_execution_id));
    const history = adapterDataOrThrow<any>(historyResult.output, 'monitoring.sensor.history', continueOnProviderError);

    const vmResult = await this.executeRead(context, 'virtualization.vm.health', {
      vm_id: vmId,
      provider_key: providerKey,
    }, runId, stepIndex++, executionOptions);
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, vmResult.tool_execution_id));
    const vmHealth = adapterDataOrThrow<any>(vmResult.output, 'virtualization.vm.health', continueOnProviderError);

    const ticketResult = await this.executeRead(context, 'ticketing.ticket.get', {
      ticket_id: relatedTicketId,
      provider_key: providerKey,
    }, runId, stepIndex++, executionOptions);
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, ticketResult.tool_execution_id));
    const ticket = adapterDataOrThrow<any>(ticketResult.output, 'ticketing.ticket.get', continueOnProviderError);

    const similarResult = await this.executeRead(context, 'ticketing.ticket.search_similar', {
      query: alert?.message ?? 'CPU pressure SAP application server',
      ticket_id: relatedTicketId,
      limit: 3,
      provider_key: providerKey,
    }, runId, stepIndex++, executionOptions);
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, similarResult.tool_execution_id));
    const similar = adapterDataOrThrow<any>(similarResult.output, 'ticketing.ticket.search_similar', continueOnProviderError);

    let directory: any = null;
    if (input.include_directory) {
      const directoryResult = await this.executeRead(context, 'directory.user.context', {
        user_id_or_email: input.user_id_or_email ?? 'sap.operator@example.invalid',
        provider_key: providerKey,
      }, runId, stepIndex++, executionOptions);
      allEvidenceIds.push(...await this.evidenceIdsForTool(context, directoryResult.tool_execution_id));
      directory = adapterDataOrThrow<any>(directoryResult.output, 'directory.user.context', continueOnProviderError);
    }

    const observationRepo = this.observationRepository(context);
    observations.push(await observationRepo.save(observationRepo.create({
      tenant_id: context.tenantId,
      run_id: runId,
      observation_type: 'monitoring_alert',
      status: alert ? 'observed' : 'provider_unavailable',
      source_provider: 'monitoring',
      source_object_type: 'alert',
      source_object_id: alert?.id ?? input.alert_id ?? 'mock-alert-001',
      severity: alert?.severity ?? null,
      summary: alert?.message ?? safeSummary(alertResult.output),
      evidence_ids: allEvidenceIds,
      metadata_json: { provider_key: providerKey },
      observed_at: new Date(alert?.observedAt ?? Date.now()),
      created_at: new Date(),
      updated_at: new Date(),
    })));

    observations.push(await observationRepo.save(observationRepo.create({
      tenant_id: context.tenantId,
      run_id: runId,
      observation_type: 'correlated_context',
      status: 'observed',
      source_provider: 'control_plane',
      source_object_type: 'diagnostic_context',
      source_object_id: alert?.id ?? input.alert_id ?? 'mock-alert-001',
      severity: alert?.severity ?? null,
      summary: [
        history ? safeSummary(history) : 'No monitoring history was available.',
        vmHealth ? safeSummary(vmHealth) : 'No virtualization health was available.',
        ticket ? `Related ticket: ${safeSummary(ticket)}` : 'No related ticket was available.',
        similar?.tickets?.length ? `${similar.tickets.length} similar ticket(s) found.` : 'No similar tickets were found.',
        directory ? `Directory context: ${safeSummary(directory)}` : 'Directory context was not requested.',
      ].join(' '),
      evidence_ids: allEvidenceIds,
      metadata_json: { provider_key: providerKey },
      observed_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    })));

    const recommendationSummary = history?.points?.some((point: { value: number }) => point.value >= 85)
      ? 'Investigate batch overlap or guest process pressure before proposing remediation.'
      : 'Continue observation and collect a wider history window before proposing remediation.';
    const confidence = history?.points?.some((point: { value: number }) => point.value >= 85) && vmHealth?.status === 'healthy'
      ? 0.82
      : 0.58;

    const recommendationRepo = this.recommendationRepository(context);
    const recommendation = await recommendationRepo.save(recommendationRepo.create({
      tenant_id: context.tenantId,
      run_id: runId,
      observation_id: observations[0]?.id ?? null,
      recommendation_type: 'read_only_diagnostic',
      status: 'proposed',
      summary: recommendationSummary,
      rationale: 'Mock Phase 2 logic correlates monitoring trend, VM health, and ticket history without LLM calls.',
      confidence,
      proposed_action_class: 'operator_review',
      max_autonomy_level: 'A1',
      evidence_ids: allEvidenceIds,
      metadata_json: {
        provider_key: providerKey,
        similar_ticket_count: similar?.tickets?.length ?? 0,
      },
      created_at: new Date(),
      updated_at: new Date(),
    }));

    const decisionRepo = this.decisionRepository(context);
    const decision = await decisionRepo.save(decisionRepo.create({
      tenant_id: context.tenantId,
      run_id: runId,
      recommendation_id: recommendation.id,
      decision: 'recommend_only',
      status: 'recorded',
      reason: 'Phase 2 diagnostic workflow is read-only and cannot create external writes or remediation requests.',
      evidence_ids: allEvidenceIds,
      policy_result_json: {
        effect: 'read',
        max_autonomy_level: 'A1',
        approval_required: false,
        external_writes_allowed: false,
      },
      metadata_json: { deterministic: true },
      created_at: new Date(),
      updated_at: new Date(),
    }));

    const evaluationRepo = this.evaluationRepository(context);
    const evaluation = await evaluationRepo.save(evaluationRepo.create({
      tenant_id: context.tenantId,
      run_id: runId,
      recommendation_id: recommendation.id,
      decision_id: decision.id,
      status: 'pending',
      outcome: null,
      scores_json: null,
      feedback_json: null,
      metadata_json: { shell_created_by: 'phase2_mock_diagnostic_workflow' },
      created_at: new Date(),
      updated_at: new Date(),
    }));

    return {
      run_id: runId,
      evidence_ids: allEvidenceIds,
      observation_ids: observations.map((observation) => observation.id),
      recommendation_id: recommendation.id,
      decision_id: decision.id,
      evaluation_id: evaluation.id,
    };
  }

  async proposeInternalNoteForRecommendation(
    context: AiExecutionContextWithManager,
    input: InternalNoteTriageInput,
  ): Promise<InternalNoteTriageProposalResult> {
    if (!context.tenantId) {
      throw requestContextMissing('Tenant context is required for diagnostic triage proposal.');
    }
    const recommendationRepo = this.recommendationRepository(context);
    const recommendation = await recommendationRepo.findOne({
      where: {
        id: input.recommendation_id,
        tenant_id: context.tenantId,
      },
    });
    if (!recommendation) {
      throw new BadRequestException('Recommendation was not found for this tenant.');
    }

    const evidenceIds = recommendation.evidence_ids ?? [];
    const providerKey = input.provider_key ?? 'mock';
    const ticketId = input.ticket_id
      ?? (typeof recommendation.metadata_json?.ticket_id === 'string' ? recommendation.metadata_json.ticket_id : null)
      ?? (typeof recommendation.metadata_json?.related_ticket_id === 'string' ? recommendation.metadata_json.related_ticket_id : null)
      ?? 'mock-ticket-1001';

    const decisionRepo = this.decisionRepository(context);
    const decision = await decisionRepo.save(decisionRepo.create({
      tenant_id: context.tenantId,
      run_id: recommendation.run_id,
      recommendation_id: recommendation.id,
      decision: 'approval_required',
      status: 'recorded',
      reason: 'Phase 3 triage can only post an internal ticket note after durable human approval.',
      evidence_ids: evidenceIds,
      policy_result_json: {
        effect: 'write',
        max_autonomy_level: 'A3',
        approval_required: true,
        external_writes_allowed_after_approval: true,
        public_comment_allowed: false,
      },
      metadata_json: {
        provider_kind: 'ticketing',
        provider_key: providerKey,
        ticket_id: ticketId,
        source_recommendation_id: recommendation.id,
      },
      created_at: new Date(),
      updated_at: new Date(),
    }));

    const evaluationRepo = this.evaluationRepository(context);
    const evaluation = await evaluationRepo.save(evaluationRepo.create({
      tenant_id: context.tenantId,
      run_id: recommendation.run_id,
      recommendation_id: recommendation.id,
      decision_id: decision.id,
      status: 'pending',
      outcome: null,
      scores_json: null,
      feedback_json: null,
      metadata_json: {
        shell_created_by: 'phase3_internal_note_triage_proposal',
        awaiting_action_execution: true,
      },
      created_at: new Date(),
      updated_at: new Date(),
    }));

    const prepared = await this.dispatcher.execute(context, {
      capabilityName: 'ticketing.ticket.internal_note.prepare',
      input: {
        ticket_id: ticketId,
        provider_key: providerKey,
        note_body: input.note_body ?? deterministicInternalNote(recommendation, evidenceIds.length),
        evidence_ids: evidenceIds,
        observation_id: recommendation.observation_id ?? undefined,
        recommendation_id: recommendation.id,
        decision_id: decision.id,
        evaluation_id: evaluation.id,
      },
      execution: {
        surface: 'internal',
        trigger_kind: 'internal',
        runId: recommendation.run_id,
        stepIndex: 100,
        metadata: { diagnostic_workflow: 'phase3_internal_note_triage' },
      },
    });

    const actionRequestId = actionRequestIdFromPrepareOutput(prepared.output);
    if (!actionRequestId) {
      throw new BadRequestException('Internal-note prepare capability did not create an action request.');
    }
    evaluation.metadata_json = {
      ...(evaluation.metadata_json ?? {}),
      action_request_id: actionRequestId,
    };
    evaluation.updated_at = new Date();
    await evaluationRepo.save(evaluation);

    return {
      run_id: recommendation.run_id ?? prepared.run_id,
      action_request_id: actionRequestId,
      decision_id: decision.id,
      evaluation_id: evaluation.id,
    };
  }
}
