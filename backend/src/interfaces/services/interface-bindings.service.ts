import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interface-middleware-application.entity';
import { InterfaceOwner } from '../interface-owner.entity';
import { InterfaceCompany } from '../interface-company.entity';
import { InterfaceDependency } from '../interface-dependency.entity';
import { InterfaceKeyIdentifier } from '../interface-key-identifier.entity';
import { InterfaceLink } from '../interface-link.entity';
import { InterfaceDataResidency } from '../interface-data-residency.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { InterfaceConnectionLink } from '../../interface-connection-links/interface-connection-link.entity';
import { Application } from '../../applications/application.entity';
import { AuditService } from '../../audit/audit.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { normalizeBindingLifecycle } from '../../interface-bindings/interface-bindings.service';
import {
  InterfacesBaseService,
  ServiceOpts,
} from './interfaces-base.service';
import { readInterfaceRelations, setInterfaceRelation, type InterfaceRelationsDeps } from '../interface-relations';

/**
 * Service for managing interface bindings and related operations.
 */
@Injectable()
export class InterfaceBindingsManagementService extends InterfacesBaseService {
  constructor(
    @InjectRepository(InterfaceEntity) repo: Repository<InterfaceEntity>,
    @InjectRepository(InterfaceLeg) legs: Repository<InterfaceLeg>,
    @InjectRepository(InterfaceMiddlewareApplication) middlewareApps: Repository<InterfaceMiddlewareApplication>,
    @InjectRepository(Application) apps: Repository<Application>,
    @InjectRepository(InterfaceBinding) bindings: Repository<InterfaceBinding>,
    itOpsSettings: ItOpsSettingsService,
    private readonly audit: AuditService,
  ) {
    super(repo, legs, middlewareApps, apps, bindings, itOpsSettings);
  }

  /**
   * List legs for an interface.
   */
  async listLegs(interfaceId: string, opts?: ServiceOpts) {
    const repo = this.getLegRepo(opts?.manager);
    const legs = await repo.find({
      where: { interface_id: interfaceId } as any,
      order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
    });
    return { items: legs };
  }

  /**
   * Update legs for an interface.
   */
  async updateLegs(
    interfaceId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const intfRepo = this.getRepo(mg);
    const legRepo = this.getLegRepo(mg);

    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      throw new BadRequestException('items array is required');
    }

    const existingInterface = await intfRepo.findOne({ where: { id: interfaceId } });
    if (!existingInterface) throw new NotFoundException('Interface not found');

    const legs = await legRepo.find({ where: { interface_id: interfaceId } as any });
    if (legs.length === 0) {
      return { items: [] };
    }
    const beforeSnapshot = legs.map((leg) => ({
      id: leg.id,
      leg_type: leg.leg_type,
      order_index: leg.order_index,
      trigger_type: leg.trigger_type,
      integration_pattern: leg.integration_pattern,
      data_format: leg.data_format,
      job_name: leg.job_name,
    }));

    const legById = new Map<string, InterfaceLeg>();
    for (const leg of legs) {
      legById.set(leg.id, leg);
    }

    const toUpdate: InterfaceLeg[] = [];
    for (const item of body.items as any[]) {
      const legId = String(item?.id || '').trim();
      if (!legId) continue;
      const found = legById.get(legId);
      if (!found) continue;
      const next = { ...found };

      if (item.trigger_type !== undefined) {
        next.trigger_type = await this.normalizeLegEnum(
          item.trigger_type,
          tenantId,
          'interfaceTriggerTypes',
          'trigger_type',
          mg,
        );
      }
      if (item.integration_pattern !== undefined) {
        next.integration_pattern = await this.normalizeLegEnum(
          item.integration_pattern,
          tenantId,
          'interfacePatterns',
          'integration_pattern',
          mg,
        );
      }
      if (item.data_format !== undefined) {
        next.data_format = await this.normalizeLegEnum(
          item.data_format,
          tenantId,
          'interfaceFormats',
          'data_format',
          mg,
        );
      }
      if (item.job_name !== undefined) {
        const text = String(item.job_name ?? '').trim();
        next.job_name = text.length === 0 ? null : text;
      }

      next.updated_at = new Date();
      toUpdate.push(next);
    }

    if (toUpdate.length === 0) {
      return {
        items: legs.sort((a, b) => {
          if (a.order_index === b.order_index) {
            return a.created_at.getTime() - b.created_at.getTime();
          }
          return a.order_index - b.order_index;
        }),
      };
    }

    await legRepo.save(toUpdate);

