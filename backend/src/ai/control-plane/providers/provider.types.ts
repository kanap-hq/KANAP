import { AiExecutionContextWithManager } from '../../ai.types';
import {
  MONITORING_ACK_STATES,
  MONITORING_ALERT_STATUS_VALUES,
  MONITORING_SEVERITY_VALUES,
} from './provider-constants';

export type ProviderKind =
  | 'ticketing'
  | 'monitoring'
  // Inventory sources (Netbox) reuse ai_adapter_configs for their connection
  // and encrypted credential; they have no control-plane provider adapter.
  | 'inventory'
  | 'virtualization'
  | 'directory'
  | 'communication'
  | 'automation'
  | 'kanap_domain';

export type ProviderEnvironment = 'production' | 'staging' | 'sandbox' | 'lab' | 'mock';

export type ProviderCredentialRef =
  | { kind: 'none' }
  | { kind: 'secret_ref'; ref: string; version?: string | null; tenant_id?: string | null }
  | { kind: 'environment'; ref: string; tenant_id?: string | null }
  // Tenant-scoped AES-256-GCM envelope written by the admin integrations
  // endpoints via AiSecretCipherService. `material_shape` is a decrypt-free
  // presence hint for admin reads (e.g. 'api_token' | 'username_passhash') —
  // it never contains material.
  | { kind: 'encrypted'; ciphertext: string; material_shape?: string | null };

export type AdapterErrorCode =
  | 'not_configured'
  | 'disabled'
  | 'malformed_config'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'timeout'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'missing_credentials'
  | 'unsupported_provider_version'
  | 'unsafe_operation'
  | 'unknown';

export type AdapterEvidenceSeed = {
  sourceProvider: string;
  sourceType: string;
  sourceId?: string | null;
  sourceUri?: string | null;
  collectedAt: string;
  trustLevel: 'system' | 'customer_system' | 'external' | 'user_supplied' | 'model_generated';
  summary: string;
  redactedPayload?: unknown;
  rawPayloadRetention?: 'none' | 'redacted' | 'encrypted_debug';
};

export type AdapterResult<T> =
  | {
      ok: true;
      data: T;
      evidence: AdapterEvidenceSeed[];
      providerRequestId?: string | null;
      warnings?: string[];
    }
  | {
      ok: false;
      errorCode: AdapterErrorCode;
      message: string;
      retryable: boolean;
      providerRequestId?: string | null;
      evidence?: AdapterEvidenceSeed[];
    };

export type AdapterHealthResult = {
  ok: boolean;
  providerKind: ProviderKind;
  providerKey: string;
  implementation?: string | null;
  environment?: ProviderEnvironment | string | null;
  checkedAt: string;
  errorCode?: AdapterErrorCode;
  message?: string;
  retryable?: boolean;
  warnings?: string[];
};

export type CapabilityApplicability = {
  available: boolean;
  reasonCode?:
    | 'provider_not_configured'
    | 'provider_disabled'
    | 'missing_credentials'
    | 'missing_permission'
    | 'unsupported_provider_version'
    | 'unsafe_environment'
    | 'policy_disabled'
    | 'emergency_paused'
    | 'malformed_config';
  message?: string;
};

export type ProviderRuntimeCredential = {
  hasSecret(): boolean;
  reveal(): string;
  toJSON(): unknown;
};

export type ProviderAdapterRuntime = {
  providerKind: ProviderKind;
  providerKey: string;
  implementation: string;
  environment: string;
  baseUrl: string | null;
  credential: ProviderRuntimeCredential | null;
  configMetadata: Record<string, unknown> | null;
  // Operator-tuned request timeout (ai_adapter_configs.timeout_seconds);
  // null means the provider's built-in default.
  timeoutSeconds: number | null;
};

export type ProviderContext = AiExecutionContextWithManager & {
  adapterRuntime?: ProviderAdapterRuntime | null;
};

export type TicketRecord = {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  urgency?: string | null;
  type?: string | null;
  requesterId?: string | null;
  requester?: string | null;
  description?: string | null;
  descriptionHtml?: string | null;
  sourceUri?: string | null;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  scope?: {
    entityId?: string | null;
    categoryId?: string | null;
  } | null;
  attachments?: TicketAttachmentRef[];
};

