// @database-spec
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import dataSource from '../../data-source';
import { withTenant } from '../../common/tenant-runner';
import { assert, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';
import { NVD_MAX_WINDOW_MS, NVD_PAGE_SIZE, NvdFeedService, type FeedRuntime } from '../nvd-feed.service';
import { VulnerabilityMatchService } from '../vulnerability-match.service';
import { Features } from '../../config/features';

// The NVD feed (lot T6a) against a fake NVD served on 127.0.0.1, never the real one: pagination,
// first pass then incremental windows, a failure retried then resumed at the next run, the cadence
// between requests, windows of at most 120 days, and the matching that follows a run. The cache
// rows are committed (the feed writes in its own transactions): they use the CVE-2098-* ids and the
// `a:kanapspec:*` products, deleted before and after.

const ALPHA = 'a:kanapspec:alpha';
const BETA = 'a:kanapspec:beta';
const DAY = 24 * 60 * 60 * 1000;

type Seen = { product: string; start: number; end: number; startIndex: number; perPage: string | null; apiKey: string | undefined };
type Handler = (seen: Seen) => { status: number; body?: unknown; delayMs?: number };

let handler: Handler = () => ({ status: 200, body: { totalResults: 0, vulnerabilities: [] } });
const seen: Seen[] = [];

function cveItem(id: string, product: string | null, end = '2.0') {
  return {
    cve: {
      id,
      published: '2026-09-01T00:00:00.000',
      lastModified: '2026-10-01T00:00:00.000',
      vulnStatus: product ? 'Analyzed' : 'Awaiting Analysis',
      descriptions: [{ lang: 'en', value: `Flaw ${id}` }],
      metrics: { cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: 9.1, baseSeverity: 'CRITICAL' } }] },
      references: [{ url: `https://example.com/${id}` }],
      configurations: product
        ? [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: `cpe:2.3:${product}:*:*:*:*:*:*:*:*`, versionEndExcluding: end }] }] }]
        : [],
    },
  };
}

