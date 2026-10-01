import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { Connection } from '../connection.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { Asset } from '../../assets/asset.entity';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { resolveClassificationOption } from '../../it-ops-settings/classification-catalog';

/**
 * Topology types for connections.
 */
export type Topology = 'server_to_server' | 'multi_server';

/**
 * Connection criticality levels.
 */
/**
 * Environment values for connections.
 */
export const ENVIRONMENTS = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'] as const;
export type EnvironmentValue = (typeof ENVIRONMENTS)[number];

/**
 * Hop input type for connection path hops (network intermediaries).
 */
export type LegInput = {
  order_index: number;
  function_code: string | null;
  equipment_asset_id: string | null;
  equipment_entity_code: string | null;
  protocol_codes: string[];
  port_override: string | null;
  notes: string | null;
};

/**
 * Per connection with linked interfaces (connection link -> interface binding -> interface):
 * the highest criticality and data class among those interfaces by the tenant catalog's rank,
 * each axis on its own, whether any of them carries PII, and whether some value is missing
 * from the catalog. The ranking follows highestClassification: values outside the catalog do
 * not rank and mark the result incomplete. Every table is read in the given tenant only.
 * With `restrictToIds`, only the links of the `:erIds` connections are aggregated.
 */
function linkedInterfaceRiskSql(restrictToIds: boolean): string {
  return `
  SELECT l.connection_id,
         CAST(COUNT(DISTINCT i.id) AS int) AS interface_count,
         (ARRAY_AGG(cr.code ORDER BY cr.rank DESC) FILTER (WHERE cr.code IS NOT NULL))[1] AS criticality,
         (ARRAY_AGG(dc.code ORDER BY dc.rank DESC) FILTER (WHERE dc.code IS NOT NULL))[1] AS data_class,
         BOOL_OR(i.contains_pii) AS contains_pii,
         BOOL_OR(cr.code IS NULL OR dc.code IS NULL) AS incomplete
  FROM interface_connection_links l
  JOIN interface_bindings b ON b.id = l.interface_binding_id AND b.tenant_id = l.tenant_id
  JOIN interfaces i ON i.id = b.interface_id AND i.tenant_id = b.tenant_id
  LEFT JOIN UNNEST(CAST(:erCritCodes AS text[]), CAST(:erCritRanks AS float8[])) AS cr(code, rank) ON cr.code = i.criticality
  LEFT JOIN UNNEST(CAST(:erClassCodes AS text[]), CAST(:erClassRanks AS float8[])) AS dc(code, rank) ON dc.code = i.data_class
  WHERE l.tenant_id = :erTenant${restrictToIds ? '\n    AND l.connection_id = ANY(CAST(:erIds AS uuid[]))' : ''}
  GROUP BY l.connection_id
`.trim();
}

/**
 * Effective risk of a connection aliased `c` joined to `er` (joinEffectiveRisk). A derived
 * connection takes the values of its linked interfaces; with none linked, criticality and data
 * class are unknown (null) and PII keeps the stored flag. A manual connection keeps its values.
 * The list filters, sorts and pages on these, so the rows show what was filtered.
 */
export const EFFECTIVE_RISK = {
  criticality: `(CASE WHEN c.risk_mode = 'derived' THEN er.criticality ELSE c.criticality END)`,
  data_class: `(CASE WHEN c.risk_mode = 'derived' THEN er.data_class ELSE c.data_class END)`,
  contains_pii: `(CASE WHEN c.risk_mode = 'derived' AND er.connection_id IS NOT NULL THEN er.contains_pii ELSE c.contains_pii END)`,
  incomplete: `(CASE WHEN c.risk_mode = 'derived' THEN COALESCE(er.incomplete, true) ELSE false END)`,
  interface_count: `COALESCE(er.interface_count, 0)`,
} as const;

/** Catalog rank of an effective classification, for sorting by severity (null when not in the catalog). */
export const EFFECTIVE_RISK_RANK = {
  criticality: `(SELECT r.rank FROM UNNEST(CAST(:erCritCodes AS text[]), CAST(:erCritRanks AS float8[])) AS r(code, rank) WHERE r.code = ${EFFECTIVE_RISK.criticality})`,
  data_class: `(SELECT r.rank FROM UNNEST(CAST(:erClassCodes AS text[]), CAST(:erClassRanks AS float8[])) AS r(code, rank) WHERE r.code = ${EFFECTIVE_RISK.data_class})`,
} as const;

export type EffectiveRisk = {
  effective_criticality: string | null;
  effective_data_class: string | null;
  effective_contains_pii: boolean;
  derived_interface_count: number;
  classification_incomplete: boolean;
};

