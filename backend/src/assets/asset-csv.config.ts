import { assetEnvironmentCode } from './asset-environments';
import { findCatalogOption, requireImportCatalogs, resolveCatalogCode } from '../it-ops-settings/catalog-resolve';
import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvFieldType,
  CsvImportContext,
  CsvImportRow,
} from '../common/csv';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { AuditLog } from '../audit/audit.entity';
import { AuditService } from '../audit/audit.service';
import { ItOpsSettings, ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../technologies/catalog/technology-catalog.service';
import { OperatingSystemService } from '../technologies/operating-system.service';
import { vulnerabilityCsvFields } from '../vulnerabilities/vulnerability-list-column';
import { isValidHostname } from './hostname.util';
import { isValidIpAddress } from './ip-address.util';
import { operatingSystemLabelSql } from '../technologies/operating-system-codes';
import type { NotificationsService } from '../notifications/notifications.service';
import { Asset } from './asset.entity';
import { AssetClusterMember } from './asset-cluster-member.entity';
import { AssetsCrudService } from './services/assets-crud.service';
import type { AssetsValidationService } from './services/assets-validation.service';
import {
  assetBadRequest,
  assetFqdnOf,
  assetIdentityHolders,
  assetNameKey,
  clusterMembershipsOf,
  clusterOsWithMembersRefusal,
  clusterSwitchRefusals,
  clustersWithMembers,
  codedRowError,
  osClusterWithMembersRefusal,
  type ClusterSwitch,
} from './asset-rules';

/**
 * The operating system is not a column. `beforeCommit` keeps the text here and takes it off the
 * row before TypeORM saves; `afterCommit` resolves it into the marked link (`source` `import`).
 * The same object goes from the hook to the save, so a WeakMap holds the text across that.
 */
const pendingOperatingSystems = new WeakMap<object, string | null>();

/** The resolver, built on the import's manager. `labelsOf` needs none of the collaborators. */
function operatingSystemWriter(context: CsvImportContext): OperatingSystemService {
  const audit = new AuditService(context.manager.getRepository(AuditLog));
  const itOps = {
    getSettings: async () => {
      if (!context.itOpsSettings) throw new Error('IT settings are required to import an operating system.');
      return context.itOpsSettings;
    },
  } as unknown as ItOpsSettingsService;
  return new OperatingSystemService(audit, itOps, new TechnologyCatalogService(audit, itOps));
}

/**
 * The Cluster Membership column names the real clusters of an asset; it is not a column either
 * (the legacy `assets.cluster` text is never read nor written). `afterValidate` resolves the names
 * and keeps the result per import (`clusterCells`); `beforeCommit` moves the names of each saved
 * row here; `afterCommit` writes the memberships through `replaceClusterMembers`.
 */
const pendingClusters = new WeakMap<object, string[]>();

type ImportRow = Parameters<NonNullable<CsvEntityConfig['afterValidate']>>[0][number];

/** Per import: the names of each matched asset's cell, and each checked row's resolved clusters (`null`: one the file creates). */
const clusterCells = new WeakMap<CsvImportContext, {
  matched: Set<string>;
  namesByAsset: Map<string, string[]>;
  resolved: WeakMap<ImportRow, Array<string | null>>;
}>();

/** The names of a Cluster Membership cell: comma separated, trimmed, without repeats (case ignored). */
function clusterNames(raw: unknown): string[] {
  if (raw == null) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of String(raw).split(',')) {
    const name = part.trim();
    const key = nameKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function nameKey(name: unknown): string {
  return String(name ?? '').trim().toLowerCase();
}

/** The writer of the memberships, built on the import's manager. `replaceClusterMembers` uses neither validation nor notifications. */
function clusterMemberWriter(context: CsvImportContext): AssetsCrudService {
  return new AssetsCrudService(
    context.manager.getRepository(Asset),
    context.manager.getRepository(AssetClusterMember),
    new AuditService(context.manager.getRepository(AuditLog)),
    undefined as unknown as AssetsValidationService,
    undefined as unknown as NotificationsService,
    operatingSystemWriter(context),
  );
}

/** Whether the import writes the row (no error, not skipped by the operation). */
function isWritten(row: ImportRow, context: CsvImportContext): boolean {
  if (row.errors.length > 0) return false;
  const operation = context.params.operation;
  return row.isInsert ? operation !== 'update_only' : operation !== 'insert_only';
}

function hasCell(row: ImportRow, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row.parsed, key);
}

/**
 * The Cluster Membership cells, at the check as at the load, against the assets as the file
 * leaves them (stored, then the file's names, Cluster switches and operating systems, new rows
 * included). Each name must be exactly one cluster of the tenant (case ignored). Row errors:
 * - the row names itself (`cluster_member_self`), the row is or becomes a cluster
 *   (`cluster_member_is_cluster`);
 * - per name: unknown (`CSV_CLUSTER_NOT_FOUND`), several clusters (`CSV_CLUSTER_AMBIGUOUS`), an
 *   asset that is not a cluster (`CSV_CLUSTER_NOT_A_CLUSTER`), a cluster that carries an
 *   operating system (`cluster_os_with_members`: the import never removes one).
 * An empty cell names nothing and is not checked.
 */
async function checkClusterMemberships(rows: ImportRow[], context: CsvImportContext): Promise<void> {
  const written = rows.filter((row) => isWritten(row, context));
  const naming = written.filter((row) => hasCell(row, 'cluster') && clusterNames(row.parsed.cluster).length > 0);
  const state = { matched: new Set<string>(), namesByAsset: new Map<string, string[]>(), resolved: new WeakMap<ImportRow, Array<string | null>>() };
  clusterCells.set(context, state);
  for (const row of written) {
    if (row.isInsert || !row.existingEntity?.id) continue;
    state.matched.add(String(row.existingEntity.id));
    if (hasCell(row, 'cluster')) state.namesByAsset.set(String(row.existingEntity.id), clusterNames(row.parsed.cluster));
  }
  if (naming.length === 0) return;

  type Candidate = { id: string | null; row: ImportRow | null; name: string; isCluster: boolean; os: string | null };
  const named = Array.from(new Set(naming.flatMap((row) => clusterNames(row.parsed.cluster).map(nameKey))));
  const matched = written.filter((row) => !row.isInsert && row.existingEntity?.id);
  const stored: Array<{ id: string; name: string; is_cluster: boolean; os: string | null }> = await context.manager.query(
    `SELECT a.id, a.name, COALESCE(a.is_cluster, false) AS is_cluster, ${operatingSystemLabelSql('a')} AS os
       FROM assets a
      WHERE a.tenant_id = $1 AND (lower(btrim(a.name)) = ANY($2::text[]) OR a.id = ANY($3::uuid[]))`,
    [context.tenantId, named, matched.map((row) => String(row.existingEntity.id))],
  );
  const byId = new Map<string, Candidate>(stored.map((a) => [a.id, { id: a.id, row: null, name: a.name, isCluster: a.is_cluster, os: a.os ?? null }]));
  const fileOs = (row: ImportRow, current: string | null) => (hasCell(row, 'operating_system') ? (String(row.parsed.operating_system ?? '').trim() || null) : current);
  const candidates: Candidate[] = [];
  for (const row of matched) {
    const current = byId.get(String(row.existingEntity.id));
    if (!current) continue;
    current.row = row;
    if (hasCell(row, 'name')) current.name = String(row.parsed.name ?? '');
    if (hasCell(row, 'is_cluster')) current.isCluster = row.parsed.is_cluster === true;
    current.os = fileOs(row, current.os);
  }
  candidates.push(...byId.values());
  for (const row of written.filter((r) => r.isInsert)) {
    candidates.push({ id: null, row, name: String(row.parsed.name ?? ''), isCluster: row.parsed.is_cluster === true, os: fileOs(row, null) });
  }
  const byName = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = nameKey(candidate.name);
    byName.set(key, [...(byName.get(key) ?? []), candidate]);
  }

  for (const row of naming) {
    const self = candidates.find((c) => c.row === row);
    const ownName = self?.name ?? String(row.parsed.name ?? row.existingEntity?.name ?? '');
    const ownCluster = self ? self.isCluster : row.parsed.is_cluster === true;
    const names = clusterNames(row.parsed.cluster);
    const error = (refusal: { message: string; code?: string; params?: Record<string, string | number> }) =>
      row.errors.push({ row: row.rowNumber, column: 'cluster', ...refusal });
    const clustersNamed = (name: string) => (byName.get(nameKey(name)) ?? []).filter((c) => c.isCluster);
    if (names.some((name) => nameKey(name) === nameKey(ownName) && clustersNamed(name).every((c) => c.row === row))) {
      error(codedRowError(assetBadRequest('cluster_member_self', 'An asset cannot be a member of itself.')));
      continue;
    }
    if (ownCluster) {
      error(codedRowError(assetBadRequest('cluster_member_is_cluster', `${ownName} is a cluster: a cluster cannot be a member.`, { name: ownName })));
      continue;
    }
    const resolved: Array<string | null> = [];
    for (const name of names) {
      const clusters = clustersNamed(name);
      if (clusters.length > 1) {
        error({ code: 'CSV_CLUSTER_AMBIGUOUS', message: `Several clusters are named ${name}.`, params: { name } });
      } else if (clusters.length === 0) {
        const any = (byName.get(nameKey(name)) ?? []).length > 0;
        error(any
          ? { code: 'CSV_CLUSTER_NOT_A_CLUSTER', message: `${name} is not a cluster.`, params: { name } }
          : { code: 'CSV_CLUSTER_NOT_FOUND', message: `Cluster not found: ${name}.`, params: { name } });
      } else if (clusters[0].os) {
        error(codedRowError(clusterOsWithMembersRefusal(clusters[0].os)));
      } else {
        resolved.push(clusters[0].id);
      }
    }
    if (resolved.length === names.length) state.resolved.set(row, resolved);
  }
}

