import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interface-middleware-application.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { Application } from '../../applications/application.entity';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { highestClassification, resolveClassificationOption } from '../../it-ops-settings/classification-catalog';

/**
 * Criticality levels for interfaces.
 */
/**
 * Route types for interfaces.
 */
export const ROUTE_TYPES = ['direct', 'via_middleware'] as const;

/**
 * Environment values for interfaces.
 */
export const ENVIRONMENTS = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'] as const;

export type EnvironmentValue = (typeof ENVIRONMENTS)[number];
export type Lifecycle = string;
export type Criticality = string;
export type RouteType = (typeof ROUTE_TYPES)[number];

/**
 * Common options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
}

/**
 * Base class with shared utilities for interface services.
 */
export abstract class InterfacesBaseService {
  constructor(
    protected readonly repo: Repository<InterfaceEntity>,
    protected readonly legs: Repository<InterfaceLeg>,
    protected readonly middlewareApps: Repository<InterfaceMiddlewareApplication>,
    protected readonly apps: Repository<Application>,
    protected readonly bindings: Repository<InterfaceBinding>,
    protected readonly itOpsSettings: ItOpsSettingsService,
  ) {}

  protected getRepo(manager?: EntityManager): Repository<InterfaceEntity> {
    return manager ? manager.getRepository(InterfaceEntity) : this.repo;
  }

  protected getBindingRepo(manager?: EntityManager): Repository<InterfaceBinding> {
    return manager ? manager.getRepository(InterfaceBinding) : this.bindings;
  }

  protected getAppRepo(manager?: EntityManager): Repository<Application> {
    return manager ? manager.getRepository(Application) : this.apps;
  }

  protected getLegRepo(manager?: EntityManager): Repository<InterfaceLeg> {
    return manager ? manager.getRepository(InterfaceLeg) : this.legs;
  }

  protected getMiddlewareRepo(manager?: EntityManager): Repository<InterfaceMiddlewareApplication> {
    return manager ? manager.getRepository(InterfaceMiddlewareApplication) : this.middlewareApps;
  }

  protected getManager(opts?: ServiceOpts): EntityManager {
    return opts?.manager ?? this.repo.manager;
  }

