import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { Features } from '../../config/features';
import { gridTextClause } from '../../technologies/technologies.service';
import { assetInServiceSql, inServiceSql } from '../../technologies/technology-reach.service';
import type { AiContextEntityType, AiExecutionContextWithManager, AiSearchEntityType } from '../ai.types';
import { resolveAiParticipationAccessScope } from './ai-query-scope.util';

/**
 * The technologies as the assistant and the MCP server read them (`query_entities`,
 * `aggregate_entities`, `get_entity_detail`): the record's columns plus four figures computed at
 * read time, each one statement shared by the list, its filters, its sort and the aggregates.
 *
 * - `server_count`: the assets the technology is installed on directly, retired ones left out.
 * - `application_count`: the applications that declare it, in service (`inServiceSql`), within the
 *   caller's read scope (a Business Contributor's own); null for a caller who cannot read
 *   applications, never a count of applications the caller cannot see.
 * - `end_of_support`: the earliest end of support among the versions in use (on an asset in service
 *   or declared by an application in service), each version dated as the End of support report
 *   dates it (its standard end, or its extended end when it has no standard one); null without a date.
 * - `open_vulnerabilities`: the CVE still to review (as the technology list counts them), null while
 *   the vulnerability feed is off.
 *
 * Every statement carries the tenant on every table besides RLS.
 */

/** What the caller may see of the applications: none (null), all, or a Business Contributor's own. */
export type AiApplicationsReach = { scope?: ParticipationAccessScope } | null;

export function technologyServerCountSql(t: string): string {
  return `(SELECT count(DISTINCT sat.asset_id)::int
             FROM asset_technologies sat
             JOIN assets sa ON sa.tenant_id = sat.tenant_id AND sa.id = sat.asset_id AND ${assetInServiceSql('sa')}
            WHERE sat.tenant_id = ${t}.tenant_id AND sat.technology_id = ${t}.id)`;
}

/** `userRef`: the bound user id of a Business Contributor, or null for every application. */
export function technologyApplicationCountSql(t: string, userRef: string | null): string {
  return `(SELECT count(DISTINCT cd.application_id)::int
             FROM application_technologies cd
             JOIN applications cap ON cap.tenant_id = cd.tenant_id AND cap.id = cd.application_id AND ${inServiceSql('cap')}
                  ${userRef ? `AND ${applicationParticipantCondition('cap', userRef)}` : ''}
            WHERE cd.tenant_id = ${t}.tenant_id AND cd.technology_id = ${t}.id)`;
}

/** A version in use: on an asset in service, or declared by an application in service. */
function versionInUseSql(v: string): string {
  return `(EXISTS (SELECT 1 FROM asset_technologies uat
                     JOIN assets ua ON ua.tenant_id = uat.tenant_id AND ua.id = uat.asset_id AND ${assetInServiceSql('ua')}
                    WHERE uat.tenant_id = ${v}.tenant_id AND uat.technology_id = ${v}.technology_id AND uat.technology_version_id = ${v}.id)
        OR EXISTS (SELECT 1 FROM application_technologies ud
                     JOIN applications uap ON uap.tenant_id = ud.tenant_id AND uap.id = ud.application_id AND ${inServiceSql('uap')}
                    WHERE ud.tenant_id = ${v}.tenant_id AND ud.technology_id = ${v}.technology_id AND ud.technology_version_id = ${v}.id))`;
}

export function technologyEndOfSupportSql(t: string): string {
  return `(SELECT min(COALESCE(ev.standard_support_end, ev.extended_support_end))
             FROM technology_versions ev
            WHERE ev.tenant_id = ${t}.tenant_id AND ev.technology_id = ${t}.id AND ${versionInUseSql('ev')})`;
}

export function technologyOpenVulnerabilitiesSql(t: string): string {
  if (!Features.VULNERABILITY_FEED_ENABLED) return 'NULL::int';
  return `(SELECT count(DISTINCT tv.cve_id)::int
             FROM technology_vulnerabilities tv
             JOIN vulnerability_cves vc ON vc.cve_id = tv.cve_id
            WHERE tv.tenant_id = ${t}.tenant_id AND tv.technology_id = ${t}.id AND tv.state = 'to_review')`;
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
  host.__aiApplicationsReach ??= (async () => {
    if (!policy || !(await policy.canReadEntityType(context, 'applications', context.manager))) return null;
    return { scope: await resolveAiParticipationAccessScope(context, 'applications') };
  })();
  return host.__aiApplicationsReach;
}

/** Set columns (registry `grid`), compared without case where `ci`. */
const SET_COLUMNS: Record<string, { ci: boolean }> = {
  reference: { ci: true },
  family: { ci: false },
  editor: { ci: true },
  hosting_type: { ci: false },
  lifecycle: { ci: false },
  admin_zone: { ci: false },
};
const TEXT_COLUMNS = new Set(['name']);
const NUMBER_COLUMNS = new Set(['server_count', 'application_count', 'open_vulnerabilities']);
const DATE_COLUMNS = new Set(['end_of_support']);

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
  end_of_support: string | null;
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
  const rows: Array<AiTechnologyRow & { total: string }> = await mg.query(
    `WITH r AS (
       SELECT t.id, t.item_number, ('TEC-' || t.item_number) AS reference, t.name, t.editor, t.family, t.hosting_type,
              t.lifecycle, t.admin_zone, t.description, t.created_at, t.updated_at,
              ${technologyServerCountSql('t')} AS server_count,
              ${applicationCount} AS application_count,
              ${technologyEndOfSupportSql('t')} AS end_of_support,
              ${technologyOpenVulnerabilitiesSql('t')} AS open_vulnerabilities
         FROM technologies t
        WHERE t.tenant_id = $1 ${idFilter}
     )
     SELECT ${opts.idsOnly ? 'r.id' : `r.id, r.item_number, r.reference, r.name, r.editor, r.family, r.hosting_type, r.lifecycle,
            r.admin_zone, r.description, r.created_at, r.updated_at, r.server_count, r.application_count,
            to_char(r.end_of_support, 'YYYY-MM-DD') AS end_of_support, r.open_vulnerabilities`},
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
  }));
  return { items, ids: rows.map((row) => row.id), total: Number(rows[0]?.total ?? 0), page, limit };
}

/** The technology's versions with the servers in service each one runs on, newest label order kept by the caller. */
export async function technologyVersionServerCounts(mg: Pick<EntityManager, 'query'>, tenantId: string, technologyId: string): Promise<Map<string, number>> {
  const rows: Array<{ id: string; servers: number }> = await mg.query(
    `SELECT v.id, (SELECT count(DISTINCT at.asset_id)::int
                     FROM asset_technologies at
                     JOIN assets a ON a.tenant_id = at.tenant_id AND a.id = at.asset_id AND ${assetInServiceSql('a')}
                    WHERE at.tenant_id = v.tenant_id AND at.technology_id = v.technology_id AND at.technology_version_id = v.id) AS servers
       FROM technology_versions v
      WHERE v.tenant_id = $1 AND v.technology_id = $2`,
    [tenantId, technologyId],
  );
  return new Map(rows.map((row) => [row.id, Number(row.servers) || 0]));
}

/** The contracts linked to the technology. */
export async function technologyContractCount(mg: Pick<EntityManager, 'query'>, tenantId: string, technologyId: string): Promise<number> {
  const [row]: Array<{ count: number }> = await mg.query(
    `SELECT count(*)::int AS count FROM technology_contracts WHERE tenant_id = $1 AND technology_id = $2`,
    [tenantId, technologyId],
  );
  return Number(row?.count) || 0;
}
