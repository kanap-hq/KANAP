// Every message the Netbox pages show about a record or a planned change is a
// structured notice, not a sentence: the UI runs in four languages and
// translates by code. `text` carries the English wording so an unknown code
// still reads properly, and this file is the only place that wording lives.
//
// Connection-level strings (the test result, a run's error, the preview's own
// message, HTTP error bodies) stay plain English, like the PRTG and GLPI
// cards.

export type NetboxNoticeCode =
  // --- decisions waiting for a person ---
  | 'ambiguous_candidates'
  | 'contested_asset'
  | 'ip_match_candidates'
  | 'similar_name_candidates'
  | 'missing_from_netbox'
  | 'reevaluate_next_sync'
  // --- worth a look, but nothing is blocked ---
  | 'netbox_status_attention'
  // --- values KANAP could not take over ---
  | 'os_not_in_catalog'
  | 'os_ambiguous'
  // No longer emitted: a name whose end is not a known DNS suffix is kept
  // whole as the host name. Records written by earlier builds still carry the
  // code, so it stays readable.
  | 'domain_not_in_catalog'
  | 'hostname_invalid'
  | 'status_not_mapped'
  | 'lifecycle_not_in_catalog'
  | 'ipv6_skipped'
  | 'ip_conflict_skipped'
  | 'subnet_not_in_catalog'
  | 'no_ip_address_type'
  // --- values KANAP could not take over (locations) ---
  | 'sub_location_name_taken'
  | 'locations_unavailable'
  // --- virtual machine clusters ---
  | 'cluster_not_mapped'
  | 'cluster_match_invalid'
  | 'cluster_other_present'
  // --- run-level trouble ---
  | 'fetch_incomplete'
  | 'save_failed'
  | 'validation_failed';

export type NetboxNotice = {
  code: NetboxNoticeCode;
  params: Record<string, string>;
  /** English wording, rebuilt from the code; the UI falls back to it. */
  text: string;
};

/** Netbox status values KANAP surfaces, in the wording Netbox itself uses. */
const NETBOX_STATUS_LABELS: Record<string, string> = {
  offline: 'Offline',
  failed: 'Failed',
  paused: 'Paused',
};

const TEXTS: Record<NetboxNoticeCode, (params: Record<string, string>) => string> = {
  ambiguous_candidates: () =>
    'Several assets could be this object. Choose one, or create a new asset.',
  contested_asset: () =>
    'Two Netbox objects match this asset. Choose which one it is.',
  ip_match_candidates: (params) =>
    `An asset already uses the address ${params.value || ''}. Choose whether it is the same equipment.`.replace('  ', ' '),
  similar_name_candidates: () =>
    'An asset has a similar name. Choose whether it is the same equipment.',
  missing_from_netbox: () =>
    'This object is no longer in Netbox. Decide whether the asset should be retired.',
  reevaluate_next_sync: () =>
    'This object will be evaluated again at the next synchronisation.',
  netbox_status_attention: (p) =>
    `Netbox reports this object as ${NETBOX_STATUS_LABELS[p.value] ?? p.value}.`,
  os_not_in_catalog: (p) =>
    `The operating system "${p.value}" is not in the IT settings, so it was left unchanged.`,
  os_ambiguous: (p) =>
    `The operating system "${p.value}" matches more than one entry in the IT settings, so it was left unchanged.`,
  domain_not_in_catalog: (p) =>
    `The domain "${p.value}" is not in the IT settings, so it was left unchanged.`,
  hostname_invalid: (p) =>
    `"${p.value}" cannot be used as a host name, so the host name was left unchanged.`,
  status_not_mapped: (p) =>
    `The Netbox status "${p.value}" has no equivalent in KANAP, so the status was left unchanged.`,
  lifecycle_not_in_catalog: (p) =>
    `The lifecycle "${p.value}" is not in the IT settings, so the status was left unchanged.`,
  ipv6_skipped: () =>
    'The primary address is IPv6, which KANAP does not record yet, so it was left out.',
  ip_conflict_skipped: (p) =>
    `The address ${p.value} is already used by another asset, so it was left out.`,
  subnet_not_in_catalog: (p) =>
    `The subnet of ${p.value} is not in the IT settings, so the address was imported without one.`,
  no_ip_address_type: () =>
    'No IP address type is set up in the IT settings, so the address was not imported.',
  sub_location_name_taken: (p) =>
    `A sub-location named "${p.value}" already exists at this location for another Netbox location, so the sub-location was left unchanged.`,
  locations_unavailable: () =>
    'Netbox did not return its locations, so sub-locations were left unchanged in this run.',
  cluster_not_mapped: (p) =>
    `The Netbox cluster "${p.value}" is not matched with a KANAP cluster, so its virtual machines were not attached to one.`,
  cluster_match_invalid: (p) =>
    `The Netbox cluster "${p.value}" is matched with an asset that is deleted, retired or no longer a cluster, so its virtual machines were not attached to it.`,
  cluster_other_present: (p) =>
    `KANAP also places the virtual machine "${p.name}" in ${p.value}. That relation was kept: remove it by hand if it is out of date.`,
  fetch_incomplete: () =>
    'Netbox returned more pages than KANAP reads in one run, so the objects beyond them were not looked at.',
  save_failed: () =>
    'KANAP could not save this object. The technical details are in the server log.',
  validation_failed: (p) =>
    `KANAP refused to save this object: ${p.detail}`,
};

