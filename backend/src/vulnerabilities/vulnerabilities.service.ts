import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Features } from '../config/features';
import { cveListEnabled } from './cve-list-feed.service';
import { NvdFeedService } from './nvd-feed.service';
import type { EntityManager } from 'typeorm';
import { AuditService, type AuditSourceOptions } from '../audit/audit.service';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { assertSetFilterModes } from '../common/ag-grid-filtering';
import { languageOf } from '../common/csv-sheet';
import type { CsvLanguage } from '../common/csv-sheet/types';
import { typedTextRows, writeListExport, type ListExportFile } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';
import { readTechnology, technologyReference, UUID_RE } from '../technologies/technology-rows';
import { gridTextClause, gridTextModel } from '../technologies/technologies.service';
import { TechnologyReachService } from '../technologies/technology-reach.service';
import { compareVersionLabels, versionOrderSql } from '../technologies/version-order';
import type { ParsedAffected, ParsedAffectedVersion } from './cve-record';
import { probesOf, productsOf, readCveNames, VulnerabilityMatchService } from './vulnerability-match.service';
import { vulnerabilityAlertsSql } from './vulnerability-alerts';
import { applicationCountsForTenantSql, applicationLinksSql, assetCountsForTenantSql, assetLinksSql, directReachOfTechnologies, EFFECTIVE_SCORE, EFFECTIVE_SEVERITY, exploitedSql, rowOnApplicationsSql, rowOnAssetsSql, technologyInEstateSql } from './vulnerability-reach-counts';
import { severityOf, VULNERABILITY_STATES, type MatchBasis, type VulnerabilityState } from './vulnerability-rules';
import { SIGNAL_FEED_SOURCES, type SignalFeedSource } from './vulnerability-signals.service';

/** The sheet of the vulnerabilities workbook. */
const VULNERABILITIES_SHEET: Record<CsvLanguage, string> = { en: 'Vulnerabilities', fr: 'Vulnérabilités', de: 'Schwachstellen', es: 'Vulnerabilidades' };

export type VulnOpts = {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  /** The audit row's source: the screen leaves it out (`user`), Plaid names its preview. */
  audit?: AuditSourceOptions;
};
/** The applications the caller reads: null without the `applications` read right, a Business Contributor's own only. */
export type ApplicationsAccess = { scope?: ParticipationAccessScope } | null;

/** An option of the page's asset or application filter: its id, its business reference and its name. */
export type VulnerabilitySubjectOption = { id: string; reference: string | null; name: string };

export type VulnerabilityFilters = {
  severity?: unknown;
  state?: unknown;
  editor?: unknown;
  technology?: unknown;
  /**
   * Assets (id or `AST-n`, comma separated): the rows in their direct links
   * (`vulnerability-reach-counts.ts`). An unknown asset is a 400.
   */
  asset?: unknown;
  /**
   * Applications (id or `APP-n`, comma separated): the rows they declare or their servers have in a
   * direct link. An unknown application, or one the user does not read, is a 400.
   */
  application?: unknown;
  /**
   * `1`: the rows whose technology touches the estate (installed on an asset in service or declared
   * by an application in service, `technologyInEstateSql`), as the home tile counts them. `0` or
   * absent: no filter. Anything else is a 400.
   */
  estate?: unknown;
  from?: unknown;
  to?: unknown;
  q?: unknown;
  limit?: unknown;
  offset?: unknown;
  /** The list grid (lot T6b): its JSON filter model, `field:DIR` sort and page from 1. */
  filters?: unknown;
  sort?: unknown;
  page?: unknown;
  /**
   * Which rows the list, the export, the filter values and a bulk `all` reach (lot V1).
   * `included` (default): the rows that alert. `excluded`: the others. `all`: both.
   */
  alerts?: unknown;
  /** `yes` or `no`: known to be exploited (CISA KEV or the EU KEV). */
  exploited?: unknown;
  /** A number: the minimum EPSS probability, from 0 to 1. */
  epss?: unknown;
  /**
   * Which feed produced the row. `nvd` keeps a row the NVD matched, `cve_org` a row CVE.org
   * matched, `both` a row both matched. A row both matched stays in `nvd` and in `cve_org`.
   */
  source?: unknown;
};

/** At most this many rows (technology version and CVE) in one change of state in bulk. */
export const BULK_MAX_ROWS = 5000;
/** Rows written by one statement of a bulk change. */
const BULK_BATCH = 500;

/** Known to be exploited: in the CISA KEV or the EU KEV (a null flag counts as not). */
const EXPLOITED_SQL = exploitedSql('c');
/** The page of a CVE in the European vulnerability database. */
const EUVD_VULNERABILITY_URL = 'https://euvd.enisa.europa.eu/vulnerability/';

/**
 * What the list, the detail, the export and the per-version summary show.
 * The NVD cache wins when it holds a score. A CVE the NVD received and has not scored yet
 * (`cvss_score` null) falls back to the CVE.org record (`r`). The summary text falls back only
 * when the cache summary is blank, whether or not the cache has a score.
 * The severity and the score are `EFFECTIVE_SEVERITY` and `EFFECTIVE_SCORE` of
 * `vulnerability-reach-counts.ts`, the one definition.
 * `score_source` is `nvd` when that cache score belongs to an NVD row (`nvd_status` set). A CVE
 * only CVE.org matched is copied into the cache with `nvd_status` null, and stays `cve_org`.
 */
export const EFFECTIVE_SUMMARY = `(CASE WHEN NULLIF(btrim(c.summary), '') IS NOT NULL THEN c.summary ELSE COALESCE(r.summary, c.summary) END)`;
export const EFFECTIVE_CVSS_VERSION = `(CASE WHEN c.cvss_score IS NOT NULL THEN c.cvss_version ELSE COALESCE(r.cvss_version, c.cvss_version) END)`;
export const EFFECTIVE_CVSS_VECTOR = `(CASE WHEN c.cvss_score IS NOT NULL THEN c.cvss_vector ELSE COALESCE(r.cvss_vector, c.cvss_vector) END)`;
export const SCORE_SOURCE_SQL = `(CASE WHEN COALESCE(c.cvss_score, r.cvss_score) IS NULL THEN NULL WHEN c.cvss_score IS NOT NULL AND c.nvd_status IS NOT NULL THEN 'nvd' ELSE 'cve_org' END)`;
const SEVERITY_ORDER = `CASE ${EFFECTIVE_SEVERITY} WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 WHEN 'none' THEN 1 ELSE 0 END`;

/** The grid's sortable columns. */
const GRID_SORTS: Record<string, string> = {
  severity: 'severity', // SEVERITY_ORDER, then the score
  cvss_score: EFFECTIVE_SCORE,
  published_at: 'c.published_at',
  cve_id: 'c.cve_id',
  technology: 'lower(t.name)',
  epss: 'c.epss',
  exploited: EXPLOITED_SQL,
};

/** Signal columns of the cache, dates and ratios as text so the driver does not shift a day or a decimal. */
const SIGNAL_COLUMNS = `c.cisa_kev, c.kev_added_at::text AS kev_added_at, c.kev_ransomware, c.eu_kev,
            c.epss::text AS epss, c.epss_percentile::text AS epss_percentile, c.epss_date::text AS epss_date, c.euvd_id`;

/** A grid date filter (`equals`, `greaterThan`, `lessThan`, `inRange`) on a day column. */
function gridDateClause(expr: string, model: any, push: (value: unknown) => string): string | null {
  if (!model || model.filterType !== 'date') return null;
  // A real day or nothing: `2026-02-31` parses in JavaScript but not in PostgreSQL (a 400, never a 500).
  const day = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).slice(0, 10);
    if (!DAY_RE.test(text) || Number.isNaN(Date.parse(text)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
      throw new BadRequestException('The publication date filter must be a day (YYYY-MM-DD).');
    }
    return text;
  };
  const from = day(model.dateFrom);
  const to = day(model.dateTo);
  switch (model.type) {
    case 'blank': return `${expr} IS NULL`;
    case 'notBlank': return `${expr} IS NOT NULL`;
    case 'greaterThan': return from ? `${expr} >= (${push(from)}::date + 1)` : null;
    case 'lessThan': return from ? `${expr} < ${push(from)}::date` : null;
    case 'inRange': return from && to ? `${expr} >= ${push(from)}::date AND ${expr} < (${push(to)}::date + 1)` : null;
    default: return from ? `${expr} >= ${push(from)}::date AND ${expr} < (${push(from)}::date + 1)` : null;
  }
}

/** A grid number filter on `expr`. */
function gridNumberClause(expr: string, model: any, push: (value: unknown) => string): string | null {
  if (!model || model.filterType !== 'number') return null;
  const n = Number(model.filter);
  const ok = model.filter !== null && model.filter !== '' && Number.isFinite(n);
  const ops: Record<string, string> = { equals: '=', notEqual: '<>', lessThan: '<', lessThanOrEqual: '<=', greaterThan: '>', greaterThanOrEqual: '>=' };
  if (model.type === 'blank') return `${expr} IS NULL`;
  if (model.type === 'notBlank') return `${expr} IS NOT NULL`;
  if (model.type === 'inRange') {
    const to = Number(model.filterTo);
    return ok && Number.isFinite(to) ? `${expr} BETWEEN ${push(n)}::numeric AND ${push(to)}::numeric` : null;
  }
  return ok && ops[model.type ?? 'equals'] ? `${expr} ${ops[model.type ?? 'equals']} ${push(n)}::numeric` : null;
}

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;
/** At most this many rows in one exported file. */
const EXPORT_LIMIT = 10000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Versions of one CVE.org block shown on a detail row. The rest stay counted. */
const MATCH_VERSION_CAP = 20;

type Row = {
  id: string;
  technology_id: string;
  technology_version_id: string | null;
  cve_id: string;
  state: VulnerabilityState;
  note: string | null;
  match_basis: MatchBasis;
  matching: boolean;
  detected_at: Date;
  state_changed_at: Date | null;
  state_changed_by_name: string | null;
  technology_name: string;
  technology_item_number: number;
  editor: string | null;
  version_label: string | null;
  /** Whether this row alerts: the version's exception, or the technology's setting. */
  alerts: boolean;
  /** The feeds that produced the row, as stored (`cve_org`, `nvd`, or both). */
  match_sources: string[] | null;
};

/** A row of the list grid: the row, with its CVE. */
type GridRow = Row & Omit<Cve, 'cvss_vector' | 'reference_urls'>;

type Cve = {
  cve_id: string;
  summary: string | null;
  cvss_score: string | null;
  /** `nvd` when the cache score is an NVD row, `cve_org` when the shown score is the record's, null with no score. */
  score_source: 'nvd' | 'cve_org' | null;
  severity: string | null;
  cvss_version: string | null;
  cvss_vector: string | null;
  published_at: Date | null;
  last_modified_at: Date | null;
  nvd_status: string | null;
  reference_urls: string[];
  cisa_kev: boolean | null;
  kev_added_at: string | null;
  kev_ransomware: boolean | null;
  eu_kev: boolean | null;
  epss: string | null;
  epss_percentile: string | null;
  epss_date: string | null;
  euvd_id: string | null;
};

