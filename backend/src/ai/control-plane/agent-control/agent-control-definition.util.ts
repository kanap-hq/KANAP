import { isRecord } from '../../../common/object-guards';
import { normalizeMonitoringScopePolicy } from '../agent/monitoring-targeting';
import { normalizeServiceDeskScopePolicy } from '../agent/service-desk-targeting';
import { KANAP_ENTITY_FAMILIES, KanapEntityFamily } from '../capability/ai-capability.registry';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiRun } from '../entities/ai-run.entity';
import { hashStableJson } from '../evidence/ai-evidence.service';
import { ticketActorRoleFromResponsePolicy } from '../providers/provider.types';
import { PLANNER_ASSIGNMENT_ACTION_TYPE, PLANNER_CLASSIFICATION_ACTION_TYPE, PLANNER_PARTICIPANT_ACTION_TYPE, PLANNER_TERMINAL_TRANSITIONS, UUID_RE, numericMetadata, possibleCapabilityCapsForAgentType } from './agent-control-constants.util';
import { stripKnowledgeAccents } from './agent-control-knowledge.util';
import { cleanAgentPriority, metadataObject, trimmedString } from './agent-control-util';
import { PlannerAction } from './ai-agent-action-planner.service';
import { VerbatimCandidate } from './ai-agent-prompt-compiler.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Agent definition normalisation: persona, response policy, scope policy, allowed
 * capabilities, lifecycle transitions, planner action resolution and config diffing.
 *
 * Extracted verbatim from the module-level header of ai-agent-control.service.ts, with the
 * persona length bounds it uses.
 */

export function proposalHash(value: unknown): string {
  return hashStableJson(value);
}

export function readKanapDataBlock(sources: Record<string, unknown>): {
  enabled: boolean;
  domains: Record<KanapEntityFamily, boolean>;
} {
  const kanapData = isRecord(sources.kanap_data) ? sources.kanap_data : {};
  const rawDomains = isRecord(kanapData.domains) ? kanapData.domains : {};
  const domains = {} as Record<KanapEntityFamily, boolean>;
  for (const domain of KANAP_ENTITY_FAMILIES) {
    domains[domain] = rawDomains[domain] !== false;
  }
  return { enabled: kanapData.enabled === true, domains };
}

// Per-agent retrieval-source policy, read from scope_policy_json.knowledge_sources.
// Defaults preserve current behaviour: knowledge ON over all accessible libraries, web OFF,
// KANAP data OFF (see readKanapDataBlock).
export function readAgentKnowledgeSources(definition: AiAgentDefinition | null): {
  knowledgeEnabled: boolean;
  knowledgeLibraryIds: string[] | null; // null = all accessible libraries
  webEnabled: boolean;
  kanapData: { enabled: boolean; domains: Record<KanapEntityFamily, boolean> };
} {
  const scope = isRecord(definition?.scope_policy_json) ? definition.scope_policy_json : {};
  const sources = isRecord(scope.knowledge_sources) ? scope.knowledge_sources : {};
  const knowledge = isRecord(sources.knowledge) ? sources.knowledge : {};
  const web = isRecord(sources.web) ? sources.web : {};
  const allLibraries = knowledge.all_libraries !== false;
  const libraryIds = Array.isArray(knowledge.library_ids)
    ? knowledge.library_ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    : [];
  return {
    knowledgeEnabled: knowledge.enabled !== false,
    knowledgeLibraryIds: allLibraries || libraryIds.length === 0 ? null : libraryIds,
    webEnabled: web.enabled === true,
    kanapData: readKanapDataBlock(sources),
  };
}

// Validate/clamp a knowledge_sources patch at write time. Library ids are UUID-checked and
// de-duplicated here; tenant/ACL safety is additionally enforced at read time by
// KnowledgeService.search (the configured ids are intersected with the agent user's
// accessible libraries, never substituted for them).
export function normalizeKnowledgeSources(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  const knowledge = isRecord(source.knowledge) ? source.knowledge : {};
  const web = isRecord(source.web) ? source.web : {};
  const allLibraries = knowledge.all_libraries !== false;
  const libraryIds = Array.isArray(knowledge.library_ids)
    ? Array.from(new Set(knowledge.library_ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))))
    : [];
  const kanapData = readKanapDataBlock(source);
  return {
    knowledge: {
      enabled: knowledge.enabled !== false,
      all_libraries: allLibraries,
      library_ids: allLibraries ? [] : libraryIds,
    },
    web: { enabled: web.enabled === true },
    kanap_data: { enabled: kanapData.enabled, domains: kanapData.domains },
    precedence: 'knowledge_first',
  };
}

