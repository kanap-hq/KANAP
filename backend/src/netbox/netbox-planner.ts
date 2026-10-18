import { AssetExternalLinkState } from './asset-external-link.entity';
import {
  CatalogOption,
  MappedAssetFields,
  MappedHardwareFields,
  NetboxCatalogs,
  NetboxMapping,
  NetboxSubLocationTarget,
} from './netbox-mapper';
import { NetboxNotice, netboxNotice } from './netbox-notice';
import {
  ExistingAsset,
  NetboxMatchedBy,
  buildMatcherIndex,
  matchNetboxObject,
} from './netbox-matcher';
import { NETBOX_LINK_SOURCE, NetboxLocationIndex, NetboxObjectType } from './netbox.types';

// Pure planner: mapped objects + the tenant's assets and existing links in,
// one decision per Netbox object out. It diffs against the CURRENT asset
// values rather than a stored hash, so a field someone edited by hand in KANAP
// is put back in line at the next run instead of being silently skipped.

export type NetboxPlanAction = 'create' | 'update' | 'unchanged' | 'ambiguous' | 'skipped';
export type NetboxSkipCause = 'unmapped_role' | 'unmapped_site' | 'unnamed' | 'ignored';

/** What a person settled in the preview for one object; it overrides the cascade. */
export type NetboxDecisionAction = 'link' | 'create' | 'ignore';
export type NetboxDecision = {
  external_type: NetboxObjectType;
  external_id: string;
  action: NetboxDecisionAction;
  /** The asset to link to; only read for 'link'. */
  asset_id?: string;
};

export type NetboxAssetRef = { id: string; name: string; asset_reference: string | null };

export type NetboxFieldDiff = { field: string; before: string | null; after: string | null };

export type NetboxPlanRow = {
  external_type: NetboxObjectType;
  external_id: string;
  external_name: string | null;
  external_url: string;
  /** The raw status Netbox reports; KANAP's lifecycle does not follow it. */
  external_status: string | null;
  action: NetboxPlanAction;
  asset: NetboxAssetRef | null;
  matched_by: NetboxMatchedBy | null;
  candidates: NetboxAssetRef[];
  diffs: NetboxFieldDiff[];
  skip_reason: NetboxSkipCause | null;
  warnings: NetboxNotice[];
  /** The decision that shaped this row, when a person made one. */
  decision: NetboxDecisionAction | null;
};

export type NetboxSyncCounts = {
  create: number;
  update: number;
  unchanged: number;
  ambiguous: number;
  skipped: number;
  missing: number;
  error: number;
  /**
   * Creations and updates a manual run left alone because the person had not
   * been shown them yet. They come back in the next preview. Absent on states
   * stored by an earlier build, which reads as zero.
   */
  deferred?: number;
};

export type ExistingLink = {
  id: string;
  external_type: string;
  external_id: string;
  asset_id: string | null;
  state: AssetExternalLinkState;
};

/** A sub-location of the tenant, with whatever external identity it carries. */
export type ExistingSubLocation = {
  id: string;
  location_id: string;
  name: string;
  description: string | null;
  external_source: string | null;
  external_id: string | null;
  external_url: string | null;
};

export type NetboxSubLocationAction = 'create' | 'adopt' | 'rename' | 'update' | 'conflict';

export type NetboxSubLocationChange = {
  action: NetboxSubLocationAction;
  /** Set for every action but 'create', which has no row yet. */
  sub_item_id: string | null;
  location_id: string;
  location_name: string;
  external_id: string;
  external_url: string;
  name: string;
  /** Empty means "leave the KANAP description alone". */
  description: string | null;
  /** Set for 'rename', and for 'adopt' when only the spelling changes. */
  previous_name: string | null;
  /** Objects of this run that end up in it. 0 is possible for rename/update. */
  asset_count: number;
};

/** What resolving one Netbox Location against the tenant's sub-locations gives. */
export type SubLocationResolution =
  | { kind: 'existing'; subItem: ExistingSubLocation }
  | { kind: 'adopt'; subItem: ExistingSubLocation }
  | { kind: 'conflict'; subItem: ExistingSubLocation | null }
  | { kind: 'create' };

export type NetboxPlan = {
  rows: NetboxPlanRow[];
  /** Links whose Netbox object was not seen this run; empty when the guard trips. */
  missing: ExistingLink[];
  counts: NetboxSyncCounts;
  /** Per-row map from the plan row to what the apply step has to write. */
  writes: Map<string, NetboxPlanWrite>;
  /** Shared-object changes, listed once each rather than once per asset. */
  subLocations: NetboxSubLocationChange[];
  /** False when Netbox did not return its locations this run. */
  subLocationsAvailable: boolean;
};

