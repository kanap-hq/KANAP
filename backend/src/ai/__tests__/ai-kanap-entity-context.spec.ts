import * as assert from 'node:assert/strict';
// These two moved to the definition module during the header split; import them from
// where they live rather than through the service.
import {
  normalizeKnowledgeSources,
  readAgentKnowledgeSources,
} from '../control-plane/agent-control/agent-control-definition.util';
import {
  KANAP_ENTITY_CONTEXT_CAPABILITY,
  KANAP_ENTITY_DETAIL_CAPABILITY,
  KANAP_ENTITY_SEARCH_CAPABILITY,
} from '../control-plane/capability/ai-capability.registry';
import {
  KanapDataPolicy,
  KanapEntityContextResolver,
  KanapEntityDispatch,
  KanapEntityDispatchOutcome,
  MAX_ENTITY_LOOKUPS_PER_RESOLUTION,
} from '../control-plane/agent-control/ai-kanap-entity-context.service';

const context = {} as any;

function policy(overrides: Partial<KanapDataPolicy['domains']> = {}, enabled = true): KanapDataPolicy {
  return {
    enabled,
    domains: {
      applications: true,
      assets: true,
      interfaces: true,
      connections: true,
      locations: true,
      ...overrides,
    },
  };
}

type DispatchCall = { capabilityName: string; input: Record<string, unknown> };

function makeDispatch(
  handler: (capabilityName: string, input: Record<string, unknown>) => KanapEntityDispatchOutcome,
): { calls: DispatchCall[]; dispatch: KanapEntityDispatch } {
  const calls: DispatchCall[] = [];
  const dispatch: KanapEntityDispatch = async (_context, capabilityName, input) => {
    calls.push({ capabilityName, input });
    return handler(capabilityName, input);
  };
  return { calls, dispatch };
}

function assetItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    ref: 'AST-7',
    label: 'WEB-SRV-01',
    status: 'active',
    summary: null,
    metadata: { hostname: 'web-srv-01', fqdn: 'web01.corp.local', location: 'PAR-DC1' },
    ...overrides,
  };
}

function applicationItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bbbbbbbb-0000-4000-8000-000000000002',
    ref: 'APP-12',
    label: 'Webshop',
    status: 'active',
    summary: 'Customer webshop',
    metadata: { criticality: 'high', business_owner: 'Ada Lovelace', it_owner: 'Grace Hopper' },
    ...overrides,
  };
}

function searchOutput(items: Array<Record<string, unknown>>): Record<string, unknown> {
  return { items, total: items.length, returned: items.length, truncated: false, complete: true };
}

// Canned happy-path handler: one exact asset match, one linked application, one
// interface/connection/location each.
function happyPathHandler(capabilityName: string, input: Record<string, unknown>): KanapEntityDispatchOutcome {
  if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY) {
    switch (input.entity_type) {
      case 'assets':
        return { ok: true, output: searchOutput([assetItem()]) };
      case 'interfaces':
        return {
          ok: true,
          output: searchOutput([{ id: 'cccccccc-0000-4000-8000-000000000003', ref: 'INT-3', label: 'INT-3 - Webshop to ERP', status: 'active', summary: null, metadata: {} }]),
        };
      case 'connections':
        return {
          ok: true,
          output: searchOutput([{ id: 'dddddddd-0000-4000-8000-000000000004', ref: 'CON-9', label: 'CON-9 - Webshop frontend', status: 'active', summary: null, metadata: {} }]),
        };
      case 'locations':
        return {
          ok: true,
          output: searchOutput([{ id: 'eeeeeeee-0000-4000-8000-000000000005', ref: 'LOC-1', label: 'PAR-DC1 — Paris DC 1', status: null, summary: null, metadata: {} }]),
        };
      default:
        return { ok: false, errorKind: 'error', message: `unexpected search ${String(input.entity_type)}` };
    }
  }
  if (capabilityName === KANAP_ENTITY_CONTEXT_CAPABILITY) {
    return {
      ok: true,
      output: {
        entity: assetItem(),
        related: [
          { relation: 'linked_applications', label: 'Applications', items: [applicationItem()] },
        ],
        knowledge: null,
      },
    };
  }
  if (capabilityName === KANAP_ENTITY_DETAIL_CAPABILITY && input.entity_type === 'applications') {
    return { ok: true, output: { entity: applicationItem(), data: { name: 'Webshop' } } };
  }
  if (capabilityName === KANAP_ENTITY_DETAIL_CAPABILITY && input.entity_type === 'assets') {
    return { ok: true, output: { entity: assetItem(), data: { ip_addresses: ['10.0.0.5'] } } };
  }
  return { ok: false, errorKind: 'error', message: `unexpected capability ${capabilityName}` };
}