export function addEstimatedUsage(acc: { tokens: number; cost: number }, run: AiRun): void {
  const usage = metadataObject(run.usage_json);
  const cost = metadataObject(run.cost_json);
  acc.tokens += numericMetadata(usage.estimated_tokens ?? usage.total_tokens);
  acc.cost += numericMetadata(cost.estimated_cost_eur ?? cost.total_cost_eur ?? cost.total_cost);
}

export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function withinDateRange(value: Date | string | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

export function cleanSingleLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

export function requireBoundedLine(value: unknown, max: number, overLimitMessage: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length > max) {
    throw new BadRequestException(overLimitMessage);
  }
  return normalized;
}

export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function uniqueBoundsApplied(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function cleanAgentKey(value: unknown): string {
  const key = cleanSingleLine(value, 120);
  if (!key || !/^[a-z0-9][a-z0-9._:-]*$/.test(key) || key.includes('*')) {
    throw new BadRequestException('Agent key must be lowercase letters, numbers, dots, underscores, colons, or hyphens.');
  }
  return key;
}

export function slugAgentKey(value: string): string {
  const slug = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
  return slug || 'agent';
}

export function cleanAgentType(value: unknown): string {
  const candidate = cleanSingleLine(value, 40) ?? 'custom';
  if (!['helpdesk', 'sre', 'software_dev', 'code_review', 'custom'].includes(candidate)) {
    throw new BadRequestException('Unsupported agent type.');
  }
  return candidate;
}

export function cleanAgentEnvironment(value: unknown): string {
  const candidate = cleanSingleLine(value, 40) ?? 'sandbox';
  if (!['production', 'staging', 'sandbox', 'lab', 'mock'].includes(candidate)) {
    throw new BadRequestException('Unsupported agent environment.');
  }
  return candidate;
}

export function cleanAgentStatus(value: unknown): string {
  const candidate = cleanSingleLine(value, 40);
  if (!candidate || !['draft', 'enabled', 'disabled', 'archived'].includes(candidate)) {
    throw new BadRequestException('Unsupported agent status.');
  }
  return candidate;
}

export function normalizedPolicyObject(value: unknown, label: string): Record<string, unknown> | null {
  if (value == null) return null;
  if (!isRecord(value)) {
    throw new BadRequestException(`${label} must be an object.`);
  }
  return value;
}

export const MAX_PERSONA_MISSION_CHARS = 500;
export const MAX_PERSONA_TONE_CHARS = 300;
export const MAX_PERSONA_ESCALATION_CHARS = 500;
// The ONE user-facing instructions limit: total characters across all
// paragraphs. Chosen so a maxed-out persona plus a full shared-context
// profile stays under the compiler's 40 000-char guidance budget — the cap
// maps to real prompt truncation, not to an internal convention. Per-line
// length and line count are deliberately unbounded.
export const MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS = 10_000;

export function normalizePersona(value: unknown, fallback: Record<string, unknown> | null = null): Record<string, unknown> | null {
  if (value == null) return fallback;
  if (!isRecord(value)) {
    throw new BadRequestException('Persona must be a structured object.');
  }
  const base = isRecord(fallback) ? { ...fallback } : {};
  delete base.tone;
  delete base.escalation_text;
  delete base.escalationText;
  const missionProvided = hasOwn(value, 'mission');
  const mission = requireBoundedLine(
    value.mission,
    MAX_PERSONA_MISSION_CHARS,
    'Purpose must be at most 500 characters.',
  );
  const outputStyleInput = isRecord(value.output_style) ? value.output_style : {};
  const fallbackOutputStyle = isRecord(base.output_style) ? base.output_style : {};
  const toneProvided = hasOwn(outputStyleInput, 'tone') || hasOwn(value, 'tone');
  // Strict validation applies to client input only. Stored values pass through
  // untouched: a row written out-of-band must never brick every later save
  // with an error about a field the UI no longer shows.
  const tone = toneProvided
    ? requireBoundedLine(
      outputStyleInput.tone ?? value.tone,
      MAX_PERSONA_TONE_CHARS,
      'Reply tone must be at most 300 characters.',
    )
    : (typeof fallbackOutputStyle.tone === 'string' && fallbackOutputStyle.tone.trim() ? fallbackOutputStyle.tone : null);
  const language = cleanSingleLine(outputStyleInput.language ?? fallbackOutputStyle.language, 24);
  if (language && language !== 'auto' && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(language)) {
    throw new BadRequestException('Unsupported output style language.');
  }
  const outputStyle = {
    ...(tone ? { tone } : {}),
    ...(language ? { language } : {}),
  };
  const escalationProvided = hasOwn(value, 'escalation_guidance')
    || hasOwn(value, 'escalation_text')
    || hasOwn(value, 'escalationText');
  const escalationGuidance = escalationProvided
    ? requireBoundedLine(
      value.escalation_guidance ?? value.escalation_text ?? value.escalationText,
      MAX_PERSONA_ESCALATION_CHARS,
      'Escalation guidance must be at most 500 characters.',
    )
    : (typeof base.escalation_guidance === 'string' && base.escalation_guidance.trim() ? base.escalation_guidance : null);
  const instructionsSource = hasOwn(value, 'instructions')
    ? value.instructions
    : base.instructions;
  const instructions = Array.isArray(instructionsSource)
    ? instructionsSource
      .map((entry) => (typeof entry === 'string' ? entry.replace(/\s+/g, ' ').trim() : ''))
      .filter((entry) => entry.length > 0)
    : [];
  const instructionsChars = instructions.reduce((total, entry) => total + entry.length, 0);
  if (instructionsChars > MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS) {
    throw new BadRequestException('Instructions are limited to 10 000 characters in total.');
  }
  const sharedContextInput = hasOwn(value, 'shared_context')
    ? value.shared_context
    : base.shared_context;
  const sharedContextRecord = isRecord(sharedContextInput) ? sharedContextInput : {};
  const sharedContextEnabled = sharedContextRecord.enabled === true;
  const sharedContextProfileId = cleanSingleLine(sharedContextRecord.profile_id, 80);
  if (sharedContextProfileId && !UUID_RE.test(sharedContextProfileId)) {
    throw new BadRequestException('Shared context profile id must be a UUID.');
  }
  const sharedContext = sharedContextEnabled || sharedContextProfileId
    ? {
      enabled: sharedContextEnabled,
      profile_id: sharedContextProfileId ?? null,
    }
    : null;
  const persona: Record<string, unknown> = {
    ...base,
    instructions,
    ...(sharedContext ? { shared_context: sharedContext } : {}),
  };
  if (missionProvided) {
    if (mission) persona.mission = mission;
    else delete persona.mission;
  } else if (mission) {
    persona.mission = mission;
  }
  if (Object.keys(outputStyle).length > 0) persona.output_style = outputStyle;
  else delete persona.output_style;
  if (escalationProvided) {
    if (escalationGuidance) persona.escalation_guidance = escalationGuidance;
    else delete persona.escalation_guidance;
  } else if (escalationGuidance) {
    persona.escalation_guidance = escalationGuidance;
  }
  if (!sharedContext) delete persona.shared_context;
  return Object.keys(persona).length > 0 ? persona : null;
}

export function normalizeResponsePolicyForConfig(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!value) return null;
  return {
    ...value,
    ticket_actor_role: ticketActorRoleFromResponsePolicy(value),
    automatic_public_reply: false,
    automatic_ticket_updates: false,
    require_human_approval_for_writes: true,
  };
}

