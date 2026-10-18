import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { languageOf, writeCsv } from '../../common/csv-sheet';
import { ItOpsSettingsService, type AdminZoneOption, type DomainTrustDirection } from '../../it-ops-settings/it-ops-settings.service';
import { technologyReference } from '../technology-rows';
import { TechnologyReachService, inServiceSql } from '../technology-reach.service';

/**
 * The administration view (lot A1a, A1b): the view 4 of the ANSSI mapping guide ("vue de
 * l'administration") at its minimal grain. Per administration zone of the tenant's catalog: its
 * attributes, the technologies placed in it with the servers that carry them (the deduction of
 * `TechnologyReachService`), the assets attached to the zone themselves, and its directory
 * services (technologies of the `directory` family). The technologies without a zone form a last
 * group, `code: null`, flagged as data to complete. Then the domains of the catalog with their
 * forest, trusts, typed counts and domain controllers.
 *
 * A domain controller is an asset of the domain (`assets.domain`), not retired, that is assigned with
 * the server role `domain-controller` (`app_asset_assignments.role`, the shipped code of that role)
 * on an instance in service (the rule of the deductions, `inServiceSql`), or that carries an installed
 * technology of the `directory` family that is not retired (lead decision, 2026-10-17). Each server
 * counts once. Retired technologies and retired assets are left out of the zones too. Every statement carries `tenant_id` besides RLS
 * and works on the whole tenant in one pass, never a query per row.
 */

export const DIRECTORY_FAMILY = 'directory';
export const DOMAIN_CONTROLLER_ROLE = 'domain-controller';

export type AdministrationOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

export type AdministrationServer = { id: string; name: string; reference: string | null; via_name: string | null };

export type AdministrationAsset = { id: string; name: string; reference: string | null; kind: string };

export type AdministrationTechnology = {
  id: string;
  reference: string | null;
  name: string;
  family: string;
  directory: boolean;
  servers: AdministrationServer[];
};

export type AdministrationZone = {
  /** Null for the technologies without a zone. */
  code: string | null;
  label: string | null;
  admin_group: string | null;
  privilege_level: string | null;
  secrets_location: string | null;
  description: string | null;
  deprecated: boolean;
  /** A zone code a technology or an asset carries that the catalog no longer has. */
  unknown: boolean;
  technologies: AdministrationTechnology[];
  /** Assets attached to the zone themselves (not retired), besides the servers of its technologies. */
  assets: AdministrationAsset[];
  directory_services: Array<{ id: string; reference: string | null; name: string }>;
  server_count: number;
};

export type AdministrationDomain = {
  code: string;
  label: string;
  dns_suffix: string;
  forest: string | null;
  trusts: Array<{ domain: string; label: string; direction: DomainTrustDirection }>;
  /**
   * Trusts declared on other domains toward this one, read only, with the direction seen from this
   * domain (an outgoing trust of A toward B is an incoming trust of B).
   */
  declared_by: Array<{ domain: string; label: string; direction: DomainTrustDirection }>;
  account_count: number | null;
  machine_count: number | null;
  domain_controllers: Array<{ id: string; name: string; reference: string | null }>;
  deprecated: boolean;
};