export type TicketAttachmentRef = {
  id: string | null;
  kind: 'image' | 'file';
  source: 'ticket_description' | 'ticket_note';
  sourceNoteId?: string | null;
  target: string;
  sourceUri?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  altText?: string | null;
};

export type TicketAttachmentReadResult = {
  attachment: TicketAttachmentRef;
  filename: string | null;
  mimeType: string;
  sizeBytes: number;
  base64Data: string;
};

export type RefItem = {
  value: string;
  label: string;
  metadata?: Record<string, unknown>;
};

export type TicketReferenceEnums = {
  statuses: RefItem[];
  priorities: RefItem[];
  types: RefItem[];
};

export type TicketReferenceCatalogKind = 'category' | 'entity' | 'group' | 'technician';

export type TicketListScope =
  | {
      mode: 'new_tickets_only';
      createdAfter: string;
      maxResults: number;
      statusValues?: string[];
      entityId?: string | null;
      categoryId?: string | null;
      // Full allowed id sets (root first, then descendants) when the selection is
      // recursive. When present they supersede exact-id matching on entityId/categoryId;
      // when absent the scope stays exact-match for backward compatibility.
      entityIds?: string[] | null;
      categoryIds?: string[] | null;
    }
  | {
      // All currently-open tickets (provider-defined non-terminal statuses), bounded by
      // per-cycle caps and an optional last-changed window. Oldest-changed first so a
      // cleanup agent sees the stalest tickets. `agent_involved` selection is NOT a
      // provider mode — it is resolved in the control-plane layer from agent-touched
      // target states, then fetched per id.
      mode: 'all_open';
      maxResults: number;
      statusValues?: string[];
      entityId?: string | null;
      categoryId?: string | null;
      entityIds?: string[] | null;
      categoryIds?: string[] | null;
      lastChangedBefore?: string | null;
      lastChangedAfter?: string | null;
    };

export type TicketNote = {
  id: string;
  visibility: 'public' | 'internal';
  authorId?: string | null;
  author?: string | null;
  authorRole?: 'requester' | 'support' | 'kanap_agent' | 'unknown';
  body: string;
  bodyHtml?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  updateFingerprint?: string | null;
  attachments?: TicketAttachmentRef[];
};

export type TicketUserAssociation = {
  id: string;
  userId: string;
  label?: string | null;
  role: 'requester' | 'assigned' | 'observer' | 'unknown';
};

export type SimilarTicket = {
  id: string;
  title: string;
  status: string;
  similarity: number;
  resolutionSummary?: string | null;
};

export type TicketClassificationContext = {
  ticketId: string;
  category?: string | null;
  categoryKey?: string | null;
  classificationSupported?: boolean;
  categoryCatalogTruncated?: boolean;
  options?: {
    types: Array<{ key: string; label: string }>;
    priorities: Array<{ key: string; label: string }>;
    categories: Array<{ key: string; label: string }>;
  };
  service?: string | null;
  type?: string | null;
  priority?: string | null;
  impact?: string | null;
  urgency?: string | null;
  supported: boolean;
  warnings?: string[];
};

export type TicketLifecycleTransition = {
  key: string;
  label: string;
  requiresApproval: boolean;
  destructive: boolean;
  terminal: boolean;
};

export type TicketLifecycleContext = {
  ticketId: string;
  status: string | null;
  statusLabel?: string | null;
  terminal: boolean;
  allowedTransitions: TicketLifecycleTransition[];
  updatedAt?: string | null;
  supported: boolean;
  warnings?: string[];
};

export type TicketRoutingTarget = {
  kind: 'user' | 'group';
  key: string;
  label: string;
};

export type TicketRoutingContext = {
  ticketId: string;
  requester?: string | null;
  assignee?: string | null;
  group?: string | null;
  // Everything currently assigned on the ticket, with keys, so the planner can avoid
  // re-proposing a present target and the pre-write drift check can compare groups.
  assignedUsers?: TicketRoutingTarget[];
  assignedGroups?: TicketRoutingTarget[];
  // Catalogue of targets the agent may route to. Instruction-driven: the persona names
  // the group, the planner picks the matching key from this list.
  supportedAssignmentTargets: TicketRoutingTarget[];
  // Provider key of the agent's OWN account, when the provider knows it. The agent may
  // self-register as an assignee on an earlier phase of the same approved batch; the
  // pre-write drift check excludes this key so that does not look like a human reroute.
  agentUserKey?: string | null;
  assignmentSupported: boolean;
  supported: boolean;
  warnings?: string[];
};