export type NetboxPlanWrite = {
  asset: MappedAssetFields;
  hardware: MappedHardwareFields;
  assetId: string | null;
  /** The top-level Location this object belongs in, resolved at apply time. */
  subLocation: NetboxSubLocationTarget | null;
};

export function externalKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/** What one preview hands to the browser: a batch a person can actually read. */
export type NetboxReviewBatch = {
  rows: NetboxPlanRow[];
  /** Creations and updates that did not fit in this batch. */
  remaining: number;
  /** Out-of-scope objects, counted by reason: they are never listed one by one. */
  skipped_by_reason: Record<string, number>;
};

/**
 * Cuts the plan down to one reviewable batch.
 *
 * The rule the whole feature rests on: a manual run writes only what the person
 * was shown. So the batch must spend its room on what needs eyes, and nothing
 * else:
 *
 *  - an object out of scope (role or site not matched, no name, ignored
 *    earlier) is counted by reason and never listed. Hundreds of patch panels
 *    must not push a server that needs a decision out of the batch;
 *  - an object the person settled in this dialog always comes first, so it can
 *    be seen and taken back whatever else changes;
 *  - then what would be created and what would be updated: the writes, which
 *    are what the review is for. Every applied batch takes them out of the
 *    next one, so the batches always move forward;
 *  - then what waits for a decision. It comes after the writes on purpose: an
 *    object left undecided stays undecided from one preview to the next, and
 *    ahead of the writes it would hold its place in every batch and could keep
 *    them out for good. Nothing is lost by listing it late: it writes no asset,
 *    every run records it, and it can be settled from the page at any time;
 *  - last, the objects with nothing to write but something to say.
 *
 * `remaining` counts writes only, for the same reason: it is what holds the
 * automatic runs, and an undecided object must not hold them for ever.
 *
 * Inside a group the Netbox order is kept, so a batch is stable from one
 * preview to the next.
 */
export function buildReviewBatch(rows: NetboxPlanRow[], limit: number): NetboxReviewBatch {
  const skippedByReason: Record<string, number> = {};
  const listed: Array<{ row: NetboxPlanRow; rank: number; index: number }> = [];
  rows.forEach((row, index) => {
    if (row.action === 'skipped' && row.decision == null) {
      const reason = row.skip_reason ?? 'ignored';
      skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
      return;
    }
    if (row.action === 'unchanged' && row.warnings.length === 0 && row.decision == null) return;
    const rank = row.decision != null ? 0
      : row.action === 'create' ? 1
        : row.action === 'update' ? 2
          : row.action === 'ambiguous' ? 3
            : 4;
    listed.push({ row, rank, index });
  });
  listed.sort((left, right) => left.rank - right.rank || left.index - right.index);
  const isWrite = (row: NetboxPlanRow) => row.action === 'create' || row.action === 'update';
  return {
    rows: listed.slice(0, limit).map((entry) => entry.row),
    remaining: listed.slice(limit).filter((entry) => isWrite(entry.row)).length,
    skipped_by_reason: skippedByReason,
  };
}

/**
 * Whether a manual run must leave this row alone. `reviewed` holds the objects
 * the preview listed; null means the run has no reviewer at all (the scheduled
 * run), and nothing is held back. Only a creation or an update is held back:
 * those are the writes a person has to have seen. An object waiting for a
 * decision is still recorded, which writes no asset and is what puts it in the
 * "to decide" list.
 */
export function isWriteDeferred(row: NetboxPlanRow, reviewed: Set<string> | null): boolean {
  if (reviewed == null) return false;
  if (row.action !== 'create' && row.action !== 'update') return false;
  return !reviewed.has(externalKey(row.external_type, row.external_id));
}

/**
 * Assets a Netbox object owns, as a map from asset id to the object that owns
 * it. Only a live link owns one: a record already flagged as gone, or whose
 * object is absent from the fetch we are planning against, does not. That is
 * what lets a device deleted and recreated in Netbox — it comes back under a
 * new id — be picked up again by its host name instead of turning into a
 * duplicate asset.
 */
export function claimedAssets(links: ExistingLink[], seenKeys: Set<string> | null): Map<string, string> {
  const owners = new Map<string, string>();
  for (const link of links) {
    if (link.state !== 'linked' || !link.asset_id) continue;
    const key = externalKey(link.external_type, link.external_id);
    if (seenKeys != null && !seenKeys.has(key)) continue;
    owners.set(link.asset_id, key);
  }
  return owners;
}

