// Netbox REST API (v3.6+) transport types. Raw Netbox shapes stay inside this
// module: the mapper turns them into KANAP asset/hardware patches.

export type NetboxConnection = {
  /** Normalized base URL, no trailing slash, e.g. https://netbox.example.com */
  baseUrl: string;
  /** API token; never logged, never echoed back to the client. */
  token: string;
  /** "Ignore certificate": per-request rejectUnauthorized:false, never process-wide. */
  insecureTls?: boolean;
  /** Operator-tuned per-request timeout, already clamped by the caller. */
  requestTimeoutMs?: number | null;
};

export type NetboxApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'timeout'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'tls_untrusted'
  | 'dns';

/**
 * Structured transport error carrying a normalized code so callers never have
 * to substring-classify Netbox messages. Messages are plain language and safe
 * to show to an administrator; they never contain the API token.
 */
export class NetboxApiError extends Error {
  constructor(
    readonly errorCode: NetboxApiErrorCode,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'NetboxApiError';
  }
}

/** Value of `external_source` / `asset_external_links.source` for this inventory. */
export const NETBOX_LINK_SOURCE = 'netbox';

/** Object families KANAP imports from Netbox. */
export type NetboxObjectType = 'device' | 'vm';

/** One Netbox device or virtual machine, normalized and flattened. */
export type NetboxObject = {
  type: NetboxObjectType;
  id: string;
  name: string | null;
  serial: string | null;
  roleSlug: string | null;
  roleName: string | null;
  siteSlug: string | null;
  siteName: string | null;
  /** Raw Netbox status value, e.g. 'active', 'decommissioning'. */
  status: string | null;
  platformName: string | null;
  /** The platform's slug, which the operating system matches are keyed on. */
  platformSlug: string | null;
  manufacturer: string | null;
  model: string | null;
  rack: string | null;
  /** Rack unit as Netbox reports it (a number for devices, absent for VMs). */
  position: string | null;
  /** Primary address with its prefix length, e.g. '10.1.2.3/24'. */
  primaryIp: string | null;
  /** Deep link into the Netbox web interface. */
  url: string;
  /** The Location the device sits in, at any depth. Always null for a VM. */
  locationId: string | null;
  /**
   * The cluster this virtual machine runs on. Always null for a device: host
   * membership stays a manual assignment and is not read from Netbox.
   */
  cluster: NetboxClusterRef | null;
};

/** The cluster a virtual machine runs on, as Netbox reports it. */
export type NetboxClusterRef = {
  id: string;
  name: string;
};

/** One Netbox cluster, for the match table. Keyed by id, not by slug. */
export type NetboxClusterOption = {
  id: string;
  name: string;
  vm_count: number;
};

/** One Netbox Location, as the walk up to the top level needs it. */
export type NetboxLocation = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  siteSlug: string | null;
  url: string;
};

/** Every Netbox Location by id. `null` stands for "not available this run". */
export type NetboxLocationIndex = Map<string, NetboxLocation>;

/** A Netbox device role, site or platform, with how many objects reference it. */
export type NetboxReferenceOption = {
  slug: string;
  name: string;
  device_count: number;
  vm_count: number;
};
