import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { bilingualDocumentTsQuerySql } from '../common/document-search-tsquery';
import { resolveToUuid } from '../common/resolve-item-id';
import { KnowledgeService } from '../knowledge/knowledge.service';
import {
  documentIncidentVisibilitySql,
  resolveDocumentIncidentViewer,
} from '../knowledge/document-entity-visibility';
import {
  AI_SEARCH_ENTITY_TYPES,
  AiEntityCommentDto,
  AiEntityCommentsDto,
  AiContextEntityType,
  AiEntityContextDto,
  AiEntityContextPayloadDto,
  AiEntityRelationshipGroupDto,
  AiEntitySummaryDto,
  AiExecutionContext,
  AiExecutionContextWithManager,
  AiKnowledgeContextDto,
  AiSearchEntityType,
} from './ai.types';
import { incidentRelatedLabelSql, incidentRelatedTitleSql, incidentVisibilitySql, resolveIncidentViewer } from '../incidents/incident-visibility';
import { lineNumberSql } from '../spend/budget-nature';
import { INCIDENT_REVIEW_SLOT } from '../knowledge/integrated-document.constants';
import { AiPolicyService } from './ai-policy.service';
import {
  participantConditionForAiEntity,
  ParticipationScopedAiEntityType,
  resolveAiDocumentIncidentViewer,
  resolveAiParticipationAccessScope,
} from './query/ai-query-scope.util';

type SearchRow = {
  id: string;
  item_number?: number | null;
  ref?: string | null;
  item_ref?: string | null;
  label: string;
  summary: string | null;
  status: string | null;
  updated_at: Date | string | null;
  score?: number;
  total_count?: number | null;
  metadata?: Record<string, string | number | boolean | null> | null;
};

type RankedSearchResult = {
  items: Array<AiEntitySummaryDto & { _score: number }>;
  total: number;
};

type ContextActivityRow = {
  type: string | null;
  content: string | null;
  context: string | null;
  decision_outcome: string | null;
  changed_fields: Record<string, [unknown, unknown]> | null;
  author_name: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  total_count?: number | null;
};

type EntityCommentRow = {
  author_name: string | null;
  content: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type EntityCommentTargetType = Extract<AiContextEntityType, 'projects' | 'tasks'>;

type EntityCommentTargetRow = {
  id: string;
  item_number: number | null;
  label: string;
};

function buildRequestSummarySql(alias: string): string {
  return `COALESCE(NULLIF(${alias}.current_situation, ''), NULLIF(${alias}.expected_benefits, ''))`;
}

function buildProjectSummarySql(alias: string): string {
  return `NULLIF(CONCAT_WS(' | ',
    CASE
      WHEN ${alias}.origin IS NOT NULL AND ${alias}.origin <> 'standard'
      THEN CONCAT('Origin: ', ${alias}.origin)
      ELSE NULL
    END,
    CASE
      WHEN COALESCE(${alias}.execution_progress, 0) > 0
      THEN CONCAT('Effort: ', ROUND(${alias}.execution_progress)::int, '%')
      ELSE NULL
    END,
    CASE
      WHEN ${alias}.planned_end IS NOT NULL
      THEN CONCAT('Target end: ', ${alias}.planned_end::text)
      ELSE NULL
    END
  ), '')`;
}

function buildUserNameSql(alias: string): string {
  return `COALESCE(NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''), ${alias}.email)`;
}

function buildContributorNamesSql(
  entityAlias: string,
  teamTable: 'portfolio_project_team' | 'portfolio_request_team',
  teamAlias: string,
  entityColumn: 'project_id' | 'request_id',
): string {
  return `COALESCE((
    SELECT string_agg(contributor.name, ', ' ORDER BY contributor.name)
    FROM (
      SELECT DISTINCT ${buildUserNameSql('u_tm')} AS name
      FROM ${teamTable} ${teamAlias}
      JOIN users u_tm ON u_tm.id = ${teamAlias}.user_id AND u_tm.tenant_id = ${entityAlias}.tenant_id
      WHERE ${teamAlias}.${entityColumn} = ${entityAlias}.id
        AND ${teamAlias}.tenant_id = ${entityAlias}.tenant_id
    ) contributor
  ), '')`;
}

function buildApplicationOwnerNamesSql(alias: string, ownerType: 'business' | 'it'): string {
  return `COALESCE((
    SELECT string_agg(owner.name, ', ' ORDER BY owner.name)
    FROM (
      SELECT DISTINCT ${buildUserNameSql('u_owner')} AS name
      FROM application_owners ao
      JOIN users u_owner ON u_owner.id = ao.user_id AND u_owner.tenant_id = ${alias}.tenant_id
      WHERE ao.application_id = ${alias}.id
        AND ao.tenant_id = ${alias}.tenant_id
        AND ao.owner_type = '${ownerType}'
    ) owner
  ), '')`;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toMetadataScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return toIso(value);
  }
  return String(value);
}

function buildRef(type: AiSearchEntityType | AiContextEntityType, itemNumber?: number | null): string | null {
  if (!itemNumber) return null;
  if (type === 'projects') return `PRJ-${itemNumber}`;
  if (type === 'requests') return `REQ-${itemNumber}`;
  if (type === 'tasks') return `T-${itemNumber}`;
  if (type === 'documents') return `DOC-${itemNumber}`;
  if (type === 'incidents') return `INC-${itemNumber}`;
  if (type === 'spend_items') return `OPX-${itemNumber}`;
  if (type === 'capex_items') return `CPX-${itemNumber}`;
  return null;
}

function toSummary(
  type: AiSearchEntityType | AiContextEntityType,
  row: SearchRow,
  matchContext?: string | null,
): AiEntitySummaryDto {
  const explicitRef = row.ref ?? row.item_ref ?? null;
  return {
    type,
    id: row.id,
    ref: explicitRef ? String(explicitRef) : buildRef(type, row.item_number ?? null),
    label: row.label,
    status: row.status ?? null,
    summary: row.summary ?? null,
    updated_at: toIso(row.updated_at),
    match_context: matchContext ?? null,
    metadata: row.metadata ?? null,
  };
}

function toContextEntityBase(
  type: AiContextEntityType,
  row: SearchRow,
  matchContext?: string | null,
): Omit<AiEntitySummaryDto, 'metadata'> {
  const { metadata: _metadata, ...entity } = toSummary(type, row, matchContext);
  return entity;
}

function personDisplayName(row: any): string | null {
  if (!row) return null;
  if (typeof row === 'string') {
    const trimmed = row.trim();
    return trimmed || null;
  }
  const combined = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return combined || row.name || row.email || null;
}

function toPersonMetadata(row: any): { id: string | null; name: string | null; email: string | null } {
  return {
    id: row?.id ?? row?.user_id ?? null,
    name: personDisplayName(row),
    email: row?.email ?? null,
  };
}

function getIntegratedDocumentSlotLabel(slotKey: string | null | undefined): string | null {
  switch (slotKey) {
    case 'purpose':
      return 'Purpose';
    case 'risks_mitigations':
      return 'Risks & Mitigations';
    default:
      return slotKey ? slotKey.replace(/_/g, ' ') : null;
  }
}

