import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { resolveAssetId } from '../asset-identifier';
import { Asset } from '../asset.entity';
import { AuditSourceOptions } from '../../audit/audit.service';
import type { LinkSource } from '../../common/link-provenance';

/**
 * Environment values for assets.
 */
export const ENVIRONMENTS = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'] as const;
export type EnvironmentValue = (typeof ENVIRONMENTS)[number];

/**
 * Common options for service methods.
 *
 * `source` / `sourceRef` land on the audit entries these services write. A
 * caller that omits them keeps the previous behaviour (AuditService infers
 * 'user' or 'system' from the user id); background writers such as the Netbox
 * sync pass source 'system' with their own reference.
 */
export interface ServiceOpts extends AuditSourceOptions {
  manager?: EntityManager;
  tenantId?: string;
  /**
   * Language the list sorts catalog columns in (`en`, `fr`, `de`, `es`). Omitted, those columns
   * sort by the tenant's stored label.
   */
  language?: 'en' | 'fr' | 'de' | 'es';
  /**
   * Provenance of the operating-system link (`manual` when omitted). Separate from `source`,
   * which is the audit entry of the asset row.
   */
  osSource?: LinkSource;
}

/**
 * Base class with shared utilities for asset services.
 */
export abstract class AssetsBaseService {
  constructor(protected readonly assetRepo: Repository<Asset>) {}

  protected getRepo(manager?: EntityManager): Repository<Asset> {
    return manager ? manager.getRepository(Asset) : this.assetRepo;
  }

  protected normalizeEnvironment(value: unknown): EnvironmentValue {
    const normalized = String(value || '').trim().toLowerCase();
    if (!ENVIRONMENTS.includes(normalized as EnvironmentValue)) {
      throw new BadRequestException(`Invalid environment "${value}"`);
    }
    return normalized as EnvironmentValue;
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

  protected normalizeBooleanFlag(value: unknown, label: string = 'flag'): boolean {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    throw new BadRequestException(`Invalid ${label}`);
  }

  async ensureAsset(id: string, manager?: EntityManager, tenantId?: string): Promise<Asset> {
    const mg = manager ?? this.assetRepo.manager;
    const resolvedId = await resolveAssetId(mg, id, tenantId);
    const repo = this.getRepo(manager);
    const where: Record<string, any> = { id: resolvedId };
    if (tenantId) {
      where.tenant_id = tenantId;
    }
    const asset = await repo.findOne({ where: where as any });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async ensureAssetByReference(reference: string, manager?: EntityManager, tenantId?: string): Promise<Asset> {
    const normalized = String(reference || '').trim().toUpperCase();
    if (!/^AST-\d+$/.test(normalized)) {
      throw new BadRequestException('Invalid asset reference');
    }
    const repo = this.getRepo(manager);
    const where: Record<string, any> = { asset_reference: normalized };
    if (tenantId) {
      where.tenant_id = tenantId;
    }
    const asset = await repo.findOne({ where: where as any });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  protected async ensureAssetIsCluster(id: string, manager?: EntityManager, tenantId?: string): Promise<Asset> {
    const asset = await this.ensureAsset(id, manager, tenantId);
    if (!asset.is_cluster) {
      throw new BadRequestException('Asset is not a cluster');
    }
    return asset;
  }

  protected async ensureAssetIsNode(id: string, manager?: EntityManager, tenantId?: string): Promise<Asset> {
    const asset = await this.ensureAsset(id, manager, tenantId);
    if (asset.is_cluster) {
      throw new BadRequestException('Select a host asset, not a cluster');
    }
    return asset;
  }

  protected async resolveLocationId(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const normalized = this.normalizeNullable(value);
    if (!normalized) return null;
    const mg = manager ?? this.assetRepo.manager;
    const rows = await mg.query(
      `SELECT id FROM locations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [normalized, tenantId],
    );
    if (!rows || rows.length === 0) {
      throw new BadRequestException('Invalid location_id');
    }
    return normalized;
  }

  protected async resolveSubLocationId(
    value: unknown,
    locationId: string | null,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const normalized = this.normalizeNullable(value);
    if (!normalized) return null;
    if (!locationId) {
      throw new BadRequestException('Cannot set sub_location_id without a location');
    }
    const mg = manager ?? this.assetRepo.manager;
    const rows = await mg.query(
      `SELECT id FROM location_sub_items WHERE id = $1 AND location_id = $2 AND tenant_id = $3 LIMIT 1`,
      [normalized, locationId, tenantId],
    );
    if (!rows || rows.length === 0) {
      throw new BadRequestException('Invalid sub_location_id');
    }
    return normalized;
  }

  /** Audit attribution carried by the caller; both keys stay undefined for normal user writes. */
  protected auditSource(opts?: ServiceOpts): AuditSourceOptions {
    return { source: opts?.source, sourceRef: opts?.sourceRef };
  }

  protected getManager(opts?: ServiceOpts): EntityManager {
    return opts?.manager ?? this.assetRepo.manager;
  }
}
