import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiSettingsService } from '../../ai-settings.service';
import { GlpiService } from '../../glpi/glpi.service';
import { GlpiAssignableGroup, GlpiCategory, GlpiConnectionOverrides, GlpiTechnician, GlpiTicket, GlpiTicketFollowup, GlpiTicketGroupAssociation, GlpiTicketUserAssociation } from '../../glpi/glpi.types';
import { classificationContextWithoutCatalogue } from './ticket-classification';
import { decodeHtmlEntities, decodeNumericHtmlEntities, HTML_TEXT_ENTITIES } from '../../../common/html-entities';
import { GLPI_TICKETING_IMPLEMENTATION, LEGACY_GLPI_TICKETING_PROVIDER_KEY } from './provider-constants';
import {
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
} from '../capability/capability-contract';
import {
  AdapterErrorCode,
  AdapterEvidenceSeed,
  AdapterResult,
  DEFAULT_TICKET_ACTOR_ROLE,
  ProviderContext,
  ProviderActionExecutionReadiness,
  ProviderActionExecutionReadinessAction,
  ProviderActionPlannerProfile,
  RefItem,
  SimilarTicket,
  TicketClassificationContext,
  TicketAssignmentUpdateActionPayload,
  TicketClassificationUpdateActionPayload,
  TicketClassificationUpdateProposal,
  TicketInternalNoteActionPayload,
  TicketInternalNotePrepared,
  TicketInternalNoteWriteResult,
  TicketLifecycleContext,
  TicketParticipantContext,
  TicketParticipantUpdateActionPayload,
  TicketParticipantUpdateOperation,
  TicketProviderActionPrepared,
  TicketProviderActionWriteResult,
  TicketPublicReplyActionPayload,
  TicketPublicReplyPrepared,
  TicketPublicReplyWriteResult,
  TicketRoutingContext,
  TicketRoutingTarget,
  TicketStatusUpdateActionPayload,
  TicketActorRole,
  TicketWriteOptions,
  TicketingProvider,
  TicketAttachmentReadResult,
  TicketAttachmentRef,
  TicketNote,
  TicketRecord,
  TicketListScope,
  TicketReferenceCatalogKind,
  TicketReferenceEnums,
} from './provider.types';
import { MAX_INTERNAL_NOTE_CHARS, MAX_PUBLIC_REPLY_CHARS, noteBodyIsUnsafe, normalizeReason } from './ticket-safety';
import { HTML_TAGS } from '../../../common/text-scan';

const GLPI_APPROVED_WRITE_CAPABILITIES = new Set([
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
]);

const GLPI_ACTION_PLANNER_PROFILE: ProviderActionPlannerProfile = {
  domain_preamble: 'Select bounded approval-gated GLPI triage actions.',
  action_vocabulary: [
    'internal_note',
    'requester_reply',
    'status_update',
    'classification_update',
    'assignment_update',
    'participant_update',
  ],
  validation_notes: [
    'For requester_reply sourced_answer, do not provide a body; the backend will use sourced synthesis.',
    'For requester_reply administrative close notices, set reply_kind=administrative and administrative_intent=close_reply.',
    'For close instructions, propose BOTH the administrative requester_reply and a status_update when a terminal transition is allowed.',
    'If no source appears sufficient for a sourced answer, prefer internal_note over requester_reply sourced_answer.',
    'If an exact public message is configured, use verbatim_ref from verbatim_candidates; do not copy ticket text as verbatim.',
    'For status_update, transition_key must exactly match one key in allowed_status_transitions.',
    'Only propose terminal status transitions when close_eligibility.matched is true, has_inactivity_age is true, terminal is false, and terminal_status_transition_keys is non-empty.',
    'For assignment_update, target must be one entry of routing_targets copied exactly (kind, key, label); propose at most one group and one user per plan.',
    'Prefer a group unless the instructions name a person. Only propose assignment_update when the agent configuration says who handles this kind of ticket; never invent a routing rule.',
    'Do not propose assignment_update for a group already listed in current_assignment.groups, nor for a user already listed in current_assignment.users. Assignment is additive: it never removes existing technicians or groups.',
    'For participant_update, operation must be add_observer and participants must be exactly one entry of routing_targets copied exactly (kind, key, label). Propose at most one group and one user per plan. Do not propose an observer already listed in the participant context. The requester is not changed. remove_observer and set_observers are not supported.',
    'For classification_update, copy proposed type/priority/urgency keys from classification_options; category must be a category key or exact label. Propose at most one classification_update per plan, with several fields allowed. Only propose when the instructions give a rule; do not repeat current_classification values. Urgency uses the priority scale.',
    'Do not propose assignment or participant updates unless they are in owned_action_types.',
  ],
};

function nowIso(): string {
  return new Date().toISOString();
}

function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = decodeHtmlEntities(
    decodeNumericHtmlEntities(String(value).replace(/\r\n/g, '\n'))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(HTML_TAGS, ' '),
    { entities: HTML_TEXT_ENTITIES, ignoreCase: true },
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
  return text || null;
}

// GLPI Ticket_User type: 2 = assigned technician, 3 = observer.
function actorTypeForPublicReply(role: TicketActorRole | undefined): 2 | 3 | null {
  switch (role ?? DEFAULT_TICKET_ACTOR_ROLE) {
    case 'assignee':
      return 2;
    case 'observer':
      return 3;
    default:
      return null;
  }
}

function normalizeTicketId(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function stableTextHash(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n').trim()).digest('hex');
}

function textOrNull(value: unknown): string | null {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return text.length > 0 ? text : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function glpiStatusLabel(value: string | null): string {
  return value ?? 'unknown';
}

function glpiPriorityLabel(value: number | null): string | null {
  if (value == null) return null;
  return String(value);
}

function glpiStatusContextLabel(value: string | null): string | null {
  switch (String(value ?? '').trim()) {
    case '1':
      return 'New';
    case '2':
      return 'Processing assigned';
    case '3':
      return 'Processing planned';
    case '4':
      return 'Pending';
    case '5':
      return 'Solved';
    case '6':
      return 'Closed';
    default:
      return value;
  }
}

function glpiPriorityContextLabel(value: number | null): string | null {
  switch (value) {
    case 1:
      return 'Very low';
    case 2:
      return 'Low';
    case 3:
      return 'Medium';
    case 4:
      return 'High';
    case 5:
      return 'Very high';
    case 6:
      return 'Major';
    default:
      return value == null ? null : String(value);
  }
}

function glpiTypeContextLabel(value: number | null): string | null {
  switch (value) {
    case 1:
      return 'Incident';
    case 2:
      return 'Request';
    default:
      return value == null ? null : String(value);
  }
}

function glpiTypeKey(value: number | null): string | null {
  switch (value) {
    case 1:
      return 'incident';
    case 2:
      return 'request';
    default:
      return null;
  }
}

function glpiPriorityKey(value: number | null): string | null {
  switch (value) {
    case 1:
      return 'very_low';
    case 2:
      return 'low';
    case 3:
      return 'medium';
    case 4:
      return 'high';
    case 5:
      return 'very_high';
    case 6:
      return 'major';
    default:
      return null;
  }
}

function glpiStatusKey(value: string | null): string | null {
  switch (String(value ?? '').trim()) {
    case '1':
      return 'new';
    case '2':
      return 'processing_assigned';
    case '3':
      return 'processing_planned';
    case '4':
      return 'pending';
    case '5':
      return 'solved';
    case '6':
      return 'closed';
    default:
      return null;
  }
}

function glpiStatusCodeForTransition(value: string): number | null {
  switch (value.trim()) {
    case 'processing_assigned':
      return 2;
    case 'processing_planned':
      return 3;
    case 'pending':
      return 4;
    case 'solved':
      return 5;
    case 'closed':
      return 6;
    default:
      return null;
  }
}

// Terminal transitions (solve/close) are destructive cleanup actions: always
// human-approved (never auto-executed — see executeAutomaticPreparedActions
// terminal backstop) and surfaced distinctly in approvals/audit.
function glpiTransitionIsTerminal(value: string): boolean {
  const key = value.trim();
  return key === 'solved' || key === 'closed';
}

function glpiStatusTransitionLabel(value: string): string {
  switch (value) {
    case 'processing_assigned':
      return 'Processing assigned';
    case 'processing_planned':
      return 'Processing planned';
    case 'pending':
      return 'Pending';
    case 'solved':
      return 'Solved';
    case 'closed':
      return 'Closed';
    default:
      return value;
  }
}

function glpiSafeStatusTransitions(currentStatus: string | null): Array<{
  key: string;
  label: string;
  requiresApproval: true;
  destructive: boolean;
  terminal: boolean;
}> {
  const current = glpiStatusKey(currentStatus);
  // Already-terminal tickets are left alone.
  if (current === 'solved' || current === 'closed') {
    return [];
  }
  const transition = (key: string, destructive: boolean) => ({
    key,
    label: glpiStatusTransitionLabel(key),
    requiresApproval: true as const,
    destructive,
    terminal: glpiTransitionIsTerminal(key),
  });
  // Non-terminal moves are safe; solve/close are destructive terminal cleanup
  // actions, offered for proposal but always human-approved.
  return [
    ...['processing_assigned', 'processing_planned', 'pending']
      .filter((key) => key !== current)
      .map((key) => transition(key, false)),
    transition('solved', true),
    transition('closed', true),
  ];
}

function glpiTypeCode(value: string | null | undefined): number | null {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'incident':
      return 1;
    case 'request':
      return 2;
    default:
      return null;
  }
}

function glpiPriorityCode(value: string | null | undefined): number | null {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'very_low':
      return 1;
    case 'low':
      return 2;
    case 'medium':
      return 3;
    case 'high':
      return 4;
    case 'very_high':
      return 5;
    case 'major':
      return 6;
    default:
      return null;
  }
}