export function autonomyLevelRank(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^A([0-6])$/);
  return match ? Number(match[1]) : null;
}

export function capabilityNameFromEntry(entry: unknown): string | null {
  if (typeof entry === 'string') return trimmedString(entry);
  if (isRecord(entry)) return trimmedString(entry.name);
  return null;
}

export function normalizeAllowedCapabilitiesForConfig(value: unknown, agentType: unknown): Record<string, unknown>[] | null {
  if (value == null) return null;
  const possibleCaps = possibleCapabilityCapsForAgentType(agentType);
  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.capabilities)
      ? value.capabilities
      : null;
  if (!entries) {
    throw new BadRequestException('Allowed capabilities must be an array or object with a capabilities array.');
  }
  const normalized: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = capabilityNameFromEntry(entry);
    if (!name) {
      throw new BadRequestException('Every capability entry requires a name.');
    }
    const maxCap = possibleCaps.get(name);
    if (!maxCap) {
      throw new ForbiddenException(`Capability ${name} is not available for this agent type.`);
    }
    const requestedLevel = isRecord(entry) && typeof entry.max_autonomy_level === 'string'
      ? entry.max_autonomy_level
      : maxCap;
    const requestedRank = autonomyLevelRank(requestedLevel);
    const maxRank = autonomyLevelRank(maxCap);
    if (requestedRank === null || maxRank === null || requestedRank > maxRank) {
      throw new ForbiddenException(`Capability ${name} cannot exceed ${maxCap}.`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      normalized.push({
        ...(isRecord(entry) ? entry : {}),
        name,
        version: isRecord(entry) && typeof entry.version === 'string' ? entry.version : '1.0.0',
        max_autonomy_level: requestedLevel,
      });
    }
  }
  return normalized;
}

