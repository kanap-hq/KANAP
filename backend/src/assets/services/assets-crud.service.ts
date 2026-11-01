import { TechnologyCpeEvents } from '../../technologies/technology-cpe-events';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Asset } from '../asset.entity';
import { AssetClusterMember } from '../asset-cluster-member.entity';
import { AuditService } from '../../audit/audit.service';
import {
  assertClusterMemberCandidates,
  clusterOsWithMembersRefusal,
  clusterSwitchRefusals,
  lockClusterForMembers,
} from '../asset-rules';
import { LinkSource } from '../../common/link-provenance';
import { operatingSystemLabelSql } from '../../technologies/operating-system-codes';
import { OperatingSystemService } from '../../technologies/operating-system.service';
import { assertAssetFqdnFree, assertAssetNameFree, assetBadRequest, assetNameKey, lockAssetNames } from '../asset-rules';
import { AssetsBaseService, ServiceOpts } from './assets-base.service';
import { AssetsValidationService } from './assets-validation.service';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';
import { shareRecipientsOf } from '../../notifications/share-recipients';
import { displayName } from '../../common/display-name';
import { NotificationsService } from '../../notifications/notifications.service';

/** Every asset has a site: a create without one, or an update that clears it, is refused. */
function locationRequired() {
  return assetBadRequest('asset_location_required', 'location_id is required');
}

/**
 * Service for core CRUD operations on assets.
 */
@Injectable()
export class AssetsCrudService extends AssetsBaseService {
  constructor(
    @InjectRepository(Asset) assetRepo: Repository<Asset>,
    @InjectRepository(AssetClusterMember) private readonly clusterMembers: Repository<AssetClusterMember>,
    private readonly audit: AuditService,
    private readonly validation: AssetsValidationService,
    private readonly notifications: NotificationsService,
    private readonly operatingSystems: OperatingSystemService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {
    super(assetRepo);
  }

  /** The link provenance of an operating-system write. The asset audit keeps `opts.source`. */
  private osSource(opts?: ServiceOpts): LinkSource {
    return opts?.osSource ?? 'manual';
  }

  /**
   * Turn a label, an old shipped code, or an empty value into the marked link.
   * `create` is on: a name the tenant does not have yet becomes a technology.
   */
  private async applyOperatingSystem(
    tenantId: string,
    assetId: string,
    value: unknown,
    userId: string | null,
    opts?: ServiceOpts,
  ): Promise<void> {
    const mg = this.getManager(opts);
    const resolved = await this.operatingSystems.resolve(mg, tenantId, value == null ? null : String(value), { create: true });
    await this.operatingSystems.setOperatingSystem(mg, tenantId, assetId, resolved, this.osSource(opts), userId);
  }

  /** The readable label, after the asset audit has already snapshotted the columns. */
  private async attachOperatingSystem<T extends { id: string }>(
    asset: T,
    tenantId: string,
    opts?: ServiceOpts,
  ): Promise<T & { operating_system: string | null }> {
    const label = await this.operatingSystems.labelOf(this.getManager(opts), tenantId, asset.id);
    return { ...asset, operating_system: label };
  }

  private getClusterMemberRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(AssetClusterMember) : this.clusterMembers;
  }

  /**
   * Get a single asset by ID.
   */
  async get(id: string, opts?: ServiceOpts) {
    return this.withOperatingSystem(await this.withExternalLinks(await this.ensureAsset(id, opts?.manager, opts?.tenantId), opts), opts);
  }

  async getByReference(reference: string, opts?: ServiceOpts) {
    return this.withOperatingSystem(await this.withExternalLinks(await this.ensureAssetByReference(reference, opts?.manager, opts?.tenantId), opts), opts);
  }

  private async withOperatingSystem<T extends { id: string; tenant_id?: string | null }>(asset: T, opts?: ServiceOpts) {
    const tenantId = this.normalizeNullable(opts?.tenantId ?? asset.tenant_id);
    if (!tenantId) return { ...asset, operating_system: null as string | null };
    return this.attachOperatingSystem(asset, tenantId, opts);
  }