/**
 * Whether a matched row's Cluster Membership cell leaves the asset's clusters as stored: an empty
 * cell changes nothing; enrich, every named cluster is already one of them; replace, the same set.
 */
function sameClusters(row: ImportRow, current: ReadonlyArray<{ id: string }>, context: CsvImportContext): boolean {
  if (!hasCell(row, 'cluster') || clusterNames(row.parsed.cluster).length === 0) return true;
  const resolved = clusterCells.get(context)?.resolved.get(row);
  if (!resolved || resolved.some((id) => id === null)) return false;
  const stored = new Set(current.map((c) => c.id));
  const wanted = new Set(resolved as string[]);
  if (![...wanted].every((id) => stored.has(id))) return false;
  return context.params.mode !== 'replace' || wanted.size === stored.size;
}

/**
 * Writes the memberships of the saved rows, once every row exists: the names resolve against the
 * stored assets (the check resolved them against the same final state). Grouped by cluster, one
 * `replaceClusterMembers` per cluster that changes: enrich adds; replace also takes each asset out
 * of the clusters its cell does not name. A cell left empty changes nothing.
 */
async function writeClusterMemberships(entities: any[], context: CsvImportContext): Promise<void> {
  const entries = entities
    .filter((entity) => pendingClusters.has(entity))
    .map((entity) => {
      const names = pendingClusters.get(entity) ?? [];
      pendingClusters.delete(entity);
      return { id: entity.id ? String(entity.id) : '', names };
    })
    .filter((entry) => entry.id && entry.names.length > 0);
  if (entries.length === 0) return;
  const { manager, tenantId } = context;
  const keys = Array.from(new Set(entries.flatMap((entry) => entry.names.map(nameKey))));
  const clusters: Array<{ id: string; key: string }> = await manager.query(
    `SELECT id, lower(btrim(name)) AS key FROM assets
      WHERE tenant_id = $1 AND is_cluster AND lower(btrim(name)) = ANY($2::text[])`,
    [tenantId, keys],
  );
  const idsByKey = new Map<string, string[]>();
  for (const cluster of clusters) idsByKey.set(cluster.key, [...(idsByKey.get(cluster.key) ?? []), cluster.id]);
  const current = await clusterMembershipsOf(manager, tenantId, entries.map((entry) => entry.id));
  const joins = new Map<string, Set<string>>();
  const leaves = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, clusterId: string, assetId: string) => map.set(clusterId, (map.get(clusterId) ?? new Set()).add(assetId));
  for (const entry of entries) {
    const wanted = new Set<string>();
    for (const name of entry.names) {
      const ids = idsByKey.get(nameKey(name)) ?? [];
      if (ids.length !== 1) throw new Error(`The cluster ${name} changed during the import.`);
      wanted.add(ids[0]);
    }
    const stored = new Set((current.get(entry.id) ?? []).map((c) => c.id));
    for (const clusterId of wanted) if (!stored.has(clusterId)) add(joins, clusterId, entry.id);
    if (context.params.mode === 'replace') {
      for (const clusterId of stored) if (!wanted.has(clusterId)) add(leaves, clusterId, entry.id);
    }
  }
  const touched = Array.from(new Set([...joins.keys(), ...leaves.keys()])).sort();
  if (touched.length === 0) return;
  const writer = clusterMemberWriter(context);
  for (const clusterId of touched) {
    const existing: Array<{ asset_id: string }> = await manager.query(
      `SELECT m.asset_id
         FROM asset_cluster_members m
         JOIN assets a ON a.tenant_id = m.tenant_id AND a.id = m.asset_id AND NOT COALESCE(a.is_cluster, false)
        WHERE m.tenant_id = $1 AND m.cluster_id = $2 AND m.asset_id <> m.cluster_id
        ORDER BY m.created_at, m.asset_id`,
      [tenantId, clusterId],
    );
    const members = existing.map((row) => row.asset_id).filter((id) => !leaves.get(clusterId)?.has(id));
    for (const id of joins.get(clusterId) ?? []) if (!members.includes(id)) members.push(id);
    await writer.replaceClusterMembers(clusterId, members, tenantId, context.userId ?? null, { manager, osSource: 'import' });
  }
}