export type TicketParticipantContext = {
  ticketId: string;
  requester?: string | null;
  // Display names of the current observers. `observerTargets` carries the same
  // people and groups with catalogue keys, so a proposal can skip one already listed.
  observers: string[];
  observerTargets?: TicketRoutingTarget[];
  watchers: string[];
  viewers: string[];
  participantUpdatesSupported: boolean;
  supported: boolean;
  warnings?: string[];
};

export type TicketClassificationUpdateProposal = {
  type?: string | null;
  priority?: string | null;
  urgency?: string | null;
  impact?: string | null;
  category?: string | null;
  service?: string | null;
};

export type TicketClassificationUpdateActionPayload = {
  ticketId: string;
  action: 'classification_update';
  current: TicketClassificationContext;
  // Input category is a catalogue key; the prepared payload carries its display label.
  proposed: TicketClassificationUpdateProposal & { categoryKey?: string };
  providerFields?: Record<string, unknown>;
  reason: string;
};

export type TicketStatusUpdateActionPayload = {
  ticketId: string;
  action: 'status_update';
  current: TicketLifecycleContext;
  transitionKey: string;
  targetStatus: string;
  targetStatusLabel?: string | null;
  // Terminal (solve/close) transitions are destructive cleanup actions that must
  // always be human-approved and surfaced distinctly in approvals/audit.
  terminal: boolean;
  providerFields?: Record<string, unknown>;
  reason: string;
};

export type TicketAssignmentUpdateActionPayload = {
  ticketId: string;
  action: 'assignment_update';
  current: TicketRoutingContext;
  target: TicketRoutingTarget;
  providerFields?: Record<string, unknown>;
  reason: string;
};

export type TicketParticipantUpdateOperation =
  | 'add_observer'
  | 'remove_observer'
  | 'set_observers';

export type TicketParticipantUpdateActionPayload = {
  ticketId: string;
  action: 'participant_update';
  current: TicketParticipantContext;
  operation: TicketParticipantUpdateOperation;
  participants: TicketRoutingTarget[];
  providerFields?: Record<string, unknown>;
  reason: string;
};

export type TicketProviderActionPrepared<TActionPayload> = {
  actionPayload: TActionPayload;
  summary: string;
};

export type TicketProviderActionWriteResult = {
  ticketId: string;
  summary: string;
  idempotencyKey: string;
  updatedFields: string[];
  alreadyApplied?: boolean;
};

// How the agent registers its own provider user on a ticket it writes to.
// 'assignee' = takes the ticket on public replies (observer on internal notes),
// 'observer' = follows the ticket only, 'none' = never appears among the ticket actors.
export const TICKET_ACTOR_ROLES = ['assignee', 'observer', 'none'] as const;
export type TicketActorRole = (typeof TICKET_ACTOR_ROLES)[number];
export const DEFAULT_TICKET_ACTOR_ROLE: TicketActorRole = 'assignee';

export function ticketActorRoleFromResponsePolicy(policy: unknown): TicketActorRole {
  const value = policy && typeof policy === 'object'
    ? (policy as Record<string, unknown>).ticket_actor_role
    : undefined;
  return (TICKET_ACTOR_ROLES as readonly string[]).includes(String(value))
    ? (value as TicketActorRole)
    : DEFAULT_TICKET_ACTOR_ROLE;
}

export type TicketWriteOptions = {
  agentActorRole?: TicketActorRole;
};

export type TicketInternalNoteActionPayload = {
  ticketId: string;
  visibility: 'internal';
  body: string;
  bodyFormat: 'plain_text';
};

export type TicketPublicReplyActionPayload = {
  ticketId: string;
  visibility: 'public';
  body: string;
  bodyFormat: 'plain_text';
};

export type TicketInternalNotePrepared = {
  actionPayload: TicketInternalNoteActionPayload;
  summary: string;
};

export type TicketPublicReplyPrepared = {
  actionPayload: TicketPublicReplyActionPayload;
  summary: string;
};

export type TicketInternalNoteWriteResult = {
  noteId: string;
  ticketId: string;
  summary: string;
  idempotencyKey: string;
  alreadyApplied?: boolean;
};

export type TicketPublicReplyWriteResult = {
  noteId: string;
  ticketId: string;
  summary: string;
  idempotencyKey: string;
  alreadyApplied?: boolean;
};

