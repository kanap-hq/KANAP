import type { EntityManager } from 'typeorm';
import { assetInServiceSql, inServiceSql } from '../technology-reach.service';

/**
 * The support rule of a technology version, shared by the End of support report, the assistant's
 * technology reads (`ai/query/ai-technologies.query.ts`) and the technologies of an application's
 * Operations tab (`versionSupportOf`), so they cannot disagree.
 *
 * - `first`: the first end, the standard one, or the extended one when the version has no standard end.
 * - `last`: the last end, after which no support exists: the extended end when it comes after the
 *   standard one, else `first`.
 * - `state` on `today`: `out_of_support` when `last` passed, `extended_support` when only `first`
 *   passed, `supported` otherwise; null without any date.
 * - `date`: the date of that state: `last` once `first` passed, `first` otherwise.
 *
 * Every expression reads the columns of the `technology_versions` alias `v`.
 */
export function versionSupportSql(v: string, today = 'CURRENT_DATE'): { first: string; last: string; state: string; date: string } {
  const first = `COALESCE(${v}.standard_support_end, ${v}.extended_support_end)`;
  // GREATEST skips nulls: the extended end when it comes later, else the first end.
  const last = `GREATEST(${v}.extended_support_end, ${first})`;
  return {
    first,
    last,
    state: `(CASE WHEN ${first} IS NULL THEN NULL
                  WHEN ${last} < ${today} THEN 'out_of_support'
                  WHEN ${first} < ${today} THEN 'extended_support'
                  ELSE 'supported' END)`,
    date: `(CASE WHEN ${first} < ${today} THEN ${last} ELSE ${first} END)`,
  };
}

/** The support of one version by `versionSupportSql`: its two ends, its state today and the date of that state. */
export type VersionSupport = {
  standard_support_end: string | null;
  extended_support_end: string | null;
  state: 'out_of_support' | 'extended_support' | 'supported';
  /** The date that matters, YYYY-MM-DD: the end passed, or the next one to come. */
  date: string;
};

/**
 * The support of the versions `ids` of the tenant, by id, on the rule of the End of support report
 * (`versionSupportSql`). A version without any end is absent. One statement for the batch.
 */
export async function versionSupportOf(
  mg: Pick<EntityManager, 'query'>,
  tenantId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, VersionSupport>> {
  const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (wanted.length === 0) return new Map();
  const support = versionSupportSql('v');
  const rows: Array<VersionSupport & { id: string }> = await mg.query(
    `SELECT v.id, to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
            to_char(v.extended_support_end, 'YYYY-MM-DD') AS extended_support_end,
            ${support.state} AS state, to_char(${support.date}, 'YYYY-MM-DD') AS date
       FROM technology_versions v
      WHERE v.tenant_id = $1 AND v.id = ANY($2::uuid[]) AND ${support.first} IS NOT NULL`,
    [tenantId, wanted],
  );
  return new Map(rows.map(({ id, ...row }) => [id, row]));
}

const STATE_RANK: Record<VersionSupport['state'], number> = { out_of_support: 0, extended_support: 1, supported: 2 };

/** The most pressing of several versions' support: out of support first, then in extended support, then the earliest date. */
export function mostPressingSupport(supports: VersionSupport[]): VersionSupport | null {
  return supports.reduce<VersionSupport | null>((best, next) => (
    !best || STATE_RANK[next.state] - STATE_RANK[best.state] < 0 || (next.state === best.state && next.date < best.date) ? next : best
  ), null);
}

/**
 * A version in use: named by a link to an asset in service, or declared by an application in
 * service (the rule of `countsOfTechnologies`). Reads the `technology_versions` alias `v`.
 */
export function versionInUseSql(v: string): string {
  return `(EXISTS (SELECT 1 FROM asset_technologies uat
                     JOIN assets ua ON ua.tenant_id = uat.tenant_id AND ua.id = uat.asset_id AND ${assetInServiceSql('ua')}
                    WHERE uat.tenant_id = ${v}.tenant_id AND uat.technology_id = ${v}.technology_id AND uat.technology_version_id = ${v}.id)
        OR EXISTS (SELECT 1 FROM application_technologies ud
                     JOIN applications uap ON uap.tenant_id = ud.tenant_id AND uap.id = ud.application_id AND ${inServiceSql('uap')}
                    WHERE ud.tenant_id = ${v}.tenant_id AND ud.technology_id = ${v}.technology_id AND ud.technology_version_id = ${v}.id))`;
}