async function testDisabledKanapDataDispatchesNothing() {
  const { calls, dispatch } = makeDispatch(happyPathHandler);
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01' },
    kanapData: policy({}, false),
  });
  assert.equal(resolution.assetMatch, 'disabled');
  assert.equal(resolution.lookupsUsed, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(resolution.sources, []);
  assert.equal(resolution.notes.length, 1);
}

async function testAssetsDomainOffDispatchesNothing() {
  const { calls, dispatch } = makeDispatch(happyPathHandler);
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01' },
    kanapData: policy({ assets: false }),
  });
  assert.equal(resolution.assetMatch, 'disabled');
  assert.equal(calls.length, 0);
}

async function testPerDomainOffFamiliesNeverDispatched() {
  const { calls, dispatch } = makeDispatch(happyPathHandler);
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'web-srv-01' },
    kanapData: policy({ applications: false, interfaces: false, connections: false, locations: false }),
  });
  assert.equal(resolution.assetMatch, 'matched');
  assert.equal(resolution.application, undefined);
  assert.equal(resolution.relatedInterfaces, undefined);
  assert.equal(resolution.relatedConnections, undefined);
  assert.equal(resolution.location, undefined);
  // Only the asset search may run: no context lookup, no applications detail, no
  // interfaces/connections/locations searches.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].capabilityName, KANAP_ENTITY_SEARCH_CAPABILITY);
  assert.equal(calls[0].input.entity_type, 'assets');
}

async function testCaseInsensitiveNameAndFqdnMatching() {
  // Match on name, different case.
  {
    const { dispatch } = makeDispatch(happyPathHandler);
    const resolver = new KanapEntityContextResolver({ dispatch });
    const resolution = await resolver.resolveAlertContext({
      context,
      alert: { deviceName: 'web-SRV-01' },
      kanapData: policy(),
    });
    assert.equal(resolution.assetMatch, 'matched');
    assert.equal(resolution.asset?.ref, 'AST-7');
  }
  // Match on FQDN, different case, via the device DNS host address.
  {
    const { dispatch } = makeDispatch(happyPathHandler);
    const resolver = new KanapEntityContextResolver({ dispatch });
    const resolution = await resolver.resolveAlertContext({
      context,
      alert: { deviceName: 'WEB01.CORP.LOCAL' },
      kanapData: policy(),
    });
    assert.equal(resolution.assetMatch, 'matched');
  }
  // DNS host address joins the exact-match set even when deviceName differs.
  {
    const { dispatch } = makeDispatch(happyPathHandler);
    const resolver = new KanapEntityContextResolver({ dispatch });
    const resolution = await resolver.resolveAlertContext({
      context,
      alert: { deviceName: 'Some display name', hostAddress: 'Web01.Corp.Local' },
      kanapData: policy(),
    });
    assert.equal(resolution.assetMatch, 'matched');
  }
  // No fuzzy matching: substring must not match.
  {
    const { dispatch } = makeDispatch(happyPathHandler);
    const resolver = new KanapEntityContextResolver({ dispatch });
    const resolution = await resolver.resolveAlertContext({
      context,
      alert: { deviceName: 'WEB-SRV' },
      kanapData: policy(),
    });
    assert.equal(resolution.assetMatch, 'unmatched');
  }
}