function sameOperatingSystem(current: string, wanted: string): boolean {
  return current.localeCompare(wanted, 'en', { sensitivity: 'accent' }) === 0;
}

/**
 * Settings-backed fields (kind, status, domain, admin_zone) accept a code or a name;
 * ambiguity is refused. The operating system stays a label for the resolver.
 * IP addresses get their type resolved and their values trimmed.
 */
function resolveAssetCatalogs(entity: any, settings: ItOpsSettings): void {
  if (entity.environment != null && String(entity.environment).trim() !== '') {
    const code = assetEnvironmentCode(entity.environment);
    if (!code) throw new Error(`Unknown environment "${entity.environment}"`);
    entity.environment = code;
  }
  if (entity.kind) entity.kind = resolveCatalogCode(entity.kind, settings.serverKinds);
  if (entity.status) entity.status = resolveCatalogCode(entity.status, settings.lifecycleStates);
  if (entity.domain) entity.domain = resolveCatalogCode(entity.domain, settings.domains);
  if (entity.admin_zone) entity.admin_zone = resolveCatalogCode(entity.admin_zone, settings.adminZones);
  if (!Array.isArray(entity.ip_addresses)) return;

  const normalizedIps: Array<{ type: string; ip: string; subnet_cidr: string | null }> = [];
  for (const ip of entity.ip_addresses) {
    if (!ip || typeof ip !== 'object' || !ip.ip) {
      continue;
    }

    const typeInput = String(ip.type || '').trim().toLowerCase();
    const resolvedType = typeInput ? findCatalogOption(typeInput, settings.ipAddressTypes)?.code : undefined;

    // Validate IP type against settings
    if (typeInput && !resolvedType) {
      const validTypes = settings.ipAddressTypes.map((option) => option.label).join(', ');
      throw new Error(
        `Invalid IP address type "${ip.type}" for asset "${entity.name}". Valid types: ${validTypes || '(none configured)'}`,
      );
    }

    normalizedIps.push({
      type: resolvedType || typeInput,
      ip: String(ip.ip || '').trim(),
      subnet_cidr: ip.subnet_cidr ? String(ip.subnet_cidr).trim() : null,
    });
  }

  entity.ip_addresses = normalizedIps.length > 0 ? normalizedIps : null;
}