/** Adds the effective risk columns to a query built with joinEffectiveRisk. */
export function selectEffectiveRisk(qb: SelectQueryBuilder<Connection>): void {
  qb.addSelect(EFFECTIVE_RISK.criticality, 'effective_criticality')
    .addSelect(EFFECTIVE_RISK.data_class, 'effective_data_class')
    .addSelect(EFFECTIVE_RISK.contains_pii, 'effective_contains_pii')
    .addSelect(EFFECTIVE_RISK.interface_count, 'derived_interface_count')
    .addSelect(EFFECTIVE_RISK.incomplete, 'classification_incomplete');
}

/** Reads the columns added by selectEffectiveRisk from a raw row. */
export function readEffectiveRisk(row: Record<string, any>): EffectiveRisk {
  return {
    effective_criticality: row.effective_criticality ?? null,
    effective_data_class: row.effective_data_class ?? null,
    effective_contains_pii: row.effective_contains_pii === true,
    derived_interface_count: Number(row.derived_interface_count) || 0,
    classification_incomplete: row.classification_incomplete === true,
  };
}

/**
 * Common options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
}

/**
 * Base class with shared utilities for connection services.
 */
export abstract class ConnectionsBaseService {
  constructor(
    protected readonly connRepo: Repository<Connection>,
    protected readonly connServers: Repository<ConnectionServer>,
    protected readonly connProtocols: Repository<ConnectionProtocol>,
    protected readonly connLegs: Repository<ConnectionLeg>,
    protected readonly assets: Repository<Asset>,
    protected readonly itOpsSettings: ItOpsSettingsService,
  ) {}

  protected getRepo(manager?: EntityManager): Repository<Connection> {
    return manager ? manager.getRepository(Connection) : this.connRepo;
  }

  protected getAssetRepo(manager?: EntityManager): Repository<Asset> {
    return manager ? manager.getRepository(Asset) : this.assets;
  }

  protected getConnServerRepo(manager?: EntityManager): Repository<ConnectionServer> {
    return manager ? manager.getRepository(ConnectionServer) : this.connServers;
  }

  protected getConnProtocolRepo(manager?: EntityManager): Repository<ConnectionProtocol> {
    return manager ? manager.getRepository(ConnectionProtocol) : this.connProtocols;
  }

  protected getLegRepo(manager?: EntityManager): Repository<ConnectionLeg> {
    return manager ? manager.getRepository(ConnectionLeg) : this.connLegs;
  }

  protected getManager(opts?: ServiceOpts): EntityManager {
    return opts?.manager ?? this.connRepo.manager;
  }

  protected ensureTenantId(tenantId?: string): string {
    const normalized = String(tenantId || '').trim();
    if (!normalized) throw new BadRequestException('Tenant context is required');
    return normalized;
  }

