import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { effectiveAssignmentsSql } from '../../app-asset-assignments/effective-assignments';
import { AuditService } from '../../audit/audit.service';
import { assertSetFilterModes } from '../../common/ag-grid-filtering';
import { languageOf } from '../../common/csv-sheet';
import { numberCell, writeListExport, type ListExportFile } from '../../common/csv/list-export';
import type { ExportFileFormat } from '../../common/xlsx/format';
import { shippedLabelIn } from '../../it-ops-settings/catalog-shipped-labels';
import type { CsvLanguage } from '../../common/csv-sheet/types';
import { findCatalogOption } from '../../it-ops-settings/catalog-resolve';
import { ItOpsSettingsService, type AdminZoneOption, type DomainOption, type DomainTrustDirection } from '../../it-ops-settings/it-ops-settings.service';
import { gridTextClause, gridTextModel } from '../technologies.service';
import { technologyReference, UUID_RE } from '../technology-rows';
import { inServiceSql } from '../technology-reach.service';

/**
 * The administration view (lot A1e), after the tiered administration model. A zone sits on what is
 * administered. The first zone of the catalog that is not deprecated is the most sensitive, and a
 * lower index among those zones is more sensitive. The five controls keep the rules reviewed in
 * lot A1d. Each one answers a count here, and the asset list names the assets it concerns.
 *
 * What runs an asset must sit in a zone at least as sensitive. A container (`asset_relations` of
 * type `contains`: `asset_id` is the container, `related_asset_id` the content) whose zone is less
 * sensitive than its content, and a cluster member whose zone is less sensitive than its cluster,
 * raise a `trust_raised` finding: the finding is always the asset to raise. Its `trust_peers` name
 * the more sensitive assets it runs (`contains`) or the cluster it is a member of (`cluster`). A
 * pair is left out when either zone is missing, deprecated or outside the catalog, and a self-link
 * is left out.
 *
 * A domain controller is an asset that is not retired, and that either carries the role
 * `domain-controller` on an instance in service, or an installed technology of the `directory`
 * family that is not retired. The domains section lists those assets of a domain of the catalog.
 * The control counts exactly those assets, when their zone is not the most sensitive one: a
 * directory server with no domain, or a domain outside the catalog, counts only among the
 * directory services outside the zone. Each control counts distinct assets: exactly the rows of
 * the asset list filtered on it. Roles and hosted applications read the effective assignments
 * (`effectiveAssignmentsSql`): a deployment assigned to a cluster is judged on the zone of the
 * cluster and of each member in service, as if assigned to each of them.
 * Retired assets and retired technologies are left out of every control. A deprecated or unknown
 * zone is shown only while an asset or a directory service still carries it. Every statement
 * carries `tenant_id` and reads the tenant in batches.
 */

export const DIRECTORY_FAMILY = 'directory';
export const DOMAIN_CONTROLLER_ROLE = 'domain-controller';

/** At most this many assets in one assignment. The same cap as the vulnerabilities bulk change. */
export const BULK_MAX_ROWS = 5000;
/** Rows written by one statement of a bulk assignment. */
const BULK_BATCH = 500;
/** Direct links, hosted applications and trust peers returned on one asset row. `total` keeps the full count. */
export const LINK_CAP = 10;
/** At most this many assets in one exported file. */
export const EXPORT_MAX_ROWS = 10000;

export const CONTROL_KEYS = [
  'assets_without_zone',
  'domain_controllers_outside',
  'directory_assets_outside',
  'trust_raised',
  'applications_on_most_sensitive',
] as const;
export type ControlKey = (typeof CONTROL_KEYS)[number];

/** Titles of the controls, the screen's full titles (`controlsList.*.title`), one map per language. */
const CONTROL_TITLES_BY_LANGUAGE: Record<CsvLanguage, Record<ControlKey, string>> = {
  en: {
    assets_without_zone: 'Assets without an administration zone',
    domain_controllers_outside: 'Domain controllers outside the most sensitive zone',
    directory_assets_outside: 'Assets carrying a directory service outside the most sensitive zone',
    trust_raised: 'What runs an asset is in a less sensitive zone',
    applications_on_most_sensitive: 'Applications hosted in the most sensitive zone',
  },
  fr: {
    assets_without_zone: "Actifs sans zone d'administration",
    domain_controllers_outside: 'Contrôleurs de domaine hors de la zone la plus sensible',
    directory_assets_outside: "Actifs portant un service d'annuaire hors de la zone la plus sensible",
    trust_raised: 'Ce qui fait tourner un actif est dans une zone moins sensible',
    applications_on_most_sensitive: 'Applications hébergées dans la zone la plus sensible',
  },
  de: {
    assets_without_zone: 'Assets ohne Administrationszone',
    domain_controllers_outside: 'Domänencontroller außerhalb der sensibelsten Zone',
    directory_assets_outside: 'Assets mit einem Verzeichnisdienst außerhalb der sensibelsten Zone',
    trust_raised: 'Was ein Asset betreibt, liegt in einer weniger sensiblen Zone',
    applications_on_most_sensitive: 'In der sensibelsten Zone gehostete Anwendungen',
  },
  es: {
    assets_without_zone: 'Activos sin zona de administración',
    domain_controllers_outside: 'Controladores de dominio fuera de la zona más sensible',
    directory_assets_outside: 'Activos que llevan un servicio de directorio fuera de la zona más sensible',
    trust_raised: 'Lo que ejecuta un activo está en una zona menos sensible',
    applications_on_most_sensitive: 'Aplicaciones alojadas en la zona más sensible',
  },
};

/** English titles of the controls. The export writes `CONTROL_TITLES_BY_LANGUAGE`. */
export const CONTROL_TITLES: Record<ControlKey, string> = CONTROL_TITLES_BY_LANGUAGE.en;

/** An empty zone, in the words of the grid (`pages.administrationView.noZone`). */
const NO_ZONE_LABEL: Record<CsvLanguage, string> = {
  en: 'No zone',
  fr: 'Sans zone',
  de: 'Keine Zone',
  es: 'Sin zona',
};

/** The sheet of each list's workbook. */
const ASSET_SHEET: Record<CsvLanguage, string> = { en: 'Assets', fr: 'Actifs', de: 'Assets', es: 'Activos' };
const DOMAIN_SHEET: Record<CsvLanguage, string> = { en: 'Domains', fr: 'Domaines', de: 'Domänen', es: 'Dominios' };

