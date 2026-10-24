import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { gridTextClause } from '../../technologies/technologies.service';
import { versionInUseSql, versionSupportSql } from '../../technologies/reports/version-support';
import { countingRowSql, rowJoinsSql, vulnerabilityCountsEnabled } from '../../vulnerabilities/vulnerability-reach-counts';
import { assetInServiceSql, inServiceSql, technologyServersCountSql } from '../../technologies/technology-reach.service';
import type { AiContextEntityType, AiExecutionContextWithManager, AiSearchEntityType } from '../ai.types';
import { resolveAiParticipationAccessScope } from './ai-query-scope.util';

/**
 * The technologies as the assistant and the MCP server read them (`query_entities`,
 * `aggregate_entities`, `get_entity_detail`): the record's columns plus figures computed at
 * read time, each one statement shared by the list, its filters, its sort and the aggregates.
 *
 * - `server_count`: the servers of the technology as the technology list counts them
 *   (`technologyServersCountSql`): assets in service that carry it, installed or carried through
 *   the asset graph, clusters excluded.
 * - `application_count`: the applications that declare it, in service (`inServiceSql`), within the
 *   caller's read scope (a Business Contributor's own); null for a caller who cannot read
 *   applications, never a count of applications the caller cannot see.
 * - Support, over the versions in use (on an asset in service or declared by an application in
 *   service), each version dated by the rule of the End of support report (`versionSupportSql`):
 *   `support_status`, the most severe state (out_of_support, extended_support, supported; unknown
 *   when no version in use has a date); `end_of_standard_support`, the earliest first end;
 *   `end_of_support`, the earliest last end, after which that version has no support at all;
 *   `versions_in_use`, each version with its state, date and servers, the most severe first.
 * - `open_vulnerabilities`: the CVE still to review that alert (as the technology list counts
 *   them). A version follows its technology unless that version has its own setting, and a row
 *   with no version follows the technology. Operating systems start excluded. null while the
 *   vulnerability feed is off.
 *
 * Every statement carries the tenant on every table besides RLS.
 */

/** What the caller may see of the applications: none (null), all, or a Business Contributor's own. */
export type AiApplicationsReach = { scope?: ParticipationAccessScope } | null;

/** The servers of the technology `t`, one definition with the technology list (`technologyServersCountSql`). */
export function technologyServerCountSql(t: string): string {
  return technologyServersCountSql(t);
}

/** `userRef`: the bound user id of a Business Contributor, or null for every application. */
export function technologyApplicationCountSql(t: string, userRef: string | null): string {
  return `(SELECT count(DISTINCT cd.application_id)::int
             FROM application_technologies cd
             JOIN applications cap ON cap.tenant_id = cd.tenant_id AND cap.id = cd.application_id AND ${inServiceSql('cap')}
                  ${userRef ? `AND ${applicationParticipantCondition('cap', userRef)}` : ''}
            WHERE cd.tenant_id = ${t}.tenant_id AND cd.technology_id = ${t}.id)`;
}

/** The most severe first: the rank of a version's state (null, no date: 0). */
const STATE_RANK = (state: string) => `(CASE ${state} WHEN 'out_of_support' THEN 3 WHEN 'extended_support' THEN 2 WHEN 'supported' THEN 1 ELSE 0 END)`;
export const SUPPORT_STATUSES = ['out_of_support', 'extended_support', 'supported', 'unknown'] as const;

/** `select` over the versions in use of the technology `t` (alias `ev`). */
function overVersionsInUse(t: string, select: string): string {
  return `(SELECT ${select}
             FROM technology_versions ev
            WHERE ev.tenant_id = ${t}.tenant_id AND ev.technology_id = ${t}.id AND ${versionInUseSql('ev')})`;
}

/** The most severe state among the versions in use; unknown when none of them has a date. */
export function technologySupportStatusSql(t: string): string {
  const rank = STATE_RANK(versionSupportSql('ev').state);
  return overVersionsInUse(t, `(ARRAY['unknown', 'supported', 'extended_support', 'out_of_support'])[COALESCE(max(${rank}), 0) + 1]`);
}

/** The earliest end of standard support among the versions in use (their first end). */
export function technologyEndOfStandardSupportSql(t: string): string {
  return overVersionsInUse(t, `min(${versionSupportSql('ev').first})`);
}

/** The earliest end of all support among the versions in use (their last end). */
export function technologyEndOfSupportSql(t: string): string {
  return overVersionsInUse(t, `min(${versionSupportSql('ev').last})`);
}

