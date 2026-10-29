import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition } from '../../auth/business-contributor-scope';
import { throwFeatureDisabled } from '../../common/feature-gates';
import { gridTextClause } from '../../technologies/technologies.service';
import { versionOrderSql } from '../../technologies/version-order';
import {
  EFFECTIVE_CVSS_VECTOR,
  EFFECTIVE_CVSS_VERSION,
  EFFECTIVE_SUMMARY,
  SCORE_SOURCE_SQL,
  vulnerabilityFeedSources,
  vulnerabilitySubjectIds,
} from '../../vulnerabilities/vulnerabilities.service';
import { vulnerabilityAlertsSql } from '../../vulnerabilities/vulnerability-alerts';
import {
  applicationLinksSql,
  assetLinksSql,
  EFFECTIVE_SCORE,
  EFFECTIVE_SEVERITY,
  exploitedSql,
  linkNamesRowSql,
  rowJoinsSql,
  rowOnApplicationsSql,
  rowOnAssetsSql,
  technologyInEstateSql,
  vulnerabilityCountsEnabled,
} from '../../vulnerabilities/vulnerability-reach-counts';
import type { AiVulnerabilityFeed } from './ai-filter.types';
import type { AiApplicationsReach } from './ai-technologies.query';

/**
 * The vulnerabilities as the assistant and the MCP server read them (`query_entities`,
 * `aggregate_entities`, `get_entity_detail`), as the vulnerabilities page lists them: one item is
 * one `technology_vulnerabilities` row, a CVE on one version of a technology (or on the technology
 * with no version recorded), whose CVE is in the cache. As the page, a list or an aggregate with no
 * filter on `state` or `alerts` keeps the rows to review that alert (`DEFAULT_ROWS`); `all` on
 * either lifts that default. A read by id or by CVE keeps every row.
 *
 * The CVE fields are the page's (`vulnerabilities.service.ts`): effective summary, score and its
 * source, effective severity (`vulnerability-reach-counts.ts`). The reach is by direct links only,
 * as the page's Servers and Applications columns (`vulnerability-reach-counts.ts`):
 * - `servers_reached`: the assets in service whose own `asset_technologies` row names the row's
 *   technology and version; nothing is carried through a host or a cluster.
 * - `applications_reached`: the applications in service that declare the technology and version,
 *   or whose server (instance in service) carries it directly, within the caller's read scope (a
 *   Business Contributor's own); null for a caller who cannot read applications.
 * `estate`: the row's technology is in use in the estate, as the page's "In use in the estate"
 * filter (`technologyInEstateSql`: installed on an asset in service or declared by an application
 * in service, whatever the version). A boolean on the technology, read over every application as
 * the page does: it names none. `matching`: the matching still finds the row (`false`: no longer
 * matches, as the page's marker).
 * A list, and the id list of the aggregates, also count the distinct CVE among every row they keep
 * (`distinct_total`, beyond the page and the ids cap), as the page's total ("117 rows (112 CVE)").
 * The `asset` and `application` filters keep the rows in those direct links
 * (`rowOnAssetsSql`, `rowOnApplicationsSql`); an unknown asset, or an application unknown or out of
 * the caller's scope, matches nothing. Their references are resolved once, before the rows
 * (`vulnerabilitySubjectIds`, as the page), never in a subquery read per row.
 *
 * With the vulnerability feed off, the family is unavailable (`throwFeatureDisabled`, as the
 * page's routes), and the policy leaves it out of the readable families.
 *
 * Every statement carries the tenant on every tenant table besides RLS; the CVE cache is shared.
 */

/** The family is read only with the vulnerability feed on. */
export function assertAiVulnerabilitiesAvailable(): void {
  if (!vulnerabilityCountsEnabled()) throwFeatureDisabled('vulnerabilityFeed');
}

/** The joins of a row (`tv`): technology `t`, cache `c`, CVE.org record `r`, version `v`. */
export const VULNERABILITY_ROW_JOINS = rowJoinsSql();