function emptyCounts(): NetboxSyncCounts {
  return { create: 0, update: 0, unchanged: 0, ambiguous: 0, skipped: 0, missing: 0, error: 0 };
}

function optionLabel(code: string | null | undefined, options: CatalogOption[]): string | null {
  if (!code) return null;
  return options.find((option) => option.code === code)?.label || code;
}

function assetRef(asset: ExistingAsset | undefined): NetboxAssetRef | null {
  return asset ? { id: asset.id, name: asset.name, asset_reference: asset.asset_reference } : null;
}

function sameText(left: string | null, right: string | null): boolean {
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase();
}

/**
 * Whether a Netbox name is a real rename of the asset name. A difference in
 * case is not one, and neither is what follows the first dot: an asset a
 * person named "par-esx-01" is the same machine as the Netbox object
 * "par-esx-01.fromage.lan", and renaming it on a suffix alone would be noise.
 */
function isRename(currentName: string, netboxName: string): boolean {
  const current = currentName.trim().toLowerCase();
  const next = netboxName.trim().toLowerCase();
  if (current === next) return false;
  const shorten = (value: string) => (value.indexOf('.') > 0 ? value.slice(0, value.indexOf('.')) : value);
  return shorten(current) !== shorten(next);
}

function firstIp(asset: ExistingAsset): string | null {
  const entries = Array.isArray(asset.ip_addresses) ? asset.ip_addresses : [];
  return entries.length > 0 ? entries[0].ip : null;
}

function sameSubLocationName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Resolves one Netbox Location against the sub-locations of one KANAP location,
 * in this order:
 *
 *  1. a sub-location that already carries this Netbox id is it;
 *  2. otherwise a sub-location of the same name with no external identity is
 *     adopted, so a list built by hand is not duplicated by the first import;
 *  3. a sub-location of the same name that belongs to ANOTHER Netbox location
 *     is a conflict: nothing is written for it, and the equipment is imported
 *     without a sub-location rather than silently landing in the wrong one;
 *  4. otherwise it has to be created.
 *
 * The apply step calls this same function against a fresh read of the database,
 * so the preview and the write cannot drift apart.
 */
export function resolveSubLocation(
  existing: ExistingSubLocation[],
  locationId: string,
  target: NetboxSubLocationTarget,
): SubLocationResolution {
  const scoped = existing.filter((item) => item.location_id === locationId);

  const byIdentity = scoped.find(
    (item) => item.external_source === NETBOX_LINK_SOURCE && item.external_id === target.externalId,
  );
  if (byIdentity) return { kind: 'existing', subItem: byIdentity };

  const byName = scoped.find((item) => sameSubLocationName(item.name, target.name));
  if (!byName) return { kind: 'create' };
  if (!byName.external_source && !byName.external_id) return { kind: 'adopt', subItem: byName };
  return { kind: 'conflict', subItem: byName };
}

/**
 * Everything the sub-location diff needs, all of it already resolved by the
 * planner: what the object's top-level Netbox Location resolves to, the name
 * the asset currently carries, and whether its KANAP location changes in this
 * very run.
 */
export type SubLocationDiffContext = {
  resolution: SubLocationResolution | null;
  /** Name of the sub-location the asset holds today, when it holds one. */
  currentName: string | null;
  /** The asset's KANAP location changes: an unresolved sub-location is dropped. */
  locationChanged: boolean;
};

/**
 * Field-by-field difference between what Netbox reports and what the asset
 * currently holds. An empty Netbox value produces no difference: it must never
 * blank a KANAP value. A name that differs only in case is not a rename.
 */