/** The versions in use listed in a row, at most. */
const VERSIONS_IN_USE_LIMIT = 10;

/**
 * The versions in use of `t` as JSON: the first `VERSIONS_IN_USE_LIMIT`, the most severe first,
 * then by date, each with its state, date, servers in service, and the number of versions in use.
 */
function technologyVersionsInUseSql(t: string): string {
  const support = versionSupportSql('ev');
  return `(SELECT json_agg(json_build_object('label', x.label, 'state', x.state, 'date', x.day, 'standard_end', x.standard_end,
                                              'servers', x.servers, 'total', x.total) ORDER BY x.n)
             FROM (SELECT ev.label, COALESCE(${support.state}, 'unknown') AS state, to_char(${support.date}, 'YYYY-MM-DD') AS day,
                          (ev.standard_support_end IS NOT NULL AND ev.extended_support_end > ev.standard_support_end) AS standard_end,
                          (SELECT count(DISTINCT vat.asset_id)::int
                             FROM asset_technologies vat
                             JOIN assets va ON va.tenant_id = vat.tenant_id AND va.id = vat.asset_id AND ${assetInServiceSql('va')}
                            WHERE vat.tenant_id = ev.tenant_id AND vat.technology_id = ev.technology_id AND vat.technology_version_id = ev.id) AS servers,
                          count(*) OVER () AS total,
                          row_number() OVER (ORDER BY ${STATE_RANK(support.state)} DESC, ${support.date} ASC NULLS LAST, ev.label, ev.id) AS n
                     FROM technology_versions ev
                    WHERE ev.tenant_id = ${t}.tenant_id AND ev.technology_id = ${t}.id AND ${versionInUseSql('ev')}) x
            WHERE x.n <= ${VERSIONS_IN_USE_LIMIT})`;
}

type VersionInUse = { label: string; state: string; date: string | null; standard_end: boolean; servers: number; total: number };

/** One line for the model: each version, its state and date, its servers; the rest counted. */
export function versionsInUseText(versions: VersionInUse[] | null): string | null {
  if (!versions?.length) return null;
  const parts = versions.map((v) => {
    const state = v.state === 'out_of_support' ? `out of support since ${v.date}`
      : v.state === 'extended_support' ? `extended support until ${v.date}`
      : v.state === 'supported' ? (v.standard_end ? `supported, standard support until ${v.date}` : `supported until ${v.date}`)
      : 'no end of support date';
    return `${v.label}: ${state}, ${v.servers} ${v.servers === 1 ? 'server' : 'servers'}`;
  });
  const rest = Number(versions[0].total) - versions.length;
  if (rest > 0) parts.push(`and ${rest} other ${rest === 1 ? 'version' : 'versions'}`);
  return parts.join('; ');
}

/** The distinct CVE of the technology `t` that count (`vulnerability-reach-counts.ts`); null with the feed off. */
export function technologyOpenVulnerabilitiesSql(t: string): string {
  if (!vulnerabilityCountsEnabled()) return 'NULL::int';
  const a = { row: 'tv', technology: t, version: 'ver', cve: 'vc', record: 'vr' };
  return `(SELECT count(DISTINCT tv.cve_id)::int
             FROM technology_vulnerabilities tv
             ${rowJoinsSql(a, false)}
            WHERE tv.tenant_id = ${t}.tenant_id AND tv.technology_id = ${t}.id AND ${countingRowSql(a)})`;
}

/**
 * The applications reach of the caller, once per AI execution context: null without the
 * `applications` read right, else the Business Contributor scope (undefined: every application).
 */
export async function resolveAiApplicationsReach(
  context: AiExecutionContextWithManager,
  policy?: { canReadEntityType(context: AiExecutionContextWithManager, entityType: AiSearchEntityType | AiContextEntityType, manager: EntityManager): Promise<boolean> },
): Promise<AiApplicationsReach> {
  const host = context as AiExecutionContextWithManager & { __aiApplicationsReach?: Promise<AiApplicationsReach> };
  if (host.__aiApplicationsReach) return host.__aiApplicationsReach;
  const pending = (async () => {
    if (!policy || !(await policy.canReadEntityType(context, 'applications', context.manager))) return null;
    return { scope: await resolveAiParticipationAccessScope(context, 'applications') };
  })();
  host.__aiApplicationsReach = pending;
  // A failure is not kept: the next call of the same context asks again.
  pending.catch(() => {
    if (host.__aiApplicationsReach === pending) host.__aiApplicationsReach = undefined;
  });
  return pending;
}

