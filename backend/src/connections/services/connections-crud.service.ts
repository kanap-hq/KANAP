import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Connection } from '../connection.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { Asset } from '../../assets/asset.entity';
import { AuditService } from '../../audit/audit.service';
import { BulkDeleteResult } from '../../common/delete.types';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { ConnectionsBaseService, ServiceOpts, Topology } from './connections-base.service';
import {
  AbsorbedServer,
  absorbClusterMembers,
  connectionSameEndpointRefusal,
} from '../connection-cluster-rules';

/**
 * Service for core CRUD operations on connections.
 */
@Injectable()
export class ConnectionsCrudService extends ConnectionsBaseService {
  constructor(
    @InjectRepository(Connection) connRepo: Repository<Connection>,
    @InjectRepository(ConnectionServer) connServers: Repository<ConnectionServer>,
    @InjectRepository(ConnectionProtocol) connProtocols: Repository<ConnectionProtocol>,
    @InjectRepository(ConnectionLeg) connLegs: Repository<ConnectionLeg>,
    @InjectRepository(Asset) assets: Repository<Asset>,
    itOpsSettings: ItOpsSettingsService,
    private readonly audit: AuditService,
  ) {
    super(connRepo, connServers, connProtocols, connLegs, assets, itOpsSettings);
  }

  /**
   * Get a single connection by ID with full details.
   */
  async get(id: string, tenantId: string, opts?: ServiceOpts & { includeLegs?: boolean }) {
    const tenant = this.ensureTenantId(tenantId);
    const repo = this.getRepo(opts?.manager);
    const resolvedId = await this.resolveConnectionIdentifier(id, tenant, opts?.manager);
    const conn = await repo.findOne({ where: { id: resolvedId, tenant_id: tenant } as any });
    if (!conn) throw new NotFoundException('Connection not found');

    const mg = opts?.manager ?? repo.manager;
    const includeLegs = !!opts?.includeLegs;
    const protocols: Array<{ connection_type_code: string; port_override: string | null }> =
      await this.getConnProtocolRepo(mg).find({
        where: { connection_id: resolvedId },
      });
    const servers = await this.getConnServerRepo(mg).find({ where: { connection_id: resolvedId } });
    const legs = includeLegs
      ? await this.getLegRepo(mg).find({
          where: { connection_id: resolvedId, tenant_id: tenant } as any,
          order: { order_index: 'ASC', created_at: 'ASC' },
        })
      : [];

    const assetIds: string[] = [];
    if (conn.source_asset_id) assetIds.push(conn.source_asset_id);
    if (conn.destination_asset_id) assetIds.push(conn.destination_asset_id);
    for (const s of servers) assetIds.push(s.asset_id);
    for (const leg of legs) {
      if (leg.equipment_asset_id) assetIds.push(leg.equipment_asset_id);
    }
    const uniqueAssetIds = Array.from(new Set(assetIds));
    let assetMap = new Map<string, any>();
    if (uniqueAssetIds.length > 0) {
      const rows = await mg
        .createQueryBuilder()
        .select('a')
        .from(Asset, 'a')
        .where('a.id IN (:...ids)', { ids: uniqueAssetIds })
        .getMany();
      assetMap = new Map(rows.map((r) => [r.id, r]));
    }
    const riskBases = [
      {
        id: conn.id,
        risk_mode: ((conn.risk_mode as any) || 'manual') as 'manual' | 'derived',
        criticality: conn.criticality,
        data_class: conn.data_class,
        contains_pii: conn.contains_pii,
      },
    ];
    const effectiveRiskMap = await this.computeEffectiveRiskForConnections(tenant, riskBases, mg);
    const effective = effectiveRiskMap.get(conn.id);

    return {
      ...conn,
      // Backwards compatibility aliases
      source_server_id: conn.source_asset_id,
      destination_server_id: conn.destination_asset_id,
      effective_criticality: effective ? effective.effective_criticality : conn.criticality,
      effective_data_class: effective ? effective.effective_data_class : conn.data_class,
      effective_contains_pii: effective?.effective_contains_pii ?? conn.contains_pii,
      derived_interface_count: effective?.derived_interface_count ?? 0,
      classification_incomplete: effective?.classification_incomplete ?? false,
      protocol_codes: protocols.map((p) => p.connection_type_code),
      protocols: protocols.map((p) => ({
        code: p.connection_type_code,
        port_override: p.port_override ?? null,
      })),
      servers: servers.map((row) => {
        const a = assetMap.get(row.asset_id);
        return a
          ? {
              id: a.id,
              name: a.name,
              environment: (a as any).environment,
              kind: (a as any).kind,
              provider: (a as any).provider,
              is_cluster: !!(a as any).is_cluster,
            }
          : null;
      }).filter(Boolean),
      source_server: conn.source_asset_id
        ? (() => {
            const a = assetMap.get(conn.source_asset_id);
            return a
              ? {
                  id: a.id,
                  name: a.name,
                  environment: (a as any).environment,
                  kind: (a as any).kind,
                  provider: (a as any).provider,
                  is_cluster: !!(a as any).is_cluster,
                }
              : null;
          })()
        : null,
      destination_server: conn.destination_asset_id
        ? (() => {
            const a = assetMap.get(conn.destination_asset_id);
            return a
              ? {
                  id: a.id,
                  name: a.name,
                  environment: (a as any).environment,
                  kind: (a as any).kind,
                  provider: (a as any).provider,
                  is_cluster: !!(a as any).is_cluster,
                }
              : null;
          })()
        : null,
      legs: includeLegs ? legs : undefined,
    };
  }