export function diffNetboxMapping(
  mapping: NetboxMapping,
  asset: ExistingAsset,
  catalogs: NetboxCatalogs,
  subLocation?: SubLocationDiffContext,
): NetboxFieldDiff[] {
  const mapped = mapping.asset;
  const hardware = mapping.hardware;
  if (!mapped || !hardware) return [];

  const diffs: NetboxFieldDiff[] = [];
  const add = (field: string, changed: boolean, before: string | null, after: string | null) => {
    if (changed) diffs.push({ field, before, after });
  };

  add('name', isRename(asset.name, mapped.name), asset.name, mapped.name);
  add('kind', asset.kind !== mapped.kind,
    optionLabel(asset.kind, catalogs.assetKinds), optionLabel(mapped.kind, catalogs.assetKinds));

  const beforeLocation = catalogs.locations.find((entry) => entry.id === asset.location_id)?.name ?? null;
  const afterLocation = catalogs.locations.find((entry) => entry.id === mapped.location_id)?.name ?? null;
  const locationChanged = asset.location_id !== mapped.location_id;
  add('location', locationChanged, beforeLocation, afterLocation);

  // The sub-location only moves when its resolved row is a different one. A
  // rename touches the shared row, not the asset, and so produces no diff
  // here: an equipment list would otherwise read as N moves for one rename.
  //
  // The one case that has to be announced even without a target is a change of
  // KANAP location: the asset service clears a sub-location that belongs to the
  // location the asset is leaving, and the preview must not let that happen
  // quietly.
  const target = mapping.subLocation;
  const dropped = Boolean(subLocation?.locationChanged && asset.sub_location_id);
  const resolvedId = subLocation?.resolution
    && subLocation.resolution.kind !== 'create'
    && subLocation.resolution.kind !== 'conflict'
    ? subLocation.resolution.subItem.id
    : null;
  if (subLocation) {
    if (target && subLocation.resolution?.kind === 'create') {
      add('sub_location', true, subLocation.currentName, target.name);
    } else if (target && resolvedId && resolvedId !== asset.sub_location_id) {
      add('sub_location', true, subLocation.currentName, target.name);
    } else if (dropped && (!target || subLocation.resolution?.kind === 'conflict')) {
      add('sub_location', true, subLocation.currentName, null);
    }
  }

  if (mapped.status) {
    add('status', asset.status !== mapped.status,
      optionLabel(asset.status, catalogs.lifecycleStates), optionLabel(mapped.status, catalogs.lifecycleStates));
  }
  if (mapped.hostname) {
    add('hostname', !sameText(asset.hostname, mapped.hostname), asset.hostname, mapped.hostname);
  }
  if (mapped.domain) {
    add('domain', asset.domain !== mapped.domain,
      optionLabel(asset.domain, catalogs.domains), optionLabel(mapped.domain, catalogs.domains));
  }
  if (mapped.operating_system) {
    add('operating_system', !sameText(asset.operating_system, mapped.operating_system),
      optionLabel(asset.operating_system, catalogs.operatingSystems),
      optionLabel(mapped.operating_system, catalogs.operatingSystems));
  }
  if (mapped.ip_addresses && mapped.ip_addresses.length > 0) {
    const wanted = mapped.ip_addresses[0].ip;
    const held = (asset.ip_addresses ?? []).some((entry) => entry.ip === wanted);
    add('primary_ip', !held, firstIp(asset), wanted);
  }

  for (const [field, value] of Object.entries({
    serial_number: hardware.serial_number,
    manufacturer: hardware.manufacturer,
    model: hardware.model,
    rack_location: hardware.rack_location,
    rack_unit: hardware.rack_unit,
  })) {
    if (!value) continue;
    const before = (asset as unknown as Record<string, string | null>)[field] ?? null;
    add(field, !sameText(before, value), before, value);
  }

  return diffs;
}

/**
 * Plans a whole run. `fetchOk` and `totalObjects` drive the "missing" guard:
 * a failed fetch, or a Netbox that returned nothing at all, must never make
 * the whole inventory look like it disappeared.
 */
