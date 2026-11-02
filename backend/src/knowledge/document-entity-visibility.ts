import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { codedForbidden, moduleRightRequired } from '../auth/module-right-required';
import {
  INCIDENT_FROZEN_STATUSES,
  INCIDENT_LEVEL_RANK,
  INCIDENT_LOCKED_MESSAGE,
  IncidentViewer,
  incidentConfidentialityPredicate,
  incidentVisibleToViewer,
  isIncidentAdminFromFacts,
  loadIncidentRoleFacts,
} from '../incidents/incident-visibility';
import { INCIDENT_REVIEW_SLOT } from './integrated-document.constants';

/**
 * Access rules for documents that are bound to a business entity through
 * `integrated_document_bindings`.
 *
 * Today only `incidents:review` restricts a document beyond the Knowledge
 * library ACL: an incident review inherits the incident's row visibility
 * (confidential → registry admins, reporter, owner), its RBAC resource
 * (`incidents`) and its closure freeze.
 *
 * This module deliberately depends on nothing but the incident visibility
 * primitives and raw SQL: `KnowledgeModule` must not import `IncidentsModule`
 * (`IncidentsModule` already imports `KnowledgeModule`).
 */

export const INCIDENT_SOURCE_ENTITY_TYPE = INCIDENT_REVIEW_SLOT.sourceEntityType;
export const INCIDENT_REVIEW_SLOT_KEY = INCIDENT_REVIEW_SLOT.slotKey;

/** Re-exported under its document-side name; the text lives in `incident-visibility.ts`. */
export const INCIDENT_REVIEW_LOCKED_MESSAGE = INCIDENT_LOCKED_MESSAGE;
export const DOCUMENT_NOT_FOUND_MESSAGE = 'Document not found';

/**
 * An incident viewer plus the two RBAC answers a document ACL needs. Resolved
 * once per query (never per row) and reused by both the SQL predicate and the
 * unit assertions.
 */
export type DocumentIncidentViewer = IncidentViewer & {
  /** incidents:reader or better (Administrator and incidents:admin included). */
  canReadIncidents: boolean;
  /** incidents:contributor or better. */
  canContributeIncidents: boolean;
};

export const ANONYMOUS_DOCUMENT_INCIDENT_VIEWER: DocumentIncidentViewer = Object.freeze({
  userId: null,
  isAdmin: false,
  canReadIncidents: false,
  canContributeIncidents: false,
});

/**
 * Server-built proof that a call arrived through the incident's own routes
 * (`/incidents/:id/integrated-documents/review`, the incident PDF, the incident
 * AI record). It grants the "source" column of the §3.7 matrix: incidents
 * permissions and row visibility replace the Knowledge library ACL for that one
 * document — never for templates, linked documents or anything else.
 *
 * It is never accepted from a DTO, a header or an AI tool argument, and it is
 * only honoured after the binding has been re-read and matched field by field.
 */
export type DocumentSourceAccessContext = {
  userId: string;
  tenantId: string;
  sourceEntityType: typeof INCIDENT_SOURCE_ENTITY_TYPE;
  sourceEntityId: string;
  slotKey: typeof INCIDENT_REVIEW_SLOT_KEY;
  /**
   * §3.8 CSV-import exemption: lets a review be written on a closed or cancelled
   * incident. Confidentiality, tenant, `incidents:contributor` and the other
   * user's edit lock still apply. Only `buildIncidentReviewImportContext` sets
   * it; no API, DTO or AI tool can reach it.
   */
  allowFrozenIncident?: boolean;
};

/** The server-side entry point for the incident routes / PDF / AI record (§3.7 source column). */
export function buildIncidentReviewSourceContext(params: {
  userId: string | null | undefined;
  tenantId: string | null | undefined;
  incidentId: string;
}): DocumentSourceAccessContext | null {
  const userId = normalizeId(params.userId);
  const tenantId = normalizeId(params.tenantId);
  const incidentId = normalizeId(params.incidentId);
  if (!userId || !tenantId || !incidentId) return null;
  return {
    userId,
    tenantId,
    sourceEntityType: INCIDENT_SOURCE_ENTITY_TYPE,
    sourceEntityId: incidentId,
    slotKey: INCIDENT_REVIEW_SLOT_KEY,
  };
}

/** The CSV-import variant (§3.8). Never call it from a request-driven document route. */
export function buildIncidentReviewImportContext(params: {
  userId: string | null | undefined;
  tenantId: string | null | undefined;
  incidentId: string;
}): DocumentSourceAccessContext | null {
  const context = buildIncidentReviewSourceContext(params);
  return context ? { ...context, allowFrozenIncident: true } : null;
}

