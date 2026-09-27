import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { extractInlineImageUrls } from '../common/content-image-urls';
import { ItemNumberService } from '../common/item-number.service';
import { DocumentImportService, ImportedDocumentResult } from '../common/document-import.service';
import { normalizeMarkdownRichText } from '../common/markdown-rich-text';
import { markdownToSearchText } from '../common/markdown-search-text';
import { bilingualDocumentTsQueryAnyTermSql, bilingualDocumentTsQuerySql, normalizeDocumentAnyTermQuery } from '../common/document-search-tsquery';
import { DocumentExportService, ExportImageFetchOptions } from '../common/document-export.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { ImportExecutionOptions, readUploadedFileBuffer } from '../common/import-connection';
import { fixMulterFilename } from '../common/upload';
import { validateUploadedFile } from '../common/upload-validation';
import { parsePagination } from '../common/pagination';
import { normalizeAgFilterModel } from '../common/ag-grid-filtering';
import { resolveToUuid } from '../common/resolve-item-id';
import { resolveInlineTenantSlug } from '../common/resolve-inline-tenant-slug';
import { StorageService } from '../common/storage/storage.service';
import { RemoteInlineImageImportService } from '../common/remote-inline-image-import.service';
import { Features } from '../config/features';
import { EmailService } from '../email/email.service';
import { resolveEmailLocale } from '../i18n/email-i18n';
import type { EmailContent } from '../notifications/notification-templates';
import { NotificationsService } from '../notifications/notifications.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { PermissionLevel, PermissionsService } from '../permissions/permissions.service';
import { INCIDENT_REVIEW_SLOT } from './integrated-document.constants';
import { incidentVisibilitySql } from '../incidents/incident-visibility';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.entity';
import {
  DocumentSourceAccessContext,
  assertDocumentIncidentVisible,
  assertDocumentIncidentWritable,
  documentIncidentVisibilityQueryBuilderClause,
  documentIncidentVisibilitySql,
  isDocumentIncidentVisible,
  isDocumentIncidentWritable,
  loadDocumentIncidentBinding,
  lockIncidentRowForDocument,
  resolveDocumentIncidentViewer,
  sourceContextMatchesBinding,
} from './document-entity-visibility';
import { DocumentActivity } from './document-activity.entity';
import { DocumentApplication } from './document-application.entity';
import { DocumentAsset } from './document-asset.entity';
import { DocumentAttachment } from './document-attachment.entity';
import { DocumentClassification } from './document-classification.entity';
import { DocumentContributor } from './document-contributor.entity';
import { DocumentEditLock } from './document-edit-lock.entity';
import { DocumentFolder } from './document-folder.entity';
import { IntegratedDocumentBinding } from './integrated-document-binding.entity';
import { DocumentLibrary } from './document-library.entity';
import { DocumentLibraryMember } from './document-library-member.entity';
import { DocumentProject } from './document-project.entity';
import { DocumentReference } from './document-reference.entity';
import { DocumentRequest } from './document-request.entity';
import { DOCUMENT_STATUSES, DocumentStatus, isDocumentStatus } from './document-status';
import { DocumentTask } from './document-task.entity';
import { DocumentType } from './document-type.entity';
import { DocumentVersion } from './document-version.entity';
import { Document } from './document.entity';

export type RelationEntityType =
  | 'applications'
  | 'assets'
  | 'projects'
  | 'requests'
  | 'tasks'
  | 'locations'
  | 'connections'
  | 'interfaces'
  | 'incidents';
export type EntityDocumentListAccess = 'granted' | 'restricted';
export type EntityDocumentListItem = {
  id: string;
  item_number: number;
  title: string;
  summary: string | null;
  status: string;
  updated_at: Date | string | null;
  created_at: Date | string | null;
};
export type EntityDocumentListResponse = {
  access: EntityDocumentListAccess;
  total: number;
  items: EntityDocumentListItem[];
};
export type VersionSnapshotResult = {
  version: DocumentVersion;
  created: boolean;
};
export type EntityKnowledgeContextGroupKey =
  | 'direct'
  | 'resulting_projects'
  | 'source_requests'
  | 'dependencies'
  | 'linked_requests'
  | 'linked_projects'
  | 'linked_applications'
  | 'linked_assets';
export type EntityKnowledgeContextSource = {
  entity_type: RelationEntityType;
  entity_id: string;
  item_number: number | null;
  item_ref?: string | null;
  name: string;
  status: string | null;
};
export type EntityKnowledgeContextItem = EntityDocumentListItem & {
  provenance: EntityKnowledgeContextSource[];
};
export type EntityKnowledgeContextGroup = {
  key: EntityKnowledgeContextGroupKey;
  label: string;
  linked_via_label: string;
  total: number;
  items: EntityKnowledgeContextItem[];
};
export type EntityKnowledgeContextResponse = {
  access: EntityDocumentListAccess;
  total: number;
  groups: EntityKnowledgeContextGroup[];
};

type KnowledgeLibraryAccessMode = 'default' | 'restricted';
type KnowledgeLibraryMemberLevel = 'reader' | 'writer';
type KnowledgeLibraryEffectiveAccessLevel = 'reader' | 'writer' | 'admin';
type KnowledgeLibraryView = DocumentLibrary & {
  is_restricted: boolean;
  effective_access_level: KnowledgeLibraryEffectiveAccessLevel | null;
  can_manage: boolean;
  can_write: boolean;
  can_delete: boolean;
};
type KnowledgeLibraryMemberView = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  label: string;
};
type KnowledgeLibraryDetailView = KnowledgeLibraryView & {
  owner: KnowledgeLibraryMemberView | null;
  readers: KnowledgeLibraryMemberView[];
  writers: KnowledgeLibraryMemberView[];
};

/**
 * Internal-only access options threaded through every document read/write.
 * `sourceContext` is built by the server (incident routes, incident PDF/AI
 * record) and is never accepted from a DTO, a header or an AI tool argument.
 */
export type DocumentAccessOptions = {
  sourceContext?: DocumentSourceAccessContext | null;
  tenantId?: string | null;
};

export type { DocumentSourceAccessContext };