export function planNetboxSync(input: {
  mappings: NetboxMapping[];
  links: ExistingLink[];
  assets: ExistingAsset[];
  catalogs: NetboxCatalogs;
  fetchOk: boolean;
  totalObjects: number;
  /** Choices made in the preview. An object out of scope ignores its own. */
  decisions?: NetboxDecision[];
  /** Every sub-location of the tenant, with whatever identity it carries. */
  subLocations?: ExistingSubLocation[];
  /** Netbox's Locations, or null when it did not return them. */
  locationIndex?: NetboxLocationIndex | null;
  /** Netbox site slug -> KANAP location id, for the upkeep of linked rows. */
  siteMap?: Record<string, string>;
}): NetboxPlan {
  const { mappings, links, assets, catalogs } = input;
  const existingSubLocations = input.subLocations ?? [];
  const locationIndex = input.locationIndex ?? null;
  const siteMap = input.siteMap ?? {};
  const subLocationsAvailable = locationIndex != null;
  const decisionsByKey = new Map(
    (input.decisions ?? []).map((decision) => [externalKey(decision.external_type, decision.external_id), decision]),
  );
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const linksByKey = new Map(links.map((link) => [externalKey(link.external_type, link.external_id), link]));
  const seen = new Set(mappings.map((mapping) => externalKey(mapping.object.type, mapping.object.id)));
  const missingGuardApplies = input.fetchOk && input.totalObjects > 0;

  // An asset another Netbox object already owns is off the table: it is kept
  // out of the index entirely, so the cascade can neither match it nor offer
  // it as a candidate. The object that owns it still reaches it directly,
  // through its own link. When the fetch is trustworthy, a record whose object
  // Netbox no longer lists releases its asset in the same breath as it becomes
  // "missing", so a recreated object can take it over in this very run.
  const owners = claimedAssets(links, missingGuardApplies ? seen : null);
  const index = buildMatcherIndex(assets.filter((asset) => !owners.has(asset.id)));

  // Pass one decides, pass two writes the rows: a decision can still be turned
  // into an ambiguity by another object landing on the same asset.
  type Decision = {
    key: string;
    mapping: NetboxMapping;
    base: NetboxPlanRow;
    skip: NetboxSkipCause | null;
    match: ReturnType<typeof matchNetboxObject> | null;
    /** A chosen asset that turned out to belong to another object. */
    heldElsewhere?: boolean;
  };

  const decisions: Decision[] = [];

  for (const mapping of mappings) {
    const key = externalKey(mapping.object.type, mapping.object.id);
    const link = linksByKey.get(key) ?? null;

    const base: NetboxPlanRow = {
      external_type: mapping.object.type,
      external_id: mapping.object.id,
      external_name: mapping.object.name,
      external_url: mapping.object.url,
      external_status: mapping.object.status,
      action: 'skipped',
      asset: null,
      matched_by: null,
      candidates: [],
      diffs: [],
      skip_reason: null,
      warnings: mapping.warnings,
      decision: null,
    };

    // Scope comes first: a decision cannot pull in an object the role and site
    // matches leave out, there would be nothing to build the asset from.
    if (mapping.skipReason) {
      decisions.push({ key, mapping, base, skip: mapping.skipReason, match: null });
      continue;
    }
    const decided = decisionsByKey.get(key) ?? null;
    if (decided?.action === 'ignore') {
      decisions.push({ key, mapping, base: { ...base, decision: 'ignore' }, skip: 'ignored', match: null });
      continue;
    }
    if (decided?.action === 'create') {
      decisions.push({
        key, mapping, base: { ...base, decision: 'create' }, skip: null,
        match: { assetId: null, matchedBy: null, candidateAssetIds: [] },
      });
      continue;
    }
    if (decided?.action === 'link' && decided.asset_id && assetsById.has(decided.asset_id)) {
      // The preview refuses a link to an asset another object holds. A run
      // that still meets one (the link appeared in between) asks again rather
      // than giving the asset a second owner.
      const heldBy = owners.get(decided.asset_id);
      const free = heldBy === undefined || heldBy === key;
      decisions.push({
        key, mapping, base: { ...base, decision: 'link' }, skip: null,
        match: free
          ? { assetId: decided.asset_id, matchedBy: 'manual', candidateAssetIds: [] }
          : { assetId: null, matchedBy: null, candidateAssetIds: [decided.asset_id] },
        heldElsewhere: !free,
      });
      continue;
    }
    if (link?.state === 'ignored') {
      decisions.push({ key, mapping, base, skip: 'ignored', match: null });
      continue;
    }

    // One predicate decides whether a record still binds its object to its
    // asset: the asset must exist, and no OTHER object's live record may own
    // it. A record that was flagged missing or failed, whose asset has since
    // been taken over by another Netbox object, therefore goes back through
    // the cascade — and since an owned asset is out of the index, it comes out
    // as a create or an ambiguity rather than as a second owner.
    const owner = link?.asset_id ? owners.get(link.asset_id) : undefined;
    const boundAssetId = link?.asset_id
      && assetsById.has(link.asset_id)
      && (owner === undefined || owner === key)
      ? link.asset_id
      : null;
    decisions.push({ key, mapping, base, skip: null, match: matchNetboxObject(mapping, boundAssetId, index) });
  }

  // Two Netbox objects reaching the same asset: neither wins, both go to a
  // person with that asset as the candidate. Link matches are counted too, so
  // that two stored records pointing at one asset cannot both be written.
  const contested = new Set<string>();
  const reachedBy = new Map<string, number>();
  for (const decision of decisions) {
    const assetId = decision.match?.assetId;
    if (!assetId) continue;
    const count = (reachedBy.get(assetId) ?? 0) + 1;
    reachedBy.set(assetId, count);
    if (count > 1) contested.add(assetId);
  }

  const rows: NetboxPlanRow[] = [];
  const writes = new Map<string, NetboxPlanWrite>();
  const counts = emptyCounts();

  // Rows are decided in two beats because a sub-location is a SHARED object:
  // one Netbox Location can be the target of several equipment rows, and two
  // Netbox Locations can want the same name. Building every write first, then
  // resolving the distinct targets once, is what makes "one row created, the
  // other in conflict" deterministic instead of a matter of row order.
  const pending: Array<{
    key: string;
    mapping: NetboxMapping;
    base: NetboxPlanRow;
    matcher: NonNullable<ReturnType<typeof matchNetboxObject>>;
  }> = [];

  for (const { key, mapping, base, skip, match, heldElsewhere } of decisions) {
    if (skip || !match) {
      rows.push({ ...base, skip_reason: skip });
      counts.skipped += 1;
      continue;
    }

    const contestedAsset = match.assetId && contested.has(match.assetId) ? match.assetId : null;
    // A suggestion (an address, or a name that only resembles) pointing at an
    // asset another object of this run reaches on firmer ground is not worth a
    // question: that asset is taken.
    const candidateIds = contestedAsset
      ? [contestedAsset]
      : match.suggestedByIp || match.suggestedByName
        ? match.candidateAssetIds.filter((id) => !reachedBy.has(id))
        : match.candidateAssetIds;
    if (candidateIds.length > 0) {
      rows.push({
        ...base,
        action: 'ambiguous',
        candidates: candidateIds
          .map((id) => assetRef(assetsById.get(id)))
          .filter((ref): ref is NetboxAssetRef => ref != null),
        warnings: [
          ...base.warnings,
          contestedAsset || heldElsewhere
            ? netboxNotice('contested_asset')
            : match.suggestedByIp
              ? netboxNotice('ip_match_candidates', { value: match.suggestedByIp })
              : match.suggestedByName
                ? netboxNotice('similar_name_candidates')
                : netboxNotice('ambiguous_candidates'),
        ],
      });
      counts.ambiguous += 1;
      continue;
    }

    writes.set(key, {
      asset: mapping.asset as MappedAssetFields,
      hardware: mapping.hardware as MappedHardwareFields,
      assetId: match.assetId,
      subLocation: mapping.subLocation,
    });
    pending.push({ key, mapping, base, matcher: match });
  }

  const { resolutions, changes } = resolveSubLocationTargets(pending, {
    existing: existingSubLocations,
    catalogs,
    locationIndex,
    siteMap,
    subLocationsAvailable,
  });

  for (const { key, mapping, base, matcher } of pending) {
    const write = writes.get(key) as NetboxPlanWrite;
    const resolution = resolutions.get(key) ?? null;
    const asset = write.assetId ? assetsById.get(write.assetId) : undefined;
    // The equipment is imported either way; only the sub-location is left
    // alone, and the person has to know why.
    const warnings = resolution?.kind === 'conflict'
      ? [...base.warnings, netboxNotice('sub_location_name_taken', { value: mapping.subLocation?.name ?? '' })]
      : base.warnings;
    // A conflict is settled here, once, by Netbox id. The write must not carry
    // the target any further: the apply step resolves a new asset's target
    // against the database, and rows are applied in the order Netbox listed
    // them, so the losing Location would be created whenever its equipment
    // happened to come first, and the run would contradict its own preview.
    if (resolution?.kind === 'conflict') write.subLocation = null;

    if (!write.assetId) {
      rows.push({ ...base, action: 'create', warnings });
      counts.create += 1;
      continue;
    }

    const subLocationContext: SubLocationDiffContext = {
      resolution,
      currentName: asset?.sub_location_id
        ? existingSubLocations.find((item) => item.id === asset.sub_location_id)?.name ?? null
        : null,
      locationChanged: Boolean(asset && asset.location_id !== write.asset.location_id),
    };
    const diffs = asset ? diffNetboxMapping(mapping, asset, catalogs, subLocationContext) : [];
    const action: NetboxPlanAction = diffs.length > 0 ? 'update' : 'unchanged';
    rows.push({
      ...base,
      action,
      asset: assetRef(asset),
      matched_by: matcher.matchedBy,
      diffs,
      warnings,
    });
    counts[action] += 1;
  }

  // Objects a previous run linked and Netbox no longer lists. Never computed
  // when the fetch failed or came back empty: that is an outage, not a
  // decommissioning.
  const missing = missingGuardApplies
    ? links.filter((link) =>
      link.state === 'linked'
      && !seen.has(externalKey(link.external_type, link.external_id)))
    : [];
  counts.missing = missing.length;

  return {
    rows,
    missing,
    counts,
    writes,
    subLocations: changes,
    subLocationsAvailable,
  };
}