/**
 * The reach of the rows of the tenant `tenant` (among `ids` when given), rows first: one row
 * `(id, n)` per row that reaches something, the tenant's links read once, counted per technology
 * and version, and joined to its rows
 * (lot 5b, performance: a subquery per row cost 0.8 to 2.4 s on 13,500 rows when a sort, a filter
 * or a sum read every row). A row missing here reaches nothing. Joined by id
 * (`LEFT JOIN (...) vsr ON vsr.id = tv.id`), never per row.
 */
function reachByRowSql(links: string, tenant: string, ids?: string): string {
  // The subjects counted per technology and version first: a row names exactly one of them.
  return `SELECT vrr.id, vrk.n
            FROM technology_vulnerabilities vrr
            JOIN (SELECT vrl.tenant_id, vrl.technology_id, vrl.technology_version_id, count(DISTINCT vrl.subject_id)::int AS n
                    FROM (${links}) vrl
                   GROUP BY vrl.tenant_id, vrl.technology_id, vrl.technology_version_id) vrk ON ${linkNamesRowSql('vrk', 'vrr')}
           WHERE vrr.tenant_id = ${tenant}${ids ? ` AND vrr.id = ANY(${ids}::uuid[])` : ''}`;
}

/** Per row: the assets in service whose direct links name it (same technology and version). */
export function vulnerabilityServersReachedByRowSql(tenant: string, ids?: string): string {
  return reachByRowSql(assetLinksSql({ tenant }), tenant, ids);
}

/**
 * Per row: the applications in service whose links name it, declared or hosted on a server's
 * direct link. `userRef`: the bound user id of a Business Contributor (own applications only), or
 * null for every application.
 */
export function vulnerabilityApplicationsReachedByRowSql(tenant: string, userRef: string | null, ids?: string): string {
  const links = userRef
    ? `SELECT val.* FROM (${applicationLinksSql({ tenant })}) val
         JOIN applications vala ON vala.tenant_id = val.tenant_id AND vala.id = val.subject_id AND ${applicationParticipantCondition('vala', userRef)}`
    : applicationLinksSql({ tenant });
  return reachByRowSql(links, tenant, ids);
}

/** The effective severity, the most severe first (null, not rated yet: 0). */
const SEVERITY_RANK = (severity: string) =>
  `(CASE ${severity} WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 WHEN 'none' THEN 1 ELSE 0 END)`;

export const VULNERABILITY_SEVERITIES = ['critical', 'high', 'medium', 'low', 'none'] as const;
export const VULNERABILITY_ROW_STATES = ['to_review', 'handled', 'not_affected'] as const;
export const VULNERABILITY_SOURCES = ['nvd', 'cve_org'] as const;

/** The vulnerabilities page, filtered on the row: its CVE, technology and version, every state and alert setting. */
export function vulnerabilityPageUrl(row: { cve_id: string; technology: string; version: string | null }): string {
  const params = new URLSearchParams({ q: row.cve_id, technology: row.technology, version: row.version ?? 'none', state: 'all', alerts: 'all' });
  return `/it/vulnerabilities?${params.toString()}`;
}

/** The value of `state` and `alerts` that keeps every row, as the page's `state=all` and `alerts=all`. */
export const ALL = 'all';

/**
 * The page's default (`VulnerabilitiesPage.tsx`, `vulnerabilities.service.ts`): without a filter on
 * the state or on the alert setting, the list and the aggregates keep the rows to review and the
 * rows that alert. `all` lifts either default.
 */
const DEFAULT_ROWS: Record<string, string> = {
  state: `x.state = 'to_review'`,
  alerts: 'x.alerts',
};

/** Set columns, by how they compare. */
const SET_COLUMNS: Record<string, 'text' | 'boolean'> = {
  severity: 'text',
  state: 'text',
  score_source: 'text',
  exploited: 'boolean',
  alerts: 'boolean',
  estate: 'boolean',
  matching: 'boolean',
};
const TEXT_COLUMNS = new Set(['cve_id', 'summary', 'note']);
const NUMBER_COLUMNS = new Set(['cvss_score', 'epss', 'servers_reached', 'applications_reached']);
const DATE_COLUMNS = new Set(['published_at', 'detected_at']);

