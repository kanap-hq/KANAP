import { writeAuditLog } from '../audit/audit.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { moduleRightRequired } from '../auth/module-right-required';
import { DocumentImportService } from '../common/document-import.service';
import { extractInlineImageUrls } from '../common/content-image-urls';
import { ImportExecutionOptions, readUploadedFileBuffer } from '../common/import-connection';
import {
  containsInlineDataImage,
  findInlineImageReferences,
  interfaceSpecificationMarkdown,
  isMarkdownTooComplex,
  normalizeMarkdownRichText,
  prepareRecoveredContent,
} from '../common/markdown-worker';
import { interfaceSpecificationLanguageOf } from './interface-specification-markdown';
import { PermissionsService, PermissionLevel } from '../permissions/permissions.service';
import { PortfolioActivity } from '../portfolio/portfolio-activity.entity';
import { Document } from './document.entity';
import { DocumentAttachment } from './document-attachment.entity';
import { IntegratedDocumentBinding } from './integrated-document-binding.entity';
import {
  INCIDENT_REVIEW_SLOT,
  incidentReviewLanguage,
  type IncidentReviewLanguage,
  integratedDocumentSlotLabel,
  integratedDocumentSlotLabels,
  incidentReviewTemplateMarkdown,
  isIncidentReviewSystemTemplate,
  INTEGRATED_DOCUMENT_SLOT_DEFINITIONS,
  IntegratedDocumentSlotKey,
} from './integrated-document.constants';
import { DocumentSourceGrant, KnowledgeService, RelationEntityType } from './knowledge.service';
import {
  DocumentSourceAccessContext,
  buildIncidentReviewImportContext,
  buildIncidentReviewSourceContext,
  resolveCurrentTenantId,
} from './document-entity-visibility';
import { incidentVisibilitySql, resolveIncidentViewer } from '../incidents/incident-visibility';

type SourceScopedEntityType = 'requests' | 'projects' | 'interfaces' | 'applications' | 'incidents';
type SourceAccessMode = 'read' | 'edit';
type SourceDescriptor = {
  id: string;
  tenant_id: string;
  item_number: number | null;
  name: string;
  reference_label?: string | null;
};
type ManagedWriteResult = {
  documentId: string;
  changed: boolean;
  created: boolean;
};
type RecoveredSlotSource = 'legacy' | 'audit';
type RecoveredSlotContent = {
  content: string | null;
  source: RecoveredSlotSource;
  unresolvedLegacyInlineAttachmentIds: string[];
};
type SourceRecoveryContext = {
  source: SourceDescriptor;
  ownerUserId: string | null;
  tenantSlug: string;
};
export type RepairSourceSlotResult = {
  slotKey: IntegratedDocumentSlotKey;
  documentId: string;
  created: boolean;
  repairedRelation: boolean;
  recoveredFrom: RecoveredSlotSource | null;
  unresolvedLegacyInlineAttachmentIds: string[];
};
export type RepairSourceEntityResult = {
  sourceEntityType: SourceScopedEntityType;
  sourceEntityId: string;
  slots: RepairSourceSlotResult[];
};
type SlotSettingRecord = {
  source_entity_type: SourceScopedEntityType;
  slot_key: IntegratedDocumentSlotKey;
  display_name: string;
  folder_id: string;
  library_id: string;
  document_type_id: string;
  template_document_id: string | null;
  template_content_markdown: string | null;
};
type RequestBackfillRow = SourceDescriptor & {
  purpose: string | null;
  risks: string | null;
  created_by_id: string | null;
  requestor_id: string | null;
  it_lead_id: string | null;
  business_lead_id: string | null;
};
type ProjectBackfillRow = SourceDescriptor & {
  purpose: string | null;
  it_lead_id: string | null;
  business_lead_id: string | null;
};
type InterfaceBackfillRow = SourceDescriptor & {
  business_purpose: string | null;
  overview_notes: string | null;
  impact_of_failure: string | null;
  business_objects: unknown | null;
  main_use_cases: string | null;
  functional_rules: string | null;
  core_transformations_summary: string | null;
  error_handling_summary: string | null;
  typical_data: string | null;
  audit_logging: string | null;
  security_controls_summary: string | null;
};
type ApplicationBackfillRow = SourceDescriptor & {
  description: string | null;
};
type LegacyAttachmentRow = {
  id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string | null;
  size: number;
  storage_path: string;
  source_field: string | null;
};
type ManagedAttachmentRow = {
  id: string;
  original_filename: string;
  mime_type: string | null;
  size: number;
  storage_path: string;
  source_field: string | null;
};
type InlineImageOccurrence = {
  raw: string;
  target: string;
  rewrite: (nextTarget: string) => string;
};
type RecoverableInlineImageOccurrence =
  | (InlineImageOccurrence & {
    kind: 'data';
    mimeType: string;
    buffer: Buffer;
    extension: string;
  })
  | (InlineImageOccurrence & {
    kind: 'legacy';
    attachmentId: string;
  });
type RecoverableInlineImageAssignment =
  | {
    kind: 'data';
    attachmentId: string;
    mimeType: string;
    size: number;
  }
  | {
    kind: 'legacy';
    attachmentId: string;
    sourceAttachmentId: string;
  };

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  reader: 1,
  contributor: 2,
  member: 3,
  admin: 4,
};

const SOURCE_ENTITY_CONFIG: Record<
  SourceScopedEntityType,
  {
    sourceTable: 'portfolio_requests' | 'portfolio_projects' | 'interfaces' | 'applications' | 'incidents';
    relationTable: 'document_requests' | 'document_projects' | 'document_incidents' | null;
    relationIdColumn: 'request_id' | 'project_id' | 'incident_id' | null;
    permissionResource: 'portfolio_requests' | 'portfolio_projects' | 'applications' | 'incidents';
    referencePrefix: 'REQ' | 'PRJ' | 'INC' | null;
    readLevel: PermissionLevel;
    editLevel: PermissionLevel;
  }
> = {
  requests: {
    sourceTable: 'portfolio_requests',
    relationTable: 'document_requests',
    relationIdColumn: 'request_id',
    permissionResource: 'portfolio_requests',
    referencePrefix: 'REQ',
    readLevel: 'reader',
    editLevel: 'member',
  },
  projects: {
    sourceTable: 'portfolio_projects',
    relationTable: 'document_projects',
    relationIdColumn: 'project_id',
    permissionResource: 'portfolio_projects',
    referencePrefix: 'PRJ',
    readLevel: 'reader',
    editLevel: 'contributor',
  },
  interfaces: {
    sourceTable: 'interfaces',
    relationTable: null,
    relationIdColumn: null,
    permissionResource: 'applications',
    referencePrefix: null,
    readLevel: 'reader',
    editLevel: 'member',
  },
  applications: {
    sourceTable: 'applications',
    relationTable: null,
    relationIdColumn: null,
    permissionResource: 'applications',
    referencePrefix: null,
    readLevel: 'reader',
    editLevel: 'member',
  },
  // Same levels as PATCH /incidents/:id. Row visibility (confidential incidents) is
  // enforced on top of the permission, in assertSourceEntityExists.
  incidents: {
    sourceTable: 'incidents',
    relationTable: 'document_incidents',
    relationIdColumn: 'incident_id',
    permissionResource: 'incidents',
    referencePrefix: 'INC',
    readLevel: 'reader',
    editLevel: 'contributor',
  },
};

const SUPPORTED_SLOT_KEYS = INTEGRATED_DOCUMENT_SLOT_DEFINITIONS.reduce<Record<SourceScopedEntityType, Set<string>>>(
  (acc, definition) => {
    if (
      definition.sourceEntityType === 'requests'
      || definition.sourceEntityType === 'projects'
      || definition.sourceEntityType === 'interfaces'
      || definition.sourceEntityType === 'applications'
      || definition.sourceEntityType === 'incidents'
    ) {
      acc[definition.sourceEntityType].add(definition.slotKey);
    }
    return acc;
  },
  {
    requests: new Set<string>(),
    projects: new Set<string>(),
    interfaces: new Set<string>(),
    applications: new Set<string>(),
    incidents: new Set<string>(),
  },
);

@Injectable()
export class IntegratedDocumentsService {
  private readonly legacyColumnExistsCache = new Map<string, boolean>();

  constructor(
    @InjectRepository(IntegratedDocumentBinding)
    private readonly bindingsRepo: Repository<IntegratedDocumentBinding>,
    private readonly knowledge: KnowledgeService,
    private readonly permissions: PermissionsService,
    private readonly importService: DocumentImportService,
  ) {}

  private getManager(opts?: { manager?: EntityManager }): EntityManager {
    return opts?.manager ?? this.bindingsRepo.manager;
  }

  private normalizeUserId(userId: string | null | undefined): string {
    const normalized = String(userId || '').trim();
    if (!normalized) {
      throw new ForbiddenException('Authenticated user is required');
    }
    return normalized;
  }

  /**
   * The §3.7 "source" access context, for incidents only.
   *
   * It travels with every Knowledge call made on behalf of an incident route so
   * the incident's own permissions and visibility replace the Knowledge library
   * ACL for that exact document — a reporter without Knowledge rights can read,
   * edit, version and illustrate the review of an incident they can see. The
   * other integrated types keep their historical behaviour (null context).
   */
  private async buildSourceAccessContext(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    userId: string | null | undefined,
    manager: EntityManager,
    opts?: { allowFrozenIncident?: boolean },
  ): Promise<DocumentSourceAccessContext | null> {
    if (
      sourceEntityType !== INCIDENT_REVIEW_SLOT.sourceEntityType
      || slotKey !== INCIDENT_REVIEW_SLOT.slotKey
    ) return null;
    const tenantId = await resolveCurrentTenantId(manager, null);
    const params = { userId, tenantId, incidentId: sourceEntityId };
    return opts?.allowFrozenIncident
      ? buildIncidentReviewImportContext(params)
      : buildIncidentReviewSourceContext(params);
  }

  /**
   * The access a source record gives to its integrated document, once `resolveManagedDocumentId`
   * checked the source permission for `accessMode`: write for an edit, read otherwise. None on the
   * incident review path, which carries its own `sourceContext`.
   */
  private sourceGrant(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    documentId: string,
    accessMode: SourceAccessMode,
    sourceContext: DocumentSourceAccessContext | null,
  ): DocumentSourceGrant | null {
    if (sourceContext) return null;
    return {
      documentId,
      sourceEntityType,
      sourceEntityId,
      slotKey,
      level: accessMode === 'edit' ? 'writer' : 'reader',
    };
  }

