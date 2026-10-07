import { AiExecutionContextWithManager } from '../../ai.types';
import {
  KANAP_ENTITY_CONTEXT_CAPABILITY,
  KANAP_ENTITY_DETAIL_CAPABILITY,
  KANAP_ENTITY_SEARCH_CAPABILITY,
  KanapEntityFamily,
} from '../capability/ai-capability.registry';
import { isRecord } from '../../../common/object-guards';

// Bounded KANAP entity resolution for monitoring diagnosis (plan 37 §4.5).
//
// Deliberately a plain class outside Nest DI: the control service constructs it with a
// dispatch callback wrapping AiCapabilityDispatcherService.execute (surface 'internal'),
// so every entity lookup flows through the dispatcher and records runs/steps/evidence
// automatically — the resolver itself never touches the database or a provider.
//
// The dispatch callback must NEVER throw: it converts dispatcher/handler failures into
// structured outcomes (ForbiddenException from AiPolicyService.assertEntityTypeReadAccess
// => errorKind 'missing_permission'; anything else => 'unavailable'/'error'). A denied or
// unavailable family degrades to "source unavailable" with a note in the resolution —
// never an error and never a leak.

// Hard cap on capability dispatches per resolution: the whole chain (asset search +
// IP tiebreak details + context + per-domain follow-ups) stops early once reached.
export const MAX_ENTITY_LOOKUPS_PER_RESOLUTION = 8;

const ASSET_CANDIDATE_LIMIT = 10;
const RELATED_ENTITY_LIMIT = 5;
const LOCATION_CANDIDATE_LIMIT = 3;

export type KanapDataPolicy = {
  enabled: boolean;
  domains: Record<KanapEntityFamily, boolean>;
};

// Citation-ready reference to a retrieved KANAP entity; feeds the reply-synthesis
// knownSources allowlist (kind 'entity') so only actually-fetched objects can be cited.
export type EntitySourceRef = {
  kind: 'entity';
  entityType: KanapEntityFamily;
  id: string;
  ref: string;
  label: string;
  url: string | null;
};

export type KanapResolvedEntity = {
  entityType: KanapEntityFamily;
  id: string;
  ref: string | null;
  label: string;
  status: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
};

export type KanapEntityDispatchOutcome =
  | { ok: true; output: unknown }
  | { ok: false; errorKind: 'missing_permission' | 'unavailable' | 'error'; message?: string };

export type KanapEntityDispatch = (
  context: AiExecutionContextWithManager,
  capabilityName: string,
  input: Record<string, unknown>,
) => Promise<KanapEntityDispatchOutcome>;

export type KanapEntityContextResolverDeps = {
  dispatch: KanapEntityDispatch;
};

// The alert-side identity of the failing device: deviceName from MonitoringAlert,
// hostAddress from the device's MonitoredObjectRecord when the runtime fetched it
// (an IP literal or a DNS name — DNS names join the exact-match set, IPs are the
// ambiguity tiebreak).
export type KanapAlertDeviceRef = {
  deviceName: string | null;
  hostAddress?: string | null;
};

export type KanapAlertContextResolution = {
  assetMatch: 'matched' | 'ambiguous' | 'unmatched' | 'disabled';
  asset?: KanapResolvedEntity;
  application?: KanapResolvedEntity;
  relatedInterfaces?: KanapResolvedEntity[];
  relatedConnections?: KanapResolvedEntity[];
  location?: KanapResolvedEntity;
  owners?: string[];
  lookupsUsed: number;
  sources: EntitySourceRef[];
  notes: string[];
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpLiteral(value: string): boolean {
  return IPV4_RE.test(value) || value.includes(':');
}

// First DNS label of an FQDN-shaped value ("acme-fr-dc1.acme-fr.example" ->
// "acme-fr-dc1"). Null for IP literals and undotted names: those have no
// shortname distinct from the value itself.
function firstDnsLabel(value: string): string | null {
  if (!value || isIpLiteral(value)) {
    return null;
  }
  const dot = value.indexOf('.');
  return dot > 0 ? value.slice(0, dot) : null;
}

// Deep-link patterns mirror the canonical frontend routes (App.tsx `/it/*`
// registrations, same shapes as EntityKnowledgePanel's sourceHref) — the routes accept
// either the short ref or the UUID and normalize via a replaceState redirect.
const ENTITY_ROUTE_BASE: Record<KanapEntityFamily, string> = {
  applications: '/it/applications',
  assets: '/it/assets',
  interfaces: '/it/interfaces',
  connections: '/it/connections',
  locations: '/it/locations',
};

export function kanapEntityDeepLink(entityType: KanapEntityFamily, refOrId: string): string {
  return `${ENTITY_ROUTE_BASE[entityType]}/${encodeURIComponent(refOrId)}/overview`;
}

function parseEntitySummary(entityType: KanapEntityFamily, value: unknown): KanapResolvedEntity | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return null;
  }
  return {
    entityType,
    id: value.id,
    ref: stringOrNull(value.ref),
    label: stringOrNull(value.label) ?? value.id,
    status: stringOrNull(value.status),
    summary: stringOrNull(value.summary),
    metadata: isRecord(value.metadata) ? value.metadata : null,
  };
}