// Normalized monitoring vocabularies. Derived from the canonical value lists
// in provider-constants.ts so the type unions and runtime vocabularies cannot
// drift apart. Adapters translate native codes to these keys — raw provider
// status/priority codes never leave the adapter layer.
export type MonitoringAlertStatus = (typeof MONITORING_ALERT_STATUS_VALUES)[number];
export type MonitoringSeverity = (typeof MONITORING_SEVERITY_VALUES)[number];
export type MonitoringAckState = (typeof MONITORING_ACK_STATES)[number];

// The failing object's shape in the provider's model: a `check` is a single
// probe/sensor/service check, a `device`/`host` is the monitored machine, a
// `group` is an aggregation node. Providers without a distinct device object
// (host-centric tools) use `host` for the machine-level object.
export type MonitoringObjectKind = 'check' | 'device' | 'group' | 'host';

export type MonitoringAlert = {
  // Provider object id of the failing check. An alert IS a check in a non-up
  // state; an occurrence is identified by (id, occurrenceStartedAt).
  id: string;
  status: MonitoringAlertStatus;
  severity: MonitoringSeverity;
  ackState: MonitoringAckState;
  // Untrusted provider text (last message from the tool) — external evidence,
  // never instructions.
  message: string;
  sensorId: string;
  vmId?: string | null;
  relatedTicketId?: string | null;
  observedAt: string;
  // When the current occurrence started (transition into the non-up state);
  // null when the provider does not expose it. A clear-then-refire yields a
  // new occurrenceStartedAt and therefore a new occurrence.
  occurrenceStartedAt: string | null;
  lastCheckedAt: string | null;
  // Display string of the last measured value, already unit-formatted by the
  // provider; null when the check has no value (e.g. hard down).
  lastValue: string | null;
  objectKind: MonitoringObjectKind;
  deviceName: string | null;
  // Human-readable display name of the failing check itself (e.g. a sensor
  // label like "HTTP" or "Disk Free") — untrusted provider text, display only.
  // Optional: adapters attach it when the provider exposes one.
  checkName?: string | null;
  // Human-readable ancestor path (root first); ids live in the reference
  // catalog, not here.
  groupPath: string[] | null;
  // Optional provider reference ids matching the reference-catalog values the
  // targeting UI pickers store (group/device/check_type predicates). Adapters
  // attach them when the underlying rows expose them; the control-plane
  // targeting matcher verifies ref-id predicates against these and only falls
  // back to name-based fields when they are absent. deviceId also feeds the
  // monitored-object read for the KANAP asset IP tiebreak.
  groupId?: string | null;
  deviceId?: string | null;
  checkTypeId?: string | null;
  // Deep link into the monitoring tool — same load-bearing role as ticket
  // sourceUri.
  sourceUri: string | null;
  // Stable dedup key for work items and idempotency:
  // provider key + object id + normalized status + occurrenceStartedAt.
  dedupKey: string;
};

// Bounded ingestion scope, mirror of TicketListScope: every field is a
// push-down filter the adapter translates to its native query language.
// String values come from the normalized monitoring vocabularies.
export type MonitoringAlertListScope = {
  // Absent/empty = provider default: all non-up states.
  statusValues?: string[] | null;
  // Inclusive minimum severity (floor) on the normalized severity ladder.
  severityFloor?: string | null;
  ackState?: string | null;
  // Provider reference-catalog ids; subtree expansion happens control-plane
  // side before the scope reaches the adapter.
  groupIds?: string[] | null;
  deviceIds?: string[] | null;
  checkTypeIds?: string[] | null;
  // Flap guard: only alerts whose current occurrence is at least this old.
  minAgeMinutes?: number | null;
  maxResults: number;
};

export type MonitoredObjectRecord = {
  objectId: string;
  objectKind: MonitoringObjectKind;
  name: string;
  // IP address or DNS name when the provider exposes it — feeds KANAP asset
  // correlation.
  hostAddress: string | null;
  groupPath: string[] | null;
  tags: string[] | null;
  sourceUri: string | null;
};

export type MonitoringReferenceEnums = {
  statuses: RefItem[];
  severities: RefItem[];
  ackStates: RefItem[];
};

export type MonitoringReferenceCatalogKind = 'group' | 'device' | 'check_type';