function numericDropdownValue(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceSeed(
  sourceType: string,
  sourceId: string,
  summary: string,
  redactedPayload: unknown,
  sourceUri?: string | null,
): AdapterEvidenceSeed {
  return {
    sourceProvider: 'ticketing:glpi',
    sourceType,
    sourceId,
    sourceUri: sourceUri ?? null,
    collectedAt: nowIso(),
    trustLevel: 'customer_system',
    summary,
    redactedPayload,
    rawPayloadRetention: 'redacted',
  };
}

function ok<T>(data: T, evidence: AdapterEvidenceSeed[], warnings?: string[]): AdapterResult<T> {
  return {
    ok: true,
    data,
    evidence,
    providerRequestId: `glpi-${Date.now()}`,
    warnings,
  };
}

function providerError<T>(
  errorCode: AdapterErrorCode,
  message: string,
  retryable = false,
): AdapterResult<T> {
  return {
    ok: false,
    errorCode,
    message,
    retryable,
    providerRequestId: `glpi-error-${Date.now()}`,
  };
}

function applicabilityError<T>(applicability: { reasonCode?: string; message?: string }): AdapterResult<T> {
  const errorCode: AdapterErrorCode = applicability.reasonCode === 'provider_disabled'
    ? 'disabled'
    : applicability.reasonCode === 'missing_credentials'
      ? 'missing_credentials'
      : applicability.reasonCode === 'provider_not_configured'
        ? 'not_configured'
        : applicability.reasonCode === 'malformed_config'
          ? 'malformed_config'
          : 'provider_unavailable';
  return providerError<T>(errorCode, applicability.message ?? 'GLPI provider is unavailable.', false);
}

function mapError<T>(error: unknown): AdapterResult<T> {
  const message = error instanceof Error ? error.message : String(error || 'GLPI provider request failed.');
  const normalized = message.toLowerCase();
  if (normalized.includes('not found')) {
    return providerError<T>('not_found', message, false);
  }
  if (normalized.includes('token') || normalized.includes('unauthorized') || normalized.includes('login')) {
    return providerError<T>('unauthorized', message, false);
  }
  if (normalized.includes('forbidden')) {
    return providerError<T>('forbidden', message, false);
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return providerError<T>('timeout', message, true);
  }
  if (normalized.includes('non-json') || normalized.includes('malformed') || normalized.includes('html instead')) {
    return providerError<T>('invalid_response', message, false);
  }
  return providerError<T>('provider_unavailable', message, true);
}

function attachmentIdFromTarget(target: string, source: TicketAttachmentRef['source'], sourceNoteId: string | null, index: number): string | null {
  const docId = String(target || '').match(/[?&]docid=(\d+)/i)?.[1]
    ?? String(target || '').match(/\/Document\/(\d+)/i)?.[1]
    ?? null;
  if (docId) return docId;
  return sourceNoteId ? `${sourceNoteId}:${index + 1}` : `${source}:${index + 1}`;
}

function filenameFromTarget(target: string): string | null {
  const clean = String(target || '').split(/[?#]/)[0] ?? '';
  const last = clean.split('/').filter(Boolean).pop();
  return last || null;
}

function toTicketAttachmentRef(
  target: string,
  source: TicketAttachmentRef['source'],
  opts: { sourceNoteId?: string | null; sourceUri?: string | null; index: number },
): TicketAttachmentRef {
  return {
    id: attachmentIdFromTarget(target, source, opts.sourceNoteId ?? null, opts.index),
    kind: 'image',
    source,
    sourceNoteId: opts.sourceNoteId ?? null,
    target,
    sourceUri: opts.sourceUri ?? null,
    filename: filenameFromTarget(target),
    mimeType: null,
    sizeBytes: null,
    altText: null,
  };
}

function toTicketRecord(ticket: GlpiTicket): TicketRecord {
  // No nowIso() fallback: an undated ticket must fail the ingestion horizon
  // check (parseDateMs('') -> null -> out of scope) instead of appearing new.
  const createdAt = ticket.date ?? ticket.updated_date ?? '';
  const updatedAt = ticket.updated_date ?? ticket.date ?? '';
  return {
    id: String(ticket.id),
    title: ticket.name ?? `GLPI ticket #${ticket.id}`,
    // Normalized keys (not raw GLPI codes/labels) so the targeting matcher compares
    // the same namespace the reference-data pickers store (see *ReferenceItems below).
    status: glpiStatusKey(ticket.status) ?? glpiStatusLabel(ticket.status),
    priority: glpiPriorityKey(ticket.priority) ?? glpiPriorityLabel(ticket.priority),
    urgency: glpiPriorityKey(numericDropdownValue(ticket.urgency)) ?? ticket.urgency,
    type: glpiTypeKey(ticket.type) ?? glpiTypeContextLabel(ticket.type),
    requester: null,
    description: stripHtml(ticket.content_html),
    // Rich source fields consumed by the provider-backed ticket importer:
    // raw HTML keeps formatting + inline <img> tags for markdown conversion,
    // and sourceUri keeps the ticket URL footer even without attachments.
    descriptionHtml: ticket.content_html ?? null,
    sourceUri: ticket.glpi_url ?? null,
    createdAt,
    updatedAt,
    scope: {
      entityId: ticket.entity_id == null ? null : String(ticket.entity_id),
      categoryId: ticket.category_id == null ? null : String(ticket.category_id),
    },
    attachments: ticket.image_targets.map((target, index) => toTicketAttachmentRef(target, 'ticket_description', {
      sourceUri: ticket.glpi_url,
      index,
    })),
  };
}

function glpiStatusReferenceItems(): RefItem[] {
  return ['1', '2', '3', '4', '5', '6'].map((code) => ({
    value: glpiStatusKey(code) ?? code,
    label: glpiStatusContextLabel(code) ?? code,
    metadata: {
      code: Number(code),
      key: glpiStatusKey(code),
    },
  }));
}

function glpiPriorityReferenceItems(): RefItem[] {
  return [1, 2, 3, 4, 5, 6].map((level) => ({
    value: glpiPriorityKey(level) ?? String(level),
    label: glpiPriorityContextLabel(level) ?? String(level),
    metadata: {
      code: level,
      level,
    },
  }));
}

function glpiTypeReferenceItems(): RefItem[] {
  return [1, 2].map((code) => ({
    value: glpiTypeKey(code) ?? String(code),
    label: glpiTypeContextLabel(code) ?? String(code),
    metadata: {
      code,
      key: glpiTypeKey(code),
    },
  }));
}

function referenceCatalogItem(kind: TicketReferenceCatalogKind, item: {
  id: number;
  name: string | null;
  completename: string | null;
  parent_id?: number | null;
}): RefItem {
  const label = item.completename || item.name || String(item.id);
  return {
    value: String(item.id),
    label,
    metadata: {
      kind,
      name: item.name,
      completename: item.completename,
      parentId: item.parent_id ?? null,
    },
  };
}

function glpiNoteAuthorRole(
  note: GlpiTicketFollowup,
  requesterUserIds: Set<number>,
): TicketNote['authorRole'] {
  if (note.author_id != null && requesterUserIds.has(note.author_id)) {
    return 'requester';
  }
  if (note.is_private) {
    return 'support';
  }
  const label = String(note.author_label ?? '').toLowerCase();
  if (label.includes('kanap')) {
    return 'kanap_agent';
  }
  return 'unknown';
}

function toTicketNote(note: GlpiTicketFollowup, requesterUserIds: Set<number>): TicketNote {
  const body = stripHtml(note.content_html) ?? '';
  const updatedAt = note.updated_date ?? note.date ?? nowIso();
  return {
    id: String(note.id),
    visibility: note.is_private ? 'internal' : 'public',
    authorId: note.author_id == null ? null : String(note.author_id),
    author: note.author_label,
    authorRole: glpiNoteAuthorRole(note, requesterUserIds),
    body,
    bodyHtml: note.content_html ?? null,
    createdAt: note.date ?? nowIso(),
    updatedAt,
    updateFingerprint: [
      'glpi-followup',
      note.id,
      note.is_private ? 'internal' : 'public',
      note.author_id ?? 'unknown',
      note.date ?? 'unknown-created',
      updatedAt,
      stableTextHash(body),
    ].join(':'),
    attachments: note.image_targets.map((target, index) => toTicketAttachmentRef(target, 'ticket_note', {
      sourceNoteId: String(note.id),
      index,
    })),
  };
}

function associationLabel(value: GlpiTicketUserAssociation): string {
  return value.user_label ?? `GLPI user ${value.user_id}`;
}

function groupRoutingTarget(group: GlpiAssignableGroup): TicketRoutingTarget {
  return { kind: 'group', key: String(group.id), label: group.completename || group.name || `GLPI group ${group.id}` };
}

function userRoutingTarget(technician: GlpiTechnician): TicketRoutingTarget {
  return { kind: 'user', key: String(technician.id), label: technician.label };
}

function observerUserTarget(
  user: GlpiTicketUserAssociation,
  technicianById: Map<number, GlpiTechnician>,
): TicketRoutingTarget {
  const known = technicianById.get(user.user_id);
  return known
    ? userRoutingTarget(known)
    : { kind: 'user', key: String(user.user_id), label: associationLabel(user) };
}

function observerGroupTarget(
  group: GlpiTicketGroupAssociation,
  catalogueById: Map<number, GlpiAssignableGroup>,
): TicketRoutingTarget {
  const known = catalogueById.get(group.group_id);
  return known
    ? groupRoutingTarget(known)
    : { kind: 'group', key: String(group.group_id), label: group.group_label ?? `GLPI group ${group.group_id}` };
}

@Injectable()
export class GlpiTicketingProvider implements TicketingProvider {
  readonly kind = 'ticketing' as const;
  readonly providerKey = LEGACY_GLPI_TICKETING_PROVIDER_KEY;
  readonly actionPlannerProfile = GLPI_ACTION_PLANNER_PROFILE;

  constructor(
    private readonly settings: AiSettingsService,
    private readonly glpi: GlpiService,
  ) {}

  async health(context: ProviderContext) {
    const applicability = await this.applicability(context);
    return {
      ok: applicability.available,
      providerKind: this.kind,
      providerKey: this.providerKey,
      implementation: GLPI_TICKETING_IMPLEMENTATION,
      environment: 'sandbox',
      checkedAt: nowIso(),
      errorCode: applicability.available ? undefined : 'not_configured' as const,
      message: applicability.message,
      retryable: false,
    };
  }

  async applicability(context: ProviderContext) {
    const runtimeConnection = this.runtimeConnectionOverrides(context);
    if (runtimeConnection) {
      if (runtimeConnection.error) {
        return runtimeConnection.error;
      }
      const overrides = runtimeConnection.overrides;
      if (!overrides.glpi_url) {
        return {
          available: false,
          reasonCode: 'provider_not_configured' as const,
          message: 'Configured GLPI adapter URL is not set.',
        };
      }
      if (!overrides.glpi_user_token) {
        return {
          available: false,
          reasonCode: 'missing_credentials' as const,
          message: 'Configured GLPI adapter user token is not set.',
        };
      }
      return { available: true };
    }

    const settings = await this.settings.get(context.tenantId, { manager: context.manager });
    if (!settings.glpi_enabled) {
      return {
        available: false,
        reasonCode: 'provider_disabled' as const,
        message: 'Tenant GLPI integration is disabled.',
      };
    }
    if (!settings.glpi_url) {
      return {
        available: false,
        reasonCode: 'provider_not_configured' as const,
        message: 'Tenant GLPI URL is not configured.',
      };
    }
    if (!settings.glpi_user_token_encrypted) {
      return {
        available: false,
        reasonCode: 'missing_credentials' as const,
        message: 'Tenant GLPI user token is not configured.',
      };
    }
    return { available: true };
  }

  private runtimeConnectionOverrides(context: ProviderContext): { overrides: GlpiConnectionOverrides; error?: undefined } | { overrides?: undefined; error: { available: false; reasonCode: 'malformed_config' | 'missing_credentials'; message: string } } | null {
    const runtime = context.adapterRuntime;
    if (!runtime || runtime.implementation !== GLPI_TICKETING_IMPLEMENTATION) {
      return null;
    }
    const baseUrl = textOrNull(runtime.baseUrl);
    if (!runtime.credential?.hasSecret()) {
      return {
        overrides: {
          glpi_url: baseUrl,
          glpi_user_token: null,
          glpi_app_token: null,
        },
      };
    }
    const raw = runtime.credential.reveal();
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) {
      return {
        overrides: {
          glpi_url: baseUrl,
          glpi_user_token: textOrNull(trimmed),
          glpi_app_token: null,
        },
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        error: {
          available: false,
          reasonCode: 'malformed_config',
          message: 'GLPI adapter credential secret is malformed.',
        },
      };
    }
    const record = objectOrNull(parsed);
    if (!record) {
      return {
        error: {
          available: false,
          reasonCode: 'malformed_config',
          message: 'GLPI adapter credential secret must be a JSON object.',
        },
      };
    }
    const userToken = textOrNull(record.glpi_user_token) ?? textOrNull(record.user_token);
    if (!userToken) {
      return {
        error: {
          available: false,
          reasonCode: 'malformed_config',
          message: 'GLPI adapter credential secret must include glpi_user_token or user_token.',
        },
      };
    }
    return {
      overrides: {
        glpi_url: baseUrl,
        glpi_user_token: userToken,
        glpi_app_token: textOrNull(record.glpi_app_token) ?? textOrNull(record.app_token),
      },
    };
  }

  async executionReadinessForActions(
    context: ProviderContext,
    input: { actions: ProviderActionExecutionReadinessAction[] },
  ): Promise<ProviderActionExecutionReadiness[]> {
    void context;
    return input.actions.map((action) => {
      const isGlpiWrite = GLPI_APPROVED_WRITE_CAPABILITIES.has(action.capability_name);
      const targetRef = typeof action.target_ref === 'string' ? action.target_ref.trim() : '';
      return {
        action_request_id: action.id,
        blocked_reason: isGlpiWrite && !targetRef ? 'GLPI action has no ticket target.' : null,
      };
    });
  }

  async getTicketWebUrls(
    context: ProviderContext,
    input: { ticketRefs: string[] },
  ): Promise<Record<string, string | null>> {
    const runtimeConnection = this.runtimeConnectionOverrides(context);
    let baseUrl: string | null = null;
    if (runtimeConnection) {
      baseUrl = runtimeConnection.error ? null : textOrNull(runtimeConnection.overrides.glpi_url);
    } else {
      const settings = await this.settings.get(context.tenantId, { manager: context.manager });
      baseUrl = settings.glpi_enabled ? textOrNull(settings.glpi_url) : null;
    }
    const urls: Record<string, string | null> = {};
    for (const ref of input.ticketRefs) {
      const ticketId = normalizeTicketId(ref);
      let url: string | null = null;
      if (baseUrl && ticketId != null) {
        try {
          // Same relative join GlpiService uses for apirest.php, so the web root
          // matches wherever the configured URL resolves API calls.
          url = new URL(`front/ticket.form.php?id=${ticketId}`, baseUrl).toString();
        } catch {
          url = null;
        }
      }
      urls[ref] = url;
    }
    return urls;
  }

  private async withSession<T>(
    context: ProviderContext,
    fn: (session: Awaited<ReturnType<GlpiService['initSession']>>) => Promise<AdapterResult<T>>,
  ): Promise<AdapterResult<T>> {
    let session: Awaited<ReturnType<GlpiService['initSession']>> | null = null;
    try {
      session = await this.glpi.initSession(context.tenantId, context.manager, this.runtimeConnectionOverrides(context)?.overrides);
      return await fn(session);
    } catch (error) {
      return mapError<T>(error);
    } finally {
      if (session) {
        await this.glpi.killSession(session);
      }
    }
  }

  private async withAvailableSession<T>(
    context: ProviderContext,
    fn: (session: Awaited<ReturnType<GlpiService['initSession']>>) => Promise<AdapterResult<T>>,
  ): Promise<AdapterResult<T>> {
    const applicability = await this.applicability(context);
    if (!applicability.available) {
      return applicabilityError<T>(applicability);
    }
    return this.withSession(context, fn);
  }

  async getTicket(context: ProviderContext, input: { ticketId: string }): Promise<AdapterResult<TicketRecord>> {
    const ticketId = normalizeTicketId(input.ticketId);
    if (!ticketId) {
      return providerError<TicketRecord>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    return this.withSession(context, async (session) => {
      const ticket = await this.glpi.getTicket(session, ticketId);
      const data = toTicketRecord(ticket);
      return ok(data, [
        evidenceSeed('ticket', data.id, `GLPI ticket ${data.id}: ${data.title}`, {
          id: data.id,
          title: data.title,
          status: data.status,
          priority: data.priority,
          description: data.description,
        }, ticket.glpi_url),
      ]);
    });
  }

  async searchSimilarTickets(
    context: ProviderContext,
    input: { query: string; ticketId?: string | null; limit?: number | null },
  ): Promise<AdapterResult<{ tickets: SimilarTicket[] }>> {
    const ticketId = input.ticketId ? normalizeTicketId(input.ticketId) : null;
    if (!ticketId) {
      return ok({ tickets: [] }, [
        evidenceSeed('ticket_search', 'glpi-query', 'GLPI similar-ticket search is not available without a ticket id.', {
          query: input.query,
          tickets: [],
        }),
      ], ['glpi_search_requires_ticket_id']);
    }
    return this.withSession(context, async (session) => {
      const followups = await this.glpi.getTicketFollowups(session, ticketId);
      const tickets: SimilarTicket[] = followups.slice(0, Math.max(1, Math.min(input.limit ?? 3, 10))).map((followup, index) => ({
        id: String(ticketId),
        title: stripHtml(followup.content_html)?.slice(0, 120) || `GLPI ticket #${ticketId} follow-up ${followup.id}`,
        status: followup.is_private ? 'internal_note' : 'public_note',
        similarity: Math.max(0.2, 0.6 - index * 0.05),
        resolutionSummary: stripHtml(followup.content_html)?.slice(0, 500) ?? null,
      }));
      return ok({ tickets }, [
        evidenceSeed('ticket_search', String(ticketId), `GLPI ticket ${ticketId} follow-up context.`, {
          ticketId,
          resultCount: tickets.length,
          tickets,
        }),
      ], ['glpi_followup_context_used_for_similarity']);
    });
  }

  async listTicketNotes(context: ProviderContext, input: { ticketId: string }): Promise<AdapterResult<{ notes: TicketNote[] }>> {
    const ticketId = normalizeTicketId(input.ticketId);
    if (!ticketId) {
      return providerError<{ notes: TicketNote[] }>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    return this.withSession(context, async (session) => {
      const [followups, users] = await Promise.all([
        this.glpi.getTicketFollowups(session, ticketId),
        this.glpi.getTicketUsers(session, ticketId),
      ]);
      const requesterUserIds = new Set(
        users
          .filter((user) => user.role === 'requester')
          .map((user) => user.user_id),
      );
      const notes = followups.map((note) => toTicketNote(note, requesterUserIds));
      return ok({ notes }, [
        evidenceSeed('ticket_notes', String(ticketId), `GLPI ticket ${ticketId} notes.`, {
          ticketId,
          noteCount: notes.length,
          requesterUserCount: requesterUserIds.size,
          notes: notes.map((note) => ({
            id: note.id,
            visibility: note.visibility,
            authorId: note.authorId,
            author: note.author,
            authorRole: note.authorRole,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            updateFingerprint: note.updateFingerprint,
            bodyPreview: note.body.slice(0, 240),
          })),
        }),
      ], requesterUserIds.size > 0 ? undefined : ['glpi_requester_user_not_available_for_note_classification']);
    });
  }

  async readTicketAttachment(
    context: ProviderContext,
    input: { ticketId: string; target: string; source?: TicketAttachmentRef['source'] | null; sourceNoteId?: string | null },
  ): Promise<AdapterResult<TicketAttachmentReadResult>> {
    const ticketId = normalizeTicketId(input.ticketId);
    if (!ticketId) {
      return providerError<TicketAttachmentReadResult>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    const target = String(input.target || '').trim();
    if (!target) {
      return providerError<TicketAttachmentReadResult>('malformed_config', 'GLPI attachment target is required.', false);
    }
    const source = input.source === 'ticket_note' ? 'ticket_note' : 'ticket_description';
    return this.withSession(context, async (session) => {
      const document = await this.glpi.fetchDocument(session, target);
      const attachment = toTicketAttachmentRef(target, source, {
        sourceNoteId: input.sourceNoteId ?? null,
        index: 0,
      });
      attachment.filename = document.filename;
      attachment.mimeType = document.mimeType;
      attachment.sizeBytes = document.buffer.length;
      const data: TicketAttachmentReadResult = {
        attachment,
        filename: document.filename,
        mimeType: document.mimeType,
        sizeBytes: document.buffer.length,
        base64Data: document.buffer.toString('base64'),
      };
      return ok(data, [
        evidenceSeed('ticket_attachment', attachment.id ?? target, `GLPI ticket ${ticketId} attachment ${attachment.id ?? target}.`, {
          ticketId,
          attachment: {
            ...attachment,
            sizeBytes: document.buffer.length,
            mimeType: document.mimeType,
            filename: document.filename,
          },
        }),
      ]);
    });
  }

  async listTicketsForScope(
    context: ProviderContext,
    input: { scope: TicketListScope },
  ): Promise<AdapterResult<{ tickets: TicketRecord[] }>> {
    const scope = input.scope;
    const entityId = scope.entityId == null ? null : normalizeTicketId(scope.entityId);
    const categoryId = scope.categoryId == null ? null : normalizeTicketId(scope.categoryId);
    const normalizedIdList = (ids: string[] | null | undefined): number[] | null => {
      if (!ids || ids.length === 0) {
        return null;
      }
      const normalized = ids.map((id) => normalizeTicketId(id)).filter((id): id is number => id != null);
      return normalized.length > 0 ? normalized : null;
    };
    const entityIds = normalizedIdList(scope.entityIds);
    const categoryIds = normalizedIdList(scope.categoryIds);
    if (scope.mode === 'new_tickets_only') {
      if (!scope.createdAfter || !Number.isFinite(Date.parse(scope.createdAfter))) {
        return providerError<{ tickets: TicketRecord[] }>('unsafe_operation', 'GLPI new-ticket listing requires a valid created-after horizon.', false);
      }
      return this.withSession(context, async (session) => {
        const tickets = await this.glpi.searchTicketsForScope(session, {
          mode: 'new_tickets_only',
          createdAfter: scope.createdAfter,
          maxResults: scope.maxResults,
          statusValues: scope.statusValues,
          entityId,
          categoryId,
          entityIds,
          categoryIds,
        });
        const data = { tickets: tickets.map(toTicketRecord) };
        return ok(data, [
          evidenceSeed('ticket_scope_list', `${scope.mode}:${scope.createdAfter}`, `GLPI listed ${data.tickets.length} ticket(s) for bounded Helpdesk scope.`, {
            mode: scope.mode,
            createdAfter: scope.createdAfter,
            statusValues: scope.statusValues ?? null,
            maxResults: scope.maxResults,
            entityId: scope.entityId ?? null,
            categoryId: scope.categoryId ?? null,
            ticketIds: data.tickets.map((ticket) => ticket.id),
          }),
        ]);
      });
    }
    if (scope.mode === 'all_open') {
      return this.withSession(context, async (session) => {
        const tickets = await this.glpi.searchTicketsForScope(session, {
          mode: 'all_open',
          maxResults: scope.maxResults,
          statusValues: scope.statusValues,
          entityId,
          categoryId,
          entityIds,
          categoryIds,
          lastChangedBefore: scope.lastChangedBefore ?? null,
          lastChangedAfter: scope.lastChangedAfter ?? null,
        });
        const data = { tickets: tickets.map(toTicketRecord) };
        return ok(data, [
          evidenceSeed('ticket_scope_list', `${scope.mode}:${scope.lastChangedBefore ?? 'any'}`, `GLPI listed ${data.tickets.length} open ticket(s) for bounded Helpdesk scope.`, {
            mode: scope.mode,
            lastChangedBefore: scope.lastChangedBefore ?? null,
            lastChangedAfter: scope.lastChangedAfter ?? null,
            statusValues: scope.statusValues ?? null,
            maxResults: scope.maxResults,
            entityId: scope.entityId ?? null,
            categoryId: scope.categoryId ?? null,
            ticketIds: data.tickets.map((ticket) => ticket.id),
          }),
        ]);
      });
    }
    return providerError<{ tickets: TicketRecord[] }>('unsafe_operation', 'Unsupported GLPI scope listing mode.', false);
  }

  async describeReferenceEnums(context: ProviderContext): Promise<AdapterResult<TicketReferenceEnums>> {
    return this.withAvailableSession(context, async () => {
      const data = {
        statuses: glpiStatusReferenceItems(),
        priorities: glpiPriorityReferenceItems(),
        types: glpiTypeReferenceItems(),
      };
      return ok(data, [
        evidenceSeed('reference_enums', 'glpi', 'Listed GLPI ticket enum reference values.', {
          statuses: data.statuses,
          priorities: data.priorities,
          types: data.types,
        }),
      ]);
    });
  }

  async searchReferenceCatalog(
    context: ProviderContext,
    input: { kind: TicketReferenceCatalogKind; query?: string | null; limit: number },
  ): Promise<AdapterResult<{ items: RefItem[]; total?: number }>> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit), 50));
    return this.withAvailableSession(context, async (session) => {
      const page = await this.glpi.searchReferenceCatalogPage(session, {
        kind: input.kind,
        query: input.query ?? null,
        limit,
      });
      const data = {
        items: page.items.map((item) => referenceCatalogItem(input.kind, item)),
        ...(page.total === undefined ? {} : { total: page.total }),
      };
      const label = input.kind === 'category' ? 'categories'
        : input.kind === 'group' ? 'assignable groups'
        : input.kind === 'technician' ? 'technicians'
        : 'entities';
      return ok(data, [
        evidenceSeed(`${input.kind}_list`, input.query?.trim() || input.kind, `Listed ${data.items.length} GLPI ${label}.`, {
          kind: input.kind,
          query: input.query ?? null,
          limit,
          items: data.items,
        }),
      ]);
    });
  }

  async resolveReferenceSubtree(
    context: ProviderContext,
    input: { kind: TicketReferenceCatalogKind; ids: string[] },
  ): Promise<AdapterResult<{ ids: string[] }>> {
    const roots = Array.from(new Set(
      (input.ids ?? []).map((id) => normalizeTicketId(id)).filter((id): id is number => id != null),
    ));
    if (roots.length === 0) {
      return ok({ ids: [] }, []);
    }
    return this.withAvailableSession(context, async (session) => {
      const ids = await this.glpi.listReferenceSubtreeIds(session, input.kind, roots);
      const data = { ids: ids.map((id) => String(id)) };
      return ok(data, [
        evidenceSeed(`${input.kind}_subtree`, roots.join(','), `Expanded ${roots.length} GLPI ${input.kind} id(s) to ${data.ids.length} including descendants.`, {
          kind: input.kind,
          rootIds: roots.map((id) => String(id)),
          count: data.ids.length,
        }),
      ]);
    });
  }

  async getTicketClassificationContext(
    context: ProviderContext,
    input: { ticketId: string; categoryScopeKeys?: string[] },
  ): Promise<AdapterResult<TicketClassificationContext>> {
    const ticketId = normalizeTicketId(input.ticketId);
    if (!ticketId) {
      return providerError<TicketClassificationContext>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    return this.withSession(context, async (session) => {
      const ticket = await this.glpi.getTicket(session, ticketId);
      const warnings: string[] = [];
      let categories: GlpiCategory[] = [];
      try {
        categories = await this.glpi.listCategories(session);
      } catch {
        // Category read permissions must not disable type/priority/urgency writes.
        warnings.push('glpi_category_catalogue_unavailable');
      }
      const currentCategory = categories.find((category) => category.id === ticket.category_id);
      let choices = categories;
      if (choices.length > 200 && input.categoryScopeKeys?.length) {
        const ids = new Set(input.categoryScopeKeys);
        // Expand using the same complete cached tree, without another GLPI request.
        let added = true;
        while (added) {
          added = false;
          for (const category of categories) {
            if (category.parentId && ids.has(String(category.parentId)) && !ids.has(String(category.id))) {
              ids.add(String(category.id));
              added = true;
            }
          }
        }
        choices = categories.filter((category) => ids.has(String(category.id)));
      }
      const categoryCatalogTruncated = choices.length > 200;
      if (categoryCatalogTruncated) warnings.push('classification_catalog_truncated');
      const data: TicketClassificationContext = {
        ticketId: String(ticket.id),
        categoryKey: ticket.category_id ? String(ticket.category_id) : null,
        category: currentCategory?.completename ?? currentCategory?.name ?? null,
        service: null,
        type: glpiTypeContextLabel(ticket.type),
        priority: glpiPriorityContextLabel(ticket.priority),
        impact: null,
        urgency: glpiPriorityContextLabel(numericDropdownValue(ticket.urgency)),
        supported: true,
        classificationSupported: true,
        categoryCatalogTruncated,
        options: {
          types: glpiTypeReferenceItems().map((item) => ({ key: item.value, label: item.label })),
          priorities: glpiPriorityReferenceItems().map((item) => ({ key: item.value, label: item.label })),
          categories: choices.slice(0, 200).map((item) => ({ key: String(item.id), label: item.completename ?? item.name ?? String(item.id) })),
        },
        warnings,
      };
      return ok(data, [
        evidenceSeed('ticket_classification', data.ticketId, `GLPI ticket ${data.ticketId} classification context.`, {
          ...(classificationContextWithoutCatalogue(data) as Record<string, unknown>),
          categoryOptionCount: data.options!.categories.length,
        }, ticket.glpi_url),
      ], warnings);
    });
  }

  async getTicketLifecycleContext(
    context: ProviderContext,
    input: { ticketId: string },
  ): Promise<AdapterResult<TicketLifecycleContext>> {
    const ticketId = normalizeTicketId(input.ticketId);
    if (!ticketId) {
      return providerError<TicketLifecycleContext>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    return this.withSession(context, async (session) => {
      const ticket = await this.glpi.getTicket(session, ticketId);
      const statusLabel = glpiStatusContextLabel(ticket.status);
      const statusKey = glpiStatusKey(ticket.status);
      const terminal = statusKey === 'solved' || statusKey === 'closed';
      const data: TicketLifecycleContext = {
        ticketId: String(ticket.id),
        status: statusLabel,
        statusLabel,
        terminal,
        allowedTransitions: glpiSafeStatusTransitions(ticket.status),
        updatedAt: ticket.updated_date ?? ticket.date ?? null,
        supported: true,
        warnings: terminal ? ['glpi_terminal_ticket_status_writes_disabled'] : undefined,
      };
      return ok(data, [
        evidenceSeed('ticket_lifecycle', data.ticketId, `GLPI ticket ${data.ticketId} lifecycle context.`, data, ticket.glpi_url),
      ], data.warnings);
    });
  }

  async getTicketRoutingContext(
    context: ProviderContext,
    input: { ticketId: string },
  ): Promise<AdapterResult<TicketRoutingContext>> {
    const ticketId = normalizeTicketId(input.ticketId);
    if (!ticketId) {
      return providerError<TicketRoutingContext>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    return this.withSession(context, async (session) => {
      const [users, groups, catalogue] = await Promise.all([
        this.glpi.getTicketUsers(session, ticketId),
        this.glpi.getTicketGroups(session, ticketId),
        this.glpi.listAssignableGroups(session),
      ]);
      const catalogueById = new Map(catalogue.map((group) => [group.id, group]));
      const assignedGroups: TicketRoutingTarget[] = groups
        .filter((group) => group.role === 'assigned')
        .map((group) => {
          const known = catalogueById.get(group.group_id);
          return known
            ? groupRoutingTarget(known)
            : { kind: 'group' as const, key: String(group.group_id), label: group.group_label ?? `GLPI group ${group.group_id}` };
        });
      const warnings: string[] = [];
      if (catalogue.length === 0) {
        warnings.push('glpi_no_assignable_groups');
      }
      // Partial result on purpose: a GLPI API profile without READ on User / Group_User
      // must still get group routing. The failure is surfaced as a warning, never fatal.
      // No assignable group means no technician catalogue either, by definition.
      let technicians: GlpiTechnician[] = [];
      let techniciansTruncated = false;
      if (catalogue.length > 0) {
        try {
          const technicianCatalogue = await this.glpi.listTechnicians(session);
          technicians = technicianCatalogue.technicians;
          techniciansTruncated = technicianCatalogue.truncated;
        } catch {
          warnings.push('glpi_technician_catalogue_unavailable');
        }
      }
      if (techniciansTruncated) {
        warnings.push('routing_catalog_truncated');
      }
      const supportedAssignmentTargets = [
        ...catalogue.map(groupRoutingTarget),
        ...technicians.map(userRoutingTarget),
      ];
      // Same rule as groups above: one person must read the same everywhere in a proposal,
      // so the technician catalogue label ("Dupont Marie") wins over the GLPI association
      // label (the login). Unknown users keep the association label.
      const technicianById = new Map(technicians.map((technician) => [technician.id, technician]));
      const userLabel = (user: GlpiTicketUserAssociation): string => {
        const known = technicianById.get(user.user_id);
        return known ? known.label : associationLabel(user);
      };
      const requesters = users.filter((user) => user.role === 'requester').map(userLabel);
      const assignedUsers: TicketRoutingTarget[] = users
        .filter((user) => user.role === 'assigned')
        .map((user) => ({ kind: 'user', key: String(user.user_id), label: userLabel(user) }));
      const data: TicketRoutingContext = {
        ticketId: String(ticketId),
        requester: requesters[0] ?? null,
        assignee: assignedUsers[0]?.label ?? null,
        group: assignedGroups[0]?.label ?? null,
        assignedUsers,
        assignedGroups,
        supportedAssignmentTargets,
        agentUserKey: session.agentUserId ? String(session.agentUserId) : null,
        assignmentSupported: supportedAssignmentTargets.length > 0,
        supported: true,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
      return ok(data, [
        evidenceSeed('ticket_routing', data.ticketId, `GLPI ticket ${data.ticketId} routing context.`, {
          ...data,
          // The catalogue is prompt input, not evidence about this ticket.
          supportedAssignmentTargets: undefined,
          supportedAssignmentTargetCount: supportedAssignmentTargets.length,
        }),
      ], warnings.length > 0 ? warnings : undefined);
    });
  }

  async getTicketParticipantContext(
    context: ProviderContext,
    input: { ticketId: string },
  ): Promise<AdapterResult<TicketParticipantContext>> {
    const ticketId = normalizeTicketId(input.ticketId);
    if (!ticketId) {
      return providerError<TicketParticipantContext>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    return this.withSession(context, async (session) => {
      const [users, groups, catalogue] = await Promise.all([
        this.glpi.getTicketUsers(session, ticketId),
        this.glpi.getTicketGroups(session, ticketId),
        this.glpi.listAssignableGroups(session),
      ]);
      const warnings: string[] = ['glpi_watchers_viewers_not_available_in_current_adapter'];
      // Same catalogue as assignment. An empty group list means there is nobody
      // the agent may add, so the write stays off for this ticket.
      let technicians: GlpiTechnician[] = [];
      if (catalogue.length === 0) {
        warnings.push('glpi_no_assignable_groups');
      } else {
        try {
          technicians = (await this.glpi.listTechnicians(session)).technicians;
        } catch {
          warnings.push('glpi_technician_catalogue_unavailable');
        }
      }
      const catalogueById = new Map(catalogue.map((group) => [group.id, group]));
      const technicianById = new Map(technicians.map((technician) => [technician.id, technician]));
      const requesterLabel = (user: GlpiTicketUserAssociation): string => {
        const known = technicianById.get(user.user_id);
        return known ? known.label : associationLabel(user);
      };
      const observerTargets: TicketRoutingTarget[] = [
        ...groups.filter((group) => group.role === 'observer').map((group) => observerGroupTarget(group, catalogueById)),
        ...users.filter((user) => user.role === 'observer').map((user) => observerUserTarget(user, technicianById)),
      ];
      const participantUpdatesSupported = catalogue.length > 0 || technicians.length > 0;
      const data: TicketParticipantContext = {
        ticketId: String(ticketId),
        requester: users.filter((user) => user.role === 'requester').map(requesterLabel)[0] ?? null,
        observers: observerTargets.map((target) => target.label),
        observerTargets,
        watchers: [],
        viewers: [],
        participantUpdatesSupported,
        supported: true,
        warnings,
      };
      return ok(data, [
        evidenceSeed('ticket_participants', data.ticketId, `GLPI ticket ${data.ticketId} participant context.`, data),
      ], data.warnings);
    });
  }

  async prepareTicketClassificationUpdate(
    context: ProviderContext,
    input: { ticketId: string; proposed: TicketClassificationUpdateProposal; reason: string },
  ): Promise<AdapterResult<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>> {
    const ticketId = normalizeTicketId(input.ticketId);
    const reason = normalizeReason(input.reason);
    if (!ticketId) {
      return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (!reason) {
      return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>('unsafe_operation', 'GLPI provider rejected an unsafe or empty classification update reason.', false);
    }
    const providerFields: Record<string, number> = {};
    const proposed: TicketClassificationUpdateActionPayload['proposed'] = {};
    const typeCode = input.proposed.type == null ? null : glpiTypeCode(input.proposed.type);
    const priorityCode = input.proposed.priority == null ? null : glpiPriorityCode(input.proposed.priority);
    const urgencyCode = input.proposed.urgency == null ? null : glpiPriorityCode(input.proposed.urgency);
    if (input.proposed.type != null) {
      if (typeCode == null) {
        return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>('unsafe_operation', 'Unsupported GLPI ticket type proposal.', false);
      }
      providerFields.type = typeCode;
      proposed.type = input.proposed.type;
    }
    if (input.proposed.priority != null) {
      if (priorityCode == null) {
        return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>('unsafe_operation', 'Unsupported GLPI ticket priority proposal.', false);
      }
      providerFields.priority = priorityCode;
      proposed.priority = input.proposed.priority;
    }
    if (input.proposed.urgency != null) {
      if (urgencyCode == null) {
        return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>('unsafe_operation', 'Unsupported GLPI ticket urgency proposal.', false);
      }
      providerFields.urgency = urgencyCode;
      proposed.urgency = input.proposed.urgency;
    }
    if (input.proposed.service || input.proposed.impact) {
      return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>(
        'unsafe_operation',
        'GLPI service/impact writes are not enabled in the current adapter.',
        false,
      );
    }
    if (input.proposed.category != null) {
      // Resolve against the complete tree: a scoped planner catalogue can contain
      // entries beyond the first 200 global choices.
      const resolved = await this.withSession(context, async (session) => {
        const catalogue = await this.glpi.listCategories(session);
        const value = String(input.proposed.category).trim();
        const byKey = catalogue.find((item) => String(item.id) === value);
        const byLabel = catalogue.filter((item) => (item.completename ?? item.name ?? '').trim().toLowerCase() === value.toLowerCase());
        const category = byKey ?? (byLabel.length === 1 ? byLabel[0] : null);
        return category ? ok(category, []) : providerError<GlpiCategory>('unsafe_operation', 'Unknown or ambiguous GLPI ticket category.', false);
      });
      if (resolved.ok === false) return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>(resolved.errorCode, resolved.message, resolved.retryable);
      providerFields.itilcategories_id = resolved.data.id;
      proposed.category = resolved.data.completename ?? resolved.data.name ?? String(resolved.data.id);
      proposed.categoryKey = String(resolved.data.id);
    }
    if (Object.keys(providerFields).length === 0) {
      return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>('unsafe_operation', 'No supported GLPI classification fields were proposed.', false);
    }
    const current = await this.getTicketClassificationContext(context, { ticketId: String(ticketId) });
    if (current.ok === false) {
      return providerError<TicketProviderActionPrepared<TicketClassificationUpdateActionPayload>>(
        current.errorCode,
        current.message,
        current.retryable,
      );
    }
    const actionPayload: TicketClassificationUpdateActionPayload = {
      ticketId: String(ticketId),
      action: 'classification_update',
      current: classificationContextWithoutCatalogue(current.data) as TicketClassificationContext,
      proposed,
      providerFields,
      reason,
    };
    const data = {
      actionPayload,
      summary: `Prepared GLPI classification update for ticket ${ticketId}.`,
    };
    return ok(data, [
      evidenceSeed('ticket_classification_update_prepared', String(ticketId), data.summary, {
        ticketId,
        proposed,
      }),
    ]);
  }

  async updateTicketClassification(
    context: ProviderContext,
    input: { actionPayload: TicketClassificationUpdateActionPayload; idempotencyKey: string },
  ): Promise<AdapterResult<TicketProviderActionWriteResult>> {
    const ticketId = normalizeTicketId(input.actionPayload.ticketId);
    if (!ticketId || input.actionPayload.action !== 'classification_update' || !input.actionPayload.providerFields) {
      return providerError<TicketProviderActionWriteResult>('malformed_config', 'Invalid GLPI classification update payload.', false);
    }
    return this.withSession(context, async (session) => {
      const result = await this.glpi.updateTicketFields(session, ticketId, input.actionPayload.providerFields as any);
      const data: TicketProviderActionWriteResult = {
        ticketId: String(result.ticket_id),
        summary: `GLPI ticket ${result.ticket_id} classification updated.`,
        idempotencyKey: input.idempotencyKey,
        updatedFields: result.updated_fields,
        alreadyApplied: false,
      };
      return ok(data, [
        evidenceSeed('ticket_classification_updated', String(result.ticket_id), data.summary, {
          ticketId: data.ticketId,
          updatedFields: data.updatedFields,
          idempotencyKey: input.idempotencyKey,
        }),
      ]);
    });
  }

  async prepareTicketStatusUpdate(
    context: ProviderContext,
    input: { ticketId: string; transitionKey: string; reason: string },
  ): Promise<AdapterResult<TicketProviderActionPrepared<TicketStatusUpdateActionPayload>>> {
    const ticketId = normalizeTicketId(input.ticketId);
    const reason = normalizeReason(input.reason);
    const targetStatusCode = glpiStatusCodeForTransition(input.transitionKey);
    if (!ticketId) {
      return providerError<TicketProviderActionPrepared<TicketStatusUpdateActionPayload>>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (!reason || targetStatusCode == null) {
      return providerError<TicketProviderActionPrepared<TicketStatusUpdateActionPayload>>('unsafe_operation', 'Unsupported or unsafe GLPI status transition proposal.', false);
    }
    const current = await this.getTicketLifecycleContext(context, { ticketId: String(ticketId) });
    if (current.ok === false) {
      return providerError<TicketProviderActionPrepared<TicketStatusUpdateActionPayload>>(
        current.errorCode,
        current.message,
        current.retryable,
      );
    }
    const transition = current.data.allowedTransitions.find((candidate) => candidate.key === input.transitionKey);
    // Destructive (terminal solve/close) transitions CAN be prepared/proposed —
    // they are gated by human approval and the auto-exec terminal backstop — but a
    // ticket that is already terminal cannot transition further.
    if (!transition || current.data.terminal) {
      return providerError<TicketProviderActionPrepared<TicketStatusUpdateActionPayload>>('unsafe_operation', 'GLPI status transition is not allowed for this ticket.', false);
    }
    const actionPayload: TicketStatusUpdateActionPayload = {
      ticketId: String(ticketId),
      action: 'status_update',
      current: current.data,
      transitionKey: input.transitionKey,
      targetStatus: input.transitionKey,
      targetStatusLabel: transition.label,
      terminal: transition.terminal,
      providerFields: { status: targetStatusCode },
      reason,
    };
    const data = {
      actionPayload,
      summary: `Prepared GLPI status update to ${transition.label} for ticket ${ticketId}.`,
    };
    return ok(data, [
      evidenceSeed('ticket_status_update_prepared', String(ticketId), data.summary, {
        ticketId,
        transition: input.transitionKey,
      }),
    ]);
  }

  async updateTicketStatus(
    context: ProviderContext,
    input: { actionPayload: TicketStatusUpdateActionPayload; idempotencyKey: string },
  ): Promise<AdapterResult<TicketProviderActionWriteResult>> {
    const ticketId = normalizeTicketId(input.actionPayload.ticketId);
    const status = input.actionPayload.providerFields?.status;
    if (!ticketId || input.actionPayload.action !== 'status_update' || typeof status !== 'number') {
      return providerError<TicketProviderActionWriteResult>('malformed_config', 'Invalid GLPI status update payload.', false);
    }
    if (status === 1) {
      return providerError<TicketProviderActionWriteResult>('unsafe_operation', 'GLPI status writes back to New are disabled.', false);
    }
    return this.withSession(context, async (session) => {
      const result = await this.glpi.updateTicketFields(session, ticketId, { status });
      const data: TicketProviderActionWriteResult = {
        ticketId: String(result.ticket_id),
        summary: `GLPI ticket ${result.ticket_id} status updated.`,
        idempotencyKey: input.idempotencyKey,
        updatedFields: result.updated_fields,
        alreadyApplied: false,
      };
      return ok(data, [
        evidenceSeed('ticket_status_updated', String(result.ticket_id), data.summary, {
          ticketId: data.ticketId,
          updatedFields: data.updatedFields,
          idempotencyKey: input.idempotencyKey,
        }),
      ]);
    });
  }

  // Catalogue-bound routing: the target must be one of the assignable groups or one of the
  // named technicians GLPI exposes, and the label is taken from that catalogue, never from
  // the caller. Additive (Group_Ticket / Ticket_User type 2), never removes an existing
  // technician or group.
  async prepareTicketAssignmentUpdate(
    context: ProviderContext,
    input: { ticketId: string; target: TicketRoutingTarget; reason: string },
  ): Promise<AdapterResult<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>> {
    const ticketId = normalizeTicketId(input.ticketId);
    const reason = normalizeReason(input.reason);
    if (!ticketId) {
      return providerError<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (!reason) {
      return providerError<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>('unsafe_operation', 'GLPI assignment updates require a reason.', false);
    }
    const targetKind = input.target?.kind;
    if (targetKind !== 'group' && targetKind !== 'user') {
      return providerError<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>('unsafe_operation', 'GLPI assignment updates support technician groups and named technicians only.', false);
    }
    const routing = await this.getTicketRoutingContext(context, { ticketId: String(ticketId) });
    if (routing.ok === false) {
      return providerError<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>(routing.errorCode, routing.message, routing.retryable);
    }
    const target = routing.data.supportedAssignmentTargets.find((candidate) => candidate.kind === targetKind && candidate.key === String(input.target.key).trim());
    if (!routing.data.assignmentSupported || !target) {
      return providerError<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>('unsafe_operation', 'GLPI assignment target is not in the routing catalogue.', false);
    }
    const alreadyAssigned = targetKind === 'group'
      ? (routing.data.assignedGroups ?? [])
      : (routing.data.assignedUsers ?? []);
    if (alreadyAssigned.some((entry) => entry.key === target.key)) {
      return providerError<TicketProviderActionPrepared<TicketAssignmentUpdateActionPayload>>('unsafe_operation', `GLPI ticket ${ticketId} is already assigned to ${target.label}.`, false);
    }
    const actionPayload: TicketAssignmentUpdateActionPayload = {
      ticketId: String(ticketId),
      action: 'assignment_update',
      current: routing.data,
      target,
      providerFields: targetKind === 'group'
        ? { groups_id: Number(target.key), type: 2, operation: 'add' }
        : { users_id: Number(target.key), type: 2, operation: 'add' },
      reason,
    };
    const data = {
      actionPayload,
      summary: `Prepared assignment of GLPI ticket ${ticketId} to ${target.label}.`,
    };
    return ok(data, [
      evidenceSeed('ticket_assignment_update_prepared', String(ticketId), data.summary, {
        ticketId,
        target,
        currentGroups: routing.data.assignedGroups ?? [],
        currentUsers: routing.data.assignedUsers ?? [],
      }),
    ]);
  }

  async updateTicketAssignment(
    context: ProviderContext,
    input: { actionPayload: TicketAssignmentUpdateActionPayload; idempotencyKey: string },
  ): Promise<AdapterResult<TicketProviderActionWriteResult>> {
    const ticketId = normalizeTicketId(input.actionPayload.ticketId);
    const targetKind = input.actionPayload.target?.kind;
    const targetId = Number.parseInt(String(input.actionPayload.target?.key ?? ''), 10);
    if (!ticketId) {
      return providerError<TicketProviderActionWriteResult>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (
      input.actionPayload.action !== 'assignment_update'
      || (targetKind !== 'group' && targetKind !== 'user')
      || !Number.isInteger(targetId)
      || targetId <= 0
    ) {
      return providerError<TicketProviderActionWriteResult>('unsafe_operation', 'GLPI provider refused an invalid assignment update.', false);
    }
    return this.withSession(context, async (session) => {
      const result = targetKind === 'group'
        ? await this.glpi.addTicketGroup(session, ticketId, targetId)
        : await this.glpi.addTicketTechnician(session, ticketId, targetId);
      const label = 'group' in result
        ? groupRoutingTarget(result.group).label
        : userRoutingTarget(result.technician).label;
      const data: TicketProviderActionWriteResult = {
        ticketId: String(ticketId),
        summary: result.alreadyPresent
          ? `GLPI ticket ${ticketId} was already assigned to ${label}.`
          : `GLPI ticket ${ticketId} assigned to ${label}.`,
        idempotencyKey: input.idempotencyKey,
        updatedFields: result.added ? ['assignment'] : [],
        alreadyApplied: result.alreadyPresent,
      };
      return ok(data, [
        evidenceSeed('ticket_assignment_updated', String(ticketId), data.summary, {
          ticketId,
          ...(targetKind === 'group' ? { groupsId: targetId } : { usersId: targetId }),
          label,
          added: result.added,
          alreadyPresent: result.alreadyPresent,
          idempotencyKey: input.idempotencyKey,
        }),
      ]);
    });
  }

  // Catalogue-bound observers: the target must be one routing target (kind, key, label
  // copied from the catalogue). Only add_observer is supported. Additive (Group_Ticket /
  // Ticket_User type 3): an observer already on the ticket is refused here, and the
  // requester is never written.
  async prepareTicketParticipantUpdate(
    context: ProviderContext,
    input: { ticketId: string; operation: TicketParticipantUpdateOperation; participants: TicketRoutingTarget[]; reason: string },
  ): Promise<AdapterResult<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>> {
    const ticketId = normalizeTicketId(input.ticketId);
    const reason = normalizeReason(input.reason);
    if (!ticketId) {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (!reason) {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>('unsafe_operation', 'GLPI observer updates require a reason.', false);
    }
    if (input.operation !== 'add_observer') {
      const refused = input.operation === 'remove_observer'
        ? 'Removing an observer is not supported.'
        : input.operation === 'set_observers'
          ? 'Replacing the observer list is not supported.'
          : 'This observer operation is not supported.';
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>(
        'unsafe_operation',
        `GLPI only adds an observer. ${refused} The requester is not changed.`,
        false,
      );
    }
    if (!Array.isArray(input.participants) || input.participants.length !== 1) {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>('unsafe_operation', 'GLPI observer updates add exactly one technician or one group.', false);
    }
    const requested = input.participants[0];
    const targetKind = requested?.kind;
    if (targetKind !== 'group' && targetKind !== 'user') {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>('unsafe_operation', 'GLPI observer updates support technician groups and named technicians only.', false);
    }
    const routing = await this.getTicketRoutingContext(context, { ticketId: String(ticketId) });
    if (routing.ok === false) {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>(routing.errorCode, routing.message, routing.retryable);
    }
    const target = routing.data.supportedAssignmentTargets.find((candidate) => candidate.kind === targetKind && candidate.key === String(requested.key).trim());
    if (!routing.data.assignmentSupported || !target) {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>('unsafe_operation', 'GLPI observer target is not in the routing catalogue.', false);
    }
    const participants = await this.getTicketParticipantContext(context, { ticketId: String(ticketId) });
    if (participants.ok === false) {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>(participants.errorCode, participants.message, participants.retryable);
    }
    const alreadyObserver = (participants.data.observerTargets ?? []).some((entry) => entry.kind === target.kind && entry.key === target.key);
    if (alreadyObserver) {
      return providerError<TicketProviderActionPrepared<TicketParticipantUpdateActionPayload>>('unsafe_operation', `GLPI ticket ${ticketId} already has ${target.label} as an observer.`, false);
    }
    const actionPayload: TicketParticipantUpdateActionPayload = {
      ticketId: String(ticketId),
      action: 'participant_update',
      current: participants.data,
      operation: 'add_observer',
      participants: [target],
      providerFields: targetKind === 'group'
        ? { groups_id: Number(target.key), type: 3, operation: 'add' }
        : { users_id: Number(target.key), type: 3, operation: 'add' },
      reason,
    };
    const data = {
      actionPayload,
      summary: `Prepared observer ${target.label} on GLPI ticket ${ticketId}.`,
    };
    return ok(data, [
      evidenceSeed('ticket_participant_update_prepared', String(ticketId), data.summary, {
        ticketId,
        target,
        currentObservers: participants.data.observerTargets ?? [],
      }),
    ]);
  }

  async updateTicketParticipants(
    context: ProviderContext,
    input: { actionPayload: TicketParticipantUpdateActionPayload; idempotencyKey: string },
  ): Promise<AdapterResult<TicketProviderActionWriteResult>> {
    const ticketId = normalizeTicketId(input.actionPayload.ticketId);
    const participant = input.actionPayload.participants?.[0];
    const targetKind = participant?.kind;
    const targetId = Number.parseInt(String(participant?.key ?? ''), 10);
    if (!ticketId) {
      return providerError<TicketProviderActionWriteResult>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (
      input.actionPayload.action !== 'participant_update'
      || input.actionPayload.operation !== 'add_observer'
      || input.actionPayload.participants.length !== 1
      || (targetKind !== 'group' && targetKind !== 'user')
      || !Number.isInteger(targetId)
      || targetId <= 0
    ) {
      return providerError<TicketProviderActionWriteResult>('unsafe_operation', 'GLPI provider refused an invalid observer update.', false);
    }
    return this.withSession(context, async (session) => {
      const result = targetKind === 'group'
        ? await this.glpi.addTicketGroupObserver(session, ticketId, targetId)
        : await this.glpi.addTicketTechnicianObserver(session, ticketId, targetId);
      const label = 'group' in result
        ? groupRoutingTarget(result.group).label
        : userRoutingTarget(result.technician).label;
      const data: TicketProviderActionWriteResult = {
        ticketId: String(ticketId),
        summary: result.alreadyPresent
          ? `GLPI ticket ${ticketId} already had ${label} as an observer.`
          : `GLPI ticket ${ticketId} observer added: ${label}.`,
        idempotencyKey: input.idempotencyKey,
        updatedFields: result.added ? ['participants'] : [],
        alreadyApplied: result.alreadyPresent,
      };
      return ok(data, [
        evidenceSeed('ticket_participants_updated', String(ticketId), data.summary, {
          ticketId,
          ...(targetKind === 'group' ? { groupsId: targetId } : { usersId: targetId }),
          label,
          added: result.added,
          alreadyPresent: result.alreadyPresent,
          idempotencyKey: input.idempotencyKey,
        }),
      ]);
    });
  }

  async prepareInternalNote(
    context: ProviderContext,
    input: { ticketId: string; noteBody: string },
  ): Promise<AdapterResult<TicketInternalNotePrepared>> {
    void context;
    const ticketId = normalizeTicketId(input.ticketId);
    const body = String(input.noteBody || '').replace(/\r\n/g, '\n').trim();
    if (!ticketId) {
      return providerError<TicketInternalNotePrepared>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (!body || body.length > MAX_INTERNAL_NOTE_CHARS || noteBodyIsUnsafe(body)) {
      return providerError<TicketInternalNotePrepared>('unsafe_operation', 'GLPI provider rejected an unsafe internal note body.', false);
    }
    const actionPayload: TicketInternalNoteActionPayload = {
      ticketId: String(ticketId),
      visibility: 'internal',
      body,
      bodyFormat: 'plain_text',
    };
    const data: TicketInternalNotePrepared = {
      actionPayload,
      summary: `Prepared internal note for GLPI ticket ${ticketId}.`,
    };
    return ok(data, [
      evidenceSeed('ticket_internal_note_prepared', String(ticketId), data.summary, {
        ticketId,
        visibility: actionPayload.visibility,
        bodyPreview: body.slice(0, 240),
      }),
    ]);
  }

  async addInternalNote(
    context: ProviderContext,
    input: { actionPayload: TicketInternalNoteActionPayload; idempotencyKey: string } & TicketWriteOptions,
  ): Promise<AdapterResult<TicketInternalNoteWriteResult>> {
    const ticketId = normalizeTicketId(input.actionPayload.ticketId);
    if (!ticketId) {
      return providerError<TicketInternalNoteWriteResult>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (
      input.actionPayload.visibility !== 'internal'
      || input.actionPayload.bodyFormat !== 'plain_text'
      || !input.actionPayload.body
      || noteBodyIsUnsafe(input.actionPayload.body)
    ) {
      return providerError<TicketInternalNoteWriteResult>('unsafe_operation', 'GLPI provider refused a non-internal or unsafe note write.', false);
    }
    return this.withSession(context, async (session) => {
      const result = await this.glpi.addTicketFollowup(session, ticketId, input.actionPayload.body, { isPrivate: true });
      // On internal notes the agent at most follows the ticket as an OBSERVER (non-fatal side effect).
      const actor = await this.addAgentActor(session, ticketId, input.agentActorRole === 'none' ? null : 3);
      const data: TicketInternalNoteWriteResult = {
        noteId: String(result.id),
        ticketId: String(result.ticket_id),
        summary: `Internal note added to GLPI ticket ${result.ticket_id}.`,
        idempotencyKey: input.idempotencyKey,
        alreadyApplied: false,
      };
      return ok(data, [
        evidenceSeed('ticket_internal_note_added', String(result.ticket_id), data.summary, {
          noteId: data.noteId,
          ticketId: data.ticketId,
          isPrivate: result.is_private,
          idempotencyKey: input.idempotencyKey,
          agentObserverAdded: actor.added,
          ...(actor.skippedReason ? { agentObserverSkippedReason: actor.skippedReason } : {}),
        }),
      ]);
    });
  }

  // Adds the agent's own GLPI user as a ticket actor as a side effect of posting. Strictly
  // own-user-only (enforced in GlpiService.addTicketUser), idempotent, additive, and
  // non-fatal: a failure is reported as evidence but never fails the note/reply that
  // already succeeded, and never routes through the disabled arbitrary-participant path.
  private async addAgentActor(
    session: Awaited<ReturnType<GlpiService['initSession']>>,
    ticketId: number,
    type: 2 | 3 | null,
  ): Promise<{ added: boolean; skippedReason?: string }> {
    if (type == null) {
      return { added: false, skippedReason: 'disabled_by_agent_policy' };
    }
    if (!session.agentUserId) {
      return { added: false, skippedReason: 'agent_glpi_user_unresolved' };
    }
    try {
      const result = await this.glpi.addTicketUser(session, ticketId, session.agentUserId, type);
      return { added: result.added, skippedReason: result.alreadyPresent ? 'already_present' : undefined };
    } catch (error) {
      return { added: false, skippedReason: error instanceof Error ? error.message : 'actor_add_failed' };
    }
  }

  async preparePublicReply(
    context: ProviderContext,
    input: { ticketId: string; replyBody: string },
  ): Promise<AdapterResult<TicketPublicReplyPrepared>> {
    void context;
    const ticketId = normalizeTicketId(input.ticketId);
    const body = String(input.replyBody || '').replace(/\r\n/g, '\n').trim();
    if (!ticketId) {
      return providerError<TicketPublicReplyPrepared>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (!body || body.length > MAX_PUBLIC_REPLY_CHARS || noteBodyIsUnsafe(body)) {
      return providerError<TicketPublicReplyPrepared>('unsafe_operation', 'GLPI provider rejected an unsafe public reply body.', false);
    }
    const actionPayload: TicketPublicReplyActionPayload = {
      ticketId: String(ticketId),
      visibility: 'public',
      body,
      bodyFormat: 'plain_text',
    };
    const data: TicketPublicReplyPrepared = {
      actionPayload,
      summary: `Prepared public reply for GLPI ticket ${ticketId}.`,
    };
    return ok(data, [
      evidenceSeed('ticket_public_reply_prepared', String(ticketId), data.summary, {
        ticketId,
        visibility: actionPayload.visibility,
        bodyPreview: body.slice(0, 240),
      }),
    ]);
  }

  async addPublicReply(
    context: ProviderContext,
    input: { actionPayload: TicketPublicReplyActionPayload; idempotencyKey: string } & TicketWriteOptions,
  ): Promise<AdapterResult<TicketPublicReplyWriteResult>> {
    const ticketId = normalizeTicketId(input.actionPayload.ticketId);
    if (!ticketId) {
      return providerError<TicketPublicReplyWriteResult>('malformed_config', 'GLPI ticket id must be a positive integer.', false);
    }
    if (
      input.actionPayload.visibility !== 'public'
      || input.actionPayload.bodyFormat !== 'plain_text'
      || !input.actionPayload.body
      || noteBodyIsUnsafe(input.actionPayload.body)
    ) {
      return providerError<TicketPublicReplyWriteResult>('unsafe_operation', 'GLPI provider refused a non-public or unsafe reply write.', false);
    }
    return this.withSession(context, async (session) => {
      const result = await this.glpi.addTicketFollowup(session, ticketId, input.actionPayload.body, {
        isPrivate: false,
        allowPublic: true,
      });
      // On public replies the agent registers itself per the agent's ticket actor role:
      // ASSIGNEE (default), OBSERVER, or not at all (additive, non-fatal).
      const actor = await this.addAgentActor(session, ticketId, actorTypeForPublicReply(input.agentActorRole));
      const data: TicketPublicReplyWriteResult = {
        noteId: String(result.id),
        ticketId: String(result.ticket_id),
        summary: `Public reply added to GLPI ticket ${result.ticket_id}.`,
        idempotencyKey: input.idempotencyKey,
        alreadyApplied: false,
      };
      return ok(data, [
        evidenceSeed('ticket_public_reply_added', String(result.ticket_id), data.summary, {
          noteId: data.noteId,
          ticketId: data.ticketId,
          isPrivate: result.is_private,
          idempotencyKey: input.idempotencyKey,
          agentAssigneeAdded: actor.added,
          ...(actor.skippedReason ? { agentAssigneeSkippedReason: actor.skippedReason } : {}),
        }),
      ]);
    });
  }
}
