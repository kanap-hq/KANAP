import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { InterfaceBinding } from './interface-binding.entity';
import { InterfaceEntity } from '../interfaces/interface.entity';
import { InterfaceLeg } from '../interfaces/interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interfaces/interface-middleware-application.entity';
import { AppInstance } from '../app-instances/app-instance.entity';
import { Application } from '../applications/application.entity';
import { AuditService } from '../audit/audit.service';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { resolveOfferedCatalogCode } from '../it-ops-settings/catalog-resolve';
import { InterfaceConnectionLink } from '../interface-connection-links/interface-connection-link.entity';
import { Connection } from '../connections/connection.entity';

export type BindingLifecycle = string;

export function normalizeBindingLifecycle(value: unknown): BindingLifecycle {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'active';
  if (raw === 'enabled') return 'active';
  if (raw === 'paused') return 'active';
  return raw;
}

@Injectable()
export class InterfaceBindingsService {
  constructor(
    @InjectRepository(InterfaceBinding) private readonly repo: Repository<InterfaceBinding>,
    @InjectRepository(InterfaceEntity) private readonly interfaces: Repository<InterfaceEntity>,
    @InjectRepository(InterfaceLeg) private readonly legs: Repository<InterfaceLeg>,
    @InjectRepository(InterfaceMiddlewareApplication)
    private readonly middlewareApps: Repository<InterfaceMiddlewareApplication>,
    @InjectRepository(AppInstance) private readonly instances: Repository<AppInstance>,
    @InjectRepository(Application) private readonly applications: Repository<Application>,
    private readonly audit: AuditService,
    private readonly itOpsSettings: ItOpsSettingsService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceBinding) : this.repo;
  }

  private getInterfaceRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceEntity) : this.interfaces;
  }

  private getLegRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceLeg) : this.legs;
  }

  private getMiddlewareRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceMiddlewareApplication) : this.middlewareApps;
  }

  private getInstanceRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(AppInstance) : this.instances;
  }

  private getApplicationRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Application) : this.applications;
  }

  private getLinkRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceConnectionLink) : this.repo.manager.getRepository(InterfaceConnectionLink);
  }

  // Status is stored as a lifecycle string on the binding
  private async normalizeStatus(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    fallback: string = 'proposed',
    held?: string | null,
  ): Promise<BindingLifecycle> {
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = (settings.lifecycleStates || []).map((item) => item.code);
    const fallbackCode = this.pickLifecycleFallback(fallback, allowed);
    if (value === undefined || value === null || String(value).trim() === '') {
      return fallbackCode;
    }
    // Rule P7: a retired state only on the binding that holds it.
    return resolveOfferedCatalogCode(normalizeBindingLifecycle(value), settings.lifecycleStates || [], { held, what: 'status' });
  }

  private normalizeNullable(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  /** Rule P7: a retired mode, or one the catalog does not know, only on the binding that holds it. */
  private async normalizeAuthMode(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    held?: string | null,
  ): Promise<string | null> {
    if (value == null || value === '') return null;
    const code = String(value || '').trim();
    if (!code) return null;
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    return resolveOfferedCatalogCode(code, settings.interfaceAuthModes || [], { held, what: 'authentication mode' });
  }

  private async ensureInterface(id: string, manager?: EntityManager) {
    const repo = this.getInterfaceRepo(manager);
    const entity = await repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Interface not found');
    return entity;
  }

  private async ensureLeg(id: string, interfaceId: string, manager?: EntityManager) {
    const repo = this.getLegRepo(manager);
    const leg = await repo.findOne({ where: { id, interface_id: interfaceId } as any });
    if (!leg) throw new BadRequestException('Interface leg not found');
    return leg;
  }

  private async ensureInstance(id: string, manager?: EntityManager) {
    const repo = this.getInstanceRepo(manager);
    const instance = await repo.findOne({ where: { id } });
    if (!instance) throw new BadRequestException('App instance not found');
    return instance;
  }

  private async ensureIntegrationTool(id: string, manager?: EntityManager) {
    const repo = this.getApplicationRepo(manager);
    const app = await repo.findOne({ where: { id } });
    if (!app) throw new BadRequestException('Integration tool application not found');
    return app;
  }

  async list(interfaceId: string, opts?: { manager?: EntityManager }) {
    await this.ensureInterface(interfaceId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const rows: Array<{
      id: string;
      interface_id: string;
      interface_leg_id: string;
      leg_type: string;
      order_index: number;
      environment: string;
      source_instance_id: string;
      target_instance_id: string;
      status: string;
      source_endpoint: string | null;
      target_endpoint: string | null;
      trigger_details: string | null;
      env_job_name: string | null;
      authentication_mode: string | null;
      monitoring_url: string | null;
      env_notes: string | null;
      integration_tool_application_id: string | null;
      created_at: Date;
      updated_at: Date;
      source_application_id: string;
      target_application_id: string;
    }> = await mg.query(
      `SELECT b.id,
              b.interface_id,
              b.interface_leg_id,
              l.leg_type,
              l.order_index,
              b.environment,
              b.source_instance_id,
              b.target_instance_id,
              b.status,
              b.source_endpoint,
              b.target_endpoint,
              b.trigger_details,
              b.env_job_name,
              b.authentication_mode,
              b.monitoring_url,
              b.env_notes,
              b.integration_tool_application_id,
              b.created_at,
              b.updated_at,
              si.application_id AS source_application_id,
              ti.application_id AS target_application_id
       FROM interface_bindings b
       JOIN interface_legs l ON l.id = b.interface_leg_id
       JOIN app_instances si ON si.id = b.source_instance_id
       JOIN app_instances ti ON ti.id = b.target_instance_id
       WHERE b.interface_id = $1
       ORDER BY b.environment ASC, l.order_index ASC, b.created_at ASC`,
      [interfaceId],
    );
    return {
      items: rows.map((row) => ({
        ...row,
        status: normalizeBindingLifecycle(row.status),
      })),
    };
  }

  async create(
    interfaceId: string,
    payload: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    if (!payload || typeof payload !== 'object') throw new BadRequestException('Body is required');
    if (!tenantId) throw new BadRequestException('Tenant context is required');

    const targetInterface = await this.ensureInterface(interfaceId, mg);
    if (!payload.interface_leg_id) throw new BadRequestException('interface_leg_id is required');
    if (!payload.source_instance_id) throw new BadRequestException('source_instance_id is required');
    if (!payload.target_instance_id) throw new BadRequestException('target_instance_id is required');

    const leg = await this.ensureLeg(payload.interface_leg_id, interfaceId, mg);
    const sourceInstance = await this.ensureInstance(payload.source_instance_id, mg);
    const targetInstance = await this.ensureInstance(payload.target_instance_id, mg);

    await this.validateInstanceAlignment(targetInterface, leg, sourceInstance, targetInstance, mg);

    const environment = sourceInstance.environment;
    const duplicate = await repo.findOne({
      where: {
        interface_leg_id: leg.id,
        environment,
      } as any,
    });
    if (duplicate) {
      throw new BadRequestException('Binding already exists for this leg and environment');
    }

    const binding = repo.create({
      tenant_id: tenantId,
      interface_id: interfaceId,
      interface_leg_id: leg.id,
      environment,
      source_instance_id: sourceInstance.id,
      target_instance_id: targetInstance.id,
      source_endpoint: this.normalizeNullable(payload.source_endpoint),
      target_endpoint: this.normalizeNullable(payload.target_endpoint),
      trigger_details: this.normalizeNullable(payload.trigger_details),
      env_job_name: this.normalizeNullable(payload.env_job_name),
      authentication_mode: await this.normalizeAuthMode(payload.authentication_mode, tenantId, mg),
      monitoring_url: this.normalizeNullable(payload.monitoring_url),
      env_notes: this.normalizeNullable(payload.env_notes),
      status: await this.normalizeStatus(payload.status, tenantId, mg, 'proposed'),
      integration_tool_application_id: payload.integration_tool_application_id
        ? (await this.ensureIntegrationTool(payload.integration_tool_application_id, mg)).id
        : null,
    });
    const saved = await repo.save(binding);
    await this.audit.log(
      { table: 'interface_bindings', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async update(
    bindingId: string,
    payload: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const repo = this.getRepo(opts?.manager);
    if (!payload || typeof payload !== 'object') throw new BadRequestException('Body is required');
    if (!tenantId) throw new BadRequestException('Tenant context is required');

    const existing = await repo.findOne({ where: { id: bindingId } });
    if (!existing) throw new NotFoundException('Binding not found');
    const targetInterface = await this.ensureInterface(existing.interface_id, opts?.manager);
    const leg = await this.ensureLeg(existing.interface_leg_id, existing.interface_id, opts?.manager);
    const before = { ...existing };

    if (payload.source_instance_id || payload.target_instance_id) {
      const newSourceId = payload.source_instance_id ?? existing.source_instance_id;
      const newTargetId = payload.target_instance_id ?? existing.target_instance_id;
      const sourceInstance = await this.ensureInstance(newSourceId, opts?.manager);
      const targetInstance = await this.ensureInstance(newTargetId, opts?.manager);
      await this.validateInstanceAlignment(
        targetInterface,
        leg,
        sourceInstance,
        targetInstance,
        opts?.manager ?? this.repo.manager,
      );

      const nextEnvironment = sourceInstance.environment;
      if (nextEnvironment !== existing.environment) {
        const duplicate = await repo.findOne({
          where: {
            interface_leg_id: existing.interface_leg_id,
            environment: nextEnvironment,
          } as any,
        });
        if (duplicate && duplicate.id !== existing.id) {
          throw new BadRequestException('Binding already exists for this leg and environment');
        }
      }

      existing.source_instance_id = newSourceId;
      existing.target_instance_id = newTargetId;
      existing.environment = nextEnvironment;
    }

    if (payload.source_endpoint !== undefined) {
      existing.source_endpoint = this.normalizeNullable(payload.source_endpoint);
    }
    if (payload.target_endpoint !== undefined) {
      existing.target_endpoint = this.normalizeNullable(payload.target_endpoint);
    }
    if (payload.trigger_details !== undefined) {
      existing.trigger_details = this.normalizeNullable(payload.trigger_details);
    }
    if (payload.env_job_name !== undefined) {
      existing.env_job_name = this.normalizeNullable(payload.env_job_name);
    }
    if (payload.authentication_mode !== undefined) {
      existing.authentication_mode = await this.normalizeAuthMode(
        payload.authentication_mode,
        tenantId,
        opts?.manager,
        existing.authentication_mode,
      );
    }
    if (payload.monitoring_url !== undefined) {
      existing.monitoring_url = this.normalizeNullable(payload.monitoring_url);
    }
    if (payload.env_notes !== undefined) {
      existing.env_notes = this.normalizeNullable(payload.env_notes);
    }
    if (payload.status !== undefined) {
      existing.status = await this.normalizeStatus(payload.status ?? existing.status, tenantId, opts?.manager, existing.status, existing.status);
    }
    if (payload.integration_tool_application_id !== undefined) {
      existing.integration_tool_application_id = payload.integration_tool_application_id
        ? (await this.ensureIntegrationTool(payload.integration_tool_application_id, opts?.manager)).id
        : null;
    }
    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'interface_bindings', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: opts?.manager },
    );
    return saved;
  }

  async delete(bindingId: string, userId: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const binding = await repo.findOne({ where: { id: bindingId } });
    if (!binding) throw new NotFoundException('Binding not found');
    await repo.delete({ id: bindingId } as any);
    await this.audit.log(
      { table: 'interface_bindings', recordId: bindingId, action: 'delete', before: binding, after: null, userId },
      { manager: opts?.manager },
    );
    return { deleted: true };
  }

  async listConnectionLinks(
    bindingId: string,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ) {
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    const mg = opts?.manager ?? this.repo.manager;

    const binding = await this.getRepo(mg).findOne({ where: { id: bindingId } });
    if (!binding) throw new NotFoundException('Binding not found');

    const rows: Array<{
      id: string;
      interface_binding_id: string;
      connection_id: string;
      notes: string | null;
      connection_reference: string;
      name: string;
      topology: string;
      lifecycle: string;
      criticality: string;
      data_class: string;
      contains_pii: boolean;
    }> = await mg.query(
      `SELECT
         l.id,
         l.interface_binding_id,
         l.connection_id,
         l.notes,
         c.connection_reference,
         c.name,
         c.topology,
         c.lifecycle,
         c.criticality,
         c.data_class,
         c.contains_pii
       FROM interface_connection_links l
       JOIN connections c ON c.id = l.connection_id
       WHERE l.interface_binding_id = $1
       ORDER BY c.name ASC, c.connection_reference ASC`,
      [bindingId],
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        interface_binding_id: r.interface_binding_id,
        connection_id: r.connection_id,
        notes: r.notes,
        connection: {
          id: r.connection_id,
          connection_reference: r.connection_reference,
          name: r.name,
          topology: r.topology,
          lifecycle: r.lifecycle,
          criticality: r.criticality,
          data_class: r.data_class,
          contains_pii: r.contains_pii,
        },
      })),
    };
  }

  async createConnectionLink(
    bindingId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const connectionId = String(body.connection_id || '').trim();
    if (!connectionId) throw new BadRequestException('connection_id is required');

    const mg = opts?.manager ?? this.repo.manager;
    const binding = await this.getRepo(mg).findOne({ where: { id: bindingId } });
    if (!binding) throw new NotFoundException('Binding not found');

    const connRepo = mg.getRepository(Connection);
    const conn = await connRepo.findOne({ where: { id: connectionId } });
    if (!conn) throw new BadRequestException('Connection not found');

    const linkRepo = this.getLinkRepo(mg);
    const existing = await linkRepo.findOne({
      where: { interface_binding_id: bindingId, connection_id: connectionId } as any,
    });
    if (existing) {
      return existing;
    }

    // Determine if this will be the first link for the connection
    const beforeCountRows: Array<{ c: string }> = await mg.query(
      `SELECT COUNT(*)::text AS c FROM interface_connection_links WHERE connection_id = $1`,
      [connectionId],
    );
    const hadLinks = Number(beforeCountRows[0]?.c || '0') > 0;

    const notes =
      body.notes === undefined || body.notes === null
        ? null
        : String(body.notes).trim() || null;

    const link = linkRepo.create({
      tenant_id: tenantId,
      interface_binding_id: bindingId,
      connection_id: connectionId,
      notes,
    });
    const saved = await linkRepo.save(link);

    // Auto-switch to derived risk when the first link is created and the
    // connection is still in manual mode. If users later switch back to manual
    // explicitly while links exist, this will not override their choice.
    if (!hadLinks && conn.risk_mode === 'manual') {
      const before = { ...conn };
      conn.risk_mode = 'derived';
      conn.updated_at = new Date();
      const updated = await connRepo.save(conn);
      await this.audit.log(
        {
          table: 'connections',
          recordId: connectionId,
          action: 'update',
          before,
          after: updated,
          userId,
        },
        { manager: mg },
      );
    }

    return saved;
  }

  async deleteConnectionLink(
    bindingId: string,
    linkId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const linkRepo = this.getLinkRepo(mg);
    const link = await linkRepo.findOne({
      where: { id: linkId, interface_binding_id: bindingId } as any,
    });
    if (!link) throw new NotFoundException('Link not found');
    const connectionId = link.connection_id;
    await linkRepo.delete({ id: linkId } as any);

    if (connectionId) {
      const remaining: Array<{ c: string }> = await mg.query(
        `SELECT COUNT(*)::text AS c FROM interface_connection_links WHERE connection_id = $1`,
        [connectionId],
      );
      const count = Number(remaining[0]?.c || '0');
      if (count === 0) {
        const connRepo = mg.getRepository(Connection);
        const conn = await connRepo.findOne({ where: { id: connectionId } });
        if (conn && conn.risk_mode === 'derived') {
          const before = { ...conn };
          conn.risk_mode = 'manual';
          conn.updated_at = new Date();
          const saved = await connRepo.save(conn);
          await this.audit.log(
            {
              table: 'connections',
              recordId: connectionId,
              action: 'update',
              before,
              after: saved,
              userId,
            },
            { manager: mg },
          );
        }
      }
    }

    return { deleted: true };
  }

  private async validateInstanceAlignment(
    intf: InterfaceEntity,
    leg: InterfaceLeg,
    source: AppInstance,
    target: AppInstance,
    manager?: EntityManager,
  ) {
    if (source.environment !== target.environment) {
      throw new BadRequestException('Source and target instances must share the same environment');
    }

    const middlewareRepo = this.getMiddlewareRepo(manager);
    const middleware = await middlewareRepo.find({ where: { interface_id: intf.id } as any });
    const middlewareAppIds = new Set(middleware.map((m) => m.application_id));

    const matchesRole = (role: string, appId: string): boolean => {
      if (role === 'source') return appId === intf.source_application_id;
      if (role === 'target') return appId === intf.target_application_id;
      if (role === 'middleware') return middlewareAppIds.has(appId);
      return true;
    };

    if (!matchesRole(leg.from_role, source.application_id)) {
      throw new BadRequestException('Source instance does not match leg source role');
    }
    if (!matchesRole(leg.to_role, target.application_id)) {
      throw new BadRequestException('Target instance does not match leg target role');
    }
  }

  private pickLifecycleFallback(candidate: string, allowed: string[]): string {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (normalized && allowed.includes(normalized)) {
      return normalized;
    }
    if (allowed.includes('active')) return 'active';
    return allowed[0] || 'active';
  }
}