/** Set columns (registry `grid`), compared without case where `ci`. */
const SET_COLUMNS: Record<string, { ci: boolean }> = {
  reference: { ci: true },
  family: { ci: false },
  editor: { ci: true },
  hosting_type: { ci: false },
  lifecycle: { ci: false },
  admin_zone: { ci: false },
  support_status: { ci: false },
};
const TEXT_COLUMNS = new Set(['name']);
const NUMBER_COLUMNS = new Set(['server_count', 'application_count', 'open_vulnerabilities']);
const DATE_COLUMNS = new Set(['end_of_support', 'end_of_standard_support']);

const SORTS: Record<string, string> = {
  name: 'lower(r.name)',
  reference: 'r.item_number',
  family: 'r.family',
  editor: 'lower(r.editor)',
  hosting_type: 'r.hosting_type',
  lifecycle: 'r.lifecycle',
  admin_zone: 'r.admin_zone',
  server_count: 'r.server_count',
  application_count: 'r.application_count',
  support_status: STATE_RANK('r.support_status'),
  end_of_standard_support: 'r.end_of_standard_support',
  end_of_support: 'r.end_of_support',
  open_vulnerabilities: 'r.open_vulnerabilities',
  created_at: 'r.created_at',
  updated_at: 'r.updated_at',
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

/** One grid filter model on a column of `r`, or a 400 for a model this list cannot take. */
function filterClause(column: string, model: any, bind: (value: unknown) => string): string | null {
  const expr = `r.${column}`;
  if (SET_COLUMNS[column]) {
    if (model?.filterType !== 'set' || model.mode === 'exclude' || !Array.isArray(model.values)) {
      throw new BadRequestException(`Unsupported filter on ${column}.`);
    }
    const { ci } = SET_COLUMNS[column];
    const values = model.values.filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '').map((v: string) => (ci ? v.trim().toLowerCase() : v.trim()));
    const blank = model.values.some((v: unknown) => v === null || v === '');
    const parts = [
      ...(values.length ? [`${ci ? `lower(${expr})` : expr} = ANY(${bind(values)}::text[])`] : []),
      ...(blank ? [`${expr} IS NULL`] : []),
    ];
    return parts.length ? `(${parts.join(' OR ')})` : 'false';
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
      const parts = model.conditions.map((condition: any) => filterClause(column, { filterType: 'date', ...condition }, bind)).filter(Boolean);
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

export type AiTechnologyRow = {
  id: string;
  item_number: number;
  reference: string;
  name: string;
  editor: string | null;
  family: string | null;
  hosting_type: string | null;
  lifecycle: string | null;
  admin_zone: string | null;
  description: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  server_count: number;
  application_count: number | null;
  support_status: (typeof SUPPORT_STATUSES)[number];
  end_of_standard_support: string | null;
  end_of_support: string | null;
  /** The versions in use, the most severe first (`versionsInUseText`), null without one. */
  versions_in_use: string | null;
  open_vulnerabilities: number | null;
};

/**
 * A page of technologies (`page`, `limit`, `sort` as `field:DIR`, `q` on name, publisher and
 * reference, `filters` keyed by grid column), or its ids only (`idsOnly`, for the aggregates).
 * An unknown sort falls back to the name. `ids` narrows to those technologies (the detail).
 */
export async function listAiTechnologies(
  mg: Pick<EntityManager, 'query'>,
  tenantId: string,
  query: Record<string, any>,
  applications: AiApplicationsReach,
  opts: { idsOnly?: boolean; ids?: string[] } = {},
): Promise<{ items: AiTechnologyRow[]; ids: string[]; total: number; page: number; limit: number }> {
  const params: unknown[] = [tenantId];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const idFilter = opts.ids ? `AND t.id = ANY(${bind(opts.ids)}::uuid[])` : '';
  const applicationCount = applications
    ? technologyApplicationCountSql('t', applications.scope ? bind(applications.scope.userId) : null)
    : 'NULL::int';
  const where: string[] = [];
  for (const [column, model] of Object.entries(filterModels(query.filters))) {
    const clause = filterClause(column, model, bind);
    if (clause) where.push(clause);
  }
  const q = String(query.q ?? '').trim().slice(0, 100);
  if (q) {
    const needle = bind(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(r.name ILIKE ${needle} OR r.editor ILIKE ${needle} OR r.reference ILIKE ${needle})`);
  }
  const [sortField, sortDirection] = String(query.sort ?? 'name').split(':');
  const sort = SORTS[sortField] ?? SORTS.name;
  const direction = String(sortDirection ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const limit = opts.idsOnly
    ? Math.min(Math.max(Number(query.limit) || 10_000, 1), 10_000)
    : Math.min(Math.max(Number(query.limit) || 25, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = opts.idsOnly ? 0 : (page - 1) * limit;
  const rows: Array<Omit<AiTechnologyRow, 'versions_in_use'> & { versions_in_use: VersionInUse[] | null; total: string }> = await mg.query(
    `WITH r AS (
       SELECT t.id, t.item_number, ('TEC-' || t.item_number) AS reference, t.name, t.editor, t.family, t.hosting_type,
              t.lifecycle, t.admin_zone, t.description, t.created_at, t.updated_at,
              ${technologyServerCountSql('t')} AS server_count,
              ${applicationCount} AS application_count,
              ${technologySupportStatusSql('t')} AS support_status,
              ${technologyEndOfStandardSupportSql('t')} AS end_of_standard_support,
              ${technologyEndOfSupportSql('t')} AS end_of_support,
              ${technologyOpenVulnerabilitiesSql('t')} AS open_vulnerabilities
              ${opts.idsOnly ? '' : `, ${technologyVersionsInUseSql('t')} AS versions_in_use`}
         FROM technologies t
        WHERE t.tenant_id = $1 ${idFilter}
     )
     SELECT ${opts.idsOnly ? 'r.id' : `r.id, r.item_number, r.reference, r.name, r.editor, r.family, r.hosting_type, r.lifecycle,
            r.admin_zone, r.description, r.created_at, r.updated_at, r.server_count, r.application_count, r.support_status,
            to_char(r.end_of_standard_support, 'YYYY-MM-DD') AS end_of_standard_support,
            to_char(r.end_of_support, 'YYYY-MM-DD') AS end_of_support, r.open_vulnerabilities, r.versions_in_use`},
            count(*) OVER () AS total
       FROM r
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${sort} ${direction} NULLS LAST, r.id
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
    params,
  );
  const items = opts.idsOnly ? [] : rows.map(({ total: _total, ...row }) => ({
    ...row,
    server_count: Number(row.server_count) || 0,
    application_count: row.application_count == null ? null : Number(row.application_count),
    open_vulnerabilities: row.open_vulnerabilities == null ? null : Number(row.open_vulnerabilities),
    versions_in_use: versionsInUseText(row.versions_in_use),
  }));
  return { items, ids: rows.map((row) => row.id), total: Number(rows[0]?.total ?? 0), page, limit };
}

/**
 * Each version of the technology: the servers in service it runs on, whether it is in use, and its
 * support state (unknown without a date) and that state's date, by the End of support report rule.
 */
export async function technologyVersionFigures(
  mg: Pick<EntityManager, 'query'>,
  tenantId: string,
  technologyId: string,
): Promise<Map<string, { servers: number; in_use: boolean; support_status: string; support_date: string | null }>> {
  const support = versionSupportSql('v');
  const rows: Array<{ id: string; servers: number; in_use: boolean; support_status: string; support_date: string | null }> = await mg.query(
    `SELECT v.id, (SELECT count(DISTINCT at.asset_id)::int
                     FROM asset_technologies at
                     JOIN assets a ON a.tenant_id = at.tenant_id AND a.id = at.asset_id AND ${assetInServiceSql('a')}
                    WHERE at.tenant_id = v.tenant_id AND at.technology_id = v.technology_id AND at.technology_version_id = v.id) AS servers,
            ${versionInUseSql('v')} AS in_use,
            COALESCE(${support.state}, 'unknown') AS support_status,
            to_char(${support.date}, 'YYYY-MM-DD') AS support_date
       FROM technology_versions v
      WHERE v.tenant_id = $1 AND v.technology_id = $2`,
    [tenantId, technologyId],
  );
  return new Map(rows.map((row) => [row.id, {
    servers: Number(row.servers) || 0,
    in_use: row.in_use === true,
    support_status: row.support_status,
    support_date: row.support_date ?? null,
  }]));
}

/** The contracts linked to the technology. */
export async function technologyContractCount(mg: Pick<EntityManager, 'query'>, tenantId: string, technologyId: string): Promise<number> {
  const [row]: Array<{ count: number }> = await mg.query(
    `SELECT count(*)::int AS count FROM technology_contracts WHERE tenant_id = $1 AND technology_id = $2`,
    [tenantId, technologyId],
  );
  return Number(row?.count) || 0;
}