  protected findNaDefault(list: Array<{ code: string; label: string }>): string | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    const match = list.find((item) => {
      const code = String(item.code || '').trim().toLowerCase();
      const label = String(item.label || '').trim().toLowerCase();
      return code === 'n/a' || code === 'na' || label === 'n/a';
    });
    return match ? String(match.code || '').trim().toLowerCase() : null;
  }

  protected normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
    const normalized = String(value || '').trim().toLowerCase();
    if (!allowed.includes(normalized as T)) {
      throw new BadRequestException(`Invalid ${label} "${value}"`);
    }
    return normalized as T;
  }

  protected normalizeRequiredText(value: unknown, label: string): string {
    const text = String(value ?? '').trim();
    if (!text) {
      throw new BadRequestException(`${label} is required`);
    }
    return text;
  }

  protected normalizeNullable(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  protected async resolveInterfaceIdentifier(identifier: string, manager?: EntityManager): Promise<string> {
    const normalized = String(identifier || '').trim();
    if (!normalized) throw new NotFoundException('Interface not found');

    const uuidMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
    const referenceMatch = normalized.match(/^(INT-\d+)(?:-.+)?$/i);
    const mg = manager ?? this.repo.manager;

    if (uuidMatch) {
      const rows: Array<{ id: string }> = await mg.query(
        `SELECT id::text AS id FROM interfaces WHERE id = $1 LIMIT 1`,
        [normalized],
      );
      if (rows[0]?.id) return rows[0].id;
    }

    if (referenceMatch) {
      const rows: Array<{ id: string }> = await mg.query(
        `SELECT id::text AS id FROM interfaces WHERE upper(interface_reference) = upper($1) LIMIT 1`,
        [referenceMatch[1]],
      );
      if (rows[0]?.id) return rows[0].id;
    }

    const rows: Array<{ id: string }> = await mg.query(
      `SELECT id::text AS id
       FROM interfaces
       WHERE upper(COALESCE(interface_id, '')) = upper($1)
       LIMIT 1`,
      [normalized],
    );
    const id = rows[0]?.id;
    if (!id) throw new NotFoundException('Interface not found');
    return id;
  }

  protected normalizeEnvironment(value: unknown): EnvironmentValue {
    const raw = String(value ?? '').trim().toLowerCase();
    const normalized = raw || 'prod';
    if (!ENVIRONMENTS.includes(normalized as EnvironmentValue)) {
      throw new BadRequestException(`Invalid environment "${value}"`);
    }
    return normalized as EnvironmentValue;
  }

  protected normalizeLifecycleFilters(value: unknown, allowed: string[]): Lifecycle[] {
    const items: string[] = Array.isArray(value)
      ? (value as any[]).map((v) => String(v ?? '')).filter(Boolean)
      : typeof value === 'string'
        ? value.split(',')
        : [];
    const normalized = items
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item): item is Lifecycle => allowed.includes(item));
    if (normalized.length > 0) return normalized;
    if (allowed.includes('active')) return ['active'];
    return allowed.length > 0 ? [allowed[0]] : ['active'];
  }

  protected async normalizeDataClass(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    existing?: string | null,
  ): Promise<string | null> {
    const catalog = await this.itOpsSettings.getClassificationCatalog(tenantId, { manager });
    const code = resolveClassificationOption(value, catalog.dataClasses, existing);
    if (value != null && String(value).trim() && code === null) {
      throw new BadRequestException(`Invalid data_class "${value}"`);
    }
    return code;
  }

  protected async normalizeCriticality(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    existing?: string | null,
  ): Promise<string | null> {
    const catalog = await this.itOpsSettings.getClassificationCatalog(tenantId, { manager });
    const code = resolveClassificationOption(value, catalog.businessCriticalityLevels, existing);
    if (value != null && String(value).trim() && code === null) {
      throw new BadRequestException(`Invalid criticality "${value}"`);
    }
    return code;
  }

  protected async normalizeDataCategory(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const code = String(value || '').trim().toLowerCase();
    if (!code) {
      throw new BadRequestException('data_category is required');
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.interfaceDataCategories || []).map((o) => o.code));
    if (!allowed.has(code)) {
      throw new BadRequestException(`Invalid data_category "${value}"`);
    }
    return code;
  }

  protected normalizeRouteType(value: unknown): RouteType {
    return this.normalizeEnum(value, ROUTE_TYPES, 'integration_route_type');
  }

  protected parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return Boolean(value);
  }

  protected async ensureApplication(id: string, manager?: EntityManager) {
    const repo = this.getAppRepo(manager);
    const app = await repo.findOne({ where: { id } });
    if (!app) throw new BadRequestException('Application not found');
    return app;
  }

  protected computeDefaultLifecycle(source: Application, target: Application): Lifecycle {
    // If both apps are active, default to active; otherwise proposed to keep changes explicit.
    const bothActive = String(source.lifecycle) === 'active' && String(target.lifecycle) === 'active';
    return (bothActive ? 'active' : 'proposed') as Lifecycle;
  }

  protected async computeDefaultCriticality(
    source: Application,
    target: Application,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<{ code: string | null; incomplete: boolean }> {
    const catalog = await this.itOpsSettings.getClassificationCatalog(tenantId, { manager });
    return highestClassification(
      [source.criticality, target.criticality],
      catalog.businessCriticalityLevels,
    );
  }

  protected async normalizeLifecycle(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    fallback?: string,
  ): Promise<Lifecycle> {
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = (settings.lifecycleStates || []).map((item) => item.code);
    const fallbackCode = this.pickLifecycleFallback(fallback ?? 'active', allowed);
    if (value === undefined || value === null || String(value).trim() === '') {
      return fallbackCode;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`Invalid lifecycle "${value}"`);
    }
    return normalized as Lifecycle;
  }

  protected pickLifecycleFallback(candidate: string, allowed: string[]): string {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (normalized && allowed.includes(normalized)) {
      return normalized;
    }
    if (allowed.includes('active')) {
      return 'active';
    }
    return allowed[0] || 'active';
  }

  protected async normalizeLegEnum(
    value: unknown,
    tenantId: string,
    settingsKey: 'interfaceTriggerTypes' | 'interfacePatterns' | 'interfaceFormats',
    label: string,
    manager?: EntityManager,
  ): Promise<string> {
    const code = String(value || '').trim().toLowerCase();
    if (!code) {
      throw new BadRequestException(`${label} is required`);
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const list = (settings as any)?.[settingsKey] || [];
    const allowed = new Set((list as Array<{ code: string }>).map((o) => o.code));
    if (!allowed.has(code)) {
      throw new BadRequestException(`Invalid ${label} "${value}"`);
    }
    return code;
  }

  protected parseInclude(raw: any): Set<string> {
    const includeRaw = Array.isArray(raw) ? raw.join(',') : String(raw ?? '').trim();
    return new Set(includeRaw.split(',').map((s) => s.trim()).filter(Boolean));
  }

  protected async createDefaultLegs(intf: InterfaceEntity, tenantId: string, manager?: EntityManager) {
    const legRepo = this.getLegRepo(manager);
    // Clear any existing legs for safety
    await legRepo.delete({ interface_id: intf.id } as any);

    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const triggerDefault = (settings.interfaceTriggerTypes[0]?.code ?? 'event_based').toLowerCase();
    const patternDefault = (settings.interfacePatterns[0]?.code ?? 'rest_api_sync').toLowerCase();
    const formatDefault = (settings.interfaceFormats[0]?.code ?? 'json').toLowerCase();

    const patternNaDefault =
      this.findNaDefault(settings.interfacePatterns as Array<{ code: string; label: string }>) || null;
    const formatNaDefault =
      this.findNaDefault(settings.interfaceFormats as Array<{ code: string; label: string }>) || null;

    const transformPatternDefault = (patternNaDefault || patternDefault).toLowerCase();
    const transformFormatDefault = (formatNaDefault || formatDefault).toLowerCase();

    const routeType = intf.integration_route_type as RouteType;
    const legs: InterfaceLeg[] = [];

    if (routeType === 'via_middleware') {
      const extract = legRepo.create({
        tenant_id: intf.tenant_id,
        interface_id: intf.id,
        leg_type: 'extract',
        from_role: 'source',
        to_role: 'middleware',
        trigger_type: triggerDefault,
        integration_pattern: patternDefault,
        data_format: formatDefault,
        job_name: null,
        order_index: 1,
      });
      const transform = legRepo.create({
        tenant_id: intf.tenant_id,
        interface_id: intf.id,
        leg_type: 'transform',
        from_role: 'middleware',
        to_role: 'middleware',
        trigger_type: triggerDefault,
        integration_pattern: transformPatternDefault,
        data_format: transformFormatDefault,
        job_name: null,
        order_index: 2,
      });
      const load = legRepo.create({
        tenant_id: intf.tenant_id,
        interface_id: intf.id,
        leg_type: 'load',
        from_role: 'middleware',
        to_role: 'target',
        trigger_type: triggerDefault,
        integration_pattern: patternDefault,
        data_format: formatDefault,
        job_name: null,
        order_index: 3,
      });
      legs.push(extract, transform, load);
    } else {
      const direct = legRepo.create({
        tenant_id: intf.tenant_id,
        interface_id: intf.id,
        leg_type: 'direct',
        from_role: 'source',
        to_role: 'target',
        trigger_type: triggerDefault,
        integration_pattern: patternDefault,
        data_format: formatDefault,
        job_name: null,
        order_index: 1,
      });
      legs.push(direct);
    }

    await legRepo.save(legs);
  }

  protected async syncMiddlewareApplications(
    intf: InterfaceEntity,
    middlewareApplicationIds: string[] | undefined,
    manager?: EntityManager,
  ) {
    const repo = this.getMiddlewareRepo(manager);
    await repo.delete({ interface_id: intf.id } as any);
    const ids = Array.from(new Set((middlewareApplicationIds || []).map((id) => String(id).trim()).filter(Boolean)));
    if (ids.length === 0) return;
    for (const appId of ids) {
      await this.ensureApplication(appId, manager);
    }
    const rows = ids.map((application_id) =>
      repo.create({
        tenant_id: intf.tenant_id,
        interface_id: intf.id,
        application_id,
      }),
    );
    await repo.save(rows);
  }

  protected async resolveTenantId(manager: EntityManager): Promise<string> {
    const res = await manager.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const id = res?.[0]?.tenant_id;
    if (!id) throw new Error('Tenant not resolved');
    return id;
  }
}