/** Directory export headers, one row per language. No comma: the English file splits on it. */
const DOMAIN_CSV_HEADERS: Record<CsvLanguage, string[]> = {
  en: ['Domain', 'DNS suffix', 'Forest', 'Trusts', 'Trusts declared by other domains', 'Number of accounts', 'Number of computers', 'Domain controllers', 'Domain controller servers'],
  fr: ['Domaine', 'Suffixe DNS', 'Forêt', 'Approbations', "Approbations déclarées par d'autres domaines", 'Nombre de comptes', "Nombre d'ordinateurs", 'Contrôleurs de domaine', 'Serveurs contrôleurs de domaine'],
  de: ['Domäne', 'DNS-Suffix', 'Gesamtstruktur', 'Vertrauensstellungen', 'Von anderen Domänen erklärte Vertrauensstellungen', 'Anzahl der Konten', 'Anzahl der Computer', 'Domänencontroller', 'Domänencontroller-Server'],
  es: ['Dominio', 'Sufijo DNS', 'Bosque', 'Confianzas', 'Confianzas declaradas por otros dominios', 'Número de cuentas', 'Número de equipos', 'Controladores de dominio', 'Servidores controladores de dominio'],
};

/** Asset export headers, one row per language, in the words of the screen's columns. */
const ASSET_CSV_HEADERS: Record<CsvLanguage, string[]> = {
  en: ['Zone', 'Reference', 'Name', 'Type', 'Technologies', 'Applications', 'Controls', 'Dependency'],
  fr: ['Zone', 'Référence', 'Nom', 'Type', 'Technologies', 'Applications', 'Contrôles', 'Dépendance'],
  de: ['Zone', 'Referenz', 'Name', 'Typ', 'Technologien', 'Anwendungen', 'Kontrollen', 'Abhängigkeit'],
  es: ['Zona', 'Referencia', 'Nombre', 'Tipo', 'Tecnologías', 'Aplicaciones', 'Controles', 'Dependencia'],
};

/** The direction of a trust in the directory export, in the words of the screen. */
const TRUST_DIRECTION_LABELS: Record<CsvLanguage, Record<DomainTrustDirection, string>> = {
  en: { two_way: 'two-way', outgoing: 'outgoing', incoming: 'incoming' },
  fr: { two_way: 'bidirectionnelle', outgoing: 'sortante', incoming: 'entrante' },
  de: { two_way: 'bidirektional', outgoing: 'ausgehend', incoming: 'eingehend' },
  es: { two_way: 'bidireccional', outgoing: 'saliente', incoming: 'entrante' },
};

/** A trust peer in the asset export, in the words of the screen (`pages.administrationView.trustPeer`). */
const TRUST_RELATION_LABEL: Record<CsvLanguage, Record<'contains' | 'cluster', string>> = {
  en: { contains: 'Runs', cluster: 'Member of cluster' },
  fr: { contains: 'Héberge', cluster: 'Membre du cluster' },
  de: { contains: 'Betreibt', cluster: 'Mitglied des Clusters' },
  es: { contains: 'Ejecuta', cluster: 'Miembro del clúster' },
};

/** Sortable fields. `zone` sorts in catalog order, `kind` by the label of its catalog, see `orderOf`. */
const SORTS: Record<string, string> = {
  name: 'lower(a.name)',
  reference: 'a.asset_reference',
  kind: 'lower(a.kind)',
  zone: "NULLIF(btrim(a.admin_zone), '')",
};

const zoneOf = (alias: string) => `NULLIF(btrim(${alias}.admin_zone), '')`;

export type AdministrationOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

export type AdministrationAssetQuery = {
  q?: unknown;
  limit?: unknown;
  offset?: unknown;
  /** The list grid: page from 1, `field:DIR` sort, and the JSON filter model. */
  page?: unknown;
  sort?: unknown;
  filters?: unknown;
};

export type AdministrationZone = {
  code: string;
  label: string | null;
  description: string | null;
  admin_group: string | null;
  deprecated: boolean;
  /** A zone code an asset or a directory service carries that the catalog no longer has. */
  unknown: boolean;
  asset_counts: Array<{ kind: string; count: number }>;
  /** Distinct applications in service hosted on the assets of the zone. */
  hosted_application_count: number;
  directory_services: Array<{ id: string; reference: string | null; name: string }>;
};

export type AdministrationSummary = {
  /** The first zone of the catalog that is not deprecated, or null when the catalog has none. */
  most_sensitive: string | null;
  zones: AdministrationZone[];
  /** Assets that are not retired and have no zone. */
  without_zone: { asset_count: number };
  /** One entry per control. `count` is null when the control does not apply. */
  controls: Array<{ key: ControlKey; count: number | null }>;
};

export type AdministrationAssetRow = {
  id: string;
  reference: string | null;
  name: string;
  kind: string;
  /** The zone code, or null when the asset has none. */
  zone: string | null;
  technologies: { total: number; items: Array<{ reference: string | null; name: string; version: string | null }> };
  applications: { total: number; items: Array<{ reference: string | null; name: string }> };
  /** The controls that concern this asset, in `CONTROL_KEYS` order. */
  findings: ControlKey[];
  /**
   * For a trust finding, the assets that make this one an asset to raise: the more sensitive assets
   * it contains (`contains`) and the more sensitive clusters it is a member of (`cluster`).
   */
  trust_peers: { total: number; items: TrustPeer[] };
  /** References of the applications that place the asset in `applications_on_most_sensitive`, capped like `applications`. */
  application_references: { total: number; items: string[] };
};

export type TrustPeer = { relation: 'contains' | 'cluster'; reference: string | null; name: string; zone: string | null };

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

export type AdministrationDirectories = {
  services: Array<{ id: string; reference: string | null; name: string; zone: string | null; servers: number }>;
  /** Domains grouped by forest. `forest` null gathers the domains that name none. */
  forests: Array<{ forest: string | null; domains: AdministrationDomain[] }>;
};

type RankCtx = {
  catalog: AdminZoneOption[];
  known: Set<string>;
  /** Non-deprecated catalog codes, in catalog order. A lower index is more sensitive. */
  ranks: string[];
  most: string | null;
  domains: DomainOption[];
  kinds: Map<string, string>;
};

type Markers = { ranks: string; most: string; role: string; family: string; domains: string };