  protected normalizeTopology(value: unknown): Topology {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'server_to_server' || v === 'server-to-server') return 'server_to_server';
    if (v === 'multi_server' || v === 'multi-server') return 'multi_server';
    throw new BadRequestException('Invalid topology');
  }

  protected normalizeRequiredText(value: unknown, label: string): string {
    const v = String(value ?? '').trim();
    if (!v) throw new BadRequestException(`${label} is required`);
    return v;
  }

  protected normalizeNullable(value: unknown): string | null {
    if (value == null) return null;
    const v = String(value).trim();
    return v.length === 0 ? null : v;
  }

  protected async resolveConnectionIdentifier(
    identifier: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const tenant = this.ensureTenantId(tenantId);
    const normalized = String(identifier || '').trim();
    if (!normalized) throw new NotFoundException('Connection not found');

    const uuidMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
    const referenceMatch = normalized.match(/^(CONN-\d+)(?:-.+)?$/i);
    if (!uuidMatch && !referenceMatch) {
      throw new NotFoundException('Connection not found');
    }

    const mg = manager ?? this.connRepo.manager;
    const lookupValue = uuidMatch ? normalized : referenceMatch?.[1] || normalized;
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT id::text AS id
       FROM connections
       WHERE ${uuidMatch ? 'id = $1' : 'upper(connection_reference) = upper($1)'}
         AND tenant_id = $2
       LIMIT 1`,
      [lookupValue, tenant],
    );
    const id = rows[0]?.id;
    if (!id) throw new NotFoundException('Connection not found');
    return id;
  }

  protected async normalizeLifecycle(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    fallback: string = 'active',
  ): Promise<string> {
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = (settings.lifecycleStates || []).map((item) => item.code);
    const normalized = String(value ?? '').trim().toLowerCase();
    const fallbackCode = allowed.includes(fallback) ? fallback : allowed[0] || 'active';
    if (!normalized) return fallbackCode;
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`Invalid lifecycle "${value}"`);
    }
    return normalized;
  }

  protected normalizeEnvironment(value: unknown): EnvironmentValue {
    const normalized = String(value ?? '').trim().toLowerCase() || 'prod';
    if (!ENVIRONMENTS.includes(normalized as EnvironmentValue)) {
      throw new BadRequestException(`Invalid environment "${value}"`);
    }
    return normalized as EnvironmentValue;
  }

  protected normalizeLifecycleFilters(value: unknown, allowed: string[]): string[] {
    const items: string[] = Array.isArray(value)
      ? (value as any[]).map((v) => String(v ?? ''))
      : typeof value === 'string'
        ? String(value)
            .split(',')
            .map((v) => v.trim())
        : [];
    const normalized = items
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item) => allowed.includes(item));
    if (normalized.length > 0) return Array.from(new Set(normalized));
    if (allowed.includes('active')) return ['active'];
    return allowed.length > 0 ? [allowed[0]] : ['active'];
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

  protected normalizeContainsPii(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || String(value).trim() === '') return false;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return Boolean(value);
  }

  protected normalizeRiskMode(value: unknown): 'manual' | 'derived' {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return 'manual';
    if (normalized === 'manual' || normalized === 'derived') return normalized;
    throw new BadRequestException(`Invalid risk_mode "${value}"`);
  }

  protected async ensureAsset(id: string, tenantId: string, manager?: EntityManager) {
    const repo = this.getAssetRepo(manager);
    const asset = await repo.findOne({ where: { id } });
    if (!asset) throw new BadRequestException('Asset not found');
    return asset;
  }

  protected async ensureConnection(id: string, manager?: EntityManager): Promise<Connection> {
    const repo = this.getRepo(manager);
    const conn = await repo.findOne({ where: { id } });
    if (!conn) throw new NotFoundException('Connection not found');
    return conn;
  }

  protected async validateEntityCode(code: string, tenantId: string, manager?: EntityManager) {
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.entities || []).map((e) => e.code));
    if (!allowed.has(code)) {
      throw new BadRequestException(`Invalid entity "${code}"`);
    }
  }

  protected async normalizeProtocolCodes(
    codes: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string[]> {
    const arr = Array.isArray(codes) ? codes : [];
    const list = arr.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean);
    if (list.length === 0) {
      throw new BadRequestException('At least one protocol is required');
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.connectionTypes || []).map((o) => o.code));
    for (const code of list) {
      if (!allowed.has(code)) {
        throw new BadRequestException(`Invalid protocol "${code}"`);
      }
    }
    return Array.from(new Set(list));
  }

  /**
   * Normalize connection-level protocols with their optional per-protocol port
   * override. Accepts either the rich form (`[{ code, port_override }]`) or the
   * legacy code-only form (`['https', 'ssh']`, override defaults to null).
   * Deduplicates by code (last occurrence wins for the override) and validates
   * each code against the tenant's configured connection types.
   */
  protected async normalizeProtocols(
    input: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Array<{ code: string; port_override: string | null }>> {
    const arr = Array.isArray(input) ? input : [];
    const byCode = new Map<string, string | null>();
    for (const item of arr) {
      let code: string;
      let portOverride: string | null;
      if (item && typeof item === 'object') {
        code = String((item as any).code ?? (item as any).connection_type_code ?? '')
          .trim()
          .toLowerCase();
        portOverride = this.normalizeNullable((item as any).port_override);
      } else {
        code = String(item ?? '').trim().toLowerCase();
        portOverride = null;
      }
      if (!code) continue;
      byCode.set(code, portOverride);
    }
    if (byCode.size === 0) {
      throw new BadRequestException('At least one protocol is required');
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.connectionTypes || []).map((o) => o.code));
    for (const code of byCode.keys()) {
      if (!allowed.has(code)) {
        throw new BadRequestException(`Invalid protocol "${code}"`);
      }
    }
    return Array.from(byCode.entries()).map(([code, port_override]) => ({ code, port_override }));
  }

  /**
   * Validate a hop's network function code against the tenant's configured
   * path-hop functions. Accepts null (unclassified hop).
   */
  protected async normalizeHopFunctionCode(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    if (value == null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.pathHopFunctions || []).map((o: any) => String(o.code).toLowerCase()));
    if (!allowed.has(normalized)) {
      throw new BadRequestException(`Invalid path-hop function "${value}"`);
    }
    return normalized;
  }

  protected normalizeLegOrderIndex(value: unknown): number {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new BadRequestException('order_index must be an integer');
    if (n < 1) throw new BadRequestException('order_index must be >= 1');
    return n;
  }

  protected async normalizeLegProtocols(codes: unknown, tenantId: string, manager?: EntityManager): Promise<string[]> {
    const list = Array.isArray(codes) ? codes : codes == null ? [] : [codes];
    const normalized = list
      .map((c) => String(c ?? '').trim().toLowerCase())
      .filter((c) => c.length > 0);
    if (normalized.length === 0) {
      throw new BadRequestException('At least one protocol is required for each leg');
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.connectionTypes || []).map((o: any) => o.code));
    for (const code of normalized) {
      if (!allowed.has(code)) {
        throw new BadRequestException(`Invalid protocol "${code}"`);
      }
    }
    return Array.from(new Set(normalized));
  }

  /**
   * Normalize the equipment for a single hop (asset XOR entity_code, both null OK).
   * The hop's equipment is the intermediary the flow passes through. Source/destination
   * of the surrounding flow are implicit from the hop's position in the path.
   */
  protected async normalizeHopEquipment(
    payload: Partial<{
      equipment_asset_id: unknown;
      equipment_entity_code: unknown;
    }>,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Pick<LegInput, 'equipment_asset_id' | 'equipment_entity_code'>> {
    const aid = this.normalizeNullable(payload.equipment_asset_id);
    const eidRaw = this.normalizeNullable(payload.equipment_entity_code);
    const eid = eidRaw ? eidRaw.toLowerCase() : null;
    if (aid && eid) {
      throw new BadRequestException('hop equipment: choose either an asset or an entity, not both');
    }
    if (!aid && !eid) {
      return { equipment_asset_id: null, equipment_entity_code: null };
    }
    if (aid) {
      await this.ensureAsset(aid, tenantId, manager);
      return { equipment_asset_id: aid, equipment_entity_code: null };
    }
    await this.validateEntityCode(eid as string, tenantId, manager);
    return { equipment_asset_id: null, equipment_entity_code: eid };
  }

  /**
   * Joins the effective risk of each connection onto a connection query aliased `c`, as `er`.
   * Read the effective values with the EFFECTIVE_RISK expressions.
   *
   * The aggregate is a MATERIALIZED common table expression: it runs once per statement. As a
   * joined subquery the planner could put it on the inner side of a nested loop and re-run it
   * for every connection when the tenant's statistics are stale (a new tenant, a bulk import
   * before autoanalyze), which took seconds for a few hundred connections. `ids`, when given,
   * restricts the aggregate to those connections' links.
   */
  protected async joinEffectiveRisk(
    qb: SelectQueryBuilder<Connection>,
    tenantId: string,
    mg: EntityManager,
    ids?: string[],
  ): Promise<void> {
    const catalog = await this.itOpsSettings.getClassificationCatalog(tenantId, { manager: mg });
    const params: Record<string, unknown> = {
      erTenant: tenantId,
      erCritCodes: catalog.businessCriticalityLevels.map((level) => level.code),
      erCritRanks: catalog.businessCriticalityLevels.map((level) => level.rank),
      erClassCodes: catalog.dataClasses.map((level) => level.code),
      erClassRanks: catalog.dataClasses.map((level) => level.rank),
    };
    if (ids) params.erIds = ids;
    qb.addCommonTableExpression(linkedInterfaceRiskSql(!!ids), 'er', { materialized: true });
    qb.leftJoin('er', 'er', 'er.connection_id = c.id');
    qb.setParameters(params);
  }

  /**
   * Effective risk values of connections: the stored values for a manual connection, the
   * highest classification of its linked interfaces for a derived one (see EFFECTIVE_RISK).
   */
  protected async computeEffectiveRiskForConnections(
    tenantId: string,
    bases: Array<{ id: string }>,
    mg: EntityManager,
  ): Promise<Map<string, EffectiveRisk>> {
    const ids = Array.from(new Set((bases || []).map((b) => b.id))).filter(Boolean);
    if (ids.length === 0) {
      return new Map();
    }
    const qb = mg
      .getRepository(Connection)
      .createQueryBuilder('c')
      .select('c.id', 'id')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.id IN (:...ids)', { ids });
    await this.joinEffectiveRisk(qb, tenantId, mg, ids);
    selectEffectiveRisk(qb);
    const rows: Array<Record<string, any>> = await qb.getRawMany();
    return new Map(rows.map((row) => [String(row.id), readEffectiveRisk(row)]));
  }
}
