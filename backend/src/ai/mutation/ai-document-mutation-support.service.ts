import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { parseItemNumber } from '../../common/parse-item-number';
import { loadLinkedReads } from '../../common/relations/linked-reads';
import { validate as isUuid } from 'uuid';
import { incidentVisibilitySql, resolveIncidentViewer } from '../../incidents/incident-visibility';
import { DOCUMENT_RELATION_MODULES, KnowledgeService, RelationEntityType, unreadableRelationFamilies } from '../../knowledge/knowledge.service';
import {
  documentIncidentVisibilitySql,
} from '../../knowledge/document-entity-visibility';
import { AiExecutionContextWithManager } from '../ai.types';
import { resolveAiDocumentIncidentViewer } from '../query/ai-query-scope.util';
import {
  AI_DOCUMENT_RELATION_ENTITY_TYPES,
  AiDocumentRelationInput,
  getAiDocumentRelationLabel,
  getAiDocumentRelationSingular,
} from './ai-document-relation-input';

const DOCUMENT_REF_RE = /^DOC-(\d+)$/i;
const TEMPLATE_LIBRARY_SLUG = 'templates';

type AiRelationResolutionCandidate = {
  entityType: RelationEntityType;
  id: string;
  ref: string | null;
  label: string;
  name: string | null;
  updated_at: string | null;
};

export type AiDocumentRelationItem = {
  id: string;
  ref: string | null;
  label: string;
};

export type AiDocumentRelationState = Record<RelationEntityType, AiDocumentRelationItem[]>;
export type AiDocumentRelationSet = Partial<Record<RelationEntityType, AiDocumentRelationItem[]>>;
export type AiDocumentRelationMutationSet = {
  add?: AiDocumentRelationSet | null;
  remove?: AiDocumentRelationSet | null;
};

export type AiDocumentSnapshot = {
  document_id: string;
  target_ref: string | null;
  target_title: string | null;
  summary: string | null;
  content_markdown: string;
  revision: number;
  status: string | null;
  review_due_at: string | null;
  last_reviewed_at: string | null;
  is_managed_integrated_document: boolean;
  library_name: string | null;
  library_slug: string | null;
  folder_name: string | null;
  document_type_id: string | null;
  document_type_name: string | null;
  template_document_id: string | null;
  template_document_ref: string | null;
  template_document_title: string | null;
  updated_at: string | null;
  relations: AiDocumentRelationState;
};

export type AiDocumentCreateDefaults = {
  libraryId: string;
  libraryName: string;
  documentTypeId: string;
  documentTypeName: string;
};

type AiDocumentResolutionCandidate = {
  document_id: string;
  target_ref: string | null;
  target_title: string | null;
  library_name: string | null;
  library_slug: string | null;
  document_type_name: string | null;
  updated_at: string | null;
};

type AiRelationQueryConfig = {
  table: string;
  nameColumn: string;
  itemPrefix?: string;
  subject: string;
};

const RELATION_QUERY_CONFIG: Record<RelationEntityType, AiRelationQueryConfig> = {
  applications: {
    table: 'applications',
    nameColumn: 'name',
    subject: 'application',
  },
  assets: {
    table: 'assets',
    nameColumn: 'name',
    subject: 'asset',
  },
  projects: {
    table: 'portfolio_projects',
    nameColumn: 'name',
    itemPrefix: 'PRJ',
    subject: 'project',
  },
  requests: {
    table: 'portfolio_requests',
    nameColumn: 'name',
    itemPrefix: 'REQ',
    subject: 'request',
  },
  tasks: {
    table: 'tasks',
    nameColumn: 'title',
    itemPrefix: 'T',
    subject: 'task',
  },
  locations: {
    table: 'locations',
    nameColumn: 'name',
    subject: 'location',
  },
  connections: {
    table: 'connections',
    nameColumn: 'name',
    subject: 'connection',
  },
  interfaces: {
    table: 'interfaces',
    nameColumn: 'name',
    subject: 'interface',
  },
  incidents: {
    table: 'incidents',
    nameColumn: 'title',
    itemPrefix: 'INC',
    subject: 'incident',
  },
};