const SORTS: Record<string, string> = {
  cve_id: 'x.cve_id',
  severity: SEVERITY_RANK('x.severity'),
  cvss_score: 'x.cvss_score',
  epss: 'x.epss',
  exploited: 'x.exploited',
  state: 'x.state',
  technology: 'lower(x.technology_name)',
  published_at: 'x.published_at',
  detected_at: 'x.detected_at',
  servers_reached: 'x.servers_reached',
  applications_reached: 'x.applications_reached',
  created_at: 'x.created_at',
  updated_at: 'x.updated_at',
};

const NUMBER_OPS: Record<string, string> = {
  equals: '=',
  notEqual: '<>',
  greaterThan: '>',
  greaterThanOrEqual: '>=',
  lessThan: '<',
  lessThanOrEqual: '<=',
};

const DATE_OPS: Record<string, string> = { equals: '=', notEqual: '<>', greaterThan: '>', lessThan: '<' };

function filterModels(raw: unknown): Record<string, any> {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      throw new BadRequestException('filters must be valid JSON.');
    }
  }
  return typeof raw === 'object' ? raw as Record<string, any> : {};
}

function day(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text) || Number.isNaN(Date.parse(text.slice(0, 10)))) {
    throw new BadRequestException(`"${text}" is not a date (YYYY-MM-DD).`);
  }
  return text.slice(0, 10);
}

function finite(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new BadRequestException(`"${String(value)}" is not a number.`);
  return n;
}

/** A set filter's ticked values: the non-blank strings, trimmed, and whether `null` (blank) is ticked. */
function setModel(column: string, model: any): { values: string[]; blank: boolean } {
  if (model?.filterType !== 'set' || model.mode === 'exclude' || !Array.isArray(model.values)) {
    throw new BadRequestException(`Unsupported filter on ${column}.`);
  }
  return {
    values: model.values.filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '').map((v: string) => v.trim()),
    blank: model.values.some((v: unknown) => v === null || v === ''),
  };
}

/** The ids the `asset` and `application` filters name, resolved before the rows. */
type SubjectFilterIds = Partial<Record<'asset' | 'application', string[]>>;

/**
 * The ids the `asset` and `application` filter models name (an id or `AST-n` / `APP-n`, without
 * case; an application within what the caller reads), one query each, before the rows are read.
 */
async function subjectFilterIds(
  mg: Pick<EntityManager, 'query'>,
  tenantId: string,
  models: Record<string, any>,
  applications: AiApplicationsReach,
): Promise<SubjectFilterIds> {
  const out: SubjectFilterIds = {};
  for (const kind of ['asset', 'application'] as const) {
    if (!Object.prototype.hasOwnProperty.call(models, kind)) continue;
    const { values } = setModel(kind, models[kind]);
    out[kind] = values.length ? (await vulnerabilitySubjectIds(mg, tenantId, kind, values, applications)).ids : [];
  }
  return out;
}