    const updatedLegs = await legRepo.find({
      where: { interface_id: interfaceId } as any,
      order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
    });
    await this.audit.log(
      {
        table: 'interface_legs',
        recordId: interfaceId,
        action: 'update',
        before: beforeSnapshot,
        after: updatedLegs.map((leg) => ({
          id: leg.id,
          leg_type: leg.leg_type,
          order_index: leg.order_index,
          trigger_type: leg.trigger_type,
          integration_pattern: leg.integration_pattern,
          data_format: leg.data_format,
          job_name: leg.job_name,
        })),
        userId,
      },
      { manager: mg },
    );
    return { items: updatedLegs };
  }

  /**
   * List connection links for an interface.
   */
  async listConnectionLinksForInterface(
    interfaceId: string,
    tenantId: string,
    query: any,
    opts?: ServiceOpts,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const target = await repo.findOne({ where: { id: interfaceId, tenant_id: tenantId } as any });
    if (!target) {
      throw new NotFoundException('Interface not found');
    }

    const settings = await this.itOpsSettings.getSettings(tenantId, { manager: mg });
    const entityLabelMap = new Map(
      (settings.entities || []).map((e: any) => [String(e.code || '').trim().toLowerCase(), e.label || e.code]),
    );

    let environment: string | null = null;
    if (query?.environment) {
      environment = this.normalizeEnvironment(query.environment);
    }

    const params: any[] = [tenantId, interfaceId];
    let sql = `
      SELECT
        l.id AS link_id,
        l.interface_binding_id AS binding_id,
        b.environment,
        b.status AS binding_status,
        leg.leg_type,
        leg.order_index,
        c.id AS connection_id,
        c.connection_reference AS connection_reference,
        c.name AS connection_name,
        c.topology,
        c.lifecycle,
        c.criticality,
        c.data_class,
        c.contains_pii,
        c.risk_mode,
        c.source_asset_id,
        c.destination_asset_id,
        c.source_entity_code,
        c.destination_entity_code,
        src.name AS source_server_name,
        src.is_cluster AS source_is_cluster,
        dst.name AS destination_server_name,
        dst.is_cluster AS destination_is_cluster,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT cp.connection_type_code), NULL) AS protocol_codes
      FROM interface_connection_links l
      JOIN interface_bindings b ON b.id = l.interface_binding_id
      JOIN interface_legs leg ON leg.id = b.interface_leg_id
      JOIN connections c ON c.id = l.connection_id
      LEFT JOIN connection_protocols cp ON cp.connection_id = c.id
      LEFT JOIN assets src ON src.id = c.source_asset_id
      LEFT JOIN assets dst ON dst.id = c.destination_asset_id
      WHERE c.tenant_id = $1
        AND b.interface_id = $2
    `;

    if (environment) {
      sql += ' AND b.environment = $3';
      params.push(environment);
    }

    sql += ' GROUP BY l.id, b.id, b.environment, b.status, leg.leg_type, leg.order_index, c.id, c.connection_reference, c.name, c.topology, c.lifecycle, c.criticality, c.data_class, c.contains_pii, c.risk_mode, c.source_asset_id, c.destination_asset_id, c.source_entity_code, c.destination_entity_code, src.name, src.is_cluster, dst.name, dst.is_cluster';

    sql += ' ORDER BY c.name ASC, c.connection_reference ASC, b.environment ASC, leg.order_index ASC';

    const rows: Array<{
      link_id: string;
      binding_id: string;
      environment: string;
      binding_status: string;
      leg_type: string;
      connection_id: string;
      connection_reference: string;
      connection_name: string;
      topology: string;
      lifecycle: string;
      criticality: string | null;
      data_class: string | null;
      contains_pii: boolean;
      risk_mode: string | null;
      protocol_codes: string[] | null;
      source_asset_id: string | null;
      destination_asset_id: string | null;
      source_entity_code: string | null;
      destination_entity_code: string | null;
      source_server_name: string | null;
      destination_server_name: string | null;
      source_is_cluster: boolean | null;
      destination_is_cluster: boolean | null;
    }> = await mg.query(sql, params);

    const items = rows.map((row) => ({
      id: row.link_id,
      binding_id: row.binding_id,
      environment: row.environment,
      leg_type: row.leg_type,
      binding_status: normalizeBindingLifecycle(row.binding_status),
      connection: {
        id: row.connection_id,
        connection_reference: row.connection_reference,
        name: row.connection_name,
        topology: row.topology,
        lifecycle: row.lifecycle,
        criticality: row.criticality,
        data_class: row.data_class,
        contains_pii: !!row.contains_pii,
        risk_mode: (row.risk_mode || 'manual') as 'manual' | 'derived',
        protocol_codes: Array.isArray(row.protocol_codes)
          ? row.protocol_codes.map((c: any) => String(c || '').trim().toLowerCase()).filter(Boolean)
          : [],
        source_server_id: row.source_asset_id,
        destination_server_id: row.destination_asset_id,
        source_asset_id: row.source_asset_id,
        destination_asset_id: row.destination_asset_id,
        source_entity_code: row.source_entity_code ? String(row.source_entity_code).trim().toLowerCase() : null,
        destination_entity_code: row.destination_entity_code ? String(row.destination_entity_code).trim().toLowerCase() : null,
        source_server_name: row.source_server_name,
        destination_server_name: row.destination_server_name,
        source_is_cluster: !!row.source_is_cluster,
        destination_is_cluster: !!row.destination_is_cluster,
        source_entity_label: row.source_entity_code
          ? entityLabelMap.get(String(row.source_entity_code).trim().toLowerCase()) || row.source_entity_code
          : null,
        destination_entity_label: row.destination_entity_code
          ? entityLabelMap.get(String(row.destination_entity_code).trim().toLowerCase()) || row.destination_entity_code
          : null,
        server_ids: [] as string[],
      },
    }));

    // Collect server ids involved in each connection (source/destination, multi-server, legs)
    const serverIdsByConnection = new Map<string, Set<string>>();
    const addServer = (connId: string, sid?: string | null) => {
      if (!sid) return;
      if (!serverIdsByConnection.has(connId)) serverIdsByConnection.set(connId, new Set());
      serverIdsByConnection.get(connId)!.add(sid);
    };

    for (const row of rows) {
      addServer(row.connection_id, row.source_asset_id);
      addServer(row.connection_id, row.destination_asset_id);
    }

    const connIds = Array.from(new Set(rows.map((r) => r.connection_id))).filter(Boolean);
    if (connIds.length > 0) {
      const csRows: Array<{ connection_id: string; asset_id: string }> = await mg.query(
        `SELECT connection_id, asset_id FROM connection_servers WHERE connection_id = ANY($1::uuid[])`,
        [connIds],
      );
      csRows.forEach((r) => addServer(r.connection_id, r.asset_id));

      // A leg names one piece of equipment the connection passes through (migration 1850300000000).
      const legRows: Array<{ connection_id: string; equipment_asset_id: string | null }> = await mg.query(
        `SELECT connection_id, equipment_asset_id
         FROM connection_legs
         WHERE connection_id = ANY($1::uuid[])`,
        [connIds],
      );
      legRows.forEach((r) => addServer(r.connection_id, r.equipment_asset_id));
    }

    items.forEach((item) => {
      const set = serverIdsByConnection.get(item.connection.id);
      item.connection.server_ids = set ? Array.from(set) : [];
    });

    return { items };
  }

  /**
   * List owners for an interface.
   */
  async listOwners(interfaceId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(InterfaceOwner).find({ where: { interface_id: interfaceId } as any });
  }

  /**
   * Bulk replace owners for an interface.
   */
  async bulkReplaceOwners(
    interfaceId: string,
    owners: Array<{ user_id: string; owner_type: 'business' | 'it' }>,
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceOwner);
    const existing = await repo.find({ where: { interface_id: interfaceId } as any });
    const beforeState = existing.map((o) => `${o.owner_type}:${o.user_id}`).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    let afterRows: InterfaceOwner[] = [];
    if (owners && owners.length) {
      const rows = owners.map((o) =>
        repo.create({
          interface_id: interfaceId,
          user_id: o.user_id,
          owner_type: o.owner_type,
        }),
      );
      afterRows = await repo.save(rows);
    }
    const afterState = afterRows.map((o) => `${o.owner_type}:${o.user_id}`).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'interface_owners',
          recordId: interfaceId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return this.listOwners(interfaceId, { manager: mg });
  }

  /**
   * List companies for an interface.
   */
  async listCompanies(interfaceId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(InterfaceCompany).find({ where: { interface_id: interfaceId } as any });
  }

  /**
   * Bulk replace companies for an interface.
   */
  async bulkReplaceCompanies(interfaceId: string, companyIds: string[], userId?: string | null, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceCompany);
    const existing = await repo.find({ where: { interface_id: interfaceId } as any });
    const beforeState = existing.map((c) => c.company_id).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    let afterRows: InterfaceCompany[] = [];
    if (companyIds && companyIds.length) {
      const rows = companyIds.map((cid) =>
        repo.create({
          interface_id: interfaceId,
          company_id: cid,
        }),
      );
      afterRows = await repo.save(rows);
    }
    const afterState = afterRows.map((c) => c.company_id).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'interface_companies',
          recordId: interfaceId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return this.listCompanies(interfaceId, { manager: mg });
  }

  /**
   * List dependencies for an interface.
   */
  async listDependencies(interfaceId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(InterfaceDependency).find({ where: { interface_id: interfaceId } as any });
  }

  /**
   * Bulk replace dependencies for an interface.
   */
  async bulkReplaceDependencies(
    interfaceId: string,
    upstreamIds: string[],
    downstreamIds: string[],
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceDependency);
    const existing = await repo.find({ where: { interface_id: interfaceId } as any });
    const beforeState = existing.map((d) => `${d.direction}:${d.related_interface_id}`).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });

    const rows: InterfaceDependency[] = [];
    const upstreamClean = Array.from(
      new Set((upstreamIds || []).map((id) => String(id || '').trim()).filter((id) => !!id)),
    );
    const downstreamClean = Array.from(
      new Set((downstreamIds || []).map((id) => String(id || '').trim()).filter((id) => !!id)),
    );

    for (const relatedId of upstreamClean) {
      rows.push(
        repo.create({
          interface_id: interfaceId,
          related_interface_id: relatedId,
          direction: 'upstream',
        }),
      );
    }
    for (const relatedId of downstreamClean) {
      rows.push(
        repo.create({
          interface_id: interfaceId,
          related_interface_id: relatedId,
          direction: 'downstream',
        }),
      );
    }

    let afterRows: InterfaceDependency[] = [];
    if (rows.length) {
      afterRows = await repo.save(rows);
    }

    const afterState = afterRows.map((d) => `${d.direction}:${d.related_interface_id}`).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'interface_dependencies',
          recordId: interfaceId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }

    return this.listDependencies(interfaceId, { manager: mg });
  }

  /**
   * List key identifiers for an interface.
   */
  async listKeyIdentifiers(interfaceId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg
      .getRepository(InterfaceKeyIdentifier)
      .find({ where: { interface_id: interfaceId } as any, order: { created_at: 'ASC' as any } });
  }

  /**
   * Bulk replace key identifiers for an interface.
   */
  async bulkReplaceKeyIdentifiers(
    interfaceId: string,
    items: Array<{ source_identifier: string; destination_identifier: string; identifier_notes?: string | null }>,
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceKeyIdentifier);
    const existing = await repo.find({ where: { interface_id: interfaceId } as any });
    const beforeState = existing.map((i) => `${i.source_identifier}:${i.destination_identifier}:${i.identifier_notes ?? ''}`).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });

    const clean = (items || [])
      .map((item) => ({
        source_identifier: String(item.source_identifier || '').trim(),
        destination_identifier: String(item.destination_identifier || '').trim(),
        identifier_notes:
          item.identifier_notes === undefined || item.identifier_notes === null
            ? null
            : String(item.identifier_notes).trim() || null,
      }))
      .filter((item) => item.source_identifier && item.destination_identifier);

    let afterRows: InterfaceKeyIdentifier[] = [];
    if (clean.length) {
      const rows = clean.map((item) =>
        repo.create({
          interface_id: interfaceId,
          source_identifier: item.source_identifier,
          destination_identifier: item.destination_identifier,
          identifier_notes: item.identifier_notes,
        }),
      );
      afterRows = await repo.save(rows);
    }

    const afterState = afterRows.map((i) => `${i.source_identifier}:${i.destination_identifier}:${i.identifier_notes ?? ''}`).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'interface_key_identifiers',
          recordId: interfaceId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }

    return this.listKeyIdentifiers(interfaceId, { manager: mg });
  }

  /**
   * List data residency for an interface.
   */
  async listDataResidency(interfaceId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(InterfaceDataResidency).find({ where: { interface_id: interfaceId } as any });
  }

  /**
   * Bulk replace data residency for an interface.
   */
  async bulkReplaceDataResidency(
    interfaceId: string,
    countryCodes: string[],
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceDataResidency);
    const existing = await repo.find({ where: { interface_id: interfaceId } as any });
    const beforeState = existing.map((r) => r.country_iso).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });

    const clean = (countryCodes || [])
      .map((c) => String(c || '').trim().toUpperCase())
      .filter((c) => !!c && c.length === 2);
    const unique = Array.from(new Set(clean));

    let afterRows: InterfaceDataResidency[] = [];
    if (unique.length) {
      const rows = unique.map((iso) =>
        repo.create({
          interface_id: interfaceId,
          country_iso: iso,
        }),
      );
      afterRows = await repo.save(rows);
    }

    const afterState = afterRows.map((r) => r.country_iso).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'interface_data_residency',
          recordId: interfaceId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }

    return this.listDataResidency(interfaceId, { manager: mg });
  }

  /**
   * List links for an interface.
   */
  async listLinks(interfaceId: string, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(InterfaceLink).find({
      where: { interface_id: interfaceId } as any,
      order: { created_at: 'DESC' as any },
    });
  }

  /**
   * Bulk replace links for an interface.
   */
  async bulkReplaceLinks(
    interfaceId: string,
    links: Array<{ kind?: string; description?: string | null; url: string }>,
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceLink);
    const existing = await repo.find({
      where: { interface_id: interfaceId } as any,
      order: { created_at: 'ASC' as any },
    });
    const beforeState = existing.map((item) => ({
      kind: item.kind,
      description: item.description ?? null,
      url: item.url,
    }));

    if (existing.length > 0) {
      await repo.delete({ id: In(existing.map((item) => item.id)) as any });
    }

    const normalized = (links || [])
      .map((item) => ({
        kind: String(item.kind || 'functional').trim() || 'functional',
        description: item.description == null ? null : String(item.description).trim() || null,
        url: String(item.url || '').trim(),
      }))
      .filter((item) => item.url);

    let saved: InterfaceLink[] = [];
    if (normalized.length > 0) {
      const rows = normalized.map((item) => repo.create({
        interface_id: interfaceId,
        kind: item.kind,
        description: item.description,
        url: item.url,
      }));
      saved = await repo.save(rows);
    }

    const afterState = saved.map((item) => ({
      kind: item.kind,
      description: item.description ?? null,
      url: item.url,
    }));
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'interface_links',
          recordId: interfaceId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }

    return this.listLinks(interfaceId, { manager: mg });
  }

  /**
   * Create a link for an interface.
   */
  async createLink(
    interfaceId: string,
    body: Partial<InterfaceLink>,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceLink);
    const url = String(body.url || '').trim();
    if (!url) throw new BadRequestException('url is required');
    const kind = String(body.kind || 'functional').trim() || 'functional';
    const entity = repo.create({
      interface_id: interfaceId,
      kind,
      description: body.description ?? null,
      url,
    });
    const saved = await repo.save(entity);
    await this.audit.log(
      { table: 'interface_links', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  /**
   * Update a link for an interface.
   */
  async updateLink(
    interfaceId: string,
    linkId: string,
    body: Partial<InterfaceLink>,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceLink);
    const existing = await repo.findOne({ where: { id: linkId, interface_id: interfaceId } });
    if (!existing) throw new NotFoundException('Link not found');
    const before = { ...existing };
    if (body.kind !== undefined) {
      existing.kind = String(body.kind || '').trim() || existing.kind;
    }
    if (body.description !== undefined) {
      existing.description =
        body.description === null || body.description === undefined ? null : String(body.description);
    }
    if (body.url !== undefined) {
      const url = String(body.url || '').trim();
      if (!url) throw new BadRequestException('url is required');
      existing.url = url;
    }
    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'interface_links', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  /**
   * Delete a link for an interface.
   */
  async deleteLink(
    interfaceId: string,
    linkId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(InterfaceLink);
    const existing = await repo.findOne({ where: { id: linkId, interface_id: interfaceId } });
    if (!existing) return { ok: true };
    await repo.delete({ id: linkId } as any);
    await this.audit.log(
      { table: 'interface_links', recordId: linkId, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  /** The Relations tab: upstream and downstream interfaces (`interface-relations.ts`). */
  relations(ref: string, opts?: ServiceOpts) {
    return readInterfaceRelations(this.relationDeps(opts), ref);
  }

  /** Link or unlink one upstream or downstream interface, under the interface lock. */
  setRelation(kind: string, ref: string, targetId: string, add: boolean, userId: string | null, opts?: ServiceOpts) {
    return setInterfaceRelation(this.relationDeps(opts), kind, ref, targetId, add, userId);
  }

  private relationDeps(opts?: ServiceOpts): InterfaceRelationsDeps {
    const manager = opts?.manager ?? this.repo.manager;
    return { manager, audit: this.audit, resolve: (ref) => this.resolveInterfaceIdentifier(ref, manager) };
  }
}
