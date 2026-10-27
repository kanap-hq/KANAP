import { In } from 'typeorm';
import type { Application } from '../application.entity';

export type DerivedUsersInput = Pick<Application, 'id' | 'users_mode' | 'users_override'> & {
  /** Year to read the metrics for. Defaults to the current year. */
  reference_year?: number | null;
};

/**
 * The metric to use for a reference year: that year's, else the closest earlier year's,
 * else the closest later one. A company whose figures for the new year have not been
 * entered yet keeps last year's, instead of dropping to zero in January.
 */
export function pickMetricForYear<T>(byYear: Map<number, T> | undefined, referenceYear: number): T | undefined {
  if (!byYear || byYear.size === 0) return undefined;
  const exact = byYear.get(referenceYear);
  if (exact !== undefined) return exact;
  const years = [...byYear.keys()];
  const earlier = years.filter((y) => y < referenceYear);
  const chosen = earlier.length > 0 ? Math.max(...earlier) : Math.min(...years);
  return byYear.get(chosen);
}

/**
 * Derived users of applications: the single rule behind the grid column and the
 * application's own total.
 *
 * The total is the current audience: the metrics of the current year, or the most recent
 * ones entered (see pickMetricForYear). `applications.users_year` is no longer read. No
 * screen lets a user choose it: it was stamped with the creation year and never moved, so
 * the total stopped following the figures entered for later years, and an application
 * imported from CSV had no year at all and derived nothing.
 *
 * Fixed number of queries for a whole page: the company/department links in one read, the
 * departments in one read, then one metrics read per family.
 */
export async function buildDerivedUsersByApp(
  apps: DerivedUsersInput[],
  mg: any,
  currentYear: number = new Date().getFullYear(),
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (apps.length === 0) return out;

  const { ApplicationCompany } = await import('../application-company.entity');
  const { ApplicationDepartment } = await import('../application-department.entity');
  const { Department } = await import('../../departments/department.entity');
  const { CompanyMetric } = await import('../../companies/company-metric.entity');
  const { DepartmentMetric } = await import('../../departments/department-metric.entity');

  // `manual` needs no query at all: the override is already on the loaded row. A null
  // mode behaves like `headcount`, as it did before.
  const linked = apps.filter((a) => a.users_mode !== 'manual');

  const companiesByApp: Record<string, string[]> = {};
  const departmentsByApp: Record<string, string[]> = {};
  if (linked.length > 0) {
    const linkedIds = linked.map((a) => a.id);
    // One after the other: the request's single connection runs its queries in turn anyway.
    const companyLinks = await mg.getRepository(ApplicationCompany).find({ where: { application_id: In(linkedIds) } as any });
    const departmentLinks = await mg.getRepository(ApplicationDepartment).find({ where: { application_id: In(linkedIds) } as any });
    for (const l of companyLinks as any[]) (companiesByApp[l.application_id] ||= []).push(l.company_id);
    for (const l of departmentLinks as any[]) (departmentsByApp[l.application_id] ||= []).push(l.department_id);
  }

  // A department that belongs to one of the application's companies is skipped, so the
  // company metrics are not double counted.
  const departmentIds = [...new Set(Object.values(departmentsByApp).flat())];
  const departmentCompany: Record<string, string> = {};
  if (departmentIds.length > 0) {
    const rows = await mg.getRepository(Department).find({ where: { id: In(departmentIds) } });
    for (const d of rows as any[]) departmentCompany[d.id] = d.company_id;
  }

  const companyIds = [...new Set(Object.values(companiesByApp).flat())];
  const companyMetrics: Record<string, Map<number, { itUsers: number | null; headcount: number }>> = {};
  const departmentHeadcount: Record<string, Map<number, number>> = {};
  // One after the other: the request's single connection runs its queries in turn anyway.
  const companyRows = companyIds.length > 0
    ? await mg.getRepository(CompanyMetric).find({ where: { company_id: In(companyIds) } })
    : [];
  const departmentRows = departmentIds.length > 0
    ? await mg.getRepository(DepartmentMetric).find({ where: { department_id: In(departmentIds) } })
    : [];
  for (const m of companyRows as any[]) {
    const it = m.it_users;
    (companyMetrics[m.company_id] ||= new Map()).set(Number(m.fiscal_year), {
      itUsers: typeof it === 'number' && it != null ? it : null,
      headcount: Number(m.headcount || 0),
    });
  }
  for (const m of departmentRows as any[]) {
    (departmentHeadcount[m.department_id] ||= new Map()).set(Number(m.fiscal_year), Number(m.headcount || 0));
  }

  for (const app of apps) {
    if (app.users_mode === 'manual') {
      out[app.id] = Math.max(0, Number(app.users_override || 0));
      continue;
    }
    const appCompanyIds = companiesByApp[app.id] || [];
    const appCompanyIdSet = new Set(appCompanyIds);
    const appDepartmentIds = (departmentsByApp[app.id] || []).filter((id) => !appCompanyIdSet.has(departmentCompany[id]));
    let total = 0;
    const referenceYear = app.reference_year ?? currentYear;
    for (const companyId of appCompanyIdSet) {
      const metric = pickMetricForYear(companyMetrics[companyId], referenceYear);
      if (!metric) continue;
      total += app.users_mode === 'it_users' ? (metric.itUsers ?? metric.headcount) : metric.headcount;
    }
    for (const departmentId of appDepartmentIds) {
      total += pickMetricForYear(departmentHeadcount[departmentId], referenceYear) || 0;
    }
    out[app.id] = total;
  }

  return out;
}

