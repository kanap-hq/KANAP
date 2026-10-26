import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { NeverRejects } from '../common/never-rejects';
import { TechnologyCpeEvents, type CpeProductsAdded } from '../technologies/technology-cpe-events';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { withTenant } from '../common/tenant-runner';
import { Features } from '../config/features';
import { CveListFeedService, type CveListSummary } from './cve-list-feed.service';
import { VulnerabilityMatchService } from './vulnerability-match.service';
import { ANNOUNCED_WITHIN_DAYS, VulnerabilityNotificationsService } from './vulnerability-notifications.service';
import { VulnerabilitySignalsService } from './vulnerability-signals.service';
import { resolveConfiguredAppBaseUrl } from '../common/url';
import { cpeProduct } from './vulnerability-rules';

export const NVD_FEED_TASK_NAME = 'vulnerability-feed';
export const NVD_DEFAULT_BASE_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The NVD refuses a date range over 120 consecutive days: one minute of margin. */
export const NVD_MAX_WINDOW_MS = 120 * DAY_MS - 60_000;
/** An incremental window starts this much before the last success: a CVE indexed late is not missed. */
const OVERLAP_MS = 60 * 60 * 1000;
/**
 * CVE asked per page. The NVD allows 2000; a Windows page of that size is about 18.6 MB and about
 * 68 s, and one of 500 is about 4.7 MB and about 6 s.
 */
export const NVD_PAGE_SIZE = 500;
/** Rolling 30 s window: 5 requests without a key, 50 with one (NVD "Rate Limits"). */
const RATE_WINDOW_MS = 30_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000;
/** How much of a product error `vulnerability_feed_sources.last_error` keeps. */
const FEED_ERROR_LIMIT = 300;
const NVD_SOURCE = 'nvd';

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
  /** The CVE.org pass of this run, when that service is wired. */
  cve_org?: CveListSummary;
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
 * registered only while `VULNERABILITY_FEED_ENABLED`. The same pass reads the CVE.org list
 * (`CveListFeedService`) after the NVD and before the workspaces are matched. Every workspace is
 * matched, then the signals already downloaded are stamped, then the owners are told. A failure of
 * CVE.org is named in the summary and does not stop the NVD collection or the matching.
 * The scheduler awaits the handler and records a failure; nothing here is started without being awaited.
 */