export type MonitoringAcknowledgeAlertActionPayload = {
  objectId: string;
  action: 'acknowledge_alert';
  // Required — carries the diagnosis reference into the monitoring tool.
  message: string;
  // Freshness anchor: the occurrence the acknowledgement was prepared against.
  // Execute must fail closed (noLongerApplicable) when it no longer matches.
  occurrenceStartedAt: string | null;
  providerFields?: Record<string, unknown>;
  reason: string;
};

export type MonitoringPauseObjectActionPayload = {
  objectId: string;
  action: 'pause_object';
  // Bounded suppression only — indefinite pause is never offered.
  durationMinutes: number;
  message: string | null;
  providerFields?: Record<string, unknown>;
  reason: string;
};

export type MonitoringProviderActionPrepared<TActionPayload> = {
  actionPayload: TActionPayload;
  summary: string;
};

export type MonitoringProviderActionWriteResult = {
  objectId: string;
  summary: string;
  idempotencyKey: string;
  updatedFields: string[];
  alreadyApplied?: boolean;
  // Fail-closed freshness: the alert cleared or changed occurrence between
  // prepare and execute, so the write was intentionally not applied.
  noLongerApplicable?: boolean;
};

export type MonitoringSensorHistory = {
  sensorId: string;
  metric: string;
  unit: string;
  windowMinutes: number;
  points: Array<{ timestamp: string; value: number }>;
  summary: string;
};

export type MonitoringCurrentState = {
  sensorId: string;
  status: string;
  value?: number | null;
  unit?: string | null;
  observedAt: string;
};

export type VirtualMachineHealth = {
  vmId: string;
  name: string;
  status: string;
  hostId: string;
  clusterId: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  storageLatencyMs: number;
  recentEvents: string[];
  summary: string;
};

export type HostHealth = {
  hostId: string;
  name: string;
  status: string;
  clusterId: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  summary: string;
};

export type ClusterHealth = {
  clusterId: string;
  name: string;
  status: string;
  summary: string;
};

export type DirectoryUserContext = {
  userIdOrEmail: string;
  displayName?: string | null;
  department?: string | null;
  manager?: string | null;
  groups: string[];
  riskNotes: string[];
};

export type DirectoryGroupContext = {
  groupIdOrName: string;
  displayName?: string | null;
  membersCount?: number | null;
  owners: string[];
};

export type AutomationJobSummary = {
  jobKey: string;
  jobId?: string;
  name: string;
  environment: ProviderEnvironment | string;
  dryRunSupported: boolean;
  dryRunRequired: boolean;
  launchAllowed: boolean;
  catalogVersion: string;
  liveTestSafety: string;
};

export type AutomationTargetSelector = {
  type: string;
  values: string[];
};

export type AutomationCatalogJob = {
  id: string;
  providerKey: string;
  jobKey: string;
  catalogVersion: string;
  displayName: string;
  description?: string | null;
  environment: ProviderEnvironment | string;
  externalJobTemplateRef: string;
  enabled: boolean;
  launchAllowed: boolean;
  dryRunSupported: boolean;
  dryRunRequired: boolean;
  variableSchema: Record<string, unknown>;
  targetPolicy: Record<string, unknown>;
  blastRadiusLimit: number;
  cooldownSeconds: number;
  timeoutSeconds: number;
  redactionPolicy: Record<string, unknown>;
  liveTestSafety: string;
  cancelAllowed: boolean;
  metadata?: Record<string, unknown> | null;
};

export type AutomationDryRunResult = {
  dryRunId: string;
  jobKey: string;
  providerKey: string;
  status: 'successful';
  summary: string;
  changed: boolean;
  target: AutomationTargetSelector;
  dryRunFingerprint: string;
  dryRunResultHash: string;
  warnings?: string[];
};

export type AutomationLaunchActionPayload = {
  providerKey: string;
  jobKey: string;
  catalogVersion: string;
  environment: string;
  externalJobTemplateRef: string;
  variables: Record<string, unknown>;
  target: AutomationTargetSelector;
  dryRunRequired: boolean;
  dryRunEvidenceId?: string | null;
  dryRunResultHash?: string | null;
  blastRadius: number;
  timeoutSeconds: number;
  redactionPolicy: Record<string, unknown>;
  liveTestSafety: string;
};

export type AutomationLaunchResult = {
  jobRunId: string;
  jobKey: string;
  providerKey: string;
  status: 'started' | 'already_started';
  summary: string;
  idempotencyKey: string;
  alreadyStarted?: boolean;
};

