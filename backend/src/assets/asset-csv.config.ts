import type { CsvLanguage } from '../common/csv-sheet';
import { assetEnvironmentCode } from './asset-environments';
import { CatalogOptionLike, findCatalogOption, offeredCatalogList, requireImportCatalogs, resolveCatalogCode, resolveOfferedCatalogCode } from '../it-ops-settings/catalog-resolve';
import { shippedLabelIn } from '../it-ops-settings/catalog-shipped-labels';
import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvFieldType,
  CsvImportContext,
  CsvImportRow,
  importCell,
  noteCleared,
  removedEntries,
} from '../common/csv';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { richTextCell } from '../common/csv/rich-text-cell';
import { AuditLog } from '../audit/audit.entity';
import { AuditService } from '../audit/audit.service';
import { ItOpsSettings, ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../technologies/catalog/technology-catalog.service';
import { OperatingSystemService, type OperatingSystemPreview } from '../technologies/operating-system.service';
import { hasLevel } from '../common/relations/relations-access';
import { accentFreeKey, noteNameMatch, noteRefusedProposal, proposalFor, undoneMatch, AMBIGUOUS_NAMES_SHOWN } from '../common/name-matching';
import { VULNERABILITY_CSV_HEADERS, vulnerabilityCsvFields } from '../vulnerabilities/vulnerability-list-column';
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

/** The entry a value names, or null (an ambiguous value names none). */
function findCatalogOptionSafe(value: string, options: CatalogOptionLike[]): CatalogOptionLike | null {
  try { return findCatalogOption(value, options); } catch { return null; }
}

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
 * row here (an empty list for `-`); `afterCommit` writes the memberships through `replaceClusterMembers`.
 */
const pendingClusters = new WeakMap<object, string[]>();

type ImportRow = Parameters<NonNullable<CsvEntityConfig['afterValidate']>>[0][number];

/**
 * Per import: the whole list of clusters each matched asset's cell gives (empty for `-`; none for a
 * blank cell, which keeps them), each checked row's resolved clusters (`null`: one the file creates),
 * and the cluster's own name for a cell name found beyond case or by Kad's proposal (by `nameKey` of
 * the cell name), which the write looks up.
 */
const clusterCells = new WeakMap<CsvImportContext, {
  matched: Set<string>;
  namesByAsset: Map<string, string[]>;
  resolved: WeakMap<ImportRow, Array<string | null>>;
  renamed: Map<string, string>;
}>();

/** Per import: what the operating system cell of each checked row resolves to (`previewOperatingSystems`). */
const operatingSystemChecks = new WeakMap<CsvImportContext, WeakMap<ImportRow, OperatingSystemPreview | null>>();

/** Whether the person who imports reads the servers and the technologies (the infrastructure). */
function readsInfrastructure(context: CsvImportContext): boolean {
  return !!context.access && hasLevel(context.access, 'infrastructure', 'reader');
}

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

/**
 * The Cluster Membership cell by the clearing rule (D21 of 26.11.9, T-I6d): the names of a filled
 * cell are the asset's whole list; `-` takes the asset out of every cluster; a blank cell (or a cell
 * that names nothing, or no column) keeps them.
 */
type ClusterCell = { kind: 'keep' } | { kind: 'clear' } | { kind: 'names'; names: string[] };

function clusterCell(row: ImportRow): ClusterCell {
  const cell = importCell(row.raw, 'cluster');
  if (cell.kind === 'clear') return row.isInsert ? { kind: 'keep' } : { kind: 'clear' };
  const names = cell.kind === 'value' ? clusterNames(cell.text) : [];
  return names.length > 0 ? { kind: 'names', names } : { kind: 'keep' };
}

/** A cell's text, by the clearing rule: '' for a blank cell, a `-` or a column the file leaves out. */
function cellText(row: CsvImportRow, column: string): string {
  const cell = importCell(row.raw, column);
  return cell.kind === 'value' ? cell.text : '';
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
  // The cell, never the stored legacy text the shared import copies for a blank cell: only the names of
  // a new asset's cell go on to the write (`beforeCommit`), the rest is read here.
  for (const row of rows) {
    const cell = clusterCell(row);
    if (row.isInsert && cell.kind === 'names') row.parsed.cluster = cell.names.join(', ');
    else delete row.parsed.cluster;
  }
  const written = rows.filter((row) => isWritten(row, context));
  const naming = written.filter((row) => clusterCell(row).kind === 'names');
  const state = {
    matched: new Set<string>(), namesByAsset: new Map<string, string[]>(), resolved: new WeakMap<ImportRow, Array<string | null>>(), renamed: new Map<string, string>(),
  };
  clusterCells.set(context, state);
  for (const row of written) {
    if (row.isInsert || !row.existingEntity?.id) continue;
    state.matched.add(String(row.existingEntity.id));
    const cell = clusterCell(row);
    if (cell.kind !== 'keep') state.namesByAsset.set(String(row.existingEntity.id), cell.kind === 'names' ? cell.names : []);
  }
  if (naming.length > 0) await resolveClusterNames(naming, written, context, state);
  await countClustersLeft(written, context, state);
}

/**
 * The links a matched row's cell removes (`noteCleared`): every cluster for `-`, the clusters a filled
 * cell does not name once its names resolved (a row whose names do not all resolve is refused).
 */
async function countClustersLeft(written: ImportRow[], context: CsvImportContext, state: { resolved: WeakMap<ImportRow, Array<string | null>> }): Promise<void> {
  const changing = written.filter((row) => !row.isInsert && row.existingEntity?.id && row.errors.length === 0 && clusterCell(row).kind !== 'keep');
  if (changing.length === 0) return;
  const current = await clusterMembershipsOf(context.manager, context.tenantId, changing.map((row) => String(row.existingEntity.id)));
  for (const row of changing) {
    const stored = (current.get(String(row.existingEntity.id)) ?? []).map((c) => c.id);
    const wanted = clusterCell(row).kind === 'clear' ? [] : state.resolved.get(row);
    if (wanted) noteCleared(row, removedEntries(stored, wanted));
  }
}

/** The names of the rows that name clusters, resolved (`checkClusterMemberships`). */
async function resolveClusterNames(
  naming: ImportRow[],
  written: ImportRow[],
  context: CsvImportContext,
  state: { resolved: WeakMap<ImportRow, Array<string | null>>; renamed: Map<string, string> },
): Promise<void> {

  type Candidate = { id: string | null; ref: string | null; row: ImportRow | null; name: string; isCluster: boolean; os: string | null };
  const namesOf = (row: ImportRow) => {
    const cell = clusterCell(row);
    return cell.kind === 'names' ? cell.names : [];
  };
  const named = Array.from(new Set(naming.flatMap((row) => namesOf(row).map(nameKey))));
  const matched = written.filter((row) => !row.isInsert && row.existingEntity?.id);
  // Every cluster too: a name is found accents aside, or proposed by Kad, in JavaScript (lot I3 of 26.11.9).
  const stored: Array<{ id: string; ref: string | null; name: string; is_cluster: boolean; os: string | null }> = await context.manager.query(
    `SELECT a.id, a.asset_reference AS ref, a.name, COALESCE(a.is_cluster, false) AS is_cluster, ${operatingSystemLabelSql('a')} AS os
       FROM assets a
      WHERE a.tenant_id = $1 AND (lower(btrim(a.name)) = ANY($2::text[]) OR a.id = ANY($3::uuid[]) OR COALESCE(a.is_cluster, false))
      ORDER BY lower(btrim(a.name)), a.id`,
    [context.tenantId, named, matched.map((row) => String(row.existingEntity.id))],
  );
  const byId = new Map<string, Candidate>(stored.map((a) => [a.id, { id: a.id, ref: a.ref, row: null, name: a.name, isCluster: a.is_cluster, os: a.os ?? null }]));
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
    candidates.push({ id: null, ref: null, row, name: String(row.parsed.name ?? ''), isCluster: row.parsed.is_cluster === true, os: fileOs(row, null) });
  }
  const byName = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = nameKey(candidate.name);
    byName.set(key, [...(byName.get(key) ?? []), candidate]);
  }

  // A name of the cell (lot I3 of 26.11.9): Kad's proposal first, for a person who reads the servers
  // (a cluster of that name exactly or case aside; several: `CSV_NAME_AMBIGUOUS_AMONG`); then the
  // name case aside, as before (several: `CSV_CLUSTER_AMBIGUOUS`); then accents aside for a person who
  // reads the servers and has not undone that match (several: `CSV_NAME_AMBIGUOUS_AMONG`). A match
  // beyond case is noted.
  const reads = readsInfrastructure(context);
  const { params } = context;
  const clustersNamed = (name: string) => (byName.get(nameKey(name)) ?? []).filter((c) => c.isCluster);
  const clusterOfName = (name: string, line: number): Candidate[] | 'ambiguous' => {
    const undone = undoneMatch(params.unmatched, 'cluster', name);
    const proposal = undone ? undefined : proposalFor(params.proposals, 'cluster', name);
    const note = (target: Candidate, origin: 'server' | 'model') => {
      state.renamed.set(nameKey(name), target.name);
      if (context.nameMatches) {
        noteNameMatch(context.nameMatches, {
          column: 'cluster', name: null, value: name, target: target.name.trim(), ref: target.ref,
          origin, reason: origin === 'model' ? 'model' : 'accents', undoable: true,
        }, line);
      }
    };
    const ambiguous = (among: Candidate[]): 'ambiguous' => {
      const names = among.slice(0, AMBIGUOUS_NAMES_SHOWN).map((c) => c.ref || c.name.trim()).join(', ');
      const row = naming.find((r) => r.rowNumber === line)!;
      row.errors.push({
        row: line, column: 'cluster', code: 'CSV_NAME_AMBIGUOUS_AMONG',
        message: `"${name}" may designate several clusters: ${names}`, params: { value: name, names },
      });
      return 'ambiguous';
    };
    // The cluster the name finds by itself, case aside, then accents aside for a person who reads the servers.
    const ownCluster = (): Candidate | null => {
      const clusters = clustersNamed(name);
      if (clusters.length > 0 || (byName.get(nameKey(name)) ?? []).length > 0 || !reads) return clusters.length === 1 ? clusters[0] : null;
      const accents = candidates.filter((c) => c.isCluster && accentFreeKey(c.name) === accentFreeKey(name));
      return accents.length === 1 ? accents[0] : null;
    };
    // The server's own match first (lot I6b of 26.12.1): Kad naming the cluster the name finds alone is
    // no proposal to list, taken or refused; the name follows its own rule below.
    const proposed = proposal !== undefined && reads ? clustersNamed(proposal) : [];
    if (proposal !== undefined && !(proposed.length === 1 && ownCluster() === proposed[0])) {
      if (proposed.length === 1) {
        note(proposed[0], 'model');
        return proposed;
      }
      // A name of several clusters: the row is refused, naming them, as a name written so would be.
      if (proposed.length > 1) return ambiguous(proposed);
      if (context.refusedProposals) {
        noteRefusedProposal(context.refusedProposals, { column: 'cluster', name: null, value: name, target: proposal, reason: 'missing' }, line);
      }
    }
    const clusters = clustersNamed(name);
    if (clusters.length > 0 || (byName.get(nameKey(name)) ?? []).length > 0 || !reads || undone) return clusters;
    const key = accentFreeKey(name);
    const accents = candidates.filter((c) => c.isCluster && accentFreeKey(c.name) === key);
    if (accents.length === 1) note(accents[0], 'server');
    if (accents.length <= 1) return accents;
    return ambiguous(accents);
  };

  for (const row of naming) {
    const self = candidates.find((c) => c.row === row);
    const ownName = self?.name ?? String(row.parsed.name ?? row.existingEntity?.name ?? '');
    const ownCluster = self ? self.isCluster : row.parsed.is_cluster === true;
    const names = namesOf(row);
    const error = (refusal: { message: string; code?: string; params?: Record<string, string | number> }) =>
      row.errors.push({ row: row.rowNumber, column: 'cluster', ...refusal });
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
      const clusters = clusterOfName(name, row.rowNumber);
      if (clusters === 'ambiguous') continue;
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
 * Whether a matched row's Cluster Membership cell leaves the asset's clusters as stored: a blank cell
 * changes nothing; `-`, the asset is in none; a filled cell, the same set.
 */
function sameClusters(row: ImportRow, current: ReadonlyArray<{ id: string }>, context: CsvImportContext): boolean {
  const cell = clusterCell(row);
  if (cell.kind === 'keep') return true;
  if (cell.kind === 'clear') return current.length === 0;
  const resolved = clusterCells.get(context)?.resolved.get(row);
  if (!resolved || resolved.some((id) => id === null)) return false;
  const stored = new Set(current.map((c) => c.id));
  const wanted = new Set(resolved as string[]);
  return wanted.size === stored.size && [...wanted].every((id) => stored.has(id));
}

/**
 * Writes the memberships of the saved rows, once every row exists: the names resolve against the
 * stored assets (the check resolved them against the same final state). Grouped by cluster, one
 * `replaceClusterMembers` per cluster that changes: each asset joins the clusters its cell names and
 * leaves the others (all of them for `-`). A blank cell changes nothing (no pending list).
 */
async function writeClusterMemberships(entities: any[], context: CsvImportContext): Promise<void> {
  const entries = entities
    .filter((entity) => pendingClusters.has(entity))
    .map((entity) => {
      const names = pendingClusters.get(entity) ?? [];
      pendingClusters.delete(entity);
      return { id: entity.id ? String(entity.id) : '', names };
    })
    .filter((entry) => entry.id);
  if (entries.length === 0) return;
  const { manager, tenantId } = context;
  const keys = Array.from(new Set(entries.flatMap((entry) => entry.names.map(nameKey))));
  const clusters: Array<{ id: string; key: string }> = keys.length === 0 ? [] : await manager.query(
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
    for (const clusterId of stored) if (!wanted.has(clusterId)) add(leaves, clusterId, entry.id);
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
    await writer.replaceClusterMembers(clusterId, members, tenantId, context.userId ?? null, { manager, osSource: 'import', audit: context.audit });
  }
}

function sameOperatingSystem(current: string, wanted: string): boolean {
  return current.localeCompare(wanted, 'en', { sensitivity: 'accent' }) === 0;
}

/**
 * The operating system cell of each row the import writes, resolved at the check as at the load,
 * writing nothing (lot I3 of 26.11.9, T-I3e): Kad's proposal first, taken when it names a technology
 * of the tenant or of the shipped catalog, and its version as written, for a person who reads the
 * infrastructure (a match of origin model; the row then carries the proposal); otherwise refused.
 * Then the cell's own label: a version found by a prefix rule (`Ubuntu 22.04` for `22.04 LTS`) is a
 * match, undoable (`unmatched`: the version is then created as written); a version to create is
 * said (`CSV_TECHNOLOGY_VERSION_CREATED`). `sameAsStored` compares what the label resolves to.
 */
async function previewOperatingSystems(rows: ImportRow[], context: CsvImportContext): Promise<void> {
  const previews = new WeakMap<ImportRow, OperatingSystemPreview | null>();
  operatingSystemChecks.set(context, previews);
  const naming = rows.filter((row) => isWritten(row, context) && hasCell(row, 'operating_system') && String(row.parsed.operating_system ?? '').trim());
  if (naming.length === 0) return;
  const os = operatingSystemWriter(context);
  const { params } = context;
  const cache = new Map<string, OperatingSystemPreview | null>();
  const preview = async (label: string, exactVersion: boolean) => {
    const key = `${exactVersion}|${label.toLowerCase()}`;
    if (!cache.has(key)) cache.set(key, await os.preview(context.manager, context.tenantId, label, { exactVersion }));
    return cache.get(key) ?? null;
  };
  for (const row of naming) {
    const cell = String(row.parsed.operating_system).trim().replace(/\s+/g, ' ');
    const undone = undoneMatch(params.unmatched, 'operating_system', cell);
    const proposal = undone ? undefined : proposalFor(params.proposals, 'operating_system', cell);
    if (proposal !== undefined) {
      const proposed = readsInfrastructure(context) ? await preview(proposal, true) : null;
      const taken = !!proposed && proposed.technology !== 'created' && proposed.version?.how !== 'created';
      // The server's own match first (lot I6b of 26.12.1): Kad naming the system the cell finds alone
      // (its version by a prefix rule) is no proposal to list, taken or refused.
      const own = taken ? await preview(cell, false) : null;
      const same = !!own && own.technology !== 'created' && own.version?.how !== 'created' && own.label === proposed!.label;
      if (proposed && taken && !same) {
        row.parsed.operating_system = proposal;
        previews.set(row, proposed);
        if (context.nameMatches) {
          noteNameMatch(context.nameMatches, {
            column: 'operating_system', name: null, value: cell, target: proposed.label, ref: null, origin: 'model', reason: 'model', undoable: true,
          }, row.rowNumber);
        }
        continue;
      }
      if (!same && context.refusedProposals) {
        noteRefusedProposal(context.refusedProposals, { column: 'operating_system', name: null, value: cell, target: proposal, reason: 'missing' }, row.rowNumber);
      }
    }
    const resolved = await preview(cell, undone);
    previews.set(row, resolved);
    if (resolved?.version?.how === 'prefix' && context.nameMatches) {
      noteNameMatch(context.nameMatches, {
        column: 'operating_system', name: null, value: cell, target: resolved.label, ref: null, origin: 'server', reason: 'version', undoable: true,
      }, row.rowNumber);
    } else if (resolved?.version?.how === 'created') {
      row.warnings.push({
        row: row.rowNumber, column: 'operating_system', code: 'CSV_TECHNOLOGY_VERSION_CREATED',
        message: `Version "${resolved.version.label}" is created.`, params: { value: resolved.version.label },
      });
    }
  }
}

/**
 * Kad's proposals for the servers' type (D31 of 26.11.9): a value of the file the type catalog does
 * not read (a hosting word, "Cloud") and the type the person named in the conversation. Taken when it
 * names one type of the catalog (its code, or its name in any language) and the person has not undone
 * it: the row carries that type, and the match is listed (origin model, undoable), named by the type's
 * name in the file's language. Refused (listed) otherwise; the value then follows the screen's rule
 * (`asset_kind_invalid`). The model's value map never converts a hosting word: only this listed match does.
 */
function takeKindProposals(rows: CsvImportRow[], context: CsvImportContext, settings: ItOpsSettings): void {
  const { params } = context;
  if (!params.proposals?.kind) return;
  const options = settings.serverKinds ?? [];
  const typeOf = (value: string) => {
    try {
      return findCatalogOption(value, options) ?? null;
    } catch {
      return 'several' as const;
    }
  };
  for (const row of rows) {
    const cell = cellText(row, 'kind');
    if (!cell || typeOf(cell) !== null || undoneMatch(params.unmatched, 'kind', cell)) continue;
    const proposal = proposalFor(params.proposals, 'kind', cell);
    if (proposal === undefined) continue;
    const type = typeOf(proposal);
    if (type === null || type === 'several') {
      if (context.refusedProposals) {
        noteRefusedProposal(context.refusedProposals, { column: 'kind', name: null, value: cell, target: proposal, reason: 'missing' }, row.rowNumber);
      }
      continue;
    }
    row.raw.kind = type.code;
    row.parsed.kind = type.code;
    if (context.nameMatches) {
      noteNameMatch(context.nameMatches, {
        column: 'kind', name: null, value: cell, target: shippedLabelIn('serverKinds', type, context.language ?? 'en') ?? (type.label || type.code),
        code: type.code, ref: null, origin: 'model', reason: 'model', undoable: true,
      }, row.rowNumber);
    }
  }
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
 * The cells are read by the clearing rule (D21 of 26.11.9): a `-` that clears is not checked (the shared
 * import refuses it where the value cannot be empty), and a blank address cell of a stored asset keeps
 * its address, so a later one leaves no gap; an earlier address `-` clears does.
 */
async function validateAssetRows(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const settings = await requireImportCatalogs(context);
  takeKindProposals(rows, context, settings);
  const fail = (row: CsvImportRow, code: string, message: string, params: Record<string, string | number>, column: string) =>
    row.errors.push({ row: row.rowNumber, column, message, code, params });
  // Rule P7: a value the catalog does not know, or one it retired, unless the asset the row updates holds it.
  const offered = (row: CsvImportRow, column: string, value: string, options: CatalogOptionLike[], held: unknown, code: string, label: string) => {
    try {
      resolveOfferedCatalogCode(value, options, { held, what: label });
    } catch (error: any) {
      const retired = !!findCatalogOptionSafe(value, options);
      if (retired) fail(row, 'catalog_value_retired', error.message, { value, allowed: offeredCatalogList(options, held) }, column);
      else fail(row, code, `Unknown ${label} "${value}"`, { value }, column);
    }
  };
  const catalog = (row: CsvImportRow, column: string, options: CatalogOptionLike[], code: string, label: string) => {
    const value = cellText(row, column);
    if (!value || value === '-') return;
    offered(row, column, value, options, (row.existingEntity as Record<string, unknown> | undefined)?.[column], code, label);
  };

  for (const row of rows) {
    const existing = row.existingEntity as { hostname?: string | null; ip_addresses?: Array<{ ip?: unknown }> | null } | undefined;
    const hostname = cellText(row, 'hostname');
    const sameHostname = !!existing && hostname === String(existing.hostname ?? '').trim();
    if (hostname && !sameHostname && !isValidHostname(hostname)) {
      fail(row, 'asset_hostname_invalid', `"${hostname}" is not a valid host name`, { value: hostname }, 'hostname');
    }
    const environment = cellText(row, 'environment');
    if (environment && !assetEnvironmentCode(environment)) {
      fail(row, 'asset_environment_invalid', `Unknown environment "${environment}"`, { value: environment }, 'environment');
    }
    catalog(row, 'kind', settings.serverKinds ?? [], 'asset_kind_invalid', 'asset type');
    catalog(row, 'domain', settings.domains ?? [], 'asset_domain_invalid', 'domain');
    catalog(row, 'status', settings.lifecycleStates ?? [], 'asset_lifecycle_invalid', 'lifecycle');
    catalog(row, 'admin_zone', settings.adminZones ?? [], 'asset_admin_zone_invalid', 'administration zone');

    for (let slot = 1; slot <= 4; slot++) {
      const typeColumn = `ip_${slot}_type`;
      const addressColumn = `ip_${slot}_address`;
      const type = cellText(row, typeColumn);
      if (type && type !== '-') {
        const heldTypes = (Array.isArray(existing?.ip_addresses) ? existing.ip_addresses : []).map((item: any) => item?.type);
        offered(row, typeColumn, type, settings.ipAddressTypes ?? [], heldTypes, 'asset_ip_type_invalid', 'IP address type');
      }
      // Rule P7, as the API: a retired subnet only on the asset that already holds it.
      const subnetColumn = `ip_${slot}_subnet_cidr`;
      const subnet = cellText(row, subnetColumn);
      if (subnet && subnet !== '-') {
        const heldSubnets = (Array.isArray(existing?.ip_addresses) ? existing.ip_addresses : []).map((item: any) => String(item?.subnet_cidr ?? ''));
        const known = (settings.subnets ?? []).filter((item) => item.cidr === subnet);
        if (known.length > 0 && known.every((item) => item.deprecated) && !heldSubnets.includes(subnet)) {
          const allowed = [...new Set((settings.subnets ?? []).filter((item) => !item.deprecated || heldSubnets.includes(item.cidr)).map((item) => item.cidr))].join(', ');
          fail(row, 'catalog_value_retired', `The subnet "${subnet}" is retired: only a record that already holds it keeps it. Use one of: ${allowed}.`, { value: subnet, allowed }, subnetColumn);
        }
      }
      const address = cellText(row, addressColumn);
      const stored = Array.isArray(existing?.ip_addresses) ? existing.ip_addresses[slot - 1]?.ip : undefined;
      const unchanged = !!existing && address === String(stored ?? '').trim();
      if (address && !unchanged && !isValidIpAddress(address)) {
        fail(row, 'asset_ip_invalid', `"${address}" is not a valid IP address`, { value: address }, addressColumn);
      }
    }

    // The address an earlier slot keeps: the file's, none for `-`, the stored one for a blank cell.
    const keptAddress = (slot: number) => {
      const cell = importCell(row.raw, `ip_${slot}_address`);
      if (cell.kind !== 'blank') return cell.kind === 'value' ? cell.text : '';
      return row.isInsert || !Array.isArray(existing?.ip_addresses) ? '' : String(existing.ip_addresses[slot - 1]?.ip ?? '').trim();
    };
    for (let slot = 2; slot <= 4; slot++) {
      const addressColumn = `ip_${slot}_address`;
      if (!cellText(row, addressColumn)) continue;
      for (let earlier = 1; earlier < slot; earlier++) {
        const earlierColumn = `ip_${earlier}_address`;
        if (earlierColumn in row.raw && !keptAddress(earlier)) {
          fail(row, 'asset_ip_gap', `IP ${slot} is set while IP ${earlier} is empty`, { slot, earlier }, addressColumn);
          break;
        }
      }
    }
    countIpEntriesLeft(row);
  }
}

/**
 * `-` on the address of a stored IP entry takes the entry out (an entry has an address, as on the
 * screen): its type and subnet go with it. The shared import counts the sub-values `-` clears; the
 * ones the entry loses this way are counted here.
 */
function countIpEntriesLeft(row: CsvImportRow): void {
  const stored = row.isInsert ? null : row.existingEntity?.ip_addresses;
  if (!Array.isArray(stored)) return;
  for (let slot = 1; slot <= 4; slot++) {
    const entry = stored[slot - 1];
    if (!entry?.ip || importCell(row.raw, `ip_${slot}_address`).kind !== 'clear') continue;
    for (const [key, column] of [['type', `ip_${slot}_type`], ['subnet_cidr', `ip_${slot}_subnet_cidr`]]) {
      if (entry[key] != null && String(entry[key]).trim() !== '' && importCell(row.raw, column).kind !== 'clear') noteCleared(row, 1);
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
  const nameKeys = [...new Set(rows.map((row) => assetNameKey(cellText(row, 'name'))).filter(Boolean))];
  const fqdns = new Map<CsvImportRow, string | null | undefined>();
  for (const row of rows) fqdns.set(row, rowFqdn(row, settings));
  const fqdnKeys = [...new Set([...fqdns.values()].filter((fqdn): fqdn is string => !!fqdn).map((fqdn) => assetNameKey(fqdn)))];
  // One after the other: the request's single connection runs its queries in turn anyway.
  const nameHolders = await assetIdentityHolders(context.manager, context.tenantId, 'name', nameKeys);
  const fqdnHolders = await assetIdentityHolders(context.manager, context.tenantId, 'fqdn', fqdnKeys);
  const namesByKey = new Map<string, typeof nameHolders>();
  for (const holder of nameHolders) namesByKey.set(holder.key, [...(namesByKey.get(holder.key) ?? []), holder]);
  const fqdnsByKey = new Map<string, typeof fqdnHolders>();
  for (const holder of fqdnHolders) fqdnsByKey.set(holder.key, [...(fqdnsByKey.get(holder.key) ?? []), holder]);
  const claimedFqdn = new Map<string, string>();

  for (const row of rows) {
    const name = cellText(row, 'name');
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
  // A `-` on the Cluster switch is refused by the shared import: the stored switch stands meanwhile.
  const finalCluster = (row: (typeof rows)[number]) => (has(row, 'is_cluster') && importCell(row.raw, 'is_cluster').kind !== 'clear'
    ? row.parsed.is_cluster === true
    : row.existingEntity.is_cluster === true);
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
 * Column order: id, reference (AST-n, export only), name, then AssetWorkspacePage.tsx tab by tab:
 * - Overview: description (notes), properties (kind to end of life), cluster membership
 * - Operations: operating system, vulnerabilities
 * - Network: hostname, domain, aliases, IP addresses
 *
 * Note: fqdn is computed from hostname + domain, so not included in CSV
 */
/**
 * The title of each column in the file's language, as the export dialog names the asset fields
 * (`csv.fields.assets` of the screen). The export and the template write it, and the import reads
 * the titles of every language as well as the technical column.
 */
const ASSET_CSV_HEADERS: Record<string, Record<CsvLanguage, string>> = {
  ...VULNERABILITY_CSV_HEADERS,
  reference: { en: 'Reference', fr: 'Référence', de: 'Referenz', es: 'Referencia' },
  name: { en: 'Name', fr: 'Nom', de: 'Name', es: 'Nombre' },
  notes: { en: 'Notes', fr: 'Notes', de: 'Notizen', es: 'Notas' },
  kind: { en: 'Asset type', fr: 'Type d’actif', de: 'Asset-Typ', es: 'Tipo de activo' },
  is_cluster: { en: 'Is a cluster', fr: 'Est un cluster', de: 'Ist ein Cluster', es: 'Es un clúster' },
  environment: { en: 'Environment', fr: 'Environnement', de: 'Umgebung', es: 'Entorno' },
  admin_zone: { en: 'Administration zone', fr: 'Zone d’administration', de: 'Administrationszone', es: 'Zona de administración' },
  location_reference: { en: 'Location', fr: 'Site', de: 'Standort', es: 'Ubicación' },
  status: { en: 'Lifecycle', fr: 'Cycle de vie', de: 'Lebenszyklus', es: 'Ciclo de vida' },
  go_live_date: { en: 'Go-live date', fr: 'Date de mise en service', de: 'Inbetriebnahmedatum', es: 'Fecha de puesta en marcha' },
  end_of_life_date: { en: 'End-of-life date', fr: 'Date de fin de vie', de: 'Datum Lebensende', es: 'Fecha de fin de vida' },
  cluster: { en: 'Cluster membership', fr: 'Appartenance au cluster', de: 'Cluster-Mitgliedschaft', es: 'Pertenencia al clúster' },
  operating_system: { en: 'Operating system', fr: 'Système d’exploitation', de: 'Betriebssystem', es: 'Sistema operativo' },
  hostname: { en: 'Hostname', fr: 'Nom d’hôte', de: 'Hostname', es: 'Nombre de host' },
  domain: { en: 'Domain', fr: 'Domaine', de: 'Domäne', es: 'Dominio' },
  aliases: { en: 'Aliases', fr: 'Alias', de: 'Aliase', es: 'Alias' },
  ip_1_type: { en: 'IP 1 type', fr: 'Type d’adresse IP 1', de: 'IP-Typ 1', es: 'Tipo de IP 1' },
  ip_1_address: { en: 'IP 1 address', fr: 'Adresse IP 1', de: 'IP-Adresse 1', es: 'Dirección IP 1' },
  ip_1_subnet_cidr: { en: 'IP 1 subnet (CIDR)', fr: 'Sous-réseau IP 1 (CIDR)', de: 'IP-Subnetz 1 (CIDR)', es: 'Subred IP 1 (CIDR)' },
  ip_2_type: { en: 'IP 2 type', fr: 'Type d’adresse IP 2', de: 'IP-Typ 2', es: 'Tipo de IP 2' },
  ip_2_address: { en: 'IP 2 address', fr: 'Adresse IP 2', de: 'IP-Adresse 2', es: 'Dirección IP 2' },
  ip_2_subnet_cidr: { en: 'IP 2 subnet (CIDR)', fr: 'Sous-réseau IP 2 (CIDR)', de: 'IP-Subnetz 2 (CIDR)', es: 'Subred IP 2 (CIDR)' },
  ip_3_type: { en: 'IP 3 type', fr: 'Type d’adresse IP 3', de: 'IP-Typ 3', es: 'Tipo de IP 3' },
  ip_3_address: { en: 'IP 3 address', fr: 'Adresse IP 3', de: 'IP-Adresse 3', es: 'Dirección IP 3' },
  ip_3_subnet_cidr: { en: 'IP 3 subnet (CIDR)', fr: 'Sous-réseau IP 3 (CIDR)', de: 'IP-Subnetz 3 (CIDR)', es: 'Subred IP 3 (CIDR)' },
  ip_4_type: { en: 'IP 4 type', fr: 'Type d’adresse IP 4', de: 'IP-Typ 4', es: 'Tipo de IP 4' },
  ip_4_address: { en: 'IP 4 address', fr: 'Adresse IP 4', de: 'IP-Adresse 4', es: 'Dirección IP 4' },
  ip_4_subnet_cidr: { en: 'IP 4 subnet (CIDR)', fr: 'Sous-réseau IP 4 (CIDR)', de: 'IP-Subnetz 4 (CIDR)', es: 'Subred IP 4 (CIDR)' },
};

export const assetCsvConfig: CsvEntityConfig = {
  entityName: 'asset',
  // The sheet of an xlsx export: the list's title on screen.
  sheetNames: { en: 'Assets', fr: 'Actifs', de: 'Assets', es: 'Activos' },
  tableName: 'assets',
  displayName: 'Assets',
  headerLabels: ASSET_CSV_HEADERS,
  upsertKey: ['name'],
  // How the check names a record a row updates (Q1 of 26.11.9).
  recordLabel: (entity) => ({ ref: entity.asset_reference || null, name: String(entity.name ?? '') }),
  // Same rule as the unique names: `lower(btrim(name))`.
  upsertKeyIgnoresOuterSpaces: true,
  fields: [
    // === IDENTITY ===
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
    {
      // The business reference the list shows (AST-n): export only, ignored on import.
      csvColumn: 'reference',
      entityProperty: 'asset_reference',
      type: CsvFieldType.STRING,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Reference',
      group: 'Identity',
    },
    {
      csvColumn: 'name',
      entityProperty: 'name',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Name',
      group: 'Overview',
    },

    // === OVERVIEW TAB (description, properties) ===
    {
      csvColumn: 'notes',
      entityProperty: 'notes',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Notes',
      group: 'Overview',
      // The notes are rich text: same rules as on the page.
      importTransformFn: richTextCell('notes'),
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
      csvColumn: 'admin_zone',
      entityProperty: 'admin_zone',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Administration zone',
      group: 'Technical',
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
      // The names of the asset's real clusters (`checkClusterMemberships`, `writeClusterMemberships`).
      csvColumn: 'cluster',
      entityProperty: 'cluster',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Cluster Membership',
      group: 'Technical',
    },

    // === OPERATIONS TAB ===
    {
      csvColumn: 'operating_system',
      entityProperty: 'operating_system',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Operating System',
      group: 'Technical',
    },
    ...vulnerabilityCsvFields('Vulnerabilities'),

    // === NETWORK TAB ===
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
    await previewOperatingSystems(rows, context);
  },

  /**
   * The row as the commit stores it: catalog names resolved, provider kept (filled only when blank).
   * The operating system is compared to the marked link's label (or, in a fixture that still
   * carries the text on the row, to that text), without case; a `-` that removes a link is counted
   * (`noteCleared`). The Cluster Membership cell is compared to the asset's real clusters (`sameClusters`).
   */
  sameAsStored: async (rows, context) => {
    const settings = await requireImportCatalogs(context);
    const ids = rows.flatMap((row) => (row.existingEntity?.id ? [String(row.existingEntity.id)] : []));
    const labels = ids.length
      ? await operatingSystemWriter(context).labelsOf(context.manager, context.tenantId, ids)
      : new Map<string, string>();
    const naming = rows.filter((row) => row.existingEntity?.id && clusterCell(row).kind !== 'keep');
    const memberships = naming.length
      ? await clusterMembershipsOf(context.manager, context.tenantId, naming.map((row) => String(row.existingEntity.id)))
      : new Map<string, Array<{ id: string; name: string }>>();
    const currentOs = (stored: any) => {
      const id = String(stored.id ?? '');
      return labels.has(id) ? (labels.get(id) ?? '') : (typeof stored.operating_system === 'string' ? stored.operating_system : '');
    };
    for (const row of rows) {
      if (importCell(row.raw, 'operating_system').kind === 'clear' && currentOs(row.existingEntity).trim()) noteCleared(row, 1);
    }
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
      // What the label resolves to (`22.04` stored as `22.04 LTS` is the same), else the label.
      const resolved = operatingSystemChecks.get(context)?.get(row);
      const wanted = osRaw == null || String(osRaw).trim() === '' ? '' : resolved?.label ?? String(osRaw).trim();
      return sameOperatingSystem(currentOs(stored), wanted);
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
      // A name the check found beyond case, or by Kad's proposal, is written as the cluster's own name.
      const cells = clusterCells.get(context);
      const own = (names: string[]) => names.map((name) => cells?.renamed.get(nameKey(name)) ?? name);
      if (entity.id && cells?.matched.has(String(entity.id))) {
        const names = cells.namesByAsset.get(String(entity.id));
        if (names) pendingClusters.set(entity, own(names));
      } else if (!entity.id && Object.prototype.hasOwnProperty.call(entity, 'cluster')) {
        // A new asset: the names of its cell (`checkClusterMemberships`).
        pendingClusters.set(entity, own(clusterNames(entity.cluster)));
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
      // A version match the person undid (named as the check lists it, spaces collapsed): the version is created as written.
      const exactVersion = !!label && undoneMatch(context.params.unmatched, 'operating_system', label.replace(/\s+/g, ' '));
      const resolved = await operatingSystems.resolve(context.manager, context.tenantId, label, { create: true, exactVersion, userId: context.userId, audit: context.audit });
      await operatingSystems.setOperatingSystem(context.manager, context.tenantId, entity.id, resolved, 'import', context.userId, context.audit);
    }
    await writeClusterMemberships(entities, context);
  },
};