// Scope-policy normalization is agent-type aware: SRE definitions carry
// monitoring targeting predicates (severity/ack_state/age_minutes, group refs)
// that the service-desk normalizer rejects, and vice versa. Both normalizers
// preserve every sibling scope key (knowledge_sources, ingestion, mode blocks)
// verbatim and only rebuild the targeting block.
export function normalizeScopePolicyForAgentType(agentType: unknown, scopePolicy: unknown): Record<string, unknown> | null {
  return agentType === 'sre'
    ? normalizeMonitoringScopePolicy(scopePolicy)
    : normalizeServiceDeskScopePolicy(scopePolicy);
}

export function definitionAllowsCapability(definition: AiAgentDefinition, capabilityName: string): boolean {
  const capabilities = Array.isArray(definition.allowed_capabilities_json)
    ? definition.allowed_capabilities_json
    : isRecord(definition.allowed_capabilities_json) && Array.isArray(definition.allowed_capabilities_json.capabilities)
      ? definition.allowed_capabilities_json.capabilities
      : [];
  return capabilities.some((entry) => {
    if (typeof entry === 'string') return entry === capabilityName;
    return isRecord(entry) && entry.name === capabilityName;
  });
}

export function allowedCapabilityNames(definition: AiAgentDefinition | null): string[] {
  if (!definition) return [];
  const capabilities = Array.isArray(definition.allowed_capabilities_json)
    ? definition.allowed_capabilities_json
    : isRecord(definition.allowed_capabilities_json) && Array.isArray(definition.allowed_capabilities_json.capabilities)
      ? definition.allowed_capabilities_json.capabilities
      : [];
  return capabilities
    .map(capabilityNameFromEntry)
    .filter((entry): entry is string => !!entry);
}

export function lifecycleAllowedTransitions(lifecycle: Record<string, unknown> | null): Record<string, unknown>[] {
  return Array.isArray(lifecycle?.allowedTransitions)
    ? lifecycle.allowedTransitions.filter(isRecord)
    : [];
}

export function lifecycleTransitionKey(transition: Record<string, unknown> | null | undefined): string | null {
  return typeof transition?.key === 'string' && transition.key.trim().length > 0
    ? transition.key.trim()
    : null;
}

export function normalizePlannerStatusTransitionKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const compact = stripKnowledgeAccents(raw)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const aliases: Record<string, string> = {
    close: 'closed',
    closing: 'closed',
    closed: 'closed',
    closeticket: 'closed',
    ferme: 'closed',
    fermer: 'closed',
    cloture: 'closed',
    cloturer: 'closed',
    clotureticket: 'closed',
    solve: 'solved',
    solved: 'solved',
    resolve: 'resolved',
    resolved: 'resolved',
    resoudre: 'resolved',
    resolu: 'resolved',
    pending: 'pending',
    wait: 'pending',
    waiting: 'pending',
    attente: 'pending',
    pendinguser: 'pending_user',
    processingassigned: 'processing_assigned',
    processingplanned: 'processing_planned',
    escalatedl2: 'escalated_l2',
  };
  return aliases[compact] ?? raw.toLocaleLowerCase().replace(/\s+/g, '_');
}

