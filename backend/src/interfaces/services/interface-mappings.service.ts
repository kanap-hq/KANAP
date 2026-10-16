import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMappingGroup } from '../interface-mapping-group.entity';
import { InterfaceMappingRule } from '../interface-mapping-rule.entity';
import { InterfaceMappingSet } from '../interface-mapping-set.entity';
import { ENVIRONMENTS, EnvironmentValue } from './interfaces-base.service';
import { RecordInUseException } from '../../common/record-in-use';

export interface InterfaceMappingsServiceOpts {
  manager?: EntityManager;
}

export interface CloneInterfaceMappingsOptions extends InterfaceMappingsServiceOpts {
  audit?: boolean;
  legMapping?: Map<string, string>;
}

const MAPPING_RULE_LIFECYCLES = ['active', 'proposed', 'deprecated', 'retired'] as const;
type MappingRuleLifecycle = (typeof MAPPING_RULE_LIFECYCLES)[number];

@Injectable()
export class InterfaceMappingsService {
  private static readonly DEFAULT_SET_NAME = 'Default';
  private static readonly DEFAULT_GROUP_DEFINITIONS = [
    { title: 'Head', description: 'Header or message-level mappings' },
    { title: 'Item', description: 'Repeated item or line-level mappings' },
  ] as const;
  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(
    @InjectRepository(InterfaceEntity) private readonly interfaces: Repository<InterfaceEntity>,
    @InjectRepository(InterfaceLeg) private readonly legs: Repository<InterfaceLeg>,
    @InjectRepository(InterfaceMappingSet) private readonly mappingSets: Repository<InterfaceMappingSet>,
    @InjectRepository(InterfaceMappingGroup) private readonly mappingGroups: Repository<InterfaceMappingGroup>,
    @InjectRepository(InterfaceMappingRule) private readonly mappingRules: Repository<InterfaceMappingRule>,
    private readonly audit: AuditService,
  ) {}