/** The CVE.org record beside the cache, when `cves()` joined it. Absent from a list row. */
type CveWithRecord = Cve & {
  record_cve_id: string | null;
  record_assigner: string | null;
  record_published_at: Date | null;
  record_updated_at: Date | null;
  record_state: string | null;
};

function commaList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return Array.from(new Set(raw.split(',').map((v) => v.trim()).filter(Boolean)));
}

function cveIdOrThrow(value: unknown): string {
  const id = String(value ?? '').trim().toUpperCase();
  if (!CVE_RE.test(id)) throw new NotFoundException('Vulnerability not found');
  return id;
}

function dayText(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return DAY_RE.test(text) ? text : null;
}

function ratio(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `yes` / `true` / `1`, `no` / `false` / `0`, or nothing. Anything else is a 400. */
function exploitedChoice(value: unknown): boolean | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'yes' || raw === 'true' || raw === '1') return true;
  if (raw === 'no' || raw === 'false' || raw === '0') return false;
  throw new BadRequestException('exploited must be yes or no.');
}

/** `1`: only the rows touching the estate. `0` or nothing: no filter. Anything else is a 400. */
function estateChoice(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  if (raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new BadRequestException('estate must be 1 or 0.');
}

const MATCH_SOURCES = ['cve_org', 'nvd'] as const;
type MatchSource = (typeof MATCH_SOURCES)[number];

/** The feeds of a row, in a stable order (`cve_org`, then `nvd`). */
function sortedSources(value: unknown): MatchSource[] {
  const raw = Array.isArray(value) ? value : [];
  const found = new Set(raw.filter((item): item is MatchSource => item === 'nvd' || item === 'cve_org'));
  return MATCH_SOURCES.filter((source) => found.has(source));
}

/** The CSV cell: `NVD`, `CVE.org`, or `NVD, CVE.org`. */
function sourceLabel(sources: readonly MatchSource[]): string {
  const labels: string[] = [];
  if (sources.includes('nvd')) labels.push('NVD');
  if (sources.includes('cve_org')) labels.push('CVE.org');
  return labels.join(', ');
}

/** `nvd`, `cve_org` or `both`, or nothing. Anything else is a 400. */
function sourceChoice(value: unknown): 'nvd' | 'cve_org' | 'both' | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'nvd' || raw === 'cve_org' || raw === 'both') return raw;
  throw new BadRequestException('source must be nvd, cve_org or both.');
}

/** A row the named feed matched. `both` keeps a row both feeds matched. */
const SOURCE_SQL: Record<'nvd' | 'cve_org' | 'both', string> = {
  nvd: `'nvd' = ANY (tv.match_sources)`,
  cve_org: `'cve_org' = ANY (tv.match_sources)`,
  both: `tv.match_sources @> ARRAY['cve_org', 'nvd']::text[]`,
};

/** The minimum EPSS probability, or nothing. A value that is not a number from 0 to 1 is a 400. */
function epssMinimum(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new BadRequestException('epss must be a number from 0 to 1.');
  return n;
}

function presentCve(c: Omit<Cve, 'cvss_vector' | 'reference_urls'>) {
  const cisa = c.cisa_kev === true;
  const eu = c.eu_kev === true;
  return {
    cve_id: c.cve_id,
    summary: c.summary,
    cvss_score: c.cvss_score == null ? null : Number(c.cvss_score),
    score_source: c.score_source === 'nvd' || c.score_source === 'cve_org' ? c.score_source : null,
    severity: c.severity,
    cvss_version: c.cvss_version,
    published_at: c.published_at,
    last_modified_at: c.last_modified_at,
    nvd_status: c.nvd_status,
    cisa_kev: cisa,
    eu_kev: eu,
    exploited: cisa || eu,
    kev_added_at: dayText(c.kev_added_at),
    kev_ransomware: c.kev_ransomware == null ? null : c.kev_ransomware === true,
    epss: ratio(c.epss),
    epss_percentile: ratio(c.epss_percentile),
    epss_date: dayText(c.epss_date),
    euvd_id: c.euvd_id ?? null,
  };
}

function presentRow(r: Row) {
  return {
    id: r.id,
    technology_version_id: r.technology_version_id,
    version_label: r.version_label,
    /** No version named: the technology is in use with links that name none. */
    potential: r.match_basis === 'version_unknown',
    match_basis: r.match_basis,
    matching: r.matching,
    state: r.state,
    note: r.note,
    state_changed_at: r.state_changed_at,
    state_changed_by_name: r.state_changed_by_name,
    detected_at: r.detected_at,
    alerts: r.alerts,
    match_sources: sortedSources(r.match_sources),
  };
}

type FeedMatch = { source: MatchSource; [key: string]: unknown };

