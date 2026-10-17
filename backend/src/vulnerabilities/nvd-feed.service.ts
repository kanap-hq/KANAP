import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { NeverRejects } from '../common/never-rejects';
import { TechnologyCpeEvents, type CpeProductsAdded } from '../technologies/technology-cpe-events';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { withTenant } from '../common/tenant-runner';
import { Features } from '../config/features';
import { VulnerabilityMatchService, type MatchResult } from './vulnerability-match.service';
import { VulnerabilityNotificationsService } from './vulnerability-notifications.service';
import { resolveConfiguredAppBaseUrl } from '../common/url';
import { cpeProduct } from './vulnerability-rules';

export const NVD_FEED_TASK_NAME = 'vulnerability-feed';
export const NVD_DEFAULT_BASE_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The NVD refuses a date range over 120 consecutive days: one minute of margin. */
export const NVD_MAX_WINDOW_MS = 120 * DAY_MS - 60_000;
/** An incremental window starts this much before the last success: a CVE indexed late is not missed. */
const OVERLAP_MS = 60 * 60 * 1000;
/** NVD maximum and recommended page size. */
const PAGE_SIZE = 2000;
/** Rolling 30 s window: 5 requests without a key, 50 with one (NVD "Rate Limits"). */
const RATE_WINDOW_MS = 30_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000;

export type ParsedCve = {
  cve_id: string;
  summary: string | null;
  cvss_score: number | null;
  severity: string | null;
  cvss_version: string | null;
  cvss_vector: string | null;
  published_at: string | null;
  last_modified_at: string | null;
  nvd_status: string | null;
  reference_urls: string[];
  matches: Array<{
    product: string;
    criteria: string;
    version_exact: string | null;
    version_start: string | null;
    start_including: boolean | null;
    version_end: string | null;
    end_including: boolean | null;
    vulnerable: boolean;
  }>;
};

/** The first metric of the first family present, primary source first (`Primary` before `Secondary`). */
function pickMetric(metrics: any): { version: string; score: number | null; severity: string | null; vector: string | null } | null {
  const families: Array<[string, string]> = [['cvssMetricV31', '3.1'], ['cvssMetricV30', '3.0'], ['cvssMetricV40', '4.0'], ['cvssMetricV2', '2.0']];
  for (const [key, version] of families) {
    const list: any[] = Array.isArray(metrics?.[key]) ? metrics[key] : [];
    if (list.length === 0) continue;
    const metric = list.find((m) => m?.type === 'Primary') ?? list[0];
    const data = metric?.cvssData ?? {};
    const score = Number(data.baseScore);
    // v2 keeps its severity on the metric, v3 and v4 inside cvssData.
    const severity = String(data.baseSeverity ?? metric?.baseSeverity ?? '').toLowerCase() || null;
    return {
      version,
      score: Number.isFinite(score) ? score : null,
      severity: severity && ['none', 'low', 'medium', 'high', 'critical'].includes(severity) ? severity : null,
      vector: typeof data.vectorString === 'string' ? data.vectorString.slice(0, 300) : null,
    };
  }
  return null;
}