/**
 * The checks of the asset screen, on every row of the dry run and the load: a host name, an IP
 * address, and a type, domain, lifecycle or administration zone that is not in the catalog.
 * A later IP address set while an earlier address cell of the file is empty is a row error
 * (`asset_ip_gap`): the nested columns would otherwise shift that address into the empty slot.
 * An impossible day is already refused by the shared date parser (`CSV_DATE_INVALID`).
 * On an existing asset, the host name and each IP address are checked only when the file changes
 * them, as the screen does: a stored value that an older rule let through does not block the row.
 */
async function validateAssetRows(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const settings = await requireImportCatalogs(context);
  const fail = (row: CsvImportRow, code: string, message: string, params: Record<string, string | number>, column: string) =>
    row.errors.push({ row: row.rowNumber, column, message, code, params });
  const catalog = (row: CsvImportRow, column: string, options: Parameters<typeof findCatalogOption>[1], code: string, label: string) => {
    if (!(column in row.raw)) return;
    const value = String(row.raw[column] ?? '').trim();
    if (!value) return;
    let found: ReturnType<typeof findCatalogOption> = null;
    try { found = findCatalogOption(value, options); } catch { found = null; }
    if (!found) fail(row, code, `Unknown ${label} "${value}"`, { value }, column);
  };

  for (const row of rows) {
    const existing = row.existingEntity as { hostname?: string | null; ip_addresses?: Array<{ ip?: unknown }> | null } | undefined;
    if ('hostname' in row.raw) {
      const hostname = String(row.raw.hostname ?? '').trim();
      const unchanged = !!existing && hostname === String(existing.hostname ?? '').trim();
      if (hostname && !unchanged && !isValidHostname(hostname)) {
        fail(row, 'asset_hostname_invalid', `"${hostname}" is not a valid host name`, { value: hostname }, 'hostname');
      }
    }
    if ('environment' in row.raw) {
      const environment = String(row.raw.environment ?? '').trim();
      if (environment && !assetEnvironmentCode(environment)) {
        fail(row, 'asset_environment_invalid', `Unknown environment "${environment}"`, { value: environment }, 'environment');
      }
    }
    catalog(row, 'kind', settings.serverKinds ?? [], 'asset_kind_invalid', 'asset type');
    catalog(row, 'domain', settings.domains ?? [], 'asset_domain_invalid', 'domain');
    catalog(row, 'status', settings.lifecycleStates ?? [], 'asset_lifecycle_invalid', 'lifecycle');
    catalog(row, 'admin_zone', settings.adminZones ?? [], 'asset_admin_zone_invalid', 'administration zone');

    for (let slot = 1; slot <= 4; slot++) {
      const typeColumn = `ip_${slot}_type`;
      const addressColumn = `ip_${slot}_address`;
      if (typeColumn in row.raw) {
        const type = String(row.raw[typeColumn] ?? '').trim();
        if (type) {
          let found: ReturnType<typeof findCatalogOption> = null;
          try { found = findCatalogOption(type, settings.ipAddressTypes ?? []); } catch { found = null; }
          if (!found) fail(row, 'asset_ip_type_invalid', `Unknown IP address type "${type}"`, { value: type }, typeColumn);
        }
      }
      if (!(addressColumn in row.raw)) continue;
      const address = String(row.raw[addressColumn] ?? '').trim();
      const stored = Array.isArray(existing?.ip_addresses) ? existing.ip_addresses[slot - 1]?.ip : undefined;
      const unchanged = !!existing && address === String(stored ?? '').trim();
      if (address && !unchanged && !isValidIpAddress(address)) {
        fail(row, 'asset_ip_invalid', `"${address}" is not a valid IP address`, { value: address }, addressColumn);
      }
    }

    for (let slot = 2; slot <= 4; slot++) {
      const addressColumn = `ip_${slot}_address`;
      if (!(addressColumn in row.raw) || !String(row.raw[addressColumn] ?? '').trim()) continue;
      for (let earlier = 1; earlier < slot; earlier++) {
        const earlierColumn = `ip_${earlier}_address`;
        if (earlierColumn in row.raw && !String(row.raw[earlierColumn] ?? '').trim()) {
          fail(row, 'asset_ip_gap', `IP ${slot} is set while IP ${earlier} is empty`, { slot, earlier }, addressColumn);
          break;
        }
      }
    }
  }
}

