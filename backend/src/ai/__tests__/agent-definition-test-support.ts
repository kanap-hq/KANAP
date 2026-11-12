import { randomUUID } from 'node:crypto';
import { AiExecutionContextWithManager } from '../ai.types';
import {
  HELP_DESK_TICKETING_TRIAGE_AGENT_KEY,
  HELP_DESK_TICKETING_TRIAGE_MANUAL_TRIGGER_KEY,
  SRE_MONITORING_DIAGNOSIS_AGENT_KEY,
} from '../control-plane/agent/ai-agent-work-queue.service';
import { helpdeskAgentDefaults, sreAgentDefaults } from '../control-plane/agent/agent-definition-defaults';
import { AiAgentDefinition } from '../control-plane/entities/ai-agent-definition.entity';
import { AiAgentTrigger } from '../control-plane/entities/ai-agent-trigger.entity';
import { AiAdapterConfig } from '../control-plane/providers/adapter-config.entity';

export type TestHelpdeskDefinitionBundle = {
  definition: AiAgentDefinition;
  trigger: AiAgentTrigger;
};

function policyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function ticketingBindingFromDefinition(definition: AiAgentDefinition): { providerKind: string; providerKey: string } {
  const bindings = policyObject(definition.provider_bindings_json);
  const ticketing = policyObject(bindings.ticketing);
  const providerKind = typeof ticketing.provider_kind === 'string' && ticketing.provider_kind.trim()
    ? ticketing.provider_kind.trim()
    : 'ticketing';
  const providerKey = typeof ticketing.provider_key === 'string' && ticketing.provider_key.trim()
    ? ticketing.provider_key.trim()
    : 'glpi';
  return { providerKind, providerKey };
}

export async function seedTestHelpdeskDefinition(
  context: AiExecutionContextWithManager,
  options: { ticketingProviderKey?: string } = {},
): Promise<TestHelpdeskDefinitionBundle> {
  const ticketingProviderKey = options.ticketingProviderKey ?? 'glpi';
  const defaults = helpdeskAgentDefaults({ ticketingProviderKey });
  const definitionRepo = context.manager.getRepository(AiAgentDefinition);
  const triggerRepo = context.manager.getRepository(AiAgentTrigger);
  const existing = await definitionRepo.findOne({
    where: { tenant_id: context.tenantId, agent_key: HELP_DESK_TICKETING_TRIAGE_AGENT_KEY },
  });
  const now = new Date();
  const definition = existing ?? await definitionRepo.save(definitionRepo.create({
    tenant_id: context.tenantId,
    agent_key: HELP_DESK_TICKETING_TRIAGE_AGENT_KEY,
    name: 'Helpdesk ticket triage agent',
    description: 'Reads a configured ticketing safe target, searches KANAP knowledge, and prepares approval-gated helpdesk follow-up proposals.',
    agent_type: 'helpdesk',
    status: 'enabled',
    ...defaults,
    // The test agent searches KANAP knowledge: its administrator opened every library.
    scope_policy_json: {
      ...defaults.scope_policy_json,
      knowledge_sources: {
        ...(defaults.scope_policy_json.knowledge_sources as Record<string, unknown>),
        knowledge: { enabled: true, all_libraries: true, library_ids: [] },
      },
    },
    persona_json: {
      mission: 'Triage helpdesk tickets, gather supporting KANAP knowledge, and prepare safe follow-up proposals for review.',
      tone: 'Clear, concise, and support-oriented.',
      instructions: [
        'Prefer internal notes when evidence is incomplete or the next step needs analyst review.',
        'Prepare requester replies only when a newer requester message needs a direct response.',
        'Do not broaden capabilities or execute writes from persona instructions.',
      ],
      escalation_text: 'Escalate to a human operator when the request is ambiguous, high-impact, or lacks reliable evidence.',
    },
    config_version: 1,
    updated_by_user_id: null,
    metadata_json: {
      product_owned: true,
      phase: 11,
      production_polling_enabled: false,
      production_a4_enabled: false,
    },
    created_at: now,
    updated_at: now,
  }));
  const binding = ticketingBindingFromDefinition(definition);
  const existingTrigger = await triggerRepo.findOne({
    where: {
      tenant_id: context.tenantId,
      agent_definition_id: definition.id,
      trigger_key: HELP_DESK_TICKETING_TRIAGE_MANUAL_TRIGGER_KEY,
    },
  });
  const trigger = existingTrigger ?? await triggerRepo.save(triggerRepo.create({
    tenant_id: context.tenantId,
    agent_definition_id: definition.id,
    trigger_key: HELP_DESK_TICKETING_TRIAGE_MANUAL_TRIGGER_KEY,
    trigger_kind: 'manual',
    status: 'enabled',
    enabled: true,
    trigger_policy_json: {
      safe_target_required: true,
      freeform_live_object_ids: false,
    },
    scope_policy_json: {
      mode: 'manual_safe_target',
      provider_kind: binding.providerKind,
      provider_key: binding.providerKey,
      target_kind: 'ticket',
      allowed_effect: 'read',
    },
    metadata_json: {
      source: 'agent_control_center',
      phase: 11,
    },
    created_at: now,
    updated_at: now,
  }));
  return { definition, trigger };
}