// Shortname <-> FQDN bridging (rule extension 2026-08-09): a monitoring tool
// reporting the device as an FQDN must match an asset stored under the bare
// shortname, and vice versa. The search query uses the first DNS label so the
// substring search can actually surface shortname-stored assets.
async function testShortnameFqdnBridging() {
  // FQDN-shaped device name vs asset stored as bare shortname.
  {
    const bare = assetItem({ label: 'acme-fr-dc1', metadata: {} });
    const { calls, dispatch } = makeDispatch((capabilityName, input) => {
      if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'assets') {
        return { ok: true, output: searchOutput([bare]) };
      }
      return happyPathHandler(capabilityName, input);
    });
    const resolver = new KanapEntityContextResolver({ dispatch });
    const resolution = await resolver.resolveAlertContext({
      context,
      alert: { deviceName: 'ACME-FR-DC1.acme-fr.example' },
      kanapData: policy({ applications: false, interfaces: false, connections: false, locations: false }),
    });
    assert.equal(resolution.assetMatch, 'matched');
    // The candidate search must run on the shortname, or a shortname-stored
    // asset would never appear in the substring results.
    const assetSearch = calls.find((call) => call.capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY);
    assert.equal(assetSearch?.input.q, 'ACME-FR-DC1');
  }
  // Shortname device vs asset identified only by its FQDN.
  {
    const fqdnOnly = assetItem({ label: 'Some display label', metadata: { fqdn: 'web01.corp.local' } });
    const { dispatch } = makeDispatch((capabilityName, input) => {
      if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'assets') {
        return { ok: true, output: searchOutput([fqdnOnly]) };
      }
      return happyPathHandler(capabilityName, input);
    });
    const resolver = new KanapEntityContextResolver({ dispatch });
    const resolution = await resolver.resolveAlertContext({
      context,
      alert: { deviceName: 'WEB01' },
      kanapData: policy({ applications: false, interfaces: false, connections: false, locations: false }),
    });
    assert.equal(resolution.assetMatch, 'matched');
  }
  // Still no fuzzy matching: a shortname that is only a PREFIX of the
  // candidate's shortname must not match.
  {
    const bare = assetItem({ label: 'acme-fr-dc1', metadata: {} });
    const { dispatch } = makeDispatch((capabilityName, input) => {
      if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'assets') {
        return { ok: true, output: searchOutput([bare]) };
      }
      return happyPathHandler(capabilityName, input);
    });
    const resolver = new KanapEntityContextResolver({ dispatch });
    const resolution = await resolver.resolveAlertContext({
      context,
      alert: { deviceName: 'ACME-FR.acme-fr.example' },
      kanapData: policy({ applications: false, interfaces: false, connections: false, locations: false }),
    });
    assert.equal(resolution.assetMatch, 'unmatched');
  }
}

async function testIpTiebreakResolvesAmbiguity() {
  const twin = assetItem({ id: 'aaaaaaaa-0000-4000-8000-000000000009', ref: 'AST-9' });
  const { calls, dispatch } = makeDispatch((capabilityName, input) => {
    if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'assets') {
      return { ok: true, output: searchOutput([assetItem(), twin]) };
    }
    if (capabilityName === KANAP_ENTITY_DETAIL_CAPABILITY && input.entity_type === 'assets') {
      const ips = input.entity_id === twin.id ? ['10.0.0.9'] : ['10.0.0.5'];
      return { ok: true, output: { entity: assetItem({ id: input.entity_id }), data: { ip_addresses: ips } } };
    }
    return happyPathHandler(capabilityName, input);
  });
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01', hostAddress: '10.0.0.9' },
    kanapData: policy(),
  });
  assert.equal(resolution.assetMatch, 'matched');
  assert.equal(resolution.asset?.ref, 'AST-9');
  // Search + two tiebreak details ran before the follow-ups.
  assert.equal(calls.filter((call) => call.capabilityName === KANAP_ENTITY_DETAIL_CAPABILITY && call.input.entity_type === 'assets').length, 2);
}

async function testAmbiguousWithoutIpTakesNothing() {
  const twin = assetItem({ id: 'aaaaaaaa-0000-4000-8000-000000000009', ref: 'AST-9' });
  const { calls, dispatch } = makeDispatch((capabilityName, input) => {
    if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'assets') {
      return { ok: true, output: searchOutput([assetItem(), twin]) };
    }
    return happyPathHandler(capabilityName, input);
  });
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01' },
    kanapData: policy(),
  });
  assert.equal(resolution.assetMatch, 'ambiguous');
  assert.equal(resolution.asset, undefined);
  assert.deepEqual(resolution.sources, []);
  assert.ok(resolution.notes.some((note) => note.includes('Several KANAP assets match')));
  // No tiebreak details without an IP, and no follow-up lookups after the bail-out.
  assert.equal(calls.length, 1);
}