/** Binding row joined with the incident it points at (`incident_id` null ⇒ orphan binding). */
export type DocumentIncidentBinding = {
  document_id: string;
  tenant_id: string;
  source_entity_id: string;
  slot_key: string;
  incident_id: string | null;
  item_number: number | null;
  status: string | null;
  confidential: boolean | null;
  reporter_user_id: string | null;
  owner_user_id: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Some internal surfaces carry a non-UUID actor label instead of a real user id
 * (headless agent runs, tool harnesses). Those are not users: they get no
 * incidents rights, and the query is skipped rather than crashing on a cast.
 */
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Tenant of the current connection; used when a caller has no tenantId at hand. */
export async function resolveCurrentTenantId(
  manager: EntityManager,
  tenantId?: string | null,
): Promise<string | null> {
  const provided = normalizeId(tenantId);
  if (provided) return provided;
  const rows = await manager.query<Array<{ tenant_id: string | null }>>(
    'SELECT app_current_tenant()::text AS tenant_id',
  );
  return normalizeId(rows[0]?.tenant_id) || null;
}

/**
 * incidents:admin / :reader / :contributor for one user, in a single query.
 *
 * Mirrors `resolveIncidentViewer` (legacy `users.role_id` + `user_roles`,
 * Administrator short-circuit) and additionally requires an enabled account and
 * reports the reader/contributor levels the document ACL needs. Fails closed on
 * a missing identity or tenant without issuing any query.
 */
export async function resolveDocumentIncidentViewer(
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId?: string | null,
): Promise<DocumentIncidentViewer> {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return ANONYMOUS_DOCUMENT_INCIDENT_VIEWER;
  if (!isUuid(normalizedUserId)) return ANONYMOUS_DOCUMENT_INCIDENT_VIEWER;

  const tenant = await resolveCurrentTenantId(manager, tenantId);
  if (!tenant || !isUuid(tenant)) {
    return { ...ANONYMOUS_DOCUMENT_INCIDENT_VIEWER, userId: normalizedUserId };
  }

  const facts = await loadIncidentRoleFacts(manager, normalizedUserId, tenant);
  if (!facts.userOk) {
    return { ...ANONYMOUS_DOCUMENT_INCIDENT_VIEWER, userId: normalizedUserId };
  }

  const isAdmin = isIncidentAdminFromFacts(facts);
  return {
    userId: normalizedUserId,
    isAdmin,
    canReadIncidents: isAdmin || facts.levelRank >= INCIDENT_LEVEL_RANK.reader,
    canContributeIncidents: isAdmin || facts.levelRank >= INCIDENT_LEVEL_RANK.contributor,
  };
}

/**
 * The binding of a document, if any, with the incident it points at.
 *
 * `document_id` is unique in `integrated_document_bindings`, so this is at most
 * one row. A binding whose incident row is missing (or lives in another tenant)
 * comes back with `incident_id = null` — an orphan, always refused.
 */
export async function loadDocumentIncidentBinding(
  manager: EntityManager,
  documentId: string,
  tenantId?: string | null,
): Promise<DocumentIncidentBinding | null> {
  const normalizedDocumentId = normalizeId(documentId);
  if (!normalizedDocumentId) return null;

  const params: unknown[] = [normalizedDocumentId];
  let tenantClause = 'b.tenant_id = app_current_tenant()';
  const tenant = normalizeId(tenantId);
  if (tenant) {
    params.push(tenant);
    tenantClause = `b.tenant_id = $${params.length}`;
  }

  const rows = await manager.query<Array<DocumentIncidentBinding>>(
    `SELECT b.document_id::text AS document_id,
            b.tenant_id::text AS tenant_id,
            b.source_entity_id::text AS source_entity_id,
            b.slot_key,
            i.id::text AS incident_id,
            i.item_number,
            i.status,
            i.confidential,
            i.reporter_user_id::text AS reporter_user_id,
            i.owner_user_id::text AS owner_user_id
     FROM integrated_document_bindings b
     LEFT JOIN incidents i
       ON i.id = b.source_entity_id
      AND i.tenant_id = b.tenant_id
     WHERE b.document_id = $1
       AND ${tenantClause}
       AND b.source_entity_type = '${INCIDENT_SOURCE_ENTITY_TYPE}'
     LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
}

/**
 * §3.3 lock ordering, entered from the document side (phase A3).
 *
 * Takes the transactional row lock on the incident that owns `documentId`,
 * **before** the binding and the document are read or written. The incident
 * services take the same lock first on every status / confidentiality / owner /
 * reporter change, so the order is always incident → document and a closure can
 * neither slip between the freeze check and the write, nor land after an
 * ordinary save that was authorised before it.
 *
 * A no-op (zero rows, no lock) for a document that is not an incident review.
 * Outside a transaction the lock is released immediately, which is the
 * pre-existing behaviour of every other write on that path.
 */
export async function lockIncidentRowForDocument(
  manager: EntityManager,
  documentId: string,
  tenantId?: string | null,
): Promise<void> {
  const normalizedDocumentId = normalizeId(documentId);
  if (!normalizedDocumentId || !isUuid(normalizedDocumentId)) return;

  const params: unknown[] = [normalizedDocumentId];
  let tenantClause = 'app_current_tenant()';
  const tenant = normalizeId(tenantId);
  if (tenant) {
    params.push(tenant);
    tenantClause = `$${params.length}::uuid`;
  }

  await manager.query(
    `SELECT i.id
     FROM incidents i
     WHERE i.tenant_id = ${tenantClause}
       AND i.id = (
         SELECT b.source_entity_id
         FROM integrated_document_bindings b
         WHERE b.document_id = $1
           AND b.tenant_id = ${tenantClause}
           AND b.source_entity_type = '${INCIDENT_SOURCE_ENTITY_TYPE}'
         LIMIT 1
       )
     FOR UPDATE`,
    params,
  );
}

/** True when the context describes exactly this binding (tenant, entity, slot, document). */
export function sourceContextMatchesBinding(
  context: DocumentSourceAccessContext | null | undefined,
  binding: DocumentIncidentBinding | null | undefined,
  documentId: string,
): boolean {
  if (!context || !binding) return false;
  return (
    context.sourceEntityType === INCIDENT_SOURCE_ENTITY_TYPE
    && context.slotKey === INCIDENT_REVIEW_SLOT_KEY
    && normalizeId(context.userId) !== ''
    && normalizeId(context.sourceEntityId) === normalizeId(binding.source_entity_id)
    && normalizeId(context.tenantId) === normalizeId(binding.tenant_id)
    && binding.slot_key === INCIDENT_REVIEW_SLOT_KEY
    && normalizeId(binding.document_id) === normalizeId(documentId)
  );
}

/** Row-level answer: identity + incidents:reader + incident visibility. No query. */
export function isDocumentIncidentVisible(
  binding: DocumentIncidentBinding,
  viewer: DocumentIncidentViewer,
): boolean {
  if (!binding.incident_id) return false;
  if (!viewer.canReadIncidents) return false;
  return incidentVisibleToViewer(
    {
      confidential: binding.confidential,
      reporter_user_id: binding.reporter_user_id,
      owner_user_id: binding.owner_user_id,
    },
    viewer,
  );
}

/** Row-level answer for writes: visible + incidents:contributor + incident not frozen. No query. */
export function isDocumentIncidentWritable(
  binding: DocumentIncidentBinding,
  viewer: DocumentIncidentViewer,
): boolean {
  if (!isDocumentIncidentVisible(binding, viewer)) return false;
  if (!viewer.canContributeIncidents) return false;
  return !INCIDENT_FROZEN_STATUSES.has(String(binding.status || ''));
}

/** Throwing form of `isDocumentIncidentVisible` (404, never 403 — presence is confidential). */
export function assertIncidentBindingVisible(
  binding: DocumentIncidentBinding,
  viewer: DocumentIncidentViewer,
): void {
  if (!isDocumentIncidentVisible(binding, viewer)) {
    throw new NotFoundException(DOCUMENT_NOT_FOUND_MESSAGE);
  }
}

/**
 * Throwing form of `isDocumentIncidentWritable`. Visibility first (404), then
 * the missing contributor level (403), then the closure freeze (403).
 */
export function assertIncidentBindingWritable(
  binding: DocumentIncidentBinding,
  viewer: DocumentIncidentViewer,
  opts?: { allowFrozenIncident?: boolean },
): void {
  assertIncidentBindingVisible(binding, viewer);
  if (!viewer.canContributeIncidents) {
    throw moduleRightRequired('incidents', 'contributor', 'incidents:contributor permission is required');
  }
  if (!opts?.allowFrozenIncident && INCIDENT_FROZEN_STATUSES.has(String(binding.status || ''))) {
    throw codedForbidden('INCIDENT_REVIEW_LOCKED', INCIDENT_REVIEW_LOCKED_MESSAGE);
  }
}

export type DocumentIncidentAccessOptions = {
  tenantId?: string | null;
  /** Already-resolved viewer/binding, so a caller never queries twice. */
  viewer?: DocumentIncidentViewer | null;
  binding?: DocumentIncidentBinding | null;
  /** §3.8 CSV-import exemption; ignored on the read path. */
  allowFrozenIncident?: boolean;
};

/**
 * A document bound to an incident is only readable by someone who could read
 * the incident. A document with no incident binding is a no-op.
 *
 * Returns the binding (or null) so callers can reuse it instead of re-querying.
 */
export async function assertDocumentIncidentVisible(
  documentId: string,
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId?: string | null,
  opts?: DocumentIncidentAccessOptions,
): Promise<DocumentIncidentBinding | null> {
  const binding = opts?.binding !== undefined
    ? opts.binding
    : await loadDocumentIncidentBinding(manager, documentId, tenantId);
  if (!binding) return null;

  const viewer = opts?.viewer
    ?? await resolveDocumentIncidentViewer(manager, userId, tenantId ?? binding.tenant_id);
  assertIncidentBindingVisible(binding, viewer);
  return binding;
}

/**
 * Same, for writes: visibility, then `incidents:contributor`, then the closure
 * freeze. Callers that mutate must run this under the §3.3 transactional lock
 * (incident row first, then the document) so a status change cannot land
 * between the check and the write.
 */
export async function assertDocumentIncidentWritable(
  documentId: string,
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId?: string | null,
  opts?: DocumentIncidentAccessOptions,
): Promise<DocumentIncidentBinding | null> {
  const binding = opts?.binding !== undefined
    ? opts.binding
    : await loadDocumentIncidentBinding(manager, documentId, tenantId);
  if (!binding) return null;

  const viewer = opts?.viewer
    ?? await resolveDocumentIncidentViewer(manager, userId, tenantId ?? binding.tenant_id);
  assertIncidentBindingWritable(binding, viewer, { allowFrozenIncident: opts?.allowFrozenIncident === true });
  return binding;
}

/**
 * Batch predicate: excludes from a `documents` query every row bound to an
 * incident the viewer may not see. Equivalent to `isDocumentIncidentVisible`,
 * evaluated in SQL so lists, totals and filter values are filtered before
 * pagination or aggregation.
 *
 * `documentAlias` is controlled by the calling code (never user input);
 * `params` is the positional parameter array, appended in place.
 *
 * Three branches, in this order:
 *  - no identity or no `incidents:reader` → every incident-bound document is out;
 *  - registry admin → only orphan bindings are out;
 *  - identified reader → orphan bindings and confidential incidents that are
 *    neither reported nor owned by the viewer are out.
 *
 * The confidentiality rule itself is not restated here: it is the register's own
 * `incidentConfidentialityPredicate`, in its `hidden` polarity, so the document
 * ACL and the incident list cannot drift. `IS NOT TRUE` (not `NOT (...)`) is
 * load-bearing there: a null reporter/owner would otherwise make the comparison
 * unknown and let the document through.
 */
export function documentIncidentVisibilitySql(
  documentAlias: string,
  viewer: DocumentIncidentViewer | null | undefined,
  params: unknown[],
): string {
  const alias = documentAlias;
  const bindingScope = `b_acl.document_id = ${alias}.id
      AND b_acl.tenant_id = ${alias}.tenant_id
      AND b_acl.source_entity_type = '${INCIDENT_SOURCE_ENTITY_TYPE}'`;

  const excludeEveryBoundDocument = ` AND NOT EXISTS (
    SELECT 1
    FROM integrated_document_bindings b_acl
    WHERE ${bindingScope}
  )`;

  // A non-admin viewer with no identity cannot be matched against a reporter or
  // an owner, so nothing beyond "no incident-bound document at all" is grantable.
  if (!viewer?.canReadIncidents) return excludeEveryBoundDocument;
  if (!viewer.isAdmin && !String(viewer.userId || '').trim()) return excludeEveryBoundDocument;

  const orphanOnly = `i_acl.id IS NULL`;
  const confidentiality = incidentConfidentialityPredicate('i_acl', viewer, params);
  const rowCondition = confidentiality.unrestricted
    ? orphanOnly
    : `${orphanOnly}
      OR (
        ${confidentiality.hidden}
      )`;

  return ` AND NOT EXISTS (
    SELECT 1
    FROM integrated_document_bindings b_acl
    LEFT JOIN incidents i_acl
      ON i_acl.id = b_acl.source_entity_id
     AND i_acl.tenant_id = b_acl.tenant_id
    WHERE ${bindingScope}
      AND (
        ${rowCondition}
      )
  )`;
}

/**
 * Same predicate for a TypeORM QueryBuilder (named parameters). Built on the
 * positional form so the two cannot drift.
 */
export function documentIncidentVisibilityQueryBuilderClause(
  documentAlias: string,
  viewer: DocumentIncidentViewer | null | undefined,
  paramName = 'documentIncidentAclUserId',
): { clause: string; params: Record<string, unknown> } {
  const params: unknown[] = [];
  const sql = documentIncidentVisibilitySql(documentAlias, viewer, params);
  const clause = sql.replace(/^\s*AND\s/, '').replace(/\$1\b/g, `:${paramName}`);
  return {
    clause,
    params: params.length > 0 ? { [paramName]: params[0] } : {},
  };
}