  /**
   * The grant a source record's own service carries when it writes that record's integrated
   * document itself (`writeSourceSlotContent`, `syncTitles`: a changed purpose, a rename). The
   * source edit permission is checked here, as `resolveManagedDocumentId` checks it for the
   * integrated-document routes, never taken on the caller's word. No user, no source edit
   * permission, or an incident review (its own `sourceContext`): no grant, and the Knowledge
   * library ACL decides as before.
   */
  private async callerWriteGrant(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    documentId: string,
    userId: string | null | undefined,
    manager: EntityManager,
    sourceContext: DocumentSourceAccessContext | null,
  ): Promise<DocumentSourceGrant | null> {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId || sourceContext) return null;
    const outcome = await this.sourcePermissionOutcome(sourceEntityType, 'edit', normalizedUserId, manager);
    if (outcome !== 'granted') return null;
    return this.sourceGrant(sourceEntityType, sourceEntityId, slotKey, documentId, 'edit', sourceContext);
  }

  private assertSupportedSlot(sourceEntityType: SourceScopedEntityType, slotKey: string): asserts slotKey is IntegratedDocumentSlotKey {
    if (!SUPPORTED_SLOT_KEYS[sourceEntityType]?.has(slotKey)) {
      throw new BadRequestException(`Unsupported integrated document slot: ${slotKey}`);
    }
  }

  private getSlotDefinition(
    sourceEntityType: SourceScopedEntityType,
    slotKey: IntegratedDocumentSlotKey,
  ) {
    const definition = INTEGRATED_DOCUMENT_SLOT_DEFINITIONS.find(
      (entry) => entry.sourceEntityType === sourceEntityType && entry.slotKey === slotKey,
    );
    if (!definition) {
      throw new BadRequestException(`Unsupported integrated document slot: ${sourceEntityType}:${slotKey}`);
    }
    return definition;
  }

  private getSlotDefinitionsForSource(sourceEntityType: SourceScopedEntityType) {
    return INTEGRATED_DOCUMENT_SLOT_DEFINITIONS.filter(
      (entry) => entry.sourceEntityType === sourceEntityType,
    );
  }

  /** `REF - name - slot`, with the slot named by `label` (the English `displayName` by default). */
  private formatManagedTitle(
    sourceEntityType: SourceScopedEntityType,
    source: SourceDescriptor,
    slotKey: IntegratedDocumentSlotKey,
    label?: string,
  ): string {
    const definition = this.getSlotDefinition(sourceEntityType, slotKey);
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];
    const ref = String(source.reference_label || '').trim()
      || (source.item_number && config.referencePrefix ? `${config.referencePrefix}-${source.item_number}` : source.id);
    return `${ref} - ${source.name} - ${label ?? definition.displayName}`;
  }

  /** The titles a managed document may carry: one per known name of its slot (any language). */
  private acceptedManagedTitles(
    sourceEntityType: SourceScopedEntityType,
    source: SourceDescriptor,
    slotKey: IntegratedDocumentSlotKey,
  ): string[] {
    const definition = this.getSlotDefinition(sourceEntityType, slotKey);
    return integratedDocumentSlotLabels(definition).map((label) => this.formatManagedTitle(sourceEntityType, source, slotKey, label));
  }

  /** The slot's name a title ends with, among the known ones; the English one otherwise. */
  private managedTitleLabel(
    sourceEntityType: SourceScopedEntityType,
    slotKey: IntegratedDocumentSlotKey,
    title: string | null | undefined,
  ): string {
    const definition = this.getSlotDefinition(sourceEntityType, slotKey);
    const text = String(title ?? '');
    return integratedDocumentSlotLabels(definition)
      .sort((a, b) => b.length - a.length)
      .find((label) => text.endsWith(` - ${label}`)) ?? definition.displayName;
  }

  /** `users.locale` of the user who creates the document, as an interface language. English when there is no user or no locale. */
  private async creatorLanguage(
    userId: string | null | undefined,
    manager: EntityManager,
  ): Promise<IncidentReviewLanguage> {
    const rows: Array<{ locale: string | null }> = userId
      ? await manager.query(`SELECT locale FROM users WHERE id = $1 AND tenant_id = app_current_tenant()`, [userId])
      : [];
    return incidentReviewLanguage(rows[0]?.locale);
  }

  /** The slot's name in the language of the user who creates the document (`users.locale`), English otherwise. */
  private async creatorSlotLabel(
    sourceEntityType: SourceScopedEntityType,
    slotKey: IntegratedDocumentSlotKey,
    userId: string | null | undefined,
    manager: EntityManager,
  ): Promise<string> {
    return integratedDocumentSlotLabel(
      this.getSlotDefinition(sourceEntityType, slotKey),
      await this.creatorLanguage(userId, manager),
    );
  }

  private getImportChangeNote(sourceEntityType: SourceScopedEntityType): string {
    return sourceEntityType === 'requests'
      ? 'Imported from legacy request field'
      : sourceEntityType === 'interfaces'
        ? 'Imported from legacy interface fields'
      : sourceEntityType === 'applications'
        ? 'Imported from legacy application description'
      : sourceEntityType === 'incidents'
        ? 'Imported from legacy incident fields'
      : 'Imported from legacy project field';
  }

  private getLegacySourceField(
    sourceEntityType: SourceScopedEntityType,
    slotKey: IntegratedDocumentSlotKey,
  ): 'purpose' | 'risks' | 'description' {
    if (sourceEntityType === 'incidents') {
      // The review has never had a mirror column on `incidents`.
      throw new BadRequestException(`Legacy source field not defined for ${sourceEntityType}:${slotKey}`);
    }
    if (sourceEntityType === 'applications' && slotKey === 'overview') {
      return 'description';
    }
    if (slotKey === 'purpose') {
      return 'purpose';
    }
    if (sourceEntityType === 'requests' && slotKey === 'risks_mitigations') {
      return 'risks';
    }
    throw new BadRequestException(`Legacy source field not defined for ${sourceEntityType}:${slotKey}`);
  }

  private getLegacyAttachmentTable(sourceEntityType: SourceScopedEntityType): {
    tableName: 'portfolio_request_attachments' | 'portfolio_project_attachments';
    relationIdColumn: 'request_id' | 'project_id';
    routePrefix: '/portfolio/requests/inline/' | '/portfolio/projects/inline/';
  } {
    if (sourceEntityType === 'incidents') {
      // Incidents never had portfolio inline attachments; falling through to the
      // project table would read another entity's rows.
      throw new BadRequestException(`Legacy inline attachments are not defined for ${sourceEntityType}`);
    }
    if (sourceEntityType === 'requests') {
      return {
        tableName: 'portfolio_request_attachments',
        relationIdColumn: 'request_id',
        routePrefix: '/portfolio/requests/inline/',
      };
    }
    return {
      tableName: 'portfolio_project_attachments',
      relationIdColumn: 'project_id',
      routePrefix: '/portfolio/projects/inline/',
    };
  }

  private normalizeOptionalUserId(value: string | null | undefined): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private firstNonEmpty(values: Array<string | null | undefined>): string | null {
    for (const value of values) {
      const normalized = this.normalizeOptionalUserId(value);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private resolvePreferredOwnerUserId(
    sourceEntityType: SourceScopedEntityType,
    row: RequestBackfillRow | ProjectBackfillRow,
  ): string | null {
    if (sourceEntityType === 'requests') {
      const requestRow = row as RequestBackfillRow;
      return this.firstNonEmpty([
        requestRow.created_by_id,
        requestRow.requestor_id,
        requestRow.it_lead_id,
        requestRow.business_lead_id,
      ]);
    }

    const projectRow = row as ProjectBackfillRow;
    return this.firstNonEmpty([
      projectRow.it_lead_id,
      projectRow.business_lead_id,
    ]);
  }

  private async loadPreferredOwnerUserId(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    manager: EntityManager,
  ): Promise<string | null> {
    if (sourceEntityType === 'applications') {
      const rows = await manager.query<Array<{ user_id: string | null }>>(
        `SELECT user_id::text
         FROM application_owners
         WHERE application_id = $1
           AND tenant_id = app_current_tenant()
         ORDER BY CASE owner_type WHEN 'business' THEN 0 WHEN 'it' THEN 1 ELSE 2 END,
                  created_at ASC,
                  id ASC
         LIMIT 1`,
        [sourceEntityId],
      );
      return this.normalizeOptionalUserId(rows[0]?.user_id);
    }

    if (sourceEntityType === 'interfaces') {
      const rows = await manager.query<Array<{ user_id: string | null }>>(
        `SELECT user_id::text
         FROM interface_owners
         WHERE interface_id = $1
           AND tenant_id = app_current_tenant()
         ORDER BY CASE owner_type WHEN 'business' THEN 0 WHEN 'it' THEN 1 ELSE 2 END,
                  created_at ASC,
                  id ASC
         LIMIT 1`,
        [sourceEntityId],
      );
      return this.normalizeOptionalUserId(rows[0]?.user_id);
    }

    if (sourceEntityType === 'incidents') {
      const rows = await manager.query<Array<{
        owner_user_id: string | null;
        reporter_user_id: string | null;
        created_by: string | null;
      }>>(
        `SELECT owner_user_id::text AS owner_user_id,
                reporter_user_id::text AS reporter_user_id,
                created_by::text AS created_by
         FROM incidents
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        return null;
      }
      return this.firstNonEmpty([
        rows[0].owner_user_id,
        rows[0].reporter_user_id,
        rows[0].created_by,
      ]);
    }

    if (sourceEntityType === 'requests') {
      const rows = await manager.query<Array<{
        created_by_id: string | null;
        requestor_id: string | null;
        it_lead_id: string | null;
        business_lead_id: string | null;
      }>>(
        `SELECT created_by_id,
                requestor_id,
                it_lead_id,
                business_lead_id
         FROM portfolio_requests
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        return null;
      }
      return this.resolvePreferredOwnerUserId(sourceEntityType, {
        id: sourceEntityId,
        tenant_id: '',
        item_number: null,
        name: '',
        purpose: null,
        risks: null,
        created_by_id: rows[0].created_by_id,
        requestor_id: rows[0].requestor_id,
        it_lead_id: rows[0].it_lead_id,
        business_lead_id: rows[0].business_lead_id,
      });
    }

    const rows = await manager.query<Array<{
      it_lead_id: string | null;
      business_lead_id: string | null;
    }>>(
      `SELECT it_lead_id,
              business_lead_id
       FROM portfolio_projects
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [sourceEntityId],
    );
    if (!rows.length) {
      return null;
    }
    return this.resolvePreferredOwnerUserId(sourceEntityType, {
      id: sourceEntityId,
      tenant_id: '',
      item_number: null,
      name: '',
      purpose: null,
      it_lead_id: rows[0].it_lead_id,
      business_lead_id: rows[0].business_lead_id,
    });
  }

  private async loadSourceRecoveryContext(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    manager: EntityManager,
  ): Promise<SourceRecoveryContext> {
    if (sourceEntityType === 'applications') {
      const rows = await manager.query<Array<{
        id: string;
        tenant_id: string;
        sequential_id: string | null;
        name: string;
      }>>(
        `SELECT id::text AS id,
                tenant_id::text AS tenant_id,
                sequential_id,
                name
         FROM applications
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        throw new NotFoundException('application not found');
      }

      const row = rows[0];
      return {
        source: {
          id: row.id,
          tenant_id: row.tenant_id,
          item_number: null,
          name: row.name,
          reference_label: String(row.sequential_id || '').trim() || row.id,
        },
        ownerUserId: await this.loadPreferredOwnerUserId('applications', row.id, manager),
        tenantSlug: await this.loadTenantSlug(row.tenant_id, manager),
      };
    }

    if (sourceEntityType === 'interfaces') {
      const rows = await manager.query<Array<{
        id: string;
        tenant_id: string;
        interface_reference: string | null;
        interface_id: string | null;
        name: string;
      }>>(
        `SELECT id::text AS id,
                tenant_id::text AS tenant_id,
                interface_reference,
                interface_id,
                name
         FROM interfaces
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        throw new NotFoundException('interface not found');
      }

      const row = rows[0];
      return {
        source: {
          id: row.id,
          tenant_id: row.tenant_id,
          item_number: null,
          name: row.name,
          reference_label: String(row.interface_reference || row.interface_id || '').trim() || row.id,
        },
        ownerUserId: await this.loadPreferredOwnerUserId('interfaces', row.id, manager),
        tenantSlug: await this.loadTenantSlug(row.tenant_id, manager),
      };
    }

    if (sourceEntityType === 'incidents') {
      const rows = await manager.query<Array<{
        id: string;
        tenant_id: string;
        item_number: number | null;
        name: string;
      }>>(
        `SELECT id::text AS id,
                tenant_id::text AS tenant_id,
                item_number,
                title AS name
         FROM incidents
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        throw new NotFoundException('incident not found');
      }

      const row = rows[0];
      return {
        source: {
          id: row.id,
          tenant_id: row.tenant_id,
          item_number: row.item_number,
          name: row.name,
          reference_label: row.item_number ? `INC-${row.item_number}` : row.id,
        },
        ownerUserId: await this.loadPreferredOwnerUserId('incidents', row.id, manager),
        tenantSlug: await this.loadTenantSlug(row.tenant_id, manager),
      };
    }

    if (sourceEntityType === 'requests') {
      const rows = await manager.query<Array<{
        id: string;
        tenant_id: string;
        item_number: number | null;
        name: string;
        created_by_id: string | null;
        requestor_id: string | null;
        it_lead_id: string | null;
        business_lead_id: string | null;
      }>>(
        `SELECT id::text AS id,
                tenant_id::text AS tenant_id,
                item_number,
                name,
                created_by_id::text,
                requestor_id::text,
                it_lead_id::text,
                business_lead_id::text
         FROM portfolio_requests
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        throw new NotFoundException('request not found');
      }

      const row = rows[0];
      return {
        source: {
          id: row.id,
          tenant_id: row.tenant_id,
          item_number: row.item_number,
          name: row.name,
          reference_label: row.item_number ? `REQ-${row.item_number}` : row.id,
        },
        ownerUserId: this.resolvePreferredOwnerUserId('requests', {
          id: row.id,
          tenant_id: row.tenant_id,
          item_number: row.item_number,
          name: row.name,
          reference_label: row.item_number ? `REQ-${row.item_number}` : row.id,
          purpose: null,
          risks: null,
          created_by_id: row.created_by_id,
          requestor_id: row.requestor_id,
          it_lead_id: row.it_lead_id,
          business_lead_id: row.business_lead_id,
        }),
        tenantSlug: await this.loadTenantSlug(row.tenant_id, manager),
      };
    }

    const rows = await manager.query<Array<{
      id: string;
      tenant_id: string;
      item_number: number | null;
      name: string;
      it_lead_id: string | null;
      business_lead_id: string | null;
    }>>(
      `SELECT id::text AS id,
              tenant_id::text AS tenant_id,
              item_number,
              name,
              it_lead_id::text,
              business_lead_id::text
       FROM portfolio_projects
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [sourceEntityId],
    );
    if (!rows.length) {
      throw new NotFoundException('project not found');
    }

    const row = rows[0];
    return {
      source: {
        id: row.id,
        tenant_id: row.tenant_id,
        item_number: row.item_number,
        name: row.name,
        reference_label: row.item_number ? `PRJ-${row.item_number}` : row.id,
      },
      ownerUserId: this.resolvePreferredOwnerUserId('projects', {
        id: row.id,
        tenant_id: row.tenant_id,
        item_number: row.item_number,
        name: row.name,
        reference_label: row.item_number ? `PRJ-${row.item_number}` : row.id,
        purpose: null,
        it_lead_id: row.it_lead_id,
        business_lead_id: row.business_lead_id,
      }),
      tenantSlug: await this.loadTenantSlug(row.tenant_id, manager),
    };
  }

  private async loadTenantSlug(tenantId: string, manager: EntityManager): Promise<string> {
    const rows = await manager.query<Array<{ slug: string | null }>>(
      `SELECT slug
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [tenantId],
    );
    const tenantSlug = String(rows[0]?.slug || '').trim();
    return tenantSlug || tenantId;
  }

  private async legacyColumnExists(
    sourceEntityType: SourceScopedEntityType,
    slotKey: IntegratedDocumentSlotKey,
    manager: EntityManager,
  ): Promise<boolean> {
    const legacySourceField = this.getLegacySourceField(sourceEntityType, slotKey);
    const tableName = SOURCE_ENTITY_CONFIG[sourceEntityType].sourceTable;
    const cacheKey = `${tableName}:${legacySourceField}`;
    const cached = this.legacyColumnExistsCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const rows = await manager.query<Array<{ present: number }>>(
      `SELECT 1 AS present
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
       LIMIT 1`,
      [tableName, legacySourceField],
    );
    const exists = rows.length > 0;
    this.legacyColumnExistsCache.set(cacheKey, exists);
    return exists;
  }

  private async loadLatestAuditFieldValue(
    tableName: 'portfolio_requests' | 'portfolio_projects' | 'applications',
    recordId: string,
    fieldName: 'purpose' | 'risks' | 'description',
    manager: EntityManager,
  ): Promise<string | null | undefined> {
    const rows = await manager.query<Array<{ field_value: string | null }>>(
      `SELECT after_json ->> $1 AS field_value
       FROM audit_log
       WHERE tenant_id = app_current_tenant()
         AND table_name = $2
         AND record_id = $3
         AND after_json ? $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [fieldName, tableName, recordId],
    );
    if (!rows.length) {
      return undefined;
    }
    return rows[0].field_value ?? null;
  }

  private async loadInterfaceBackfillRow(
    sourceEntityId: string,
    manager: EntityManager,
  ): Promise<InterfaceBackfillRow> {
    const rows = await manager.query<Array<{
      id: string;
      tenant_id: string;
      interface_reference: string | null;
      interface_id: string | null;
      name: string;
      business_purpose: string | null;
      overview_notes: string | null;
      impact_of_failure: string | null;
      business_objects: unknown | null;
      main_use_cases: string | null;
      functional_rules: string | null;
      core_transformations_summary: string | null;
      error_handling_summary: string | null;
      typical_data: string | null;
      audit_logging: string | null;
      security_controls_summary: string | null;
    }>>(
      `SELECT id::text AS id,
              tenant_id::text AS tenant_id,
              interface_reference,
              interface_id,
              name,
              business_purpose,
              overview_notes,
              impact_of_failure,
              business_objects,
              main_use_cases,
              functional_rules,
              core_transformations_summary,
              error_handling_summary,
              typical_data,
              audit_logging,
              security_controls_summary
       FROM interfaces
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [sourceEntityId],
    );
    if (!rows.length) {
      throw new NotFoundException('interface not found');
    }

    const row = rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      item_number: null,
      name: row.name,
      reference_label: String(row.interface_reference || row.interface_id || '').trim() || row.id,
      business_purpose: row.business_purpose,
      overview_notes: row.overview_notes,
      impact_of_failure: row.impact_of_failure,
      business_objects: row.business_objects,
      main_use_cases: row.main_use_cases,
      functional_rules: row.functional_rules,
      core_transformations_summary: row.core_transformations_summary,
      error_handling_summary: row.error_handling_summary,
      typical_data: row.typical_data,
      audit_logging: row.audit_logging,
      security_controls_summary: row.security_controls_summary,
    };
  }

  private async loadApplicationBackfillRow(
    sourceEntityId: string,
    manager: EntityManager,
  ): Promise<ApplicationBackfillRow> {
    const rows = await manager.query<Array<{
      id: string;
      tenant_id: string;
      sequential_id: string | null;
      name: string;
      description: string | null;
    }>>(
      `SELECT id::text AS id,
              tenant_id::text AS tenant_id,
              sequential_id,
              name,
              description
       FROM applications
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [sourceEntityId],
    );
    if (!rows.length) {
      throw new NotFoundException('application not found');
    }

    const row = rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      item_number: null,
      name: row.name,
      reference_label: String(row.sequential_id || '').trim() || row.id,
      description: row.description,
    };
  }

  private async loadRecoveredSlotContent(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: IntegratedDocumentSlotKey,
    manager: EntityManager,
    language?: IncidentReviewLanguage,
  ): Promise<RecoveredSlotContent> {
    if (sourceEntityType === 'applications') {
      const row = await this.loadApplicationBackfillRow(sourceEntityId, manager);
      return {
        content: await prepareRecoveredContent(row.description),
        source: 'legacy',
        unresolvedLegacyInlineAttachmentIds: [],
      };
    }

    if (sourceEntityType === 'interfaces') {
      const row = await this.loadInterfaceBackfillRow(sourceEntityId, manager);
      return {
        content: await interfaceSpecificationMarkdown(row, language),
        source: 'legacy',
        unresolvedLegacyInlineAttachmentIds: [],
      };
    }

    if (sourceEntityType === 'incidents') {
      const rows = await manager.query<Array<{ status: string }>>(
        `SELECT status
         FROM incidents
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        throw new NotFoundException('incident not found');
      }
      // A closed or cancelled incident whose review is missing is an integrity fault.
      // A read, a PDF export or the chat must never mint a fresh review from today's
      // template for a frozen record; run `npm run integrated-docs:backfill` instead.
      if (rows[0].status === 'closed' || rows[0].status === 'cancelled') {
        throw new NotFoundException(
          `Integrated document missing for a ${rows[0].status} incident and cannot be recreated automatically (${sourceEntityType}:${slotKey}:${sourceEntityId})`,
        );
      }
      return {
        content: null,
        source: 'legacy',
        unresolvedLegacyInlineAttachmentIds: [],
      };
    }

    const legacySourceField = this.getLegacySourceField(sourceEntityType, slotKey);
    if (await this.legacyColumnExists(sourceEntityType, slotKey, manager)) {
      const rows = await manager.query<Array<{ content: string | null }>>(
        `SELECT ${legacySourceField} AS content
         FROM ${SOURCE_ENTITY_CONFIG[sourceEntityType].sourceTable}
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [sourceEntityId],
      );
      if (!rows.length) {
        throw new NotFoundException(`${sourceEntityType.slice(0, -1)} not found`);
      }
      const content = await prepareRecoveredContent(rows[0].content ?? null);
      return {
        content,
        source: 'legacy',
        unresolvedLegacyInlineAttachmentIds: [],
      };
    }

    const auditSourceTable = SOURCE_ENTITY_CONFIG[sourceEntityType].sourceTable as 'portfolio_requests' | 'portfolio_projects' | 'applications';
    const auditContent = await this.loadLatestAuditFieldValue(
      auditSourceTable,
      sourceEntityId,
      legacySourceField,
      manager,
    );
    if (auditContent === undefined) {
      throw new NotFoundException(
        `Integrated document missing and no recovery source is available for ${sourceEntityType}:${slotKey}`,
      );
    }
    const content = await prepareRecoveredContent(auditContent);
    return {
      content,
      source: 'audit',
      unresolvedLegacyInlineAttachmentIds: this.extractAnyLegacyInlineAttachmentIds(content || ''),
    };
  }

  /** The inline images of a Markdown text (Markdown workers), with their rewrite. */
  private async collectInlineImageOccurrences(content: string | null | undefined): Promise<InlineImageOccurrence[]> {
    const references = await findInlineImageReferences(content, { fieldName: 'content_markdown' });
    return references.map(({ raw, target }) => ({
      raw,
      target,
      rewrite: (nextTarget: string) => raw.replace(target, nextTarget),
    }));
  }

  private applyInlineImageReplacements(
    content: string | null | undefined,
    replacements: Array<{ raw: string; replacement: string }>,
  ): string {
    const text = String(content || '');
    if (replacements.length === 0) {
      return text;
    }

    let cursor = 0;
    let output = '';
    for (const entry of replacements) {
      const nextIndex = text.indexOf(entry.raw, cursor);
      if (nextIndex < 0) {
        throw new BadRequestException('Failed to rewrite recovered inline image content');
      }
      output += text.slice(cursor, nextIndex);
      output += entry.replacement;
      cursor = nextIndex + entry.raw.length;
    }

    output += text.slice(cursor);
    return output;
  }

  private inlineImageExtensionFromMimeType(mimeType: string): string {
    switch (String(mimeType || '').toLowerCase()) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
        return 'jpg';
      case 'image/gif':
        return 'gif';
      case 'image/webp':
        return 'webp';
      default:
        throw new BadRequestException('Unsupported image type. Allowed: PNG, JPG, JPEG, GIF, WEBP');
    }
  }

  private parseDataImageUri(
    target: string | null | undefined,
  ): { mimeType: string; buffer: Buffer; extension: string } | null {
    const normalized = String(target || '').trim();
    const match = normalized.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
    if (!match) {
      return null;
    }

    const metaEnd = normalized.indexOf(',');
    if (metaEnd < 0) {
      throw new BadRequestException('Invalid inline image data URI');
    }

    const base64Part = normalized.slice(metaEnd + 1).replace(/\s+/g, '');
    const buffer = Buffer.from(base64Part, 'base64');
    if (buffer.length === 0) {
      throw new BadRequestException('Invalid inline image payload');
    }

    const mimeType = String(match[1] || '').toLowerCase();
    return {
      mimeType,
      buffer,
      extension: this.inlineImageExtensionFromMimeType(mimeType),
    };
  }

  private parseLegacyInlineAttachmentId(
    target: string | null | undefined,
    sourceEntityType: SourceScopedEntityType,
  ): string | null {
    const normalized = String(target || '').trim();
    if (!normalized) {
      return null;
    }
    if (sourceEntityType === 'interfaces') {
      return null;
    }
    const { routePrefix } = this.getLegacyAttachmentTable(sourceEntityType);
    const match = normalized.match(
      new RegExp(`${this.escapeRegExp(routePrefix)}[^/]+/([a-f0-9-]+)(?=[/?#]|$)`, 'i'),
    );
    return match?.[1] || null;
  }

  private async collectRecoverableInlineImageOccurrences(
    content: string | null | undefined,
    sourceEntityType: SourceScopedEntityType,
    opts?: { includeLegacyAttachmentRefs?: boolean },
  ): Promise<RecoverableInlineImageOccurrence[]> {
    const occurrences = await this.collectInlineImageOccurrences(content);
    const recoverable: RecoverableInlineImageOccurrence[] = [];

    for (const occurrence of occurrences) {
      const dataImage = this.parseDataImageUri(occurrence.target);
      if (dataImage) {
        recoverable.push({
          ...occurrence,
          kind: 'data',
          mimeType: dataImage.mimeType,
          buffer: dataImage.buffer,
          extension: dataImage.extension,
        });
        continue;
      }

      if (opts?.includeLegacyAttachmentRefs === false) {
        continue;
      }

      const attachmentId = this.parseLegacyInlineAttachmentId(occurrence.target, sourceEntityType);
      if (attachmentId) {
        recoverable.push({
          ...occurrence,
          kind: 'legacy',
          attachmentId,
        });
      }
    }

    return recoverable;
  }

  /**
   * Whether a recovered text holds inline base64 images. A text the Markdown
   * workers cannot process in time is kept as it is: no image is taken out of it.
   */
  private async recoveredContentHasDataImage(content: string | null | undefined): Promise<boolean> {
    try {
      return await containsInlineDataImage(String(content || ''), { fieldName: 'content_markdown' });
    } catch (error) {
      if (isMarkdownTooComplex(error)) return false;
      throw error;
    }
  }

  private async resolveRecoveredInitialContent(content: string | null | undefined): Promise<string> {
    if (await this.recoveredContentHasDataImage(content)) {
      return '';
    }
    return await normalizeMarkdownRichText(content, {
      fieldName: 'content_markdown',
      enforceSizeLimit: false,
    }) || '';
  }

  private buildRecoveredInlineImageFile(
    occurrence: Extract<RecoverableInlineImageOccurrence, { kind: 'data' }>,
    index: number,
  ): Express.Multer.File {
    const originalname = `recovered-inline-${index + 1}.${occurrence.extension}`;
    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype: occurrence.mimeType,
      size: occurrence.buffer.length,
      buffer: occurrence.buffer,
      destination: '',
      filename: originalname,
      path: '',
      stream: undefined as any,
    } as Express.Multer.File;
  }

  private async hasOwningRelationRow(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    documentId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];
    if (!config.relationTable || !config.relationIdColumn) {
      return false;
    }
    const rows = await manager.query(
      `SELECT 1
       FROM ${config.relationTable}
       WHERE tenant_id = app_current_tenant()
         AND document_id = $1
         AND ${config.relationIdColumn} = $2
       LIMIT 1`,
      [documentId, sourceEntityId],
    );
    return rows.length > 0;
  }

  private async ensureOwningRelationRow(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    documentId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];
    if (!config.relationTable || !config.relationIdColumn) {
      return false;
    }
    if (await this.hasOwningRelationRow(sourceEntityType, sourceEntityId, documentId, manager)) {
      return false;
    }

    const sourceRows = await manager.query<Array<{ tenant_id: string }>>(
      `SELECT tenant_id::text AS tenant_id
       FROM ${config.sourceTable}
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [sourceEntityId],
    );
    if (!sourceRows.length) {
      throw new NotFoundException(`${sourceEntityType.slice(0, -1)} not found`);
    }

    await manager.query(
      `INSERT INTO ${config.relationTable} (tenant_id, document_id, ${config.relationIdColumn})
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, ${config.relationIdColumn}) DO NOTHING`,
      [sourceRows[0].tenant_id, documentId, sourceEntityId],
    );
    return true;
  }

  private async ensurePrimaryOwnerContributor(
    documentId: string,
    ownerUserId: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    const normalizedOwnerUserId = this.normalizeOptionalUserId(ownerUserId);
    if (!normalizedOwnerUserId) {
      return;
    }

    const userRows = await manager.query<Array<{ id: string }>>(
      `SELECT id
       FROM users
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [normalizedOwnerUserId],
    );
    if (!userRows.length) {
      return;
    }

    await manager.query(
      `UPDATE document_contributors
       SET is_primary = false
       WHERE tenant_id = app_current_tenant()
         AND document_id = $1
         AND role = 'owner'
         AND user_id <> $2`,
      [documentId, normalizedOwnerUserId],
    );
    await manager.query(
      `INSERT INTO document_contributors (
         tenant_id,
         document_id,
         user_id,
         role,
         is_primary
       )
       VALUES (app_current_tenant(), $1, $2, 'owner', true)
       ON CONFLICT (document_id, user_id, role)
       DO UPDATE SET
         is_primary = EXCLUDED.is_primary`,
      [documentId, normalizedOwnerUserId],
    );
  }

  private async getSlotSetting(
    sourceEntityType: SourceScopedEntityType,
    slotKey: IntegratedDocumentSlotKey,
    manager: EntityManager,
  ): Promise<SlotSettingRecord> {
    const rows = await manager.query<Array<SlotSettingRecord>>(
      `SELECT s.source_entity_type,
              s.slot_key,
              s.display_name,
              s.folder_id,
              f.library_id,
              s.document_type_id,
              s.template_document_id,
              td.content_markdown AS template_content_markdown
       FROM integrated_document_slot_settings s
       JOIN document_folders f ON f.id = s.folder_id AND f.tenant_id = s.tenant_id
       LEFT JOIN documents td ON td.id = s.template_document_id AND td.tenant_id = s.tenant_id
       WHERE s.tenant_id = app_current_tenant()
         AND s.source_entity_type = $1
         AND s.slot_key = $2
         AND s.is_active = true
       LIMIT 1`,
      [sourceEntityType, slotKey],
    );
    if (!rows.length) {
      throw new NotFoundException(`Integrated document slot setting not found for ${sourceEntityType}:${slotKey}`);
    }
    return rows[0];
  }

  private async findBinding(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: IntegratedDocumentSlotKey,
    manager: EntityManager,
  ): Promise<IntegratedDocumentBinding | null> {
    return manager.getRepository(IntegratedDocumentBinding).findOne({
      where: {
        source_entity_type: sourceEntityType,
        source_entity_id: sourceEntityId,
        slot_key: slotKey,
      } as any,
    });
  }

  private async getDocumentOrThrow(documentId: string, manager: EntityManager): Promise<Document> {
    const document = await manager.getRepository(Document).findOne({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException('Integrated document not found');
    }
    return document;
  }

  private async resolveInitialContent(
    explicitContent: string | null | undefined,
    templateContent: string | null | undefined,
    opts?: { useTemplateWhenBlank?: boolean; storedContent?: boolean },
  ): Promise<string> {
    const normalizedExplicit = await normalizeMarkdownRichText(explicitContent, {
      fieldName: 'content_markdown',
      enforceSizeLimit: !opts?.storedContent,
    }) || '';
    if (normalizedExplicit) {
      return normalizedExplicit;
    }
    if (opts?.useTemplateWhenBlank === false) {
      return '';
    }
    // The template is a stored document: it keeps whatever size it has.
    return await normalizeMarkdownRichText(templateContent, {
      fieldName: 'content_markdown',
      enforceSizeLimit: false,
    }) || '';
  }

  private async logSourceSemanticActivity(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: IntegratedDocumentSlotKey,
    tenantId: string,
    userId: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    // Interfaces, applications and incidents keep no per-edit entry: the incident
    // journal records lifecycle events, not review content edits.
    if (
      sourceEntityType === 'interfaces'
      || sourceEntityType === 'applications'
      || sourceEntityType === 'incidents'
    ) {
      return;
    }

    const repo = manager.getRepository(PortfolioActivity);
    await repo.save(repo.create({
      tenant_id: tenantId,
      request_id: sourceEntityType === 'requests' ? sourceEntityId : null,
      project_id: sourceEntityType === 'projects' ? sourceEntityId : null,
      author_id: userId || null,
      type: 'change',
      // The slot key is stored instead of a rendered sentence so the activity
      // feed can label the change in the reader's language.
      changed_fields: { document_updated: [null, slotKey] },
    }));
    // The project's history reads the edit as "Document modified: Purpose", from the slot alone.
    if (sourceEntityType === 'projects') {
      await writeAuditLog(manager, {
        table: 'portfolio_project_documents',
        recordId: sourceEntityId,
        action: 'update',
        before: null,
        after: { slot: slotKey },
        userId: userId || null,
      });
    }
  }

  private extractKnowledgeInlineAttachmentIds(content: string): string[] {
    const attachmentIds = new Set<string>();
    for (const url of extractInlineImageUrls(content)) {
      const match = url.match(/\/knowledge\/inline\/[^/]+\/([a-f0-9-]+)(?=[/?#]|$)/i);
      if (match?.[1]) {
        attachmentIds.add(match[1]);
      }
    }
    return Array.from(attachmentIds);
  }

  private extractLegacyInlineAttachmentIds(
    content: string,
    sourceEntityType: SourceScopedEntityType,
  ): string[] {
    const { routePrefix } = this.getLegacyAttachmentTable(sourceEntityType);
    const attachmentIds = new Set<string>();
    for (const url of extractInlineImageUrls(content)) {
      const match = url.match(
        new RegExp(`${this.escapeRegExp(routePrefix)}[^/]+/([a-f0-9-]+)(?=[/?#]|$)`, 'i'),
      );
      if (match?.[1]) {
        attachmentIds.add(match[1]);
      }
    }
    return Array.from(attachmentIds);
  }

  private extractAnyLegacyInlineAttachmentIds(content: string): string[] {
    const attachmentIds = new Set<string>();
    for (const url of extractInlineImageUrls(content)) {
      const match = url.match(/\/portfolio\/(?:requests|projects)\/inline\/[^/]+\/([a-f0-9-]+)(?=[/?#]|$)/i);
      if (match?.[1]) {
        attachmentIds.add(match[1]);
      }
    }
    return Array.from(attachmentIds);
  }

  private rewriteKnowledgeInlineAttachmentIds(
    content: string,
    mappings: Array<{ sourceAttachmentId: string; clonedAttachmentId: string }>,
  ): string {
    let rewritten = content;
    for (const mapping of mappings) {
      const escaped = this.escapeRegExp(mapping.sourceAttachmentId);
      const pattern = new RegExp(
        `([^"'\\s)]*?/knowledge/inline/[^/]+/)${escaped}(?=(?:[/?#)"'\\s]|$))`,
        'g',
      );
      rewritten = rewritten.replace(pattern, `$1${mapping.clonedAttachmentId}`);
    }
    return rewritten;
  }

  private rewriteLegacyInlineAttachmentIds(
    content: string,
    sourceEntityType: SourceScopedEntityType,
    tenantSlug: string,
    mappings: Array<{ sourceAttachmentId: string; clonedAttachmentId: string }>,
  ): string {
    const { routePrefix } = this.getLegacyAttachmentTable(sourceEntityType);
    let rewritten = content;
    for (const mapping of mappings) {
      const escaped = this.escapeRegExp(mapping.sourceAttachmentId);
      const pattern = new RegExp(
        `${this.escapeRegExp(routePrefix)}[^/]+/${escaped}(?=(?:[/?#)"'\\s]|$))`,
        'g',
      );
      rewritten = rewritten.replace(
        pattern,
        this.buildManagedInlineAttachmentPath(tenantSlug, mapping.clonedAttachmentId),
      );
    }
    return rewritten;
  }

  private buildManagedInlineAttachmentPath(tenantSlug: string, attachmentId: string): string {
    return `/api/knowledge/inline/${tenantSlug}/${attachmentId}`;
  }

  private escapeRegExp(value: string): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async loadLegacyAttachmentRows(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    sourceField: 'purpose' | 'risks' | 'description',
    attachmentIds: string[],
    manager: EntityManager,
  ): Promise<LegacyAttachmentRow[]> {
    const normalizedAttachmentIds = Array.from(new Set(attachmentIds.map((value) => String(value || '').trim()).filter(Boolean)));
    if (normalizedAttachmentIds.length === 0) {
      return [];
    }

    const { tableName, relationIdColumn } = this.getLegacyAttachmentTable(sourceEntityType);
    return manager.query<Array<LegacyAttachmentRow>>(
      `SELECT id,
              original_filename,
              stored_filename,
              mime_type,
              size,
              storage_path,
              source_field
       FROM ${tableName}
       WHERE ${relationIdColumn} = $1
         AND source_field = $2
         AND id = ANY($3::uuid[])
       ORDER BY created_at ASC`,
      [sourceEntityId, sourceField, normalizedAttachmentIds],
    );
  }

  private async importLegacyInlineAttachments(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    sourceField: 'purpose' | 'risks',
    documentId: string,
    tenantId: string,
    tenantSlug: string,
    content: string,
    userId: string | null | undefined,
    manager: EntityManager,
  ): Promise<{
    content_markdown: string;
    mappings: Array<{ sourceAttachmentId: string; clonedAttachmentId: string }>;
  }> {
    const referencedAttachmentIds = this.extractLegacyInlineAttachmentIds(content, sourceEntityType);
    if (referencedAttachmentIds.length === 0) {
      return {
        content_markdown: content,
        mappings: [],
      };
    }

    const legacyAttachments = await this.loadLegacyAttachmentRows(
      sourceEntityType,
      sourceEntityId,
      sourceField,
      referencedAttachmentIds,
      manager,
    );
    if (legacyAttachments.length !== referencedAttachmentIds.length) {
      throw new NotFoundException(`Missing legacy inline attachment rows for ${sourceEntityType}:${sourceField}`);
    }

    const attachmentById = new Map<string, LegacyAttachmentRow>();
    for (const attachment of legacyAttachments) {
      attachmentById.set(String(attachment.id), attachment);
    }

    const attachmentRepo = manager.getRepository(DocumentAttachment);
    const mappings: Array<{ sourceAttachmentId: string; clonedAttachmentId: string }> = [];
    for (const referencedAttachmentId of referencedAttachmentIds) {
      const legacyAttachment = attachmentById.get(referencedAttachmentId);
      if (!legacyAttachment) {
        throw new NotFoundException(`Legacy inline attachment ${referencedAttachmentId} not found`);
      }

      const saved = await attachmentRepo.save(attachmentRepo.create({
        tenant_id: tenantId,
        document_id: documentId,
        original_filename: legacyAttachment.original_filename,
        stored_filename: legacyAttachment.stored_filename,
        mime_type: legacyAttachment.mime_type,
        size: Number(legacyAttachment.size || 0),
        storage_path: legacyAttachment.storage_path,
        source_field: 'content_markdown',
        uploaded_by_id: userId || null,
      }));

      mappings.push({
        sourceAttachmentId: referencedAttachmentId,
        clonedAttachmentId: saved.id,
      });
    }

    return {
      content_markdown: this.rewriteLegacyInlineAttachmentIds(
        content,
        sourceEntityType,
        tenantSlug,
        mappings,
      ),
      mappings,
    };
  }

  private async importRecoveredInlineImages(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: IntegratedDocumentSlotKey,
    documentId: string,
    tenantId: string,
    tenantSlug: string,
    content: string | null | undefined,
    userId: string | null | undefined,
    manager: EntityManager,
    opts?: { includeLegacyAttachmentRefs?: boolean },
  ): Promise<{
    content_markdown: string;
    legacyMappings: Array<{ sourceAttachmentId: string; clonedAttachmentId: string }>;
    dataImageAttachmentIds: string[];
  }> {
    let recoverable: RecoverableInlineImageOccurrence[];
    try {
      recoverable = await this.collectRecoverableInlineImageOccurrences(
        content,
        sourceEntityType,
        { includeLegacyAttachmentRefs: opts?.includeLegacyAttachmentRefs !== false },
      );
    } catch (error) {
      // A text the Markdown workers cannot process in time is kept as it is.
      if (!isMarkdownTooComplex(error)) throw error;
      recoverable = [];
    }

    if (recoverable.length === 0) {
      return {
        content_markdown: await normalizeMarkdownRichText(content, {
          fieldName: 'content_markdown',
          enforceSizeLimit: false,
        }) || '',
        legacyMappings: [],
        dataImageAttachmentIds: [],
      };
    }

    const legacySourceField = this.getLegacySourceField(sourceEntityType, slotKey);
    const legacyAttachmentIds = Array.from(new Set(
      recoverable
        .filter((occurrence): occurrence is Extract<RecoverableInlineImageOccurrence, { kind: 'legacy' }> => (
          occurrence.kind === 'legacy'
        ))
        .map((occurrence) => occurrence.attachmentId),
    ));

    const legacyById = new Map<string, LegacyAttachmentRow>();
    if (legacyAttachmentIds.length > 0) {
      const legacyAttachments = await this.loadLegacyAttachmentRows(
        sourceEntityType,
        sourceEntityId,
        legacySourceField,
        legacyAttachmentIds,
        manager,
      );
      if (legacyAttachments.length !== legacyAttachmentIds.length) {
        throw new NotFoundException(`Missing legacy inline attachment rows for ${sourceEntityType}:${legacySourceField}`);
      }
      for (const legacyAttachment of legacyAttachments) {
        legacyById.set(String(legacyAttachment.id), legacyAttachment);
      }
    }

    const attachmentRepo = manager.getRepository(DocumentAttachment);
    const replacements: Array<{ raw: string; replacement: string }> = [];
    const legacyMappings: Array<{ sourceAttachmentId: string; clonedAttachmentId: string }> = [];
    const dataImageAttachmentIds: string[] = [];

    for (let index = 0; index < recoverable.length; index += 1) {
      const occurrence = recoverable[index];
      if (occurrence.kind === 'data') {
        const uploaded = await this.knowledge.uploadAttachment(
          documentId,
          this.buildRecoveredInlineImageFile(occurrence, index),
          userId || null,
          {
            manager,
            sourceField: 'content_markdown',
          },
        );
        dataImageAttachmentIds.push(uploaded.id);
        replacements.push({
          raw: occurrence.raw,
          replacement: occurrence.rewrite(
            this.buildManagedInlineAttachmentPath(tenantSlug, uploaded.id),
          ),
        });
        continue;
      }

      const legacyAttachment = legacyById.get(occurrence.attachmentId);
      if (!legacyAttachment) {
        throw new NotFoundException(`Legacy inline attachment ${occurrence.attachmentId} not found`);
      }

      const saved = await attachmentRepo.save(attachmentRepo.create({
        tenant_id: tenantId,
        document_id: documentId,
        original_filename: legacyAttachment.original_filename,
        stored_filename: legacyAttachment.stored_filename,
        mime_type: legacyAttachment.mime_type,
        size: Number(legacyAttachment.size || 0),
        storage_path: legacyAttachment.storage_path,
        source_field: 'content_markdown',
        uploaded_by_id: userId || null,
      }));

      legacyMappings.push({
        sourceAttachmentId: occurrence.attachmentId,
        clonedAttachmentId: saved.id,
      });
      replacements.push({
        raw: occurrence.raw,
        replacement: occurrence.rewrite(
          this.buildManagedInlineAttachmentPath(tenantSlug, saved.id),
        ),
      });
    }

    return {
      content_markdown: await normalizeMarkdownRichText(
        this.applyInlineImageReplacements(content, replacements),
        {
          fieldName: 'content_markdown',
          enforceSizeLimit: false,
        },
      ) || '',
      legacyMappings,
      dataImageAttachmentIds,
    };
  }

  private async rewriteRecoveredInlineImagesForVerification(
    sourceEntityType: SourceScopedEntityType,
    tenantSlug: string,
    content: string | null | undefined,
    managedAttachmentIds: string[],
    contextLabel: string,
    opts?: { includeLegacyAttachmentRefs?: boolean },
  ): Promise<{
    content_markdown: string;
    assignments: RecoverableInlineImageAssignment[];
  }> {
    const recoverable = await this.collectRecoverableInlineImageOccurrences(
      content,
      sourceEntityType,
      { includeLegacyAttachmentRefs: opts?.includeLegacyAttachmentRefs !== false },
    );
    if (recoverable.length !== managedAttachmentIds.length) {
      throw new Error(`Managed inline attachment count mismatch for ${contextLabel}`);
    }

    const replacements: Array<{ raw: string; replacement: string }> = [];
    const assignments: RecoverableInlineImageAssignment[] = [];

    for (let index = 0; index < recoverable.length; index += 1) {
      const occurrence = recoverable[index];
      const attachmentId = String(managedAttachmentIds[index] || '').trim();
      if (!attachmentId) {
        throw new Error(`Managed inline attachment mapping missing for ${contextLabel}`);
      }

      replacements.push({
        raw: occurrence.raw,
        replacement: occurrence.rewrite(
          this.buildManagedInlineAttachmentPath(tenantSlug, attachmentId),
        ),
      });

      if (occurrence.kind === 'data') {
        assignments.push({
          kind: 'data',
          attachmentId,
          mimeType: occurrence.mimeType,
          size: occurrence.buffer.length,
        });
        continue;
      }

      assignments.push({
        kind: 'legacy',
        attachmentId,
        sourceAttachmentId: occurrence.attachmentId,
      });
    }

    return {
      content_markdown: this.applyInlineImageReplacements(content, replacements),
      assignments,
    };
  }

  private async assertRecoveredInlineImagesMatchDocument(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: IntegratedDocumentSlotKey,
    tenantSlug: string,
    recoveredContent: string | null | undefined,
    documentId: string,
    normalizedDocumentContent: string,
    manager: EntityManager,
    opts?: { includeLegacyAttachmentRefs?: boolean },
  ): Promise<void> {
    const managedAttachmentIds = this.extractKnowledgeInlineAttachmentIds(normalizedDocumentContent);
    const contextLabel = `${sourceEntityType}:${slotKey}:${sourceEntityId}`;
    const rewritten = await this.rewriteRecoveredInlineImagesForVerification(
      sourceEntityType,
      tenantSlug,
      recoveredContent,
      managedAttachmentIds,
      contextLabel,
      { includeLegacyAttachmentRefs: opts?.includeLegacyAttachmentRefs !== false },
    );

    const managedAttachments = await manager.query<Array<ManagedAttachmentRow>>(
      `SELECT id,
              original_filename,
              mime_type,
              size,
              storage_path,
              source_field
       FROM document_attachments
       WHERE tenant_id = app_current_tenant()
         AND document_id = $1
         AND source_field = 'content_markdown'`,
      [documentId],
    );
    if (managedAttachments.length !== managedAttachmentIds.length) {
      throw new Error(`Managed attachment row mismatch for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
    }

    const managedAttachmentIdsSet = new Set(managedAttachmentIds);
    if (managedAttachments.some((attachment) => !managedAttachmentIdsSet.has(String(attachment.id)))) {
      throw new Error(`Managed attachment rows are not fully referenced by content for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
    }

    const managedById = new Map<string, ManagedAttachmentRow>(
      managedAttachments.map((attachment) => [String(attachment.id), attachment]),
    );

    const legacyAssignments = rewritten.assignments
      .filter((assignment): assignment is Extract<RecoverableInlineImageAssignment, { kind: 'legacy' }> => (
        assignment.kind === 'legacy'
      ));
    if (legacyAssignments.length > 0) {
      const legacySourceField = this.getLegacySourceField(sourceEntityType, slotKey);
      const legacyAttachments = await this.loadLegacyAttachmentRows(
        sourceEntityType,
        sourceEntityId,
        legacySourceField,
        legacyAssignments.map((assignment) => assignment.sourceAttachmentId),
        manager,
      );
      if (legacyAttachments.length !== legacyAssignments.length) {
        throw new Error(`Legacy inline attachment row mismatch for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
      }

      const legacyById = new Map<string, LegacyAttachmentRow>(
        legacyAttachments.map((attachment) => [String(attachment.id), attachment]),
      );

      for (const assignment of legacyAssignments) {
        const legacyAttachment = legacyById.get(assignment.sourceAttachmentId);
        const managedAttachment = managedById.get(assignment.attachmentId);
        if (!legacyAttachment || !managedAttachment) {
          throw new Error(`Inline attachment mapping missing for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
        }
        if (managedAttachment.source_field !== 'content_markdown') {
          throw new Error(`Managed inline attachment source_field mismatch for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
        }
        if (
          managedAttachment.storage_path !== legacyAttachment.storage_path
          || managedAttachment.original_filename !== legacyAttachment.original_filename
          || managedAttachment.mime_type !== legacyAttachment.mime_type
          || Number(managedAttachment.size || 0) !== Number(legacyAttachment.size || 0)
        ) {
          throw new Error(`Managed inline attachment metadata mismatch for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
        }
      }
    }

    for (const assignment of rewritten.assignments) {
      if (assignment.kind !== 'data') {
        continue;
      }
      const managedAttachment = managedById.get(assignment.attachmentId);
      if (!managedAttachment) {
        throw new Error(`Managed inline attachment mapping missing for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
      }
      if (managedAttachment.source_field !== 'content_markdown') {
        throw new Error(`Managed inline attachment source_field mismatch for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
      }
      if (
        String(managedAttachment.mime_type || '').toLowerCase() !== assignment.mimeType
        || Number(managedAttachment.size || 0) !== assignment.size
      ) {
        throw new Error(`Recovered data image metadata mismatch for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
      }
    }

    const normalizedExpectedContent = await normalizeMarkdownRichText(rewritten.content_markdown, {
      fieldName: 'content_markdown',
      enforceSizeLimit: false,
    }) || '';
    if (normalizedExpectedContent !== normalizedDocumentContent) {
      throw new Error(`Managed document content mismatch for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
    }
  }

  private async assertSourcePermission(
    sourceEntityType: SourceScopedEntityType,
    accessMode: SourceAccessMode,
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];
    const requiredLevel = accessMode === 'edit' ? config.editLevel : config.readLevel;
    const outcome = await this.sourcePermissionOutcome(sourceEntityType, accessMode, userId, manager);
    if (outcome === 'unknown-user') {
      throw new ForbiddenException('User not found');
    }
    if (outcome === 'denied') {
      throw moduleRightRequired(config.permissionResource, requiredLevel, `${config.permissionResource}:${requiredLevel} permission is required`);
    }
  }

  /** The source permission check of `assertSourcePermission`, as an outcome instead of an exception. */
  private async sourcePermissionOutcome(
    sourceEntityType: SourceScopedEntityType,
    accessMode: SourceAccessMode,
    userId: string,
    manager: EntityManager,
  ): Promise<'granted' | 'denied' | 'unknown-user'> {
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];
    const requiredLevel = accessMode === 'edit' ? config.editLevel : config.readLevel;

    const userRows = await manager.query(
      `SELECT u.role_id,
              lower(coalesce(r.role_name, '')) AS primary_role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
       WHERE u.id = $1
         AND u.tenant_id = app_current_tenant()
       LIMIT 1`,
      [userId],
    ) as Array<{ role_id: string | null; primary_role_name: string }>;
    if (!userRows.length) {
      return 'unknown-user';
    }

    const extraRoleRows = await manager.query(
      `SELECT ur.role_id,
              lower(coalesce(r.role_name, '')) AS role_name
       FROM user_roles ur
       LEFT JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
       WHERE ur.user_id = $1
         AND ur.tenant_id = app_current_tenant()`,
      [userId],
    ) as Array<{ role_id: string | null; role_name: string }>;

    const roleNames = new Set<string>([
      String(userRows[0].primary_role_name || ''),
      ...extraRoleRows.map((row) => String(row.role_name || '')),
    ]);
    if (roleNames.has('administrator')) {
      return 'granted';
    }

    const roleIds = Array.from(new Set([
      userRows[0].role_id,
      ...extraRoleRows.map((row) => row.role_id),
    ].filter(Boolean) as string[]));

    const effectivePermissions = await this.permissions.listForRoles(roleIds, { manager });
    const currentLevel = effectivePermissions.get(config.permissionResource);
    if (!currentLevel || (PERMISSION_RANK[currentLevel] ?? 0) < PERMISSION_RANK[requiredLevel]) {
      return 'denied';
    }
    return 'granted';
  }

  /**
   * Existence plus, for incidents, row visibility: a confidential incident the caller
   * cannot see is a 404 here, not only in the controller. The service never relies on
   * the controller having resolved a visible id first.
   */
  private async assertSourceEntityExists(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    manager: EntityManager,
    userId?: string | null,
  ): Promise<void> {
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];

    if (sourceEntityType === 'incidents') {
      const tenantRows = await manager.query<Array<{ tenant_id: string | null }>>(
        `SELECT app_current_tenant()::text AS tenant_id`,
      );
      const viewer = await resolveIncidentViewer(manager, userId ?? null, tenantRows[0]?.tenant_id ?? null);
      const params: unknown[] = [sourceEntityId];
      const visibility = incidentVisibilitySql('i', viewer, params);
      const rows = await manager.query(
        `SELECT i.id
         FROM incidents i
         WHERE i.id = $1
           AND i.tenant_id = app_current_tenant()
           ${visibility}
         LIMIT 1`,
        params,
      );
      if (!rows.length) {
        throw new NotFoundException('incident not found');
      }
      return;
    }

    const rows = await manager.query(
      `SELECT id
       FROM ${config.sourceTable}
       WHERE id = $1
         AND tenant_id = app_current_tenant()
       LIMIT 1`,
      [sourceEntityId],
    );
    if (!rows.length) {
      throw new NotFoundException(`${sourceEntityType.slice(0, -1)} not found`);
    }
  }

  private async resolveManagedDocumentId(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    accessMode: SourceAccessMode,
    userId: string,
    manager: EntityManager,
  ): Promise<string> {
    this.assertSupportedSlot(sourceEntityType, slotKey);
    await this.assertSourcePermission(sourceEntityType, accessMode, userId, manager);
    await this.assertSourceEntityExists(sourceEntityType, sourceEntityId, manager, userId);

    let binding = await this.findBinding(
      sourceEntityType,
      sourceEntityId,
      slotKey as IntegratedDocumentSlotKey,
      manager,
    );
    if (!binding) {
      await this.repairSourceSlot(
        sourceEntityType,
        sourceEntityId,
        slotKey as IntegratedDocumentSlotKey,
        { manager, actorUserId: userId },
      );
      binding = await this.findBinding(
        sourceEntityType,
        sourceEntityId,
        slotKey as IntegratedDocumentSlotKey,
        manager,
      );
    }

    if (!binding) {
      throw new NotFoundException('Integrated document not found');
    }

    await this.ensureOwningRelationRow(
      sourceEntityType,
      sourceEntityId,
      binding.document_id,
      manager,
    );
    return String(binding.document_id);
  }

  private async ensureBoundDocument(
    sourceEntityType: SourceScopedEntityType,
    source: SourceDescriptor,
    slotKey: IntegratedDocumentSlotKey,
    explicitContent: string | null | undefined,
    userId: string | null | undefined,
    manager: EntityManager,
    opts?: {
      useTemplateWhenBlank?: boolean;
      /**
       * The explicit content is a stored content (copy, backfill, repair): no size
       * limit, here and in the managed document it creates. The parse budget still
       * applies: a content over it is kept as it is.
       */
      storedContent?: boolean;
      ownerUserId?: string | null;
      changeNote?: string | null;
      activityContent?: string | null;
      initializer?: (
        documentId: string,
        manager: EntityManager,
      ) => Promise<{ content_markdown?: string | null } | void>;
    },
  ): Promise<ManagedWriteResult> {
    const existingBinding = await this.findBinding(sourceEntityType, source.id, slotKey, manager);
    if (existingBinding) {
      return {
        documentId: existingBinding.document_id,
        changed: false,
        created: false,
      };
    }

    const slotSetting = await this.getSlotSetting(sourceEntityType, slotKey, manager);
    const initialContent = await this.resolveInitialContent(
      explicitContent,
      slotSetting.template_content_markdown,
      { useTemplateWhenBlank: opts?.useTemplateWhenBlank, storedContent: opts?.storedContent },
    );

    const provisioningContext = await this.buildSourceAccessContext(
      sourceEntityType,
      source.id,
      slotKey,
      userId,
      manager,
    );
    const created = await this.knowledge.createManagedDocument(
      {
        tenantId: source.tenant_id,
        title: this.formatManagedTitle(sourceEntityType, source, slotKey, await this.creatorSlotLabel(sourceEntityType, slotKey, userId, manager)),
        summary: null,
        content_markdown: initialContent,
        folder_id: slotSetting.folder_id,
        library_id: slotSetting.library_id,
        document_type_id: slotSetting.document_type_id,
        template_document_id: slotSetting.template_document_id,
        status: 'published',
        relationEntityType: SOURCE_ENTITY_CONFIG[sourceEntityType].relationTable
          ? sourceEntityType as Extract<RelationEntityType, 'projects' | 'requests' | 'incidents'>
          : undefined,
        relationIds: SOURCE_ENTITY_CONFIG[sourceEntityType].relationTable
          ? [source.id]
          : undefined,
        change_note: opts?.changeNote ?? null,
        activity_content: opts?.activityContent ?? null,
      },
      userId || null,
      {
        manager,
        initializer: opts?.initializer,
        sourceContext: provisioningContext,
        boundToSource: true,
        // A blank explicit content leaves the template, a stored content, in place.
        storedContent: opts?.storedContent
          || (!String(explicitContent ?? '').trim() && opts?.useTemplateWhenBlank !== false),
      },
    );
    await this.ensurePrimaryOwnerContributor(created.id, opts?.ownerUserId ?? null, manager);

    try {
      await manager.getRepository(IntegratedDocumentBinding).save(
        manager.getRepository(IntegratedDocumentBinding).create({
          tenant_id: source.tenant_id,
          source_entity_type: sourceEntityType,
          source_entity_id: source.id,
          slot_key: slotKey,
          document_id: created.id,
          hidden_from_entity_knowledge: true,
        }),
      );
    } catch (e: any) {
      if (String(e?.message || '').includes('uq_integrated_document_bindings_slot')) {
        const existingBinding = await this.findBinding(sourceEntityType, source.id, slotKey, manager);
        if (existingBinding) {
          return { documentId: existingBinding.document_id, changed: false, created: false };
        }
      }
      throw e;
    }

    return {
      documentId: created.id,
      changed: true,
      created: true,
    };
  }

  async provisionForRequest(
    source: SourceDescriptor,
    body: {
      purpose?: string | null;
      risks_mitigations?: string | null;
    },
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const ownerUserId = await this.loadPreferredOwnerUserId('requests', source.id, manager);
    await this.ensureBoundDocument('requests', source, 'purpose', body?.purpose, userId, manager, {
      ownerUserId,
    });
    await this.ensureBoundDocument('requests', source, 'risks_mitigations', body?.risks_mitigations, userId, manager, {
      ownerUserId,
    });
  }

  async provisionForProject(
    source: SourceDescriptor,
    body: {
      purpose?: string | null;
    },
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const ownerUserId = await this.loadPreferredOwnerUserId('projects', source.id, manager);
    await this.ensureBoundDocument('projects', source, 'purpose', body?.purpose, userId, manager, {
      ownerUserId,
    });
  }

  /**
   * The specification of a new interface. Headings follow the creating user's
   * language (`users.locale`), English when the user has none. A specification
   * the caller already wrote is stored as it is. An interface that already has
   * its document keeps that document: nothing here rewrites an existing one.
   * The library template stays the English copy (a tenant has no language).
   */
  async provisionForInterface(
    source: SourceDescriptor,
    body: {
      specification?: string | null;
    },
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const ownerUserId = await this.loadPreferredOwnerUserId('interfaces', source.id, manager);
    const supplied = String(body?.specification || '').trim() ? body?.specification : null;
    const explicitContent = supplied ?? (await this.loadRecoveredSlotContent(
      'interfaces',
      source.id,
      'specification',
      manager,
      await this.creatorLanguage(userId, manager),
    )).content;
    await this.ensureBoundDocument('interfaces', source, 'specification', explicitContent, userId, manager, {
      ownerUserId,
      useTemplateWhenBlank: false,
    });
  }

  /**
   * Eager provisioning of the `incidents:review` document, from the configured
   * template. Called inside the incident create transaction and by the CSV import
   * create path, so a review always exists before anything tries to read it.
   *
   * Takes the incident id (not a descriptor) because the CSV commit path only has
   * the id at hand; the reference and title are read back here.
   */
  async provisionForIncident(
    incidentId: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const context = await this.loadSourceRecoveryContext('incidents', incidentId, manager);
    await this.ensureBoundDocument('incidents', context.source, 'review', await this.incidentReviewStart(userId, manager), userId, manager, {
      ownerUserId: context.ownerUserId,
    });
  }

  /**
   * The body a new incident review starts from: the shipped template in the creating
   * user's language (`users.locale`), or null to start from the library template when
   * the tenant has edited it (a renamed or rewritten template keeps its own words).
   */
  private async incidentReviewStart(userId: string | null | undefined, manager: EntityManager): Promise<string | null> {
    const slotSetting = await this.getSlotSetting('incidents', 'review', manager);
    if (!isIncidentReviewSystemTemplate(slotSetting.template_content_markdown)) return null;
    return incidentReviewTemplateMarkdown(await this.creatorLanguage(userId, manager));
  }

  /**
   * §3.3 closure snapshot primitive, called by `IncidentsService` from the
   * close/cancel transaction (phase A3).
   *
   * **Lock ordering contract**: the caller MUST already hold the incident row
   * lock (`SELECT ... FROM incidents WHERE id = $1 FOR UPDATE`) in the same
   * transaction. This method then takes the document row lock. Incident first,
   * document second, on every path that serializes review mutations, status
   * transitions and confidentiality/owner/reporter changes.
   *
   * It refuses with 423 when another user holds an edit lock on the review, and
   * returns the reference to store in `incident_entries.changed_fields.review_version`.
   */
  async snapshotReviewForIncidentTransition(
    incidentId: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager; changeNote?: string | null },
  ): Promise<{ document_id: string; version_number: number; revision: number }> {
    const manager = this.getManager(opts);
    const slotKey: IntegratedDocumentSlotKey = 'review';

    let binding = await this.findBinding('incidents', incidentId, slotKey, manager);
    if (!binding) {
      // Eager provisioning happens at create; a missing binding here is an
      // integrity gap and is repaired explicitly rather than silently skipped.
      await this.provisionForIncident(incidentId, userId, { manager });
      binding = await this.findBinding('incidents', incidentId, slotKey, manager);
    }
    if (!binding) {
      throw new NotFoundException('Integrated document not found');
    }

    const documentId = String(binding.document_id);
    await manager.query('SELECT id FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
    await this.knowledge.assertDocumentUnlockedForUser(documentId, userId ?? null, manager);

    const document = await this.getDocumentOrThrow(documentId, manager);
    const snapshot = await this.knowledge.ensureCurrentVersionSnapshot(
      document,
      opts?.changeNote ?? null,
      String(userId || '').trim() || null,
      manager,
    );

    return {
      document_id: documentId,
      version_number: Number(snapshot.version.version_number),
      revision: Number(document.revision),
    };
  }

  /**
   * §3.8 CSV-import write path for `incidents:review`, and the only place that
   * may write the review of a closed or cancelled incident.
   *
   * It still enforces the tenant, `incidents:contributor`, the incident's row
   * visibility (404 when invisible) and another user's edit lock (423). It is
   * not reachable from any document route: no DTO, header or AI tool can build
   * the exemption. Must run inside the CSV commit transaction so a failure rolls
   * the incident upsert back with it.
   */
  async writeIncidentReviewForImport(
    incidentId: string,
    content: string | null | undefined,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager; changeNote?: string | null; activityContent?: string | null },
  ): Promise<{ document_id: string; changed: boolean; version_number: number | null; revision: number | null }> {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const slotKey: IntegratedDocumentSlotKey = 'review';

    this.assertSupportedSlot('incidents', slotKey);
    await this.assertSourcePermission('incidents', 'edit', normalizedUserId, manager);
    await this.assertSourceEntityExists('incidents', incidentId, manager, normalizedUserId);

    let binding = await this.findBinding('incidents', incidentId, slotKey, manager);
    if (!binding) {
      // An imported incident may already be closed: provision explicitly rather
      // than going through the lazy repair, which refuses frozen incidents.
      await this.provisionForIncident(incidentId, normalizedUserId, { manager });
      binding = await this.findBinding('incidents', incidentId, slotKey, manager);
    }
    if (!binding) {
      throw new NotFoundException('Integrated document not found');
    }

    const documentId = String(binding.document_id);
    await this.ensureOwningRelationRow('incidents', incidentId, documentId, manager);
    await this.knowledge.assertDocumentUnlockedForUser(documentId, normalizedUserId, manager);

    const existing = await this.getDocumentOrThrow(documentId, manager);
    const nextContent = await normalizeMarkdownRichText(content, { fieldName: 'content_markdown' }) || '';
    if (existing.content_markdown === nextContent) {
      return { document_id: documentId, changed: false, version_number: null, revision: null };
    }

    const importContext = await this.buildSourceAccessContext(
      'incidents',
      incidentId,
      slotKey,
      normalizedUserId,
      manager,
      { allowFrozenIncident: true },
    );
    await this.knowledge.updateManagedDocument(
      documentId,
      {
        content_markdown: nextContent,
        create_version: true,
        change_note: opts?.changeNote ?? this.getImportChangeNote('incidents'),
        activity_content: opts?.activityContent ?? 'Document updated',
      },
      normalizedUserId,
      { manager, sourceContext: importContext },
    );

    const saved = await this.getDocumentOrThrow(documentId, manager);
    // `revision` completes the `changed_fields.review_version` shape the CSV
    // import journals (phase A3, §3.8) — same object as the closure snapshot.
    return {
      document_id: documentId,
      changed: true,
      version_number: Number(saved.current_version_number) || null,
      revision: Number(saved.revision) || null,
    };
  }

  async writeSourceSlotContent(
    sourceEntityType: SourceScopedEntityType,
    source: SourceDescriptor,
    slotKey: IntegratedDocumentSlotKey,
    content: string | null | undefined,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager; logSourceActivity?: boolean },
  ): Promise<ManagedWriteResult> {
    const manager = this.getManager(opts);
    this.assertSupportedSlot(sourceEntityType, slotKey);
    const ownerUserId = await this.loadPreferredOwnerUserId(sourceEntityType, source.id, manager);

    const existingBinding = await this.findBinding(sourceEntityType, source.id, slotKey, manager);
    if (!existingBinding) {
      const created = await this.ensureBoundDocument(
        sourceEntityType,
        source,
        slotKey,
        content,
        userId,
        manager,
        {
          useTemplateWhenBlank: false,
          ownerUserId,
        },
      );
      if (created.changed && opts?.logSourceActivity !== false) {
        await this.logSourceSemanticActivity(sourceEntityType, source.id, slotKey, source.tenant_id, userId, manager);
      }
      return created;
    }

    const existingDocument = await this.getDocumentOrThrow(existingBinding.document_id, manager);
    const nextContent = await normalizeMarkdownRichText(content, { fieldName: 'content_markdown' }) || '';
    if (existingDocument.content_markdown === nextContent) {
      return {
        documentId: existingBinding.document_id,
        changed: false,
        created: false,
      };
    }

    const sourceContext = await this.buildSourceAccessContext(sourceEntityType, source.id, slotKey, userId, manager);
    await this.knowledge.updateManagedDocument(
      existingBinding.document_id,
      {
        content_markdown: nextContent,
        create_version: true,
        activity_content: 'Document updated',
      },
      userId || null,
      {
        manager,
        sourceContext,
        sourceGrant: await this.callerWriteGrant(
          sourceEntityType, source.id, slotKey, existingBinding.document_id, userId, manager, sourceContext,
        ),
        systemOperation: !String(userId || '').trim(),
      },
    );

    if (opts?.logSourceActivity !== false) {
      await this.logSourceSemanticActivity(sourceEntityType, source.id, slotKey, source.tenant_id, userId, manager);
    }

    return {
      documentId: existingBinding.document_id,
      changed: true,
      created: false,
    };
  }

  /**
   * Realign the managed titles of one source entity after a rename.
   *
   * `allowFrozenIncident` is the §3.8 CSV-import exemption: only the incident CSV
   * import passes it, so an imported line may rename a closed incident's review
   * exactly as it may rewrite its body. Every request-driven caller leaves it off.
   */
  async syncTitles(
    sourceEntityType: SourceScopedEntityType,
    source: SourceDescriptor,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager; allowFrozenIncident?: boolean },
  ): Promise<number> {
    const manager = this.getManager(opts);
    const bindings = await manager.getRepository(IntegratedDocumentBinding).find({
      where: {
        source_entity_type: sourceEntityType,
        source_entity_id: source.id,
      } as any,
      order: { created_at: 'ASC' as const },
    });

    let updatedCount = 0;
    for (const binding of bindings) {
      if (!SUPPORTED_SLOT_KEYS[sourceEntityType].has(binding.slot_key)) {
        continue;
      }
      const slotKey = binding.slot_key as IntegratedDocumentSlotKey;
      const document = await this.getDocumentOrThrow(binding.document_id, manager);
      // The slot keeps the name the title carries, in whichever language it was created.
      const nextTitle = this.formatManagedTitle(sourceEntityType, source, slotKey, this.managedTitleLabel(sourceEntityType, slotKey, document.title));
      if (document.title === nextTitle) {
        continue;
      }
      const sourceContext = await this.buildSourceAccessContext(
        sourceEntityType, source.id, slotKey, userId, manager,
        { allowFrozenIncident: opts?.allowFrozenIncident === true },
      );
      await this.knowledge.updateManagedDocument(
        binding.document_id,
        {
          title: nextTitle,
          create_version: false,
        },
        userId || null,
        {
          manager,
          sourceContext,
          sourceGrant: await this.callerWriteGrant(
            sourceEntityType, source.id, slotKey, binding.document_id, userId, manager, sourceContext,
          ),
          systemOperation: !String(userId || '').trim(),
        },
      );
      updatedCount += 1;
    }

    return updatedCount;
  }

  async createProjectPurposeFromRequest(
    requestSource: SourceDescriptor,
    projectSource: SourceDescriptor,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const requestBinding = await this.findBinding('requests', requestSource.id, 'purpose', manager);
    if (!requestBinding) {
      throw new NotFoundException('Request purpose integrated document not found');
    }

    const requestDocument = await this.getDocumentOrThrow(requestBinding.document_id, manager);
    const referencedAttachmentIds = this.extractKnowledgeInlineAttachmentIds(requestDocument.content_markdown || '');
    const ownerUserId = await this.loadPreferredOwnerUserId('projects', projectSource.id, manager);

    await this.ensureBoundDocument(
      'projects',
      projectSource,
      'purpose',
      requestDocument.content_markdown || '',
      userId,
      manager,
      {
        ownerUserId,
        useTemplateWhenBlank: false,
        storedContent: true,
        initializer: async (projectDocumentId, initializerManager) => {
          if (referencedAttachmentIds.length === 0) {
            return {
              content_markdown: requestDocument.content_markdown || '',
            };
          }

          const mappings = await this.knowledge.cloneInlineAttachments(
            requestBinding.document_id,
            projectDocumentId,
            referencedAttachmentIds,
            userId || null,
            { manager: initializerManager },
          );
          if (mappings.length !== referencedAttachmentIds.length) {
            throw new NotFoundException('Failed to clone one or more managed inline attachments');
          }

          return {
            content_markdown: this.rewriteKnowledgeInlineAttachmentIds(
              requestDocument.content_markdown || '',
              mappings,
            ),
          };
        },
      },
    );
  }

  /**
   * The description of an application copied into another one (a new version): the content of the
   * source's `overview` document, its inline images cloned. A source with no document has nothing
   * to copy; the new application then gets its own on first opening. Returns whether it copied.
   */
  async copyApplicationOverview(
    sourceApplicationId: string,
    target: SourceDescriptor,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<boolean> {
    const manager = this.getManager(opts);
    const sourceBinding = await this.findBinding('applications', sourceApplicationId, 'overview', manager);
    if (!sourceBinding) return false;

    const sourceDocument = await this.getDocumentOrThrow(sourceBinding.document_id, manager);
    const content = sourceDocument.content_markdown || '';
    const referencedAttachmentIds = this.extractKnowledgeInlineAttachmentIds(content);
    const ownerUserId = await this.loadPreferredOwnerUserId('applications', target.id, manager);

    await this.ensureBoundDocument('applications', target, 'overview', content, userId, manager, {
      ownerUserId,
      useTemplateWhenBlank: false,
      storedContent: true,
      initializer: async (targetDocumentId, initializerManager) => {
        if (referencedAttachmentIds.length === 0) return { content_markdown: content };
        const mappings = await this.knowledge.cloneInlineAttachments(
          sourceBinding.document_id,
          targetDocumentId,
          referencedAttachmentIds,
          userId || null,
          { manager: initializerManager },
        );
        if (mappings.length !== referencedAttachmentIds.length) {
          throw new NotFoundException('Failed to clone one or more managed inline attachments');
        }
        return { content_markdown: this.rewriteKnowledgeInlineAttachmentIds(content, mappings) };
      },
    });
    return true;
  }

  /**
   * The specification of an interface copied into another one (a duplicate, or the
   * interface migrated onto a new application version): the content of the source's
   * `specification` document, its inline images cloned. A source with no document
   * has nothing to copy; the new interface then gets its own on first opening.
   * Returns whether it copied.
   */
  async copyInterfaceSpecification(
    sourceInterfaceId: string,
    target: SourceDescriptor,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<boolean> {
    const manager = this.getManager(opts);
    const sourceBinding = await this.findBinding('interfaces', sourceInterfaceId, 'specification', manager);
    if (!sourceBinding) return false;

    const sourceDocument = await this.getDocumentOrThrow(sourceBinding.document_id, manager);
    const content = sourceDocument.content_markdown || '';
    const referencedAttachmentIds = this.extractKnowledgeInlineAttachmentIds(content);
    const ownerUserId = await this.loadPreferredOwnerUserId('interfaces', target.id, manager);

    await this.ensureBoundDocument('interfaces', target, 'specification', content, userId, manager, {
      ownerUserId,
      useTemplateWhenBlank: false,
      storedContent: true,
      initializer: async (targetDocumentId, initializerManager) => {
        if (referencedAttachmentIds.length === 0) return { content_markdown: content };
        const mappings = await this.knowledge.cloneInlineAttachments(
          sourceBinding.document_id,
          targetDocumentId,
          referencedAttachmentIds,
          userId || null,
          { manager: initializerManager },
        );
        if (mappings.length !== referencedAttachmentIds.length) {
          throw new NotFoundException('Failed to clone one or more managed inline attachments');
        }
        return { content_markdown: this.rewriteKnowledgeInlineAttachmentIds(content, mappings) };
      },
    });
    return true;
  }

  private async backfillSourceSlot(
    sourceEntityType: SourceScopedEntityType,
    source: SourceDescriptor,
    slotKey: IntegratedDocumentSlotKey,
    legacyContent: string | null | undefined,
    tenantSlug: string,
    ownerUserId: string | null,
    actorUserId: string | null | undefined,
    manager: EntityManager,
  ): Promise<ManagedWriteResult> {
    const importChangeNote = this.getImportChangeNote(sourceEntityType);
    const initialContent = await this.resolveRecoveredInitialContent(legacyContent);
    const normalizedActorUserId = this.normalizeOptionalUserId(actorUserId);

    return this.ensureBoundDocument(
      sourceEntityType,
      source,
      slotKey,
      initialContent,
      normalizedActorUserId,
      manager,
      {
        ownerUserId,
        useTemplateWhenBlank: false,
        storedContent: true,
        changeNote: importChangeNote,
        activityContent: importChangeNote,
        initializer: async (documentId, initializerManager) => {
          const imported = await this.importRecoveredInlineImages(
            sourceEntityType,
            source.id,
            slotKey,
            documentId,
            source.tenant_id,
            tenantSlug,
            legacyContent,
            normalizedActorUserId,
            initializerManager,
            { includeLegacyAttachmentRefs: true },
          );
          return {
            content_markdown: imported.content_markdown,
          };
        },
      },
    );
  }

  async backfillRequestRow(
    row: RequestBackfillRow,
    tenantSlug: string,
    opts?: { manager?: EntityManager },
  ): Promise<{ created: number; skipped: number }> {
    const manager = this.getManager(opts);
    const ownerUserId = this.resolvePreferredOwnerUserId('requests', row);
    const source: SourceDescriptor = {
      id: row.id,
      tenant_id: row.tenant_id,
      item_number: row.item_number,
      name: row.name,
    };

    const purpose = await this.backfillSourceSlot(
      'requests',
      source,
      'purpose',
      row.purpose,
      tenantSlug,
      ownerUserId,
      null,
      manager,
    );
    const risks = await this.backfillSourceSlot(
      'requests',
      source,
      'risks_mitigations',
      row.risks,
      tenantSlug,
      ownerUserId,
      null,
      manager,
    );

    const created = Number(purpose.created) + Number(risks.created);
    return {
      created,
      skipped: 2 - created,
    };
  }

  async backfillProjectRow(
    row: ProjectBackfillRow,
    tenantSlug: string,
    opts?: { manager?: EntityManager },
  ): Promise<{ created: number; skipped: number }> {
    const manager = this.getManager(opts);
    const ownerUserId = this.resolvePreferredOwnerUserId('projects', row);
    const source: SourceDescriptor = {
      id: row.id,
      tenant_id: row.tenant_id,
      item_number: row.item_number,
      name: row.name,
    };

    const purpose = await this.backfillSourceSlot(
      'projects',
      source,
      'purpose',
      row.purpose,
      tenantSlug,
      ownerUserId,
      null,
      manager,
    );

    return {
      created: Number(purpose.created),
      skipped: purpose.created ? 0 : 1,
    };
  }

  /**
   * `allowFrozenIncident` is the operator escape hatch for `incidents:review`
   * (§3.2): only `npm run integrated-docs:backfill` passes it, and it is the
   * one way a closed or cancelled incident whose review is missing gets one.
   * Every lazy read path leaves it off, so a frozen record can never gain a
   * brand-new review from today's template just because someone opened it.
   */
  async repairSourceSlot(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: IntegratedDocumentSlotKey,
    opts?: { manager?: EntityManager; actorUserId?: string | null; allowFrozenIncident?: boolean },
  ): Promise<RepairSourceSlotResult> {
    const manager = this.getManager(opts);
    const actorUserId = this.normalizeOptionalUserId(opts?.actorUserId);
    this.assertSupportedSlot(sourceEntityType, slotKey);

    const existingBinding = await this.findBinding(sourceEntityType, sourceEntityId, slotKey, manager);
    if (existingBinding) {
      const repairedRelation = await this.ensureOwningRelationRow(
        sourceEntityType,
        sourceEntityId,
        existingBinding.document_id,
        manager,
      );
      return {
        slotKey,
        documentId: existingBinding.document_id,
        created: false,
        repairedRelation,
        recoveredFrom: null,
        unresolvedLegacyInlineAttachmentIds: [],
      };
    }

    if (sourceEntityType === 'incidents') {
      return this.repairIncidentReviewSlot(sourceEntityId, slotKey, actorUserId, manager, {
        allowFrozenIncident: opts?.allowFrozenIncident === true,
      });
    }

    const context = await this.loadSourceRecoveryContext(sourceEntityType, sourceEntityId, manager);
    // A missing specification is written once, in the language of the user who opens it.
    // A backfill has no user, so it stays on the English headings.
    const recoveredLanguage = sourceEntityType === 'interfaces'
      ? await this.creatorLanguage(actorUserId, manager)
      : undefined;
    const recovered = await this.loadRecoveredSlotContent(
      sourceEntityType,
      sourceEntityId,
      slotKey,
      manager,
      recoveredLanguage,
    );

    if (recovered.source === 'legacy') {
      await this.backfillSourceSlot(
        sourceEntityType,
        context.source,
        slotKey,
        recovered.content,
        context.tenantSlug,
        context.ownerUserId,
        actorUserId,
        manager,
      );
    } else {
      const initialContent = await this.resolveRecoveredInitialContent(recovered.content);
      const needsDataImageRecovery = await this.recoveredContentHasDataImage(recovered.content);
      await this.ensureBoundDocument(
        sourceEntityType,
        context.source,
        slotKey,
        initialContent,
        actorUserId,
        manager,
        {
          ownerUserId: context.ownerUserId,
          useTemplateWhenBlank: false,
          storedContent: true,
          changeNote: 'Recovered from audit log after integrated-doc migration',
          activityContent: 'Recovered from audit log after integrated-doc migration',
          initializer: needsDataImageRecovery
            ? async (documentId, initializerManager) => {
              const imported = await this.importRecoveredInlineImages(
                sourceEntityType,
                context.source.id,
                slotKey,
                documentId,
                context.source.tenant_id,
                context.tenantSlug,
                recovered.content,
                actorUserId,
                initializerManager,
                { includeLegacyAttachmentRefs: false },
              );
              return {
                content_markdown: imported.content_markdown,
              };
            }
            : undefined,
        },
      );
    }

    const binding = await this.findBinding(sourceEntityType, sourceEntityId, slotKey, manager);
    if (!binding) {
      throw new NotFoundException(`Integrated document repair failed for ${sourceEntityType}:${slotKey}:${sourceEntityId}`);
    }

    const repairedRelation = await this.ensureOwningRelationRow(
      sourceEntityType,
      sourceEntityId,
      binding.document_id,
      manager,
    );

    return {
      slotKey,
      documentId: binding.document_id,
      created: true,
      repairedRelation,
      recoveredFrom: recovered.source,
      unresolvedLegacyInlineAttachmentIds: recovered.unresolvedLegacyInlineAttachmentIds,
    };
  }

  /**
   * A review document that lost its binding but is still reachable through
   * `document_incidents` — same folder, same managed type, not bound elsewhere.
   */
  private async findUnboundIncidentReviewDocumentId(
    incidentId: string,
    slotKey: IntegratedDocumentSlotKey,
    manager: EntityManager,
  ): Promise<string | null> {
    const slotSetting = await this.getSlotSetting('incidents', slotKey, manager);
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT d.id::text AS id
       FROM document_incidents di
       JOIN documents d ON d.id = di.document_id AND d.tenant_id = di.tenant_id
       WHERE di.tenant_id = app_current_tenant()
         AND di.incident_id = $1
         AND d.folder_id = $2
         AND d.document_type_id = $3
         AND NOT EXISTS (
           SELECT 1 FROM integrated_document_bindings b
           WHERE b.document_id = d.id
             AND b.tenant_id = d.tenant_id
         )
       ORDER BY d.created_at ASC, d.id ASC
       LIMIT 1`,
      [incidentId, slotSetting.folder_id, slotSetting.document_type_id],
    );
    return rows[0]?.id ? String(rows[0].id) : null;
  }

  /**
   * Lazy repair for `incidents:review`.
   *
   * Recovering the document through the owning relation comes first and never
   * replaces its content. Otherwise only an open incident gets a fresh document from
   * the template: for a closed or cancelled one, `loadRecoveredSlotContent` raises,
   * because a frozen record must not gain a brand-new review on a mere read.
   *
   * `allowFrozenIncident` skips that refusal, and only the backfill script sets
   * it — otherwise a closed incident whose binding is missing would be a dead
   * end with no repair path at all.
   */
  private async repairIncidentReviewSlot(
    incidentId: string,
    slotKey: IntegratedDocumentSlotKey,
    actorUserId: string | null,
    manager: EntityManager,
    opts?: { allowFrozenIncident?: boolean },
  ): Promise<RepairSourceSlotResult> {
    const context = await this.loadSourceRecoveryContext('incidents', incidentId, manager);

    const recoveredDocumentId = await this.findUnboundIncidentReviewDocumentId(incidentId, slotKey, manager);
    if (recoveredDocumentId) {
      const bindingsRepo = manager.getRepository(IntegratedDocumentBinding);
      await bindingsRepo.save(bindingsRepo.create({
        tenant_id: context.source.tenant_id,
        source_entity_type: 'incidents',
        source_entity_id: incidentId,
        slot_key: slotKey,
        document_id: recoveredDocumentId,
        hidden_from_entity_knowledge: true,
      }));
      return {
        slotKey,
        documentId: recoveredDocumentId,
        created: false,
        repairedRelation: false,
        recoveredFrom: null,
        unresolvedLegacyInlineAttachmentIds: [],
      };
    }

    if (!opts?.allowFrozenIncident) {
      await this.loadRecoveredSlotContent('incidents', incidentId, slotKey, manager);
    }
    await this.ensureBoundDocument('incidents', context.source, slotKey, null, actorUserId, manager, {
      ownerUserId: context.ownerUserId,
      useTemplateWhenBlank: true,
    });

    const binding = await this.findBinding('incidents', incidentId, slotKey, manager);
    if (!binding) {
      throw new NotFoundException(`Integrated document repair failed for incidents:${slotKey}:${incidentId}`);
    }
    const repairedRelation = await this.ensureOwningRelationRow('incidents', incidentId, binding.document_id, manager);
    return {
      slotKey,
      documentId: binding.document_id,
      created: true,
      repairedRelation,
      recoveredFrom: null,
      unresolvedLegacyInlineAttachmentIds: [],
    };
  }

  async repairSourceEntity(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    opts?: { manager?: EntityManager; actorUserId?: string | null; allowFrozenIncident?: boolean },
  ): Promise<RepairSourceEntityResult> {
    const slots: RepairSourceSlotResult[] = [];
    for (const definition of this.getSlotDefinitionsForSource(sourceEntityType)) {
      slots.push(
        await this.repairSourceSlot(
          sourceEntityType,
          sourceEntityId,
          definition.slotKey,
          opts,
        ),
      );
    }
    return {
      sourceEntityType,
      sourceEntityId,
      slots,
    };
  }

  private async verifySourceSlotState(
    sourceEntityType: SourceScopedEntityType,
    context: SourceRecoveryContext,
    slotKey: IntegratedDocumentSlotKey,
    manager: EntityManager,
  ): Promise<void> {
    const slotSetting = await this.getSlotSetting(sourceEntityType, slotKey, manager);
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];
    const binding = await this.findBinding(sourceEntityType, context.source.id, slotKey, manager);
    if (!binding) {
      throw new Error(`Expected binding for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }
    if (!binding.hidden_from_entity_knowledge) {
      throw new Error(`Binding for ${sourceEntityType}:${slotKey}:${context.source.id} must stay hidden from entity knowledge`);
    }

    const documentRows = await manager.query<Array<{
      id: string;
      title: string;
      status: string;
      folder_id: string;
      library_id: string;
      document_type_id: string;
      template_document_id: string | null;
      content_markdown: string | null;
      revision: number;
      current_version_number: number;
      relation_count: number;
      owning_relation_count: number;
    }>>(
      `SELECT d.id,
              d.title,
              d.status,
              d.folder_id,
              d.library_id,
              d.document_type_id,
              d.template_document_id,
              d.content_markdown,
              d.revision,
              d.current_version_number,
              ${config.relationTable ? `(
                SELECT COUNT(*)::int
                FROM ${config.relationTable} rel
                WHERE rel.document_id = d.id
                  AND rel.tenant_id = d.tenant_id
              )` : '0'} AS relation_count,
              ${config.relationTable && config.relationIdColumn ? `(
                SELECT COUNT(*)::int
                FROM ${config.relationTable} rel
                WHERE rel.document_id = d.id
                  AND rel.${config.relationIdColumn} = $2
                  AND rel.tenant_id = d.tenant_id
              )` : '0'} AS owning_relation_count
       FROM documents d
       WHERE d.id = $1
         AND d.tenant_id = app_current_tenant()
       LIMIT 1`,
      // `$2` is only in the query of a source with a relation table (not applications).
      config.relationTable && config.relationIdColumn ? [binding.document_id, context.source.id] : [binding.document_id],
    );
    if (documentRows.length !== 1) {
      throw new Error(`Managed document ${binding.document_id} not found for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }

    const document = documentRows[0];
    if (!this.acceptedManagedTitles(sourceEntityType, context.source, slotKey).includes(document.title)) {
      throw new Error(`Managed document title mismatch for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }
    if (document.status !== 'published') {
      throw new Error(`Managed document status must be published for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }
    if (document.folder_id !== slotSetting.folder_id || document.library_id !== slotSetting.library_id) {
      throw new Error(`Managed document folder/library mismatch for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }
    if (document.document_type_id !== slotSetting.document_type_id) {
      throw new Error(`Managed document type mismatch for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }
    if (String(document.template_document_id || '') !== String(slotSetting.template_document_id || '')) {
      throw new Error(`Managed document template mismatch for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }
    if (
      config.relationTable
      && (Number(document.relation_count || 0) !== 1 || Number(document.owning_relation_count || 0) !== 1)
    ) {
      throw new Error(`Managed document owning relation mismatch for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }
    if (Number(document.revision || 0) < 1 || Number(document.current_version_number || 0) < 1) {
      throw new Error(`Managed document version counters must be at least 1 for ${sourceEntityType}:${slotKey}:${context.source.id}`);
    }

    if (context.ownerUserId) {
      const contributorRows = await manager.query<Array<{ user_id: string; is_primary: boolean }>>(
        `SELECT user_id,
                is_primary
         FROM document_contributors
         WHERE tenant_id = app_current_tenant()
           AND document_id = $1
           AND role = 'owner'`,
        [document.id],
      );
      const matchingOwner = contributorRows.find(
        (row) => row.user_id === context.ownerUserId && !!row.is_primary,
      );
      if (!matchingOwner) {
        throw new Error(`Managed document owner contributor mismatch for ${sourceEntityType}:${slotKey}:${context.source.id}`);
      }
    }

    // Incidents have no legacy column to compare against: the review document is the
    // only source of truth, so the structural checks above are the whole contract.
    if (sourceEntityType === 'incidents') {
      return;
    }

    // A specification is rebuilt in the language its headings still show, so a
    // French document matches the French copy of the same fields. English when
    // the first heading is not a shipped one.
    const recoveredLanguage = sourceEntityType === 'interfaces'
      ? interfaceSpecificationLanguageOf(document.content_markdown) ?? undefined
      : undefined;
    const recovered = await this.loadRecoveredSlotContent(
      sourceEntityType,
      context.source.id,
      slotKey,
      manager,
      recoveredLanguage,
    );
    const normalizedDocumentContent = await normalizeMarkdownRichText(document.content_markdown, {
      fieldName: 'content_markdown',
      enforceSizeLimit: false,
    }) || '';
    await this.assertRecoveredInlineImagesMatchDocument(
      sourceEntityType,
      context.source.id,
      slotKey,
      context.tenantSlug,
      recovered.content,
      document.id,
      normalizedDocumentContent,
      manager,
      { includeLegacyAttachmentRefs: recovered.source === 'legacy' },
    );
  }

  async verifySourceEntity(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const context = await this.loadSourceRecoveryContext(sourceEntityType, sourceEntityId, manager);
    for (const definition of this.getSlotDefinitionsForSource(sourceEntityType)) {
      await this.verifySourceSlotState(sourceEntityType, context, definition.slotKey, manager);
    }
  }

  private async verifySourceSlotMigration(
    sourceEntityType: SourceScopedEntityType,
    source: SourceDescriptor,
    slotKey: IntegratedDocumentSlotKey,
    legacyContent: string | null | undefined,
    tenantSlug: string,
    expectedOwnerUserId: string | null,
    manager: EntityManager,
  ): Promise<void> {
    const slotSetting = await this.getSlotSetting(sourceEntityType, slotKey, manager);
    const config = SOURCE_ENTITY_CONFIG[sourceEntityType];
    const bindingRows = await manager.query<Array<{
      document_id: string;
      hidden_from_entity_knowledge: boolean;
    }>>(
      `SELECT document_id,
              hidden_from_entity_knowledge
       FROM integrated_document_bindings
       WHERE tenant_id = app_current_tenant()
         AND source_entity_type = $1
         AND source_entity_id = $2
         AND slot_key = $3`,
      [sourceEntityType, source.id, slotKey],
    );
    if (bindingRows.length !== 1) {
      throw new Error(`Expected exactly one binding for ${sourceEntityType}:${slotKey}:${source.id}, found ${bindingRows.length}`);
    }
    if (!bindingRows[0].hidden_from_entity_knowledge) {
      throw new Error(`Binding for ${sourceEntityType}:${slotKey}:${source.id} must stay hidden from entity knowledge`);
    }

    const documentRows = await manager.query<Array<{
      id: string;
      title: string;
      status: string;
      folder_id: string;
      library_id: string;
      document_type_id: string;
      template_document_id: string | null;
      content_markdown: string | null;
      revision: number;
      current_version_number: number;
      relation_count: number;
      owning_relation_count: number;
    }>>(
      `SELECT d.id,
              d.title,
              d.status,
              d.folder_id,
              d.library_id,
              d.document_type_id,
              d.template_document_id,
              d.content_markdown,
              d.revision,
              d.current_version_number,
              ${config.relationTable ? `(
                SELECT COUNT(*)::int
                FROM ${config.relationTable} rel
                WHERE rel.document_id = d.id
                  AND rel.tenant_id = d.tenant_id
              )` : '0'} AS relation_count,
              ${config.relationTable && config.relationIdColumn ? `(
                SELECT COUNT(*)::int
                FROM ${config.relationTable} rel
                WHERE rel.document_id = d.id
                  AND rel.${config.relationIdColumn} = $2
                  AND rel.tenant_id = d.tenant_id
              )` : '0'} AS owning_relation_count
       FROM documents d
       WHERE d.id = $1
         AND d.tenant_id = app_current_tenant()
       LIMIT 1`,
      // `$2` is only in the query of a source with a relation table (not applications).
      config.relationTable && config.relationIdColumn ? [bindingRows[0].document_id, source.id] : [bindingRows[0].document_id],
    );
    if (documentRows.length !== 1) {
      throw new Error(`Managed document ${bindingRows[0].document_id} not found for ${sourceEntityType}:${slotKey}:${source.id}`);
    }

    const document = documentRows[0];
    if (!this.acceptedManagedTitles(sourceEntityType, source, slotKey).includes(document.title)) {
      throw new Error(`Managed document title mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if (document.status !== 'published') {
      throw new Error(`Managed document status must be published for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if (document.folder_id !== slotSetting.folder_id || document.library_id !== slotSetting.library_id) {
      throw new Error(`Managed document folder/library mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if (document.document_type_id !== slotSetting.document_type_id) {
      throw new Error(`Managed document type mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if (String(document.template_document_id || '') !== String(slotSetting.template_document_id || '')) {
      throw new Error(`Managed document template mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if (
      config.relationTable
      && (Number(document.relation_count || 0) !== 1 || Number(document.owning_relation_count || 0) !== 1)
    ) {
      throw new Error(`Managed document owning relation mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if (Number(document.revision || 0) !== 1 || Number(document.current_version_number || 0) !== 1) {
      throw new Error(`Managed document version counters must be 1 for ${sourceEntityType}:${slotKey}:${source.id}`);
    }

    const versionRows = await manager.query<Array<{
      version_number: number;
      change_note: string | null;
      created_by: string | null;
    }>>(
      `SELECT version_number,
              change_note,
              created_by
       FROM document_versions
       WHERE document_id = $1
       ORDER BY version_number ASC`,
      [document.id],
    );
    if (versionRows.length !== 1 || Number(versionRows[0].version_number || 0) !== 1) {
      throw new Error(`Managed document must have exactly one initial version for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if ((versionRows[0].change_note || null) !== this.getImportChangeNote(sourceEntityType)) {
      throw new Error(`Managed document change note mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
    }
    if (this.normalizeOptionalUserId(versionRows[0].created_by) !== this.normalizeOptionalUserId(expectedOwnerUserId)) {
      throw new Error(`Managed document version author mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
    }

    if (expectedOwnerUserId) {
      const contributorRows = await manager.query<Array<{ user_id: string; is_primary: boolean }>>(
        `SELECT user_id,
                is_primary
         FROM document_contributors
         WHERE tenant_id = app_current_tenant()
           AND document_id = $1
           AND role = 'owner'`,
        [document.id],
      );
      const matchingOwner = contributorRows.find((row) => row.user_id === expectedOwnerUserId && !!row.is_primary);
      if (!matchingOwner) {
        throw new Error(`Managed document owner contributor mismatch for ${sourceEntityType}:${slotKey}:${source.id}`);
      }
    }

    const preparedLegacyContent = await prepareRecoveredContent(legacyContent);
    const normalizedDocumentContent = await normalizeMarkdownRichText(document.content_markdown, {
      fieldName: 'content_markdown',
      enforceSizeLimit: false,
    }) || '';
    await this.assertRecoveredInlineImagesMatchDocument(
      sourceEntityType,
      source.id,
      slotKey,
      tenantSlug,
      preparedLegacyContent,
      document.id,
      normalizedDocumentContent,
      manager,
      { includeLegacyAttachmentRefs: true },
    );
  }

  async verifyRequestRow(
    row: RequestBackfillRow,
    tenantSlug: string,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const source: SourceDescriptor = {
      id: row.id,
      tenant_id: row.tenant_id,
      item_number: row.item_number,
      name: row.name,
    };
    const ownerUserId = this.resolvePreferredOwnerUserId('requests', row);

    await this.verifySourceSlotMigration(
      'requests',
      source,
      'purpose',
      row.purpose,
      tenantSlug,
      ownerUserId,
      manager,
    );
    await this.verifySourceSlotMigration(
      'requests',
      source,
      'risks_mitigations',
      row.risks,
      tenantSlug,
      ownerUserId,
      manager,
    );
  }

  async verifyProjectRow(
    row: ProjectBackfillRow,
    tenantSlug: string,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = this.getManager(opts);
    const source: SourceDescriptor = {
      id: row.id,
      tenant_id: row.tenant_id,
      item_number: row.item_number,
      name: row.name,
    };
    const ownerUserId = this.resolvePreferredOwnerUserId('projects', row);

    await this.verifySourceSlotMigration(
      'projects',
      source,
      'purpose',
      row.purpose,
      tenantSlug,
      ownerUserId,
      manager,
    );
  }

  /** Deletes the managed documents of a source record (`checkAccess`: see KnowledgeService.deleteManagedDocument). */
  async deleteForEntity(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager; checkAccess?: boolean },
  ): Promise<number> {
    const manager = this.getManager(opts);
    const bindings = await manager.getRepository(IntegratedDocumentBinding).find({
      where: {
        source_entity_type: sourceEntityType,
        source_entity_id: sourceEntityId,
      } as any,
      order: { created_at: 'ASC' as const },
    });

    for (const binding of bindings) {
      await this.knowledge.deleteManagedDocument(binding.document_id, userId || null, { manager, checkAccess: opts?.checkAccess });
    }

    return bindings.length;
  }

  async getBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      slotKey,
      'read',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, slotKey, normalizedUserId, manager,
    );
    // Only the incident source path needs an identity here: `resolveManagedDocumentId`
    // already applied the source entity's own permissions. Passing a userId for the
    // other source types would newly enforce the Knowledge library ACL on routes that
    // never required it (a Portfolio member with no `knowledge` permission).
    return this.knowledge.get(documentId, {
      manager,
      userId: sourceContext ? normalizedUserId : null,
      sourceContext,
    });
  }

  async acquireLockBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const managedSlotKey = slotKey as IntegratedDocumentSlotKey;
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      managedSlotKey,
      'edit',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, managedSlotKey, normalizedUserId, manager,
    );
    return this.knowledge.acquireLock(documentId, normalizedUserId, {
      manager, sourceContext, sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, managedSlotKey, documentId, 'edit', sourceContext),
    });
  }

  async heartbeatLockBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    userId: string | null | undefined,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const managedSlotKey = slotKey as IntegratedDocumentSlotKey;
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      managedSlotKey,
      'edit',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, managedSlotKey, normalizedUserId, manager,
    );
    return this.knowledge.heartbeatLock(documentId, normalizedUserId, lockToken, {
      manager, sourceContext, sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, managedSlotKey, documentId, 'edit', sourceContext),
    });
  }

  async releaseLockBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    userId: string | null | undefined,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const managedSlotKey = slotKey as IntegratedDocumentSlotKey;
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      managedSlotKey,
      'edit',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, managedSlotKey, normalizedUserId, manager,
    );
    return this.knowledge.releaseLock(documentId, normalizedUserId, lockToken, {
      manager, sourceContext, sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, managedSlotKey, documentId, 'edit', sourceContext),
    });
  }

  /**
   * Administrative unlock from the entity route (phase A3, §3.4).
   *
   * Resolved as a read so it still works on a closed incident; the entry route
   * carries its own level (`incidents:admin`) and `KnowledgeService.forceReleaseLock`
   * additionally requires `incidents:admin` for a review.
   */
  async forceReleaseLockBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const managedSlotKey = slotKey as IntegratedDocumentSlotKey;
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      managedSlotKey,
      'read',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, managedSlotKey, normalizedUserId, manager,
    );
    return this.knowledge.forceReleaseLock(documentId, { manager, userId: normalizedUserId, sourceContext });
  }

  async updateBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    body: any,
    userId: string | null | undefined,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      slotKey,
      'edit',
      normalizedUserId,
      manager,
    );

    const existing = await this.getDocumentOrThrow(documentId, manager);
    const nextContent = body?.content_markdown === undefined
      ? existing.content_markdown
      : (await normalizeMarkdownRichText(body?.content_markdown, { fieldName: 'content_markdown' }) || '');

    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, slotKey, normalizedUserId, manager,
    );
    const result = await this.knowledge.update(
      documentId,
      {
        content_markdown: body?.content_markdown,
        revision: body?.revision,
        save_mode: body?.save_mode,
        change_note: body?.change_note,
      },
      normalizedUserId,
      lockToken,
      { manager, sourceContext, sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, slotKey, documentId, 'edit', sourceContext) },
    );

    if (
      body?.save_mode !== 'autosave'
      && nextContent !== existing.content_markdown
    ) {
      const sourceRows = await manager.query<Array<{ tenant_id: string }>>(
        `SELECT tenant_id
         FROM ${SOURCE_ENTITY_CONFIG[sourceEntityType].sourceTable}
         WHERE id = $1
         LIMIT 1`,
        [sourceEntityId],
      );
      if (sourceRows.length > 0) {
        await this.logSourceSemanticActivity(
          sourceEntityType,
          sourceEntityId,
          slotKey as IntegratedDocumentSlotKey,
          sourceRows[0].tenant_id,
          normalizedUserId,
          manager,
        );
      }
    }

    return result;
  }

  async uploadInlineAttachmentBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    file: Express.Multer.File,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      slotKey,
      'edit',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, slotKey, normalizedUserId, manager,
    );
    return this.knowledge.uploadAttachment(documentId, file, normalizedUserId, {
      manager,
      sourceField: 'content_markdown',
      sourceContext,
      sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, slotKey, documentId, 'edit', sourceContext),
    });
  }

  async importDocumentBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    file: Express.Multer.File,
    userId: string | null | undefined,
    lockToken: string | null | undefined,
    opts?: ImportExecutionOptions,
  ): Promise<{ markdown: string; warnings: string[] }> {
    if (!opts?.releaseConnection) {
      const manager = this.getManager(opts);
      const normalizedUserId = this.normalizeUserId(userId);
      const documentId = await this.resolveManagedDocumentId(
        sourceEntityType,
        sourceEntityId,
        slotKey,
        'edit',
        normalizedUserId,
        manager,
      );
      const sourceContext = await this.buildSourceAccessContext(
        sourceEntityType, sourceEntityId, slotKey, normalizedUserId, manager,
      );
      return this.knowledge.importDocument(documentId, file, normalizedUserId, lockToken, {
        manager, sourceContext, sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, slotKey, documentId, 'edit', sourceContext),
      });
    }

    let manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    this.assertSupportedSlot(sourceEntityType, slotKey);
    await this.assertSourcePermission(sourceEntityType, 'edit', normalizedUserId, manager);
    await this.assertSourceEntityExists(sourceEntityType, sourceEntityId, manager, normalizedUserId);

    const buffer = readUploadedFileBuffer(file);
    const released = await opts.releaseConnection(
      () => this.importService.convertToMarkdown(buffer, file.mimetype, file.originalname),
    );
    manager = released.manager;

    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      slotKey,
      'edit',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, slotKey, normalizedUserId, manager,
    );
    return this.knowledge.finalizeImportedDocument(
      documentId, released.result, normalizedUserId, lockToken,
      { manager, sourceContext, sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, slotKey, documentId, 'edit', sourceContext) },
    );
  }

  async importInlineAttachmentBySourceUrl(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    sourceUrl: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      slotKey,
      'edit',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, slotKey, normalizedUserId, manager,
    );
    return this.knowledge.importInlineAttachmentFromUrl(documentId, sourceUrl, normalizedUserId, {
      manager,
      sourceField: 'content_markdown',
      sourceContext,
      sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, slotKey, documentId, 'edit', sourceContext),
    });
  }

  async listVersionsBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    userId: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      slotKey,
      'read',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, slotKey, normalizedUserId, manager,
    );
    // Same as `getBySource`: an identity is only passed on the incident source path.
    return this.knowledge.listVersions(documentId, {
      manager,
      userId: sourceContext ? normalizedUserId : null,
      sourceContext,
    });
  }

  async revertBySource(
    sourceEntityType: SourceScopedEntityType,
    sourceEntityId: string,
    slotKey: string,
    versionNumber: number,
    userId: string | null | undefined,
    lockToken: string | null | undefined,
    opts?: { manager?: EntityManager },
  ) {
    const manager = this.getManager(opts);
    const normalizedUserId = this.normalizeUserId(userId);
    const managedSlotKey = slotKey as IntegratedDocumentSlotKey;
    const documentId = await this.resolveManagedDocumentId(
      sourceEntityType,
      sourceEntityId,
      managedSlotKey,
      'edit',
      normalizedUserId,
      manager,
    );
    const sourceContext = await this.buildSourceAccessContext(
      sourceEntityType, sourceEntityId, managedSlotKey, normalizedUserId, manager,
    );
    const result = await this.knowledge.revert(
      documentId, versionNumber, normalizedUserId, lockToken,
      { manager, sourceContext, sourceGrant: this.sourceGrant(sourceEntityType, sourceEntityId, managedSlotKey, documentId, 'edit', sourceContext) },
    );
    const sourceRows = await manager.query<Array<{ tenant_id: string }>>(
      `SELECT tenant_id
       FROM ${SOURCE_ENTITY_CONFIG[sourceEntityType].sourceTable}
       WHERE id = $1
       LIMIT 1`,
      [sourceEntityId],
    );
    if (sourceRows.length > 0) {
      await this.logSourceSemanticActivity(
        sourceEntityType,
        sourceEntityId,
        managedSlotKey,
        sourceRows[0].tenant_id,
        normalizedUserId,
        manager,
      );
    }
    return result;
  }
}