/** One grid filter model on a column of `x`, or a 400 for a model this list cannot take. */
function filterClause(column: string, model: any, bind: (value: unknown) => string, applications: AiApplicationsReach, subjects: SubjectFilterIds): string | null {
  const expr = `x.${column}`;
  if (SET_COLUMNS[column]) {
    const { values, blank } = setModel(column, model);
    // `all` on the state or the alert setting lifts the page's default (`DEFAULT_ROWS`).
    if (DEFAULT_ROWS[column] && values.includes(ALL)) return null;
    if (SET_COLUMNS[column] === 'boolean') {
      const yes = values.some((v) => v.toLowerCase() === 'true');
      const no = values.some((v) => v.toLowerCase() === 'false');
      return yes && no ? 'true' : yes ? expr : no ? `NOT ${expr}` : 'false';
    }
    const parts = [
      ...(values.length ? [`${expr} = ANY(${bind(values)}::text[])`] : []),
      ...(blank ? [`${expr} IS NULL`] : []),
    ];
    return parts.length ? `(${parts.join(' OR ')})` : 'false';
  }
  if (column === 'technology') {
    // A reference, an id or a name, without case.
    const { values } = setModel(column, model);
    if (!values.length) return 'false';
    const p = bind(values.map((v) => v.toUpperCase()));
    return `(upper(x.technology) = ANY(${p}::text[]) OR upper(x.technology_id::text) = ANY(${p}::text[]) OR upper(x.technology_name) = ANY(${p}::text[]))`;
  }
  if (column === 'version') {
    // Labels; `null`: the rows with no version recorded.
    const { values, blank } = setModel(column, model);
    const parts = [
      ...(values.length ? [`x.version = ANY(${bind(values)}::text[])`] : []),
      ...(blank ? ['x.technology_version_id IS NULL'] : []),
    ];
    return parts.length ? `(${parts.join(' OR ')})` : 'false';
  }
  if (column === 'sources') {
    // A row both feeds matched is in both.
    const { values } = setModel(column, model);
    const known = values.map((v) => v.toLowerCase()).filter((v) => (VULNERABILITY_SOURCES as readonly string[]).includes(v));
    return known.length ? `x.match_sources && ${bind(known)}::text[]` : 'false';
  }
  if (column === 'asset') {
    // Direct links only, as the page (`rowOnAssetsSql`); an unknown asset matches nothing.
    setModel(column, model);
    const ids = subjects.asset ?? [];
    return ids.length ? rowOnAssetsSql({ tenant: '$1', ids: bind(ids) }, 'x') : 'false';
  }
  if (column === 'application') {
    // Declared or hosted on a server's direct link (`rowOnApplicationsSql`), within what the caller
    // reads; an unknown application, or one out of that scope, matches nothing.
    setModel(column, model);
    const ids = applications ? subjects.application ?? [] : [];
    return ids.length ? rowOnApplicationsSql({ tenant: '$1', ids: bind(ids) }, 'x') : 'false';
  }
  if (TEXT_COLUMNS.has(column)) {
    if (model?.filterType !== 'text') throw new BadRequestException(`Unsupported filter on ${column}.`);
    return gridTextClause(expr, model, bind);
  }
  if (NUMBER_COLUMNS.has(column)) {
    if (model?.filterType !== 'number') throw new BadRequestException(`Unsupported filter on ${column}.`);
    if (model.type === 'inRange') return `${expr} BETWEEN ${bind(finite(model.filter))} AND ${bind(finite(model.filterTo))}`;
    if (model.type === 'blank') return `${expr} IS NULL`;
    if (model.type === 'notBlank') return `${expr} IS NOT NULL`;
    const op = NUMBER_OPS[model.type];
    if (!op) throw new BadRequestException(`Unsupported filter on ${column}.`);
    return `${expr} ${op} ${bind(finite(model.filter))}`;
  }
  if (DATE_COLUMNS.has(column)) {
    if (model?.filterType !== 'date') throw new BadRequestException(`Unsupported filter on ${column}.`);
    if (model.operator && Array.isArray(model.conditions)) {
      const parts = model.conditions.map((condition: any) => filterClause(column, { filterType: 'date', ...condition }, bind, applications, subjects)).filter(Boolean);
      return parts.length ? `(${parts.join(model.operator === 'OR' ? ' OR ' : ' AND ')})` : null;
    }
    if (model.type === 'blank') return `${expr} IS NULL`;
    if (model.type === 'notBlank') return `${expr} IS NOT NULL`;
    if (model.type === 'inRange') return `${expr} BETWEEN ${bind(day(model.dateFrom))}::date AND ${bind(day(model.dateTo))}::date`;
    const op = DATE_OPS[model.type];
    if (!op) throw new BadRequestException(`Unsupported filter on ${column}.`);
    return `${expr} ${op} ${bind(day(model.dateFrom))}::date`;
  }
  throw new BadRequestException(`Unsupported filter field: ${column}.`);
}

