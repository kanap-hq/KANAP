import { z } from 'zod';
import type { AiMutationPreviewDto } from '../../ai.types';

export const EXECUTE_APPROVED_PREVIEW_CAPABILITY = 'kanap.mutation_preview.execute_approved';
export const TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY = 'ticketing.ticket.internal_note.prepare';
export const TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY = 'ticketing.ticket.internal_note.add_approved';
export const TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY = 'ticketing.ticket.public_reply.prepare';
export const TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY = 'ticketing.ticket.public_reply.add_approved';
export const TICKETING_TICKET_NOTES_LIST_CAPABILITY = 'ticketing.ticket.notes.list';
export const TICKETING_TICKET_ATTACHMENT_READ_CAPABILITY = 'ticketing.ticket.attachment.read';
export const TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY = 'ticketing.ticket.classification_context.get';
export const TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY = 'ticketing.ticket.classification_update.prepare';
export const TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY = 'ticketing.ticket.classification_update.approved';
export const TICKETING_LIFECYCLE_CONTEXT_CAPABILITY = 'ticketing.ticket.lifecycle_context.get';
export const TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY = 'ticketing.ticket.status_update.prepare';
export const TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY = 'ticketing.ticket.status_update.approved';
export const TICKETING_ROUTING_CONTEXT_CAPABILITY = 'ticketing.ticket.routing_context.get';
export const TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY = 'ticketing.ticket.assignment_update.prepare';
export const TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY = 'ticketing.ticket.assignment_update.approved';
export const TICKETING_PARTICIPANT_CONTEXT_CAPABILITY = 'ticketing.ticket.participant_context.get';
export const TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY = 'ticketing.ticket.participant_update.prepare';
export const TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY = 'ticketing.ticket.participant_update.approved';
export const AUTOMATION_PROVIDER_CAPABILITY_VERSION = '1.0.0';
export const AUTOMATION_JOB_ALLOWED_LIST_CAPABILITY = 'automation.job.allowed.list';
export const AUTOMATION_JOB_SCHEMA_GET_CAPABILITY = 'automation.job.schema.get';
export const AUTOMATION_JOB_DRY_RUN_CAPABILITY = 'automation.job.dry_run';
export const AUTOMATION_JOB_LAUNCH_PREPARE_CAPABILITY = 'automation.job.launch.prepare';
export const AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY = 'automation.job.launch_approved';
export const AUTOMATION_JOB_STATUS_GET_CAPABILITY = 'automation.job.status.get';
export const AUTOMATION_JOB_OUTPUT_GET_CAPABILITY = 'automation.job.output.get';
export const EXTERNAL_MCP_CAPABILITY_VERSION = '1.0.0';

export const CapabilityEffectSchema = z.enum(['read', 'propose', 'notify', 'write', 'remediate']);
export type CapabilityEffect = z.infer<typeof CapabilityEffectSchema>;

export const CapabilityRiskLevelSchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type CapabilityRiskLevel = z.infer<typeof CapabilityRiskLevelSchema>;

export const CapabilitySurfaceSchema = z.enum(['chat', 'mcp', 'scheduler', 'alert', 'internal']);
export type CapabilitySurface = z.infer<typeof CapabilitySurfaceSchema>;

export const CapabilityAutonomyLevelSchema = z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
export type CapabilityAutonomyLevel = z.infer<typeof CapabilityAutonomyLevelSchema>;

export const CapabilityApprovalRequirementSchema = z.enum(['none', 'human', 'policy']);
export type CapabilityApprovalRequirement = z.infer<typeof CapabilityApprovalRequirementSchema>;

export const CapabilityApprovalStrategySchema = z.union([
  z.object({
    mode: z.literal('none'),
  }),
  z.object({
    mode: z.literal('mutation_preview'),
    preview_id_input_field: z.string().trim().min(1).default('preview_ids'),
  }),
  z.object({
    mode: z.literal('action_request'),
    action_request_id_input_field: z.string().trim().min(1).default('action_request_id'),
  }),
]).default({ mode: 'none' });
export type CapabilityApprovalStrategy = z.infer<typeof CapabilityApprovalStrategySchema>;

export const CapabilityProviderKindSchema = z.enum([
  'kanap_domain',
  'ticketing',
  'monitoring',
  'virtualization',
  'directory',
  'communication',
  'automation',
  'external_mcp',
  'web',
]);
export type CapabilityProviderKind = z.infer<typeof CapabilityProviderKindSchema>;

