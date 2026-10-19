import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { languageOf, writeCsv } from '../../common/csv-sheet';
import { ItOpsSettingsService, type AdminZoneOption, type DomainTrustDirection } from '../../it-ops-settings/it-ops-settings.service';
import { technologyReference } from '../technology-rows';
import { inServiceSql } from '../technology-reach.service';

/**
 * The administration view (lot A1d): the view 4 of the ANSSI mapping guide ("vue de
 * l'administration"). A zone sits on what is administered. Per zone of the catalog, in catalog
 * order (the first zone is the most sensitive): its attributes, the assets of the zone, the
 * applications hosted on those assets, and the directory services placed in the zone. Then the
 * domains, unchanged. Then the control points: assets without a zone, domain controllers and
 * directory-carrying assets outside the most sensitive zone, dependencies that raise trust, and
 * applications hosted in the most sensitive zone.
 *
 * The most sensitive zone is the first non-deprecated zone of the catalog. Without one, the
 * controls that depend on it are absent. A deprecated zone is shown only when it still carries
 * an asset or a directory service. A zone code the catalog no longer has is shown when an asset
 * or a directory service still carries it.
 *
 * A domain controller, in the domains section, is an asset of the domain (`assets.domain`), not
 * retired, assigned with the server role `domain-controller` on an instance in service
 * (`inServiceSql`), or carrying an installed technology of the `directory` family that is not
 * retired. The control point uses the role only. Retired assets and retired technologies are left
 * out. Every statement carries `tenant_id` and reads the tenant in one pass.
 */

export const DIRECTORY_FAMILY = 'directory';
export const DOMAIN_CONTROLLER_ROLE = 'domain-controller';

export type AdministrationOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

export type AdministrationAsset = { id: string; name: string; reference: string | null; kind: string };

export type AdministrationDirectory = { id: string; reference: string | null; name: string };

export type AdministrationZone = {
  code: string;
  label: string | null;
  admin_group: string | null;
  description: string | null;
  deprecated: boolean;
  /** A zone code an asset or a directory service carries that the catalog no longer has. */
  unknown: boolean;
  assets: AdministrationAsset[];
  asset_counts: Array<{ kind: string; count: number }>;
  /** Distinct applications in service hosted on the assets of the zone. */
  hosted_application_count: number;
  directory_services: AdministrationDirectory[];
};

/** The record a control point asks to correct. The reference is the business one. */
export type ControlAsset = AdministrationAsset;

export type TrustRaised = {
  asset: ControlAsset;
  asset_zone: string;
  holder: ControlAsset;
  holder_zone: string;
  holder_kind: 'contains' | 'cluster';
};

export type HostedApplication = {
  id: string;
  name: string;
  reference: string | null;
  asset: ControlAsset;
};

export type AdministrationControls = {
  /** The first non-deprecated zone of the catalog, or null when the catalog has none. */
  most_sensitive_zone: string | null;
  assets_without_zone: ControlAsset[];
  /** Null when there is no most sensitive zone: the check does not run. */
  domain_controllers_outside: ControlAsset[] | null;
  directory_assets_outside: ControlAsset[] | null;
  trust_raised: TrustRaised[] | null;
  applications_on_most_sensitive: HostedApplication[] | null;
};

/** English titles of the control points, also the Zone column of a `control` row in the export. */
export const CONTROL_TITLES = {
  assetsWithoutZone: 'Assets without an administration zone',
  domainControllers: 'Domain controllers outside the most sensitive zone',
  directoryAssets: 'Assets carrying a directory service outside the most sensitive zone',
  trustRaised: 'Assets in a more sensitive zone than what contains them',
  applications: 'Applications hosted in the most sensitive zone',
} as const;

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
  controls: AdministrationControls;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

type AssetRow = { id: string; name: string; kind: string; asset_reference: string | null; admin_zone: string | null };
type HostingRow = { id: string; name: string; sequential_id: string | null; asset_id: string };
type DirectoryRow = { id: string; item_number: number; name: string; admin_zone: string | null };
type PairRow = {
  holder_id: string; holder_name: string; holder_kind: string; holder_reference: string | null; holder_zone: string | null;
  asset_id: string; asset_name: string; asset_kind: string; asset_reference: string | null; asset_zone: string | null;
};