function formatActivityFieldName(field: string): string {
  return field
    .replace(/_ids?$/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function summarizeActivityChangedFields(changedFields: unknown): string | null {
  if (!changedFields || typeof changedFields !== 'object' || Array.isArray(changedFields)) {
    return null;
  }

  const record = changedFields as Record<string, unknown>;
  const statusChange = record.status;
  if (Array.isArray(statusChange) && statusChange.length >= 2) {
    const nextStatus = toMetadataScalar(statusChange[1]);
    if (nextStatus != null) {
      return `Status changed to ${nextStatus}`;
    }
  }

  // Managed document edit: the activity stores the slot key, not a sentence.
  const documentUpdate = record.document_updated;
  if (Array.isArray(documentUpdate) && documentUpdate.length >= 2) {
    const slotLabel = getIntegratedDocumentSlotLabel(
      documentUpdate[1] == null ? null : String(documentUpdate[1]),
    );
    if (slotLabel) {
      return `Document updated: ${slotLabel}`;
    }
  }

  const fieldNames = Object.keys(record)
    .map((field) => formatActivityFieldName(field))
    .filter((field) => field.length > 0);
  if (fieldNames.length === 0) {
    return null;
  }

  const visibleFields = fieldNames.slice(0, 3).join(', ');
  return fieldNames.length > 3
    ? `Changed ${visibleFields}, and more`
    : `Changed ${visibleFields}`;
}

function buildActivitySummary(row: ContextActivityRow): string | null {
  if (row.type === 'comment') {
    return row.content ? 'Comment added' : 'Comment activity';
  }
  if (row.type === 'decision') {
    const outcome = row.decision_outcome ? `Decision: ${String(row.decision_outcome).replace(/_/g, ' ')}` : 'Decision recorded';
    const changeSummary = summarizeActivityChangedFields(row.changed_fields);
    return changeSummary ? `${outcome}. ${changeSummary}` : outcome;
  }
  return summarizeActivityChangedFields(row.changed_fields);
}

function toRecentActivityMetadata(row: ContextActivityRow): Record<string, string | number | boolean | null> {
  return {
    type: toMetadataScalar(row.type),
    author: toMetadataScalar(row.author_name),
    content: toMetadataScalar(row.content),
    context: toMetadataScalar(row.context),
    decision_outcome: toMetadataScalar(row.decision_outcome),
    summary: toMetadataScalar(buildActivitySummary(row)),
    created_at: toMetadataScalar(toIso(row.created_at)),
    updated_at: toMetadataScalar(toIso(row.updated_at)),
  };
}

function toEntityCommentDto(row: EntityCommentRow): AiEntityCommentDto {
  const updatedAt = toIso(row.updated_at);
  const createdAt = toIso(row.created_at);
  return {
    author: row.author_name ?? null,
    content: row.content ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    edited: updatedAt != null && createdAt !== updatedAt,
  };
}

function toProjectPhaseMetadata(row: any): Record<string, string | number | boolean | null> {
  return {
    name: toMetadataScalar(row.name),
    status: toMetadataScalar(row.status),
    sequence: toNullableNumber(row.sequence),
    planned_start: toMetadataScalar(toIso(row.planned_start)),
    planned_end: toMetadataScalar(toIso(row.planned_end)),
    task_count: toNullableNumber(row.task_count),
  };
}

function toTaskPhaseMetadata(row: any): Record<string, string | number | boolean | null> | null {
  if (!row?.phase_name) {
    return null;
  }

  return {
    name: toMetadataScalar(row.phase_name),
    status: toMetadataScalar(row.phase_status),
    sequence: toNullableNumber(row.phase_sequence),
    planned_start: toMetadataScalar(toIso(row.phase_planned_start)),
    planned_end: toMetadataScalar(toIso(row.phase_planned_end)),
  };
}

function toProjectTaskSummary(row: any): AiEntitySummaryDto {
  return toSummary('tasks', {
    id: row.id,
    item_number: row.item_number,
    label: row.label,
    summary: row.summary ?? null,
    status: row.status ?? null,
    updated_at: row.updated_at ?? null,
    metadata: {
      assignee: toMetadataScalar(row.assignee_name),
      priority: toMetadataScalar(row.priority_level),
      phase: toMetadataScalar(row.phase_name),
    },
  });
}

function toIntegratedDocumentSummary(row: any): AiEntitySummaryDto {
  const slotLabel = getIntegratedDocumentSlotLabel(row.slot_key);
  return toSummary('documents', {
    id: row.id,
    item_number: row.item_number,
    label: row.label,
    summary: row.summary ?? null,
    status: row.status ?? null,
    updated_at: row.updated_at ?? null,
    metadata: {
      integrated: true,
      special_status: 'integrated_document',
      slot_key: toMetadataScalar(row.slot_key),
      slot_label: toMetadataScalar(slotLabel),
      hidden_from_entity_knowledge: row.hidden_from_entity_knowledge === true,
      library: toMetadataScalar(row.library_name),
      type: toMetadataScalar(row.document_type_name),
    },
  });
}

/**
 * Feature flag for the unified `search_index` path (Phase B of
 * planning/search-revamp.md). Defaults to enabled; set
 * AI_SEARCH_INDEX_ENABLED=false to fall back to the legacy per-entity-type
 * SQL searches for one release while the new path soaks in QA.
 */
function aiSearchIndexEnabled(): boolean {
  return process.env.AI_SEARCH_INDEX_ENABLED !== 'false';
}

// Indexed-path ref parsing. Superset of parseNumericPrefix: also accepts the
// OPX prefix that the OPEX revamp renders for spend items. The query prefix is
// only used to PRIORITIZE the matching entity type (score tier 4); the bare
// digits still match every type's ref_number, like the legacy path did.
const INDEXED_REF_QUERY_RE = /^(PRJ|REQ|T|DOC|APP|AST|CONN|INT|LOC|CTR|CPX|SI|OPX|COMP|CONT|DEPT|SUP|BP|INC)-?(\d+)$/i;

const QUERY_PREFIX_TO_INDEX_REF_PREFIX: Record<string, string> = {
  SI: 'OPX',
};

const PARTICIPATION_SCOPE_SOURCE_TABLE: Record<ParticipationScopedAiEntityType, string> = {
  applications: 'applications',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  tasks: 'tasks',
};

// Per-type metadata DTO shape on the indexed path — mirrors the inline
// metadata objects the legacy searchXxx() helpers build, sourced from
// search_index.extra_json. Types absent here return metadata: null.
// Budget lines: `analytics` is "Nature de coût: Matériel; Récurrence: Récurrent", the values they
// hold on the enabled dimensions of their type (migration 1853940000000), null when none.
const SEARCH_INDEX_METADATA_KEYS: Partial<Record<AiSearchEntityType, string[]>> = {
  accounts: ['coa_code'],
  applications: [
    'lifecycle', 'criticality', 'cyber_criticality', 'recovery_wave', 'rto_minutes', 'rpo_minutes', 'category', 'hosting_model', 'data_class',
    'version', 'supplier', 'business_owner', 'it_owner',
  ],
  business_processes: ['primary_category'],
  capex_items: ['paying_company', 'supplier', 'analytics'],
  companies: ['base_currency'],
  connections: ['source', 'destination'],
  contacts: ['supplier'],
  contracts: ['company', 'supplier'],
  departments: ['company'],
  incidents: ['severity', 'category'],
  interfaces: ['source_application', 'target_application', 'business_process'],
  projects: ['business_lead', 'it_lead', 'contributors'],
  requests: ['requestor', 'business_lead', 'it_lead', 'contributors'],
  spend_items: ['supplier', 'paying_company', 'account', 'contract', 'analytics'],
  suppliers: ['erp_supplier_id'],
  tasks: ['assignee', 'creator'],
  users: [
    'email', 'job_title', 'primary_role', 'company', 'department', 'locale',
    'team', 'contributor_profile', 'project_availability', 'areas_of_expertise',
  ],
};

function appendParticipationScopeSql(
  entityType: ParticipationScopedAiEntityType,
  alias: string,
  params: unknown[],
  accessScope?: { userId: string },
): string {
  if (!accessScope) return '';
  params.push(accessScope.userId);
  return `AND ${participantConditionForAiEntity(entityType, alias, `$${params.length}`)}`;
}

function appendNullableParticipationScopeSql(
  entityType: ParticipationScopedAiEntityType,
  alias: string,
  params: unknown[],
  accessScope?: { userId: string },
): string {
  if (!accessScope) return '';
  params.push(accessScope.userId);
  return `AND (${alias}.id IS NULL OR ${participantConditionForAiEntity(entityType, alias, `$${params.length}`)})`;
}

@Injectable()
export class AiEntityService {
  private readonly logger = new Logger(AiEntityService.name);

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly policy: AiPolicyService,
  ) {}

  private parseNumericRef(query: string): number | null {
    const numericPrefix = this.parseNumericPrefix(query);
    if (!numericPrefix) return null;
    const value = Number(numericPrefix);
    return Number.isSafeInteger(value) ? value : null;
  }

  private parseNumericPrefix(query: string): string | null {
    const trimmed = String(query || '').trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(?:PRJ|REQ|T|DOC|APP|AST|CONN|INT|LOC|CTR|CPX|SI|COMP|CONT|DEPT|SUP|BP|INC)-?(\d+)$/i)
      ?? trimmed.match(/^(\d+)$/);
    if (!match) return null;
    const digits = match[1];
    return digits && Number.isSafeInteger(Number(digits)) ? digits : null;
  }

  private async listRecentActivity(
    manager: AiExecutionContextWithManager['manager'],
    params: {
      tenantId: string;
      projectId?: string;
      taskId?: string;
    },
  ): Promise<{ items: Array<Record<string, string | number | boolean | null>>; total: number }> {
    const targetColumn = params.projectId ? 'project_id' : 'task_id';
    const targetId = params.projectId ?? params.taskId;
    if (!targetId) {
      return { items: [], total: 0 };
    }

    const rows = await manager.query<ContextActivityRow[]>(
      `SELECT a.type,
              a.content,
              a.context,
              a.decision_outcome,
              a.changed_fields,
              ${buildUserNameSql('u_author')} AS author_name,
              a.created_at,
              a.updated_at,
              COUNT(*) OVER()::int AS total_count
       FROM portfolio_activities a
       LEFT JOIN users u_author ON u_author.id = a.author_id AND u_author.tenant_id = a.tenant_id
       WHERE a.${targetColumn} = $1
         AND a.tenant_id = $2
       ORDER BY a.created_at DESC
       LIMIT 20`,
      [targetId, params.tenantId],
    );

    const total = rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0;
    return {
      items: rows.map((row) => toRecentActivityMetadata(row)),
      total,
    };
  }

  private async listIntegratedDocuments(
    manager: AiExecutionContextWithManager['manager'],
    params: {
      tenantId: string;
      sourceEntityType: 'projects';
      sourceEntityId: string;
      userId: string | null;
    },
  ): Promise<AiEntitySummaryDto[]> {
    // §3.7 point 6: the entity-context tool applies the same document filter as
    // the Knowledge lists — library ACL plus the incident rules for bound reviews.
    const accessibleLibraries = await this.knowledge.listReadableLibraryIdsForUser(
      manager,
      params.userId,
    );
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return [];
    }
    const queryParams: unknown[] = [params.sourceEntityType, params.sourceEntityId, params.tenantId];
    let libraryClause = '';
    if (accessibleLibraries) {
      queryParams.push(accessibleLibraries);
      libraryClause = ` AND d.library_id = ANY($${queryParams.length}::uuid[])`;
    }
    const incidentClause = documentIncidentVisibilitySql(
      'd',
      await resolveDocumentIncidentViewer(manager, params.userId, params.tenantId),
      queryParams,
    );

    const rows = await manager.query<SearchRow[]>(
      `SELECT d.id,
              d.item_number,
              d.title AS label,
              d.summary,
              d.status,
              d.updated_at,
              b.slot_key,
              b.hidden_from_entity_knowledge,
              dl.name AS library_name,
              dt.name AS document_type_name
       FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
       LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id AND dt.tenant_id = d.tenant_id
       WHERE b.source_entity_type = $1
         AND b.source_entity_id = $2
         AND b.tenant_id = $3
         ${libraryClause}
         ${incidentClause}
       ORDER BY b.slot_key ASC, d.updated_at DESC`,
      queryParams,
    );

    return rows.map((row) => toIntegratedDocumentSummary(row));
  }

  private async searchApplications(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const numericPrefix = this.parseNumericPrefix(query);
    const businessOwnerNamesSql = buildApplicationOwnerNamesSql('a', 'business');
    const itOwnerNamesSql = buildApplicationOwnerNamesSql('a', 'it');
    const params: unknown[] = [numericPrefix, like, context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'applications');
    const accessScopeSql = appendParticipationScopeSql('applications', 'a', params, accessScope);
    params.push(limit);
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT a.id,
              a.sequential_id AS item_ref,
              a.name AS label,
              a.description AS summary,
              a.status,
              a.updated_at,
              a.lifecycle,
              a.criticality, a.cyber_criticality, a.recovery_wave, a.rto_minutes, a.rpo_minutes,
              a.category,
              a.hosting_model,
              a.data_class,
              a.version,
              s.name AS supplier_name,
              ${businessOwnerNamesSql} AS business_owner_names,
              ${itOwnerNamesSql} AS it_owner_names,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN $1::text IS NOT NULL AND UPPER(COALESCE(a.sequential_id, '')) = 'APP-' || $1 THEN 4
                WHEN $1::text IS NOT NULL AND COALESCE(a.sequential_id, '') ILIKE 'APP-' || $1 || '%' THEN 3.5
                WHEN a.name ILIKE $2 THEN 3
                WHEN COALESCE(a.description, '') ILIKE $2 THEN 2
                ELSE 1
              END AS score
       FROM applications a
       LEFT JOIN suppliers s ON s.id = a.supplier_id AND s.tenant_id = $3
       WHERE a.tenant_id = $3
         AND (
           ($1::text IS NOT NULL AND UPPER(COALESCE(a.sequential_id, '')) = 'APP-' || $1)
           OR ($1::text IS NOT NULL AND COALESCE(a.sequential_id, '') ILIKE 'APP-' || $1 || '%')
           OR COALESCE(a.sequential_id, '') ILIKE $2
           OR a.name ILIKE $2
           OR COALESCE(a.description, '') ILIKE $2
           OR COALESCE(a.editor, '') ILIKE $2
           OR COALESCE(a.notes, '') ILIKE $2
           OR COALESCE(a.support_notes, '') ILIKE $2
           OR COALESCE(a.licensing, '') ILIKE $2
           OR COALESCE(a.version, '') ILIKE $2
           OR COALESCE(a.category, '') ILIKE $2
           OR COALESCE(a.lifecycle, '') ILIKE $2
           OR COALESCE(a.criticality, '') ILIKE $2
           OR COALESCE(a.status::text, '') ILIKE $2
           OR COALESCE(a.data_class, '') ILIKE $2
           OR COALESCE(a.hosting_model, '') ILIKE $2
           OR COALESCE(s.name, '') ILIKE $2
           OR ${businessOwnerNamesSql} ILIKE $2
           OR ${itOwnerNamesSql} ILIKE $2
         )
         ${accessScopeSql}
       ORDER BY score DESC,
                CASE
                  WHEN $1::text IS NOT NULL
                    AND COALESCE(a.sequential_id, '') ILIKE 'APP-' || $1 || '%'
                    AND COALESCE(a.sequential_id, '') ~ '^APP-[0-9]+$'
                  THEN NULLIF(regexp_replace(a.sequential_id, '^APP-', ''), '')::int
                  ELSE NULL
                END ASC NULLS LAST,
                a.updated_at DESC,
                a.name ASC
       LIMIT $${params.length}`,
      params,
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('applications', {
          ...row,
          metadata: {
            lifecycle: row.lifecycle ?? null,
            criticality: row.criticality ?? null,
            cyber_criticality: row.cyber_criticality ?? null,
            recovery_wave: row.recovery_wave ?? null,
            rto_minutes: row.rto_minutes ?? null,
            rpo_minutes: row.rpo_minutes ?? null,
            category: row.category ?? null,
            hosting_model: row.hosting_model ?? null,
            data_class: row.data_class ?? null,
            version: row.version ?? null,
            supplier: row.supplier_name ?? null,
            business_owner: row.business_owner_names || null,
            it_owner: row.it_owner_names || null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchAssets(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const numericPrefix = this.parseNumericPrefix(query);
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT a.id,
              a.asset_reference AS item_ref,
              a.name AS label,
              COALESCE(a.fqdn, a.hostname, a.notes) AS summary,
              a.status,
              a.updated_at,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN $1::text IS NOT NULL AND UPPER(COALESCE(a.asset_reference, '')) = 'AST-' || $1 THEN 4
                WHEN $1::text IS NOT NULL AND COALESCE(a.asset_reference, '') ILIKE 'AST-' || $1 || '%' THEN 3.5
                WHEN a.name ILIKE $2 THEN 3
                WHEN COALESCE(a.fqdn, '') ILIKE $2 OR COALESCE(a.hostname, '') ILIKE $2 THEN 2
                ELSE 1
              END AS score
       FROM assets a
       WHERE a.tenant_id = $3
         AND (
           ($1::text IS NOT NULL AND UPPER(COALESCE(a.asset_reference, '')) = 'AST-' || $1)
           OR ($1::text IS NOT NULL AND COALESCE(a.asset_reference, '') ILIKE 'AST-' || $1 || '%')
           OR COALESCE(a.asset_reference, '') ILIKE $2
           OR a.name ILIKE $2
           OR COALESCE(a.fqdn, '') ILIKE $2
           OR COALESCE(a.hostname, '') ILIKE $2
           OR COALESCE(a.notes, '') ILIKE $2
           OR COALESCE(a.domain, '') ILIKE $2
           OR COALESCE(a.cluster, '') ILIKE $2
           OR COALESCE(a.operating_system, '') ILIKE $2
           OR COALESCE(a.kind, '') ILIKE $2
           OR COALESCE(a.provider, '') ILIKE $2
           OR COALESCE(a.environment, '') ILIKE $2
           OR COALESCE(a.region, '') ILIKE $2
           OR COALESCE(a.zone, '') ILIKE $2
           OR COALESCE(a.status::text, '') ILIKE $2
           OR EXISTS (SELECT 1 FROM unnest(a.aliases) AS alias WHERE alias ILIKE $2)
         )
       ORDER BY score DESC,
                CASE
                  WHEN $1::text IS NOT NULL
                    AND COALESCE(a.asset_reference, '') ILIKE 'AST-' || $1 || '%'
                    AND COALESCE(a.asset_reference, '') ~ '^AST-[0-9]+$'
                  THEN NULLIF(regexp_replace(a.asset_reference, '^AST-', ''), '')::int
                  ELSE NULL
                END ASC NULLS LAST,
                a.updated_at DESC,
                a.name ASC
       LIMIT $4`,
      [numericPrefix, like, context.tenantId, limit],
    );

    return {
      items: rows.map((row) => ({ ...toSummary('assets', row, row.summary), _score: row.score ?? 1 })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchSpendItems(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT si.id,
              si.item_number,
              si.product_name AS label,
              COALESCE(
                NULLIF(si.description, ''),
                NULLIF(CONCAT_WS(' | ', sup.name, comp.name, NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), '')), '')
              ) AS summary,
              si.status,
              si.updated_at,
              sup.name AS supplier_name,
              comp.name AS company_name,
              NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), '') AS account_display,
              lc.contract_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN si.product_name ILIKE $1 THEN 3
                WHEN COALESCE(sup.name, '') ILIKE $1 OR COALESCE(comp.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM spend_items si
       LEFT JOIN suppliers sup ON sup.id = si.supplier_id AND sup.tenant_id = si.tenant_id
       LEFT JOIN companies comp ON comp.id = si.paying_company_id AND comp.tenant_id = si.tenant_id
       LEFT JOIN accounts acc ON acc.id = si.account_id AND acc.tenant_id = si.tenant_id
       LEFT JOIN LATERAL (
         SELECT c.name AS contract_name
         FROM contract_spend_items csi
         JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
         WHERE csi.spend_item_id = si.id
         ORDER BY csi.created_at DESC
         LIMIT 1
       ) lc ON TRUE
       WHERE si.tenant_id = $2 AND si.nature = 'opex'
         AND (
           si.product_name ILIKE $1
           OR COALESCE(si.description, '') ILIKE $1
           OR COALESCE(sup.name, '') ILIKE $1
           OR COALESCE(comp.name, '') ILIKE $1
           OR COALESCE(acc.account_name, '') ILIKE $1
           OR COALESCE(acc.account_number::text, '') ILIKE $1
           OR COALESCE(lc.contract_name, '') ILIKE $1
           OR COALESCE(si.currency, '') ILIKE $1
           OR COALESCE(si.notes, '') ILIKE $1
         )
       ORDER BY score DESC, si.updated_at DESC, si.product_name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('spend_items', {
          ...row,
          metadata: {
            supplier: row.supplier_name ?? null,
            paying_company: row.company_name ?? null,
            account: row.account_display ?? null,
            contract: row.contract_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchContracts(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT c.id,
              NULL::int AS item_number,
              c.name AS label,
              COALESCE(NULLIF(c.notes, ''), NULLIF(CONCAT_WS(' | ', comp.name, sup.name), '')) AS summary,
              c.status,
              c.updated_at,
              comp.name AS company_name,
              sup.name AS supplier_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN c.name ILIKE $1 THEN 3
                WHEN COALESCE(comp.name, '') ILIKE $1 OR COALESCE(sup.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM contracts c
       LEFT JOIN companies comp ON comp.id = c.company_id AND comp.tenant_id = c.tenant_id
       LEFT JOIN suppliers sup ON sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id
       WHERE c.tenant_id = $2
         AND (
           c.name ILIKE $1
           OR COALESCE(c.notes, '') ILIKE $1
           OR COALESCE(comp.name, '') ILIKE $1
           OR COALESCE(sup.name, '') ILIKE $1
           OR COALESCE(c.currency, '') ILIKE $1
           OR COALESCE(c.billing_frequency, '') ILIKE $1
         )
       ORDER BY score DESC, c.updated_at DESC, c.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('contracts', {
          ...row,
          metadata: {
            company: row.company_name ?? null,
            supplier: row.supplier_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchCompanies(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT c.id,
              NULL::int AS item_number,
              c.name AS label,
              NULLIF(CONCAT_WS(', ', c.city, c.country_iso), '') AS summary,
              c.status,
              c.updated_at,
              c.base_currency,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN c.name ILIKE $1 THEN 3
                WHEN COALESCE(c.city, '') ILIKE $1 OR COALESCE(c.country_iso, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM companies c
       WHERE c.tenant_id = $2
         AND (
           c.name ILIKE $1
           OR COALESCE(c.country_iso, '') ILIKE $1
           OR COALESCE(c.city, '') ILIKE $1
           OR COALESCE(c.address1, '') ILIKE $1
           OR COALESCE(c.address2, '') ILIKE $1
           OR COALESCE(c.postal_code, '') ILIKE $1
           OR COALESCE(c.reg_number, '') ILIKE $1
           OR COALESCE(c.vat_number, '') ILIKE $1
           OR COALESCE(c.base_currency, '') ILIKE $1
           OR COALESCE(c.notes, '') ILIKE $1
         )
       ORDER BY score DESC, c.updated_at DESC, c.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('companies', {
          ...row,
          metadata: {
            base_currency: row.base_currency ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchSuppliers(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT s.id,
              NULL::int AS item_number,
              s.name AS label,
              COALESCE(NULLIF(s.notes, ''), s.erp_supplier_id) AS summary,
              s.status,
              s.updated_at,
              s.erp_supplier_id,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN s.name ILIKE $1 THEN 3
                WHEN COALESCE(s.erp_supplier_id, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM suppliers s
       WHERE s.tenant_id = $2
         AND (
           s.name ILIKE $1
           OR COALESCE(s.erp_supplier_id, '') ILIKE $1
           OR COALESCE(s.notes, '') ILIKE $1
         )
       ORDER BY score DESC, s.updated_at DESC, s.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('suppliers', {
          ...row,
          metadata: {
            erp_supplier_id: row.erp_supplier_id ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchDepartments(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT d.id,
              NULL::int AS item_number,
              d.name AS label,
              COALESCE(NULLIF(d.description, ''), comp.name) AS summary,
              d.status,
              d.updated_at,
              comp.name AS company_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN d.name ILIKE $1 THEN 3
                WHEN COALESCE(comp.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM departments d
       LEFT JOIN companies comp ON comp.id = d.company_id AND comp.tenant_id = d.tenant_id
       WHERE d.tenant_id = $2
         AND (
           d.name ILIKE $1
           OR COALESCE(d.description, '') ILIKE $1
           OR COALESCE(comp.name, '') ILIKE $1
           OR COALESCE(d.status::text, '') ILIKE $1
         )
       ORDER BY score DESC, d.updated_at DESC, d.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('departments', {
          ...row,
          metadata: {
            company: row.company_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchLocations(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT ranked.id,
              ranked.label,
              ranked.summary,
              ranked.status,
              ranked.updated_at,
              ranked.score,
              COUNT(*) OVER()::int AS total_count
       FROM (
         SELECT DISTINCT ON (l.id) l.id,
                l.location_reference || ' — ' || l.name AS label,
                COALESCE(NULLIF(l.city, ''), l.country_iso) AS summary,
                NULL::text AS status,
                l.updated_at,
                CASE
                  WHEN l.name ILIKE $1 THEN 3
                  WHEN l.location_reference ILIKE $1 THEN 3
                  WHEN COALESCE(l.city, '') ILIKE $1 THEN 2
                  WHEN sl.name IS NOT NULL THEN 2
                  ELSE 1
                END AS score
         FROM locations l
         LEFT JOIN location_sub_items sl
           ON sl.location_id = l.id AND sl.tenant_id = l.tenant_id
           AND (sl.name ILIKE $1 OR COALESCE(sl.description, '') ILIKE $1)
         WHERE l.tenant_id = $2
           AND (
             l.location_reference ILIKE $1
             OR l.name ILIKE $1
             OR COALESCE(l.city, '') ILIKE $1
             OR COALESCE(l.country_iso, '') ILIKE $1
             OR COALESCE(l.provider, '') ILIKE $1
             OR COALESCE(l.hosting_type, '') ILIKE $1
             OR sl.id IS NOT NULL
           )
         ORDER BY l.id, score DESC
       ) ranked
       ORDER BY ranked.score DESC, ranked.updated_at DESC, ranked.label ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row) => ({ ...toSummary('locations', row, row.summary), _score: row.score ?? 1 })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchProjects(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const ref = this.parseNumericRef(query);
    const numericPrefix = this.parseNumericPrefix(query);
    const summarySql = buildProjectSummarySql('p');
    const contributorNamesSql = buildContributorNamesSql('p', 'portfolio_project_team', 'pt', 'project_id');
    const params: unknown[] = [ref, numericPrefix, like, context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'projects');
    const accessScopeSql = appendParticipationScopeSql('projects', 'p', params, accessScope);
    params.push(limit);
    const limitRef = `$${params.length}`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT p.id,
              p.item_number,
              p.name AS label,
              ${summarySql} AS summary,
              p.status,
              p.updated_at,
              ${buildUserNameSql('u_bl')} AS business_lead_name,
              ${buildUserNameSql('u_il')} AS it_lead_name,
              ${contributorNamesSql} AS contributor_names,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN $1::int IS NOT NULL AND p.item_number = $1 THEN 4
                WHEN $2::text IS NOT NULL AND p.item_number::text LIKE $2 || '%' THEN 3.5
                WHEN p.name ILIKE $3 THEN 3
                ELSE 1
              END AS score
       FROM portfolio_projects p
       LEFT JOIN portfolio_categories pc ON pc.id = p.category_id AND pc.tenant_id = $4
       LEFT JOIN portfolio_streams ps ON ps.id = p.stream_id AND ps.tenant_id = $4
       LEFT JOIN companies co ON co.id = p.company_id AND co.tenant_id = $4
       LEFT JOIN departments dep ON dep.id = p.department_id AND dep.tenant_id = $4
       LEFT JOIN users u_bs ON u_bs.id = p.business_sponsor_id AND u_bs.tenant_id = p.tenant_id
       LEFT JOIN users u_bl ON u_bl.id = p.business_lead_id AND u_bl.tenant_id = p.tenant_id
       LEFT JOIN users u_is ON u_is.id = p.it_sponsor_id AND u_is.tenant_id = p.tenant_id
       LEFT JOIN users u_il ON u_il.id = p.it_lead_id AND u_il.tenant_id = p.tenant_id
       WHERE p.tenant_id = $4
         ${accessScopeSql}
         AND (
           ($1::int IS NOT NULL AND p.item_number = $1)
           OR ($2::text IS NOT NULL AND p.item_number::text LIKE $2 || '%')
           OR p.name ILIKE $3
           OR COALESCE(p.origin, '') ILIKE $3
           OR COALESCE(p.status::text, '') ILIKE $3
           OR COALESCE(p.override_justification, '') ILIKE $3
           OR COALESCE(pc.name, '') ILIKE $3
           OR COALESCE(ps.name, '') ILIKE $3
           OR COALESCE(co.name, '') ILIKE $3
           OR COALESCE(dep.name, '') ILIKE $3
           OR ${buildUserNameSql('u_bs')} ILIKE $3
           OR ${buildUserNameSql('u_bl')} ILIKE $3
           OR ${buildUserNameSql('u_is')} ILIKE $3
           OR ${buildUserNameSql('u_il')} ILIKE $3
           OR EXISTS (
             SELECT 1
             FROM portfolio_project_team pt
             JOIN users u_tm ON u_tm.id = pt.user_id AND u_tm.tenant_id = p.tenant_id
             WHERE pt.project_id = p.id
               AND pt.tenant_id = p.tenant_id
               AND ${buildUserNameSql('u_tm')} ILIKE $3
           )
         )
       ORDER BY score DESC,
                CASE WHEN $2::text IS NOT NULL AND p.item_number::text LIKE $2 || '%' THEN p.item_number ELSE NULL END ASC NULLS LAST,
                p.updated_at DESC,
                p.name ASC
       LIMIT ${limitRef}`,
      params,
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('projects', {
          ...row,
          metadata: {
            business_lead: row.business_lead_name || null,
            it_lead: row.it_lead_name || null,
            contributors: row.contributor_names || null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchRequests(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const ref = this.parseNumericRef(query);
    const numericPrefix = this.parseNumericPrefix(query);
    const summarySql = buildRequestSummarySql('r');
    const contributorNamesSql = buildContributorNamesSql('r', 'portfolio_request_team', 'rt', 'request_id');
    const params: unknown[] = [ref, numericPrefix, like, context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'requests');
    const accessScopeSql = appendParticipationScopeSql('requests', 'r', params, accessScope);
    params.push(limit);
    const limitRef = `$${params.length}`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT r.id,
              r.item_number,
              r.name AS label,
              ${summarySql} AS summary,
              r.status,
              r.updated_at,
              ${buildUserNameSql('u_req')} AS requestor_name,
              ${buildUserNameSql('u_bl')} AS business_lead_name,
              ${buildUserNameSql('u_il')} AS it_lead_name,
              ${contributorNamesSql} AS contributor_names,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN $1::int IS NOT NULL AND r.item_number = $1 THEN 4
                WHEN $2::text IS NOT NULL AND r.item_number::text LIKE $2 || '%' THEN 3.5
                WHEN r.name ILIKE $3 THEN 3
                ELSE 1
              END AS score
       FROM portfolio_requests r
       LEFT JOIN portfolio_categories pc ON pc.id = r.category_id AND pc.tenant_id = $4
       LEFT JOIN portfolio_streams ps ON ps.id = r.stream_id AND ps.tenant_id = $4
       LEFT JOIN companies co ON co.id = r.company_id AND co.tenant_id = $4
       LEFT JOIN departments dep ON dep.id = r.department_id AND dep.tenant_id = $4
       LEFT JOIN users u_req ON u_req.id = r.requestor_id AND u_req.tenant_id = r.tenant_id
       LEFT JOIN users u_bs ON u_bs.id = r.business_sponsor_id AND u_bs.tenant_id = r.tenant_id
       LEFT JOIN users u_bl ON u_bl.id = r.business_lead_id AND u_bl.tenant_id = r.tenant_id
       LEFT JOIN users u_is ON u_is.id = r.it_sponsor_id AND u_is.tenant_id = r.tenant_id
       LEFT JOIN users u_il ON u_il.id = r.it_lead_id AND u_il.tenant_id = r.tenant_id
       WHERE r.tenant_id = $4
         ${accessScopeSql}
         AND (
           ($1::int IS NOT NULL AND r.item_number = $1)
           OR ($2::text IS NOT NULL AND r.item_number::text LIKE $2 || '%')
           OR r.name ILIKE $3
           OR COALESCE(r.current_situation, '') ILIKE $3
           OR COALESCE(r.expected_benefits, '') ILIKE $3
           OR COALESCE(r.status::text, '') ILIKE $3
           OR COALESCE(r.override_justification, '') ILIKE $3
           OR COALESCE(pc.name, '') ILIKE $3
           OR COALESCE(ps.name, '') ILIKE $3
           OR COALESCE(co.name, '') ILIKE $3
           OR COALESCE(dep.name, '') ILIKE $3
           OR ${buildUserNameSql('u_req')} ILIKE $3
           OR ${buildUserNameSql('u_bs')} ILIKE $3
           OR ${buildUserNameSql('u_bl')} ILIKE $3
           OR ${buildUserNameSql('u_is')} ILIKE $3
           OR ${buildUserNameSql('u_il')} ILIKE $3
           OR EXISTS (
             SELECT 1
             FROM portfolio_request_team rt
             JOIN users u_tm ON u_tm.id = rt.user_id AND u_tm.tenant_id = r.tenant_id
             WHERE rt.request_id = r.id
               AND rt.tenant_id = r.tenant_id
               AND ${buildUserNameSql('u_tm')} ILIKE $3
           )
         )
       ORDER BY score DESC,
                CASE WHEN $2::text IS NOT NULL AND r.item_number::text LIKE $2 || '%' THEN r.item_number ELSE NULL END ASC NULLS LAST,
                r.updated_at DESC,
                r.name ASC
       LIMIT ${limitRef}`,
      params,
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('requests', {
          ...row,
          metadata: {
            requestor: row.requestor_name || null,
            business_lead: row.business_lead_name || null,
            it_lead: row.it_lead_name || null,
            contributors: row.contributor_names || null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchTasks(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const ref = this.parseNumericRef(query);
    const numericPrefix = this.parseNumericPrefix(query);
    const params: unknown[] = [ref, numericPrefix, like, context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'tasks');
    const accessScopeSql = appendParticipationScopeSql('tasks', 't', params, accessScope);
    params.push(limit);
    const limitRef = `$${params.length}`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT t.id,
              t.item_number,
              COALESCE(t.title, 'Untitled task') AS label,
              t.description AS summary,
              t.status,
              t.updated_at,
              ${buildUserNameSql('u_assign')} AS assignee_name,
              ${buildUserNameSql('u_creator')} AS creator_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN $1::int IS NOT NULL AND t.item_number = $1 THEN 4
                WHEN $2::text IS NOT NULL AND t.item_number::text LIKE $2 || '%' THEN 3.5
                WHEN COALESCE(t.title, '') ILIKE $3 THEN 3
                ELSE 1
              END AS score
       FROM tasks t
       LEFT JOIN users u_assign ON u_assign.id = t.assignee_user_id AND u_assign.tenant_id = t.tenant_id
       LEFT JOIN users u_creator ON u_creator.id = t.creator_id AND u_creator.tenant_id = t.tenant_id
       LEFT JOIN portfolio_task_types tt ON tt.id = t.task_type_id AND tt.tenant_id = $4
       LEFT JOIN companies co ON co.id = t.company_id AND co.tenant_id = $4
       LEFT JOIN portfolio_categories pc ON pc.id = t.category_id AND pc.tenant_id = $4
       LEFT JOIN portfolio_streams ps ON ps.id = t.stream_id AND ps.tenant_id = $4
       LEFT JOIN portfolio_projects rel_proj ON rel_proj.id = t.related_object_id AND t.related_object_type = 'project' AND rel_proj.tenant_id = $4
       LEFT JOIN spend_items rel_si ON rel_si.id = t.related_object_id AND t.related_object_type = 'spend_item' AND rel_si.tenant_id = $4 AND rel_si.nature = 'opex'
       LEFT JOIN contracts rel_ct ON rel_ct.id = t.related_object_id AND t.related_object_type = 'contract' AND rel_ct.tenant_id = $4
       LEFT JOIN spend_items rel_cx ON rel_cx.id = t.related_object_id AND t.related_object_type = 'capex_item' AND rel_cx.tenant_id = $4 AND rel_cx.nature = 'capex'
       LEFT JOIN incidents rel_inc ON rel_inc.id = t.related_object_id AND t.related_object_type = 'incident' AND rel_inc.tenant_id = $4
       WHERE t.tenant_id = $4
         ${accessScopeSql}
         AND (
           ($1::int IS NOT NULL AND t.item_number = $1)
           OR ($2::text IS NOT NULL AND t.item_number::text LIKE $2 || '%')
           OR COALESCE(t.title, '') ILIKE $3
           OR COALESCE(t.description, '') ILIKE $3
           OR COALESCE(t.status::text, '') ILIKE $3
           OR COALESCE(t.priority_level, '') ILIKE $3
           OR COALESCE(t.related_object_type, '') ILIKE $3
           OR ${buildUserNameSql('u_assign')} ILIKE $3
           OR ${buildUserNameSql('u_creator')} ILIKE $3
           OR COALESCE(tt.name, '') ILIKE $3
           OR COALESCE(co.name, '') ILIKE $3
           OR COALESCE(pc.name, '') ILIKE $3
           OR COALESCE(ps.name, '') ILIKE $3
           OR COALESCE(rel_proj.name, '') ILIKE $3
           OR COALESCE(rel_si.product_name, '') ILIKE $3
           OR COALESCE(rel_ct.name, '') ILIKE $3
           OR COALESCE(rel_cx.product_name, '') ILIKE $3
           OR COALESCE(${incidentRelatedTitleSql('rel_inc')}, '') ILIKE $3
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.labels) AS lbl WHERE lbl ILIKE $3)
         )
       ORDER BY score DESC,
                CASE WHEN $2::text IS NOT NULL AND t.item_number::text LIKE $2 || '%' THEN t.item_number ELSE NULL END ASC NULLS LAST,
                t.updated_at DESC,
                t.created_at DESC
       LIMIT ${limitRef}`,
      params,
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('tasks', {
          ...row,
          metadata: {
            assignee: row.assignee_name || null,
            creator: row.creator_name || null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchUsers(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const exact = String(query || '').trim();
    const like = `%${exact}%`;
    const displayNameSql = buildUserNameSql('u');
    const expertiseSql = `COALESCE((
      SELECT string_agg(DISTINCT area.value, ', ' ORDER BY area.value)
      FROM jsonb_array_elements_text(COALESCE(tmc.areas_of_expertise, '[]'::jsonb)) area(value)
    ), '')`;
    const summarySql = `NULLIF(CONCAT_WS(' | ',
      CASE WHEN ${displayNameSql} <> u.email THEN u.email ELSE NULL END,
      NULLIF(u.job_title, ''),
      NULLIF(pt.name, ''),
      NULLIF(c.name, '')
    ), '')`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT u.id,
              NULL::int AS item_number,
              ${displayNameSql} AS label,
              ${summarySql} AS summary,
              u.status,
              u.updated_at,
              u.email,
              u.job_title,
              u.locale,
              r.role_name AS primary_role_name,
              c.name AS company_name,
              d.name AS department_name,
              pt.name AS team_name,
              CASE WHEN tmc.id IS NULL THEN 'not_configured' ELSE 'configured' END AS contributor_profile,
              tmc.project_availability,
              ${expertiseSql} AS areas_of_expertise,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN LOWER(u.email) = LOWER($1) THEN 5
                WHEN ${displayNameSql} ILIKE $2 THEN 4
                WHEN u.email ILIKE $2 THEN 3
                ELSE 1
              END AS score
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
       LEFT JOIN companies c ON c.id = u.company_id AND c.tenant_id = u.tenant_id
       LEFT JOIN departments d ON d.id = u.department_id AND d.tenant_id = u.tenant_id
       LEFT JOIN portfolio_team_member_configs tmc ON tmc.user_id = u.id AND tmc.tenant_id = u.tenant_id
       LEFT JOIN portfolio_teams pt ON pt.id = tmc.team_id AND pt.tenant_id = u.tenant_id
       WHERE u.tenant_id = $3
         AND (
           ${displayNameSql} ILIKE $2
           OR u.email ILIKE $2
           OR COALESCE(u.job_title, '') ILIKE $2
           OR COALESCE(r.role_name, '') ILIKE $2
           OR COALESCE(c.name, '') ILIKE $2
           OR COALESCE(d.name, '') ILIKE $2
           OR COALESCE(pt.name, '') ILIKE $2
           OR ${expertiseSql} ILIKE $2
         )
       ORDER BY score DESC, u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.email ASC
       LIMIT $4`,
      [exact, like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('users', {
          ...row,
          metadata: {
            email: row.email ?? null,
            job_title: row.job_title ?? null,
            primary_role: row.primary_role_name ?? null,
            company: row.company_name ?? null,
            department: row.department_name ?? null,
            locale: row.locale ?? null,
            team: row.team_name ?? null,
            contributor_profile: row.contributor_profile ?? null,
            project_availability: toNullableNumber(row.project_availability),
            areas_of_expertise: row.areas_of_expertise || null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchCapexItems(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT ci.id,
              ${lineNumberSql('ci', 'capex')} AS item_number,
              ci.product_name AS label,
              NULLIF(CONCAT_WS(' | ', comp.name, sup.name, ci.ppe_type::text, ci.investment_type), '') AS summary,
              ci.status,
              ci.updated_at,
              comp.name AS company_name,
              sup.name AS supplier_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN ci.product_name ILIKE $1 THEN 3
                WHEN COALESCE(comp.name, '') ILIKE $1 OR COALESCE(sup.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM spend_items ci
       LEFT JOIN companies comp ON comp.id = ci.paying_company_id AND comp.tenant_id = ci.tenant_id
       LEFT JOIN suppliers sup ON sup.id = ci.supplier_id AND sup.tenant_id = ci.tenant_id
       WHERE ci.tenant_id = $2 AND ci.nature = 'capex'
         AND (
           ci.product_name ILIKE $1
           OR COALESCE(ci.notes, '') ILIKE $1
           OR COALESCE(ci.ppe_type::text, '') ILIKE $1
           OR COALESCE(ci.investment_type::text, '') ILIKE $1
           OR ci.priority::text ILIKE $1
           OR COALESCE(ci.currency, '') ILIKE $1
           OR COALESCE(comp.name, '') ILIKE $1
           OR COALESCE(sup.name, '') ILIKE $1
         )
       ORDER BY score DESC, ci.updated_at DESC, ci.product_name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('capex_items', {
          ...row,
          metadata: {
            paying_company: row.company_name ?? null,
            supplier: row.supplier_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchIncidents(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const ref = this.parseNumericRef(query);
    const numericPrefix = this.parseNumericPrefix(query);
    const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
    const params: unknown[] = [ref, numericPrefix, like, context.tenantId, limit];
    const visibility = incidentVisibilitySql('i', viewer, params);
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT i.id,
              i.item_number,
              i.title AS label,
              i.description AS summary,
              i.status,
              i.updated_at,
              i.severity,
              i.category,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN $1::int IS NOT NULL AND i.item_number = $1 THEN 4
                WHEN $2::text IS NOT NULL AND i.item_number::text LIKE $2 || '%' THEN 3.5
                WHEN i.title ILIKE $3 THEN 3
                ELSE 1
              END AS score
       FROM incidents i
       LEFT JOIN integrated_document_bindings review_b
         ON review_b.tenant_id = i.tenant_id
        AND review_b.source_entity_type = '${INCIDENT_REVIEW_SLOT.sourceEntityType}'
        AND review_b.source_entity_id = i.id
        AND review_b.slot_key = '${INCIDENT_REVIEW_SLOT.slotKey}'
       LEFT JOIN documents review_d
         ON review_d.id = review_b.document_id
        AND review_d.tenant_id = review_b.tenant_id
       WHERE i.tenant_id = $4
         ${visibility}
         AND (
           ($1::int IS NOT NULL AND i.item_number = $1)
           OR ($2::text IS NOT NULL AND i.item_number::text LIKE $2 || '%')
           OR i.title ILIKE $3
           OR COALESCE(i.description, '') ILIKE $3
           OR COALESCE(review_d.content_plain, '') ILIKE $3
           OR COALESCE(i.source_ref, '') ILIKE $3
           OR COALESCE(i.severity, '') ILIKE $3
           OR COALESCE(i.status, '') ILIKE $3
           OR COALESCE(i.category, '') ILIKE $3
         )
       ORDER BY score DESC,
                CASE WHEN $2::text IS NOT NULL AND i.item_number::text LIKE $2 || '%' THEN i.item_number ELSE NULL END ASC NULLS LAST,
                i.updated_at DESC,
                i.title ASC
       LIMIT $5`,
      params,
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('incidents', {
          ...row,
          metadata: {
            severity: row.severity ?? null,
            category: row.category ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchAccounts(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT a.id,
              NULL::int AS item_number,
              NULLIF(TRIM(CONCAT_WS(' - ', a.account_number, a.account_name)), '') AS label,
              COALESCE(NULLIF(a.description, ''), NULLIF(a.native_name, ''), coa.code) AS summary,
              a.status,
              a.updated_at,
              coa.code AS coa_code,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN a.account_number::text ILIKE $1 OR a.account_name ILIKE $1 THEN 3
                WHEN COALESCE(coa.code, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM accounts a
       LEFT JOIN chart_of_accounts coa ON coa.id = a.coa_id AND coa.tenant_id = a.tenant_id
       WHERE a.tenant_id = $2
         AND (
           a.account_number::text ILIKE $1
           OR a.account_name ILIKE $1
           OR COALESCE(a.native_name, '') ILIKE $1
           OR COALESCE(a.description, '') ILIKE $1
           OR COALESCE(a.consolidation_account_name, '') ILIKE $1
           OR COALESCE(a.consolidation_account_description, '') ILIKE $1
           OR COALESCE(coa.code, '') ILIKE $1
         )
       ORDER BY score DESC, a.updated_at DESC, a.account_name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('accounts', {
          ...row,
          metadata: {
            coa_code: row.coa_code ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchChartOfAccounts(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT coa.id,
              NULL::int AS item_number,
              NULLIF(TRIM(CONCAT_WS(' - ', coa.code, coa.name)), '') AS label,
              NULLIF(CONCAT_WS(' | ', coa.scope, coa.country_iso), '') AS summary,
              NULL::text AS status,
              coa.updated_at,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN coa.code ILIKE $1 THEN 3
                WHEN coa.name ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM chart_of_accounts coa
       WHERE coa.tenant_id = $2
         AND (
           coa.code ILIKE $1
           OR coa.name ILIKE $1
           OR COALESCE(coa.country_iso, '') ILIKE $1
           OR COALESCE(coa.scope, '') ILIKE $1
         )
       ORDER BY score DESC, coa.updated_at DESC, coa.code ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row) => ({ ...toSummary('chart_of_accounts', row, row.summary), _score: row.score ?? 1 })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchAnalyticsCategories(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT ac.id,
              NULL::int AS item_number,
              ac.name AS label,
              ac.description AS summary,
              ac.status,
              ac.updated_at,
              COUNT(*) OVER()::int AS total_count,
              CASE WHEN ac.name ILIKE $1 THEN 3 ELSE 1 END AS score
       FROM analytics_categories ac
       WHERE ac.tenant_id = $2
         AND (
           ac.name ILIKE $1
           OR COALESCE(ac.description, '') ILIKE $1
           OR COALESCE(ac.status::text, '') ILIKE $1
         )
       ORDER BY score DESC, ac.updated_at DESC, ac.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row) => ({ ...toSummary('analytics_categories', row, row.summary), _score: row.score ?? 1 })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchBusinessProcesses(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT bp.id,
              NULL::int AS item_number,
              bp.name AS label,
              COALESCE(NULLIF(bp.description, ''), NULLIF(bp.notes, ''), bpc.name) AS summary,
              bp.status,
              bp.updated_at,
              bpc.name AS primary_category_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN bp.name ILIKE $1 THEN 3
                WHEN COALESCE(bpc.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM business_processes bp
       LEFT JOIN LATERAL (
         SELECT c.name
         FROM business_process_category_links l
         JOIN business_process_categories c ON c.id = l.category_id AND c.tenant_id = bp.tenant_id
         WHERE l.process_id = bp.id AND l.tenant_id = bp.tenant_id
         ORDER BY c.name ASC
         LIMIT 1
       ) bpc ON TRUE
       WHERE bp.tenant_id = $2
         AND (
           bp.name ILIKE $1
           OR COALESCE(bp.description, '') ILIKE $1
           OR COALESCE(bp.notes, '') ILIKE $1
           OR COALESCE(bp.status::text, '') ILIKE $1
           OR COALESCE(bpc.name, '') ILIKE $1
         )
       ORDER BY score DESC, bp.updated_at DESC, bp.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('business_processes', {
          ...row,
          metadata: {
            primary_category: row.primary_category_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchContacts(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const labelSql = `NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT c.id,
              NULL::int AS item_number,
              COALESCE(${labelSql}, c.email) AS label,
              NULLIF(CONCAT_WS(' | ', c.job_title, sup.name, c.country), '') AS summary,
              CASE WHEN c.active THEN 'active' ELSE 'inactive' END AS status,
              c.updated_at,
              sup.name AS supplier_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN ${labelSql} ILIKE $1 OR c.email ILIKE $1 THEN 3
                WHEN COALESCE(sup.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM contacts c
       LEFT JOIN suppliers sup ON sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id
       WHERE c.tenant_id = $2
         AND (
           COALESCE(${labelSql}, '') ILIKE $1
           OR c.email ILIKE $1
           OR COALESCE(c.job_title, '') ILIKE $1
           OR COALESCE(c.phone, '') ILIKE $1
           OR COALESCE(c.mobile, '') ILIKE $1
           OR COALESCE(c.country, '') ILIKE $1
           OR COALESCE(c.notes, '') ILIKE $1
           OR COALESCE(sup.name, '') ILIKE $1
         )
       ORDER BY score DESC, c.updated_at DESC, label ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('contacts', {
          ...row,
          metadata: {
            supplier: row.supplier_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchInterfaces(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT i.id,
              NULL::int AS item_number,
              NULLIF(TRIM(CONCAT_WS(' - ', i.interface_reference, i.name)), '') AS label,
              COALESCE(NULLIF(i.business_purpose, ''), NULLIF(CONCAT_WS(' | ', sa.name, ta.name), '')) AS summary,
              i.lifecycle AS status,
              i.updated_at,
              sa.name AS source_application_name,
              ta.name AS target_application_name,
              bp.name AS business_process_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN i.interface_reference ILIKE $1 OR i.interface_id ILIKE $1 OR i.name ILIKE $1 THEN 3
                WHEN COALESCE(sa.name, '') ILIKE $1 OR COALESCE(ta.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM interfaces i
       LEFT JOIN applications sa ON sa.id = i.source_application_id AND sa.tenant_id = i.tenant_id
       LEFT JOIN applications ta ON ta.id = i.target_application_id AND ta.tenant_id = i.tenant_id
       LEFT JOIN business_processes bp ON bp.id = i.business_process_id AND bp.tenant_id = i.tenant_id
       WHERE i.tenant_id = $2
         AND (
           i.interface_reference ILIKE $1
           OR i.interface_id ILIKE $1
           OR i.name ILIKE $1
           OR COALESCE(i.business_purpose, '') ILIKE $1
           OR COALESCE(i.overview_notes, '') ILIKE $1
           OR COALESCE(i.lifecycle, '') ILIKE $1
           OR COALESCE(i.criticality, '') ILIKE $1
           OR COALESCE(i.data_category, '') ILIKE $1
           OR COALESCE(i.data_class, '') ILIKE $1
           OR COALESCE(sa.name, '') ILIKE $1
           OR COALESCE(ta.name, '') ILIKE $1
           OR COALESCE(bp.name, '') ILIKE $1
         )
       ORDER BY score DESC, i.updated_at DESC, i.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('interfaces', {
          ...row,
          metadata: {
            source_application: row.source_application_name ?? null,
            target_application: row.target_application_name ?? null,
            business_process: row.business_process_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async searchConnections(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const like = `%${query}%`;
    const rows = await context.manager.query<SearchRow[]>(
      `SELECT cn.id,
              NULL::int AS item_number,
              NULLIF(TRIM(CONCAT_WS(' - ', cn.connection_reference, cn.name)), '') AS label,
              COALESCE(NULLIF(cn.description, ''), NULLIF(CONCAT_WS(' | ', src.name, dst.name), '')) AS summary,
              cn.lifecycle AS status,
              cn.updated_at,
              src.name AS source_asset_name,
              dst.name AS destination_asset_name,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN cn.connection_reference ILIKE $1 OR cn.name ILIKE $1 THEN 3
                WHEN COALESCE(src.name, '') ILIKE $1 OR COALESCE(dst.name, '') ILIKE $1 THEN 2
                ELSE 1
              END AS score
       FROM connections cn
       LEFT JOIN assets src ON src.id = cn.source_asset_id AND src.tenant_id = cn.tenant_id
       LEFT JOIN assets dst ON dst.id = cn.destination_asset_id AND dst.tenant_id = cn.tenant_id
       WHERE cn.tenant_id = $2
         AND (
           cn.connection_reference ILIKE $1
           OR cn.name ILIKE $1
           OR COALESCE(cn.description, '') ILIKE $1
           OR COALESCE(cn.topology, '') ILIKE $1
           OR COALESCE(cn.lifecycle, '') ILIKE $1
           OR COALESCE(cn.criticality, '') ILIKE $1
           OR COALESCE(cn.data_class, '') ILIKE $1
           OR COALESCE(src.name, '') ILIKE $1
           OR COALESCE(dst.name, '') ILIKE $1
           OR EXISTS (
             SELECT 1
             FROM connection_protocols cp
             WHERE cp.connection_id = cn.id
               AND cp.tenant_id = cn.tenant_id
               AND cp.connection_type_code ILIKE $1
           )
         )
       ORDER BY score DESC, cn.updated_at DESC, cn.name ASC
       LIMIT $3`,
      [like, context.tenantId, limit],
    );

    return {
      items: rows.map((row: any) => ({
        ...toSummary('connections', {
          ...row,
          metadata: {
            source: row.source_asset_name ?? null,
            destination: row.destination_asset_name ?? null,
          },
        }, row.summary),
        _score: row.score ?? 1,
      })),
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private async listApplications(context: AiExecutionContextWithManager) {
    const itOwnerNamesSql = buildApplicationOwnerNamesSql('a', 'it');
    const params: unknown[] = [context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'applications');
    const accessScopeSql = appendParticipationScopeSql('applications', 'a', params, accessScope);
    const rows = await context.manager.query<any[]>(
      `SELECT a.id, a.sequential_id AS item_ref, NULL::int AS item_number, a.name AS label, a.description AS summary, a.status, a.updated_at,
              a.lifecycle, a.criticality, a.cyber_criticality, a.recovery_wave, a.rto_minutes, a.rpo_minutes, a.category, a.hosting_model, a.data_class, a.version,
              s.name AS supplier_name,
              ${itOwnerNamesSql} AS it_owner_names
       FROM applications a
       LEFT JOIN suppliers s ON s.id = a.supplier_id AND s.tenant_id = $1
       WHERE a.tenant_id = $1
       ${accessScopeSql}
       ORDER BY a.name ASC`,
      params,
    );
    return rows.map((row) => ({
      ...toSummary('applications', row),
      metadata: {
        lifecycle: row.lifecycle ?? null,
        criticality: row.criticality ?? null,
        cyber_criticality: row.cyber_criticality ?? null,
        recovery_wave: row.recovery_wave ?? null,
        rto_minutes: row.rto_minutes ?? null,
        rpo_minutes: row.rpo_minutes ?? null,
        category: row.category ?? null,
        hosting_model: row.hosting_model ?? null,
        data_class: row.data_class ?? null,
        version: row.version ?? null,
        supplier: row.supplier_name ?? null,
        it_owner: row.it_owner_names ?? null,
      },
    }));
  }

  private async listAssets(context: AiExecutionContextWithManager) {
    const rows = await context.manager.query<any[]>(
      `SELECT a.id, a.asset_reference AS item_ref, NULL::int AS item_number, a.name AS label, COALESCE(a.fqdn, a.hostname, a.notes) AS summary, a.status, a.updated_at,
              a.kind, a.provider, a.environment, a.operating_system
       FROM assets a
       WHERE a.tenant_id = $1
       ORDER BY a.name ASC`,
      [context.tenantId],
    );
    return rows.map((row) => ({
      ...toSummary('assets', row),
      metadata: {
        kind: row.kind ?? null,
        provider: row.provider ?? null,
        environment: row.environment ?? null,
        os: row.operating_system ?? null,
      },
    }));
  }

  private async listProjects(context: AiExecutionContextWithManager) {
    const summarySql = buildProjectSummarySql('p');
    const params: unknown[] = [context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'projects');
    const accessScopeSql = appendParticipationScopeSql('projects', 'p', params, accessScope);
    const rows = await context.manager.query<any[]>(
      `SELECT p.id, p.item_number, p.name AS label, ${summarySql} AS summary, p.status, p.updated_at,
              pc.name AS category_name, ps.name AS stream_name, co.name AS company_name
       FROM portfolio_projects p
       LEFT JOIN portfolio_categories pc ON pc.id = p.category_id AND pc.tenant_id = $1
       LEFT JOIN portfolio_streams ps ON ps.id = p.stream_id AND ps.tenant_id = $1
       LEFT JOIN companies co ON co.id = p.company_id AND co.tenant_id = $1
       WHERE p.tenant_id = $1
       ${accessScopeSql}
       ORDER BY p.updated_at DESC, p.name ASC`,
      params,
    );
    return rows.map((row) => ({
      ...toSummary('projects', row),
      metadata: {
        category: row.category_name ?? null,
        stream: row.stream_name ?? null,
        company: row.company_name ?? null,
      },
    }));
  }

  private async listRequests(context: AiExecutionContextWithManager) {
    const summarySql = buildRequestSummarySql('r');
    const params: unknown[] = [context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'requests');
    const accessScopeSql = appendParticipationScopeSql('requests', 'r', params, accessScope);
    const rows = await context.manager.query<any[]>(
      `SELECT r.id, r.item_number, r.name AS label, ${summarySql} AS summary, r.status, r.updated_at,
              pc.name AS category_name, ps.name AS stream_name, co.name AS company_name
       FROM portfolio_requests r
       LEFT JOIN portfolio_categories pc ON pc.id = r.category_id AND pc.tenant_id = $1
       LEFT JOIN portfolio_streams ps ON ps.id = r.stream_id AND ps.tenant_id = $1
       LEFT JOIN companies co ON co.id = r.company_id AND co.tenant_id = $1
       WHERE r.tenant_id = $1
       ${accessScopeSql}
       ORDER BY r.updated_at DESC, r.name ASC`,
      params,
    );
    return rows.map((row) => ({
      ...toSummary('requests', row),
      metadata: {
        category: row.category_name ?? null,
        stream: row.stream_name ?? null,
        company: row.company_name ?? null,
      },
    }));
  }

  private async listTasks(context: AiExecutionContextWithManager) {
    const params: unknown[] = [context.tenantId];
    const accessScope = await resolveAiParticipationAccessScope(context, 'tasks');
    const accessScopeSql = appendParticipationScopeSql('tasks', 't', params, accessScope);
    const rows = await context.manager.query<any[]>(
      `SELECT t.id, t.item_number, COALESCE(t.title, 'Untitled task') AS label, t.description AS summary, t.status, t.updated_at,
              tt.name AS task_type_name,
              t.related_object_type,
              COALESCE(rel_proj.name, rel_si.product_name, rel_ct.name, rel_cx.product_name, ${incidentRelatedLabelSql('rel_inc')}) AS related_object_name,
              CONCAT_WS(' ', u_assign.first_name, u_assign.last_name) AS assignee_name,
              t.priority_level
       FROM tasks t
       LEFT JOIN portfolio_task_types tt ON tt.id = t.task_type_id AND tt.tenant_id = $1
       LEFT JOIN users u_assign ON u_assign.id = t.assignee_user_id AND u_assign.tenant_id = t.tenant_id
       LEFT JOIN portfolio_projects rel_proj ON rel_proj.id = t.related_object_id AND t.related_object_type = 'project' AND rel_proj.tenant_id = $1
       LEFT JOIN spend_items rel_si ON rel_si.id = t.related_object_id AND t.related_object_type = 'spend_item' AND rel_si.tenant_id = $1 AND rel_si.nature = 'opex'
       LEFT JOIN contracts rel_ct ON rel_ct.id = t.related_object_id AND t.related_object_type = 'contract' AND rel_ct.tenant_id = $1
       LEFT JOIN spend_items rel_cx ON rel_cx.id = t.related_object_id AND t.related_object_type = 'capex_item' AND rel_cx.tenant_id = $1 AND rel_cx.nature = 'capex'
       LEFT JOIN incidents rel_inc ON rel_inc.id = t.related_object_id AND t.related_object_type = 'incident' AND rel_inc.tenant_id = $1
       WHERE t.tenant_id = $1
       ${accessScopeSql}
       ORDER BY t.updated_at DESC, t.created_at DESC`,
      params,
    );
    return rows.map((row) => ({
      ...toSummary('tasks', row),
      metadata: {
        task_type: row.task_type_name ?? null,
        related_to: row.related_object_type ?? null,
        related_object_name: row.related_object_name ?? null,
        assignee: row.assignee_name || null,
        priority: row.priority_level ?? null,
      },
    }));
  }

  async listEntities(
    context: AiExecutionContextWithManager,
    input: { entity_type: AiContextEntityType },
  ) {
    await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);

    let items: AiEntitySummaryDto[];
    if (input.entity_type === 'applications') items = await this.listApplications(context);
    else if (input.entity_type === 'assets') items = await this.listAssets(context);
    else if (input.entity_type === 'projects') items = await this.listProjects(context);
    else if (input.entity_type === 'requests') items = await this.listRequests(context);
    else if (input.entity_type === 'tasks') items = await this.listTasks(context);
    else throw new BadRequestException('Unsupported entity type.');

    return { items, total: items.length };
  }

  async searchAll(
    context: AiExecutionContextWithManager,
    input: {
      query: string;
      entity_types?: AiSearchEntityType[];
      limit?: number;
      offset?: number;
    },
  ) {
    if (aiSearchIndexEnabled()) {
      return this.searchAllIndexed(context, input);
    }
    return this.searchAllLegacy(context, input);
  }

  /**
   * Unified search over the trigger-maintained `search_index` table: a single
   * indexed query (GIN tsvector + pg_trgm) replaces the legacy sequential
   * per-entity-type scans, with one comparable score scale across types.
   * Participation scope and the documents library ACL are enforced query-time
   * (never baked into the index).
   */
  private async searchAllIndexed(
    context: AiExecutionContextWithManager,
    input: {
      query: string;
      entity_types?: AiSearchEntityType[];
      limit?: number;
      offset?: number;
    },
  ) {
    const requested = input.entity_types && input.entity_types.length > 0
      ? input.entity_types
      : [...AI_SEARCH_ENTITY_TYPES] as AiSearchEntityType[];
    const allowed = await this.policy.listReadableEntityTypes(context, requested, context.manager) as AiSearchEntityType[];
    if (allowed.length === 0) {
      return { items: [], total: 0, complete: false, entity_types: [] as AiSearchEntityType[] };
    }

    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 100);
    const offset = Math.min(Math.max(Number(input.offset) || 0, 0), 5000);

    const { rows, total } = await this.runSearchIndexQuery(context, allowed, input.query, limit, offset);
    const items = rows.map((row) => {
      const { _score, ...item } = this.searchIndexRowToSummary(row);
      return item;
    });
    const truncated = offset + items.length < total;

    return {
      items,
      total,
      offset,
      limit,
      returned: items.length,
      truncated,
      complete: !truncated,
      entity_types: allowed,
      failed_entity_types: [] as AiSearchEntityType[],
      warnings: [] as Array<{ entity_type: AiSearchEntityType; message: string }>,
    };
  }

  private async runSearchIndexQuery(
    context: AiExecutionContextWithManager,
    entityTypes: AiSearchEntityType[],
    query: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: any[]; total: number }> {
    const q = String(query || '').trim();
    const prefixed = q.match(INDEXED_REF_QUERY_RE);
    const bare = q.match(/^(\d+)$/);
    const digits = prefixed?.[2] ?? bare?.[1] ?? null;
    const numericPrefix = digits && Number.isSafeInteger(Number(digits)) ? digits : null;
    const ref = numericPrefix != null ? Number(numericPrefix) : null;
    const queryPrefix = prefixed ? prefixed[1].toUpperCase() : null;
    const refPrefix = queryPrefix
      ? (QUERY_PREFIX_TO_INDEX_REF_PREFIX[queryPrefix] ?? queryPrefix)
      : null;

    const params: unknown[] = [];
    const push = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    // Lexeme-prefix fallback: the legacy path substring-ILIKEd every indexed
    // field, so "admin" used to match a user through the "Administrator" role
    // name. websearch_to_tsquery only matches whole stems; AND-ing the query
    // tokens as :* prefixes keeps that recall (such matches score in the same
    // bottom tier the legacy CASE gave them).
    const prefixTokens = (prefixed || bare ? [] : q.split(/[^\p{L}\p{N}]+/u))
      .filter((token) => token.length >= 3)
      .slice(0, 4);
    const prefixTsQueryInput = prefixTokens.length > 0
      ? prefixTokens.map((token) => `${token}:*`).join(' & ')
      : null;

    const tenantRef = push(context.tenantId);
    const typesRef = push(entityTypes);
    const qRef = push(q);
    const likeRef = push(`%${q}%`);
    const refRef = push(ref);
    const numPrefixRef = push(numericPrefix);
    const refPrefixRef = push(refPrefix);
    const prefixRef = push(prefixTsQueryInput);
    const tsq = bilingualDocumentTsQuerySql(qRef);
    const prefixTsq = `(to_tsquery('kanap_fr', ${prefixRef}) || to_tsquery('kanap_en', ${prefixRef}))`;

    // Participation scope (CRITICAL — security): scoped users only see the
    // applications/projects/requests/tasks they participate in. Resolved once
    // per type (cached on the context) and replicated with the exact same
    // participantCondition SQL as the legacy per-type searches, via EXISTS
    // against the source tables.
    const scopeClauses: string[] = [];
    for (const type of ['applications', 'projects', 'requests', 'tasks'] as ParticipationScopedAiEntityType[]) {
      if (!entityTypes.includes(type)) continue;
      const accessScope = await resolveAiParticipationAccessScope(context, type);
      if (!accessScope) continue;
      const userRef = push(accessScope.userId);
      const sourceTable = PARTICIPATION_SCOPE_SOURCE_TABLE[type];
      scopeClauses.push(`AND (search_index.entity_type <> '${type}' OR EXISTS (
        SELECT 1 FROM ${sourceTable} scope_src
        WHERE scope_src.id = search_index.entity_id
          AND scope_src.tenant_id = search_index.tenant_id
          AND ${participantConditionForAiEntity(type, 'scope_src', userRef)}
      ))`);
    }

    // Documents stay behind the knowledge library ACL (same check as
    // KnowledgeService.search). null = unrestricted; [] = no library access.
    if (entityTypes.includes('documents')) {
      const accessibleLibraries = await this.knowledge.listReadableLibraryIdsForUser(
        context.manager,
        context.userId ?? null,
      );
      if (accessibleLibraries) {
        const librariesRef = push(accessibleLibraries);
        scopeClauses.push(`AND (search_index.entity_type <> 'documents' OR EXISTS (
          SELECT 1 FROM documents d_acl
          WHERE d_acl.id = search_index.entity_id
            AND d_acl.tenant_id = search_index.tenant_id
            AND d_acl.library_id = ANY(${librariesRef}::uuid[])
        ))`);
      }

      // §3.7 point 4: a document bound to an incident also follows the incident's
      // permissions and row visibility. Resolved as soon as `documents` is among
      // the searched types — never gated on `incidents` being searched too, and
      // never inside the library branch (which is skipped for unrestricted
      // Knowledge access).
      const documentIncidentViewer = await resolveAiDocumentIncidentViewer(context);
      // Built straight onto the shared parameter array, so the placeholders it
      // emits are the real positions in this query: no `$1` rewriting, and no
      // assumption about how many parameters the fragment needs.
      const incidentAclClause = documentIncidentVisibilitySql('d_acl', documentIncidentViewer, params);
      scopeClauses.push(`AND (search_index.entity_type <> 'documents' OR EXISTS (
        SELECT 1 FROM documents d_acl
        WHERE d_acl.id = search_index.entity_id
          AND d_acl.tenant_id = search_index.tenant_id
          ${incidentAclClause}
      ))`);
    }

    if (entityTypes.includes('incidents')) {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      if (!viewer.isAdmin) {
        const userRef = viewer.userId ? push(viewer.userId) : null;
        const ownerClause = userRef
          ? `OR i_acl.reporter_user_id = ${userRef} OR i_acl.owner_user_id = ${userRef}`
          : '';
        scopeClauses.push(`AND (search_index.entity_type <> 'incidents' OR EXISTS (
          SELECT 1 FROM incidents i_acl
          WHERE i_acl.id = search_index.entity_id
            AND i_acl.tenant_id = search_index.tenant_id
            AND (i_acl.confidential = false ${ownerClause})
        ))`);
      }
    }

    const limitRef = push(limit);
    const offsetRef = push(offset);

    const rows = await context.manager.query(
      `SELECT entity_type, entity_id, ref_prefix, ref_number, label, summary, status,
              extra_json, source_updated_at,
              COUNT(*) OVER()::int AS total_count,
              CASE
                WHEN ${refRef}::int IS NOT NULL AND ref_number = ${refRef}
                     AND (${refPrefixRef}::text IS NULL OR ref_prefix = ${refPrefixRef}) THEN 4
                WHEN LOWER(COALESCE(extra_json->>'email', '')) = LOWER(${qRef}) THEN 4
                WHEN ${numPrefixRef}::text IS NOT NULL
                     AND ref_number::text LIKE ${numPrefixRef} || '%' THEN 3.5
                WHEN label ILIKE ${likeRef} THEN 3
                WHEN similarity(label, ${qRef}) > 0.35 THEN 2.5
                ELSE 1 + LEAST(ts_rank(search_vector, ${tsq}), 0.99)
              END AS score
       FROM search_index
       WHERE tenant_id = ${tenantRef}
         AND entity_type = ANY(${typesRef}::text[])
         AND (
               (${refRef}::int IS NOT NULL AND ref_number = ${refRef})
            OR (${numPrefixRef}::text IS NOT NULL AND ref_number::text LIKE ${numPrefixRef} || '%')
            OR label ILIKE ${likeRef}
            OR similarity(label, ${qRef}) > 0.35
            OR search_vector @@ ${tsq}
            OR (${prefixRef}::text IS NOT NULL AND search_vector @@ ${prefixTsq})
            OR LOWER(COALESCE(extra_json->>'email', '')) = LOWER(${qRef})
         )
         ${scopeClauses.join('\n         ')}
       ORDER BY score DESC,
                CASE WHEN ${numPrefixRef}::text IS NOT NULL THEN ref_number END ASC NULLS LAST,
                source_updated_at DESC NULLS LAST,
                label ASC
       LIMIT ${limitRef} OFFSET ${offsetRef}`,
      params,
    );

    return {
      rows,
      total: rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0,
    };
  }

  private searchIndexRowToSummary(row: any): AiEntitySummaryDto & { _score: number } {
    const type = row.entity_type as AiSearchEntityType;
    const extra = (row.extra_json ?? null) as Record<string, unknown> | null;

    let ref: string | null = null;
    if (type === 'applications' || type === 'assets') {
      ref = (extra?.item_ref as string | undefined) ?? null;
    } else {
      ref = buildRef(type, row.ref_number ?? null);
    }

    const metadataKeys = SEARCH_INDEX_METADATA_KEYS[type];
    let metadata: Record<string, string | number | boolean | null> | null = null;
    if (metadataKeys) {
      metadata = {};
      for (const key of metadataKeys) {
        const value = extra ? extra[key] : null;
        metadata[key] = key === 'project_availability'
          ? toNullableNumber(value)
          : ((value as string | number | boolean | null | undefined) ?? null);
      }
    }

    return {
      type,
      id: row.entity_id,
      ref,
      label: row.label,
      status: row.status ?? null,
      summary: row.summary ?? null,
      updated_at: toIso(row.source_updated_at),
      match_context: row.summary ?? null,
      metadata,
      _score: Number(row.score) || 1,
    };
  }

  private async searchAllLegacy(
    context: AiExecutionContextWithManager,
    input: {
      query: string;
      entity_types?: AiSearchEntityType[];
      limit?: number;
      offset?: number;
    },
  ) {
    const requested = input.entity_types && input.entity_types.length > 0
      ? input.entity_types
      : [...AI_SEARCH_ENTITY_TYPES] as AiSearchEntityType[];
    const allowed = await this.policy.listReadableEntityTypes(context, requested, context.manager) as AiSearchEntityType[];
    if (allowed.length === 0) {
      return { items: [], total: 0, complete: false, entity_types: [] as AiSearchEntityType[] };
    }

    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 100);
    const offset = Math.min(Math.max(Number(input.offset) || 0, 0), 5000);
    const fetchLimit = Math.min(limit + offset, 5000);
    const failedEntityTypes: Array<{ type: AiSearchEntityType; message: string }> = [];
    // Isolate each per-entity-type search in its own PostgreSQL SAVEPOINT so a
    // single broken query (e.g. a SQL operator-mismatch in one of the searchXxx
    // helpers) doesn't poison the surrounding transaction and cascade-fail every
    // sibling search with "current transaction is aborted, commands ignored".
    // SAVEPOINT is the only way to recover from a query error inside an open tx
    // — try/catch on its own catches the JS exception but the tx stays poisoned.
    const empty: RankedSearchResult = { items: [], total: 0 };
    let savepointCounter = 0;
    const safeRun = async (
      type: AiSearchEntityType,
      run: () => Promise<RankedSearchResult>,
    ): Promise<RankedSearchResult> => {
      // Unique name per savepoint — Promise.all dispatches all of these and PG
      // serializes them on a single connection, but using distinct names is cheap
      // and removes any ambiguity if savepoints ever interleave. The name is a
      // fixed prefix and a counter only: an SQL identifier never takes a value
      // from the request.
      const sp = `search_sp_${++savepointCounter}`;
      try {
        await context.manager.query(`SAVEPOINT ${sp}`);
      } catch (err) {
        const message = (err as Error).message;
        failedEntityTypes.push({ type, message });
        this.logger.warn(`searchAll: ${type} could not start savepoint: ${message}`);
        return empty;
      }
      try {
        const result = await run();
        await context.manager.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        // Roll back to the savepoint so the outer tx stays usable for the
        // remaining sibling searches.
        try {
          await context.manager.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await context.manager.query(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          // ignore — best-effort cleanup
        }
        const message = (err as Error).message;
        failedEntityTypes.push({ type, message });
        this.logger.warn(`searchAll: ${type} failed for query "${input.query}": ${message}`);
        return empty;
      }
    };

    // SAVEPOINTs only isolate failures correctly when the surrounding queries are
    // serialized — Promise.all interleaves SAVEPOINT/RELEASE/ROLLBACK statements
    // and PG ends up rejecting many of them ("savepoint does not exist", "current
    // transaction is aborted"). Run sequentially so each savepoint completes its
    // SAVEPOINT → query → RELEASE/ROLLBACK cycle before the next one starts.
    // The per-search latency hit is small (each is a single LIMIT-bounded query)
    // and the autocomplete is debounced 150ms client-side anyway.
    const results: RankedSearchResult[] = [];
    for (const type of allowed) {
      const r = await safeRun(type, () => this.runEntityTypeSearch(context, type, input.query, fetchLimit));
      results.push(r);
    }

    const total = results.reduce((sum, result) => sum + (result.total || 0), 0);
    const items = results
      .flatMap((result) => result.items)
      .sort((left: any, right: any) => {
        if ((right._score ?? 0) !== (left._score ?? 0)) {
          return (right._score ?? 0) - (left._score ?? 0);
        }
        const leftTime = new Date(left.updated_at || 0).getTime();
        const rightTime = new Date(right.updated_at || 0).getTime();
        return rightTime - leftTime;
      })
      .slice(offset, offset + limit)
      .map(({ _score, ...item }: any) => item);

    const truncated = offset + items.length < total;
    const failedTypeNames = failedEntityTypes.map((entry) => entry.type);

    return {
      items,
      total,
      offset,
      limit,
      returned: items.length,
      truncated,
      complete: !truncated && failedEntityTypes.length === 0,
      entity_types: allowed,
      failed_entity_types: failedTypeNames,
      warnings: failedEntityTypes.map((entry) => ({
        entity_type: entry.type,
        message: `Search failed for ${entry.type}: ${entry.message}`,
      })),
    };
  }

  private async searchDocumentsForMentions(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<RankedSearchResult> {
    const search = await this.knowledge.searchMentionOptions(
      { q: query, limit },
      { manager: context.manager, userId: context.userId },
    );
    return {
      items: (search.items || []).map((item: any) => ({
        ...toSummary('documents', {
          id: item.id,
          item_number: item.item_number,
          item_ref: item.item_ref,
          label: item.title,
          summary: item.summary ?? null,
          status: item.status,
          updated_at: item.updated_at,
        }, item.summary ?? null),
        _score: 1,
      })),
      total: search.total ?? 0,
    };
  }

  async searchMentionCandidates(
    context: AiExecutionContextWithManager,
    input: {
      query: string;
      entity_types?: AiSearchEntityType[];
      limit?: number;
    },
  ) {
    const requested = input.entity_types && input.entity_types.length > 0
      ? input.entity_types
      : [...AI_SEARCH_ENTITY_TYPES] as AiSearchEntityType[];
    const allowed = await this.policy.listReadableEntityTypes(context, requested, context.manager) as AiSearchEntityType[];
    if (allowed.length === 0) {
      return { items: [], total: 0, returned: 0, complete: false, entity_types: [] as AiSearchEntityType[] };
    }

    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    const empty: RankedSearchResult = { items: [], total: 0 };
    let savepointCounter = 0;
    const safeRun = async (
      type: AiSearchEntityType,
      run: () => Promise<RankedSearchResult>,
    ): Promise<RankedSearchResult> => {
      // Fixed prefix and counter only: an SQL identifier never takes a value from the request.
      const sp = `mention_sp_${++savepointCounter}`;
      try {
        await context.manager.query(`SAVEPOINT ${sp}`);
      } catch (err) {
        this.logger.warn(`searchMentionCandidates: ${type} could not start savepoint: ${(err as Error).message}`);
        return empty;
      }
      try {
        const result = await run();
        await context.manager.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        try {
          await context.manager.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await context.manager.query(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          // ignore
        }
        this.logger.warn(
          `searchMentionCandidates: ${type} failed for query "${input.query}": ${(err as Error).message}`,
        );
        return empty;
      }
    };

    const results: RankedSearchResult[] = [];
    for (const type of allowed) {
      const result = await safeRun(type, () => (
        type === 'documents'
          ? this.searchDocumentsForMentions(context, input.query, limit)
          : this.runEntityTypeSearch(context, type, input.query, limit)
      ));
      results.push(result);
    }

    const total = results.reduce((sum, result) => sum + (result.total || 0), 0);
    const items = results
      .flatMap((result) => result.items)
      .map(({ _score, ...item }: any) => item);

    return {
      items,
      total,
      limit,
      returned: items.length,
      complete: false,
      entity_types: allowed,
    };
  }

  /**
   * Run a single entity_type's search, dispatched to the right per-type helper.
   * Extracted from searchAll so callers (such as the @-mention picker) can run
   * per-type searches with their own limits without going through searchAll's
   * cross-type ranking — that ranking compares incomparable score scales (knowledge
   * search uses fetchLimit-index, while SQL searches use a 1..4 CASE) and lets
   * one type swallow all the result slots.
   */
  private async runEntityTypeSearch(
    context: AiExecutionContextWithManager,
    type: AiSearchEntityType | AiContextEntityType,
    query: string,
    fetchLimit: number,
  ): Promise<RankedSearchResult> {
    // Indexed path: single-type query over search_index. Documents keep the
    // KnowledgeService path below so per-type callers (the @-mention picker)
    // retain ts_headline snippets and item-ref prefix ordering.
    if (aiSearchIndexEnabled() && type !== 'documents') {
      const { rows, total } = await this.runSearchIndexQuery(
        context,
        [type as AiSearchEntityType],
        query,
        fetchLimit,
        0,
      );
      return {
        items: rows.map((row) => this.searchIndexRowToSummary(row)),
        total,
      };
    }
    if (type === 'accounts') return this.searchAccounts(context, query, fetchLimit);
    if (type === 'analytics_categories') return this.searchAnalyticsCategories(context, query, fetchLimit);
    if (type === 'applications') return this.searchApplications(context, query, fetchLimit);
    if (type === 'assets') return this.searchAssets(context, query, fetchLimit);
    if (type === 'business_processes') return this.searchBusinessProcesses(context, query, fetchLimit);
    if (type === 'capex_items') return this.searchCapexItems(context, query, fetchLimit);
    if (type === 'chart_of_accounts') return this.searchChartOfAccounts(context, query, fetchLimit);
    if (type === 'companies') return this.searchCompanies(context, query, fetchLimit);
    if (type === 'connections') return this.searchConnections(context, query, fetchLimit);
    if (type === 'contacts') return this.searchContacts(context, query, fetchLimit);
    if (type === 'contracts') return this.searchContracts(context, query, fetchLimit);
    if (type === 'departments') return this.searchDepartments(context, query, fetchLimit);
    if (type === 'incidents') return this.searchIncidents(context, query, fetchLimit);
    if (type === 'interfaces') return this.searchInterfaces(context, query, fetchLimit);
    if (type === 'locations') return this.searchLocations(context, query, fetchLimit);
    if (type === 'projects') return this.searchProjects(context, query, fetchLimit);
    if (type === 'requests') return this.searchRequests(context, query, fetchLimit);
    if (type === 'spend_items') return this.searchSpendItems(context, query, fetchLimit);
    if (type === 'suppliers') return this.searchSuppliers(context, query, fetchLimit);
    if (type === 'tasks') return this.searchTasks(context, query, fetchLimit);
    if (type === 'users') return this.searchUsers(context, query, fetchLimit);
    if (type !== 'documents') {
      throw new BadRequestException('Unsupported entity type.');
    }
    const search = await this.knowledge.search(
      { q: query, limit: fetchLimit, offset: 0 },
      { manager: context.manager, userId: context.userId },
    );
    return {
      items: (search.items || []).map((item: any, index: number) => ({
        ...toSummary('documents', {
          id: item.id,
          item_number: item.item_number,
          label: item.title,
          summary: item.summary ?? null,
          status: item.status,
          updated_at: item.updated_at,
        }, item.snippet ?? item.summary ?? null),
        _score: fetchLimit - index,
      })),
      total: search.total ?? 0,
    } satisfies RankedSearchResult;
  }

  /**
   * Per-type search for callers that want diversity rather than cross-type ranking.
   * Returns a flat list ordered by entity_type, each type contributing at most
   * `limitPerType` items. Ideal for the @-mention picker, which groups results by
   * type visually anyway. Each per-type call is wrapped in a SAVEPOINT so a single
   * broken query doesn't take down the rest.
   */
  async searchByEntityTypes(
    context: AiExecutionContextWithManager,
    input: {
      query: string;
      entity_types?: AiSearchEntityType[];
      limitPerType: number;
    },
  ): Promise<{
    groups: Array<{ entity_type: string; items: AiEntitySummaryDto[] }>;
  }> {
    const requested = input.entity_types && input.entity_types.length > 0
      ? input.entity_types
      : [...AI_SEARCH_ENTITY_TYPES] as AiSearchEntityType[];
    const allowed = await this.policy.listReadableEntityTypes(context, requested, context.manager) as AiSearchEntityType[];
    if (allowed.length === 0) return { groups: [] };

    const limitPerType = Math.min(Math.max(Number(input.limitPerType) || 3, 1), 20);
    const groups: Array<{ entity_type: string; items: AiEntitySummaryDto[] }> = [];

    let savepointCounter = 0;
    for (const type of allowed) {
      // Fixed prefix and counter only: an SQL identifier never takes a value from the request.
      const sp = `pick_sp_${++savepointCounter}`;
      try {
        await context.manager.query(`SAVEPOINT ${sp}`);
      } catch {
        continue;
      }
      try {
        const result = await this.runEntityTypeSearch(context, type, input.query, limitPerType);
        await context.manager.query(`RELEASE SAVEPOINT ${sp}`);
        const items = result.items.map(({ _score, ...rest }: any) => rest);
        if (items.length > 0) {
          groups.push({ entity_type: type, items: items.slice(0, limitPerType) });
        }
      } catch (err) {
        try {
          await context.manager.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await context.manager.query(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          // ignore
        }
        this.logger.warn(
          `searchByEntityTypes: ${type} failed for query "${input.query}": ${(err as Error).message}`,
        );
      }
    }

    return { groups };
  }

  private async getKnowledgeContext(
    context: AiExecutionContext,
    entityType: AiContextEntityType,
    entityId: string,
    manager: AiExecutionContextWithManager['manager'],
  ): Promise<AiKnowledgeContextDto> {
    const result = await this.knowledge.getKnowledgeContextForEntity(entityType as any, entityId, {
      manager,
      userId: context.userId,
    });

    return {
      access: result.access,
      total: result.total,
      groups: result.groups.map((group) => ({
        key: group.key,
        label: group.label,
        linked_via_label: group.linked_via_label,
        total: group.total,
        items: group.items.map((item) => ({
          id: item.id,
          ref: buildRef('documents', item.item_number),
          title: item.title,
          summary: item.summary ?? null,
          status: item.status,
          updated_at: toIso(item.updated_at),
          created_at: toIso(item.created_at),
          provenance: item.provenance.map((source) => ({
            entity_type: source.entity_type,
            entity_id: source.entity_id,
            ref: buildRef(source.entity_type as any, source.item_number),
            label: source.name,
            status: source.status ?? null,
          })),
        })),
      })),
    };
  }

  private dedupe(items: AiEntitySummaryDto[]): AiEntitySummaryDto[] {
    const seen = new Set<string>();
    const output: AiEntitySummaryDto[] = [];
    for (const item of items) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  private async buildApplicationContext(context: AiExecutionContextWithManager, applicationId: string, manager: AiExecutionContextWithManager['manager']): Promise<AiEntityContextPayloadDto> {
    const requestSummarySql = buildRequestSummarySql('r');
    const projectSummarySql = buildProjectSummarySql('p');
    const { tenantId } = context;
    const applicationAccessScope = await resolveAiParticipationAccessScope(context, 'applications');
    const applicationRootParams: unknown[] = [applicationId, tenantId];
    const applicationRootScopeSql = appendParticipationScopeSql('applications', 'a', applicationRootParams, applicationAccessScope);
    const applications = await manager.query<any[]>(
      `SELECT a.id, a.name, a.description, a.status, a.updated_at, a.lifecycle, a.environment, a.editor, a.criticality, a.hosting_model, a.data_class, a.version
       FROM applications a
       WHERE a.id = $1
         AND a.tenant_id = $2
         ${applicationRootScopeSql}
       LIMIT 1`,
      applicationRootParams,
    );
    const application = applications[0];
    if (!application) {
      throw new NotFoundException('Application not found.');
    }

    const requestAccessScope = await resolveAiParticipationAccessScope(context, 'requests');
    const projectAccessScope = await resolveAiParticipationAccessScope(context, 'projects');
    const applicationRequestParams: unknown[] = [applicationId, tenantId];
    const applicationRequestScopeSql = appendParticipationScopeSql('requests', 'r', applicationRequestParams, requestAccessScope);
    const applicationProjectParams: unknown[] = [applicationId, tenantId];
    const applicationProjectScopeSql = appendParticipationScopeSql('projects', 'p', applicationProjectParams, projectAccessScope);
    const relatedApplicationParams: unknown[] = [applicationId, tenantId];
    const relatedApplicationScopeSql = appendParticipationScopeSql('applications', 'a', relatedApplicationParams, applicationAccessScope);

    const [requestRows, projectRows, relatedApplicationRows, assetRows, ownerRows] = await Promise.all([
      manager.query<SearchRow[]>(
        `SELECT r.id, r.item_number, r.name AS label, ${requestSummarySql} AS summary, r.status, r.updated_at
         FROM portfolio_request_applications l
         JOIN portfolio_requests r ON r.id = l.request_id AND r.tenant_id = $2 AND r.tenant_id = l.tenant_id
         WHERE l.application_id = $1
           AND l.tenant_id = $2
           ${applicationRequestScopeSql}
         ORDER BY r.updated_at DESC`,
        applicationRequestParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT p.id, p.item_number, p.name AS label, ${projectSummarySql} AS summary, p.status, p.updated_at
         FROM application_projects l
         JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = $2 AND p.tenant_id = l.tenant_id
         WHERE l.application_id = $1
           AND l.tenant_id = $2
           ${applicationProjectScopeSql}
         ORDER BY p.updated_at DESC`,
        applicationProjectParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, a.description AS summary, a.status, a.updated_at
         FROM application_suites l
         JOIN applications a ON a.id = l.suite_id AND a.tenant_id = $2 AND a.tenant_id = l.tenant_id
         WHERE l.application_id = $1
           AND l.tenant_id = $2
           ${relatedApplicationScopeSql}
         UNION
         SELECT a.id, NULL::int AS item_number, a.name AS label, a.description AS summary, a.status, a.updated_at
         FROM application_suites l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = $2 AND a.tenant_id = l.tenant_id
         WHERE l.suite_id = $1
           AND l.tenant_id = $2
           ${relatedApplicationScopeSql}`,
        relatedApplicationParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, COALESCE(a.fqdn, a.hostname, a.notes) AS summary, a.status, a.updated_at
         FROM app_instances ai
         JOIN app_asset_assignments aaa ON aaa.app_instance_id = ai.id AND aaa.tenant_id = $2 AND aaa.tenant_id = ai.tenant_id
         JOIN assets a ON a.id = aaa.asset_id AND a.tenant_id = $2 AND a.tenant_id = aaa.tenant_id
         WHERE ai.application_id = $1
           AND ai.tenant_id = $2
         ORDER BY a.updated_at DESC`,
        [applicationId, tenantId],
      ),
      manager.query<any[]>(
        `SELECT ao.owner_type, ao.user_id, u.email, u.first_name, u.last_name
         FROM application_owners ao
         JOIN users u ON u.id = ao.user_id AND u.tenant_id = ao.tenant_id
         WHERE ao.application_id = $1
           AND ao.tenant_id = $2
         ORDER BY ao.owner_type ASC, u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.email ASC NULLS LAST`,
        [applicationId, tenantId],
      ),
    ]);

    const businessOwners = ownerRows.filter((row) => row.owner_type === 'business').map((row) => toPersonMetadata(row));
    const itOwners = ownerRows.filter((row) => row.owner_type === 'it').map((row) => toPersonMetadata(row));

    return {
      entity: {
        ...toContextEntityBase('applications', {
          id: application.id,
          label: application.name,
          summary: application.description,
          status: application.status,
          updated_at: application.updated_at,
        }),
        metadata: {
          lifecycle: application.lifecycle,
          environment: application.environment,
          editor: application.editor,
          criticality: application.criticality,
          hosting_model: application.hosting_model,
          data_class: application.data_class,
          version: application.version,
          business_owners: businessOwners,
          it_owners: itOwners,
        },
      },
      related: [
        { relation: 'linked_requests', label: 'Linked Requests', items: requestRows.map((row) => toSummary('requests', row)) },
        { relation: 'linked_projects', label: 'Linked Projects', items: projectRows.map((row) => toSummary('projects', row)) },
        { relation: 'related_applications', label: 'Related Applications', items: this.dedupe(relatedApplicationRows.map((row) => toSummary('applications', row))) },
        { relation: 'linked_assets', label: 'Linked Assets', items: this.dedupe(assetRows.map((row) => toSummary('assets', row))) },
      ].filter((group) => group.items.length > 0),
      knowledge: await this.getKnowledgeContext(context, 'applications', applicationId, manager),
    };
  }

  private async buildAssetContext(context: AiExecutionContextWithManager, assetId: string, manager: AiExecutionContextWithManager['manager']): Promise<AiEntityContextPayloadDto> {
    const requestSummarySql = buildRequestSummarySql('r');
    const projectSummarySql = buildProjectSummarySql('p');
    const { tenantId } = context;
    const assets = await manager.query<any[]>(
      `SELECT a.id, a.name, a.status, a.updated_at, a.kind, a.provider, a.environment, a.fqdn, a.region, a.zone, a.notes
       FROM assets a
       WHERE a.id = $1
         AND a.tenant_id = $2
       LIMIT 1`,
      [assetId, tenantId],
    );
    const asset = assets[0];
    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    const requestAccessScope = await resolveAiParticipationAccessScope(context, 'requests');
    const projectAccessScope = await resolveAiParticipationAccessScope(context, 'projects');
    const applicationAccessScope = await resolveAiParticipationAccessScope(context, 'applications');
    const assetRequestParams: unknown[] = [assetId, tenantId];
    const assetRequestScopeSql = appendParticipationScopeSql('requests', 'r', assetRequestParams, requestAccessScope);
    const assetProjectParams: unknown[] = [assetId, tenantId];
    const assetProjectScopeSql = appendParticipationScopeSql('projects', 'p', assetProjectParams, projectAccessScope);
    const assetApplicationParams: unknown[] = [assetId, tenantId];
    const assetApplicationScopeSql = appendParticipationScopeSql('applications', 'a', assetApplicationParams, applicationAccessScope);

    const [requestRows, projectRows, relatedAssetRows, applicationRows] = await Promise.all([
      manager.query<SearchRow[]>(
        `SELECT r.id, r.item_number, r.name AS label, ${requestSummarySql} AS summary, r.status, r.updated_at
         FROM portfolio_request_assets l
         JOIN portfolio_requests r ON r.id = l.request_id AND r.tenant_id = $2 AND r.tenant_id = l.tenant_id
         WHERE l.asset_id = $1
           AND l.tenant_id = $2
           ${assetRequestScopeSql}
         ORDER BY r.updated_at DESC`,
        assetRequestParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT p.id, p.item_number, p.name AS label, ${projectSummarySql} AS summary, p.status, p.updated_at
         FROM asset_projects l
         JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = $2 AND p.tenant_id = l.tenant_id
         WHERE l.asset_id = $1
           AND l.tenant_id = $2
           ${assetProjectScopeSql}
         ORDER BY p.updated_at DESC`,
        assetProjectParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, COALESCE(a.fqdn, a.hostname, a.notes) AS summary, a.status, a.updated_at
         FROM asset_relations rel
         JOIN assets a ON a.id = rel.related_asset_id AND a.tenant_id = $2 AND a.tenant_id = rel.tenant_id
         WHERE rel.asset_id = $1
           AND rel.tenant_id = $2
         UNION
         SELECT a.id, NULL::int AS item_number, a.name AS label, COALESCE(a.fqdn, a.hostname, a.notes) AS summary, a.status, a.updated_at
         FROM asset_relations rel
         JOIN assets a ON a.id = rel.asset_id AND a.tenant_id = $2 AND a.tenant_id = rel.tenant_id
         WHERE rel.related_asset_id = $1
           AND rel.tenant_id = $2`,
        [assetId, tenantId],
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, a.description AS summary, a.status, a.updated_at
         FROM app_asset_assignments aaa
         JOIN app_instances ai ON ai.id = aaa.app_instance_id AND ai.tenant_id = $2 AND ai.tenant_id = aaa.tenant_id
         JOIN applications a ON a.id = ai.application_id AND a.tenant_id = $2 AND a.tenant_id = ai.tenant_id
         WHERE aaa.asset_id = $1
           AND aaa.tenant_id = $2
           ${assetApplicationScopeSql}
         ORDER BY a.updated_at DESC`,
        assetApplicationParams,
      ),
    ]);

    return {
      entity: {
        ...toSummary('assets', {
          id: asset.id,
          label: asset.name,
          summary: asset.fqdn ?? asset.notes ?? null,
          status: asset.status,
          updated_at: asset.updated_at,
        }),
        metadata: {
          kind: asset.kind,
          provider: asset.provider,
          environment: asset.environment,
          fqdn: asset.fqdn,
          region: asset.region,
          zone: asset.zone,
        },
      },
      related: [
        { relation: 'linked_requests', label: 'Linked Requests', items: requestRows.map((row) => toSummary('requests', row)) },
        { relation: 'linked_projects', label: 'Linked Projects', items: projectRows.map((row) => toSummary('projects', row)) },
        { relation: 'related_assets', label: 'Related Assets', items: this.dedupe(relatedAssetRows.map((row) => toSummary('assets', row))) },
        { relation: 'linked_applications', label: 'Linked Applications', items: this.dedupe(applicationRows.map((row) => toSummary('applications', row))) },
      ].filter((group) => group.items.length > 0),
      knowledge: await this.getKnowledgeContext(context, 'assets', assetId, manager),
    };
  }

  private async buildRequestContext(context: AiExecutionContextWithManager, requestId: string, manager: AiExecutionContextWithManager['manager']): Promise<AiEntityContextPayloadDto> {
    const requestSummarySql = buildRequestSummarySql('r');
    const projectSummarySql = buildProjectSummarySql('p');
    const { tenantId } = context;
    const requestAccessScope = await resolveAiParticipationAccessScope(context, 'requests');
    const requestRootParams: unknown[] = [requestId, tenantId];
    const requestRootScopeSql = appendParticipationScopeSql('requests', 'r', requestRootParams, requestAccessScope);
    const requests = await manager.query<any[]>(
      `SELECT r.id,
              r.item_number,
              r.name,
              ${requestSummarySql} AS summary,
              r.current_situation,
              r.expected_benefits,
              r.status,
              r.updated_at,
              r.target_delivery_date,
              r.requestor_id,
              ${buildUserNameSql('u_req')} AS requestor_name,
              r.business_lead_id,
              ${buildUserNameSql('u_bl')} AS business_lead_name,
              r.it_lead_id,
              ${buildUserNameSql('u_il')} AS it_lead_name,
              CASE WHEN ot.id IS NOT NULL THEN CONCAT('T-', ot.item_number, ' ', COALESCE(ot.title, 'Untitled task')) ELSE NULL END AS origin_task_ref
       FROM portfolio_requests r
       LEFT JOIN tasks ot ON ot.id = r.origin_task_id AND ot.tenant_id = $2
       LEFT JOIN users u_req ON u_req.id = r.requestor_id AND u_req.tenant_id = r.tenant_id
       LEFT JOIN users u_bl ON u_bl.id = r.business_lead_id AND u_bl.tenant_id = r.tenant_id
       LEFT JOIN users u_il ON u_il.id = r.it_lead_id AND u_il.tenant_id = r.tenant_id
       WHERE r.id = $1
         AND r.tenant_id = $2
         ${requestRootScopeSql}
       LIMIT 1`,
      requestRootParams,
    );
    const request = requests[0];
    if (!request) {
      throw new NotFoundException('Request not found.');
    }

    const projectAccessScope = await resolveAiParticipationAccessScope(context, 'projects');
    const applicationAccessScope = await resolveAiParticipationAccessScope(context, 'applications');
    const requestProjectParams: unknown[] = [requestId, tenantId];
    const requestProjectScopeSql = appendParticipationScopeSql('projects', 'p', requestProjectParams, projectAccessScope);
    const requestDependencyParams: unknown[] = [requestId, tenantId];
    const requestDependencyScopeSql = [
      appendNullableParticipationScopeSql('requests', 'r', requestDependencyParams, requestAccessScope),
      appendNullableParticipationScopeSql('projects', 'p', requestDependencyParams, projectAccessScope),
    ].join('\n');
    const requestApplicationParams: unknown[] = [requestId, tenantId];
    const requestApplicationScopeSql = appendParticipationScopeSql('applications', 'a', requestApplicationParams, applicationAccessScope);

    const [projectRows, dependencyRows, applicationRows, assetRows, contributorRows] = await Promise.all([
      manager.query<SearchRow[]>(
        `SELECT p.id, p.item_number, p.name AS label, ${projectSummarySql} AS summary, p.status, p.updated_at
         FROM portfolio_request_projects rp
         JOIN portfolio_projects p ON p.id = rp.project_id AND p.tenant_id = $2 AND p.tenant_id = rp.tenant_id
         WHERE rp.request_id = $1
           AND rp.tenant_id = $2
           ${requestProjectScopeSql}
         ORDER BY p.updated_at DESC`,
        requestProjectParams,
      ),
      manager.query<any[]>(
        `SELECT r.id AS request_id,
                r.item_number AS request_item_number,
                r.name AS request_label,
                ${requestSummarySql} AS request_summary,
                r.status AS request_status,
                r.updated_at AS request_updated_at,
                p.id AS project_id,
                p.item_number AS project_item_number,
                p.name AS project_label,
                ${projectSummarySql} AS project_summary,
                p.status AS project_status,
                p.updated_at AS project_updated_at
         FROM portfolio_request_dependencies d
         LEFT JOIN portfolio_requests r ON r.id = d.depends_on_request_id AND r.tenant_id = $2 AND r.tenant_id = d.tenant_id
         LEFT JOIN portfolio_projects p ON p.id = d.depends_on_project_id AND p.tenant_id = $2 AND p.tenant_id = d.tenant_id
         WHERE d.request_id = $1
           AND d.tenant_id = $2
           ${requestDependencyScopeSql}`,
        requestDependencyParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, a.description AS summary, a.status, a.updated_at
         FROM portfolio_request_applications l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = $2 AND a.tenant_id = l.tenant_id
         WHERE l.request_id = $1
           AND l.tenant_id = $2
           ${requestApplicationScopeSql}
         ORDER BY a.updated_at DESC`,
        requestApplicationParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, COALESCE(a.fqdn, a.hostname, a.notes) AS summary, a.status, a.updated_at
         FROM portfolio_request_assets l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = $2 AND a.tenant_id = l.tenant_id
         WHERE l.request_id = $1
           AND l.tenant_id = $2
         ORDER BY a.updated_at DESC`,
        [requestId, tenantId],
      ),
      manager.query<any[]>(
        `SELECT rt.user_id, u.email, u.first_name, u.last_name
         FROM portfolio_request_team rt
         JOIN users u ON u.id = rt.user_id AND u.tenant_id = rt.tenant_id
         WHERE rt.request_id = $1
           AND rt.tenant_id = $2
         ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.email ASC NULLS LAST`,
        [requestId, tenantId],
      ),
    ]);

    const dependencyItems = dependencyRows.flatMap((row) => {
      const items: AiEntitySummaryDto[] = [];
      if (row.request_id) {
        items.push(toSummary('requests', {
          id: row.request_id,
          item_number: row.request_item_number,
          label: row.request_label,
          summary: row.request_summary,
          status: row.request_status,
          updated_at: row.request_updated_at,
        }));
      }
      if (row.project_id) {
        items.push(toSummary('projects', {
          id: row.project_id,
          item_number: row.project_item_number,
          label: row.project_label,
          summary: row.project_summary,
          status: row.project_status,
          updated_at: row.project_updated_at,
        }));
      }
      return items;
    });

    return {
      entity: {
        ...toContextEntityBase('requests', {
          id: request.id,
          item_number: request.item_number,
          label: request.name,
          summary: request.summary,
          status: request.status,
          updated_at: request.updated_at,
        }),
        metadata: {
          current_situation: request.current_situation ?? null,
          expected_benefits: request.expected_benefits ?? null,
          target_delivery_date: request.target_delivery_date ?? null,
          origin_task: request.origin_task_ref ?? null,
          requestor: request.requestor_id ? toPersonMetadata({ id: request.requestor_id, name: request.requestor_name }) : null,
          business_lead: request.business_lead_id ? toPersonMetadata({ id: request.business_lead_id, name: request.business_lead_name }) : null,
          it_lead: request.it_lead_id ? toPersonMetadata({ id: request.it_lead_id, name: request.it_lead_name }) : null,
          contributors: contributorRows.map((row) => toPersonMetadata(row)),
        },
      },
      related: [
        { relation: 'resulting_projects', label: 'Resulting Projects', items: projectRows.map((row) => toSummary('projects', row)) },
        { relation: 'dependencies', label: 'Dependencies', items: this.dedupe(dependencyItems) },
        { relation: 'linked_applications', label: 'Linked Applications', items: applicationRows.map((row) => toSummary('applications', row)) },
        { relation: 'linked_assets', label: 'Linked Assets', items: assetRows.map((row) => toSummary('assets', row)) },
      ].filter((group) => group.items.length > 0),
      knowledge: await this.getKnowledgeContext(context, 'requests', requestId, manager),
    };
  }

  private async buildProjectContext(context: AiExecutionContextWithManager, projectId: string, manager: AiExecutionContextWithManager['manager']): Promise<AiEntityContextPayloadDto> {
    const requestSummarySql = buildRequestSummarySql('r');
    const projectSummarySql = buildProjectSummarySql('p');
    const { tenantId } = context;
    const canReadKnowledge = await this.policy.canReadKnowledge(context, manager);
    const projectAccessScope = await resolveAiParticipationAccessScope(context, 'projects');
    const projectRootParams: unknown[] = [projectId, tenantId];
    const projectRootScopeSql = appendParticipationScopeSql('projects', 'p', projectRootParams, projectAccessScope);
    const projects = await manager.query<any[]>(
      `SELECT p.id,
              p.item_number,
              p.name,
              ${projectSummarySql} AS summary,
              p.status,
              p.updated_at,
              p.origin,
              p.execution_progress,
              p.planned_start,
              p.planned_end,
              p.actual_start,
              p.actual_end,
              p.business_lead_id,
              ${buildUserNameSql('u_bl')} AS business_lead_name,
              p.it_lead_id,
              ${buildUserNameSql('u_il')} AS it_lead_name
       FROM portfolio_projects p
       LEFT JOIN users u_bl ON u_bl.id = p.business_lead_id AND u_bl.tenant_id = p.tenant_id
       LEFT JOIN users u_il ON u_il.id = p.it_lead_id AND u_il.tenant_id = p.tenant_id
       WHERE p.id = $1
         AND p.tenant_id = $2
         ${projectRootScopeSql}
       LIMIT 1`,
      projectRootParams,
    );
    const project = projects[0];
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const requestAccessScope = await resolveAiParticipationAccessScope(context, 'requests');
    const taskAccessScope = await resolveAiParticipationAccessScope(context, 'tasks');
    const applicationAccessScope = await resolveAiParticipationAccessScope(context, 'applications');
    const projectRequestParams: unknown[] = [projectId, tenantId];
    const projectRequestScopeSql = appendParticipationScopeSql('requests', 'r', projectRequestParams, requestAccessScope);
    const projectDependencyParams: unknown[] = [projectId, tenantId];
    const projectDependencyScopeSql = appendParticipationScopeSql('projects', 'p', projectDependencyParams, projectAccessScope);
    const projectTaskParams: unknown[] = [projectId, tenantId];
    const projectTaskScopeSql = appendParticipationScopeSql('tasks', 't', projectTaskParams, taskAccessScope);
    const projectApplicationParams: unknown[] = [projectId, tenantId];
    const projectApplicationScopeSql = appendParticipationScopeSql('applications', 'a', projectApplicationParams, applicationAccessScope);

    const [
      requestRows,
      dependencyRows,
      applicationRows,
      assetRows,
      contributorRows,
      phaseRows,
      projectTaskRows,
      integratedDocumentRows,
      recentActivity,
    ] = await Promise.all([
      manager.query<SearchRow[]>(
        `SELECT r.id, r.item_number, r.name AS label, ${requestSummarySql} AS summary, r.status, r.updated_at
         FROM portfolio_request_projects rp
         JOIN portfolio_requests r ON r.id = rp.request_id AND r.tenant_id = $2 AND r.tenant_id = rp.tenant_id
         WHERE rp.project_id = $1
           AND rp.tenant_id = $2
           ${projectRequestScopeSql}
         ORDER BY r.updated_at DESC`,
        projectRequestParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT p.id, p.item_number, p.name AS label, ${projectSummarySql} AS summary, p.status, p.updated_at
         FROM portfolio_project_dependencies d
         JOIN portfolio_projects p ON p.id = d.depends_on_project_id AND p.tenant_id = $2 AND p.tenant_id = d.tenant_id
         WHERE d.project_id = $1
           AND d.tenant_id = $2
           ${projectDependencyScopeSql}
         ORDER BY p.updated_at DESC`,
        projectDependencyParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, a.description AS summary, a.status, a.updated_at
         FROM application_projects l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = $2 AND a.tenant_id = l.tenant_id
         WHERE l.project_id = $1
           AND l.tenant_id = $2
           ${projectApplicationScopeSql}
         ORDER BY a.updated_at DESC`,
        projectApplicationParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id, NULL::int AS item_number, a.name AS label, COALESCE(a.fqdn, a.hostname, a.notes) AS summary, a.status, a.updated_at
         FROM asset_projects l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = $2 AND a.tenant_id = l.tenant_id
         WHERE l.project_id = $1
           AND l.tenant_id = $2
         ORDER BY a.updated_at DESC`,
        [projectId, tenantId],
      ),
      manager.query<any[]>(
        `SELECT pt.user_id, u.email, u.first_name, u.last_name
         FROM portfolio_project_team pt
         JOIN users u ON u.id = pt.user_id AND u.tenant_id = pt.tenant_id
         WHERE pt.project_id = $1
           AND pt.tenant_id = $2
         ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.email ASC NULLS LAST`,
        [projectId, tenantId],
      ),
      manager.query<any[]>(
        `SELECT phase.name,
                phase.status,
                phase.sequence,
                phase.planned_start,
                phase.planned_end,
                COUNT(t.id)::int AS task_count
         FROM portfolio_project_phases phase
         LEFT JOIN tasks t ON t.phase_id = phase.id AND t.tenant_id = phase.tenant_id
         WHERE phase.project_id = $1
           AND phase.tenant_id = $2
         GROUP BY phase.id, phase.name, phase.status, phase.sequence, phase.planned_start, phase.planned_end
         ORDER BY phase.sequence ASC, phase.name ASC`,
        [projectId, tenantId],
      ),
      manager.query<any[]>(
        `SELECT t.id,
                t.item_number,
                COALESCE(t.title, 'Untitled task') AS label,
                t.description AS summary,
                t.status,
                t.updated_at,
                ${buildUserNameSql('u_assign')} AS assignee_name,
                t.priority_level,
                phase.name AS phase_name,
                phase.sequence AS phase_sequence
         FROM tasks t
         LEFT JOIN users u_assign ON u_assign.id = t.assignee_user_id AND u_assign.tenant_id = t.tenant_id
         LEFT JOIN portfolio_project_phases phase ON phase.id = t.phase_id AND phase.tenant_id = t.tenant_id
         WHERE t.related_object_type = 'project'
           AND t.related_object_id = $1
           AND t.tenant_id = $2
           ${projectTaskScopeSql}
         ORDER BY COALESCE(phase.sequence, 2147483647) ASC, t.updated_at DESC, t.item_number DESC`,
        projectTaskParams,
      ),
      canReadKnowledge
        ? this.listIntegratedDocuments(manager, {
          tenantId,
          sourceEntityType: 'projects',
          sourceEntityId: projectId,
          userId: context.userId ?? null,
        })
        : Promise.resolve([]),
      this.listRecentActivity(manager, { tenantId, projectId }),
    ]);

    return {
      entity: {
        ...toContextEntityBase('projects', {
          id: project.id,
          item_number: project.item_number,
          label: project.name,
          summary: project.summary,
          status: project.status,
          updated_at: project.updated_at,
        }),
        metadata: {
          origin: project.origin ?? null,
          execution_progress: toNullableNumber(project.execution_progress),
          planned_start: project.planned_start ?? null,
          planned_end: project.planned_end ?? null,
          actual_start: project.actual_start ?? null,
          actual_end: project.actual_end ?? null,
          business_lead: project.business_lead_id ? toPersonMetadata({ id: project.business_lead_id, name: project.business_lead_name }) : null,
          it_lead: project.it_lead_id ? toPersonMetadata({ id: project.it_lead_id, name: project.it_lead_name }) : null,
          contributors: contributorRows.map((row) => toPersonMetadata(row)),
          phases: phaseRows.map((row) => toProjectPhaseMetadata(row)),
          recent_activity: recentActivity.items,
          recent_activity_total: recentActivity.total,
          recent_activity_returned: recentActivity.items.length,
          recent_activity_truncated: recentActivity.total > recentActivity.items.length,
        },
      },
      related: [
        { relation: 'source_requests', label: 'Source Requests', items: requestRows.map((row) => toSummary('requests', row)) },
        { relation: 'dependencies', label: 'Dependencies', items: dependencyRows.map((row) => toSummary('projects', row)) },
        { relation: 'linked_applications', label: 'Linked Applications', items: applicationRows.map((row) => toSummary('applications', row)) },
        { relation: 'linked_assets', label: 'Linked Assets', items: assetRows.map((row) => toSummary('assets', row)) },
        { relation: 'project_tasks', label: 'Project Tasks', items: projectTaskRows.map((row) => toProjectTaskSummary(row)) },
        { relation: 'integrated_documents', label: 'Integrated Documents', items: integratedDocumentRows },
      ].filter((group) => group.items.length > 0),
      knowledge: await this.getKnowledgeContext(context, 'projects', projectId, manager),
    };
  }

  private async buildTaskContext(context: AiExecutionContextWithManager, taskId: string, manager: AiExecutionContextWithManager['manager']): Promise<AiEntityContextPayloadDto> {
    const { tenantId } = context;
    const taskAccessScope = await resolveAiParticipationAccessScope(context, 'tasks');
    const taskRootParams: unknown[] = [taskId, tenantId];
    const taskRootScopeSql = appendParticipationScopeSql('tasks', 't', taskRootParams, taskAccessScope);
    const requestAccessScope = await resolveAiParticipationAccessScope(context, 'requests');
    const convertedRequestScopeSql = appendParticipationScopeSql('requests', 'pr', taskRootParams, requestAccessScope);
    const tasks = await manager.query<any[]>(
      `SELECT t.id,
              t.item_number,
              COALESCE(t.title, 'Untitled task') AS title,
              t.description,
              t.status,
              t.updated_at,
              t.related_object_type,
              t.related_object_id,
              t.assignee_user_id,
              ${buildUserNameSql('u_assign')} AS assignee_name,
              t.creator_id,
              ${buildUserNameSql('u_creator')} AS creator_name,
              u_creator.email AS creator_email,
              t.priority_level,
              phase.name AS phase_name,
              phase.status AS phase_status,
              phase.planned_start AS phase_planned_start,
              phase.planned_end AS phase_planned_end,
              phase.sequence AS phase_sequence,
              tt.name AS task_type_name,
              COALESCE(rel_proj.name, rel_si.product_name, rel_ct.name, rel_cx.product_name, ${incidentRelatedLabelSql('rel_inc')}) AS related_object_name,
              pr.id AS converted_request_id,
              pr.item_number AS converted_request_item_number,
              pr.name AS converted_request_name,
              ${buildRequestSummarySql('pr')} AS converted_request_summary,
              pr.status AS converted_request_status,
              pr.updated_at AS converted_request_updated_at
       FROM tasks t
       LEFT JOIN portfolio_task_types tt ON tt.id = t.task_type_id AND tt.tenant_id = $2
       LEFT JOIN users u_assign ON u_assign.id = t.assignee_user_id AND u_assign.tenant_id = t.tenant_id
       LEFT JOIN users u_creator ON u_creator.id = t.creator_id AND u_creator.tenant_id = t.tenant_id
       LEFT JOIN portfolio_project_phases phase ON phase.id = t.phase_id AND phase.tenant_id = t.tenant_id
       LEFT JOIN portfolio_projects rel_proj ON rel_proj.id = t.related_object_id AND t.related_object_type = 'project' AND rel_proj.tenant_id = $2
       LEFT JOIN spend_items rel_si ON rel_si.id = t.related_object_id AND t.related_object_type = 'spend_item' AND rel_si.tenant_id = $2 AND rel_si.nature = 'opex'
       LEFT JOIN contracts rel_ct ON rel_ct.id = t.related_object_id AND t.related_object_type = 'contract' AND rel_ct.tenant_id = $2
       LEFT JOIN spend_items rel_cx ON rel_cx.id = t.related_object_id AND t.related_object_type = 'capex_item' AND rel_cx.tenant_id = $2 AND rel_cx.nature = 'capex'
       LEFT JOIN incidents rel_inc ON rel_inc.id = t.related_object_id AND t.related_object_type = 'incident' AND rel_inc.tenant_id = $2
       LEFT JOIN portfolio_requests pr ON pr.origin_task_id = t.id AND pr.tenant_id = $2 ${convertedRequestScopeSql}
       WHERE t.id = $1
         AND t.tenant_id = $2
         ${taskRootScopeSql}
       LIMIT 1`,
      taskRootParams,
    );
    const task = tasks[0];
    if (!task) {
      throw new NotFoundException('Task not found.');
    }

    const relatedGroups: AiEntityRelationshipGroupDto[] = [];
    const applicationAccessScope = await resolveAiParticipationAccessScope(context, 'applications');
    const taskApplicationParams: unknown[] = [taskId, tenantId];
    const taskApplicationScopeSql = appendParticipationScopeSql('applications', 'a', taskApplicationParams, applicationAccessScope);
    const [applicationRows, assetRows] = await Promise.all([
      manager.query<SearchRow[]>(
        `SELECT a.id,
                a.sequential_id AS item_ref,
                a.name AS label,
                a.description AS summary,
                a.lifecycle AS status,
                a.updated_at
         FROM task_applications ta
         JOIN applications a ON a.id = ta.application_id AND a.tenant_id = ta.tenant_id
         WHERE ta.task_id = $1
           AND ta.tenant_id = $2
           ${taskApplicationScopeSql}
         ORDER BY a.name ASC`,
        taskApplicationParams,
      ),
      manager.query<SearchRow[]>(
        `SELECT a.id,
                a.asset_reference AS item_ref,
                a.name AS label,
                a.notes AS summary,
                a.status,
                a.updated_at
         FROM task_assets ta
         JOIN assets a ON a.id = ta.asset_id AND a.tenant_id = ta.tenant_id
         WHERE ta.task_id = $1
           AND ta.tenant_id = $2
         ORDER BY a.name ASC`,
        [taskId, tenantId],
      ),
    ]);

    if (applicationRows.length > 0) {
      relatedGroups.push({
        relation: 'linked_applications',
        label: 'Linked Applications',
        items: applicationRows.map((row) => toSummary('applications', row)),
      });
    }

    if (assetRows.length > 0) {
      relatedGroups.push({
        relation: 'linked_assets',
        label: 'Linked Assets',
        items: assetRows.map((row) => toSummary('assets', row)),
      });
    }

    if (task.related_object_type === 'project' && task.related_object_id) {
      const projectAccessScope = await resolveAiParticipationAccessScope(context, 'projects');
      const relatedProjectParams: unknown[] = [task.related_object_id, tenantId];
      const relatedProjectScopeSql = appendParticipationScopeSql('projects', 'p', relatedProjectParams, projectAccessScope);
      const projectRows = await manager.query<SearchRow[]>(
        `SELECT p.id, p.item_number, p.name AS label, ${buildProjectSummarySql('p')} AS summary, p.status, p.updated_at
         FROM portfolio_projects p
         WHERE p.id = $1
           AND p.tenant_id = $2
           ${relatedProjectScopeSql}
         LIMIT 1`,
        relatedProjectParams,
      );
      if (projectRows[0]) {
        relatedGroups.push({
          relation: 'related_project',
          label: 'Related Project',
          items: [toSummary('projects', projectRows[0])],
        });
      }
    }

    if (task.converted_request_id) {
      relatedGroups.push({
        relation: 'converted_request',
        label: 'Converted Request',
        items: [toSummary('requests', {
          id: task.converted_request_id,
          item_number: task.converted_request_item_number,
          label: task.converted_request_name,
          summary: task.converted_request_summary ?? null,
          status: task.converted_request_status,
          updated_at: task.converted_request_updated_at,
        })],
      });
    }

    const recentActivity = await this.listRecentActivity(manager, { tenantId, taskId });

    return {
      entity: {
        ...toContextEntityBase('tasks', {
          id: task.id,
          item_number: task.item_number,
          label: task.title,
          summary: task.description,
          status: task.status,
          updated_at: task.updated_at,
        }),
        metadata: {
          task_type: task.task_type_name ?? null,
          related_to: task.related_object_type ?? null,
          related_object_name: task.related_object_name ?? null,
          assignee: task.assignee_name || null,
          creator: task.creator_id ? toPersonMetadata({ id: task.creator_id, name: task.creator_name, email: task.creator_email }) : null,
          priority_level: task.priority_level ?? null,
          phase: toTaskPhaseMetadata(task),
          recent_activity: recentActivity.items,
          recent_activity_total: recentActivity.total,
          recent_activity_returned: recentActivity.items.length,
          recent_activity_truncated: recentActivity.total > recentActivity.items.length,
        },
      },
      related: relatedGroups,
      knowledge: await this.getKnowledgeContext(context, 'tasks', taskId, manager),
    };
  }

  async getEntityContext(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiContextEntityType;
      entity_id: string;
    },
  ): Promise<AiEntityContextDto> {
    await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);

    let result: AiEntityContextPayloadDto;
    if (input.entity_type === 'applications') {
      result = await this.buildApplicationContext(context, input.entity_id, context.manager);
    } else if (input.entity_type === 'assets') {
      result = await this.buildAssetContext(context, input.entity_id, context.manager);
    } else if (input.entity_type === 'requests') {
      result = await this.buildRequestContext(context, input.entity_id, context.manager);
    } else if (input.entity_type === 'projects') {
      result = await this.buildProjectContext(context, input.entity_id, context.manager);
    } else if (input.entity_type === 'tasks') {
      result = await this.buildTaskContext(context, input.entity_id, context.manager);
    } else {
      throw new BadRequestException('Unsupported entity type.');
    }

    return {
      ...result,
      total: 1,
      returned: 1,
      truncated: result.entity.metadata?.recent_activity_truncated === true,
      complete: result.entity.metadata?.recent_activity_truncated !== true,
    };
  }

  private async resolveCommentTarget(
    context: AiExecutionContextWithManager,
    entityType: EntityCommentTargetType,
    entityIdOrRef: string,
  ): Promise<AiEntityCommentsDto['entity']> {
    const resolvedId = await resolveToUuid(
      entityIdOrRef,
      entityType === 'projects' ? 'project' : 'task',
      context.manager,
    );

    const accessScope = await resolveAiParticipationAccessScope(context, entityType);
    const rows = entityType === 'projects'
      ? await (() => {
        const params: unknown[] = [resolvedId, context.tenantId];
        const scopeSql = appendParticipationScopeSql('projects', 'p', params, accessScope);
        return context.manager.query<EntityCommentTargetRow[]>(
          `SELECT p.id,
                  p.item_number,
                  p.name AS label
           FROM portfolio_projects p
           WHERE p.id = $1
             AND p.tenant_id = $2
             ${scopeSql}
           LIMIT 1`,
          params,
        );
      })()
      : await (() => {
        const params: unknown[] = [resolvedId, context.tenantId];
        const scopeSql = appendParticipationScopeSql('tasks', 't', params, accessScope);
        return context.manager.query<EntityCommentTargetRow[]>(
          `SELECT t.id,
                  t.item_number,
                  COALESCE(t.title, 'Untitled task') AS label
           FROM tasks t
           WHERE t.id = $1
             AND t.tenant_id = $2
             ${scopeSql}
           LIMIT 1`,
          params,
        );
      })();

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(entityType === 'projects' ? 'Project not found.' : 'Task not found.');
    }

    return {
      type: entityType,
      id: row.id,
      ref: buildRef(entityType, row.item_number ?? null),
      label: row.label,
    };
  }

  private async listEntityCommentsPage(
    context: AiExecutionContextWithManager,
    target: AiEntityCommentsDto['entity'],
    offset: number,
    limit: number,
  ): Promise<{ items: AiEntityCommentDto[]; total: number }> {
    const countRows = target.type === 'projects'
      ? await context.manager.query<Array<{ total: number }>>(
        `SELECT COUNT(*)::int AS total
         FROM portfolio_activities a
         WHERE a.project_id = $1
           AND a.tenant_id = $2
           AND a.type = 'comment'`,
        [target.id, context.tenantId],
      )
      : await context.manager.query<Array<{ total: number }>>(
        `SELECT COUNT(*)::int AS total
         FROM portfolio_activities a
         WHERE a.task_id = $1
           AND a.tenant_id = $2
           AND a.type = 'comment'`,
        [target.id, context.tenantId],
      );

    const rows = target.type === 'projects'
      ? await context.manager.query<EntityCommentRow[]>(
        `SELECT ${buildUserNameSql('u_author')} AS author_name,
                a.content,
                a.created_at,
                a.updated_at
         FROM portfolio_activities a
         LEFT JOIN users u_author ON u_author.id = a.author_id AND u_author.tenant_id = a.tenant_id
         WHERE a.project_id = $1
           AND a.tenant_id = $2
           AND a.type = 'comment'
         ORDER BY a.created_at DESC
         OFFSET $3
         LIMIT $4`,
        [target.id, context.tenantId, offset, limit],
      )
      : await context.manager.query<EntityCommentRow[]>(
        `SELECT ${buildUserNameSql('u_author')} AS author_name,
                a.content,
                a.created_at,
                a.updated_at
         FROM portfolio_activities a
         LEFT JOIN users u_author ON u_author.id = a.author_id AND u_author.tenant_id = a.tenant_id
         WHERE a.task_id = $1
           AND a.tenant_id = $2
           AND a.type = 'comment'
         ORDER BY a.created_at DESC
         OFFSET $3
         LIMIT $4`,
        [target.id, context.tenantId, offset, limit],
      );

    return {
      items: rows.map((row) => toEntityCommentDto(row)),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async getEntityComments(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: EntityCommentTargetType;
      entity_id: string;
      offset?: number;
      limit?: number;
    },
  ): Promise<AiEntityCommentsDto> {
    await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);

    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.max(1, input.limit ?? 20);
    const target = await this.resolveCommentTarget(context, input.entity_type, input.entity_id);
    const { items, total } = await this.listEntityCommentsPage(context, target, offset, limit);

    const truncated = offset + items.length < total;
    return {
      entity: target,
      items,
      total,
      offset,
      limit,
      returned: items.length,
      truncated,
      complete: offset === 0 && !truncated,
    };
  }
}