function toDateOnly(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class AiDocumentMutationSupportService {
  constructor(private readonly knowledge: KnowledgeService) {}

  private emptyRelationState(): AiDocumentRelationState {
    return {
      applications: [],
      assets: [],
      projects: [],
      requests: [],
      connections: [],
      tasks: [],
      locations: [],
      interfaces: [],
      incidents: [],
    };
  }

  private parseRelationItemNumber(entityType: RelationEntityType, input: string): number | null {
    const normalized = String(input || '').trim();
    if (!normalized) {
      return null;
    }

    switch (entityType) {
      case 'projects': {
        const match = normalized.match(/^(?:PRJ-|project\s+#?|prj\s+#?|#)?(\d+)$/i);
        return match ? parseItemNumber(match[1]) : null;
      }
      case 'requests': {
        const match = normalized.match(/^(?:REQ-|request\s+#?|req\s+#?|#)?(\d+)$/i);
        return match ? parseItemNumber(match[1]) : null;
      }
      case 'tasks': {
        const match = normalized.match(/^(?:T-|task\s+#?|ticket\s+#?|#)?(\d+)$/i);
        return match ? parseItemNumber(match[1]) : null;
      }
      case 'incidents': {
        const match = normalized.match(/^(?:INC[-\s]?)?(\d+)$/i);
        return match ? parseItemNumber(match[1]) : null;
      }
      default:
        return null;
    }
  }

  private buildRelationRef(entityType: RelationEntityType, itemNumber: unknown): string | null {
    const numeric = itemNumber == null ? null : Number(itemNumber);
    if (!Number.isFinite(numeric) || numeric == null) {
      return null;
    }

    switch (entityType) {
      case 'projects':
        return `PRJ-${numeric}`;
      case 'requests':
        return `REQ-${numeric}`;
      case 'tasks':
        return `T-${numeric}`;
      case 'incidents':
        return `INC-${numeric}`;
      default:
        return null;
    }
  }

  private buildRelationLabel(entityType: RelationEntityType, row: Record<string, unknown>): string {
    const name = String(row.name || '').trim() || String(row.id || '');
    const ref = this.buildRelationRef(entityType, row.item_number);
    return ref ? `${ref} - ${name}` : name;
  }

  private toRelationItem(entityType: RelationEntityType, row: Record<string, unknown>): AiDocumentRelationItem {
    const ref = this.buildRelationRef(entityType, row.item_number);
    return {
      id: String(row.id),
      ref,
      label: String(row.label || this.buildRelationLabel(entityType, row)),
    };
  }

  private toRelationState(relations: unknown): AiDocumentRelationState {
    const relationState = this.emptyRelationState();
    if (!relations || typeof relations !== 'object' || Array.isArray(relations)) {
      return relationState;
    }

    const relationMap = relations as Partial<Record<RelationEntityType, unknown>>;
    for (const entityType of AI_DOCUMENT_RELATION_ENTITY_TYPES) {
      const values = relationMap[entityType];
      if (!Array.isArray(values)) {
        continue;
      }

      const seen = new Set<string>();
      relationState[entityType] = values
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const item = this.toRelationItem(entityType, entry as Record<string, unknown>);
          if (!item.id || seen.has(item.id)) {
            return null;
          }
          seen.add(item.id);
          return item;
        })
        .filter((entry): entry is AiDocumentRelationItem => !!entry);
    }

    return relationState;
  }

  private normalizeStoredRelationSet(value: unknown): AiDocumentRelationSet {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const relationMap = value as Partial<Record<RelationEntityType, unknown>>;
    const normalized: AiDocumentRelationSet = {};

    for (const entityType of AI_DOCUMENT_RELATION_ENTITY_TYPES) {
      if (!Object.prototype.hasOwnProperty.call(relationMap, entityType)) {
        continue;
      }

      const items = relationMap[entityType];
      if (!Array.isArray(items)) {
        continue;
      }

      const seen = new Set<string>();
      const normalizedItems = items
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const item = entry as Record<string, unknown>;
          const id = String(item.id || '').trim();
          if (!id || seen.has(id)) {
            return null;
          }
          seen.add(id);
          return {
            id,
            ref: item.ref == null ? null : String(item.ref),
            label: String(item.label || item.name || item.ref || id),
          } satisfies AiDocumentRelationItem;
        })
        .filter((entry): entry is AiDocumentRelationItem => !!entry);

      normalized[entityType] = normalizedItems;
    }

    return normalized;
  }

  private formatRelationCandidate(candidate: AiRelationResolutionCandidate): string {
    const subject = candidate.label || candidate.ref || candidate.id;
    const details = candidate.updated_at
      ? `updated ${candidate.updated_at.slice(0, 10)}`
      : null;
    return details ? `${subject} (${details})` : subject;
  }

  private buildRelationAmbiguityMessage(
    entityType: RelationEntityType,
    query: string,
    candidates: AiRelationResolutionCandidate[],
    opts?: { exactNameAmbiguous?: boolean },
  ): string {
    const subject = RELATION_QUERY_CONFIG[entityType].subject;
    const [primary, ...rest] = candidates;
    const others = rest.slice(0, 2).map((candidate) => this.formatRelationCandidate(candidate));
    const reason = opts?.exactNameAmbiguous
      ? 'is ambiguous'
      : 'was not an exact unique match';

    return [
      `${subject[0].toUpperCase()}${subject.slice(1)} "${query}" ${reason}.`,
      `Most likely: ${this.formatRelationCandidate(primary)}.`,
      others.length > 0 ? `Also found: ${others.join('; ')}.` : null,
      `Ask the user to confirm which ${subject} to use before retrying.`,
    ].filter(Boolean).join(' ');
  }

  private async getExactRelationTarget(
    context: AiExecutionContextWithManager,
    entityType: RelationEntityType,
    idOrRefOrName: string,
  ): Promise<AiDocumentRelationItem> {
    const normalized = String(idOrRefOrName || '').trim();
    if (entityType === 'incidents') {
      return this.getExactIncidentRelationTarget(context, normalized);
    }
    const config = RELATION_QUERY_CONFIG[entityType];

    let rows: Array<Record<string, unknown>> = [];
    if (isUuid(normalized)) {
      rows = await context.manager.query(
        `SELECT id,
                ${config.nameColumn} AS name,
                ${config.itemPrefix ? 'item_number,' : 'NULL::int AS item_number,'}
                updated_at
         FROM ${config.table}
         WHERE tenant_id = $1
           AND id = $2
         LIMIT 1`,
        [context.tenantId, normalized],
      );
    } else {
      const itemNumber = this.parseRelationItemNumber(entityType, normalized);
      if (itemNumber != null && config.itemPrefix) {
        rows = await context.manager.query(
          `SELECT id,
                  ${config.nameColumn} AS name,
                  item_number,
                  updated_at
           FROM ${config.table}
           WHERE tenant_id = $1
             AND item_number = $2
           LIMIT 1`,
          [context.tenantId, itemNumber],
        );
      }
    }

    if (rows.length === 0) {
      throw new NotFoundException(`No ${config.subject} found matching "${normalized}".`);
    }

    return this.toRelationItem(entityType, rows[0]);
  }

  private async searchRelationCandidates(
    context: AiExecutionContextWithManager,
    entityType: RelationEntityType,
    query: string,
    limit = 5,
  ): Promise<AiRelationResolutionCandidate[]> {
    const normalized = String(query || '').trim();
    if (entityType === 'incidents') {
      return this.searchIncidentRelationCandidates(context, normalized, limit);
    }
    const config = RELATION_QUERY_CONFIG[entityType];
    const like = `%${normalized}%`;
    const prefix = `${normalized}%`;
    const itemNumber = this.parseRelationItemNumber(entityType, normalized);

    const params: unknown[] = [context.tenantId, like, normalized, prefix];
    let itemNumberSql = '';
    if (itemNumber != null && config.itemPrefix) {
      params.push(itemNumber);
      itemNumberSql = ` OR item_number = $${params.length}`;
    }
    params.push(Math.min(Math.max(limit, 1), 10));

    const rows = await context.manager.query(
      `SELECT id,
              ${config.nameColumn} AS name,
              ${config.itemPrefix ? 'item_number,' : 'NULL::int AS item_number,'}
              updated_at
       FROM ${config.table}
       WHERE tenant_id = $1
         AND (
           COALESCE(${config.nameColumn}, '') ILIKE $2
           ${itemNumberSql}
         )
       ORDER BY
         CASE
           WHEN lower(COALESCE(${config.nameColumn}, '')) = lower($3) THEN 0
           WHEN COALESCE(${config.nameColumn}, '') ILIKE $4 THEN 1
           WHEN COALESCE(${config.nameColumn}, '') ILIKE $2 THEN 2
           ELSE 3
         END ASC,
         updated_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return rows.map((row: Record<string, unknown>) => {
      const item = this.toRelationItem(entityType, row);
      return {
        entityType,
        id: item.id,
        ref: item.ref,
        label: item.label,
        name: row.name == null ? null : String(row.name),
        updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
      };
    });
  }

  private incidentRelationLabelSql(alias: string): string {
    return `CASE WHEN ${alias}.confidential THEN CONCAT('INC-', ${alias}.item_number::text) ELSE CONCAT('INC-', ${alias}.item_number::text, ' - ', ${alias}.title) END`;
  }

  private async getExactIncidentRelationTarget(
    context: AiExecutionContextWithManager,
    idOrRefOrName: string,
  ): Promise<AiDocumentRelationItem> {
    const params: unknown[] = [context.tenantId];
    const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
    let identitySql = '';
    if (isUuid(idOrRefOrName)) {
      params.push(idOrRefOrName);
      identitySql = `i.id = $${params.length}`;
    } else {
      const itemNumber = this.parseRelationItemNumber('incidents', idOrRefOrName);
      if (itemNumber == null) {
        throw new NotFoundException(`No incident found matching "${idOrRefOrName}".`);
      }
      params.push(itemNumber);
      identitySql = `i.item_number = $${params.length}`;
    }
    const visibility = incidentVisibilitySql('i', viewer, params);
    const rows = await context.manager.query(
      `SELECT i.id,
              i.title AS name,
              i.item_number,
              i.updated_at,
              ${this.incidentRelationLabelSql('i')} AS label
       FROM incidents i
       WHERE i.tenant_id = $1
         AND ${identitySql}
         ${visibility}
       LIMIT 1`,
      params,
    );
    if (rows.length === 0) {
      throw new NotFoundException(`No incident found matching "${idOrRefOrName}".`);
    }
    return this.toRelationItem('incidents', rows[0]);
  }

  private async searchIncidentRelationCandidates(
    context: AiExecutionContextWithManager,
    query: string,
    limit: number,
  ): Promise<AiRelationResolutionCandidate[]> {
    const like = `%${query}%`;
    const prefix = `${query}%`;
    const itemNumber = this.parseRelationItemNumber('incidents', query);
    const params: unknown[] = [context.tenantId, like, query, prefix];
    let itemNumberSql = '';
    if (itemNumber != null) {
      params.push(itemNumber);
      itemNumberSql = ` OR i.item_number = $${params.length}`;
    }
    const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
    const visibility = incidentVisibilitySql('i', viewer, params);
    params.push(Math.min(Math.max(limit, 1), 10));

    const rows = await context.manager.query(
      `SELECT i.id,
              i.title AS name,
              i.item_number,
              i.updated_at,
              ${this.incidentRelationLabelSql('i')} AS label
       FROM incidents i
       WHERE i.tenant_id = $1
         AND (
           COALESCE(i.title, '') ILIKE $2
           ${itemNumberSql}
         )
         ${visibility}
       ORDER BY
         CASE
           WHEN lower(COALESCE(i.title, '')) = lower($3) THEN 0
           WHEN COALESCE(i.title, '') ILIKE $4 THEN 1
           WHEN COALESCE(i.title, '') ILIKE $2 THEN 2
           ELSE 3
         END ASC,
         i.updated_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return rows.map((row: Record<string, unknown>) => {
      const item = this.toRelationItem('incidents', row);
      return {
        entityType: 'incidents',
        id: item.id,
        ref: item.ref,
        label: item.label,
        name: row.name == null ? null : String(row.name),
        updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
      };
    });
  }

  private toDocumentSnapshot(document: any): AiDocumentSnapshot {
    const templateItemNumber = document.template_document_item_number != null
      ? Number(document.template_document_item_number)
      : null;

    return {
      document_id: String(document.id),
      target_ref: document.item_ref ?? (document.item_number ? `DOC-${document.item_number}` : null),
      target_title: document.title ?? null,
      summary: document.summary ?? null,
      content_markdown: String(document.content_markdown || ''),
      revision: Number(document.revision ?? 0),
      status: document.status ?? null,
      review_due_at: toDateOnly(document.review_due_at),
      last_reviewed_at: toDateOnly(document.last_reviewed_at),
      is_managed_integrated_document: document.is_managed_integrated_document === true,
      library_name: document.library_name ?? null,
      library_slug: document.library_slug ?? null,
      folder_name: document.folder_name ?? null,
      document_type_id: document.document_type_id ? String(document.document_type_id) : null,
      document_type_name: document.document_type_name ?? null,
      template_document_id: document.template_document_id ? String(document.template_document_id) : null,
      template_document_ref: templateItemNumber ? `DOC-${templateItemNumber}` : null,
      template_document_title: document.template_document_title ?? null,
      updated_at: document.updated_at ? new Date(document.updated_at).toISOString() : null,
      relations: this.toRelationState(document.relations),
    };
  }

  private async getExactDocumentSnapshot(
    context: AiExecutionContextWithManager,
    idOrRef: string,
    opts?: { templatesOnly?: boolean; entityLabel?: 'document' | 'template' },
  ): Promise<AiDocumentSnapshot> {
    const document = await this.knowledge.get(idOrRef, { manager: context.manager, userId: context.userId });
    const snapshot = this.toDocumentSnapshot(document);

    if (opts?.templatesOnly && snapshot.library_slug !== TEMPLATE_LIBRARY_SLUG) {
      throw new BadRequestException(
        `${opts.entityLabel === 'template' ? 'Template' : 'Document'} reference must point to a document in the Templates library.`,
      );
    }

    return snapshot;
  }

  private async searchDocumentCandidates(
    context: AiExecutionContextWithManager,
    query: string,
    opts?: { templatesOnly?: boolean; limit?: number },
  ): Promise<AiDocumentResolutionCandidate[]> {
    const normalized = String(query || '').trim();
    const limit = Math.min(Math.max(Number(opts?.limit) || 5, 1), 10);
    const like = `%${normalized}%`;
    const prefix = `${normalized}%`;
    const accessibleLibraries = await this.knowledge.listLibraries({
      manager: context.manager,
      userId: context.userId,
    });
    const accessibleLibraryIds = accessibleLibraries.map((library) => String(library.id));
    if (accessibleLibraryIds.length === 0) {
      return [];
    }

    const params: unknown[] = [context.tenantId, like, normalized, prefix];
    let templateClause = '';
    if (opts?.templatesOnly) {
      params.push(TEMPLATE_LIBRARY_SLUG);
      templateClause = `AND dl.slug = $${params.length}`;
    }
    params.push(accessibleLibraryIds);
    const libraryAccessClause = `AND d.library_id = ANY($${params.length}::uuid[])`;
    // Resolving a document by title must not surface an incident review the
    // caller cannot see (the managed title carries "INC-N - <incident title>").
    const incidentAccessClause = documentIncidentVisibilitySql(
      'd',
      await resolveAiDocumentIncidentViewer(context),
      params,
    );
    params.push(limit);

    const rows = await context.manager.query(
      `SELECT d.id,
              d.item_number,
              d.title,
              dl.name AS library_name,
              dl.slug AS library_slug,
              dt.name AS document_type_name,
              d.updated_at
       FROM documents d
       LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id AND dt.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1
         ${templateClause}
         ${libraryAccessClause}
         ${incidentAccessClause}
         AND (
           d.title ILIKE $2
           OR COALESCE(d.summary, '') ILIKE $2
         )
       ORDER BY
         CASE
           WHEN lower(d.title) = lower($3) THEN 0
           WHEN d.title ILIKE $4 THEN 1
           WHEN d.title ILIKE $2 THEN 2
           ELSE 3
         END ASC,
         d.updated_at DESC,
         d.item_number DESC
       LIMIT $${params.length}`,
      params,
    );

    return rows.map((row: any) => ({
      document_id: String(row.id),
      target_ref: row.item_number ? `DOC-${row.item_number}` : null,
      target_title: row.title ? String(row.title) : null,
      library_name: row.library_name ? String(row.library_name) : null,
      library_slug: row.library_slug ? String(row.library_slug) : null,
      document_type_name: row.document_type_name ? String(row.document_type_name) : null,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    }));
  }

  private formatCandidate(candidate: AiDocumentResolutionCandidate): string {
    const ref = candidate.target_ref || candidate.document_id;
    const title = candidate.target_title ? `"${candidate.target_title}"` : 'Untitled document';
    const details = [
      candidate.library_name,
      candidate.document_type_name,
      candidate.updated_at ? `updated ${candidate.updated_at.slice(0, 10)}` : null,
    ].filter(Boolean);
    return details.length > 0
      ? `${ref} ${title} (${details.join(' / ')})`
      : `${ref} ${title}`;
  }

  private buildAmbiguityMessage(
    entityLabel: 'document' | 'template',
    query: string,
    candidates: AiDocumentResolutionCandidate[],
    opts?: { exactTitleAmbiguous?: boolean },
  ): string {
    const subject = entityLabel === 'template' ? 'Template' : 'Document';
    const [primary, ...rest] = candidates;
    const others = rest.slice(0, 2).map((candidate) => this.formatCandidate(candidate));
    const reason = opts?.exactTitleAmbiguous
      ? 'is ambiguous'
      : 'was not an exact unique match';

    return [
      `${subject} "${query}" ${reason}.`,
      `Most likely: ${this.formatCandidate(primary)}.`,
      others.length > 0
        ? `${entityLabel === 'template' ? 'Other matches' : 'Also found'}: ${others.join('; ')}.`
        : null,
      `Ask the user to confirm which ${entityLabel} to use, preferably by DOC reference, before retrying.`,
    ].filter(Boolean).join(' ');
  }

  async resolveDocumentSnapshot(
    context: AiExecutionContextWithManager,
    idOrRef: string,
    opts?: { templatesOnly?: boolean; entityLabel?: 'document' | 'template' },
  ): Promise<AiDocumentSnapshot> {
    const normalized = String(idOrRef || '').trim();
    const entityLabel = opts?.entityLabel || 'document';
    if (!normalized) {
      throw new BadRequestException(`${entityLabel === 'template' ? 'Template' : 'Document'} reference is required.`);
    }

    if (isUuid(normalized) || DOCUMENT_REF_RE.test(normalized)) {
      return this.getExactDocumentSnapshot(context, normalized, opts);
    }

    const candidates = await this.searchDocumentCandidates(context, normalized, opts);
    if (candidates.length === 0) {
      throw new NotFoundException(`No ${entityLabel} found matching "${normalized}".`);
    }

    const exactTitleMatches = candidates.filter((candidate) =>
      String(candidate.target_title || '').trim().toLowerCase() === normalized.toLowerCase(),
    );

    if (exactTitleMatches.length === 1) {
      return this.getExactDocumentSnapshot(context, exactTitleMatches[0].document_id, opts);
    }

    if (exactTitleMatches.length > 1) {
      throw new BadRequestException(
        this.buildAmbiguityMessage(entityLabel, normalized, exactTitleMatches, {
          exactTitleAmbiguous: true,
        }),
      );
    }

    throw new BadRequestException(
      this.buildAmbiguityMessage(entityLabel, normalized, candidates),
    );
  }

  async resolveTemplateSnapshot(
    context: AiExecutionContextWithManager,
    idOrRefOrTitle: string,
  ): Promise<AiDocumentSnapshot> {
    return this.resolveDocumentSnapshot(context, idOrRefOrTitle, {
      templatesOnly: true,
      entityLabel: 'template',
    });
  }

  async resolveCreateDefaults(
    context: AiExecutionContextWithManager,
  ): Promise<AiDocumentCreateDefaults> {
    const libraries = await this.knowledge.listLibraries({ manager: context.manager, userId: context.userId });
    const writableLibraries = libraries.filter((entry: any) => entry.can_write);
    const library = writableLibraries.find((entry: any) => entry.is_system !== true) ?? writableLibraries[0];
    if (!library) {
      throw new BadRequestException('No document library is available for this tenant.');
    }

    const documentTypes = await this.knowledge.listTypes({ manager: context.manager });
    const documentType = documentTypes.find((entry: any) => entry.is_default === true) ?? documentTypes[0];
    if (!documentType) {
      throw new BadRequestException('No document type is available for this tenant.');
    }

    return {
      libraryId: String(library.id),
      libraryName: String(library.name || library.id),
      documentTypeId: String(documentType.id),
      documentTypeName: String(documentType.name || documentType.id),
    };
  }

  async resolveRelationTarget(
    context: AiExecutionContextWithManager,
    entityType: RelationEntityType,
    idOrRefOrName: string,
  ): Promise<AiDocumentRelationItem> {
    const normalized = String(idOrRefOrName || '').trim();
    const config = RELATION_QUERY_CONFIG[entityType];
    if (!normalized) {
      throw new BadRequestException(`${config.subject} reference is required.`);
    }

    if (isUuid(normalized) || this.parseRelationItemNumber(entityType, normalized) != null) {
      return this.getExactRelationTarget(context, entityType, normalized);
    }

    const candidates = await this.searchRelationCandidates(context, entityType, normalized);
    if (candidates.length === 0) {
      throw new NotFoundException(`No ${config.subject} found matching "${normalized}".`);
    }

    const exactNameMatches = candidates.filter((candidate) =>
      String(candidate.name || '').trim().toLowerCase() === normalized.toLowerCase(),
    );

    if (exactNameMatches.length === 1) {
      return {
        id: exactNameMatches[0].id,
        ref: exactNameMatches[0].ref,
        label: exactNameMatches[0].label,
      };
    }

    if (exactNameMatches.length > 1) {
      throw new BadRequestException(
        this.buildRelationAmbiguityMessage(entityType, normalized, exactNameMatches, {
          exactNameAmbiguous: true,
        }),
      );
    }

    throw new BadRequestException(
      this.buildRelationAmbiguityMessage(entityType, normalized, candidates),
    );
  }

  async resolveRelationTargets(
    context: AiExecutionContextWithManager,
    requestedRelations: AiDocumentRelationInput | null | undefined,
  ): Promise<AiDocumentRelationSet> {
    const resolved: AiDocumentRelationSet = {};
    await this.assertRelationFamiliesReadable(context, requestedRelations);

    for (const entityType of AI_DOCUMENT_RELATION_ENTITY_TYPES) {
      const requests = requestedRelations?.[entityType] || [];
      if (requests.length === 0) {
        continue;
      }

      const resolvedItems: AiDocumentRelationItem[] = [];
      const seen = new Set<string>();

      for (const request of requests) {
        const target = await this.resolveRelationTarget(context, entityType, request);
        if (seen.has(target.id)) {
          continue;
        }
        seen.add(target.id);
        resolvedItems.push(target);
      }

      if (resolvedItems.length > 0) {
        resolved[entityType] = resolvedItems;
      }
    }

    return resolved;
  }

  /**
   * A family the caller does not read is neither looked up nor written: the document leaves it out
   * for them (`knowledge.get`), so a write would replace links they cannot see.
   */
  private async assertRelationFamiliesReadable(
    context: AiExecutionContextWithManager,
    requestedRelations: AiDocumentRelationInput | null | undefined,
  ): Promise<void> {
    const families = AI_DOCUMENT_RELATION_ENTITY_TYPES.filter((entityType) =>
      (requestedRelations?.[entityType] || []).length > 0 && DOCUMENT_RELATION_MODULES[entityType]);
    if (families.length === 0) return;
    const refused = unreadableRelationFamilies(families, await loadLinkedReads(context.manager, context.userId, context.tenantId));
    if (refused.length > 0) {
      throw new ForbiddenException(`You cannot link ${refused.join(', ')} to a document: you do not read that module.`);
    }
  }

  buildRelationAdditionMutation(
    currentRelations: AiDocumentRelationState,
    additions: AiDocumentRelationSet,
  ): {
    currentRelationSnapshot: AiDocumentRelationSet;
    nextRelations: Partial<Record<RelationEntityType, string[]>>;
    nextRelationLabels: AiDocumentRelationSet;
    changedTypes: RelationEntityType[];
  } {
    return this.buildRelationMutation(currentRelations, {
      add: additions,
    });
  }

  buildRelationMutation(
    currentRelations: AiDocumentRelationState,
    mutation: AiDocumentRelationMutationSet,
  ): {
    currentRelationSnapshot: AiDocumentRelationSet;
    nextRelations: Partial<Record<RelationEntityType, string[]>>;
    nextRelationLabels: AiDocumentRelationSet;
    changedTypes: RelationEntityType[];
  } {
    const currentRelationSnapshot: AiDocumentRelationSet = {};
    const nextRelations: Partial<Record<RelationEntityType, string[]>> = {};
    const nextRelationLabels: AiDocumentRelationSet = {};
    const changedTypes: RelationEntityType[] = [];

    for (const entityType of AI_DOCUMENT_RELATION_ENTITY_TYPES) {
      const additionsForType = mutation.add?.[entityType] || [];
      const removalsForType = mutation.remove?.[entityType] || [];
      if (additionsForType.length === 0 && removalsForType.length === 0) {
        continue;
      }

      const currentItems = currentRelations[entityType] || [];
      const removalIds = new Set(removalsForType.map((item) => item.id));
      const additionIds = new Set(additionsForType.map((item) => item.id));

      for (const item of removalsForType) {
        if (additionIds.has(item.id)) {
          throw new BadRequestException(
            `Cannot add and remove the same ${getAiDocumentRelationSingular(entityType)} in one preview.`,
          );
        }
      }

      const nextItems = currentItems.filter((item) => !removalIds.has(item.id));
      const existingIds = new Set(nextItems.map((item) => item.id));
      let changed = false;

      if (nextItems.length !== currentItems.length) {
        changed = true;
      }

      for (const item of additionsForType) {
        if (existingIds.has(item.id)) {
          continue;
        }
        existingIds.add(item.id);
        nextItems.push(item);
        changed = true;
      }

      if (!changed) {
        continue;
      }

      currentRelationSnapshot[entityType] = currentItems;
      nextRelations[entityType] = nextItems.map((item) => item.id);
      nextRelationLabels[entityType] = nextItems;
      changedTypes.push(entityType);
    }

    return {
      currentRelationSnapshot,
      nextRelations,
      nextRelationLabels,
      changedTypes,
    };
  }

  buildRelationPreviewChanges(
    currentRelations: unknown,
    nextRelations: unknown,
  ): Record<string, { label: string; from: string | null; to: string | null; format: 'markdown' }> {
    const currentRelationSet = this.normalizeStoredRelationSet(currentRelations);
    const nextRelationSet = this.normalizeStoredRelationSet(nextRelations);
    const changes: Record<string, { label: string; from: string | null; to: string | null; format: 'markdown' }> = {};

    for (const entityType of AI_DOCUMENT_RELATION_ENTITY_TYPES) {
      const hasCurrent = Object.prototype.hasOwnProperty.call(currentRelationSet, entityType);
      const hasNext = Object.prototype.hasOwnProperty.call(nextRelationSet, entityType);
      if (!hasCurrent && !hasNext) {
        continue;
      }

      const currentItems = currentRelationSet[entityType] || [];
      const nextItems = nextRelationSet[entityType];
      if (currentItems.length === 0 && (!nextItems || nextItems.length === 0)) {
        continue;
      }

      changes[`linked_${entityType}`] = {
        label: getAiDocumentRelationLabel(entityType),
        from: this.renderRelationListMarkdown(currentItems),
        to: this.renderRelationListMarkdown(nextItems || []),
        format: 'markdown',
      };
    }

    return changes;
  }

  assertRelationEditingAllowed(document: AiDocumentSnapshot): void {
    if (document.is_managed_integrated_document) {
      throw new BadRequestException('Managed integrated document relations cannot be changed from Knowledge');
    }
  }

  renderRelationListMarkdown(items: AiDocumentRelationItem[] | null | undefined): string | null {
    if (!items || items.length === 0) {
      return null;
    }
    return items.map((item) => `- ${item.label}`).join('\n');
  }

  assertRelationSnapshotUnchanged(
    liveDocument: AiDocumentSnapshot,
    expectedSnapshot: unknown,
  ): void {
    const expected = this.normalizeStoredRelationSet(expectedSnapshot);

    for (const entityType of AI_DOCUMENT_RELATION_ENTITY_TYPES) {
      const expectedItems = expected[entityType];
      if (!expectedItems) {
        continue;
      }

      const liveIds = [...(liveDocument.relations[entityType] || [])].map((item) => item.id).sort();
      const expectedIds = [...expectedItems].map((item) => item.id).sort();
      if (liveIds.length !== expectedIds.length || liveIds.some((id, index) => id !== expectedIds[index])) {
        throw new ConflictException(
          `Document ${getAiDocumentRelationSingular(entityType)} relations changed after the preview was created.`,
        );
      }
    }
  }

  /**
   * The preview of an AI document mutation must refuse exactly what the write
   * would refuse — write access first (library ACL, and for an incident review
   * `incidents:contributor` plus the closure freeze), then the workflow state
   * and another user's edit lock. Without the write check the preview would
   * disclose that a document the caller cannot write exists and is editable.
   */
  async assertUpdatePreviewAllowed(
    context: AiExecutionContextWithManager,
    documentId: string,
  ): Promise<void> {
    await this.knowledge.assertDocumentWritable(documentId, context.manager, context.userId);
    await this.knowledge.assertWorkflowAllowsEditing(documentId, context.manager);
    await this.knowledge.assertDocumentUnlockedForUser(documentId, context.userId, context.manager);
  }
}