export type AutomationJobStatusResult = {
  jobRunId: string;
  status: 'pending' | 'running' | 'successful' | 'failed' | 'cancelled';
  summary: string;
  outcome?: string | null;
};

export type AutomationJobOutputResult = {
  jobRunId: string;
  output: string;
  truncated: boolean;
};

export type ProviderActionPlannerProfile = {
  domain_preamble: string;
  action_vocabulary: readonly string[];
  validation_notes?: readonly string[];
};

export type ProviderActionExecutionReadinessAction = {
  id: string;
  tenant_id: string;
  provider_kind: string | null;
  provider_key: string | null;
  target_type: string | null;
  target_id: string | null;
  target_ref: string | null;
  capability_name: string;
  capability_version: string;
  status: string;
  action_payload_json?: unknown;
  metadata_json?: unknown;
};

export type ProviderActionExecutionReadiness = {
  action_request_id: string;
  blocked_reason: string | null;
  requires_sandbox_write_target?: boolean;
  sandbox_write_target_ref?: string | null;
};

export interface ProviderBase {
  readonly kind: ProviderKind;
  readonly providerKey: string;
  readonly actionPlannerProfile?: ProviderActionPlannerProfile;
  health(context: ProviderContext): Promise<AdapterHealthResult>;
  applicability(context: ProviderContext): Promise<CapabilityApplicability>;
  executionReadinessForActions?(
    context: ProviderContext,
    input: { actions: ProviderActionExecutionReadinessAction[] },
  ): Promise<ProviderActionExecutionReadiness[]>;
}

export interface TicketingProvider extends ProviderBase {
  getTicket(context: ProviderContext, input: { ticketId: string }): Promise<AdapterResult<TicketRecord>>;
  searchSimilarTickets(context: ProviderContext, input: { query: string; ticketId?: string | null; limit?: number | null }): Promise<AdapterResult<{ tickets: SimilarTicket[] }>>;
  listTicketNotes(context: ProviderContext, input: { ticketId: string }): Promise<AdapterResult<{ notes: TicketNote[] }>>;
  readTicketAttachment(context: ProviderContext, input: { ticketId: string; target: string; source?: TicketAttachmentRef['source'] | null; sourceNoteId?: string | null }): Promise<AdapterResult<TicketAttachmentReadResult>>;
  listTicketsForScope(context: ProviderContext, input: { scope: TicketListScope }): Promise<AdapterResult<{ tickets: TicketRecord[] }>>;
  describeReferenceEnums(context: ProviderContext): Promise<AdapterResult<TicketReferenceEnums>>;
  // `total` is optional: providers that already know the catalogue size (cached
  // catalogues, search APIs returning a count) report it so the UI can show a
  // real count instead of "50+". Consumers must tolerate it being absent.
  searchReferenceCatalog(context: ProviderContext, input: { kind: TicketReferenceCatalogKind; query?: string | null; limit: number }): Promise<AdapterResult<{ items: RefItem[]; total?: number }>>;
  // Expand tree-catalog ids (categories/entities) to the ids plus all their
  // descendants, input ids first. Backs recursive targeting selection.
  resolveReferenceSubtree(context: ProviderContext, input: { kind: TicketReferenceCatalogKind; ids: string[] }): Promise<AdapterResult<{ ids: string[] }>>;
  getTicketClassificationContext(context: ProviderContext, input: { ticketId: string; categoryScopeKeys?: string[] }): Promise<AdapterResult<TicketClassificationContext>>;
  getTicketLifecycleContext(context: ProviderContext, input: { ticketId: string }): Promise<AdapterResult<TicketLifecycleContext>>;
  getTicketRoutingContext(context: ProviderContext, input: { ticketId: string }): Promise<AdapterResult<TicketRoutingContext>>;
  getTicketParticipantContext(context: ProviderContext, input: { ticketId: string }): Promise<AdapterResult<TicketParticipantContext>>;
  prepareTicketClassificationUpdate(context: ProviderContext, input: {
    ticketId: string;
    proposed: TicketClassificationUpdateProposal;
    reason: string;
  }): Promise<AdapterResult<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>>;
  updateTicketClassification(context: ProviderContext, input: {
    actionPayload: TicketClassificationUpdateActionPayload;
    idempotencyKey: string;
  }): Promise<AdapterResult<TicketProviderActionWriteResult>>;
  prepareTicketStatusUpdate(context: ProviderContext, input: {
    ticketId: string;
    transitionKey: string;
    reason: string;
  }): Promise<AdapterResult<TicketProviderActionPrepared<TicketStatusUpdateActionPayload>>>;
  updateTicketStatus(context: ProviderContext, input: {
    actionPayload: TicketStatusUpdateActionPayload;
    idempotencyKey: string;
  }): Promise<AdapterResult<TicketProviderActionWriteResult>>;
  prepareTicketAssignmentUpdate(context: ProviderContext, input: {
    ticketId: string;
    target: TicketRoutingTarget;
    reason: string;
  }): Promise<AdapterResult<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>>;
  updateTicketAssignment(context: ProviderContext, input: {
    actionPayload: TicketAssignmentUpdateActionPayload;
    idempotencyKey: string;
  }): Promise<AdapterResult<TicketProviderActionWriteResult>>;
  prepareTicketParticipantUpdate(context: ProviderContext, input: {
    ticketId: string;
    operation: TicketParticipantUpdateOperation;
    participants: TicketRoutingTarget[];
    reason: string;
  }): Promise<AdapterResult<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>>;
  updateTicketParticipants(context: ProviderContext, input: {
    actionPayload: TicketParticipantUpdateActionPayload;
    idempotencyKey: string;
  }): Promise<AdapterResult<TicketProviderActionWriteResult>>;
  prepareInternalNote(context: ProviderContext, input: { ticketId: string; noteBody: string }): Promise<AdapterResult<TicketInternalNotePrepared>>;
  addInternalNote(context: ProviderContext, input: { actionPayload: TicketInternalNoteActionPayload; idempotencyKey: string } & TicketWriteOptions): Promise<AdapterResult<TicketInternalNoteWriteResult>>;
  preparePublicReply(context: ProviderContext, input: { ticketId: string; replyBody: string }): Promise<AdapterResult<TicketPublicReplyPrepared>>;
  addPublicReply(context: ProviderContext, input: { actionPayload: TicketPublicReplyActionPayload; idempotencyKey: string } & TicketWriteOptions): Promise<AdapterResult<TicketPublicReplyWriteResult>>;
  // Optional cosmetic capability: human-facing deep links into the provider's
  // own web UI for the given ticket refs (approvals/queue surfaces). Must stay
  // cheap — config/settings reads only, never per-ticket provider API calls.
  // Refs the provider cannot link resolve to null.
  getTicketWebUrls?(context: ProviderContext, input: { ticketRefs: string[] }): Promise<Record<string, string | null>>;
}

