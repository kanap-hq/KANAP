import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { AuditService } from '../../audit/audit.service';
import { lockBudgetLine } from '../../spend/budget-locks';
import { auditTableOf } from '../../spend/budget-nature';
import {
  applicationParticipantCondition,
  resolveBusinessContributorScopeForUser,
} from '../../auth/business-contributor-scope';
import { SupplierContactsService } from '../../suppliers/supplier-contacts.service';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationPreviewChangeDto } from '../ai.types';
import { AiMutationAuditOptions, buildAiMutationAudit } from './ai-mutation-audit.util';
import { firstReturnedRow } from '../../analytics/analytics-context';
import {
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from './ai-mutation-operation.types';
import { AiTaskMutationSupportService } from './ai-task-mutation-support.service';

export const AI_RELATION_ENTITY_TYPES = [
  'applications',
  'assets',
  'suppliers',
  'contracts',
  'spend_items',
  'capex_items',
  'projects',
  'requests',
  'locations',
] as const;

export type AiRelationEntityType = typeof AI_RELATION_ENTITY_TYPES[number];

export type AiUpdateEntityRelationsInput = {
  entity_type: AiRelationEntityType;
  ref: string;
  relation: string;
  add?: unknown[];
  remove?: unknown[];
};

type RelationTarget =
  | 'applications'
  | 'assets'
  | 'business_processes'
  | 'capex_items'
  | 'companies'
  | 'contacts'
  | 'contracts'
  | 'departments'
  | 'projects'
  | 'requests'
  | 'spend_items'
  | 'suppliers'
  | 'users';

type RelationKind =
  | 'app_asset_assignments'
  | 'asset_relations'
  | 'contact_role'
  | 'link'
  | 'location_external_contacts'
  | 'location_internal_contacts'
  | 'owner_role'
  | 'simple'
  | 'sub_locations'
  | 'supplier_contacts';

type SimpleRelationConfig = {
  kind: 'simple';
  sourceEntity: AiRelationEntityType;
  relation: string;
  label: string;
  table: string;
  sourceColumn: string;
  targetColumn: string;
  target: RelationTarget;
  businessResource: string;
};

type SpecialRelationConfig = {
  kind: Exclude<RelationKind, 'simple'>;
  sourceEntity: AiRelationEntityType;
  relation: string;
  label: string;
  businessResource: string;
};

type RelationConfig = SimpleRelationConfig | SpecialRelationConfig;

type ResolvedReference = {
  id: string;
  ref: string | null;
  label: string;
  row: Record<string, unknown>;
};

type RelationItem = {
  key: string;
  label: string;
  payload: Record<string, unknown>;
};

// The CAPEX lines share the link tables of the OPEX lines (`spend_items`, nature `capex`, lot Z1):
// a relation to `capex_items` reads and replaces the links to CAPEX lines only (`targetSql`), and
// its audit rows keep their CAPEX table names (`auditTableName`).
const SIMPLE_RELATIONS: SimpleRelationConfig[] = [
  { sourceEntity: 'applications', relation: 'companies', label: 'Companies', table: 'application_companies', sourceColumn: 'application_id', targetColumn: 'company_id', target: 'companies', businessResource: 'applications', kind: 'simple' },
  { sourceEntity: 'applications', relation: 'departments', label: 'Departments', table: 'application_departments', sourceColumn: 'application_id', targetColumn: 'department_id', target: 'departments', businessResource: 'applications', kind: 'simple' },
  { sourceEntity: 'applications', relation: 'spend_items', label: 'Spend Items', table: 'application_spend_items', sourceColumn: 'application_id', targetColumn: 'spend_item_id', target: 'spend_items', businessResource: 'applications', kind: 'simple' },
  { sourceEntity: 'applications', relation: 'capex_items', label: 'CAPEX Items', table: 'application_spend_items', sourceColumn: 'application_id', targetColumn: 'spend_item_id', target: 'capex_items', businessResource: 'applications', kind: 'simple' },
  { sourceEntity: 'applications', relation: 'contracts', label: 'Contracts', table: 'application_contracts', sourceColumn: 'application_id', targetColumn: 'contract_id', target: 'contracts', businessResource: 'applications', kind: 'simple' },
  { sourceEntity: 'applications', relation: 'projects', label: 'Projects', table: 'application_projects', sourceColumn: 'application_id', targetColumn: 'project_id', target: 'projects', businessResource: 'applications', kind: 'simple' },

  { sourceEntity: 'assets', relation: 'spend_items', label: 'Spend Items', table: 'asset_spend_items', sourceColumn: 'asset_id', targetColumn: 'spend_item_id', target: 'spend_items', businessResource: 'infrastructure', kind: 'simple' },
  { sourceEntity: 'assets', relation: 'capex_items', label: 'CAPEX Items', table: 'asset_spend_items', sourceColumn: 'asset_id', targetColumn: 'spend_item_id', target: 'capex_items', businessResource: 'infrastructure', kind: 'simple' },
  { sourceEntity: 'assets', relation: 'contracts', label: 'Contracts', table: 'asset_contracts', sourceColumn: 'asset_id', targetColumn: 'contract_id', target: 'contracts', businessResource: 'infrastructure', kind: 'simple' },
  { sourceEntity: 'assets', relation: 'projects', label: 'Projects', table: 'asset_projects', sourceColumn: 'asset_id', targetColumn: 'project_id', target: 'projects', businessResource: 'infrastructure', kind: 'simple' },
  { sourceEntity: 'assets', relation: 'cluster_members', label: 'Cluster Members', table: 'asset_cluster_members', sourceColumn: 'cluster_id', targetColumn: 'asset_id', target: 'assets', businessResource: 'infrastructure', kind: 'simple' },

  { sourceEntity: 'contracts', relation: 'spend_items', label: 'Spend Items', table: 'contract_spend_items', sourceColumn: 'contract_id', targetColumn: 'spend_item_id', target: 'spend_items', businessResource: 'contracts', kind: 'simple' },
  { sourceEntity: 'contracts', relation: 'capex_items', label: 'CAPEX Items', table: 'contract_spend_items', sourceColumn: 'contract_id', targetColumn: 'spend_item_id', target: 'capex_items', businessResource: 'contracts', kind: 'simple' },

  { sourceEntity: 'spend_items', relation: 'applications', label: 'Applications', table: 'application_spend_items', sourceColumn: 'spend_item_id', targetColumn: 'application_id', target: 'applications', businessResource: 'opex', kind: 'simple' },
  { sourceEntity: 'spend_items', relation: 'projects', label: 'Projects', table: 'portfolio_project_opex', sourceColumn: 'opex_id', targetColumn: 'project_id', target: 'projects', businessResource: 'opex', kind: 'simple' },
  { sourceEntity: 'spend_items', relation: 'contracts', label: 'Contracts', table: 'contract_spend_items', sourceColumn: 'spend_item_id', targetColumn: 'contract_id', target: 'contracts', businessResource: 'opex', kind: 'simple' },

  { sourceEntity: 'capex_items', relation: 'applications', label: 'Applications', table: 'application_spend_items', sourceColumn: 'spend_item_id', targetColumn: 'application_id', target: 'applications', businessResource: 'capex', kind: 'simple' },
  { sourceEntity: 'capex_items', relation: 'projects', label: 'Projects', table: 'portfolio_project_opex', sourceColumn: 'opex_id', targetColumn: 'project_id', target: 'projects', businessResource: 'capex', kind: 'simple' },
  { sourceEntity: 'capex_items', relation: 'contracts', label: 'Contracts', table: 'contract_spend_items', sourceColumn: 'spend_item_id', targetColumn: 'contract_id', target: 'contracts', businessResource: 'capex', kind: 'simple' },

  { sourceEntity: 'projects', relation: 'applications', label: 'Applications', table: 'application_projects', sourceColumn: 'project_id', targetColumn: 'application_id', target: 'applications', businessResource: 'portfolio_projects', kind: 'simple' },
  { sourceEntity: 'projects', relation: 'assets', label: 'Assets', table: 'asset_projects', sourceColumn: 'project_id', targetColumn: 'asset_id', target: 'assets', businessResource: 'portfolio_projects', kind: 'simple' },
  { sourceEntity: 'projects', relation: 'capex_items', label: 'CAPEX Items', table: 'portfolio_project_opex', sourceColumn: 'project_id', targetColumn: 'opex_id', target: 'capex_items', businessResource: 'portfolio_projects', kind: 'simple' },
  { sourceEntity: 'projects', relation: 'spend_items', label: 'Spend Items', table: 'portfolio_project_opex', sourceColumn: 'project_id', targetColumn: 'opex_id', target: 'spend_items', businessResource: 'portfolio_projects', kind: 'simple' },

  { sourceEntity: 'requests', relation: 'applications', label: 'Applications', table: 'portfolio_request_applications', sourceColumn: 'request_id', targetColumn: 'application_id', target: 'applications', businessResource: 'portfolio_requests', kind: 'simple' },
  { sourceEntity: 'requests', relation: 'assets', label: 'Assets', table: 'portfolio_request_assets', sourceColumn: 'request_id', targetColumn: 'asset_id', target: 'assets', businessResource: 'portfolio_requests', kind: 'simple' },
  { sourceEntity: 'requests', relation: 'capex_items', label: 'CAPEX Items', table: 'portfolio_request_opex', sourceColumn: 'request_id', targetColumn: 'opex_id', target: 'capex_items', businessResource: 'portfolio_requests', kind: 'simple' },
  { sourceEntity: 'requests', relation: 'spend_items', label: 'Spend Items', table: 'portfolio_request_opex', sourceColumn: 'request_id', targetColumn: 'opex_id', target: 'spend_items', businessResource: 'portfolio_requests', kind: 'simple' },
  { sourceEntity: 'requests', relation: 'business_processes', label: 'Business Processes', table: 'portfolio_request_business_processes', sourceColumn: 'request_id', targetColumn: 'business_process_id', target: 'business_processes', businessResource: 'portfolio_requests', kind: 'simple' },
];

const SPECIAL_RELATIONS: SpecialRelationConfig[] = [
  { sourceEntity: 'applications', relation: 'owners', label: 'Owners', kind: 'owner_role', businessResource: 'applications' },
  { sourceEntity: 'applications', relation: 'support_contacts', label: 'Support Contacts', kind: 'contact_role', businessResource: 'applications' },
  { sourceEntity: 'applications', relation: 'asset_assignments', label: 'Asset Assignments', kind: 'app_asset_assignments', businessResource: 'applications' },
  { sourceEntity: 'applications', relation: 'links', label: 'Links', kind: 'link', businessResource: 'applications' },

  { sourceEntity: 'assets', relation: 'support_contacts', label: 'Support Contacts', kind: 'contact_role', businessResource: 'infrastructure' },
  { sourceEntity: 'assets', relation: 'relations', label: 'Asset Relations', kind: 'asset_relations', businessResource: 'infrastructure' },
  { sourceEntity: 'assets', relation: 'links', label: 'Links', kind: 'link', businessResource: 'infrastructure' },

  { sourceEntity: 'suppliers', relation: 'contacts', label: 'Contacts', kind: 'supplier_contacts', businessResource: 'suppliers' },
  { sourceEntity: 'contracts', relation: 'contacts', label: 'Contacts', kind: 'contact_role', businessResource: 'contracts' },
  { sourceEntity: 'contracts', relation: 'links', label: 'Links', kind: 'link', businessResource: 'contracts' },
  { sourceEntity: 'spend_items', relation: 'contacts', label: 'Contacts', kind: 'contact_role', businessResource: 'opex' },
  { sourceEntity: 'spend_items', relation: 'links', label: 'Links', kind: 'link', businessResource: 'opex' },
  { sourceEntity: 'capex_items', relation: 'contacts', label: 'Contacts', kind: 'contact_role', businessResource: 'capex' },
  { sourceEntity: 'capex_items', relation: 'links', label: 'Links', kind: 'link', businessResource: 'capex' },

  { sourceEntity: 'locations', relation: 'internal_contacts', label: 'Internal Contacts', kind: 'location_internal_contacts', businessResource: 'locations' },
  { sourceEntity: 'locations', relation: 'external_contacts', label: 'External Contacts', kind: 'location_external_contacts', businessResource: 'locations' },
  { sourceEntity: 'locations', relation: 'links', label: 'Links', kind: 'link', businessResource: 'locations' },
  { sourceEntity: 'locations', relation: 'sub_locations', label: 'Sub-locations', kind: 'sub_locations', businessResource: 'locations' },
];

const RELATION_CONFIGS: RelationConfig[] = [...SIMPLE_RELATIONS, ...SPECIAL_RELATIONS];
const BUSINESS_RESOURCES = Array.from(new Set(RELATION_CONFIGS.map((config) => config.businessResource)));

export const AI_RELATION_BUSINESS_RESOURCES = BUSINESS_RESOURCES;

export function getAiRelationBusinessResource(entityType: unknown, relation: unknown): string {
  return getRelationConfig(entityType, relation).businessResource;
}

function getRelationConfig(entityType: unknown, relation: unknown): RelationConfig {
  const normalizedEntity = String(entityType || '').trim() as AiRelationEntityType;
  const normalizedRelation = normalizeKey(String(relation || ''));
  const config = RELATION_CONFIGS.find((item) => item.sourceEntity === normalizedEntity && item.relation === normalizedRelation);
  if (!config) {
    const supported = RELATION_CONFIGS
      .filter((item) => item.sourceEntity === normalizedEntity)
      .map((item) => item.relation)
      .join(', ');
    throw new BadRequestException(
      supported
        ? `Unsupported relation "${relation}" for ${normalizedEntity}. Supported relations: ${supported}.`
        : `Unsupported relation entity type "${entityType}".`,
    );
  }
  return config;
}

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function coerceItemArray(value: unknown, label: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new BadRequestException(`${label} must be an array.`);
  return value;
}

function relationItemSignature(items: RelationItem[]): string {
  return JSON.stringify(
    items
      .map((item) => ({ key: item.key, payload: normalizePayload(item.payload) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}

function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

function itemListLabel(items: RelationItem[]): string | null {
  if (items.length === 0) return null;
  return items.map((item) => item.label).join(', ');
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

@Injectable()
export class AiRelationMutationSupportService {
  constructor(
    private readonly audit: AuditService,
    private readonly supplierContacts: SupplierContactsService,
    private readonly taskSupport: AiTaskMutationSupportService,
  ) {}

  getSupportedRelationDescriptions(): string[] {
    const byEntity = new Map<string, string[]>();
    for (const config of RELATION_CONFIGS) {
      const values = byEntity.get(config.sourceEntity) ?? [];
      values.push(config.relation);
      byEntity.set(config.sourceEntity, values);
    }
    return Array.from(byEntity.entries()).map(([entity, relations]) => `${entity}: ${relations.join(', ')}`);
  }

  async prepareUpdatePreview(
    context: AiExecutionContextWithManager,
    input: AiUpdateEntityRelationsInput,
  ): Promise<AiPreparedMutationPreview> {
    const config = getRelationConfig(input.entity_type, input.relation);
    const target = await this.resolveSource(context, config.sourceEntity, input.ref);
    const currentItems = await this.loadRelationItems(context, config, target.id);
    const nextItems = await this.computeNextItems(context, config, target.id, currentItems, input);
    if (relationItemSignature(currentItems) === relationItemSignature(nextItems)) {
      throw new BadRequestException(`${config.label} already has the requested links.`);
    }
    return {
      targetEntityType: config.sourceEntity,
      targetEntityId: target.id,
      mutationInput: {
        action: 'update_relations',
        entity_type: config.sourceEntity,
        relation: config.relation,
        relation_label: config.label,
        next_items: nextItems,
        source_preview_id: null,
      },
      currentValues: {
        target_ref: target.ref,
        target_title: target.label,
        items: currentItems,
      },
    };
  }

  async prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const config = getRelationConfig(preview.target_entity_type || preview.mutation_input?.entity_type, preview.mutation_input?.relation);
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the target record.');
    const target = await this.resolveSource(context, config.sourceEntity, preview.target_entity_id);
    const currentItems = await this.loadRelationItems(context, config, target.id);
    const previousItems = this.coerceRelationItems(preview.current_values?.items, 'current_values.items');
    if (relationItemSignature(currentItems) === relationItemSignature(previousItems)) {
      throw new BadRequestException(`${config.label} already matches the original values.`);
    }
    return {
      targetEntityType: config.sourceEntity,
      targetEntityId: target.id,
      mutationInput: {
        action: 'update_relations',
        entity_type: config.sourceEntity,
        relation: config.relation,
        relation_label: config.label,
        next_items: previousItems,
        source_preview_id: preview.id,
      },
      currentValues: {
        target_ref: target.ref,
        target_title: target.label,
        items: currentItems,
      },
    };
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    const config = getRelationConfig(preview.target_entity_type || preview.mutation_input?.entity_type, preview.mutation_input?.relation);
    const currentItems = this.coerceRelationItems(preview.current_values?.items, 'current_values.items');
    const nextItems = this.coerceRelationItems(preview.mutation_input?.next_items, 'mutation_input.next_items');
    const title = textOrNull(preview.current_values?.target_title) || preview.target_entity_id || config.sourceEntity;
    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Update ${config.label.toLowerCase()} for ${config.sourceEntity.slice(0, -1)} "${title}".`;
        break;
      case 'executed':
        summary = `Updated ${config.label.toLowerCase()} for "${title}".`;
        break;
      case 'rejected':
        summary = `Relation update preview for "${title}" was rejected.`;
        break;
      case 'expired':
        summary = `Relation update preview for "${title}" expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Relation update preview for "${title}" failed.`;
        break;
    }
    const changes: Record<string, AiMutationPreviewChangeDto> = {
      [config.relation]: {
        label: config.label,
        from: itemListLabel(currentItems),
        to: itemListLabel(nextItems),
        format: 'text',
      },
    };
    return {
      target: {
        entity_type: config.sourceEntity,
        entity_id: preview.target_entity_id ?? null,
        ref: textOrNull(preview.current_values?.target_ref),
        title,
      },
      changes,
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    const config = getRelationConfig(preview.target_entity_type || preview.mutation_input?.entity_type, preview.mutation_input?.relation);
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the target record.');
    const expectedItems = this.coerceRelationItems(preview.current_values?.items, 'current_values.items');
    const nextItems = this.coerceRelationItems(preview.mutation_input?.next_items, 'mutation_input.next_items');
    // An OPEX or CAPEX line is locked before its relations are compared and replaced (lock
    // order, `spend/budget-locks.ts`): no writer of the line changes them in between.
    if (config.sourceEntity === 'spend_items' || config.sourceEntity === 'capex_items') {
      const scope = config.sourceEntity === 'spend_items' ? 'opex' : 'capex';
      if (!(await lockBudgetLine(context.manager, scope, context.tenantId, preview.target_entity_id))) {
        throw new NotFoundException(`${config.label}: the line was not found.`);
      }
    }
    const liveItems = await this.loadRelationItems(context, config, preview.target_entity_id);
    if (relationItemSignature(liveItems) !== relationItemSignature(expectedItems)) {
      throw new ConflictException(`${config.label} changed after the preview was created.`);
    }
    const audit = buildAiMutationAudit(preview);
    await this.replaceRelationItems(context, config, preview.target_entity_id, nextItems, audit);
    await this.audit.log(
      {
        table: this.auditTableName(config),
        recordId: preview.target_entity_id,
        action: 'update',
        before: expectedItems,
        after: nextItems,
        userId: context.userId,
        source: audit.source,
        sourceRef: audit.sourceRef,
      },
      { manager: context.manager },
    );
  }

  private coerceRelationItems(value: unknown, fieldName: string): RelationItem[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an array.`);
    }
    return value.map((item) => {
      const record = objectValue(item);
      return {
        key: String(record.key || ''),
        label: String(record.label || record.key || ''),
        payload: objectValue(record.payload),
      };
    }).filter((item) => item.key);
  }

  private async computeNextItems(
    context: AiExecutionContextWithManager,
    config: RelationConfig,
    sourceId: string,
    currentItems: RelationItem[],
    input: AiUpdateEntityRelationsInput,
  ): Promise<RelationItem[]> {
    const add = coerceItemArray(input.add, 'add');
    const remove = coerceItemArray(input.remove, 'remove');
    if (add.length === 0 && remove.length === 0) {
      throw new BadRequestException('At least one add or remove item is required.');
    }

    const next = new Map(currentItems.map((item) => [item.key, item]));
    for (const raw of remove) {
      const item = await this.resolveRelationInput(context, config, sourceId, raw, 'remove', currentItems);
      if (!next.has(item.key)) {
        throw new BadRequestException(`${item.label} is not currently linked.`);
      }
      next.delete(item.key);
    }
    for (const raw of add) {
      const item = await this.resolveRelationInput(context, config, sourceId, raw, 'add', currentItems);
      next.set(item.key, item);
    }
    return Array.from(next.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  private async resolveRelationInput(
    context: AiExecutionContextWithManager,
    config: RelationConfig,
    sourceId: string,
    raw: unknown,
    mode: 'add' | 'remove',
    currentItems: RelationItem[],
  ): Promise<RelationItem> {
    if (config.kind === 'simple') {
      const targetRef = this.extractRef(raw);
      const target = await this.resolveReference(context, config.target, targetRef);
      return { key: target.id, label: target.label, payload: { [config.targetColumn]: target.id } };
    }
    switch (config.kind) {
      case 'owner_role':
        return this.resolveOwnerRoleInput(context, raw);
      case 'contact_role':
        return this.resolveContactRoleInput(context, raw, config.sourceEntity === 'contracts' || config.sourceEntity === 'spend_items' || config.sourceEntity === 'capex_items');
      case 'supplier_contacts':
        return this.resolveSupplierContactInput(context, raw);
      case 'asset_relations':
        return this.resolveAssetRelationInput(context, raw);
      case 'link':
        return this.resolveLinkInput(raw, mode, currentItems);
      case 'location_internal_contacts':
        return this.resolveLocationInternalContactInput(context, raw);
      case 'location_external_contacts':
        return this.resolveLocationExternalContactInput(context, raw);
      case 'sub_locations':
        return this.resolveSubLocationInput(raw, mode, currentItems);
      case 'app_asset_assignments':
        return this.resolveAppAssetAssignmentInput(context, sourceId, raw, mode, currentItems);
      default:
        throw new BadRequestException(`Unsupported relation kind ${(config as any).kind}.`);
    }
  }

  private extractRef(raw: unknown): string {
    if (raw == null) throw new BadRequestException('Relation reference is required.');
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return String(raw).trim();
    }
    const item = raw as Record<string, unknown>;
    const ref = item.ref ?? item.id ?? item.name ?? item.code ?? item.email ?? item.label;
    const text = textOrNull(ref);
    if (!text) throw new BadRequestException('Relation reference is required.');
    return text;
  }

  private async resolveOwnerRoleInput(context: AiExecutionContextWithManager, raw: unknown): Promise<RelationItem> {
    const item = objectValue(raw);
    const role = normalizeKey(String(item.owner_type ?? item.role ?? ''));
    if (role !== 'business' && role !== 'it') {
      throw new BadRequestException('Owner role must be business or it.');
    }
    const ref = textOrNull(item.user_ref ?? item.user_id ?? item.email ?? item.ref ?? raw);
    if (!ref) throw new BadRequestException('Owner user reference is required.');
    const user = isUuid(ref)
      ? await this.resolveUserById(context, ref)
      : await this.taskSupport.resolveUserReference(context, ref);
    return {
      key: `${role}:${user.id}`,
      label: `${role.toUpperCase()} owner: ${user.label}`,
      payload: { user_id: user.id, owner_type: role },
    };
  }

  private async resolveContactRoleInput(context: AiExecutionContextWithManager, raw: unknown, supplierOriginCapable: boolean): Promise<RelationItem> {
    const item = objectValue(raw);
    const ref = textOrNull(item.contact_ref ?? item.contact_id ?? item.email ?? item.ref ?? raw);
    if (!ref) throw new BadRequestException('Contact reference is required.');
    const contact = await this.resolveReference(context, 'contacts', ref);
    const role = textOrNull(item.role) ?? null;
    const origin = supplierOriginCapable ? textOrNull(item.origin) ?? 'manual' : null;
    return {
      key: `${contact.id}:${role ?? ''}:${origin ?? ''}`,
      label: [contact.label, role].filter(Boolean).join(' - '),
      payload: { contact_id: contact.id, role, origin },
    };
  }

  private async resolveSupplierContactInput(context: AiExecutionContextWithManager, raw: unknown): Promise<RelationItem> {
    const item = objectValue(raw);
    const ref = textOrNull(item.contact_ref ?? item.contact_id ?? item.email ?? item.ref ?? raw);
    if (!ref) throw new BadRequestException('Contact reference is required.');
    const contact = await this.resolveReference(context, 'contacts', ref);
    const role = normalizeKey(String(item.role ?? 'other'));
    if (!['commercial', 'technical', 'support', 'other'].includes(role)) {
      throw new BadRequestException('Supplier contact role must be commercial, technical, support, or other.');
    }
    return {
      key: `${contact.id}:${role}`,
      label: `${contact.label} - ${role}`,
      payload: { contact_id: contact.id, role, is_primary: item.is_primary === true },
    };
  }

  private async resolveAssetRelationInput(context: AiExecutionContextWithManager, raw: unknown): Promise<RelationItem> {
    const item = objectValue(raw);
    const ref = textOrNull(item.related_asset_ref ?? item.related_asset_id ?? item.asset_ref ?? item.asset_id ?? item.ref ?? raw);
    if (!ref) throw new BadRequestException('Related asset reference is required.');
    const target = await this.resolveReference(context, 'assets', ref);
    const relationType = normalizeKey(String(item.relation_type ?? item.type ?? ''));
    if (relationType !== 'contains' && relationType !== 'depends_on') {
      throw new BadRequestException('Asset relation_type must be contains or depends_on.');
    }
    return {
      key: `${target.id}:${relationType}`,
      label: `${relationType}: ${target.label}`,
      payload: { related_asset_id: target.id, relation_type: relationType, notes: textOrNull(item.notes) },
    };
  }

  private resolveLinkInput(raw: unknown, mode: 'add' | 'remove', currentItems: RelationItem[]): RelationItem {
    const item = objectValue(raw);
    const id = textOrNull(item.id ?? item.link_id);
    if (mode === 'remove' && id) {
      const existing = currentItems.find((candidate) => candidate.payload.id === id || candidate.key === id);
      if (!existing) throw new BadRequestException(`Link ${id} is not currently linked.`);
      return existing;
    }
    const url = textOrNull(item.url ?? raw);
    if (!url) throw new BadRequestException('Link URL is required.');
    const existing = currentItems.find((candidate) => String(candidate.payload.url || '').trim().toLowerCase() === url.toLowerCase());
    if (mode === 'remove') {
      if (!existing) throw new BadRequestException(`Link ${url} is not currently linked.`);
      return existing;
    }
    return {
      key: existing?.key ?? `new:${url.toLowerCase()}`,
      label: textOrNull(item.description) ? `${item.description}: ${url}` : url,
      payload: { id: existing?.payload.id ?? null, url, description: textOrNull(item.description) },
    };
  }

  private async resolveLocationInternalContactInput(context: AiExecutionContextWithManager, raw: unknown): Promise<RelationItem> {
    const item = objectValue(raw);
    const ref = textOrNull(item.user_ref ?? item.user_id ?? item.email ?? item.ref ?? raw);
    if (!ref) throw new BadRequestException('User reference is required.');
    const user = isUuid(ref)
      ? await this.resolveUserById(context, ref)
      : await this.taskSupport.resolveUserReference(context, ref);
    const role = textOrNull(item.role);
    return {
      key: user.id,
      label: [user.label, role].filter(Boolean).join(' - '),
      payload: { user_id: user.id, role },
    };
  }

  private async resolveLocationExternalContactInput(context: AiExecutionContextWithManager, raw: unknown): Promise<RelationItem> {
    const item = objectValue(raw);
    const ref = textOrNull(item.contact_ref ?? item.contact_id ?? item.email ?? item.ref ?? raw);
    if (!ref) throw new BadRequestException('External contact reference is required.');
    const contact = await this.resolveReference(context, 'contacts', ref);
    const role = textOrNull(item.role);
    return {
      key: contact.id,
      label: [contact.label, role].filter(Boolean).join(' - '),
      payload: { contact_id: contact.id, role },
    };
  }

  private resolveSubLocationInput(raw: unknown, mode: 'add' | 'remove', currentItems: RelationItem[]): RelationItem {
    const item = objectValue(raw);
    const id = textOrNull(item.id ?? item.sub_location_id);
    if (mode === 'remove' && id) {
      const existing = currentItems.find((candidate) => candidate.payload.id === id || candidate.key === id);
      if (!existing) throw new BadRequestException(`Sub-location ${id} is not currently present.`);
      return existing;
    }
    const name = textOrNull(item.name ?? item.ref ?? raw);
    if (!name) throw new BadRequestException('Sub-location name is required.');
    const existing = currentItems.find((candidate) => String(candidate.payload.name || '').trim().toLowerCase() === name.toLowerCase());
    if (mode === 'remove') {
      if (!existing) throw new BadRequestException(`Sub-location ${name} is not currently present.`);
      return existing;
    }
    return {
      key: existing?.key ?? `new:${name.toLowerCase()}`,
      label: name,
      payload: { id: existing?.payload.id ?? null, name, description: textOrNull(item.description) },
    };
  }

  private async resolveAppAssetAssignmentInput(
    context: AiExecutionContextWithManager,
    applicationId: string,
    raw: unknown,
    mode: 'add' | 'remove',
    currentItems: RelationItem[],
  ): Promise<RelationItem> {
    const item = objectValue(raw);
    const assignmentId = textOrNull(item.id ?? item.assignment_id);
    if (mode === 'remove' && assignmentId) {
      const existing = currentItems.find((candidate) => candidate.payload.id === assignmentId || candidate.key === assignmentId);
      if (!existing) throw new BadRequestException(`Asset assignment ${assignmentId} is not currently present.`);
      return existing;
    }
    const environment = normalizeKey(String(item.environment ?? item.env ?? ''));
    if (!environment) throw new BadRequestException('Asset assignment environment is required.');
    const instances = await context.manager.query(
      `SELECT id, environment FROM app_instances WHERE tenant_id = $1 AND application_id = $2 AND environment = $3 LIMIT 2`,
      [context.tenantId, applicationId, environment],
    );
    if (instances.length === 0) throw new NotFoundException(`Application instance ${environment} not found.`);
    const assetRef = textOrNull(item.asset_ref ?? item.asset_id ?? item.server_ref ?? item.server_id ?? item.ref);
    if (!assetRef) throw new BadRequestException('Asset reference is required.');
    const asset = await this.resolveReference(context, 'assets', assetRef);
    const role = normalizeKey(String(item.role ?? ''));
    if (!role) throw new BadRequestException('Asset assignment role is required.');
    const key = `${instances[0].id}:${asset.id}:${role}`;
    const existing = currentItems.find((candidate) => candidate.key === key);
    if (mode === 'remove') {
      if (!existing) throw new BadRequestException(`${asset.label} is not assigned as ${role} in ${environment}.`);
      return existing;
    }
    return {
      key,
      label: `${environment}: ${asset.label} (${role})`,
      payload: {
        app_instance_id: instances[0].id,
        environment,
        asset_id: asset.id,
        role,
        since_date: textOrNull(item.since_date),
        notes: textOrNull(item.notes),
      },
    };
  }

  private async loadRelationItems(
    context: AiExecutionContextWithManager,
    config: RelationConfig,
    sourceId: string,
  ): Promise<RelationItem[]> {
    if (config.kind === 'simple') {
      return this.loadSimpleRelation(context, config, sourceId);
    }
    switch (config.kind) {
      case 'owner_role':
        return this.loadOwnerRoles(context, sourceId);
      case 'contact_role':
        return this.loadContactRoles(context, config, sourceId);
      case 'supplier_contacts':
        return this.loadSupplierContacts(context, sourceId);
      case 'asset_relations':
        return this.loadAssetRelations(context, sourceId);
      case 'link':
        return this.loadLinks(context, config, sourceId);
      case 'location_internal_contacts':
        return this.loadLocationInternalContacts(context, sourceId);
      case 'location_external_contacts':
        return this.loadLocationExternalContacts(context, sourceId);
      case 'sub_locations':
        return this.loadSubLocations(context, sourceId);
      case 'app_asset_assignments':
        return this.loadAppAssetAssignments(context, sourceId);
      default:
        throw new BadRequestException(`Unsupported relation kind ${(config as any).kind}.`);
    }
  }

  private async loadSimpleRelation(context: AiExecutionContextWithManager, config: SimpleRelationConfig, sourceId: string): Promise<RelationItem[]> {
    const target = this.targetSql(config.target);
    const params: unknown[] = [context.tenantId, sourceId];
    const accessScope = config.target === 'applications'
      ? await resolveBusinessContributorScopeForUser({
        manager: context.manager,
        userId: context.userId,
        tenantId: context.tenantId,
      }, 'applications', 'reader')
      : undefined;
    const accessScopeSql = accessScope
      ? (() => {
        params.push(accessScope.userId);
        return `AND ${applicationParticipantCondition('t', `$${params.length}`)}`;
      })()
      : '';
    const rows = await context.manager.query(
      `
      SELECT l.${config.targetColumn} AS target_id,
             ${target.labelSql} AS label
      FROM ${config.table} l
      JOIN ${target.table} t ON t.id = l.${config.targetColumn} AND t.tenant_id = $1${target.where ?? ''}
      WHERE l.tenant_id = $1 AND l.${config.sourceColumn} = $2
      ${accessScopeSql}
      ORDER BY label ASC
      `,
      params,
    );
    return rows.map((row: any) => ({
      key: String(row.target_id),
      label: String(row.label || row.target_id),
      payload: { [config.targetColumn]: String(row.target_id) },
    }));
  }

  /** `where`: a predicate on the target row `t`; a `spend_items` target is an OPEX line, a `capex_items` one a CAPEX line (`spend/budget-nature.ts`). */
  private targetSql(target: RelationTarget): { table: string; labelSql: string; where?: string } {
    switch (target) {
      case 'applications': return { table: 'applications', labelSql: `COALESCE(NULLIF(CONCAT(COALESCE(t.sequential_id, ''), ' - ', t.name), ' - '), t.name, t.id::text)` };
      case 'assets': return { table: 'assets', labelSql: `COALESCE(NULLIF(CONCAT(COALESCE(t.asset_reference, ''), ' - ', t.name), ' - '), t.name, t.id::text)` };
      case 'business_processes': return { table: 'business_processes', labelSql: 'COALESCE(t.name, t.id::text)' };
      case 'capex_items': return { table: 'spend_items', labelSql: 'COALESCE(t.product_name, t.id::text)', where: ` AND t.nature = 'capex'` };
      case 'companies': return { table: 'companies', labelSql: 'COALESCE(t.name, t.id::text)' };
      case 'contacts': return { table: 'contacts', labelSql: `COALESCE(NULLIF(TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''))), ''), t.email, t.id::text)` };
      case 'contracts': return { table: 'contracts', labelSql: 'COALESCE(t.name, t.id::text)' };
      case 'departments': return { table: 'departments', labelSql: 'COALESCE(t.name, t.id::text)' };
      case 'projects': return { table: 'portfolio_projects', labelSql: `COALESCE(CONCAT('PRJ-', t.item_number::text, ' - ', t.name), t.name, t.id::text)` };
      case 'requests': return { table: 'portfolio_requests', labelSql: `COALESCE(CONCAT('REQ-', t.item_number::text, ' - ', t.name), t.name, t.id::text)` };
      case 'spend_items': return { table: 'spend_items', labelSql: 'COALESCE(t.product_name, t.id::text)', where: ` AND t.nature = 'opex'` };
      case 'suppliers': return { table: 'suppliers', labelSql: 'COALESCE(t.name, t.id::text)' };
      case 'users': return { table: 'users', labelSql: `COALESCE(NULLIF(TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''))), ''), t.email, t.id::text)` };
    }
  }

  private async loadOwnerRoles(context: AiExecutionContextWithManager, applicationId: string): Promise<RelationItem[]> {
    const rows = await context.manager.query(
      `
      SELECT o.user_id, o.owner_type,
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email, o.user_id::text) AS label
      FROM application_owners o
      LEFT JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 AND o.application_id = $2
      ORDER BY o.owner_type, label
      `,
      [context.tenantId, applicationId],
    );
    return rows.map((row: any) => ({
      key: `${row.owner_type}:${row.user_id}`,
      label: `${String(row.owner_type).toUpperCase()} owner: ${row.label}`,
      payload: { user_id: row.user_id, owner_type: row.owner_type },
    }));
  }

  private contactTable(config: RelationConfig): { table: string; sourceColumn: string; includeOrigin: boolean } {
    if (config.sourceEntity === 'applications') return { table: 'application_support_contacts', sourceColumn: 'application_id', includeOrigin: false };
    if (config.sourceEntity === 'assets') return { table: 'asset_support_contacts', sourceColumn: 'asset_id', includeOrigin: false };
    if (config.sourceEntity === 'contracts') return { table: 'contract_contacts', sourceColumn: 'contract_id', includeOrigin: true };
    if (config.sourceEntity === 'spend_items') return { table: 'spend_item_contacts', sourceColumn: 'spend_item_id', includeOrigin: true };
    // A CAPEX line (resolved with its nature): its contacts share the OPEX table.
    return { table: 'spend_item_contacts', sourceColumn: 'spend_item_id', includeOrigin: true };
  }

  private async loadContactRoles(context: AiExecutionContextWithManager, config: RelationConfig, sourceId: string): Promise<RelationItem[]> {
    const table = this.contactTable(config);
    const originSelect = table.includeOrigin ? ', l.origin' : `, NULL::text AS origin`;
    const rows = await context.manager.query(
      `
      SELECT l.contact_id, l.role${originSelect},
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), ''), c.email, l.contact_id::text) AS label
      FROM ${table.table} l
      JOIN contacts c ON c.id = l.contact_id AND c.tenant_id = $1
      WHERE l.tenant_id = $1 AND l.${table.sourceColumn} = $2
      ORDER BY label, l.role
      `,
      [context.tenantId, sourceId],
    );
    return rows.map((row: any) => ({
      key: `${row.contact_id}:${row.role ?? ''}:${row.origin ?? ''}`,
      label: [row.label, row.role].filter(Boolean).join(' - '),
      payload: { contact_id: row.contact_id, role: row.role ?? null, origin: row.origin ?? null },
    }));
  }

  private async loadSupplierContacts(context: AiExecutionContextWithManager, supplierId: string): Promise<RelationItem[]> {
    const rows = await context.manager.query(
      `
      SELECT l.id, l.contact_id, l.role, l.is_primary,
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), ''), c.email, l.contact_id::text) AS label
      FROM supplier_contacts l
      JOIN contacts c ON c.id = l.contact_id AND c.tenant_id = $1
      WHERE l.tenant_id = $1 AND l.supplier_id = $2
      ORDER BY label, l.role
      `,
      [context.tenantId, supplierId],
    );
    return rows.map((row: any) => ({
      key: `${row.contact_id}:${row.role}`,
      label: `${row.label} - ${row.role}`,
      payload: { id: row.id, contact_id: row.contact_id, role: row.role, is_primary: row.is_primary === true },
    }));
  }

  private async loadAssetRelations(context: AiExecutionContextWithManager, assetId: string): Promise<RelationItem[]> {
    const rows = await context.manager.query(
      `
      SELECT r.related_asset_id, r.relation_type, r.notes,
             COALESCE(NULLIF(CONCAT(COALESCE(a.asset_reference, ''), ' - ', a.name), ' - '), a.name, r.related_asset_id::text) AS label
      FROM asset_relations r
      JOIN assets a ON a.id = r.related_asset_id AND a.tenant_id = $1
      WHERE r.tenant_id = $1 AND r.asset_id = $2
      ORDER BY r.relation_type, label
      `,
      [context.tenantId, assetId],
    );
    return rows.map((row: any) => ({
      key: `${row.related_asset_id}:${row.relation_type}`,
      label: `${row.relation_type}: ${row.label}`,
      payload: { related_asset_id: row.related_asset_id, relation_type: row.relation_type, notes: row.notes ?? null },
    }));
  }

  private linkTable(config: RelationConfig): { table: string; sourceColumn: string } {
    if (config.sourceEntity === 'applications') return { table: 'application_links', sourceColumn: 'application_id' };
    if (config.sourceEntity === 'assets') return { table: 'asset_links', sourceColumn: 'asset_id' };
    if (config.sourceEntity === 'contracts') return { table: 'contract_links', sourceColumn: 'contract_id' };
    if (config.sourceEntity === 'spend_items') return { table: 'spend_links', sourceColumn: 'spend_item_id' };
    if (config.sourceEntity === 'capex_items') return { table: 'spend_links', sourceColumn: 'spend_item_id' };
    return { table: 'location_links', sourceColumn: 'location_id' };
  }

  private async loadLinks(context: AiExecutionContextWithManager, config: RelationConfig, sourceId: string): Promise<RelationItem[]> {
    const table = this.linkTable(config);
    const rows = await context.manager.query(
      `
      SELECT id, url, description
      FROM ${table.table}
      WHERE tenant_id = $1 AND ${table.sourceColumn} = $2
      ORDER BY created_at DESC
      `,
      [context.tenantId, sourceId],
    );
    return rows.map((row: any) => ({
      key: String(row.id),
      label: row.description ? `${row.description}: ${row.url}` : row.url,
      payload: { id: row.id, url: row.url, description: row.description ?? null },
    }));
  }

  private async loadLocationInternalContacts(context: AiExecutionContextWithManager, locationId: string): Promise<RelationItem[]> {
    const rows = await context.manager.query(
      `
      SELECT l.user_id, l.role,
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email, l.user_id::text) AS label
      FROM location_user_contacts l
      JOIN users u ON u.id = l.user_id AND u.tenant_id = $1
      WHERE l.tenant_id = $1 AND l.location_id = $2
      ORDER BY label
      `,
      [context.tenantId, locationId],
    );
    return rows.map((row: any) => ({
      key: String(row.user_id),
      label: [row.label, row.role].filter(Boolean).join(' - '),
      payload: { user_id: row.user_id, role: row.role ?? null },
    }));
  }

  private async loadLocationExternalContacts(context: AiExecutionContextWithManager, locationId: string): Promise<RelationItem[]> {
    const rows = await context.manager.query(
      `
      SELECT l.contact_id, l.role,
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), ''), c.email, l.contact_id::text) AS label
      FROM location_contacts l
      JOIN contacts c ON c.id = l.contact_id AND c.tenant_id = $1
      WHERE l.tenant_id = $1 AND l.location_id = $2
      ORDER BY label
      `,
      [context.tenantId, locationId],
    );
    return rows.map((row: any) => ({
      key: String(row.contact_id),
      label: [row.label, row.role].filter(Boolean).join(' - '),
      payload: { contact_id: row.contact_id, role: row.role ?? null },
    }));
  }

  private async loadSubLocations(context: AiExecutionContextWithManager, locationId: string): Promise<RelationItem[]> {
    const rows = await context.manager.query(
      `
      SELECT id, name, description
      FROM location_sub_items
      WHERE tenant_id = $1 AND location_id = $2
      ORDER BY name
      `,
      [context.tenantId, locationId],
    );
    return rows.map((row: any) => ({
      key: String(row.id),
      label: row.name,
      payload: { id: row.id, name: row.name, description: row.description ?? null },
    }));
  }

  private async loadAppAssetAssignments(context: AiExecutionContextWithManager, applicationId: string): Promise<RelationItem[]> {
    const rows = await context.manager.query(
      `
      SELECT aaa.id, aaa.app_instance_id, ai.environment, aaa.asset_id, aaa.role, aaa.since_date, aaa.notes,
             COALESCE(NULLIF(CONCAT(COALESCE(a.asset_reference, ''), ' - ', a.name), ' - '), a.name, aaa.asset_id::text) AS asset_label
      FROM app_asset_assignments aaa
      JOIN app_instances ai ON ai.id = aaa.app_instance_id AND ai.tenant_id = $1
      JOIN assets a ON a.id = aaa.asset_id AND a.tenant_id = $1
      WHERE aaa.tenant_id = $1 AND ai.application_id = $2
      ORDER BY ai.environment, asset_label, aaa.role
      `,
      [context.tenantId, applicationId],
    );
    return rows.map((row: any) => ({
      key: `${row.app_instance_id}:${row.asset_id}:${row.role}`,
      label: `${row.environment}: ${row.asset_label} (${row.role})`,
      payload: {
        id: row.id,
        app_instance_id: row.app_instance_id,
        environment: row.environment,
        asset_id: row.asset_id,
        role: row.role,
        since_date: row.since_date ?? null,
        notes: row.notes ?? null,
      },
    }));
  }

  private async replaceRelationItems(
    context: AiExecutionContextWithManager,
    config: RelationConfig,
    sourceId: string,
    nextItems: RelationItem[],
    audit: AiMutationAuditOptions,
  ): Promise<void> {
    if (config.kind === 'simple') {
      await this.replaceSimpleRelation(context, config, sourceId, nextItems);
      return;
    }
    switch (config.kind) {
      case 'owner_role':
        await this.replaceOwnerRoles(context, sourceId, nextItems);
        return;
      case 'contact_role':
        await this.replaceContactRoles(context, config, sourceId, nextItems);
        return;
      case 'supplier_contacts':
        await this.replaceSupplierContacts(context, sourceId, nextItems, audit);
        return;
      case 'asset_relations':
        await this.replaceAssetRelations(context, sourceId, nextItems);
        return;
      case 'link':
        await this.replaceLinks(context, config, sourceId, nextItems);
        return;
      case 'location_internal_contacts':
        await this.replaceLocationContacts(context, 'location_user_contacts', 'user_id', sourceId, nextItems);
        return;
      case 'location_external_contacts':
        await this.replaceLocationContacts(context, 'location_contacts', 'contact_id', sourceId, nextItems);
        return;
      case 'sub_locations':
        await this.replaceSubLocations(context, sourceId, nextItems);
        return;
      case 'app_asset_assignments':
        await this.replaceAppAssetAssignments(context, sourceId, nextItems);
        return;
      default:
        throw new BadRequestException(`Unsupported relation kind ${(config as any).kind}.`);
    }
  }

  private async replaceSimpleRelation(context: AiExecutionContextWithManager, config: SimpleRelationConfig, sourceId: string, nextItems: RelationItem[]): Promise<void> {
    // A target with a predicate (OPEX or CAPEX lines): only the links to such targets are replaced,
    // a link to a line of the other nature stays.
    const target = this.targetSql(config.target);
    const ofTarget = target.where
      ? ` AND EXISTS (SELECT 1 FROM ${target.table} t WHERE t.tenant_id = l.tenant_id AND t.id = l.${config.targetColumn}${target.where})`
      : '';
    await context.manager.query(`DELETE FROM ${config.table} l WHERE l.tenant_id = $1 AND l.${config.sourceColumn} = $2${ofTarget}`, [context.tenantId, sourceId]);
    for (const item of nextItems) {
      const targetId = item.payload[config.targetColumn];
      if (!targetId) continue;
      await context.manager.query(
        `INSERT INTO ${config.table} (tenant_id, ${config.sourceColumn}, ${config.targetColumn}) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [context.tenantId, sourceId, targetId],
      );
    }
  }

  private async replaceOwnerRoles(context: AiExecutionContextWithManager, applicationId: string, nextItems: RelationItem[]): Promise<void> {
    await context.manager.query(`DELETE FROM application_owners WHERE tenant_id = $1 AND application_id = $2`, [context.tenantId, applicationId]);
    for (const item of nextItems) {
      await context.manager.query(
        `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [context.tenantId, applicationId, item.payload.user_id, item.payload.owner_type],
      );
    }
  }

  private async replaceContactRoles(context: AiExecutionContextWithManager, config: RelationConfig, sourceId: string, nextItems: RelationItem[]): Promise<void> {
    const table = this.contactTable(config);
    await context.manager.query(`DELETE FROM ${table.table} WHERE tenant_id = $1 AND ${table.sourceColumn} = $2`, [context.tenantId, sourceId]);
    for (const item of nextItems) {
      const columns = table.includeOrigin
        ? `(tenant_id, ${table.sourceColumn}, contact_id, role, origin)`
        : `(tenant_id, ${table.sourceColumn}, contact_id, role)`;
      const values = table.includeOrigin ? `($1, $2, $3, $4, $5)` : `($1, $2, $3, $4)`;
      const params = table.includeOrigin
        ? [context.tenantId, sourceId, item.payload.contact_id, item.payload.role, item.payload.origin ?? 'manual']
        : [context.tenantId, sourceId, item.payload.contact_id, item.payload.role];
      await context.manager.query(`INSERT INTO ${table.table} ${columns} VALUES ${values} ON CONFLICT DO NOTHING`, params);
    }
  }

  /** The supplier links and every link they propagate are audited with the preview's source, like the summary row. */
  private async replaceSupplierContacts(
    context: AiExecutionContextWithManager,
    supplierId: string,
    nextItems: RelationItem[],
    audit: AiMutationAuditOptions,
  ): Promise<void> {
    const current = await this.loadSupplierContacts(context, supplierId);
    const currentByKey = new Map(current.map((item) => [item.key, item]));
    const nextByKey = new Map(nextItems.map((item) => [item.key, item]));
    for (const item of current) {
      if (nextByKey.has(item.key)) continue;
      const linkId = textOrNull(item.payload.id);
      if (linkId) {
        await this.supplierContacts.detach(supplierId, linkId, { manager: context.manager, tenantId: context.tenantId, userId: context.userId, audit });
      }
    }
    for (const item of nextItems) {
      const currentItem = currentByKey.get(item.key);
      if (currentItem) {
        if ((currentItem.payload.is_primary === true) !== (item.payload.is_primary === true)) {
          const [before] = await context.manager.query(
            `SELECT * FROM supplier_contacts WHERE tenant_id = $1 AND id = $2`,
            [context.tenantId, currentItem.payload.id],
          );
          const after = firstReturnedRow<{ id: string }>(await context.manager.query(
            `UPDATE supplier_contacts SET is_primary = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3 RETURNING *`,
            [item.payload.is_primary === true, context.tenantId, currentItem.payload.id],
          ));
          // The link change is audited like the links attach and detach write, with the preview's source.
          if (before && after) {
            await this.audit.log(
              {
                table: 'supplier_contacts',
                recordId: after.id,
                action: 'update',
                before,
                after,
                userId: context.userId,
                source: audit.source,
                sourceRef: audit.sourceRef,
              },
              { manager: context.manager },
            );
          }
        }
        continue;
      }
      await this.supplierContacts.attach(
        supplierId,
        {
          contactId: String(item.payload.contact_id),
          role: String(item.payload.role) as any,
          isPrimary: item.payload.is_primary === true,
        },
        { manager: context.manager, tenantId: context.tenantId, userId: context.userId, audit },
      );
    }
  }

  private async replaceAssetRelations(context: AiExecutionContextWithManager, assetId: string, nextItems: RelationItem[]): Promise<void> {
    await context.manager.query(`DELETE FROM asset_relations WHERE tenant_id = $1 AND asset_id = $2`, [context.tenantId, assetId]);
    for (const item of nextItems) {
      if (item.payload.related_asset_id === assetId) throw new BadRequestException('Asset cannot have a relation to itself.');
      await context.manager.query(
        `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type, notes) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [context.tenantId, assetId, item.payload.related_asset_id, item.payload.relation_type, item.payload.notes ?? null],
      );
    }
  }

  private async replaceLinks(context: AiExecutionContextWithManager, config: RelationConfig, sourceId: string, nextItems: RelationItem[]): Promise<void> {
    const table = this.linkTable(config);
    await context.manager.query(`DELETE FROM ${table.table} WHERE tenant_id = $1 AND ${table.sourceColumn} = $2`, [context.tenantId, sourceId]);
    for (const item of nextItems) {
      await context.manager.query(
        `INSERT INTO ${table.table} (tenant_id, ${table.sourceColumn}, url, description) VALUES ($1, $2, $3, $4)`,
        [context.tenantId, sourceId, item.payload.url, item.payload.description ?? null],
      );
    }
  }

  private async replaceLocationContacts(
    context: AiExecutionContextWithManager,
    tableName: string,
    targetColumn: 'user_id' | 'contact_id',
    locationId: string,
    nextItems: RelationItem[],
  ): Promise<void> {
    await context.manager.query(`DELETE FROM ${tableName} WHERE tenant_id = $1 AND location_id = $2`, [context.tenantId, locationId]);
    for (const item of nextItems) {
      await context.manager.query(
        `INSERT INTO ${tableName} (tenant_id, location_id, ${targetColumn}, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [context.tenantId, locationId, item.payload[targetColumn], item.payload.role ?? null],
      );
    }
  }

  private async replaceSubLocations(context: AiExecutionContextWithManager, locationId: string, nextItems: RelationItem[]): Promise<void> {
    const current = await this.loadSubLocations(context, locationId);
    const nextExistingIds = new Set(nextItems.map((item) => textOrNull(item.payload.id)).filter(Boolean) as string[]);
    const toDelete = current.filter((item) => !nextExistingIds.has(String(item.payload.id)));
    for (const item of toDelete) {
      const assetRows: Array<{ c: string }> = await context.manager.query(
        `SELECT COUNT(*)::text AS c FROM assets WHERE tenant_id = $1 AND sub_location_id = $2`,
        [context.tenantId, item.payload.id],
      );
      if (Number(assetRows[0]?.c || '0') > 0) {
        throw new BadRequestException(`Cannot remove sub-location "${item.label}" because assets are assigned to it.`);
      }
      await context.manager.query(`DELETE FROM location_sub_items WHERE tenant_id = $1 AND id = $2`, [context.tenantId, item.payload.id]);
    }
    for (const item of nextItems) {
      const id = textOrNull(item.payload.id);
      const name = textOrNull(item.payload.name);
      if (!name) continue;
      if (id) {
        await context.manager.query(
          `UPDATE location_sub_items SET name = $1, description = $2, updated_at = now() WHERE tenant_id = $3 AND location_id = $4 AND id = $5`,
          [name, item.payload.description ?? null, context.tenantId, locationId, id],
        );
      } else {
        await context.manager.query(
          `
          INSERT INTO location_sub_items (tenant_id, location_id, name, description, display_order)
          VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(display_order) + 1 FROM location_sub_items WHERE tenant_id = $1 AND location_id = $2), 0))
          `,
          [context.tenantId, locationId, name, item.payload.description ?? null],
        );
      }
    }
  }

  private async replaceAppAssetAssignments(context: AiExecutionContextWithManager, applicationId: string, nextItems: RelationItem[]): Promise<void> {
    const current = await this.loadAppAssetAssignments(context, applicationId);
    const currentKeys = new Set(current.map((item) => item.key));
    const nextKeys = new Set(nextItems.map((item) => item.key));
    for (const item of current) {
      if (!nextKeys.has(item.key)) {
        await context.manager.query(`DELETE FROM app_asset_assignments WHERE tenant_id = $1 AND id = $2`, [context.tenantId, item.payload.id]);
      }
    }
    for (const item of nextItems) {
      if (currentKeys.has(item.key)) {
        await context.manager.query(
          `UPDATE app_asset_assignments SET since_date = $1, notes = $2, updated_at = now() WHERE tenant_id = $3 AND app_instance_id = $4 AND asset_id = $5 AND role = $6`,
          [item.payload.since_date ?? null, item.payload.notes ?? null, context.tenantId, item.payload.app_instance_id, item.payload.asset_id, item.payload.role],
        );
      } else {
        await context.manager.query(
          `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role, since_date, notes) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [context.tenantId, item.payload.app_instance_id, item.payload.asset_id, item.payload.role, item.payload.since_date ?? null, item.payload.notes ?? null],
        );
      }
    }
  }

  /** The table the audit log names: a relation of a CAPEX line keeps its CAPEX table name (`auditTableOf`). */
  private auditTableName(config: RelationConfig): string {
    const capex = config.sourceEntity === 'capex_items' || (config.kind === 'simple' && config.target === 'capex_items');
    const label = (table: string) => (capex ? auditTableOf('capex', table) : table);
    if (config.kind === 'simple') return label(config.table);
    switch (config.kind) {
      case 'owner_role': return 'application_owners';
      case 'contact_role': return label(this.contactTable(config).table);
      case 'supplier_contacts': return 'supplier_contacts';
      case 'asset_relations': return 'asset_relations';
      case 'link': return label(this.linkTable(config).table);
      case 'location_internal_contacts': return 'location_user_contacts';
      case 'location_external_contacts': return 'location_contacts';
      case 'sub_locations': return 'location_sub_items';
      case 'app_asset_assignments': return 'app_asset_assignments';
    }
  }

  private async resolveSource(
    context: AiExecutionContextWithManager,
    entityType: AiRelationEntityType,
    ref: string,
  ): Promise<ResolvedReference> {
    return this.resolveReference(context, entityType === 'locations' ? 'locations' as any : entityType as RelationTarget, ref);
  }

  private async resolveReference(
    context: AiExecutionContextWithManager,
    entityType: RelationTarget | 'locations',
    ref: string,
  ): Promise<ResolvedReference> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('Record reference is required.');
    const rows = await this.queryReferenceCandidates(context, entityType, normalized);
    if (rows.length === 0) throw new NotFoundException(`No ${String(entityType).replace(/_/g, ' ')} found matching "${normalized}".`);
    if (rows.length > 1) {
      const labels = rows.map((row) => this.recordTitle(entityType, row)).join(', ');
      throw new BadRequestException(`Multiple ${String(entityType).replace(/_/g, ' ')} matched "${normalized}": ${labels}. Use a more specific reference.`);
    }
    return {
      id: String(rows[0].id),
      ref: this.recordRef(entityType, rows[0]),
      label: this.recordTitle(entityType, rows[0]),
      row: rows[0],
    };
  }

  private async queryReferenceCandidates(
    context: AiExecutionContextWithManager,
    entityType: RelationTarget | 'locations',
    ref: string,
  ): Promise<Record<string, unknown>[]> {
    const uuid = isUuid(ref);
    const itemNumber = Number((ref.match(/(?:^|[-\s])(\d+)$/)?.[1] ?? '').trim());
    const { manager, tenantId } = context;
    switch (entityType) {
      case 'applications': {
        const accessScope = await resolveBusinessContributorScopeForUser({
          manager,
          userId: context.userId,
          tenantId,
        }, 'applications', 'reader');
        const params: unknown[] = [tenantId, ref];
        const accessScopeSql = accessScope
          ? (() => {
            params.push(accessScope.userId);
            return `AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
          })()
          : '';
        return manager.query(
          `SELECT a.*
           FROM applications a
           WHERE a.tenant_id = $1
             AND (${uuid ? 'a.id = $2 OR ' : ''}LOWER(COALESCE(a.sequential_id, '')) = LOWER($2::text) OR LOWER(a.name) = LOWER($2::text))
             ${accessScopeSql}
           ORDER BY a.name LIMIT 6`,
          params,
        );
      }
      case 'assets':
        return manager.query(`SELECT * FROM assets WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(COALESCE(asset_reference, '')) = LOWER($2::text) OR LOWER(name) = LOWER($2::text) OR LOWER(COALESCE(hostname, '')) = LOWER($2::text) OR LOWER(COALESCE(fqdn, '')) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'business_processes':
        return manager.query(`SELECT * FROM business_processes WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'capex_items':
        // CAPEX lines only (`spend/budget-nature.ts`); the CAPEX title is `product_name` (lot Z1).
        return manager.query(`SELECT * FROM spend_items WHERE tenant_id = $1 AND nature = 'capex' AND (${uuid ? 'id = $2 OR ' : ''}LOWER(product_name) = LOWER($2::text)) ORDER BY product_name LIMIT 6`, [tenantId, ref]);
      case 'companies':
        return manager.query(`SELECT * FROM companies WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'contacts':
        return manager.query(`SELECT * FROM contacts WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(email) = LOWER($2::text) OR LOWER(NULLIF(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), '')) = LOWER($2::text)) ORDER BY email LIMIT 6`, [tenantId, ref]);
      case 'contracts':
        return manager.query(`SELECT * FROM contracts WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'departments':
        return manager.query(`SELECT * FROM departments WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'projects':
        return manager.query(`SELECT * FROM portfolio_projects WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR item_number = $3) ORDER BY item_number LIMIT 6`, [tenantId, ref, Number.isInteger(itemNumber) ? itemNumber : -1]);
      case 'requests':
        return manager.query(`SELECT * FROM portfolio_requests WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR item_number = $3) ORDER BY item_number LIMIT 6`, [tenantId, ref, Number.isInteger(itemNumber) ? itemNumber : -1]);
      case 'spend_items':
        // OPEX lines only (`spend/budget-nature.ts`).
        return manager.query(`SELECT * FROM spend_items WHERE tenant_id = $1 AND nature = 'opex' AND (${uuid ? 'id = $2 OR ' : ''}LOWER(product_name) = LOWER($2::text)) ORDER BY product_name LIMIT 6`, [tenantId, ref]);
      case 'suppliers':
        return manager.query(`SELECT * FROM suppliers WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR LOWER(COALESCE(erp_supplier_id, '')) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'users':
        return manager.query(`SELECT id, email, first_name, last_name FROM users WHERE tenant_id = $1 AND status = 'enabled' AND (${uuid ? 'id = $2 OR ' : ''}LOWER(email) = LOWER($2::text) OR LOWER(NULLIF(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), '')) = LOWER($2::text)) ORDER BY email LIMIT 6`, [tenantId, ref]);
      case 'locations':
        return manager.query(`SELECT * FROM locations WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(location_reference) = LOWER($2::text) OR LOWER(name) = LOWER($2::text) OR LOWER(CONCAT(location_reference, ' - ', name)) = LOWER($2::text)) ORDER BY location_reference LIMIT 6`, [tenantId, ref]);
    }
  }

  private recordRef(entityType: RelationTarget | 'locations', row: Record<string, unknown>): string | null {
    switch (entityType) {
      case 'applications': return textOrNull(row.sequential_id);
      case 'assets': return textOrNull(row.asset_reference) || textOrNull(row.hostname);
      case 'projects': return row.item_number == null ? null : `PRJ-${row.item_number}`;
      case 'requests': return row.item_number == null ? null : `REQ-${row.item_number}`;
      case 'spend_items': return textOrNull(row.product_name);
      case 'capex_items': return textOrNull(row.product_name);
      case 'locations': return textOrNull(row.location_reference);
      case 'users': return textOrNull(row.email);
      default: return null;
    }
  }

  private recordTitle(entityType: RelationTarget | 'locations', row: Record<string, unknown>): string {
    switch (entityType) {
      case 'applications': return [row.sequential_id, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled application';
      case 'assets': return [row.asset_reference, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled asset';
      case 'capex_items': return textOrNull(row.product_name) || 'Untitled CAPEX item';
      case 'contacts': {
        const name = [row.first_name, row.last_name].map(textOrNull).filter(Boolean).join(' ');
        return name || textOrNull(row.email) || 'Untitled contact';
      }
      case 'projects': return [row.item_number == null ? null : `PRJ-${row.item_number}`, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled project';
      case 'requests': return [row.item_number == null ? null : `REQ-${row.item_number}`, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled request';
      case 'spend_items': return textOrNull(row.product_name) || 'Untitled spend item';
      case 'locations': return [row.location_reference, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled location';
      case 'users': {
        const name = [row.first_name, row.last_name].map(textOrNull).filter(Boolean).join(' ');
        return name || textOrNull(row.email) || 'Unknown user';
      }
      default: return textOrNull(row.name) || String(row.id || 'Untitled record');
    }
  }

  private async resolveUserById(context: AiExecutionContextWithManager, id: string) {
    const user = await this.resolveReference(context, 'users', id);
    return { id: user.id, email: user.ref, label: user.label };
  }
}