const toAsset = (row: { id: string; name: string; kind: string; asset_reference: string | null }): AdministrationAsset => ({
  id: row.id, name: row.name, reference: row.asset_reference, kind: row.kind,
});

@Injectable()
export class AdministrationViewService {
  constructor(private readonly itOps: ItOpsSettingsService) {}

  async view(opts: AdministrationOpts): Promise<AdministrationView> {
    const { manager: mg, tenantId } = opts;
    const settings = await this.itOps.getSettings(tenantId, { manager: mg });
    const catalog = settings.adminZones ?? [];
    const known = new Set(catalog.map((option) => option.code));
    const rank = new Map(catalog.map((option, index) => [option.code, index]));
    const most = catalog.find((option) => !option.deprecated)?.code ?? null;

    const assetRows: AssetRow[] = await mg.query(
      `SELECT a.id, a.name, a.kind, a.asset_reference, NULLIF(btrim(a.admin_zone), '') AS admin_zone
         FROM assets a
        WHERE a.tenant_id = $1 AND a.status <> 'retired'
        ORDER BY lower(a.name), a.id`,
      [tenantId],
    );
    const assetById = new Map(assetRows.map((row) => [row.id, row]));
    const assetsByZone = new Map<string, AdministrationAsset[]>();
    const withoutZone: AdministrationAsset[] = [];
    for (const row of assetRows) {
      const asset = toAsset(row);
      if (!row.admin_zone) withoutZone.push(asset);
      else {
        const list = assetsByZone.get(row.admin_zone) ?? [];
        list.push(asset);
        assetsByZone.set(row.admin_zone, list);
      }
    }

    const hostings: HostingRow[] = await mg.query(
      `SELECT DISTINCT ap.id, ap.name, ap.sequential_id, a.id AS asset_id
         FROM app_asset_assignments aa
         JOIN assets a ON a.tenant_id = $1 AND a.id = aa.asset_id AND a.status <> 'retired'
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = aa.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
        WHERE aa.tenant_id = $1`,
      [tenantId],
    );
    const hostedByZone = new Map<string, Set<string>>();
    const onMost: HostedApplication[] = [];
    for (const row of hostings) {
      const asset = assetById.get(row.asset_id);
      if (!asset?.admin_zone) continue;
      const ids = hostedByZone.get(asset.admin_zone) ?? new Set<string>();
      ids.add(row.id);
      hostedByZone.set(asset.admin_zone, ids);
      if (most && asset.admin_zone === most) {
        onMost.push({ id: row.id, name: row.name, reference: row.sequential_id, asset: toAsset(asset) });
      }
    }
    onMost.sort((a, b) => byName(a, b) || byName(a.asset, b.asset));

    const directories: DirectoryRow[] = await mg.query(
      `SELECT t.id, t.item_number, t.name, NULLIF(btrim(t.admin_zone), '') AS admin_zone
         FROM technologies t
        WHERE t.tenant_id = $1 AND t.lifecycle <> 'retired' AND t.family = $2
        ORDER BY lower(t.name), t.item_number`,
      [tenantId, DIRECTORY_FAMILY],
    );
    const directoriesByZone = new Map<string, AdministrationDirectory[]>();
    for (const row of directories) {
      if (!row.admin_zone) continue;
      const list = directoriesByZone.get(row.admin_zone) ?? [];
      list.push({ id: row.id, reference: technologyReference(row.item_number), name: row.name });
      directoriesByZone.set(row.admin_zone, list);
    }

    const zoneOf = (option: AdminZoneOption | null, code: string, unknown = false): AdministrationZone => {
      const assets = assetsByZone.get(code) ?? [];
      const counts = new Map<string, number>();
      for (const asset of assets) counts.set(asset.kind, (counts.get(asset.kind) ?? 0) + 1);
      return {
        code,
        label: option?.label ?? code,
        admin_group: option?.admin_group ?? null,
        description: option?.description ?? null,
        deprecated: !!option?.deprecated,
        unknown,
        assets,
        asset_counts: [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind)),
        hosted_application_count: hostedByZone.get(code)?.size ?? 0,
        directory_services: directoriesByZone.get(code) ?? [],
      };
    };
    const zones: AdministrationZone[] = catalog
      .filter((option) => !option.deprecated || assetsByZone.has(option.code) || directoriesByZone.has(option.code))
      .map((option) => zoneOf(option, option.code));
    const strayCodes = new Set<string>([
      ...[...assetsByZone.keys()].filter((code) => !known.has(code)),
      ...[...directoriesByZone.keys()].filter((code) => !known.has(code)),
    ]);
    for (const code of [...strayCodes].sort()) zones.push(zoneOf(null, code, true));