export function lifecycleTransitionByKey(lifecycle: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const normalizedKey = normalizePlannerStatusTransitionKey(key);
  if (!normalizedKey) return null;
  return lifecycleAllowedTransitions(lifecycle).find((transition) => lifecycleTransitionKey(transition) === normalizedKey) ?? null;
}

export function lifecycleTransitionIsTerminal(transition: Record<string, unknown> | null | undefined): boolean {
  return transition?.terminal === true;
}

export function preferredTerminalLifecycleTransition(lifecycle: Record<string, unknown> | null): Record<string, unknown> | null {
  const transitions = lifecycleAllowedTransitions(lifecycle);
  return transitions.find(lifecycleTransitionIsTerminal)
    ?? transitions.find((transition) => lifecycleTransitionKey(transition) === 'solved')
    ?? transitions.find((transition) => lifecycleTransitionKey(transition) === 'closed')
    ?? transitions.find((transition) => lifecycleTransitionKey(transition) === 'resolved')
    ?? transitions.find((transition) => {
      const key = lifecycleTransitionKey(transition);
      return !!key && PLANNER_TERMINAL_TRANSITIONS.has(key);
    })
    ?? null;
}

export function plannerStatusTransitionIsTerminal(key: string | null): boolean {
  return !!key && PLANNER_TERMINAL_TRANSITIONS.has(key);
}

export function resolvePlannerStatusTransition(
  lifecycle: Record<string, unknown> | null,
  action: PlannerAction,
  closeEligible: boolean,
): { transition: Record<string, unknown> | null; key: string | null; resolution: string | null } {
  const normalizedKey = normalizePlannerStatusTransitionKey(action.transition_key);
  if (!normalizedKey) {
    return { transition: null, key: null, resolution: null };
  }
  const directTransition = lifecycleTransitionByKey(lifecycle, normalizedKey);
  const directKey = lifecycleTransitionKey(directTransition);
  if (directTransition && directKey) {
    return {
      transition: directTransition,
      key: directKey,
      resolution: directKey === action.transition_key ? null : 'transition_key_normalized',
    };
  }
  if (closeEligible && plannerStatusTransitionIsTerminal(normalizedKey)) {
    const terminalTransition = preferredTerminalLifecycleTransition(lifecycle);
    const terminalKey = lifecycleTransitionKey(terminalTransition);
    if (terminalTransition && terminalKey) {
      return {
        transition: terminalTransition,
        key: terminalKey,
        resolution: 'terminal_transition_substituted',
      };
    }
  }
  return { transition: null, key: normalizedKey, resolution: null };
}

export function plannerActionKindKey(action: PlannerAction): string {
  if (action.action_type === PLANNER_CLASSIFICATION_ACTION_TYPE) return `${action.action_type}:${proposalHash(action.proposed ?? {})}`;
  if (action.action_type === 'requester_reply') {
    return `${action.action_type}:${action.reply_kind ?? 'unspecified'}:${action.administrative_intent ?? 'none'}:${action.verbatim_ref ?? 'draft'}`;
  }
  if (action.action_type === 'status_update') {
    return `${action.action_type}:${action.transition_key ?? 'unspecified'}`;
  }
  if (action.action_type === PLANNER_ASSIGNMENT_ACTION_TYPE) {
    return `${action.action_type}:${action.target?.kind ?? 'unspecified'}:${action.target?.key ?? 'unspecified'}`;
  }
  if (action.action_type === PLANNER_PARTICIPANT_ACTION_TYPE) {
    const participant = Array.isArray(action.participants) && action.participants.length > 0
      ? action.participants[0]
      : action.target ?? null;
    return `${action.action_type}:${action.operation ?? 'add_observer'}:${participant?.kind ?? 'unspecified'}:${participant?.key ?? 'unspecified'}`;
  }
  return action.action_type;
}

