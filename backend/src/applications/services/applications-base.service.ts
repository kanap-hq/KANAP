import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { Application } from '../application.entity';
import {
  applicationParticipantCondition,
  notFoundForScopedAccess,
  ParticipationAccessScope,
} from '../../auth/business-contributor-scope';

/**
 * Common options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
  tenantId?: string;
  accessScope?: ParticipationAccessScope;
  projectAccessScope?: ParticipationAccessScope;
  /** The requests the caller may count (Relations badge): none without the read right on requests. */
  requestsAccess?: { scope?: ParticipationAccessScope } | null;
  /**
   * The Relations badge counts budget lines and contracts only for a caller who reads them, as the
   * Relations tab shows them. `false` leaves them out; left unset (internal callers), they count.
   */
  readsBudget?: boolean;
  readsContracts?: boolean;
}

/**
 * Base class with shared utilities for application services.
 */
export abstract class ApplicationsBaseService {
  constructor(protected readonly appRepo: Repository<Application>) {}

  protected getRepo(manager?: EntityManager): Repository<Application> {
    return manager ? manager.getRepository(Application) : this.appRepo;
  }

  protected getManager(opts?: ServiceOpts): EntityManager {
    return opts?.manager ?? this.appRepo.manager;
  }

  protected normalizeNullable(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  protected ensureTenantId(tenantId?: string): string {
    const normalized = String(tenantId || '').trim();
    if (!normalized) {
      throw new BadRequestException('Tenant context is required');
    }
    return normalized;
  }

  protected parseBool(v: unknown): boolean {
    const s = String(v ?? '').trim().toLowerCase();
    return ['yes', 'true', '1', 'y', 't'].includes(s);
  }

  async ensureApp(
    id: string,
    manager?: EntityManager,
    accessScope?: ParticipationAccessScope,
  ): Promise<Application> {
    const repo = this.getRepo(manager);
    const resolvedId = await this.resolveApplicationIdentifier(id, manager);
    const app = await repo.findOne({ where: { id: resolvedId } });
    if (!app) throw new NotFoundException('Application not found');
    await this.assertVisible(resolvedId, accessScope, manager);
    return app;
  }

  async assertVisible(
    id: string,
    accessScope?: ParticipationAccessScope,
    manager?: EntityManager,
  ): Promise<void> {
    if (!accessScope) return;
    const repo = this.getRepo(manager);
    const visible = await repo
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .where('a.id = :id', { id })
      .andWhere(applicationParticipantCondition('a', ':accessScopeUserId'), {
        accessScopeUserId: accessScope.userId,
      })
      .getRawOne();
    if (!visible) throw notFoundForScopedAccess('Application');
  }

  async resolveApplicationIdentifier(identifier: string, manager?: EntityManager): Promise<string> {
    const normalized = String(identifier || '').trim();
    if (!normalized) throw new NotFoundException('Application not found');

    const mg = manager ?? this.appRepo.manager;
    const uuidMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
    const sequentialMatch = normalized.match(/^(APP-[0-9]+)(?:-.+)?$/i);

    const rows: Array<{ id: string }> = uuidMatch
      ? await mg.query(
        `SELECT id::text AS id
         FROM applications
         WHERE id = $1
           AND tenant_id = app_current_tenant()
         LIMIT 1`,
        [normalized],
      )
      : sequentialMatch
        ? await mg.query(
          `SELECT id::text AS id
           FROM applications
           WHERE upper(sequential_id) = upper($1)
             AND tenant_id = app_current_tenant()
           LIMIT 1`,
          [sequentialMatch[1]],
        )
        : [];

    if (!rows[0]?.id) {
      throw new NotFoundException('Application not found');
    }
    return rows[0].id;
  }

  protected async resolveTenantId(manager: EntityManager): Promise<string> {
    const res = await manager.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const id = res?.[0]?.tenant_id;
    if (!id) throw new Error('Tenant not resolved');
    return id;
  }

  protected async getCurrentTenantId(manager: EntityManager): Promise<string> {
    const rows: Array<{ tenant_id: string }> = await manager.query(`SELECT app_current_tenant() AS tenant_id`);
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }
    return tenantId;
  }
}