export type AiVulnerabilityRow = {
  id: string;
  cve_id: string;
  summary: string | null;
  severity: string | null;
  cvss_score: number | null;
  score_source: 'nvd' | 'cve_org' | null;
  exploited: boolean;
  epss: number | null;
  state: string;
  note: string | null;
  /** The technology's reference (`TEC-n`) and name. */
  technology: string;
  technology_name: string;
  /** The version's label; null: none recorded, the CVE potentially concerns it. */
  version: string | null;
  /** The feeds that matched the row, sorted. */
  sources: string[];
  alerts: boolean;
  /** The technology is in use in the estate (`technologyInEstateSql`). */
  estate: boolean;
  /** The matching still finds the row; false: no longer matches. */
  matching: boolean;
  published_at: string | null;
  detected_at: string | null;
  /** The first detection, to the second: the item's created_at. */
  created_at: Date | string | null;
  updated_at: Date | string | null;
  servers_reached: number;
  applications_reached: number | null;
  /** The vulnerabilities page, filtered on this row. */
  page_url: string;
};

/** What the detail adds to a row. */
export type AiVulnerabilityDetailRow = AiVulnerabilityRow & {
  cvss_version: string | null;
  cvss_vector: string | null;
  cisa_kev: boolean;
  eu_kev: boolean;
  kev_added_at: string | null;
  kev_ransomware: boolean | null;
  epss_percentile: number | null;
  epss_date: string | null;
  euvd_id: string | null;
  last_modified_at: string | null;
  potential: boolean;
  state_changed_at: Date | string | null;
  state_changed_by: string | null;
};

const numberOrNull = (value: unknown): number | null => (value == null || value === '' ? null : Number(value));

/**
 * A page of vulnerability rows (`page`, `limit`, `sort` as `field:DIR`, `q` on the CVE id, the
 * technology name and the summary, `filters` keyed by grid column), or their ids only (`idsOnly`,
 * for the aggregates). Default order, as the page: exploited first, then the most severe, the
 * highest score, the latest published. `ids` narrows to those rows, `cveIds` to those CVE (the
 * detail, which also reads the `detail` columns).
 */