/** The domain code a cell names, or null when the cell is empty or matches nothing. */
function domainCodeOf(value: unknown, settings: ItOpsSettings): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    return findCatalogOption(text, settings.domains ?? [])?.code ?? null;
  } catch {
    return null;
  }
}

/**
 * The FQDN a row will store. A column the file leaves out keeps the stored value. An unknown
 * domain is left unresolved: that row is already refused, and its FQDN is not guessed.
 */
function rowFqdn(row: CsvImportRow, settings: ItOpsSettings): string | null | undefined {
  const existing = row.existingEntity;
  const hostname = 'hostname' in row.parsed ? row.parsed.hostname : existing?.hostname ?? null;
  let code: string | null;
  if ('domain' in row.parsed) {
    const raw = row.parsed.domain;
    if (raw == null || String(raw).trim() === '') {
      code = null;
    } else {
      const resolved = domainCodeOf(raw, settings);
      if (!resolved) return undefined;
      code = resolved;
    }
  } else {
    code = existing?.domain ?? null;
  }
  const domain = code ? (settings.domains ?? []).find((item) => item.code === code) : null;
  return assetFqdnOf(hostname, code ? { code, dns_suffix: domain?.dns_suffix } : null);
}

/**
 * A name or FQDN another asset already carries is a row error. A stored duplicate stays
 * importable while the value does not change. Two new rows with the same FQDN: the later one.
 */
async function assertAssetIdentityRows(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const settings = await requireImportCatalogs(context);
  const fail = (row: CsvImportRow, code: string, message: string, params: Record<string, string | number>, column: string) =>
    row.errors.push({ row: row.rowNumber, column, message, code, params });
  const nameKeys = [...new Set(rows.map((row) => assetNameKey(row.raw.name)).filter(Boolean))];
  const fqdns = new Map<CsvImportRow, string | null | undefined>();
  for (const row of rows) fqdns.set(row, rowFqdn(row, settings));
  const fqdnKeys = [...new Set([...fqdns.values()].filter((fqdn): fqdn is string => !!fqdn).map((fqdn) => assetNameKey(fqdn)))];
  const [nameHolders, fqdnHolders] = await Promise.all([
    assetIdentityHolders(context.manager, context.tenantId, 'name', nameKeys),
    assetIdentityHolders(context.manager, context.tenantId, 'fqdn', fqdnKeys),
  ]);
  const namesByKey = new Map<string, typeof nameHolders>();
  for (const holder of nameHolders) namesByKey.set(holder.key, [...(namesByKey.get(holder.key) ?? []), holder]);
  const fqdnsByKey = new Map<string, typeof fqdnHolders>();
  for (const holder of fqdnHolders) fqdnsByKey.set(holder.key, [...(fqdnsByKey.get(holder.key) ?? []), holder]);
  const claimedFqdn = new Map<string, string>();

  for (const row of rows) {
    const name = String(row.raw.name ?? '').trim();
    const existing = row.existingEntity;
    const named = namesByKey.get(assetNameKey(name)) ?? [];
    const others = named.filter((holder) => holder.id !== String(existing?.id ?? ''));
    if (name && !existing && named.length) {
      fail(row, 'asset_name_taken', `An asset already has this name: ${named[0].ref}`, { name: named[0].name, ref: named[0].ref }, 'name');
    } else if (name && existing && others.length && assetNameKey(name) !== assetNameKey(existing.name)) {
      fail(row, 'asset_name_taken', `An asset already has this name: ${others[0].ref}`, { name: others[0].name, ref: others[0].ref }, 'name');
    }

    const fqdn = fqdns.get(row);
    if (!fqdn) continue;
    const key = assetNameKey(fqdn);
    const previous = assetNameKey(existing?.fqdn);
    if (existing && key === previous) continue;
    const holder = (fqdnsByKey.get(key) ?? []).find((item) => item.id !== String(existing?.id ?? ''));
    if (holder) {
      fail(row, 'asset_fqdn_taken', `An asset already has this FQDN: ${holder.ref}`, { fqdn: key, ref: holder.ref }, 'hostname');
      continue;
    }
    const claimed = claimedFqdn.get(key);
    if (claimed) {
      fail(row, 'asset_fqdn_taken', `An asset already has this FQDN: ${claimed}`, { fqdn: key, ref: claimed }, 'hostname');
      continue;
    }
    claimedFqdn.set(key, existing?.asset_reference || name);
  }
}

/**
 * The cluster rules, at the check as at the load, as row errors (the codes of the API):
 * - the Cluster switch (`cluster_has_members`, `cluster_switch_member`, `asset-rules.ts`);
 * - an operating system on a cluster that has members (`os_cluster_with_members`).
 * A row a matched insert-only import skips is not checked. A new asset has no member.
 */
