import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { NvdFeedService } from './nvd-feed.service';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { assertSetFilterModes } from '../common/ag-grid-filtering';
import { languageOf, writeCsv } from '../common/csv-sheet';
import { readTechnology, technologyReference, UUID_RE } from '../technologies/technology-rows';
import { gridTextClause, gridTextModel } from '../technologies/technologies.service';
import { versionInUseSql } from '../technologies/reports/version-support';
import { assetInServiceSql, inServiceSql, REACH_FROM_TECHNOLOGIES, TechnologyReachService, withoutJit } from '../technologies/technology-reach.service';
import { compareVersionLabels, versionOrderSql } from '../technologies/version-order';
import { VulnerabilityMatchService } from './vulnerability-match.service';
import { vulnerabilityAlertsSql } from './vulnerability-alerts';
import { severityOf, VULNERABILITY_STATES, type MatchBasis, type VulnerabilityState } from './vulnerability-rules';

export type VulnOpts = { manager: EntityManager; tenantId: string; userId?: string | null };
/** The applications the caller reads: null without the `applications` read right, a Business Contributor's own only. */
export type ApplicationsAccess = { scope?: ParticipationAccessScope } | null;

export type VulnerabilityFilters = {
  severity?: unknown;
  state?: unknown;
  editor?: unknown;
  technology?: unknown;
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
};

/** At most this many rows (technology version and CVE) in one change of state in bulk. */
export const BULK_MAX_ROWS = 5000;
/** Rows written by one statement of a bulk change. */
const BULK_BATCH = 500;

/** Known to be exploited: in the CISA KEV or the EU KEV (a null flag counts as not). */
const EXPLOITED_SQL = `(COALESCE(c.cisa_kev, false) OR COALESCE(c.eu_kev, false))`;
/** The page of a CVE in the European vulnerability database. */
const EUVD_VULNERABILITY_URL = 'https://euvd.enisa.europa.eu/vulnerability/';

/** The grid's sortable columns. */
const GRID_SORTS: Record<string, string> = {
  severity: 'severity', // SEVERITY_ORDER, then the score
  cvss_score: 'c.cvss_score',
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
const SEVERITY_ORDER = `CASE c.severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 WHEN 'none' THEN 1 ELSE 0 END`;

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
};

/** A row of the list grid: the row, with its CVE. */
type GridRow = Row & Omit<Cve, 'cvss_vector' | 'reference_urls'>;

type Cve = {
  cve_id: string;
  summary: string | null;
  cvss_score: string | null;
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
  };
}