export interface MonitoringProvider extends ProviderBase {
  getAlert(context: ProviderContext, input: { alertId: string }): Promise<AdapterResult<MonitoringAlert>>;
  getSensorHistory(context: ProviderContext, input: { sensorId: string; windowMinutes?: number | null }): Promise<AdapterResult<MonitoringSensorHistory>>;
  getCurrentState(context: ProviderContext, input: { sensorId: string }): Promise<AdapterResult<MonitoringCurrentState>>;
  listRelatedAlerts(context: ProviderContext, input: { sensorId: string; limit?: number | null }): Promise<AdapterResult<{ alerts: MonitoringAlert[] }>>;
  // Bounded ingestion workhorse — mirror of listTicketsForScope with the
  // normalized monitoring vocabulary scope.
  listAlertsForScope(context: ProviderContext, input: { scope: MonitoringAlertListScope }): Promise<AdapterResult<{ alerts: MonitoringAlert[] }>>;
  // Device/group context for an alert (name, path, host address, tags) —
  // feeds KANAP asset correlation.
  getMonitoredObject(context: ProviderContext, input: { objectId: string }): Promise<AdapterResult<MonitoredObjectRecord>>;
  describeReferenceEnums(context: ProviderContext): Promise<AdapterResult<MonitoringReferenceEnums>>;
  searchReferenceCatalog(context: ProviderContext, input: { kind: MonitoringReferenceCatalogKind; query: string; limit?: number | null }): Promise<AdapterResult<{ items: RefItem[] }>>;
  // 15.B write pairs — typed now, adapter implementations land in 15.B. The
  // control plane checks `typeof provider.<method> === 'function'` before
  // offering the corresponding action; providers that omit them never see the
  // action offered.
  prepareAcknowledgeAlert?(context: ProviderContext, input: {
    objectId: string;
    message: string;
    reason: string;
  }): Promise<AdapterResult<MonitoringProviderActionPrepared<MonitoringAcknowledgeAlertActionPayload>>>;
  executeAcknowledgeAlert?(context: ProviderContext, input: {
    actionPayload: MonitoringAcknowledgeAlertActionPayload;
    idempotencyKey: string;
  }): Promise<AdapterResult<MonitoringProviderActionWriteResult>>;
  preparePauseObject?(context: ProviderContext, input: {
    objectId: string;
    durationMinutes: number;
    reason: string;
  }): Promise<AdapterResult<MonitoringProviderActionPrepared<MonitoringPauseObjectActionPayload>>>;
  executePauseObject?(context: ProviderContext, input: {
    actionPayload: MonitoringPauseObjectActionPayload;
    idempotencyKey: string;
  }): Promise<AdapterResult<MonitoringProviderActionWriteResult>>;
}