async function testUnmatchedDeviceIsNoted() {
  const { dispatch } = makeDispatch((capabilityName, input) => {
    if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'assets') {
      return { ok: true, output: searchOutput([]) };
    }
    return happyPathHandler(capabilityName, input);
  });
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'GHOST-HOST' },
    kanapData: policy(),
  });
  assert.equal(resolution.assetMatch, 'unmatched');
  assert.deepEqual(resolution.sources, []);
  assert.ok(resolution.notes.some((note) => note.includes('No KANAP asset matches device "GHOST-HOST"')));
}

async function testBudgetCapStopsLookups() {
  // Ten identically named assets; the confirming IP belongs to the last candidate, which
  // the budget never reaches: 1 search + 7 tiebreak details = 8 dispatches, hard stop.
  const twins = Array.from({ length: 10 }, (_entry, index) => assetItem({
    id: `aaaaaaaa-0000-4000-8000-00000000001${index}`,
    ref: `AST-1${index}`,
  }));
  const { calls, dispatch } = makeDispatch((capabilityName, input) => {
    if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'assets') {
      return { ok: true, output: searchOutput(twins) };
    }
    if (capabilityName === KANAP_ENTITY_DETAIL_CAPABILITY && input.entity_type === 'assets') {
      const ips = input.entity_id === twins[9].id ? ['10.0.0.42'] : [];
      return { ok: true, output: { entity: assetItem({ id: input.entity_id }), data: { ip_addresses: ips } } };
    }
    return happyPathHandler(capabilityName, input);
  });
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01', hostAddress: '10.0.0.42' },
    kanapData: policy(),
  });
  assert.equal(resolution.assetMatch, 'ambiguous');
  assert.equal(resolution.lookupsUsed, MAX_ENTITY_LOOKUPS_PER_RESOLUTION);
  assert.equal(calls.length, MAX_ENTITY_LOOKUPS_PER_RESOLUTION);
  assert.ok(resolution.notes.some((note) => note.includes('Entity lookup budget reached (8)')));
}

async function testSmallerCallerBudgetIsHonored() {
  const { calls, dispatch } = makeDispatch(happyPathHandler);
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01' },
    kanapData: policy(),
    budget: 2,
  });
  assert.equal(resolution.assetMatch, 'matched');
  assert.equal(resolution.lookupsUsed, 2);
  assert.equal(calls.length, 2);
  assert.ok(resolution.notes.some((note) => note.includes('Entity lookup budget reached (2)')));
}

async function testPermissionDeniedDomainSkippedWithNote() {
  const { calls, dispatch } = makeDispatch((capabilityName, input) => {
    if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'connections') {
      return { ok: false, errorKind: 'missing_permission' };
    }
    return happyPathHandler(capabilityName, input);
  });
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01' },
    kanapData: policy(),
  });
  assert.equal(resolution.assetMatch, 'matched');
  assert.equal(resolution.relatedConnections, undefined);
  assert.ok(resolution.notes.some((note) => note.includes('Connection lookup unavailable (missing permission)')));
  // The denial does not abort later domains: the locations search still ran.
  assert.ok(calls.some((call) => call.capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && call.input.entity_type === 'locations'));
  assert.equal(resolution.location?.ref, 'LOC-1');
}

async function testUnavailableCapabilityResultSkippedWithNote() {
  const { dispatch } = makeDispatch((capabilityName, input) => {
    if (capabilityName === KANAP_ENTITY_SEARCH_CAPABILITY && input.entity_type === 'interfaces') {
      return { ok: true, output: { available: false, reasonCode: 'provider_not_configured' } };
    }
    return happyPathHandler(capabilityName, input);
  });
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01' },
    kanapData: policy(),
  });
  assert.equal(resolution.assetMatch, 'matched');
  assert.equal(resolution.relatedInterfaces, undefined);
  assert.ok(resolution.notes.some((note) => note.includes('Interface lookup unavailable (not configured)')));
}