  /**
   * Create a new connection.
   */
  async create(body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = opts?.manager ?? this.connRepo.manager;
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');

    const name = this.normalizeRequiredText(body.name, 'name');
    const description = this.normalizeNullable(body.description);
    const topology = body.topology ? this.normalizeTopology(body.topology) : 'server_to_server';
    const lifecycle = await this.normalizeLifecycle(body.lifecycle, tenant, mg, 'active');
    const protocols = await this.normalizeProtocols(body.protocols ?? body.protocol_codes, tenant, mg);
    const criticality = await this.normalizeCriticality(body.criticality ?? null, tenant, mg);
    const data_class = await this.normalizeDataClass(body.data_class ?? null, tenant, mg);
    const contains_pii = this.normalizeContainsPii(body.contains_pii);
    const risk_mode = this.normalizeRiskMode(body.risk_mode);
    if (risk_mode === 'derived') {
      throw new BadRequestException('Cannot set risk_mode to "derived" when creating a connection without linked interfaces');
    }

    let source_asset_id: string | null = null;
    let source_entity_code: string | null = null;
    let destination_asset_id: string | null = null;
    let destination_entity_code: string | null = null;
    let multiAssetIds: string[] = [];
    let absorbed: AbsorbedServer[] = [];

    if (topology === 'server_to_server') {
      const normalizeSide = async (
        assetId: unknown,
        entityCode: unknown,
        label: 'source' | 'destination',
      ) => {
        const aid = this.normalizeNullable(assetId);
        const eidRaw = this.normalizeNullable(entityCode);
        const eid = eidRaw ? eidRaw.toLowerCase() : null;
        if (aid && eid) throw new BadRequestException(`${label}: choose either asset or entity, not both`);
        if (!aid && !eid) throw new BadRequestException(`${label}: select an asset or an entity`);
        if (aid) {
          await this.ensureAsset(aid, tenant, mg);
          return { asset: aid, entity: null };
        }
        await this.validateEntityCode(eid as string, tenant, mg);
        return { asset: null, entity: eid };
      };
      // Accept both asset_id and server_id for backwards compatibility
      const src = await normalizeSide(body.source_asset_id ?? body.source_server_id, body.source_entity_code, 'source');
      const dst = await normalizeSide(body.destination_asset_id ?? body.destination_server_id, body.destination_entity_code, 'destination');
      if (src.asset && src.asset === dst.asset) throw connectionSameEndpointRefusal();
      source_asset_id = src.asset;
      source_entity_code = src.entity;
      destination_asset_id = dst.asset;
      destination_entity_code = dst.entity;
    } else {
      const assetsInput = Array.isArray(body.servers) ? body.servers : [];
      const normalizedIds: string[] = Array.from(
        new Set(
          (assetsInput as unknown[])
            .map((v) => this.normalizeNullable(v))
            .filter((v): v is string => !!v),
        ),
      );
      for (const aid of normalizedIds) {
        await this.ensureAsset(aid, tenant, mg);
      }
      const { kept, absorbed: listAbsorbed } = await absorbClusterMembers(mg, tenant, normalizedIds);
      if (kept.length < 2) {
        throw new BadRequestException('Select at least two assets for a multi-server connection');
      }
      multiAssetIds = kept;
      absorbed = listAbsorbed;
    }

    const repo = this.getRepo(mg);
    const entity = repo.create({
      tenant_id: tenant,
      name,
      description,
      topology,
      source_asset_id,
      source_entity_code,
      destination_asset_id,
      destination_entity_code,
      lifecycle,
      criticality,
      data_class,
      contains_pii,
      risk_mode,
    });
    const saved = await repo.save(entity);

    const protoRepo = this.getConnProtocolRepo(mg);
    for (const proto of protocols) {
      const cp = protoRepo.create({
        tenant_id: tenant,
        connection_id: saved.id,
        connection_type_code: proto.code,
        port_override: proto.port_override,
      });
      await protoRepo.save(cp);
    }

    if (topology === 'multi_server') {
      const csRepo = this.getConnServerRepo(mg);
      for (const aid of multiAssetIds) {
        const cs = csRepo.create({
          tenant_id: tenant,
          connection_id: saved.id,
          asset_id: aid,
        });
        await csRepo.save(cs);
      }
    }

    await this.audit.log(
      { table: 'connections', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );

    return { ...saved, absorbed };
  }

  /**
   * Update an existing connection.
   */
  async update(id: string, body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = opts?.manager ?? this.connRepo.manager;
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');

    const repo = this.getRepo(mg);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Connection not found');
    const before = { ...existing };

    const topology = body.topology ? this.normalizeTopology(body.topology) : (existing.topology as Topology);
    const name = body.name ? this.normalizeRequiredText(body.name, 'name') : existing.name;
    const description = body.hasOwnProperty('description') ? this.normalizeNullable(body.description) : existing.description;
    const lifecycle = await this.normalizeLifecycle(
      body.hasOwnProperty('lifecycle') ? body.lifecycle : existing.lifecycle,
      tenant,
      mg,
      existing.lifecycle,
    );
    const criticality = body.hasOwnProperty('criticality')
      ? await this.normalizeCriticality(body.criticality, tenant, mg, existing.criticality)
      : existing.criticality;
    const data_class = body.hasOwnProperty('data_class')
      ? await this.normalizeDataClass(body.data_class, tenant, mg, existing.data_class)
      : existing.data_class;
    const contains_pii = body.hasOwnProperty('contains_pii')
      ? this.normalizeContainsPii(body.contains_pii)
      : existing.contains_pii ?? false;
    const risk_mode = body.hasOwnProperty('risk_mode')
      ? this.normalizeRiskMode(body.risk_mode)
      : (existing.risk_mode as 'manual' | 'derived') || 'manual';
    if (risk_mode === 'derived') {
      const rows: Array<{ c: string }> = await mg.query(
        `SELECT COUNT(*)::text AS c FROM interface_connection_links WHERE connection_id = $1`,
        [id],
      );
      const linkCount = Number(rows[0]?.c || '0');
      if (linkCount === 0) {
        throw new BadRequestException(
          'Cannot set risk_mode to "derived" when no interface bindings are linked to this connection',
        );
      }
    }

    // Load existing protocols to compute next set
    const protoRepo = this.getConnProtocolRepo(mg);
    const existingProtocols = await protoRepo.find({ where: { connection_id: id } });
    const existingPortByCode = new Map(
      existingProtocols.map((p) => [p.connection_type_code, p.port_override ?? null]),
    );
    let nextProtocols: Array<{ code: string; port_override: string | null }>;
    if (body.hasOwnProperty('protocols')) {
      // Rich form: explicit per-protocol port overrides from the Overview tab.
      nextProtocols = await this.normalizeProtocols(body.protocols, tenant, mg);
    } else if (body.hasOwnProperty('protocol_codes')) {
      // Legacy code-only form (metadata bar add/remove): preserve existing
      // per-protocol overrides for codes that survive the change.
      const codes = await this.normalizeProtocolCodes(body.protocol_codes, tenant, mg);
      nextProtocols = codes.map((code) => ({
        code,
        port_override: existingPortByCode.get(code) ?? null,
      }));
    } else {
      nextProtocols = existingProtocols.map((p) => ({
        code: p.connection_type_code,
        port_override: p.port_override ?? null,
      }));
    }
    if (nextProtocols.length === 0) {
      throw new BadRequestException('At least one protocol is required');
    }

    let source_asset_id = existing.source_asset_id;
    let source_entity_code = existing.source_entity_code;
    let destination_asset_id = existing.destination_asset_id;
    let destination_entity_code = existing.destination_entity_code;
    let multiAssetIds: string[] | null = null;
    let absorbed: AbsorbedServer[] = [];

    if (topology === 'server_to_server') {
      const normalizeSide = async (
        assetId: unknown,
        entityCode: unknown,
        fallbackAsset: string | null,
        fallbackEntity: string | null,
        label: 'source' | 'destination',
      ) => {
        const hasAsset = assetId !== undefined;
        const hasEntity = entityCode !== undefined;
        const candidateAsset = hasAsset ? this.normalizeNullable(assetId) : fallbackAsset;
        const candidateEntity = hasEntity ? this.normalizeNullable(entityCode)?.toLowerCase() ?? null : fallbackEntity;
        if (candidateAsset && candidateEntity) throw new BadRequestException(`${label}: choose either asset or entity, not both`);
        if (!candidateAsset && !candidateEntity) throw new BadRequestException(`${label}: select an asset or an entity`);
        if (candidateAsset) {
          await this.ensureAsset(candidateAsset, tenant, mg);
          return { asset: candidateAsset, entity: null };
        }
        await this.validateEntityCode(candidateEntity as string, tenant, mg);
        return { asset: null, entity: candidateEntity };
      };
      // Accept both asset_id and server_id for backwards compatibility
      const src = await normalizeSide(
        body.source_asset_id ?? body.source_server_id,
        body.source_entity_code,
        source_asset_id,
        source_entity_code,
        'source'
      );
      const dst = await normalizeSide(
        body.destination_asset_id ?? body.destination_server_id,
        body.destination_entity_code,
        destination_asset_id,
        destination_entity_code,
        'destination',
      );
      // An existing loop can still be renamed, but touching a side may not keep it looped.
      const sameEndpoint = !!src.asset && src.asset === dst.asset;
      const unchanged =
        existing.source_asset_id === src.asset && existing.destination_asset_id === dst.asset;
      if (sameEndpoint && !unchanged) throw connectionSameEndpointRefusal();
      source_asset_id = src.asset;
      source_entity_code = src.entity;
      destination_asset_id = dst.asset;
      destination_entity_code = dst.entity;
      multiAssetIds = [];
    } else {
      const assetsInput = body.hasOwnProperty('servers') ? body.servers : null;
      const normalizedIds: string[] | null = assetsInput == null
        ? null
        : Array.from(
            new Set(
              ((Array.isArray(assetsInput) ? assetsInput : []) as unknown[])
                .map((v) => this.normalizeNullable(v))
                .filter((v): v is string => !!v),
            ),
          );
      if (normalizedIds !== null) {
        for (const aid of normalizedIds) {
          await this.ensureAsset(aid, tenant, mg);
        }
        const { kept, absorbed: listAbsorbed } = await absorbClusterMembers(mg, tenant, normalizedIds);
        if (kept.length < 2) {
          throw new BadRequestException('Select at least two assets for a multi-server connection');
        }
        multiAssetIds = kept;
        absorbed = listAbsorbed;
      } else {
        // Keep current multi-server list; load it
        const existingServers = await this.getConnServerRepo(mg).find({ where: { connection_id: id } });
        multiAssetIds = existingServers.map((cs) => cs.asset_id);
        if (multiAssetIds.length < 2) {
          throw new BadRequestException('Select at least two assets for a multi-server connection');
        }
      }
      // Clear S2S fields
      source_asset_id = null;
      source_entity_code = null;
      destination_asset_id = null;
      destination_entity_code = null;
    }

    existing.name = name;
    existing.description = description;
    existing.topology = topology;
    existing.source_asset_id = source_asset_id;
    existing.source_entity_code = source_entity_code;
    existing.destination_asset_id = destination_asset_id;
    existing.destination_entity_code = destination_entity_code;
    existing.lifecycle = lifecycle;
    existing.criticality = criticality;
    existing.data_class = data_class;
    existing.contains_pii = contains_pii;
    existing.risk_mode = risk_mode;
    existing.updated_at = new Date();

    const saved = await repo.save(existing);

    // Replace protocols
    await protoRepo.delete({ connection_id: id } as any);
    for (const proto of nextProtocols) {
      const cp = protoRepo.create({
        tenant_id: tenant,
        connection_id: id,
        connection_type_code: proto.code,
        port_override: proto.port_override,
      });
      await protoRepo.save(cp);
    }

    // Replace multi-server rows if applicable
    if (topology === 'multi_server' && multiAssetIds) {
      const csRepo = this.getConnServerRepo(mg);
      await csRepo.delete({ connection_id: id } as any);
      for (const aid of multiAssetIds) {
        const cs = csRepo.create({
          tenant_id: tenant,
          connection_id: id,
          asset_id: aid,
        });
        await csRepo.save(cs);
      }
    } else {
      // Clear any lingering multi-server rows when switching to S2S
      await this.getConnServerRepo(mg).delete({ connection_id: id } as any);
    }

    await this.audit.log(
      { table: 'connections', recordId: id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );

    // Return the enriched response so the frontend keeps protocol_codes, source_server,
    // effective_*, etc. without an extra round-trip.
    return { ...(await this.get(id, tenant, { manager: mg })), absorbed };
  }

  /**
   * Delete a connection.
   */
  async delete(id: string, userId: string | null, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.connRepo.manager;
    const repo = this.getRepo(mg);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Connection not found');
    await this.deleteLegsForConnection(id, { manager: mg });
    await repo.delete(id);
    await this.audit.log(
      { table: 'connections', recordId: id, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { success: true };
  }

  /**
   * Bulk delete connections.
   */
  /** The list's bulk delete: the ids deleted, as every bulk delete answers (`BulkDeleteResult`). */
  async bulkDelete(ids: string[], userId: string | null, opts?: ServiceOpts): Promise<BulkDeleteResult> {
    if (!Array.isArray(ids) || ids.length === 0) return { deleted: [], failed: [] };
    const mg = opts?.manager ?? this.connRepo.manager;
    const repo = this.getRepo(mg);
    const existing = await repo.find({ where: { id: In(ids) } });
    if (existing.length === 0) return { deleted: [], failed: [] };
    for (const row of existing) {
      await this.deleteLegsForConnection(row.id, { manager: mg });
    }
    await repo.delete(ids);
    for (const row of existing) {
      await this.audit.log(
        { table: 'connections', recordId: row.id, action: 'delete', before: row, after: null, userId },
        { manager: mg },
      );
    }
    return { deleted: existing.map((row) => row.id), failed: [] };
  }

  /**
   * Delete all legs for a connection (internal helper).
   */
  private async deleteLegsForConnection(connectionId: string, opts?: ServiceOpts) {
    const legRepo = this.getLegRepo(opts?.manager);
    await legRepo.delete({ connection_id: connectionId } as any);
  }
}
