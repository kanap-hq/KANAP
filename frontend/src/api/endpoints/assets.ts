import { api, PaginatedResponse, PaginationParams } from '../client';

/**
 * Asset (server) entity
 */
export interface Asset {
  id: string;
  name: string;
  asset_reference?: string | null;
  kind: string;
  provider: string;
  environment: 'prod' | 'pre_prod' | 'qa' | 'test' | 'dev' | 'sandbox';
  region?: string | null;
  zone?: string | null;
  hostname?: string | null;
  domain?: string | null;
  admin_zone?: string | null;
  fqdn?: string | null;
  aliases?: string[] | null;
  ip_addresses?: IpAddressEntry[] | null;
  cluster?: string | null;
  is_cluster: boolean;
  status: string;
  location_id?: string | null;
  sub_location_id?: string | null;
  /** Readable label of the marked technology (`Windows Server 2019`). A write resolves it; null clears the mark. */
  operating_system?: string | null;
  notes?: string | null;
  external_links?: AssetExternalLink[] | null;
  created_at: string;
  updated_at?: string;
}

/**
 * Link between an asset and the external inventory it comes from.
 * Only `linked` and `missing` rows are returned.
 */
export interface AssetExternalLink {
  source: 'netbox';
  external_type: 'device' | 'vm';
  external_url: string;
  state: 'linked' | 'ambiguous' | 'missing' | 'ignored' | 'error';
  /** Raw Netbox status; absent on payloads from an older backend. */
  external_status?: string | null;
  /**
   * The asset and hardware fields the inventory provides for this object.
   * Absent or null when the record has not been synchronised since the list
   * existed: every field the inventory can own is then treated as managed.
   */
  managed_fields?: string[] | null;
  last_synced_at: string | null;
}

/**
 * IP address entry
 */
export interface IpAddressEntry {
  type: string;
  ip: string;
  subnet_cidr: string | null;
}

/**
 * Asset summary for list views
 */
export interface AssetSummary extends Asset {
  location_name?: string | null;
  location_reference?: string | null;
  sub_location_name?: string | null;
  assignments_count?: number;
  cluster_name?: string | null;
}

/**
 * Server assignment to application instance
 */
export interface ServerAssignment {
  id: string;
  app_instance_id: string;
  role: string;
  since_date?: string | null;
  notes?: string | null;
  application: {
    id: string;
    name: string;
  };
  environment: string;
}

/**
 * Cluster member
 */
export interface ClusterMember {
  id: string;
  name: string;
  environment: string;
  status: string;
  kind: string;
  provider: string;
  location?: string | null;
  location_id?: string | null;
  /** Readable label of the member's operating system. */
  operating_system?: string | null;
}

/**
 * Cluster summary
 */
export interface ClusterSummary {
  id: string;
  name: string;
  environment: string;
  status: string;
}

/**
 * Server connection
 */
export interface ServerConnection {
  id: string;
  connection_reference: string;
  name: string;
  topology: 'server_to_server' | 'multi_server';
  lifecycle: string;
  protocol_labels?: string[];
  source_label?: string | null;
  destination_label?: string | null;
}

/**
 * Location entity
 */
export interface Location {
  id: string;
  code: string;
  name: string;
  hosting_type: string;
  operating_company_id?: string | null;
  provider?: string | null;
  country_iso?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
}

/**
 * Location summary for list views
 */
export interface LocationSummary extends Location {
  operating_company_name?: string | null;
  servers_count?: number;
}

/**
 * Payload for creating an asset
 */
export interface CreateAssetInput {
  name: string;
  kind: string;
  provider: string;
  environment?: 'prod' | 'pre_prod' | 'qa' | 'test' | 'dev' | 'sandbox';
  hostname?: string | null;
  domain?: string | null;
  admin_zone?: string | null;
  aliases?: string[] | null;
  ip_addresses?: IpAddressEntry[] | null;
  is_cluster?: boolean;
  /** Readable label. The server resolves it to the marked technology link; null clears the mark. */
  operating_system?: string | null;
  status?: string;
  location_id?: string | null;
  sub_location_id?: string | null;
  notes?: string | null;
}

/**
 * Payload for updating an asset
 */
export type UpdateAssetInput = Partial<CreateAssetInput>;

/**
 * Payload for creating a location
 */
export interface CreateLocationInput {
  code: string;
  name: string;
  hosting_type: string;
  operating_company_id?: string | null;
  provider?: string | null;
  country_iso?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
}

/**
 * Payload for updating a location
 */
export type UpdateLocationInput = Partial<CreateLocationInput>;

/**
 * Location sub-item (building, room, rack, etc.)
 */