// Resolves a planner assignment target against the provider routing catalogue. The label
// always comes from the catalogue: the model may only pick, never name.
export function resolvePlannerAssignmentTarget(
  routing: Record<string, unknown> | null,
  action: PlannerAction,
): { target: { kind: 'user' | 'group'; key: string; label: string } | null; reason: string | null } {
  const key = typeof action.target?.key === 'string' ? action.target.key.trim() : '';
  const label = typeof action.target?.label === 'string' ? action.target.label.trim().toLowerCase() : '';
  if (!key && !label) {
    return { target: null, reason: 'missing_assignment_target' };
  }
  if (!routing || routing.assignmentSupported !== true) {
    return { target: null, reason: 'assignment_not_supported_by_provider' };
  }
  const catalogue = Array.isArray(routing.supportedAssignmentTargets) ? routing.supportedAssignmentTargets.filter(isRecord) : [];
  const sameKind = catalogue.filter((candidate) => candidate.kind === action.target?.kind && typeof candidate.key === 'string' && typeof candidate.label === 'string');
  let match = sameKind.find((candidate) => key && candidate.key === key);
  if (!match && label) {
    const labelMatches = sameKind.filter((candidate) => String(candidate.label).trim().toLowerCase() === label);
    if (labelMatches.length > 1) {
      return { target: null, reason: 'assignment_target_ambiguous' };
    }
    match = labelMatches[0];
  }
  if (!match || (match.kind !== 'group' && match.kind !== 'user')) {
    return { target: null, reason: 'assignment_target_not_in_routing_catalogue' };
  }
  // Already-present check is per kind: a group write compares groups, a technician write
  // compares the technicians already on the ticket.
  const assignedRaw = match.kind === 'group' ? routing.assignedGroups : routing.assignedUsers;
  const assigned = Array.isArray(assignedRaw) ? assignedRaw.filter(isRecord) : [];
  if (assigned.some((entry) => String(entry.key ?? '') === String(match.key))) {
    return { target: null, reason: 'assignment_target_already_present' };
  }
  return { target: { kind: match.kind, key: String(match.key), label: String(match.label) }, reason: null };
}

// Resolves one observer add against the routing catalogue. The label always comes from
// the catalogue. remove_observer and set_observers are refused in words by the provider;
// the planner skips them before a proposal exists. An observer already listed is refused.
export function resolvePlannerObserverTarget(
  routing: Record<string, unknown> | null,
  participants: Record<string, unknown> | null,
  action: PlannerAction,
): { target: { kind: 'user' | 'group'; key: string; label: string } | null; reason: string | null } {
  if (action.operation && action.operation !== 'add_observer') {
    return { target: null, reason: 'participant_operation_not_supported' };
  }
  if (Array.isArray(action.participants) && action.participants.length > 1) {
    return { target: null, reason: 'one_observer_per_proposal' };
  }
  const requested = Array.isArray(action.participants) && action.participants.length === 1
    ? action.participants[0]
    : action.target ?? null;
  const key = typeof requested?.key === 'string' ? requested.key.trim() : '';
  const label = typeof requested?.label === 'string' ? requested.label.trim().toLowerCase() : '';
  if (!key && !label) {
    return { target: null, reason: 'missing_observer_target' };
  }
  if (!participants || participants.participantUpdatesSupported !== true) {
    return { target: null, reason: 'participant_updates_not_supported' };
  }
  if (!routing || routing.assignmentSupported !== true) {
    return { target: null, reason: 'observer_target_not_in_routing_catalogue' };
  }
  const catalogue = Array.isArray(routing.supportedAssignmentTargets) ? routing.supportedAssignmentTargets.filter(isRecord) : [];
  const sameKind = catalogue.filter((candidate) => candidate.kind === requested?.kind && typeof candidate.key === 'string' && typeof candidate.label === 'string');
  let match = sameKind.find((candidate) => key && candidate.key === key);
  if (!match && label) {
    const labelMatches = sameKind.filter((candidate) => String(candidate.label).trim().toLowerCase() === label);
    if (labelMatches.length > 1) {
      return { target: null, reason: 'observer_target_ambiguous' };
    }
    match = labelMatches[0];
  }
  if (!match || (match.kind !== 'group' && match.kind !== 'user')) {
    return { target: null, reason: 'observer_target_not_in_routing_catalogue' };
  }
  const observerTargets = Array.isArray(participants.observerTargets) ? participants.observerTargets.filter(isRecord) : null;
  if (observerTargets) {
    if (observerTargets.some((entry) => entry.kind === match.kind && String(entry.key ?? '') === String(match.key))) {
      return { target: null, reason: 'observer_already_present' };
    }
  } else if (Array.isArray(participants.observers)) {
    const wanted = String(match.label).trim().toLowerCase();
    if (participants.observers.some((entry) => String(entry).trim().toLowerCase() === wanted)) {
      return { target: null, reason: 'observer_already_present' };
    }
  }
  return { target: { kind: match.kind, key: String(match.key), label: String(match.label) }, reason: null };
}