async function serve() {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const match = /^cpe:2\.3:(.+?):\*:\*:\*:\*:\*:\*:\*:\*$/.exec(url.searchParams.get('virtualMatchString') ?? '');
    const entry: Seen = {
      product: match?.[1] ?? '',
      start: Date.parse(url.searchParams.get('lastModStartDate') ?? ''),
      end: Date.parse(url.searchParams.get('lastModEndDate') ?? ''),
      startIndex: Number(url.searchParams.get('startIndex')),
      perPage: url.searchParams.get('resultsPerPage'),
      apiKey: req.headers.apikey as string | undefined,
    };
    seen.push(entry);
    const answer = handler(entry);
    setTimeout(() => {
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer.body ?? { message: 'unavailable' }));
    }, answer.delayMs ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/rest/json/cves/2.0` };
}

class SpecFeed extends NvdFeedService {
  products = [ALPHA, BETA];
  async followedProducts() { return this.products; }
}

function feed(products = [ALPHA, BETA]) {
  const service = new SpecFeed(dataSource, { register: () => false } as any, new VulnerabilityMatchService(), { claim: async () => [], send: async () => undefined } as any);
  service.products = products;
  return service;
}

let baseUrl = '';
let clock = Date.parse('2026-10-16T00:00:00.000Z');
const sleeps: number[] = [];
function runtime(apiKey: string | null = 'spec-key'): FeedRuntime {
  return {
    baseUrl, apiKey, fetch: (input, init) => fetch(input, init),
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
    spacingMs: apiKey ? 600 : 6000,
    retryDelayMs: 30_000,
  };
}
function reset() { seen.length = 0; sleeps.length = 0; }

async function cleanup() {
  await dataSource.query(`DELETE FROM vulnerability_cves WHERE cve_id LIKE 'CVE-2098-%'`);
  await dataSource.query(`DELETE FROM vulnerability_feed_products WHERE product LIKE 'a:kanapspec:%'`);
}
async function lastSuccess(product: string): Promise<{ last_success_at: Date | null; last_error: string | null } | undefined> {
  return (await dataSource.query(`SELECT last_success_at, last_error FROM vulnerability_feed_products WHERE product = $1`, [product]))[0];
}

async function testFirstPassPagination() {
  reset();
  handler = (s) => {
    if (s.product !== ALPHA) return { status: 200, body: { totalResults: 0, vulnerabilities: [] } };
    return s.startIndex === 0
      ? { status: 200, body: { totalResults: 3, vulnerabilities: [cveItem('CVE-2098-20001', ALPHA), cveItem('CVE-2098-20002', null)] } }
      : { status: 200, body: { totalResults: 3, vulnerabilities: [cveItem('CVE-2098-20003', ALPHA)] } };
  };
  const startedAt = clock;
  const summary = await feed().collect(runtime());
  assert.equal(summary.requests, 3, 'two pages for alpha, one for beta');
  assert.deepEqual(seen.map((s) => [s.product, s.startIndex]), [[ALPHA, 0], [ALPHA, 2], [BETA, 0]]);
  assert.equal(NVD_PAGE_SIZE, 500);
  assert.ok(seen.every((s) => s.perPage === '500'), 'every page asks for 500 CVE');
  assert.equal(seen[0].apiKey, 'spec-key', 'the key goes in the apiKey header');
  assert.ok(Number.isNaN(seen[0].start) && Number.isNaN(seen[0].end), 'first pass: every CVE of the product, no dates');
  assert.ok(NVD_MAX_WINDOW_MS <= 120 * DAY);
  assert.deepEqual(sleeps, [600, 600], 'one request per 0.6 s with a key');
  assert.equal(summary.cves, 3);
  const matches = await dataSource.query(
    `SELECT c.cve_id, count(m.id)::int AS n FROM vulnerability_cves c LEFT JOIN vulnerability_cve_matches m ON m.cve_id = c.cve_id
      WHERE c.cve_id LIKE 'CVE-2098-2000%' GROUP BY c.cve_id ORDER BY c.cve_id`,
  );
  assert.deepEqual(matches.map((m: any) => [m.cve_id, m.n]), [['CVE-2098-20001', 1], ['CVE-2098-20002', 0], ['CVE-2098-20003', 1]],
    'a CVE without configuration is kept, with no criterion');
  assert.equal(new Date((await lastSuccess(ALPHA))!.last_success_at!).getTime(), startedAt, 'the last success is the start of the pass');
}

async function testIncremental() {
  reset();
  const previous = new Date((await lastSuccess(ALPHA))!.last_success_at!).getTime();
  clock += DAY;
  handler = (s) => ({ status: 200, body: { totalResults: s.product === ALPHA ? 1 : 0, vulnerabilities: s.product === ALPHA ? [cveItem('CVE-2098-20002', ALPHA)] : [] } });
  await feed().collect(runtime(null));
  assert.equal(seen[0].start, previous - 60 * 60 * 1000, 'from the last success, an hour of overlap');
  assert.equal(seen[0].end, clock - 6000, 'up to now');
  assert.deepEqual(sleeps, [6000], 'one request per 6 s without a key');
  const [{ n }] = await dataSource.query(`SELECT count(*)::int AS n FROM vulnerability_cve_matches WHERE cve_id = 'CVE-2098-20002'`);
  assert.equal(n, 1, 'the analysed CVE now carries its criterion');
}

async function testErrorAndResume() {
  reset();
  const before = await lastSuccess(ALPHA);
  clock += DAY;
  handler = (s) => (s.product === ALPHA ? { status: 503 } : { status: 200, body: { totalResults: 0, vulnerabilities: [] } });
  const failed = await feed().collect(runtime());
  assert.deepEqual(failed.failed_products, [ALPHA]);
  assert.equal(seen.filter((s) => s.product === ALPHA).length, 3, 'three attempts');
  assert.ok(sleeps.includes(30_000) && sleeps.includes(60_000), 'retries wait 30 s, then 60 s');
  const after = await lastSuccess(ALPHA);
  assert.equal(new Date(after!.last_success_at!).getTime(), new Date(before!.last_success_at!).getTime(), 'the last success does not move');
  assert.match(after!.last_error ?? '', /HTTP 503/);

  // One refusal, then the NVD answers: the run resumes from the last success.
  reset();
  let refused = false;
  handler = (s) => {
    if (s.product === ALPHA && !refused) { refused = true; return { status: 429 }; }
    return { status: 200, body: { totalResults: 0, vulnerabilities: [] } };
  };
  const resumed = await feed().collect(runtime());
  assert.deepEqual(resumed.failed_products, []);
  assert.equal(seen.find((x) => x.product === ALPHA)!.start, new Date(before!.last_success_at!).getTime() - 60 * 60 * 1000, 'resumes from the last success');
  assert.equal((await lastSuccess(ALPHA))!.last_error, null);
}

async function testNvdDown() {
  reset();
  const gamma = 'a:kanapspec:gamma';
  handler = () => ({ status: 503 });
  const summary = await feed([ALPHA, BETA, gamma]).collect(runtime());
  assert.equal(seen[0].product, gamma, 'a product never tried goes first');
  assert.equal(seen.length, 6, 'three attempts for each of two products');
  assert.equal(new Set(seen.map((x) => x.product)).size, 2, 'the third product is not asked');
  assert.deepEqual([...summary.failed_products].sort(), [ALPHA, BETA, gamma].sort());
  assert.match(summary.errors.join(' | '), /Stopped after two products failed in a row: 1 product/);

  // The product left aside goes first at the next run.
  const asked = new Set(seen.map((x) => x.product));
  const leftAside = [ALPHA, BETA, gamma].find((p) => !asked.has(p));
  reset();
  handler = () => ({ status: 200, body: { totalResults: 0, vulnerabilities: [] } });
  await feed([ALPHA, BETA, gamma]).collect(runtime());
  assert.equal(seen[0].product, leftAside);
}

async function testProductErrorsDoNotStop() {
  reset();
  const [bad1, bad2, good] = ['a:kanapspec:bad1', 'a:kanapspec:bad2', 'a:kanapspec:good'];
  handler = (x) => (x.product === good ? { status: 200, body: { totalResults: 0, vulnerabilities: [] } } : { status: 404 });
  const summary = await feed([bad1, bad2, good]).collect(runtime());
  assert.deepEqual(seen.map((x) => x.product), [bad1, bad2, good], 'a 404 is not retried and does not stop the run');
  assert.deepEqual(summary.failed_products, [bad1, bad2]);
  assert.ok((await lastSuccess(good))?.last_success_at, 'the healthy product is collected');
  assert.match((await lastSuccess(bad1))?.last_error ?? '', /HTTP 404/);
}

async function testLongGap() {
  reset();
  await dataSource.query(`UPDATE vulnerability_feed_products SET last_success_at = $2 WHERE product = $1`, [ALPHA, new Date(clock - 200 * DAY)]);
  handler = () => ({ status: 200, body: { totalResults: 0, vulnerabilities: [] } });
  await feed().collect(runtime());
  const alpha = seen.filter((s) => s.product === ALPHA);
  assert.equal(alpha.length, 2, 'two windows for 200 days');
  assert.ok(alpha.every((s) => s.end - s.start <= NVD_MAX_WINDOW_MS));
  assert.equal(alpha[1].start, alpha[0].end, 'contiguous windows');
}

async function testRunMatchesTenants() {
  reset();
  const [tenant] = await dataSource.query(
    `INSERT INTO tenants (slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ('nvd-feed-spec-' || substr(md5(random()::text), 1, 8), 'NVD feed spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())
     RETURNING id`,
  );
  try {
    const technologyId = await withTenant(dataSource, tenant.id, async (mg) => {
      const [tech] = await mg.query(`INSERT INTO technologies (tenant_id, item_number, name, cpe_products) VALUES ($1, 1, 'Alpha', ARRAY[$2]) RETURNING id`, [tenant.id, ALPHA]);
      const versions = await mg.query(
        `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '1.4'), ($1, $2, '2.1') RETURNING id`, [tenant.id, tech.id],
      );
      const [server] = await mg.query(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Alpha server', 'vm', 'prod') RETURNING id`, [tenant.id]);
      for (const v of versions) {
        await mg.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`, [tenant.id, server.id, tech.id, v.id]);
      }
      return tech.id as string;
    });
    clock += DAY;
    handler = (s) => ({ status: 200, body: { totalResults: s.product === ALPHA ? 1 : 0, vulnerabilities: s.product === ALPHA ? [cveItem('CVE-2098-20009', ALPHA, '2.0')] : [] } });
    const summary = await feed().run(runtime());
    assert.ok(summary.tenants_matched >= 1);
    const rows = await withTenant(dataSource, tenant.id, (mg) => mg.query(
      `SELECT v.label, tv.state FROM technology_vulnerabilities tv JOIN technology_versions v ON v.id = tv.technology_version_id
        WHERE tv.tenant_id = $1 AND tv.technology_id = $2 AND tv.cve_id = 'CVE-2098-20009'`,
      [tenant.id, technologyId],
    ));
    assert.deepEqual(rows, [{ label: '1.4', state: 'to_review' }], 'the run matches after collecting: 1.4 is below 2.0, 2.1 is not');
  } finally {
    await withTenant(dataSource, tenant.id, async (mg) => {
      await mg.query(`DELETE FROM technologies WHERE tenant_id = $1`, [tenant.id]);
      await mg.query(`DELETE FROM assets WHERE tenant_id = $1`, [tenant.id]);
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
}

/**
 * Collection on demand (lot T6b): a product new to the feed is collected once, right away, even
 * asked twice at the same time; a collected product is not asked again; nothing while the feed is off.
 */
async function testOnDemand() {
  reset();
  const GAMMA = 'a:kanapspec:ondemand1';
  const DELTA = 'a:kanapspec:ondemand2';
  handler = (s) => ({ status: 200, body: { totalResults: 1, vulnerabilities: [cveItem(s.product === GAMMA ? 'CVE-2098-60001' : 'CVE-2098-60002', s.product)] } });
  const saved = Features.VULNERABILITY_FEED_ENABLED;
  const tenantId = '00000000-0000-4000-8000-00000000d06e';
  try {
    (Features as any).VULNERABILITY_FEED_ENABLED = false;
    await feed([]).collectNew(tenantId, [GAMMA], runtime());
    assert.equal(seen.length, 0, 'feed off: nothing is asked');
    (Features as any).VULNERABILITY_FEED_ENABLED = true;
    const service = feed([]);
    assert.deepEqual(await service.neverCollected([GAMMA.toUpperCase(), DELTA]), [GAMMA, DELTA], 'never collected yet');
    await service.collectNew(tenantId, [GAMMA], runtime());
    assert.deepEqual(seen.map((s) => s.product), [GAMMA], 'the new product, once, at once');
    assert.ok((await lastSuccess(GAMMA))?.last_success_at, 'collected');
    await service.collectNew(tenantId, [GAMMA], runtime());
    assert.equal(seen.length, 1, 'a collected product is not asked again');
    // Two requests at once, from two services of the process or one: one collection.
    await Promise.all([service.collectNew(tenantId, [DELTA], runtime()), service.collectNew(tenantId, [DELTA], runtime()), feed([]).collectNew(tenantId, [DELTA], runtime())]);
    assert.deepEqual(seen.map((s) => s.product), [GAMMA, DELTA], 'one collection for simultaneous requests');
    assert.deepEqual(await service.neverCollected([GAMMA, DELTA]), []);
  } finally {
    (Features as any).VULNERABILITY_FEED_ENABLED = saved;
  }
}

/**
 * A technology gains three products the feed never collected (what `drain` asks of `collectNew`
 * after the catalog sync's `TechnologyCpeEvents`). Once the queue is idle, its rows cover the CVE
 * of the three products. A second workspace that carries the same products, queued behind the
 * first, is matched too, and so is one that asks after the collection has finished. No email is
 * prepared: the technology was already matched on another product, and a product just added stays
 * a silent baseline.
 */
async function testRematchAfterFirstCollection() {
  reset();
  const OLD = 'a:kanapspec:fresh0';
  const PRODUCTS = ['a:kanapspec:fresh1', 'a:kanapspec:fresh2', 'a:kanapspec:fresh3'];
  const CVE: Record<string, string> = {
    [PRODUCTS[0]]: 'CVE-2098-71001',
    [PRODUCTS[1]]: 'CVE-2098-71002',
    [PRODUCTS[2]]: 'CVE-2098-71003',
  };
  const OLD_CVE = 'CVE-2098-70001';
  handler = (s) => {
    const id = CVE[s.product];
    return id
      ? { status: 200, body: { totalResults: 1, vulnerabilities: [cveItem(id, s.product, '2.0')] } }
      : { status: 200, body: { totalResults: 0, vulnerabilities: [] } };
  };
  const calls = { claim: 0, send: 0 };
  const notifier = {
    claim: async () => { calls.claim += 1; return []; },
    send: async () => { calls.send += 1; },
  };
  const service = new NvdFeedService(dataSource, { register: () => false } as any, new VulnerabilityMatchService(), notifier as any);
  const saved = Features.VULNERABILITY_FEED_ENABLED;
  const tenants: string[] = [];
  const insertTenant = async (tag: string, products: string[]) => {
    const [tenant] = await dataSource.query(
      `INSERT INTO tenants (slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ('nvd-fresh-' || $1 || '-' || substr(md5(random()::text), 1, 8), 'Fresh collection', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())
       RETURNING id`,
      [tag],
    );
    tenants.push(tenant.id);
    const technologyId = await withTenant(dataSource, tenant.id, async (mg) => {
      const [tech] = await mg.query(
        `INSERT INTO technologies (tenant_id, item_number, name, cpe_products) VALUES ($1, 1, $2, $3::text[]) RETURNING id`,
        [tenant.id, tag, products],
      );
      const [version] = await mg.query(
        `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '1.4') RETURNING id`,
        [tenant.id, tech.id],
      );
      const [server] = await mg.query(
        `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'vm', 'prod') RETURNING id`,
        [tenant.id, `${tag} server`],
      );
      await mg.query(
        `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`,
        [tenant.id, server.id, tech.id, version.id],
      );
      return { technologyId: tech.id as string, versionId: version.id as string };
    });
    return { tenantId: tenant.id as string, ...technologyId };
  };
  const cveIds = async (tenantId: string, technologyId: string) => withTenant(dataSource, tenantId, (mg) => mg.query(
    `SELECT cve_id FROM technology_vulnerabilities WHERE tenant_id = $1 AND technology_id = $2 ORDER BY cve_id`,
    [tenantId, technologyId],
  )) as Promise<Array<{ cve_id: string }>>;
  try {
    (Features as any).VULNERABILITY_FEED_ENABLED = true;
    await dataSource.query(
      `INSERT INTO vulnerability_cves (cve_id, summary, cvss_score, severity, cvss_version, published_at, nvd_status)
       VALUES ($1, 'Already matched', 9.1, 'critical', '3.1', now(), 'Analyzed')`,
      [OLD_CVE],
    );
    await dataSource.query(
      `INSERT INTO vulnerability_cve_matches (cve_id, product, criteria, version_end, end_including, vulnerable)
       VALUES ($1, $2, 'cpe:2.3:' || $2 || ':*', '2.0', false, true)`,
      [OLD_CVE, OLD],
    );
    await dataSource.query(
      `INSERT INTO vulnerability_feed_products (product, last_success_at) VALUES ($1, now()) ON CONFLICT (product) DO UPDATE SET last_success_at = now()`,
      [OLD],
    );
    const first = await insertTenant('alpha', [OLD, ...PRODUCTS]);
    await withTenant(dataSource, first.tenantId, (mg) => mg.query(
      `INSERT INTO technology_vulnerabilities (tenant_id, technology_id, technology_version_id, cve_id, match_basis)
       VALUES ($1, $2, $3, $4, 'version_in_range')`,
      [first.tenantId, first.technologyId, first.versionId, OLD_CVE],
    ));
    const second = await insertTenant('beta', PRODUCTS);
    // Queued together, as the catalog sync does: one workspace per technology, before any page returns.
    await Promise.all([
      service.collectNew(first.tenantId, PRODUCTS, runtime()),
      service.collectNew(second.tenantId, PRODUCTS, runtime()),
    ]);
    assert.deepEqual(seen.map((s) => s.product), PRODUCTS, 'the three products, once');
    assert.deepEqual((await cveIds(first.tenantId, first.technologyId)).map((r) => r.cve_id), [OLD_CVE, ...Object.values(CVE)].sort(),
      'the technology already matched keeps its row and gains the CVE of the three products');
    assert.deepEqual((await cveIds(second.tenantId, second.technologyId)).map((r) => r.cve_id), Object.values(CVE).sort(),
      'the other workspace that carries the products is matched too');
    assert.deepEqual(calls, { claim: 0, send: 0 }, 'no email is prepared');

    const third = await insertTenant('gamma', [PRODUCTS[0]]);
    await service.collectNew(third.tenantId, [PRODUCTS[0]], runtime());
    assert.deepEqual(seen.map((s) => s.product), PRODUCTS, 'a product already collected is not asked again');
    assert.deepEqual((await cveIds(third.tenantId, third.technologyId)).map((r) => r.cve_id), [CVE[PRODUCTS[0]]],
      'a workspace that asks after the collection is matched');
    assert.deepEqual(calls, { claim: 0, send: 0 }, 'still no email');
  } finally {
    (Features as any).VULNERABILITY_FEED_ENABLED = saved;
    for (const tenantId of tenants) {
      await withTenant(dataSource, tenantId, async (mg) => {
        await mg.query(`DELETE FROM technologies WHERE tenant_id = $1`, [tenantId]);
        await mg.query(`DELETE FROM assets WHERE tenant_id = $1`, [tenantId]);
      });
      await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
  }
}

/** The review's P8: a second tenant that asks for the same new product, collected by the first request, is matched too. */
async function testSecondTenantMatched() {
  reset();
  const EPSILON = 'a:kanapspec:ondemand3';
  handler = (s) => ({ status: 200, body: { totalResults: 1, vulnerabilities: [cveItem('CVE-2098-60003', s.product)] } });
  const saved = Features.VULNERABILITY_FEED_ENABLED;
  const matched: string[] = [];
  const matcher = { matchTenant: async (_mg: unknown, tenantId: string) => { matched.push(tenantId); return { addedIds: [] }; } };
  const instance = () => new SpecFeed(dataSource, { register: () => false } as any, matcher as any, { claim: async () => [], send: async () => undefined } as any);
  try {
    (Features as any).VULNERABILITY_FEED_ENABLED = true;
    const A = '00000000-0000-4000-8000-0000000000a1';
    const B = '00000000-0000-4000-8000-0000000000b2';
    await Promise.all([instance().collectNew(A, [EPSILON], runtime()), instance().collectNew(B, [EPSILON], runtime())]);
    assert.equal(seen.filter((s) => s.product === EPSILON).length, 1, 'collected once');
    assert.deepEqual(matched.sort(), [A, B], 'both tenants matched');
  } finally {
    (Features as any).VULNERABILITY_FEED_ENABLED = saved;
  }
}

/**
 * The review's P6: a collection on demand never holds the scheduled task's lock (a run is never
 * skipped), stops at the first failure of the service, and a tenant's quota leaves the rest to the run.
 */
async function testOnDemandLimits() {
  reset();
  const SLOW = 'a:kanapspec:ondemand4';
  const DOWN = 'a:kanapspec:ondemand5';
  const AFTER = 'a:kanapspec:ondemand6';
  const Q = ['a:kanapspec:ondemand7', 'a:kanapspec:ondemand8', 'a:kanapspec:ondemand9'];
  handler = (s) => (s.product === DOWN
    ? { status: 503 }
    : { status: 200, body: { totalResults: 0, vulnerabilities: [] }, delayMs: s.product === SLOW ? 400 : 0 });
  const saved = Features.VULNERABILITY_FEED_ENABLED;
  const tenantId = '00000000-0000-4000-8000-00000000d07e';
  try {
    (Features as any).VULNERABILITY_FEED_ENABLED = true;
    const service = feed([]);
    const pending = service.collectNew(tenantId, [SLOW], runtime());
    await new Promise((r) => setTimeout(r, 150));
    const probe = dataSource.createQueryRunner();
    await probe.connect();
    let locked = false;
    try {
      [{ locked }] = await probe.query(`SELECT pg_try_advisory_lock(hashtext('vulnerability-feed')) AS locked`);
      if (locked) await probe.query(`SELECT pg_advisory_unlock(hashtext('vulnerability-feed'))`);
    } finally {
      await probe.release();
    }
    assert.equal(locked, true, 'the scheduled task\'s lock stays free during a collection on demand');
    await pending;
    assert.ok((await lastSuccess(SLOW))?.last_success_at);

    reset();
    await service.collectNew(tenantId, [DOWN, AFTER], runtime());
    assert.deepEqual(seen.map((s) => s.product), [DOWN], 'one try, then the service is down: the rest waits for the run');
    assert.match(String((await lastSuccess(DOWN))?.last_error), /503/);
    assert.deepEqual(await service.neverCollected([AFTER]), [AFTER]);

    reset();
    const quota = feed([]);
    quota.onDemandPerHour = 2;
    await quota.collectNew(tenantId, Q, runtime());
    assert.deepEqual(seen.map((s) => s.product), Q.slice(0, 2), 'two products an hour for this tenant');
    await quota.collectNew(tenantId, [Q[2]], runtime());
    assert.equal(seen.length, 2, 'the quota is spent: the run collects the third');
    await quota.collectNew('00000000-0000-4000-8000-00000000d07f', [Q[2]], runtime());
    assert.equal(seen.length, 3, 'another tenant has its own quota');
  } finally {
    (Features as any).VULNERABILITY_FEED_ENABLED = saved;
  }
}

async function main() {
  const fake = await serve();
  baseUrl = fake.baseUrl;
  try {
    await runSpecs('nvd feed', [
      ['clean start', cleanup],
      ['first pass, pagination, cadence', testFirstPassPagination],
      ['incremental', testIncremental],
      ['error and resume', testErrorAndResume],
      ['NVD down: the run stops early', testNvdDown],
      ['product errors do not stop the run', testProductErrorsDoNotStop],
      ['windows of at most 120 days', testLongGap],
      ['matching after a run', testRunMatchesTenants],
      ['collection on demand', testOnDemand],
      ['rematch after the first collection of new products', testRematchAfterFirstCollection],
      ['a second tenant asking for the same product is matched', testSecondTenantMatched],
      ['collection on demand: lock, circuit and quota', testOnDemandLimits],
      ['clean end', cleanup],
    ]);
  } finally {
    fake.server.close();
  }
}

void main();