/** Rows of one CVE grouped per technology, versions by label (unknown version last). */
function groupByTechnology(rows: Row[]) {
  const byTech = new Map<string, { technology_id: string; reference: string | null; name: string; editor: string | null; versions: ReturnType<typeof presentRow>[] }>();
  for (const r of rows) {
    const entry = byTech.get(r.technology_id) ?? {
      technology_id: r.technology_id,
      reference: technologyReference(r.technology_item_number),
      name: r.technology_name,
      editor: r.editor,
      versions: [],
    };
    entry.versions.push(presentRow(r));
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

/**
 * The vulnerabilities of a tenant (lot T6a): the rows of `technology_vulnerabilities` with the
 * CVE of the platform cache, and the servers and applications they reach through the deductions
 * of the technology layer (`TechnologyReachService`). A row with a version reaches the servers and
 * applications whose link names that version; a row without version, those whose link names none.
 */
@Injectable()
export class VulnerabilitiesService {
  constructor(
    private readonly reach: TechnologyReachService,
    private readonly matcher: VulnerabilityMatchService,
    private readonly audit: AuditService,
    @Optional() private readonly feed?: NvdFeedService,
  ) {}

  /** The WHERE clause of the filters, on `tv` (rows), `t` (technologies) and `c` (cache). */
  private async filterSql(mg: EntityManager, tenantId: string, filters: VulnerabilityFilters, params: unknown[]): Promise<string> {
    const where: string[] = [];
    const push = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const severities = commaList(filters.severity);
    if (severities.length) {
      const valid = severities.map(severityOf);
      if (valid.some((s) => !s)) throw new BadRequestException('severity must be critical, high, medium, low or none.');
      where.push(`c.severity = ANY(${push(valid)}::text[])`);
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
      where.push(`(tv.cve_id ILIKE ${like} OR t.name ILIKE ${like} OR c.summary ILIKE ${like})`);
    }
    const exploited = exploitedChoice(filters.exploited);
    if (exploited !== null) where.push(exploited ? EXPLOITED_SQL : `NOT ${EXPLOITED_SQL}`);
    const epssMin = epssMinimum(filters.epss);
    if (epssMin !== null) where.push(`c.epss >= ${push(epssMin)}::numeric`);
    where.push(...this.gridClauses(filters.filters, push));
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
   * filter on `exploited` (`yes` / `no`; an unknown value matches nothing, both match every row).
   * An unreadable model or another column is ignored; `technologies` (the name before T6c) reads
   * as `technology`; a set filter in exclude mode is a 400.
   */
  private gridClauses(raw: unknown, push: (value: unknown) => string): string[] {
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
    for (const [column, expr] of [['severity', 'c.severity'], ['state', 'tv.state']] as const) {
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
    // Versions by label (one label may name a version of several technologies); `null`: not recorded.
    const versions = setValues('version');
    if (versions) {
      const parts: string[] = [];
      if (versions.length) parts.push(`v.label = ANY(${push(versions)}::text[])`);
      if ((model.version.values as unknown[]).some((value) => value === null)) parts.push('tv.technology_version_id IS NULL');
      out.push(parts.length ? `(${parts.join(' OR ')})` : 'false');
    }
    const json = typeof raw === 'string' ? raw : JSON.stringify(model);
    for (const [column, expr] of [['cve_id', 'tv.cve_id'], ['summary', 'c.summary']] as const) {
      const clause = gridTextClause(expr, gridTextModel(json, column), push);
      if (clause) out.push(clause);
    }
    const score = gridNumberClause('c.cvss_score', model.cvss_score, push);
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
    const published = gridDateClause('c.published_at', model.published_at, push);
    if (published) out.push(`(${published})`);
    return out;
  }

  /** The rows with their technology, CVE and version (`v`, none for the rows without version). */
  private readonly rowsFrom = `
    FROM technology_vulnerabilities tv
    JOIN technologies t ON t.tenant_id = tv.tenant_id AND t.id = tv.technology_id
    JOIN vulnerability_cves c ON c.cve_id = tv.cve_id
    LEFT JOIN technology_versions v ON v.tenant_id = tv.tenant_id AND v.id = tv.technology_version_id`;

  private readonly rowColumns = `tv.id, tv.technology_id, tv.technology_version_id, tv.cve_id, tv.state, tv.note, tv.match_basis, tv.matching,
    tv.detected_at, tv.state_changed_at,
    NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS state_changed_by_name,
    t.name AS technology_name, t.item_number AS technology_item_number, t.editor, v.label AS version_label,
    ${vulnerabilityAlertsSql('v', 't')} AS alerts`;

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

  private async cves(mg: EntityManager, ids: string[]): Promise<Map<string, Cve>> {
    const rows: Cve[] = ids.length
      ? await mg.query(
        `SELECT c.cve_id, c.summary, c.cvss_score, c.severity, c.cvss_version, c.cvss_vector, c.published_at,
                c.last_modified_at, c.nvd_status, c.reference_urls, ${SIGNAL_COLUMNS}
           FROM vulnerability_cves c WHERE c.cve_id = ANY($1::text[])`,
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
   * What the rows reach: per (technology, version) key, the servers (reached assets) and the
   * visible applications (hosted or declared). Applications are null without the read right.
   */
  private async reachOf(mg: EntityManager, tenantId: string, rows: Row[], applications: ApplicationsAccess) {
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

  /** Counts of distinct servers and applications reached by a set of rows. */
  private counts(rows: Row[], reach: Awaited<ReturnType<VulnerabilitiesService['reachOf']>>) {
    const servers = new Set<string>();
    const apps = new Set<string>();
    for (const r of rows) {
      const key = rowKey(r.technology_id, r.technology_version_id);
      for (const a of reach.servers.get(key) ?? []) servers.add(a.asset_id);
      for (const a of reach.apps?.get(key) ?? []) apps.add(a.application_id);
    }
    return { servers: servers.size, applications: reach.apps ? apps.size : null };
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
    const severityThen = `${SEVERITY_ORDER} DESC, c.cvss_score DESC NULLS LAST`;
    // Exploited first (the default, and the column itself). An explicit severity sort stays on the
    // severity. Another column: that column, then most severe.
    const order = !sortField || sortField === 'exploited'
      ? `${EXPLOITED_SQL} ${sortField === 'exploited' ? direction : 'DESC'}, ${severityThen}, c.published_at DESC NULLS LAST, ${tail}`
      : sortField === 'severity'
        ? `${SEVERITY_ORDER} ${direction}, c.cvss_score ${direction} NULLS LAST, c.published_at DESC NULLS LAST, ${tail}`
        : sortField === 'technology'
          ? `lower(t.name) ${direction}, t.id, ${severityThen}, ${tail}`
          : `${GRID_SORTS[sortField]} ${direction} NULLS LAST, ${severityThen}, ${tail}`;
    const params: unknown[] = [tenantId];
    const where = await this.filterSql(mg, tenantId, filters, params);
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
              c.summary, c.cvss_score, c.severity, c.cvss_version, c.published_at, c.last_modified_at, c.nvd_status,
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
      // The servers and applications of this version.
      ...this.counts([r], reach),
    }));
    return { items, total, cves, limit, offset, rows };
  }

  /**
   * The values of the grid's set filters that depend on the rows (`fields`: `version`): the labels
   * of the versions the other filters reach, newest number first, `null` last when a row has no version.
   */
  async filterValues(query: VulnerabilityFilters & { fields?: unknown }, opts: VulnOpts): Promise<Record<string, Array<string | null>>> {
    const { manager: mg, tenantId } = opts;
    const out: Record<string, Array<string | null>> = {};
    if (!commaList(query.fields).includes('version')) return out;
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
    const where = await this.filterSql(mg, tenantId, { ...query, filters: grid }, params);
    const rows: Array<{ value: string | null }> = await mg.query(
      `SELECT DISTINCT v.label AS value ${this.rowsFrom} WHERE tv.tenant_id = $1 ${where}`,
      params,
    );
    // Newest number first (`version-order.ts`), as the grid; null last.
    out.version = rows.map((r) => r.value).sort((a, b) => (a == null ? 1 : 0) - (b == null ? 1 : 0) || compareVersionLabels(a, b));
    return out;
  }

  /**
   * One CVE: its record, the technologies and versions it concerns, the servers and applications
   * reached. Every row is kept, alerting or not (lot V1): each version, server and application
   * carries `alerts`, the effective setting of its row. `servers` and `applications` count them
   * all; `alerting` counts those of the rows that alert, as the page does.
   */
  async detail(cveIdRaw: string, opts: VulnOpts, applications: ApplicationsAccess) {
    const { manager: mg, tenantId } = opts;
    const cveId = cveIdOrThrow(cveIdRaw);
    const rows = await this.rowsOf(mg, tenantId, `AND tv.cve_id = $2`, [tenantId, cveId]);
    const cve = (await this.cves(mg, [cveId])).get(cveId);
    if (!cve || rows.length === 0) throw new NotFoundException('Vulnerability not found');
    const reach = await this.reachOf(mg, tenantId, rows, applications);
    const versionOf = new Map(rows.map((r) => [rowKey(r.technology_id, r.technology_version_id), r]));

    const reachedAssets = rows.flatMap((r) => reach.servers.get(rowKey(r.technology_id, r.technology_version_id)) ?? []);
    const assetIds = Array.from(new Set(reachedAssets.flatMap((a) => [a.asset_id, a.via_asset_id]).filter((id): id is string => !!id)));
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
        alerts: row.alerts,
      };
    }).sort((x, y) => String(x.name ?? '').localeCompare(String(y.name ?? ''), 'en', { sensitivity: 'base' }));

    let apps: Array<Record<string, unknown>> | null = null;
    if (reach.apps) {
      const reachedApps = rows.flatMap((r) => reach.apps!.get(rowKey(r.technology_id, r.technology_version_id)) ?? []);
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
          technology_id: a.technology_id,
          technology_name: row.technology_name,
          version_label: row.version_label,
          alerts: row.alerts,
        };
      }).sort((x, y) => String(x.name ?? '').localeCompare(String(y.name ?? ''), 'en', { sensitivity: 'base' }));
    }
    const presented = presentCve(cve);
    const kevSources: Array<'cisa' | 'eu'> = [];
    if (presented.cisa_kev) kevSources.push('cisa');
    if (presented.eu_kev) kevSources.push('eu');
    return {
      ...presented,
      /** The European record: its EUVD id, or the CVE id when the mapping has none. */
      euvd_url: `${EUVD_VULNERABILITY_URL}${presented.euvd_id || cve.cve_id}`,
      kev_sources: kevSources,
      cvss_vector: cve.cvss_vector,
      reference_urls: cve.reference_urls ?? [],
      technologies: groupByTechnology(rows),
      ...this.counts(rows, reach),
      alerting: this.counts(rows.filter((r) => r.alerts), reach),
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
   * versions table, plus the unknown version when a link names none. `installed` follows
   * `versionInUseSql` (for the unknown version: a link that names no version is in use). A version
   * that is not installed has `servers` and every count at 0. `open` counts distinct CVE still to
   * review by severity, `unknown` for a CVE the NVD has not scored yet (`severity` null), `total` every distinct CVE of the version, `cves` the distinct CVE of the technology.
   * `versions_excluded` and `versions_included` count every version.
   */
  async summary(idOrRef: string, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const counts = await this.versionAlertCounts(mg, tenantId, tech.id);
    const products = await this.productStates(mg, tech.cpe_products);
    // One statement: the reach ($1 tenant, $2 this technology) and the rows ($3). A technology with
    // no version and no link still returns `cves` through the left join (the pad row has a null `installed`).
    // The rows are grouped by version first (`agg`), and the servers counted once per version
    // (`servers`, materialized), then both are joined to the few version lines: the reach is never
    // aggregated again for each match row.
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
    }> = await withoutJit(mg,
      `WITH RECURSIVE ${REACH_FROM_TECHNOLOGIES},
       servers AS MATERIALIZED (
         SELECT technology_version_id, count(DISTINCT asset_id)::int AS servers
           FROM reach
          GROUP BY technology_version_id
       ),
       agg AS (
         SELECT tv.technology_version_id,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND c.severity = 'critical')::int AS critical,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND c.severity = 'high')::int AS high,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND c.severity = 'medium')::int AS medium,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND c.severity = 'low')::int AS low,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND c.severity = 'none')::int AS none,
                count(DISTINCT tv.cve_id) FILTER (WHERE tv.state = 'to_review' AND c.severity IS NULL)::int AS unknown,
                count(DISTINCT tv.cve_id)::int AS total
           FROM technology_vulnerabilities tv
           LEFT JOIN vulnerability_cves c ON c.cve_id = tv.cve_id
          WHERE tv.tenant_id = $1 AND tv.technology_id = $3
          GROUP BY tv.technology_version_id
       ),
       versions AS (
         SELECT v.id AS technology_version_id, v.label,
                ${vulnerabilityAlertsSql('v', 't')} AS alerts,
                ${versionInUseSql('v')} AS installed
           FROM technology_versions v
           JOIN technologies t ON t.tenant_id = v.tenant_id AND t.id = v.technology_id
          WHERE v.tenant_id = $1 AND v.technology_id = $3
       ),
       unknown AS (
         SELECT t.vulnerability_alerts AS alerts,
                (EXISTS (SELECT 1 FROM asset_technologies uat
                           JOIN assets ua ON ua.tenant_id = uat.tenant_id AND ua.id = uat.asset_id AND ${assetInServiceSql('ua')}
                          WHERE uat.tenant_id = $1 AND uat.technology_id = $3 AND uat.technology_version_id IS NULL)
              OR EXISTS (SELECT 1 FROM application_technologies ud
                           JOIN applications uap ON uap.tenant_id = ud.tenant_id AND uap.id = ud.application_id AND ${inServiceSql('uap')}
                          WHERE ud.tenant_id = $1 AND ud.technology_id = $3 AND ud.technology_version_id IS NULL)) AS installed
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
        { table: 'technology_vulnerabilities', recordId: String(row.id), action: 'update', before: row, after, userId: opts.userId ?? null },
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
   */
  async bulkState(body: Record<string, unknown>, opts: VulnOpts) {
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
      where = await this.filterSql(mg, tenantId, { ...filters, limit: undefined, offset: undefined, page: undefined, sort: undefined }, params);
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
          { table: 'technology_vulnerabilities', recordId: String(row.id), action: 'update', before: row, after, userId: opts.userId ?? null },
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

  /** The list as a CSV file, one line per grid row (technology, version and CVE), with its filters and sort. */
  async exportCsv(filters: VulnerabilityFilters, language: unknown, opts: VulnOpts, applications: ApplicationsAccess) {
    const { items } = await this.listRows(filters, opts, applications, false);
    const headers = ['CVE', 'Severity', 'Score', 'Published', 'Technology reference', 'Technology', 'Publisher', 'Version', 'Match', 'State', 'Note', 'Servers', 'Applications', 'Exploited', 'KEV added', 'Ransomware', 'EPSS', 'EPSS percentile', 'EUVD', 'Alerts'];
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
    const content = writeCsv({ language: await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, language), headers, rows: lines });
    return { filename: 'vulnerabilities.csv', content };
  }
}