/** Rows of one CVE grouped per technology, versions by label (unknown version last). */
function groupByTechnology(rows: Row[], matchesByTechnology: Map<string, Record<MatchSource, FeedMatch[]>>) {
  const byTech = new Map<string, { technology_id: string; reference: string | null; name: string; editor: string | null; versions: Array<ReturnType<typeof presentRow> & { matches: FeedMatch[] }> }>();
  for (const r of rows) {
    const entry = byTech.get(r.technology_id) ?? {
      technology_id: r.technology_id,
      reference: technologyReference(r.technology_item_number),
      name: r.technology_name,
      editor: r.editor,
      versions: [],
    };
    const prepared = matchesByTechnology.get(r.technology_id) ?? { cve_org: [], nvd: [] };
    // A version the feed did not match carries none of that feed's criteria.
    const matches = sortedSources(r.match_sources).flatMap((source) => prepared[source]);
    entry.versions.push({ ...presentRow(r), matches });
    byTech.set(r.technology_id, entry);
  }
  const list = Array.from(byTech.values());
  for (const t of list) {
    // Newest number first (`version-order.ts`), the unknown version last.
    t.versions.sort((a, b) => (a.version_label == null ? 1 : 0) - (b.version_label == null ? 1 : 0)
      || compareVersionLabels(a.version_label, b.version_label));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

const rowKey = (technologyId: string, versionId: string | null) => `${technologyId}|${versionId ?? ''}`;

type NvdCriterion = {
  product: string;
  version_exact: string | null;
  version_start: string | null;
  start_including: boolean | null;
  version_end: string | null;
  end_including: boolean | null;
};

type AffectedRow = {
  id: string;
  container: 'cna' | 'adp';
  vendor: string | null;
  product: string | null;
  vendor_key: string;
  product_key: string;
  default_status: ParsedAffected['default_status'];
  versions: unknown;
  cpe_products: string[] | null;
  cpes: string[] | null;
  package_name: string | null;
  collection_url: string | null;
  platforms: string[] | null;
  modules: string[] | null;
};

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** One NVD bound, with only the ends the criterion carries. */
function presentBound(row: NvdCriterion): Record<string, string | boolean> {
  const bound: Record<string, string | boolean> = {};
  if (row.version_exact) bound.exact = row.version_exact;
  if (row.version_start) {
    bound.start = row.version_start;
    bound.start_including = row.start_including === true;
  }
  if (row.version_end) {
    bound.end = row.version_end;
    bound.end_including = row.end_including === true;
  }
  return bound;
}

function boundSortKey(bound: Record<string, string | boolean>): string {
  return `${bound.exact ?? ''}\0${bound.start ?? ''}\0${bound.end ?? ''}`;
}

/** `*`, `-` or nothing: that side of the bound is open, as the row's text reads it. */
function openBound(value: string | boolean | undefined): boolean {
  if (typeof value !== 'string') return true;
  const text = value.trim();
  return text === '' || text === '*' || text === '-';
}

/**
 * Identity of one displayed bound. An exact version is the whole text. An open end does not
 * count, and neither does its flag. The same key as the page (`feedText.ts`).
 */
function nvdBoundKey(bound: Record<string, string | boolean>): string {
  const text = (value: string | boolean | undefined) => (openBound(value) || typeof value !== 'string' ? '' : value.trim());
  const exact = text(bound.exact);
  if (exact) return `e\0${exact}`;
  const start = text(bound.start);
  const end = text(bound.end);
  const flag = (side: string, value: string | boolean | undefined) => (side && value === true ? '1' : '0');
  return ['r', start, flag(start, bound.start_including), end, flag(end, bound.end_including)].join('\0');
}

/** First occurrence of each bound. The caller sorts afterwards, so the order stays the sort order. */
export function dedupeNvdBounds(versions: Array<Record<string, string | boolean>>): Array<Record<string, string | boolean>> {
  const seen = new Set<string>();
  const out: Array<Record<string, string | boolean>> = [];
  for (const bound of versions) {
    const key = nvdBoundKey(bound);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bound);
  }
  return out;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Vulnerable criteria of this CVE whose product the technology declares, one object per product. */
function nvdMatches(criteria: NvdCriterion[], products: string[]): FeedMatch[] {
  const wanted = new Set(products);
  const byProduct = new Map<string, Array<Record<string, string | boolean>>>();
  for (const row of criteria) {
    const product = String(row.product ?? '').toLowerCase();
    if (!wanted.has(product)) continue;
    const list = byProduct.get(product) ?? [];
    list.push(presentBound(row));
    byProduct.set(product, list);
  }
  return Array.from(byProduct.entries())
    .sort((a, b) => compareText(a[0], b[0]))
    .map(([cpe, versions]) => ({
      source: 'nvd' as const,
      cpe,
      versions: dedupeNvdBounds(versions).sort((a, b) => compareText(boundSortKey(a), boundSortKey(b))),
    }));
}

function compactVersion(value: unknown): ParsedAffectedVersion {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    version: textOrNull(item.version),
    status: item.status === 'affected' || item.status === 'unaffected' || item.status === 'unknown' ? item.status : null,
    versionType: textOrNull(item.versionType),
    lessThan: textOrNull(item.lessThan),
    lessThanOrEqual: textOrNull(item.lessThanOrEqual),
    changes: Array.isArray(item.changes) ? item.changes as ParsedAffectedVersion['changes'] : [],
  };
}

/** CVE.org blocks this technology reaches, by a name or by a CPE product. `probesOf` decides. */
function orgMatches(blocks: AffectedRow[], names: ReturnType<typeof readCveNames>, products: string[]): FeedMatch[] {
  const matched = blocks.flatMap((block) => {
    const parsed: ParsedAffected = {
      container: block.container,
      vendor: block.vendor,
      product: block.product,
      vendor_key: block.vendor_key,
      product_key: block.product_key,
      default_status: block.default_status,
      versions: [],
      cpe_products: block.cpe_products ?? [],
      cpes: block.cpes ?? [],
      package_name: block.package_name,
      collection_url: block.collection_url,
      platforms: block.platforms ?? [],
      modules: block.modules ?? [],
    };
    const probes = probesOf(names, products, parsed);
    if (probes.length === 0) return [];
    const versions = Array.isArray(block.versions) ? block.versions : [];
    const item: FeedMatch = {
      source: 'cve_org',
      vendor: block.vendor,
      product: block.product,
      cpe: probes.find((probe) => probe.precisionProduct)?.precisionProduct ?? null,
      container: block.container,
      default_status: block.default_status,
      versions: versions.slice(0, MATCH_VERSION_CAP).map(compactVersion),
      versions_total: versions.length,
    };
    if (block.package_name) item.package_name = block.package_name;
    if (block.platforms && block.platforms.length > 0) item.platforms = block.platforms;
    if (block.modules && block.modules.length > 0) item.modules = block.modules;
    return [{ item, vendor: block.vendor ?? '', product: block.product ?? '', container: block.container, id: Number(block.id) }];
  });
  matched.sort((a, b) => compareText(a.vendor, b.vendor) || compareText(a.product, b.product) || compareText(a.container, b.container) || a.id - b.id);
  return matched.map((entry) => entry.item);
}

/** An error kept from an attempt that is newer than the last success. No success yet counts as newer. */
function feedFailing(row: { last_error: string | null; last_attempt_at: Date | string | null; last_success_at: Date | string | null } | undefined): boolean {
  if (!row?.last_error || !row.last_attempt_at) return false;
  if (!row.last_success_at) return true;
  return new Date(row.last_attempt_at).getTime() > new Date(row.last_success_at).getTime();
}

/**
 * How fresh each feed is, as the page reads it (`GET /vulnerabilities/sources`, field `items`)
 * and the assistant (`feeds`). Both sources are always named, with null dates when no pass has
 * written a row. `failing` is true when the last attempt is newer than the last success and an
 * error was kept. The error text stays in the database: it can name a mirror.
 * `vulnerability_feed_sources` is a platform table, shared by every tenant: it has no tenant column.
 * The exploitation catalogues are `vulnerabilitySignalSources` (the route's `signals`). This
 * function stays on NVD and CVE.org: the assistant's type names only those two.
 */
export async function vulnerabilityFeedSources(mg: Pick<EntityManager, 'query'>) {
  const rows: Array<{ source: string; last_success_at: Date | null; last_attempt_at: Date | null; last_error: string | null }> = await mg.query(
    `SELECT source, last_success_at, last_attempt_at, last_error
       FROM vulnerability_feed_sources
      WHERE source = ANY($1::text[])`,
    [['nvd', 'cve_org']],
  );
  const bySource = new Map(rows.map((row) => [row.source, row]));
  const enabled: Record<MatchSource, boolean> = {
    nvd: Features.VULNERABILITY_FEED_ENABLED,
    cve_org: cveListEnabled(),
  };
  return (['nvd', 'cve_org'] as const).map((source) => {
    const row = bySource.get(source);
    return {
      source,
      last_success_at: row?.last_success_at ?? null,
      last_attempt_at: row?.last_attempt_at ?? null,
      failing: feedFailing(row),
      enabled: enabled[source],
    };
  });
}

/** One exploitation catalogue of `GET /vulnerabilities/sources` (`signals`). */
export type VulnerabilitySignalSource = {
  source: SignalFeedSource;
  last_success_at: Date | null;
  last_attempt_at: Date | null;
  failing: boolean;
  /** The vulnerability feed: the catalogues are read by that task, and by no switch of their own. */
  enabled: boolean;
  /** EPSS: the day of the scores (`cursor.score_date`). Null for the other catalogues. */
  score_date: string | null;
};

const SCORE_DAY = /^\d{4}-\d{2}-\d{2}$/;

function scoreDateOf(cursor: unknown): string | null {
  if (!cursor || typeof cursor !== 'object') return null;
  const value = (cursor as { score_date?: unknown }).score_date;
  return typeof value === 'string' && SCORE_DAY.test(value) ? value : null;
}

/**
 * How fresh each exploitation catalogue is. The four are always named, with null dates when no
 * pass has written a row. Same `failing` rule as `vulnerabilityFeedSources`, and the error text
 * stays in the database. `score_date` is the EPSS file's day of scores. `enabled` follows the
 * vulnerability feed: there is no separate switch.
 */
export async function vulnerabilitySignalSources(mg: Pick<EntityManager, 'query'>): Promise<VulnerabilitySignalSource[]> {
  const rows: Array<{ source: string; last_success_at: Date | null; last_attempt_at: Date | null; last_error: string | null; cursor: unknown }> = await mg.query(
    `SELECT source, last_success_at, last_attempt_at, last_error, cursor
       FROM vulnerability_feed_sources
      WHERE source = ANY($1::text[])`,
    [SIGNAL_FEED_SOURCES],
  );
  const bySource = new Map(rows.map((row) => [row.source, row]));
  const enabled = Features.VULNERABILITY_FEED_ENABLED;
  return SIGNAL_FEED_SOURCES.map((source) => {
    const row = bySource.get(source);
    return {
      source,
      last_success_at: row?.last_success_at ?? null,
      last_attempt_at: row?.last_attempt_at ?? null,
      failing: feedFailing(row),
      enabled,
      score_date: source === 'epss' ? scoreDateOf(row?.cursor) : null,
    };
  });
}

function presentRecord(cve: CveWithRecord) {
  if (!cve.record_cve_id) return null;
  return {
    assigner: cve.record_assigner,
    published_at: cve.record_published_at,
    updated_at: cve.record_updated_at,
    state: cve.record_state,
  };
}

/**
 * The ids of the assets or applications `refs` name (an id or a business reference, `AST-n` or
 * `APP-n`, without case), and the references that name none. An application the user does not
 * read is unknown. One query, before the rows are read: a filter never reads them per row (the
 * page's filters and the assistant's, `ai-vulnerabilities.query.ts`).
 */
export async function vulnerabilitySubjectIds(
  mg: Pick<EntityManager, 'query'>,
  tenantId: string,
  kind: 'asset' | 'application',
  refs: string[],
  applications: ApplicationsAccess,
): Promise<{ ids: string[]; unknown: string[] }> {
  if (kind === 'application' && !applications) return { ids: [], unknown: refs };
  const wanted = refs.map((ref) => ref.toUpperCase());
  const params: unknown[] = [tenantId, wanted];
  const [table, reference] = kind === 'asset' ? ['assets', 'asset_reference'] : ['applications', 'sequential_id'];
  const scopeSql = kind === 'application' && applications?.scope
    ? (params.push(applications.scope.userId), `AND ${applicationParticipantCondition('s', `$${params.length}`)}`)
    : '';
  const found: Array<{ id: string; ref: string | null }> = await mg.query(
    `SELECT s.id::text AS id, upper(s.${reference}) AS ref
       FROM ${table} s
      WHERE s.tenant_id = $1 AND (upper(s.id::text) = ANY($2::text[]) OR upper(s.${reference}) = ANY($2::text[])) ${scopeSql}`,
    params,
  );
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const [i, ref] of wanted.entries()) {
    const hits = found.filter((row) => row.id.toUpperCase() === ref || row.ref === ref);
    if (hits.length === 0) unknown.push(refs[i]);
    for (const hit of hits) ids.add(hit.id);
  }
  return { ids: Array.from(ids), unknown };
}

/**
 * The vulnerabilities of a tenant (lot T6a): the rows of `technology_vulnerabilities` with the
 * CVE of the platform cache, and the servers and applications they reach. A row with a version
 * reaches the servers and applications whose link names that version; a row without version,
 * those whose link names none. Every count of servers and applications is of direct links
 * (`vulnerability-reach-counts.ts`), the servers as the technology list counts them (clusters
 * excluded, `TechnologyReachService.serversOfTechnologies`); the panel also lists what the deductions of the technology
 * layer reach through another asset (`TechnologyReachService`), marked and not counted.
 */
@Injectable()
export class VulnerabilitiesService {
  constructor(
    private readonly reach: TechnologyReachService,
    private readonly matcher: VulnerabilityMatchService,
    private readonly audit: AuditService,
    @Optional() private readonly feed?: NvdFeedService,
  ) {}

  /** `vulnerabilitySubjectIds` for the query parameters: a reference that names nothing is a 400. */
  private async subjectIdsOrThrow(
    mg: EntityManager,
    tenantId: string,
    kind: 'asset' | 'application',
    refs: string[],
    applications: ApplicationsAccess,
  ): Promise<string[]> {
    const { ids, unknown } = await vulnerabilitySubjectIds(mg, tenantId, kind, refs, applications);
    if (unknown.length) throw new BadRequestException(`${kind} ${unknown[0]} is not an ${kind} of this workspace.`);
    return ids;
  }