  private getInterfaceRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceEntity) : this.interfaces;
  }

  private getLegRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceLeg) : this.legs;
  }

  private getSetRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceMappingSet) : this.mappingSets;
  }

  private getGroupRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceMappingGroup) : this.mappingGroups;
  }

  private getRuleRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceMappingRule) : this.mappingRules;
  }

  private getManager(opts?: InterfaceMappingsServiceOpts) {
    return opts?.manager ?? this.mappingSets.manager;
  }

  private has(body: any, key: string) {
    return !!body && Object.prototype.hasOwnProperty.call(body, key);
  }

  private normalizeRequiredText(value: unknown, label: string) {
    const text = String(value ?? '').trim();
    if (!text) {
      throw new BadRequestException(`${label} is required`);
    }
    return text;
  }

  private normalizeOptionalText(value: unknown) {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
  }

  private normalizeOptionalUuid(value: unknown, label: string) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (!InterfaceMappingsService.UUID_PATTERN.test(text)) {
      throw new BadRequestException(`${label} must be a valid UUID`);
    }
    return text;
  }

  private normalizeRuleLifecycle(value: unknown): MappingRuleLifecycle {
    const normalized = String(value ?? '').trim().toLowerCase() || 'active';
    if (!MAPPING_RULE_LIFECYCLES.includes(normalized as MappingRuleLifecycle)) {
      throw new BadRequestException(`Invalid lifecycle "${value}"`);
    }
    return normalized as MappingRuleLifecycle;
  }

  private normalizeEnvironmentScope(value: unknown): EnvironmentValue[] | null {
    if (value == null) return null;
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : null;
    if (!rawItems) {
      throw new BadRequestException('environment_scope must be an array');
    }

    const normalized: EnvironmentValue[] = [];
    for (const item of rawItems) {
      const text = String(item ?? '').trim().toLowerCase();
      if (!text) continue;
      if (text === 'all' || text === '*') return null;
      if (!ENVIRONMENTS.includes(text as EnvironmentValue)) {
        throw new BadRequestException(`Invalid environment "${item}"`);
      }
      if (!normalized.includes(text as EnvironmentValue)) {
        normalized.push(text as EnvironmentValue);
      }
    }
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeOrderIndex(value: unknown, label: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`${label} must be a non-negative integer`);
    }
    return parsed;
  }

  private normalizeBindings(value: unknown, label: string): Array<Record<string, unknown>> {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${label} must be an array`);
    }
    return value.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException(`${label}[${index}] must be an object`);
      }
      return { ...(item as Record<string, unknown>) };
    });
  }

  private async ensureInterface(interfaceId: string, manager?: EntityManager) {
    const entity = await this.getInterfaceRepo(manager).findOne({ where: { id: interfaceId } as any });
    if (!entity) throw new NotFoundException('Interface not found');
    return entity;
  }

  private async ensureLegForInterface(interfaceId: string, legId: string | null, manager?: EntityManager) {
    if (!legId) return null;
    const leg = await this.getLegRepo(manager).findOne({
      where: { id: legId, interface_id: interfaceId } as any,
    });
    if (!leg) {
      throw new BadRequestException('Invalid applies_to_leg_id');
    }
    return leg;
  }

  private async ensureMappingSet(mappingSetId: string, manager?: EntityManager) {
    const set = await this.getSetRepo(manager).findOne({ where: { id: mappingSetId } as any });
    if (!set) throw new NotFoundException('Mapping set not found');
    return set;
  }

  private async ensureMappingGroup(groupId: string, manager?: EntityManager) {
    const group = await this.getGroupRepo(manager).findOne({ where: { id: groupId } as any });
    if (!group) throw new NotFoundException('Mapping group not found');
    return group;
  }

  private async ensureMappingRule(ruleId: string, manager?: EntityManager) {
    const rule = await this.getRuleRepo(manager).findOne({ where: { id: ruleId } as any });
    if (!rule) throw new NotFoundException('Mapping rule not found');
    return rule;
  }

  private async ensureSetNameUnique(
    interfaceId: string,
    name: string,
    manager?: EntityManager,
    excludeId?: string,
  ) {
    const repo = this.getSetRepo(manager);
    const existing = await repo.findOne({ where: { interface_id: interfaceId, name } as any });
    if (existing && existing.id !== excludeId) {
      throw new BadRequestException('A mapping set with this name already exists');
    }
  }

  private normalizeGroupTitleKey(value: unknown) {
    return String(value ?? '').trim().toLowerCase();
  }

  private isReservedGroupTitle(value: unknown) {
    const normalized = this.normalizeGroupTitleKey(value);
    return InterfaceMappingsService.DEFAULT_GROUP_DEFINITIONS.some(
      (definition) => this.normalizeGroupTitleKey(definition.title) === normalized,
    );
  }

  private async ensureGroupTitleUnique(
    mappingSetId: string,
    title: string,
    manager?: EntityManager,
    excludeId?: string,
  ) {
    const repo = this.getGroupRepo(manager);
    const existing = await repo.find({ where: { mapping_set_id: mappingSetId } as any });
    const normalizedTitle = this.normalizeGroupTitleKey(title);
    const duplicate = existing.find((group) => (
      group.id !== excludeId && this.normalizeGroupTitleKey(group.title) === normalizedTitle
    ));
    if (duplicate) {
      throw new BadRequestException('A mapping group with this title already exists in this set');
    }
  }

  private async ensureRuleKeyUnique(
    mappingSetId: string,
    ruleKey: string | null,
    manager?: EntityManager,
    excludeId?: string,
  ) {
    if (!ruleKey) return;
    const repo = this.getRuleRepo(manager);
    const existing = await repo.findOne({ where: { mapping_set_id: mappingSetId, rule_key: ruleKey } as any });
    if (existing && existing.id !== excludeId) {
      throw new BadRequestException('A mapping rule with this rule_key already exists in this set');
    }
  }

  private async setDefaultMappingSet(interfaceId: string, mappingSetId: string, manager?: EntityManager) {
    const repo = this.getSetRepo(manager);
    const sets = await repo.find({ where: { interface_id: interfaceId } as any });
    const updates: InterfaceMappingSet[] = [];
    const now = new Date();
    for (const set of sets) {
      const shouldBeDefault = set.id === mappingSetId;
      if (set.is_default !== shouldBeDefault) {
        set.is_default = shouldBeDefault;
        set.updated_at = now;
        updates.push(set);
      }
    }
    if (updates.length > 0) {
      await repo.save(updates);
    }
  }

  private async nextGroupOrderIndex(mappingSetId: string, manager?: EntityManager) {
    const repo = this.getGroupRepo(manager);
    const row = await repo
      .createQueryBuilder('mapping_group')
      .select('MAX(mapping_group.order_index)', 'max_order_index')
      .where('mapping_group.mapping_set_id = :mappingSetId', { mappingSetId })
      .getRawOne<{ max_order_index: string | null }>();
    const current = Number(row?.max_order_index ?? 0);
    return Number.isInteger(current) && current >= 1 ? current + 1 : 1;
  }

  private async nextRuleOrderIndex(
    mappingSetId: string,
    groupId: string | null,
    manager?: EntityManager,
  ) {
    const repo = this.getRuleRepo(manager);
    const qb = repo
      .createQueryBuilder('rule')
      .select('MAX(rule.order_index)', 'max_order_index')
      .where('rule.mapping_set_id = :mappingSetId', { mappingSetId });
    if (groupId) {
      qb.andWhere('rule.group_id = :groupId', { groupId });
    } else {
      qb.andWhere('rule.group_id IS NULL');
    }
    const row = await qb.getRawOne<{ max_order_index: string | null }>();
    const current = Number(row?.max_order_index ?? 0);
    return Number.isInteger(current) && current >= 1 ? current + 1 : 1;
  }

  private async ensureDefaultGroupsForSet(mappingSetId: string, manager?: EntityManager) {
    const mg = manager;
    const set = await this.ensureMappingSet(mappingSetId, mg);
    const repo = this.getGroupRepo(mg);
    const existing = await repo.find({
      where: { mapping_set_id: mappingSetId } as any,
      order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
    });
    const existingTitles = new Set(existing.map((group) => this.normalizeGroupTitleKey(group.title)));
    const missingDefinitions = InterfaceMappingsService.DEFAULT_GROUP_DEFINITIONS.filter(
      (definition) => !existingTitles.has(this.normalizeGroupTitleKey(definition.title)),
    );

    if (missingDefinitions.length === 0) {
      return existing;
    }

    let nextOrderIndex = await this.nextGroupOrderIndex(mappingSetId, mg);
    const created = missingDefinitions.map((definition) => {
      const entity = repo.create({
        tenant_id: set.tenant_id,
        interface_id: set.interface_id,
        mapping_set_id: set.id,
        title: definition.title,
        description: definition.description,
        order_index: nextOrderIndex,
      });
      nextOrderIndex += 1;
      return entity;
    });
    const saved = await repo.save(created);
    return [...existing, ...saved];
  }

  private async bumpRevision(mappingSetId: string, manager?: EntityManager) {
    const repo = this.getSetRepo(manager);
    const set = await repo.findOne({ where: { id: mappingSetId } as any });
    if (!set) return null;
    set.revision_number = Number(set.revision_number || 0) + 1;
    set.updated_at = new Date();
    return repo.save(set);
  }

  private sortSets(items: InterfaceMappingSet[]) {
    return [...items].sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      if (a.created_at.getTime() !== b.created_at.getTime()) {
        return a.created_at.getTime() - b.created_at.getTime();
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  async ensureDefaultSetForInterface(
    interfaceId: string,
    tenantId?: string | null,
    userId?: string | null,
    opts?: InterfaceMappingsServiceOpts & { audit?: boolean },
  ) {
    const mg = this.getManager(opts);
    const target = await this.ensureInterface(interfaceId, mg);
    const repo = this.getSetRepo(mg);

    const existingDefault = await repo.findOne({
      where: { interface_id: interfaceId, is_default: true } as any,
    });
    if (existingDefault) {
      await this.ensureDefaultGroupsForSet(existingDefault.id, mg);
      return existingDefault;
    }

    const firstSet = await repo.findOne({
      where: { interface_id: interfaceId } as any,
      order: { created_at: 'ASC' as any },
    });
    if (firstSet) {
      const before = { ...firstSet };
      firstSet.is_default = true;
      firstSet.updated_at = new Date();
      const saved = await repo.save(firstSet);
      if (opts?.audit) {
        await this.audit.log(
          {
            table: 'interface_mapping_sets',
            recordId: saved.id,
            action: 'update',
            before,
            after: saved,
            userId: userId ?? null,
          },
          { manager: mg },
        );
      }
      await this.ensureDefaultGroupsForSet(saved.id, mg);
      return saved;
    }

    const created = repo.create({
      tenant_id: tenantId || target.tenant_id,
      interface_id: interfaceId,
      name: InterfaceMappingsService.DEFAULT_SET_NAME,
      description: null,
      is_default: true,
      revision_number: 1,
    });
    const saved = await repo.save(created);
    if (opts?.audit) {
      await this.audit.log(
        {
          table: 'interface_mapping_sets',
          recordId: saved.id,
          action: 'create',
          before: null,
          after: saved,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    await this.ensureDefaultGroupsForSet(saved.id, mg);
    return saved;
  }

  async listSets(interfaceId: string, opts?: InterfaceMappingsServiceOpts) {
    const mg = this.getManager(opts);
    await this.ensureDefaultSetForInterface(interfaceId, null, null, { manager: mg, audit: false });
    const items = await this.getSetRepo(mg).find({
      where: { interface_id: interfaceId } as any,
    });
    return { items: this.sortSets(items) };
  }

  async getSet(mappingSetId: string, opts?: InterfaceMappingsServiceOpts) {
    return this.ensureMappingSet(mappingSetId, this.getManager(opts));
  }

  async createSet(
    interfaceId: string,
    body: { name?: string; description?: string | null; is_default?: boolean },
    userId: string | null,
    opts?: InterfaceMappingsServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const target = await this.ensureInterface(interfaceId, mg);
    const repo = this.getSetRepo(mg);
    const name = this.normalizeRequiredText(body?.name, 'name');
    await this.ensureSetNameUnique(interfaceId, name, mg);

    const existing = await repo.find({ where: { interface_id: interfaceId } as any });
    const shouldBeDefault = existing.length === 0 || body?.is_default === true;

    const created = repo.create({
      tenant_id: target.tenant_id,
      interface_id: interfaceId,
      name,
      description: this.normalizeOptionalText(body?.description),
      is_default: shouldBeDefault,
      revision_number: 1,
    });
    const saved = await repo.save(created);
    if (shouldBeDefault) {
      await this.setDefaultMappingSet(interfaceId, saved.id, mg);
    }
    const refreshed = await repo.findOne({ where: { id: saved.id } as any });
    await this.audit.log(
      {
        table: 'interface_mapping_sets',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: refreshed,
        userId,
      },
      { manager: mg },
    );
    await this.ensureDefaultGroupsForSet(saved.id, mg);
    return refreshed;
  }

  async updateSet(
    mappingSetId: string,
    body: { name?: string; description?: string | null; is_default?: boolean },
    userId: string | null,
    opts?: InterfaceMappingsServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = this.getSetRepo(mg);
    const existing = await this.ensureMappingSet(mappingSetId, mg);
    const before = { ...existing };

    if (this.has(body, 'name')) {
      const name = this.normalizeRequiredText(body?.name, 'name');
      await this.ensureSetNameUnique(existing.interface_id, name, mg, existing.id);
      existing.name = name;
    }
    if (this.has(body, 'description')) {
      existing.description = this.normalizeOptionalText(body?.description);
    }
    if (body?.is_default === true) {
      existing.is_default = true;
    } else if (body?.is_default === false && existing.is_default) {
      throw new BadRequestException('Cannot unset the default mapping set directly');
    }

    existing.revision_number = Number(existing.revision_number || 0) + 1;
    existing.updated_at = new Date();
    await repo.save(existing);
    if (existing.is_default) {
      await this.setDefaultMappingSet(existing.interface_id, existing.id, mg);
    }
    const refreshed = await repo.findOne({ where: { id: existing.id } as any });
    await this.audit.log(
      {
        table: 'interface_mapping_sets',
        recordId: existing.id,
        action: 'update',
        before,
        after: refreshed,
        userId,
      },
      { manager: mg },
    );
    return refreshed;
  }

  async deleteSet(mappingSetId: string, userId: string | null, opts?: InterfaceMappingsServiceOpts) {
    const mg = this.getManager(opts);
    const repo = this.getSetRepo(mg);
    const existing = await this.ensureMappingSet(mappingSetId, mg);
    if (existing.is_default) {
      throw new RecordInUseException('MAPPING_SET_DEFAULT', 'mapping set', existing.name, [],
        'Default mapping set cannot be deleted. Make another set the default first.');
    }
    await repo.delete({ id: mappingSetId } as any);
    await this.audit.log(
      {
        table: 'interface_mapping_sets',
        recordId: mappingSetId,
        action: 'delete',
        before: existing,
        after: null,
        userId,
      },
      { manager: mg },
    );
    return { deleted: true };
  }

  async listGroups(mappingSetId: string, opts?: InterfaceMappingsServiceOpts) {
    const mg = this.getManager(opts);
    await this.ensureDefaultGroupsForSet(mappingSetId, mg);
    const items = await this.getGroupRepo(mg).find({
      where: { mapping_set_id: mappingSetId } as any,
      order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
    });
    return { items };
  }

  async getGroup(groupId: string, opts?: InterfaceMappingsServiceOpts) {
    return this.ensureMappingGroup(groupId, this.getManager(opts));
  }

  async createGroup(
    mappingSetId: string,
    body: { title?: string; description?: string | null; order_index?: number },
    userId: string | null,
    opts?: InterfaceMappingsServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const set = await this.ensureMappingSet(mappingSetId, mg);
    const repo = this.getGroupRepo(mg);
    const title = this.normalizeRequiredText(body?.title, 'title');
    await this.ensureGroupTitleUnique(mappingSetId, title, mg);
    const orderIndex = this.has(body, 'order_index')
      ? this.normalizeOrderIndex(body?.order_index, 'order_index')
      : await this.nextGroupOrderIndex(mappingSetId, mg);

    const created = repo.create({
      tenant_id: set.tenant_id,
      interface_id: set.interface_id,
      mapping_set_id: set.id,
      title,
      description: this.normalizeOptionalText(body?.description),
      order_index: orderIndex,
    });
    const saved = await repo.save(created);
    await this.bumpRevision(mappingSetId, mg);
    await this.audit.log(
      {
        table: 'interface_mapping_groups',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
      },
      { manager: mg },
    );
    return saved;
  }

  async updateGroup(
    groupId: string,
    body: { title?: string; description?: string | null; order_index?: number },
    userId: string | null,
    opts?: InterfaceMappingsServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = this.getGroupRepo(mg);
    const existing = await this.ensureMappingGroup(groupId, mg);
    if (this.isReservedGroupTitle(existing.title)) {
      throw new BadRequestException('Default mapping groups cannot be edited');
    }
    const before = { ...existing };

    if (this.has(body, 'title')) {
      existing.title = this.normalizeRequiredText(body?.title, 'title');
      await this.ensureGroupTitleUnique(existing.mapping_set_id, existing.title, mg, existing.id);
    }
    if (this.has(body, 'description')) {
      existing.description = this.normalizeOptionalText(body?.description);
    }
    if (this.has(body, 'order_index')) {
      existing.order_index = this.normalizeOrderIndex(body?.order_index, 'order_index');
    }

    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.bumpRevision(existing.mapping_set_id, mg);
    await this.audit.log(
      {
        table: 'interface_mapping_groups',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId,
      },
      { manager: mg },
    );
    return saved;
  }

  async deleteGroup(groupId: string, userId: string | null, opts?: InterfaceMappingsServiceOpts) {
    const mg = this.getManager(opts);
    const repo = this.getGroupRepo(mg);
    const existing = await this.ensureMappingGroup(groupId, mg);
    if (this.isReservedGroupTitle(existing.title)) {
      throw new RecordInUseException('MAPPING_GROUP_DEFAULT', 'mapping group', existing.title, [],
        'Default mapping groups cannot be deleted. Leave the group empty if you do not need it.');
    }
    await repo.delete({ id: groupId } as any);
    await this.bumpRevision(existing.mapping_set_id, mg);
    await this.audit.log(
      {
        table: 'interface_mapping_groups',
        recordId: groupId,
        action: 'delete',
        before: existing,
        after: null,
        userId,
      },
      { manager: mg },
    );
    return { deleted: true };
  }

  async listRules(
    mappingSetId: string,
    groupId?: string | null,
    opts?: InterfaceMappingsServiceOpts,
  ) {
    const mg = this.getManager(opts);
    await this.ensureDefaultGroupsForSet(mappingSetId, mg);

    let normalizedGroupId: string | null | undefined = undefined;
    if (groupId !== undefined) {
      normalizedGroupId = this.normalizeOptionalUuid(groupId, 'group_id');
      if (normalizedGroupId) {
        const group = await this.ensureMappingGroup(normalizedGroupId, mg);
        if (group.mapping_set_id !== mappingSetId) {
          throw new BadRequestException('group_id does not belong to this mapping set');
        }
      }
    }

    const qb = this.getRuleRepo(mg)
      .createQueryBuilder('rule')
      .where('rule.mapping_set_id = :mappingSetId', { mappingSetId });
    if (normalizedGroupId !== undefined) {
      if (normalizedGroupId) {
        qb.andWhere('rule.group_id = :groupId', { groupId: normalizedGroupId });
      } else {
        qb.andWhere('rule.group_id IS NULL');
      }
    }
    const rules = await qb.getMany();

    const groups = await this.getGroupRepo(mg).find({
      where: { mapping_set_id: mappingSetId } as any,
      order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
    });
    const groupOrder = new Map(groups.map((group) => [group.id, group.order_index]));
    rules.sort((a, b) => {
      const aGroupOrder = a.group_id ? groupOrder.get(a.group_id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const bGroupOrder = b.group_id ? groupOrder.get(b.group_id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      if (aGroupOrder !== bGroupOrder) return aGroupOrder - bGroupOrder;
      if (a.order_index !== b.order_index) return a.order_index - b.order_index;
      return a.created_at.getTime() - b.created_at.getTime();
    });

    return { items: rules };
  }

  async getRule(ruleId: string, opts?: InterfaceMappingsServiceOpts) {
    return this.ensureMappingRule(ruleId, this.getManager(opts));
  }

  async createRule(
    mappingSetId: string,
    body: {
      group_id?: string | null;
      rule_key?: string | null;
      title?: string;
      order_index?: number;
      applies_to_leg_id?: string | null;
      operation_kind?: string | null;
      lifecycle?: string | null;
      environment_scope?: string[] | string | null;
      source_bindings?: Array<Record<string, unknown>>;
      target_bindings?: Array<Record<string, unknown>>;
      condition_text?: string | null;
      business_rule_text?: string | null;
      middleware_rule_text?: string | null;
      remarks?: string | null;
      example_input?: string | null;
      example_output?: string | null;
      implementation_status?: string | null;
      test_status?: string | null;
    },
    userId: string | null,
    opts?: InterfaceMappingsServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const set = await this.ensureMappingSet(mappingSetId, mg);
    const repo = this.getRuleRepo(mg);

    const groupId = this.normalizeOptionalUuid(body?.group_id, 'group_id');
    if (groupId) {
      const group = await this.ensureMappingGroup(groupId, mg);
      if (group.mapping_set_id !== set.id) {
        throw new BadRequestException('group_id does not belong to this mapping set');
      }
    }

    const ruleKey = this.normalizeOptionalText(body?.rule_key);
    await this.ensureRuleKeyUnique(mappingSetId, ruleKey, mg);

    const appliesToLegId = this.normalizeOptionalUuid(body?.applies_to_leg_id, 'applies_to_leg_id');
    await this.ensureLegForInterface(set.interface_id, appliesToLegId, mg);

    const orderIndex = this.has(body, 'order_index')
      ? this.normalizeOrderIndex(body?.order_index, 'order_index')
      : await this.nextRuleOrderIndex(mappingSetId, groupId, mg);

    const created = repo.create({
      tenant_id: set.tenant_id,
      interface_id: set.interface_id,
      mapping_set_id: set.id,
      group_id: groupId,
      rule_key: ruleKey,
      title: this.normalizeRequiredText(body?.title, 'title'),
      order_index: orderIndex,
      applies_to_leg_id: appliesToLegId,
      operation_kind: this.normalizeOptionalText(body?.operation_kind) || 'direct',
      lifecycle: this.normalizeRuleLifecycle(body?.lifecycle),
      environment_scope: this.normalizeEnvironmentScope(body?.environment_scope),
      source_bindings: this.normalizeBindings(body?.source_bindings, 'source_bindings'),
      target_bindings: this.normalizeBindings(body?.target_bindings, 'target_bindings'),
      condition_text: this.normalizeOptionalText(body?.condition_text),
      business_rule_text: this.normalizeOptionalText(body?.business_rule_text),
      middleware_rule_text: this.normalizeOptionalText(body?.middleware_rule_text),
      remarks: this.normalizeOptionalText(body?.remarks),
      example_input: this.normalizeOptionalText(body?.example_input),
      example_output: this.normalizeOptionalText(body?.example_output),
      implementation_status: this.normalizeOptionalText(body?.implementation_status),
      test_status: this.normalizeOptionalText(body?.test_status),
    });
    const saved = await repo.save(created);
    await this.bumpRevision(mappingSetId, mg);
    await this.audit.log(
      {
        table: 'interface_mapping_rules',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
      },
      { manager: mg },
    );
    return saved;
  }

  async updateRule(
    ruleId: string,
    body: {
      group_id?: string | null;
      rule_key?: string | null;
      title?: string;
      order_index?: number;
      applies_to_leg_id?: string | null;
      operation_kind?: string | null;
      lifecycle?: string | null;
      environment_scope?: string[] | string | null;
      source_bindings?: Array<Record<string, unknown>>;
      target_bindings?: Array<Record<string, unknown>>;
      condition_text?: string | null;
      business_rule_text?: string | null;
      middleware_rule_text?: string | null;
      remarks?: string | null;
      example_input?: string | null;
      example_output?: string | null;
      implementation_status?: string | null;
      test_status?: string | null;
    },
    userId: string | null,
    opts?: InterfaceMappingsServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = this.getRuleRepo(mg);
    const existing = await this.ensureMappingRule(ruleId, mg);
    const before = { ...existing };

    if (this.has(body, 'group_id')) {
      const groupId = this.normalizeOptionalUuid(body?.group_id, 'group_id');
      if (groupId) {
        const group = await this.ensureMappingGroup(groupId, mg);
        if (group.mapping_set_id !== existing.mapping_set_id) {
          throw new BadRequestException('group_id does not belong to this mapping set');
        }
      }
      existing.group_id = groupId;
    }

    if (this.has(body, 'rule_key')) {
      const ruleKey = this.normalizeOptionalText(body?.rule_key);
      await this.ensureRuleKeyUnique(existing.mapping_set_id, ruleKey, mg, existing.id);
      existing.rule_key = ruleKey;
    }
    if (this.has(body, 'title')) {
      existing.title = this.normalizeRequiredText(body?.title, 'title');
    }
    if (this.has(body, 'order_index')) {
      existing.order_index = this.normalizeOrderIndex(body?.order_index, 'order_index');
    }
    if (this.has(body, 'applies_to_leg_id')) {
      const appliesToLegId = this.normalizeOptionalUuid(body?.applies_to_leg_id, 'applies_to_leg_id');
      await this.ensureLegForInterface(existing.interface_id, appliesToLegId, mg);
      existing.applies_to_leg_id = appliesToLegId;
    }
    if (this.has(body, 'operation_kind')) {
      existing.operation_kind = this.normalizeRequiredText(body?.operation_kind, 'operation_kind');
    }
    if (this.has(body, 'lifecycle')) {
      existing.lifecycle = this.normalizeRuleLifecycle(body?.lifecycle);
    }
    if (this.has(body, 'environment_scope')) {
      existing.environment_scope = this.normalizeEnvironmentScope(body?.environment_scope);
    }
    if (this.has(body, 'source_bindings')) {
      existing.source_bindings = this.normalizeBindings(body?.source_bindings, 'source_bindings');
    }
    if (this.has(body, 'target_bindings')) {
      existing.target_bindings = this.normalizeBindings(body?.target_bindings, 'target_bindings');
    }
    if (this.has(body, 'condition_text')) {
      existing.condition_text = this.normalizeOptionalText(body?.condition_text);
    }
    if (this.has(body, 'business_rule_text')) {
      existing.business_rule_text = this.normalizeOptionalText(body?.business_rule_text);
    }
    if (this.has(body, 'middleware_rule_text')) {
      existing.middleware_rule_text = this.normalizeOptionalText(body?.middleware_rule_text);
    }
    if (this.has(body, 'remarks')) {
      existing.remarks = this.normalizeOptionalText(body?.remarks);
    }
    if (this.has(body, 'example_input')) {
      existing.example_input = this.normalizeOptionalText(body?.example_input);
    }
    if (this.has(body, 'example_output')) {
      existing.example_output = this.normalizeOptionalText(body?.example_output);
    }
    if (this.has(body, 'implementation_status')) {
      existing.implementation_status = this.normalizeOptionalText(body?.implementation_status);
    }
    if (this.has(body, 'test_status')) {
      existing.test_status = this.normalizeOptionalText(body?.test_status);
    }

    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.bumpRevision(existing.mapping_set_id, mg);
    await this.audit.log(
      {
        table: 'interface_mapping_rules',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId,
      },
      { manager: mg },
    );
    return saved;
  }

  async deleteRule(ruleId: string, userId: string | null, opts?: InterfaceMappingsServiceOpts) {
    const mg = this.getManager(opts);
    const repo = this.getRuleRepo(mg);
    const existing = await this.ensureMappingRule(ruleId, mg);
    await repo.delete({ id: ruleId } as any);
    await this.bumpRevision(existing.mapping_set_id, mg);
    await this.audit.log(
      {
        table: 'interface_mapping_rules',
        recordId: ruleId,
        action: 'delete',
        before: existing,
        after: null,
        userId,
      },
      { manager: mg },
    );
    return { deleted: true };
  }

  async cloneInterfaceMappings(
    sourceInterfaceId: string,
    targetInterfaceId: string,
    tenantId: string,
    _userId: string | null,
    opts?: CloneInterfaceMappingsOptions,
  ) {
    const mg = this.getManager(opts);
    await this.ensureInterface(sourceInterfaceId, mg);
    const target = await this.ensureInterface(targetInterfaceId, mg);

    const setRepo = this.getSetRepo(mg);
    const groupRepo = this.getGroupRepo(mg);
    const ruleRepo = this.getRuleRepo(mg);
    const legMapping = opts?.legMapping ?? new Map<string, string>();

    const existingTargetCount = await setRepo.count({ where: { interface_id: targetInterfaceId } as any });
    if (existingTargetCount > 0) {
      throw new BadRequestException('Target interface already has mapping sets');
    }

    const sourceSets = await setRepo.find({
      where: { interface_id: sourceInterfaceId } as any,
      order: { created_at: 'ASC' as any },
    });

    if (sourceSets.length === 0) {
      await this.ensureDefaultSetForInterface(targetInterfaceId, tenantId || target.tenant_id, null, {
        manager: mg,
        audit: false,
      });
      return { mappingSetCount: 1, mappingGroupCount: 0, mappingRuleCount: 0 };
    }

    const sourceGroups = await groupRepo.find({
      where: { interface_id: sourceInterfaceId } as any,
      order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
    });
    const sourceRules = await ruleRepo.find({
      where: { interface_id: sourceInterfaceId } as any,
      order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
    });

    const createdSets = await setRepo.save(
      sourceSets.map((set) =>
        setRepo.create({
          tenant_id: tenantId || target.tenant_id,
          interface_id: targetInterfaceId,
          name: set.name,
          description: set.description,
          is_default: set.is_default,
          revision_number: set.revision_number,
        }),
      ),
    );
    const setIdMap = new Map<string, string>();
    sourceSets.forEach((set, index) => setIdMap.set(set.id, createdSets[index].id));

    const createdGroups = await groupRepo.save(
      sourceGroups.map((group) =>
        groupRepo.create({
          tenant_id: tenantId || target.tenant_id,
          interface_id: targetInterfaceId,
          mapping_set_id: setIdMap.get(group.mapping_set_id) || '',
          title: group.title,
          description: group.description,
          order_index: group.order_index,
        }),
      ),
    );
    const groupIdMap = new Map<string, string>();
    sourceGroups.forEach((group, index) => groupIdMap.set(group.id, createdGroups[index].id));

    const createdRules = await ruleRepo.save(
      sourceRules.map((rule) =>
        ruleRepo.create({
          tenant_id: tenantId || target.tenant_id,
          interface_id: targetInterfaceId,
          mapping_set_id: setIdMap.get(rule.mapping_set_id) || '',
          group_id: rule.group_id ? groupIdMap.get(rule.group_id) || null : null,
          rule_key: rule.rule_key,
          title: rule.title,
          order_index: rule.order_index,
          applies_to_leg_id: rule.applies_to_leg_id ? legMapping.get(rule.applies_to_leg_id) || null : null,
          operation_kind: rule.operation_kind,
          lifecycle: this.normalizeRuleLifecycle(rule.lifecycle),
          environment_scope: this.normalizeEnvironmentScope(rule.environment_scope),
          source_bindings: Array.isArray(rule.source_bindings)
            ? rule.source_bindings.map((item) => ({ ...item }))
            : [],
          target_bindings: Array.isArray(rule.target_bindings)
            ? rule.target_bindings.map((item) => ({ ...item }))
            : [],
          condition_text: rule.condition_text,
          business_rule_text: rule.business_rule_text,
          middleware_rule_text: rule.middleware_rule_text,
          remarks: rule.remarks,
          example_input: rule.example_input,
          example_output: rule.example_output,
          implementation_status: rule.implementation_status,
          test_status: rule.test_status,
        }),
      ),
    );

    return {
      mappingSetCount: createdSets.length,
      mappingGroupCount: createdGroups.length,
      mappingRuleCount: createdRules.length,
    };
  }
}