const CODES = new Set(Object.keys(TEXTS));

/**
 * A record holds one notice, so when an object produces several, one has to
 * win. Three tiers, and the highest wins; inside a tier the first notice
 * produced wins, which is the order the mapper works in.
 *
 *  3 — something is blocked or waiting on a person: the object could not be
 *      saved, or nobody can say which asset it is.
 *  2 — nothing is blocked, but the object deserves a look: Netbox reports it
 *      offline, failed or paused.
 *  1 — purely informational: a value KANAP could not take over (operating
 *      system, domain, host name, address...). The object is fine.
 */
const NOTICE_PRIORITY: Record<NetboxNoticeCode, 1 | 2 | 3> = {
  ambiguous_candidates: 3,
  contested_asset: 3,
  ip_match_candidates: 3,
  similar_name_candidates: 3,
  missing_from_netbox: 3,
  reevaluate_next_sync: 3,
  save_failed: 3,
  validation_failed: 3,
  netbox_status_attention: 2,
  os_not_in_catalog: 1,
  os_ambiguous: 1,
  domain_not_in_catalog: 1,
  hostname_invalid: 1,
  status_not_mapped: 1,
  lifecycle_not_in_catalog: 1,
  ipv6_skipped: 1,
  ip_conflict_skipped: 1,
  subnet_not_in_catalog: 1,
  no_ip_address_type: 1,
  sub_location_name_taken: 1,
  locations_unavailable: 1,
  cluster_not_mapped: 1,
  cluster_match_invalid: 1,
  cluster_other_present: 1,
  fetch_incomplete: 1,
};

/**
 * Shown on the preview row only, never kept on the record: another cluster
 * holding the machine is often deliberate, and would otherwise stay on the
 * records list at every run.
 */
const PREVIEW_ONLY_NOTICES: ReadonlySet<NetboxNoticeCode> = new Set<NetboxNoticeCode>(['cluster_other_present']);

/** The one notice a record keeps out of everything an object produced. */
export function primaryNotice(notices: NetboxNotice[]): NetboxNotice | null {
  let best: NetboxNotice | null = null;
  let bestRank = 0;
  for (const notice of notices) {
    if (PREVIEW_ONLY_NOTICES.has(notice.code)) continue;
    const rank = NOTICE_PRIORITY[notice.code] ?? 1;
    if (rank > bestRank) {
      best = notice;
      bestRank = rank;
    }
  }
  return best;
}

/** Builds a notice, English wording included. */
export function netboxNotice(code: NetboxNoticeCode, params: Record<string, string> = {}): NetboxNotice {
  return { code, params, text: TEXTS[code](params) };
}

/**
 * Rebuilds a notice from what the database holds. An unknown code (a record
 * written by a newer build) degrades to a neutral sentence rather than an
 * empty message.
 */
export function netboxNoticeFromStore(
  code: unknown,
  params: unknown,
): NetboxNotice | null {
  const normalized = typeof code === 'string' ? code.trim() : '';
  if (!normalized) return null;
  const safeParams: Record<string, string> = {};
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (value != null) safeParams[key] = String(value);
    }
  }
  if (!CODES.has(normalized)) {
    return { code: normalized as NetboxNoticeCode, params: safeParams, text: 'This object needs attention.' };
  }
  return netboxNotice(normalized as NetboxNoticeCode, safeParams);
}