/** `%`, `_` and `\` are LIKE metacharacters: escaped so the fragment matches literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

const LOCK_TTL_SECONDS = 5 * 60;
const DEFAULT_DOCUMENT_TYPE_NAME = 'Document';
const TEMPLATE_LIBRARY_SLUG = 'templates';
const DOCUMENT_CONTRIBUTOR_ROLES = new Set(['owner', 'author', 'reviewer', 'validator']);
const RBAC_LEVEL_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
const LIBRARY_ACCESS_RANK: Record<KnowledgeLibraryEffectiveAccessLevel, number> = { reader: 1, writer: 2, admin: 3 };
const ACTIVE_WORKFLOW_STATUSES = new Set(['pending_review', 'pending_approval']);
const INLINE_ATTACHMENT_SOURCE_RESOURCE: Record<'requests' | 'projects', 'portfolio_requests' | 'portfolio_projects'> = {
  requests: 'portfolio_requests',
  projects: 'portfolio_projects',
};
const WORKFLOW_STAGE_TO_ROLE: Record<'reviewer' | 'approver', 'reviewer' | 'validator'> = {
  reviewer: 'reviewer',
  approver: 'validator',
};

type DocumentWorkflowStage = 'reviewer' | 'approver';
type DocumentWorkflowStatus = 'pending_review' | 'pending_approval' | 'changes_requested' | 'approved' | 'cancelled';
type DocumentWorkflowDecision = 'pending' | 'approved' | 'changes_requested';
type DocumentLinkedEntityField =
  | 'linked_application'
  | 'linked_asset'
  | 'linked_project'
  | 'linked_request'
  | 'linked_task';
type DocumentLinkedEntitySurface =
  | {
      kind: 'legacy';
      table: string;
      relationAlias: string;
      relationIdColumn: string;
      targetTable: string;
      targetAlias: string;
      targetMatchExpressions: string[];
    }
  | {
      kind: 'integrated';
      relationAlias: string;
      sourceEntityType: 'applications' | 'assets' | 'projects' | 'requests';
      targetTable: string;
      targetAlias: string;
      targetMatchExpressions: string[];
    };

const DOCUMENT_LINKED_ENTITY_FILTERS: Record<DocumentLinkedEntityField, DocumentLinkedEntitySurface[]> = {
  linked_application: [
    {
      kind: 'legacy',
      table: 'document_applications',
      relationAlias: 'da_link',
      relationIdColumn: 'application_id',
      targetTable: 'applications',
      targetAlias: 'a_link',
      targetMatchExpressions: ['a_link.name'],
    },
  ],
  linked_asset: [
    {
      kind: 'legacy',
      table: 'document_assets',
      relationAlias: 'da_link',
      relationIdColumn: 'asset_id',
      targetTable: 'assets',
      targetAlias: 'ast_link',
      targetMatchExpressions: ['ast_link.name', 'ast_link.hostname', 'ast_link.fqdn'],
    },
  ],
  linked_project: [
    {
      kind: 'legacy',
      table: 'document_projects',
      relationAlias: 'dp_link',
      relationIdColumn: 'project_id',
      targetTable: 'portfolio_projects',
      targetAlias: 'p_link',
      targetMatchExpressions: ['p_link.name', `('PRJ-' || p_link.item_number::text)`],
    },
    {
      kind: 'integrated',
      relationAlias: 'idb_project_link',
      sourceEntityType: 'projects',
      targetTable: 'portfolio_projects',
      targetAlias: 'p_link',
      targetMatchExpressions: ['p_link.name', `('PRJ-' || p_link.item_number::text)`],
    },
  ],
  linked_request: [
    {
      kind: 'legacy',
      table: 'document_requests',
      relationAlias: 'dr_link',
      relationIdColumn: 'request_id',
      targetTable: 'portfolio_requests',
      targetAlias: 'r_link',
      targetMatchExpressions: ['r_link.name', `('REQ-' || r_link.item_number::text)`],
    },
    {
      kind: 'integrated',
      relationAlias: 'idb_request_link',
      sourceEntityType: 'requests',
      targetTable: 'portfolio_requests',
      targetAlias: 'r_link',
      targetMatchExpressions: ['r_link.name', `('REQ-' || r_link.item_number::text)`],
    },
  ],
  linked_task: [
    {
      kind: 'legacy',
      table: 'document_tasks',
      relationAlias: 'dt_link',
      relationIdColumn: 'task_id',
      targetTable: 'tasks',
      targetAlias: 't_link',
      targetMatchExpressions: ['t_link.title', `('T-' || t_link.item_number::text)`],
    },
  ],
};

const compileDateFilterCondition = (
  rawModel: any,
  expression: string,
  nextParam: () => string,
): { sql: string; params: Record<string, any> } | null => {
  const model = normalizeAgFilterModel(rawModel);
  if (!model || typeof model !== 'object') return null;

  const filterCategory = String(model.filterType ?? 'date');
  const type = String(model.type ?? 'equals');
  const fromRaw = model.dateFrom ?? model.filter ?? model.value;
  const toRaw = model.dateTo ?? model.filterTo ?? model.valueTo;

  if (filterCategory !== 'date' && filterCategory !== 'text') return null;

  if (type === 'blank') {
    return { sql: `${expression} IS NULL`, params: {} };
  }
  if (type === 'notBlank') {
    return { sql: `${expression} IS NOT NULL`, params: {} };
  }

  const castParam = (param: string): string => `:${param}::date`;

  if (type === 'inRange') {
    if (!fromRaw || !toRaw) return null;
    const fromParam = nextParam();
    const toParam = nextParam();
    return {
      sql: `${expression} BETWEEN ${castParam(fromParam)} AND ${castParam(toParam)}`,
      params: { [fromParam]: fromRaw, [toParam]: toRaw },
    };
  }

  if (!fromRaw) return null;
  const param = nextParam();

  switch (type) {
    case 'equals':
      return { sql: `${expression} = ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'notEqual':
      return { sql: `${expression} <> ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'lessThan':
      return { sql: `${expression} < ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'lessThanOrEqual':
      return { sql: `${expression} <= ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'greaterThan':
      return { sql: `${expression} > ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'greaterThanOrEqual':
      return { sql: `${expression} >= ${castParam(param)}`, params: { [param]: fromRaw } };
    default:
      return null;
  }
};

function buildDocumentLinkedEntityExistsClause(
  surface: DocumentLinkedEntitySurface,
  documentAlias: string,
  predicateSql?: string,
): string {
  if (surface.kind === 'legacy') {
    return `EXISTS (
      SELECT 1
      FROM ${surface.table} ${surface.relationAlias}
      JOIN ${surface.targetTable} ${surface.targetAlias}
        ON ${surface.targetAlias}.id = ${surface.relationAlias}.${surface.relationIdColumn}
       AND ${surface.targetAlias}.tenant_id = ${documentAlias}.tenant_id
      WHERE ${surface.relationAlias}.document_id = ${documentAlias}.id
        AND ${surface.relationAlias}.tenant_id = ${documentAlias}.tenant_id
        ${predicateSql ? `AND (${predicateSql})` : ''}
    )`;
  }

  return `EXISTS (
    SELECT 1
    FROM integrated_document_bindings ${surface.relationAlias}
    JOIN ${surface.targetTable} ${surface.targetAlias}
      ON ${surface.targetAlias}.id = ${surface.relationAlias}.source_entity_id
     AND ${surface.targetAlias}.tenant_id = ${documentAlias}.tenant_id
    WHERE ${surface.relationAlias}.document_id = ${documentAlias}.id
      AND ${surface.relationAlias}.tenant_id = ${documentAlias}.tenant_id
      AND ${surface.relationAlias}.source_entity_type = '${surface.sourceEntityType}'
      ${predicateSql ? `AND (${predicateSql})` : ''}
  )`;
}

function buildDocumentLinkedEntityExistsGroup(
  field: DocumentLinkedEntityField,
  documentAlias: string,
  predicateFactory?: (surface: DocumentLinkedEntitySurface) => string,
): string {
  const clauses = DOCUMENT_LINKED_ENTITY_FILTERS[field].map((surface) =>
    buildDocumentLinkedEntityExistsClause(
      surface,
      documentAlias,
      predicateFactory ? predicateFactory(surface) : undefined,
    ),
  );
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

function compileDocumentLinkedEntityFilterCondition(
  field: DocumentLinkedEntityField,
  rawModel: any,
  documentAlias: string,
  paramRef: string,
): { sql: string; value?: string } | null {
  const model = normalizeAgFilterModel(rawModel);
  if (!model || typeof model !== 'object') return null;

  const type = String(model.type ?? 'contains');
  const anyLinkedSql = buildDocumentLinkedEntityExistsGroup(field, documentAlias);

  if (type === 'blank') {
    return { sql: `NOT ${anyLinkedSql}` };
  }
  if (type === 'notBlank') {
    return { sql: anyLinkedSql };
  }

  const filterText = String(model.filter ?? model.value ?? '').trim();
  if (!filterText) return null;

  let value = filterText;
  let predicateKind: 'equals' | 'contains' = 'contains';
  let negate = false;

  switch (type) {
    case 'equals':
      predicateKind = 'equals';
      break;
    case 'notEqual':
      predicateKind = 'equals';
      negate = true;
      break;
    case 'startsWith':
      value = `${filterText}%`;
      break;
    case 'endsWith':
      value = `%${filterText}`;
      break;
    case 'notContains':
      value = `%${filterText}%`;
      negate = true;
      break;
    case 'contains':
    default:
      value = `%${filterText}%`;
      break;
  }

  const matchSql = buildDocumentLinkedEntityExistsGroup(field, documentAlias, (surface) => {
    const comparisons = surface.targetMatchExpressions.map((expression) =>
      predicateKind === 'equals'
        ? `${expression} = ${paramRef}`
        : `${expression} ILIKE ${paramRef}`,
    );
    return comparisons.length === 1 ? comparisons[0] : `(${comparisons.join(' OR ')})`;
  });

  return {
    sql: negate ? `NOT ${matchSql}` : matchSql,
    value,
  };
}

function applyDocumentLinkedEntityFilters(
  builder: { andWhere: (sql: string, params?: Record<string, any>) => any },
  filters: Record<string, any> | undefined,
  nextParam: () => string,
  documentAlias = 'd',
): void {
  if (!filters || typeof filters !== 'object') return;

  for (const field of Object.keys(DOCUMENT_LINKED_ENTITY_FILTERS) as DocumentLinkedEntityField[]) {
    const model = filters[field];
    if (!model) continue;
    const param = nextParam();
    const compiled = compileDocumentLinkedEntityFilterCondition(field, model, documentAlias, `:${param}`);
    if (!compiled) continue;
    builder.andWhere(compiled.sql, compiled.value === undefined ? {} : { [param]: compiled.value });
  }
}

type WorkflowParticipantView = {
  id: string;
  user_id: string;
  user_name: string;
  stage: DocumentWorkflowStage;
  decision: DocumentWorkflowDecision;
  comment: string | null;
  acted_at: Date | string | null;
};

type KnowledgeAuditOptions = {
  source?: string;
  sourceRef?: string | null;
};

type WorkflowView = {
  id: string;
  status: DocumentWorkflowStatus;
  current_stage: DocumentWorkflowStage | null;
  requested_revision: number;
  requested_at: Date | string;
  requested_by: string | null;
  requested_by_name: string | null;
  completed_at: Date | string | null;
  is_active: boolean;
  participants: WorkflowParticipantView[];
};

type ApprovedWorkflowSummary = {
  id: string;
  requested_revision: number;
  requested_at: Date | string;
  approved_at: Date | string | null;
  requested_by: string | null;
  requested_by_name: string | null;
};

type TemplateDocumentSummary = {
  id: string;
  content_markdown: string;
  document_type_id: string | null;
  title: string | null;
  item_number: number | null;
  document_type_name: string | null;
};

type ValidationInfo = {
  validated_revision: number | null;
  validated_at: Date | string | null;
  is_validated_current_revision: boolean;
};

type DocumentChangeField =
  | 'title'
  | 'summary'
  | 'status'
  | 'content_markdown'
  | 'library_id'
  | 'folder_id';

const RELATION_TABLE_MAP: Record<
  RelationEntityType,
  { table: string; idColumn: string; targetTable: string; label: string }
> = {
  applications: {
    table: 'document_applications',
    idColumn: 'application_id',
    targetTable: 'applications',
    label: 'applications',
  },
  assets: {
    table: 'document_assets',
    idColumn: 'asset_id',
    targetTable: 'assets',
    label: 'assets',
  },
  projects: {
    table: 'document_projects',
    idColumn: 'project_id',
    targetTable: 'portfolio_projects',
    label: 'projects',
  },
  requests: {
    table: 'document_requests',
    idColumn: 'request_id',
    targetTable: 'portfolio_requests',
    label: 'requests',
  },
  tasks: {
    table: 'document_tasks',
    idColumn: 'task_id',
    targetTable: 'tasks',
    label: 'tasks',
  },
  locations: {
    table: 'document_locations',
    idColumn: 'location_id',
    targetTable: 'locations',
    label: 'locations',
  },
  connections: {
    table: 'document_connections',
    idColumn: 'connection_id',
    targetTable: 'connections',
    label: 'connections',
  },
  interfaces: {
    table: 'document_interfaces',
    idColumn: 'interface_id',
    targetTable: 'interfaces',
    label: 'interfaces',
  },
  incidents: {
    table: 'document_incidents',
    idColumn: 'incident_id',
    targetTable: 'incidents',
    label: 'incidents',
  },
};

function hashLockToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function dedupeStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

type ActiveDocumentLock = {
  holder_user_id: string;
  holder_name: string;
  acquired_at: Date;
  heartbeat_at: Date;
  expires_at: Date;
};

type KnowledgeContextRootEntityType = RelationEntityType;
type KnowledgeContextSourceRow = {
  entity_id: string;
  item_number: number | null;
  item_ref?: string | null;
  name: string;
  status: string | null;
};
type EntityDocumentListItemRow = EntityDocumentListItem & {
  entity_id: string;
};
type EntityKnowledgeContextGroupDefinition = {
  key: EntityKnowledgeContextGroupKey;
  label: string;
  linked_via_label: string;
  sources: EntityKnowledgeContextSource[];
};

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentsRepo: Repository<Document>,
    @InjectRepository(DocumentFolder)
    private readonly foldersRepo: Repository<DocumentFolder>,
    @InjectRepository(IntegratedDocumentBinding)
    private readonly integratedBindingsRepo: Repository<IntegratedDocumentBinding>,
    @InjectRepository(DocumentLibrary)
    private readonly librariesRepo: Repository<DocumentLibrary>,
    @InjectRepository(DocumentType)
    private readonly documentTypesRepo: Repository<DocumentType>,
    @InjectRepository(DocumentVersion)
    private readonly versionsRepo: Repository<DocumentVersion>,
    @InjectRepository(DocumentEditLock)
    private readonly locksRepo: Repository<DocumentEditLock>,
    @InjectRepository(DocumentAttachment)
    private readonly attachmentsRepo: Repository<DocumentAttachment>,
    @InjectRepository(DocumentActivity)
    private readonly activitiesRepo: Repository<DocumentActivity>,
    @InjectRepository(DocumentContributor)
    private readonly contributorsRepo: Repository<DocumentContributor>,
    @InjectRepository(DocumentClassification)
    private readonly classificationsRepo: Repository<DocumentClassification>,
    @InjectRepository(DocumentReference)
    private readonly referencesRepo: Repository<DocumentReference>,
    @InjectRepository(DocumentApplication)
    private readonly documentApplicationsRepo: Repository<DocumentApplication>,
    @InjectRepository(DocumentAsset)
    private readonly documentAssetsRepo: Repository<DocumentAsset>,
    @InjectRepository(DocumentProject)
    private readonly documentProjectsRepo: Repository<DocumentProject>,
    @InjectRepository(DocumentRequest)
    private readonly documentRequestsRepo: Repository<DocumentRequest>,
    @InjectRepository(DocumentTask)
    private readonly documentTasksRepo: Repository<DocumentTask>,
    private readonly itemNumbers: ItemNumberService,
    private readonly audit: AuditService,
    private readonly exportService: DocumentExportService,
    private readonly importService: DocumentImportService,
    private readonly storage: StorageService,
    private readonly remoteInlineImages: RemoteInlineImageImportService,
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    private readonly users: UsersService,
    private readonly emails: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  getManager(opts?: { manager?: EntityManager }): EntityManager {
    return opts?.manager ?? this.documentsRepo.manager;
  }

  private normalizeLibraryAccessMode(input: unknown, fallback: KnowledgeLibraryAccessMode = 'default'): KnowledgeLibraryAccessMode {
    const value = String(input || '').trim().toLowerCase();
    return value === 'restricted' ? 'restricted' : fallback;
  }

  private normalizeLibraryMemberIds(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of input) {
      const normalized = String(value || '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  private normalizeLibraryMemberLevel(input: unknown): KnowledgeLibraryMemberLevel {
    return String(input || '').trim().toLowerCase() === 'writer' ? 'writer' : 'reader';
  }

  private hasLibraryAccessLevel(
    current: KnowledgeLibraryEffectiveAccessLevel | null | undefined,
    required: KnowledgeLibraryEffectiveAccessLevel,
  ): boolean {
    if (!current) return false;
    return (LIBRARY_ACCESS_RANK[current] ?? 0) >= (LIBRARY_ACCESS_RANK[required] ?? Number.MAX_SAFE_INTEGER);
  }

  private resolveEffectiveLibraryAccessLevel(
    library: Pick<DocumentLibrary, 'access_mode' | 'owner_user_id'>,
    knowledgeLevel: 'reader' | 'member' | 'admin' | null,
    membershipLevel: KnowledgeLibraryMemberLevel | null,
    userId: string | null | undefined,
  ): KnowledgeLibraryEffectiveAccessLevel | null {
    const normalizedUserId = String(userId || '').trim();
    const isOwner = !!normalizedUserId && !!library.owner_user_id && String(library.owner_user_id) === normalizedUserId;
    if (this.hasPermissionLevel(knowledgeLevel || undefined, 'admin') || isOwner) {
      return 'admin';
    }

    if (this.normalizeLibraryAccessMode(library.access_mode) !== 'restricted') {
      if (this.hasPermissionLevel(knowledgeLevel || undefined, 'member')) return 'writer';
      if (this.hasPermissionLevel(knowledgeLevel || undefined, 'reader')) return 'reader';
      return null;
    }

    if (membershipLevel === 'writer') {
      if (this.hasPermissionLevel(knowledgeLevel || undefined, 'member')) return 'writer';
      if (this.hasPermissionLevel(knowledgeLevel || undefined, 'reader')) return 'reader';
      return null;
    }

    if (membershipLevel === 'reader' && this.hasPermissionLevel(knowledgeLevel || undefined, 'reader')) {
      return 'reader';
    }

    return null;
  }

  private toKnowledgeLibraryView(
    library: DocumentLibrary,
    effectiveAccessLevel: KnowledgeLibraryEffectiveAccessLevel | null,
    userId: string | null | undefined,
  ): KnowledgeLibraryView {
    const normalizedUserId = String(userId || '').trim();
    const canManage = this.hasLibraryAccessLevel(effectiveAccessLevel, 'admin')
      || (!!normalizedUserId && !!library.owner_user_id && String(library.owner_user_id) === normalizedUserId);

    return {
      ...library,
      is_restricted: this.normalizeLibraryAccessMode(library.access_mode) === 'restricted',
      effective_access_level: effectiveAccessLevel,
      can_manage: canManage,
      can_write: this.hasLibraryAccessLevel(effectiveAccessLevel, 'writer'),
      can_delete: this.hasPermissionLevel(effectiveAccessLevel || undefined, 'admin'),
    };
  }

  private async listLibrariesWithAccess(
    manager: EntityManager,
    userId: string | null | undefined,
  ): Promise<KnowledgeLibraryView[]> {
    const libraries = await manager
      .getRepository(DocumentLibrary)
      .createQueryBuilder('l')
      .orderBy('l.display_order', 'ASC')
      .addOrderBy('lower(l.name)', 'ASC')
      .getMany();

    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return libraries.map((library) => this.toKnowledgeLibraryView(library, null, null));
    }

    const knowledgeLevel = await this.getKnowledgeLevelForUser(manager, normalizedUserId);
    const membershipRows = await manager.query<Array<{ library_id: string; access_level: string }>>(
      `SELECT library_id, access_level
       FROM document_library_members
       WHERE user_id = $1`,
      [normalizedUserId],
    );
    const membershipByLibraryId = new Map<string, KnowledgeLibraryMemberLevel>();
    for (const row of membershipRows) {
      const libraryId = String(row.library_id || '').trim();
      if (!libraryId) continue;
      const nextLevel = this.normalizeLibraryMemberLevel(row.access_level);
      const currentLevel = membershipByLibraryId.get(libraryId);
      if (!currentLevel || nextLevel === 'writer') {
        membershipByLibraryId.set(libraryId, nextLevel);
      }
    }

    return libraries
      .map((library) => this.toKnowledgeLibraryView(
        library,
        this.resolveEffectiveLibraryAccessLevel(
          library,
          knowledgeLevel,
          membershipByLibraryId.get(library.id) ?? null,
          normalizedUserId,
        ),
        normalizedUserId,
      ))
      .filter((library) => library.effective_access_level != null);
  }

  private async getLibraryWithAccessOrThrow(
    manager: EntityManager,
    libraryId: string,
    userId: string | null | undefined,
  ): Promise<KnowledgeLibraryView> {
    const repo = manager.getRepository(DocumentLibrary);
    const existing = await repo.findOne({ where: { id: libraryId } as any });
    if (!existing) {
      throw new NotFoundException('Library not found');
    }

    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return this.toKnowledgeLibraryView(existing, null, null);
    }

    const knowledgeLevel = await this.getKnowledgeLevelForUser(manager, normalizedUserId);
    const membership = await manager.getRepository(DocumentLibraryMember).findOne({
      where: { library_id: libraryId, user_id: normalizedUserId } as any,
    });
    const effectiveAccessLevel = this.resolveEffectiveLibraryAccessLevel(
      existing,
      knowledgeLevel,
      membership ? this.normalizeLibraryMemberLevel(membership.access_level) : null,
      normalizedUserId,
    );
    const view = this.toKnowledgeLibraryView(existing, effectiveAccessLevel, normalizedUserId);
    if (!view.effective_access_level) {
      throw new NotFoundException('Library not found');
    }
    return view;
  }

  private async listAccessibleLibraryIds(
    manager: EntityManager,
    userId: string | null | undefined,
    required: KnowledgeLibraryEffectiveAccessLevel = 'reader',
  ): Promise<string[] | null> {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return null;
    }
    const libraries = await this.listLibrariesWithAccess(manager, normalizedUserId);
    return libraries
      .filter((library) => this.hasLibraryAccessLevel(library.effective_access_level, required))
      .map((library) => library.id);
  }

  /**
   * Library IDs the user can read, or null when unrestricted (no user / full
   * access). Used by the AI search-index path to keep document results behind
   * the same library ACL as KnowledgeService.search.
   */
  async listReadableLibraryIdsForUser(
    manager: EntityManager,
    userId: string | null | undefined,
  ): Promise<string[] | null> {
    return this.listAccessibleLibraryIds(manager, userId, 'reader');
  }

  async assertLibraryReadable(
    libraryId: string,
    manager: EntityManager,
    userId: string | null | undefined,
  ): Promise<KnowledgeLibraryView> {
    return this.getLibraryWithAccessOrThrow(manager, libraryId, userId);
  }

  async assertLibraryWritable(
    libraryId: string,
    manager: EntityManager,
    userId: string | null | undefined,
  ): Promise<KnowledgeLibraryView> {
    const view = await this.getLibraryWithAccessOrThrow(manager, libraryId, userId);
    if (!view.can_write) {
      throw new NotFoundException('Library not found');
    }
    return view;
  }

  async assertLibraryManageable(
    libraryId: string,
    manager: EntityManager,
    userId: string | null | undefined,
  ): Promise<KnowledgeLibraryView> {
    const view = await this.getLibraryWithAccessOrThrow(manager, libraryId, userId);
    if (!view.can_manage) {
      throw new ForbiddenException('You are not allowed to manage this library');
    }
    return view;
  }

  private async getDocumentLibraryId(
    documentId: string,
    manager: EntityManager,
  ): Promise<string> {
    const rows = await manager.query<Array<{ library_id: string | null }>>(
      `SELECT library_id
       FROM documents
       WHERE id = $1
       LIMIT 1`,
      [documentId],
    );
    const libraryId = String(rows[0]?.library_id || '').trim();
    if (!libraryId) {
      throw new NotFoundException('Document not found');
    }
    return libraryId;
  }

  private async getLibraryOrThrow(libraryId: string, manager: EntityManager): Promise<DocumentLibrary> {
    const library = await manager.getRepository(DocumentLibrary).findOne({ where: { id: libraryId } as any });
    if (!library) {
      throw new NotFoundException('Library not found');
    }
    return library;
  }

  /**
   * The single access gate for one document, covering both columns of the §3.7
   * matrix.
   *
   * - Knowledge context (no `sourceContext`): the Knowledge library ACL as
   *   before, plus — when the document is an incident review — `incidents:reader`
   *   and the incident's row visibility (and `incidents:contributor` + the
   *   closure freeze for writes).
   * - Source context (`opts.sourceContext` matching this exact binding): the
   *   incident rules alone, no Knowledge permission required. The context is
   *   server-built and re-validated against the binding here; it never applies to
   *   templates or other documents reached along the way.
   *
   * The returned view already carries an incident-aware `can_write`, which is
   * what `GET /knowledge/:idOrRef` reports to the client.
   */
  private async resolveDocumentAccess(
    documentId: string,
    manager: EntityManager,
    userId: string | null | undefined,
    mode: 'read' | 'write',
    opts?: DocumentAccessOptions & { knownLibraryId?: string | null },
  ): Promise<KnowledgeLibraryView & { granted_by_source_context?: boolean }> {
    const resolveLibraryId = async () => (
      String(opts?.knownLibraryId || '').trim()
      || await this.getDocumentLibraryId(documentId, manager)
    );
    // §3.3 lock ordering: on a write, the owning incident row is locked before
    // the binding is read, so the status seen here is the committed one and a
    // concurrent closure cannot land between this check and the mutation.
    if (mode === 'write') {
      await lockIncidentRowForDocument(manager, documentId, opts?.tenantId ?? null);
    }
    const binding = await loadDocumentIncidentBinding(manager, documentId, opts?.tenantId ?? null);
    const normalizedUserId = String(userId || '').trim();
    const sourceContext = opts?.sourceContext ?? null;
    // A context built for someone else is ignored, not honoured: the caller's
    // identity and the context identity must be the same person.
    const contextMatchesActor = !!sourceContext
      && (!normalizedUserId || normalizedUserId === sourceContext.userId);

    if (binding && contextMatchesActor && sourceContextMatchesBinding(sourceContext, binding, documentId)) {
      const viewer = await resolveDocumentIncidentViewer(
        manager,
        sourceContext!.userId,
        sourceContext!.tenantId,
      );
      const shared = { binding, viewer, tenantId: opts?.tenantId ?? binding.tenant_id };
      await assertDocumentIncidentVisible(documentId, manager, sourceContext!.userId, shared.tenantId, shared);
      if (mode === 'write') {
        await assertDocumentIncidentWritable(documentId, manager, sourceContext!.userId, shared.tenantId, {
          ...shared,
          allowFrozenIncident: sourceContext!.allowFrozenIncident === true,
        });
      }
      const libraryId = await resolveLibraryId();
      const library = await this.getLibraryOrThrow(libraryId, manager);
      // No Knowledge level is granted: the incident permissions decide, and the
      // synthesized view stays below `admin` so manage/delete remain refused.
      return {
        ...this.toKnowledgeLibraryView(
          library,
          isDocumentIncidentWritable(binding, viewer) ? 'writer' : 'reader',
          null,
        ),
        // Tells `get()` that the caller holds no Knowledge right on this
        // document: everything the Knowledge branch would expose about its
        // neighbourhood (relations, template) has to be withheld.
        granted_by_source_context: true,
      };
    }

    const libraryId = await resolveLibraryId();
    const view = mode === 'write'
      ? await this.assertLibraryWritable(libraryId, manager, userId)
      : await this.assertLibraryReadable(libraryId, manager, userId);

    if (!binding) {
      return view;
    }

    const tenantId = opts?.tenantId ?? binding.tenant_id;
    const viewer = await resolveDocumentIncidentViewer(manager, userId, tenantId);
    await assertDocumentIncidentVisible(documentId, manager, userId, tenantId, { binding, viewer });
    if (mode === 'write') {
      await assertDocumentIncidentWritable(documentId, manager, userId, tenantId, { binding, viewer });
    }
    return { ...view, can_write: view.can_write && isDocumentIncidentWritable(binding, viewer) };
  }

  async assertDocumentReadable(
    documentId: string,
    manager: EntityManager,
    userId: string | null | undefined,
    opts?: DocumentAccessOptions,
  ): Promise<KnowledgeLibraryView> {
    return this.resolveDocumentAccess(documentId, manager, userId, 'read', opts);
  }

  async assertDocumentWritable(
    documentId: string,
    manager: EntityManager,
    userId: string | null | undefined,
    opts?: DocumentAccessOptions,
  ): Promise<KnowledgeLibraryView> {
    return this.resolveDocumentAccess(documentId, manager, userId, 'write', opts);
  }

  /**
   * Can this user open `DOC-N` through Knowledge? Library ACL plus, for an
   * incident review, `incidents:reader` and the incident's row visibility.
   * Used to vet share recipients; never throws, so nothing leaks about them.
   */
  async canUserOpenDocument(
    candidateUserId: string,
    documentId: string,
    manager: EntityManager,
    tenantId?: string | null,
  ): Promise<boolean> {
    const normalized = String(candidateUserId || '').trim();
    if (!normalized) return false;
    try {
      await this.assertDocumentReadable(documentId, manager, normalized, { tenantId: tenantId ?? null });
      return true;
    } catch {
      return false;
    }
  }

  async getIntegratedBinding(
    documentId: string,
    manager: EntityManager,
  ): Promise<IntegratedDocumentBinding | null> {
    return manager.getRepository(IntegratedDocumentBinding).findOne({
      where: { document_id: documentId } as any,
    });
  }

  private async assertDocumentMoveDeleteAllowed(
    documentId: string,
    manager: EntityManager,
  ): Promise<void> {
    if (await this.getIntegratedBinding(documentId, manager)) {
      throw new BadRequestException('Managed integrated documents cannot be moved or deleted from Knowledge');
    }
  }

  async assertIntegratedDocumentWorkflowRequestAllowed(
    documentId: string,
    manager: EntityManager,
  ): Promise<void> {
    if (await this.getIntegratedBinding(documentId, manager)) {
      throw new BadRequestException('Managed integrated documents do not support Knowledge review workflow');
    }
  }

  private async assertIntegratedDocumentUpdateRestrictions(
    existing: Document,
    body: any,
    manager: EntityManager,
  ): Promise<void> {
    if (!(await this.getIntegratedBinding(existing.id, manager))) {
      return;
    }

    const restrictedFieldErrors: string[] = [];
    if (body?.title !== undefined) {
      const nextTitle = String(body.title || '').trim();
      if (nextTitle !== String(existing.title || '')) {
        restrictedFieldErrors.push('title');
      }
    }

    if (body?.folder_id !== undefined) {
      const nextFolderId = body.folder_id ? String(body.folder_id) : null;
      if ((existing.folder_id ? String(existing.folder_id) : null) !== nextFolderId) {
        restrictedFieldErrors.push('folder_id');
      }
    }

    if (body?.library_id !== undefined) {
      const nextLibraryId = body.library_id ? String(body.library_id) : null;
      if ((existing.library_id ? String(existing.library_id) : null) !== nextLibraryId) {
        restrictedFieldErrors.push('library_id');
      }
    }

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'document_type_id')) {
      const nextDocumentTypeId = body?.document_type_id ? String(body.document_type_id) : null;
      if ((existing.document_type_id ? String(existing.document_type_id) : null) !== nextDocumentTypeId) {
        restrictedFieldErrors.push('document_type_id');
      }
    }

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'template_document_id')) {
      const nextTemplateId = body?.template_document_id ? String(body.template_document_id) : null;
      if ((existing.template_document_id ? String(existing.template_document_id) : null) !== nextTemplateId) {
        restrictedFieldErrors.push('template_document_id');
      }
    }

    if (restrictedFieldErrors.length > 0) {
      throw new BadRequestException(
        `Managed integrated documents cannot change: ${restrictedFieldErrors.join(', ')}`,
      );
    }
  }

  private assertManagedFolderWritable(folder: DocumentFolder): void {
    if (folder.system_key) {
      throw new BadRequestException('Managed Docs folders cannot be changed from Knowledge');
    }
  }

  private normalizeDocumentTypeId(value: unknown): string | null {
    const typeId = String(value || '').trim();
    return typeId || null;
  }

  private async getDefaultDocumentType(manager: EntityManager): Promise<DocumentType> {
    const repo = manager.getRepository(DocumentType);
    const existing = await repo.findOne({
      where: { is_default: true } as any,
      order: { display_order: 'ASC', created_at: 'ASC' } as any,
    });
    if (existing) return existing;

    const named = await repo
      .createQueryBuilder('t')
      .where('lower(t.name) = lower(:name)', { name: DEFAULT_DOCUMENT_TYPE_NAME })
      .orderBy('t.display_order', 'ASC')
      .addOrderBy('t.created_at', 'ASC')
      .getOne();

    if (named) {
      named.is_default = true;
      named.is_system = true;
      named.is_active = true;
      named.updated_at = new Date();
      return repo.save(named);
    }

    return repo.save(
      repo.create({
        name: DEFAULT_DOCUMENT_TYPE_NAME,
        description: 'Default fallback document type',
        template_content: null,
        is_active: true,
        is_system: true,
        is_default: true,
        display_order: 0,
      }),
    );
  }

  private async getDocumentTypeByIdOrThrow(
    typeId: string,
    manager: EntityManager,
    opts?: { allowInactive?: boolean },
  ): Promise<DocumentType> {
    const documentType = await manager.getRepository(DocumentType).findOne({ where: { id: typeId } as any });
    if (!documentType) {
      throw new BadRequestException('document_type_id is invalid');
    }
    if (!opts?.allowInactive && documentType.is_active === false) {
      throw new BadRequestException('document_type_id is inactive');
    }
    return documentType;
  }

  private async getTemplateDocumentSummary(
    templateDocumentId: string,
    manager: EntityManager,
    tenantId?: string | null,
    userId?: string | null,
  ): Promise<TemplateDocumentSummary> {
    const normalizedUserId = String(userId || '').trim();
    if (normalizedUserId) {
      await this.assertDocumentReadable(templateDocumentId, manager, normalizedUserId);
    }
    const tenantClause = tenantId ? 'AND d.tenant_id = $2' : 'AND d.tenant_id = app_current_tenant()';
    const params = tenantId ? [templateDocumentId, tenantId] : [templateDocumentId];
    const rows = await manager.query(
      `SELECT d.id,
              d.content_markdown,
              d.document_type_id,
              d.title,
              d.item_number,
              dt.name AS document_type_name
       FROM documents d
       JOIN document_libraries l ON l.id = d.library_id AND l.tenant_id = d.tenant_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id AND dt.tenant_id = d.tenant_id
       WHERE d.id = $1
         ${tenantClause}
         AND l.slug = 'templates'
       LIMIT 1`,
      params,
    );
    if (!rows.length) {
      throw new BadRequestException('template_document_id is invalid');
    }
    const row = rows[0];
    return {
      id: row.id,
      content_markdown: String(row.content_markdown || ''),
      document_type_id: row.document_type_id ? String(row.document_type_id) : null,
      title: row.title ? String(row.title) : null,
      item_number: row.item_number != null ? Number(row.item_number) : null,
      document_type_name: row.document_type_name ? String(row.document_type_name) : null,
    };
  }

  private async resolveDocumentTypeId(
    manager: EntityManager,
    params: {
      explicitDocumentTypeId: unknown;
      hasExplicitDocumentTypeId: boolean;
      templateDocument: TemplateDocumentSummary | null;
      currentDocumentTypeId?: string | null;
    },
  ): Promise<string> {
    const defaultType = await this.getDefaultDocumentType(manager);
    const templateTypeId = params.templateDocument?.document_type_id || defaultType.id;

    if (params.hasExplicitDocumentTypeId) {
      const explicitTypeId = this.normalizeDocumentTypeId(params.explicitDocumentTypeId);
      const resolvedType = explicitTypeId
        ? await this.getDocumentTypeByIdOrThrow(explicitTypeId, manager)
        : defaultType;
      if (params.templateDocument && resolvedType.id !== templateTypeId) {
        throw new BadRequestException('document_type_id does not match template document type');
      }
      return resolvedType.id;
    }

    if (params.templateDocument) {
      return templateTypeId;
    }

    if (params.currentDocumentTypeId) {
      return String(params.currentDocumentTypeId);
    }

    return defaultType.id;
  }

  private getValidationInfo(
    document: { status: string | null | undefined; revision: number | string | null | undefined },
    latestApprovedWorkflow: ApprovedWorkflowSummary | null,
  ): ValidationInfo {
    const validatedRevision = latestApprovedWorkflow?.requested_revision != null
      ? Number(latestApprovedWorkflow.requested_revision)
      : null;
    const currentRevision = document?.revision != null ? Number(document.revision) : null;
    const isValidatedCurrentRevision = String(document?.status || '').toLowerCase() === 'published'
      && validatedRevision != null
      && currentRevision != null
      && validatedRevision === currentRevision;

    return {
      validated_revision: validatedRevision,
      validated_at: latestApprovedWorkflow?.approved_at || null,
      is_validated_current_revision: isValidatedCurrentRevision,
    };
  }

  private async assertTenantScopedIdsExist(
    manager: EntityManager,
    table:
      | 'applications'
      | 'assets'
      | 'incidents'
      | 'portfolio_categories'
      | 'portfolio_projects'
      | 'portfolio_requests'
      | 'tasks'
      | 'users',
    ids: string[],
    label: string,
  ): Promise<void> {
    const uniqueIds = dedupeStrings(ids);
    if (!uniqueIds.length) return;

    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id
       FROM ${table}
       WHERE id = ANY($1::uuid[])
         AND tenant_id = app_current_tenant()`,
      [uniqueIds],
    );

    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException(`One or more ${label} were not found`);
    }
  }

  async resolveDocumentId(idOrRef: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(idOrRef, 'document', manager);
  }

  private stripMarkdown(value: string): string {
    return markdownToSearchText(value);
  }

  private parseItemNumberQuery(input: string): number | null {
    const value = String(input || '').trim();
    if (!value) return null;
    const match = value.match(/(?:^[A-Z]+-)?(\d+)$/i);
    if (!match) return null;
    const itemNumber = Number(match[1]);
    return Number.isFinite(itemNumber) && itemNumber > 0 ? itemNumber : null;
  }

  private parseItemNumberPrefixQuery(input: string): string | null {
    const value = String(input || '').trim();
    if (!value) return null;
    const match = value.match(/^(?:DOC-?)?(\d+)$/i);
    if (!match) return null;
    const digits = match[1];
    return digits && Number.isSafeInteger(Number(digits)) && Number(digits) > 0 ? digits : null;
  }

  hasPermissionLevel(current: string | undefined, required: 'reader' | 'member' | 'admin'): boolean {
    return (RBAC_LEVEL_RANK[current || ''] ?? 0) >= (RBAC_LEVEL_RANK[required] ?? Number.MAX_SAFE_INTEGER);
  }

  private async getRoleContextForUser(
    manager: EntityManager,
    userId: string | null | undefined,
  ): Promise<{ enabled: boolean; roleIds: string[]; isAdministrator: boolean }> {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return { enabled: false, roleIds: [], isAdministrator: false };
    }

    const user = await this.users.findById(normalizedUserId, { manager });
    if (!user) {
      return { enabled: false, roleIds: [], isAdministrator: false };
    }

    const userRoles = await manager.getRepository(UserRole).find({
      where: { user_id: user.id },
      relations: ['role'],
    });

    const roleIds = new Set<string>();
    if (user.role_id) roleIds.add(user.role_id);
    for (const userRole of userRoles) roleIds.add(userRole.role_id);

    const roleNames = userRoles.map((userRole) => userRole.role?.role_name?.toLowerCase() ?? '');
    if (user.role?.role_name) roleNames.push(user.role.role_name.toLowerCase());

    return {
      enabled: user.status === 'enabled',
      roleIds: Array.from(roleIds),
      isAdministrator: roleNames.includes('administrator'),
    };
  }

  private async getPermissionLevelForUser(
    manager: EntityManager,
    userId: string | null | undefined,
    resource: string,
  ): Promise<PermissionLevel | null> {
    const ctx = await this.getRoleContextForUser(manager, userId);
    if (!ctx.enabled) return null;
    if (ctx.isAdministrator) return 'admin';

    const permissions = await this.permissions.listForRoles(ctx.roleIds, { manager });
    const level = permissions.get(resource);
    return level ? (level as PermissionLevel) : null;
  }

  async getKnowledgeLevelForUser(
    manager: EntityManager,
    userId: string | null | undefined,
  ): Promise<'reader' | 'member' | 'admin' | null> {
    const level = await this.getPermissionLevelForUser(manager, userId, 'knowledge');
    return this.hasPermissionLevel(level || undefined, 'reader')
      ? (level as 'reader' | 'member' | 'admin')
      : null;
  }

  private async resolveUserIdFromRefreshToken(
    manager: EntityManager,
    tenantId: string,
    refreshToken: string | null | undefined,
  ): Promise<string | null> {
    const token = String(refreshToken || '').trim();
    if (!token) return null;

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokenRows = await manager.query(
      `SELECT user_id, expires_at
       FROM refresh_tokens
       WHERE token_hash = $1
         AND tenant_id = $2
       LIMIT 1`,
      [tokenHash, tenantId],
    );
    if (!tokenRows.length) return null;

    const expiresAt = tokenRows[0]?.expires_at ? new Date(tokenRows[0].expires_at).getTime() : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }

    const userId = String(tokenRows[0].user_id || '').trim();
    return userId || null;
  }

  /**
   * Viewer gate for `GET /knowledge/inline/:tenantSlug/:attachmentId`.
   *
   * The route is `@Public()`: identity comes from the refresh-token cookie. The
   * parent document (not just the source type) is passed in, so an incident
   * review image is checked against the exact incident it belongs to.
   *
   * For an incident review there is **no** `knowledge:reader` fallback: only
   * `incidents:reader` plus the incident's row visibility can authorize it.
   * Images referenced only by older versions follow the same rule — the check is
   * on the parent document, not on the current body.
   */
  private async ensureInlineAttachmentAccess(
    manager: EntityManager,
    tenantId: string,
    refreshToken: string | null | undefined,
    parent?: {
      documentId: string;
      integratedBinding?: Pick<IntegratedDocumentBinding, 'source_entity_type'> | null;
    } | null,
  ): Promise<boolean> {
    const userId = await this.resolveUserIdFromRefreshToken(manager, tenantId, refreshToken);
    if (!userId) return false;
    return this.canAccessInlineAttachmentForUser(manager, tenantId, userId, parent);
  }

  /**
   * Même règle d'accès que la route `inline`, mais avec une identité déjà établie
   * (JWT) plutôt qu'un `refresh_token` de cookie. Le résolveur d'images de l'export
   * et la route publique partagent ainsi une seule implémentation : elles ne
   * peuvent pas diverger.
   */
  async canAccessInlineAttachmentForUser(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    parent?: {
      documentId: string;
      integratedBinding?: Pick<IntegratedDocumentBinding, 'source_entity_type'> | null;
    } | null,
  ): Promise<boolean> {
    const sourceEntityType = parent?.integratedBinding?.source_entity_type ?? null;

    if (sourceEntityType === 'incidents') {
      if (!parent?.documentId) return false;
      const binding = await loadDocumentIncidentBinding(manager, parent.documentId, tenantId);
      if (!binding) return false;
      const viewer = await resolveDocumentIncidentViewer(manager, userId, tenantId);
      return isDocumentIncidentVisible(binding, viewer);
    }

    if (sourceEntityType === 'requests' || sourceEntityType === 'projects') {
      const resource = INLINE_ATTACHMENT_SOURCE_RESOURCE[sourceEntityType];
      const level = await this.getPermissionLevelForUser(manager, userId, resource);
      return this.hasPermissionLevel(level || undefined, 'reader');
    }

    return (await this.getKnowledgeLevelForUser(manager, userId)) != null;
  }

  /**
   * Shared viewer-authorization gate for @Public() inline-attachment routes in
   * other modules (portfolio projects/requests, tasks). Resolves the user from
   * the refresh_token cookie within the tenant and requires >= reader on the
   * given RBAC resource. Returns false (→ caller 404s) when the cookie is
   * missing/expired/invalid or the user lacks permission.
   */
  async canAccessInlineAttachment(
    manager: EntityManager,
    tenantId: string,
    refreshToken: string | null | undefined,
    resource: string,
  ): Promise<boolean> {
    const userId = await this.resolveUserIdFromRefreshToken(manager, tenantId, refreshToken);
    if (!userId) return false;
    return this.canAccessResourceForUser(manager, userId, resource);
  }

  /**
   * Variante à identité déjà établie (JWT) de `canAccessInlineAttachment`, partagée
   * avec le résolveur d'images de l'export.
   */
  async canAccessResourceForUser(
    manager: EntityManager,
    userId: string,
    resource: string,
  ): Promise<boolean> {
    const level = await this.getPermissionLevelForUser(manager, userId, resource);
    return this.hasPermissionLevel(level || undefined, 'reader');
  }

  private normalizeStatus(input?: unknown, fallback: DocumentStatus = 'draft'): DocumentStatus {
    if (input == null) return fallback;
    const value = String(input).trim().toLowerCase();
    if (!isDocumentStatus(value)) {
      throw new BadRequestException(`Invalid status: ${String(input)}`);
    }
    return value;
  }

  private getDocumentSearchState(input: unknown): { term: string; itemNumber: number | null } | null {
    const term = String(input || '').trim();
    if (!term) return null;
    return {
      term,
      itemNumber: this.parseItemNumberQuery(term),
    };
  }

  private normalizeDocumentSearchTerm(input: string): string {
    return String(input || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private getDocumentSearchFallbackTerms(term: string): string[] {
    const normalized = this.normalizeDocumentSearchTerm(term);
    if (!normalized) return [];
    const stopWords = new Set([
      'avec',
      'dans',
      'des',
      'donc',
      'for',
      'les',
      'plus',
      'pour',
      'the',
      'une',
      'with',
    ]);
    const values = [
      normalized,
      ...normalized.split(/\s+/)
        .flatMap((token) => token.split(/['-]/))
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !stopWords.has(token)),
    ];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
      if (result.length >= 8) break;
    }
    return result;
  }

  private buildDocumentSearchSql(
    alias: string,
    paramOffset: number,
    search: { term: string; itemNumber: number | null },
  ): { clause: string; params: Array<string | number> } {
    const params: Array<string | number> = [search.term, `%${search.term}%`];
    const searchTermIndex = paramOffset + 1;
    const searchLikeIndex = paramOffset + 2;
    const clauses = [
      `${alias}.search_vector @@ ${bilingualDocumentTsQuerySql(`$${searchTermIndex}`)}`,
      `${alias}.title ILIKE $${searchLikeIndex}`,
      `COALESCE(${alias}.summary, '') ILIKE $${searchLikeIndex}`,
      `COALESCE(${alias}.content_plain, '') ILIKE $${searchLikeIndex}`,
      `COALESCE(${alias}.content_markdown, '') ILIKE $${searchLikeIndex}`,
    ];
    if (search.itemNumber != null) {
      params.push(search.itemNumber);
      clauses.unshift(`${alias}.item_number = $${paramOffset + params.length}`);
    }
    return {
      clause: `(${clauses.join(' OR ')})`,
      params,
    };
  }

  private async ensureVersionSnapshot(
    document: Document,
    changeNote: string | null,
    userId: string | null,
    manager: EntityManager,
  ): Promise<VersionSnapshotResult> {
    const versionsRepo = manager.getRepository(DocumentVersion);
    const docsRepo = manager.getRepository(Document);
    const latestVersion = await versionsRepo
      .createQueryBuilder('v')
      .where('v.document_id = :documentId', { documentId: document.id })
      .orderBy('v.version_number', 'DESC')
      .getOne();

    if (
      latestVersion
      && latestVersion.title === document.title
      && (latestVersion.summary || null) === (document.summary || null)
      && latestVersion.content_markdown === document.content_markdown
    ) {
      const latestVersionNumber = Number(latestVersion.version_number || 0);
      if (Number(document.current_version_number || 0) !== latestVersionNumber) {
        document.current_version_number = latestVersionNumber;
        await docsRepo.save(document);
      }
      return { version: latestVersion, created: false };
    }

    const nextVersion = Math.max(
      Number(document.current_version_number || 0),
      Number(latestVersion?.version_number || 0),
    ) + 1;

    const version = versionsRepo.create({
      tenant_id: document.tenant_id,
      document_id: document.id,
      version_number: nextVersion,
      title: document.title,
      summary: document.summary,
      content_markdown: document.content_markdown,
      content_plain: document.content_plain,
      change_note: changeNote,
      created_by: userId,
    });
    const savedVersion = await versionsRepo.save(version);

    document.current_version_number = nextVersion;
    await docsRepo.save(document);
    return { version: savedVersion, created: true };
  }

  async ensureCurrentVersionSnapshot(
    document: Document,
    changeNote: string | null,
    userId: string | null,
    manager: EntityManager,
  ): Promise<VersionSnapshotResult> {
    return this.ensureVersionSnapshot(document, changeNote, userId, manager);
  }

  private parseDocReferences(markdown: string): number[] {
    const text = String(markdown || '');
    // Accept legacy and renamed workspace URLs.
    const matches = [...text.matchAll(/\/(?:docs|knowledge)\/DOC-(\d+)/gi)];
    const out: number[] = [];
    const seen = new Set<number>();
    for (const match of matches) {
      const num = Number(match[1]);
      if (!Number.isFinite(num) || num <= 0 || seen.has(num)) continue;
      seen.add(num);
      out.push(num);
    }
    return out;
  }

  private formatUserDisplayName(row: any, fallback: string): string {
    const fromFullName = String(
      row?.display_name
      || row?.holder_name
      || row?.user_name
      || '',
    ).trim();
    if (fromFullName) return fromFullName;
    return String(row?.email || fallback || '').trim() || fallback;
  }

  async getUserDisplayName(userId: string, manager: EntityManager): Promise<string> {
    const rows = await manager.query(
      `SELECT NULLIF(trim(concat_ws(' ', first_name, last_name)), '') AS display_name, email
       FROM users
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [userId],
    );
    return this.formatUserDisplayName(rows[0], userId);
  }

  private getCurrentWorkflowStage(status: string | null | undefined): DocumentWorkflowStage | null {
    if (status === 'pending_review') return 'reviewer';
    if (status === 'pending_approval') return 'approver';
    return null;
  }

  async getActiveWorkflow(
    documentId: string,
    manager: EntityManager,
  ): Promise<WorkflowView | null> {
    const workflowRows = await manager.query(
      `SELECT w.*,
              COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, w.requested_by::text) AS requested_by_name
       FROM document_workflows w
       LEFT JOIN users u ON u.id = w.requested_by AND u.tenant_id = w.tenant_id
       WHERE w.document_id = $1
         AND w.status IN ('pending_review', 'pending_approval')
       ORDER BY w.requested_at DESC
       LIMIT 1`,
      [documentId],
    );
    if (!workflowRows.length) return null;

    const workflow = workflowRows[0];
    const participants = await manager.query(
      `SELECT p.*,
              COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, p.user_id::text) AS user_name
       FROM document_workflow_participants p
       LEFT JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
       WHERE p.workflow_id = $1
       ORDER BY CASE p.stage WHEN 'reviewer' THEN 0 ELSE 1 END ASC, p.created_at ASC`,
      [workflow.id],
    );

    return {
      id: workflow.id,
      status: workflow.status,
      current_stage: this.getCurrentWorkflowStage(workflow.status),
      requested_revision: Number(workflow.requested_revision || 0),
      requested_at: workflow.requested_at,
      requested_by: workflow.requested_by || null,
      requested_by_name: workflow.requested_by_name || null,
      completed_at: workflow.completed_at || null,
      is_active: ACTIVE_WORKFLOW_STATUSES.has(String(workflow.status || '')),
      participants: participants.map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        user_name: row.user_name || row.user_id,
        stage: row.stage,
        decision: row.decision,
        comment: row.comment || null,
        acted_at: row.acted_at || null,
      })),
    };
  }

  private async getLatestApprovedWorkflowSummary(
    documentId: string,
    manager: EntityManager,
  ): Promise<ApprovedWorkflowSummary | null> {
    const rows = await manager.query(
      `SELECT w.id,
              w.requested_revision,
              w.requested_at,
              w.completed_at AS approved_at,
              w.requested_by,
              COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, w.requested_by::text) AS requested_by_name
       FROM document_workflows w
       LEFT JOIN users u ON u.id = w.requested_by AND u.tenant_id = w.tenant_id
       WHERE w.document_id = $1
         AND w.status = 'approved'
       ORDER BY coalesce(w.completed_at, w.requested_at) DESC
       LIMIT 1`,
      [documentId],
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      requested_revision: Number(row.requested_revision || 0),
      requested_at: row.requested_at,
      approved_at: row.approved_at || null,
      requested_by: row.requested_by || null,
      requested_by_name: row.requested_by_name || null,
    };
  }

  async assertWorkflowAllowsEditing(documentId: string, manager: EntityManager): Promise<void> {
    const activeWorkflow = await this.getActiveWorkflow(documentId, manager);
    if (!activeWorkflow) return;
    throw new ConflictException('Document is currently in review. Cancel review to edit it.');
  }

  async createSystemActivity(
    documentId: string,
    userId: string | null,
    type: 'change' | 'decision',
    content: string,
    manager: EntityManager,
    changedFields?: Record<string, [unknown, unknown]> | null,
  ) {
    const activity = manager.getRepository(DocumentActivity).create({
      document_id: documentId,
      author_id: userId,
      type,
      content,
      changed_fields: changedFields ?? null,
    });
    return manager.getRepository(DocumentActivity).save(activity);
  }

  private async applyDocumentRelations(
    documentId: string,
    relations: unknown,
    manager: EntityManager,
  ): Promise<void> {
    if (!relations || typeof relations !== 'object' || Array.isArray(relations)) {
      return;
    }

    const relationBody = relations as Partial<Record<RelationEntityType, unknown>>;
    for (const key of Object.keys(RELATION_TABLE_MAP) as RelationEntityType[]) {
      const relationValues = relationBody[key];
      if (Array.isArray(relationValues)) {
        await this.replaceDocumentRelationsByEntity(documentId, key, relationValues, manager);
      }
    }
  }

  private buildDocumentChanges(
    before: Partial<Record<DocumentChangeField, unknown>> | null,
    after: Partial<Record<DocumentChangeField, unknown>>,
    fields: DocumentChangeField[],
  ): Record<string, [unknown, unknown]> {
    const changes: Record<string, [unknown, unknown]> = {};

    for (const field of fields) {
      if (field === 'content_markdown') {
        const previousContent = String(before?.content_markdown || '');
        const nextContent = String(after.content_markdown || '');
        if (previousContent !== nextContent) {
          changes.content_markdown = ['(changed)', '(changed)'];
        }
        continue;
      }

      const previousValue = before?.[field] ?? null;
      const nextValue = after[field] ?? null;
      if (previousValue !== nextValue) {
        changes[field] = [previousValue, nextValue];
      }
    }

    return changes;
  }

  private async auditDocumentChange(
    action: 'create' | 'update' | 'delete',
    recordId: string,
    before: unknown,
    after: unknown,
    userId: string | null,
    manager: EntityManager,
    audit?: KnowledgeAuditOptions | null,
  ): Promise<void> {
    await this.audit.log(
      {
        table: 'documents',
        recordId,
        action,
        before,
        after,
        userId,
        source: audit?.source,
        sourceRef: audit?.sourceRef ?? null,
      },
      { manager },
    );
  }

  async getWorkflowParticipantEmails(
    manager: EntityManager,
    workflowId: string,
    stage: DocumentWorkflowStage,
  ): Promise<Array<{ email: string; name: string; userId: string; locale: string | null }>> {
    const rows = await manager.query(
      `SELECT p.user_id,
              u.email,
              u.locale,
              COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, p.user_id::text) AS user_name
       FROM document_workflow_participants p
       JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
       WHERE p.workflow_id = $1
         AND p.stage = $2
         AND coalesce(u.status, '') = 'enabled'
       ORDER BY p.created_at ASC`,
      [workflowId, stage],
    );
    return rows
      .map((row: any) => ({
        email: String(row.email || '').trim(),
        name: String(row.user_name || row.user_id || '').trim() || String(row.user_id || ''),
        userId: String(row.user_id || '').trim(),
        locale: row.locale ?? null,
      }))
      .filter((row: { email: string }) => !!row.email);
  }

  async getDocumentNotificationRecipients(
    manager: EntityManager,
    documentId: string,
    extraUserIds: Array<string | null | undefined> = [],
  ): Promise<Array<{ email: string; locale: string | null }>> {
    const rows = await manager.query(
      `SELECT DISTINCT u.email, u.locale
       FROM document_contributors c
       JOIN users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
       WHERE c.document_id = $1
         AND c.role IN ('owner', 'author')
         AND coalesce(u.status, '') = 'enabled'
         AND coalesce(u.email, '') <> ''`,
      [documentId],
    );

    const recipients = new Map<string, { email: string; locale: string | null }>();
    for (const row of rows) {
      const email = String(row.email || '').trim();
      if (!email || recipients.has(email)) continue;
      recipients.set(email, { email, locale: row.locale ?? null });
    }

    const extraIds = dedupeStrings(extraUserIds);
    if (extraIds.length) {
      const extraRows = await manager.query(
        `SELECT DISTINCT email, locale
         FROM users
         WHERE id = ANY($1::uuid[])
           AND tenant_id = app_current_tenant()
           AND coalesce(status, '') = 'enabled'
           AND coalesce(email, '') <> ''`,
        [extraIds],
      );
      for (const row of extraRows) {
        const email = String(row.email || '').trim();
        if (!email || recipients.has(email)) continue;
        recipients.set(email, { email, locale: row.locale ?? null });
      }
    }

    return Array.from(recipients.values());
  }

  async sendWorkflowEmail(
    recipients: Array<{ email: string; locale?: string | null }>,
    buildContent: (locale: string) => EmailContent,
  ): Promise<void> {
    if (!Features.EMAIL_ENABLED) return;
    const localeGroups = new Map<string, Set<string>>();

    for (const entry of recipients) {
      const email = String(entry?.email || '').trim();
      if (!email) continue;
      const locale = resolveEmailLocale(entry.locale);
      const group = localeGroups.get(locale) ?? new Set<string>();
      group.add(email);
      localeGroups.set(locale, group);
    }

    for (const [locale, emails] of localeGroups) {
      const uniqueRecipients = Array.from(emails);
      if (!uniqueRecipients.length) continue;
      const content = buildContent(locale);

      try {
        await this.emails.send({
          to: uniqueRecipients,
          subject: content.subject,
          html: content.html,
          text: content.text,
          attachments: content.attachments,
        });
      } catch (error) {
        this.logger.warn(`Knowledge workflow email failed for locale ${locale}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  buildKnowledgeDocumentUrl(appBaseUrl: string | null | undefined, itemNumber: number): string | null {
    const base = String(appBaseUrl || '').trim().replace(/\/$/, '');
    if (!base) return null;
    return `${base}/knowledge/DOC-${itemNumber}`;
  }

  private async getActiveDocumentLock(
    documentId: string,
    manager: EntityManager,
  ): Promise<ActiveDocumentLock | null> {
    const rows = await manager.query(
      `SELECT l.holder_user_id,
              l.acquired_at,
              l.heartbeat_at,
              l.expires_at,
              NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS display_name,
              u.email
       FROM document_edit_locks l
       LEFT JOIN users u ON u.id = l.holder_user_id AND u.tenant_id = l.tenant_id
       WHERE l.document_id = $1
         AND l.expires_at > now()
       LIMIT 1`,
      [documentId],
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      holder_user_id: row.holder_user_id,
      holder_name: this.formatUserDisplayName(row, String(row.holder_user_id || '')),
      acquired_at: row.acquired_at,
      heartbeat_at: row.heartbeat_at,
      expires_at: row.expires_at,
    };
  }

  async assertDocumentUnlockedForUser(
    documentId: string,
    userId: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    const activeLock = await this.getActiveDocumentLock(documentId, manager);
    const currentUserId = String(userId || '').trim();
    if (!activeLock || activeLock.holder_user_id === currentUserId) {
      return;
    }

    throw new HttpException({
      message: 'Document is locked by another user',
      lock: activeLock,
    }, 423);
  }

  private async syncReferences(documentId: string, markdown: string, manager: EntityManager): Promise<void> {
    const referencesRepo = manager.getRepository(DocumentReference);
    const numbers = this.parseDocReferences(markdown);

    const targetRows: Array<{ id: string; item_number: number }> = numbers.length
      ? await manager.query(
          `SELECT id, item_number
           FROM documents
           WHERE item_number = ANY($1::int[])
             AND tenant_id = app_current_tenant()
             AND id <> $2`,
          [numbers, documentId],
        )
      : [];

    const targetIds = dedupeStrings(targetRows.map((row) => row.id));

    await referencesRepo.delete({ source_document_id: documentId } as any);

    for (const targetId of targetIds) {
      const relation = referencesRepo.create({
        source_document_id: documentId,
        target_document_id: targetId,
      });
      await referencesRepo.save(relation);
    }
  }

  private async ensureValidLock(
    documentId: string,
    userId: string,
    lockToken: string | null | undefined,
    manager: EntityManager,
  ): Promise<DocumentEditLock> {
    if (!lockToken) {
      throw new HttpException('Missing lock token', 423);
    }

    const repo = manager.getRepository(DocumentEditLock);
    const lock = await repo.findOne({ where: { document_id: documentId } as any });
    if (!lock) {
      throw new HttpException('Document lock not found', 423);
    }

    if (lock.holder_user_id !== userId) {
      throw new HttpException({
        message: 'Document is locked by another user',
        lock: {
          holder_user_id: lock.holder_user_id,
          holder_name: await this.getUserDisplayName(lock.holder_user_id, manager),
          acquired_at: lock.acquired_at,
          heartbeat_at: lock.heartbeat_at,
          expires_at: lock.expires_at,
        },
      }, 423);
    }

    if (new Date(lock.expires_at).getTime() <= Date.now()) {
      await repo.delete({ id: lock.id } as any);
      throw new GoneException('Document lock expired');
    }

    const expected = hashLockToken(lockToken);
    if (expected !== lock.lock_token_hash) {
      throw new HttpException('Invalid lock token', 423);
    }

    return lock;
  }

  private slugifyLibraryName(name: string): string {
    const slug = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
    return slug || 'library';
  }

  private async generateUniqueLibrarySlug(
    baseName: string,
    manager: EntityManager,
    excludeId?: string,
  ): Promise<string> {
    const base = this.slugifyLibraryName(baseName);
    const repo = manager.getRepository(DocumentLibrary);
    let candidate = base;
    let i = 2;

    while (true) {
      const qb = repo.createQueryBuilder('l').where('l.slug = :slug', { slug: candidate });
      if (excludeId) {
        qb.andWhere('l.id <> :excludeId', { excludeId });
      }
      const exists = await qb.getExists();
      if (!exists) return candidate;
      candidate = `${base}-${i}`;
      i += 1;
    }
  }

  private async resolveDefaultLibrary(manager: EntityManager): Promise<DocumentLibrary> {
    const repo = manager.getRepository(DocumentLibrary);
    const nonSystem = await repo
      .createQueryBuilder('l')
      .where('l.is_system = false')
      .orderBy('l.display_order', 'ASC')
      .addOrderBy('lower(l.name)', 'ASC')
      .limit(1)
      .getOne();
    if (nonSystem) return nonSystem;

    const anyLibrary = await repo
      .createQueryBuilder('l')
      .orderBy('l.display_order', 'ASC')
      .addOrderBy('lower(l.name)', 'ASC')
      .limit(1)
      .getOne();
    if (!anyLibrary) {
      throw new BadRequestException('No document library is available for this tenant');
    }
    return anyLibrary;
  }

  private async ensureLibraryExists(
    libraryId: string,
    manager: EntityManager,
  ): Promise<DocumentLibrary> {
    const library = await manager.getRepository(DocumentLibrary).findOne({ where: { id: libraryId } as any });
    if (!library) throw new BadRequestException('library_id is invalid');
    return library;
  }

  private async ensureFolderInLibrary(
    folderId: string,
    libraryId: string,
    manager: EntityManager,
  ): Promise<DocumentFolder> {
    const folder = await manager.getRepository(DocumentFolder).findOne({ where: { id: folderId } as any });
    if (!folder) throw new BadRequestException('folder not found');
    if (folder.library_id !== libraryId) {
      throw new BadRequestException('folder does not belong to the selected library');
    }
    return folder;
  }

  private async ensureDocumentTypeExists(
    documentTypeId: string,
    manager: EntityManager,
  ): Promise<DocumentType> {
    const documentType = await manager.getRepository(DocumentType).findOne({
      where: { id: documentTypeId } as any,
    });
    if (!documentType) {
      throw new BadRequestException('document_type_id is invalid');
    }
    return documentType;
  }

  private parseDocumentMoveBody(body: any): { libraryId: string; folderId: string | null } {
    const hasLibraryId =
      Object.prototype.hasOwnProperty.call(body ?? {}, 'target_library_id')
      || Object.prototype.hasOwnProperty.call(body ?? {}, 'library_id');
    const hasFolderId =
      Object.prototype.hasOwnProperty.call(body ?? {}, 'target_folder_id')
      || Object.prototype.hasOwnProperty.call(body ?? {}, 'folder_id');
    if (!hasLibraryId) throw new BadRequestException('library_id is required');
    if (!hasFolderId) throw new BadRequestException('folder_id is required');

    const libraryId = String(body?.target_library_id ?? body?.library_id ?? '').trim();
    if (!libraryId) throw new BadRequestException('library_id is required');

    return {
      libraryId,
      folderId: body?.target_folder_id ? String(body.target_folder_id) : (body?.folder_id ? String(body.folder_id) : null),
    };
  }

  private parseFolderMoveBody(
    body: any,
    currentLibraryId: string,
  ): { libraryId: string; parentId: string | null } {
    const hasLibraryId =
      Object.prototype.hasOwnProperty.call(body ?? {}, 'target_library_id')
      || Object.prototype.hasOwnProperty.call(body ?? {}, 'library_id');

    const rawLibraryId = hasLibraryId ? String(body?.target_library_id ?? body?.library_id ?? '').trim() : currentLibraryId;
    if (!rawLibraryId) throw new BadRequestException('library_id is required');

    const rawParentId = body?.target_folder_id ?? body?.folder_id ?? body?.parent_id;
    return {
      libraryId: rawLibraryId,
      parentId: rawParentId ? String(rawParentId) : null,
    };
  }

  private async assertTemplateLibraryMoveAllowed(
    existingLibraryId: string,
    targetLibrary: DocumentLibrary,
    manager: EntityManager,
  ): Promise<void> {
    if (existingLibraryId === targetLibrary.id) return;

    const existingLibrary = await this.ensureLibraryExists(existingLibraryId, manager);
    if (existingLibrary.slug === TEMPLATE_LIBRARY_SLUG || targetLibrary.slug === TEMPLATE_LIBRARY_SLUG) {
      throw new BadRequestException('Documents cannot be moved to or from the Templates library');
    }
  }

  private async assertTemplateFolderMoveAllowed(
    existingLibraryId: string,
    targetLibrary: DocumentLibrary,
    manager: EntityManager,
  ): Promise<void> {
    if (existingLibraryId === targetLibrary.id) return;

    const existingLibrary = await this.ensureLibraryExists(existingLibraryId, manager);
    if (existingLibrary.slug === TEMPLATE_LIBRARY_SLUG || targetLibrary.slug === TEMPLATE_LIBRARY_SLUG) {
      throw new BadRequestException('Folders cannot be moved to or from the Templates library');
    }
  }

  private async listFolderSubtreeIds(manager: EntityManager, id: string): Promise<string[]> {
    const rows = await manager.query(
      `WITH RECURSIVE descendants AS (
         SELECT id, parent_id
         FROM document_folders
         WHERE id = $1
         UNION ALL
         SELECT f.id, f.parent_id
         FROM document_folders f
         JOIN descendants d ON f.parent_id = d.id
       )
       SELECT id
       FROM descendants`,
      [id],
    );
    return rows.map((row: any) => String(row.id));
  }

  private async moveDocumentRecord(
    idOrRef: string,
    target: { libraryId: string; folderId: string | null },
    targetLibrary: DocumentLibrary,
    userId: string | null,
    manager: EntityManager,
    knowledgeLevel?: 'reader' | 'member' | 'admin' | null,
  ): Promise<Document> {
    const id = await this.resolveDocumentId(idOrRef, manager);
    const repo = manager.getRepository(Document);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Document not found');

    await this.assertDocumentWritable(existing.id, manager, userId);
    await this.assertDocumentMoveDeleteAllowed(existing.id, manager);
    await this.assertWorkflowAllowsEditing(existing.id, manager);
    await this.assertLibraryWritable(target.libraryId, manager, userId);

    const crossLibraryMove = existing.library_id !== target.libraryId;
    const effectiveLevel = knowledgeLevel ?? await this.getKnowledgeLevelForUser(manager, userId);
    if (crossLibraryMove && !this.hasPermissionLevel(effectiveLevel || undefined, 'admin')) {
      throw new ForbiddenException('Only knowledge admins can move documents between libraries');
    }
    await this.assertTemplateLibraryMoveAllowed(existing.library_id, targetLibrary, manager);

    if (existing.library_id === target.libraryId && existing.folder_id === target.folderId) {
      return existing;
    }

    const before = { ...existing };
    existing.library_id = target.libraryId;
    existing.folder_id = target.folderId;
    existing.updated_by = userId ?? existing.updated_by;
    existing.updated_at = new Date();

    const saved = await repo.save(existing);

    const changes = this.buildDocumentChanges(before, saved, ['library_id', 'folder_id']);

    if (Object.keys(changes).length > 0) {
      await this.createSystemActivity(
        saved.id,
        userId,
        'change',
        crossLibraryMove ? 'Document moved to another library' : 'Document moved',
        manager,
        changes,
      );
      await this.auditDocumentChange('update', saved.id, before, saved, userId, manager);
    }

    return saved;
  }

  private async folderNameExistsInLibrary(
    manager: EntityManager,
    libraryId: string,
    parentId: string | null,
    name: string,
  ): Promise<boolean> {
    const rows = await manager.query(
      `SELECT 1
       FROM document_folders
       WHERE library_id = $1
         AND tenant_id = app_current_tenant()
         AND lower(name) = lower($2)
         AND coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) =
             coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       LIMIT 1`,
      [libraryId, name, parentId],
    );
    return rows.length > 0;
  }

  private async resolveMovedFolderName(
    manager: EntityManager,
    libraryId: string,
    parentId: string | null,
    originalName: string,
    sourceLibraryName: string,
  ): Promise<string> {
    if (!(await this.folderNameExistsInLibrary(manager, libraryId, parentId, originalName))) {
      return originalName;
    }

    const base = `${originalName} (from ${sourceLibraryName})`;
    let candidate = base;
    let i = 2;
    while (await this.folderNameExistsInLibrary(manager, libraryId, parentId, candidate)) {
      candidate = `${base} ${i}`;
      i += 1;
    }
    return candidate;
  }

  async listLibraries(opts?: { manager?: EntityManager; userId?: string | null }) {
    const manager = this.getManager(opts);
    const normalizedUserId = String(opts?.userId || '').trim();
    if (!normalizedUserId) {
      return manager
        .getRepository(DocumentLibrary)
        .createQueryBuilder('l')
        .orderBy('l.display_order', 'ASC')
        .addOrderBy('lower(l.name)', 'ASC')
        .getMany();
    }
    return this.listLibrariesWithAccess(manager, normalizedUserId);
  }

  async getLibrary(id: string, opts?: { manager?: EntityManager; userId?: string | null }): Promise<KnowledgeLibraryDetailView> {
    const manager = this.getManager(opts);
    const library = await this.assertLibraryManageable(id, manager, opts?.userId || null);

    const ownerRows = library.owner_user_id
      ? await manager.query<Array<KnowledgeLibraryMemberView>>(
          `SELECT u.id,
                  u.email,
                  u.first_name,
                  u.last_name,
                  COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, u.id::text) AS label
           FROM users u
           WHERE u.id = $1
             AND u.tenant_id = app_current_tenant()
           LIMIT 1`,
          [library.owner_user_id],
        )
      : [];

    const memberRows = await manager.query<Array<KnowledgeLibraryMemberView & { access_level: string }>>(
      `SELECT u.id,
              u.email,
              u.first_name,
              u.last_name,
              COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, u.id::text) AS label,
              m.access_level
       FROM document_library_members m
       JOIN users u
         ON u.id = m.user_id
        AND u.tenant_id = m.tenant_id
       WHERE m.library_id = $1
       ORDER BY lower(COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, u.id::text)) ASC`,
      [library.id],
    );

    return {
      ...library,
      owner: ownerRows[0] ?? null,
      readers: memberRows
        .filter((row) => row.access_level === 'reader')
        .map(({ access_level, ...row }) => row),
      writers: memberRows
        .filter((row) => row.access_level === 'writer')
        .map(({ access_level, ...row }) => row),
    };
  }

  async createLibrary(body: any, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const name = String(body?.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    const slug = await this.generateUniqueLibrarySlug(name, manager);
    const [{ next_order }] = await manager.query(
      `SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order
       FROM document_libraries`,
    );
    const displayOrder = Number(next_order) || 0;

    const entity = manager.getRepository(DocumentLibrary).create({
      name,
      slug,
      access_mode: 'default',
      is_system: false,
      display_order: displayOrder,
      owner_user_id: userId,
      created_by: userId,
    });

    return manager.getRepository(DocumentLibrary).save(entity);
  }

  async reorderLibraries(ids: string[], opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const orderedIds = dedupeStrings(Array.isArray(ids) ? ids : []);
    if (orderedIds.length === 0) {
      throw new BadRequestException('ids is required');
    }

    const repo = manager.getRepository(DocumentLibrary);
    const existing = await repo
      .createQueryBuilder('l')
      .where('l.id IN (:...ids)', { ids: orderedIds })
      .getMany();

    if (existing.length !== orderedIds.length) {
      throw new BadRequestException('One or more libraries were not found');
    }

    for (let i = 0; i < orderedIds.length; i += 1) {
      await repo.update({ id: orderedIds[i] } as any, {
        display_order: i,
        updated_at: new Date(),
      } as any);
    }

    return this.listLibraries({ manager });
  }

  async updateLibrary(id: string, body: any, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const run = async (tx: EntityManager) => {
      const repo = tx.getRepository(DocumentLibrary);
      const existing = await repo.findOne({ where: { id } as any });
      if (!existing) throw new NotFoundException('Library not found');
      if (existing.is_system) throw new BadRequestException('System libraries cannot be modified');

      await this.assertLibraryManageable(existing.id, tx, userId);

      if (body?.name !== undefined) {
        const name = String(body?.name || '').trim();
        if (!name) throw new BadRequestException('name is required');
        existing.name = name;
        existing.slug = await this.generateUniqueLibrarySlug(name, tx, existing.id);
      }

      if (body?.owner_user_id !== undefined) {
        const ownerUserId = String(body?.owner_user_id || '').trim();
        if (!ownerUserId) throw new BadRequestException('owner_user_id is required');
        await this.assertTenantScopedIdsExist(tx, 'users', [ownerUserId], 'library owner');
        existing.owner_user_id = ownerUserId;
      }

      const hasAccessMode = Object.prototype.hasOwnProperty.call(body ?? {}, 'access_mode');
      const hasReaders = Object.prototype.hasOwnProperty.call(body ?? {}, 'reader_user_ids');
      const hasWriters = Object.prototype.hasOwnProperty.call(body ?? {}, 'writer_user_ids');
      const nextAccessMode = hasAccessMode
        ? this.normalizeLibraryAccessMode(body?.access_mode)
        : this.normalizeLibraryAccessMode(existing.access_mode);

      if (hasAccessMode || hasReaders || hasWriters) {
        existing.access_mode = nextAccessMode;

        const writerUserIds = this.normalizeLibraryMemberIds(body?.writer_user_ids);
        const readerUserIds = this.normalizeLibraryMemberIds(body?.reader_user_ids)
          .filter((candidate) => !writerUserIds.includes(candidate));
        const ownerUserId = String(existing.owner_user_id || '').trim();
        const allMemberIds = [...readerUserIds, ...writerUserIds]
          .filter((candidate) => candidate && candidate !== ownerUserId);

        if (allMemberIds.length > 0) {
          await this.assertTenantScopedIdsExist(tx, 'users', allMemberIds, 'library members');
        }

        await tx.getRepository(DocumentLibraryMember).delete({ library_id: existing.id } as any);

        if (existing.access_mode === 'restricted') {
          const membershipRepo = tx.getRepository(DocumentLibraryMember);
          for (const userIdToSave of readerUserIds) {
            await membershipRepo.save(membershipRepo.create({
              library_id: existing.id,
              user_id: userIdToSave,
              access_level: 'reader',
            }));
          }
          for (const userIdToSave of writerUserIds) {
            await membershipRepo.save(membershipRepo.create({
              library_id: existing.id,
              user_id: userIdToSave,
              access_level: 'writer',
            }));
          }
        }
      }

      existing.updated_at = new Date();
      await repo.save(existing);
      return this.getLibrary(existing.id, { manager: tx, userId });
    };

    if (manager.queryRunner?.isTransactionActive) {
      return run(manager);
    }
    return manager.transaction(run);
  }

  async deleteLibrary(id: string, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const run = async (tx: EntityManager) => {
      const repo = tx.getRepository(DocumentLibrary);
      const existing = await repo.findOne({ where: { id } as any });
      if (!existing) throw new NotFoundException('Library not found');
      if (existing.is_system) throw new BadRequestException('System libraries cannot be deleted');
      await this.assertLibraryManageable(existing.id, tx, userId);

      const accessibleFallbacks = (await this.listLibrariesWithAccess(tx, userId))
        .filter((library) => library.id !== existing.id && !library.is_system);
      const fallback = accessibleFallbacks[0] ?? null;

      if (!fallback) {
        throw new BadRequestException('Cannot delete the last accessible non-system library');
      }

      const folders = await tx
        .getRepository(DocumentFolder)
        .createQueryBuilder('f')
        .where('f.library_id = :libraryId', { libraryId: existing.id })
        .orderBy('f.parent_id', 'ASC', 'NULLS FIRST')
        .addOrderBy('lower(f.name)', 'ASC')
        .getMany();

      for (const folder of folders) {
        const nextName = await this.resolveMovedFolderName(
          tx,
          fallback.id,
          folder.parent_id || null,
          folder.name,
          existing.name,
        );
        await tx.getRepository(DocumentFolder).update(
          { id: folder.id } as any,
          {
            library_id: fallback.id,
            name: nextName,
            updated_at: new Date(),
          } as any,
        );
      }

      await tx
        .getRepository(Document)
        .createQueryBuilder()
        .update(Document)
        .set({ library_id: fallback.id } as any)
        .where('library_id = :libraryId', { libraryId: existing.id })
        .execute();

      await repo.delete({ id: existing.id } as any);
      return { ok: true, fallback_library_id: fallback.id };
    };

    if (manager.queryRunner?.isTransactionActive) {
      return run(manager);
    }
    return manager.transaction(run);
  }

  async list(query: any, opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null }) {
    const manager = this.getManager(opts);
    const tenantId = String(opts?.tenantId || '').trim();
    const { page, limit, skip, sort, q, filters } = parsePagination(query, { field: 'updated_at', direction: 'DESC' });
    let reviewDueDateParamIndex = 0;
    const nextReviewDueDateParam = () => `reviewDueDate${reviewDueDateParamIndex++}`;
    let linkedEntityParamIndex = 0;
    const nextLinkedEntityParam = () => `linkedEntity${linkedEntityParamIndex++}`;
    const accessibleLibraryViews = opts?.userId
      ? await this.listLibrariesWithAccess(manager, opts.userId || null)
      : null;
    const accessibleLibraries = accessibleLibraryViews
      ? accessibleLibraryViews.map((library) => library.id)
      : null;
    const writableLibraryIds = accessibleLibraryViews
      ? new Set(accessibleLibraryViews.filter((library) => library.can_write).map((library) => library.id))
      : null;
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return { items: [], total: 0, page, limit };
    }

    const allowedSort = new Set([
      'updated_at',
      'created_at',
      'title',
      'status',
      'item_number',
      'published_at',
      'review_due_at',
      'current_version_number',
      'primary_owner_name',
      'library_name',
      'document_type_name',
      'template_name',
    ]);
    const sortField = allowedSort.has(sort.field) ? sort.field : 'updated_at';
    // Alias-based sort fields need special handling
    const sortExpression = sortField === 'primary_owner_name'
      ? 'primary_owner_name'
      : sortField === 'library_name'
        ? 'library_name'
        : sortField === 'document_type_name'
          ? 'document_type_name'
        : sortField === 'template_name'
          ? 'template_name'
          : `d.${sortField}`;

    const qb = manager
      .getRepository(Document)
      .createQueryBuilder('d')
      .where('d.tenant_id = app_current_tenant()')
      .leftJoin('document_folders', 'f', 'f.id = d.folder_id AND f.tenant_id = d.tenant_id')
      .leftJoin('document_libraries', 'dl', 'dl.id = d.library_id AND dl.tenant_id = d.tenant_id')
      .leftJoin('document_types', 'dtype', 'dtype.id = d.document_type_id AND dtype.tenant_id = d.tenant_id')
      .leftJoin('documents', 'td', 'td.id = d.template_document_id AND td.tenant_id = d.tenant_id')
      .select([
        'd.id AS id',
        'd.item_number AS item_number',
        'd.title AS title',
        'd.summary AS summary',
        'd.status AS status',
        'd.revision AS revision',
        'd.current_version_number AS current_version_number',
        'd.folder_id AS folder_id',
        'd.library_id AS library_id',
        'd.document_type_id AS document_type_id',
        'd.template_document_id AS template_document_id',
        'd.published_at AS published_at',
        'd.last_reviewed_at AS last_reviewed_at',
        'd.review_due_at AS review_due_at',
        'd.created_by AS created_by',
        'd.updated_by AS updated_by',
        'd.created_at AS created_at',
        'd.updated_at AS updated_at',
        'f.name AS folder_name',
        'dl.name AS library_name',
        'dl.slug AS library_slug',
        'dtype.name AS document_type_name',
        'td.title AS template_name',
        `(SELECT w.requested_revision
          FROM document_workflows w
          WHERE w.document_id = d.id
            AND w.tenant_id = d.tenant_id
            AND w.status = 'approved'
          ORDER BY coalesce(w.completed_at, w.requested_at) DESC
          LIMIT 1) AS validated_revision`,
        `(SELECT w.completed_at
          FROM document_workflows w
          WHERE w.document_id = d.id
            AND w.tenant_id = d.tenant_id
            AND w.status = 'approved'
          ORDER BY coalesce(w.completed_at, w.requested_at) DESC
          LIMIT 1) AS validated_at`,
      `(SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, c.user_id::text)
          FROM document_contributors c
          LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = d.tenant_id
          WHERE c.document_id = d.id AND c.tenant_id = d.tenant_id AND c.role = 'owner' AND c.is_primary = true
          LIMIT 1) AS primary_owner_name`,
      ]);
    if (tenantId) {
      qb.andWhere('d.tenant_id = :tenantId', { tenantId });
    }
    if (accessibleLibraries) {
      qb.andWhere('d.library_id IN (:...accessibleLibraryIds)', { accessibleLibraryIds: accessibleLibraries });
    }
    {
      const acl = documentIncidentVisibilityQueryBuilderClause(
        'd',
        await resolveDocumentIncidentViewer(manager, opts?.userId || null, tenantId || null),
      );
      qb.andWhere(acl.clause, acl.params);
    }

    const search = this.getDocumentSearchState(q);
    if (search) {
      const params: Record<string, string | number> = {
        searchTerm: search.term,
        searchLike: `%${search.term}%`,
      };
      const searchClauses = [
        `d.search_vector @@ ${bilingualDocumentTsQuerySql(':searchTerm')}`,
        `d.title ILIKE :searchLike`,
        `COALESCE(d.summary, '') ILIKE :searchLike`,
        `COALESCE(d.content_plain, '') ILIKE :searchLike`,
        `COALESCE(d.content_markdown, '') ILIKE :searchLike`,
      ];
      if (search.itemNumber != null) {
        params.searchItemNumber = search.itemNumber;
        searchClauses.unshift('d.item_number = :searchItemNumber');
      }
      qb.andWhere(`(${searchClauses.join(' OR ')})`, params);
    }

    const filterStatus = query?.status || (filters as any)?.status?.filter;
    if (filterStatus && isDocumentStatus(String(filterStatus))) {
      qb.andWhere('d.status = :status', { status: String(filterStatus) });
    }

    const libraryId = query?.library_id || (filters as any)?.library_id?.filter;
    if (libraryId) {
      qb.andWhere('d.library_id = :libraryId', { libraryId: String(libraryId) });
    }

    const rootFolder = ['1', 'true'].includes(String(query?.root_folder || '').toLowerCase());
    const folderId = query?.folder_id || (filters as any)?.folder_id?.filter;
    if (rootFolder) {
      qb.andWhere('d.folder_id IS NULL');
    } else if (folderId) {
      qb.andWhere('d.folder_id = :folderId', { folderId: String(folderId) });
    }

    const typeId = query?.document_type_id || (filters as any)?.document_type_id?.filter;
    if (typeId) {
      qb.andWhere('d.document_type_id = :typeId', { typeId: String(typeId) });
    }

    const documentTypeNameFilter = (filters as any)?.document_type_name;
    if (documentTypeNameFilter?.filterType === 'set' && Array.isArray(documentTypeNameFilter.values) && documentTypeNameFilter.values.length > 0) {
      const hasNull = documentTypeNameFilter.values.includes(null);
      const nonNull = documentTypeNameFilter.values.filter((value: any) => value !== null);
      if (hasNull && nonNull.length > 0) {
        qb.andWhere('(dtype.name = ANY(:documentTypeNames) OR dtype.name IS NULL)', { documentTypeNames: nonNull });
      } else if (hasNull) {
        qb.andWhere('dtype.name IS NULL');
      } else if (nonNull.length > 0) {
        qb.andWhere('dtype.name = ANY(:documentTypeNames)', { documentTypeNames: nonNull });
      }
    }

    const templateId = query?.template_document_id || (filters as any)?.template_document_id?.filter;
    if (templateId) {
      qb.andWhere('d.template_document_id = :templateId', { templateId: String(templateId) });
    }

    const reviewDueDateFilter = (filters as any)?.review_due_at ?? query?.review_due_at;
    if (reviewDueDateFilter) {
      if (typeof reviewDueDateFilter === 'string') {
        qb.andWhere('d.review_due_at = :reviewDueDate', { reviewDueDate: reviewDueDateFilter });
      } else {
        const reviewDueDateCondition = compileDateFilterCondition(
          reviewDueDateFilter,
          'd.review_due_at',
          nextReviewDueDateParam,
        );
        if (reviewDueDateCondition) {
          qb.andWhere(reviewDueDateCondition.sql, reviewDueDateCondition.params);
        }
      }
    }

    const ownerId = query?.owner_id || (filters as any)?.owner_id?.filter;
    if (ownerId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM document_contributors c
          WHERE c.document_id = d.id
            AND c.tenant_id = d.tenant_id
            AND c.user_id = :ownerId
            AND c.role = 'owner'
        )`,
        { ownerId: String(ownerId) },
      );
    }

    // Scope filters: ownerUserId (my documents) and teamId (my team's documents)
    const ownerUserId = query?.ownerUserId;
    if (ownerUserId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM document_contributors c
          WHERE c.document_id = d.id
            AND c.tenant_id = d.tenant_id
            AND c.user_id = :ownerUserId
            AND c.role = 'owner'
        )`,
        { ownerUserId: String(ownerUserId) },
      );
    }

    const teamId = query?.teamId;
    if (teamId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM document_contributors c
          WHERE c.document_id = d.id
            AND c.tenant_id = d.tenant_id
            AND c.role = 'owner'
            AND c.user_id IN (
              SELECT user_id
              FROM portfolio_team_member_configs
              WHERE team_id = :teamId
                AND tenant_id = d.tenant_id
            )
        )`,
        { teamId: String(teamId) },
      );
    }

    // CheckboxSetFilter: multi-value status filter
    const statusFilter = (filters as any)?.status;
    if (statusFilter?.filterType === 'set' && Array.isArray(statusFilter.values) && statusFilter.values.length > 0) {
      const validStatuses = statusFilter.values.filter((s: string) => isDocumentStatus(String(s)));
      if (validStatuses.length > 0) {
        qb.andWhere('d.status = ANY(:statusValues)', { statusValues: validStatuses });
      }
    }

    // CheckboxSetFilter: folder_name
    const folderNameFilter = (filters as any)?.folder_name;
    if (folderNameFilter?.filterType === 'set' && Array.isArray(folderNameFilter.values) && folderNameFilter.values.length > 0) {
      const hasNull = folderNameFilter.values.includes(null);
      const nonNull = folderNameFilter.values.filter((v: any) => v !== null);
      if (hasNull && nonNull.length > 0) {
        qb.andWhere('(f.name = ANY(:folderNames) OR f.name IS NULL)', { folderNames: nonNull });
      } else if (hasNull) {
        qb.andWhere('f.name IS NULL');
      } else if (nonNull.length > 0) {
        qb.andWhere('f.name = ANY(:folderNames)', { folderNames: nonNull });
      }
    }

    // CheckboxSetFilter: template_name
    const templateNameFilter = (filters as any)?.template_name;
    if (templateNameFilter?.filterType === 'set' && Array.isArray(templateNameFilter.values) && templateNameFilter.values.length > 0) {
      const hasNull = templateNameFilter.values.includes(null);
      const nonNull = templateNameFilter.values.filter((v: any) => v !== null);
      if (hasNull && nonNull.length > 0) {
        qb.andWhere('(td.title = ANY(:templateNames) OR td.title IS NULL)', { templateNames: nonNull });
      } else if (hasNull) {
        qb.andWhere('td.title IS NULL');
      } else if (nonNull.length > 0) {
        qb.andWhere('td.title = ANY(:templateNames)', { templateNames: nonNull });
      }
    }

    // CheckboxSetFilter: library_name
    const libraryNameFilter = (filters as any)?.library_name;
    if (libraryNameFilter?.filterType === 'set' && Array.isArray(libraryNameFilter.values) && libraryNameFilter.values.length > 0) {
      const hasNull = libraryNameFilter.values.includes(null);
      const nonNull = libraryNameFilter.values.filter((v: any) => v !== null);
      if (hasNull && nonNull.length > 0) {
        qb.andWhere('(dl.name = ANY(:libraryNames) OR dl.name IS NULL)', { libraryNames: nonNull });
      } else if (hasNull) {
        qb.andWhere('dl.name IS NULL');
      } else if (nonNull.length > 0) {
        qb.andWhere('dl.name = ANY(:libraryNames)', { libraryNames: nonNull });
      }
    }

    // CheckboxSetFilter: primary_owner_name
    const ownerNameFilter = (filters as any)?.primary_owner_name;
    if (ownerNameFilter?.filterType === 'set' && Array.isArray(ownerNameFilter.values) && ownerNameFilter.values.length > 0) {
      const hasNull = ownerNameFilter.values.includes(null);
      const nonNull = ownerNameFilter.values.filter((v: any) => v !== null);
      const subquery = `(SELECT COALESCE(NULLIF(trim(concat_ws(' ', u2.first_name, u2.last_name)), ''), u2.email, c2.user_id::text)
        FROM document_contributors c2
        LEFT JOIN users u2 ON u2.id = c2.user_id AND u2.tenant_id = d.tenant_id
        WHERE c2.document_id = d.id AND c2.tenant_id = d.tenant_id AND c2.role = 'owner' AND c2.is_primary = true
        LIMIT 1)`;
      if (hasNull && nonNull.length > 0) {
        qb.andWhere(`(${subquery} = ANY(:ownerNames) OR ${subquery} IS NULL)`, { ownerNames: nonNull });
      } else if (hasNull) {
        qb.andWhere(`${subquery} IS NULL`);
      } else if (nonNull.length > 0) {
        qb.andWhere(`${subquery} = ANY(:ownerNames)`, { ownerNames: nonNull });
      }
    }

    applyDocumentLinkedEntityFilters(qb, filters as Record<string, any> | undefined, nextLinkedEntityParam);

    const total = await qb.getCount();

    const rows = await qb
      .orderBy(sortExpression, sort.direction as 'ASC' | 'DESC')
      .addOrderBy('d.item_number', 'DESC')
      .offset(skip)
      .limit(limit)
      .getRawMany();

    const items = rows.map((row: any) => ({
      ...row,
      item_ref: `DOC-${row.item_number}`,
      can_write: writableLibraryIds ? writableLibraryIds.has(String(row.library_id || '')) : false,
      validated_revision: row.validated_revision != null ? Number(row.validated_revision) : null,
      validated_at: row.validated_at || null,
      is_validated_current_revision:
        String(row.status || '').toLowerCase() === 'published'
        && row.validated_revision != null
        && Number(row.validated_revision) === Number(row.revision || 0),
    }));

    return { items, total, page, limit };
  }

  async listIds(query: any, opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null }): Promise<{ ids: string[]; total: number }> {
    const manager = this.getManager(opts);
    const tenantId = String(opts?.tenantId || '').trim();
    const parsed = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 }, { field: 'updated_at', direction: 'DESC' });
    const search = this.getDocumentSearchState(parsed.q);
    const filters = parsed.filters as Record<string, any> | undefined;
    let linkedEntityParamIndex = 0;
    const nextLinkedEntityParam = () => `linkedEntity${linkedEntityParamIndex++}`;
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return { ids: [], total: 0 };
    }

    const qb = manager
      .getRepository(Document)
      .createQueryBuilder('d')
      .where('d.tenant_id = app_current_tenant()')
      .select('d.id', 'id');
    if (tenantId) {
      qb.andWhere('d.tenant_id = :tenantId', { tenantId });
    }
    if (accessibleLibraries) {
      qb.andWhere('d.library_id IN (:...accessibleLibraryIds)', { accessibleLibraryIds: accessibleLibraries });
    }
    {
      const acl = documentIncidentVisibilityQueryBuilderClause(
        'd',
        await resolveDocumentIncidentViewer(manager, opts?.userId || null, tenantId || null),
      );
      qb.andWhere(acl.clause, acl.params);
    }

    if (search) {
      const params: Record<string, string | number> = {
        searchTerm: search.term,
      };
      const searchClauses = [`d.search_vector @@ ${bilingualDocumentTsQuerySql(':searchTerm')}`];
      if (search.itemNumber != null) {
        params.searchItemNumber = search.itemNumber;
        searchClauses.unshift('d.item_number = :searchItemNumber');
      }
      qb.andWhere(`(${searchClauses.join(' OR ')})`, params);
    }

    const status = query?.status;
    if (status && isDocumentStatus(String(status))) {
      qb.andWhere('d.status = :status', { status: String(status) });
    }

    const libraryId = query?.library_id;
    if (libraryId) {
      qb.andWhere('d.library_id = :libraryId', { libraryId: String(libraryId) });
    }

    const rootFolder = ['1', 'true'].includes(String(query?.root_folder || '').toLowerCase());
    const folderId = query?.folder_id || (filters as any)?.folder_id?.filter;
    if (rootFolder) {
      qb.andWhere('d.folder_id IS NULL');
    } else if (folderId) {
      qb.andWhere('d.folder_id = :folderId', { folderId: String(folderId) });
    }

    applyDocumentLinkedEntityFilters(qb, filters, nextLinkedEntityParam);

    const total = await qb.clone().getCount();
    const rows = await qb
      .orderBy('d.updated_at', 'DESC')
      .limit(Math.min(Number(query?.limit) || 10000, 10000))
      .getRawMany();

    const ids = rows.map((row: any) => String(row.id)).filter(Boolean);
    return { ids, total };
  }

  async listFilterValues(query: any, opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null }): Promise<Record<string, any[]>> {
    const manager = this.getManager(opts);
    const tenantId = String(opts?.tenantId || '').trim();
    const fields = query?.fields ? String(query.fields).split(',') : null;
    const shouldReturn = (field: string) => !fields || fields.includes(field);
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return {};
    }

    // Build a base scope subquery for cross-filtering
    const scopeConditions: string[] = ['1=1'];
    const scopeParams: any[] = [];
    scopeConditions.push(`d.tenant_id = app_current_tenant()`);
    if (tenantId) {
      scopeConditions.push(`d.tenant_id = $${scopeParams.length + 1}`);
      scopeParams.push(tenantId);
    }
    const ownerUserId = query?.ownerUserId;
    if (ownerUserId) {
      scopeConditions.push(`EXISTS (SELECT 1 FROM document_contributors c WHERE c.document_id = d.id AND c.tenant_id = d.tenant_id AND c.role = 'owner' AND c.user_id = $${scopeParams.length + 1})`);
      scopeParams.push(String(ownerUserId));
    }
    const teamId = query?.teamId;
    if (teamId) {
      scopeConditions.push(`EXISTS (SELECT 1 FROM document_contributors c WHERE c.document_id = d.id AND c.tenant_id = d.tenant_id AND c.role = 'owner' AND c.user_id IN (SELECT user_id FROM portfolio_team_member_configs WHERE team_id = $${scopeParams.length + 1} AND tenant_id = d.tenant_id))`);
      scopeParams.push(String(teamId));
    }
    const libraryId = query?.library_id;
    if (libraryId) {
      scopeConditions.push(`d.library_id = $${scopeParams.length + 1}`);
      scopeParams.push(String(libraryId));
    }
    const rootFolder = ['1', 'true'].includes(String(query?.root_folder || '').toLowerCase());
    const folderId = query?.folder_id;
    if (rootFolder) {
      scopeConditions.push('d.folder_id IS NULL');
    } else if (folderId) {
      scopeConditions.push(`d.folder_id = $${scopeParams.length + 1}`);
      scopeParams.push(String(folderId));
    }
    if (accessibleLibraries) {
      scopeConditions.push(`d.library_id = ANY($${scopeParams.length + 1}::uuid[])`);
      scopeParams.push(accessibleLibraries);
    }
    {
      const viewer = await resolveDocumentIncidentViewer(manager, opts?.userId || null, tenantId || null);
      scopeConditions.push(documentIncidentVisibilitySql('d', viewer, scopeParams).replace(/^\s*AND\s/, ''));
    }

    // Apply cross-filter from other active filters
    let filters: any = {};
    if (query?.filters) {
      try { filters = typeof query.filters === 'string' ? JSON.parse(query.filters) : query.filters; } catch { /* ignore */ }
    }

    const search = this.getDocumentSearchState(query?.q);
    if (search) {
      const searchFilter = this.buildDocumentSearchSql('d', scopeParams.length, search);
      scopeConditions.push(searchFilter.clause);
      scopeParams.push(...searchFilter.params);
    }

    const scopeWhere = scopeConditions.join(' AND ');

    const promises: Array<Promise<[string, any[]]>> = [];

    if (shouldReturn('status')) {
      promises.push(
        manager.query(
          `SELECT DISTINCT d.status FROM documents d WHERE ${scopeWhere} ORDER BY d.status`,
          scopeParams,
        ).then((rows: any[]) => ['status', rows.map((r: any) => r.status).filter(Boolean)]),
      );
    }

    if (shouldReturn('folder_name')) {
      promises.push(
        manager.query(
          `SELECT DISTINCT f.name
           FROM documents d
           LEFT JOIN document_folders f ON f.id = d.folder_id AND f.tenant_id = d.tenant_id
           WHERE ${scopeWhere}
           ORDER BY 1`,
          scopeParams,
        ).then((rows: any[]) => ['folder_name', rows.map((r: any) => r.name)]),
      );
    }

    if (shouldReturn('template_name')) {
      promises.push(
        manager.query(
          `SELECT DISTINCT td.title AS name
           FROM documents d
           LEFT JOIN documents td ON td.id = d.template_document_id AND td.tenant_id = d.tenant_id
           WHERE ${scopeWhere}
           ORDER BY 1`,
          scopeParams,
        ).then((rows: any[]) => ['template_name', rows.map((r: any) => r.name)]),
      );
    }

    if (shouldReturn('document_type_name')) {
      promises.push(
        manager.query(
          `SELECT DISTINCT dt.name
           FROM documents d
           LEFT JOIN document_types dt ON dt.id = d.document_type_id AND dt.tenant_id = d.tenant_id
           WHERE ${scopeWhere}
           ORDER BY 1`,
          scopeParams,
        ).then((rows: any[]) => ['document_type_name', rows.map((r: any) => r.name)]),
      );
    }

    if (shouldReturn('library_name')) {
      promises.push(
        manager.query(
          `SELECT DISTINCT dl.name
           FROM documents d
           LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
           WHERE ${scopeWhere}
           ORDER BY 1`,
          scopeParams,
        ).then((rows: any[]) => ['library_name', rows.map((r: any) => r.name)]),
      );
    }

    if (shouldReturn('primary_owner_name')) {
      promises.push(
        manager.query(
          `SELECT DISTINCT (SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, c.user_id::text)
              FROM document_contributors c
              LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = d.tenant_id
              WHERE c.document_id = d.id AND c.tenant_id = d.tenant_id AND c.role = 'owner' AND c.is_primary = true
              LIMIT 1) AS name
           FROM documents d
           WHERE ${scopeWhere}
           ORDER BY 1`,
          scopeParams,
        ).then((rows: any[]) => ['primary_owner_name', rows.map((r: any) => r.name).filter(Boolean)]),
      );
    }

    // Legacy fields for backwards compat
    if (shouldReturn('folders')) {
      promises.push(
        manager.query(
          libraryId
            ? `SELECT id, name
               FROM document_folders
               WHERE tenant_id = app_current_tenant()
                 AND library_id = $1
               ORDER BY lower(name)`
            : `SELECT id, name
               FROM document_folders
               WHERE tenant_id = app_current_tenant()
               ORDER BY lower(name)`,
          libraryId ? [libraryId] : [],
        ).then(
          (rows: any[]) => ['folders', rows.map((r: any) => `${r.id}|${r.name}`)],
        ),
      );
    }
    if (shouldReturn('document_types')) {
      promises.push(
        manager.query(
          `SELECT id, name
           FROM document_types
           WHERE tenant_id = app_current_tenant()
             AND is_active = true
           ORDER BY lower(name)`,
        ).then(
          (rows: any[]) => ['document_types', rows.map((r: any) => `${r.id}|${r.name}`)],
        ),
      );
    }
    if (shouldReturn('owners')) {
      promises.push(
        manager.query(
          `SELECT DISTINCT c.user_id AS id,
                  COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, c.user_id::text) AS name
           FROM document_contributors c
           LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
           WHERE c.role = 'owner'
             AND c.tenant_id = app_current_tenant()
           ORDER BY 2`,
        ).then((rows: any[]) => ['owners', rows.map((r: any) => `${r.id}|${r.name}`)]),
      );
    }

    const results = await Promise.all(promises);
    const out: Record<string, any[]> = {};
    for (const [key, values] of results) {
      out[key] = values;
    }
    return out;
  }

  async listRelationOptions(
    entity: RelationEntityType,
    query: any,
    opts?: { manager?: EntityManager; userId?: string | null; tenantId?: string | null },
  ): Promise<{ items: Array<{ id: string; label: string }> }> {
    const manager = this.getManager(opts);
    const q = String(query?.q || '').trim();
    const limit = Math.min(Math.max(Number(query?.limit) || 25, 1), 50);
    const itemNumber = this.parseItemNumberQuery(q);

    switch (entity) {
      case 'applications': {
        const params: any[] = [];
        let where = `tenant_id = app_current_tenant()`;
        if (q) {
          params.push(`%${q}%`);
          where += ` AND name ILIKE $${params.length}`;
        }
        params.push(limit);
        const rows = await manager.query(
          `SELECT id, name
           FROM applications
           WHERE ${where}
           ORDER BY lower(name) ASC
           LIMIT $${params.length}`,
          params,
        );
        return { items: rows.map((row: any) => ({ id: row.id, label: row.name || row.id })) };
      }
      case 'assets': {
        const params: any[] = [];
        let where = `tenant_id = app_current_tenant()`;
        if (q) {
          params.push(`%${q}%`);
          where += ` AND name ILIKE $${params.length}`;
        }
        params.push(limit);
        const rows = await manager.query(
          `SELECT id, name
           FROM assets
           WHERE ${where}
           ORDER BY lower(name) ASC
           LIMIT $${params.length}`,
          params,
        );
        return { items: rows.map((row: any) => ({ id: row.id, label: row.name || row.id })) };
      }
      case 'projects': {
        const params: any[] = [];
        let where = `tenant_id = app_current_tenant()`;
        if (q) {
          params.push(`%${q}%`);
          const textPos = params.length;
          if (itemNumber != null) {
            params.push(itemNumber);
            where += ` AND (name ILIKE $${textPos} OR item_number = $${params.length})`;
          } else {
            where += ` AND name ILIKE $${textPos}`;
          }
        }
        params.push(limit);
        const rows = await manager.query(
          `SELECT id, name, item_number
           FROM portfolio_projects
           WHERE ${where}
           ORDER BY lower(name) ASC
           LIMIT $${params.length}`,
          params,
        );
        return {
          items: rows.map((row: any) => ({
            id: row.id,
            label: row.item_number ? `PRJ-${row.item_number} - ${row.name}` : (row.name || row.id),
          })),
        };
      }
      case 'requests': {
        const params: any[] = [];
        let where = `tenant_id = app_current_tenant()`;
        if (q) {
          params.push(`%${q}%`);
          const textPos = params.length;
          if (itemNumber != null) {
            params.push(itemNumber);
            where += ` AND (name ILIKE $${textPos} OR item_number = $${params.length})`;
          } else {
            where += ` AND name ILIKE $${textPos}`;
          }
        }
        params.push(limit);
        const rows = await manager.query(
          `SELECT id, name, item_number
           FROM portfolio_requests
           WHERE ${where}
           ORDER BY lower(name) ASC
           LIMIT $${params.length}`,
          params,
        );
        return {
          items: rows.map((row: any) => ({
            id: row.id,
            label: row.item_number ? `REQ-${row.item_number} - ${row.name}` : (row.name || row.id),
          })),
        };
      }
      case 'tasks': {
        const params: any[] = [];
        let where = `tenant_id = app_current_tenant()`;
        if (q) {
          params.push(`%${q}%`);
          const textPos = params.length;
          if (itemNumber != null) {
            params.push(itemNumber);
            where += ` AND (COALESCE(title, '') ILIKE $${textPos} OR item_number = $${params.length})`;
          } else {
            where += ` AND COALESCE(title, '') ILIKE $${textPos}`;
          }
        }
        params.push(limit);
        const rows = await manager.query(
          `SELECT id, title, item_number
           FROM tasks
           WHERE ${where}
           ORDER BY created_at DESC
           LIMIT $${params.length}`,
          params,
        );
        return {
          items: rows.map((row: any) => ({
            id: row.id,
            label: row.item_number
              ? `T-${row.item_number} - ${row.title || 'Untitled task'}`
              : (row.title || row.id),
          })),
        };
      }
      case 'interfaces': {
        const params: any[] = [];
        let where = `tenant_id = app_current_tenant()`;
        if (q) {
          params.push(`%${q}%`);
          where += ` AND (name ILIKE $${params.length} OR interface_reference ILIKE $${params.length} OR COALESCE(interface_id, '') ILIKE $${params.length})`;
        }
        params.push(limit);
        const rows = await manager.query(
          `SELECT id, interface_reference, interface_id, name
           FROM interfaces
           WHERE ${where}
           ORDER BY lower(name) ASC
           LIMIT $${params.length}`,
          params,
        );
        return {
          items: rows.map((row: any) => ({
            id: row.id,
            label: [row.interface_reference || row.interface_id, row.name].filter(Boolean).join(' - ') || row.id,
          })),
        };
      }
      case 'incidents': {
        // Confidential incidents (and every incident for a caller without
        // incidents:reader) must not surface as a picker label: `INC-N · title`
        // would leak both the reference and the title.
        const viewer = await resolveDocumentIncidentViewer(manager, opts?.userId ?? null, opts?.tenantId ?? null);
        if (!viewer.canReadIncidents) {
          return { items: [] };
        }
        const params: any[] = [];
        let where = `i.tenant_id = app_current_tenant()`;
        where += incidentVisibilitySql('i', viewer, params);
        if (q) {
          params.push(`%${q}%`);
          const textPos = params.length;
          if (itemNumber != null) {
            params.push(itemNumber);
            where += ` AND (i.title ILIKE $${textPos} OR i.item_number = $${params.length})`;
          } else {
            where += ` AND i.title ILIKE $${textPos}`;
          }
        }
        params.push(limit);
        const rows = await manager.query(
          `SELECT i.id, i.title, i.item_number
           FROM incidents i
           WHERE ${where}
           ORDER BY (i.status IN ('closed', 'cancelled')) ASC, i.detected_at DESC
           LIMIT $${params.length}`,
          params,
        );
        return {
          items: rows.map((row: any) => ({
            id: row.id,
            label: `INC-${row.item_number} · ${row.title}`,
          })),
        };
      }
      default:
        throw new BadRequestException('Unsupported relation entity');
    }
  }

  async listClassificationOptions(opts?: { manager?: EntityManager }): Promise<{
    categories: Array<{ id: string; name: string; is_active?: boolean }>;
    streams: Array<{ id: string; name: string; category_id: string; is_active?: boolean }>;
  }> {
    const manager = this.getManager(opts);
    const [categories, streams] = await Promise.all([
      manager.query(
        `SELECT id, name, is_active
         FROM portfolio_categories
         WHERE tenant_id = app_current_tenant()
         ORDER BY display_order ASC, lower(name) ASC`,
      ),
      manager.query(
        `SELECT id, name, category_id, is_active
         FROM portfolio_streams
         WHERE tenant_id = app_current_tenant()
         ORDER BY display_order ASC, lower(name) ASC`,
      ),
    ]);

    return {
      categories: categories.map((row: any) => ({
        id: row.id,
        name: row.name,
        is_active: row.is_active,
      })),
      streams: streams.map((row: any) => ({
        id: row.id,
        name: row.name,
        category_id: row.category_id,
        is_active: row.is_active,
      })),
    };
  }

  async listContributorOptions(opts?: { manager?: EntityManager }): Promise<Array<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    label: string;
  }>> {
    const manager = this.getManager(opts);
    const rows = await manager.query(
      `SELECT id,
              email,
              first_name,
              last_name,
              status,
              COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email, id::text) AS label
       FROM users
       WHERE tenant_id = app_current_tenant()
         AND coalesce(status, '') = 'enabled'
       ORDER BY lower(coalesce(nullif(last_name, ''), email)) ASC,
                lower(coalesce(nullif(first_name, ''), email)) ASC,
                lower(email) ASC`,
    );

    return rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      label: row.label || row.email || row.id,
    }));
  }

  async get(idOrRef: string, opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions) {
    const manager = this.getManager(opts);
    const id = await this.resolveDocumentId(idOrRef, manager);

    const rows = await manager.query(
      `SELECT d.*,
              f.name AS folder_name,
              dl.name AS library_name,
              dl.slug AS library_slug,
              dtype.name AS document_type_name,
              td.title AS template_document_title,
              td.item_number AS template_document_item_number,
              td.document_type_id AS template_document_type_id,
              tdt.name AS template_document_type_name
       FROM documents d
       LEFT JOIN document_folders f ON f.id = d.folder_id AND f.tenant_id = d.tenant_id
       LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
       LEFT JOIN document_types dtype ON dtype.id = d.document_type_id AND dtype.tenant_id = d.tenant_id
       LEFT JOIN documents td ON td.id = d.template_document_id AND td.tenant_id = d.tenant_id
       LEFT JOIN document_types tdt ON tdt.id = td.document_type_id AND tdt.tenant_id = td.tenant_id
       WHERE d.id = $1
       LIMIT 1`,
      [id],
    );

    if (!rows.length) {
      throw new NotFoundException('Document not found');
    }

    const document = rows[0];
    const libraryAccess = await this.resolveDocumentAccess(id, manager, opts?.userId || null, 'read', {
      ...(opts ?? {}),
      knownLibraryId: document.library_id,
    });
    // §3.7: reached through the incident's own routes, the caller has no
    // Knowledge right on this document — only the right to see the incident. The
    // review body is theirs to read; the document's Knowledge neighbourhood is
    // not. Related applications, assets, projects, requests, tasks and interfaces
    // are withheld entirely (they carry no ACL of their own here), and so is the
    // template the document was created from. Related incidents and backlinks
    // stay, because both are already filtered on the caller's own rights.
    const knowledgeBranch = libraryAccess.granted_by_source_context !== true;
    // Related incidents and backlinks are filtered on their own rights: reaching a
    // document (even through the incident source context) never exposes the
    // metadata of neighbouring incidents or documents the caller cannot read.
    const incidentViewer = await resolveDocumentIncidentViewer(
      manager,
      opts?.userId || null,
      opts?.tenantId ?? document.tenant_id,
    );
    const backlinkLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');

    const incidentRelationParams: unknown[] = [id];
    const incidentRelationSql = incidentViewer.canReadIncidents
      ? `SELECT dinc.incident_id, inc.title, inc.item_number FROM document_incidents dinc
           JOIN incidents inc ON inc.id = dinc.incident_id AND inc.tenant_id = dinc.tenant_id
           WHERE dinc.document_id = $1
             ${incidentVisibilitySql('inc', incidentViewer, incidentRelationParams)}
           ORDER BY dinc.created_at ASC`
      : null;

    const backlinkParams: unknown[] = [id];
    let backlinkLibraryClause = '';
    if (backlinkLibraries) {
      if (backlinkLibraries.length === 0) {
        backlinkLibraryClause = ' AND false';
      } else {
        backlinkParams.push(backlinkLibraries);
        backlinkLibraryClause = ` AND d.library_id = ANY($${backlinkParams.length}::uuid[])`;
      }
    }
    const backlinkIncidentClause = documentIncidentVisibilitySql('d', incidentViewer, backlinkParams);

    const [
      contributors,
      classifications,
      relations,
      incomingReferences,
      attachments,
      editLock,
      workflow,
      latestApprovedWorkflow,
      integratedBinding,
    ] = await Promise.all([
      manager.query(
        `SELECT c.*, COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, c.user_id::text) AS user_name
         FROM document_contributors c
         LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
         WHERE c.document_id = $1
         ORDER BY c.is_primary DESC, c.created_at ASC`,
        [id],
      ),
      manager.query(
        `SELECT dc.*, pc.name AS category_name, ps.name AS stream_name
         FROM document_classifications dc
         LEFT JOIN portfolio_categories pc ON pc.id = dc.category_id AND pc.tenant_id = dc.tenant_id
         LEFT JOIN portfolio_streams ps ON ps.id = dc.stream_id AND ps.tenant_id = dc.tenant_id
         WHERE dc.document_id = $1
         ORDER BY pc.name ASC, ps.name ASC`,
        [id],
      ),
      Promise.all([
        knowledgeBranch ? manager.query(
          `SELECT da.application_id, a.name FROM document_applications da
           JOIN applications a ON a.id = da.application_id AND a.tenant_id = da.tenant_id
           WHERE da.document_id = $1 ORDER BY da.created_at ASC`, [id]) : [],
        knowledgeBranch ? manager.query(
          `SELECT das.asset_id, a.name FROM document_assets das
           JOIN assets a ON a.id = das.asset_id AND a.tenant_id = das.tenant_id
           WHERE das.document_id = $1 ORDER BY das.created_at ASC`, [id]) : [],
        knowledgeBranch ? manager.query(
          `SELECT dp.project_id, p.name, p.item_number FROM document_projects dp
           JOIN portfolio_projects p ON p.id = dp.project_id AND p.tenant_id = dp.tenant_id
           WHERE dp.document_id = $1 ORDER BY dp.created_at ASC`, [id]) : [],
        knowledgeBranch ? manager.query(
          `SELECT dr.request_id, r.name, r.item_number FROM document_requests dr
           JOIN portfolio_requests r ON r.id = dr.request_id AND r.tenant_id = dr.tenant_id
           WHERE dr.document_id = $1 ORDER BY dr.created_at ASC`, [id]) : [],
        knowledgeBranch ? manager.query(
          `SELECT dt.task_id, t.title, t.item_number FROM document_tasks dt
           JOIN tasks t ON t.id = dt.task_id AND t.tenant_id = dt.tenant_id
           WHERE dt.document_id = $1 ORDER BY dt.created_at ASC`, [id]) : [],
        knowledgeBranch ? manager.query(
          `SELECT di.interface_id, i.interface_reference, i.interface_id AS interface_code, i.name
           FROM document_interfaces di
           JOIN interfaces i ON i.id = di.interface_id AND i.tenant_id = di.tenant_id
           WHERE di.document_id = $1 ORDER BY di.created_at ASC`, [id]) : [],
        incidentRelationSql
          ? manager.query(incidentRelationSql, incidentRelationParams)
          : Promise.resolve([]),
      ]),
      manager.query(
        `SELECT r.id,
                r.source_document_id,
                d.item_number AS source_item_number,
                d.title AS source_title,
                d.status AS source_status
         FROM document_references r
         JOIN documents d ON d.id = r.source_document_id AND d.tenant_id = r.tenant_id
         WHERE r.target_document_id = $1
           ${backlinkLibraryClause}
           ${backlinkIncidentClause}
         ORDER BY d.updated_at DESC`,
        backlinkParams,
      ),
      manager.query(
        `SELECT *
         FROM document_attachments
         WHERE document_id = $1
           AND source_field IS NULL
         ORDER BY uploaded_at DESC`,
        [id],
      ),
      this.getActiveDocumentLock(id, manager),
      this.getActiveWorkflow(id, manager),
      this.getLatestApprovedWorkflowSummary(id, manager),
      this.getIntegratedBinding(id, manager),
    ]);

    const validationInfo = this.getValidationInfo(document, latestApprovedWorkflow);

    return {
      ...document,
      ...(knowledgeBranch ? {} : {
        template_document_id: null,
        template_document_title: null,
        template_document_item_number: null,
        template_document_type_id: null,
        template_document_type_name: null,
      }),
      item_ref: `DOC-${document.item_number}`,
      contributors,
      classifications,
      relations: {
        applications: relations[0].map((row: any) => ({ id: row.application_id, name: row.name })),
        assets: relations[1].map((row: any) => ({ id: row.asset_id, name: row.name })),
        projects: relations[2].map((row: any) => ({ id: row.project_id, name: row.item_number ? `PRJ-${row.item_number} - ${row.name}` : row.name })),
        requests: relations[3].map((row: any) => ({ id: row.request_id, name: row.item_number ? `REQ-${row.item_number} - ${row.name}` : row.name })),
        tasks: relations[4].map((row: any) => ({ id: row.task_id, name: row.item_number ? `T-${row.item_number} - ${row.title || 'Untitled task'}` : (row.title || 'Untitled task') })),
        interfaces: relations[5].map((row: any) => ({
          id: row.interface_id,
          name: [row.interface_reference || row.interface_code, row.name].filter(Boolean).join(' - ') || row.name || row.interface_id,
        })),
        incidents: relations[6].map((row: any) => ({ id: row.incident_id, name: `INC-${row.item_number} · ${row.title}` })),
      },
      incoming_references: incomingReferences,
      attachments,
      edit_lock: editLock,
      workflow,
      latest_approved_workflow: latestApprovedWorkflow,
      integrated_binding: integratedBinding,
      is_managed_integrated_document: !!integratedBinding,
      effective_library_access_level: libraryAccess.effective_access_level,
      can_manage_library: libraryAccess.can_manage,
      can_write: libraryAccess.can_write,
      is_restricted_library: libraryAccess.is_restricted,
      ...validationInfo,
    };
  }

  async share(idOrRef: string, dto: ShareItemDto, tenantId: string, userId: string, opts?: { manager?: EntityManager }) {
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    const manager = this.getManager(opts);
    const id = await this.resolveDocumentId(idOrRef, manager);

    const rows = await manager.query(
      `SELECT id, title, item_number, library_id FROM documents WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Document not found');
    const document = rows[0];
    await this.assertDocumentReadable(id, manager, userId || null);

    // §3.7 point 10: an incident review must not be pushed to someone who could
    // not open DOC-N. Every recipient is checked (library ACL + incidents:reader
    // + row visibility) before anything is queued, and the error never says which
    // recipient failed or anything about the document.
    const incidentBinding = await loadDocumentIncidentBinding(manager, id, tenantId);
    if (incidentBinding) {
      if (rawEmails.length > 0) {
        throw new ForbiddenException('This document cannot be shared outside the application');
      }
      for (const recipientId of userIds) {
        const allowed = await this.canUserOpenDocument(String(recipientId), id, manager, tenantId);
        if (!allowed) {
          throw new ForbiddenException('One of the recipients is not allowed to open this document');
        }
      }
    }

    const senderRows = await manager.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    const senderName = senderRows.length > 0
      ? `${senderRows[0].first_name} ${senderRows[0].last_name}`.trim() || 'Someone'
      : 'Someone';

    const recipientRows = userIds.length > 0
      ? await manager.query(
          `SELECT u.id AS "userId", u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.locale
           FROM users u
           JOIN roles ro ON ro.id = u.role_id
           WHERE u.id = ANY($1) AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [userIds],
        )
      : [];

    if (recipientRows.length > 0 || rawEmails.length > 0) {
      this.notifications.notifyShare({
        itemType: 'document',
        itemId: document.id,
        itemName: document.title || `DOC-${document.item_number}`,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
        manager,
      });
    }
    return { success: true };
  }

  async create(
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager; audit?: KnowledgeAuditOptions },
  ) {
    const manager = this.getManager(opts);

    const title = String(body?.title || '').trim();
    if (!title) {
      throw new BadRequestException('title is required');
    }

    const status = this.normalizeStatus(body?.status, 'draft');
    const summary = body?.summary == null ? null : String(body.summary).trim() || null;

    const requestedLibraryId = body?.library_id ? String(body.library_id) : null;
    const library = requestedLibraryId
      ? await this.ensureLibraryExists(requestedLibraryId, manager)
      : await this.resolveDefaultLibrary(manager);
    await this.assertLibraryWritable(library.id, manager, userId);

    const folderId = body?.folder_id ? String(body.folder_id) : null;
    if (folderId) {
      await this.ensureFolderInLibrary(folderId, library.id, manager);
    }

    const templateDocumentId = body?.template_document_id ? String(body.template_document_id) : null;
    let templateClassifications: Array<{ category_id: string; stream_id: string | null }> = [];
    const hasExplicitDocumentTypeId = Object.prototype.hasOwnProperty.call(body ?? {}, 'document_type_id');
    const templateDocument = templateDocumentId
      ? await this.getTemplateDocumentSummary(templateDocumentId, manager, tenantId, userId)
      : null;

    let contentMarkdown = normalizeMarkdownRichText(body?.content_markdown, { fieldName: 'content_markdown' }) || '';
    if (templateDocument) {
      templateClassifications = await manager.query(
        `SELECT category_id, stream_id
         FROM document_classifications
         WHERE document_id = $1
         ORDER BY created_at ASC`,
        [templateDocumentId],
      );
      if (!String(contentMarkdown || '').trim()) {
        contentMarkdown = templateDocument.content_markdown;
      }
    }

    const documentTypeId = await this.resolveDocumentTypeId(manager, {
      explicitDocumentTypeId: body?.document_type_id,
      hasExplicitDocumentTypeId,
      templateDocument,
    });

    const contentPlain = this.stripMarkdown(contentMarkdown);

    const itemNumber = await this.itemNumbers.nextItemNumber('document', tenantId, manager);

    const repo = manager.getRepository(Document);
    const entity = repo.create({
      tenant_id: tenantId,
      item_number: itemNumber,
      title,
      summary,
      content_markdown: contentMarkdown,
      content_plain: contentPlain,
      folder_id: folderId,
      library_id: library.id,
      document_type_id: documentTypeId,
      template_document_id: templateDocumentId,
      status,
      revision: 1,
      current_version_number: 0,
      published_at: status === 'published' ? new Date() : null,
      last_reviewed_at: body?.last_reviewed_at ? new Date(body.last_reviewed_at) : null,
      review_due_at: body?.review_due_at ? new Date(body.review_due_at) : null,
      created_by: userId,
      updated_by: userId,
    });

    const saved = await repo.save(entity);

    const ownerId = body?.owner_user_id || userId;
    if (!ownerId) {
      throw new BadRequestException('owner_user_id is required');
    }

    await this.bulkReplaceContributors(saved.id, [
      {
        user_id: ownerId,
        role: 'owner',
        is_primary: true,
      },
      ...(Array.isArray(body?.contributors) ? body.contributors : []),
    ], { manager });

    if (Array.isArray(body?.classifications)) {
      await this.bulkReplaceClassifications(saved.id, body.classifications, { manager });
    } else if (templateClassifications.length > 0) {
      await this.bulkReplaceClassifications(saved.id, templateClassifications, { manager });
    }

    await this.applyDocumentRelations(saved.id, body?.relations, manager);

    await this.ensureVersionSnapshot(saved, body?.change_note ? String(body.change_note) : 'Initial version', userId, manager);
    await this.syncReferences(saved.id, saved.content_markdown, manager);
    await this.createSystemActivity(
      saved.id,
      userId,
      'change',
      'Document created',
      manager,
      this.buildDocumentChanges(null, saved, ['title', 'status']),
    );
    await this.auditDocumentChange('create', saved.id, null, saved, userId, manager, opts?.audit);

    return this.get(saved.id, { manager, userId });
  }

  async createManagedDocument(
    body: {
      tenantId: string;
      title: string;
      summary?: string | null;
      content_markdown?: string | null;
      folder_id: string;
      library_id: string;
      document_type_id: string;
      template_document_id?: string | null;
      status?: DocumentStatus;
      relationEntityType?: Extract<RelationEntityType, 'projects' | 'requests' | 'incidents'>;
      relationIds?: string[];
      change_note?: string | null;
      activity_content?: string | null;
    },
    userId: string | null,
    opts?: {
      manager?: EntityManager;
      initializer?: (
        documentId: string,
        manager: EntityManager,
      ) => Promise<{
        title?: string;
        summary?: string | null;
        content_markdown?: string | null;
      } | void>;
    } & DocumentAccessOptions,
  ): Promise<Document> {
    const manager = this.getManager(opts);
    const normalizedUserId = String(userId || '').trim() || null;

    const title = String(body?.title || '').trim();
    if (!title) {
      throw new BadRequestException('title is required');
    }

    const summary = body?.summary == null ? null : String(body.summary).trim() || null;
    const contentMarkdown = normalizeMarkdownRichText(body?.content_markdown, {
      fieldName: 'content_markdown',
    }) || '';
    const status = this.normalizeStatus(body?.status, 'published');

    await this.ensureFolderInLibrary(String(body.folder_id), String(body.library_id), manager);
    await this.ensureDocumentTypeExists(String(body.document_type_id), manager);
    // Provisioning an integrated document is a system operation bounded to the
    // slot: the caller (IntegratedDocumentsService) has already enforced the
    // source entity's own permissions and visibility. Requiring Knowledge write
    // on Managed Docs here would stop an incident reporter from creating an
    // incident at all.
    if (normalizedUserId && !opts?.sourceContext) {
      await this.assertLibraryWritable(String(body.library_id), manager, normalizedUserId);
    }

    const itemNumber = await this.itemNumbers.nextItemNumber('document', body.tenantId, manager);
    const repo = manager.getRepository(Document);
    const entity = repo.create({
      tenant_id: body.tenantId,
      item_number: itemNumber,
      title,
      summary,
      content_markdown: contentMarkdown,
      content_plain: this.stripMarkdown(contentMarkdown),
      folder_id: body.folder_id,
      library_id: body.library_id,
      document_type_id: body.document_type_id,
      template_document_id: body.template_document_id ? String(body.template_document_id) : null,
      status,
      revision: 1,
      current_version_number: 0,
      published_at: status === 'published' ? new Date() : null,
      created_by: userId,
      updated_by: userId,
    });

    let saved = await repo.save(entity);

    if (body.relationEntityType && Array.isArray(body.relationIds) && body.relationIds.length > 0) {
      await this.replaceDocumentRelationsByEntity(saved.id, body.relationEntityType, body.relationIds, manager);
    }

    if (opts?.initializer) {
      const patch = await opts.initializer(saved.id, manager);
      let changed = false;

      if (patch && patch.title !== undefined) {
        const nextTitle = String(patch.title || '').trim();
        if (!nextTitle) {
          throw new BadRequestException('title cannot be empty');
        }
        if (nextTitle !== saved.title) {
          saved.title = nextTitle;
          changed = true;
        }
      }

      if (patch && patch.summary !== undefined) {
        const nextSummary = patch.summary == null ? null : String(patch.summary).trim() || null;
        if (nextSummary !== saved.summary) {
          saved.summary = nextSummary;
          changed = true;
        }
      }

      if (patch && patch.content_markdown !== undefined) {
        const nextContent = normalizeMarkdownRichText(patch.content_markdown, {
          fieldName: 'content_markdown',
        }) || '';
        if (nextContent !== saved.content_markdown) {
          saved.content_markdown = nextContent;
          saved.content_plain = this.stripMarkdown(nextContent);
          changed = true;
        }
      }

      if (changed) {
        saved.updated_by = userId;
        saved.updated_at = new Date();
        saved = await repo.save(saved);
      }
    }

    await this.ensureVersionSnapshot(
      saved,
      body?.change_note == null ? 'Initial version' : String(body.change_note),
      userId,
      manager,
    );
    await this.syncReferences(saved.id, saved.content_markdown, manager);

    await this.createSystemActivity(
      saved.id,
      userId,
      'change',
      body?.activity_content ? String(body.activity_content) : 'Document created',
      manager,
      this.buildDocumentChanges(null, saved, ['title', 'status']),
    );

    await this.auditDocumentChange('create', saved.id, null, saved, userId, manager);

    return saved;
  }

  async updateManagedDocument(
    idOrRef: string,
    body: {
      title?: string;
      summary?: string | null;
      content_markdown?: string | null;
      change_note?: string | null;
      activity_content?: string | null;
      create_version?: boolean;
    },
    userId: string | null,
    opts?: { manager?: EntityManager; systemOperation?: boolean } & DocumentAccessOptions,
  ): Promise<Document> {
    const manager = this.getManager(opts);
    const id = await this.resolveDocumentId(idOrRef, manager);
    const normalizedUserId = String(userId || '').trim() || null;

    const repo = manager.getRepository(Document);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Document not found');
    }
    // §3.7 point 2: a null userId is never an implicit authorization. Either the
    // caller is an authenticated writer (Knowledge or incident source context),
    // or it is an explicit system operation (migration / backfill / title sync).
    if (normalizedUserId || opts?.sourceContext) {
      await this.assertDocumentWritable(existing.id, manager, normalizedUserId, opts);
    } else if (opts?.systemOperation !== true) {
      throw new ForbiddenException('A user or an explicit system operation is required');
    }

    await this.assertWorkflowAllowsEditing(existing.id, manager);

    const before = { ...existing };
    let changed = false;
    let contentChanged = false;

    if (body?.title !== undefined) {
      const title = String(body.title || '').trim();
      if (!title) {
        throw new BadRequestException('title cannot be empty');
      }
      if (title !== existing.title) {
        existing.title = title;
        changed = true;
      }
    }

    if (body?.summary !== undefined) {
      const summary = body.summary == null ? null : String(body.summary).trim() || null;
      if (summary !== existing.summary) {
        existing.summary = summary;
        changed = true;
      }
    }

    if (body?.content_markdown !== undefined) {
      const normalized = normalizeMarkdownRichText(body.content_markdown, {
        fieldName: 'content_markdown',
      }) || '';
      if (normalized !== existing.content_markdown) {
        existing.content_markdown = normalized;
        existing.content_plain = this.stripMarkdown(normalized);
        changed = true;
        contentChanged = true;
      }
    }

    if (!changed) {
      return existing;
    }

    existing.revision = Number(existing.revision) + 1;
    existing.updated_by = userId;
    existing.updated_at = new Date();

    const saved = await repo.save(existing);

    if (contentChanged) {
      await this.syncReferences(saved.id, saved.content_markdown, manager);
    }

    if (body?.create_version !== false) {
      await this.ensureVersionSnapshot(
        saved,
        body?.change_note == null ? null : String(body.change_note),
        userId,
        manager,
      );
    }

    if (body?.activity_content) {
      const changes = this.buildDocumentChanges(before, saved, ['title', 'summary', 'content_markdown']);
      await this.createSystemActivity(
        saved.id,
        userId,
        'change',
        String(body.activity_content),
        manager,
        Object.keys(changes).length > 0 ? changes : null,
      );
    }

    await this.auditDocumentChange('update', saved.id, before, saved, userId, manager);

    return saved;
  }

  async cloneInlineAttachments(
    sourceDocumentId: string,
    targetDocumentId: string,
    attachmentIds: string[] | null | undefined,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<Array<{ sourceAttachmentId: string; clonedAttachmentId: string }>> {
    const manager = this.getManager(opts);

    const targetDocument = await manager.getRepository(Document).findOne({
      where: { id: targetDocumentId },
    });
    if (!targetDocument) {
      throw new NotFoundException('Target document not found');
    }

    const requestedIds = dedupeStrings(Array.isArray(attachmentIds) ? attachmentIds : []);
    const sourceAttachments = requestedIds.length > 0
      ? await manager.query<Array<{
          id: string;
          tenant_id: string;
          original_filename: string;
          mime_type: string | null;
          size: number;
          storage_path: string;
          source_field: string | null;
        }>>(
          `SELECT id,
                  tenant_id,
                  original_filename,
                  mime_type,
                  size,
                  storage_path,
                  source_field
           FROM document_attachments
           WHERE document_id = $1
             AND source_field = 'content_markdown'
             AND id = ANY($2::uuid[])
           ORDER BY uploaded_at ASC`,
          [sourceDocumentId, requestedIds],
        )
      : [];

    if (requestedIds.length !== sourceAttachments.length) {
      throw new NotFoundException('One or more inline attachments were not found on the source document');
    }

    const repo = manager.getRepository(DocumentAttachment);
    const mappings: Array<{ sourceAttachmentId: string; clonedAttachmentId: string }> = [];

    for (const attachment of sourceAttachments) {
      const obj = await this.storage.getObjectStream(attachment.storage_path);
      const ext = path.extname(attachment.original_filename || '') || path.extname(attachment.storage_path || '');
      const clonedAttachmentId = randomUUID();
      const rand = Math.random().toString(36).slice(2, 8);
      const now = new Date();
      const key = [
        'files',
        targetDocument.tenant_id,
        'documents',
        targetDocument.id,
        now.getUTCFullYear().toString(),
        String(now.getUTCMonth() + 1).padStart(2, '0'),
        `${clonedAttachmentId}_${rand}${ext}`,
      ].join('/');

      await this.storage.putObject({
        key,
        body: obj.stream,
        contentType: obj.contentType || attachment.mime_type,
        contentLength: obj.contentLength ?? attachment.size,
        sse: 'AES256',
      });

      const cloned = repo.create({
        id: clonedAttachmentId,
        tenant_id: targetDocument.tenant_id,
        document_id: targetDocument.id,
        original_filename: attachment.original_filename,
        stored_filename: path.basename(key),
        mime_type: attachment.mime_type,
        size: attachment.size,
        storage_path: key,
        source_field: attachment.source_field || 'content_markdown',
        uploaded_by_id: userId,
      });
      const saved = await repo.save(cloned);

      await this.audit.log(
        {
          table: 'document_attachments',
          recordId: saved.id,
          action: 'create',
          before: null,
          after: saved,
          userId,
        },
        { manager },
      );

      mappings.push({
        sourceAttachmentId: attachment.id,
        clonedAttachmentId: saved.id,
      });
    }

    return mappings;
  }

  async deleteManagedDocument(
    idOrRef: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const id = await this.resolveDocumentId(idOrRef, manager);

    const repo = manager.getRepository(Document);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) {
      return;
    }
    const normalizedUserId = String(userId || '').trim() || null;
    if (normalizedUserId) {
      await this.assertDocumentWritable(existing.id, manager, normalizedUserId);
    }

    const attachments = await manager.getRepository(DocumentAttachment).find({
      where: { document_id: id } as any,
    });
    const excludedAttachmentIds = attachments.map((attachment) => attachment.id);

    for (const attachment of attachments) {
      const referencedElsewhere = await this.isStoragePathReferencedElsewhere(
        manager,
        attachment.storage_path,
        excludedAttachmentIds,
      );
      if (!referencedElsewhere) {
        try {
          await this.storage.deleteObject(attachment.storage_path);
        } catch {
          // Keep document deletion resilient even if the object is already missing.
        }
      }
    }

    await repo.delete({ id } as any);

    await this.auditDocumentChange('delete', existing.id, existing, null, userId, manager);
  }

  async update(
    idOrRef: string,
    body: any,
    userId: string,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager; audit?: KnowledgeAuditOptions } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const id = await this.resolveDocumentId(idOrRef, manager);

    const repo = manager.getRepository(Document);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Document not found');
    }
    await this.assertDocumentWritable(existing.id, manager, userId, opts);

    const integratedBinding = await this.getIntegratedBinding(existing.id, manager);
    const isIncidentReview = integratedBinding?.source_entity_type === INCIDENT_REVIEW_SLOT.sourceEntityType
      && integratedBinding.slot_key === INCIDENT_REVIEW_SLOT.slotKey;

    const saveMode = body?.save_mode === 'autosave' ? 'autosave' : 'manual';

    const shouldCheckLock =
      body?.save_mode === 'autosave' ||
      body?.save_mode === 'manual' ||
      body?.content_markdown !== undefined ||
      body?.title !== undefined ||
      body?.summary !== undefined ||
      body?.status !== undefined ||
      body?.folder_id !== undefined ||
      body?.document_type_id !== undefined ||
      body?.template_document_id !== undefined ||
      body?.contributors !== undefined ||
      body?.classifications !== undefined ||
      body?.relations !== undefined ||
      body?.review_due_at !== undefined ||
      body?.last_reviewed_at !== undefined;

    if (shouldCheckLock) {
      await this.assertWorkflowAllowsEditing(existing.id, manager);
      await this.ensureValidLock(existing.id, userId, lockToken, manager);
    }

    const incomingRevision = Number(body?.revision);
    if (!Number.isFinite(incomingRevision)) {
      throw new BadRequestException('revision is required');
    }
    if (incomingRevision !== Number(existing.revision)) {
      throw new ConflictException('Document revision conflict');
    }

    await this.assertIntegratedDocumentUpdateRestrictions(existing, body, manager);

    const before = { ...existing };

    if (body?.title !== undefined) {
      const title = String(body.title || '').trim();
      if (!title) throw new BadRequestException('title cannot be empty');
      existing.title = title;
    }

    if (body?.summary !== undefined) {
      existing.summary = body.summary == null ? null : String(body.summary).trim() || null;
    }

    if (body?.content_markdown !== undefined) {
      const normalized = normalizeMarkdownRichText(body.content_markdown, { fieldName: 'content_markdown' }) || '';
      existing.content_markdown = normalized;
      existing.content_plain = this.stripMarkdown(normalized);
    }

    if (body?.folder_id !== undefined) {
      const nextFolderId = body.folder_id ? String(body.folder_id) : null;
      if (nextFolderId) {
        await this.ensureFolderInLibrary(nextFolderId, existing.library_id, manager);
      }
      existing.folder_id = nextFolderId;
    }

    if (body?.library_id !== undefined && String(body.library_id || '') !== existing.library_id) {
      throw new BadRequestException('library_id cannot be changed on update');
    }

    const hasExplicitDocumentTypeId = Object.prototype.hasOwnProperty.call(body ?? {}, 'document_type_id');
    const hasExplicitTemplateDocumentId = Object.prototype.hasOwnProperty.call(body ?? {}, 'template_document_id');
    const nextTemplateId = hasExplicitTemplateDocumentId
      ? (body?.template_document_id ? String(body.template_document_id) : null)
      : (existing.template_document_id ? String(existing.template_document_id) : null);
    if (integratedBinding) {
      // A managed document cannot change type or template (already refused by
      // assertIntegratedDocumentUpdateRestrictions above), so re-reading the
      // template is pure overhead — and it would refuse the write outright for an
      // incident reporter who has no Knowledge rights on the Templates library.
      existing.template_document_id = nextTemplateId;
    } else {
      const nextTemplateDocument = nextTemplateId
        ? await this.getTemplateDocumentSummary(nextTemplateId, manager, null, userId)
        : null;

      existing.document_type_id = await this.resolveDocumentTypeId(manager, {
        explicitDocumentTypeId: body?.document_type_id,
        hasExplicitDocumentTypeId,
        templateDocument: nextTemplateDocument,
        currentDocumentTypeId: existing.document_type_id ? String(existing.document_type_id) : null,
      });
      existing.template_document_id = nextTemplateId;
    }

    let statusChanged = false;
    if (body?.status !== undefined) {
      const nextStatus = this.normalizeStatus(body.status, (existing.status as DocumentStatus) || 'draft');
      if (nextStatus === 'in_review') {
        throw new BadRequestException('Use the review workflow to move a document into review');
      }
      statusChanged = nextStatus !== existing.status;
      existing.status = nextStatus;
      if (statusChanged && nextStatus === 'published') {
        existing.published_at = new Date();
      }
    }

    if (body?.review_due_at !== undefined) {
      existing.review_due_at = body.review_due_at ? new Date(body.review_due_at) : null;
    }

    if (body?.last_reviewed_at !== undefined) {
      existing.last_reviewed_at = body.last_reviewed_at ? new Date(body.last_reviewed_at) : null;
    }

    existing.revision = Number(existing.revision) + 1;
    existing.updated_by = userId;
    existing.updated_at = new Date();

    const saved = await repo.save(existing);

    // §3.3: for `incidents:review` only, every save that actually changes the
    // content keeps a version — autosave included. `ensureVersionSnapshot`
    // deduplicates identical content, so a no-op save adds nothing, and the
    // policy is applied here (the common document write path) so Knowledge, the
    // integrated routes, import and CSV all follow it. Other document types keep
    // the historical "manual save or status change" behaviour.
    const shouldVersion = saveMode === 'manual' || statusChanged || isIncidentReview;
    if (shouldVersion) {
      await this.ensureVersionSnapshot(saved, body?.change_note ? String(body.change_note) : null, userId, manager);
    }

    if (body?.contributors && Array.isArray(body.contributors)) {
      await this.bulkReplaceContributors(saved.id, body.contributors, { manager });
    }

    if (body?.classifications && Array.isArray(body.classifications)) {
      await this.bulkReplaceClassifications(saved.id, body.classifications, { manager });
    }

    await this.applyDocumentRelations(saved.id, body?.relations, manager);

    await this.syncReferences(saved.id, saved.content_markdown, manager);

    const changes = this.buildDocumentChanges(before, saved, ['title', 'summary', 'status', 'content_markdown']);

    if (Object.keys(changes).length > 0 && (saveMode === 'manual' || statusChanged)) {
      await this.createSystemActivity(
        saved.id,
        userId,
        'change',
        statusChanged ? 'Document status changed' : 'Document updated',
        manager,
        changes,
      );
    }

    await this.auditDocumentChange('update', saved.id, before, saved, userId, manager, opts?.audit);

    if (body?.content_markdown !== undefined && before.content_markdown !== saved.content_markdown) {
      await this.cleanupOrphanedInlineAttachments(saved.id, before.content_markdown, saved.content_markdown, manager);
    }

    return this.get(saved.id, { manager, userId, ...(opts ?? {}) });
  }

  async remove(idOrRef: string, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const id = await this.resolveDocumentId(idOrRef, manager);

    const repo = manager.getRepository(Document);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Document not found');

    await this.assertDocumentWritable(existing.id, manager, userId);
    await this.assertDocumentMoveDeleteAllowed(existing.id, manager);

    await repo.delete({ id } as any);

    await this.auditDocumentChange('delete', id, existing, null, userId, manager);

    return { ok: true };
  }

  private async isStoragePathReferencedElsewhere(
    manager: EntityManager,
    storagePath: string,
    excludedDocumentAttachmentIds: string[] = [],
  ): Promise<boolean> {
    const documentRefs = excludedDocumentAttachmentIds.length > 0
      ? await manager.query<Array<{ exists: number }>>(
          `SELECT 1 AS exists
           FROM document_attachments
           WHERE storage_path = $1
             AND id <> ALL($2::uuid[])
           LIMIT 1`,
          [storagePath, excludedDocumentAttachmentIds],
        )
      : await manager.query<Array<{ exists: number }>>(
          `SELECT 1 AS exists
           FROM document_attachments
           WHERE storage_path = $1
           LIMIT 1`,
          [storagePath],
        );
    if (documentRefs.length > 0) return true;

    const requestRefs = await manager.query<Array<{ exists: number }>>(
      `SELECT 1 AS exists
       FROM portfolio_request_attachments
       WHERE storage_path = $1
       LIMIT 1`,
      [storagePath],
    );
    if (requestRefs.length > 0) return true;

    const projectRefs = await manager.query<Array<{ exists: number }>>(
      `SELECT 1 AS exists
       FROM portfolio_project_attachments
       WHERE storage_path = $1
       LIMIT 1`,
      [storagePath],
    );
    if (projectRefs.length > 0) return true;

    const taskRefs = await manager.query<Array<{ exists: number }>>(
      `SELECT 1 AS exists
       FROM task_attachments
       WHERE storage_path = $1
       LIMIT 1`,
      [storagePath],
    );
    return taskRefs.length > 0;
  }

  async bulkRemove(ids: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = this.getManager(opts);
    const repo = manager.getRepository(Document);
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of uniqueIds) {
      try {
        const found = await withSavepoint(manager, async () => {
          const existing = await repo.findOne({ where: { id } as any });
          if (!existing) return false;
          await this.remove(id, userId, { manager });
          return true;
        });
        if (!found) {
          result.failed.push({ id, name: 'Unknown', reason: 'Not found' });
          continue;
        }
        result.deleted.push(id);
      } catch (e: any) {
        let name = 'Unknown';
        try {
          const existing = await withSavepoint(manager, () => repo.findOne({ where: { id } as any }));
          if (existing) name = existing.title || existing.id;
        } catch (lookupError: any) {
          this.logger.warn(`Failed to load document title for bulk delete error reporting: ${lookupError?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: e?.message || 'Unknown error' });
      }
    }

    return result;
  }

  async move(idOrRef: string, body: any, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const target = this.parseDocumentMoveBody(body);
    const targetLibrary = await this.ensureLibraryExists(target.libraryId, manager);
    if (target.folderId) {
      await this.ensureFolderInLibrary(target.folderId, target.libraryId, manager);
    }

    const saved = await this.moveDocumentRecord(idOrRef, target, targetLibrary, userId, manager);
    return {
      ok: true,
      id: saved.id,
      library_id: saved.library_id,
      folder_id: saved.folder_id,
    };
  }

  async bulkMove(ids: string[], body: any, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (uniqueIds.length === 0) {
      throw new BadRequestException('ids are required');
    }

    return manager.transaction(async (tx) => {
      const target = this.parseDocumentMoveBody(body);
      const targetLibrary = await this.ensureLibraryExists(target.libraryId, tx);
      if (target.folderId) {
        await this.ensureFolderInLibrary(target.folderId, target.libraryId, tx);
      }

      const knowledgeLevel = await this.getKnowledgeLevelForUser(tx, userId);
      const moved: string[] = [];
      for (const id of uniqueIds) {
        const saved = await this.moveDocumentRecord(id, target, targetLibrary, userId, tx, knowledgeLevel);
        moved.push(saved.id);
      }

      return { ok: true, moved };
    });
  }

  async listTypes(opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    await this.getDefaultDocumentType(manager);
    return manager
      .getRepository(DocumentType)
      .createQueryBuilder('t')
      .orderBy('t.is_default', 'DESC')
      .addOrderBy('t.is_system', 'DESC')
      .addOrderBy('t.display_order', 'ASC')
      .addOrderBy('lower(t.name)', 'ASC')
      .getMany();
  }

  async createType(body: any, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const name = String(body?.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    const repo = manager.getRepository(DocumentType);
    const existing = await repo
      .createQueryBuilder('t')
      .where('lower(t.name) = lower(:name)', { name })
      .getOne();
    if (existing) throw new BadRequestException('Document type already exists');

    const entity = repo.create({
      name,
      description: body?.description ? String(body.description).trim() : null,
      template_content: body?.template_content ? String(body.template_content) : null,
      is_active: body?.is_active !== false,
      is_system: false,
      is_default: false,
      display_order: Number.isFinite(Number(body?.display_order)) ? Number(body.display_order) : 0,
    });
    return repo.save(entity);
  }

  async updateType(id: string, body: any, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const repo = manager.getRepository(DocumentType);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Document type not found');

    if (body?.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      if (existing.is_system && name !== existing.name) {
        throw new BadRequestException('System document types cannot be renamed');
      }
      const duplicate = await repo
        .createQueryBuilder('t')
        .where('t.id <> :id', { id })
        .andWhere('lower(t.name) = lower(:name)', { name })
        .getOne();
      if (duplicate) {
        throw new BadRequestException('Document type already exists');
      }
      existing.name = name;
    }
    if (body?.description !== undefined) {
      existing.description = body.description == null ? null : String(body.description).trim() || null;
    }
    if (body?.template_content !== undefined) {
      existing.template_content = body.template_content == null ? null : String(body.template_content);
    }
    if (body?.is_active !== undefined) {
      if (existing.is_default && body.is_active === false) {
        throw new BadRequestException('The default document type must stay active');
      }
      existing.is_active = !!body.is_active;
    }
    if (body?.is_system !== undefined && !!body.is_system !== !!existing.is_system) {
      throw new BadRequestException('is_system cannot be changed');
    }
    if (body?.is_default !== undefined && !!body.is_default !== !!existing.is_default) {
      throw new BadRequestException('is_default cannot be changed');
    }
    if (body?.display_order !== undefined) {
      existing.display_order = Number.isFinite(Number(body.display_order)) ? Number(body.display_order) : 0;
    }
    existing.updated_at = new Date();

    return repo.save(existing);
  }

  async deleteType(id: string, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const type = await manager.getRepository(DocumentType).findOne({ where: { id } as any });
    if (!type) {
      throw new NotFoundException('Document type not found');
    }
    if (type.is_system || type.is_default) {
      throw new BadRequestException('System document types cannot be deleted');
    }

    const refs = await manager
      .getRepository(Document)
      .createQueryBuilder('d')
      .where('d.document_type_id = :id', { id })
      .getCount();

    if (refs > 0) {
      throw new BadRequestException('Cannot delete document type in use');
    }

    await manager.getRepository(DocumentType).delete({ id } as any);
    return { ok: true };
  }

  async listFolderTree(opts?: { manager?: EntityManager; libraryId?: string; userId?: string | null }) {
    const manager = this.getManager(opts);
    const normalizedUserId = String(opts?.userId || '').trim();
    const qb = manager
      .getRepository(DocumentFolder)
      .createQueryBuilder('f')
      .orderBy('f.display_order', 'ASC')
      .addOrderBy('lower(f.name)', 'ASC');
    if (opts?.libraryId) {
      if (normalizedUserId) {
        await this.assertLibraryReadable(opts.libraryId, manager, normalizedUserId);
      }
      qb.where('f.library_id = :libraryId', { libraryId: opts.libraryId });
    } else if (normalizedUserId) {
      const accessibleLibraries = await this.listAccessibleLibraryIds(manager, normalizedUserId, 'reader');
      if (!accessibleLibraries || accessibleLibraries.length === 0) {
        return { items: [] };
      }
      qb.where('f.library_id IN (:...accessibleLibraryIds)', { accessibleLibraryIds: accessibleLibraries });
    }
    const rows = await qb.getMany();

    const byId = new Map<string, any>();
    for (const row of rows) {
      byId.set(row.id, { ...row, children: [] as any[] });
    }

    const roots: any[] = [];
    for (const row of rows) {
      const node = byId.get(row.id);
      if (row.parent_id && byId.has(row.parent_id)) {
        byId.get(row.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return { items: roots };
  }

  async createFolder(body: any, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);
    const name = String(body?.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    const libraryId = String(body?.library_id || '').trim();
    if (!libraryId) throw new BadRequestException('library_id is required');
    await this.ensureLibraryExists(libraryId, manager);
    await this.assertLibraryWritable(libraryId, manager, userId);

    const parentId = body?.parent_id ? String(body.parent_id) : null;
    if (parentId) {
      await this.ensureFolderInLibrary(parentId, libraryId, manager);
    }

    const entity = manager.getRepository(DocumentFolder).create({
      name,
      parent_id: parentId,
      library_id: libraryId,
      display_order: Number.isFinite(Number(body?.display_order)) ? Number(body.display_order) : 0,
      description: body?.description ? String(body.description).trim() : null,
      created_by: userId,
    });

    return manager.getRepository(DocumentFolder).save(entity);
  }

  async updateFolder(id: string, body: any, opts?: { manager?: EntityManager; userId?: string | null }) {
    const manager = this.getManager(opts);
    const repo = manager.getRepository(DocumentFolder);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Folder not found');
    this.assertManagedFolderWritable(existing);
    await this.assertLibraryWritable(existing.library_id, manager, opts?.userId || null);

    if (body?.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      existing.name = name;
    }
    if (body?.description !== undefined) {
      existing.description = body.description == null ? null : String(body.description).trim() || null;
    }
    if (body?.display_order !== undefined) {
      existing.display_order = Number.isFinite(Number(body.display_order)) ? Number(body.display_order) : 0;
    }
    existing.updated_at = new Date();

    return repo.save(existing);
  }

  async moveFolder(id: string, body: any, userId: string | null, opts?: { manager?: EntityManager }) {
    const manager = this.getManager(opts);

    return manager.transaction(async (tx) => {
      const repo = tx.getRepository(DocumentFolder);
      const existing = await repo.findOne({ where: { id } });
      if (!existing) throw new NotFoundException('Folder not found');
      this.assertManagedFolderWritable(existing);
      await this.assertLibraryWritable(existing.library_id, tx, userId);

      const target = this.parseFolderMoveBody(body, existing.library_id);
      const targetLibrary = await this.ensureLibraryExists(target.libraryId, tx);
      await this.assertLibraryWritable(target.libraryId, tx, userId);
      const nextParentId = target.parentId;
      const crossLibraryMove = existing.library_id !== target.libraryId;
      const knowledgeLevel = crossLibraryMove ? await this.getKnowledgeLevelForUser(tx, userId) : null;

      if (nextParentId === id) {
        throw new BadRequestException('A folder cannot be its own parent');
      }

      if (nextParentId) {
        const checkRows = await tx.query(
          `WITH RECURSIVE descendants AS (
             SELECT id, parent_id
             FROM document_folders
             WHERE id = $1
             UNION ALL
             SELECT f.id, f.parent_id
             FROM document_folders f
             JOIN descendants d ON f.parent_id = d.id
           )
           SELECT 1
           FROM descendants
           WHERE id = $2
           LIMIT 1`,
          [id, nextParentId],
        );
        if (checkRows.length > 0) {
          throw new BadRequestException('Cannot move folder into one of its descendants');
        }

        const parent = await repo.findOne({ where: { id: nextParentId } });
        if (!parent) throw new BadRequestException('parent folder not found');
        if (parent.library_id !== target.libraryId) {
          throw new BadRequestException(crossLibraryMove
            ? 'parent folder must be in the target library'
            : 'parent folder must be in the same library');
        }
      }

      if (crossLibraryMove) {
        if (!this.hasPermissionLevel(knowledgeLevel || undefined, 'admin')) {
          throw new ForbiddenException('Only knowledge admins can move folders between libraries');
        }
        await this.assertTemplateFolderMoveAllowed(existing.library_id, targetLibrary, tx);
      }

      if (!crossLibraryMove) {
        existing.parent_id = nextParentId;
        if (body?.display_order !== undefined) {
          existing.display_order = Number.isFinite(Number(body.display_order)) ? Number(body.display_order) : 0;
        }
        existing.updated_at = new Date();
        return repo.save(existing);
      }

      const sourceLibrary = await this.ensureLibraryExists(existing.library_id, tx);
      const subtreeFolderIds = await this.listFolderSubtreeIds(tx, id);
      const movedRootName = await this.resolveMovedFolderName(
        tx,
        target.libraryId,
        nextParentId,
        existing.name,
        sourceLibrary.name,
      );

      const documentsInSubtree = await tx.getRepository(Document).find({
        select: { id: true, folder_id: true } as any,
        where: { folder_id: In(subtreeFolderIds) } as any,
      });

      for (const document of documentsInSubtree) {
        await this.moveDocumentRecord(
          document.id,
          {
            libraryId: target.libraryId,
            folderId: document.folder_id ? String(document.folder_id) : null,
          },
          targetLibrary,
          userId,
          tx,
          knowledgeLevel,
        );
      }

      const now = new Date();
      const descendantIds = subtreeFolderIds.filter((folderId) => folderId !== id);
      if (descendantIds.length > 0) {
        await tx.getRepository(DocumentFolder)
          .createQueryBuilder()
          .update(DocumentFolder)
          .set({
            library_id: target.libraryId,
            updated_at: now,
          } as any)
          .where({ id: In(descendantIds) } as any)
          .execute();
      }

      existing.library_id = target.libraryId;
      existing.parent_id = nextParentId;
      existing.name = movedRootName;
      if (body?.display_order !== undefined) {
        existing.display_order = Number.isFinite(Number(body.display_order)) ? Number(body.display_order) : 0;
      }
      existing.updated_at = now;
      return repo.save(existing);
    });
  }

  async deleteFolder(id: string, opts?: { manager?: EntityManager; userId?: string | null }) {
    const manager = this.getManager(opts);
    const repo = manager.getRepository(DocumentFolder);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Folder not found');
    this.assertManagedFolderWritable(existing);
    await this.assertLibraryWritable(existing.library_id, manager, opts?.userId || null);

    const [children, docs] = await Promise.all([
      repo.count({ where: { parent_id: id } as any }),
      manager.getRepository(Document).count({ where: { folder_id: id } as any }),
    ]);

    if (children > 0) throw new BadRequestException('Cannot delete folder with child folders');
    if (docs > 0) {
      await manager
        .getRepository(Document)
        .createQueryBuilder()
        .update(Document)
        .set({ folder_id: null } as any)
        .where('folder_id = :id', { id })
        .execute();
    }

    await repo.delete({ id } as any);
    return { ok: true, moved_documents_to_unfiled: docs };
  }

  async listFolderDocuments(folderId: string, query: any, opts?: { manager?: EntityManager; userId?: string | null }) {
    return this.list({ ...query, folder_id: folderId }, opts);
  }

  async acquireLock(idOrRef: string, userId: string, opts?: { manager?: EntityManager } & DocumentAccessOptions) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    // Write gate: acquiring an edit lock on a closed/cancelled incident review is refused.
    await this.assertDocumentWritable(documentId, manager, userId, opts);
    await this.assertWorkflowAllowsEditing(documentId, manager);

    const repo = manager.getRepository(DocumentEditLock);
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const expiresAt = new Date(nowMs + LOCK_TTL_SECONDS * 1000);
    const token = randomUUID();
    const tokenHash = hashLockToken(token);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rows = await manager.query<Array<{ holder_user_id: string }>>(
        `INSERT INTO document_edit_locks (
           tenant_id,
           document_id,
           holder_user_id,
           lock_token_hash,
           acquired_at,
           heartbeat_at,
           expires_at
         )
         VALUES (app_current_tenant(), $1, $2, $3, $4, $4, $5)
         ON CONFLICT (tenant_id, document_id) DO UPDATE
         SET holder_user_id = EXCLUDED.holder_user_id,
             lock_token_hash = EXCLUDED.lock_token_hash,
             acquired_at = EXCLUDED.acquired_at,
             heartbeat_at = EXCLUDED.heartbeat_at,
             expires_at = EXCLUDED.expires_at
         WHERE document_edit_locks.holder_user_id = EXCLUDED.holder_user_id
            OR document_edit_locks.expires_at <= EXCLUDED.acquired_at
         RETURNING holder_user_id`,
        [documentId, userId, tokenHash, now, expiresAt],
      );

      if (rows.length > 0) {
        return {
          lock_token: token,
          expires_at: expiresAt,
          holder_user_id: userId,
        };
      }

      const lock = await repo.findOne({ where: { document_id: documentId } as any });
      if (lock && new Date(lock.expires_at).getTime() > nowMs && lock.holder_user_id !== userId) {
        throw new HttpException({
          message: 'Document is already locked by another user',
          lock: {
            holder_user_id: lock.holder_user_id,
            holder_name: await this.getUserDisplayName(lock.holder_user_id, manager),
            acquired_at: lock.acquired_at,
            heartbeat_at: lock.heartbeat_at,
            expires_at: lock.expires_at,
          },
        }, 423);
      }
    }

    throw new ConflictException('Failed to acquire document lock');
  }

  async heartbeatLock(
    idOrRef: string,
    userId: string,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    // Heartbeat keeps an editing session alive, so it follows the write rules too.
    await this.assertDocumentWritable(documentId, manager, userId, opts);
    const repo = manager.getRepository(DocumentEditLock);

    const lock = await this.ensureValidLock(documentId, userId, lockToken, manager);

    lock.heartbeat_at = new Date();
    lock.expires_at = new Date(Date.now() + LOCK_TTL_SECONDS * 1000);
    await repo.save(lock);

    return { ok: true, expires_at: lock.expires_at };
  }

  async releaseLock(
    idOrRef: string,
    userId: string,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    // Releasing one's own lock is not a document mutation: it must stay possible
    // after the incident was closed, so this is a read gate plus the token check
    // in ensureValidLock (holder + matching token).
    await this.assertDocumentReadable(documentId, manager, userId, opts);
    const lock = await this.ensureValidLock(documentId, userId, lockToken, manager);
    await manager.getRepository(DocumentEditLock).delete({ id: lock.id } as any);
    return { ok: true };
  }

  /**
   * Administrative unlock. On an incident review it additionally requires
   * `incidents:admin` — a Knowledge admin is not a registry admin.
   */
  async forceReleaseLock(
    idOrRef: string,
    opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentReadable(documentId, manager, opts?.userId || null, opts);
    const binding = await loadDocumentIncidentBinding(manager, documentId, opts?.tenantId ?? null);
    if (binding) {
      const viewer = await resolveDocumentIncidentViewer(
        manager,
        opts?.sourceContext?.userId ?? opts?.userId ?? null,
        opts?.tenantId ?? binding.tenant_id,
      );
      if (!viewer.isAdmin) {
        throw new ForbiddenException('incidents:admin permission is required');
      }
    }
    await manager.getRepository(DocumentEditLock).delete({ document_id: documentId } as any);
    return { ok: true };
  }

  async listVersions(idOrRef: string, opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentReadable(documentId, manager, opts?.userId || null, opts);
    return manager
      .getRepository(DocumentVersion)
      .createQueryBuilder('v')
      .where('v.document_id = :documentId', { documentId })
      .orderBy('v.version_number', 'DESC')
      .getMany();
  }

  async createVersion(
    idOrRef: string,
    body: { change_note?: string | null } | null | undefined,
    userId: string,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentWritable(documentId, manager, userId, opts);
    await this.assertWorkflowAllowsEditing(documentId, manager);
    await this.ensureValidLock(documentId, userId, lockToken, manager);

    const document = await manager.getRepository(Document).findOne({ where: { id: documentId } as any });
    if (!document) throw new NotFoundException('Document not found');

    const result = await this.ensureVersionSnapshot(
      document,
      body?.change_note == null ? null : String(body.change_note),
      userId,
      manager,
    );

    if (result.created) {
      await this.createSystemActivity(
        documentId,
        userId,
        'change',
        `Version ${result.version.version_number} created`,
        manager,
      );
    }

    return {
      created: result.created,
      version: result.version,
      document: await this.get(documentId, { manager, userId, ...(opts ?? {}) }),
    };
  }

  async getVersion(
    idOrRef: string,
    versionNumber: number,
    opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentReadable(documentId, manager, opts?.userId || null, opts);
    const version = await manager
      .getRepository(DocumentVersion)
      .findOne({ where: { document_id: documentId, version_number: versionNumber } as any });
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  async compareVersions(
    idOrRef: string,
    fromVersion: number,
    toVersion: number,
    opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const [from, to] = await Promise.all([
      this.getVersion(idOrRef, fromVersion, { ...(opts ?? {}), manager, userId: opts?.userId || null }),
      this.getVersion(idOrRef, toVersion, { ...(opts ?? {}), manager, userId: opts?.userId || null }),
    ]);

    return {
      from,
      to,
      changed: {
        title: from.title !== to.title,
        summary: from.summary !== to.summary,
        content_markdown: from.content_markdown !== to.content_markdown,
      },
    };
  }

  async revert(
    idOrRef: string,
    versionNumber: number,
    userId: string,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentWritable(documentId, manager, userId, opts);
    await this.assertWorkflowAllowsEditing(documentId, manager);

    const doc = await manager.getRepository(Document).findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');

    await this.ensureValidLock(documentId, userId, lockToken, manager);

    const version = await manager
      .getRepository(DocumentVersion)
      .findOne({ where: { document_id: documentId, version_number: versionNumber } as any });
    if (!version) throw new NotFoundException('Version not found');

    doc.title = version.title;
    doc.summary = version.summary;
    doc.content_markdown = version.content_markdown;
    doc.content_plain = version.content_plain;
    doc.revision = Number(doc.revision) + 1;
    doc.updated_by = userId;
    doc.updated_at = new Date();

    const saved = await manager.getRepository(Document).save(doc);

    await this.ensureVersionSnapshot(saved, `Revert to version ${versionNumber}`, userId, manager);
    await this.syncReferences(saved.id, saved.content_markdown, manager);

    await manager.getRepository(DocumentActivity).save(
      manager.getRepository(DocumentActivity).create({
        document_id: saved.id,
        author_id: userId,
        type: 'change',
        content: `Reverted to version ${versionNumber}`,
        changed_fields: {
          revision: [saved.revision - 1, saved.revision],
        },
      }),
    );

    return this.get(saved.id, { manager, userId, ...(opts ?? {}) });
  }

  async bulkReplaceContributors(
    idOrRef: string,
    contributors: any[],
    opts?: { manager?: EntityManager; userId?: string | null; guardAgainstActiveLock?: boolean },
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    const normalizedUserId = opts?.userId === undefined ? undefined : (opts.userId || null);
    if (normalizedUserId !== undefined) {
      await this.assertDocumentWritable(documentId, manager, normalizedUserId);
    }
    if (opts?.guardAgainstActiveLock) {
      await this.assertWorkflowAllowsEditing(documentId, manager);
      await this.assertDocumentUnlockedForUser(documentId, opts.userId || null, manager);
    }

    const normalized = Array.isArray(contributors) ? contributors : [];
    if (!normalized.length) {
      throw new BadRequestException('At least one contributor is required');
    }

    const rows = normalized
      .map((entry) => ({
        user_id: String(entry?.user_id || '').trim(),
        role: String(entry?.role || '').trim().toLowerCase() || 'author',
        is_primary: !!entry?.is_primary,
      }))
      .filter((entry) => !!entry.user_id);

    if (!rows.length) {
      throw new BadRequestException('At least one valid contributor is required');
    }

    const ownerCount = rows.filter((entry) => entry.role === 'owner').length;
    if (ownerCount === 0) {
      rows[0].role = 'owner';
      rows[0].is_primary = true;
    }

    if (!rows.some((entry) => entry.is_primary)) {
      rows[0].is_primary = true;
    }

    const uniqueRows: Array<{ user_id: string; role: string; is_primary: boolean }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!DOCUMENT_CONTRIBUTOR_ROLES.has(row.role)) {
        throw new BadRequestException(`Invalid contributor role: ${row.role}`);
      }
      const key = `${row.user_id}|${row.role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueRows.push(row);
    }

    await this.assertTenantScopedIdsExist(
      manager,
      'users',
      uniqueRows.map((row) => row.user_id),
      'contributors',
    );

    const repo = manager.getRepository(DocumentContributor);
    await repo.delete({ document_id: documentId } as any);

    for (const row of uniqueRows) {
      const entity = repo.create({
        document_id: documentId,
        user_id: row.user_id,
        role: row.role,
        is_primary: row.is_primary,
      });
      await repo.save(entity);
    }

    return { ok: true };
  }

  async bulkReplaceClassifications(
    idOrRef: string,
    classifications: any[],
    opts?: { manager?: EntityManager; userId?: string | null; guardAgainstActiveLock?: boolean },
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    const normalizedUserId = opts?.userId === undefined ? undefined : (opts.userId || null);
    if (normalizedUserId !== undefined) {
      await this.assertDocumentWritable(documentId, manager, normalizedUserId);
    }
    if (opts?.guardAgainstActiveLock) {
      await this.assertWorkflowAllowsEditing(documentId, manager);
      await this.assertDocumentUnlockedForUser(documentId, opts.userId || null, manager);
    }

    const rows = Array.isArray(classifications)
      ? classifications
          .map((entry) => ({
            category_id: String(entry?.category_id || '').trim(),
            stream_id: entry?.stream_id ? String(entry.stream_id).trim() : null,
          }))
          .filter((entry) => !!entry.category_id)
      : [];

    const uniqueRows: Array<{ category_id: string; stream_id: string | null }> = [];
    const seen = new Set<string>();

    await this.assertTenantScopedIdsExist(
      manager,
      'portfolio_categories',
      rows.map((row) => row.category_id),
      'classification categories',
    );

    for (const row of rows) {
      const key = `${row.category_id}|${row.stream_id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (row.stream_id) {
        const streamRows = await manager.query(
          `SELECT 1
           FROM portfolio_streams
           WHERE id = $1
             AND tenant_id = app_current_tenant()
             AND category_id = $2
           LIMIT 1`,
          [row.stream_id, row.category_id],
        );
        if (!streamRows.length) {
          throw new BadRequestException('Invalid classification: stream does not belong to category');
        }
      }

      uniqueRows.push(row);
    }

    const repo = manager.getRepository(DocumentClassification);
    await repo.delete({ document_id: documentId } as any);

    for (const row of uniqueRows) {
      const entity = repo.create({
        document_id: documentId,
        category_id: row.category_id,
        stream_id: row.stream_id,
      });
      await repo.save(entity);
    }

    return { ok: true };
  }

  async replaceDocumentRelationsByEntity(
    documentId: string,
    entity: RelationEntityType,
    ids: string[],
    manager: EntityManager,
  ) {
    const map = RELATION_TABLE_MAP[entity];
    if (!map) throw new BadRequestException('Unsupported relation entity');

    const values = dedupeStrings(Array.isArray(ids) ? ids : []);

    await this.assertTenantScopedIdsExist(manager, map.targetTable as any, values, `related ${map.label}`);

    await manager.query(`DELETE FROM ${map.table} WHERE document_id = $1`, [documentId]);
    if (values.length > 0) {
      await manager.query(
        `INSERT INTO ${map.table} (tenant_id, document_id, ${map.idColumn})
         SELECT app_current_tenant(), $1, value
         FROM unnest($2::uuid[]) AS value
         ON CONFLICT DO NOTHING`,
        [documentId, values],
      );
    }

    return { ok: true, count: values.length };
  }

  async addDocumentRelationByEntity(
    documentId: string,
    entity: RelationEntityType,
    targetId: string,
    manager: EntityManager,
  ) {
    const map = RELATION_TABLE_MAP[entity];
    if (!map) throw new BadRequestException('Unsupported relation entity');

    const normalizedTargetId = String(targetId || '').trim();
    if (!normalizedTargetId) {
      throw new BadRequestException(`${map.idColumn} is required`);
    }

    await this.assertTenantScopedIdsExist(manager, map.targetTable as any, [normalizedTargetId], `related ${map.label}`);
    await manager.query(
      `INSERT INTO ${map.table} (tenant_id, document_id, ${map.idColumn})
       VALUES (app_current_tenant(), $1, $2)
       ON CONFLICT DO NOTHING`,
      [documentId, normalizedTargetId],
    );

    return { ok: true };
  }

  async removeDocumentRelationByEntity(
    documentId: string,
    entity: RelationEntityType,
    targetId: string,
    manager: EntityManager,
  ) {
    const map = RELATION_TABLE_MAP[entity];
    if (!map) throw new BadRequestException('Unsupported relation entity');

    const normalizedTargetId = String(targetId || '').trim();
    if (!normalizedTargetId) {
      throw new BadRequestException(`${map.idColumn} is required`);
    }

    await manager.query(
      `DELETE FROM ${map.table}
       WHERE document_id = $1
         AND ${map.idColumn} = $2`,
      [documentId, normalizedTargetId],
    );

    return { ok: true };
  }

  async listIncomingReferences(
    idOrRef: string,
    opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentReadable(documentId, manager, opts?.userId || null, opts);

    // Source documents are filtered on their own rights (library ACL + incidents).
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return [];
    }
    const viewer = await resolveDocumentIncidentViewer(manager, opts?.userId || null, opts?.tenantId ?? null);
    const params: unknown[] = [documentId];
    let libraryClause = '';
    if (accessibleLibraries) {
      params.push(accessibleLibraries);
      libraryClause = ` AND d.library_id = ANY($${params.length}::uuid[])`;
    }
    const incidentClause = documentIncidentVisibilitySql('d', viewer, params);

    return manager.query(
      `SELECT r.id,
              r.source_document_id,
              d.item_number AS source_item_number,
              d.title AS source_title,
              d.status AS source_status,
              d.updated_at AS source_updated_at
       FROM document_references r
       JOIN documents d ON d.id = r.source_document_id AND d.tenant_id = r.tenant_id
       WHERE r.target_document_id = $1
         ${libraryClause}
         ${incidentClause}
       ORDER BY d.updated_at DESC`,
      params,
    );
  }

  async listActivities(idOrRef: string, opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentReadable(documentId, manager, opts?.userId || null, opts);

    return manager.query(
      `SELECT a.*,
              COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, a.author_id::text) AS author_name
       FROM document_activities a
       LEFT JOIN users u ON u.id = a.author_id AND u.tenant_id = a.tenant_id
       WHERE a.document_id = $1
       ORDER BY a.created_at DESC`,
      [documentId],
    );
  }

  async createActivity(
    idOrRef: string,
    body: any,
    userId: string | null,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentWritable(documentId, manager, userId, opts);

    const type = String(body?.type || 'comment').trim().toLowerCase();
    if (type !== 'comment') {
      throw new BadRequestException('Only comments can be created via this endpoint');
    }

    const content = normalizeMarkdownRichText(body?.content, { fieldName: 'content' });

    const activity = manager.getRepository(DocumentActivity).create({
      document_id: documentId,
      author_id: userId,
      type,
      content,
      changed_fields: body?.changed_fields && typeof body.changed_fields === 'object' ? body.changed_fields : null,
    });

    return manager.getRepository(DocumentActivity).save(activity);
  }

  async updateActivity(
    idOrRef: string,
    activityId: string,
    body: any,
    userId: string,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentWritable(documentId, manager, userId, opts);

    const repo = manager.getRepository(DocumentActivity);
    const existing = await repo.findOne({ where: { id: activityId, document_id: documentId } as any });
    if (!existing) throw new NotFoundException('Activity not found');

    if (existing.author_id !== userId) {
      throw new HttpException('Only the author can edit this comment', 403);
    }
    if (existing.type !== 'comment') {
      throw new BadRequestException('Only comments can be edited via this endpoint');
    }

    existing.content = normalizeMarkdownRichText(body?.content, { fieldName: 'content' });
    existing.updated_at = new Date();
    return repo.save(existing);
  }

  async search(query: any, opts?: { manager?: EntityManager; userId?: string | null; tenantId?: string | null }) {
    const manager = this.getManager(opts);
    const search = this.getDocumentSearchState(query?.q);
    if (!search) throw new BadRequestException('q is required');
    const incidentViewer = await resolveDocumentIncidentViewer(manager, opts?.userId || null, opts?.tenantId ?? null);

    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 200);
    const offset = Math.min(Math.max(Number(query?.offset) || 0, 0), 5000);
    const libraryId = query?.library_id ? String(query.library_id) : null;
    // Optional allow-list of library ids (agent "restrict to specific libraries"). Kept
    // intersected with the caller's accessible libraries below — never substituted for it.
    const libraryIds = Array.isArray(query?.library_ids)
      ? query.library_ids.map((value: unknown) => String(value)).filter((value: string) => value.length > 0)
      : null;
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return { items: [], total: 0, offset, limit, truncated: false };
    }

    const matchMode = query?.matchMode === 'any' ? 'any' : 'and';
    const tsQueryTerm = matchMode === 'any' ? normalizeDocumentAnyTermQuery(search.term) : search.term;
    const params: Array<string | number | string[]> = [tsQueryTerm, `%${search.term}%`];
    const tsQuerySql = matchMode === 'any'
      ? bilingualDocumentTsQueryAnyTermSql('$1')
      : bilingualDocumentTsQuerySql('$1');
    const rankSql = `ts_rank_cd(d.search_vector, ${tsQuerySql})`;
    // No content_markdown ILIKE here: it forces a seq scan over the largest
    // column and content_plain carries the same visible text.
    const searchClauses = [
      matchMode === 'any'
        ? `(d.search_vector @@ ${tsQuerySql} AND ${rankSql} > 0)`
        : `d.search_vector @@ ${tsQuerySql}`,
      `d.title ILIKE $2`,
      `COALESCE(d.summary, '') ILIKE $2`,
      `COALESCE(d.content_plain, '') ILIKE $2`,
    ];
    if (search.itemNumber != null) {
      params.push(search.itemNumber);
      searchClauses.unshift(`d.item_number = $${params.length}`);
    }
    const whereClauses = [`(${searchClauses.join(' OR ')})`];
    if (libraryId) {
      params.push(libraryId);
      whereClauses.push(`d.library_id = $${params.length}`);
    }
    if (libraryIds && libraryIds.length > 0) {
      params.push(libraryIds);
      whereClauses.push(`d.library_id = ANY($${params.length}::uuid[])`);
    }
    if (accessibleLibraries) {
      params.push(accessibleLibraries);
      whereClauses.push(`d.library_id = ANY($${params.length}::uuid[])`);
    }
    whereClauses.push(documentIncidentVisibilitySql('d', incidentViewer, params).replace(/^\s*AND\s/, ''));
    params.push(limit);
    params.push(offset);

    let rows = await manager.query(
      `SELECT d.id,
              d.item_number,
              d.title,
              d.summary,
              d.status,
              d.updated_at,
              d.folder_id,
              d.document_type_id,
              d.library_id,
              dl.name AS library_name,
              CASE WHEN d.title ILIKE $2 THEN 1 ELSE 0 END AS title_match,
              COUNT(*) OVER()::int AS total_count,
              ${rankSql} AS rank,
              ts_headline('kanap_fr', coalesce(d.content_plain, ''), ${tsQuerySql},
                'MaxFragments=2, MinWords=8, MaxWords=20') AS snippet
       FROM documents d
       LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY title_match DESC, rank DESC, d.title ASC, d.updated_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    if (rows.length === 0) {
      const fallbackTerms = this.getDocumentSearchFallbackTerms(search.term);
      if (fallbackTerms.length > 0) {
        const fallbackParams: Array<string | number | string[]> = [];
        const fallbackClauses: string[] = [];
        for (const term of fallbackTerms) {
          fallbackParams.push(`%${term}%`);
          const index = fallbackParams.length;
          fallbackClauses.push(
            `d.title ILIKE $${index}`,
            `COALESCE(d.summary, '') ILIKE $${index}`,
            `COALESCE(d.content_plain, '') ILIKE $${index}`,
          );
        }
        if (search.itemNumber != null) {
          fallbackParams.push(search.itemNumber);
          fallbackClauses.unshift(`d.item_number = $${fallbackParams.length}`);
        }
        const fallbackWhereClauses = [`(${fallbackClauses.join(' OR ')})`];
        if (libraryId) {
          fallbackParams.push(libraryId);
          fallbackWhereClauses.push(`d.library_id = $${fallbackParams.length}`);
        }
        if (libraryIds && libraryIds.length > 0) {
          fallbackParams.push(libraryIds);
          fallbackWhereClauses.push(`d.library_id = ANY($${fallbackParams.length}::uuid[])`);
        }
        if (accessibleLibraries) {
          fallbackParams.push(accessibleLibraries);
          fallbackWhereClauses.push(`d.library_id = ANY($${fallbackParams.length}::uuid[])`);
        }
        fallbackWhereClauses.push(
          documentIncidentVisibilitySql('d', incidentViewer, fallbackParams).replace(/^\s*AND\s/, ''),
        );
        fallbackParams.push(limit);
        fallbackParams.push(offset);
        rows = await manager.query(
          `SELECT d.id,
                  d.item_number,
                  d.title,
                  d.summary,
                  d.status,
                  d.updated_at,
                  d.folder_id,
                  d.document_type_id,
                  d.library_id,
                  dl.name AS library_name,
                  0 AS title_match,
                  COUNT(*) OVER()::int AS total_count,
                  0 AS rank,
                  NULL AS snippet
           FROM documents d
           LEFT JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
           WHERE ${fallbackWhereClauses.join(' AND ')}
           ORDER BY d.title ASC, d.updated_at DESC
           LIMIT $${fallbackParams.length - 1}
           OFFSET $${fallbackParams.length}`,
          fallbackParams,
        );
      }
    }

    const total = rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0;

    return {
      items: rows.map((row: any) => ({
        ...row,
        item_ref: `DOC-${row.item_number}`,
        score: Number(row.rank ?? row.score ?? 0),
      })),
      total,
      offset,
      limit,
      truncated: offset + rows.length < total,
    };
  }

  async searchMentionOptions(query: any, opts?: { manager?: EntityManager; userId?: string | null; tenantId?: string | null }) {
    const manager = this.getManager(opts);
    const rawSearch = String(query?.q || '').trim();
    const itemNumber = rawSearch ? this.parseItemNumberQuery(rawSearch) : null;
    const itemNumberPrefix = rawSearch ? this.parseItemNumberPrefixQuery(rawSearch) : null;
    const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return { items: [], total: 0, limit };
    }

    const whereClauses = ['d.tenant_id = app_current_tenant()'];
    const params: Array<string | number | string[]> = [];
    if (accessibleLibraries) {
      params.push(accessibleLibraries);
      whereClauses.push(`d.library_id = ANY($${params.length}::uuid[])`);
    }
    whereClauses.push(
      documentIncidentVisibilitySql(
        'd',
        await resolveDocumentIncidentViewer(manager, opts?.userId || null, opts?.tenantId ?? null),
        params,
      ).replace(/^\s*AND\s/, ''),
    );

    let exactIndex: number | null = null;
    let prefixIndex: number | null = null;
    let likeIndex: number | null = null;
    if (rawSearch) {
      const searchClauses: string[] = [];
      if (itemNumber != null) {
        params.push(itemNumber);
        exactIndex = params.length;
        searchClauses.push(`d.item_number = $${exactIndex}`);
      }
      if (itemNumberPrefix) {
        params.push(itemNumberPrefix);
        prefixIndex = params.length;
        searchClauses.push(`d.item_number::text LIKE $${prefixIndex} || '%'`);
      }
      params.push(`%${rawSearch}%`);
      likeIndex = params.length;
      searchClauses.push(
        `d.title ILIKE $${likeIndex}`,
        `('DOC-' || d.item_number::text) ILIKE $${likeIndex}`,
        `COALESCE(d.summary, '') ILIKE $${likeIndex}`,
        `COALESCE(d.content_plain, '') ILIKE $${likeIndex}`,
        `COALESCE(d.content_markdown, '') ILIKE $${likeIndex}`,
      );
      whereClauses.push(`(${searchClauses.join(' OR ')})`);
    }

    const exactScoreSql = exactIndex ? `WHEN d.item_number = $${exactIndex} THEN 4` : '';
    const prefixScoreSql = prefixIndex ? `WHEN d.item_number::text LIKE $${prefixIndex} || '%' THEN 3.5` : '';
    const titleScoreSql = likeIndex ? `WHEN d.title ILIKE $${likeIndex} THEN 3` : '';
    const scoreCases = [exactScoreSql, prefixScoreSql, titleScoreSql].filter(Boolean).join('\n                ');
    const scoreSql = scoreCases
      ? `CASE
                ${scoreCases}
                ELSE 1
              END`
      : '1';
    const prefixSortSql = prefixIndex
      ? `CASE WHEN d.item_number::text LIKE $${prefixIndex} || '%' THEN d.item_number ELSE NULL END ASC NULLS LAST,`
      : '';

    params.push(limit);
    const limitIndex = params.length;
    const rows = await manager.query(
      `SELECT d.id,
              d.item_number,
              'DOC-' || d.item_number::text AS item_ref,
              d.title,
              d.summary,
              d.status,
              d.updated_at,
              COUNT(*) OVER()::int AS total_count,
              ${scoreSql} AS score
       FROM documents d
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY score DESC,
                ${prefixSortSql}
                d.updated_at DESC,
                d.item_number DESC
       LIMIT $${limitIndex}`,
      params,
    );
    const total = rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0;

    return {
      items: rows.map((row: any) => ({
        id: row.id,
        item_number: Number(row.item_number),
        item_ref: row.item_ref || `DOC-${row.item_number}`,
        title: row.title,
        summary: row.summary ?? null,
        status: row.status,
        updated_at: row.updated_at,
      })),
      total,
      limit,
    };
  }

  async listLinkOptions(query: any, opts?: { manager?: EntityManager; userId?: string | null; tenantId?: string | null }) {
    const manager = this.getManager(opts);
    const page = Math.max(1, parseInt(query?.page ?? '1', 10) || 1);
    const limit = Math.min(Math.max(parseInt(query?.limit ?? '100', 10) || 100, 1), 200);
    const offset = (page - 1) * limit;
    const rawSearch = String(query?.q || '').trim();
    const itemNumber = rawSearch ? this.parseItemNumberQuery(rawSearch) : null;
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return { items: [], total: 0, page, limit };
    }

    const whereClauses = ['d.tenant_id = app_current_tenant()'];
    const params: Array<string | number | string[]> = [];
    if (accessibleLibraries) {
      params.push(accessibleLibraries);
      whereClauses.push(`d.library_id = ANY($${params.length}::uuid[])`);
    }
    whereClauses.push(
      documentIncidentVisibilitySql(
        'd',
        await resolveDocumentIncidentViewer(manager, opts?.userId || null, opts?.tenantId ?? null),
        params,
      ).replace(/^\s*AND\s/, ''),
    );

    if (rawSearch) {
      params.push(`%${rawSearch}%`);
      const likeIndex = params.length;
      const searchClauses = [
        `d.title ILIKE $${likeIndex}`,
        `('DOC-' || d.item_number::text) ILIKE $${likeIndex}`,
        `COALESCE(d.summary, '') ILIKE $${likeIndex}`,
        `COALESCE(d.content_plain, '') ILIKE $${likeIndex}`,
        `COALESCE(d.content_markdown, '') ILIKE $${likeIndex}`,
      ];
      if (itemNumber != null) {
        params.push(itemNumber);
        searchClauses.unshift(`d.item_number = $${params.length}`);
      }
      whereClauses.push(`(${searchClauses.join(' OR ')})`);
    }

    params.push(limit);
    params.push(offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const rows = await manager.query(
      `SELECT d.id,
              d.item_number,
              'DOC-' || d.item_number::text AS item_ref,
              d.title,
              d.status,
              d.updated_at,
              d.library_id,
              dl.name AS library_name,
              dl.slug AS library_slug,
              COUNT(*) OVER()::int AS total_count
       FROM documents d
       LEFT JOIN document_libraries dl
         ON dl.id = d.library_id
        AND dl.tenant_id = d.tenant_id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY lower(d.title) ASC, d.item_number DESC
       LIMIT $${limitIndex}
       OFFSET $${offsetIndex}`,
      params,
    );
    const total = rows.length > 0 ? Math.max(Number(rows[0].total_count) || 0, rows.length) : 0;

    return {
      items: rows.map((row: any) => ({
        id: row.id,
        item_number: Number(row.item_number),
        item_ref: row.item_ref || `DOC-${row.item_number}`,
        title: row.title,
        status: row.status,
        updated_at: row.updated_at,
        library_id: row.library_id,
        library_name: row.library_name,
        library_slug: row.library_slug,
      })),
      total,
      page,
      limit,
    };
  }

  async listAttachments(idOrRef: string, opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentReadable(documentId, manager, opts?.userId || null, opts);
    return manager
      .getRepository(DocumentAttachment)
      .createQueryBuilder('a')
      .where('a.document_id = :documentId', { documentId })
      .andWhere('a.source_field IS NULL')
      .orderBy('a.uploaded_at', 'DESC')
      .getMany();
  }

  async uploadAttachment(
    idOrRef: string,
    file: Express.Multer.File,
    userId: string | null,
    opts?: { manager?: EntityManager; sourceField?: string | null } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentWritable(documentId, manager, userId, opts);
    await this.assertWorkflowAllowsEditing(documentId, manager);
    await this.assertDocumentUnlockedForUser(documentId, userId, manager);
    if (!file) throw new BadRequestException('No file uploaded');

    const [{ tenant_id }] = await manager.query(`SELECT app_current_tenant() AS tenant_id`);

    const decodedName = fixMulterFilename(file.originalname);
    const ext = path.extname(decodedName || '') || '';
    const now = new Date();
    const id = randomUUID();
    const rand = Math.random().toString(36).slice(2, 8);

    const key = [
      'files',
      tenant_id,
      'documents',
      documentId,
      now.getUTCFullYear().toString(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}_${rand}${ext}`,
    ].join('/');

    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : null);
    if (!buf) throw new BadRequestException('Empty upload');

    const validated = validateUploadedFile(
      {
        originalName: decodedName,
        mimeType: file.mimetype,
        buffer: buf as Buffer,
        size: file.size,
      },
      { scope: opts?.sourceField ? 'inline-image' : 'attachment' },
    );

    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const attachment = manager.getRepository(DocumentAttachment).create({
      id,
      tenant_id,
      document_id: documentId,
      original_filename: decodedName || `${id}${ext}`,
      stored_filename: path.basename(key),
      mime_type: validated.mimeType,
      size: validated.size,
      storage_path: key,
      source_field: opts?.sourceField || null,
      uploaded_by_id: userId,
    });

    const saved = await manager.getRepository(DocumentAttachment).save(attachment);

    await this.audit.log(
      {
        table: 'document_attachments',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
      },
      { manager },
    );

    return saved;
  }

  async importInlineAttachmentFromUrl(
    documentId: string,
    sourceUrl: string,
    userId?: string | null,
    opts?: { manager?: EntityManager; sourceField?: string | null } & DocumentAccessOptions,
  ) {
    const file = await this.remoteInlineImages.importFromUrl(sourceUrl);
    return this.uploadAttachment(documentId, file, userId || null, opts);
  }

  async getAttachmentMeta(
    attachmentId: string,
    opts?: { manager?: EntityManager; userId?: string | null } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const found = await manager.getRepository(DocumentAttachment).findOne({ where: { id: attachmentId } });
    if (!found) throw new NotFoundException('Attachment not found');
    await this.assertDocumentReadable(found.document_id, manager, opts?.userId || null, opts);
    return found;
  }

  async deleteAttachment(
    idOrRef: string,
    attachmentId: string,
    userId: string | null,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);
    await this.assertDocumentWritable(documentId, manager, userId, opts);
    await this.assertWorkflowAllowsEditing(documentId, manager);
    await this.assertDocumentUnlockedForUser(documentId, userId, manager);

    const repo = manager.getRepository(DocumentAttachment);
    const existing = await repo.findOne({ where: { id: attachmentId, document_id: documentId } as any });
    if (!existing) throw new NotFoundException('Attachment not found');

    try {
      await this.storage.deleteObject(existing.storage_path);
    } catch {
      // Keep DB delete resilient even if object is already missing.
    }

    await repo.delete({ id: existing.id } as any);

    await this.audit.log(
      {
        table: 'document_attachments',
        recordId: existing.id,
        action: 'delete',
        before: existing,
        after: null,
        userId,
      },
      { manager },
    );

    return { ok: true };
  }

  async importDocument(
    idOrRef: string,
    file: Express.Multer.File,
    userId: string | null,
    lockToken: string | null | undefined,
    opts?: ImportExecutionOptions & DocumentAccessOptions,
  ): Promise<{ markdown: string; warnings: string[] }> {
    let manager = this.getManager(opts);
    const documentId = await this.resolveDocumentId(idOrRef, manager);

    await this.assertDocumentWritable(documentId, manager, userId, opts);
    await this.assertWorkflowAllowsEditing(documentId, manager);
    await this.ensureValidLock(documentId, String(userId || ''), lockToken, manager);

    const buffer = readUploadedFileBuffer(file);
    let converted: ImportedDocumentResult;
    if (opts?.releaseConnection) {
      const released = await opts.releaseConnection(
        () => this.importService.convertToMarkdown(buffer, file.mimetype, file.originalname),
      );
      converted = released.result;
      manager = released.manager;
    } else {
      converted = await this.importService.convertToMarkdown(
        buffer,
        file.mimetype,
        file.originalname,
      );
    }

    return this.finalizeImportedDocument(documentId, converted, userId, lockToken, { ...(opts ?? {}), manager });
  }

  async finalizeImportedDocument(
    documentId: string,
    converted: ImportedDocumentResult,
    userId: string | null,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager } & DocumentAccessOptions,
  ): Promise<{ markdown: string; warnings: string[] }> {
    const manager = this.getManager(opts);

    await this.assertDocumentWritable(documentId, manager, userId, opts);
    await this.assertWorkflowAllowsEditing(documentId, manager);
    await this.ensureValidLock(documentId, String(userId || ''), lockToken, manager);

    const tenantSlug = await this.loadCurrentTenantSlug(manager);
    const replacements = new Map<string, string>();

    for (const image of converted.images) {
      const attachment = await this.uploadAttachment(documentId, image.file, userId, {
        ...(opts ?? {}),
        manager,
        sourceField: 'content_markdown',
      });
      replacements.set(image.sourcePath, this.buildInlineAttachmentPath(tenantSlug, attachment.id));
    }

    return {
      markdown: this.importService.rewriteImageTargets(converted.markdown, replacements, converted.omittedTargets),
      warnings: converted.warnings,
    };
  }

  private async loadCurrentTenantSlug(manager: EntityManager): Promise<string> {
    const currentTenantRows = await manager.query<Array<{ tenant_id: string | null }>>(
      'SELECT app_current_tenant() AS tenant_id',
    );
    const tenantId = String(currentTenantRows[0]?.tenant_id || '').trim();
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }

    const tenantRows = await manager.query<Array<{ slug: string | null }>>(
      `SELECT slug
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [tenantId],
    );
    const slug = String(tenantRows[0]?.slug || '').trim();
    return slug || tenantId;
  }

  private buildInlineAttachmentPath(tenantSlug: string, attachmentId: string): string {
    return `/api/knowledge/inline/${tenantSlug}/${attachmentId}`;
  }

  /**
   * Is this inline attachment still referenced by any stored version of the
   * document? One indexed-by-document_id lookup that stops at the first hit,
   * instead of reading every version body back into the process.
   */
  private async isInlineAttachmentUsedByVersion(
    manager: EntityManager,
    documentId: string,
    attachmentId: string,
  ): Promise<boolean> {
    const rows = await manager.query<Array<{ exists: number }>>(
      `SELECT 1 AS exists
       FROM document_versions
       WHERE tenant_id = app_current_tenant()
         AND document_id = $1
         AND content_markdown LIKE $2
       LIMIT 1`,
      [documentId, `%${escapeLikePattern(attachmentId)}%`],
    );
    return rows.length > 0;
  }

  private async cleanupOrphanedInlineAttachments(
    documentId: string,
    oldContent: string | null,
    newContent: string | null,
    manager: EntityManager,
  ): Promise<void> {
    const previousUrls = extractInlineImageUrls(oldContent);
    const nextUrls = new Set(extractInlineImageUrls(newContent));
    if (previousUrls.length === 0) {
      return;
    }

    const repo = manager.getRepository(DocumentAttachment);
    for (const url of previousUrls) {
      if (nextUrls.has(url)) {
        continue;
      }
      const match = url.match(/\/knowledge\/inline\/[^/]+\/([a-f0-9-]+)(?:[/?#].*)?$/i);
      if (!match) {
        continue;
      }

      const attachment = await repo.findOne({
        where: {
          id: match[1],
          document_id: documentId,
          source_field: 'content_markdown',
        } as any,
      });
      if (!attachment) {
        continue;
      }

      // Kept versions still render their images: an attachment that disappeared
      // from the current body but is still referenced by a stored version is not
      // an orphan. Without this, reverting or reading an older version of an
      // incident review after a closure would show broken images. Asked per
      // candidate and bounded by `LIMIT 1`, so a document with a long history
      // never has every version body pulled into memory.
      if (await this.isInlineAttachmentUsedByVersion(manager, documentId, attachment.id)) {
        continue;
      }

      const referencedElsewhere = await this.isStoragePathReferencedElsewhere(manager, attachment.storage_path, [attachment.id]);
      if (!referencedElsewhere) {
        try {
          await this.storage.deleteObject(attachment.storage_path);
        } catch {
          // Ignore storage delete failures during inline attachment cleanup.
        }
      }
      await repo.delete({ id: attachment.id } as any);
    }
  }

  async getInlineAttachmentMeta(
    tenantSlug: string,
    attachmentId: string,
    refreshToken?: string | null,
  ): Promise<{
    storagePath: string;
    mimeType: string | null;
    size: number | null;
  } | null> {
    const effectiveSlug = resolveInlineTenantSlug(tenantSlug);
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();

      const tenantRows = await runner.query(
        `SELECT id
         FROM tenants
         WHERE slug = $1
         LIMIT 1`,
        [effectiveSlug],
      );
      if (!tenantRows.length) {
        await runner.rollbackTransaction();
        return null;
      }

      const tenantId = String(tenantRows[0].id || '').trim();
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      const userId = await this.resolveUserIdFromRefreshToken(runner.manager, tenantId, refreshToken);
      if (!userId) {
        await runner.rollbackTransaction();
        return null;
      }

      const meta = await this.getInlineAttachmentMetaForUser(runner.manager, tenantId, userId, attachmentId);
      if (!meta) {
        await runner.rollbackTransaction();
        return null;
      }

      await runner.commitTransaction();
      return meta;
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw error;
    } finally {
      await runner.release();
    }
  }

  /**
   * Cœur partagé de la résolution d'une image inline de document : lecture de la
   * ligne d'attachement puis contrôle d'accès, dans un contexte tenant déjà établi.
   * Utilisé par la route publique — via `getInlineAttachmentMeta`, identité issue du
   * cookie — et par le résolveur d'images de l'export, avec l'identité du JWT.
   */
  async getInlineAttachmentMetaForUser(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    attachmentId: string,
  ): Promise<{
    storagePath: string;
    mimeType: string | null;
    size: number | null;
  } | null> {
    const rows = await manager.query(
      `SELECT a.storage_path,
              a.mime_type,
              a.size,
              a.document_id::text AS document_id,
              b.source_entity_type
       FROM document_attachments a
       LEFT JOIN integrated_document_bindings b
         ON b.document_id = a.document_id
        AND b.tenant_id = a.tenant_id
       WHERE a.id = $1
         AND a.tenant_id = $2
         AND a.source_field IS NOT NULL
       LIMIT 1`,
      [attachmentId, tenantId],
    ) as Array<{
      storage_path: string;
      mime_type: string | null;
      size: number | null;
      document_id: string;
      source_entity_type: IntegratedDocumentBinding['source_entity_type'] | null;
    }>;
    if (!rows.length) return null;

    const canAccess = await this.canAccessInlineAttachmentForUser(manager, tenantId, userId, {
      documentId: String(rows[0].document_id),
      integratedBinding: rows[0]?.source_entity_type
        ? { source_entity_type: rows[0].source_entity_type }
        : null,
    });
    if (!canAccess) return null;

    return {
      storagePath: rows[0].storage_path,
      mimeType: rows[0].mime_type ?? null,
      size: rows[0].size == null ? null : Number(rows[0].size),
    };
  }

  async exportDocument(
    idOrRef: string,
    format: 'pdf' | 'docx' | 'odt',
    opts?: {
      manager?: EntityManager;
      imageFetchCookie?: string | null;
      userId?: string | null;
      /** Résolution interne des images inline (voir `InlineImageResolverService`). */
      resolveInlineImage?: ExportImageFetchOptions['resolveInlineImage'];
    } & DocumentAccessOptions,
  ) {
    const manager = this.getManager(opts);
    const document = await this.get(idOrRef, { ...(opts ?? {}), manager, userId: opts?.userId || null });

    const exportOptions: ExportImageFetchOptions = {};
    if (opts?.imageFetchCookie) {
      exportOptions.imageFetchHeaders = { Cookie: opts.imageFetchCookie };
    }
    if (opts?.resolveInlineImage) {
      exportOptions.resolveInlineImage = opts.resolveInlineImage;
    }

    return this.exportService.exportMarkdown(
      String(document.content_markdown || ''),
      format,
      String(document.title || `DOC-${document.item_number}`),
      Object.keys(exportOptions).length > 0 ? exportOptions : undefined,
    );
  }

  private mapKnowledgeContextSources(
    entityType: RelationEntityType,
    rows: KnowledgeContextSourceRow[],
  ): EntityKnowledgeContextSource[] {
    const sources: EntityKnowledgeContextSource[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const entityId = String(row?.entity_id || '').trim();
      if (!entityId || seen.has(entityId)) continue;
      seen.add(entityId);
      sources.push({
        entity_type: entityType,
        entity_id: entityId,
        item_number: row?.item_number != null ? Number(row.item_number) : null,
        item_ref: row?.item_ref != null ? String(row.item_ref) : this.formatKnowledgeSourceRef(entityType, row?.item_number),
        name: String(row?.name || entityId),
        status: row?.status != null ? String(row.status) : null,
      });
    }

    return sources;
  }

  private formatKnowledgeSourceRef(entityType: RelationEntityType, itemNumber: number | null | undefined): string | null {
    if (itemNumber == null) return null;
    const prefix = entityType === 'tasks'
      ? 'T'
      : entityType === 'requests'
        ? 'REQ'
        : entityType === 'projects'
          ? 'PRJ'
          : entityType === 'incidents'
            ? 'INC'
            : null;
    return prefix ? `${prefix}-${Number(itemNumber)}` : null;
  }

  private async listDocumentRowsForEntityIds(
    entity: RelationEntityType,
    entityIds: string[],
    manager: EntityManager,
    userId?: string | null,
  ): Promise<EntityDocumentListItemRow[]> {
    const ids = dedupeStrings(entityIds);
    if (ids.length === 0) return [];

    const map = RELATION_TABLE_MAP[entity];
    if (!map) throw new BadRequestException('Unsupported relation entity');
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return [];
    }

    const params: unknown[] = [ids, entity];
    let libraryClause = '';
    if (accessibleLibraries) {
      params.push(accessibleLibraries);
      libraryClause = ` AND d.library_id = ANY($${params.length}::uuid[])`;
    }
    const incidentClause = documentIncidentVisibilitySql(
      'd',
      await resolveDocumentIncidentViewer(manager, userId || null, null),
      params,
    );

    return manager.query(
      `SELECT rel.${map.idColumn} AS entity_id,
              d.id,
              d.item_number,
              d.title,
              d.summary,
              d.status,
              d.updated_at,
              d.created_at
       FROM ${map.table} rel
       JOIN documents d ON d.id = rel.document_id AND d.tenant_id = rel.tenant_id
       LEFT JOIN integrated_document_bindings b
         ON b.document_id = d.id
        AND b.tenant_id = d.tenant_id
        AND b.source_entity_type = $2
        AND b.source_entity_id = rel.${map.idColumn}
       WHERE rel.${map.idColumn} = ANY($1::uuid[])
         AND (b.document_id IS NULL OR b.hidden_from_entity_knowledge = false)
         ${libraryClause}
         ${incidentClause}
       ORDER BY rel.${map.idColumn} ASC, d.updated_at DESC`,
      params,
    );
  }

  private async listDocumentRowsForKnowledgeSources(
    sources: EntityKnowledgeContextSource[],
    manager: EntityManager,
    userId?: string | null,
  ): Promise<Map<string, EntityDocumentListItemRow[]>> {
    const rowsBySourceId = new Map<string, EntityDocumentListItemRow[]>();
    const sourceIdsByType = new Map<RelationEntityType, string[]>();

    for (const source of sources) {
      const ids = sourceIdsByType.get(source.entity_type) || [];
      ids.push(source.entity_id);
      sourceIdsByType.set(source.entity_type, ids);
    }

    await Promise.all(
      Array.from(sourceIdsByType.entries()).map(async ([entityType, entityIds]) => {
        const rows = await this.listDocumentRowsForEntityIds(entityType, entityIds, manager, userId || null);
        for (const row of rows) {
          const bucket = rowsBySourceId.get(row.entity_id) || [];
          bucket.push(row);
          rowsBySourceId.set(row.entity_id, bucket);
        }
      }),
    );

    return rowsBySourceId;
  }

  private buildKnowledgeContextGroup(
    definition: EntityKnowledgeContextGroupDefinition,
    rowsBySourceId: Map<string, EntityDocumentListItemRow[]>,
  ): EntityKnowledgeContextGroup | null {
    const itemsById = new Map<string, EntityKnowledgeContextItem>();
    const provenanceKeysByDocumentId = new Map<string, Set<string>>();

    for (const source of definition.sources) {
      const rows = rowsBySourceId.get(source.entity_id) || [];
      for (const row of rows) {
        const provenanceKey = `${source.entity_type}:${source.entity_id}`;
        const existingProvenanceKeys = provenanceKeysByDocumentId.get(row.id) || new Set<string>();
        const existingItem = itemsById.get(row.id);
        if (existingItem && existingProvenanceKeys.has(provenanceKey)) {
          continue;
        }

        if (!existingItem) {
          itemsById.set(row.id, {
            id: row.id,
            item_number: Number(row.item_number),
            title: row.title,
            summary: row.summary,
            status: row.status,
            updated_at: row.updated_at,
            created_at: row.created_at,
            provenance: [],
          });
        }

        const item = itemsById.get(row.id);
        if (!item) continue;
        item.provenance.push(source);
        existingProvenanceKeys.add(provenanceKey);
        provenanceKeysByDocumentId.set(row.id, existingProvenanceKeys);
      }
    }

    const items = Array.from(itemsById.values())
      .map((item) => ({
        ...item,
        provenance: [...item.provenance].sort((a, b) => {
          const aRef = `${a.item_number != null ? a.item_number : Number.MAX_SAFE_INTEGER}:${a.name}`.toLowerCase();
          const bRef = `${b.item_number != null ? b.item_number : Number.MAX_SAFE_INTEGER}:${b.name}`.toLowerCase();
          return aRef.localeCompare(bRef);
        }),
      }))
      .sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
        return String(a.title || '').localeCompare(String(b.title || ''));
      });

    if (items.length === 0) {
      return null;
    }

    return {
      key: definition.key,
      label: definition.label,
      linked_via_label: definition.linked_via_label,
      total: items.length,
      items,
    };
  }

  private async getRequestKnowledgeContextGroupDefinitions(
    requestId: string,
    manager: EntityManager,
  ): Promise<EntityKnowledgeContextGroupDefinition[]> {
    const [requestRows, projectRows, requestDependencyRows, projectDependencyRows, applicationRows, assetRows] = await Promise.all([
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT r.id AS entity_id, r.item_number, r.name, r.status
         FROM portfolio_requests r
         WHERE r.id = $1
         LIMIT 1`,
        [requestId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT p.id AS entity_id, p.item_number, p.name, p.status
         FROM portfolio_request_projects rp
         JOIN portfolio_projects p ON p.id = rp.project_id AND p.tenant_id = rp.tenant_id
         WHERE rp.request_id = $1
         ORDER BY p.name ASC`,
        [requestId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT r.id AS entity_id, r.item_number, r.name, r.status
         FROM portfolio_request_dependencies d
         JOIN portfolio_requests r ON r.id = d.depends_on_request_id AND r.tenant_id = d.tenant_id
         WHERE d.request_id = $1
         ORDER BY r.name ASC`,
        [requestId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT p.id AS entity_id, p.item_number, p.name, p.status
         FROM portfolio_request_dependencies d
         JOIN portfolio_projects p ON p.id = d.depends_on_project_id AND p.tenant_id = d.tenant_id
         WHERE d.request_id = $1
         ORDER BY p.name ASC`,
        [requestId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.sequential_id AS item_ref, a.name, NULL::text AS status
         FROM portfolio_request_applications l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
         WHERE l.request_id = $1
         ORDER BY a.name ASC`,
        [requestId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.asset_reference AS item_ref, a.name, NULL::text AS status
         FROM portfolio_request_assets l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
         WHERE l.request_id = $1
         ORDER BY a.name ASC`,
        [requestId],
      ),
    ]);

    return [
      {
        key: 'direct',
        label: 'Direct',
        linked_via_label: 'Direct',
        sources: this.mapKnowledgeContextSources('requests', requestRows),
      },
      {
        key: 'resulting_projects',
        label: 'Resulting Projects',
        linked_via_label: 'Resulting Project',
        sources: this.mapKnowledgeContextSources('projects', projectRows),
      },
      {
        key: 'dependencies',
        label: 'Dependencies',
        linked_via_label: 'Dependency',
        sources: [
          ...this.mapKnowledgeContextSources('requests', requestDependencyRows),
          ...this.mapKnowledgeContextSources('projects', projectDependencyRows),
        ],
      },
      {
        key: 'linked_applications',
        label: 'Linked Applications',
        linked_via_label: 'Application',
        sources: this.mapKnowledgeContextSources('applications', applicationRows),
      },
      {
        key: 'linked_assets',
        label: 'Linked Assets',
        linked_via_label: 'Asset',
        sources: this.mapKnowledgeContextSources('assets', assetRows),
      },
    ];
  }

  private async getProjectKnowledgeContextGroupDefinitions(
    projectId: string,
    manager: EntityManager,
  ): Promise<EntityKnowledgeContextGroupDefinition[]> {
    const [projectRows, sourceRequestRows, dependencyRows, applicationRows, assetRows] = await Promise.all([
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT p.id AS entity_id, p.item_number, p.name, p.status
         FROM portfolio_projects p
         WHERE p.id = $1
         LIMIT 1`,
        [projectId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT r.id AS entity_id, r.item_number, r.name, r.status
         FROM portfolio_request_projects rp
         JOIN portfolio_requests r ON r.id = rp.request_id AND r.tenant_id = rp.tenant_id
         WHERE rp.project_id = $1
         ORDER BY r.name ASC`,
        [projectId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT p.id AS entity_id, p.item_number, p.name, p.status
         FROM portfolio_project_dependencies d
         JOIN portfolio_projects p ON p.id = d.depends_on_project_id AND p.tenant_id = d.tenant_id
         WHERE d.project_id = $1
         ORDER BY p.name ASC`,
        [projectId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.sequential_id AS item_ref, a.name, NULL::text AS status
         FROM application_projects l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
         WHERE l.project_id = $1
         ORDER BY a.name ASC`,
        [projectId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.asset_reference AS item_ref, a.name, NULL::text AS status
         FROM asset_projects l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
         WHERE l.project_id = $1
         ORDER BY a.name ASC`,
        [projectId],
      ),
    ]);

    return [
      {
        key: 'direct',
        label: 'Direct',
        linked_via_label: 'Direct',
        sources: this.mapKnowledgeContextSources('projects', projectRows),
      },
      {
        key: 'source_requests',
        label: 'Source Requests',
        linked_via_label: 'Source Request',
        sources: this.mapKnowledgeContextSources('requests', sourceRequestRows),
      },
      {
        key: 'dependencies',
        label: 'Dependencies',
        linked_via_label: 'Dependency',
        sources: this.mapKnowledgeContextSources('projects', dependencyRows),
      },
      {
        key: 'linked_applications',
        label: 'Linked Applications',
        linked_via_label: 'Application',
        sources: this.mapKnowledgeContextSources('applications', applicationRows),
      },
      {
        key: 'linked_assets',
        label: 'Linked Assets',
        linked_via_label: 'Asset',
        sources: this.mapKnowledgeContextSources('assets', assetRows),
      },
    ];
  }

  private async getApplicationKnowledgeContextGroupDefinitions(
    applicationId: string,
    manager: EntityManager,
  ): Promise<EntityKnowledgeContextGroupDefinition[]> {
    const [applicationRows, requestRows, projectRows, relatedApplicationRows, assetRows] = await Promise.all([
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.sequential_id AS item_ref, a.name, a.status
         FROM applications a
         WHERE a.id = $1
         LIMIT 1`,
        [applicationId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT r.id AS entity_id, r.item_number, r.name, r.status
         FROM portfolio_request_applications l
         JOIN portfolio_requests r ON r.id = l.request_id AND r.tenant_id = l.tenant_id
         WHERE l.application_id = $1
         ORDER BY r.name ASC`,
        [applicationId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT p.id AS entity_id, p.item_number, p.name, p.status
         FROM application_projects l
         JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
         WHERE l.application_id = $1
         ORDER BY p.name ASC`,
        [applicationId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.sequential_id AS item_ref, a.name, a.status
         FROM application_suites l
         JOIN applications a ON a.id = l.suite_id AND a.tenant_id = l.tenant_id
         WHERE l.application_id = $1
         UNION ALL
         SELECT a.id AS entity_id, NULL::int AS item_number, a.sequential_id AS item_ref, a.name, a.status
         FROM application_suites l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
         WHERE l.suite_id = $1`,
        [applicationId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.asset_reference AS item_ref, a.name, a.status
         FROM app_instances ai
         JOIN app_asset_assignments aaa ON aaa.app_instance_id = ai.id AND aaa.tenant_id = ai.tenant_id
         JOIN assets a ON a.id = aaa.asset_id AND a.tenant_id = aaa.tenant_id
         WHERE ai.application_id = $1
         ORDER BY a.name ASC`,
        [applicationId],
      ),
    ]);

    return [
      {
        key: 'direct',
        label: 'Direct',
        linked_via_label: 'Direct',
        sources: this.mapKnowledgeContextSources('applications', applicationRows),
      },
      {
        key: 'linked_requests',
        label: 'Linked Requests',
        linked_via_label: 'Request',
        sources: this.mapKnowledgeContextSources('requests', requestRows),
      },
      {
        key: 'linked_projects',
        label: 'Linked Projects',
        linked_via_label: 'Project',
        sources: this.mapKnowledgeContextSources('projects', projectRows),
      },
      {
        key: 'linked_applications',
        label: 'Related Applications',
        linked_via_label: 'Application',
        sources: this.mapKnowledgeContextSources('applications', relatedApplicationRows),
      },
      {
        key: 'linked_assets',
        label: 'Linked Assets',
        linked_via_label: 'Asset',
        sources: this.mapKnowledgeContextSources('assets', assetRows),
      },
    ];
  }

  private async getAssetKnowledgeContextGroupDefinitions(
    assetId: string,
    manager: EntityManager,
  ): Promise<EntityKnowledgeContextGroupDefinition[]> {
    const [assetRows, requestRows, projectRows, relatedAssetRows, applicationRows] = await Promise.all([
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.asset_reference AS item_ref, a.name, a.status
         FROM assets a
         WHERE a.id = $1
         LIMIT 1`,
        [assetId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT r.id AS entity_id, r.item_number, r.name, r.status
         FROM portfolio_request_assets l
         JOIN portfolio_requests r ON r.id = l.request_id AND r.tenant_id = l.tenant_id
         WHERE l.asset_id = $1
         ORDER BY r.name ASC`,
        [assetId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT p.id AS entity_id, p.item_number, p.name, p.status
         FROM asset_projects l
         JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
         WHERE l.asset_id = $1
         ORDER BY p.name ASC`,
        [assetId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.asset_reference AS item_ref, a.name, a.status
         FROM asset_relations r
         JOIN assets a ON a.id = r.related_asset_id AND a.tenant_id = r.tenant_id
         WHERE r.asset_id = $1
         UNION ALL
         SELECT a.id AS entity_id, NULL::int AS item_number, a.asset_reference AS item_ref, a.name, a.status
         FROM asset_relations r
         JOIN assets a ON a.id = r.asset_id AND a.tenant_id = r.tenant_id
         WHERE r.related_asset_id = $1`,
        [assetId],
      ),
      manager.query<KnowledgeContextSourceRow[]>(
        `SELECT a.id AS entity_id, NULL::int AS item_number, a.sequential_id AS item_ref, a.name, a.status
         FROM app_asset_assignments aaa
         JOIN app_instances ai ON ai.id = aaa.app_instance_id AND ai.tenant_id = aaa.tenant_id
         JOIN applications a ON a.id = ai.application_id AND a.tenant_id = ai.tenant_id
         WHERE aaa.asset_id = $1
         ORDER BY a.name ASC`,
        [assetId],
      ),
    ]);

    return [
      {
        key: 'direct',
        label: 'Direct',
        linked_via_label: 'Direct',
        sources: this.mapKnowledgeContextSources('assets', assetRows),
      },
      {
        key: 'linked_requests',
        label: 'Linked Requests',
        linked_via_label: 'Request',
        sources: this.mapKnowledgeContextSources('requests', requestRows),
      },
      {
        key: 'linked_projects',
        label: 'Linked Projects',
        linked_via_label: 'Project',
        sources: this.mapKnowledgeContextSources('projects', projectRows),
      },
      {
        key: 'linked_assets',
        label: 'Related Assets',
        linked_via_label: 'Asset',
        sources: this.mapKnowledgeContextSources('assets', relatedAssetRows),
      },
      {
        key: 'linked_applications',
        label: 'Linked Applications',
        linked_via_label: 'Application',
        sources: this.mapKnowledgeContextSources('applications', applicationRows),
      },
    ];
  }

  private async getDirectKnowledgeContextGroupDefinitions(
    entityType: 'tasks' | 'locations' | 'connections' | 'interfaces' | 'incidents',
    entityId: string,
    manager: EntityManager,
    userId?: string | null,
  ): Promise<EntityKnowledgeContextGroupDefinition[]> {
    const sourceRows =
      entityType === 'incidents'
        ? await (async () => {
            // An incident the caller cannot see (no incidents:reader, or a
            // confidential row they neither report nor own) yields no source at
            // all, so its review never reaches the knowledge context.
            const viewer = await resolveDocumentIncidentViewer(manager, userId || null, null);
            if (!viewer.canReadIncidents) return [] as KnowledgeContextSourceRow[];
            const params: unknown[] = [entityId];
            const visibility = incidentVisibilitySql('i', viewer, params);
            return manager.query<KnowledgeContextSourceRow[]>(
              `SELECT i.id AS entity_id, i.item_number, i.title AS name, i.status
               FROM incidents i
               WHERE i.id = $1
                 AND i.tenant_id = app_current_tenant()
                 ${visibility}
               LIMIT 1`,
              params,
            );
          })()
      : entityType === 'locations'
        ? await manager.query<KnowledgeContextSourceRow[]>(
            `SELECT l.id AS entity_id,
                    NULL::int AS item_number,
                    l.location_reference AS item_ref,
                    l.name,
                    NULL::text AS status
             FROM locations l
             WHERE l.id = $1
             LIMIT 1`,
              [entityId],
            )
        : entityType === 'connections'
          ? await manager.query<KnowledgeContextSourceRow[]>(
              `SELECT c.id AS entity_id,
                      NULL::int AS item_number,
                      c.connection_reference AS item_ref,
                      c.name,
                      c.lifecycle AS status
               FROM connections c
               WHERE c.id = $1
               LIMIT 1`,
              [entityId],
            )
          : entityType === 'interfaces'
            ? await manager.query<KnowledgeContextSourceRow[]>(
                `SELECT i.id AS entity_id,
                        NULL::int AS item_number,
                        COALESCE(NULLIF(i.interface_reference, ''), NULLIF(i.interface_id, '')) AS item_ref,
                        i.name,
                        i.lifecycle AS status
                 FROM interfaces i
                 WHERE i.id = $1
                 LIMIT 1`,
                [entityId],
              )
            : await manager.query<KnowledgeContextSourceRow[]>(
                `SELECT t.id AS entity_id, t.item_number, t.title AS name, t.status
                 FROM tasks t
                 WHERE t.id = $1
                 LIMIT 1`,
                [entityId],
              );

    return [
      {
        key: 'direct',
        label: 'Direct',
        linked_via_label: 'Direct',
        sources: this.mapKnowledgeContextSources(entityType, sourceRows),
      },
    ];
  }

  async getKnowledgeContextForEntity(
    entity: KnowledgeContextRootEntityType,
    entityId: string,
    opts?: { manager?: EntityManager; userId?: string | null },
  ): Promise<EntityKnowledgeContextResponse> {
    const manager = this.getManager(opts);
    const knowledgeLevel = await this.getKnowledgeLevelForUser(manager, opts?.userId ?? null);
    if (!knowledgeLevel) {
      return {
        access: 'restricted',
        total: 0,
        groups: [],
      };
    }
    const definitions = entity === 'requests'
      ? await this.getRequestKnowledgeContextGroupDefinitions(entityId, manager)
      : entity === 'projects'
        ? await this.getProjectKnowledgeContextGroupDefinitions(entityId, manager)
        : entity === 'applications'
          ? await this.getApplicationKnowledgeContextGroupDefinitions(entityId, manager)
          : entity === 'assets'
            ? await this.getAssetKnowledgeContextGroupDefinitions(entityId, manager)
            : await this.getDirectKnowledgeContextGroupDefinitions(entity, entityId, manager, opts?.userId ?? null);

    const groups: EntityKnowledgeContextGroup[] = [];
    const distinctDocumentIds = new Set<string>();

    for (const definition of definitions) {
      if (definition.sources.length === 0) continue;
      const rowsBySourceId = await this.listDocumentRowsForKnowledgeSources(definition.sources, manager, opts?.userId ?? null);
      const group = this.buildKnowledgeContextGroup(definition, rowsBySourceId);
      if (!group) continue;
      group.items.forEach((item) => distinctDocumentIds.add(item.id));
      groups.push(group);
    }

    const total = distinctDocumentIds.size;
    return {
      access: 'granted',
      total,
      groups,
    };
  }

  async listDocumentsForEntity(
    entity: RelationEntityType,
    entityId: string,
    opts?: { manager?: EntityManager; userId?: string | null },
  ): Promise<EntityDocumentListResponse> {
    const manager = this.getManager(opts);
    const map = RELATION_TABLE_MAP[entity];
    if (!map) throw new BadRequestException('Unsupported relation entity');
    const knowledgeLevel = await this.getKnowledgeLevelForUser(manager, opts?.userId ?? null);
    if (!knowledgeLevel) {
      return {
        access: 'restricted',
        total: 0,
        items: [],
      };
    }
    const accessibleLibraries = await this.listAccessibleLibraryIds(manager, opts?.userId || null, 'reader');
    if (accessibleLibraries && accessibleLibraries.length === 0) {
      return {
        access: 'granted',
        total: 0,
        items: [],
      };
    }

    const params: unknown[] = [entityId, entity];
    let libraryClause = '';
    if (accessibleLibraries) {
      params.push(accessibleLibraries);
      libraryClause = ` AND d.library_id = ANY($${params.length}::uuid[])`;
    }
    libraryClause += documentIncidentVisibilitySql(
      'd',
      await resolveDocumentIncidentViewer(manager, opts?.userId || null, null),
      params,
    );

    const countRows: Array<{ total: string | number }> = await manager.query(
      `SELECT COUNT(DISTINCT d.id)::int AS total
       FROM ${map.table} rel
       JOIN documents d ON d.id = rel.document_id AND d.tenant_id = rel.tenant_id
       LEFT JOIN integrated_document_bindings b
         ON b.document_id = d.id
        AND b.tenant_id = d.tenant_id
        AND b.source_entity_type = $2
        AND b.source_entity_id = $1
       WHERE rel.${map.idColumn} = $1
         AND (b.document_id IS NULL OR b.hidden_from_entity_knowledge = false)
         ${libraryClause}`,
      params,
    );
    const total = Number(countRows[0]?.total || 0);

    const items = await manager.query(
      `SELECT d.id,
              d.item_number,
              d.title,
              d.summary,
              d.status,
              d.updated_at,
              d.created_at
       FROM ${map.table} rel
       JOIN documents d ON d.id = rel.document_id AND d.tenant_id = rel.tenant_id
       LEFT JOIN integrated_document_bindings b
         ON b.document_id = d.id
        AND b.tenant_id = d.tenant_id
        AND b.source_entity_type = $2
        AND b.source_entity_id = $1
       WHERE rel.${map.idColumn} = $1
         AND (b.document_id IS NULL OR b.hidden_from_entity_knowledge = false)
         ${libraryClause}
       ORDER BY d.updated_at DESC`,
      params,
    );
    return {
      access: 'granted',
      total,
      items,
    };
  }

  async listStatuses() {
    return DOCUMENT_STATUSES;
  }
}
