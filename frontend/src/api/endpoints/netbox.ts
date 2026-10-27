import { api } from '../client';

/**
 * Netbox inventory integration.
 *
 * Mirrors `planning/netbox-integration-contract.md`. Every route lives under
 * `/netbox` and requires `infrastructure:admin`, except `GET /netbox/status`
 * which only needs `infrastructure:reader`.
 */

export type NetboxRecordState = 'linked' | 'ambiguous' | 'missing' | 'ignored' | 'error';
export type NetboxObjectType = 'device' | 'vm';
export type NetboxEnvironment = 'prod' | 'pre_prod' | 'qa' | 'test' | 'dev' | 'sandbox';

/**
 * Record messages and preview warnings are structured so the UI can translate them.
 * `text` is the English fallback for a code this build does not know yet.
 */
export type NetboxNoticeCode =
  | 'ambiguous_candidates'
  | 'contested_asset'
  | 'missing_from_netbox'
  | 'reevaluate_next_sync'
  | 'os_not_in_catalog'
  | 'os_ambiguous'
  | 'os_cluster_with_members'
  | 'domain_not_in_catalog'
  | 'hostname_invalid'
  | 'status_not_mapped'
  | 'lifecycle_not_in_catalog'
  | 'ipv6_skipped'
  | 'ip_conflict_skipped'
  | 'ip_match_candidates'
  | 'similar_name_candidates'
  | 'subnet_not_in_catalog'
  | 'no_ip_address_type'
  | 'sub_location_name_taken'
  | 'locations_unavailable'
  | 'cluster_not_mapped'
  | 'cluster_match_invalid'
  | 'cluster_other_present'
  | 'fetch_incomplete'
  | 'save_failed'
  | 'validation_failed'
  | 'netbox_status_attention';

/** Raw Netbox status values. Kept as a plain string on the wire: an unknown value must not break anything. */
export type NetboxExternalStatus =
  | 'active' | 'offline' | 'planned' | 'staged'
  | 'failed' | 'inventory' | 'decommissioning' | 'paused';

/**
 * Netbox statuses worth telling the user about. The KANAP lifecycle stays Active;
 * only the Netbox-side state is surfaced.
 */
export const NETBOX_ATTENTION_STATUSES: readonly string[] = ['offline', 'failed', 'paused'];

export function isNetboxAttentionStatus(value: string | null | undefined): boolean {
  return !!value && NETBOX_ATTENTION_STATUSES.includes(value);
}

export interface NetboxNotice {
  code: NetboxNoticeCode;
  params: Record<string, string>;
  /** English fallback, rendered as is when the code is unknown to this build. */
  text: string;
}

export interface NetboxIntegrationView {
  configured: boolean;
  enabled: boolean;
  base_url: string | null;
  credential: { present: boolean };
  /** null = the built-in default (30s). Allowed range 5..120. */
  request_timeout_seconds: number | null;
  insecure_tls: boolean;
  auto_sync: boolean;
  /** A synchronisation was applied by hand at least once; the hourly run waits for it. */
  manual_sync_done?: boolean;
  default_environment: NetboxEnvironment;
  secret_writable: boolean;
  updated_at: string | null;
  /** Absent on a payload from an older server. */
  last_test?: { ok: boolean; tested_at: string } | null;
}

/** Partial: omitted keys keep their stored value. */
export interface NetboxIntegrationSaveInput {
  enabled?: boolean;
  base_url?: string;
  /** Write-only. Omitted or empty keeps the stored token. */
  api_token?: string;
  request_timeout_seconds?: number | null;
  insecure_tls?: boolean;
  auto_sync?: boolean;
  default_environment?: string;
}

/** Blank fields fall back to the stored values. */
export interface NetboxTestInput {
  base_url?: string;
  api_token?: string;
  insecure_tls?: boolean;
  request_timeout_seconds?: number | null;
}

export interface NetboxTestResult {
  ok: boolean;
  message: string;
  /** Stable code the screen translates (`errors:<code>`). Absent on a success. */
  code?: string;
  netbox_version?: string;
  /** When the test ran, and whether it was written on the saved configuration. */
  tested_at?: string;
  persisted?: boolean;
}

export interface NetboxMappingEntry {
  slug: string;
  name: string;
  device_count: number;
  vm_count: number;
}

/** One Netbox cluster. Keyed by its Netbox id: a cluster has no slug to match on. */
export interface NetboxClusterEntry {
  id: string;
  name: string;
  vm_count: number;
}