async function checkClusterSwitchAndOs(rows: ImportRow[], context: CsvImportContext): Promise<void> {
  const checked = rows.filter((row) =>
    row.errors.length === 0
    && !row.isInsert
    && row.existingEntity?.id
    && context.params.operation !== 'insert_only');
  if (checked.length === 0) return;
  const has = (row: (typeof rows)[number], key: string) => Object.prototype.hasOwnProperty.call(row.parsed, key);
  const finalCluster = (row: (typeof rows)[number]) => (has(row, 'is_cluster') ? row.parsed.is_cluster === true : row.existingEntity.is_cluster === true);
  const switches: ClusterSwitch[] = [];
  for (const row of checked) {
    const from = row.existingEntity.is_cluster === true;
    const to = finalCluster(row);
    if (from !== to) switches.push({ id: String(row.existingEntity.id), from, to });
  }
  const refusals = await clusterSwitchRefusals(context.manager, context.tenantId, switches);
  const settingOs = checked.filter((row) =>
    !refusals.has(String(row.existingEntity.id))
    && finalCluster(row)
    && has(row, 'operating_system')
    && String(row.parsed.operating_system ?? '').trim() !== '');
  const withMembers = await clustersWithMembers(context.manager, context.tenantId, settingOs.map((row) => String(row.existingEntity.id)));
  for (const row of checked) {
    const id = String(row.existingEntity.id);
    const refusal = refusals.get(id);
    if (refusal) {
      row.errors.push({ row: row.rowNumber, column: 'is_cluster', ...codedRowError(refusal) });
    } else if (withMembers.has(id) && settingOs.includes(row)) {
      row.errors.push({ row: row.rowNumber, column: 'operating_system', ...codedRowError(osClusterWithMembersRefusal()) });
    }
  }
}

/**
 * The same cluster rules again at the write, on the rows locked `FOR UPDATE`: the check ran
 * without lock, so a member added or a switch saved since then is seen here. A refusal stops the
 * import before anything is written (`CSV_IMPORT_FAILED`, its reason names the asset). New assets
 * have no member and are not checked.
 */