export const CapabilityRetryPolicySchema = z.object({
  automatic_retry: z.boolean(),
  max_attempts: z.number().int().min(1).max(10).default(1),
});
export type CapabilityRetryPolicy = z.infer<typeof CapabilityRetryPolicySchema>;

export const CapabilityIdempotencySchema = z.object({
  mode: z.enum(['idempotent', 'non_idempotent']),
  key_fields: z.array(z.string().trim().min(1)).optional(),
});
export type CapabilityIdempotency = z.infer<typeof CapabilityIdempotencySchema>;

export const CapabilityEvidenceRequirementSchema = z.object({
  persist_input: z.boolean(),
  persist_output: z.boolean(),
  redact_fields: z.array(z.string().trim().min(1)).default([]),
  retention: z.enum(['short', 'standard', 'audit']).default('standard'),
});
export type CapabilityEvidenceRequirement = z.infer<typeof CapabilityEvidenceRequirementSchema>;

export const CapabilityMcpExposureSchema = z.object({
  enabled: z.boolean(),
  read_only: z.boolean(),
});
export type CapabilityMcpExposure = z.infer<typeof CapabilityMcpExposureSchema>;

export const CapabilityContractSchema = z.object({
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.string().trim().min(1),
  provider_kind: CapabilityProviderKindSchema,
  supported_surfaces: z.array(CapabilitySurfaceSchema).min(1),
  input_schema: z.record(z.string(), z.unknown()),
  output_schema: z.record(z.string(), z.unknown()),
  effect: CapabilityEffectSchema,
  risk_level: CapabilityRiskLevelSchema,
  max_autonomy_level: CapabilityAutonomyLevelSchema,
  default_approval: CapabilityApprovalRequirementSchema,
  approval_strategy: CapabilityApprovalStrategySchema,
  evidence: CapabilityEvidenceRequirementSchema,
  tenant_permissions: z.array(z.string().trim().min(1)).default([]),
  business_resources: z.array(z.string().trim().min(1)).default([]),
  timeout_seconds: z.number().int().min(1).max(1800),
  retry_policy: CapabilityRetryPolicySchema,
  execution_phase: z.number().int().optional(),
  idempotency: CapabilityIdempotencySchema,
  rollback: z.object({
    supported: z.boolean(),
    capability_name: z.string().trim().min(1).optional(),
  }),
  cost: z.object({
    estimated_unit_cost: z.number().min(0).nullable().default(null),
    metered: z.boolean().default(false),
  }),
  redaction_policy: z.object({
    fields: z.array(z.string().trim().min(1)).default([]),
  }),
  mcp_exposure: CapabilityMcpExposureSchema,
  live_test_safety: z.enum(['mock_only', 'live_read', 'live_write_gated', 'destructive_gated']),
  compatibility: z.object({
    ai_tool_name: z.string().trim().min(1).nullable().default(null),
  }).default({ ai_tool_name: null }),
}).superRefine((value, ctx) => {
  if (value.mcp_exposure.enabled && (value.effect !== 'read' || !value.mcp_exposure.read_only)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mcp_exposure'],
      message: 'MCP exposure is only allowed for read-only capabilities in Phase 1.',
    });
  }
  if (value.effect !== 'read' && value.default_approval === 'none' && value.max_autonomy_level !== 'A2') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['default_approval'],
      message: 'Non-read capabilities must either require approval or be capped at A2 proposal-only autonomy.',
    });
  }
  if (value.idempotency.mode === 'idempotent' && (!value.idempotency.key_fields || value.idempotency.key_fields.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['idempotency', 'key_fields'],
      message: 'Idempotent capabilities must declare key fields.',
    });
  }
});

export type CapabilityContract = z.infer<typeof CapabilityContractSchema>;

export type CapabilityExecutionContext = {
  runId?: string | null;
  toolExecutionId?: string | null;
  stepIndex?: number | null;
  surface: CapabilitySurface;
  trigger_kind: 'human_user' | 'mcp_client' | 'alert_trigger' | 'scheduled_trigger' | 'internal';
  idempotency_key?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CapabilityExecutionResult<T = unknown> = {
  run_id: string;
  step_id: string;
  tool_execution_id: string;
  /** Handler output after redaction. The model and the evidence store read this. */
  output: T;
  /** Mutation previews taken from the handler output before redaction, for the card the user approves. */
  previews?: AiMutationPreviewDto[];
};

export type CapabilityApplicability = {
  available: boolean;
  reason?: string | null;
};