export interface NetboxMappingOptions {
  roles: NetboxMappingEntry[];
  sites: NetboxMappingEntry[];
  /** Netbox platforms. Absent on a server that does not match them yet. */
  platforms?: NetboxMappingEntry[];
  /** The token could not read the platforms; the roles and sites are unaffected. */
  platforms_unavailable?: boolean;
  /** Netbox clusters. Absent on a server that does not match them yet. */
  clusters?: NetboxClusterEntry[];
  /** The token could not read the clusters; the rest of the tab is unaffected. */
  clusters_unavailable?: boolean;
  /** The tenant's cluster assets in service, by name: what a Netbox cluster can match. */
  kanap_clusters?: Array<{ id: string; name: string }>;
  asset_kinds: Array<{ code: string; label: string }>;
  locations: Array<{ id: string; name: string }>;
  /**
   * Technologies a platform can match. `code` and `label` are the same readable text
   * (the technology name, or the name and its version), which is what `os_map` stores.
   */
  operating_systems?: Array<{ code: string; label: string }>;
  /** Saved maps: role slug -> asset kind code, site slug -> location id. */
  role_map: Record<string, string>;
  site_map: Record<string, string>;
  /** Platform slug -> technology label. Never an import filter. */
  os_map?: Record<string, string>;
  /** Netbox cluster id -> KANAP cluster asset id. Never an import filter. */
  cluster_map?: Record<string, string>;
  /** Netbox cluster id -> the Netbox name stored with the match. */
  cluster_names?: Record<string, string>;
  /** Label-match suggestions, for unmapped entries only. Not saved yet. */
  suggested_role_map: Record<string, string>;
  suggested_site_map: Record<string, string>;
  suggested_os_map?: Record<string, string>;
  suggested_cluster_map?: Record<string, string>;
}

/** Full replace of every map the body carries; an absent one keeps its saved value. */
export interface NetboxMappingSaveInput {
  role_map: Record<string, string>;
  site_map: Record<string, string>;
  os_map?: Record<string, string>;
  cluster_map?: Record<string, string>;
  /** Netbox cluster id -> its Netbox name, kept with the match for display. */
  cluster_names?: Record<string, string>;
}

export interface NetboxAssetRef {
  id: string;
  name: string;
  asset_reference: string | null;
}

/** `field` is a stable key translated by the frontend; before/after are display values. */
export interface NetboxFieldDiff {
  field: string;
  before: string | null;
  after: string | null;
}

/** What a person decided about one Netbox object, from inside the preview. */
export type NetboxDecisionAction = 'link' | 'create' | 'ignore';

export interface NetboxDecision {
  external_type: NetboxObjectType;
  external_id: string;
  action: NetboxDecisionAction;
  /** Required for `link`. */
  asset_id?: string;
}

/**
 * Body of both the preview and the run. Decisions are written only when the run
 * is applied; `reuse_inventory` lets a re-preview reuse the inventory read a
 * moment ago, and is never set on the first preview of a dialog.
 */
export interface NetboxSyncInput {
  decisions?: NetboxDecision[];
  reuse_inventory?: boolean;
  /**
   * Manual run only: the objects the preview listed. The run creates and
   * updates nothing else; the rest comes back in the next preview.
   */
  reviewed?: Array<{ external_type: NetboxObjectType; external_id: string }>;
}

export interface NetboxPlanRow {
  external_type: NetboxObjectType;
  external_id: string;
  external_name: string | null;
  external_url: string;
  action: 'create' | 'update' | 'unchanged' | 'ambiguous' | 'skipped';
  asset: NetboxAssetRef | null;
  matched_by: 'link' | 'serial' | 'fqdn' | 'name' | 'manual' | null;
  candidates: NetboxAssetRef[];
  diffs: NetboxFieldDiff[];
  skip_reason: 'unmapped_role' | 'unmapped_site' | 'unnamed' | 'ignored' | null;
  warnings: NetboxNotice[];
  /** Raw Netbox status; absent on payloads from an older backend. */
  external_status?: string | null;
  /** The decision that shaped this row, if any. Absent on payloads from an older backend. */
  decision?: NetboxDecisionAction | null;
}

export interface NetboxSyncCounts {
  create: number;
  update: number;
  unchanged: number;
  ambiguous: number;
  skipped: number;
  missing: number;
  error: number;
  /** Creations and updates a manual run left for a later batch. */
  deferred?: number;
}

export interface NetboxPreviewResult {
  ok: boolean;
  /** Failure code (`errors:<code>`), or `fetch_incomplete` on a partial read. */
  code?: string | null;
  message: string | null;
  counts: NetboxSyncCounts;
  /** `unchanged` rows are omitted; capped at 500. */
  rows: NetboxPlanRow[];
  rows_truncated: boolean;
  /** This preview is one batch; `remaining` objects wait after it, untouched by Apply. */
  batch?: { listed: number; remaining: number };
  /** Out-of-scope objects by reason. They are counted, never listed. */
  skipped_by_reason?: Record<string, number>;
  /** The first names for each reason. An empty string has no name. Absent on an older payload. */
  skipped_names?: Record<string, string[]>;
  missing: NetboxRecordRow[];
  /**
   * Changes to the shared sub-locations, listed once each rather than once per
   * asset: a first import creates them, and a rename in Netbox renames one row
   * that every asset carrying it follows. Absent on payloads from an older
   * backend, hence the `?`.
   */
  sub_locations?: NetboxSubLocationsView;
  /**
   * How many role and site matches are saved. Zero on either side means every
   * object is skipped: suggestions shown in the Mappings tab decide nothing
   * until they are saved. Optional for the same reason as above.
   */
  saved_matches?: { roles: number; sites: number };
  /**
   * Notices about the inventory as a whole, once each: a Netbox cluster whose
   * virtual machines cannot be attached to a KANAP cluster.
   */
  notices?: NetboxNotice[];
}