export async function seedTestSreDefinition(
  context: AiExecutionContextWithManager,
  options: { monitoringProviderKey?: string } = {},
): Promise<AiAgentDefinition> {
  const monitoringProviderKey = options.monitoringProviderKey ?? 'mock';
  const adapterRepo = context.manager.getRepository(AiAdapterConfig);
  const existingAdapter = await adapterRepo.findOne({
    where: {
      tenant_id: context.tenantId,
      provider_kind: 'monitoring',
      provider_key: monitoringProviderKey,
    },
  });
  if (!existingAdapter) {
    await adapterRepo.save(adapterRepo.create({
      id: randomUUID(),
      tenant_id: context.tenantId,
      provider_kind: 'monitoring',
      provider_key: monitoringProviderKey,
      implementation: monitoringProviderKey,
      environment: 'sandbox',
      enabled: true,
      credential_ref_json: { kind: 'none' },
      live_test_safety: 'mock_only',
      created_at: new Date(),
      updated_at: new Date(),
    }));
  }
  const defaults = sreAgentDefaults({ monitoringProviderKey });
  const definitionRepo = context.manager.getRepository(AiAgentDefinition);
  const existingDefinition = await definitionRepo.findOne({
    where: { tenant_id: context.tenantId, agent_key: SRE_MONITORING_DIAGNOSIS_AGENT_KEY },
  });
  if (existingDefinition) {
    return existingDefinition;
  }
  const now = new Date();
  return definitionRepo.save(definitionRepo.create({
    tenant_id: context.tenantId,
    agent_key: SRE_MONITORING_DIAGNOSIS_AGENT_KEY,
    name: 'SRE monitoring diagnosis agent',
    description: 'Reads alerts from the bound monitoring provider, correlates them with KANAP knowledge and infrastructure data, and prepares diagnostic findings for review.',
    agent_type: 'sre',
    status: 'draft',
    ...defaults,
    // The test agent correlates alerts with KANAP knowledge: its administrator opened every library.
    scope_policy_json: {
      ...defaults.scope_policy_json,
      knowledge_sources: {
        ...(defaults.scope_policy_json.knowledge_sources as Record<string, unknown>),
        knowledge: { enabled: true, all_libraries: true, library_ids: [] },
      },
    },
    persona_json: {
      mission: 'Diagnose monitoring alerts with supporting KANAP knowledge and infrastructure context, and prepare clear findings for operator review.',
    },
    config_version: 1,
    updated_by_user_id: null,
    metadata_json: {
      product_owned: true,
      phase: 15,
    },
    created_at: now,
    updated_at: now,
  }));
}