@Injectable()
export class NvdFeedService implements OnModuleInit {
  private readonly logger = new Logger(NvdFeedService.name);
  private lastRequestAt = 0;
  /** The CVE of the current run whose severity rose to critical or high (`store`), for the notifications. */
  private raisedCves = new Set<string>();
  /** The collections on demand of this process, one after the other. */
  private onDemand: Promise<void> = Promise.resolve();
  /** `collectNew` calls not finished yet, their rematch included (the specs wait for them). */
  private demandPending = 0;
  /**
   * Workspaces to match once the on-demand queue is idle, and the products whose first collection
   * has succeeded. Several products collected one after another are matched once, with all of them
   * in the cache (`flushRematch`).
   */
  private readonly rematchTenants = new Set<string>();
  private readonly rematchProducts = new Set<string>();
  /** Technologies to match once the transaction that changed them has committed (`txid`). */
  private afterCommit: Array<{ tenantId: string; technologyId: string; products: string[]; txid: string; queuedAt: number }> = [];
  /**
   * Technologies taken out of `afterCommit` whose match has not finished. A record still says the
   * match is running for them: the rows are written only when the match commits.
   */
  private readonly matchingNow = new Map<string, Set<string>>();
  private draining = false;
  /** How long the queue waits between two reads of the transactions' status. */
  drainDelayMs = 200;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly matcher: VulnerabilityMatchService,
    private readonly notifier: VulnerabilityNotificationsService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
    /** Stamps exploitation signals already downloaded onto CVE this collection just cached. */
    @Optional() private readonly signals?: VulnerabilitySignalsService,
    /** The CVE.org list. Specs that build the service by hand leave it out. */
    @Optional() private readonly cveList?: CveListFeedService,
  ) {}

  onModuleInit() {
    this.cpeEvents?.subscribe((event) => this.onCpeProductsAdded(event));
    this.signals?.onNewlyExploited((cveIds) => this.announceExploited(cveIds));
    if (!Features.VULNERABILITY_FEED_ENABLED) return;
    this.scheduledTasks.register({
      name: NVD_FEED_TASK_NAME,
      description: 'Reads the published vulnerabilities from the NVD and from CVE.org, and matches them with each workspace',
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

  /** The scheduled run: collect the NVD, then CVE.org, match every tenant, stamp the signals, then tell the owners what is new. */
  async run(runtime: FeedRuntime = defaultRuntime()): Promise<FeedSummary> {
    this.raisedCves = new Set();
    await this.markNvdAttempt();
    // The rows detected from now on, whatever writes them, are this run's news (notifications).
    const [{ started }]: Array<{ started: Date }> = await this.dataSource.query(`SELECT clock_timestamp() AS started`);
    const summary = await this.collect(runtime);
    // CVE.org is its own pass. A failure here is recorded and does not skip the matching below,
    // nor does it undo the NVD collection that just finished.
    try {
      const cveOrg = await this.cveList?.collect();
      if (cveOrg) {
        summary.cve_org = cveOrg;
        for (const error of cveOrg.errors) summary.errors.push(`CVE.org: ${error}`);
      }
    } catch (error: any) {
      summary.errors.push(`CVE.org: ${String(error?.message ?? error).slice(0, 300)}`);
    }
    const raised = Array.from(this.raisedCves);
    const notified = await this.notifiedTenantIds();
    const matched: string[] = [];
    for (const tenantId of await this.tenantIds()) {
      try {
        const result = await withTenant(this.dataSource, tenantId, (mg) => this.matcher.matchTenant(mg, tenantId));
        summary.tenants_matched += 1;
        summary.rows_added += result.added;
        summary.rows_removed += result.removed;
        matched.push(tenantId);
      } catch (error: any) {
        summary.errors.push(`Matching of tenant ${tenantId}: ${error?.message ?? error}`);
      }
    }
    // After every match: a CVE only CVE.org put in the cache receives the signals already
    // downloaded, before the mails read them. A new medium CVE already exploited is announced
    // at this run, not left to the signals task.
    await this.applyKnownSignals();
    for (const tenantId of matched) {
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
    // Before the throw below: a pass where every product failed still records that it failed.
    await this.markNvdOutcome(summary);
    if (summary.errors.length > 0) this.logger.warn(`[${NVD_FEED_TASK_NAME}] ${summary.errors.length} failure(s): ${summary.errors.join(' | ')}`);
    if (summary.failed_products.length > 0 && summary.failed_products.length === summary.products) {
      throw new Error(`No product could be read from the NVD: ${summary.errors[0] ?? 'unknown error'}`);
    }
    return summary;
  }

  /**
   * The age of the NVD pass (`vulnerability_feed_sources`, `source = 'nvd'`). A failed write is
   * logged and does not stop the pass. The cursor of another source is left alone.
   */
  private async markNvdAttempt(): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO vulnerability_feed_sources (source, last_attempt_at) VALUES ($1, now())
         ON CONFLICT (source) DO UPDATE SET last_attempt_at = now()`,
        [NVD_SOURCE],
      );
    } catch (error) {
      this.warnProgress(error);
    }
  }

  /** Success clears the error and keeps the attempt time. A product failure keeps the previous success. */
  private async markNvdOutcome(summary: FeedSummary): Promise<void> {
    try {
      if (summary.failed_products.length === 0) {
        await this.dataSource.query(
          `INSERT INTO vulnerability_feed_sources (source, last_success_at, last_error) VALUES ($1, now(), NULL)
           ON CONFLICT (source) DO UPDATE SET last_success_at = now(), last_error = NULL`,
          [NVD_SOURCE],
        );
        return;
      }
      const message = String(summary.errors[0] ?? 'NVD feed failed').slice(0, FEED_ERROR_LIMIT);
      await this.dataSource.query(
        `INSERT INTO vulnerability_feed_sources (source, last_error) VALUES ($1, $2)
         ON CONFLICT (source) DO UPDATE SET last_error = EXCLUDED.last_error`,
        [NVD_SOURCE, message],
      );
    } catch (error) {
      this.warnProgress(error);
    }
  }

  private warnProgress(error: unknown): void {
    try {
      this.logger.warn(`[${NVD_FEED_TASK_NAME}] feed progress: ${String((error as { message?: string })?.message ?? error).slice(0, FEED_ERROR_LIMIT)}`);
    } catch {
      // A logger failure must not become an unhandled rejection.
    }
  }

  /**
   * A technology changed (CPE products received, a version or a link written: `TechnologyCpeEvents`,
   * lot T6b). The work waits for the commit of the caller's transaction: the event queues the
   * technology with the transaction's id (`txid_current()`), and a queue outside any request
   * transaction reads that transaction's status (`txid_status`): once `committed`, the technology is
   * matched with the cache from the committed state, then the products the feed never collected are
   * collected in the background. Once that queue is idle, every workspace that carries a product
   * whose first collection succeeded is matched (`flushRematch`), so a product collected after the
   * first is in the cache by then. `aborted`, nothing happens. These matches send no email: the
   * first match of a technology, and of a CPE product just added to one already matched, stays a
   * silent baseline (`vulnerability-notifications.service.ts`). Nothing while the feed is off.
   */
  async onCpeProductsAdded(event: CpeProductsAdded): Promise<void> {
    if (!Features.VULNERABILITY_FEED_ENABLED) return;
    const [row]: Array<{ txid: string }> = await event.manager.query(`SELECT txid_current()::text AS txid`);
    const same = this.afterCommit.find((item) => item.txid === row.txid && item.tenantId === event.tenantId && item.technologyId === event.technologyId);
    if (same) same.products = Array.from(new Set([...same.products, ...event.products]));
    else this.afterCommit.push({ tenantId: event.tenantId, technologyId: event.technologyId, products: [...event.products], txid: row.txid, queuedAt: Date.now() });
    void this.drain();
  }

  /**
   * Technology ids of this tenant whose match is queued or running. The record's vulnerabilities
   * route uses it to say the search is in progress (`VulnerabilityReachService`). Empty almost
   * always: the queue only holds a technology between a change and the match that follows it.
   */
  pendingTechnologyIds(tenantId: string): string[] {
    const ids = new Set<string>();
    for (const item of this.afterCommit) {
      if (item.tenantId === tenantId) ids.add(item.technologyId);
    }
    for (const id of this.matchingNow.get(tenantId) ?? []) ids.add(id);
    return Array.from(ids);
  }

  /** Keeps a technology visible as pending from the moment it leaves the queue until its match ends. */
  private markMatching(tenantId: string, technologyId: string): void {
    const ids = this.matchingNow.get(tenantId) ?? new Set<string>();
    ids.add(technologyId);
    this.matchingNow.set(tenantId, ids);
  }

  private unmarkMatching(tenantId: string, technologyId: string): void {
    const ids = this.matchingNow.get(tenantId);
    if (!ids) return;
    ids.delete(technologyId);
    if (ids.size === 0) this.matchingNow.delete(tenantId);
  }

  /** Resolves once the after-commit queue and the collections it started are finished (for the specs). */
  async whenIdle(timeoutMs = 15_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while ((this.draining || this.afterCommit.length > 0 || this.demandPending > 0) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 25));
    }
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
        // Only the items whose status was read: one queued during the read waits for the next turn.
        const asked = new Set(txids);
        const ready = this.afterCommit.filter((item) => asked.has(item.txid) && status.get(item.txid) === 'committed');
        // Mark every ready technology before the first match: the ones waiting behind it stay pending too.
        for (const item of ready) this.markMatching(item.tenantId, item.technologyId);
        this.afterCommit = this.afterCommit.filter((item) => !asked.has(item.txid)
          || (status.get(item.txid) === 'in progress' && Date.now() - item.queuedAt < 10 * 60_000));
        for (const item of ready) {
          try {
            await withTenant(this.dataSource, item.tenantId, (mg) => this.matcher.matchTenant(mg, item.tenantId, item.technologyId));
            const fresh = await this.neverCollected(item.products);
            if (fresh.length > 0) void this.collectNew(item.tenantId, fresh);
          } catch (error: any) {
            this.logger.warn(`[${NVD_FEED_TASK_NAME}] matching of technology ${item.technologyId} after a change: ${String(error?.message ?? error).slice(0, 300)}`);
          } finally {
            this.unmarkMatching(item.tenantId, item.technologyId);
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
   * Collects products never collected, now, in the background (lot T6b): the same collection as the
   * scheduled run (cadence, first pass by pages), one request at a time in this process. It never
   * takes the scheduled task's lock: each product is collected under its own lock
   * (`vulnerability-feed:product:<product>`, which the run takes too), so a run is never skipped
   * and two requests for one product collect it once. A request is tried once, and the first failure
   * of the service stops the collection (the products left wait for the run); a tenant collects
   * `onDemandPerHour` new products an hour at most in this process, the run takes the others.
   * When the queue is idle, every workspace that carries a product just collected for the first time
   * is matched (`flushRematch`). Never rejects, and sends no email.
   */
  @NeverRejects()
  async collectNew(tenantId: string, products: string[], runtime: FeedRuntime = defaultRuntime()): Promise<void> {
    if (!Features.VULNERABILITY_FEED_ENABLED) return;
    this.demandPending += 1;
    try {
      const job = this.onDemand.then(() => this.collectNewNow(tenantId, products, { ...runtime, attempts: runtime.attempts ?? 1 }));
      // The last call of the queue matches. One chained behind this one sees a different `onDemand`.
      let settled: Promise<void> = Promise.resolve();
      const tail = job.catch(() => undefined).then(() => {
        if (this.onDemand === settled) return this.flushRematch();
      });
      settled = tail.catch(() => undefined);
      this.onDemand = settled;
      await tail;
    } finally {
      this.demandPending -= 1;
    }
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
    // Already collected, by the call ahead in this queue or by an earlier one. The workspace is
    // still matched: it may have gained the product after that collection's match.
    if (wanted.length === 0) {
      this.noteRematch(tenantId, products);
      return;
    }
    const allowed = wanted.slice(0, this.takeOnDemandQuota(tenantId, wanted.length));
    const summary: FeedSummary = { products: allowed.length, requests: 0, cves: 0, failed_products: [], errors: [], tenants_matched: 0, rows_added: 0, rows_removed: 0 };
    const collected: string[] = [];
    for (const product of allowed) {
      let serviceDown = false;
      let done = false;
      await this.withProductLock(product, true, async () => {
        // Collected by a run or by another request while this one waited.
        if ((await this.neverCollected([product])).length === 0) {
          done = true;
          return;
        }
        try {
          await this.collectProduct(product, runtime, summary);
          done = true;
        } catch (error: any) {
          await this.recordFailure(product, error);
          serviceDown = serviceFailure(error);
          this.logger.warn(`[${NVD_FEED_TASK_NAME}] ${product} on demand: ${String(error?.message ?? error).slice(0, 300)}`);
        }
      });
      if (done) collected.push(product);
      if (serviceDown) break;
    }
    // The CVE just cached take the signals already downloaded before the rematch reads them.
    await this.applyKnownSignals();
    this.noteRematch(tenantId, collected);
  }

  /** Remembers a workspace, and products whose first collection succeeded, for `flushRematch`. */
  private noteRematch(tenantId: string, products: string[]): void {
    const wanted = Array.from(new Set(products.map((p) => String(p).trim().toLowerCase()).filter(Boolean)));
    if (wanted.length === 0) return;
    this.rematchTenants.add(tenantId);
    for (const product of wanted) this.rematchProducts.add(product);
  }

  /**
   * Matches every workspace that asked for the products just collected, and every workspace that
   * carries one of them, each under its own context. One match for the whole queue: the products
   * collected one after another are all in the cache. No email (the rows are there before the next
   * scheduled run, and a product just added is a silent baseline anyway).
   */
  private async flushRematch(): Promise<void> {
    const products = Array.from(this.rematchProducts);
    const requesters = Array.from(this.rematchTenants);
    this.rematchProducts.clear();
    this.rematchTenants.clear();
    if (products.length === 0) return;
    let carriers: string[] = [];
    try {
      carriers = await this.tenantsCarrying(products);
    } catch (error: any) {
      this.logger.warn(`[${NVD_FEED_TASK_NAME}] workspaces carrying a product just collected: ${String(error?.message ?? error).slice(0, 300)}`);
    }
    const tenants = Array.from(new Set([...requesters, ...carriers])).sort();
    for (const tenantId of tenants) {
      try {
        await withTenant(this.dataSource, tenantId, (mg) => this.matcher.matchTenant(mg, tenantId));
      } catch (error: any) {
        this.logger.warn(`[${NVD_FEED_TASK_NAME}] matching of tenant ${tenantId} after a first collection: ${String(error?.message ?? error).slice(0, 300)}`);
      }
    }
  }

  /** The workspaces in use that carry one of `products` (retired technologies included: their rows are revised). */
  private async tenantsCarrying(products: string[]): Promise<string[]> {
    const wanted = Array.from(new Set(products.map((p) => String(p).trim().toLowerCase()).filter(Boolean)));
    if (wanted.length === 0) return [];
    const carriers: string[] = [];
    for (const tenantId of await this.tenantIds()) {
      const rows: Array<{ ok: number }> = await withTenant(this.dataSource, tenantId, (mg) => mg.query(
        `SELECT 1 AS ok FROM technologies
          WHERE tenant_id = $1 AND EXISTS (SELECT 1 FROM unnest(cpe_products) AS p WHERE lower(p) = ANY($2::text[]))
          LIMIT 1`,
        [tenantId, wanted],
      ));
      if (rows.length > 0) carriers.push(tenantId);
    }
    return carriers;
  }

  /**
   * The CVE just cached take the signals already downloaded, without a second fetch. The scheduled
   * run calls this after matching every tenant and before the mails, so a CVE only CVE.org put in
   * the cache is flagged before it is announced. A collection on demand still calls it before the
   * rematch. A failure does not fail the collection: the next signals run stamps them.
   */
  private async applyKnownSignals(): Promise<void> {
    try {
      await this.signals?.applyKnown();
    } catch (error: any) {
      this.logger.warn(`[${NVD_FEED_TASK_NAME}] known signals: ${String(error?.message ?? error).slice(0, 300)}`);
    }
  }

  /**
   * CVE already cached that entered the CISA KEV or the EU KEV (told by the signals task after its
   * run): their rows still to review and in the alerts are announced to the IT owners as "now
   * known to be exploited", once, in a vulnerability email (lead decision, lot K2a). The same
   * tenants as a run: active ones, email on. Returns the number of digests claimed.
   */
  async announceExploited(cveIds: string[]): Promise<number> {
    if (cveIds.length === 0) return 0;
    const notified = await this.notifiedTenantIds();
    let claimed = 0;
    for (const tenantId of await this.tenantIds()) {
      if (!notified.has(tenantId)) continue;
      try {
        const digests = await withTenant(this.dataSource, tenantId, (mg) => this.notifier.claimNowExploited(mg, tenantId, cveIds));
        claimed += digests.length;
        void this.notifier.send(tenantId, digests);
      } catch (error: any) {
        this.logger.warn(`[${NVD_FEED_TASK_NAME}] exploited CVE of tenant ${tenantId}: ${String(error?.message ?? error).slice(0, 300)}`);
      }
    }
    return claimed;
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
      url.searchParams.set('resultsPerPage', String(NVD_PAGE_SIZE));
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
   * A row CVE.org wrote (`nvd_status` null) counts only when the CVE was published within
   * `ANNOUNCED_WITHIN_DAYS`. A row the NVD already wrote keeps the rule at any age.
   */
  async store(mg: EntityManager, cves: ParsedCve[]): Promise<string[]> {
    // In cve_id order: the upsert locks its rows in the order the signals task locks them
    // (vulnerability-signals.service.ts, writeOrdered), so the two never deadlock.
    const unique = Array.from(new Map(cves.map((c) => [c.cve_id, c])).values())
      .sort((a, b) => (a.cve_id < b.cve_id ? -1 : a.cve_id > b.cve_id ? 1 : 0));
    // Every step of the statement reads the same snapshot: `old` holds the severities before the upsert.
    const raised: Array<{ cve_id: string }> = await mg.query(
      `WITH old AS (
         SELECT cve_id, severity, nvd_status, published_at FROM vulnerability_cves
          WHERE cve_id IN (SELECT i.cve_id FROM jsonb_to_recordset($1::jsonb) AS i(cve_id text))
       ), up AS (
       INSERT INTO vulnerability_cves AS c (cve_id, summary, cvss_score, severity, cvss_version, cvss_vector, published_at, last_modified_at, nvd_status, reference_urls, fetched_at)
       -- Signal columns (cisa_kev, eu_kev, epss, euvd_id and the rest) are omitted on purpose:
       -- a re-read from the NVD must keep what the signals task stored.
       SELECT i.cve_id, i.summary, i.cvss_score, i.severity, i.cvss_version, i.cvss_vector, i.published_at, i.last_modified_at, i.nvd_status,
              COALESCE(ARRAY(SELECT jsonb_array_elements_text(i.reference_urls)), '{}'), now()
         FROM jsonb_to_recordset($1::jsonb) AS i(
           cve_id text, summary text, cvss_score numeric, severity text, cvss_version text, cvss_vector text,
           published_at timestamptz, last_modified_at timestamptz, nvd_status text, reference_urls jsonb)
        ORDER BY i.cve_id
       ON CONFLICT (cve_id) DO UPDATE SET
         summary = EXCLUDED.summary, cvss_score = EXCLUDED.cvss_score, severity = EXCLUDED.severity,
         cvss_version = EXCLUDED.cvss_version, cvss_vector = EXCLUDED.cvss_vector, published_at = EXCLUDED.published_at,
         last_modified_at = EXCLUDED.last_modified_at, nvd_status = EXCLUDED.nvd_status,
         reference_urls = EXCLUDED.reference_urls, fetched_at = now()
       RETURNING c.cve_id, c.severity, c.published_at
       )
       SELECT up.cve_id FROM up JOIN old ON old.cve_id = up.cve_id
        WHERE up.severity IN ('critical', 'high') AND (old.severity IS NULL OR old.severity NOT IN ('critical', 'high'))
          AND (old.nvd_status IS NOT NULL
               OR COALESCE(up.published_at, old.published_at) >= now() - make_interval(days => $2::int))`,
      [JSON.stringify(unique.map(({ matches: _matches, ...cve }) => ({
        ...cve,
        published_at: utc(cve.published_at),
        last_modified_at: utc(cve.last_modified_at),
      }))), ANNOUNCED_WITHIN_DAYS],
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