  /**
   * The WHERE clause of the filters, on `tv` (rows), `t` (technologies), `c` (cache) and `r` (CVE.org
   * record). `applications` is what the user reads: the application filters stay inside it.
   * `params` starts with the tenant (`$1`), as every caller's `tv.tenant_id = $1`.
   */
  private async filterSql(mg: EntityManager, tenantId: string, filters: VulnerabilityFilters, params: unknown[], applications: ApplicationsAccess): Promise<string> {
    const where: string[] = [];
    const push = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const severities = commaList(filters.severity);
    if (severities.length) {
      const valid = severities.map(severityOf);
      if (valid.some((s) => !s)) throw new BadRequestException('severity must be critical, high, medium, low or none.');
      where.push(`${EFFECTIVE_SEVERITY} = ANY(${push(valid)}::text[])`);
    }
    const states = commaList(filters.state);
    if (states.length) {
      if (states.some((s) => !(VULNERABILITY_STATES as readonly string[]).includes(s))) {
        throw new BadRequestException('state must be to_review, handled or not_affected.');
      }
      where.push(`tv.state = ANY(${push(states)}::text[])`);
    }
    const editors = commaList(filters.editor).map((e) => e.toLowerCase());
    if (editors.length) where.push(`lower(t.editor) = ANY(${push(editors)}::text[])`);
    const technologies = commaList(filters.technology);
    if (technologies.length) {
      const ids: string[] = [];
      for (const ref of technologies) {
        try {
          ids.push((await readTechnology(mg, tenantId, ref)).id);
        } catch (error) {
          if (error instanceof NotFoundException) throw new BadRequestException(`technology ${ref} is not a technology of this workspace.`);
          throw error;
        }
      }
      where.push(`tv.technology_id = ANY(${push(ids)}::uuid[])`);
    }
    // Direct links only (`vulnerability-reach-counts.ts`), as the counts.
    const assets = commaList(filters.asset);
    if (assets.length) where.push(rowOnAssetsSql({ tenant: '$1', ids: push(await this.subjectIdsOrThrow(mg, tenantId, 'asset', assets, applications)) }));
    const apps = commaList(filters.application);
    if (apps.length) where.push(rowOnApplicationsSql({ tenant: '$1', ids: push(await this.subjectIdsOrThrow(mg, tenantId, 'application', apps, applications)) }));
    if (estateChoice(filters.estate)) where.push(technologyInEstateSql('tv'));
    for (const [key, op] of [['from', '>='], ['to', '<']] as const) {
      const value = String(filters[key] ?? '').trim();
      if (!value) continue;
      // A real day: `2026-02-31` parses in JavaScript but not in PostgreSQL.
      if (!DAY_RE.test(value) || Number.isNaN(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${key} must be a day (YYYY-MM-DD).`);
      // `to` is inclusive: before the next day.
      where.push(key === 'from' ? `c.published_at ${op} ${push(value)}::date` : `c.published_at ${op} (${push(value)}::date + 1)`);
    }
    const q = String(filters.q ?? '').trim();
    if (q) {
      const like = push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`(tv.cve_id ILIKE ${like} OR t.name ILIKE ${like} OR ${EFFECTIVE_SUMMARY} ILIKE ${like})`);
    }
    const exploited = exploitedChoice(filters.exploited);
    if (exploited !== null) where.push(exploited ? EXPLOITED_SQL : `NOT ${EXPLOITED_SQL}`);
    const source = sourceChoice(filters.source);
    if (source) where.push(SOURCE_SQL[source]);
    const epssMin = epssMinimum(filters.epss);
    if (epssMin !== null) where.push(`c.epss >= ${push(epssMin)}::numeric`);
    where.push(...await this.gridClauses(mg, tenantId, filters.filters, push, applications));
    const alerts = this.alertsClause(filters);
    if (alerts) where.push(alerts);
    return where.length ? `AND ${where.join(' AND ')}` : '';
  }

  /**
   * Rows that alert, the others, or both. Empty is `included`. A row alerts when
   * `COALESCE(version.vulnerability_alerts, technology.vulnerability_alerts)` is true.
   */
  private alertsClause(filters: VulnerabilityFilters): string {
    const raw = String(filters.alerts ?? '').trim().toLowerCase();
    const mode = raw === '' ? 'included' : raw;
    const alerts = vulnerabilityAlertsSql('v', 't');
    if (mode === 'all') return '';
    if (mode === 'excluded') return `NOT ${alerts}`;
    if (mode === 'included') return alerts;
    throw new BadRequestException('alerts must be included, excluded or all.');
  }

  /**
   * The list grid's filter model (lots T6b, T6c), on rows: set filters on `severity`, `state`,
   * `editor` (without case), `technology` (id or `TEC-n`; an unknown one matches nothing) and
   * `version` (labels, `null` for the rows without version), text filters on `cve_id` and
   * `summary`, a number filter on `cvss_score` and `epss`, a date filter on `published_at`, a set
   * filter on `exploited` (`yes` / `no`; an unknown value matches nothing; `yes` and `no`
   * together match every row) and on `source` (`nvd`, `cve_org`, `both`; an unknown value
   * matches nothing, several match the rows any of them would keep); set filters on `asset` and
   * `application` (id, `AST-n` or `APP-n`: the rows in their direct links, as
   * `vulnerability-reach-counts.ts` counts them; an unknown asset, or an application unknown or
   * outside what the user reads, matches nothing; several values keep the rows of any of them, and
   * the two columns together the rows of both: the page's Servers and Applications columns).
   * An unreadable model or another column is ignored; `technologies` (the name before T6c) reads
   * as `technology`; a set filter in exclude mode is a 400. The assets and applications are read
   * once (`vulnerabilitySubjectIds`), before the rows; the tenant is `$1`.
   */
  private async gridClauses(mg: EntityManager, tenantId: string, raw: unknown, push: (value: unknown) => string, applications: ApplicationsAccess): Promise<string[]> {
    let model: Record<string, any>;
    try {
      model = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, any>);
    } catch {
      return [];
    }
    if (!model || typeof model !== 'object') return [];
    // These set filters read the ticked values: an exclude model is a 400, never read as an include.
    assertSetFilterModes(model);
    // The column's name before lot T6c, in filters saved then (a link, a list context).
    if (model.technology === undefined && model.technologies !== undefined) model = { ...model, technology: model.technologies };
    const out: string[] = [];
    const setValues = (column: string): string[] | null => {
      const m = model[column];
      if (!m || m.filterType !== 'set' || !Array.isArray(m.values)) return null;
      return m.values.filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '').map((v: string) => v.trim());
    };
    for (const [column, expr] of [['severity', EFFECTIVE_SEVERITY], ['state', 'tv.state']] as const) {
      const values = setValues(column);
      if (values) out.push(values.length ? `${expr} = ANY(${push(values)}::text[])` : 'false');
    }
    const editors = setValues('editor');
    if (editors) out.push(editors.length ? `lower(t.editor) = ANY(${push(editors.map((e) => e.toLowerCase()))}::text[])` : 'false');
    const technologies = setValues('technology');
    if (technologies) {
      if (technologies.length === 0) out.push('false');
      else {
        const p = push(technologies.map((v) => v.toUpperCase()));
        out.push(`(upper(t.id::text) = ANY(${p}::text[]) OR ('TEC-' || t.item_number) = ANY(${p}::text[]))`);
      }
    }
    // Unknown references, or applications the user does not read, are left out; none left: nothing matches.
    for (const kind of ['asset', 'application'] as const) {
      const refs = setValues(kind);
      if (!refs) continue;
      const ids = refs.length ? (await vulnerabilitySubjectIds(mg, tenantId, kind, refs, applications)).ids : [];
      if (ids.length === 0) out.push('false');
      else out.push((kind === 'asset' ? rowOnAssetsSql : rowOnApplicationsSql)({ tenant: '$1', ids: push(ids) }));
    }
    // Versions by label (one label may name a version of several technologies); `null`: not recorded.
    const versions = setValues('version');
    if (versions) {
      const parts: string[] = [];
      if (versions.length) parts.push(`v.label = ANY(${push(versions)}::text[])`);
      if ((model.version.values as unknown[]).some((value) => value === null)) parts.push('tv.technology_version_id IS NULL');
      out.push(parts.length ? `(${parts.join(' OR ')})` : 'false');
    }
    const json = typeof raw === 'string' ? raw : JSON.stringify(model);
    for (const [column, expr] of [['cve_id', 'tv.cve_id'], ['summary', EFFECTIVE_SUMMARY]] as const) {
      const clause = gridTextClause(expr, gridTextModel(json, column), push);
      if (clause) out.push(clause);
    }
    const score = gridNumberClause(EFFECTIVE_SCORE, model.cvss_score, push);
    if (score) out.push(score);
    const epss = gridNumberClause('c.epss', model.epss, push);
    if (epss) out.push(epss);
    const exploited = setValues('exploited');
    if (exploited) {
      const yes = exploited.some((v) => v.toLowerCase() === 'yes' || v.toLowerCase() === 'true' || v === '1');
      const no = exploited.some((v) => v.toLowerCase() === 'no' || v.toLowerCase() === 'false' || v === '0');
      if (!yes && !no) out.push('false');
      else if (yes && !no) out.push(EXPLOITED_SQL);
      else if (no && !yes) out.push(`NOT ${EXPLOITED_SQL}`);
    }
    const sources = setValues('source');
    if (sources) {
      const parts = sources
        .map((value) => value.toLowerCase())
        .filter((value): value is 'nvd' | 'cve_org' | 'both' => value === 'nvd' || value === 'cve_org' || value === 'both')
        .map((value) => SOURCE_SQL[value]);
      out.push(parts.length ? `(${parts.join(' OR ')})` : 'false');
    }
    const published = gridDateClause('c.published_at', model.published_at, push);
    if (published) out.push(`(${published})`);
    return out;
  }

  /**
   * What each feed matched, per technology, recomputed from the cache. A version drops a feed it
   * was not matched by (`groupByTechnology`). Nothing is stored.
   */
  private async sourceMatches(mg: EntityManager, tenantId: string, cveId: string, technologyIds: string[]) {
    const map = new Map<string, Record<MatchSource, FeedMatch[]>>();
    if (technologyIds.length === 0) return map;
    const techs: Array<{ id: string; cpe_products: string[] | null; cve_names: unknown }> = await mg.query(
      `SELECT id, cpe_products, cve_names FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, technologyIds],
    );
    const criteria: NvdCriterion[] = await mg.query(
      `SELECT product, version_exact, version_start, start_including, version_end, end_including
         FROM vulnerability_cve_matches
        WHERE cve_id = $1 AND vulnerable`,
      [cveId],
    );
    const blocks: AffectedRow[] = await mg.query(
      `SELECT id::text AS id, container, vendor, product, vendor_key, product_key, default_status, versions,
              cpe_products, cpes, package_name, collection_url, platforms, modules
         FROM vulnerability_cve_affected
        WHERE cve_id = $1`,
      [cveId],
    );
    for (const tech of techs) {
      const products = productsOf(tech.cpe_products);
      const names = readCveNames(tech.cve_names);
      map.set(tech.id, { nvd: nvdMatches(criteria, products), cve_org: orgMatches(blocks, names, products) });
    }
    return map;
  }

  /** The rows with their technology, CVE and version (`v`, none for the rows without version). */
  private readonly rowsFrom = `
    FROM technology_vulnerabilities tv
    JOIN technologies t ON t.tenant_id = tv.tenant_id AND t.id = tv.technology_id
    JOIN vulnerability_cves c ON c.cve_id = tv.cve_id
    LEFT JOIN vulnerability_cve_records r ON r.cve_id = c.cve_id
    LEFT JOIN technology_versions v ON v.tenant_id = tv.tenant_id AND v.id = tv.technology_version_id`;

  private readonly rowColumns = `tv.id, tv.technology_id, tv.technology_version_id, tv.cve_id, tv.state, tv.note, tv.match_basis, tv.matching,
    tv.detected_at, tv.state_changed_at,
    NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS state_changed_by_name,
    t.name AS technology_name, t.item_number AS technology_item_number, t.editor, v.label AS version_label,
    ${vulnerabilityAlertsSql('v', 't')} AS alerts, tv.match_sources`;

  private readonly usersJoin = `LEFT JOIN users u ON u.tenant_id = tv.tenant_id AND u.id = tv.state_changed_by`;

  private async rowsOf(mg: EntityManager, tenantId: string, extraWhere: string, params: unknown[]): Promise<Row[]> {
    return mg.query(
      `SELECT ${this.rowColumns}
         ${this.rowsFrom}
         ${this.usersJoin}
        WHERE tv.tenant_id = $1 ${extraWhere}
        ORDER BY t.name, ${versionOrderSql('v.label')}`,
      params,
    );
  }

  private async cves(mg: EntityManager, ids: string[]): Promise<Map<string, CveWithRecord>> {
    const rows: CveWithRecord[] = ids.length
      ? await mg.query(
        `SELECT c.cve_id, ${EFFECTIVE_SUMMARY} AS summary, ${EFFECTIVE_SCORE} AS cvss_score,
                ${EFFECTIVE_SEVERITY} AS severity, ${EFFECTIVE_CVSS_VERSION} AS cvss_version,
                ${EFFECTIVE_CVSS_VECTOR} AS cvss_vector, c.published_at,
                c.last_modified_at, c.nvd_status, c.reference_urls, ${SCORE_SOURCE_SQL} AS score_source,
                r.cve_id AS record_cve_id, r.assigner AS record_assigner,
                r.published_at AS record_published_at, r.updated_at AS record_updated_at, r.state AS record_state,
                ${SIGNAL_COLUMNS}
           FROM vulnerability_cves c
           LEFT JOIN vulnerability_cve_records r ON r.cve_id = c.cve_id
          WHERE c.cve_id = ANY($1::text[])`,
        [ids],
      )
      : [];
    return new Map(rows.map((r) => [r.cve_id, r]));
  }

  private async visibleApplicationIds(mg: EntityManager, tenantId: string, ids: string[], scope?: ParticipationAccessScope): Promise<Set<string>> {
    const wanted = Array.from(new Set(ids));
    if (wanted.length === 0) return new Set();
    const params: unknown[] = [tenantId, wanted];
    const scopeSql = scope ? (params.push(scope.userId), `AND ${applicationParticipantCondition('a', `$${params.length}`)}`) : '';
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT a.id::text AS id FROM applications a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[]) ${scopeSql}`,
      params,
    );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * What the rows reach through the asset graph, for the panel's lists: per (technology, version)
   * key, the servers (reached assets, directly or through another asset) and the visible
   * applications (hosted or declared). Applications are null without the read right. Not counted.
   */
  private async graphReach(mg: EntityManager, tenantId: string, rows: Row[], applications: ApplicationsAccess) {
    const techIds = Array.from(new Set(rows.map((r) => r.technology_id)));
    const assets = await this.reach.assetsOfTechnologies(mg, tenantId, techIds);
    const servers = new Map<string, typeof assets>();
    for (const a of assets) {
      const key = rowKey(a.technology_id, a.technology_version_id);
      const list = servers.get(key);
      if (list) list.push(a);
      else servers.set(key, [a]);
    }
    if (!applications) return { servers, apps: null };
    const reached = await this.reach.applicationsOfTechnologies(mg, tenantId, techIds);
    const visible = await this.visibleApplicationIds(mg, tenantId, reached.map((r) => r.application_id), applications.scope);
    const apps = new Map<string, typeof reached>();
    for (const a of reached) {
      if (!visible.has(a.application_id)) continue;
      const key = rowKey(a.technology_id, a.technology_version_id);
      const list = apps.get(key);
      if (list) list.push(a);
      else apps.set(key, [a]);
    }
    return { servers, apps };
  }

  /**
   * The direct reach of the rows (`vulnerability-reach-counts.ts`), what every count reads: per
   * (technology, version) key, the servers it is installed on as the technology list counts them
   * (`TechnologyReachService.serversOfTechnologies`: in service, clusters excluded), the assets in
   * service whose direct links name it (`installed`, clusters included: the panel's direct marks),
   * and the visible applications that declare it or whose server has it in a direct link.
   * Applications are null without the read right.
   */
  private async reachOf(mg: EntityManager, tenantId: string, rows: Row[], applications: ApplicationsAccess) {
    const techIds = Array.from(new Set(rows.map((r) => r.technology_id)));
    const direct = await directReachOfTechnologies(mg, tenantId, techIds, applications !== null);
    const add = (map: Map<string, Set<string>>, key: string, id: string) => {
      const set = map.get(key);
      if (set) set.add(id);
      else map.set(key, new Set([id]));
    };
    const servers = new Map<string, Set<string>>();
    for (const a of await this.reach.serversOfTechnologies(mg, tenantId, techIds)) add(servers, rowKey(a.technology_id, a.technology_version_id), a.asset_id);
    const installed = new Map<string, Set<string>>();
    for (const a of direct.assets) add(installed, rowKey(a.technology_id, a.technology_version_id), a.asset_id);
    if (!applications) return { servers, installed, apps: null };
    const visible = await this.visibleApplicationIds(mg, tenantId, direct.applications.map((a) => a.application_id), applications.scope);
    const apps = new Map<string, Set<string>>();
    for (const a of direct.applications) {
      if (visible.has(a.application_id)) add(apps, rowKey(a.technology_id, a.technology_version_id), a.application_id);
    }
    return { servers, installed, apps };
  }

  /** Counts of distinct servers and applications a set of rows reaches by direct links. */
  private counts(rows: Row[], reach: Awaited<ReturnType<VulnerabilitiesService['reachOf']>>) {
    const servers = new Set<string>();
    const apps = new Set<string>();
    for (const r of rows) {
      const key = rowKey(r.technology_id, r.technology_version_id);
      for (const id of reach.servers.get(key) ?? []) servers.add(id);
      for (const id of reach.apps?.get(key) ?? []) apps.add(id);
    }
    return { servers: servers.size, applications: reach.apps ? apps.size : null };
  }

  /** How fresh each feed is (`vulnerabilityFeedSources`) and each exploitation catalogue (`vulnerabilitySignalSources`). */
  async sources(opts: VulnOpts) {
    return {
      items: await vulnerabilityFeedSources(opts.manager),
      signals: await vulnerabilitySignalSources(opts.manager),
    };
  }

  /**
   * The rows (technology, version and CVE) that concern the tenant, filtered, exploited first and
   * then most severe, paged by row (lot T6c: the unit that carries the state).
   */
  async list(filters: VulnerabilityFilters, opts: VulnOpts, applications: ApplicationsAccess) {
    const { items, total, cves, limit, offset } = await this.listRows(filters, opts, applications, true);
    return { items, total, cves, limit, offset };
  }

  private async listRows(filters: VulnerabilityFilters, opts: VulnOpts, applications: ApplicationsAccess, paging: boolean) {
    const { manager: mg, tenantId } = opts;
    const whole = (value: unknown, fallback: number, max: number) => {
      const n = Math.floor(Number(value));
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : fallback;
    };
    const limit = paging ? Math.max(whole(filters.limit, 50, 200), 1) : EXPORT_LIMIT;
    // `offset`, or the grid's `page` (from 1).
    const offset = !paging ? 0
      : filters.offset !== undefined ? whole(filters.offset, 0, 1_000_000_000)
        : Math.max(whole(filters.page, 1, 10_000_000) - 1, 0) * limit;
    // The grid's `field:DIR`. Omitted: exploited first, then most severe.
    const [sortField, sortDir] = String(filters.sort ?? '').split(':');
    // Own keys only (`constructor` or `__proto__` would read the prototype); another column is a 400.
    if (sortField && !Object.prototype.hasOwnProperty.call(GRID_SORTS, sortField)) {
      throw new BadRequestException('sort must be severity, cvss_score, published_at, cve_id, technology, epss or exploited.');
    }
    const direction = String(sortDir ?? '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    // Then by CVE, technology, version and row: a stable order, so the pages neither repeat nor skip a row.
    const tail = `c.cve_id DESC, lower(t.name), t.id, ${versionOrderSql('v.label')}, tv.id`;
    const severityThen = `${SEVERITY_ORDER} DESC, ${EFFECTIVE_SCORE} DESC NULLS LAST`;
    // Exploited first (the default, and the column itself). An explicit severity sort stays on the
    // severity. Another column: that column, then most severe.
    const order = !sortField || sortField === 'exploited'
      ? `${EXPLOITED_SQL} ${sortField === 'exploited' ? direction : 'DESC'}, ${severityThen}, c.published_at DESC NULLS LAST, ${tail}`
      : sortField === 'severity'
        ? `${SEVERITY_ORDER} ${direction}, ${EFFECTIVE_SCORE} ${direction} NULLS LAST, c.published_at DESC NULLS LAST, ${tail}`
        : sortField === 'technology'
          ? `lower(t.name) ${direction}, t.id, ${severityThen}, ${tail}`
          : `${GRID_SORTS[sortField]} ${direction} NULLS LAST, ${severityThen}, ${tail}`;
    const params: unknown[] = [tenantId];
    const where = await this.filterSql(mg, tenantId, filters, params, applications);
    // The rows and the distinct CVE among them: the grid's total speaks of both.
    const [counted] = await mg.query(
      `SELECT count(*)::int AS rows, count(DISTINCT tv.cve_id)::int AS cves ${this.rowsFrom} WHERE tv.tenant_id = $1 ${where}`,
      params,
    );
    const total = Number(counted?.rows ?? 0);
    const cves = Number(counted?.cves ?? 0);
    if (!paging && total > EXPORT_LIMIT) {
      throw new BadRequestException(`More than ${EXPORT_LIMIT} rows match: narrow the filters to export them.`);
    }
    const rows: GridRow[] = total === 0 ? [] : await mg.query(
      `SELECT ${this.rowColumns},
              ${EFFECTIVE_SUMMARY} AS summary, ${EFFECTIVE_SCORE} AS cvss_score, ${EFFECTIVE_SEVERITY} AS severity,
              ${EFFECTIVE_CVSS_VERSION} AS cvss_version, ${SCORE_SOURCE_SQL} AS score_source,
              c.published_at, c.last_modified_at, c.nvd_status,
              ${SIGNAL_COLUMNS}
         ${this.rowsFrom}
         ${this.usersJoin}
        WHERE tv.tenant_id = $1 ${where}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    // A page past the end (the grid refreshing a block emptied by a change in bulk) keeps the real
    // total, never 0, or the grid would empty itself.
    if (rows.length === 0) return { items: [], total, cves, limit, offset, rows: [] as GridRow[] };
    const reach = await this.reachOf(mg, tenantId, rows, applications);
    const items = rows.map((r) => ({
      id: r.id,
      ...presentCve(r),
      technology: { id: r.technology_id, reference: technologyReference(r.technology_item_number), name: r.technology_name },
      editor: r.editor,
      /** The version's label; null: none recorded, potentially concerned. */
      version: r.version_label,
      technology_version_id: r.technology_version_id,
      potential: r.match_basis === 'version_unknown',
      match_basis: r.match_basis,
      matching: r.matching,
      state: r.state,
      note: r.note,
      state_changed_at: r.state_changed_at,
      state_changed_by_name: r.state_changed_by_name,
      detected_at: r.detected_at,
      alerts: r.alerts,
      match_sources: sortedSources(r.match_sources),
      // The servers and applications of this version, by direct links.
      ...this.counts([r], reach),
    }));
    return { items, total, cves, limit, offset, rows };
  }