export async function listAiVulnerabilities(
  mg: Pick<EntityManager, 'query'>,
  tenantId: string,
  query: Record<string, any>,
  applications: AiApplicationsReach,
  opts: { idsOnly?: boolean; ids?: string[]; cveIds?: string[]; detail?: boolean } = {},
): Promise<{ items: AiVulnerabilityDetailRow[]; ids: string[]; total: number; distinct_total: number; page: number; limit: number }> {
  assertAiVulnerabilitiesAvailable();
  const params: unknown[] = [tenantId];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const narrow = [
    ...(opts.ids ? [`tv.id = ANY(${bind(opts.ids)}::uuid[])`] : []),
    ...(opts.cveIds ? [`tv.cve_id = ANY(${bind(opts.cveIds)}::text[])`] : []),
  ];
  const applicationsReach = applications
    ? `LEFT JOIN (${vulnerabilityApplicationsReachedByRowSql('$1', applications.scope ? bind(applications.scope.userId) : null)}) var ON var.id = tv.id`
    : '';
  const applicationsReached = applications ? 'COALESCE(var.n, 0)' : 'NULL::int';
  const where: string[] = [];
  const models = filterModels(query.filters);
  const subjects = await subjectFilterIds(mg, tenantId, models, applications);
  for (const [column, model] of Object.entries(models)) {
    const clause = filterClause(column, model, bind, applications, subjects);
    if (clause) where.push(clause);
  }
  // The page's default, on a list or an aggregate; a read by id or by CVE (the detail) keeps every row.
  if (!opts.ids && !opts.cveIds) {
    for (const [column, clause] of Object.entries(DEFAULT_ROWS)) {
      if (!Object.prototype.hasOwnProperty.call(models, column)) where.push(clause);
    }
  }
  const q = String(query.q ?? '').trim().slice(0, 100);
  if (q) {
    const needle = bind(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(x.cve_id ILIKE ${needle} OR x.technology_name ILIKE ${needle} OR x.technology ILIKE ${needle} OR x.summary ILIKE ${needle})`);
  }
  const [sortField, sortDirection] = String(query.sort ?? '').split(':');
  const direction = String(sortDirection ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const severityThen = `${SEVERITY_RANK('x.severity')} DESC, x.cvss_score DESC NULLS LAST`;
  const tail = `x.cve_id DESC, lower(x.technology_name), x.technology_id, ${versionOrderSql('x.version')}, x.id`;
  const order = sortField === 'severity'
    ? `${SORTS.severity} ${direction}, x.cvss_score ${direction} NULLS LAST, x.published_at DESC NULLS LAST, ${tail}`
    : Object.prototype.hasOwnProperty.call(SORTS, sortField) && sortField !== 'exploited'
      ? `${SORTS[sortField]} ${direction} NULLS LAST, ${severityThen}, ${tail}`
      // Exploited first, the default and the column itself.
      : `x.exploited ${sortField === 'exploited' ? direction : 'DESC'}, ${severityThen}, x.published_at DESC NULLS LAST, ${tail}`;
  const limit = opts.idsOnly
    ? Math.min(Math.max(Number(query.limit) || 10_000, 1), 10_000)
    : Math.min(Math.max(Number(query.limit) || 25, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = opts.idsOnly ? 0 : (page - 1) * limit;
  const detailColumns = opts.detail
    ? `, ${EFFECTIVE_CVSS_VERSION} AS cvss_version, ${EFFECTIVE_CVSS_VECTOR} AS cvss_vector,
       COALESCE(c.cisa_kev, false) AS cisa_kev, COALESCE(c.eu_kev, false) AS eu_kev, c.kev_added_at::text AS kev_added_at,
       c.kev_ransomware, c.epss_percentile::text AS epss_percentile, c.epss_date::text AS epss_date, c.euvd_id,
       to_char(c.last_modified_at, 'YYYY-MM-DD') AS last_modified_at, (tv.match_basis = 'version_unknown') AS potential,
       tv.state_changed_at,
       (SELECT NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') FROM users u
         WHERE u.tenant_id = tv.tenant_id AND u.id = tv.state_changed_by) AS state_changed_by`
    : '';
  const rows: any[] = await mg.query(
    `WITH x AS (
       SELECT tv.id, tv.tenant_id, tv.technology_id, tv.technology_version_id, tv.cve_id,
              ${EFFECTIVE_SUMMARY} AS summary, ${EFFECTIVE_SEVERITY} AS severity, ${EFFECTIVE_SCORE} AS cvss_score,
              ${SCORE_SOURCE_SQL} AS score_source, ${exploitedSql('c')} AS exploited, c.epss,
              tv.state, tv.note, ('TEC-' || t.item_number) AS technology, t.name AS technology_name, v.label AS version,
              tv.match_sources, ${vulnerabilityAlertsSql('v', 't')} AS alerts,
              ${technologyInEstateSql('tv')} AS estate, tv.matching,
              c.published_at::date AS published_at, tv.detected_at::date AS detected_at, tv.detected_at AS created_at, tv.updated_at,
              -- As text too: the driver would read a date at local midnight.
              to_char(c.published_at::date, 'YYYY-MM-DD') AS published_day, to_char(tv.detected_at::date, 'YYYY-MM-DD') AS detected_day,
              COALESCE(vsr.n, 0) AS servers_reached,
              ${applicationsReached} AS applications_reached
              ${detailColumns}
         FROM technology_vulnerabilities tv
         ${VULNERABILITY_ROW_JOINS}
         LEFT JOIN (${vulnerabilityServersReachedByRowSql('$1')}) vsr ON vsr.id = tv.id
         ${applicationsReach}
        WHERE tv.tenant_id = $1 ${narrow.map((clause) => `AND ${clause}`).join(' ')}
     ),
     -- Inlined: read twice (the rows and the distinct CVE), a materialized f cost a full scan of it
     -- and most of the time in JIT (lot E review: 75-103 ms against 28 ms on 10,131 rows).
     f AS NOT MATERIALIZED (SELECT x.* FROM x ${where.length ? `WHERE ${where.join(' AND ')}` : ''})
     -- The distinct CVE of every row kept, as the page's total: over the whole set, never the page or the ids cap.
     SELECT ${opts.idsOnly ? 'x.id' : 'x.*'}, (SELECT count(DISTINCT fd.cve_id) FROM f fd)::int AS distinct_total, count(*) OVER () AS total
       FROM f x
      ORDER BY ${order}
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
    params,
  );
  const items = opts.idsOnly ? [] : rows.map((row): AiVulnerabilityDetailRow => {
    const sources = (Array.isArray(row.match_sources) ? row.match_sources as string[] : []).filter((s) => (VULNERABILITY_SOURCES as readonly string[]).includes(s)).sort();
    return {
      id: row.id,
      cve_id: row.cve_id,
      summary: row.summary ?? null,
      severity: row.severity ?? null,
      cvss_score: numberOrNull(row.cvss_score),
      score_source: row.score_source === 'nvd' || row.score_source === 'cve_org' ? row.score_source : null,
      exploited: row.exploited === true,
      epss: numberOrNull(row.epss),
      state: row.state,
      note: row.note ?? null,
      technology: row.technology,
      technology_name: row.technology_name,
      version: row.version ?? null,
      sources,
      alerts: row.alerts === true,
      estate: row.estate === true,
      matching: row.matching === true,
      published_at: row.published_day ?? null,
      detected_at: row.detected_day ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      servers_reached: Number(row.servers_reached) || 0,
      applications_reached: row.applications_reached == null ? null : Number(row.applications_reached),
      page_url: vulnerabilityPageUrl(row),
      cvss_version: row.cvss_version ?? null,
      cvss_vector: row.cvss_vector ?? null,
      cisa_kev: row.cisa_kev === true,
      eu_kev: row.eu_kev === true,
      kev_added_at: row.kev_added_at ?? null,
      kev_ransomware: row.kev_ransomware ?? null,
      epss_percentile: numberOrNull(row.epss_percentile),
      epss_date: row.epss_date ?? null,
      euvd_id: row.euvd_id ?? null,
      last_modified_at: row.last_modified_at ?? null,
      potential: row.potential === true,
      state_changed_at: row.state_changed_at ?? null,
      state_changed_by: row.state_changed_by ?? null,
    };
  });
  return {
    items,
    ids: rows.map((row) => row.id),
    total: Number(rows[0]?.total ?? 0),
    distinct_total: Number(rows[0]?.distinct_total ?? 0),
    page,
    limit,
  };
}

const FEED_NAMES: Record<AiVulnerabilityFeed['source'], string> = { nvd: 'NVD', cve_org: 'CVE.org' };

/**
 * How fresh the feeds are, as the page's feed line (`vulnerabilityFeedSources`, `feedText.ts`):
 * the feeds that are on, by name, with their last success and whether the last attempt failed.
 * Never the error text. A platform table: no tenant to carry.
 */
export async function readAiVulnerabilityFeeds(mg: Pick<EntityManager, 'query'>): Promise<AiVulnerabilityFeed[]> {
  assertAiVulnerabilitiesAvailable();
  return (await vulnerabilityFeedSources(mg))
    .filter((feed) => feed.enabled)
    .map((feed) => ({
      source: feed.source,
      name: FEED_NAMES[feed.source],
      // As text: the dispatcher's redaction (MCP and chat) walks objects and would empty a Date.
      last_success_at: feed.last_success_at ? new Date(feed.last_success_at).toISOString() : null,
      failing: feed.failing,
    }));
}