// Resolve the planner's verbatim_ref against the trusted candidate set. Tolerant of an
// LLM that fumbles the ref token: falls back to a case-insensitive ref match, then to
// normalized-text equality (the natural failure mode is the model echoing the message
// text instead of the ref). Still strictly bounded to configured candidates — no ticket
// text can leak in, so the verbatim guarantee holds.
export function resolveVerbatimCandidate(candidates: VerbatimCandidate[], ref: string): VerbatimCandidate | null {
  const exact = candidates.find((candidate) => candidate.ref === ref);
  if (exact) return exact;
  const wanted = ref.trim().toLocaleLowerCase();
  const byRefInsensitive = candidates.find((candidate) => candidate.ref.toLocaleLowerCase() === wanted);
  if (byRefInsensitive) return byRefInsensitive;
  // Tolerate a corrupted ref token (e.g. "verbatim_1-xyz" or a stale hash suffix): match by
  // the leading verbatim index. This is still strictly an index into the trusted candidate
  // set, so no ticket text can resolve here.
  const indexMatch = wanted.match(/^verbatim[_-]?(\d+)/);
  if (indexMatch) {
    const candidate = candidates[Number(indexMatch[1]) - 1];
    if (candidate) return candidate;
  }
  // Last resort: the model echoed the message text instead of the ref.
  const wantedText = ref.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return candidates.find((candidate) => candidate.normalized.toLocaleLowerCase() === wantedText) ?? null;
}

export function plannerActionKey(action: PlannerAction, guidanceHashValue: string): string {
  return proposalHash({
    action_type: action.action_type,
    kind: plannerActionKindKey(action),
    guidance_hash: guidanceHashValue,
  });
}

export function configSnapshot(definition: AiAgentDefinition): Record<string, unknown> {
  return {
    name: definition.name,
    description: definition.description,
    status: definition.status,
    environment: definition.environment,
    agent_priority: cleanAgentPriority(definition.agent_priority),
    persona_json: definition.persona_json ?? null,
    trigger_policy_json: definition.trigger_policy_json,
    scope_policy_json: definition.scope_policy_json,
    queue_policy_json: definition.queue_policy_json,
    response_policy_json: definition.response_policy_json,
    evaluation_policy_json: definition.evaluation_policy_json,
    llm_model_config_id: definition.llm_model_config_id ?? null,
    config_version: definition.config_version ?? 1,
  };
}

export function changedConfigDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))) {
    if (hashStableJson(before[key]) !== hashStableJson(after[key])) {
      diff[key] = { before: before[key] ?? null, after: after[key] ?? null };
    }
  }
  return diff;
}

export function autonomyThresholds(definition: AiAgentDefinition) {
  const evaluation = metadataObject(definition.evaluation_policy_json);
  const earned = metadataObject(evaluation.earned_autonomy);
  return {
    minimumDecided: Math.max(1, numericMetadata(earned.minimum_decided_count) || 20),
    minimumAcceptanceRate: Math.max(0, Math.min(1, numericMetadata(earned.minimum_acceptance_rate) || 0.7)),
    minimumObservationDays: Math.max(0, numericMetadata(earned.minimum_observation_days) || 28),
  };
}