  /**
   * Adds the external inventory objects this asset is linked to (Netbox today)
   * so the workspace can show where the values come from. One tenant-filtered
   * query; rows an administrator ignored or that failed are not shown here.
   */
  private async withExternalLinks(asset: Asset, opts?: ServiceOpts) {
    const tenantId = this.normalizeNullable(opts?.tenantId ?? asset.tenant_id);
    if (!tenantId) {
      return { ...asset, external_links: [] };
    }
    const rows: Array<{
      source: string;
      external_type: string;
      external_url: string | null;
      state: string;
      external_status: string | null;
      managed_fields: string[] | null;
      last_synced_at: Date | null;
    }> = await this.getManager(opts).query(
      `SELECT source, external_type, external_url, state, external_status, managed_fields, last_synced_at
       FROM asset_external_links
       WHERE tenant_id = $1 AND asset_id = $2 AND state IN ('linked', 'missing')
       ORDER BY source ASC, external_type ASC`,
      [tenantId, asset.id],
    );
    return {
      ...asset,
      external_links: rows.map((row) => ({
        source: row.source,
        external_type: row.external_type,
        external_url: row.external_url,
        state: row.state,
        // The status the inventory reports; the asset's own lifecycle is its own.
        external_status: row.external_status ?? null,
        // The fields the inventory provides for this object. Null means the
        // record predates the list, and the workspace then locks all of them.
        managed_fields: row.managed_fields ?? null,
        last_synced_at: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
      })),
    };
  }