export interface VirtualizationProvider extends ProviderBase {
  getVmHealth(context: ProviderContext, input: { vmId: string }): Promise<AdapterResult<VirtualMachineHealth>>;
  getHostHealth(context: ProviderContext, input: { hostId: string }): Promise<AdapterResult<HostHealth>>;
  getClusterHealth(context: ProviderContext, input: { clusterId: string }): Promise<AdapterResult<ClusterHealth>>;
  getRecentEvents(context: ProviderContext, input: { vmId?: string | null; hostId?: string | null; limit?: number | null }): Promise<AdapterResult<{ events: string[] }>>;
  getResourceUsageSummary(context: ProviderContext, input: { vmId?: string | null; hostId?: string | null }): Promise<AdapterResult<{ summary: string }>>;
}

export interface DirectoryProvider extends ProviderBase {
  getUserContext(context: ProviderContext, input: { userIdOrEmail: string }): Promise<AdapterResult<DirectoryUserContext>>;
  getGroupContext(context: ProviderContext, input: { groupIdOrName: string }): Promise<AdapterResult<DirectoryGroupContext>>;
  validateIdentityRelation(context: ProviderContext, input: { userIdOrEmail: string; ticketId?: string | null }): Promise<AdapterResult<{ related: boolean; summary: string }>>;
}

export interface CommunicationProvider extends ProviderBase {
  postApprovalRequest(context: ProviderContext, input: { channelRef: string; templateId: string; actionRequestId: string }): Promise<AdapterResult<{ messageId: string }>>;
  postStatusUpdate(context: ProviderContext, input: { channelRef: string; templateId: string; summary: string }): Promise<AdapterResult<{ messageId: string }>>;
}

export interface AutomationProvider extends ProviderBase {
  listAllowedJobs(context: ProviderContext, input: { jobs: AutomationCatalogJob[] }): Promise<AdapterResult<{ jobs: AutomationJobSummary[] }>>;
  getJobSchema(context: ProviderContext, input: { job: AutomationCatalogJob }): Promise<AdapterResult<{ jobKey: string; schema: Record<string, unknown> }>>;
  getJobStatus(context: ProviderContext, input: { jobRunId: string; providerKey?: string | null; jobKey?: string | null }): Promise<AdapterResult<AutomationJobStatusResult>>;
  getJobOutput(context: ProviderContext, input: { jobRunId: string; providerKey?: string | null; jobKey?: string | null }): Promise<AdapterResult<AutomationJobOutputResult>>;
  dryRunJob(context: ProviderContext, input: {
    job: AutomationCatalogJob;
    target: AutomationTargetSelector;
    variables: Record<string, unknown>;
    dryRunFingerprint: string;
  }): Promise<AdapterResult<AutomationDryRunResult>>;
  launchApprovedJob(context: ProviderContext, input: {
    actionPayload: AutomationLaunchActionPayload;
    approvalId: string;
    idempotencyKey: string;
  }): Promise<AdapterResult<AutomationLaunchResult>>;
  cancelJob(context: ProviderContext, input: { jobRunId: string }): Promise<AdapterResult<{ cancelled: boolean }>>;
}

export interface KanapDomainProvider extends ProviderBase {
  resolveOperationalContext(context: ProviderContext, input: { assetId?: string | null; applicationId?: string | null }): Promise<AdapterResult<{ summary: string }>>;
}
