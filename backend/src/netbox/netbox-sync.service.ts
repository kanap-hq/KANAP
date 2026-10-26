import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AiAdapterConfig } from '../ai/control-plane/providers/adapter-config.entity';
import { AssetsService } from '../assets/services';
import { assertPublicHttpUrl } from '../common/ssrf-guard';
import { withTenantExecution } from '../common/tenant-runner';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { AssetExternalLinkState } from './asset-external-link.entity';
import { NetboxClient } from './netbox.client';
import {
  NETBOX_LINK_SOURCE,
  NetboxConfigService,
  NetboxSyncStateView,
  normalizeNetboxAddress,
} from './netbox-config.service';
import {
  MappedAssetFields,
  MappedHardwareFields,
  NETBOX_VIRTUAL_MACHINES_NAME,
  NETBOX_VIRTUAL_MACHINES_SLUG,
  NetboxCatalogs,
  NetboxMapping,
  NetboxSubLocationTarget,
  managedFieldsOf,
  mapNetboxObject,
  matchCatalogOption,
  suggestClusterAsset,
  suggestOperatingSystem,
} from './netbox-mapper';
import { ExistingAsset } from './netbox-matcher';
import { netboxBadRequest, netboxFailureOf } from './netbox-errors';
import { NetboxNotice, netboxNotice, netboxNoticeFromStore, primaryNotice } from './netbox-notice';
import {
  ExistingLink,
  ExistingSubLocation,
  NetboxClusterAsset,
  NetboxClusterContext,
  NetboxClusterTarget,
  NetboxDecision,
  NetboxPlan,
  NetboxPlanRow,
  NetboxPlanWrite,
  NetboxSubLocationChange,
  NetboxSyncCounts,
  buildReviewBatch,
  claimedAssets,
  diffNetboxMapping,
  externalKey,
  isWriteDeferred,
  planClusterAttachment,
  planNetboxSync,
  resolveSubLocation,
  subLocationUpkeepNotices,
} from './netbox-planner';
import { NetboxApiError, NetboxLocation, NetboxLocationIndex, NetboxObject, NetboxObjectType } from './netbox.types';
import { LocationsService, SubItemExternal } from '../locations/locations.service';
import { operatingSystemLabelSql } from '../technologies/operating-system-codes';
import { OperatingSystemService } from '../technologies/operating-system.service';

// One engine for the three ways a synchronisation can be asked for: the
// read-only preview, the manual run and the scheduled run. Fetch, map, match,
// plan, then apply — the first four steps are identical everywhere, only the
// last one is skipped for a preview.
//
// Writes go through the asset services (never raw SQL), so validation,
// references and audit entries behave exactly as they do for a person, with
// the audit source set to the Netbox sync instead of a user.

const RUNNING_LOCK_PREFIX = 'netbox-sync';
/**
 * One review batch. A manual run writes only what its preview listed, so this
 * is how much a person is asked to read in one go, not a cap on what Netbox may
 * hold: whatever does not fit comes back in the next preview.
 */
const PREVIEW_ROW_LIMIT = 500;
/** Generous bound on the list of reviewed objects a run accepts. */
const REVIEWED_LIMIT = PREVIEW_ROW_LIMIT * 4;
/**
 * A run gives up after this many objects fail one after another. Writing
 * thousands of error rows and then reporting success helps nobody: something
 * systematic is wrong (a catalog value every object needs, a permission), and
 * it should be said once, loudly.
 */
const CONSECUTIVE_FAILURE_LIMIT = 10;
/** One request carries at most this many choices from the preview dialog. */
const DECISION_LIMIT = 1000;
/**
 * A re-preview after a choice in the dialog may reuse the inventory fetched
 * this recently, so settling eighty objects does not read Netbox eighty times.
 * Previews only: a run always reads Netbox again.
 */
const PREVIEW_INVENTORY_TTL_MS = 2 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the choices a preview dialog sent. Anything malformed is refused
 * outright: a choice that silently fell away would let an asset be created
 * that the person had just said not to create.
 */
export function parseNetboxDecisions(raw: unknown): NetboxDecision[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException('The choices made in the preview could not be read. Open the preview again.');
  }
  if (raw.length > DECISION_LIMIT) {
    throw new BadRequestException(`Too many choices in one go (${DECISION_LIMIT} at most). Apply these first, then continue.`);
  }
  const byKey = new Map<string, NetboxDecision>();
  for (const entry of raw) {
    const type = String((entry as any)?.external_type ?? '');
    const id = String((entry as any)?.external_id ?? '').trim();
    const action = String((entry as any)?.action ?? '');
    const assetId = String((entry as any)?.asset_id ?? '').trim();
    const valid = (type === 'device' || type === 'vm')
      && /^[0-9]{1,18}$/.test(id)
      && (action === 'link' || action === 'create' || action === 'ignore')
      && (action !== 'link' || UUID_PATTERN.test(assetId));
    if (!valid) {
      throw new BadRequestException('The choices made in the preview could not be read. Open the preview again.');
    }
    byKey.set(externalKey(type, id), {
      external_type: type as NetboxObjectType,
      external_id: id,
      action: action as NetboxDecision['action'],
      ...(action === 'link' ? { asset_id: assetId } : {}),
    });
  }
  return [...byKey.values()];
}

/**
 * Reads the list of objects the preview showed. A manual run with no list has
 * had nothing reviewed, so it creates and updates nothing: an older page, or a
 * direct API call, must not be a way around the review.
 */
export function parseNetboxReviewed(raw: unknown): Set<string> {
  if (raw == null) return new Set();
  if (!Array.isArray(raw) || raw.length > REVIEWED_LIMIT) {
    throw new BadRequestException('The list of reviewed objects could not be read. Open the preview again.');
  }
  const keys = new Set<string>();
  for (const entry of raw) {
    const type = String((entry as any)?.external_type ?? '');
    const id = String((entry as any)?.external_id ?? '').trim();
    if ((type !== 'device' && type !== 'vm') || !id) {
      throw new BadRequestException('The list of reviewed objects could not be read. Open the preview again.');
    }
    keys.add(externalKey(type, id));
  }
  return keys;
}

export type NetboxRecordRow = {
  id: string;
  external_type: NetboxObjectType;
  external_id: string;
  external_name: string | null;
  external_url: string;
  state: AssetExternalLinkState;
  asset: {
    id: string;
    name: string;
    asset_reference: string | null;
    status: string;
    /** The asset type code, and its label from the tenant's catalog. */
    kind: string | null;
    kind_label: string | null;
  } | null;
  candidates: Array<{ id: string; name: string; asset_reference: string | null }>;
  /** The raw status the inventory reports; KANAP's lifecycle does not follow it. */
  external_status: string | null;
  message: NetboxNotice | null;
  last_seen_at: string | null;
  last_synced_at: string | null;
};

export type NetboxPreviewResult = {
  ok: boolean;
  /** A stable code the screen translates. Set on a failure, and on a partial read. */
  code?: string | null;
  message: string | null;
  counts: NetboxSyncCounts;
  rows: NetboxPlanRow[];
  rows_truncated: boolean;
  /**
   * This preview is one batch. `remaining` objects still wait to be decided,
   * created or updated after it; applying leaves them untouched.
   */
  batch: { listed: number; remaining: number };
  /** Out-of-scope objects by reason; they are counted, never listed. */
  skipped_by_reason: Record<string, number>;
  /** The first names for each skip reason. Absent names are empty strings. */
  skipped_names: Record<string, string[]>;
  missing: NetboxRecordRow[];
  /**
   * How many role and site matches are SAVED. The Mappings tab pre-fills its
   * rows with suggestions, which look like a filled form but decide nothing
   * until they are saved; with none saved every object comes out skipped, and
   * the dialog says that instead of listing hundreds of skipped objects.
   */
  saved_matches: { roles: number; sites: number };
  /** Changes to the shared sub-locations, listed once each. */
  sub_locations: {
    available: boolean;
    changes: NetboxSubLocationChange[];
  };
  /**
   * Notices about the inventory as a whole, listed once each: a Netbox cluster
   * whose virtual machines cannot be attached to a KANAP cluster.
   */
  notices: NetboxNotice[];
};

export type NetboxStatus = {
  configured: boolean;
  enabled: boolean;
  auto_sync: boolean;
  sync: NetboxSyncStateView;
  records: Record<AssetExternalLinkState, number>;
  /**
   * Objects the last manual run left for a later batch. While it is not zero,
   * automatic runs hold: they would import what nobody has read.
   */
  review_pending: number;
};

/** Body of a preview or of a manual run: the choices made in the dialog. */
export type NetboxSyncInput = {
  decisions?: unknown;
  reuse_inventory?: unknown;
  /** Manual run only: the objects the preview listed, `{external_type, external_id}`. */
  reviewed?: unknown;
};

export type NetboxResolveInput = {
  action?: unknown;
  asset_id?: unknown;
};

type LocalContext = {
  config: AiAdapterConfig;
  catalogs: NetboxCatalogs;
  assets: ExistingAsset[];
  links: ExistingLink[];
  subLocations: ExistingSubLocation[];
  defaultEnvironment: string;
  roleMap: Record<string, string>;
  siteMap: Record<string, string>;
  osMap: Record<string, string>;
  clusters: NetboxClusterContext;
};

type ApplyOutcome =
  | { action: 'create' | 'update' | 'unchanged'; assetId: string }
  | { action: 'error'; notice: NetboxNotice };

// `cluster` is not a field of the asset row: applyRow adds the relation itself.
const ASSET_FIELD_BY_DIFF_KEY: Record<string, keyof MappedAssetFields> = {
  name: 'name',
  kind: 'kind',
  location: 'location_id',
  status: 'status',
  hostname: 'hostname',
  domain: 'domain',
  operating_system: 'operating_system',
  primary_ip: 'ip_addresses',
};

const HARDWARE_FIELDS: Array<keyof MappedHardwareFields> = [
  'serial_number',
  'manufacturer',
  'model',
  'rack_location',
  'rack_unit',
];