export type AdministrationView = {
  zones: AdministrationZone[];
  domains: AdministrationDomain[];
  /** Technologies without a zone: the data to complete. */
  unplaced_count: number;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

@Injectable()
export class AdministrationViewService {
  constructor(
    private readonly itOps: ItOpsSettingsService,
    private readonly reach: TechnologyReachService,
  ) {}

  async view(opts: AdministrationOpts): Promise<AdministrationView> {
    const { manager: mg, tenantId } = opts;
    const settings = await this.itOps.getSettings(tenantId, { manager: mg });

    const techRows: Array<{ id: string; item_number: number; name: string; family: string; admin_zone: string | null }> = await mg.query(
      `SELECT t.id, t.item_number, t.name, t.family, NULLIF(btrim(t.admin_zone), '') AS admin_zone
         FROM technologies t
        WHERE t.tenant_id = $1 AND t.lifecycle <> 'retired'
        ORDER BY lower(t.name), t.item_number`,
      [tenantId],
    );
    const reached = await this.reach.assetsOfTechnologies(mg, tenantId, techRows.map((row) => row.id));
    const assetIds = [...new Set(reached.flatMap((row) => [row.asset_id, ...(row.via_asset_id ? [row.via_asset_id] : [])]))];
    const assets: Array<{ id: string; name: string; asset_reference: string | null; retired: boolean }> = assetIds.length
      ? await mg.query(
        `SELECT a.id, a.name, a.asset_reference, (a.status = 'retired') AS retired FROM assets a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])`,
        [tenantId, assetIds],
      )
      : [];
    const assetById = new Map(assets.map((row) => [row.id, row]));
    const serversOf = new Map<string, Map<string, AdministrationServer>>();
    for (const row of reached) {
      const asset = assetById.get(row.asset_id);
      if (!asset || asset.retired) continue;
      const servers = serversOf.get(row.technology_id) ?? new Map<string, AdministrationServer>();
      serversOf.set(row.technology_id, servers);
      const existing = servers.get(asset.id);
      // A server reached directly wins over the same server reached through another one.
      if (existing && existing.via_name === null) continue;
      const via = row.via_asset_id ? assetById.get(row.via_asset_id)?.name ?? null : null;
      servers.set(asset.id, { id: asset.id, name: asset.name, reference: asset.asset_reference, via_name: via });
    }

    const technologiesByZone = new Map<string | null, AdministrationTechnology[]>();
    for (const row of techRows) {
      const technology: AdministrationTechnology = {
        id: row.id,
        reference: technologyReference(row.item_number),
        name: row.name,
        family: row.family,
        directory: row.family === DIRECTORY_FAMILY,
        servers: [...(serversOf.get(row.id)?.values() ?? [])].sort(byName),
      };
      const list = technologiesByZone.get(row.admin_zone) ?? [];
      list.push(technology);
      technologiesByZone.set(row.admin_zone, list);
    }

    const assetRows: Array<{ id: string; name: string; kind: string; asset_reference: string | null; admin_zone: string }> = await mg.query(
      `SELECT a.id, a.name, a.kind, a.asset_reference, NULLIF(btrim(a.admin_zone), '') AS admin_zone
         FROM assets a
        WHERE a.tenant_id = $1 AND a.status <> 'retired' AND NULLIF(btrim(a.admin_zone), '') IS NOT NULL
        ORDER BY lower(a.name), a.id`,
      [tenantId],
    );
    const assetsByZone = new Map<string, AdministrationAsset[]>();
    for (const row of assetRows) {
      const list = assetsByZone.get(row.admin_zone) ?? [];
      list.push({ id: row.id, name: row.name, reference: row.asset_reference, kind: row.kind });
      assetsByZone.set(row.admin_zone, list);
    }

    const zone = (option: AdminZoneOption | null, code: string | null, unknown = false): AdministrationZone => {
      const technologies = technologiesByZone.get(code) ?? [];
      const assets = code === null ? [] : (assetsByZone.get(code) ?? []);
      return {
        code,
        label: option?.label ?? code,
        admin_group: option?.admin_group ?? null,
        privilege_level: option?.privilege_level ?? null,
        secrets_location: option?.secrets_location ?? null,
        description: option?.description ?? null,
        deprecated: !!option?.deprecated,
        unknown,
        technologies,
        assets,
        directory_services: technologies.filter((item) => item.directory).map(({ id, reference, name }) => ({ id, reference, name })),
        server_count: new Set([
          ...technologies.flatMap((item) => item.servers.map((server) => server.id)),
          ...assets.map((asset) => asset.id),
        ]).size,
      };
    };
    const catalog = settings.adminZones ?? [];
    const known = new Set(catalog.map((option) => option.code));
    const zones: AdministrationZone[] = catalog
      .filter((option) => !option.deprecated || technologiesByZone.has(option.code) || assetsByZone.has(option.code))
      .map((option) => zone(option, option.code));
    const strayCodes = new Set<string>([
      ...[...technologiesByZone.keys()].filter((code): code is string => code !== null && !known.has(code)),
      ...[...assetsByZone.keys()].filter((code) => !known.has(code)),
    ]);
    const strays = [...strayCodes].sort();
    for (const code of strays) zones.push(zone(null, code, true));
    zones.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }));
    const unplaced = technologiesByZone.get(null) ?? [];
    if (unplaced.length) zones.push(zone(null, null));

    return { zones, domains: await this.domains(opts, settings.domains ?? []), unplaced_count: unplaced.length };
  }

  private async domains(opts: AdministrationOpts, catalog: Awaited<ReturnType<ItOpsSettingsService['getSettings']>>['domains']): Promise<AdministrationDomain[]> {
    const { manager: mg, tenantId } = opts;
    const listed = catalog.filter((option) => !option.system);
    if (!listed.length) return [];
    const controllers: Array<{ domain: string; id: string; name: string; asset_reference: string | null }> = await mg.query(
      `SELECT a.domain, a.id, a.name, a.asset_reference
         FROM assets a
        WHERE a.tenant_id = $1 AND a.domain = ANY($2::text[]) AND a.status <> 'retired'
          AND (
            EXISTS (
              SELECT 1 FROM app_asset_assignments aa
                JOIN app_instances i ON i.tenant_id = $1 AND i.id = aa.app_instance_id
                JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
               WHERE aa.tenant_id = $1 AND aa.asset_id = a.id AND aa.role = $3
            )
            OR EXISTS (
              SELECT 1 FROM asset_technologies at
                JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id AND t.family = $4 AND t.lifecycle <> 'retired'
               WHERE at.tenant_id = $1 AND at.asset_id = a.id
            )
          )
        ORDER BY lower(a.name), a.id`,
      [tenantId, listed.map((option) => option.code), DOMAIN_CONTROLLER_ROLE, DIRECTORY_FAMILY],
    );
    const labelOf = new Map(catalog.map((option) => [option.code, option.label]));
    const seenFromTarget: Record<DomainTrustDirection, DomainTrustDirection> = { two_way: 'two_way', outgoing: 'incoming', incoming: 'outgoing' };
    const declaredBy = new Map<string, AdministrationDomain['declared_by']>();
    for (const option of listed) {
      for (const trust of option.trusts ?? []) {
        const list = declaredBy.get(trust.domain) ?? [];
        list.push({ domain: option.code, label: option.label, direction: seenFromTarget[trust.direction] });
        declaredBy.set(trust.domain, list);
      }
    }
    return listed
      .map((option) => ({
        code: option.code,
        label: option.label,
        dns_suffix: option.dns_suffix,
        forest: option.forest ?? null,
        trusts: (option.trusts ?? []).map((trust) => ({ domain: trust.domain, label: labelOf.get(trust.domain) ?? trust.domain, direction: trust.direction })),
        declared_by: (declaredBy.get(option.code) ?? []).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
        account_count: option.account_count ?? null,
        machine_count: option.machine_count ?? null,
        domain_controllers: controllers.filter((row) => row.domain === option.code).map((row) => ({ id: row.id, name: row.name, reference: row.asset_reference })),
        deprecated: !!option.deprecated,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }

  /** One list as a CSV file: `list=zones` (one row per technology, a zone without any on its own row) or `list=domains`. */
  async csv(query: Record<string, unknown>, opts: AdministrationOpts): Promise<{ filename: string; content: string }> {
    const view = await this.view(opts);
    const language = await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, query.language);
    if (query.list === 'domains') {
      const headers = ['Domain', 'DNS suffix', 'Forest', 'Trusts', 'Trusts declared by other domains', 'Accounts', 'Machines', 'Domain controllers', 'Domain controller servers'];
      const direction: Record<DomainTrustDirection, string> = { two_way: 'two-way', outgoing: 'outgoing', incoming: 'incoming' };
      const rows = view.domains.map((domain) => [
        domain.label,
        domain.dns_suffix,
        domain.forest ?? '',
        domain.trusts.map((trust) => `${trust.label} (${direction[trust.direction]})`).join(', '),
        domain.declared_by.map((trust) => `${trust.label} (${direction[trust.direction]})`).join(', '),
        domain.account_count == null ? '' : String(domain.account_count),
        domain.machine_count == null ? '' : String(domain.machine_count),
        String(domain.domain_controllers.length),
        domain.domain_controllers.map((server) => server.name).join(', '),
      ]);
      return { filename: 'administration_view_domains.csv', content: writeCsv({ language, headers, rows }) };
    }
    const settings = await this.itOps.getSettings(opts.tenantId, { manager: opts.manager });
    const familyLabel = new Map((settings.technologyFamilies ?? []).map((option) => [option.code, option.label]));
    const headers = ['Zone', 'Administrator group', 'Privilege level', 'Secrets location', 'Technology reference', 'Technology', 'Family', 'Directory service', 'Servers', 'Servers in this zone'];
    const rows: string[][] = [];
    for (const zone of view.zones) {
      const head = [zone.code === null ? 'No zone (to complete)' : zone.label ?? '', zone.admin_group ?? '', zone.privilege_level ?? '', zone.secrets_location ?? ''];
      const zoneServers = zone.assets.map((asset) => asset.name).join(', ');
      if (!zone.technologies.length) rows.push([...head, '', '', '', '', '', zoneServers]);
      for (const technology of zone.technologies) {
        rows.push([
          ...head,
          technology.reference ?? '',
          technology.name,
          familyLabel.get(technology.family) ?? technology.family,
          technology.directory ? 'Yes' : 'No',
          technology.servers.map((server) => server.name).join(', '),
          zoneServers,
        ]);
      }
    }
    return { filename: 'administration_view_zones.csv', content: writeCsv({ language, headers, rows }) };
  }
}
