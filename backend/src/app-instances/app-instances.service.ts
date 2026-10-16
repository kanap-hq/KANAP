import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AppInstance } from './app-instance.entity';
import { Application } from '../applications/application.entity';
import { InterfaceBinding } from '../interface-bindings/interface-binding.entity';
import { AppAssetAssignment } from '../app-asset-assignments/app-asset-assignment.entity';
import { RecordInUseException, type UsageCount } from '../common/record-in-use';
import { AuditService } from '../audit/audit.service';
import { resolveLifecycleState, DisabledAtInput } from '../common/status';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import {
  applicationParticipantCondition,
  ParticipationAccessScope,
} from '../auth/business-contributor-scope';

const ENVIRONMENTS = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'] as const;
type EnvironmentValue = (typeof ENVIRONMENTS)[number];
@Injectable()
export class AppInstancesService {
  constructor(
    @InjectRepository(AppInstance) private readonly repo: Repository<AppInstance>,
    @InjectRepository(Application) private readonly apps: Repository<Application>,
    @InjectRepository(InterfaceBinding) private readonly bindings: Repository<InterfaceBinding>,
    @InjectRepository(AppAssetAssignment) private readonly assignments: Repository<AppAssetAssignment>,
    private readonly audit: AuditService,
    private readonly itOpsSettings: ItOpsSettingsService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(AppInstance) : this.repo;
  }

