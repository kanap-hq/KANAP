import { assetInServiceSql, inServiceSql } from '../technology-reach.service';

/**
 * The support rule of a technology version, shared by the End of support report and the
 * assistant's technology reads (`ai/query/ai-technologies.query.ts`), so the two cannot disagree.
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