// Every read of a record row selects exactly these columns.
const RECORD_COLUMNS = `l.id, l.external_type, l.external_id, l.external_name, l.external_url, l.state,
              l.external_status, l.candidate_asset_ids, l.message_code, l.message_params,
              l.last_seen_at, l.last_synced_at,
              a.id AS asset_id, a.name AS asset_name, a.asset_reference, a.status AS asset_status,
              a.kind AS asset_kind`;

/**
 * The needle of a record search, ready to bind. `%`, `_` and `\` typed by the
 * user are escaped so they match themselves instead of acting as wildcards;
 * the value itself never reaches the SQL text.
 */
export function netboxRecordSearchNeedle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 100);
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function emptyRecordCounts(): Record<AssetExternalLinkState, number> {
  return { linked: 0, ambiguous: 0, missing: 0, ignored: 0, error: 0 };
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The message an HTTP exception carries, when it carries one. */
function httpExceptionMessage(error: HttpException): string | null {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown })?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return null;
}

/** A message safe to show an administrator, whatever went wrong. */
export function plainErrorMessage(error: unknown): string {
  if (error instanceof NetboxApiError) {
    return error.message;
  }
  if (error instanceof HttpException) {
    const message = httpExceptionMessage(error);
    if (message) return message;
  }
  return 'The synchronisation could not finish. Check the Netbox connection, then try again.';
}

/**
 * The notice one object's failure deserves. A rejection from the asset
 * services already reads plainly ("A host name can use only…"), so it is passed
 * through; anything else points at the server log rather than at the Netbox
 * connection, which is demonstrably working if we got this far.
 */
export function objectFailureNotice(error: unknown): NetboxNotice {
  if (error instanceof BadRequestException || isDuplicateNameRefusal(error)) {
    const detail = httpExceptionMessage(error);
    if (detail) return netboxNotice('validation_failed', { detail });
  }
  return netboxNotice('save_failed');
}

/** The `code` of a refusal from the services (`{ code, message }`), when it carries one. */
function refusalCode(error: unknown): string | null {
  if (!(error instanceof BadRequestException) && !(error instanceof ConflictException)) return null;
  const response = error.getResponse();
  const code = typeof response === 'object' && response !== null ? (response as { code?: unknown }).code : null;
  return typeof code === 'string' ? code : null;
}

/** Names another record already holds: 409 `duplicate` (`common/duplicate-name.ts`), or an asset's name or FQDN. */
const DUPLICATE_NAME_CODES = new Set(['duplicate', 'asset_name_taken', 'asset_fqdn_taken']);

/** A name another record already has: its message reads plainly. */
function isDuplicateNameRefusal(error: unknown): error is ConflictException {
  return error instanceof ConflictException && DUPLICATE_NAME_CODES.has(refusalCode(error) ?? '');
}

/** The locations service refusing a name another sub-location already holds. */
function isSubLocationNameRejection(error: unknown): boolean {
  return isDuplicateNameRefusal(error)
    && /already exists at this location/i.test(httpExceptionMessage(error) ?? '');
}

/** An IP address another asset already holds in the same subnet. A malformed address is not one. */
export function isDuplicateIpRejection(error: unknown): boolean {
  return error instanceof BadRequestException && refusalCode(error) === 'asset_ip_taken';
}

/** Every Location by id, which is how the walk up to the top level finds a parent. */
function indexNetboxLocations(locations: NetboxLocation[]): NetboxLocationIndex {
  return new Map(locations.map((location) => [location.id, location]));
}

/**
 * One read of Netbox, as every entry point uses it. `complete` covers devices
 * and virtual machines only: a truncated location list disables sub-location
 * handling but must never disarm the "missing" guard for equipment.
 */
type FetchedInventory = {
  objects: NetboxObject[];
  complete: boolean;
  locations: NetboxLocationIndex | null;
};