function parseSearchItems(entityType: KanapEntityFamily, output: unknown): KanapResolvedEntity[] {
  if (!isRecord(output) || !Array.isArray(output.items)) {
    return [];
  }
  return output.items
    .map((item) => parseEntitySummary(entityType, item))
    .filter((item): item is KanapResolvedEntity => !!item);
}

function toSourceRef(entity: KanapResolvedEntity): EntitySourceRef {
  const refOrId = entity.ref ?? entity.id;
  return {
    kind: 'entity',
    entityType: entity.entityType,
    id: entity.id,
    ref: entity.ref ?? entity.label,
    label: entity.label,
    url: kanapEntityDeepLink(entity.entityType, refOrId),
  };
}

// Matching rule (maintainer decision 2026-07-05, plan 37 §4.5; extended 2026-08-09):
// case-insensitive EXACT comparison of the candidate's name/hostname/fqdn against the
// device name (and against the device host address when it is a DNS name). A value's
// FIRST DNS LABEL also counts as exact on either side, so a monitoring tool reporting
// "ACME-FR-DC1.acme-fr.example" matches an asset named "acme-fr-dc1" and a shortname
// device matches an asset whose name/hostname/fqdn carries the domain. Still no
// fuzzy matching.
function candidateMatches(candidate: KanapResolvedEntity, targets: string[]): boolean {
  const metadata = candidate.metadata ?? {};
  const fields = [
    candidate.label,
    stringOrNull(metadata.hostname),
    stringOrNull(metadata.fqdn),
  ];
  return fields.some((field) => {
    if (!field) {
      return false;
    }
    const normalized = field.trim().toLocaleLowerCase();
    if (targets.includes(normalized)) {
      return true;
    }
    const label = firstDnsLabel(normalized);
    return !!label && targets.includes(label);
  });
}

function detailIps(output: unknown): string[] {
  if (!isRecord(output) || !isRecord(output.data)) {
    return [];
  }
  const raw = output.data.ip_addresses;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      return isRecord(entry) && typeof entry.ip === 'string' ? entry.ip.trim() : '';
    })
    .filter(Boolean);
}

function ownersFromApplicationMetadata(metadata: Record<string, unknown> | null): string[] {
  if (!metadata) {
    return [];
  }
  const owners: string[] = [];
  for (const key of ['business_owner', 'it_owner']) {
    const value = stringOrNull(metadata[key]);
    if (value) {
      owners.push(value);
    }
  }
  return owners;
}