  /**
   * The values of the page's filters (`fields`, comma separated). `version`: the labels of the
   * versions the other filters reach, newest number first, `null` last when a row has no version.
   * `asset` and `application`: the assets and applications with at least one vulnerability that
   * counts (`vulnerability-reach-counts.ts`: to review, in the alerts, direct links, in service),
   * whatever the other filters, by name (`subjectOptions`).
   * `applications`: what the user reads (the application filter and options stay inside it).
   */
  async filterValues(
    query: VulnerabilityFilters & { fields?: unknown },
    opts: VulnOpts,
    applications: ApplicationsAccess = null,
  ): Promise<Record<string, Array<string | null> | VulnerabilitySubjectOption[]>> {
    const { manager: mg, tenantId } = opts;
    const out: Record<string, Array<string | null> | VulnerabilitySubjectOption[]> = {};
    const fields = commaList(query.fields);
    for (const kind of ['asset', 'application'] as const) {
      if (fields.includes(kind)) out[kind] = await this.subjectOptions(mg, tenantId, kind, applications);
    }
    if (!fields.includes('version')) return out;
    // The column's own filter does not narrow its values.
    let grid = query.filters;
    try {
      const model = typeof grid === 'string' ? JSON.parse(grid) : grid;
      if (model && typeof model === 'object') {
        const { version: _own, ...others } = model as Record<string, unknown>;
        grid = JSON.stringify(others);
      }
    } catch {
      grid = undefined;
    }
    const params: unknown[] = [tenantId];
    const where = await this.filterSql(mg, tenantId, { ...query, filters: grid }, params, applications);
    const rows: Array<{ value: string | null }> = await mg.query(
      `SELECT DISTINCT v.label AS value ${this.rowsFrom} WHERE tv.tenant_id = $1 ${where}`,
      params,
    );
    // Newest number first (`version-order.ts`), as the grid; null last.
    out.version = rows.map((r) => r.value).sort((a, b) => (a == null ? 1 : 0) - (b == null ? 1 : 0) || compareVersionLabels(a, b));
    return out;
  }