  private getAppRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Application) : this.apps;
  }

  private getBindingsRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(InterfaceBinding) : this.bindings;
  }

  private getAssignmentsRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(AppAssetAssignment) : this.assignments;
  }

  private normalizeEnvironment(value: unknown): EnvironmentValue {
    const normalized = String(value || '').trim().toLowerCase();
    if (!ENVIRONMENTS.includes(normalized as EnvironmentValue)) {
      throw new BadRequestException(`Invalid environment "${value}"`);
    }
    return normalized as EnvironmentValue;
  }

  private normalizeNullableText(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  private normalizeBoolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    }
    return Boolean(value);
  }

  private resolveInstanceStatus({
    lifecycle,
    statusInput,
    disabledAtInput,
    currentDisabledAt,
  }: {
    lifecycle?: string;
    statusInput?: unknown;
    disabledAtInput?: DisabledAtInput;
    currentDisabledAt?: Date | null;
  }) {
    if (statusInput !== undefined || disabledAtInput !== undefined) {
      return resolveLifecycleState({ currentDisabledAt, nextStatus: statusInput, nextDisabledAt: disabledAtInput });
    }
    if (lifecycle === 'retired') {
      return resolveLifecycleState({ currentDisabledAt, nextStatus: 'disabled' });
    }
    return resolveLifecycleState({ currentDisabledAt, nextStatus: 'enabled' });
  }

  private async ensureApplication(
    applicationId: string,
    manager?: EntityManager,
    accessScope?: ParticipationAccessScope,
  ): Promise<Application> {
    const repo = this.getAppRepo(manager);
    const normalized = String(applicationId || '').trim();
    const uuidMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
    const sequentialMatch = normalized.match(/^(APP-[0-9]+)(?:-.+)?$/i);
    const qb = repo.createQueryBuilder('app');
    if (uuidMatch) {
      qb.where('app.id = :id', { id: normalized });
    } else if (sequentialMatch) {
      qb.where('upper(app.sequential_id) = upper(:sequentialId)', { sequentialId: sequentialMatch[1] });
    } else {
      throw new NotFoundException('Application not found');
    }
    if (accessScope) {
      qb.andWhere(applicationParticipantCondition('app', ':accessScopeUserId'), {
        accessScopeUserId: accessScope.userId,
      });
    }
    const app = await qb.getOne();
    if (!app) {
      throw new NotFoundException('Application not found');
    }
    return app;
  }

  async list(applicationId: string, opts?: { manager?: EntityManager; accessScope?: ParticipationAccessScope }) {
    const app = await this.ensureApplication(applicationId, opts?.manager, opts?.accessScope);
    const repo = this.getRepo(opts?.manager);
    return repo.find({
      where: { application_id: app.id } as any,
      order: { environment: 'ASC', created_at: 'ASC' } as any,
    });
  }

  private async assertEnvironmentAvailable(
    applicationId: string,
    environment: EnvironmentValue,
    opts: { manager?: EntityManager; ignoreId?: string | null } = {},
  ) {
    const repo = this.getRepo(opts.manager);
    const existing = await repo.findOne({
      where: {
        application_id: applicationId,
        environment,
      } as any,
    });
    if (existing && existing.id !== opts.ignoreId) {
      throw new BadRequestException(`Environment "${environment}" already exists for this application`);
    }
  }

  async create(
    applicationId: string,
    payload: any,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const app = await this.ensureApplication(applicationId, mg);
    if (!payload) {
      throw new BadRequestException('Body is required');
    }
    const environment = this.normalizeEnvironment(payload.environment ?? payload.env ?? payload.environment_id);
    await this.assertEnvironmentAvailable(app.id, environment, { manager: mg });

    const ssoEnabled = this.normalizeBoolean(payload.sso_enabled, app.sso_enabled);
    const mfaSupported = this.normalizeBoolean(payload.mfa_supported, app.mfa_supported);
    const lifecycle = await this.normalizeLifecycle(payload.lifecycle, app.tenant_id, mg, 'active');
    const lifecycleState = this.resolveInstanceStatus({
      lifecycle,
      statusInput: payload.status,
      disabledAtInput: payload.disabled_at as DisabledAtInput,
    });

    const instance = repo.create({
      application_id: app.id,
      environment,
      lifecycle,
      sso_enabled: ssoEnabled,
      mfa_supported: mfaSupported,
      base_url: this.normalizeNullableText(payload.base_url),
      region: this.normalizeNullableText(payload.region),
      zone: this.normalizeNullableText(payload.zone),
      notes: this.normalizeNullableText(payload.notes),
      status: lifecycleState.status,
      disabled_at: lifecycleState.disabled_at,
    });
    const saved = await repo.save(instance);
    await this.audit.log(
      { table: 'app_instances', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  private async findOrFail(instanceId: string, manager?: EntityManager) {
    const repo = this.getRepo(manager);
    const instance = await repo.findOne({ where: { id: instanceId } as any });
    if (!instance) {
      throw new NotFoundException('App instance not found');
    }
    return instance;
  }

  async update(instanceId: string, payload: any, userId: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Body is required');
    }
    const repo = this.getRepo(mg);
    const existing = await this.findOrFail(instanceId, mg);
    const before = { ...existing };
    let lifecycle: string | undefined;

    if (payload.environment && payload.environment !== existing.environment) {
      const env = this.normalizeEnvironment(payload.environment);
      await this.assertEnvironmentAvailable(existing.application_id, env, { manager: mg, ignoreId: instanceId });
      existing.environment = env;
    }

    if (payload.base_url !== undefined) {
      existing.base_url = this.normalizeNullableText(payload.base_url);
    }

    if (payload.region !== undefined) {
      existing.region = this.normalizeNullableText(payload.region);
    }

    if (payload.zone !== undefined) {
      existing.zone = this.normalizeNullableText(payload.zone);
    }

    if (payload.lifecycle !== undefined) {
      lifecycle = await this.normalizeLifecycle(
        payload.lifecycle,
        existing.tenant_id,
        mg,
        existing.lifecycle as string,
      );
      existing.lifecycle = lifecycle;
    }

    if (payload.sso_enabled !== undefined) {
      existing.sso_enabled = this.normalizeBoolean(payload.sso_enabled, existing.sso_enabled);
    }

    if (payload.mfa_supported !== undefined) {
      existing.mfa_supported = this.normalizeBoolean(payload.mfa_supported, existing.mfa_supported);
    }

    if (payload.notes !== undefined) {
      existing.notes = this.normalizeNullableText(payload.notes);
    }

    if (payload.status !== undefined || payload.disabled_at !== undefined || lifecycle !== undefined) {
      const { status, disabled_at } = this.resolveInstanceStatus({
        lifecycle: lifecycle ?? (existing.lifecycle as string),
        statusInput: payload.status,
        disabledAtInput: payload.disabled_at as DisabledAtInput,
        currentDisabledAt: existing.disabled_at,
      });
      existing.status = status;
      existing.disabled_at = disabled_at;
    }

    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'app_instances', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async delete(instanceId: string, userId: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const instance = await this.findOrFail(instanceId, mg);

    const bindingsRepo = this.getBindingsRepo(mg);
    const bindingCount = await bindingsRepo
      .createQueryBuilder('b')
      .where('b.source_instance_id = :id OR b.target_instance_id = :id', { id: instanceId })
      .getCount();
    const assignmentsRepo = this.getAssignmentsRepo(mg);
    const assignmentCount = await assignmentsRepo.count({ where: { app_instance_id: instanceId } as any });
    // Both counted, for one refusal the interface words (APP_INSTANCE_IN_USE): remove them first.
    const usages: UsageCount[] = [];
    if (bindingCount > 0) usages.push({ type: 'interface_bindings', total: bindingCount });
    if (assignmentCount > 0) usages.push({ type: 'server_assignments', total: assignmentCount });
    if (usages.length > 0) {
      throw new RecordInUseException('APP_INSTANCE_IN_USE', 'instance', instance.environment, usages,
        `Cannot delete instance with ${bindingCount > 0 ? 'active interface bindings' : 'server assignments'}. Remove them first.`);
    }

    await repo.delete({ id: instanceId } as any);
    await this.audit.log(
      { table: 'app_instances', recordId: instanceId, action: 'delete', before: instance, after: null, userId },
      { manager: mg },
    );
    return { deleted: true };
  }

  private async normalizeLifecycle(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    fallback?: string,
  ): Promise<string> {
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = (settings.lifecycleStates || []).map((item) => item.code);
    const normalizedFallback = this.pickLifecycleFallback(fallback, allowed);
    if (value === undefined || value === null || String(value).trim() === '') {
      return normalizedFallback;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`Invalid lifecycle "${value}"`);
    }
    return normalized;
  }

  private pickLifecycleFallback(candidate: string | undefined, allowed: string[]): string {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (normalized && allowed.includes(normalized)) {
      return normalized;
    }
    if (allowed.includes('active')) return 'active';
    return allowed[0] || 'active';
  }
}