function firstLinkedApplication(contextOutput: unknown): KanapResolvedEntity | null {
  if (!isRecord(contextOutput) || !Array.isArray(contextOutput.related)) {
    return null;
  }
  const group = contextOutput.related.find((entry) => isRecord(entry) && entry.relation === 'linked_applications');
  if (!isRecord(group) || !Array.isArray(group.items)) {
    return null;
  }
  for (const item of group.items) {
    const parsed = parseEntitySummary('applications', item);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

type DispatchState = {
  context: AiExecutionContextWithManager;
  budget: number;
  lookupsUsed: number;
  budgetNoted: boolean;
  notes: string[];
};

export class KanapEntityContextResolver {
  constructor(private readonly deps: KanapEntityContextResolverDeps) {}

  async resolveAlertContext(input: {
    context: AiExecutionContextWithManager;
    alert: KanapAlertDeviceRef;
    kanapData: KanapDataPolicy;
    budget?: number;
  }): Promise<KanapAlertContextResolution> {
    const notes: string[] = [];
    const sources: EntitySourceRef[] = [];
    if (!input.kanapData.enabled) {
      return {
        assetMatch: 'disabled',
        lookupsUsed: 0,
        sources,
        notes: ['KANAP data enrichment is turned off for this agent.'],
      };
    }
    if (!input.kanapData.domains.assets) {
      return {
        assetMatch: 'disabled',
        lookupsUsed: 0,
        sources,
        notes: ['Asset lookups are turned off for this agent; the alert was not correlated with KANAP data.'],
      };
    }
    const deviceName = (input.alert.deviceName ?? '').trim();
    if (!deviceName) {
      return {
        assetMatch: 'unmatched',
        lookupsUsed: 0,
        sources,
        notes: ['The alert does not carry a device name; no KANAP asset correlation is possible.'],
      };
    }

    const state: DispatchState = {
      context: input.context,
      budget: Math.max(1, Math.min(input.budget ?? MAX_ENTITY_LOOKUPS_PER_RESOLUTION, MAX_ENTITY_LOOKUPS_PER_RESOLUTION)),
      lookupsUsed: 0,
      budgetNoted: false,
      notes,
    };
    const hostAddress = (input.alert.hostAddress ?? '').trim();
    const hostIsIp = hostAddress ? isIpLiteral(hostAddress) : false;
    const deviceShortName = firstDnsLabel(deviceName);
    const matchTargets = [deviceName.toLocaleLowerCase()];
    if (deviceShortName) {
      matchTargets.push(deviceShortName.toLocaleLowerCase());
    }
    if (hostAddress && !hostIsIp) {
      matchTargets.push(hostAddress.toLocaleLowerCase());
      const hostShortName = firstDnsLabel(hostAddress);
      if (hostShortName) {
        matchTargets.push(hostShortName.toLocaleLowerCase());
      }
    }

    // 1. Asset candidates by device name. FQDN-shaped names search by their
    // first label: the substring search would never return an asset whose
    // stored name is the bare shortname, and the shortname is itself a
    // substring of every FQDN-carrying candidate field, so recall only grows.
    const search = await this.dispatchBounded(state, KANAP_ENTITY_SEARCH_CAPABILITY, {
      entity_type: 'assets',
      q: deviceShortName ?? deviceName,
      limit: ASSET_CANDIDATE_LIMIT,
    }, 'Asset');
    if (search.status !== 'ok') {
      return { assetMatch: 'unmatched', lookupsUsed: state.lookupsUsed, sources, notes };
    }
    const candidates = parseSearchItems('assets', search.output);
    const survivors = candidates.filter((candidate) => candidateMatches(candidate, matchTargets));

    let matched: KanapResolvedEntity | null = null;
    if (survivors.length === 1) {
      matched = survivors[0];
    } else if (survivors.length === 0) {
      // CMDB-drift signal: the device exists in the monitoring tool but not in KANAP.
      notes.push(`No KANAP asset matches device "${deviceName}" by name, hostname or FQDN.`);
      return { assetMatch: 'unmatched', lookupsUsed: state.lookupsUsed, sources, notes };
    } else {
      // 2. Several exact-name survivors: the device IP is the only accepted tiebreak.
      if (hostIsIp) {
        const ipMatches: KanapResolvedEntity[] = [];
        for (const survivor of survivors) {
          const detail = await this.dispatchBounded(state, KANAP_ENTITY_DETAIL_CAPABILITY, {
            entity_type: 'assets',
            entity_id: survivor.id,
          }, 'Asset');
          if (detail.status !== 'ok') {
            continue;
          }
          if (detailIps(detail.output).includes(hostAddress)) {
            ipMatches.push(survivor);
          }
        }
        if (ipMatches.length === 1) {
          matched = ipMatches[0];
        }
      }
      if (!matched) {
        notes.push(`Several KANAP assets match device "${deviceName}" and no single IP confirmation was possible; no asset context was used.`);
        return { assetMatch: 'ambiguous', lookupsUsed: state.lookupsUsed, sources, notes };
      }
    }

    const resolution: KanapAlertContextResolution = {
      assetMatch: 'matched',
      asset: matched,
      lookupsUsed: state.lookupsUsed,
      sources,
      notes,
    };
    sources.push(toSourceRef(matched));

    // 3. Asset context → linked applications (owners/criticality live on the application).
    if (input.kanapData.domains.applications) {
      const assetContext = await this.dispatchBounded(state, KANAP_ENTITY_CONTEXT_CAPABILITY, {
        entity_type: 'assets',
        entity_id: matched.id,
      }, 'Asset context');
      const linkedApplication = assetContext.status === 'ok' ? firstLinkedApplication(assetContext.output) : null;
      if (linkedApplication) {
        const appDetail = await this.dispatchBounded(state, KANAP_ENTITY_DETAIL_CAPABILITY, {
          entity_type: 'applications',
          entity_id: linkedApplication.id,
        }, 'Application');
        const application = appDetail.status === 'ok' && isRecord(appDetail.output)
          ? parseEntitySummary('applications', appDetail.output.entity) ?? linkedApplication
          : linkedApplication;
        resolution.application = application;
        sources.push(toSourceRef(application));
        const owners = ownersFromApplicationMetadata(application.metadata);
        if (owners.length > 0) {
          resolution.owners = owners;
        }
      }
    }

    // 4. Interfaces/connections scoped to the matched application/asset.
    if (input.kanapData.domains.interfaces) {
      const q = resolution.application?.label ?? matched.label;
      const interfacesSearch = await this.dispatchBounded(state, KANAP_ENTITY_SEARCH_CAPABILITY, {
        entity_type: 'interfaces',
        q,
        limit: RELATED_ENTITY_LIMIT,
      }, 'Interface');
      if (interfacesSearch.status === 'ok') {
        const interfaces = parseSearchItems('interfaces', interfacesSearch.output).slice(0, RELATED_ENTITY_LIMIT);
        if (interfaces.length > 0) {
          resolution.relatedInterfaces = interfaces;
          for (const entry of interfaces) {
            sources.push(toSourceRef(entry));
          }
        }
      }
    }
    if (input.kanapData.domains.connections) {
      const connectionsSearch = await this.dispatchBounded(state, KANAP_ENTITY_SEARCH_CAPABILITY, {
        entity_type: 'connections',
        q: matched.label,
        limit: RELATED_ENTITY_LIMIT,
      }, 'Connection');
      if (connectionsSearch.status === 'ok') {
        const connections = parseSearchItems('connections', connectionsSearch.output).slice(0, RELATED_ENTITY_LIMIT);
        if (connections.length > 0) {
          resolution.relatedConnections = connections;
          for (const entry of connections) {
            sources.push(toSourceRef(entry));
          }
        }
      }
    }

    // 5. Location, from the asset summary's location name.
    if (input.kanapData.domains.locations) {
      const locationName = matched.metadata ? stringOrNull(matched.metadata.location) : null;
      if (locationName) {
        const locationSearch = await this.dispatchBounded(state, KANAP_ENTITY_SEARCH_CAPABILITY, {
          entity_type: 'locations',
          q: locationName,
          limit: LOCATION_CANDIDATE_LIMIT,
        }, 'Location');
        if (locationSearch.status === 'ok') {
          const locations = parseSearchItems('locations', locationSearch.output);
          const target = locationName.toLocaleLowerCase();
          const location = locations.find((entry) => entry.label.toLocaleLowerCase().includes(target))
            ?? (locations.length === 1 ? locations[0] : undefined);
          if (location) {
            resolution.location = location;
            sources.push(toSourceRef(location));
          }
        }
      }
    }

    resolution.lookupsUsed = state.lookupsUsed;
    return resolution;
  }

  private async dispatchBounded(
    state: DispatchState,
    capabilityName: string,
    capabilityInput: Record<string, unknown>,
    familyLabel: string,
  ): Promise<{ status: 'ok'; output: unknown } | { status: 'skipped' }> {
    if (state.lookupsUsed >= state.budget) {
      if (!state.budgetNoted) {
        state.notes.push(`Entity lookup budget reached (${state.budget}); remaining KANAP context lookups were skipped.`);
        state.budgetNoted = true;
      }
      return { status: 'skipped' };
    }
    state.lookupsUsed += 1;
    const outcome = await this.deps.dispatch(state.context, capabilityName, capabilityInput);
    // `=== false` (not `!outcome.ok`): the backend compiles without strictNullChecks,
    // where truthiness checks do not narrow discriminated unions.
    if (outcome.ok === false) {
      state.notes.push(outcome.errorKind === 'missing_permission'
        ? `${familyLabel} lookup unavailable (missing permission); skipped.`
        : `${familyLabel} lookup unavailable (${outcome.errorKind}); skipped.`);
      return { status: 'skipped' };
    }
    // The internal entity capabilities report a structured applicability result instead
    // of throwing when the entity read layer is not wired (see entityCapabilityUnavailable).
    if (isRecord(outcome.output) && outcome.output.available === false) {
      state.notes.push(`${familyLabel} lookup unavailable (not configured); skipped.`);
      return { status: 'skipped' };
    }
    return { status: 'ok', output: outcome.output };
  }
}