    const controls = await this.controls(opts, { assetById, withoutZone, rank, most, onMost });
    return { zones, domains: await this.domains(opts, settings.domains ?? []), controls };
  }

  private async controls(
    opts: AdministrationOpts,
    ctx: {
      assetById: Map<string, AssetRow>;
      withoutZone: AdministrationAsset[];
      rank: Map<string, number>;
      most: string | null;
      onMost: HostedApplication[];
    },
  ): Promise<AdministrationControls> {
    const { manager: mg, tenantId } = opts;
    const { assetById, withoutZone, rank, most, onMost } = ctx;
    const outside = (ids: string[]): ControlAsset[] | null => {
      if (!most) return null;
      return ids
        .map((id) => assetById.get(id))
        .filter((row): row is AssetRow => !!row && row.admin_zone !== most)
        .map(toAsset)
        .sort(byName);
    };
    if (!most) {
      return {
        most_sensitive_zone: null,
        assets_without_zone: withoutZone,
        domain_controllers_outside: null,
        directory_assets_outside: null,
        trust_raised: null,
        applications_on_most_sensitive: null,
      };
    }

    const controllers: Array<{ id: string }> = await mg.query(
      `SELECT DISTINCT a.id
         FROM assets a
         JOIN app_asset_assignments aa ON aa.tenant_id = $1 AND aa.asset_id = a.id AND aa.role = $2
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = aa.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
        WHERE a.tenant_id = $1 AND a.status <> 'retired'`,
      [tenantId, DOMAIN_CONTROLLER_ROLE],
    );
    const directoryAssets: Array<{ id: string }> = await mg.query(
      `SELECT DISTINCT a.id
         FROM assets a
         JOIN asset_technologies at ON at.tenant_id = $1 AND at.asset_id = a.id
         JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id AND t.family = $2 AND t.lifecycle <> 'retired'
        WHERE a.tenant_id = $1 AND a.status <> 'retired'`,
      [tenantId, DIRECTORY_FAMILY],
    );
    const pairs: PairRow[] = await mg.query(
      `SELECT c.id AS holder_id, c.name AS holder_name, c.kind AS holder_kind, c.asset_reference AS holder_reference,
              NULLIF(btrim(c.admin_zone), '') AS holder_zone,
              a.id AS asset_id, a.name AS asset_name, a.kind AS asset_kind, a.asset_reference AS asset_reference,
              NULLIF(btrim(a.admin_zone), '') AS asset_zone, 'contains' AS holder_link
         FROM asset_relations r
         JOIN assets c ON c.tenant_id = $1 AND c.id = r.asset_id AND c.status <> 'retired'
         JOIN assets a ON a.tenant_id = $1 AND a.id = r.related_asset_id AND a.status <> 'retired'
        WHERE r.tenant_id = $1 AND r.relation_type = 'contains' AND r.asset_id <> r.related_asset_id
        UNION ALL
       SELECT c.id, c.name, c.kind, c.asset_reference, NULLIF(btrim(c.admin_zone), ''),
              a.id, a.name, a.kind, a.asset_reference, NULLIF(btrim(a.admin_zone), ''), 'cluster'
         FROM asset_cluster_members m
         JOIN assets c ON c.tenant_id = $1 AND c.id = m.cluster_id AND c.status <> 'retired'
         JOIN assets a ON a.tenant_id = $1 AND a.id = m.asset_id AND a.status <> 'retired'
        WHERE m.tenant_id = $1 AND m.cluster_id <> m.asset_id`,
      [tenantId],
    );
    const trust: TrustRaised[] = [];
    for (const row of pairs as Array<PairRow & { holder_link: 'contains' | 'cluster' }>) {
      const assetRank = row.asset_zone == null ? undefined : rank.get(row.asset_zone);
      const holderRank = row.holder_zone == null ? undefined : rank.get(row.holder_zone);
      if (assetRank === undefined || holderRank === undefined || assetRank >= holderRank) continue;
      trust.push({
        asset: { id: row.asset_id, name: row.asset_name, reference: row.asset_reference, kind: row.asset_kind },
        asset_zone: row.asset_zone!,
        holder: { id: row.holder_id, name: row.holder_name, reference: row.holder_reference, kind: row.holder_kind },
        holder_zone: row.holder_zone!,
        holder_kind: row.holder_link,
      });
    }
    trust.sort((a, b) => byName(a.holder, b.holder) || byName(a.asset, b.asset));

    return {
      most_sensitive_zone: most,
      assets_without_zone: withoutZone,
      domain_controllers_outside: outside(controllers.map((row) => row.id)),
      directory_assets_outside: outside(directoryAssets.map((row) => row.id)),
      trust_raised: trust,
      applications_on_most_sensitive: onMost,
    };
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

  /**
   * One list as a CSV file. `list=domains` is unchanged. `list=zones` is one fact per row
   * (`Record` is `zone`, `asset`, `directory` or `control`):
   * a zone row carries the administrator group, the description and the hosted-application count,
   * and its note is the asset counts by type; an asset row and a directory row name the zone;
   * a control row uses the English control title as its zone, and its note says the zone, the
   * contained asset, or the hosting asset. An empty control is omitted.
   */
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
    const kindLabel = new Map((settings.serverKinds ?? []).map((option) => [option.code, option.label]));
    const kind = (code: string) => kindLabel.get(code) ?? code;
    const zoneLabel = new Map(view.zones.map((zone) => [zone.code, zone.label ?? zone.code]));
    const headers = ['Record', 'Zone', 'Administrator group', 'Description', 'Reference', 'Name', 'Type', 'Hosted applications', 'Note'];
    const rows: string[][] = [];
    for (const zone of view.zones) {
      const label = zone.label ?? zone.code;
      rows.push(['zone', label, zone.admin_group ?? '', zone.description ?? '', '', '', '', String(zone.hosted_application_count), zone.asset_counts.map((item) => `${kind(item.kind)}: ${item.count}`).join(', ')]);
      for (const asset of zone.assets) rows.push(['asset', label, '', '', asset.reference ?? '', asset.name, kind(asset.kind), '', '']);
      for (const service of zone.directory_services) rows.push(['directory', label, '', '', service.reference ?? '', service.name, '', '', '']);
    }
    const control = (title: string, reference: string, name: string, type: string, note: string) => {
      rows.push(['control', title, '', '', reference, name, type, '', note]);
    };
    const zoneNote = (code: string | null) => (code ? zoneLabel.get(code) ?? code : 'No zone');
    for (const asset of view.controls.assets_without_zone) control(CONTROL_TITLES.assetsWithoutZone, asset.reference ?? '', asset.name, kind(asset.kind), 'No zone');
    for (const asset of view.controls.domain_controllers_outside ?? []) {
      control(CONTROL_TITLES.domainControllers, asset.reference ?? '', asset.name, kind(asset.kind), zoneNote(assetByZone(view, asset.id)));
    }
    for (const asset of view.controls.directory_assets_outside ?? []) {
      control(CONTROL_TITLES.directoryAssets, asset.reference ?? '', asset.name, kind(asset.kind), zoneNote(assetByZone(view, asset.id)));
    }
    for (const finding of view.controls.trust_raised ?? []) {
      const contained = [finding.asset.reference, finding.asset.name, zoneNote(finding.asset_zone)].filter(Boolean).join(' ');
      control(CONTROL_TITLES.trustRaised, finding.holder.reference ?? '', finding.holder.name, finding.holder_kind, contained);
    }
    for (const app of view.controls.applications_on_most_sensitive ?? []) {
      control(CONTROL_TITLES.applications, app.reference ?? '', app.name, '', app.asset.reference ?? app.asset.name);
    }
    return { filename: 'administration_view_zones.csv', content: writeCsv({ language, headers, rows }) };
  }
}

function assetByZone(view: AdministrationView, assetId: string): string | null {
  for (const zone of view.zones) {
    if (zone.assets.some((asset) => asset.id === assetId)) return zone.code;
  }
  return null;
}