async function recheckClusterRulesAtWrite(entities: any[], context: CsvImportContext): Promise<void> {
  const updated = entities.filter((entity) => entity.id);
  if (updated.length === 0) return;
  const ids = Array.from(new Set(updated.map((entity) => String(entity.id))));
  const locked: Array<{ id: string; is_cluster: boolean }> = await context.manager.query(
    `SELECT id, COALESCE(is_cluster, false) AS is_cluster FROM assets
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [context.tenantId, ids],
  );
  const stored = new Map(locked.map((row) => [row.id, row.is_cluster === true]));
  const switches: ClusterSwitch[] = [];
  for (const entity of updated) {
    const id = String(entity.id);
    if (!stored.has(id)) continue;
    const from = stored.get(id) === true;
    const to = entity.is_cluster === true;
    if (from !== to) switches.push({ id, from, to });
  }
  const refusals = await clusterSwitchRefusals(context.manager, context.tenantId, switches);
  const settingOs = updated.filter((entity) =>
    entity.is_cluster === true
    && Object.prototype.hasOwnProperty.call(entity, 'operating_system')
    && String(entity.operating_system ?? '').trim() !== '');
  const withMembers = await clustersWithMembers(context.manager, context.tenantId, settingOs.map((entity) => String(entity.id)));
  for (const entity of updated) {
    const id = String(entity.id);
    const refusal = refusals.get(id) ?? (withMembers.has(id) ? osClusterWithMembersRefusal() : null);
    if (refusal) throw new Error(`${entity.name}: ${refusal.message}`);
  }
}

/**
 * CSV configuration for Assets entity
 *
 * Field order matches AssetWorkspacePage.tsx tabs:
 * - Overview: name, location, kind, is_cluster, status, notes
 * - Technical: environment, hostname, domain, admin_zone, aliases, operating system, cluster, IP addresses
 *
 * Note: fqdn is computed from hostname + domain, so not included in CSV
 */
export const assetCsvConfig: CsvEntityConfig = {
  entityName: 'asset',
  tableName: 'assets',
  displayName: 'Assets',
  upsertKey: ['name'],
  // Same rule as the unique names: `lower(btrim(name))`.
  upsertKeyIgnoresOuterSpaces: true,
  fields: [
    // Identity
    {
      csvColumn: 'id',
      entityProperty: 'id',
      type: CsvFieldType.STRING,
      isIdentityColumn: true,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'ID',
      group: 'Identity',
    },

    // === OVERVIEW TAB ===
    {
      csvColumn: 'name',
      entityProperty: 'name',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Name',
      group: 'Overview',
    },
    {
      csvColumn: 'location_reference',
      entityProperty: 'location_id',
      type: CsvFieldType.FK_BY_CODE,
      fkEntity: 'locations',
      fkLookupColumn: 'location_reference',
      fkRequired: true,
      required: true,
      defaultExport: true,
      label: 'Location',
      group: 'Overview',
    },
    {
      csvColumn: 'kind',
      entityProperty: 'kind',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Asset Type',
      group: 'Overview',
    },
    {
      csvColumn: 'is_cluster',
      entityProperty: 'is_cluster',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: true,
      label: 'Is Cluster',
      group: 'Overview',
    },
    {
      csvColumn: 'status',
      entityProperty: 'status',
      // Settings-backed (lifecycle_states): resolved code/label -> code in beforeCommit,
      // so no hard-coded enum gate here (same pattern as `kind`).
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Lifecycle',
      group: 'Overview',
    },
    {
      csvColumn: 'go_live_date',
      entityProperty: 'go_live_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Go-live Date',
      group: 'Overview',
    },
    {
      csvColumn: 'end_of_life_date',
      entityProperty: 'end_of_life_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'End-of-life Date',
      group: 'Overview',
    },
    {
      csvColumn: 'notes',
      entityProperty: 'notes',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Notes',
      group: 'Overview',
    },

    // === TECHNICAL TAB ===
    {
      csvColumn: 'environment',
      entityProperty: 'environment',
      // A code or the name the screen shows in any language. Resolved in beforeCommit.
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Environment',
      group: 'Technical',
    },
    {
      csvColumn: 'hostname',
      entityProperty: 'hostname',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Hostname',
      group: 'Technical',
    },
    {
      csvColumn: 'domain',
      entityProperty: 'domain',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Domain',
      group: 'Technical',
    },
    {
      csvColumn: 'admin_zone',
      entityProperty: 'admin_zone',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Administration zone',
      group: 'Technical',
    },
    {
      csvColumn: 'aliases',
      entityProperty: 'aliases',
      type: CsvFieldType.ARRAY,
      arrayStrategy: ArrayStrategy.COMMA_SEPARATED,
      required: false,
      defaultExport: true,
      label: 'Aliases',
      group: 'Technical',
    },
    {
      csvColumn: 'operating_system',
      entityProperty: 'operating_system',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Operating System',
      group: 'Technical',
    },
    {
      // The names of the asset's real clusters (`checkClusterMemberships`, `writeClusterMemberships`).
      csvColumn: 'cluster',
      entityProperty: 'cluster',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Cluster Membership',
      group: 'Technical',
    },
    // Note: region and zone were removed - region comes from Location, zone was unused

    // === IP ADDRESSES (up to 4) ===
    {
      csvColumn: 'ip_1_type',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[0].type',
      required: false,
      defaultExport: true,
      label: 'IP 1 Type',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_1_address',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[0].ip',
      required: false,
      defaultExport: true,
      label: 'IP 1 Address',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_1_subnet_cidr',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[0].subnet_cidr',
      required: false,
      defaultExport: true,
      label: 'IP 1 Subnet CIDR',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_2_type',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[1].type',
      required: false,
      defaultExport: false,
      label: 'IP 2 Type',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_2_address',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[1].ip',
      required: false,
      defaultExport: false,
      label: 'IP 2 Address',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_2_subnet_cidr',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[1].subnet_cidr',
      required: false,
      defaultExport: false,
      label: 'IP 2 Subnet CIDR',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_3_type',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[2].type',
      required: false,
      defaultExport: false,
      label: 'IP 3 Type',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_3_address',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[2].ip',
      required: false,
      defaultExport: false,
      label: 'IP 3 Address',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_3_subnet_cidr',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[2].subnet_cidr',
      required: false,
      defaultExport: false,
      label: 'IP 3 Subnet CIDR',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_4_type',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[3].type',
      required: false,
      defaultExport: false,
      label: 'IP 4 Type',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_4_address',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[3].ip',
      required: false,
      defaultExport: false,
      label: 'IP 4 Address',
      group: 'IP Addresses',
    },
    {
      csvColumn: 'ip_4_subnet_cidr',
      entityProperty: 'ip_addresses',
      type: CsvFieldType.NESTED,
      nestedPath: '[3].subnet_cidr',
      required: false,
      defaultExport: false,
      label: 'IP 4 Subnet CIDR',
      group: 'IP Addresses',
    },

    // === VULNERABILITIES (export only, left out with the feed off) ===
    ...vulnerabilityCsvFields('Vulnerabilities'),
  ],

  // Export presets
  exportPresets: [
    {
      name: 'enrichment',
      label: 'Data Enrichment',
      fields: [
        'id', 'name', 'location_reference', 'kind', 'is_cluster', 'status',
        'go_live_date', 'end_of_life_date', 'notes',
        'environment', 'hostname', 'domain', 'admin_zone', 'aliases',
        'operating_system', 'cluster',
        'ip_1_type', 'ip_1_address', 'ip_1_subnet_cidr',
        'ip_2_type', 'ip_2_address', 'ip_2_subnet_cidr',
        'ip_3_type', 'ip_3_address', 'ip_3_subnet_cidr',
        'ip_4_type', 'ip_4_address', 'ip_4_subnet_cidr',
      ],
    },
  ],

  /**
   * The checks of the asset screen and the unique name and FQDN (`validateAssetRows`,
   * `assertAssetIdentityRows`), then the cluster rules (`checkClusterSwitchAndOs`) and the Cluster
   * Membership cells (`checkClusterMemberships`), which skip the rows already in error.
   */
  afterValidate: async (rows, context) => {
    await validateAssetRows(rows, context);
    await assertAssetIdentityRows(rows, context);
    await checkClusterSwitchAndOs(rows, context);
    await checkClusterMemberships(rows, context);
  },

  /**
   * The row as the commit stores it: catalog names resolved, provider kept (filled only when blank).
   * The operating system is compared to the marked link's label (or, in a fixture that still
   * carries the text on the row, to that text), without case. The Cluster Membership cell is
   * compared to the asset's real clusters (`sameClusters`).
   */
  sameAsStored: async (rows, context) => {
    const settings = await requireImportCatalogs(context);
    const ids = rows.flatMap((row) => (row.existingEntity?.id ? [String(row.existingEntity.id)] : []));
    const labels = ids.length
      ? await operatingSystemWriter(context).labelsOf(context.manager, context.tenantId, ids)
      : new Map<string, string>();
    const naming = rows.filter((row) => row.existingEntity?.id && hasCell(row, 'cluster') && clusterNames(row.parsed.cluster).length > 0);
    const memberships = naming.length
      ? await clusterMembershipsOf(context.manager, context.tenantId, naming.map((row) => String(row.existingEntity.id)))
      : new Map<string, Array<{ id: string; name: string }>>();
    return rows.map((row) => {
      const stored = row.existingEntity;
      if (!stored.provider && (row.parsed.location_id ?? stored.location_id)) return false;
      const next = { ...row.parsed };
      const hasOs = Object.prototype.hasOwnProperty.call(next, 'operating_system');
      const osRaw = next.operating_system;
      delete next.operating_system;
      delete next.cluster;
      try {
        resolveAssetCatalogs(next, settings);
      } catch {
        return false;
      }
      if (!sameStoredValues(stored, next)) return false;
      if (!sameClusters(row, memberships.get(String(stored.id ?? '')) ?? [], context)) return false;
      if (!hasOs) return true;
      const wanted = osRaw == null || String(osRaw).trim() === '' ? '' : String(osRaw).trim();
      const id = String(stored.id ?? '');
      const current = labels.has(id)
        ? (labels.get(id) ?? '')
        : (typeof stored.operating_system === 'string' ? stored.operating_system : '');
      return sameOperatingSystem(current, wanted);
    });
  },
  /**
   * Hook to normalize and validate fields before commit.
   * - Derives Provider from Location (required at DB level but auto-populated in frontend)
   * - Resolves settings-backed fields (kind, status, domain, admin_zone, ip_address type)
   *   accepting both codes and labels
   * - Holds the operating-system text and the cluster names aside: they are not columns
   */
  beforeCommit: async (entities: any[], context: CsvImportContext) => {
    // 0. The cluster rules, again under the lock of the rows.
    await recheckClusterRulesAtWrite(entities, context);

    // 1. Effective IT Ops catalogs (defaults included), preloaded by the assets CSV service.
    const settings = await requireImportCatalogs(context);

    // 2. Derive provider from location
    const needsProvider = entities.filter((e) => e.location_id && !e.provider);
    if (needsProvider.length > 0) {
      const locationIds = [...new Set(needsProvider.map((e) => e.location_id))];

      const locations = await context.manager.query(
        `SELECT id, provider, hosting_type FROM locations WHERE id = ANY($1) AND tenant_id = $2`,
        [locationIds, context.tenantId],
      );

      const locationMap = new Map<string, { provider: string | null; hosting_type: string }>();
      for (const loc of locations) {
        locationMap.set(loc.id, { provider: loc.provider, hosting_type: loc.hosting_type });
      }

      for (const entity of needsProvider) {
        const locData = locationMap.get(entity.location_id);
        if (locData) {
          entity.provider = locData.provider || locData.hosting_type || null;
        }
      }
    }

    // 3. Resolve settings-backed fields and normalize IP addresses.
    //    The operating system is resolved after the row exists, so the link can point at it.
    for (const entity of entities) {
      resolveAssetCatalogs(entity, settings);
      const domain = entity.domain ? (settings.domains ?? []).find((item) => item.code === entity.domain) : null;
      entity.fqdn = assetFqdnOf(entity.hostname, entity.domain ? { code: entity.domain, dns_suffix: domain?.dns_suffix } : null);
      if (Object.prototype.hasOwnProperty.call(entity, 'operating_system')) {
        const raw = entity.operating_system;
        const text = raw == null ? '' : String(raw).trim();
        pendingOperatingSystems.set(entity, text || null);
        delete entity.operating_system;
      }
      // A matched row carries the stored legacy text: the cell is the one the check kept.
      const cells = clusterCells.get(context);
      if (entity.id && cells?.matched.has(String(entity.id))) {
        const names = cells.namesByAsset.get(String(entity.id));
        if (names) pendingClusters.set(entity, names);
      } else if (Object.prototype.hasOwnProperty.call(entity, 'cluster')) {
        pendingClusters.set(entity, clusterNames(entity.cluster));
      }
      delete entity.cluster;
    }
  },

  /**
   * Write the marked link once the asset row has its id (an absent key leaves the link alone), then
   * the memberships: a cluster's operating system cleared by the file is gone first.
   */
  afterCommit: async (entities: any[], context: CsvImportContext) => {
    const pending = entities.filter((entity) => pendingOperatingSystems.has(entity));
    const operatingSystems = pending.length > 0 ? operatingSystemWriter(context) : null;
    for (const entity of pending) {
      const label = pendingOperatingSystems.get(entity) ?? null;
      pendingOperatingSystems.delete(entity);
      if (!entity.id || !operatingSystems) continue;
      const resolved = await operatingSystems.resolve(context.manager, context.tenantId, label, { create: true });
      await operatingSystems.setOperatingSystem(context.manager, context.tenantId, entity.id, resolved, 'import', context.userId);
    }
    await writeClusterMemberships(entities, context);
  },
};