/**
 * Resolves every distinct Netbox Location this run has to write into, and
 * works out the upkeep of the ones already linked.
 *
 * Two things happen here, and they are deliberately different:
 *
 *  - the targets of this run, resolved against a working copy that grows as we
 *    go. Targets are sorted by Netbox id, so when two Locations want the same
 *    name the lower id wins and the other comes out as a conflict, whatever
 *    order the equipment rows arrived in. The apply step re-reads the database
 *    and lands on the same answer without any of this;
 *  - the upkeep of sub-locations already linked: a Location renamed in Netbox
 *    is renamed in place, whatever the equipment rows do. Without this step a
 *    rename would never happen at all, because a row whose only change is the
 *    shared name has no diff and is never written.
 *
 * One sub-location produces at most one change per run, carrying everything
 * that has to be written: a rename also refreshes the description and the deep
 * link, so the apply step never has to guess.
 */
function resolveSubLocationTargets(
  pending: Array<{ key: string; mapping: NetboxMapping; base: NetboxPlanRow }>,
  context: {
    existing: ExistingSubLocation[];
    catalogs: NetboxCatalogs;
    locationIndex: NetboxLocationIndex | null;
    siteMap: Record<string, string>;
    subLocationsAvailable: boolean;
  },
): { resolutions: Map<string, SubLocationResolution>; changes: NetboxSubLocationChange[] } {
  const resolutions = new Map<string, SubLocationResolution>();
  const changes: NetboxSubLocationChange[] = [];
  const { existing, catalogs, locationIndex, siteMap, subLocationsAvailable } = context;

  const locationName = (locationId: string) =>
    catalogs.locations.find((entry) => entry.id === locationId)?.name ?? '';

  // A working copy: a creation or an adoption planned for one target must be
  // visible to the next, or two Netbox Locations with the same name would both
  // be created and the unique index would refuse the second one mid-run.
  const working: ExistingSubLocation[] = existing.map((item) => ({ ...item }));

  if (subLocationsAvailable) {
    changes.push(...reconcileLinkedSubLocations(
      working,
      locationIndex as NetboxLocationIndex,
      siteMap,
      locationName,
    ));
  }

  // One entry per distinct Netbox Location, holding the rows that want it.
  const wanted = new Map<string, { target: NetboxSubLocationTarget; rows: typeof pending }>();
  for (const entry of pending) {
    const target = entry.mapping.subLocation;
    if (!target) continue;
    const bucket = wanted.get(target.externalId);
    if (bucket) bucket.rows.push(entry);
    else wanted.set(target.externalId, { target, rows: [entry] });
  }

  const ordered = [...wanted.entries()].sort(([left], [right]) => compareExternalIds(left, right));

  for (const [externalId, bucket] of ordered) {
    const { target, rows: bucketRows } = bucket;
    const locationId = bucketRows[0].mapping.asset?.location_id ?? '';
    if (!locationId) continue;
    const resolution = resolveSubLocation(working, locationId, target);
    for (const row of bucketRows) resolutions.set(row.key, resolution);

    const assetCount = bucketRows.length;
    const base = {
      location_id: locationId,
      location_name: locationName(locationId),
      external_id: externalId,
      asset_count: assetCount,
    };

    if (resolution.kind === 'create') {
      changes.push({
        ...base,
        action: 'create',
        sub_item_id: null,
        external_url: target.url,
        name: target.name,
        description: target.description,
        previous_name: null,
      });
      // Reserve the name so a later target cannot claim it too.
      working.push({
        id: `${PENDING_SUB_ITEM_PREFIX}${externalId}`,
        location_id: locationId,
        name: target.name,
        description: target.description,
        external_source: NETBOX_LINK_SOURCE,
        external_id: externalId,
        external_url: target.url,
      });
      continue;
    }

    if (resolution.kind === 'conflict') {
      changes.push({
        ...base,
        action: 'conflict',
        // A conflict can be against a row this very run is about to create.
        // That placeholder is not an id anyone can use, so it is reported as
        // "no row yet" rather than leaking the working copy's bookkeeping.
        sub_item_id: realSubItemId(resolution.subItem),
        external_url: target.url,
        name: target.name,
        description: target.description,
        previous_name: resolution.subItem?.name ?? null,
      });
      continue;
    }

    const subItem = resolution.subItem;
    if (resolution.kind === 'adopt') {
      // A list built by hand is taken over, never duplicated. The row keeps its
      // id, so the assets already filed there do not move.
      const spellingChanged = subItem.name !== target.name;
      changes.push({
        ...base,
        action: 'adopt',
        sub_item_id: subItem.id,
        external_url: target.url,
        name: target.name,
        description: target.description,
        previous_name: spellingChanged ? subItem.name : null,
      });
      subItem.external_source = NETBOX_LINK_SOURCE;
      subItem.external_id = externalId;
      subItem.external_url = target.url;
      subItem.name = target.name;
      if (target.description) subItem.description = target.description;
    }
  }

  return { resolutions, changes };
}