/**
 * The derived users of the application `alias` (a row of `applications`) in SQL, for the list's
 * filter: the rule of `buildDerivedUsersByApp` for `currentYear`. Manual: the override, at least
 * 0. Otherwise the metric of each linked company (its IT users in `it_users` mode, else its
 * headcount) plus the headcount of each linked department whose company is not linked, each read
 * for the year as `pickMetricForYear` picks it (that year, else the closest earlier one, else the
 * closest later one). Both must stay the same rule.
 */
export function derivedTotalUsersSql(alias: string, currentYear: number = new Date().getFullYear()): string {
  const year = Math.trunc(currentYear);
  const pick = (table: string, idColumn: string, id: string, value: string) => `(SELECT ${value} FROM ${table} m
      WHERE m.tenant_id = ${alias}.tenant_id AND m.${idColumn} = ${id}
      ORDER BY (m.fiscal_year > ${year}), abs(m.fiscal_year - ${year})
      LIMIT 1)`;
  const companyMetric = `CASE WHEN ${alias}.users_mode = 'it_users' THEN COALESCE(m.it_users, m.headcount, 0) ELSE COALESCE(m.headcount, 0) END`;
  return `(CASE WHEN ${alias}.users_mode = 'manual' THEN GREATEST(0, COALESCE(${alias}.users_override, 0))
    ELSE COALESCE((SELECT SUM(${pick('company_metrics', 'company_id', 'lc.company_id', companyMetric)})
        FROM (SELECT DISTINCT l.company_id FROM application_companies l
          WHERE l.application_id = ${alias}.id AND l.tenant_id = ${alias}.tenant_id) lc), 0)
      + COALESCE((SELECT SUM(${pick('department_metrics', 'department_id', 'ld.department_id', 'COALESCE(m.headcount, 0)')})
        FROM (SELECT DISTINCT l.department_id FROM application_departments l
          LEFT JOIN departments d ON d.id = l.department_id AND d.tenant_id = l.tenant_id
          WHERE l.application_id = ${alias}.id AND l.tenant_id = ${alias}.tenant_id
            AND NOT EXISTS (SELECT 1 FROM application_companies c
              WHERE c.application_id = ${alias}.id AND c.tenant_id = ${alias}.tenant_id AND c.company_id = d.company_id)) ld), 0)
  END)`;
}