type DirectoryRow = { id: string; item_number: number; name: string; zone: string | null; servers: number };
type AssetPageRow = { id: string; reference: string | null; name: string; kind: string; zone: string | null };
type TechLink = { asset_id: string; item_number: number; name: string; version: string | null };
type AppLink = { asset_id: string; application_id: string; name: string; reference: string | null };
type PeerLink = TrustPeer & { asset_id: string };
type LockRow = {
  id: string; name: string; asset_reference: string | null; kind: string; status: string;
  admin_zone: string | null; updated_at: Date;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

function readModel(raw: unknown): Record<string, any> {
  if (raw == null || raw === '') return {};
  try {
    const model = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, any> : {};
  } catch {
    return {};
  }
}

/** Grid columns the asset list filters on, by filter type. A bulk scope may name these only. */
const TEXT_COLUMNS = ['name', 'reference'];
const SET_COLUMNS = ['zone', 'kind', 'type', 'control'];
const BULK_FILTERS_SHAPE = 'filters must be the asset list request, { q?, filters? }, with filters the grid model as JSON text or an object.';

/**
 * The scope of an assignment to every asset of the filter: the asset list request, `{ q?, filters? }`.
 * Any other key, a flat grid model, a model that does not parse or an entry the list does not apply
 * is a `400` `bulk_filters_invalid`: ignored, it would widen the scope to more assets.
 */
function bulkFilters(raw: unknown): AdministrationAssetQuery {
  const refuse = (message: string): never => {
    throw new BadRequestException({ code: 'bulk_filters_invalid', message });
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse(`${BULK_FILTERS_SHAPE} Send {} for every asset.`);
  const scope = raw as Record<string, unknown>;
  const extra = Object.keys(scope).filter((key) => key !== 'q' && key !== 'filters');
  if (extra.length) return refuse(`Unexpected ${extra.map((key) => `"${key}"`).join(', ')} in filters. ${BULK_FILTERS_SHAPE}`);
  if (scope.q !== undefined && scope.q !== null && typeof scope.q !== 'string') return refuse('filters.q must be text.');
  let model: unknown = scope.filters;
  if (model === undefined || model === null || model === '') return { q: scope.q };
  if (typeof model === 'string') {
    try {
      model = JSON.parse(model);
    } catch {
      return refuse(`filters.filters is not valid JSON. ${BULK_FILTERS_SHAPE}`);
    }
  }
  if (!model || typeof model !== 'object' || Array.isArray(model)) return refuse(`filters.filters must be a grid model object. ${BULK_FILTERS_SHAPE}`);
  for (const [column, entry] of Object.entries(model as Record<string, any>)) {
    const text = TEXT_COLUMNS.includes(column) && entry?.filterType === 'text' && !('conditions' in entry)
      && (entry.type === undefined || typeof entry.type === 'string');
    const set = SET_COLUMNS.includes(column) && entry?.filterType === 'set' && Array.isArray(entry.values);
    if (!text && !set) return refuse(`The asset list does not apply the filter on "${column}". ${BULK_FILTERS_SHAPE}`);
  }
  return { q: scope.q, filters: scope.filters };
}

function setFilter(model: Record<string, any>, column: string): { values: string[]; blank: boolean } | null {
  const entry = model[column];
  if (!entry || entry.filterType !== 'set' || !Array.isArray(entry.values)) return null;
  return {
    values: entry.values.filter((value: unknown): value is string => typeof value === 'string' && value.trim() !== '').map((value: string) => value.trim()),
    blank: entry.values.some((value: unknown) => value === null),
  };
}

function whole(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : fallback;
}

/**
 * Domain controllers: the role on an instance in service, or a directory technology that is not
 * retired. The same definition feeds the domains section and the control.
 */
function domainControllersSql(role: string, family: string, ids?: string): string {
  const only = ids ? `AND a.id = ANY(${ids}::uuid[])` : '';
  return `SELECT DISTINCT a.id AS asset_id
    FROM assets a
    WHERE a.tenant_id = $1 AND a.status <> 'retired'
      ${only}
      AND (
        a.id IN (
          SELECT aa.asset_id FROM (${effectiveAssignmentsSql({ tenant: '$1', assets: ids })}) aa
            JOIN app_instances i ON i.tenant_id = $1 AND i.id = aa.app_instance_id
            JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
           WHERE aa.role = ${role}
        )
        OR EXISTS (
          SELECT 1 FROM asset_technologies at
            JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id
              AND t.family = ${family} AND t.lifecycle <> 'retired'
           WHERE at.tenant_id = $1 AND at.asset_id = a.id
        )
      )`;
}

/**
 * The controllers the domains section lists (`domains`: the codes of the catalog's domains, a
 * `text[]` placeholder) whose zone is not the most sensitive one.
 */
function controllersSql(role: string, family: string, most: string, domains: string, ids?: string): string {
  return `SELECT s.asset_id
    FROM (${domainControllersSql(role, family, ids)}) s
    JOIN assets ax ON ax.tenant_id = $1 AND ax.id = s.asset_id
    WHERE ${zoneOf('ax')} IS DISTINCT FROM ${most}
      AND ax.domain = ANY(${domains}::text[])`;
}

/** The codes of the domains the domains section lists: the catalog's, without the system entries. */
function listedDomainCodes(domains: DomainOption[]): string[] {
  return domains.filter((option) => !option.system).map((option) => option.code);
}

/** Assets with a direct link to a directory technology that is not retired, outside the most sensitive zone. */
function directorySql(family: string, most: string, ids?: string): string {
  const only = ids ? `AND ax.id = ANY(${ids}::uuid[])` : '';
  return `SELECT DISTINCT ax.id AS asset_id
    FROM assets ax
    JOIN asset_technologies at ON at.tenant_id = $1 AND at.asset_id = ax.id
    JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id
      AND t.family = ${family} AND t.lifecycle <> 'retired'
    WHERE ax.tenant_id = $1 AND ax.status <> 'retired'
      AND ${zoneOf('ax')} IS DISTINCT FROM ${most}
      ${only}`;
}

/**
 * Pairs that raise trust. `asset_id` is the asset to raise: the container, or the cluster member.
 * The other columns name its peer: the content, or the cluster. A lower `array_position` in the
 * non-deprecated catalog is more sensitive, the same comparison as the reviewed rule. A zone the
 * array does not hold (missing, deprecated, unknown) drops the pair.
 */
function trustSql(ranks: string): string {
  const ranked = (alias: string) => `array_position(${ranks}, ${zoneOf(alias)})`;
  return `SELECT holder.id AS asset_id, content.asset_reference AS reference, content.name,
              ${zoneOf('content')} AS zone, 'contains'::text AS relation
         FROM asset_relations r
         JOIN assets holder ON holder.tenant_id = $1 AND holder.id = r.asset_id AND holder.status <> 'retired'
         JOIN assets content ON content.tenant_id = $1 AND content.id = r.related_asset_id AND content.status <> 'retired'
        WHERE r.tenant_id = $1 AND r.relation_type = 'contains' AND r.asset_id <> r.related_asset_id
          AND ${ranked('content')} IS NOT NULL AND ${ranked('holder')} IS NOT NULL
          AND ${ranked('content')} < ${ranked('holder')}
        UNION ALL
       SELECT member.id, cluster.asset_reference, cluster.name, ${zoneOf('cluster')}, 'cluster'
         FROM asset_cluster_members m
         JOIN assets cluster ON cluster.tenant_id = $1 AND cluster.id = m.cluster_id AND cluster.status <> 'retired'
         JOIN assets member ON member.tenant_id = $1 AND member.id = m.asset_id AND member.status <> 'retired'
        WHERE m.tenant_id = $1 AND m.cluster_id <> m.asset_id
          AND ${ranked('member')} IS NOT NULL AND ${ranked('cluster')} IS NOT NULL
          AND ${ranked('member')} > ${ranked('cluster')}`;
}

/** Applications in service hosted on assets of the most sensitive zone. One row per assignment. */
function hostedFrom(most: string, ids?: string): string {
  const only = ids ? `AND ax.id = ANY(${ids}::uuid[])` : '';
  return `FROM (${effectiveAssignmentsSql({ tenant: '$1', assets: ids })}) aa
    JOIN assets ax ON ax.tenant_id = $1 AND ax.id = aa.asset_id AND ax.status <> 'retired'
      AND ${zoneOf('ax')} = ${most}
    JOIN app_instances i ON i.tenant_id = $1 AND i.id = aa.app_instance_id
    JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
    WHERE aa.tenant_id = $1 ${only}`;
}

@Injectable()
export class AdministrationViewService {
  constructor(
    private readonly itOps: ItOpsSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Zones with their counts, the assets that have no zone, and the five control counts. */
  async summary(opts: AdministrationOpts): Promise<AdministrationSummary> {
    const ctx = await this.context(opts);
    const { manager: mg, tenantId } = opts;
    const counts: Array<{ zone: string | null; kind: string; count: number }> = await mg.query(
      `SELECT ${zoneOf('a')} AS zone, a.kind, count(*)::int AS count
         FROM assets a
        WHERE a.tenant_id = $1 AND a.status <> 'retired'
        GROUP BY 1, 2`,
      [tenantId],
    );
    const hosted: Array<{ zone: string; count: number }> = await mg.query(
      `SELECT ${zoneOf('a')} AS zone, count(DISTINCT ap.id)::int AS count
         FROM (${effectiveAssignmentsSql({ tenant: '$1' })}) aa
         JOIN assets a ON a.tenant_id = $1 AND a.id = aa.asset_id AND a.status <> 'retired'
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = aa.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
        WHERE aa.tenant_id = $1 AND ${zoneOf('a')} IS NOT NULL
        GROUP BY 1`,
      [tenantId],
    );
    const services = await this.directoryRows(opts);
    const byKind = new Map<string, Map<string, number>>();
    let without = 0;
    for (const row of counts) {
      if (!row.zone) { without += Number(row.count); continue; }
      const kinds = byKind.get(row.zone) ?? new Map<string, number>();
      kinds.set(row.kind, Number(row.count));
      byKind.set(row.zone, kinds);
    }
    const hostedByZone = new Map(hosted.map((row) => [row.zone, Number(row.count)]));
    const servicesByZone = new Map<string, AdministrationZone['directory_services']>();
    for (const row of services) {
      if (!row.zone) continue;
      const list = servicesByZone.get(row.zone) ?? [];
      list.push({ id: row.id, reference: technologyReference(row.item_number), name: row.name });
      servicesByZone.set(row.zone, list);
    }
    const zone = (option: AdminZoneOption | null, code: string, unknown = false): AdministrationZone => {
      const kinds = byKind.get(code) ?? new Map<string, number>();
      return {
        code,
        label: option?.label ?? code,
        description: option?.description ?? null,
        admin_group: option?.admin_group ?? null,
        deprecated: !!option?.deprecated,
        unknown,
        asset_counts: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind)),
        hosted_application_count: hostedByZone.get(code) ?? 0,
        directory_services: servicesByZone.get(code) ?? [],
      };
    };
    const zones = ctx.catalog
      .filter((option) => !option.deprecated || byKind.has(option.code) || servicesByZone.has(option.code))
      .map((option) => zone(option, option.code));
    const stray = new Set<string>([
      ...[...byKind.keys()].filter((code) => !ctx.known.has(code)),
      ...[...servicesByZone.keys()].filter((code) => !ctx.known.has(code)),
    ]);
    for (const code of [...stray].sort()) zones.push(zone(null, code, true));
    return { most_sensitive: ctx.most, zones, without_zone: { asset_count: without }, controls: await this.controlCounts(opts, ctx) };
  }

  /**
   * One page of the assets that are not retired, in the grid's order. Technologies and applications
   * are the direct links, capped, loaded for the page only. Findings use the same SQL as the counts.
   */
  async assets(query: AdministrationAssetQuery, opts: AdministrationOpts): Promise<{
    items: AdministrationAssetRow[]; total: number; limit: number; offset: number; page: number;
  }> {
    const ctx = await this.context(opts);
    const { limit, offset, page } = this.pageOf(query);
    const params: unknown[] = [opts.tenantId];
    const where = this.whereOf(query, ctx, params);
    // The order may bind the catalog: the count statement keeps the parameters it names.
    const pageParams = [...params];
    const order = this.orderOf(query.sort, ctx, pageParams);
    const [counted] = await opts.manager.query(
      `SELECT count(*)::int AS n FROM assets a WHERE ${where}`,
      params,
    );
    const total = Number(counted?.n ?? 0);
    const rows: AssetPageRow[] = total === 0 ? [] : await opts.manager.query(
      `SELECT a.id, a.asset_reference AS reference, a.name, a.kind, ${zoneOf('a')} AS zone
         FROM assets a
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset}`,
      pageParams,
    );
    return { items: await this.decorate(opts, ctx, rows, LINK_CAP), total, limit, offset, page };
  }

  /**
   * Sets the administration zone of many assets: the chosen ones (`ids`), or every asset the list's
   * filters reach (`all: true`, with `filters` the list request, see `bulkFilters`), less the ones
   * the user unticked (`exclude_ids`). The chosen assets are taken as they are. `dry_run` counts without writing and returns `as_of`. The write that
   * sends it back changes only the assets created by then, and refuses when the locked rows are
   * more than `expected_rows` (`409` `bulk_list_changed`). More than `BULK_MAX_ROWS` is a `400`
   * `bulk_too_many`. Each changed asset is audited on `assets`. The UPDATE leaves the `search_index`
   * trigger of the assets in place.
   */
  async assignZone(body: Record<string, unknown>, opts: AdministrationOpts): Promise<
    { ok: true; rows: number; changed: number } | { ok: true; dry_run: true; rows: number; changes: number; as_of: string }
  > {
    const { manager: mg, tenantId } = opts;
    // A write locks the catalog as the change of one asset does: a settings save that retires the
    // zone waits for the assignment, or the assignment sees the saved catalog.
    const ctx = await this.context(opts, body.dry_run !== true);
    const zone = this.resolveZone(body, ctx.catalog);
    const all = body.all === true;
    const rowIds = (name: 'ids' | 'exclude_ids'): string[] => {
      const raw = body[name];
      if (raw === undefined || raw === null) return [];
      if (!Array.isArray(raw)) throw new BadRequestException(`${name} must be a list of asset ids.`);
      const ids = Array.from(new Set(raw.map((value) => String(value ?? '').trim().toLowerCase())));
      if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException(`${name} must be asset ids.`);
      if (ids.length > BULK_MAX_ROWS) {
        throw new BadRequestException({ code: 'bulk_too_many', message: `At most ${BULK_MAX_ROWS} rows at once: narrow the filters.` });
      }
      return ids;
    };
    const ids = rowIds('ids');
    const excluded = rowIds('exclude_ids');
    if (all && ids.length > 0) throw new BadRequestException('Send the chosen rows (ids) or every row of the filter (all: true), not both.');
    if (!all && excluded.length > 0) throw new BadRequestException('exclude_ids goes with all: true.');
    if (!all && ids.length === 0) throw new BadRequestException('Choose the rows (ids), or every row of the filter (all: true).');
    const params: unknown[] = [tenantId];
    let where: string;
    if (all) {
      where = this.whereOf(bulkFilters(body.filters), ctx, params);
      if (excluded.length > 0) {
        params.push(excluded);
        where += ` AND a.id <> ALL($${params.length}::uuid[])`;
      }
    } else {
      params.push(ids);
      where = `a.tenant_id = $1 AND a.status <> 'retired' AND a.id = ANY($${params.length}::uuid[])`;
    }
    if (all && body.dry_run !== true && (body.as_of === undefined || body.as_of === null)) {
      throw new BadRequestException('as_of is required with all: send the instant the dry run returned.');
    }
    let expectedRows: number | null = null;
    if (body.expected_rows !== undefined && body.expected_rows !== null) {
      expectedRows = Number(body.expected_rows);
      if (!Number.isSafeInteger(expectedRows) || expectedRows < 0) throw new BadRequestException('expected_rows must be the rows the dry run counted.');
    } else if (all && body.dry_run !== true) {
      throw new BadRequestException('expected_rows is required with all: send the rows the dry run counted.');
    }
    if (body.as_of !== undefined && body.as_of !== null) {
      const asOf = new Date(String(body.as_of));
      if (Number.isNaN(asOf.getTime())) throw new BadRequestException('as_of must be the instant a dry run returned.');
      params.push(asOf.toISOString());
      where += ` AND a.created_at <= $${params.length}::timestamptz`;
    }
    const scopeParams = [...params];
    params.push(zone);
    const zoneParam = `$${params.length}`;
    const [count] = await mg.query(
      `SELECT count(*)::int AS rows,
              count(*) FILTER (WHERE a.admin_zone IS DISTINCT FROM ${zoneParam})::int AS changes
         FROM assets a
        WHERE ${where}`,
      params,
    );
    const rows = Number(count?.rows ?? 0);
    if (rows > BULK_MAX_ROWS) {
      throw new BadRequestException({ code: 'bulk_too_many', message: `These filters reach ${rows} rows, more than ${BULK_MAX_ROWS} at once: narrow them.` });
    }
    if (body.dry_run === true) {
      const [{ as_of: asOf }] = await mg.query(`SELECT clock_timestamp() AS as_of`);
      return { ok: true, dry_run: true, rows, changes: Number(count?.changes ?? 0), as_of: new Date(asOf).toISOString() };
    }

    const before: LockRow[] = await mg.query(
      `SELECT a.id, a.name, a.asset_reference, a.kind, a.status, a.admin_zone, a.updated_at
         FROM assets a
        WHERE ${where}
        ORDER BY a.id
        FOR UPDATE OF a`,
      scopeParams,
    );
    if (expectedRows !== null && before.length > expectedRows) {
      throw new ConflictException({ code: 'bulk_list_changed', message: 'The list changed since the count: count again.' });
    }
    const toChange = before.filter((row) => row.admin_zone !== zone);
    let changed = 0;
    for (let i = 0; i < toChange.length; i += BULK_BATCH) {
      const batch = toChange.slice(i, i + BULK_BATCH);
      // An UPDATE answers [rows, rowCount], RETURNING included.
      const [afterRows] = await mg.query(
        `UPDATE assets
            SET admin_zone = $3, updated_at = clock_timestamp()
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])
          RETURNING id, name, asset_reference, kind, status, admin_zone, updated_at`,
        [tenantId, batch.map((row) => row.id), zone],
      );
      const afterById = new Map((afterRows as LockRow[]).map((row) => [String(row.id), row]));
      for (const row of batch) {
        const after = afterById.get(String(row.id));
        if (!after) continue;
        await this.audit.log(
          { table: 'assets', recordId: String(row.id), action: 'update', before: this.snapshot(row), after: this.snapshot(after), userId: opts.userId ?? null },
          { manager: mg },
        );
        changed += 1;
      }
    }
    return { ok: true, rows, changed };
  }

  /** Directory services, and the domains of the catalog grouped by forest. No link between the two is stored. */
  async directories(opts: AdministrationOpts): Promise<AdministrationDirectories> {
    const ctx = await this.context(opts);
    const services = await this.directoryRows(opts);
    const domains = await this.domains(opts, ctx.domains);
    // A forest is a DNS name: grouped without case, under the spelling of its first domain.
    const groups = new Map<string | null, AdministrationDirectories['forests'][number]>();
    for (const domain of domains) {
      const forest = domain.forest && domain.forest.trim() ? domain.forest.trim() : null;
      const key = forest === null ? null : forest.toLowerCase();
      const group = groups.get(key) ?? { forest, domains: [] };
      group.domains.push(domain);
      groups.set(key, group);
    }
    const forests = [...groups.values()]
      .sort((a, b) => (a.forest === null ? 1 : b.forest === null ? -1 : a.forest.localeCompare(b.forest, undefined, { sensitivity: 'base' })));
    return {
      services: services.map((row) => ({
        id: row.id,
        reference: technologyReference(row.item_number),
        name: row.name,
        zone: row.zone,
        servers: Number(row.servers),
      })),
      forests,
    };
  }

  /**
   * One list as a CSV file or a workbook of one sheet (`format`). `list=domains` is the domains.
   * `list=assets` (the default) is every asset the asset list's filters reach, in the list's order.
   * A text cell gets the formula guard; the domains' counts are numbers.
   */
  async csv<F extends ExportFileFormat = 'csv'>(query: Record<string, unknown>, opts: AdministrationOpts, format?: F): Promise<ListExportFile<F>> {
    const list = query.list === undefined || query.list === '' ? 'assets' : String(query.list);
    const fileFormat = format ?? ('csv' as F);
    if (list === 'domains') return this.domainsCsv(query, opts, fileFormat);
    if (list !== 'assets') throw new BadRequestException('list must be assets or domains.');
    return this.assetsCsv(query, opts, fileFormat);
  }

  private async context(opts: AdministrationOpts, forWrite = false): Promise<RankCtx> {
    const settings = forWrite
      ? await this.itOps.getSettingsForWrite(opts.tenantId, opts.manager)
      : await this.itOps.getSettings(opts.tenantId, { manager: opts.manager });
    const catalog = settings.adminZones ?? [];
    const ranks = catalog.filter((option) => !option.deprecated).map((option) => option.code);
    return {
      catalog,
      known: new Set(catalog.map((option) => option.code)),
      ranks,
      most: ranks[0] ?? null,
      domains: settings.domains ?? [],
      kinds: new Map((settings.serverKinds ?? []).map((option) => [option.code, option.label])),
    };
  }

  private async controlCounts(opts: AdministrationOpts, ctx: RankCtx): Promise<AdministrationSummary['controls']> {
    const params: unknown[] = [opts.tenantId];
    const bare = `SELECT count(*)::int AS assets_without_zone,
             NULL::int AS domain_controllers_outside,
             NULL::int AS directory_assets_outside,
             NULL::int AS trust_raised,
             NULL::int AS applications_on_most_sensitive`;
    let sql = `${bare}
      FROM assets a
      WHERE a.tenant_id = $1 AND a.status <> 'retired' AND ${zoneOf('a')} IS NULL`;
    // The four controls that name the most sensitive zone do not apply when the catalog has none.
    if (ctx.most) {
      const m = this.markers(params, ctx);
      sql = `SELECT
        (SELECT count(*)::int FROM assets a WHERE a.tenant_id = $1 AND a.status <> 'retired' AND ${zoneOf('a')} IS NULL) AS assets_without_zone,
        (SELECT count(*)::int FROM (${controllersSql(m.role, m.family, m.most, m.domains)}) s) AS domain_controllers_outside,
        (SELECT count(*)::int FROM (${directorySql(m.family, m.most)}) s) AS directory_assets_outside,
        (SELECT count(DISTINCT asset_id)::int FROM (${trustSql(m.ranks)}) s) AS trust_raised,
        (SELECT count(DISTINCT ax.id)::int ${hostedFrom(m.most)}) AS applications_on_most_sensitive`;
    }
    const [row] = await opts.manager.query(sql, params);
    const count = (key: ControlKey): number | null => (ctx.most || key === 'assets_without_zone' ? Number(row?.[key] ?? 0) : null);
    return CONTROL_KEYS.map((key) => ({ key, count: count(key) }));
  }

  /** Directory technologies that are not retired, with the number of assets that carry them directly. */
  private async directoryRows(opts: AdministrationOpts): Promise<DirectoryRow[]> {
    return opts.manager.query(
      `SELECT t.id, t.item_number, t.name, ${zoneOf('t')} AS zone,
              count(DISTINCT a.id)::int AS servers
         FROM technologies t
         LEFT JOIN asset_technologies at ON at.tenant_id = $1 AND at.technology_id = t.id
         LEFT JOIN assets a ON a.tenant_id = $1 AND a.id = at.asset_id AND a.status <> 'retired'
        WHERE t.tenant_id = $1 AND t.lifecycle <> 'retired' AND t.family = $2
        GROUP BY t.id, t.item_number, t.name, t.admin_zone
        ORDER BY lower(t.name), t.item_number`,
      [opts.tenantId, DIRECTORY_FAMILY],
    );
  }

  private async domains(opts: AdministrationOpts, catalog: DomainOption[]): Promise<AdministrationDomain[]> {
    const { manager: mg, tenantId } = opts;
    const listed = catalog.filter((option) => !option.system);
    if (!listed.length) return [];
    const controllers: Array<{ domain: string; id: string; name: string; asset_reference: string | null }> = await mg.query(
      `SELECT a.domain, a.id, a.name, a.asset_reference
         FROM assets a
        WHERE a.tenant_id = $1 AND a.domain = ANY($2::text[]) AND a.status <> 'retired'
          AND a.id IN (SELECT asset_id FROM (${domainControllersSql('$3', '$4')}) s)
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

  private markers(params: unknown[], ctx: RankCtx): Markers {
    params.push(ctx.ranks);
    const ranks = `$${params.length}::text[]`;
    params.push(ctx.most);
    const most = `$${params.length}`;
    params.push(DOMAIN_CONTROLLER_ROLE);
    const role = `$${params.length}`;
    params.push(DIRECTORY_FAMILY);
    const family = `$${params.length}`;
    params.push(listedDomainCodes(ctx.domains));
    const domains = `$${params.length}`;
    return { ranks, most, role, family, domains };
  }

  /** The WHERE of the asset list, on `a`. The same clause scopes a bulk assignment of the filter. */
  private whereOf(query: AdministrationAssetQuery, ctx: RankCtx, params: unknown[]): string {
    const model = readModel(query.filters);
    assertSetFilterModes(model);
    const parts = [`a.tenant_id = $1`, `a.status <> 'retired'`];
    const push = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const q = String(query.q ?? '').trim();
    if (q) {
      const like = push(`%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      parts.push(`(a.name ILIKE ${like} OR a.asset_reference ILIKE ${like})`);
    }
    const json = typeof query.filters === 'string' ? query.filters : JSON.stringify(model);
    for (const [column, expr] of [['name', 'a.name'], ['reference', 'a.asset_reference']] as const) {
      const clause = gridTextClause(expr, gridTextModel(json, column), push);
      if (clause) parts.push(clause);
    }
    const zone = setFilter(model, 'zone');
    if (zone) parts.push(this.setClause(zoneOf('a'), zone, push));
    const kind = setFilter(model, 'kind') ?? setFilter(model, 'type');
    if (kind) parts.push(this.setClause('a.kind', kind, push));
    const control = setFilter(model, 'control');
    if (control) {
      const keys = control.values.filter((value): value is ControlKey => (CONTROL_KEYS as readonly string[]).includes(value));
      if (!keys.length) parts.push('false');
      else parts.push(this.controlClause(keys, ctx, params));
    }
    return parts.join(' AND ');
  }

  /** A set filter. `null` among the values matches an empty column. An empty selection matches nothing. */
  private setClause(expr: string, filter: { values: string[]; blank: boolean }, push: (value: unknown) => string): string {
    const parts: string[] = [];
    if (filter.values.length) parts.push(`${expr} = ANY(${push(filter.values)}::text[])`);
    if (filter.blank) parts.push(`${expr} IS NULL`);
    return parts.length ? `(${parts.join(' OR ')})` : 'false';
  }

  /**
   * One arm per selected control. Parameters are appended only when that arm uses them, in order,
   * so a filter on one control does not leave an untyped gap in the bind list.
   */
  private controlClause(keys: ControlKey[], ctx: RankCtx, params: unknown[]): string {
    const ranked = keys.some((key) => key !== 'assets_without_zone');
    if (ranked && !ctx.most) {
      return `(${keys.map((key) => (key === 'assets_without_zone' ? `${zoneOf('a')} IS NULL` : 'false')).join(' OR ')})`;
    }
    const bind = (value: unknown, cast: string) => {
      params.push(value);
      return `$${params.length}::${cast}`;
    };
    const ranks = keys.includes('trust_raised') ? bind(ctx.ranks, 'text[]') : null;
    const most = keys.some((key) => key !== 'assets_without_zone' && key !== 'trust_raised') ? bind(ctx.most, 'text') : null;
    const role = keys.includes('domain_controllers_outside') ? bind(DOMAIN_CONTROLLER_ROLE, 'text') : null;
    const family = keys.includes('directory_assets_outside') || keys.includes('domain_controllers_outside')
      ? bind(DIRECTORY_FAMILY, 'text')
      : null;
    const domains = keys.includes('domain_controllers_outside') ? bind(listedDomainCodes(ctx.domains), 'text[]') : null;
    const parts = keys.map((key) => {
      if (key === 'assets_without_zone') return `${zoneOf('a')} IS NULL`;
      if (key === 'domain_controllers_outside') return `a.id IN (${controllersSql(role!, family!, most!, domains!)})`;
      if (key === 'directory_assets_outside') return `a.id IN (${directorySql(family!, most!)})`;
      if (key === 'trust_raised') return `a.id IN (SELECT asset_id FROM (${trustSql(ranks!)}) pairs)`;
      return `a.id IN (SELECT DISTINCT ax.id ${hostedFrom(most!)})`;
    });
    return `(${parts.join(' OR ')})`;
  }

  /**
   * The ORDER BY of the asset list. `zone` follows the catalog order (deprecated zones at their
   * place), then the codes the catalog does not have, by code; assets without a zone come last in
   * both directions. `kind` follows the labels of the asset type catalog, then the codes the
   * catalog does not have, by code. The catalog is bound on `params`.
   */
  private orderOf(sort: unknown, ctx: RankCtx, params: unknown[]): string {
    const [rawField, rawDir] = String(sort ?? '').split(':');
    const field = rawField === 'type' ? 'kind' : rawField;
    if (field && !Object.prototype.hasOwnProperty.call(SORTS, field)) {
      throw new BadRequestException('sort must be name, reference, kind or zone.');
    }
    const direction = String(rawDir ?? '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    if (field === 'zone') {
      params.push(ctx.catalog.map((option) => option.code));
      const zone = zoneOf('a');
      return `(${zone} IS NULL) ASC, array_position($${params.length}::text[], ${zone}) ${direction} NULLS LAST, ${zone} ${direction}, lower(a.name) ASC, a.id ASC`;
    }
    if (field === 'kind') {
      params.push([...ctx.kinds.entries()]
        .sort(([codeA, labelA], [codeB, labelB]) => (labelA || codeA).localeCompare(labelB || codeB, undefined, { sensitivity: 'base' }) || codeA.localeCompare(codeB))
        .map(([code]) => code));
      return `array_position($${params.length}::text[], a.kind) ${direction} NULLS LAST, ${SORTS.kind} ${direction}, lower(a.name) ASC, a.id ASC`;
    }
    const primary = field ? `${SORTS[field]} ${direction} NULLS LAST` : `${SORTS.name} ASC`;
    return field && field !== 'name' ? `${primary}, lower(a.name) ASC, a.id ASC` : `${primary}, a.id ASC`;
  }

  private pageOf(query: AdministrationAssetQuery): { limit: number; offset: number; page: number } {
    const limit = Math.max(whole(query.limit, 50, 200), 1);
    const offset = query.offset !== undefined
      ? whole(query.offset, 0, 1_000_000_000)
      : Math.max(whole(query.page, 1, 10_000_000) - 1, 0) * limit;
    return { limit, offset, page: Math.floor(offset / limit) + 1 };
  }

  /** Technologies, applications, findings and trust peers of these assets. `cap` null keeps every link (the export). */
  private async decorate(opts: AdministrationOpts, ctx: RankCtx, rows: AssetPageRow[], cap: number | null): Promise<AdministrationAssetRow[]> {
    if (!rows.length) return [];
    const { manager: mg, tenantId } = opts;
    const ids = rows.map((row) => row.id);
    const technologies: TechLink[] = await mg.query(
      `SELECT at.asset_id, t.item_number, t.name, v.label AS version
         FROM asset_technologies at
         JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id
         LEFT JOIN technology_versions v ON v.tenant_id = $1 AND v.id = at.technology_version_id
        WHERE at.tenant_id = $1 AND at.asset_id = ANY($2::uuid[])
        ORDER BY at.asset_id, lower(t.name), t.item_number, lower(coalesce(v.label, '')), at.id`,
      [tenantId, ids],
    );
    const applications: AppLink[] = await mg.query(
      `SELECT DISTINCT aa.asset_id, ap.id AS application_id, ap.name, ap.sequential_id AS reference
         FROM (${effectiveAssignmentsSql({ tenant: '$1', assets: '$2' })}) aa
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = aa.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}`,
      [tenantId, ids],
    );
    const techByAsset = new Map<string, TechLink[]>();
    for (const link of technologies) {
      const list = techByAsset.get(link.asset_id) ?? [];
      list.push(link);
      techByAsset.set(link.asset_id, list);
    }
    const appsByAsset = new Map<string, AppLink[]>();
    for (const link of applications) {
      const list = appsByAsset.get(link.asset_id) ?? [];
      list.push(link);
      appsByAsset.set(link.asset_id, list);
    }
    for (const list of appsByAsset.values()) {
      list.sort((a, b) => byName(a, b) || (a.reference ?? '').localeCompare(b.reference ?? '') || a.application_id.localeCompare(b.application_id));
    }

    const controllers = new Set<string>();
    const directories = new Set<string>();
    const peers = new Map<string, PeerLink[]>();
    if (ctx.most) {
      // Each statement binds only the parameters it names. A hole in $1..$n is untyped.
      const controllerRows: Array<{ asset_id: string }> = await mg.query(
        `SELECT asset_id FROM (${controllersSql('$4', '$5', '$3', '$6', '$2')}) s`,
        [tenantId, ids, ctx.most, DOMAIN_CONTROLLER_ROLE, DIRECTORY_FAMILY, listedDomainCodes(ctx.domains)],
      );
      for (const row of controllerRows) controllers.add(row.asset_id);
      const directoryRows: Array<{ asset_id: string }> = await mg.query(
        `SELECT asset_id FROM (${directorySql('$4', '$3', '$2')}) s`,
        [tenantId, ids, ctx.most, DIRECTORY_FAMILY],
      );
      for (const row of directoryRows) directories.add(row.asset_id);
      const trustParams: unknown[] = [tenantId, ids, ctx.ranks];
      const pairs: PeerLink[] = await mg.query(
        `SELECT asset_id, reference, name, zone, relation
           FROM (${trustSql(`$3::text[]`)}) pairs
          WHERE asset_id = ANY($2::uuid[])`,
        trustParams,
      );
      for (const pair of pairs) {
        const list = peers.get(pair.asset_id) ?? [];
        list.push(pair);
        peers.set(pair.asset_id, list);
      }
      for (const list of peers.values()) {
        list.sort((a, b) => byName(a, b) || (a.reference ?? '').localeCompare(b.reference ?? '') || a.relation.localeCompare(b.relation));
      }
    }

    const take = <T>(list: T[]): { total: number; items: T[] } => ({ total: list.length, items: cap == null ? list : list.slice(0, cap) });
    return rows.map((row) => {
      const techs = techByAsset.get(row.id) ?? [];
      const apps = appsByAsset.get(row.id) ?? [];
      const trust = peers.get(row.id) ?? [];
      const findings: ControlKey[] = [];
      if (!row.zone) findings.push('assets_without_zone');
      if (controllers.has(row.id)) findings.push('domain_controllers_outside');
      if (directories.has(row.id)) findings.push('directory_assets_outside');
      if (trust.length) findings.push('trust_raised');
      const onMost = !!ctx.most && row.zone === ctx.most && apps.length > 0;
      if (onMost) findings.push('applications_on_most_sensitive');
      return {
        id: row.id,
        reference: row.reference,
        name: row.name,
        kind: row.kind,
        zone: row.zone,
        technologies: take(techs.map((link) => ({ reference: technologyReference(link.item_number), name: link.name, version: link.version }))),
        applications: take(apps.map((link) => ({ reference: link.reference, name: link.name }))),
        findings,
        trust_peers: take(trust.map((link) => ({ relation: link.relation, reference: link.reference, name: link.name, zone: link.zone }))),
        application_references: take(onMost ? apps.map((link) => link.reference).filter((reference): reference is string => !!reference) : []),
      };
    });
  }

  private resolveZone(body: Record<string, unknown>, catalog: AdminZoneOption[]): string | null {
    if (!Object.prototype.hasOwnProperty.call(body, 'zone')) {
      throw new BadRequestException('zone is required: a zone code, or null to clear it.');
    }
    const value = body.zone;
    if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
    if (typeof value !== 'string') throw new BadRequestException('zone must be a zone code or null.');
    const option = findCatalogOption(value, catalog);
    if (!option) throw new BadRequestException(`Unknown administration zone: ${value.trim()}.`);
    if (option.deprecated) throw new BadRequestException(`The administration zone "${option.code}" is deprecated.`);
    return option.code;
  }

  private snapshot(row: LockRow): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      asset_reference: row.asset_reference,
      kind: row.kind,
      status: row.status,
      admin_zone: row.admin_zone,
      updated_at: row.updated_at,
    };
  }

  private async assetsCsv<F extends ExportFileFormat>(query: Record<string, unknown>, opts: AdministrationOpts, format: F): Promise<ListExportFile<F>> {
    const ctx = await this.context(opts);
    const params: unknown[] = [opts.tenantId];
    const where = this.whereOf(query, ctx, params);
    const pageParams = [...params];
    const order = this.orderOf(query.sort, ctx, pageParams);
    const [counted] = await opts.manager.query(`SELECT count(*)::int AS n FROM assets a WHERE ${where}`, params);
    const total = Number(counted?.n ?? 0);
    if (total > EXPORT_MAX_ROWS) {
      throw new BadRequestException({ code: 'export_too_many', message: `More than ${EXPORT_MAX_ROWS} rows match: narrow the filters to export them.` });
    }
    const rows: AssetPageRow[] = total === 0 ? [] : await opts.manager.query(
      `SELECT a.id, a.asset_reference AS reference, a.name, a.kind, ${zoneOf('a')} AS zone
         FROM assets a
        WHERE ${where}
        ORDER BY ${order}`,
      pageParams,
    );
    const items = await this.decorate(opts, ctx, rows, null);
    const language = await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, query.language);
    const headers = ASSET_CSV_HEADERS[language] ?? ASSET_CSV_HEADERS.en;
    const controlTitles = CONTROL_TITLES_BY_LANGUAGE[language] ?? CONTROL_TITLES_BY_LANGUAGE.en;
    const relations = TRUST_RELATION_LABEL[language] ?? TRUST_RELATION_LABEL.en;
    // Shipped values in the file's language, as the screen shows them; a label the tenant typed stays as it is.
    const zoneLabel = (code: string | null) => {
      if (!code) return NO_ZONE_LABEL[language];
      const option = ctx.catalog.find((entry) => entry.code === code);
      return option ? shippedLabelIn('adminZones', option, language) ?? (option.label || code) : code;
    };
    const kindLabel = (code: string) => {
      const label = ctx.kinds.get(code);
      return label === undefined ? code : shippedLabelIn('serverKinds', { code, label }, language) ?? label;
    };
    const lines = items.map((item) => [
      zoneLabel(item.zone),
      item.reference ?? '',
      item.name,
      kindLabel(item.kind),
      item.technologies.items.map((link) => `${link.reference ?? ''} ${link.name}${link.version ? ` (${link.version})` : ''}`.trim()).join('; '),
      item.applications.items.map((link) => `${link.reference ? `${link.reference} ` : ''}${link.name}`.trim()).join('; '),
      item.findings.map((key) => controlTitles[key]).join('; '),
      item.trust_peers.items.map((link) => {
        const who = [link.reference, link.name].filter(Boolean).join(' ');
        return `${relations[link.relation]} ${who} (${zoneLabel(link.zone)})`.trim();
      }).join('; '),
    ]);
    return writeListExport({ format, language, filename: 'administration_view_assets.csv', sheetNames: ASSET_SHEET, headers, rows: lines });
  }

  private async domainsCsv<F extends ExportFileFormat>(query: Record<string, unknown>, opts: AdministrationOpts, format: F): Promise<ListExportFile<F>> {
    const ctx = await this.context(opts);
    const domains = await this.domains(opts, ctx.domains);
    const language = await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, query.language);
    const headers = DOMAIN_CSV_HEADERS[language] ?? DOMAIN_CSV_HEADERS.en;
    const direction = TRUST_DIRECTION_LABELS[language] ?? TRUST_DIRECTION_LABELS.en;
    const rows = domains.map((domain) => [
      domain.label,
      domain.dns_suffix,
      domain.forest ?? '',
      domain.trusts.map((trust) => `${trust.label} (${direction[trust.direction]})`).join(', '),
      domain.declared_by.map((trust) => `${trust.label} (${direction[trust.direction]})`).join(', '),
      numberCell(domain.account_count),
      numberCell(domain.machine_count),
      numberCell(domain.domain_controllers.length),
      domain.domain_controllers.map((server) => server.name).join(', '),
    ]);
    return writeListExport({ format, language, filename: 'administration_view_domains.csv', sheetNames: DOMAIN_SHEET, headers, rows });
  }
}