export interface LocationSubItem {
  id: string;
  name: string;
  description?: string | null;
  display_order: number;
  /**
   * Set when an inventory synchronisation owns this row (Netbox today). Its
   * name and description are put back in line at the next run.
   */
  external_source?: string | null;
  external_url?: string | null;
}

/**
 * Assets API endpoints
 */
export const assetsApi = {
  /**
   * List assets with pagination and filtering
   */
  list: (params?: PaginationParams & { is_cluster?: boolean }): Promise<PaginatedResponse<AssetSummary>> =>
    api.paginated<AssetSummary>('/assets', params),

  /**
   * Get a single asset by ID
   */
  get: (id: string): Promise<Asset> =>
    api.get<Asset>(`/assets/${id}`),

  /**
   * Create a new asset
   */
  create: (data: CreateAssetInput): Promise<Asset> =>
    api.post<Asset, CreateAssetInput>('/assets', data),

  /**
   * Update an existing asset
   */
  update: (id: string, data: UpdateAssetInput): Promise<Asset> =>
    api.patch<Asset, UpdateAssetInput>(`/assets/${id}`, data),

  /**
   * Delete an asset
   */
  delete: (id: string): Promise<void> =>
    api.delete(`/assets/${id}`),

  /**
   * Bulk delete assets
   */
  bulkDelete: (ids: string[]): Promise<{ deleted: number }> =>
    api.post<{ deleted: number }>('/assets/bulk', { ids, action: 'delete' }),

  /**
   * Get asset assignments
   */
  getAssignments: (id: string): Promise<{ items: ServerAssignment[] }> =>
    api.get<{ items: ServerAssignment[] }>(`/assets/${id}/assignments`),

  /**
   * Get cluster members (if asset is a cluster)
   */
  getMembers: (id: string): Promise<PaginatedResponse<ClusterMember>> =>
    api.get<PaginatedResponse<ClusterMember>>(`/assets/${id}/members`),

  /**
   * Set cluster members
   */
  setMembers: (id: string, serverIds: string[]): Promise<void> =>
    api.post(`/assets/${id}/members`, { server_ids: serverIds }),

  /**
   * Get clusters this server belongs to
   */
  getClusters: (id: string): Promise<PaginatedResponse<ClusterSummary>> =>
    api.get<PaginatedResponse<ClusterSummary>>(`/assets/${id}/clusters`),

  /**
   * Get connections involving this server
   */
  getConnections: (id: string): Promise<PaginatedResponse<ServerConnection>> =>
    api.get<PaginatedResponse<ServerConnection>>(`/connections/by-server/${id}`),
};

/**
 * Locations API endpoints
 */
export const locationsApi = {
  /**
   * List locations with pagination and filtering
   */
  list: (params?: PaginationParams): Promise<PaginatedResponse<LocationSummary>> =>
    api.paginated<LocationSummary>('/locations', params),

  /**
   * Get a single location by ID
   */
  get: (id: string): Promise<Location> =>
    api.get<Location>(`/locations/${id}`),

  /**
   * Create a new location
   */
  create: (data: CreateLocationInput): Promise<Location> =>
    api.post<Location, CreateLocationInput>('/locations', data),

  /**
   * Update an existing location
   */
  update: (id: string, data: UpdateLocationInput): Promise<Location> =>
    api.patch<Location, UpdateLocationInput>(`/locations/${id}`, data),

  /**
   * Delete a location
   */
  delete: (id: string): Promise<void> =>
    api.delete(`/locations/${id}`),

  /**
   * Get servers at this location
   */
  getServers: (id: string, params?: PaginationParams): Promise<PaginatedResponse<AssetSummary>> =>
    api.paginated<AssetSummary>(`/locations/${id}/servers`, params),

  listSubItems: (id: string): Promise<LocationSubItem[]> =>
    api.get<LocationSubItem[]>(`/locations/${id}/sub-items`),

  createSubItem: (id: string, data: { name: string; description?: string | null }): Promise<LocationSubItem> =>
    api.post<LocationSubItem>(`/locations/${id}/sub-items`, data),

  updateSubItem: (id: string, subItemId: string, data: { name?: string; description?: string | null }): Promise<LocationSubItem> =>
    api.patch<LocationSubItem>(`/locations/${id}/sub-items/${subItemId}`, data),

  deleteSubItem: (id: string, subItemId: string): Promise<void> =>
    api.delete(`/locations/${id}/sub-items/${subItemId}`),

  reorderSubItems: (id: string, orderedIds: string[]): Promise<void> =>
    api.patch(`/locations/${id}/sub-items/reorder`, { ordered_ids: orderedIds }),
};