/** One `vulnerabilities[].cve` of the NVD CVE API 2.0, as the cache keeps it; null when it has no valid id. */
export function parseNvdCve(cve: any): ParsedCve | null {
  const id = String(cve?.id ?? '').trim().toUpperCase();
  if (!/^CVE-\d{4}-\d{4,}$/.test(id)) return null;
  const descriptions: any[] = Array.isArray(cve?.descriptions) ? cve.descriptions : [];
  const summary = (descriptions.find((d) => d?.lang === 'en') ?? descriptions[0])?.value ?? null;
  const metric = pickMetric(cve?.metrics);
  const references: any[] = Array.isArray(cve?.references) ? cve.references : [];
  const urls = Array.from(new Set(references.map((r) => String(r?.url ?? '').trim()).filter((u) => /^https?:\/\//i.test(u) && u.length <= 2000))).slice(0, 50);
  const matches: ParsedCve['matches'] = [];
  const seen = new Set<string>();
  const status = typeof cve?.vulnStatus === 'string' ? cve.vulnStatus : null;
  if (status !== 'Rejected') {
    for (const config of Array.isArray(cve?.configurations) ? cve.configurations : []) {
      for (const node of Array.isArray(config?.nodes) ? config.nodes : []) {
        // A negated node lists what is NOT affected: never read as a vulnerable product.
        if (node?.negate === true) continue;
        for (const match of Array.isArray(node?.cpeMatch) ? node.cpeMatch : []) {
          const criteria = String(match?.criteria ?? '');
          const parsed = cpeProduct(criteria);
          if (!parsed) continue;
          const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
          const start = text(match.versionStartIncluding) ?? text(match.versionStartExcluding);
          const end = text(match.versionEndIncluding) ?? text(match.versionEndExcluding);
          const row = {
            product: parsed.product,
            criteria: criteria.slice(0, 500),
            version_exact: parsed.version ? parsed.version.slice(0, 100) : null,
            version_start: start,
            start_including: start ? text(match.versionStartIncluding) !== null : null,
            version_end: end,
            end_including: end ? text(match.versionEndIncluding) !== null : null,
            vulnerable: match.vulnerable === true,
          };
          const key = JSON.stringify(row);
          if (seen.has(key)) continue;
          seen.add(key);
          matches.push(row);
        }
      }
    }
  }
  return {
    cve_id: id,
    summary: typeof summary === 'string' ? summary.slice(0, 8000) : null,
    cvss_score: metric?.score ?? null,
    severity: metric?.severity ?? null,
    cvss_version: metric?.version ?? null,
    cvss_vector: metric?.vector ?? null,
    published_at: typeof cve?.published === 'string' ? cve.published : null,
    last_modified_at: typeof cve?.lastModified === 'string' ? cve.lastModified : null,
    nvd_status: status,
    reference_urls: urls,
    matches,
  };
}

/** The NVD answers in UTC without an offset (`2026-10-01T12:00:00.000`): read it as UTC. */
function utc(value: string | null): string | null {
  if (!value) return null;
  return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
}

export type FeedRuntime = {
  baseUrl: string;
  apiKey: string | null;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Minimum time between two requests, from the rolling window (6 s without a key, 0.6 s with one). */
  spacingMs: number;
  retryDelayMs: number;
  /** Tries per request: three for the scheduled run, one on demand. */
  attempts?: number;
};

export type FeedSummary = {
  products: number;
  requests: number;
  cves: number;
  failed_products: string[];
  errors: string[];
  tenants_matched: number;
  rows_added: number;
  rows_removed: number;
};

export function defaultRuntime(): FeedRuntime {
  const apiKey = (process.env.NVD_API_KEY ?? '').trim() || null;
  return {
    baseUrl: (process.env.NVD_API_BASE_URL ?? '').trim() || NVD_DEFAULT_BASE_URL,
    apiKey,
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    spacingMs: Math.ceil(RATE_WINDOW_MS / (apiKey ? 50 : 5)),
    retryDelayMs: RETRY_DELAY_MS,
  };
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`NVD answered HTTP ${status}`);
  }
}

/**
 * A failure of the service rather than of one product: no answer, a timeout, a server error, or a
 * refusal of the cadence (403, 429) after the retries. A 400 or a 404 is the product's own error.
 */
function serviceFailure(error: unknown): boolean {
  return !(error instanceof HttpError) || [403, 408, 429].includes(error.status) || error.status >= 500;
}

/**
 * The NVD feed (lot T6a): fills the platform cache (`vulnerability_cves`,
 * `vulnerability_cve_matches`) for the CPE products the tenants follow, then matches every tenant.
 *
 * - Products: the union of the `cpe_products` of the technologies not retired of every tenant in
 *   use, read tenant by tenant under its own context; the cache and the feed's progress (`vulnerability_feed_products`) name no tenant.
 * - Per product: every CVE at the first pass (pages only, no date), then the CVE modified since
 *   the last success (an hour of overlap), in windows of at most 120 days (`lastModStartDate` /
 *   `lastModEndDate`), 2,000 per page (`startIndex`). Products tried longest ago go first. Each window that completes moves the product's
 *   `last_success_at`: a failure resumes from there at the next run.
 * - Cadence: one request per 6 s without a key, per 0.6 s with `NVD_API_KEY` (the rolling 30 s
 *   window of the NVD); a refused or failed request is tried three times (30 s, then 60 s later);
 *   after two products failed in a row for a failure of the service (no answer, 5xx, 403, 429),
 *   the others wait for the next run; a 400 or 404 stays the product's own error.
 * - A CVE without CPE configuration yet (frequent since 2024) is kept with no criterion: it matches
 *   at the run that follows its analysis, when its `lastModified` brings it back.
 * Scheduled task `vulnerability-feed` (model: `cleanup/lifecycle-status-sync.service.ts`),
 * registered only while `VULNERABILITY_FEED_ENABLED`. The scheduler awaits the handler and records a
 * failure; nothing here is started without being awaited.
 */
@Injectable()
export class NvdFeedService implements OnModuleInit {
  private readonly logger = new Logger(NvdFeedService.name);
  private lastRequestAt = 0;
  /** The CVE of the current run whose severity rose to critical or high (`store`), for the notifications. */
  private raisedCves = new Set<string>();
  /** The collections on demand of this process, one after the other. */
  private onDemand: Promise<void> = Promise.resolve();
  /** Technologies to match once the transaction that changed them has committed (`txid`). */
  private afterCommit: Array<{ tenantId: string; technologyId: string; products: string[]; txid: string; queuedAt: number }> = [];
  private draining = false;
  /** How long the queue waits between two reads of the transactions' status. */
  drainDelayMs = 200;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly matcher: VulnerabilityMatchService,
    private readonly notifier: VulnerabilityNotificationsService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {}

  onModuleInit() {
    this.cpeEvents?.subscribe((event) => this.onCpeProductsAdded(event));
    if (!Features.VULNERABILITY_FEED_ENABLED) return;
    this.scheduledTasks.register({
      name: NVD_FEED_TASK_NAME,
      description: 'Reads the published vulnerabilities (NVD) of the products the technologies name, and matches them with each workspace',
      defaultCron: '20 */6 * * *',
      handler: () => this.run(),
    });
  }

  /** The tenants in use, as the other scheduled tasks read them. */
  private async tenantIds(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM tenants WHERE status IN ('active', 'frozen') AND deleted_at IS NULL ORDER BY id ASC`,
    );
    return rows.map((r) => r.id);
  }

  /** The union of the CPE products every tenant follows, without saying which tenant follows which. */
  async followedProducts(): Promise<string[]> {
    const products = new Set<string>();
    for (const tenantId of await this.tenantIds()) {
      const rows: Array<{ product: string }> = await withTenant(this.dataSource, tenantId, (mg) => mg.query(
        `SELECT DISTINCT lower(p) AS product FROM technologies t, unnest(t.cpe_products) AS p
          WHERE t.tenant_id = $1 AND t.lifecycle <> 'retired'`,
        [tenantId],
      ));
      for (const row of rows) products.add(row.product);
    }
    return Array.from(products).sort();
  }

  /**
   * The tenants whose IT owners are told of new vulnerabilities (lot T6b): active ones only, as the
   * other scheduled notifications (a frozen workspace is matched, not mailed), and none while the
   * application address is not configured (the emails link to it).
   */
  private async notifiedTenantIds(): Promise<Set<string>> {
    // Email off (no SMTP): nothing is claimed, so nothing is lost for a later announcement either.
    if (!Features.EMAIL_ENABLED || resolveConfiguredAppBaseUrl(null) === null) return new Set();
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM tenants WHERE status = 'active' AND deleted_at IS NULL`,
    );
    return new Set(rows.map((r) => r.id));
  }

  /** The scheduled run: collect, then match every tenant and tell the owners what is new. */
  async run(runtime: FeedRuntime = defaultRuntime()): Promise<FeedSummary> {
    this.raisedCves = new Set();
    // The rows detected from now on, whatever writes them, are this run's news (notifications).
    const [{ started }]: Array<{ started: Date }> = await this.dataSource.query(`SELECT clock_timestamp() AS started`);
    const summary = await this.collect(runtime);
    const raised = Array.from(this.raisedCves);
    const notified = await this.notifiedTenantIds();
    for (const tenantId of await this.tenantIds()) {
      let result: MatchResult;
      try {
        result = await withTenant(this.dataSource, tenantId, (mg) => this.matcher.matchTenant(mg, tenantId));
        summary.tenants_matched += 1;
        summary.rows_added += result.added;
        summary.rows_removed += result.removed;
      } catch (error: any) {
        summary.errors.push(`Matching of tenant ${tenantId}: ${error?.message ?? error}`);
        continue;
      }
      if (!notified.has(tenantId)) continue;
      try {
        // Claimed once the matching has committed, in its own transaction; sent without awaiting.
        // What is not claimed now is never announced later (vulnerability-notifications.service.ts).
        const digests = await withTenant(this.dataSource, tenantId, (mg) => this.notifier.claim(mg, tenantId, started, raised));
        void this.notifier.send(tenantId, digests);
      } catch (error: any) {
        summary.errors.push(`Notifications of tenant ${tenantId}: ${error?.message ?? error}`);
      }
    }
    if (summary.errors.length > 0) this.logger.warn(`[${NVD_FEED_TASK_NAME}] ${summary.errors.length} failure(s): ${summary.errors.join(' | ')}`);
    if (summary.failed_products.length > 0 && summary.failed_products.length === summary.products) {
      throw new Error(`No product could be read from the NVD: ${summary.errors[0] ?? 'unknown error'}`);
    }
    return summary;
  }

  /**
   * A technology changed (CPE products received, a version or a link written: `TechnologyCpeEvents`,
   * lot T6b). The work waits for the commit of the caller's transaction: the event queues the
   * technology with the transaction's id (`txid_current()`), and a queue outside any request
   * transaction reads that transaction's status (`txid_status`): once `committed`, the technology is
   * matched with the cache from the committed state, then the products the feed never collected are
   * collected in the background (and the tenant matched again); `aborted`, nothing happens. These
   * matches send no email: the next runs find their rows already there. Nothing while the feed is off.
   */
  async onCpeProductsAdded(event: CpeProductsAdded): Promise<void> {
    if (!Features.VULNERABILITY_FEED_ENABLED) return;
    const [row]: Array<{ txid: string }> = await event.manager.query(`SELECT txid_current()::text AS txid`);
    const same = this.afterCommit.find((item) => item.txid === row.txid && item.tenantId === event.tenantId && item.technologyId === event.technologyId);
    if (same) same.products = Array.from(new Set([...same.products, ...event.products]));
    else this.afterCommit.push({ tenantId: event.tenantId, technologyId: event.technologyId, products: [...event.products], txid: row.txid, queuedAt: Date.now() });
    void this.drain();
  }

  /** Resolves once the after-commit queue is empty (for the specs). */
  async whenIdle(timeoutMs = 15_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while ((this.draining || this.afterCommit.length > 0) && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  }

  /** Works through the after-commit queue; an item waits while its transaction is in progress (10 minutes at most). */
  @NeverRejects()
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.afterCommit.length > 0) {
        const txids = Array.from(new Set(this.afterCommit.map((item) => item.txid)));
        const rows: Array<{ txid: string; status: string | null }> = await this.dataSource.query(
          `SELECT t AS txid, txid_status(t::bigint) AS status FROM unnest($1::text[]) AS t`,
          [txids],
        );
        const status = new Map(rows.map((r) => [r.txid, r.status]));
        const ready = this.afterCommit.filter((item) => status.get(item.txid) === 'committed');
        this.afterCommit = this.afterCommit.filter((item) => status.get(item.txid) === 'in progress' && Date.now() - item.queuedAt < 10 * 60_000);
        for (const item of ready) {
          try {
            await withTenant(this.dataSource, item.tenantId, (mg) => this.matcher.matchTenant(mg, item.tenantId, item.technologyId));
            const fresh = await this.neverCollected(item.products);
            if (fresh.length > 0) void this.collectNew(item.tenantId, fresh);
          } catch (error: any) {
            this.logger.warn(`[${NVD_FEED_TASK_NAME}] matching of technology ${item.technologyId} after a change: ${String(error?.message ?? error).slice(0, 300)}`);
          }
        }
        if (this.afterCommit.length > 0 && ready.length === 0) await new Promise((r) => setTimeout(r, this.drainDelayMs));
      }
    } finally {
      this.draining = false;
    }
    if (this.afterCommit.length > 0) void this.drain();
  }

  /** Of `products`, those the feed never collected (no success yet), in lower case. */
  async neverCollected(products: string[]): Promise<string[]> {
    const wanted = Array.from(new Set(products.map((p) => String(p).trim().toLowerCase()).filter(Boolean)));
    if (wanted.length === 0) return [];
    const done: Array<{ product: string }> = await this.dataSource.query(
      `SELECT product FROM vulnerability_feed_products WHERE product = ANY($1::text[]) AND last_success_at IS NOT NULL`,
      [wanted],
    );
    const collected = new Set(done.map((r) => r.product));
    return wanted.filter((p) => !collected.has(p));
  }

  /**
   * Collects products never collected, now, in the background, then matches the tenant (lot T6b):
   * the same collection as the scheduled run (cadence, first pass by pages), one request at a time in
   * this process. It never takes the scheduled task's lock: each product is collected under its own
   * lock (`vulnerability-feed:product:<product>`, which the run takes too), so a run is never skipped
   * and two requests for one product collect it once. A request is tried once, and the first failure
   * of the service stops the collection (the products left wait for the run); a tenant collects
   * `onDemandPerHour` new products an hour at most in this process, the run takes the others.
   * Never rejects.
   */
  @NeverRejects()
  async collectNew(tenantId: string, products: string[], runtime: FeedRuntime = defaultRuntime()): Promise<void> {
    if (!Features.VULNERABILITY_FEED_ENABLED) return;
    const next = this.onDemand.then(() => this.collectNewNow(tenantId, products, { ...runtime, attempts: runtime.attempts ?? 1 }));
    this.onDemand = next.catch(() => undefined);
    await next;
  }

  /** New products a tenant may have collected on demand per hour, in this process. */
  onDemandPerHour = 20;
  private readonly onDemandUse = new Map<string, number[]>();

  /** How many of `wanted` new products the tenant may still collect this hour (and counts them). */
  private takeOnDemandQuota(tenantId: string, wanted: number): number {
    const hourAgo = Date.now() - 60 * 60_000;
    const used = (this.onDemandUse.get(tenantId) ?? []).filter((at) => at > hourAgo);
    const allowed = Math.max(Math.min(wanted, this.onDemandPerHour - used.length), 0);
    for (let i = 0; i < allowed; i += 1) used.push(Date.now());
    this.onDemandUse.set(tenantId, used);
    return allowed;
  }

  /** Runs `fn` under the product's own lock; `wait` false gives up (returns false) when another holds it. */
  private async withProductLock(product: string, wait: boolean, fn: () => Promise<void>): Promise<boolean> {
    const key = `${NVD_FEED_TASK_NAME}:product:${product}`;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      if (wait) await runner.query(`SELECT pg_advisory_lock(hashtext($1))`, [key]);
      else {
        const [{ locked }] = await runner.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [key]);
        if (!locked) return false;
      }
      try {
        await fn();
      } finally {
        await runner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch(() => undefined);
      }
      return true;
    } finally {
      await runner.release();
    }
  }

  private async collectNewNow(tenantId: string, products: string[], runtime: FeedRuntime): Promise<void> {
    const wanted = await this.neverCollected(products);
    if (wanted.length === 0) return;
    const allowed = wanted.slice(0, this.takeOnDemandQuota(tenantId, wanted.length));
    const summary: FeedSummary = { products: allowed.length, requests: 0, cves: 0, failed_products: [], errors: [], tenants_matched: 0, rows_added: 0, rows_removed: 0 };
    for (const product of allowed) {
      let serviceDown = false;
      await this.withProductLock(product, true, async () => {
        // Collected by a run or by another request while this one waited: nothing to collect, but
        // the tenant is still matched below (it asked for these products).
        if ((await this.neverCollected([product])).length === 0) return;
        try {
          await this.collectProduct(product, runtime, summary);
        } catch (error: any) {
          await this.recordFailure(product, error);
          serviceDown = serviceFailure(error);
          this.logger.warn(`[${NVD_FEED_TASK_NAME}] ${product} on demand: ${String(error?.message ?? error).slice(0, 300)}`);
        }
      });
      if (serviceDown) break;
    }
    await withTenant(this.dataSource, tenantId, (mg) => this.matcher.matchTenant(mg, tenantId));
  }

  /** A product's failure, kept for the next run and for the technology's section. */
  private async recordFailure(product: string, error: any): Promise<void> {
    const message = String(error?.message ?? error).slice(0, 500);
    await this.dataSource.query(
      `INSERT INTO vulnerability_feed_products (product, last_attempt_at, last_error) VALUES ($1, now(), $2)
       ON CONFLICT (product) DO UPDATE SET last_attempt_at = now(), last_error = EXCLUDED.last_error`,
      [product, message],
    ).catch(() => undefined);
  }

  /** Fills the cache for every followed product; a product that fails is retried at the next run. */
  async collect(runtime: FeedRuntime = defaultRuntime()): Promise<FeedSummary> {
    const summary: FeedSummary = { products: 0, requests: 0, cves: 0, failed_products: [], errors: [], tenants_matched: 0, rows_added: 0, rows_removed: 0 };
    const followed = await this.followedProducts();
    // The products tried longest ago first, never tried first of all: a product that fails does not
    // keep the head of the list, and every product gets its turn when a run stops early.
    const attempts: Array<{ product: string; last_attempt_at: Date | null }> = followed.length
      ? await this.dataSource.query(`SELECT product, last_attempt_at FROM vulnerability_feed_products WHERE product = ANY($1::text[])`, [followed])
      : [];
    const lastAttempt = new Map(attempts.map((a) => [a.product, a.last_attempt_at ? new Date(a.last_attempt_at).getTime() : null]));
    const products = [...followed].sort((a, b) => {
      const x = lastAttempt.get(a) ?? null;
      const y = lastAttempt.get(b) ?? null;
      if (x !== y) return x === null ? -1 : y === null ? 1 : x - y;
      return a.localeCompare(b);
    });
    summary.products = products.length;
    let failedInARow = 0;
    for (const product of products) {
      if (failedInARow >= 2) {
        // The NVD (or the mirror) is down: the remaining products wait for the next run instead of
        // spending their retries one after the other. Only failures of the service count here.
        summary.failed_products.push(product);
        continue;
      }
      try {
        // Under the product's lock: a collection on demand of the same product is not run twice.
        const done = await this.withProductLock(product, false, () => this.collectProduct(product, runtime, summary));
        if (!done) continue; // being collected on demand right now
        failedInARow = 0;
      } catch (error: any) {
        failedInARow = serviceFailure(error) ? failedInARow + 1 : 0;
        const message = String(error?.message ?? error).slice(0, 500);
        summary.failed_products.push(product);
        summary.errors.push(`${product}: ${message}`);
        await this.recordFailure(product, error);
      }
    }
    const skipped = summary.failed_products.length - summary.errors.length;
    if (skipped > 0) summary.errors.push(`Stopped after two products failed in a row: ${skipped} product(s) left for the next run`);
    return summary;
  }

  private async collectProduct(product: string, runtime: FeedRuntime, summary: FeedSummary): Promise<void> {
    const [state]: Array<{ last_success_at: Date | null }> = await this.dataSource.query(
      `SELECT last_success_at FROM vulnerability_feed_products WHERE product = $1`,
      [product],
    );
    const end = runtime.now();
    const markSuccess = (at: number) => this.dataSource.query(
      `INSERT INTO vulnerability_feed_products (product, last_success_at, last_attempt_at, last_error) VALUES ($1, $2, now(), NULL)
       ON CONFLICT (product) DO UPDATE SET last_success_at = EXCLUDED.last_success_at, last_attempt_at = now(), last_error = NULL`,
      [product, new Date(at)],
    );
    if (!state?.last_success_at) {
      // First pass of a product: all its CVE, whatever their age, by pages only.
      await this.collectWindow(product, null, null, runtime, summary);
      await markSuccess(end);
      return;
    }
    let start = Math.max(new Date(state.last_success_at).getTime() - OVERLAP_MS, end - 10 * 365 * DAY_MS);
    while (start < end) {
      const windowEnd = Math.min(start + NVD_MAX_WINDOW_MS, end);
      await this.collectWindow(product, new Date(start), new Date(windowEnd), runtime, summary);
      await markSuccess(windowEnd);
      start = windowEnd;
    }
  }

  /** The CVE of the product modified between `from` and `to`, or all of them (`null`), page by page. */
  private async collectWindow(product: string, from: Date | null, to: Date | null, runtime: FeedRuntime, summary: FeedSummary): Promise<void> {
    let startIndex = 0;
    for (;;) {
      const url = new URL(runtime.baseUrl);
      url.searchParams.set('virtualMatchString', `cpe:2.3:${product}:*:*:*:*:*:*:*:*`);
      if (from && to) {
        url.searchParams.set('lastModStartDate', from.toISOString());
        url.searchParams.set('lastModEndDate', to.toISOString());
      }
      url.searchParams.set('resultsPerPage', String(PAGE_SIZE));
      url.searchParams.set('startIndex', String(startIndex));
      const page = await this.request(url, runtime, summary);
      const items: any[] = Array.isArray(page?.vulnerabilities) ? page.vulnerabilities : [];
      const parsed = items.map((item) => parseNvdCve(item?.cve)).filter((c): c is ParsedCve => !!c);
      if (parsed.length > 0) {
        const raised = await this.dataSource.transaction((mg) => this.store(mg, parsed));
        for (const cveId of raised) this.raisedCves.add(cveId);
        summary.cves += parsed.length;
      }
      const total = Number(page?.totalResults ?? 0);
      startIndex += items.length;
      if (items.length === 0 || !Number.isFinite(total) || startIndex >= total) return;
    }
  }

  /** One request, at the cadence, tried `ATTEMPTS` times on a network error, a refusal (403, 429) or a server error. */
  private async request(url: URL, runtime: FeedRuntime, summary: FeedSummary): Promise<any> {
    let lastError: unknown = null;
    const attempts = runtime.attempts ?? ATTEMPTS;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const wait = this.lastRequestAt + runtime.spacingMs - runtime.now();
      if (wait > 0) await runtime.sleep(wait);
      this.lastRequestAt = runtime.now();
      summary.requests += 1;
      try {
        const response = await runtime.fetch(url.toString(), {
          headers: { Accept: 'application/json', ...(runtime.apiKey ? { apiKey: runtime.apiKey } : {}) },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new HttpError(response.status);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (!serviceFailure(error) || attempt === attempts) break;
        await runtime.sleep(runtime.retryDelayMs * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Upserts the CVE of one page and replaces their criteria, in one transaction. Returns the CVE
   * already in the cache whose severity rose to critical or high (lot T6b: announced once).
   */
  async store(mg: EntityManager, cves: ParsedCve[]): Promise<string[]> {
    const unique = Array.from(new Map(cves.map((c) => [c.cve_id, c])).values());
    // Every step of the statement reads the same snapshot: `old` holds the severities before the upsert.
    const raised: Array<{ cve_id: string }> = await mg.query(
      `WITH old AS (
         SELECT cve_id, severity FROM vulnerability_cves
          WHERE cve_id IN (SELECT i.cve_id FROM jsonb_to_recordset($1::jsonb) AS i(cve_id text))
       ), up AS (
       INSERT INTO vulnerability_cves AS c (cve_id, summary, cvss_score, severity, cvss_version, cvss_vector, published_at, last_modified_at, nvd_status, reference_urls, fetched_at)
       SELECT i.cve_id, i.summary, i.cvss_score, i.severity, i.cvss_version, i.cvss_vector, i.published_at, i.last_modified_at, i.nvd_status,
              COALESCE(ARRAY(SELECT jsonb_array_elements_text(i.reference_urls)), '{}'), now()
         FROM jsonb_to_recordset($1::jsonb) AS i(
           cve_id text, summary text, cvss_score numeric, severity text, cvss_version text, cvss_vector text,
           published_at timestamptz, last_modified_at timestamptz, nvd_status text, reference_urls jsonb)
       ON CONFLICT (cve_id) DO UPDATE SET
         summary = EXCLUDED.summary, cvss_score = EXCLUDED.cvss_score, severity = EXCLUDED.severity,
         cvss_version = EXCLUDED.cvss_version, cvss_vector = EXCLUDED.cvss_vector, published_at = EXCLUDED.published_at,
         last_modified_at = EXCLUDED.last_modified_at, nvd_status = EXCLUDED.nvd_status,
         reference_urls = EXCLUDED.reference_urls, fetched_at = now()
       RETURNING c.cve_id, c.severity
       )
       SELECT up.cve_id FROM up JOIN old ON old.cve_id = up.cve_id
        WHERE up.severity IN ('critical', 'high') AND (old.severity IS NULL OR old.severity NOT IN ('critical', 'high'))`,
      [JSON.stringify(unique.map(({ matches: _matches, ...cve }) => ({
        ...cve,
        published_at: utc(cve.published_at),
        last_modified_at: utc(cve.last_modified_at),
      })))],
    );
    await mg.query(`DELETE FROM vulnerability_cve_matches WHERE cve_id = ANY($1::text[])`, [unique.map((c) => c.cve_id)]);
    const matches = unique.flatMap((c) => c.matches.map((m) => ({ cve_id: c.cve_id, ...m })));
    if (matches.length > 0) {
      await mg.query(
        `INSERT INTO vulnerability_cve_matches (cve_id, product, criteria, version_exact, version_start, start_including, version_end, end_including, vulnerable)
         SELECT cve_id, product, criteria, version_exact, version_start, start_including, version_end, end_including, vulnerable
           FROM jsonb_to_recordset($1::jsonb) AS m(
             cve_id text, product text, criteria text, version_exact text, version_start text, start_including boolean,
             version_end text, end_including boolean, vulnerable boolean)`,
        [JSON.stringify(matches)],
      );
    }
    return raised.map((r) => r.cve_id);
  }
}