/**
 * Run-level notices for the upkeep conflicts: a Location renamed in Netbox onto
 * a name already taken in KANAP. No equipment row carries that conflict (the
 * assets keep their sub-location, so they have no diff), and a scheduled run
 * has no preview, so without this nothing would ever say the rename is stuck.
 * A conflict on a target of this run is already on its equipment rows.
 */
export function subLocationUpkeepNotices(changes: NetboxSubLocationChange[]): NetboxNotice[] {
  return changes
    .filter((change) => change.action === 'conflict' && change.asset_count === 0)
    .map((change) => netboxNotice('sub_location_name_taken', { value: change.name }));
}

/**
 * The id of a real row, or null. The planner's working copy holds placeholder
 * entries for the sub-locations it is about to create, so that a second target
 * cannot claim their name; their id is bookkeeping, never something to store.
 */
const PENDING_SUB_ITEM_PREFIX = 'pending:';

function realSubItemId(subItem: ExistingSubLocation | null | undefined): string | null {
  if (!subItem) return null;
  return subItem.id.startsWith(PENDING_SUB_ITEM_PREFIX) ? null : subItem.id;
}

/** Numeric-aware ordering so "10" sorts after "9" and ties stay stable. */
function compareExternalIds(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftNumeric = left.trim() !== '' && Number.isFinite(leftNumber);
  const rightNumeric = right.trim() !== '' && Number.isFinite(rightNumber);
  if (leftNumeric && rightNumeric && leftNumber !== rightNumber) return leftNumber - rightNumber;
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

/**
 * Upkeep of the sub-locations a previous run linked. A Location renamed in
 * Netbox is renamed in place: every asset that carries it, including the ones a
 * person filed there by hand, follows. Nothing here touches an asset.
 *
 * A row is left alone when its Netbox Location is gone, when it moved under a
 * parent (it is no longer a top-level one) or when its site is mapped
 * elsewhere. A rename onto a name already taken in the KANAP location is
 * reported, never forced: the identity is still known, so the equipment keeps
 * its sub-location.
 */
function reconcileLinkedSubLocations(
  working: ExistingSubLocation[],
  locationIndex: NetboxLocationIndex,
  siteMap: Record<string, string>,
  locationName: (locationId: string) => string,
): NetboxSubLocationChange[] {
  const changes: NetboxSubLocationChange[] = [];
  for (const subItem of working) {
    if (subItem.external_source !== NETBOX_LINK_SOURCE || !subItem.external_id) continue;
    const location = locationIndex.get(subItem.external_id);
    if (!location || location.parentId || !location.siteSlug) continue;
    if (siteMap[location.siteSlug] !== subItem.location_id) continue;

    const nameChanged = location.name !== subItem.name;
    const urlChanged = location.url !== subItem.external_url;
    // An empty Netbox description never blanks the KANAP one.
    const descriptionChanged = Boolean(location.description) && location.description !== subItem.description;
    if (!nameChanged && !urlChanged && !descriptionChanged) continue;

    const base = {
      sub_item_id: subItem.id,
      location_id: subItem.location_id,
      location_name: locationName(subItem.location_id),
      external_id: subItem.external_id,
      external_url: location.url,
      description: location.description,
      asset_count: 0,
    };

    if (nameChanged) {
      const taken = working.some((other) =>
        other.id !== subItem.id
        && other.location_id === subItem.location_id
        && sameSubLocationName(other.name, location.name));
      if (taken) {
        changes.push({ ...base, action: 'conflict', name: location.name, previous_name: subItem.name });
        continue;
      }
      changes.push({ ...base, action: 'rename', name: location.name, previous_name: subItem.name });
      subItem.name = location.name;
    } else {
      changes.push({ ...base, action: 'update', name: subItem.name, previous_name: null });
    }

    subItem.external_url = location.url;
    if (location.description) subItem.description = location.description;
  }
  return changes;
}