@Injectable()
export class NetboxSyncService {
  private readonly logger = new Logger(NetboxSyncService.name);
  /** Last inventory a preview fetched, per tenant. See PREVIEW_INVENTORY_TTL_MS. */
  private readonly previewInventory = new Map<string, {
    at: number;
    baseUrl: string;
    fetched: FetchedInventory;
  }>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: NetboxConfigService,
    private readonly client: NetboxClient,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly assets: AssetsService,
    private readonly locations: LocationsService,
    @Optional() private readonly operatingSystems?: OperatingSystemService,
  ) {}

  // ==========================================================================
  // Read side
  // ==========================================================================

  async getStatus(manager: EntityManager, tenantId: string): Promise<NetboxStatus> {
    const config = await this.config.getConfig(manager, tenantId);
    const view = this.config.toView(config);
    const rows: Array<{ state: AssetExternalLinkState; total: string }> = await manager.query(
      `SELECT state, count(*)::text AS total
       FROM asset_external_links
       WHERE tenant_id = $1 AND source = $2
       GROUP BY state`,
      [tenantId, NETBOX_LINK_SOURCE],
    );
    const records = emptyRecordCounts();
    for (const row of rows) {
      records[row.state] = Number(row.total) || 0;
    }
    return {
      configured: view.configured,
      enabled: view.enabled,
      auto_sync: view.auto_sync,
      sync: this.config.readSyncState(config),
      records,
      review_pending: view.review_pending,
    };
  }

  async listRecords(
    manager: EntityManager,
    tenantId: string,
    query: { state?: string; q?: string; page?: string | number; limit?: string | number },
  ): Promise<{ items: NetboxRecordRow[]; total: number }> {
    // Whole numbers only, and bound as parameters: neither value reaches the
    // SQL text, so a crafted query string cannot shape the statement.
    const page = Math.max(1, Math.floor(Number(query.page)) || 1);
    const limit = Math.min(200, Math.max(1, Math.floor(Number(query.limit)) || 50));
    const state = typeof query.state === 'string' && query.state.trim() ? query.state.trim() : null;
    const needle = netboxRecordSearchNeedle(query.q);

    const params: unknown[] = [tenantId, NETBOX_LINK_SOURCE];
    let where = 'WHERE l.tenant_id = $1 AND l.source = $2';
    if (state) {
      params.push(state);
      where += ` AND l.state = $${params.length}`;
    }
    if (needle) {
      params.push(needle);
      // The needle is bound, never inlined; the asset side of the search is
      // reached through the same tenant-scoped join as the page query.
      where += ` AND (l.external_name ILIKE $${params.length}`
        + ` OR a.name ILIKE $${params.length}`
        + ` OR a.asset_reference ILIKE $${params.length})`;
    }
    // The count only needs the assets table when the search reads from it.
    const countJoin = needle ? 'LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = $1' : '';

    const totalRows: Array<{ total: string }> = await manager.query(
      `SELECT count(*)::text AS total FROM asset_external_links l ${countJoin} ${where}`,
      params,
    );
    const rows = await manager.query(
      `SELECT ${RECORD_COLUMNS}
       FROM asset_external_links l
       LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = $1
       ${where}
       ORDER BY l.external_name ASC NULLS LAST, l.external_id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    return {
      items: await this.decorateRecords(manager, tenantId, rows),
      total: Number(totalRows[0]?.total) || 0,
    };
  }

  // Resolves the candidate assets of every row in one batched query.
  private async decorateRecords(
    manager: EntityManager,
    tenantId: string,
    rows: Array<Record<string, any>>,
  ): Promise<NetboxRecordRow[]> {
    const candidateIds = Array.from(new Set(
      rows.flatMap((row) => (Array.isArray(row.candidate_asset_ids) ? row.candidate_asset_ids : [])),
    ));
    const candidates: Array<{ id: string; name: string; asset_reference: string | null }> = candidateIds.length > 0
      ? await manager.query(
        `SELECT id, name, asset_reference FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, candidateIds],
      )
      : [];
    const candidateById = new Map(candidates.map((asset) => [asset.id, asset]));

    // The asset type the user knows ("Switch", "Physical server") lives in the
    // tenant's catalog, not on the row. One read covers the whole page; a code
    // the catalog does not hold falls back to itself.
    const kindLabels = new Map<string, string>();
    if (rows.some((row) => row.asset_kind)) {
      const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
      for (const option of settings.serverKinds) kindLabels.set(option.code, option.label);
    }

    return rows.map((row) => ({
      id: row.id,
      external_type: row.external_type,
      external_id: row.external_id,
      external_name: row.external_name,
      external_url: row.external_url,
      state: row.state,
      external_status: row.external_status ?? null,
      asset: row.asset_id
        ? {
          id: row.asset_id,
          name: row.asset_name,
          asset_reference: row.asset_reference,
          status: row.asset_status,
          kind: row.asset_kind ?? null,
          kind_label: row.asset_kind ? kindLabels.get(row.asset_kind) ?? row.asset_kind : null,
        }
        : null,
      candidates: (Array.isArray(row.candidate_asset_ids) ? row.candidate_asset_ids : [])
        .map((id: string) => candidateById.get(id))
        .filter((asset: unknown): asset is { id: string; name: string; asset_reference: string | null } => !!asset),
      message: netboxNoticeFromStore(row.message_code, row.message_params),
      last_seen_at: isoOrNull(row.last_seen_at),
      last_synced_at: isoOrNull(row.last_synced_at),
    }));
  }

  private async findRecord(manager: EntityManager, tenantId: string, id: string): Promise<NetboxRecordRow> {
    const rows = await manager.query(
      `SELECT ${RECORD_COLUMNS}
       FROM asset_external_links l
       LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = $1
       WHERE l.tenant_id = $1 AND l.source = $2 AND l.id = $3`,
      [tenantId, NETBOX_LINK_SOURCE, id],
    );
    if (rows.length === 0) {
      throw new NotFoundException('This Netbox object is not in the list any more.');
    }
    return (await this.decorateRecords(manager, tenantId, rows))[0];
  }

  /**
   * Admin "Test connection". Values typed in the dialog win over the stored
   * ones so an address can be checked before it is saved. Never throws for a
   * connection problem: the card shows the reason.
   */
  async testConnection(
    manager: EntityManager,
    tenantId: string,
    input: { base_url?: unknown; api_token?: unknown; insecure_tls?: unknown; request_timeout_seconds?: unknown },
  ): Promise<{ ok: boolean; code?: string; message: string; netbox_version?: string }> {
    const config = await this.config.getConfig(manager, tenantId);
    const baseUrlRaw = typeof input.base_url === 'string' && input.base_url.trim() ? input.base_url.trim() : null;
    const tokenRaw = typeof input.api_token === 'string' && input.api_token.trim() ? input.api_token.trim() : null;
    const timeoutRaw = Number(input.request_timeout_seconds);
    // The outcome is kept on the configuration only when the test used the
    // saved address and token, not values typed in the dialog and not saved.
    let testsStoredValues = !!config && !tokenRaw && !baseUrlRaw;

    let connection;
    try {
      const baseUrl = baseUrlRaw ? normalizeNetboxAddress(baseUrlRaw) : null;
      if (baseUrl) assertPublicHttpUrl(baseUrl); // SSRF: blocks internal targets in cloud, no-op on-prem
      if (baseUrl && config && !tokenRaw && baseUrl === (config.base_url ?? null)) testsStoredValues = true;
      connection = this.config.buildConnection(config, {
        baseUrl,
        token: tokenRaw,
        insecureTls: typeof input.insecure_tls === 'boolean' ? input.insecure_tls : undefined,
        timeoutSeconds: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined,
      });
    } catch (error) {
      return this.finishConnectionTest(manager, tenantId, testsStoredValues ? config : null, this.connectionFailure(tenantId, 'connection test', error));
    }

    try {
      const version = await this.client.getVersion(connection);
      return this.finishConnectionTest(manager, tenantId, testsStoredValues ? config : null, {
        ok: true,
        ...(version ? { netbox_version: version } : {}),
        message: version ? `Connected to Netbox ${version}.` : 'Connected to Netbox.',
      });
    } catch (error) {
      return this.finishConnectionTest(manager, tenantId, testsStoredValues ? config : null, this.connectionFailure(tenantId, 'connection test', error));
    }
  }

  /**
   * Writes the test outcome next to the saved address when a configuration
   * exists. A failed write still returns the outcome: the card can show it
   * for this session.
   */
  private async finishConnectionTest(
    manager: EntityManager,
    tenantId: string,
    config: AiAdapterConfig | null,
    result: { ok: boolean; code?: string; message: string; netbox_version?: string },
  ): Promise<{ ok: boolean; code?: string; message: string; netbox_version?: string; tested_at: string; persisted: boolean }> {
    const testedAt = new Date().toISOString();
    let persisted = false;
    if (config) {
      try {
        persisted = await this.config.recordConnectionTest(manager, config, { ok: result.ok, tested_at: testedAt });
      } catch (error) {
        this.logger.warn(`Netbox last test could not be saved for tenant ${tenantId}: ${plainErrorMessage(error)}`);
      }
    }
    return { ...result, tested_at: testedAt, persisted };
  }

  /** A connection problem as a code and a sentence the screen can translate. */
  private connectionFailure(
    tenantId: string,
    action: string,
    error: unknown,
  ): { ok: false; code: string; message: string } {
    const failure = netboxFailureOf(error);
    if (failure.detail) {
      this.logger.warn(`Netbox ${action} failed for tenant ${tenantId}: ${failure.detail}`);
    }
    return { ok: false, code: failure.code, message: failure.message };
  }

  /**
   * Roles, sites, platforms and clusters as Netbox reports them, next to the
   * KANAP asset types, locations, operating systems and clusters they can be
   * matched with, plus a suggestion for every entry whose name already points
   * at one.
   */
  async mappingOptions(manager: EntityManager, tenantId: string) {
    const config = await this.config.getConfig(manager, tenantId);
    const view = this.config.toView(config);
    if (!view.configured) {
      throw new BadRequestException('Set up the Netbox connection first, then choose the matches.');
    }
    const connection = this.config.buildConnection(config);
    let deviceRoles;
    let sites;
    let platforms;
    let virtualMachineCount;
    let clusters;
    try {
      [deviceRoles, sites, platforms, virtualMachineCount, clusters] = await Promise.all([
        this.client.listRoles(connection),
        this.client.listSites(connection),
        // Netbox permissions are granted per object type: a token that reads
        // devices, roles and sites may still be refused the platforms. That
        // must cost the operating systems alone — failing the whole tab would
        // take the role and site matches down with it, on a setup that works.
        this.client.listPlatforms(connection).catch((error) => {
          this.logger.warn(
            `Netbox platforms could not be read for tenant ${tenantId}: ${plainErrorMessage(error)}`,
          );
          return null;
        }),
        this.client.countVirtualMachines(connection),
        // Clusters are optional the same way: the import of devices and virtual
        // machines does not need them, and a token that cannot read them must
        // not take the rest of the tab down.
        this.client.listClusters(connection).catch((error) => {
          this.logger.warn(
            `Netbox clusters could not be read for tenant ${tenantId}: ${plainErrorMessage(error)}`,
          );
          return null;
        }),
      ]);
    } catch (error) {
      const failure = netboxFailureOf(error);
      if (failure.detail) {
        this.logger.warn(`Netbox mapping options failed for tenant ${tenantId}: ${failure.detail}`);
      }
      throw netboxBadRequest(failure.code);
    }

    // Every virtual machine is matched through one reserved entry, listed
    // first: their Netbox roles are not used, so a single decision covers them.
    const roles = [
      {
        slug: NETBOX_VIRTUAL_MACHINES_SLUG,
        name: NETBOX_VIRTUAL_MACHINES_NAME,
        device_count: 0,
        vm_count: virtualMachineCount,
      },
      ...deviceRoles.filter((role) => role.slug !== NETBOX_VIRTUAL_MACHINES_SLUG),
    ];

    const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
    const operatingSystems = await this.operatingSystemChoices(manager, tenantId);
    const locations: Array<{ id: string; name: string }> = await manager.query(
      `SELECT id, name FROM locations WHERE tenant_id = $1 ORDER BY name ASC`,
      [tenantId],
    );
    const kanapClusters: Array<{ id: string; name: string }> = await manager.query(
      `SELECT id, name FROM assets
       WHERE tenant_id = $1 AND is_cluster = true AND status IS DISTINCT FROM 'retired'
       ORDER BY name ASC`,
      [tenantId],
    );
    const assetKinds = settings.serverKinds.map((option) => ({ code: option.code, label: option.label }));
    const saved = this.config.getMapping(config);

    const suggestedRoleMap: Record<string, string> = {};
    for (const role of roles) {
      if (saved.role_map[role.slug]) continue;
      // "Virtual machines" has no Netbox name to match on, so it is suggested
      // the virtual-machine asset type directly when the tenant has one.
      const match = role.slug === NETBOX_VIRTUAL_MACHINES_SLUG
        ? settings.serverKinds.find((option) => option.code === 'virtual_machine') ?? null
        : matchCatalogOption(role.name, settings.serverKinds).option;
      if (match) suggestedRoleMap[role.slug] = match.code;
    }
    const suggestedSiteMap: Record<string, string> = {};
    for (const site of sites) {
      if (saved.site_map[site.slug]) continue;
      const match = locations.find((location) => location.name.trim().toLowerCase() === site.name.trim().toLowerCase());
      if (match) suggestedSiteMap[site.slug] = match.id;
    }
    // A platform nobody matches costs the object nothing: its operating system
    // is simply left as it is. So the suggestion may be generous where the two
    // maps above cannot be — "Debian 12" pre-fills "Debian 12 (bookworm)".
    const suggestedOsMap: Record<string, string> = {};
    for (const platform of platforms ?? []) {
      if (saved.os_map[platform.slug]) continue;
      const match = suggestOperatingSystem(platform.name, operatingSystems);
      if (match) suggestedOsMap[platform.slug] = match.code;
    }
    // A suggestion only pre-fills the form. Nothing is attached until the
    // administrator saves the match.
    const savedClusterMap = saved.cluster_map ?? {};
    const suggestedClusterMap: Record<string, string> = {};
    for (const cluster of clusters ?? []) {
      if (savedClusterMap[cluster.id]) continue;
      const match = suggestClusterAsset(cluster.name, kanapClusters);
      if (match) suggestedClusterMap[cluster.id] = match;
    }

    return {
      roles,
      sites,
      platforms: platforms ?? [],
      /** The token could not read them; the operating systems cannot be matched. */
      platforms_unavailable: platforms == null,
      clusters: clusters ?? [],
      /** The token could not read them; virtual machines cannot be attached from here. */
      clusters_unavailable: clusters == null,
      asset_kinds: assetKinds,
      locations,
      operating_systems: operatingSystems,
      kanap_clusters: kanapClusters,
      role_map: saved.role_map,
      site_map: saved.site_map,
      os_map: saved.os_map,
      cluster_map: savedClusterMap,
      cluster_names: saved.cluster_names ?? {},
      suggested_role_map: suggestedRoleMap,
      suggested_site_map: suggestedSiteMap,
      suggested_os_map: suggestedOsMap,
      suggested_cluster_map: suggestedClusterMap,
    };
  }

  // ==========================================================================
  // Plan
  // ==========================================================================

  /** Operating-system labels the platform map offers. Empty when the service is not wired (tests). */
  private operatingSystemChoices(manager: EntityManager, tenantId: string) {
    return this.operatingSystems?.mappingChoices(manager, tenantId) ?? Promise.resolve([]);
  }

  /** Everything the plan needs from the database, read in a handful of queries. */
  private async loadLocalContext(manager: EntityManager, tenantId: string): Promise<LocalContext> {
    const config = await this.config.getConfig(manager, tenantId);
    const view = this.config.toView(config);
    if (!config || !view.configured) {
      throw new BadRequestException('Set up the Netbox connection first, then run a synchronisation.');
    }
    if (!view.enabled) {
      throw new BadRequestException('The Netbox connection is turned off. Turn it on, then run a synchronisation.');
    }

    const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
    const locations: Array<{ id: string; name: string; provider: string | null }> = await manager.query(
      `SELECT id, name, provider FROM locations WHERE tenant_id = $1`,
      [tenantId],
    );
    const assets: ExistingAsset[] = await manager.query(
      `SELECT a.id, a.name, a.asset_reference, a.status, a.kind, a.location_id, a.sub_location_id,
              a.hostname, a.domain, a.fqdn, ${operatingSystemLabelSql('a')} AS operating_system, a.ip_addresses,
              h.serial_number, h.manufacturer, h.model, h.rack_location, h.rack_unit
       FROM assets a
       LEFT JOIN asset_hardware_info h ON h.asset_id = a.id AND h.tenant_id = $1
       WHERE a.tenant_id = $1`,
      [tenantId],
    );
    // One query for every sub-location of the tenant: the resolver needs the
    // ones of the locations this run writes to, and grouping per location would
    // cost a round trip per row.
    const subLocations: ExistingSubLocation[] = await manager.query(
      `SELECT id, location_id, name, description, external_source, external_id, external_url
       FROM location_sub_items
       WHERE tenant_id = $1`,
      [tenantId],
    );
    const links: ExistingLink[] = await manager.query(
      `SELECT id, external_type, external_id, asset_id, state
       FROM asset_external_links
       WHERE tenant_id = $1 AND source = $2`,
      [tenantId, NETBOX_LINK_SOURCE],
    );
    const mapping = this.config.getMapping(config);
    const clusters = await this.loadClusterContext(manager, tenantId, mapping.cluster_map);

    return {
      config,
      catalogs: {
        assetKinds: settings.serverKinds,
        assetProviders: settings.serverProviders,
        operatingSystems: await this.operatingSystemChoices(manager, tenantId),
        lifecycleStates: settings.lifecycleStates,
        ipAddressTypes: settings.ipAddressTypes,
        domains: settings.domains,
        subnets: settings.subnets,
        locations,
      },
      assets,
      links,
      subLocations,
      defaultEnvironment: view.default_environment,
      roleMap: mapping.role_map,
      siteMap: mapping.site_map,
      osMap: mapping.os_map,
      clusters,
    };
  }

  /**
   * The assets the saved cluster matches name, the clusters in service that
   * already contain each asset, and the member hosts in service that carry it.
   * The reads carry this tenant's id: a match that names an asset of another
   * tenant finds nothing and reads as deleted.
   */
  private async loadClusterContext(
    manager: EntityManager,
    tenantId: string,
    clusterMap: Record<string, string>,
  ): Promise<NetboxClusterContext> {
    const ids = [...new Set(Object.values(clusterMap))].filter((id) => UUID_PATTERN.test(id));
    const targets: NetboxClusterAsset[] = ids.length > 0
      ? await manager.query(
        `SELECT id, name, is_cluster, status FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, ids],
      )
      : [];
    const containers = new Map<string, Array<{ id: string; name: string }>>();
    if (ids.length > 0) {
      const rows: Array<{ asset_id: string; id: string; name: string }> = await manager.query(
        `SELECT r.related_asset_id AS asset_id, c.id, c.name
         FROM asset_relations r
         JOIN assets c ON c.tenant_id = $1 AND c.id = r.asset_id
           AND c.is_cluster = true AND c.status IS DISTINCT FROM 'retired'
         WHERE r.tenant_id = $1 AND r.relation_type = 'contains'
         ORDER BY c.name, c.id`,
        [tenantId],
      );
      for (const row of rows) {
        const list = containers.get(row.asset_id) ?? [];
        list.push({ id: row.id, name: row.name });
        containers.set(row.asset_id, list);
      }
    }
    // The member hosts that carry a virtual machine today: attaching it to the cluster replaces
    // their link (R1). One query for every mapped cluster, everything scoped by the tenant.
    const hosts = new Map<string, Array<{ id: string; name: string; cluster_id: string }>>();
    if (ids.length > 0) {
      const rows: Array<{ asset_id: string; id: string; name: string; cluster_id: string }> = await manager.query(
        `SELECT r.related_asset_id AS asset_id, h.id, h.name, m.cluster_id
           FROM asset_cluster_members m
           JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id
             AND c.status IS DISTINCT FROM 'retired'
           JOIN assets h ON h.tenant_id = m.tenant_id AND h.id = m.asset_id
             AND h.status IS DISTINCT FROM 'retired'
           JOIN asset_relations r ON r.tenant_id = m.tenant_id AND r.asset_id = m.asset_id
             AND r.relation_type = 'contains'
          WHERE m.tenant_id = $1 AND m.cluster_id = ANY($2::uuid[])
          ORDER BY m.cluster_id, lower(h.name), h.id, r.related_asset_id`,
        [tenantId, ids],
      );
      for (const row of rows) {
        const list = hosts.get(row.asset_id) ?? [];
        list.push({ id: row.id, name: row.name, cluster_id: row.cluster_id });
        hosts.set(row.asset_id, list);
      }
    }
    // Ids are matched in lower case, as the database returns them.
    const map: Record<string, string> = {};
    for (const [clusterId, assetId] of Object.entries(clusterMap)) map[clusterId] = assetId.toLowerCase();
    return { map, targets: new Map(targets.map((target) => [String(target.id), target])), containers, hosts };
  }

  /**
   * Fetches every device and virtual machine in one go. `complete` is false
   * when either walk stopped on the page cap: the caller must then treat the
   * inventory as partial and leave the missing computation alone.
   *
   * Locations are fetched apart, and a failure there never fails the run:
   * equipment still imports, nothing touches a sub-location, and the preview
   * says why. A partial assignment would be worse than none.
   */
  private async fetchObjects(local: LocalContext): Promise<FetchedInventory> {
    const connection = this.config.buildConnection(local.config);
    const [devices, virtualMachines, locations] = await Promise.all([
      this.client.listDevices(connection),
      this.client.listVirtualMachines(connection),
      this.client.listLocations(connection)
        .then((page) => (page.complete ? indexNetboxLocations(page.locations) : null))
        .catch((error) => {
          this.logger.warn(
            `Netbox locations could not be read for tenant ${local.config.tenant_id}: ${plainErrorMessage(error)}`,
          );
          return null;
        }),
    ]);
    return {
      objects: [...devices.objects, ...virtualMachines.objects],
      // Locations deliberately do not take part: a truncated location list must
      // not disarm the "missing" guard for equipment.
      complete: devices.complete && virtualMachines.complete,
      locations,
    };
  }

  private buildPlan(
    local: LocalContext,
    fetched: FetchedInventory,
    decisions: NetboxDecision[] = [],
  ): { plan: NetboxPlan; mappings: NetboxMapping[] } {
    const mappings = fetched.objects.map((object) => mapNetboxObject(object, {
      roleMap: local.roleMap,
      siteMap: local.siteMap,
      osMap: local.osMap,
      defaultEnvironment: local.defaultEnvironment,
      catalogs: local.catalogs,
      locations: fetched.locations,
    }));
    const plan = planNetboxSync({
      mappings,
      links: local.links,
      assets: local.assets,
      catalogs: local.catalogs,
      // A partial list is no basis for declaring anything gone.
      fetchOk: fetched.complete,
      totalObjects: fetched.objects.length,
      decisions,
      subLocations: local.subLocations,
      locationIndex: fetched.locations,
      siteMap: local.siteMap,
      clusters: local.clusters,
    });
    return { plan, mappings };
  }

  /**
   * Refuses, before anything is shown or started, a link to an asset that is
   * gone or that another Netbox object holds. `seen` is the set of objects the
   * fetch returned, when there is one: a record whose object left Netbox does
   * not hold its asset any more.
   */
  private assertDecisionsApply(
    local: LocalContext,
    decisions: NetboxDecision[],
    seen: Set<string> | null,
  ): void {
    const assetIds = new Set(local.assets.map((asset) => asset.id));
    const owners = claimedAssets(local.links, seen);
    for (const decision of decisions) {
      if (decision.action !== 'link' || !decision.asset_id) continue;
      if (!assetIds.has(decision.asset_id)) {
        throw new BadRequestException('One of the chosen assets does not exist any more. Choose another one.');
      }
      const owner = owners.get(decision.asset_id);
      if (owner !== undefined && owner !== externalKey(decision.external_type, decision.external_id)) {
        const asset = local.assets.find((entry) => entry.id === decision.asset_id);
        throw new ConflictException({
          statusCode: 409,
          code: 'NETBOX_ASSET_ALREADY_LINKED',
          message: `${asset?.name ?? 'This asset'} is already linked to another Netbox object. Pick another asset, or create a new one.`,
        });
      }
    }
  }

  /**
   * Read-only preview, run inside the request. Never writes, never throws for
   * a connection problem: the dialog shows the reason instead.
   */
  async preview(manager: EntityManager, tenantId: string, input: NetboxSyncInput = {}): Promise<NetboxPreviewResult> {
    const decisions = parseNetboxDecisions(input.decisions);
    const local = await this.loadLocalContext(manager, tenantId);
    const savedMatches = {
      roles: Object.keys(local.roleMap).length,
      sites: Object.keys(local.siteMap).length,
    };
    let fetched: FetchedInventory;
    try {
      const baseUrl = String(local.config.base_url ?? '');
      const kept = this.previewInventory.get(tenantId);
      if (
        input.reuse_inventory === true
        && kept && kept.baseUrl === baseUrl
        && Date.now() - kept.at < PREVIEW_INVENTORY_TTL_MS
      ) {
        fetched = kept.fetched;
      } else {
        fetched = await this.fetchObjects(local);
        this.previewInventory.set(tenantId, { at: Date.now(), baseUrl, fetched });
      }
    } catch (error) {
      const failure = this.connectionFailure(tenantId, 'preview', error);
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
        counts: { create: 0, update: 0, unchanged: 0, ambiguous: 0, skipped: 0, missing: 0, error: 0 },
        rows: [],
        rows_truncated: false,
        batch: { listed: 0, remaining: 0 },
        skipped_by_reason: {},
        skipped_names: {},
        missing: [],
        saved_matches: savedMatches,
        // Nothing was read, so nothing is known about the sub-locations either.
        sub_locations: { available: true, changes: [] },
        notices: [],
      };
    }
    this.assertDecisionsApply(
      local,
      decisions,
      fetched.complete && fetched.objects.length > 0
        ? new Set(fetched.objects.map((object) => externalKey(object.type, object.id)))
        : null,
    );
    const { plan } = this.buildPlan(local, fetched, decisions);
    // One batch a person can read. Rows that need nothing are left out, except
    // when they carry a warning (an operating system missing from the catalog
    // has to stay visible after the object itself has stopped changing) or a
    // decision, which the person must be able to see and take back.
    const batch = buildReviewBatch(plan.rows, PREVIEW_ROW_LIMIT);
    const missingIds = plan.missing.map((link) => link.id);
    const missingRows = missingIds.length > 0
      ? await this.decorateRecords(
        manager,
        tenantId,
        await manager.query(
          `SELECT ${RECORD_COLUMNS}
           FROM asset_external_links l
           LEFT JOIN assets a ON a.id = l.asset_id AND a.tenant_id = $1
           WHERE l.tenant_id = $1 AND l.id = ANY($2::uuid[])
           ORDER BY l.external_name ASC NULLS LAST`,
          [tenantId, missingIds],
        ),
      )
      : [];

    return {
      ok: true,
      // A partial inventory is worth saying out loud before anyone applies it.
      code: fetched.complete ? null : 'fetch_incomplete',
      message: fetched.complete ? null : netboxNotice('fetch_incomplete').text,
      counts: plan.counts,
      rows: batch.rows,
      rows_truncated: batch.remaining > 0,
      batch: { listed: batch.rows.length, remaining: batch.remaining },
      skipped_by_reason: batch.skipped_by_reason,
      skipped_names: batch.skipped_names,
      missing: missingRows,
      saved_matches: savedMatches,
      sub_locations: {
        available: plan.subLocationsAvailable,
        changes: plan.subLocations,
      },
      notices: plan.clusterNotices,
    };
  }

  // ==========================================================================
  // Apply
  // ==========================================================================

  /** Starts a manual run in the background; the page polls GET /netbox/status. */
  async startManualRun(manager: EntityManager, tenantId: string, input: NetboxSyncInput = {}): Promise<NetboxStatus> {
    const decisions = parseNetboxDecisions(input.decisions);
    const reviewed = parseNetboxReviewed(input.reviewed);
    const status = await this.getStatus(manager, tenantId);
    if (!status.configured) {
      throw new BadRequestException('Set up the Netbox connection first, then run a synchronisation.');
    }
    if (!status.enabled) {
      throw new BadRequestException('The Netbox connection is turned off. Turn it on, then run a synchronisation.');
    }
    if (status.sync.status === 'running') {
      // Object response, so `code` sits at the top level of the JSON body the
      // page reads, next to the usual statusCode and message.
      throw new ConflictException({
        statusCode: 409,
        code: 'NETBOX_SYNC_RUNNING',
        message: 'A synchronisation is already running. Wait for it to finish.',
      });
    }
    if (decisions.some((decision) => decision.action === 'link')) {
      // No fetch here, so every live record counts as holding its asset. The
      // planner has the last word once the run has read Netbox.
      this.assertDecisionsApply(await this.loadLocalContext(manager, tenantId), decisions, null);
    }
    // Fire and forget: the run writes its own state, so nothing here has to be
    // The lock, not a stored flag, decides whether a run may start: a crashed
    // run leaves a stale 'running' behind but frees its lock, and must not
    // block the button. Taken here, synchronously, and handed to the
    // background run that keeps holding it.
    const runner = await this.acquireRunLock(tenantId);
    if (!runner) {
      throw new ConflictException({
        statusCode: 409,
        code: 'NETBOX_SYNC_RUNNING',
        message: 'A synchronisation is already running. Wait for it to finish.',
      });
    }
    const startedAt = new Date();
    await this.persistState(tenantId, this.runningState('manual', startedAt));
    void this.runLocked(tenantId, 'manual', runner, startedAt, decisions, reviewed).catch((error) => {
      this.logger.error(`Netbox synchronisation could not start for tenant ${tenantId}: ${plainErrorMessage(error)}`);
    });
    return { ...status, sync: this.runningState('manual', startedAt) };
  }

  private runningState(trigger: 'manual' | 'scheduled', startedAt: Date): NetboxSyncStateView {
    return {
      status: 'running',
      trigger,
      started_at: startedAt.toISOString(),
      finished_at: null,
      duration_ms: null,
      counts: null,
      error: null,
      warnings: [],
    };
  }

  /**
   * Takes the per-tenant run lock. Session-scoped, on a connection of its own,
   * because a run uses one transaction per object rather than one for the whole
   * run. Returns null when another run already holds it.
   */
  private async acquireRunLock(tenantId: string) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const lock = await runner.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [`${RUNNING_LOCK_PREFIX}:${tenantId}`],
      );
      if (lock[0]?.locked === true) {
        return runner;
      }
    } catch (error) {
      await this.releaseRunLock(runner, tenantId);
      throw error;
    }
    await runner.release().catch(() => undefined);
    return null;
  }

  /**
   * Gives the lock back. If the unlock fails, the session may still hold it,
   * and returning that session to the pool would block every later run on this
   * tenant: the connection is destroyed instead, which ends the session and
   * the lock with it.
   */
  private async releaseRunLock(
    runner: ReturnType<DataSource['createQueryRunner']>,
    tenantId: string,
  ): Promise<void> {
    try {
      await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [`${RUNNING_LOCK_PREFIX}:${tenantId}`]);
      await runner.release();
      return;
    } catch (error) {
      this.logger.error(
        `Netbox run lock for tenant ${tenantId} could not be released; dropping the connection. ${plainErrorMessage(error)}`,
      );
    }
    try {
      const raw = (runner as unknown as { databaseConnection?: { release?: (err?: unknown) => void; end?: () => void } })
        .databaseConnection;
      // node-postgres removes a pooled client from the pool when it is handed
      // back with an error instead of being returned clean.
      if (typeof raw?.release === 'function') raw.release(new Error('netbox: advisory lock not released'));
      else if (typeof raw?.end === 'function') raw.end();
    } catch {
      // Nothing left to try; the pool will reap the connection on its own.
    }
  }

  /**
   * One run, start to finish, outside any request, holding the lock the caller
   * already took.
   */
  async runInBackground(
    tenantId: string,
    trigger: 'manual' | 'scheduled',
  ): Promise<{ status: 'skipped' | 'success' | 'failure'; counts?: NetboxSyncCounts; error?: string }> {
    const runner = await this.acquireRunLock(tenantId);
    if (!runner) {
      return { status: 'skipped' };
    }
    const startedAt = new Date();
    await this.persistState(tenantId, this.runningState(trigger, startedAt));
    return this.runLocked(tenantId, trigger, runner, startedAt);
  }

  private async runLocked(
    tenantId: string,
    trigger: 'manual' | 'scheduled',
    runner: ReturnType<DataSource['createQueryRunner']>,
    startedAt: Date,
    decisions: NetboxDecision[] = [],
    /** Objects a person was shown; null for the scheduled run, which has no reviewer. */
    reviewed: Set<string> | null = null,
  ): Promise<{ status: 'skipped' | 'success' | 'failure'; counts?: NetboxSyncCounts; error?: string }> {
    try {
      const result = await this.executeRun(tenantId, decisions, reviewed);
      const finishedAt = new Date();
      await this.persistState(tenantId, {
        status: 'success',
        trigger,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        counts: result.counts,
        error: null,
        warnings: result.warnings,
      });
      return { status: 'success', counts: result.counts };
    } catch (error) {
      const finishedAt = new Date();
      const message = plainErrorMessage(error);
      await this.persistState(tenantId, {
        status: 'failure',
        trigger,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        counts: null,
        error: message,
        warnings: [],
      });
      this.logger.warn(`Netbox synchronisation failed for tenant ${tenantId}: ${message}`, (error as Error)?.stack);
      return { status: 'failure', error: message };
    } finally {
      await this.releaseRunLock(runner, tenantId);
    }
  }

  private async persistState(tenantId: string, state: NetboxSyncStateView): Promise<void> {
    await withTenantExecution(this.dataSource, tenantId, (manager) =>
      this.config.writeSyncState(manager, tenantId, state));
  }

  private async executeRun(
    tenantId: string,
    decisions: NetboxDecision[] = [],
    reviewed: Set<string> | null = null,
  ): Promise<{ counts: NetboxSyncCounts; warnings: NetboxNotice[] }> {
    // Read phase outside any transaction, then the HTTP calls with no database
    // connection held, then one short transaction per object.
    const local = await withTenantExecution(
      this.dataSource,
      tenantId,
      (manager) => this.loadLocalContext(manager, tenantId),
      { transaction: false },
    );
    const fetched = await this.fetchObjects(local);
    // The inventory a preview kept is older than what this run is about to write.
    this.previewInventory.delete(tenantId);
    const { plan } = this.buildPlan(local, fetched, decisions);
    const counts: NetboxSyncCounts = { ...plan.counts, create: 0, update: 0, unchanged: 0, error: 0, deferred: 0 };
    const warnings: NetboxNotice[] = fetched.complete ? [] : [netboxNotice('fetch_incomplete')];
    if (!fetched.complete) {
      this.logger.warn(`Netbox returned more pages than KANAP reads for tenant ${tenantId}; the inventory is partial.`);
    }
    if (plan.subLocationsAvailable === false) {
      warnings.push(netboxNotice('locations_unavailable'));
    }
    // A match that points at an asset unable to take the machines is a setup
    // to fix, and the hourly run has no preview to say it in. A cluster nobody
    // matched is only listed in the preview: leaving clusters out is allowed.
    warnings.push(...plan.clusterNotices.filter((notice) => notice.code === 'cluster_match_invalid'));

    // Records whose object Netbox no longer lists are flagged first, so that a
    // device deleted and recreated under a new id finds its asset free and the
    // stale record is cleared away when the new one takes over, below.
    for (const link of plan.missing) {
      await this.markMissing(tenantId, link).catch((error) => this.logRecordFailure(link, error));
    }

    // Upkeep of the sub-locations already linked, before any equipment row is
    // written. These are changes to a SHARED row: a rename or a description
    // produces no diff on the equipment rows, so without this step it would
    // never be written at all. Each change gets its own short transaction, and
    // a failure is reported without stopping the run.
    warnings.push(...subLocationUpkeepNotices(plan.subLocations));
    for (const change of plan.subLocations) {
      if (change.action !== 'rename' && change.action !== 'update' && change.action !== 'adopt') continue;
      try {
        await this.reconcileSubLocation(tenantId, change);
      } catch (error) {
        this.logger.warn(
          `Netbox location ${change.external_id} could not be kept in step: ${plainErrorMessage(error)}`,
        );
        // Only a refused name is a name conflict; anything else is reported
        // for what it is.
        warnings.push(isSubLocationNameRejection(error)
          ? netboxNotice('sub_location_name_taken', { value: change.name })
          : objectFailureNotice(error));
      }
    }

    let consecutiveFailures = 0;
    for (const row of plan.rows) {
      const key = externalKey(row.external_type, row.external_id);
      if (row.skip_reason) {
        // Out of scope. An object a person chose to ignore still gets its
        // "last seen" stamp so it does not drift into the missing list.
        if (row.decision === 'ignore') {
          await this.ignoreByDecision(tenantId, row).catch((error) => this.logRecordFailure(row, error));
        } else if (row.skip_reason === 'ignored') {
          await this.touchIgnored(tenantId, row).catch((error) => this.logRecordFailure(row, error));
        }
        continue;
      }
      if (row.action === 'ambiguous') {
        await this.upsertLink(tenantId, row, {
          assetId: null,
          state: 'ambiguous',
          candidateAssetIds: row.candidates.map((candidate) => candidate.id),
          // The planner already worked out which ambiguity this is.
          notice: primaryNotice(row.warnings) ?? netboxNotice('ambiguous_candidates'),
          synced: false,
        }).catch((error) => this.logRecordFailure(row, error));
        continue;
      }
      const write = plan.writes.get(key);
      if (!write) continue;
      // A manual run writes only what its preview listed. Anything else is left
      // exactly as it is and comes back in the next preview: a creation nobody
      // read is how a duplicate gets in, and KANAP never deletes one.
      if (isWriteDeferred(row, reviewed)) {
        counts.deferred = (counts.deferred ?? 0) + 1;
        continue;
      }

      const outcome = await this.applyRow(tenantId, row, write, local.defaultEnvironment);
      if (outcome.action === 'error') {
        counts.error += 1;
        consecutiveFailures += 1;
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
          // Something systematic is wrong. Stop rather than fill the table
          // with error rows and then report a successful run.
          throw new Error(
            `${CONSECUTIVE_FAILURE_LIMIT} objects in a row could not be saved, so the synchronisation was stopped. `
            + 'The technical details are in the server log.',
          );
        }
      } else {
        consecutiveFailures = 0;
        counts[outcome.action] += 1;
      }
    }

    return { counts, warnings };
  }

  /** Never lose the real reason a record could not be written. */
  private logRecordFailure(
    row: Pick<NetboxPlanRow, 'external_type' | 'external_id'> | ExistingLink,
    error: unknown,
  ): void {
    this.logger.warn(
      `Netbox ${row.external_type} ${row.external_id}: ${plainErrorMessage(error)}`,
      (error as Error)?.stack,
    );
  }

  /**
   * One Netbox object, one transaction. A failure here is recorded on that
   * object's row and the run carries on with the next one.
   */
  private async applyRow(
    tenantId: string,
    row: NetboxPlanRow,
    write: NetboxPlanWrite,
    defaultEnvironment: string,
  ): Promise<ApplyOutcome> {
    try {
      return await withTenantExecution(this.dataSource, tenantId, async (manager) => {
        const opts = { manager, tenantId, source: 'system', sourceRef: NETBOX_LINK_SOURCE, osSource: 'netbox' as const };
        const warnings = [...row.warnings];
        let assetId = write.assetId;
        let action: 'create' | 'update' | 'unchanged' = row.action === 'create' ? 'create' : 'unchanged';

        // A brand-new asset always needs its sub-location; an existing one only
        // when the plan found the sub-location moving. The database is read
        // again inside this transaction rather than remembered from the plan:
        // an earlier row that created the sub-location and then rolled back
        // would leave a phantom id behind, and every later row would fail on it.
        const subLocationId = write.subLocation
          && (!assetId || row.diffs.some((diff) => diff.field === 'sub_location'))
          ? await this.ensureSubLocation(manager, tenantId, write.asset.location_id, write.subLocation, warnings)
          : null;

        if (!assetId) {
          const body = this.createBody(write.asset, defaultEnvironment);
          if (subLocationId) body.sub_location_id = subLocationId;
          let created;
          try {
            created = await this.assets.create(body, tenantId, null, opts);
          } catch (error) {
            if (!isDuplicateIpRejection(error)) throw error;
            warnings.push(netboxNotice('ip_conflict_skipped', { value: write.asset.ip_addresses?.[0]?.ip ?? '' }));
            created = await this.assets.create({ ...body, ip_addresses: null }, tenantId, null, opts);
          }
          assetId = created.id;
          action = 'create';
        } else if (row.action === 'update') {
          const patch = this.updateBody(write.asset, row);
          if (subLocationId) patch.sub_location_id = subLocationId;
          await this.skipOperatingSystemOfCluster(manager, tenantId, assetId, patch, warnings);
          if (Object.keys(patch).length > 0) {
            try {
              await this.assets.update(assetId, patch, tenantId, null, opts);
            } catch (error) {
              if (!isDuplicateIpRejection(error)) throw error;
              warnings.push(netboxNotice('ip_conflict_skipped', { value: write.asset.ip_addresses?.[0]?.ip ?? '' }));
              const { ip_addresses, ...rest } = patch as Record<string, unknown>;
              if (Object.keys(rest).length > 0) {
                await this.assets.update(assetId, rest, tenantId, null, opts);
              }
            }
            action = 'update';
          }
        }

        const hardware = this.hardwareBody(write.hardware, row, action === 'create');
        if (Object.keys(hardware).length > 0) {
          await this.assets.upsertHardwareInfo(assetId, hardware, tenantId, null, opts);
          if (action === 'unchanged') action = 'update';
        }

        if (write.cluster) {
          const added = await this.attachToCluster(manager, tenantId, assetId, write.cluster, warnings, opts);
          if (added && action === 'unchanged') action = 'update';
        }

        // The "Netbox" link on the asset is written once, when the asset and
        // the Netbox object are first tied together.
        const existing = await manager.query(
          `SELECT id, asset_id FROM asset_external_links
           WHERE tenant_id = $1 AND source = $2 AND external_type = $3 AND external_id = $4`,
          [tenantId, NETBOX_LINK_SOURCE, row.external_type, row.external_id],
        );
        if (existing.length === 0 || existing[0].asset_id !== assetId) {
          await this.assets.createLink(assetId, { description: 'Netbox', url: row.external_url }, null, opts);
        }

        // The stale record goes BEFORE the new one is marked linked, so the
        // one-live-record-per-asset index is never momentarily violated.
        await this.dropStaleRecords(manager, tenantId, assetId, row);
        await this.upsertLink(tenantId, row, {
          assetId,
          state: 'linked',
          candidateAssetIds: [],
          // One record holds one notice; the preview carries the full list.
          notice: primaryNotice(warnings),
          synced: true,
          // Refreshed even when nothing was written to the asset: a platform
          // added in Netbox has to lock the field at the run that sees it.
          managedFields: managedFieldsOf(write),
        }, manager);

        return { action, assetId } as ApplyOutcome;
      });
    } catch (error) {
      this.logRecordFailure(row, error);
      const notice = objectFailureNotice(error);
      await this.upsertLink(tenantId, row, {
        assetId: null,
        state: 'error',
        candidateAssetIds: [],
        notice,
        synced: false,
      }).catch((linkError) => this.logRecordFailure(row, linkError));
      return { action: 'error', notice };
    }
  }

  /**
   * Adds the `contains` relation from the matched KANAP cluster to this
   * virtual machine, inside the row's transaction, and nothing else: the
   * cluster's other relations are left as they are. A member host that carries
   * the machine today loses its link to it (R1, `addRelationWithPlacement`),
   * so `changed` is true for the added relation or for a replaced host link.
   *
   * The cluster row is read again and locked here, so an asset deleted, retired
   * or turned into something else since the plan writes nothing and says so,
   * and a person replacing the cluster's relations at the same moment waits for
   * this row.
   *
   * Lock order, no deadlock: the row has already locked the virtual machine
   * (its update), then locks the cluster (`FOR NO KEY UPDATE`, the lock
   * `bulkReplaceRelations` takes on its asset). `addRelationWithPlacement` then
   * takes the same cluster lock, the cluster's own lock, and the hosts' locks,
   * in the order every relation writer uses.
   */
  private async attachToCluster(
    manager: EntityManager,
    tenantId: string,
    assetId: string,
    cluster: NetboxClusterTarget,
    warnings: NetboxNotice[],
    opts: { manager: EntityManager; tenantId: string; source: string; sourceRef: string },
  ): Promise<boolean> {
    const rows: Array<{ is_cluster: boolean; status: string | null }> = await manager.query(
      `SELECT is_cluster, status FROM assets WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
      [tenantId, cluster.assetId],
    );
    const target = rows[0];
    if (!target || target.is_cluster !== true || String(target.status ?? '').toLowerCase() === 'retired') {
      warnings.push(netboxNotice('cluster_match_invalid', { value: cluster.netboxName }));
      return false;
    }
    return this.assets.addRelationWithPlacement(cluster.assetId, assetId, 'contains', tenantId, null, opts)
      .then((result) => result.changed);
  }

  /**
   * Finds, adopts or creates the KANAP sub-location a Netbox Location stands
   * for, and returns its id. Runs inside the equipment row's own transaction,
   * so a failure takes the sub-location back with it and the next row starts
   * from a clean slate.
   *
   * The row is re-read rather than remembered from the plan: the plan was built
   * before any of this run's writes, and a sub-location created by an earlier
   * row (or by hand a moment ago) has to be found, not duplicated. It costs one
   * query, and only on a row whose sub-location actually moves — an idempotent
   * run does none at all.
   *
   * The decision itself is `resolveSubLocation`, the same pure function the
   * preview used, so the two cannot drift apart.
   */
  private async ensureSubLocation(
    manager: EntityManager,
    tenantId: string,
    locationId: string,
    target: NetboxSubLocationTarget,
    warnings: NetboxNotice[],
  ): Promise<string | null> {
    const rows: ExistingSubLocation[] = await manager.query(
      `SELECT id, location_id, name, description, external_source, external_id, external_url
       FROM location_sub_items
       WHERE tenant_id = $1 AND location_id = $2`,
      [tenantId, locationId],
    );
    const resolution = resolveSubLocation(rows, locationId, target);
    const external: SubItemExternal = {
      source: NETBOX_LINK_SOURCE,
      id: target.externalId,
      url: target.url,
    };
    const opts = {
      manager,
      external,
      audit: { source: 'system', sourceRef: NETBOX_LINK_SOURCE },
    };

    // The deep link is refreshed by the upkeep step of a run, not here: a
    // failure swallowed inside this transaction would leave it aborted.
    if (resolution.kind === 'existing') return resolution.subItem.id;

    if (resolution.kind === 'adopt') {
      // A list built by hand is taken over rather than duplicated, so the
      // assets already filed there do not move.
      const saved = await this.locations.updateSubItem(
        locationId,
        resolution.subItem.id,
        { name: target.name, ...(target.description ? { description: target.description } : {}) },
        tenantId,
        null,
        opts,
      );
      return saved.id;
    }

    if (resolution.kind === 'conflict') {
      warnings.push(netboxNotice('sub_location_name_taken', { value: target.name }));
      return null;
    }

    const created = await this.locations.createSubItem(
      locationId,
      { name: target.name, description: target.description },
      tenantId,
      null,
      opts,
    );
    return created.id;
  }

  /**
   * Keeps one already-linked sub-location in step with Netbox: a rename, a
   * description, the deep link, or the identity an adoption gives it. Its own
   * short transaction: a change that cannot be applied is reported and the run
   * carries on, because the equipment that carries the sub-location has
   * nothing to do with it.
   */
  private async reconcileSubLocation(tenantId: string, change: NetboxSubLocationChange): Promise<void> {
    if (!change.sub_item_id) return;
    await withTenantExecution(this.dataSource, tenantId, async (manager) => {
      const body: Record<string, unknown> = {};
      // An adoption takes the Netbox spelling over; where it is already the
      // same, this writes the value it already holds, which costs nothing.
      if (change.action === 'rename' || change.action === 'adopt') body.name = change.name;
      if (change.description) body.description = change.description;
      await this.locations.updateSubItem(
        change.location_id,
        change.sub_item_id as string,
        body,
        tenantId,
        null,
        {
          manager,
          external: {
            source: NETBOX_LINK_SOURCE,
            id: change.external_id,
            url: change.external_url,
          },
          audit: { source: 'system', sourceRef: NETBOX_LINK_SOURCE },
        },
      );
    });
  }

  /**
   * A device deleted and recreated in Netbox comes back under a new id, so the
   * asset would end up with the new record plus the old one. The old one has
   * nothing left to say: it is removed in the same transaction, BEFORE the new
   * record is marked linked, so the database's one-live-record-per-asset rule
   * is never broken even for an instant.
   *
   * Only a record flagged 'missing' is removed this way. A record still marked
   * 'linked' for the same asset would mean two live Netbox objects claim it,
   * which the planner refuses to produce.
   */
  private async dropStaleRecords(
    manager: EntityManager,
    tenantId: string,
    assetId: string,
    row: Pick<NetboxPlanRow, 'external_type' | 'external_id'>,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM asset_external_links
       WHERE tenant_id = $1 AND source = $2 AND asset_id = $3 AND state = 'missing'
         AND NOT (external_type = $4 AND external_id = $5)`,
      [tenantId, NETBOX_LINK_SOURCE, assetId, row.external_type, row.external_id],
    );
  }

  /** Body for a new asset: every value Netbox owns, plus the configured environment. */
  private createBody(mapped: MappedAssetFields, defaultEnvironment: string): Record<string, unknown> {
    const body: Record<string, unknown> = {
      name: mapped.name,
      kind: mapped.kind,
      provider: mapped.provider,
      // The environment is set once, at creation, and never rewritten: Netbox
      // does not know about it.
      environment: defaultEnvironment,
      location_id: mapped.location_id,
    };
    if (mapped.status) body.status = mapped.status;
    if (mapped.hostname) body.hostname = mapped.hostname;
    // A domain without a host name is refused by the asset service.
    if (mapped.hostname && mapped.domain) body.domain = mapped.domain;
    if (mapped.operating_system) body.operating_system = mapped.operating_system;
    if (mapped.ip_addresses) body.ip_addresses = mapped.ip_addresses;
    return body;
  }

  /**
   * A cluster that has members carries no operating system (`asset-rules.ts`): the platform of
   * its Netbox object is left out with a notice, and the rest of the row is written. Without
   * this, the asset service would refuse the whole row at every run.
   */
  private async skipOperatingSystemOfCluster(
    manager: EntityManager,
    tenantId: string,
    assetId: string,
    patch: Record<string, unknown>,
    warnings: NetboxNotice[],
  ): Promise<void> {
    if (!patch.operating_system) return;
    const [row]: Array<{ id: string }> = await manager.query(
      `SELECT a.id FROM assets a
        WHERE a.tenant_id = $1 AND a.id = $2 AND a.is_cluster
          AND EXISTS (SELECT 1 FROM asset_cluster_members m WHERE m.tenant_id = a.tenant_id AND m.cluster_id = a.id)`,
      [tenantId, assetId],
    );
    if (!row) return;
    warnings.push(netboxNotice('os_cluster_with_members', { value: String(patch.operating_system) }));
    delete patch.operating_system;
  }

  /** Patch for an existing asset: only the fields the plan reported as different. */
  private updateBody(mapped: MappedAssetFields, row: NetboxPlanRow): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const diff of row.diffs) {
      const field = ASSET_FIELD_BY_DIFF_KEY[diff.field];
      if (!field) continue;
      const value = mapped[field];
      if (value == null) continue;
      patch[field] = value;
    }
    // Changing the domain without sending a host name can leave the asset
    // without one, which the asset service refuses.
    if (patch.domain && !patch.hostname && mapped.hostname) {
      patch.hostname = mapped.hostname;
    }
    return patch;
  }

  private hardwareBody(
    hardware: MappedHardwareFields,
    row: NetboxPlanRow,
    isCreate: boolean,
  ): Record<string, unknown> {
    const changed = new Set(row.diffs.map((diff) => diff.field));
    const body: Record<string, unknown> = {};
    for (const field of HARDWARE_FIELDS) {
      const value = hardware[field];
      if (!value) continue;
      if (isCreate || changed.has(field)) body[field] = value;
    }
    return body;
  }

  // ==========================================================================
  // Link rows
  // ==========================================================================

  private async upsertLink(
    tenantId: string,
    row: Pick<NetboxPlanRow, 'external_type' | 'external_id' | 'external_name' | 'external_url' | 'external_status'>,
    values: {
      assetId: string | null;
      state: AssetExternalLinkState;
      candidateAssetIds: string[];
      notice: NetboxNotice | null;
      synced: boolean;
      /**
       * The fields Netbox provides for this object, refreshed at every run,
       * including on a row nothing was written to: the asset workspace locks
       * exactly these. Only a linked record has any.
       */
      managedFields?: string[] | null;
    },
    manager?: EntityManager,
  ): Promise<void> {
    const run = async (mg: EntityManager) => {
      await mg.query(
        `INSERT INTO asset_external_links
           (tenant_id, source, external_type, external_id, external_name, external_url,
            asset_id, state, candidate_asset_ids, message_code, message_params, external_status,
            managed_fields, last_seen_at, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10, $11::jsonb, $12, $13::text[], now(), ${values.synced ? 'now()' : 'NULL'})
         ON CONFLICT (tenant_id, source, external_type, external_id) DO UPDATE SET
           external_name = EXCLUDED.external_name,
           external_url = EXCLUDED.external_url,
           external_status = EXCLUDED.external_status,
           asset_id = EXCLUDED.asset_id,
           state = EXCLUDED.state,
           candidate_asset_ids = EXCLUDED.candidate_asset_ids,
           message_code = EXCLUDED.message_code,
           message_params = EXCLUDED.message_params,
           managed_fields = EXCLUDED.managed_fields,
           last_seen_at = now(),
           last_synced_at = ${values.synced ? 'now()' : 'asset_external_links.last_synced_at'},
           updated_at = now()`,
        [
          tenantId,
          NETBOX_LINK_SOURCE,
          row.external_type,
          row.external_id,
          row.external_name,
          row.external_url,
          values.assetId,
          values.state,
          values.candidateAssetIds,
          values.notice?.code ?? null,
          values.notice ? JSON.stringify(values.notice.params) : null,
          row.external_status,
          values.managedFields ?? null,
        ],
      );
    };
    if (manager) {
      await run(manager);
      return;
    }
    await withTenantExecution(this.dataSource, tenantId, run);
  }

  /**
   * "Ignore", chosen in the preview. The object may have no record yet, so
   * this one inserts; an existing record keeps its asset and its candidates,
   * exactly as the same choice made from the records list does.
   */
  private async ignoreByDecision(tenantId: string, row: NetboxPlanRow): Promise<void> {
    await withTenantExecution(this.dataSource, tenantId, (manager) => manager.query(
      `INSERT INTO asset_external_links
         (tenant_id, source, external_type, external_id, external_name, external_url,
          state, external_status, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ignored', $7, now())
       ON CONFLICT (tenant_id, source, external_type, external_id) DO UPDATE SET
         external_name = EXCLUDED.external_name,
         external_url = EXCLUDED.external_url,
         external_status = EXCLUDED.external_status,
         state = 'ignored',
         message_code = NULL,
         message_params = NULL,
         last_seen_at = now(),
         updated_at = now()`,
      [
        tenantId, NETBOX_LINK_SOURCE, row.external_type, row.external_id,
        row.external_name, row.external_url, row.external_status,
      ],
    ));
  }

  private async touchIgnored(tenantId: string, row: NetboxPlanRow): Promise<void> {
    await withTenantExecution(this.dataSource, tenantId, (manager) => manager.query(
      `UPDATE asset_external_links
       SET external_name = $4, external_url = $5, external_status = $7,
           last_seen_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND source = $2 AND external_type = $3 AND external_id = $6`,
      [
        tenantId, NETBOX_LINK_SOURCE, row.external_type,
        row.external_name, row.external_url, row.external_id, row.external_status,
      ],
    ));
  }

  /**
   * Flags a record whose object Netbox no longer lists. A record that has no
   * asset either — its asset was deleted in KANAP and the object is gone from
   * Netbox — has nothing left to decide about, so it is removed instead of
   * being left behind as an orphan nobody can act on.
   */
  private async markMissing(tenantId: string, link: ExistingLink): Promise<void> {
    await withTenantExecution(this.dataSource, tenantId, async (manager) => {
      if (!link.asset_id) {
        await manager.query(
          `DELETE FROM asset_external_links
           WHERE tenant_id = $1 AND source = $2 AND id = $3 AND asset_id IS NULL`,
          [tenantId, NETBOX_LINK_SOURCE, link.id],
        );
        return;
      }
      await manager.query(
        `UPDATE asset_external_links
         SET state = 'missing', message_code = $4, message_params = NULL, updated_at = now()
         WHERE tenant_id = $1 AND source = $2 AND id = $3 AND state = 'linked'`,
        [tenantId, NETBOX_LINK_SOURCE, link.id, 'missing_from_netbox'],
      );
    });
  }

  // ==========================================================================
  // Row actions
  // ==========================================================================

  async resolveRecord(
    manager: EntityManager,
    tenantId: string,
    id: string,
    input: NetboxResolveInput,
  ): Promise<NetboxRecordRow> {
    const record = await this.findRecord(manager, tenantId, id);
    const action = String(input.action || '').trim();

    if (action === 'ignore') {
      await manager.query(
        `UPDATE asset_external_links
         SET state = 'ignored', message_code = NULL, message_params = NULL, updated_at = now()
         WHERE tenant_id = $1 AND source = $2 AND id = $3`,
        [tenantId, NETBOX_LINK_SOURCE, id],
      );
      return this.findRecord(manager, tenantId, id);
    }
    if (action !== 'link' && action !== 'create') {
      throw new BadRequestException('Choose whether to link this object to an asset, create a new asset, or ignore it.');
    }

    let assetId: string | null = null;
    if (action === 'link') {
      assetId = String(input.asset_id || '').trim() || null;
      if (!assetId) {
        throw new BadRequestException('Choose the asset this object belongs to.');
      }
      const found = await manager.query(
        `SELECT id FROM assets WHERE tenant_id = $1 AND id = $2`,
        [tenantId, assetId],
      );
      if (found.length === 0) {
        throw new NotFoundException('That asset does not exist any more.');
      }
      // One asset, one Netbox object. A record whose object disappeared from
      // Netbox does not hold the asset: the new object may take it over.
      const claimed = await manager.query(
        `SELECT external_name FROM asset_external_links
         WHERE tenant_id = $1 AND source = $2 AND asset_id = $3 AND state = 'linked' AND id <> $4
         LIMIT 1`,
        [tenantId, NETBOX_LINK_SOURCE, assetId, id],
      );
      if (claimed.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'NETBOX_ASSET_ALREADY_LINKED',
          message: claimed[0].external_name
            ? `This asset is already linked to the Netbox object "${claimed[0].external_name}". Pick another asset, or create a new one.`
            : 'This asset is already linked to another Netbox object. Pick another asset, or create a new one.',
        });
      }
    }

    // Applying the Netbox values right away means reading the object again —
    // that one object, not the whole inventory.
    const local = await this.loadLocalContext(manager, tenantId);
    const connection = this.config.buildConnection(local.config);
    let object: NetboxObject;
    let locationIndex: NetboxLocationIndex | null = null;
    try {
      object = record.external_type === 'device'
        ? await this.client.getDevice(connection, record.external_id)
        : await this.client.getVirtualMachine(connection, record.external_id);
    } catch (error) {
      const failure = netboxFailureOf(error);
      if (failure.detail) {
        this.logger.warn(`Netbox object ${record.external_id} could not be read: ${failure.detail}`);
      }
      throw netboxBadRequest(failure.code);
    }
    // Same isolated read as a full run: resolving one object must place it in
    // the same sub-location the next run would. Unavailable locations are not
    // worth failing the action over — the object is still linked or created,
    // and the following run fills the sub-location in.
    // A virtual machine, or a device outside any Location, has nothing to walk.
    if (object.locationId) {
      try {
        const page = await this.client.listLocations(connection);
        locationIndex = page.complete ? indexNetboxLocations(page.locations) : null;
      } catch (error) {
        this.logger.warn(`Netbox locations could not be read while resolving one object: ${plainErrorMessage(error)}`);
      }
    }
    // The role and site matches still decide what the object may become.
    const mapping = mapNetboxObject(object, {
      roleMap: local.roleMap,
      siteMap: local.siteMap,
      osMap: local.osMap,
      defaultEnvironment: local.defaultEnvironment,
      catalogs: local.catalogs,
      locations: locationIndex,
    });
    if (!mapping.asset || !mapping.hardware) {
      throw new BadRequestException(
        'This object is out of scope for the current matches. Match its role and its site first.',
      );
    }

    const existingAsset = assetId ? local.assets.find((asset) => asset.id === assetId) : undefined;
    const resolution = mapping.subLocation
      ? resolveSubLocation(local.subLocations, mapping.asset.location_id, mapping.subLocation)
      : null;
    // Linked or created by hand, a virtual machine joins its cluster as a run would put it there.
    const attachment = planClusterAttachment(object, existingAsset ? existingAsset.id : null, local.clusters);
    const row: NetboxPlanRow = {
      external_type: record.external_type,
      external_id: record.external_id,
      external_name: object.name,
      external_url: object.url,
      external_status: object.status,
      action: assetId ? 'update' : 'create',
      asset: null,
      matched_by: null,
      candidates: [],
      diffs: existingAsset
        ? diffNetboxMapping(mapping, existingAsset, local.catalogs, {
          resolution,
          currentName: existingAsset.sub_location_id
            ? local.subLocations.find((item) => item.id === existingAsset.sub_location_id)?.name ?? null
            : null,
          locationChanged: existingAsset.location_id !== mapping.asset.location_id,
        })
        : [],
      skip_reason: null,
      decision: null,
      warnings: [...mapping.warnings, ...attachment.warnings],
    };
    if (attachment.diff) row.diffs.push(attachment.diff);
    const outcome = await this.applyRow(
      tenantId,
      row,
      {
        asset: mapping.asset,
        hardware: mapping.hardware,
        assetId,
        subLocation: mapping.subLocation,
        cluster: attachment.target,
      },
      local.defaultEnvironment,
    );
    if (outcome.action === 'error') {
      throw new BadRequestException(outcome.notice.text);
    }
    return this.findRecord(manager, tenantId, id);
  }

  /**
   * Puts an ignored object back in the list. With an asset or with candidates
   * there is something to show; with neither, the record holds no information
   * at all, so it is removed and the object is judged afresh at the next run
   * rather than sitting in the "to decide" list with nothing to decide.
   */
  async unignoreRecord(manager: EntityManager, tenantId: string, id: string): Promise<NetboxRecordRow> {
    const record = await this.findRecord(manager, tenantId, id);
    if (record.state !== 'ignored') {
      return record;
    }
    if (record.asset) {
      // Another object may have taken the asset over while this one sat
      // ignored; the database would refuse a second live record for it.
      const claimed = await manager.query(
        `SELECT id FROM asset_external_links
         WHERE tenant_id = $1 AND source = $2 AND asset_id = $3 AND state = 'linked' AND id <> $4
         LIMIT 1`,
        [tenantId, NETBOX_LINK_SOURCE, record.asset.id, id],
      );
      if (claimed.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'NETBOX_ASSET_ALREADY_LINKED',
          message: 'The asset this object was linked to now belongs to another Netbox object. '
            + 'Remove this record, or link it to a different asset.',
        });
      }
    }
    if (!record.asset && record.candidates.length === 0) {
      await manager.query(
        `DELETE FROM asset_external_links WHERE tenant_id = $1 AND source = $2 AND id = $3`,
        [tenantId, NETBOX_LINK_SOURCE, id],
      );
      return { ...record, message: netboxNotice('reevaluate_next_sync') };
    }
    await manager.query(
      `UPDATE asset_external_links
       SET state = CASE WHEN asset_id IS NULL THEN 'ambiguous' ELSE 'linked' END,
           message_code = CASE WHEN asset_id IS NULL THEN 'ambiguous_candidates' ELSE NULL END,
           message_params = NULL,
           updated_at = now()
       WHERE tenant_id = $1 AND source = $2 AND id = $3`,
      [tenantId, NETBOX_LINK_SOURCE, id],
    );
    return this.findRecord(manager, tenantId, id);
  }

  /** Retires the asset behind an object Netbox no longer lists. */
  async retireAsset(manager: EntityManager, tenantId: string, id: string, userId: string | null): Promise<NetboxRecordRow> {
    const record = await this.findRecord(manager, tenantId, id);
    if (record.state !== 'missing' || !record.asset) {
      throw new BadRequestException('Only an asset whose Netbox object has disappeared can be retired from here.');
    }
    // A person asked for this, so the audit entry keeps their name; the source
    // reference still says the decision came from the Netbox page.
    await this.assets.update(record.asset.id, { status: 'retired' }, tenantId, userId, {
      manager,
      tenantId,
      sourceRef: NETBOX_LINK_SOURCE,
    });
    return this.findRecord(manager, tenantId, id);
  }
}