  /**
   * The options of the asset or application filter: the subjects whose counts
   * (`assetCountsForTenantSql`, `applicationCountsForTenantSql`) have at least one vulnerability
   * open, so an estate's hundreds of servers with none stay out. One query for the tenant; the
   * applications only for a user who reads them, inside the user's scope. By name.
   */
  private async subjectOptions(
    mg: EntityManager,
    tenantId: string,
    kind: 'asset' | 'application',
    applications: ApplicationsAccess,
  ): Promise<VulnerabilitySubjectOption[]> {
    if (kind === 'application' && !applications) return [];
    const params: unknown[] = [tenantId];
    const [table, reference, counts] = kind === 'asset'
      ? ['assets', 'asset_reference', assetCountsForTenantSql({ tenant: '$1' })]
      : ['applications', 'sequential_id', applicationCountsForTenantSql({ tenant: '$1' })];
    const scopeSql = kind === 'application' && applications?.scope
      ? (params.push(applications.scope.userId), `AND ${applicationParticipantCondition('s', `$${params.length}`)}`)
      : '';
    return mg.query(
      `SELECT s.id::text AS id, s.${reference} AS reference, s.name
         FROM ${table} s
         JOIN (${counts}) vc ON vc.id = s.id
        WHERE s.tenant_id = $1 AND vc.open > 0 ${scopeSql}
        ORDER BY lower(s.name), s.id`,
      params,
    );
  }