/** What a run does to the tenant's sub-locations. */
export interface NetboxSubLocationsView {
  /** False when Netbox did not return its locations: nothing is touched. */
  available: boolean;
  changes: NetboxSubLocationChange[];
}

export interface NetboxSubLocationChange {
  action: 'create' | 'adopt' | 'rename' | 'update' | 'conflict';
  /** Null for a creation, and for a conflict against a row not yet created. */
  sub_item_id: string | null;
  location_id: string;
  /** The KANAP location the sub-location belongs to. */
  location_name: string;
  external_id: string;
  external_url: string;
  name: string;
  /** Set for a rename, and for an adoption that changes the spelling. */
  previous_name: string | null;
  /** Objects of this run that end up in it. */
  asset_count: number;
}

export interface NetboxSyncState {
  status: 'never' | 'running' | 'success' | 'failure';
  trigger: 'manual' | 'scheduled' | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  counts: NetboxSyncCounts | null;
  /** English fallback. Shown as stored when `error_code` is absent. */
  error: string | null;
  /**
   * Stable code the page translates (`errors:<code>`).
   * Absent on a state written before codes existed.
   */
  error_code?: string | null;
  /** Run-level notices, such as an incomplete read of a very large Netbox. */
  warnings?: NetboxNotice[];
}

export interface NetboxStatus {
  configured: boolean;
  enabled: boolean;
  auto_sync: boolean;
  sync: NetboxSyncState;
  records: Record<NetboxRecordState, number>;
  /** Objects the last manual run left for a later batch; automatic runs hold meanwhile. */
  review_pending?: number;
}

export interface NetboxRecordRow {
  id: string;
  external_type: NetboxObjectType;
  external_id: string;
  external_name: string | null;
  external_url: string;
  state: NetboxRecordState;
  asset: (NetboxAssetRef & {
    status: string;
    /** The KANAP asset type, resolved against the tenant catalog. Absent on payloads from an older backend. */
    kind?: string | null;
    kind_label?: string | null;
  }) | null;
  candidates: NetboxAssetRef[];
  /** Raw Netbox status; absent on payloads from an older backend. */
  external_status?: string | null;
  message: NetboxNotice | null;
  last_seen_at: string | null;
  last_synced_at: string | null;
}

export type NetboxRecordResolveInput =
  | { action: 'link'; asset_id: string }
  | { action: 'create' }
  | { action: 'ignore' };

export const netboxApi = {
  getIntegration: (): Promise<NetboxIntegrationView> =>
    api.get<NetboxIntegrationView>('/netbox/integration'),

  saveIntegration: (data: NetboxIntegrationSaveInput): Promise<NetboxIntegrationView> =>
    api.put<NetboxIntegrationView, NetboxIntegrationSaveInput>('/netbox/integration', data),

  testIntegration: (data: NetboxTestInput): Promise<NetboxTestResult> =>
    api.post<NetboxTestResult, NetboxTestInput>('/netbox/integration/test', data),

  getMappingOptions: (): Promise<NetboxMappingOptions> =>
    api.get<NetboxMappingOptions>('/netbox/mapping-options'),

  saveMapping: (data: NetboxMappingSaveInput): Promise<NetboxMappingSaveInput> =>
    api.put<NetboxMappingSaveInput, NetboxMappingSaveInput>('/netbox/mapping', data),

  previewSync: (input?: NetboxSyncInput): Promise<NetboxPreviewResult> =>
    api.post<NetboxPreviewResult, NetboxSyncInput>('/netbox/sync/preview', input ?? {}),

  startSync: (input?: NetboxSyncInput): Promise<NetboxStatus> =>
    api.post<NetboxStatus, NetboxSyncInput>('/netbox/sync', input ?? {}),

  getStatus: (): Promise<NetboxStatus> => api.get<NetboxStatus>('/netbox/status'),

  /** `q` searches the Netbox name, the asset name and the asset reference. */
  listRecords: (params: { state?: NetboxRecordState; q?: string; page?: number; limit?: number }): Promise<{ items: NetboxRecordRow[]; total: number }> =>
    api.get<{ items: NetboxRecordRow[]; total: number }>('/netbox/records', { params }),

  resolveRecord: (id: string, data: NetboxRecordResolveInput): Promise<NetboxRecordRow> =>
    api.post<NetboxRecordRow, NetboxRecordResolveInput>(`/netbox/records/${id}/resolve`, data),

  unignoreRecord: (id: string): Promise<NetboxRecordRow> =>
    api.post<NetboxRecordRow>(`/netbox/records/${id}/unignore`),

  retireAsset: (id: string): Promise<NetboxRecordRow> =>
    api.post<NetboxRecordRow>(`/netbox/records/${id}/retire-asset`),
};