async function testSourcesCarryDeepLinks() {
  const { dispatch } = makeDispatch(happyPathHandler);
  const resolver = new KanapEntityContextResolver({ dispatch });
  const resolution = await resolver.resolveAlertContext({
    context,
    alert: { deviceName: 'WEB-SRV-01' },
    kanapData: policy(),
  });
  assert.equal(resolution.assetMatch, 'matched');
  assert.deepEqual(resolution.owners, ['Ada Lovelace', 'Grace Hopper']);
  const byRef = new Map(resolution.sources.map((source) => [source.ref, source]));
  assert.equal(byRef.get('AST-7')?.url, '/it/assets/AST-7/overview');
  assert.equal(byRef.get('APP-12')?.url, '/it/applications/APP-12/overview');
  assert.equal(byRef.get('INT-3')?.url, '/it/interfaces/INT-3/overview');
  assert.equal(byRef.get('CON-9')?.url, '/it/connections/CON-9/overview');
  assert.equal(byRef.get('LOC-1')?.url, '/it/locations/LOC-1/overview');
  assert.ok(resolution.sources.every((source) => source.kind === 'entity'));
  // Full happy path stays within the hard budget: 6 lookups for all five domains.
  assert.equal(resolution.lookupsUsed, 6);
}

function testNormalizeKanapDataRoundTrip() {
  const normalized = normalizeKnowledgeSources({
    knowledge: { enabled: true, all_libraries: true, library_ids: [] },
    web: { enabled: false },
    kanap_data: {
      enabled: true,
      domains: { applications: false, assets: true, interfaces: true, connections: true, locations: true },
    },
  });
  assert.deepEqual(normalized.kanap_data, {
    enabled: true,
    domains: { applications: false, assets: true, interfaces: true, connections: true, locations: true },
  });
  const sources = readAgentKnowledgeSources({ scope_policy_json: { knowledge_sources: normalized } } as any);
  assert.equal(sources.kanapData.enabled, true);
  assert.equal(sources.kanapData.domains.applications, false);
  assert.equal(sources.kanapData.domains.assets, true);
  // Pre-existing fields stay byte-compatible.
  assert.equal(sources.knowledgeEnabled, true);
  assert.equal(sources.knowledgeLibraryIds, null);
  assert.equal(sources.webEnabled, false);
}

function testNormalizeDropsUnknownDomains() {
  const normalized = normalizeKnowledgeSources({
    kanap_data: { enabled: true, domains: { gadgets: true, assets: false } },
  });
  const kanapData = normalized.kanap_data as { enabled: boolean; domains: Record<string, boolean> };
  assert.equal(Object.prototype.hasOwnProperty.call(kanapData.domains, 'gadgets'), false);
  assert.equal(kanapData.domains.assets, false);
  // Missing domain keys inside an explicitly present block default to ON.
  assert.equal(kanapData.domains.applications, true);
}

function testAbsentKanapDataDefaultsDisabled() {
  const normalized = normalizeKnowledgeSources({ knowledge: { enabled: true }, web: { enabled: false } });
  const kanapData = normalized.kanap_data as { enabled: boolean; domains: Record<string, boolean> };
  assert.equal(kanapData.enabled, false);
  // Existing definitions without the block read as disabled (helpdesk-safety default).
  const sources = readAgentKnowledgeSources({
    scope_policy_json: {
      knowledge_sources: {
        knowledge: { enabled: true, all_libraries: true, library_ids: [] },
        web: { enabled: false },
        precedence: 'knowledge_first',
      },
    },
  } as any);
  assert.equal(sources.kanapData.enabled, false);
  assert.equal(sources.knowledgeEnabled, true);
  assert.equal(sources.webEnabled, false);
  // A definition with no scope policy at all also reads as disabled.
  assert.equal(readAgentKnowledgeSources(null).kanapData.enabled, false);
}

async function run() {
  await testDisabledKanapDataDispatchesNothing();
  await testAssetsDomainOffDispatchesNothing();
  await testPerDomainOffFamiliesNeverDispatched();
  await testCaseInsensitiveNameAndFqdnMatching();
  await testShortnameFqdnBridging();
  await testIpTiebreakResolvesAmbiguity();
  await testAmbiguousWithoutIpTakesNothing();
  await testUnmatchedDeviceIsNoted();
  await testBudgetCapStopsLookups();
  await testSmallerCallerBudgetIsHonored();
  await testPermissionDeniedDomainSkippedWithNote();
  await testUnavailableCapabilityResultSkippedWithNote();
  await testSourcesCarryDeepLinks();
  testNormalizeKanapDataRoundTrip();
  testNormalizeDropsUnknownDomains();
  testAbsentKanapDataDefaultsDisabled();
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