  async shareAsset(
    assetId: string,
    dto: ShareItemDto,
    tenantId: string,
    userId: string,
    opts?: ServiceOpts,
  ) {
    const { userIds, rawEmails } = shareRecipientsOf(dto);

    const mg = this.getManager(opts);
    const asset = await this.ensureAsset(assetId, opts?.manager, tenantId);
    const senderRows = await mg.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    const senderName = displayName(senderRows[0], 'Someone');

    const recipientRows = userIds.length > 0
      ? await mg.query(
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
        itemType: 'asset',
        itemId: asset.id,
        itemName: asset.name,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
        manager: mg,
      });
    }

    return { ok: true };
  }

  /**
   * Create a new asset.
   */
  async create(
    body: Partial<Asset>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const repo = this.getRepo(opts?.manager);

    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');

    const name = this.normalizeNullable(body.name);
    if (!name) throw new BadRequestException('name is required');
    if (body.environment == null) throw new BadRequestException('environment is required');
    if (body.kind == null) throw new BadRequestException('kind is required');
    if (body.provider == null) throw new BadRequestException('provider is required');

    const environment = this.normalizeEnvironment(body.environment);
    const kind = await this.validation.resolveKind(body.kind, tenant, opts?.manager);
    const provider = await this.validation.resolveProvider(body.provider, tenant, opts?.manager);
    const status = await this.validation.normalizeLifecycleStatus(body.status, tenant, opts?.manager, 'active');
    const location_id = await this.resolveLocationId((body as any).location_id, tenant, opts?.manager);
    if (!location_id) throw locationRequired();
    const sub_location_id = await this.resolveSubLocationId((body as any).sub_location_id, location_id, tenant, opts?.manager);
    const setsOperatingSystem = Object.prototype.hasOwnProperty.call(body, 'operating_system');
    const is_cluster = body.is_cluster === undefined ? false : this.normalizeBooleanFlag((body as any).is_cluster, 'is_cluster');
    const ip_addresses = await this.validation.validateIpAddresses((body as any).ip_addresses, tenant, this.getManager(opts));
    const notes = this.normalizeNullable((body as any).notes);

    // Handle domain, hostname, and FQDN
    const domain = await this.validation.resolveDomain((body as any).domain, tenant, opts?.manager);
    const admin_zone = await this.validation.resolveAdminZone((body as any).admin_zone, tenant, opts?.manager);
    const hostname = this.normalizeNullable(body.hostname);

    // Validate hostname if domain requires it
    if (domain && domain !== 'workgroup' && domain !== 'n-a') {
      if (!hostname) {
        throw new BadRequestException('Hostname is required when a domain is selected');
      }
    }
    if (hostname && !this.validation.validateHostname(hostname)) {
      throw new BadRequestException('A host name can use only letters, digits, hyphens and dots. Each part between dots must be 63 characters or less.');
    }

    // Compute FQDN, then refuse a name or FQDN another asset of the tenant already carries.
    const fqdn = await this.validation.computeFqdn(hostname, domain, tenant, opts?.manager);
    const manager = this.getManager(opts);
    await lockAssetNames(manager, tenant);
    await assertAssetNameFree(manager, tenant, name);
    await assertAssetFqdnFree(manager, tenant, fqdn);

    // Process aliases
    const aliases = this.validation.normalizeAliases((body as any).aliases);

    const entity = repo.create({
      name,
      environment,
      kind,
      provider,
      region: this.normalizeNullable(body.region),
      zone: this.normalizeNullable(body.zone),
      hostname,
      domain,
      admin_zone,
      fqdn,
      aliases,
      ip_addresses,
      cluster: this.normalizeNullable(body.cluster),
      is_cluster,
      status,
      go_live_date: this.normalizeNullable((body as any).go_live_date),
      end_of_life_date: this.normalizeNullable((body as any).end_of_life_date),
      location_id,
      sub_location_id,
      notes,
    });

    const saved = await repo.save(entity);
    await this.audit.log(
      { table: 'assets', recordId: saved.id, action: 'create', before: null, after: saved, userId, ...this.auditSource(opts) },
      { manager: opts?.manager },
    );
    if (setsOperatingSystem) {
      await this.applyOperatingSystem(tenant, saved.id, (body as any).operating_system, userId, opts);
    }
    return this.attachOperatingSystem(saved, tenant, opts);
  }

  /**
   * Update an existing asset.
   */
  async update(
    id: string,
    body: Partial<Asset>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const repo = this.getRepo(opts?.manager);

    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');

    const existing = await this.ensureAsset(id, opts?.manager, tenant);

    const before = { ...existing };
    const has = (key: keyof Asset | string) => Object.prototype.hasOwnProperty.call(body, key);

    let nameToCheck: string | null = null;
    if (has('name')) {
      const name = this.normalizeNullable(body.name);
      if (!name) throw new BadRequestException('name is required');
      if (assetNameKey(name) !== assetNameKey(existing.name)) nameToCheck = name;
      existing.name = name;
    }
    if (has('environment')) {
      existing.environment = this.normalizeEnvironment((body as any).environment);
    }
    if (has('kind')) {
      existing.kind = await this.validation.resolveKind((body as any).kind, tenant, opts?.manager);
    }
    if (has('provider')) {
      existing.provider = await this.validation.resolveProvider((body as any).provider, tenant, opts?.manager);
    }
    if (has('region')) {
      existing.region = this.normalizeNullable((body as any).region);
    }
    if (has('zone')) {
      existing.zone = this.normalizeNullable((body as any).zone);
    }

    // Handle domain, hostname, aliases, and FQDN together
    if (has('domain')) {
      existing.domain = await this.validation.resolveDomain((body as any).domain, tenant, opts?.manager);
    }
    if (has('admin_zone')) {
      existing.admin_zone = await this.validation.resolveAdminZone((body as any).admin_zone, tenant, opts?.manager);
    }
    if (has('hostname')) {
      existing.hostname = this.normalizeNullable((body as any).hostname);
    }
    if (has('aliases')) {
      existing.aliases = this.validation.normalizeAliases((body as any).aliases);
    }

    // If hostname or domain changed, recompute FQDN and validate
    if (has('hostname') || has('domain')) {
      const newHostname = existing.hostname;
      const newDomain = existing.domain;

      if (newDomain && newDomain !== 'workgroup' && newDomain !== 'n-a') {
        if (!newHostname) {
          throw new BadRequestException('Hostname is required when a domain is selected');
        }
      }
      if (newHostname && !this.validation.validateHostname(newHostname)) {
        throw new BadRequestException('A host name can use only letters, digits, hyphens and dots. Each part between dots must be 63 characters or less.');
      }
      existing.fqdn = await this.validation.computeFqdn(newHostname, newDomain, tenant, opts?.manager);
    }

    // A duplicate that already exists stays editable until its name or FQDN actually changes.
    const fqdnToCheck = has('hostname') || has('domain')
      ? (existing.fqdn && assetNameKey(existing.fqdn) !== assetNameKey(before.fqdn) ? existing.fqdn : null)
      : null;
    if (nameToCheck || fqdnToCheck) {
      const manager = this.getManager(opts);
      await lockAssetNames(manager, tenant);
      if (nameToCheck) await assertAssetNameFree(manager, tenant, nameToCheck, existing.id);
      if (fqdnToCheck) await assertAssetFqdnFree(manager, tenant, fqdnToCheck, existing.id);
    }

    if (has('ip_addresses')) {
      existing.ip_addresses = await this.validation.validateIpAddresses((body as any).ip_addresses, tenant, this.getManager(opts), existing.id);
    }
    if (has('notes')) {
      existing.notes = this.normalizeNullable((body as any).notes);
    }
    if (has('cluster')) {
      existing.cluster = this.normalizeNullable((body as any).cluster);
    }
    if (has('is_cluster')) {
      const isCluster = this.normalizeBooleanFlag((body as any).is_cluster, 'is_cluster');
      if (isCluster !== Boolean(existing.is_cluster)) {
        await this.assertClusterSwitch(tenant, existing.id, isCluster, opts);
      }
      existing.is_cluster = isCluster;
    }
    if (has('status')) {
      existing.status = await this.validation.normalizeLifecycleStatus(
        (body as any).status,
        tenant,
        opts?.manager,
        existing.status,
      );
    }
    if (has('location_id')) {
      const newLocationId = await this.resolveLocationId((body as any).location_id, tenant, opts?.manager);
      if (!newLocationId) throw locationRequired();
      const locationChanged = newLocationId !== existing.location_id;
      existing.location_id = newLocationId;

      if (locationChanged) {
        // Location changed: resolve explicit sub_location_id against new location, or clear it
        if (has('sub_location_id')) {
          existing.sub_location_id = await this.resolveSubLocationId((body as any).sub_location_id, newLocationId, tenant, opts?.manager);
        } else {
          existing.sub_location_id = null;
        }
        // The screen deduces the provider from the new site, unless this request names one.
        if (!has('provider') && newLocationId) {
          const provider = await this.validation.providerForSite(newLocationId, tenant, this.getManager(opts));
          if (provider) existing.provider = provider;
        }
      } else if (has('sub_location_id')) {
        // Location same: just resolve sub_location_id against current location
        existing.sub_location_id = await this.resolveSubLocationId((body as any).sub_location_id, newLocationId, tenant, opts?.manager);
      }
    } else if (has('sub_location_id')) {
      // Location unchanged: validate sub_location_id against current location
      existing.sub_location_id = await this.resolveSubLocationId((body as any).sub_location_id, existing.location_id, tenant, opts?.manager);
    }
    if (has('go_live_date')) {
      existing.go_live_date = this.normalizeNullable((body as any).go_live_date);
    }
    if (has('end_of_life_date')) {
      existing.end_of_life_date = this.normalizeNullable((body as any).end_of_life_date);
    }

    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'assets', recordId: saved.id, action: 'update', before, after: saved, userId, ...this.auditSource(opts) },
      { manager: opts?.manager },
    );
    // Retired or back in service: its technologies are matched again with the vulnerabilities.
    if (before.status !== saved.status) await this.cpeEvents?.emitForSubjects(opts?.manager ?? repo.manager, tenant, 'asset', [saved.id]);
    if (has('operating_system')) {
      await this.applyOperatingSystem(tenant, saved.id, (body as any).operating_system, userId, opts);
    }
    return this.attachOperatingSystem(saved, tenant, opts);
  }

  /**
   * The Cluster switch of an existing asset, under the lock of its row: a cluster with members
   * stays a cluster, a member of a cluster stays a plain asset (`asset-rules.ts`). The operating
   * system is left as it is. A new asset is a member of nothing, so `create` needs no check.
   */
  private async assertClusterSwitch(tenantId: string, assetId: string, to: boolean, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    // The tenant row before the asset row, as every asset writer takes them (`lockAssetNames`, the
    // import, `getSettingsForWrite`): a later settings read of this update never waits behind it.
    await mg.query('SELECT 1 FROM tenants WHERE id = $1 FOR SHARE', [tenantId]);
    const [locked]: Array<{ is_cluster: boolean }> = await mg.query(
      `SELECT COALESCE(is_cluster, false) AS is_cluster FROM assets WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, assetId],
    );
    const from = locked?.is_cluster === true;
    const refusal = (await clusterSwitchRefusals(mg, tenantId, [{ id: assetId, from, to }])).get(assetId);
    if (refusal) throw refusal;
  }

  // =========================================================================
  // Cluster Operations
  // =========================================================================

  async listClusterMembers(clusterId: string, opts?: ServiceOpts) {
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAssetIsCluster(clusterId, opts?.manager, tenantId);
    const mg = this.getManager(opts);

    const rows: Array<{
      asset_id: string;
      name: string;
      environment: string;
      status: string;
      kind: string;
      provider: string;
      location_id: string | null;
      location_name: string | null;
      location_reference: string | null;
      operating_system: string | null;
    }> = await mg.query(
      `SELECT acm.asset_id, a.name, a.environment, a.status, a.location_id,
              a.kind, a.provider, ${operatingSystemLabelSql('a')} AS operating_system,
              l.name AS location_name, l.location_reference AS location_reference
       FROM asset_cluster_members acm
       JOIN assets a ON a.id = acm.asset_id
       LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = $2
       WHERE acm.cluster_id = $1 AND acm.tenant_id = $2 AND a.tenant_id = $2
       ORDER BY a.name ASC`,
      [clusterId, tenantId],
    );

    const items = rows.map((row) => ({
      id: row.asset_id,
      name: row.name,
      environment: row.environment,
      status: row.status,
      kind: row.kind,
      provider: row.provider,
      location_id: row.location_id,
      location: row.location_reference && row.location_name
        ? `${row.location_reference} · ${row.location_name}`
        : row.location_name || row.location_reference || null,
      operating_system: row.operating_system || null,
    }));
    return { items };
  }

  async listClustersForAsset(assetId: string, opts?: ServiceOpts) {
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, opts?.manager, tenantId);
    const mg = this.getManager(opts);

    const rows: Array<{ id: string; name: string; environment: string; status: string }> = await mg.query(
      `SELECT acm.cluster_id AS id, c.name, c.environment, c.status
       FROM asset_cluster_members acm
       JOIN assets c ON c.id = acm.cluster_id
       WHERE acm.asset_id = $1 AND acm.tenant_id = $2 AND c.tenant_id = $2
       ORDER BY c.name ASC`,
      [assetId, tenantId],
    );
    return { items: rows };
  }

  /**
   * Replace the members of a cluster. Refusals are coded (`errors:<code>`):
   * `cluster_member_self`, `cluster_member_not_found`, `cluster_member_is_cluster` (`name`), and
   * `cluster_os_with_members` (`os`) when a cluster that carries an operating system gets members.
   * With `removeOperatingSystem`, that operating system is removed instead, in the same
   * transaction as the members (`OperatingSystemService.setOperatingSystem`, its own audit).
   */
  async replaceClusterMembers(
    clusterId: string,
    assetIds: unknown,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
    options?: { removeOperatingSystem?: unknown },
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = this.getManager(opts);
    const removeFlag = options?.removeOperatingSystem;
    if (removeFlag !== undefined && removeFlag !== null && typeof removeFlag !== 'boolean') {
      throw new BadRequestException('remove_operating_system must be a boolean');
    }
    const removeOperatingSystem = removeFlag === true;
    const cluster = await this.ensureAssetIsCluster(clusterId, mg, tenant);
    if (!Array.isArray(assetIds)) {
      throw new BadRequestException('asset_ids must be an array');
    }

    const normalizedIds = Array.from(
      new Set(
        (assetIds as unknown[])
          .map((sid) => String(sid || '').trim().toLowerCase())
          .filter((sid) => sid.length > 0),
      ),
    );

    await assertClusterMemberCandidates(mg, tenant, cluster.id, normalizedIds);

    await mg.transaction(async (trx) => {
      // The cluster row first: a concurrent switch or operating-system write waits for this one.
      // The row read before the transaction may have changed meanwhile: decide on the locked one.
      const locked = await lockClusterForMembers(trx, tenant, clusterId);
      if (!locked) throw new NotFoundException('Asset not found');
      if (!locked.isCluster) throw new BadRequestException('Asset is not a cluster');
      if (normalizedIds.length > 0) {
        const os = locked.os;
        if (os && !removeOperatingSystem) throw clusterOsWithMembersRefusal(os);
        if (os) {
          await this.operatingSystems.setOperatingSystem(trx, tenant, clusterId, null, this.osSource(opts), userId);
        }
      }

      const repo = this.getClusterMemberRepo(trx);
      const existing = await repo.find({ where: { tenant_id: tenant, cluster_id: clusterId } as any });
      const existingMembers = existing.map((row) => row.asset_id);
      await repo.delete({ tenant_id: tenant, cluster_id: clusterId } as any);
      if (normalizedIds.length > 0) {
        const payload = normalizedIds.map((sid) =>
          repo.create({
            cluster_id: clusterId,
            asset_id: sid,
            tenant_id: tenant,
            created_at: new Date(),
            updated_at: new Date(),
          }),
        );
        await repo.save(payload);
      }
      await this.getRepo(trx).update({ id: clusterId, tenant_id: tenant } as any, { updated_at: new Date() } as any);

      await this.audit.log(
        {
          table: 'asset_cluster_members',
          recordId: clusterId,
          action: 'update',
          before: { members: existingMembers },
          after: { members: normalizedIds },
          userId,
        },
        { manager: trx },
      );
    });

    return this.listClusterMembers(clusterId, { manager: mg, tenantId: tenant });
  }
}