  /**
   * One CVE: its record, the technologies and versions it concerns, the servers and applications
   * reached. Every row is kept, alerting or not (lot V1): each version, server and application
   * carries `alerts`, the effective setting of its row. `servers` and `applications` count those
   * reached by direct links (`vulnerability-reach-counts.ts`), of every row; `alerting` counts those
   * of the rows that alert, as the page does. `servers_list` and `applications_list` also hold what
   * is reached through another asset (`via_asset_name`), with `direct` false: listed, not counted.
   */
  async detail(cveIdRaw: string, opts: VulnOpts, applications: ApplicationsAccess) {
    const { manager: mg, tenantId } = opts;
    const cveId = cveIdOrThrow(cveIdRaw);
    const rows = await this.rowsOf(mg, tenantId, `AND tv.cve_id = $2`, [tenantId, cveId]);
    const cve = (await this.cves(mg, [cveId])).get(cveId);
    if (!cve || rows.length === 0) throw new NotFoundException('Vulnerability not found');
    const direct = await this.reachOf(mg, tenantId, rows, applications);
    const reach = await this.graphReach(mg, tenantId, rows, applications);
    const versionOf = new Map(rows.map((r) => [rowKey(r.technology_id, r.technology_version_id), r]));

    const reachedAssets = rows.flatMap((r) => reach.servers.get(rowKey(r.technology_id, r.technology_version_id)) ?? []);
    const reachedApps = reach.apps ? rows.flatMap((r) => reach.apps!.get(rowKey(r.technology_id, r.technology_version_id)) ?? []) : [];
    // The names of the servers, of the carriers they are reached through, and of the applications' servers, in one query.
    const assetIds = Array.from(new Set([...reachedAssets, ...reachedApps].flatMap((a) => [a.asset_id, a.via_asset_id]).filter((id): id is string => !!id)));
    const assetRows: Array<{ id: string; name: string; asset_reference: string | null; environment: string | null }> = assetIds.length
      ? await mg.query(`SELECT id, name, asset_reference, environment FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, assetIds])
      : [];
    const assetsById = new Map(assetRows.map((a) => [a.id, a]));
    const servers = reachedAssets.map((a) => {
      const row = versionOf.get(rowKey(a.technology_id, a.technology_version_id))!;
      const asset = assetsById.get(a.asset_id);
      return {
        asset_id: a.asset_id,
        name: asset?.name ?? null,
        reference: asset?.asset_reference ?? null,
        environment: asset?.environment ?? null,
        technology_id: a.technology_id,
        technology_name: row.technology_name,
        version_label: row.version_label,
        via_asset_name: a.via_asset_id ? assetsById.get(a.via_asset_id)?.name ?? null : null,
        /** Installed on this server (counted), or reached through another asset (listed only). */
        direct: a.via_asset_id == null && direct.installed.get(rowKey(a.technology_id, a.technology_version_id))?.has(a.asset_id) === true,
        alerts: row.alerts,
      };
    }).sort((x, y) => String(x.name ?? '').localeCompare(String(y.name ?? ''), 'en', { sensitivity: 'base' }));

    let apps: Array<Record<string, unknown>> | null = null;
    if (reach.apps) {
      const appIds = Array.from(new Set(reachedApps.map((a) => a.application_id)));
      const appRows: Array<{ id: string; name: string; sequential_id: string | null; criticality: string | null }> = appIds.length
        ? await mg.query(`SELECT id, name, sequential_id, criticality FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, appIds])
        : [];
      const appsById = new Map(appRows.map((a) => [a.id, a]));
      apps = reachedApps.map((a) => {
        const row = versionOf.get(rowKey(a.technology_id, a.technology_version_id))!;
        const app = appsById.get(a.application_id);
        return {
          application_id: a.application_id,
          name: app?.name ?? null,
          reference: app?.sequential_id ?? null,
          criticality: app?.criticality ?? null,
          kind: a.kind,
          environment: a.environment,
          server_name: a.asset_id ? assetsById.get(a.asset_id)?.name ?? null : null,
          /** Hosted on a server the technology reaches through another asset (a host, a cluster): that asset. */
          via_asset_name: a.via_asset_id ? assetsById.get(a.via_asset_id)?.name ?? null : null,
          technology_id: a.technology_id,
          technology_name: row.technology_name,
          version_label: row.version_label,
          /** Declared, or hosted on a server with a direct link (counted); else listed only. */
          direct: a.kind === 'declared'
            ? direct.apps?.get(rowKey(a.technology_id, a.technology_version_id))?.has(a.application_id) === true
            : a.via_asset_id == null && !!a.asset_id && direct.installed.get(rowKey(a.technology_id, a.technology_version_id))?.has(a.asset_id) === true,
          alerts: row.alerts,
        };
      }).sort((x, y) => String(x.name ?? '').localeCompare(String(y.name ?? ''), 'en', { sensitivity: 'base' }));
    }
    const presented = presentCve(cve);
    const kevSources: Array<'cisa' | 'eu'> = [];
    if (presented.cisa_kev) kevSources.push('cisa');
    if (presented.eu_kev) kevSources.push('eu');
    const technologyIds = Array.from(new Set(rows.map((r) => r.technology_id)));
    return {
      ...presented,
      /** The European record: its EUVD id, or the CVE id when the mapping has none. */
      euvd_url: `${EUVD_VULNERABILITY_URL}${presented.euvd_id || cve.cve_id}`,
      kev_sources: kevSources,
      cvss_vector: cve.cvss_vector,
      reference_urls: cve.reference_urls ?? [],
      /** The CVE.org record, or null when this installation has not read it. */
      record: presentRecord(cve),
      technologies: groupByTechnology(rows, await this.sourceMatches(mg, tenantId, cveId, technologyIds)),
      ...this.counts(rows, direct),
      alerting: this.counts(rows.filter((r) => r.alerts), direct),
      servers_list: servers,
      applications_list: apps,
    };
  }

  /** The vulnerabilities of one technology, one item per version and CVE, most severe first. */
  async ofTechnology(idOrRef: string, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const rows = await this.rowsOf(mg, tenantId, `AND tv.technology_id = $2`, [tenantId, tech.id]);
    const cves = await this.cves(mg, Array.from(new Set(rows.map((r) => r.cve_id))));
    const rank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, none: 1 };
    const items = rows.map((r) => ({ ...presentCve(cves.get(r.cve_id)!), ...presentRow(r) }))
      .sort((a, b) => (rank[b.severity ?? ''] ?? 0) - (rank[a.severity ?? ''] ?? 0)
        || (b.cvss_score ?? -1) - (a.cvss_score ?? -1)
        || b.cve_id.localeCompare(a.cve_id));
    const counts = await this.versionAlertCounts(mg, tenantId, tech.id);
    return {
      technology: { id: tech.id, name: tech.name, reference: technologyReference(tech.item_number) },
      technology_alerts: tech.vulnerability_alerts,
      ...counts,
      products: await this.productStates(mg, tech.cpe_products),
      items,
    };
  }

  /**
   * The vulnerabilities of one technology, one row per version (lot V4b), in the order of the
   * versions table, plus the unknown version when a link names none. `installed`: a direct link
   * of an asset in service or of an application in service names the version (for the unknown
   * version: a link that names no version). `servers`: the assets in service whose direct link names
   * the version, as every count (`vulnerability-reach-counts.ts`); an asset the graph carries the
   * version to does not count. A version that is not installed has `servers` and every count at 0. `open` counts distinct CVE still to
   * review by severity, `unknown` when neither the NVD cache nor the CVE.org record has a severity, `total` every distinct CVE of the version, `cves` the distinct CVE of the technology.
   * `versions_excluded` and `versions_included` count every version.
   */
  async summary(idOrRef: string, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const counts = await this.versionAlertCounts(mg, tenantId, tech.id);
    const products = await this.productStates(mg, tech.cpe_products);
    // One statement: the direct links ($1 tenant, $2 this technology) and the rows ($3). A technology
    // with no version and no link still returns `cves` through the left join (the pad row has a null
    // `installed`). The servers are the assets in service, clusters excluded, whose direct link names the version
    // (`assetLinksSql`, nothing carried through the asset graph); a version is installed when a
    // direct link of an asset or an application names it (`assetLinksSql`, `applicationLinksSql`).
    // The rows are grouped by version first (`agg`), the links once per version (`servers`,
    // `in_use`), then both are joined to the few version lines.
    const rows: Array<{
      technology_version_id: string | null;
      label: string | null;
      alerts: boolean | null;
      installed: boolean | null;
      servers: number | null;
      critical: number | null;
      high: number | null;
      medium: number | null;
      low: number | null;
      none: number | null;
      unknown: number | null;
      total: number | null;
      cves: number;
    }> = await mg.query(
      `WITH servers AS MATERIALIZED (
         SELECT l.technology_version_id, count(DISTINCT l.subject_id)::int AS servers
           FROM (${assetLinksSql({ tenant: '$1', technologies: '$2' })}) l
           JOIN assets sa ON sa.tenant_id = l.tenant_id AND sa.id = l.subject_id AND sa.is_cluster IS NOT TRUE
          GROUP BY l.technology_version_id
       ),
       in_use AS MATERIALIZED (
         SELECT DISTINCT l.technology_version_id
           FROM (${assetLinksSql({ tenant: '$1', technologies: '$2' })}
                 UNION ALL
                 ${applicationLinksSql({ tenant: '$1', technologies: '$2' })}) l
       ),
       agg AS (
         SELECT tv.technology_version_id,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND ${EFFECTIVE_SEVERITY} = 'critical')::int AS critical,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND ${EFFECTIVE_SEVERITY} = 'high')::int AS high,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND ${EFFECTIVE_SEVERITY} = 'medium')::int AS medium,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND ${EFFECTIVE_SEVERITY} = 'low')::int AS low,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND ${EFFECTIVE_SEVERITY} = 'none')::int AS none,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND ${EFFECTIVE_SEVERITY} IS NULL)::int AS unknown,
                count(DISTINCT tv.cve_id)::int AS total
           FROM technology_vulnerabilities tv
           LEFT JOIN vulnerability_cves c ON c.cve_id = tv.cve_id
           LEFT JOIN vulnerability_cve_records r ON r.cve_id = c.cve_id
          WHERE tv.tenant_id = $1 AND tv.technology_id = $3
          GROUP BY tv.technology_version_id
       ),
       versions AS (
         SELECT v.id AS technology_version_id, v.label,
                ${vulnerabilityAlertsSql('v', 't')} AS alerts,
                EXISTS (SELECT 1 FROM in_use iu WHERE iu.technology_version_id = v.id) AS installed
           FROM technology_versions v
           JOIN technologies t ON t.tenant_id = v.tenant_id AND t.id = v.technology_id
          WHERE v.tenant_id = $1 AND v.technology_id = $3
       ),
       unknown AS (
         SELECT t.vulnerability_alerts AS alerts,
                EXISTS (SELECT 1 FROM in_use iu WHERE iu.technology_version_id IS NULL) AS installed
           FROM technologies t
          WHERE t.tenant_id = $1 AND t.id = $3
            AND (EXISTS (SELECT 1 FROM asset_technologies at
                          WHERE at.tenant_id = $1 AND at.technology_id = $3 AND at.technology_version_id IS NULL)
              OR EXISTS (SELECT 1 FROM application_technologies ad
                          WHERE ad.tenant_id = $1 AND ad.technology_id = $3 AND ad.technology_version_id IS NULL))
       ),
       lines AS (
         SELECT v.technology_version_id, v.label, v.alerts, v.installed,
                COALESCE(s.servers, 0)::int AS servers,
                COALESCE(a.critical, 0)::int AS critical,
                COALESCE(a.high, 0)::int AS high,
                COALESCE(a.medium, 0)::int AS medium,
                COALESCE(a.low, 0)::int AS low,
                COALESCE(a.none, 0)::int AS none,
                COALESCE(a.unknown, 0)::int AS unknown,
                COALESCE(a.total, 0)::int AS total
           FROM versions v
           LEFT JOIN servers s ON s.technology_version_id = v.technology_version_id
           LEFT JOIN agg a ON a.technology_version_id = v.technology_version_id
         UNION ALL
         SELECT NULL::uuid, NULL::text, u.alerts, u.installed,
                COALESCE(s.servers, 0)::int,
                COALESCE(a.critical, 0)::int,
                COALESCE(a.high, 0)::int,
                COALESCE(a.medium, 0)::int,
                COALESCE(a.low, 0)::int,
                COALESCE(a.none, 0)::int,
                COALESCE(a.unknown, 0)::int,
                COALESCE(a.total, 0)::int
           FROM unknown u
           LEFT JOIN servers s ON s.technology_version_id IS NULL
           LEFT JOIN agg a ON a.technology_version_id IS NULL
       ),
       totals AS (
         SELECT count(DISTINCT cve_id)::int AS cves
           FROM technology_vulnerabilities
          WHERE tenant_id = $1 AND technology_id = $3
       )
       SELECT l.technology_version_id, l.label, l.alerts, l.installed,
              (CASE WHEN l.installed THEN l.servers ELSE 0 END)::int AS servers,
              (CASE WHEN l.installed THEN l.critical ELSE 0 END)::int AS critical,
              (CASE WHEN l.installed THEN l.high ELSE 0 END)::int AS high,
              (CASE WHEN l.installed THEN l.medium ELSE 0 END)::int AS medium,
              (CASE WHEN l.installed THEN l.low ELSE 0 END)::int AS low,
              (CASE WHEN l.installed THEN l.none ELSE 0 END)::int AS none,
              (CASE WHEN l.installed THEN l.unknown ELSE 0 END)::int AS unknown,
              (CASE WHEN l.installed THEN l.total ELSE 0 END)::int AS total,
              t.cves
         FROM totals t
         LEFT JOIN lines l ON true
        ORDER BY ${versionOrderSql('l.label')}`,
      [tenantId, [tech.id], tech.id],
    );
    const openOf = (row: (typeof rows)[number]) => ({
      critical: Number(row.critical),
      high: Number(row.high),
      medium: Number(row.medium),
      low: Number(row.low),
      none: Number(row.none),
      unknown: Number(row.unknown),
    });
    return {
      technology: { id: tech.id, name: tech.name, reference: technologyReference(tech.item_number) },
      technology_alerts: tech.vulnerability_alerts,
      ...counts,
      collecting: products.some((product) => product.status === 'pending'),
      products,
      cves: Number(rows[0]?.cves ?? 0),
      versions: rows.filter((row) => row.installed != null).map((row) => ({
        version_id: row.technology_version_id,
        label: row.label,
        installed: row.installed === true,
        alerts: row.alerts === true,
        servers: Number(row.servers ?? 0),
        open: openOf(row),
        total: Number(row.total),
      })),
    };
  }

  /** Every version of the technology, by its effective alert setting (a version with no match included). */
  private async versionAlertCounts(mg: EntityManager, tenantId: string, technologyId: string) {
    const [{ versions_excluded, versions_included }] = await mg.query(
      `SELECT count(*) FILTER (WHERE NOT ${vulnerabilityAlertsSql('v', 't')})::int AS versions_excluded,
              count(*) FILTER (WHERE ${vulnerabilityAlertsSql('v', 't')})::int AS versions_included
         FROM technology_versions v
         JOIN technologies t ON t.tenant_id = v.tenant_id AND t.id = v.technology_id
        WHERE v.tenant_id = $1 AND v.technology_id = $2`,
      [tenantId, technologyId],
    );
    return { versions_excluded: Number(versions_excluded), versions_included: Number(versions_included) };
  }

  /**
   * Where the feed stands on each CPE product of a technology (lot T6b): `collected` (its CVE are in
   * the cache), `failed` (never collected, the last attempt failed), `pending` (never collected yet:
   * the section says the search is under way).
   */
  private async productStates(mg: EntityManager, cpeProducts: unknown) {
    const products = Array.from(new Set((Array.isArray(cpeProducts) ? cpeProducts : []).map((p) => String(p).toLowerCase())));
    if (products.length === 0) return [];
    const rows: Array<{ product: string; last_success_at: Date | null; last_error: string | null }> = await mg.query(
      `SELECT product, last_success_at, last_error FROM vulnerability_feed_products WHERE product = ANY($1::text[])`,
      [products],
    );
    const byProduct = new Map(rows.map((r) => [r.product, r]));
    return products.map((product) => {
      const row = byProduct.get(product);
      const status = row?.last_success_at ? 'collected' : row?.last_error ? 'failed' : 'pending';
      return { product, status };
    });
  }

  /**
   * Sets the state and the note of the technology's rows for the CVE: every version, or the one
   * `technology_version_id` names (`null`: the unknown version). Each changed row is audited.
   */
  async update(idOrRef: string, cveIdRaw: string, body: Record<string, unknown>, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const cveId = cveIdOrThrow(cveIdRaw);
    const patch: { state?: VulnerabilityState; note?: string | null } = {};
    if (body.state !== undefined) {
      if (!(VULNERABILITY_STATES as readonly string[]).includes(String(body.state))) {
        throw new BadRequestException('state must be to_review, handled or not_affected.');
      }
      patch.state = body.state as VulnerabilityState;
    }
    if (body.note !== undefined) {
      if (body.note !== null && typeof body.note !== 'string') throw new BadRequestException('note must be text.');
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (note.length > 4000) throw new BadRequestException('note must be at most 4000 characters.');
      patch.note = note || null;
    }
    if (patch.state === undefined && patch.note === undefined) throw new BadRequestException('Nothing to change: send state or note.');
    const params: unknown[] = [tenantId, tech.id, cveId];
    let versionSql = '';
    if (Object.prototype.hasOwnProperty.call(body, 'technology_version_id')) {
      const versionId = body.technology_version_id;
      if (versionId === null) versionSql = 'AND technology_version_id IS NULL';
      else if (typeof versionId === 'string' && UUID_RE.test(versionId)) { params.push(versionId); versionSql = `AND technology_version_id = $4`; }
      else throw new BadRequestException('technology_version_id must be a version id or null.');
    }
    const before: Array<Record<string, unknown>> = await mg.query(
      `SELECT id, technology_id, technology_version_id, cve_id, state, note, state_changed_by, state_changed_at
         FROM technology_vulnerabilities
        WHERE tenant_id = $1 AND technology_id = $2 AND cve_id = $3 ${versionSql}
        ORDER BY technology_version_id NULLS LAST FOR UPDATE`, // the order of the matching: (technology, version, CVE)
      params,
    );
    if (before.length === 0) throw new NotFoundException('Vulnerability not found');
    let changed = 0;
    for (const row of before) {
      const stateChanges = patch.state !== undefined && patch.state !== row.state;
      const noteChanges = patch.note !== undefined && patch.note !== row.note;
      if (!stateChanges && !noteChanges) continue;
      // An UPDATE answers [rows, rowCount], RETURNING included.
      const [[after]] = await mg.query(
        `UPDATE technology_vulnerabilities
            SET state = COALESCE($3, state),
                note = CASE WHEN $4::boolean THEN $5 ELSE note END,
                state_changed_by = CASE WHEN $6::boolean THEN $7::uuid ELSE state_changed_by END,
                state_changed_at = CASE WHEN $6::boolean THEN now() ELSE state_changed_at END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING id, technology_id, technology_version_id, cve_id, state, note, state_changed_by, state_changed_at`,
        [tenantId, row.id, stateChanges ? patch.state : null, noteChanges, patch.note ?? null, stateChanges, opts.userId ?? null],
      );
      await this.audit.log(
        { table: 'technology_vulnerabilities', recordId: String(row.id), action: 'update', before: row, after, userId: opts.userId ?? null, ...opts.audit },
        { manager: mg },
      );
      changed += 1;
    }
    return { ok: true, changed, ...(await this.ofTechnology(tech.id, opts)) };
  }

  /**
   * Changes in bulk (lots T6b, T6c) the state, and the note when one is sent, of grid rows
   * (technology, version and CVE): the chosen ones (`ids`, row ids), or every row the list's
   * filters reach (`all: true` with `filters`, the list's parameters, grid model included), less
   * the rows the user unticked (`exclude_ids`). The chosen rows are taken as they are: the filters
   * do not narrow them. The rows are locked in the matching's order (technology, version, CVE),
   * written in batches of 500, and each changed row is audited on `technology_vulnerabilities`.
   * `dry_run` counts without writing and returns `as_of`, the instant of the count: the write that
   * sends it back changes only the rows detected by then, so a row found after the count (a new CVE
   * matched while the user confirms) stays to review; `changed` says how many really changed. The
   * write also sends `expected_rows`, the rows of the count (required with `all`): when the locked
   * rows are more (a matching that began before the count committed after it), nothing is written
   * and the answer is a 409 `bulk_list_changed`. More than `BULK_MAX_ROWS` rows is a 400.
   * `applications`: what the user reads (the application filter stays inside it).
   */
  async bulkState(body: Record<string, unknown>, opts: VulnOpts, applications: ApplicationsAccess = null) {
    const { manager: mg, tenantId } = opts;
    const state = String(body.state ?? '');
    if (!(VULNERABILITY_STATES as readonly string[]).includes(state)) {
      throw new BadRequestException('state must be to_review, handled or not_affected.');
    }
    let note: string | null | undefined;
    if (body.note !== undefined) {
      if (body.note !== null && typeof body.note !== 'string') throw new BadRequestException('note must be text.');
      const text = typeof body.note === 'string' ? body.note.trim() : '';
      if (text.length > 4000) throw new BadRequestException('note must be at most 4000 characters.');
      note = text || null;
    }
    const all = body.all === true;
    const rowIds = (name: 'ids' | 'exclude_ids'): string[] => {
      const raw = body[name];
      if (raw === undefined || raw === null) return [];
      if (!Array.isArray(raw)) throw new BadRequestException(`${name} must be a list of row ids.`);
      const ids = Array.from(new Set(raw.map((v) => String(v ?? '').trim().toLowerCase())));
      if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException(`${name} must be row ids.`);
      if (ids.length > BULK_MAX_ROWS) throw new BadRequestException({ code: 'bulk_too_many', message: `At most ${BULK_MAX_ROWS} rows at once: narrow the filters.` });
      return ids;
    };
    const ids = rowIds('ids');
    const excluded = rowIds('exclude_ids');
    if (all && ids.length > 0) throw new BadRequestException('Send the chosen rows (ids) or every row of the filter (all: true), not both.');
    if (!all && excluded.length > 0) throw new BadRequestException('exclude_ids goes with all: true.');
    if (!all && ids.length === 0) throw new BadRequestException('Choose the rows (ids), or every row of the filter (all: true).');
    const filters = (body.filters && typeof body.filters === 'object' ? body.filters : {}) as VulnerabilityFilters;

    const params: unknown[] = [tenantId];
    let where: string;
    if (all) {
      where = await this.filterSql(mg, tenantId, { ...filters, limit: undefined, offset: undefined, page: undefined, sort: undefined }, params, applications);
      if (excluded.length > 0) {
        params.push(excluded);
        where += ` AND tv.id <> ALL($${params.length}::uuid[])`;
      }
    } else {
      params.push(ids);
      where = ` AND tv.id = ANY($${params.length}::uuid[])`;
    }
    // Every one of the filter: only what the user confirmed, so the count's instant is required.
    if (all && body.dry_run !== true && (body.as_of === undefined || body.as_of === null)) {
      throw new BadRequestException('as_of is required with all: send the instant the dry run returned.');
    }
    // The rows the user confirmed (the dry run's `rows`): required with all, checked under the lock.
    let expectedRows: number | null = null;
    if (body.expected_rows !== undefined && body.expected_rows !== null) {
      expectedRows = Number(body.expected_rows);
      if (!Number.isSafeInteger(expectedRows) || expectedRows < 0) throw new BadRequestException('expected_rows must be the rows the dry run counted.');
    } else if (all && body.dry_run !== true) {
      throw new BadRequestException('expected_rows is required with all: send the rows the dry run counted.');
    }
    if (body.as_of !== undefined && body.as_of !== null) {
      const asOf = new Date(String(body.as_of));
      if (Number.isNaN(asOf.getTime())) throw new BadRequestException('as_of must be the instant a dry run returned.');
      params.push(asOf.toISOString());
      where += ` AND tv.detected_at <= $${params.length}::timestamptz`;
    }
    const scopeParams = [...params];
    const noteChanges = note !== undefined;
    params.push(state, note ?? null);
    const changeSql = `tv.state <> $${params.length - 1}::text${noteChanges ? ` OR tv.note IS DISTINCT FROM $${params.length}::text` : ` OR $${params.length}::text IS NOT NULL`}`;
    const [count] = await mg.query(
      `SELECT count(*)::int AS rows, count(DISTINCT tv.cve_id)::int AS cves, count(*) FILTER (WHERE ${changeSql})::int AS changes
         ${this.rowsFrom} WHERE tv.tenant_id = $1 ${where}`,
      params,
    );
    const rows = Number(count?.rows ?? 0);
    if (rows > BULK_MAX_ROWS) {
      // A code: the page says the cap in its own words, and any other refusal by its message.
      throw new BadRequestException({ code: 'bulk_too_many', message: `These filters reach ${rows} rows, more than ${BULK_MAX_ROWS} at once: narrow them.` });
    }
    const summary = { rows, cves: Number(count?.cves ?? 0) };
    if (body.dry_run === true) {
      const [{ as_of: asOf }] = await mg.query(`SELECT clock_timestamp() AS as_of`);
      return { ok: true, dry_run: true, ...summary, changes: Number(count?.changes ?? 0), as_of: new Date(asOf).toISOString() };
    }

    const before: Array<Record<string, unknown>> = await mg.query(
      `SELECT tv.id, tv.technology_id, tv.technology_version_id, tv.cve_id, tv.state, tv.note, tv.state_changed_by, tv.state_changed_at
         ${this.rowsFrom} WHERE tv.tenant_id = $1 ${where}
        ORDER BY tv.technology_id, tv.technology_version_id NULLS LAST, tv.cve_id
        FOR UPDATE OF tv`,
      scopeParams,
    );
    // More rows than confirmed: one the count did not see (a matching that began before the count and
    // committed after it has a detection instant before `as_of`). Nothing is written; the user counts again.
    if (expectedRows !== null && before.length > expectedRows) {
      throw new ConflictException({ code: 'bulk_list_changed', message: 'The list changed since the count: count again.' });
    }
    const toChange = before.filter((row) => row.state !== state || (noteChanges && row.note !== note));
    let changed = 0;
    for (let i = 0; i < toChange.length; i += BULK_BATCH) {
      const batch = toChange.slice(i, i + BULK_BATCH);
      // An UPDATE answers [rows, rowCount], RETURNING included.
      const [afterRows] = await mg.query(
        `UPDATE technology_vulnerabilities
            SET state = $3,
                note = CASE WHEN $4::boolean THEN $5 ELSE note END,
                state_changed_by = CASE WHEN state <> $3 THEN $6::uuid ELSE state_changed_by END,
                state_changed_at = CASE WHEN state <> $3 THEN now() ELSE state_changed_at END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])
          RETURNING id, technology_id, technology_version_id, cve_id, state, note, state_changed_by, state_changed_at`,
        [tenantId, batch.map((row) => row.id), state, noteChanges, note ?? null, opts.userId ?? null],
      );
      const afterById = new Map((afterRows as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
      for (const row of batch) {
        const after = afterById.get(String(row.id));
        if (!after) continue;
        await this.audit.log(
          { table: 'technology_vulnerabilities', recordId: String(row.id), action: 'update', before: row, after, userId: opts.userId ?? null, ...opts.audit },
          { manager: mg },
        );
        changed += 1;
      }
    }
    return { ok: true, ...summary, changed };
  }

  /** Matches the technology again with the cache, under a lock of its row. */
  async rematch(idOrRef: string, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const result = await this.matcher.matchTenant(mg, tenantId, tech.id);
    // Its products the feed never collected are collected once this transaction has committed, in
    // the background (then matched).
    const fresh = this.feed ? await this.feed.neverCollected((tech.cpe_products ?? []) as string[]) : [];
    if (fresh.length > 0) await this.feed!.onCpeProductsAdded({ manager: mg, tenantId, technologyId: tech.id, products: fresh });
    return { ok: true, added: result.added, updated: result.updated, removed: result.removed, unmatched: result.unmatched, collecting: fresh };
  }

  /**
   * The list as a CSV file or a workbook (`format`), one line per grid row (technology, version and
   * CVE), with its filters and sort. The CSV writes the scores, counts and days as plain text in every
   * language; the workbook has them as numbers and dates.
   */
  async exportCsv<F extends ExportFileFormat = 'csv'>(
    filters: VulnerabilityFilters,
    language: unknown,
    opts: VulnOpts,
    applications: ApplicationsAccess,
    format?: F,
  ): Promise<ListExportFile<F>> {
    const { items } = await this.listRows(filters, opts, applications, false);
    const headers = ['CVE', 'Severity', 'Score', 'Published', 'Technology reference', 'Technology', 'Publisher', 'Version', 'Match', 'Source', 'State', 'Note', 'Servers', 'Applications', 'Exploited', 'KEV added', 'Ransomware', 'EPSS', 'EPSS percentile', 'EUVD', 'Alerts'];
    const basisLabel: Record<MatchBasis, string> = {
      version_in_range: 'Version in range',
      version_not_comparable: 'Version not comparable',
      version_unknown: 'Version unknown',
    };
    const stateLabel: Record<VulnerabilityState, string> = { to_review: 'To review', handled: 'Handled', not_affected: 'Not affected' };
    const lines = items.map((item) => [
      item.cve_id,
      item.severity ?? '',
      item.cvss_score == null ? '' : String(item.cvss_score),
      item.published_at ? new Date(item.published_at).toISOString().slice(0, 10) : '',
      item.technology.reference ?? '',
      item.technology.name,
      item.editor ?? '',
      item.version ?? 'Unknown',
      basisLabel[item.match_basis],
      sourceLabel(item.match_sources),
      stateLabel[item.state],
      item.note ?? '',
      String(item.servers),
      item.applications == null ? '' : String(item.applications),
      item.exploited ? 'yes' : 'no',
      item.kev_added_at ?? '',
      item.kev_ransomware == null ? '' : item.kev_ransomware ? 'yes' : 'no',
      item.epss == null ? '' : String(item.epss),
      item.epss_percentile == null ? '' : String(item.epss_percentile),
      item.euvd_id ?? '',
      item.alerts ? 'yes' : 'no',
    ]);
    const fileFormat = format ?? ('csv' as F);
    return writeListExport({
      format: fileFormat,
      language: await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, language),
      filename: 'vulnerabilities.csv',
      sheetNames: VULNERABILITIES_SHEET,
      headers,
      // Score, Published, Servers, Applications, KEV added, EPSS, EPSS percentile.
      rows: typedTextRows(fileFormat, lines, { 2: 'number', 3: 'date', 12: 'number', 13: 'number', 15: 'date', 17: 'number', 18: 'number' }),
    });
  }
}
